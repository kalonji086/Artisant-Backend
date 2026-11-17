import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { sendEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

type AuthenticatedRequest = Request & { user?: { id: string; email?: string } };
type WorkspaceRole = 'owner' | 'employee';
type Workspace = { ownerId: string; userId: string; role: WorkspaceRole };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const safeError = (error: unknown) => error instanceof Error ? error.message : String(error);

async function getWorkspace(userId: string): Promise<Workspace | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('business_type')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.business_type) return { ownerId: userId, userId, role: 'owner' };

  const { data: membership, error } = await supabase
    .from('business_members')
    .select('owner_id')
    .eq('member_user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return membership ? { ownerId: membership.owner_id, userId, role: 'employee' } : null;
}

async function requireWorkspace(
  req: Request,
  res: Response,
  ownerOnly = false
): Promise<Workspace | null> {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Session invalide.' });
    return null;
  }
  try {
    const workspace = await getWorkspace(userId);
    if (!workspace) {
      res.status(403).json({ error: 'Un statut Entreprise ou Sous-traitance approuvé est requis.' });
      return null;
    }
    if (ownerOnly && workspace.role !== 'owner') {
      res.status(403).json({ error: 'Cette action est réservée au responsable de l’entreprise.' });
      return null;
    }
    return workspace;
  } catch (error) {
    logger.error('Résolution de l’espace entreprise impossible', { user_id: userId, error: safeError(error) });
    res.status(500).json({ error: 'Impossible de vérifier l’accès à l’espace entreprise.' });
    return null;
  }
}

function logDatabaseError(action: string, error: unknown, res: Response) {
  logger.error(action, { error: safeError(error) });
  return res.status(500).json({ error: 'Une erreur est survenue pendant le traitement de la demande.' });
}

function escapedHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

export async function getBusinessAccess(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  try {
    const workspace = await getWorkspace(userId);
    return res.json({ access: workspace ? { owner_id: workspace.ownerId, role: workspace.role } : null });
  } catch (error) {
    return logDatabaseError('Lecture de l’accès entreprise impossible', error, res);
  }
}

export async function getBusinessDashboard(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res);
  if (!workspace) return;
  try {
    const ownerId = workspace.ownerId;
    const [profile, projects] = await Promise.all([
      supabase.from('business_profiles').select('company_name, business_type, country').eq('owner_id', ownerId).maybeSingle(),
      supabase.from('business_projects').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).in('status', ['active', 'on_hold']),
    ]);
    if (profile.error) throw profile.error;
    if (projects.error) throw projects.error;
    if (workspace.role === 'employee') {
      return res.json({
        access: { owner_id: ownerId, role: workspace.role },
        profile: profile.data,
        stats: { active_projects: projects.count ?? 0 },
      });
    }

    const [jobs, applications, contracts, payments, members] = await Promise.all([
      supabase.from('business_jobs').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId),
      supabase.from('business_applications').select('id, business_jobs!inner(owner_id)', { count: 'exact', head: true }).eq('business_jobs.owner_id', ownerId).in('status', ['submitted', 'shortlisted']),
      supabase.from('business_contracts').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).in('status', ['draft', 'signing']),
      supabase.from('business_payments').select('amount, status, currency').eq('owner_id', ownerId),
      supabase.from('business_members').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId).eq('status', 'active'),
    ]);
    const errors = [jobs, applications, contracts, payments, members].find((result) => result.error);
    if (errors?.error) throw errors.error;

    return res.json({
      access: { owner_id: ownerId, role: workspace.role },
      profile: profile.data,
      stats: {
        jobs: jobs.count ?? 0,
        applications: applications.count ?? 0,
        active_projects: projects.count ?? 0,
        contracts_to_sign: contracts.count ?? 0,
        team_members: members.count ?? 0,
        unpaid_amount: (payments.data ?? [])
          .filter((payment) => payment.status === 'planned' || payment.status === 'due' || payment.status === 'overdue')
          .reduce((sum, payment) => sum + Number(payment.amount), 0),
        currency: payments.data?.[0]?.currency ?? 'USD',
      },
    });
  } catch (error) {
    return logDatabaseError('Chargement du tableau de bord entreprise impossible', error, res);
  }
}

export async function getBusinessProfile(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const { data, error } = await supabase
    .from('business_profiles')
    .select('owner_id, business_type, company_name, country, registration_number, tax_number, company_address, contact_person, contact_email, contact_phone, industry, website, description, updated_at')
    .eq('owner_id', workspace.ownerId)
    .maybeSingle();
  if (error) return logDatabaseError('Lecture du profil entreprise impossible', error, res);
  if (!data) return res.status(404).json({ error: 'Profil entreprise introuvable.' });
  return res.json({ profile: data, access: { role: workspace.role } });
}

