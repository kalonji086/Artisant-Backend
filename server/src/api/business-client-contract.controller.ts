import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

type AuthenticatedRequest = Request & { user?: { id: string } };
type OwnerContext = {
  id: string;
  businessType: string;
  companyName: string;
  signerName: string;
  signerEmail: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logDatabaseError(action: string, error: unknown, res: Response) {
  logger.error(action, {
    error: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({ error: 'Une erreur est survenue pendant le traitement de la demande.' });
}

async function getOwnerContext(req: Request, res: Response): Promise<OwnerContext | null> {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Session invalide.' });
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('business_type, business_modules')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) {
    logDatabaseError('Vérification de l’accès aux contrats clients impossible', profileError, res);
    return null;
  }
  if (!profile?.business_type) {
    res.status(403).json({ error: 'Un statut Entreprise ou Sous-traitance approuvé est requis.' });
    return null;
  }
  if (!Array.isArray(profile.business_modules) || !profile.business_modules.includes('contracts')) {
    res.status(403).json({ error: 'Le module Contrats entreprise n’est pas attribué à votre compte.' });
    return null;
  }

  const { data: business, error: businessError } = await supabase
    .from('business_profiles')
    .select('business_type, company_name, contact_person, contact_email')
    .eq('owner_id', userId)
    .maybeSingle();
  if (businessError) {
    logDatabaseError('Lecture des informations entreprise impossible', businessError, res);
    return null;
  }
  if (!business || business.business_type !== profile.business_type) {
    res.status(403).json({ error: 'Le profil entreprise vérifié est introuvable.' });
    return null;
  }

  return {
    id: userId,
    businessType: business.business_type,
    companyName: business.company_name ?? '',
    signerName: business.contact_person ?? '',
    signerEmail: business.contact_email ?? '',
  };
}

async function addDocumentUrls<T extends { document_path: string; signed_document_path?: string | null }>(rows: T[]) {
  return Promise.all(rows.map(async (row) => {
    const [document, signedDocument] = await Promise.all([
      supabase.storage.from('business-client-contracts').createSignedUrl(row.document_path, 5 * 60),
      row.signed_document_path
        ? supabase.storage.from('business-client-contracts').createSignedUrl(row.signed_document_path, 5 * 60)
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (document.error) throw document.error;
    if (signedDocument.error) throw signedDocument.error;
    return {
      ...row,
      document_url: document.data.signedUrl,
      signed_document_url: signedDocument.data?.signedUrl ?? null,
    };
  }));
}

export async function listEligibleBusinessClientQuotes(req: Request, res: Response) {
  const owner = await getOwnerContext(req, res);
  if (!owner) return;

  const { data: quotes, error: quoteError } = await supabase
    .from('quotes')
    .select('id, title, category, description, price, budget, created_at, client_id')
    .eq('artisan_id', owner.id)
    .eq('business_type', owner.businessType)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });
  if (quoteError) return logDatabaseError('Lecture des devis clients acceptés impossible', quoteError, res);
  if (!quotes?.length) return res.json({ data: [] });

  const { data: contracts, error: contractError } = await supabase
    .from('business_client_contracts')
    .select('quote_id')
    .eq('owner_id', owner.id)
    .in('status', ['draft', 'signing', 'signed']);
  if (contractError) return logDatabaseError('Vérification des contrats clients existants impossible', contractError, res);
  const contractedQuoteIds = new Set((contracts ?? []).map((contract) => contract.quote_id));
  const eligibleQuotes = quotes.filter((quote) => !contractedQuoteIds.has(quote.id));
  const clientIds = Array.from(new Set(eligibleQuotes.map((quote) => quote.client_id)));
  const { data: clients, error: clientsError } = clientIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', clientIds)
    : { data: [], error: null };
  if (clientsError) return logDatabaseError('Lecture des clients des devis impossible', clientsError, res);

  const clientById = new Map((clients ?? []).map((client) => [client.id, client.full_name]));
  return res.json({
    data: eligibleQuotes.map((quote) => ({
      ...quote,
      client_name: clientById.get(quote.client_id) ?? null,
    })),
  });
}

export async function listBusinessClientContracts(req: Request, res: Response) {
  const owner = await getOwnerContext(req, res);
  if (!owner) return;
  const { data, error } = await supabase
    .from('business_client_contracts')
    .select('*')
    .eq('owner_id', owner.id)
    .order('created_at', { ascending: false });
  if (error) return logDatabaseError('Lecture des contrats clients impossible', error, res);

  try {
    return res.json({ data: await addDocumentUrls(data ?? []) });
  } catch (error) {
    return logDatabaseError('Préparation des documents client impossible', error, res);
  }
}

export async function listMyBusinessClientContracts(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('role').eq('id', userId).maybeSingle();
  if (profileError) return logDatabaseError('Vérification du profil client impossible', profileError, res);
  if (profile?.role !== 'client') return res.status(403).json({ error: 'Cette liste est réservée aux clients.' });

  const { data, error } = await supabase
    .from('business_client_contracts')
    .select('*')
    .eq('client_id', userId)
    .not('company_signed_at', 'is', null)
    .order('created_at', { ascending: false });
  if (error) return logDatabaseError('Lecture de vos contrats entreprise impossible', error, res);

  try {
    return res.json({ data: await addDocumentUrls(data ?? []) });
  } catch (error) {
    return logDatabaseError('Préparation de vos contrats entreprise impossible', error, res);
  }
}

export async function createBusinessClientContract(req: Request, res: Response) {
  const owner = await getOwnerContext(req, res);
  if (!owner) return;
  if (!owner.companyName.trim() || !owner.signerName.trim() || !owner.signerEmail.trim()) {
    return res.status(409).json({ error: 'Complétez le nom de l’entreprise et les coordonnées du signataire dans votre profil.' });
  }
  const body = req.body ?? {};
  const quoteId = typeof body.quote_id === 'string' ? body.quote_id : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const documentPath = typeof body.document_path === 'string' ? body.document_path : '';
  if (
    !UUID_RE.test(quoteId)
    || title.length < 3
    || title.length > 160
    || !documentPath.startsWith(`${owner.id}/${quoteId}/`)
    || documentPath.includes('..')
    || !/\.pdf$/i.test(documentPath)
  ) {
    return res.status(400).json({ error: 'Devis accepté, titre et PDF valide obligatoires.' });
  }

  const rawAmount = body.amount === '' || body.amount == null ? null : Number(body.amount);
  if (rawAmount !== null && (!Number.isFinite(rawAmount) || rawAmount < 0 || rawAmount > 9_999_999_999.99)) {
    return res.status(400).json({ error: 'Montant du contrat invalide.' });
  }
  const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'USD';

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('id, client_id, artisan_id, status, price, business_type, business_company_name')
    .eq('id', quoteId)
    .eq('artisan_id', owner.id)
    .eq('business_type', owner.businessType)
    .eq('status', 'accepted')
    .maybeSingle();
  if (quoteError) return logDatabaseError('Vérification du devis client impossible', quoteError, res);
  if (!quote) return res.status(409).json({ error: 'Un contrat ne peut être préparé qu’après acceptation du devis ciblé.' });

  const { data: existingContract, error: existingError } = await supabase
    .from('business_client_contracts')
    .select('id')
    .eq('quote_id', quoteId)
    .in('status', ['draft', 'signing', 'signed'])
    .maybeSingle();
  if (existingError) return logDatabaseError('Vérification du contrat client existant impossible', existingError, res);
  if (existingContract) return res.status(409).json({ error: 'Un contrat existe déjà pour ce devis.' });

  const [{ data: client, error: clientError }, clientAuth] = await Promise.all([
    supabase.from('profiles').select('full_name, role').eq('id', quote.client_id).maybeSingle(),
    supabase.auth.admin.getUserById(quote.client_id),
  ]);
  if (clientError) return logDatabaseError('Lecture du signataire client impossible', clientError, res);
  if (clientAuth.error) return logDatabaseError('Lecture de l’adresse du client impossible', clientAuth.error, res);
  if (client?.role !== 'client' || !client.full_name || !clientAuth.data.user?.email) {
    return res.status(400).json({ error: 'Le profil du client doit fournir un nom et une adresse e-mail.' });
  }

  const { data: document, error: fileError } = await supabase.storage
    .from('business-client-contracts')
    .createSignedUrl(documentPath, 5 * 60);
  if (fileError) return res.status(400).json({ error: 'Le PDF doit être téléversé dans le dossier privé de ce devis.' });

  const { data, error } = await supabase.from('business_client_contracts').insert({
    quote_id: quote.id,
    owner_id: owner.id,
    client_id: quote.client_id,
    company_name: owner.companyName,
    title,
    document_path: documentPath,
    status: 'draft',
    company_signer_name: owner.signerName,
    company_signer_email: owner.signerEmail,
    client_signer_name: client.full_name,
    client_signer_email: clientAuth.data.user.email,
    amount: rawAmount ?? quote.price,
    currency,
  }).select('*').single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Un contrat existe déjà pour ce devis.' });
    return logDatabaseError('Création du contrat client impossible', error, res);
  }

  return res.status(201).json({
    contract: {
      ...data,
      document_url: document.signedUrl,
      signed_document_url: null,
    },
  });
}

export async function signBusinessClientContract(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Session invalide.' });
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identifiant de contrat invalide.' });

  const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
  if (fullName.length < 2 || fullName.length > 120) {
    return res.status(400).json({ error: 'Saisissez votre nom complet (2 à 120 caractères).' });
  }
  if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Vous devez confirmer votre accord avant de signer.' });

  const { data: contract, error: contractError } = await supabase
    .from('business_client_contracts')
    .select('id, owner_id, client_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (contractError) return logDatabaseError('Vérification du signataire du contrat impossible', contractError, res);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });

  if (contract.owner_id === userId) {
    const owner = await getOwnerContext(req, res);
    if (!owner) return;
  } else if (contract.client_id === userId) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('role').eq('id', userId).maybeSingle();
    if (profileError) return logDatabaseError('Vérification du profil client impossible', profileError, res);
    if (profile?.role !== 'client') return res.status(403).json({ error: 'La signature est réservée au client du devis.' });
  } else {
    return res.status(403).json({ error: 'Vous n’êtes pas signataire de ce contrat.' });
  }

  const { data, error } = await supabase.rpc('sign_business_client_contract', {
    p_contract_id: req.params.id,
    p_signer_user_id: userId,
    p_full_name: fullName,
    p_confirmed: true,
  });
  if (error) {
    if (error.code === 'P0002') return res.status(404).json({ error: 'Contrat introuvable.' });
    if (error.code === '42501') return res.status(403).json({ error: error.message });
    if (error.code === '22023') return res.status(400).json({ error: error.message });
    if (error.code === '23505' || error.code === '55000') return res.status(409).json({ error: error.message });
    return logDatabaseError('Signature du contrat client impossible', error, res);
  }
  return res.json({ contract: data });
}
