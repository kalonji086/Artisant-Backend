import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { logActivity } from '../lib/activity';
import { updateEmployerRequestSchema, updateUserSchema, reasonSchema } from '../lib/validation';

type AuthenticatedRequest = Request & { user?: { id: string } };

const QUOTE_STATUSES = ['unassigned', 'assigned', 'pending', 'accepted', 'rejected', 'completed'] as const;
const PROFILE_ROLES = ['client', 'artisan'] as const;
const EMPLOYER_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** Extrait page/pageSize sûrs depuis la query string (bornés). */
const parsePagination = (req: Request) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
};

/** Résout une liste d'UUIDs profils en { id: full_name }. */
const fetchProfileNames = async (ids: Array<string | null | undefined>): Promise<Record<string, string>> => {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', unique);

  if (error) throw error;

  return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name || 'Utilisateur inconnu']));
};

/** Génère les clés 'YYYY-MM' des N derniers mois (mois courant inclus). */
const buildMonthKeys = (months: number): string[] => {
  const keys: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

const getMonthRange = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    to: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
};

/**
 * GET /api/v1/admin/stats
 * Statistiques agrégées du tableau de bord principal.
 */
export const getAdminStats = async (_req: Request, res: Response) => {
  try {
    const monthKeys = buildMonthKeys(12);

    const [
      totalProfilesRes,
      clientsRes,
      artisansRes,
      activeArtisansRes,
      quotesTotalRes,
      categoriesRes,
      pendingRequestsRes,
      recentProfilesRes,
      recentQuotesRes,
      categoriesListRes,
    ] = await Promise.all([
      (() => { console.log('[STATS] totalProfiles'); return supabase.from('profiles').select('id', { count: 'exact', head: true }).in('role', PROFILE_ROLES); })(),
      (() => { console.log('[STATS] clients'); return supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'client'); })(),
      (() => { console.log('[STATS] artisans'); return supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'artisan'); })(),
      (() => { console.log('[STATS] activeArtisans'); return supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'artisan').eq('is_available', true); })(),
      (() => { console.log('[STATS] quotes'); return supabase.from('quotes').select('id', { count: 'exact', head: true }); })(),
      (() => { console.log('[STATS] categories'); return supabase.from('categories').select('id', { count: 'exact', head: true }); })(),
      (() => { console.log('[STATS] pendingRequests'); return supabase.from('employer_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'); })(),
      (() => { console.log('[STATS] recentProfiles'); return supabase.from('profiles').select('id, full_name, role, avatar_url, created_at').in('role', PROFILE_ROLES).order('created_at', { ascending: false }).limit(5); })(),
      (() => { console.log('[STATS] recentQuotes'); return supabase.from('quotes').select('id, status, price, created_at, client_id, artisan_id').order('created_at', { ascending: false }).limit(5); })(),
      (() => { console.log('[STATS] categoriesList'); return supabase.from('categories').select('id, name'); })(),
    ]);

    const allResults = [
      totalProfilesRes, clientsRes, artisansRes, activeArtisansRes, quotesTotalRes,
      categoriesRes, pendingRequestsRes, recentProfilesRes, recentQuotesRes,
      categoriesListRes,
    ];
    const failed = allResults.find((r) => r.error);
    if (failed?.error) {
      console.error('[STATS] Initial query failed:', failed.error);
      throw failed.error;
    }

    console.log('[STATS] Initial queries OK, starting quote status queries...');

    const [quoteStatusResults, signupResults] = await Promise.all([
      Promise.all(
        QUOTE_STATUSES.map((status) => {
          console.log(`[STATS] Quote status: ${status}`);
          return supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', status);
        })
      ),
      Promise.all(
        monthKeys.map((month) => {
          console.log(`[STATS] Signup month: ${month}`);
          const range = getMonthRange(month);
          return supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .in('role', PROFILE_ROLES)
            .gte('created_at', range.from)
            .lt('created_at', range.to);
        })
      ),
    ]);

    console.log('[STATS] Quote and signup queries OK');

    const aggregateError = [...quoteStatusResults, ...signupResults].find((result) => result.error);
    if (aggregateError?.error) {
      console.error('[STATS] Aggregate query failed:', aggregateError.error);
      throw aggregateError.error;
    }

    console.log('[STATS] Starting category services queries...');

    const quotesByStatus = QUOTE_STATUSES.map((status, index) => ({
      status,
      count: quoteStatusResults[index].count ?? 0,
    }));
    const signupsByMonth = monthKeys.map((month, index) => ({
      month,
      count: signupResults[index].count ?? 0,
    }));

    const categories = categoriesListRes.data ?? [];
    console.log(`[STATS] Categories count: ${categories.length}`);

    let servicesByCategory: Array<{ category: string; count: number }> = [];
    try {
      const serviceCountResults = await Promise.all([
        ...categories.map((category) => {
          console.log(`[STATS] Service count for category: ${category.id}`);
          return supabase
            .from('artisan_services')
            .select('category_id', { count: 'exact', head: true })
            .eq('category_id', category.id);
        }),
        (() => {
          console.log('[STATS] Service count uncategorized');
          return supabase
            .from('artisan_services')
            .select('category_id', { count: 'exact', head: true })
            .is('category_id', null);
        })(),
      ]);

      console.log('[STATS] Service count queries OK');

      const serviceError = serviceCountResults.find((result) => result.error);
      if (serviceError?.error) {
        console.error('[STATS] Service count failed:', serviceError.error);
        throw serviceError.error;
      }

      const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
      const serviceCounts = new Map<string, number>();
      categories.forEach((category, index) => {
        const name = categoryNames.get(category.id) || 'Non classé';
        serviceCounts.set(name, (serviceCounts.get(name) ?? 0) + (serviceCountResults[index].count ?? 0));
      });
      const uncategorizedCount = serviceCountResults[categories.length].count ?? 0;
      if (uncategorizedCount > 0) {
        serviceCounts.set('Non classé', (serviceCounts.get('Non classé') ?? 0) + uncategorizedCount);
      }
      servicesByCategory = Array.from(serviceCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    } catch (err) {
      console.error('[STATS] Skipping service count due to error:', err);
      // Continue without service counts - artisan_services may not be initialized
    }

    // Devis récents avec noms résolus
    const recentQuoteRows = recentQuotesRes.data ?? [];
    const quoteProfileNames = await fetchProfileNames(
      recentQuoteRows.flatMap((q) => [q.client_id, q.artisan_id])
    );
    const recentQuotes = recentQuoteRows.map((q) => ({
      ...q,
      client_name: quoteProfileNames[q.client_id] ?? '—',
      artisan_name: q.artisan_id ? (quoteProfileNames[q.artisan_id] ?? '—') : 'Non assigné',
    }));

    res.json({
      totals: {
        users: totalProfilesRes.count ?? 0,
        clients: clientsRes.count ?? 0,
        artisans: artisansRes.count ?? 0,
        activeArtisans: activeArtisansRes.count ?? 0,
        quotes: quotesTotalRes.count ?? 0,
        quotesPending: quotesByStatus.find((s) => s.status === 'pending')?.count ?? 0,
        jobs: 0,
        categories: categoriesRes.count ?? 0,
        employerRequestsPending: pendingRequestsRes.count ?? 0,
      },
      quotesByStatus,
      signupsByMonth,
      servicesByCategory,
      recentUsers: recentProfilesRes.data ?? [],
      recentQuotes,
    });
  } catch (err: unknown) {
    console.error('DEBUG: Full error object:', JSON.stringify(err, null, 2));
    console.error('DEBUG: Error type:', typeof err);
    console.error('DEBUG: Error instanceof Error:', err instanceof Error);

    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' &&
            err !== null &&
            'message' in err &&
            typeof err.message === 'string'
          ? err.message
          : 'Erreur inconnue lors de la récupération des statistiques';
    logger.error('Erreur lors de la récupération des statistiques', {
      error: message || 'ERROR_EMPTY',
      fullError: err,
      errorString: String(err)
    });
    res.status(500).json({ error: message || 'Erreur serveur (voir logs)' });
  }
};