export async function updateBusinessProfile(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const body = req.body ?? {};
  const allowed: Record<string, [number, number]> = {
    company_name: [2, 160],
    company_address: [5, 250],
    contact_person: [2, 120],
    contact_email: [3, 254],
    contact_phone: [6, 40],
    industry: [2, 100],
    website: [0, 250],
    description: [0, 1500],
  };
  const patch: Record<string, string> = {};
  for (const [field, [min, max]] of Object.entries(allowed)) {
    if (body[field] === undefined) continue;
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (value.length < min || value.length > max) {
      return res.status(400).json({ error: `Le champ ${field} est invalide.` });
    }
    if (field === 'contact_email' && !EMAIL_RE.test(value)) {
      return res.status(400).json({ error: 'Adresse e-mail de contact invalide.' });
    }
    if (field === 'website' && value && !/^https?:\/\/\S+$/i.test(value)) {
      return res.status(400).json({ error: 'Le site Web doit commencer par http:// ou https://.' });
    }
    patch[field] = value;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucune modification valide.' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('business_profiles')
    .update(patch)
    .eq('owner_id', workspace.ownerId)
    .select()
    .maybeSingle();
  if (error) return logDatabaseError('Mise à jour du profil entreprise impossible', error, res);
  if (!data) return res.status(404).json({ error: 'Profil entreprise introuvable.' });
  return res.json({ profile: data });
}

const JOB_SELECT = 'id, owner_id, created_by, title, category, description, city, work_type, budget_min, budget_max, currency, status, expires_at, created_at, updated_at';

export async function listBusinessJobs(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const { data, error } = await supabase
    .from('business_jobs')
    .select(JOB_SELECT)
    .eq('owner_id', workspace.ownerId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return logDatabaseError('Lecture des demandes entreprise impossible', error, res);
  return res.json({ data: data ?? [] });
}

export async function searchBusinessJobs(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) return logDatabaseError('Vérification du compte artisan impossible', profileError, res);
  if (profile?.role !== 'artisan') return res.status(403).json({ error: 'Les demandes sont réservées aux comptes artisan.' });

  const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 100) : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 80) : '';
  let query = supabase
    .from('business_jobs')
    .select('id, owner_id, title, category, description, city, work_type, budget_min, budget_max, currency, expires_at, created_at')
    .eq('status', 'published')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (term) query = query.ilike('title', `%${term.replace(/[%_,]/g, '')}%`);
  if (city) query = query.ilike('city', `%${city.replace(/[%_,]/g, '')}%`);
  if (category) query = query.ilike('category', `%${category.replace(/[%_,]/g, '')}%`);
  const { data, error } = await query;
  if (error) return logDatabaseError('Recherche des demandes entreprise impossible', error, res);

  const ownerIds = Array.from(new Set((data ?? []).map((job) => job.owner_id)));
  const { data: companies, error: companyError } = ownerIds.length
    ? await supabase.from('business_profiles').select('owner_id, company_name, business_type, country').in('owner_id', ownerIds)
    : { data: [], error: null };
  if (companyError) return logDatabaseError('Lecture des profils entreprise impossible', companyError, res);
  const companiesByOwner = new Map((companies ?? []).map((company) => [company.owner_id, company]));
  const { data: applications, error: applicationError } = await supabase
    .from('business_applications')
    .select('job_id, status')
    .eq('applicant_id', userId)
    .in('job_id', (data ?? []).map((job) => job.id));
  if (applicationError) return logDatabaseError('Lecture des candidatures artisan impossible', applicationError, res);
  const applicationByJob = new Map((applications ?? []).map((application) => [application.job_id, application.status]));
  return res.json({
    data: (data ?? []).map((job) => ({
      ...job,
      business: companiesByOwner.get(job.owner_id) ?? null,
      application_status: applicationByJob.get(job.id) ?? null,
    })),
  });
}

export async function createBusinessJob(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const body = req.body ?? {};
  if (!isText(body.title, 5, 140) || !isText(body.category, 2, 80)
      || !isText(body.description, 20, 4000) || !isText(body.city, 2, 100)) {
    return res.status(400).json({ error: 'Titre, métier, description et ville sont obligatoires.' });
  }
  const workType = ['project', 'full_time', 'part_time', 'contract', 'internship'].includes(body.work_type)
    ? body.work_type
    : 'project';
  const status = body.status === 'published' ? 'published' : 'draft';
  const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'USD';
  const budgetMin = body.budget_min === '' || body.budget_min == null ? null : Number(body.budget_min);
  const budgetMax = body.budget_max === '' || body.budget_max == null ? null : Number(body.budget_max);
  if ((budgetMin !== null && (!Number.isFinite(budgetMin) || budgetMin < 0))
      || (budgetMax !== null && (!Number.isFinite(budgetMax) || budgetMax < 0))
      || (budgetMin !== null && budgetMax !== null && budgetMax < budgetMin)) {
    return res.status(400).json({ error: 'Fourchette de budget invalide.' });
  }
  const { data, error } = await supabase
    .from('business_jobs')
    .insert({
      owner_id: workspace.ownerId,
      created_by: workspace.userId,
      title: body.title.trim(),
      category: body.category.trim(),
      description: body.description.trim(),
      city: body.city.trim(),
      work_type: workType,
      budget_min: budgetMin,
      budget_max: budgetMax,
      currency,
      status,
    })
    .select(JOB_SELECT)
    .single();
  if (error) return logDatabaseError('Création de la demande entreprise impossible', error, res);
  return res.status(201).json({ job: data });
}

export async function updateBusinessJob(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const field of ['title', 'category', 'description', 'city'] as const) {
    if (body[field] !== undefined) {
      const limits: Record<typeof field, [number, number]> = {
        title: [5, 140], category: [2, 80], description: [20, 4000], city: [2, 100],
      };
      if (!isText(body[field], ...limits[field])) return res.status(400).json({ error: `Le champ ${field} est invalide.` });
      patch[field] = body[field].trim();
    }
  }
  if (body.status !== undefined) {
    if (!['draft', 'published', 'closed'].includes(body.status)) return res.status(400).json({ error: 'Statut de demande invalide.' });
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucune modification valide.' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('business_jobs')
    .update(patch)
    .eq('id', req.params.id)
    .eq('owner_id', workspace.ownerId)
    .select(JOB_SELECT)
    .maybeSingle();
  if (error) return logDatabaseError('Mise à jour de la demande entreprise impossible', error, res);
  if (!data) return res.status(404).json({ error: 'Demande introuvable.' });
  return res.json({ job: data });
}

