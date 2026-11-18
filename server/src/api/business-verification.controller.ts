import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { BUSINESS_MODULES } from './business-workspace.controller';

type AuthenticatedRequest = Request & { user?: { id: string } };
type BusinessType = 'enterprise' | 'subcontractor';
type ProofType = 'registration' | 'tax' | 'representative_id' | 'authorization';
type BusinessRequestStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'revoked';

const PROOF_TYPES: ProofType[] = ['registration', 'tax', 'representative_id', 'authorization'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = 'artisan-business-proofs';

const requiredText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

const publicRequest = (row: Record<string, unknown>) => ({
  id: row.id,
  user_id: row.user_id,
  business_type: row.business_type,
  company_name: row.company_name,
  country: row.country,
  registration_number: row.registration_number,
  tax_number: row.tax_number,
  company_address: row.company_address,
  contact_person: row.contact_person,
  contact_email: row.contact_email,
  contact_phone: row.contact_phone,
  status: row.status,
  assigned_modules: row.assigned_modules ?? [],
  review_note: row.review_note,
  created_at: row.created_at,
  updated_at: row.updated_at,
  reviewed_at: row.reviewed_at,
});

export const getMyBusinessVerification = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });

  const { data, error } = await supabase
    .from('artisan_business_verifications')
    .select('id, user_id, business_type, company_name, country, registration_number, tax_number, company_address, contact_person, contact_email, contact_phone, status, assigned_modules, review_note, created_at, updated_at, reviewed_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Lecture de la demande de vérification impossible', { user_id: userId, error: error.message });
    return res.status(500).json({ error: 'Impossible de charger votre demande.' });
  }
  return res.json({ request: data ? publicRequest(data) : null });
};

export const submitBusinessVerification = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });

  const body = req.body ?? {};
  if (body.business_type !== 'enterprise' && body.business_type !== 'subcontractor') {
    return res.status(400).json({ error: 'Choisissez Entreprise ou Sous-traitance.' });
  }
  const fields: Array<[string, number, number]> = [
    ['company_name', 2, 160],
    ['country', 2, 100],
    ['registration_number', 2, 100],
    ['tax_number', 2, 100],
    ['company_address', 5, 250],
    ['contact_person', 2, 120],
    ['contact_phone', 6, 40],
  ];
  for (const [field, min, max] of fields) {
    if (!requiredText(body[field], min, max)) {
      return res.status(400).json({ error: `Le champ ${field} est obligatoire (de ${min} à ${max} caractères).` });
    }
  }
  if (!requiredText(body.contact_email, 3, 254) || !EMAIL_RE.test(body.contact_email.trim())) {
    return res.status(400).json({ error: 'Saisissez une adresse e-mail de contact valide.' });
  }

  const documents = body.documents;
  if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
    return res.status(400).json({ error: 'Les quatre justificatifs obligatoires doivent être fournis.' });
  }
  const proofPaths: Record<ProofType, string> = {} as Record<ProofType, string>;
  for (const proofType of PROOF_TYPES) {
    const path = documents[proofType];
    if (
      typeof path !== 'string'
      || !path.startsWith(`${userId}/${proofType}_`)
      || path.includes('..')
      || path.length > 500
      || !/\.(pdf|jpg|jpeg|png|webp)$/i.test(path)
    ) {
      return res.status(400).json({ error: 'Un justificatif est manquant ou invalide.' });
    }
    proofPaths[proofType] = path;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) {
    logger.error('Vérification du rôle pour une demande entreprise impossible', { user_id: userId, error: profileError.message });
    return res.status(500).json({ error: 'Impossible de vérifier votre compte.' });
  }
  if (profile?.role !== 'artisan') {
    return res.status(403).json({ error: 'Cette demande est réservée aux comptes artisan.' });
  }

  const { data, error } = await supabase
    .from('artisan_business_verifications')
    .insert({
      user_id: userId,
      business_type: body.business_type as BusinessType,
      company_name: body.company_name.trim(),
      country: body.country.trim(),
      registration_number: body.registration_number.trim(),
      tax_number: body.tax_number.trim(),
      company_address: body.company_address.trim(),
      contact_person: body.contact_person.trim(),
      contact_email: body.contact_email.trim(),
      contact_phone: body.contact_phone.trim(),
      documents: proofPaths,
    })
    .select('id, user_id, business_type, company_name, country, registration_number, tax_number, company_address, contact_person, contact_email, contact_phone, status, review_note, created_at, updated_at, reviewed_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Une demande a déjà été envoyée pour ce compte. Vous pouvez suivre son statut dans cette page.' });
    }
    logger.error('Enregistrement de la demande de vérification impossible', { user_id: userId, error: error.message });
    return res.status(500).json({ error: 'Impossible d’envoyer votre demande.' });
  }
  if (!data) return res.status(500).json({ error: 'La demande n’a pas été enregistrée.' });

  return res.status(201).json({ request: publicRequest(data) });
};

