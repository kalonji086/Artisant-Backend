import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { updateEmployerRequestSchema } from '../lib/validation';

type AuthenticatedRequest = Request & { user?: { id: string } };

const QUOTE_STATUSES = ['pending', 'accepted', 'rejected', 'completed'] as const;
const PROFILE_ROLES = ['client', 'artisan', 'admin'] as const;
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

/**
 * GET /api/v1/admin/stats
 * Statistiques agrégées du tableau de bord principal.
 */
export const getAdminStats = async (_req: Request, res: Response) => {
  try {
    const sixMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1).toISOString();

    const [
      totalProfilesRes,
      clientsRes,
      artisansRes,
      activeArtisansRes,
      quotesTotalRes,
      quotesRowsRes,
      jobsRes,
      categoriesRes,
      pendingRequestsRes,
      recentProfilesRes,
      recentQuotesRes,
      servicesRes,
      categoriesListRes,
      signupsRes,
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'client'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'artisan'),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'artisan')
        .eq('is_available', true),
      supabase.from('quotes').select('id', { count: 'exact', head: true }),
      supabase.from('quotes').select('status'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }),
      supabase.from('categories').select('id', { count: 'exact', head: true }),
      supabase.from('employer_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase
        .from('profiles')
        .select('id, full_name, role, avatar_url, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('quotes')
        .select('id, status, price, created_at, client_id, artisan_id')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('artisan_services').select('category_id'),
      supabase.from('categories').select('id, name'),
      supabase.from('profiles').select('created_at').gte('created_at', sixMonthsAgo),
    ]);

    const allResults = [
      totalProfilesRes, clientsRes, artisansRes, activeArtisansRes, quotesTotalRes,
      quotesRowsRes, jobsRes, categoriesRes, pendingRequestsRes, recentProfilesRes,
      recentQuotesRes, servicesRes, categoriesListRes, signupsRes,
    ];
    const failed = allResults.find((r) => r.error);
    if (failed?.error) throw failed.error;

    // Devis par statut
    const quotesByStatus = QUOTE_STATUSES.map((status) => ({
      status,
      count: quotesRowsRes.data?.filter((q) => q.status === status).length ?? 0,
    }));

    // Inscriptions par mois (6 derniers mois, mois vides inclus)
    const signupsByMonth = buildMonthKeys(6).map((month) => ({ month, count: 0 }));
    for (const row of signupsRes.data ?? []) {
      if (!row.created_at) continue;
      const d = new Date(row.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = signupsByMonth.find((m) => m.month === key);
      if (bucket) bucket.count += 1;
    }

    // Services par catégorie
    const categoryNames = new Map((categoriesListRes.data ?? []).map((c) => [c.id, c.name]));
    const serviceCounts = new Map<string, number>();
    for (const row of servicesRes.data ?? []) {
      const name = (row.category_id && categoryNames.get(row.category_id)) || 'Non classé';
      serviceCounts.set(name, (serviceCounts.get(name) ?? 0) + 1);
    }
    const servicesByCategory = Array.from(serviceCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Devis récents avec noms résolus
    const recentQuoteRows = recentQuotesRes.data ?? [];
    const quoteProfileNames = await fetchProfileNames(
      recentQuoteRows.flatMap((q) => [q.client_id, q.artisan_id])
    );
    const recentQuotes = recentQuoteRows.map((q) => ({
      ...q,
      client_name: quoteProfileNames[q.client_id] ?? '—',
      artisan_name: quoteProfileNames[q.artisan_id] ?? '—',
    }));

    res.json({
      totals: {
        users: totalProfilesRes.count ?? 0,
        clients: clientsRes.count ?? 0,
        artisans: artisansRes.count ?? 0,
        activeArtisans: activeArtisansRes.count ?? 0,
        quotes: quotesTotalRes.count ?? 0,
        quotesPending: quotesByStatus.find((s) => s.status === 'pending')?.count ?? 0,
        jobs: jobsRes.count ?? 0,
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
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la récupération des statistiques';
    res.status(500).json({ error: message });
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
      .select('id, full_name, phone, role, avatar_url, is_available, rating, address, created_at', {
        count: 'exact',
      });

    if (role) query = query.eq('role', role);
    if (search) query = query.or(`full_name.ilike.%${search}%,address.ilike.%${search}%`);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    res.json({
      data: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la récupération des utilisateurs';
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
        artisan_name: names[q.artisan_id] ?? '—',
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
    const message = err instanceof Error
      ? err.message
      : 'Erreur inconnue lors de la récupération des demandes employeur';
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