export async function applyToBusinessJob(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  const body = req.body ?? {};
  if (!isText(body.message, 10, 2000)) return res.status(400).json({ error: 'Présentez votre candidature en 10 à 2000 caractères.' });
  const proposedAmount = body.proposed_amount === '' || body.proposed_amount == null ? null : Number(body.proposed_amount);
  const estimatedDays = body.estimated_days === '' || body.estimated_days == null ? null : Number(body.estimated_days);
  if (proposedAmount !== null && (!Number.isFinite(proposedAmount) || proposedAmount < 0)) {
    return res.status(400).json({ error: 'Montant proposé invalide.' });
  }
  if (estimatedDays !== null && (!Number.isInteger(estimatedDays) || estimatedDays < 1 || estimatedDays > 3650)) {
    return res.status(400).json({ error: 'Durée estimée invalide.' });
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('role, business_type').eq('id', userId).maybeSingle();
  if (profileError) return logDatabaseError('Vérification de l’artisan impossible', profileError, res);
  if (profile?.role !== 'artisan') return res.status(403).json({ error: 'Les candidatures sont réservées aux comptes artisan.' });

  const { data: job, error: jobError } = await supabase
    .from('business_jobs').select('id, owner_id, status, currency').eq('id', req.params.id).maybeSingle();
  if (jobError) return logDatabaseError('Vérification de la demande impossible', jobError, res);
  if (!job || job.status !== 'published') return res.status(404).json({ error: 'Cette demande n’est plus disponible.' });
  if (job.owner_id === userId) return res.status(400).json({ error: 'Vous ne pouvez pas postuler à votre propre demande.' });

  const { data, error } = await supabase
    .from('business_applications')
    .insert({
      job_id: job.id,
      applicant_id: userId,
      message: body.message.trim(),
      proposed_amount: proposedAmount,
      currency: job.currency,
      estimated_days: estimatedDays,
    })
    .select('id, job_id, applicant_id, message, proposed_amount, currency, estimated_days, status, created_at')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Vous avez déjà postulé à cette demande.' });
    return logDatabaseError('Envoi de la candidature impossible', error, res);
  }
  return res.status(201).json({ application: data });
}

export async function listBusinessApplications(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const jobId = typeof req.query.job_id === 'string' ? req.query.job_id : '';
  let query = supabase
    .from('business_applications')
    .select('id, job_id, applicant_id, message, proposed_amount, currency, estimated_days, status, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (jobId) {
    if (!UUID_RE.test(jobId)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
    const { data: job, error: jobError } = await supabase.from('business_jobs')
      .select('id').eq('id', jobId).eq('owner_id', workspace.ownerId).maybeSingle();
    if (jobError) return logDatabaseError('Vérification de la demande impossible', jobError, res);
    if (!job) return res.status(404).json({ error: 'Demande introuvable.' });
    query = query.eq('job_id', jobId);
  } else {
    const { data: jobs, error: jobsError } = await supabase
      .from('business_jobs').select('id').eq('owner_id', workspace.ownerId);
    if (jobsError) return logDatabaseError('Lecture des demandes entreprise impossible', jobsError, res);
    const jobIds = (jobs ?? []).map((job) => job.id);
    if (!jobIds.length) return res.json({ data: [] });
    query = query.in('job_id', jobIds);
  }
  const { data, error } = await query;
  if (error) return logDatabaseError('Lecture des candidatures impossible', error, res);
  const applicantIds = Array.from(new Set((data ?? []).map((application) => application.applicant_id)));
  const { data: profiles, error: profilesError } = applicantIds.length
    ? await supabase.from('profiles').select('id, full_name, profession, city, description, avatar_url, business_type, rating').in('id', applicantIds)
    : { data: [], error: null };
  if (profilesError) return logDatabaseError('Lecture des profils candidats impossible', profilesError, res);
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return res.json({ data: (data ?? []).map((application) => ({ ...application, artisan: byId.get(application.applicant_id) ?? null })) });
}

export async function listMyBusinessApplications(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  const { data, error } = await supabase
    .from('business_applications')
    .select('id, job_id, message, proposed_amount, currency, estimated_days, status, created_at, business_jobs!inner(title, category, city, owner_id)')
    .eq('applicant_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return logDatabaseError('Lecture de mes candidatures impossible', error, res);
  return res.json({ data: data ?? [] });
}

export async function updateBusinessApplication(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de candidature invalide.' });
  const { status } = req.body ?? {};
  if (!['shortlisted', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Décision de candidature invalide.' });
  }
  const { data: ownedApplication, error: ownedApplicationError } = await supabase
    .from('business_applications')
    .select('id, job_id, business_jobs!inner(owner_id)')
    .eq('id', req.params.id)
    .eq('business_jobs.owner_id', workspace.ownerId)
    .maybeSingle();
  if (ownedApplicationError) return logDatabaseError('Vérification de la candidature impossible', ownedApplicationError, res);
  if (!ownedApplication) return res.status(404).json({ error: 'Candidature introuvable.' });
  const { data: currentApplication, error: currentApplicationError } = await supabase
    .from('business_applications').select('status').eq('id', req.params.id).single();
  if (currentApplicationError) return logDatabaseError('Lecture de l’état de la candidature impossible', currentApplicationError, res);
  if (currentApplication.status === 'accepted' && status !== 'accepted') {
    return res.status(409).json({ error: 'Une candidature acceptée ne peut plus être annulée depuis cette page.' });
  }
  if (status === 'accepted') {
    const { data: application, error: applicationError } = await supabase
      .from('business_applications').select('job_id').eq('id', ownedApplication.id).maybeSingle();
    if (applicationError) return logDatabaseError('Lecture de la candidature impossible', applicationError, res);
    if (!application) return res.status(404).json({ error: 'Candidature introuvable.' });
    const { data: accepted, error: acceptedError } = await supabase
      .from('business_applications').select('id').eq('job_id', application.job_id).eq('status', 'accepted').neq('id', req.params.id).maybeSingle();
    if (acceptedError) return logDatabaseError('Vérification des candidatures acceptées impossible', acceptedError, res);
    if (accepted) return res.status(409).json({ error: 'Une candidature est déjà retenue pour cette demande.' });
  }
  const { data, error } = await supabase
    .from('business_applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('job_id', ownedApplication.job_id)
    .select('id, job_id, applicant_id, status, updated_at')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Une candidature est déjà retenue pour cette demande.' });
    return logDatabaseError('Mise à jour de la candidature impossible', error, res);
  }
  if (!data) return res.status(404).json({ error: 'Candidature introuvable.' });
  return res.json({ application: data });
}

export async function listBusinessProjects(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res);
  if (!workspace) return;
  const { data, error } = await supabase
    .from('business_projects')
    .select('id, owner_id, job_id, application_id, artisan_id, title, description, status, start_date, due_date, budget, currency, created_at, updated_at')
    .eq('owner_id', workspace.ownerId)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) return logDatabaseError('Lecture des projets impossible', error, res);
  const artisanIds = Array.from(new Set((data ?? []).map((project) => project.artisan_id)));
  const { data: profiles, error: profilesError } = artisanIds.length
    ? await supabase.from('profiles').select('id, full_name, profession, avatar_url').in('id', artisanIds)
    : { data: [], error: null };
  if (profilesError) return logDatabaseError('Lecture des artisans affectés impossible', profilesError, res);
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return res.json({ data: (data ?? []).map((project) => ({ ...project, artisan: byId.get(project.artisan_id) ?? null })) });
}

export async function updateBusinessProject(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de projet invalide.' });
  const { data: project, error: projectError } = await supabase
    .from('business_projects').select('id, owner_id').eq('id', req.params.id).eq('owner_id', workspace.ownerId).maybeSingle();
  if (projectError) return logDatabaseError('Lecture du projet impossible', projectError, res);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!['active', 'on_hold', 'completed', 'cancelled'].includes(body.status)) return res.status(400).json({ error: 'Statut de projet invalide.' });
    patch.status = body.status;
  }
  if (body.due_date !== undefined) {
    if (body.due_date !== null && (typeof body.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date))) {
      return res.status(400).json({ error: 'Date de fin invalide.' });
    }
    patch.due_date = body.due_date || null;
  }
  if (workspace.role === 'owner') {
    if (body.title !== undefined) {
      if (!isText(body.title, 2, 160)) return res.status(400).json({ error: 'Titre de projet invalide.' });
      patch.title = body.title.trim();
    }
    if (body.budget !== undefined) {
      const amount = body.budget === '' || body.budget === null ? null : Number(body.budget);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return res.status(400).json({ error: 'Budget invalide.' });
      patch.budget = amount;
    }
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Aucune modification autorisée.' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('business_projects').update(patch).eq('id', req.params.id).eq('owner_id', workspace.ownerId).select().maybeSingle();
  if (error) return logDatabaseError('Mise à jour du projet impossible', error, res);
  return res.json({ project: data });
}