export const getBusinessVerifications = async (req: Request, res: Response) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
  const from = (page - 1) * pageSize;
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const validStatuses: BusinessRequestStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'revoked'];
  if (status && !validStatuses.includes(status as BusinessRequestStatus)) {
    return res.status(400).json({ error: 'Filtre de statut invalide.' });
  }

  let query = supabase
    .from('artisan_business_verifications')
    .select('id, user_id, business_type, company_name, country, registration_number, tax_number, company_address, contact_person, contact_email, contact_phone, documents, status, assigned_modules, review_note, created_at, updated_at, reviewed_at', { count: 'exact' });
  if (status) query = query.eq('status', status);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) {
    logger.error('Lecture Admin des vérifications entreprise impossible', { error: error.message });
    return res.status(500).json({ error: 'Impossible de charger les demandes de vérification.' });
  }

  try {
    const requests = await Promise.all((data ?? []).map(async (row) => {
      const signedDocuments = await Promise.all(PROOF_TYPES.map(async (proofType) => {
        const path = row.documents[proofType];
        const { data: signed, error: signedError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(path, 5 * 60);
        if (signedError) throw signedError;
        return [proofType, { path, signed_url: signed.signedUrl }] as const;
      }));
      return { ...publicRequest(row), documents: Object.fromEntries(signedDocuments) };
    }));

    return res.json({
      data: requests,
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    });
  } catch (error) {
    logger.error('Création de liens sécurisés pour les justificatifs impossible', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ error: 'Impossible de préparer l’accès sécurisé aux justificatifs.' });
  }
};

export const reviewBusinessVerification = async (req: AuthenticatedRequest, res: Response) => {
  const adminId = req.user?.id;
  const requestId = req.params.id;
  const { status, review_note: reviewNote, modules } = req.body ?? {};
  const allowed: BusinessRequestStatus[] = ['pending', 'in_review', 'approved', 'rejected', 'revoked'];

  if (!UUID_RE.test(requestId)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
  if (!adminId || !allowed.includes(status)) return res.status(400).json({ error: 'Statut de décision invalide.' });
  if (!Array.isArray(modules) || modules.some((module: unknown) =>
    typeof module !== 'string' || !BUSINESS_MODULES.includes(module as typeof BUSINESS_MODULES[number]))) {
    return res.status(400).json({ error: 'Sélection de modules entreprise invalide.' });
  }
  if (new Set(modules).size !== modules.length) {
    return res.status(400).json({ error: 'La sélection contient des modules en double.' });
  }
  if (status === 'approved' && modules.length === 0) {
    return res.status(400).json({ error: 'Attribuez au moins un module avant l’approbation.' });
  }
  if (status === 'rejected' && !requiredText(reviewNote, 5, 1000)) {
    return res.status(400).json({ error: 'Une raison de rejet (5 à 1000 caractères) est obligatoire.' });
  }
  if (reviewNote !== undefined && (typeof reviewNote !== 'string' || reviewNote.length > 1000)) {
    return res.status(400).json({ error: 'La note de suivi ne peut pas dépasser 1000 caractères.' });
  }

  const { data, error } = await supabase.rpc('review_artisan_business_verification', {
    p_request_id: requestId,
    p_status: status,
    p_review_note: typeof reviewNote === 'string' ? reviewNote.trim() : null,
    p_admin_id: adminId,
    p_modules: modules,
  });
  if (error) {
    const notFound = error.code === 'P0002';
    const invalid = error.code === '22023';
    if (!notFound && !invalid) {
      logger.error('Décision Admin sur la vérification entreprise impossible', { request_id: requestId, error: error.message });
    }
    return res.status(notFound ? 404 : invalid ? 400 : 500).json({
      error: notFound ? 'Demande introuvable.' : invalid ? error.message : 'Impossible d’enregistrer la décision.',
    });
  }
  if (!data) return res.status(500).json({ error: 'La décision n’a pas été enregistrée.' });
  return res.json({ request: publicRequest(data) });
};