/**
 * GET /api/v1/admin/users?search=&role=&page=&pageSize=
 * Liste paginée des profils (recherche + filtre par rôle).
 */
export const getUsers = async (req: Request, res: Response) => {
  const { page, pageSize, from, to } = parsePagination(req);

  const roleParam = typeof req.query.role === 'string' ? req.query.role : '';
  const role = (PROFILE_ROLES as readonly string[]).includes(roleParam) ? roleParam : null;
  const search = typeof req.query.search === 'string'
    ? req.query.search.replace(/[,()]/g, ' ').trim()
    : '';

  try {
    let query = supabase
      .from('profiles')
      .select('id, full_name, phone, role, avatar_url, is_available, rating, address, city, profession, description, created_at, is_suspended, suspended_at, suspension_reason', {
        count: 'exact',
      });

    query = query.in('role', PROFILE_ROLES);
    if (role) query = query.eq('role', role);
    if (search) {
      const filters = [`full_name.ilike.%${search}%`, `address.ilike.%${search}%`, `city.ilike.%${search}%`, `phone.ilike.%${search}%`];
      const { data: byEmail } = await supabase
        .from('profile_details')
        .select('user_id')
        .ilike('email', `%${search}%`)
        .limit(200);
      if (byEmail?.length) filters.push(`id.in.(${byEmail.map((r) => r.user_id).join(',')})`);
      query = query.or(filters.join(','));
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    // Table absente (migration 017 non exécutée) : la liste reste affichée sans les détails.
    const { data: details } = rows.length
      ? await supabase.from('profile_details').select('*').in('user_id', rows.map((r) => r.id))
      : { data: [] };
    const byId = new Map((details ?? []).map((d) => [d.user_id as string, d]));

    res.json({
      data: rows.map((r) => {
        const d = byId.get(r.id);
        return {
          ...r,
          email: d?.email ?? null,
          birth_date: d?.birth_date ?? null,
          gender: d?.gender ?? null,
          country: d?.country ?? null,
          years_experience: d?.years_experience ?? null,
          service_radius_km: d?.service_radius_km ?? null,
          terms_accepted_at: d?.terms_accepted_at ?? null,
          terms_version: d?.terms_version ?? null,
        };
      }),
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' &&
            err !== null &&
            'message' in err &&
            typeof err.message === 'string'
          ? err.message
          : 'Erreur inconnue lors de la récupération des utilisateurs';
    logger.error('Erreur lors de la récupération des utilisateurs', { error: message });
    res.status(500).json({ error: message });
  }
};

/**
 * GET /api/v1/admin/quotes?status=&page=&pageSize=
 * Tous les devis de la plateforme, avec noms client/artisan résolus.
 */
export const getQuotes = async (req: Request, res: Response) => {
  const { page, pageSize, from, to } = parsePagination(req);

  const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
  const status = (QUOTE_STATUSES as readonly string[]).includes(statusParam) ? statusParam : null;

  try {
    let query = supabase.from('quotes').select('*', { count: 'exact' });
    if (status) query = query.eq('status', status);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    const names = await fetchProfileNames(rows.flatMap((q) => [q.client_id, q.artisan_id]));

    res.json({
      data: rows.map((q) => ({
        ...q,
        client_name: names[q.client_id] ?? '—',
        artisan_name: q.artisan_id ? (names[q.artisan_id] ?? '—') : 'Non assigné',
      })),
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la récupération des devis';
    res.status(500).json({ error: message });
  }
};

/**
 * GET /api/v1/admin/employer-requests?status=&page=&pageSize=
 * Demandes d'accès employeur (file d'attente d'approbation).
 */
export const getEmployerRequests = async (req: Request, res: Response) => {
  const { page, pageSize, from, to } = parsePagination(req);

  const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
  const status = (EMPLOYER_REQUEST_STATUSES as readonly string[]).includes(statusParam)
    ? statusParam
    : null;

  try {
    let query = supabase.from('employer_requests').select(
      'id, user_id, company_name, company_email, company_phone, industry, company_size, contact_person, contact_email, hiring_needs, expected_hires, status, admin_notes, approved_at, created_at',
      { count: 'exact' }
    );

    if (status) query = query.eq('status', status);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    res.json({
      data: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' &&
            err !== null &&
            'message' in err &&
            typeof err.message === 'string'
          ? err.message
          : 'Erreur inconnue lors de la récupération des demandes employeur';
    logger.error('Erreur lors de la récupération des demandes employeur', { error: message });
    res.status(500).json({ error: message });
  }
};

/**
 * PATCH /api/v1/admin/employer-requests/:id
 * Approuve ou rejette une demande employeur.
 * À l'approbation : crée/met à jour le profil employeur (employer_profiles).
 */
export const updateEmployerRequestStatus = async (req: Request, res: Response) => {
  const admin = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const validationResult = updateEmployerRequestSchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: validationResult.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  const { status, admin_notes } = validationResult.data;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('employer_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) {
      return res.status(404).json({ error: 'Demande employeur non trouvée' });
    }

    const updatePayload: Record<string, unknown> = { status };
    if (admin_notes !== undefined) updatePayload.admin_notes = admin_notes;
    if (status === 'approved') {
      updatePayload.approved_by = admin?.id;
      updatePayload.approved_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('employer_requests')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logActivity({
      actorId: admin?.id,
      action: `employer_request.${status}`,
      entityType: 'employer_request',
      entityId: id,
      metadata: { company_name: existing.company_name },
    });

    // À l'approbation : créer (ou rafraîchir) le profil employeur actif
    if (status === 'approved' && existing.user_id) {
      const { error: upsertError } = await supabase.from('employer_profiles').upsert(
        {
          user_id: existing.user_id,
          request_id: existing.id,
          company_name: existing.company_name,
          company_email: existing.company_email,
          company_phone: existing.company_phone,
          company_address: existing.company_address,
          company_website: existing.company_website,
          contact_person: existing.contact_person,
          contact_position: existing.contact_position,
          contact_email: existing.contact_email,
          contact_phone: existing.contact_phone,
          industry: existing.industry,
          company_size: existing.company_size,
          years_in_business: existing.years_in_business,
          is_active: true,
        },
        { onConflict: 'user_id' }
      );
      if (upsertError) throw upsertError;
    }

    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : 'Erreur inconnue lors de la mise à jour de la demande';
    res.status(500).json({ error: message });
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Durée de bannissement Supabase effective « indéfiniment » (≈ 100 ans)
const BAN_FOREVER = '876000h';

const errorMessageOf = (err: unknown, fallback: string): string =>
  err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string'
      ? err.message
      : fallback;

/** Charge un utilisateur géré par l'admin. Refuse les actions sur soi-même et sur un autre admin. */
const loadManagedUser = async (
  adminId: string | undefined,
  id: string,
  { allowSelf = false }: { allowSelf?: boolean } = {}
): Promise<{ status: number; error?: string; profile?: Record<string, unknown> }> => {
  if (!UUID_RE.test(id)) return { status: 400, error: 'Identifiant utilisateur invalide' };
  if (!allowSelf && id === adminId) return { status: 400, error: 'Action impossible sur votre propre compte' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, is_suspended')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: 404, error: 'Utilisateur non trouvé' };
  if (data.role === 'admin') return { status: 403, error: 'Les comptes administrateurs ne peuvent pas être modifiés ici' };
  return { status: 200, profile: data };
};

/**
 * PATCH /api/v1/admin/users/:id
 * Modifie les informations d'un profil (et le rôle client/artisan). Motif obligatoire.
 */
export const updateUser = async (req: Request, res: Response) => {
  const admin = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  const { reason, ...fields } = parsed.data;
  const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) {
    return res.status(400).json({ error: 'Aucune modification fournie' });
  }

  try {
    const check = await loadManagedUser(admin?.id, id);
    if (check.error) return res.status(check.status).json({ error: check.error });
    const before = check.profile!;

    if (changes.role !== undefined && id === admin?.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas changer votre propre rôle' });
    }

    // Le rôle est protégé par le trigger prevent_role_change : la clé service role est autorisée.
    const { data, error } = await supabase
      .from('profiles')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    await logActivity({
      actorId: admin?.id,
      action: changes.role !== undefined && changes.role !== before.role ? 'user.role_changed' : 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: {
        reason,
        fields: Object.keys(changes),
        ...(changes.role !== undefined ? { role_from: before.role, role_to: changes.role } : {}),
      },
    });

    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessageOf(err, 'Erreur lors de la mise à jour de l\'utilisateur') });
  }
};

/**
 * POST /api/v1/admin/users/:id/suspend
 * Suspend le compte : bannissement auth (connexion impossible) + statut affiché en temps réel.
 */
export const suspendUser = async (req: Request, res: Response) => {
  const admin = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { reason } = parsed.data;

  try {
    const check = await loadManagedUser(admin?.id, id);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { error: banError } = await supabase.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
    if (banError) throw banError;

    const { data, error } = await supabase
      .from('profiles')
      .update({ is_suspended: true, suspended_at: new Date().toISOString(), suspension_reason: reason })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    await logActivity({ actorId: admin?.id, action: 'user.suspended', entityType: 'user', entityId: id, metadata: { reason } });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessageOf(err, 'Erreur lors de la suspension du compte') });
  }
};

/**
 * POST /api/v1/admin/users/:id/reactivate
 * Lève la suspension (retire le bannissement auth).
 */
export const reactivateUser = async (req: Request, res: Response) => {
  const admin = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { reason } = parsed.data;

  try {
    const check = await loadManagedUser(admin?.id, id);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { error: unbanError } = await supabase.auth.admin.updateUserById(id, { ban_duration: 'none' });
    if (unbanError) throw unbanError;

    const { data, error } = await supabase
      .from('profiles')
      .update({ is_suspended: false, suspended_at: null, suspension_reason: null })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    await logActivity({ actorId: admin?.id, action: 'user.reactivated', entityType: 'user', entityId: id, metadata: { reason } });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessageOf(err, 'Erreur lors de la réactivation du compte') });
  }
};

/**
 * POST /api/v1/admin/users/:id/delete
 * Suppression définitive du compte (profil, données liées en cascade, et utilisateur auth).
 * Le motif est journalisé ; l'email est conservé dans le journal pour traçabilité.
 */
export const deleteUserAccount = async (req: Request, res: Response) => {
  const admin = (req as AuthenticatedRequest).user;
  const { id } = req.params;

  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { reason } = parsed.data;

  try {
    const check = await loadManagedUser(admin?.id, id);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { data: details } = await supabase.from('profile_details').select('email').eq('user_id', id).maybeSingle();
    const email = (details?.email as string | undefined) ?? null;

    const { error: profileError } = await supabase.from('profiles').delete().eq('id', id);
    if (profileError) throw profileError;

    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) throw authError;

    await logActivity({
      actorId: admin?.id,
      action: 'user.deleted',
      entityType: 'user',
      entityId: id,
      metadata: { reason, email, role: check.profile?.role ?? null },
    });
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessageOf(err, 'Erreur lors de la suppression du compte') });
  }
};

export const getDatabaseStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { SETUP_INSTRUCTIONS } = await import('../lib/init-database');

    res.json({
      status: 'Database initialization required',
      message: 'Les tables Supabase doivent être créées manuellement via le SQL Editor de Supabase.',
      setupInstructions: SETUP_INSTRUCTIONS,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    res.status(500).json({ error: message });
  }
};