export async function searchBusinessArtisans(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const profession = typeof req.query.profession === 'string' ? req.query.profession.trim().slice(0, 80) : '';
  const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0, 100) : '';
  let query = supabase
    .from('profiles')
    .select('id, full_name, profession, city, description, avatar_url, business_type, rating, is_available')
    .eq('role', 'artisan')
    .neq('id', workspace.ownerId)
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(50);
  if (term) query = query.ilike('full_name', `%${term.replace(/[%_,]/g, '')}%`);
  if (profession) query = query.ilike('profession', `%${profession.replace(/[%_,]/g, '')}%`);
  if (city) query = query.ilike('city', `%${city.replace(/[%_,]/g, '')}%`);
  const { data, error } = await query;
  if (error) return logDatabaseError('Recherche des artisans impossible', error, res);
  const { data: favorites, error: favoriteError } = await supabase
    .from('business_favorites').select('artisan_id').eq('owner_id', workspace.ownerId);
  if (favoriteError) return logDatabaseError('Lecture des artisans favoris impossible', favoriteError, res);
  const favoriteIds = new Set((favorites ?? []).map((favorite) => favorite.artisan_id));
  return res.json({ data: (data ?? []).map((artisan) => ({ ...artisan, is_favorite: favoriteIds.has(artisan.id) })) });
}

export async function listBusinessFavorites(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const { data: favorites, error } = await supabase
    .from('business_favorites').select('artisan_id, created_at').eq('owner_id', workspace.ownerId).order('created_at', { ascending: false });
  if (error) return logDatabaseError('Lecture des favoris impossible', error, res);
  const ids = (favorites ?? []).map((favorite) => favorite.artisan_id);
  const { data: artisans, error: profileError } = ids.length
    ? await supabase.from('profiles').select('id, full_name, profession, city, description, avatar_url, business_type, rating').in('id', ids)
    : { data: [], error: null };
  if (profileError) return logDatabaseError('Lecture des profils favoris impossible', profileError, res);
  const byId = new Map((artisans ?? []).map((artisan) => [artisan.id, artisan]));
  return res.json({ data: (favorites ?? []).map((favorite) => byId.get(favorite.artisan_id)).filter(Boolean) });
}

export async function addBusinessFavorite(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.artisanId) || req.params.artisanId === workspace.ownerId) {
    return res.status(400).json({ error: 'Artisan invalide.' });
  }
  const { data: artisan, error: artisanError } = await supabase
    .from('profiles').select('id').eq('id', req.params.artisanId).eq('role', 'artisan').maybeSingle();
  if (artisanError) return logDatabaseError('Vérification de l’artisan impossible', artisanError, res);
  if (!artisan) return res.status(404).json({ error: 'Artisan introuvable.' });
  const { error } = await supabase.from('business_favorites').upsert({
    owner_id: workspace.ownerId, artisan_id: req.params.artisanId,
  });
  if (error) return logDatabaseError('Ajout du favori impossible', error, res);
  return res.json({ ok: true });
}

export async function removeBusinessFavorite(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.artisanId)) return res.status(400).json({ error: 'Artisan invalide.' });
  const { error } = await supabase.from('business_favorites')
    .delete().eq('owner_id', workspace.ownerId).eq('artisan_id', req.params.artisanId);
  if (error) return logDatabaseError('Suppression du favori impossible', error, res);
  return res.json({ ok: true });
}

export async function listBusinessPayments(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const { data, error } = await supabase
    .from('business_payments')
    .select('id, project_id, contract_id, description, amount, currency, due_date, status, paid_at, payment_reference, created_at, business_projects!inner(title)')
    .eq('owner_id', workspace.ownerId)
    .order('due_date', { ascending: true })
    .limit(200);
  if (error) return logDatabaseError('Lecture des paiements convenus impossible', error, res);
  return res.json({ data: data ?? [], note: 'ARTISANTS ne traite ni ne détient les fonds. Ce module suit les paiements convenus entre les parties.' });
}

export async function listBusinessContracts(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const { data, error } = await supabase.from('business_contracts')
    .select('id, project_id, title, status, signature_provider, amount, currency, document_path, signed_document_path, company_signer_name, company_signed_name, company_signed_at, artisan_signer_name, artisan_signed_name, artisan_signed_at, created_at, updated_at, business_projects!inner(title)')
    .eq('owner_id', workspace.ownerId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return logDatabaseError('Lecture des contrats impossible', error, res);
  try {
    const contracts = await Promise.all((data ?? []).map(async (contract) => {
      const [original, signed] = await Promise.all([
        supabase.storage.from('business-contracts').createSignedUrl(contract.document_path, 5 * 60),
        contract.signed_document_path
          ? supabase.storage.from('business-contracts').createSignedUrl(contract.signed_document_path, 5 * 60)
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (original.error) throw original.error;
      if (signed.error) throw signed.error;
      return {
        ...contract,
        document_url: original.data.signedUrl,
        signed_document_url: signed.data?.signedUrl ?? null,
      };
    }));
    return res.json({ data: contracts });
  } catch (error) {
    return logDatabaseError('Préparation des liens sécurisés de contrat impossible', error, res);
  }
}

export async function listMyBusinessContracts(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  const { data: projects, error: projectsError } = await supabase
    .from('business_projects')
    .select('id, owner_id, title')
    .eq('artisan_id', userId)
    .limit(100);
  if (projectsError) return logDatabaseError('Lecture des projets de l’artisan impossible', projectsError, res);
  const projectIds = (projects ?? []).map((project) => project.id);
  if (!projectIds.length) return res.json({ data: [] });

  const { data, error } = await supabase.from('business_contracts')
    .select('id, owner_id, project_id, title, status, signature_provider, amount, currency, document_path, signed_document_path, company_signer_name, company_signed_name, company_signed_at, artisan_signer_name, artisan_signed_name, artisan_signed_at, created_at, updated_at')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return logDatabaseError('Lecture des contrats de l’artisan impossible', error, res);

  const ownerIds = Array.from(new Set((data ?? []).map((contract) => contract.owner_id)));
  const { data: companies, error: companiesError } = ownerIds.length
    ? await supabase.from('business_profiles').select('owner_id, company_name').in('owner_id', ownerIds)
    : { data: [], error: null };
  if (companiesError) return logDatabaseError('Lecture des entreprises signataires impossible', companiesError, res);
  const projectById = new Map((projects ?? []).map((project) => [project.id, project]));
  const companyByOwner = new Map((companies ?? []).map((company) => [company.owner_id, company]));

  try {
    const contracts = await Promise.all((data ?? []).map(async (contract) => {
      const [original, signed] = await Promise.all([
        supabase.storage.from('business-contracts').createSignedUrl(contract.document_path, 5 * 60),
        contract.signed_document_path
          ? supabase.storage.from('business-contracts').createSignedUrl(contract.signed_document_path, 5 * 60)
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (original.error) throw original.error;
      if (signed.error) throw signed.error;
      return {
        ...contract,
        document_url: original.data.signedUrl,
        signed_document_url: signed.data?.signedUrl ?? null,
        business: companyByOwner.get(contract.owner_id) ?? null,
        business_projects: projectById.get(contract.project_id) ?? null,
      };
    }));
    return res.json({ data: contracts });
  } catch (urlError) {
    return logDatabaseError('Préparation des contrats de l’artisan impossible', urlError, res);
  }
}

export async function signBusinessContract(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de contrat invalide.' });
  const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
  if (!isText(fullName, 2, 120)) return res.status(400).json({ error: 'Saisissez votre nom complet (2 à 120 caractères).' });
  if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Vous devez confirmer votre accord avant de signer.' });

  const { data, error } = await supabase.rpc('sign_business_contract_in_app', {
    p_contract_id: req.params.id,
    p_signer_user_id: userId,
    p_full_name: fullName,
    p_confirmed: true,
  });
  if (error) {
    if (error.code === 'P0002') return res.status(404).json({ error: 'Contrat introuvable.' });
    if (error.code === '42501') return res.status(403).json({ error: 'Vous n’êtes pas signataire de ce contrat.' });
    if (error.code === '22023') return res.status(400).json({ error: error.message });
    if (error.code === '23505' || error.code === '55000') return res.status(409).json({ error: error.message });
    return logDatabaseError('Signature du contrat impossible', error, res);
  }
  return res.json({ contract: data });
}

export async function createBusinessContract(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const body = req.body ?? {};
  if (!UUID_RE.test(body.project_id ?? '') || !isText(body.title, 3, 160)
      || typeof body.document_path !== 'string'
      || !body.document_path.startsWith(`${workspace.ownerId}/${body.project_id}/`)
      || body.document_path.includes('..')
      || !/\.pdf$/i.test(body.document_path)) {
    return res.status(400).json({ error: 'Projet, titre et contrat PDF valide obligatoires.' });
  }
  const amount = body.amount === '' || body.amount == null ? null : Number(body.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return res.status(400).json({ error: 'Montant du contrat invalide.' });
  const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'USD';
  const { data: project, error: projectError } = await supabase.from('business_projects')
    .select('id, owner_id, artisan_id')
    .eq('id', body.project_id)
    .eq('owner_id', workspace.ownerId)
    .maybeSingle();
  if (projectError) return logDatabaseError('Vérification du projet pour le contrat impossible', projectError, res);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  const [{ data: company, error: companyError }, { data: artisan, error: artisanError }, artisanAuth] = await Promise.all([
    supabase.from('business_profiles').select('contact_person, contact_email').eq('owner_id', workspace.ownerId).single(),
    supabase.from('profiles').select('full_name').eq('id', project.artisan_id).maybeSingle(),
    supabase.auth.admin.getUserById(project.artisan_id),
  ]);
  if (companyError) return logDatabaseError('Lecture de l’entreprise signataire impossible', companyError, res);
  if (artisanError) return logDatabaseError('Lecture de l’artisan signataire impossible', artisanError, res);
  if (artisanAuth.error) return logDatabaseError('Lecture de l’e-mail de l’artisan signataire impossible', artisanAuth.error, res);
  if (!artisan?.full_name || !artisanAuth.data.user?.email) {
    return res.status(400).json({ error: 'Le profil de l’artisan doit fournir un nom et une adresse e-mail pour la signature.' });
  }
  const { error: fileError } = await supabase.storage.from('business-contracts').createSignedUrl(body.document_path, 60);
  if (fileError) return res.status(400).json({ error: 'Le PDF doit être téléversé dans le dossier privé du projet.' });

  const { data, error } = await supabase.from('business_contracts').insert({
    owner_id: workspace.ownerId,
    project_id: project.id,
    created_by: workspace.userId,
    title: body.title.trim(),
    document_path: body.document_path,
    company_signer_name: company.contact_person,
    company_signer_email: company.contact_email,
    artisan_signer_name: artisan.full_name,
    artisan_signer_email: artisanAuth.data.user.email,
    amount,
    currency,
  }).select('id, project_id, title, status, signature_provider, company_signer_name, artisan_signer_name, amount, currency, created_at').single();
  if (error) return logDatabaseError('Création de la fiche contrat impossible', error, res);
  return res.status(201).json({ contract: data });
}

type YouSignResponse = Record<string, unknown> & { id?: string; total_pages?: number };

function yousignBaseUrl() {
  return process.env.YOUSIGN_ENV === 'production'
    ? 'https://api.yousign.app/v3'
    : 'https://api-sandbox.yousign.app/v3';
}

async function yousignJson(path: string, method: 'POST' | 'GET', body?: unknown): Promise<YouSignResponse> {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) throw new Error('YOUSIGN_API_KEY is not configured');
  const response = await fetch(`${yousignBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  let result: YouSignResponse = {};
  try {
    result = text ? JSON.parse(text) as YouSignResponse : {};
  } catch {
    throw new Error(`Yousign returned an unexpected response (${response.status})`);
  }
  if (!response.ok) {
    const detail = typeof result.detail === 'string' ? result.detail : `HTTP ${response.status}`;
    throw new Error(`Yousign request failed: ${detail}`);
  }
  return result;
}

function signerName(name: string) {
  const parts = name.trim().split(/\s+/);
  const firstName = parts.shift() ?? '';
  return { first_name: firstName, last_name: parts.join(' ') || firstName };
}

async function sendContractForSignature(contractId: string, ownerId: string) {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) throw new Error('La signature Yousign n’est pas configurée (YOUSIGN_API_KEY).');
  const { data: contract, error } = await supabase.from('business_contracts')
    .select('id, owner_id, project_id, title, document_path, company_signer_name, company_signer_email, artisan_signer_name, artisan_signer_email, status, signature_provider')
    .eq('id', contractId)
    .eq('owner_id', ownerId)
    .single();
  if (error) throw error;
  if (contract.signature_provider !== 'yousign') throw new Error('Ce contrat utilise la signature dans ARTISANTS.');
  if (!['draft', 'error'].includes(contract.status)) throw new Error('Ce contrat a déjà été envoyé ou signé.');

  const { data: pdf, error: pdfError } = await supabase.storage.from('business-contracts').download(contract.document_path);
  if (pdfError) throw pdfError;
  const fileBuffer = new Uint8Array(await pdf.arrayBuffer());
  if (fileBuffer.length < 5 || new TextDecoder().decode(fileBuffer.slice(0, 5)) !== '%PDF-') {
    throw new Error('Le document téléversé n’est pas un PDF valide.');
  }

  let requestId: string | null = null;
  try {
    const request = await yousignJson('/signature_requests', 'POST', {
      name: contract.title,
      delivery_mode: 'email',
      ordered_signers: true,
      external_id: contract.id,
    });
    if (!request.id) throw new Error('Yousign did not return a signature request id');
    requestId = request.id;

    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), 'contract.pdf');
    form.append('nature', 'signable_document');
    const upload = await fetch(`${yousignBaseUrl()}/signature_requests/${encodeURIComponent(requestId)}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    const uploadText = await upload.text();
    let document: YouSignResponse;
    try {
      document = JSON.parse(uploadText) as YouSignResponse;
    } catch {
      throw new Error(`Yousign document upload returned an invalid response (${upload.status})`);
    }
    if (!upload.ok || !document.id) throw new Error(`Yousign document upload failed (${upload.status})`);
    const documentId = document.id;
    const page = typeof document.total_pages === 'number' && document.total_pages > 0 ? document.total_pages : 1;
    const signerRows = [
      { name: contract.company_signer_name, email: contract.company_signer_email, x: 70 },
      { name: contract.artisan_signer_name, email: contract.artisan_signer_email, x: 350 },
    ];
    for (const [index, signer] of signerRows.entries()) {
      const identity = signerName(signer.name);
      await yousignJson(`/signature_requests/${encodeURIComponent(requestId)}/signers`, 'POST', {
        info: { ...identity, email: signer.email, locale: 'fr' },
        signature_level: 'electronic_signature',
        signature_authentication_mode: 'no_otp',
        fields: [{
          type: 'signature',
          document_id: documentId,
          page,
          x: signer.x,
          y: 700,
        }],
        ...(index === 0 ? { custom_text: { request_subject: 'Signature du contrat ARTISANTS' } } : {}),
      });
    }
    const { error: updateError } = await supabase.from('business_contracts')
      .update({
        status: 'signing',
        signature_request_id: requestId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .eq('owner_id', ownerId);
    if (updateError) throw updateError;
    await yousignJson(`/signature_requests/${encodeURIComponent(requestId)}/activate`, 'POST');
    return { status: 'signing' as const };
  } catch (error) {
    const { error: saveError } = await supabase.from('business_contracts').update({
      status: 'error',
      ...(requestId ? { signature_request_id: requestId } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', contractId).eq('owner_id', ownerId);
    if (saveError) logger.error('Impossible de conserver l’état d’échec du contrat', { contract_id: contractId, error: saveError.message });
    throw error;
  }
}

export async function sendBusinessContract(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de contrat invalide.' });
  try {
    const result = await sendContractForSignature(req.params.id, workspace.ownerId);
    return res.json({ contract: { id: req.params.id, ...result } });
  } catch (error) {
    const message = safeError(error);
    logger.error('Envoi du contrat à Yousign impossible', { contract_id: req.params.id, error: message });
    if (message === 'Ce contrat utilise la signature dans ARTISANTS.') return res.status(409).json({ error: message });
    if (message.includes('not configured')) return res.status(503).json({ error: 'Configurez YOUSIGN_API_KEY et YOUSIGN_ENV avant d’envoyer un contrat.' });
    return res.status(502).json({ error: 'Yousign n’a pas pu démarrer la signature. Vérifiez le PDF et réessayez.' });
  }
}

export async function createBusinessPayment(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const body = req.body ?? {};
  if (!UUID_RE.test(body.project_id ?? '') || !isText(body.description, 3, 300)) {
    return res.status(400).json({ error: 'Projet et description du paiement obligatoires.' });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Montant du paiement invalide.' });
  const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'USD';
  if (body.contract_id && !UUID_RE.test(body.contract_id)) return res.status(400).json({ error: 'Contrat associé invalide.' });
  if (body.contract_id) {
    const { data: contract, error: contractError } = await supabase.from('business_contracts')
      .select('id').eq('id', body.contract_id).eq('owner_id', workspace.ownerId).eq('project_id', body.project_id).maybeSingle();
    if (contractError) return logDatabaseError('Vérification du contrat associé impossible', contractError, res);
    if (!contract) return res.status(404).json({ error: 'Contrat associé introuvable pour ce projet.' });
  }
  const dueDate = body.due_date === '' || body.due_date == null ? null : body.due_date;
  if (dueDate !== null && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    return res.status(400).json({ error: 'Date d’échéance invalide.' });
  }
  const { data: project, error: projectError } = await supabase
    .from('business_projects').select('id').eq('id', body.project_id).eq('owner_id', workspace.ownerId).maybeSingle();
  if (projectError) return logDatabaseError('Vérification du projet impossible', projectError, res);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  const { data, error } = await supabase.from('business_payments').insert({
    owner_id: workspace.ownerId,
    project_id: body.project_id,
    contract_id: body.contract_id || null,
    created_by: workspace.userId,
    description: body.description.trim(),
    amount,
    currency,
    due_date: dueDate,
    status: 'planned',
  }).select().single();
  if (error) return logDatabaseError('Enregistrement du paiement convenu impossible', error, res);
  return res.status(201).json({ payment: data });
}

export async function updateBusinessPayment(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de paiement invalide.' });
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!['planned', 'due', 'paid', 'overdue', 'canceled'].includes(body.status)) return res.status(400).json({ error: 'Statut de paiement invalide.' });
    patch.status = body.status;
    patch.paid_at = body.status === 'paid' ? new Date().toISOString() : null;
  }
  if (body.payment_reference !== undefined) {
    if (typeof body.payment_reference !== 'string' || body.payment_reference.length > 200) return res.status(400).json({ error: 'Référence de paiement invalide.' });
    patch.payment_reference = body.payment_reference.trim() || null;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Aucune modification valide.' });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('business_payments')
    .update(patch).eq('id', req.params.id).eq('owner_id', workspace.ownerId).select().maybeSingle();
  if (error) return logDatabaseError('Mise à jour du paiement convenu impossible', error, res);
  if (!data) return res.status(404).json({ error: 'Paiement introuvable.' });
  return res.json({ payment: data });
}

export async function getBusinessReports(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const [jobs, projects, applications, payments, contracts] = await Promise.all([
    supabase.from('business_jobs').select('id, status, created_at').eq('owner_id', workspace.ownerId),
    supabase.from('business_projects').select('id, status, budget, currency, created_at').eq('owner_id', workspace.ownerId),
    supabase.from('business_applications').select('id, status, business_jobs!inner(owner_id)').eq('business_jobs.owner_id', workspace.ownerId),
    supabase.from('business_payments').select('amount, status, currency, due_date').eq('owner_id', workspace.ownerId),
    supabase.from('business_contracts').select('id, status').eq('owner_id', workspace.ownerId),
  ]);
  const failed = [jobs, projects, applications, payments, contracts].find((result) => result.error);
  if (failed?.error) return logDatabaseError('Calcul des rapports entreprise impossible', failed.error, res);
  const rows = payments.data ?? [];
  return res.json({
    demand_requests: {
      total: jobs.data?.length ?? 0,
      published: jobs.data?.filter((row) => row.status === 'published').length ?? 0,
      closed: jobs.data?.filter((row) => row.status === 'closed').length ?? 0,
    },
    applications: {
      total: applications.data?.length ?? 0,
      accepted: applications.data?.filter((row) => row.status === 'accepted').length ?? 0,
      pending: applications.data?.filter((row) => row.status === 'submitted' || row.status === 'shortlisted').length ?? 0,
    },
    projects: {
      total: projects.data?.length ?? 0,
      active: projects.data?.filter((row) => row.status === 'active' || row.status === 'on_hold').length ?? 0,
      completed: projects.data?.filter((row) => row.status === 'completed').length ?? 0,
    },
    contracts: {
      total: contracts.data?.length ?? 0,
      signed: contracts.data?.filter((row) => row.status === 'signed').length ?? 0,
      to_sign: contracts.data?.filter((row) => row.status === 'draft' || row.status === 'signing').length ?? 0,
    },
    payment_tracking: {
      currency: rows[0]?.currency ?? 'USD',
      recorded: rows.length,
      paid: rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount), 0),
      unpaid: rows.filter((row) => row.status === 'planned' || row.status === 'due' || row.status === 'overdue')
        .reduce((sum, row) => sum + Number(row.amount), 0),
    },
  });
}

export async function listBusinessTeam(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const { data, error } = await supabase.from('business_members')
    .select('id, member_user_id, email, role, status, created_at')
    .eq('owner_id', workspace.ownerId).order('created_at', { ascending: false });
  if (error) return logDatabaseError('Lecture des employés impossible', error, res);
  return res.json({ data: data ?? [] });
}

export async function inviteBusinessMember(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  const { data: duplicate, error: duplicateError } = await supabase
    .from('business_members').select('id').eq('email', email).eq('status', 'active').maybeSingle();
  if (duplicateError) return logDatabaseError('Vérification de l’invitation impossible', duplicateError, res);
  if (duplicate) return res.status(409).json({ error: 'Cette adresse e-mail appartient déjà à un employé actif.' });

  const { data: business, error: businessError } = await supabase
    .from('business_profiles').select('company_name').eq('owner_id', workspace.ownerId).single();
  if (businessError) return logDatabaseError('Lecture du nom de l’entreprise impossible', businessError, res);

  let memberUserId: string;
  const redirectTo = process.env.BUSINESS_INVITE_REDIRECT_URL || 'artisant://business-invite';
  const invited = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!invited.error && invited.data.user) {
    memberUserId = invited.data.user.id;
  } else if (invited.error?.message.toLowerCase().includes('already registered')
    || invited.error?.message.toLowerCase().includes('already been registered')) {
    const link = await supabase.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });
    const existingId = link.data.user?.id;
    const actionLink = link.data.properties?.action_link;
    if (link.error || !existingId || !actionLink) {
      logger.error('Création du lien de connexion pour invitation impossible', { error: link.error?.message ?? 'Lien manquant' });
      return res.status(502).json({ error: 'Impossible de préparer le lien de connexion de cet employé.' });
    }
    memberUserId = existingId;
    try {
      await sendEmail({
        to: email,
        subject: 'Invitation à rejoindre une équipe ARTISANTS',
        htmlContent: `<p>Vous êtes invité(e) à rejoindre l’équipe de ${escapedHtml(business.company_name)} sur ARTISANTS.</p><p><a href="${escapedHtml(actionLink)}">Accepter l’invitation et vous connecter</a></p>`,
      });
    } catch (error) {
      logger.error('Envoi de l’invitation par e-mail impossible', { error: safeError(error) });
      return res.status(502).json({ error: 'Le lien de connexion n’a pas pu être envoyé. Vérifiez la configuration e-mail.' });
    }
  } else {
    logger.error('Invitation Supabase impossible', { error: invited.error?.message ?? 'Utilisateur manquant' });
    return res.status(502).json({ error: 'Impossible de créer l’invitation. Vérifiez la configuration des e-mails Supabase.' });
  }

  const { data, error } = await supabase.from('business_members').upsert({
    owner_id: workspace.ownerId,
    member_user_id: memberUserId,
    email,
    invited_by: workspace.userId,
    status: 'active',
    created_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,member_user_id' })
    .select('id, member_user_id, email, role, status, created_at')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ce compte est déjà lié à une entreprise.' });
    return logDatabaseError('Enregistrement de l’employé impossible', error, res);
  }
  return res.status(201).json({ member: data });
}

export async function revokeBusinessMember(req: Request, res: Response) {
  const workspace = await requireWorkspace(req, res, true);
  if (!workspace) return;
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant d’employé invalide.' });
  const { data, error } = await supabase.from('business_members')
    .update({ status: 'revoked' })
    .eq('id', req.params.id)
    .eq('owner_id', workspace.ownerId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();
  if (error) return logDatabaseError('Révocation de l’accès employé impossible', error, res);
  if (!data) return res.status(404).json({ error: 'Employé actif introuvable.' });
  return res.json({ ok: true });
}

export async function businessWebhook(req: Request, res: Response) {
  const secret = process.env.YOUSIGN_WEBHOOK_SECRET;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const received = req.header('x-yousign-signature-256') ?? '';
  if (!secret || !rawBody || !received) return res.status(503).json({ error: 'Webhook de signature non configuré.' });

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Signature du webhook invalide.' });
  }

  const event = req.body ?? {};
  const eventId = typeof event.event_id === 'string' ? event.event_id : '';
  const eventName = typeof event.event_name === 'string' ? event.event_name : '';
  const requestId = event.data?.signature_request?.id;
  if (!eventId || typeof requestId !== 'string' || !eventName.startsWith('signature_request.')) {
    return res.status(400).json({ error: 'Événement de signature invalide.' });
  }
  const statusByEvent: Record<string, string> = {
    'signature_request.done': 'signed',
    'signature_request.declined': 'declined',
    'signature_request.rejected': 'declined',
    'signature_request.expired': 'expired',
    'signature_request.canceled': 'canceled',
    'signature_request.activated': 'signing',
    'signature_request.approved': 'signing',
  };
  const status = statusByEvent[eventName];
  if (!status) return res.status(200).json({ received: true });

  const { error: eventError } = await supabase.from('business_signature_events')
    .insert({ event_id: eventId, event_name: eventName });
  if (eventError?.code === '23505') return res.status(200).json({ received: true, duplicate: true });
  if (eventError) return logDatabaseError('Enregistrement du webhook de signature impossible', eventError, res);

  const { data: contract, error } = await supabase.from('business_contracts')
    .select('id, document_path')
    .eq('signature_request_id', requestId)
    .maybeSingle();
  if (error) return logDatabaseError('Recherche du contrat de signature impossible', error, res);
  if (!contract) return res.status(200).json({ received: true, unmatched: true });
  const { error: updateError } = await supabase.from('business_contracts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', contract.id);
  if (updateError) return logDatabaseError('Mise à jour du statut de signature impossible', updateError, res);
  res.status(200).json({ received: true });

  if (status === 'signed') {
    void downloadSignedBusinessContract(requestId, contract.id).catch((downloadError: unknown) => {
      logger.error('Archivage du contrat signé impossible', {
        contract_id: contract.id,
        error: safeError(downloadError),
      });
    });
  }
}

async function downloadSignedBusinessContract(requestId: string, contractId: string) {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) throw new Error('YOUSIGN_API_KEY is not configured');
  const baseUrl = process.env.YOUSIGN_ENV === 'production'
    ? 'https://api.yousign.app/v3'
    : 'https://api-sandbox.yousign.app/v3';
  const response = await fetch(`${baseUrl}/signature_requests/${encodeURIComponent(requestId)}/documents/download`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/pdf' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Yousign signed document download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Yousign response was not a PDF');
  const { data: contract, error: contractError } = await supabase.from('business_contracts')
    .select('owner_id, project_id').eq('id', contractId).single();
  if (contractError) throw contractError;
  const path = `${contract.owner_id}/${contract.project_id}/${contractId}-signed.pdf`;
  const { error: uploadError } = await supabase.storage.from('business-contracts')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (uploadError) throw uploadError;
  const { error: updateError } = await supabase.from('business_contracts')
    .update({ signed_document_path: path, updated_at: new Date().toISOString() })
    .eq('id', contractId);
  if (updateError) throw updateError;
}
