import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendEmail } from '../lib/email';
import { getBranding } from '../lib/branding';
import {
  claimAndRun,
  decodeUnsubscribeEmail,
  renderEmail,
  resolveAudience,
  verifyUnsubscribe,
  type Recurrence,
  type Segment,
} from '../lib/marketing';

type AuthedRequest = Request & { user?: { id: string } };

const RECURRENCES: Recurrence[] = ['daily', 'weekly', 'monthly'];
const MAX_HTML = 500_000;

const fail = (res: Response, err: unknown, fallback: string) => {
  const message = err instanceof Error ? err.message : fallback;
  logger.error(fallback, { error: message });
  return res.status(500).json({ error: message });
};

const baseUrl = (req: Request) =>
  (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

const cleanSegment = (raw: unknown): Segment => {
  const s = (raw ?? {}) as Record<string, unknown>;
  const segment: Segment = {};
  if (s.audience === 'all' || s.audience === 'client' || s.audience === 'artisan') segment.audience = s.audience;
  if (typeof s.profession === 'string' && s.profession.trim()) segment.profession = s.profession.trim();
  if (typeof s.city === 'string' && s.city.trim()) segment.city = s.city.trim();
  if (Array.isArray(s.emails)) {
    segment.emails = s.emails.filter((e): e is string => typeof e === 'string').slice(0, 5000);
  }
  return segment;
};

const audienceLabel = (s: Segment): string =>
  s.audience && s.audience !== 'all' ? s.audience : s.audience === 'all' ? 'all' : 'custom';

export const listCampaigns = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const from = (page - 1) * pageSize;

  try {
    let query = supabase
      .from('admin_email_campaigns')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (status) query = query.eq('status', status);
    const { data, count, error } = await query;
    if (error) throw error;
    res.json({
      data: data ?? [],
      pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    });
  } catch (err) {
    fail(res, err, 'Erreur lors de la lecture des campagnes');
  }
};

interface CampaignInput {
  name: string;
  subject: string;
  html: string;
  segment: Segment;
  scheduleType: 'now' | 'once' | 'recurring';
  scheduledAt: string | null;
  recurrence: Recurrence | null;
  draft: boolean;
}

const parseCampaign = (body: Record<string, unknown>): CampaignInput | string => {
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const draft = body.draft === true;
  const scheduleType = body.scheduleType === 'once' || body.scheduleType === 'recurring' ? body.scheduleType : 'now';
  const segment = cleanSegment(body.segment);

  if (!subject || subject.length > 200) return 'Objet requis (200 caractères maximum)';
  if (!html.replace(/<[^>]*>/g, '').trim() && !/<img/i.test(html)) return 'Le contenu du message est vide';
  if (html.length > MAX_HTML) return 'Le message est trop volumineux';
  if (!segment.audience && !(segment.emails && segment.emails.length)) return 'Choisissez au moins un public';

  let scheduledAt: string | null = null;
  let recurrence: Recurrence | null = null;
  if (!draft && scheduleType !== 'now') {
    const date = new Date(String(body.scheduledAt ?? ''));
    if (Number.isNaN(date.getTime())) return 'Date de programmation invalide';
    if (date.getTime() < Date.now() - 60_000) return 'La date de programmation est dans le passé';
    scheduledAt = date.toISOString();
  }
  if (scheduleType === 'recurring') {
    recurrence = RECURRENCES.includes(body.recurrence as Recurrence) ? (body.recurrence as Recurrence) : null;
    if (!recurrence) return 'Fréquence de récurrence invalide';
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : subject;
  return { name, subject, html, segment, scheduleType, scheduledAt, recurrence, draft };
};

export const createCampaign = async (req: AuthedRequest, res: Response) => {
  const input = parseCampaign(req.body ?? {});
  if (typeof input === 'string') return res.status(400).json({ error: input });

  try {
    const sendNow = !input.draft && input.scheduleType === 'now';
    const { data, error } = await supabase
      .from('admin_email_campaigns')
      .insert({
        created_by: req.user?.id,
        name: input.name,
        subject: input.subject,
        html_content: input.html,
        segment: input.segment,
        audience: audienceLabel(input.segment),
        schedule_type: input.scheduleType,
        scheduled_at: input.scheduledAt,
        recurrence: input.recurrence,
        status: input.draft ? 'draft' : 'scheduled',
        next_run_at: input.draft ? null : sendNow ? new Date().toISOString() : input.scheduledAt,
      })
      .select()
      .single();
    if (error) throw error;

    if (sendNow) void claimAndRun(data.id, baseUrl(req));
    res.status(201).json(data);
  } catch (err) {
    fail(res, err, 'Erreur lors de la création de la campagne');
  }
};

export const updateCampaign = async (req: Request, res: Response) => {
  const input = parseCampaign(req.body ?? {});
  if (typeof input === 'string') return res.status(400).json({ error: input });
  if (!input.draft && input.scheduleType === 'now') {
    return res.status(400).json({ error: 'Utilisez « Envoyer maintenant » depuis la liste ou programmez une date' });
  }

  try {
    const { data, error } = await supabase
      .from('admin_email_campaigns')
      .update({
        name: input.name,
        subject: input.subject,
        html_content: input.html,
        segment: input.segment,
        audience: audienceLabel(input.segment),
        schedule_type: input.scheduleType,
        scheduled_at: input.scheduledAt,
        recurrence: input.recurrence,
        status: input.draft ? 'draft' : 'scheduled',
        next_run_at: input.draft ? null : input.scheduledAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .in('status', ['draft', 'scheduled', 'cancelled'])
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Cette campagne ne peut plus être modifiée' });
    res.json(data);
  } catch (err) {
    fail(res, err, 'Erreur lors de la modification de la campagne');
  }
};

export const sendCampaignNow = async (req: Request, res: Response) => {
  try {
    const { error } = await supabase
      .from('admin_email_campaigns')
      .update({ next_run_at: new Date().toISOString(), status: 'scheduled' })
      .eq('id', req.params.id)
      .in('status', ['draft', 'scheduled', 'cancelled']);
    if (error) throw error;
    const started = await claimAndRun(req.params.id, baseUrl(req));
    if (!started) return res.status(409).json({ error: 'Campagne introuvable ou déjà en cours' });
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 'Erreur lors de l\'envoi de la campagne');
  }
};

export const cancelCampaign = async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('admin_email_campaigns')
      .update({ status: 'cancelled', next_run_at: null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Seule une campagne programmée peut être annulée' });
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 'Erreur lors de l\'annulation de la campagne');
  }
};

const deleteCampaigns = async (ids: string[]) => {
  const { data, error } = await supabase
    .from('admin_email_campaigns')
    .delete()
    .in('id', ids)
    .neq('status', 'sending')
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
};

export const deleteCampaign = async (req: Request, res: Response) => {
  try {
    const deleted = await deleteCampaigns([req.params.id]);
    if (!deleted) return res.status(409).json({ error: 'Campagne introuvable ou en cours d\'envoi' });
    res.json({ success: true, deleted });
  } catch (err) {
    fail(res, err, 'Erreur lors de la suppression');
  }
};

export const bulkDeleteCampaigns = async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((i): i is string => typeof i === 'string') : [];
  if (ids.length === 0 || ids.length > 500) return res.status(400).json({ error: 'Sélection invalide' });
  try {
    res.json({ success: true, deleted: await deleteCampaigns(ids) });
  } catch (err) {
    fail(res, err, 'Erreur lors de la suppression');
  }
};

export const clearHistory = async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('admin_email_campaigns')
      .delete()
      .in('status', ['sent', 'partial', 'failed', 'cancelled'])
      .select('id');
    if (error) throw error;
    res.json({ success: true, deleted: data?.length ?? 0 });
  } catch (err) {
    fail(res, err, 'Erreur lors de la suppression de l\'historique');
  }
};

export const sendTestEmail = async (req: Request, res: Response) => {
  const { subject, html, to } = req.body ?? {};
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Adresse de test invalide' });
  }
  if (typeof subject !== 'string' || !subject.trim() || typeof html !== 'string' || html.length > MAX_HTML) {
    return res.status(400).json({ error: 'Objet et contenu requis' });
  }
  try {
    const sample = { email: to, name: 'Prénom Nom', profession: 'Plombier', city: 'Paris' };
    await sendEmail({
      to,
      subject: `[TEST] ${subject.trim()}`,
      htmlContent: renderEmail(html, sample, baseUrl(req), await getBranding()),
    });
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 'Erreur lors de l\'envoi du test');
  }
};

export const countAudience = async (req: Request, res: Response) => {
  try {
    const recipients = await resolveAudience(cleanSegment(req.body?.segment));
    res.json({ count: recipients.length });
  } catch (err) {
    fail(res, err, 'Erreur lors du calcul de l\'audience');
  }
};

export const listTemplates = async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, name, subject, html_content, created_at')
    .order('created_at', { ascending: false });
  if (error) return fail(res, error, 'Erreur lors de la lecture des modèles');
  res.json({ data: data ?? [] });
};

export const createTemplate = async (req: AuthedRequest, res: Response) => {
  const { name, subject, html } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof html !== 'string' || html.length > MAX_HTML) {
    return res.status(400).json({ error: 'Nom et contenu requis' });
  }
  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      name: name.trim().slice(0, 120),
      subject: typeof subject === 'string' ? subject.slice(0, 200) : '',
      html_content: html,
      created_by: req.user?.id,
    })
    .select('id, name, subject, html_content, created_at')
    .single();
  if (error) return fail(res, error, 'Erreur lors de l\'enregistrement du modèle');
  res.status(201).json(data);
};

export const deleteTemplate = async (req: Request, res: Response) => {
  const { error } = await supabase.from('email_templates').delete().eq('id', req.params.id);
  if (error) return fail(res, error, 'Erreur lors de la suppression du modèle');
  res.json({ success: true });
};

const page = (title: string, message: string) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:Arial,sans-serif;background:#f0f0f3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;">
<div style="background:#fff;padding:32px;border-radius:12px;max-width:420px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1><p style="color:#60646c;margin:0;">${message}</p></div></body></html>`;

/** Lien public de désinscription (signé, sans authentification). */
export const unsubscribe = async (req: Request, res: Response) => {
  const e = typeof req.query.e === 'string' ? req.query.e : '';
  const t = typeof req.query.t === 'string' ? req.query.t : '';
  res.type('html');

  let email = '';
  try {
    email = decodeUnsubscribeEmail(e);
  } catch {
    return res.status(400).send(page('Lien invalide', 'Ce lien de désinscription est invalide.'));
  }
  if (!email || !t || !verifyUnsubscribe(email, t)) {
    return res.status(400).send(page('Lien invalide', 'Ce lien de désinscription est invalide.'));
  }

  const { error } = await supabase.from('email_unsubscribes').upsert({ email });
  if (error) {
    logger.error('Désinscription échouée', { error: error.message });
    return res.status(500).send(page('Erreur', 'Une erreur est survenue, réessayez plus tard.'));
  }
  res.send(page('Désinscription confirmée', 'Vous ne recevrez plus nos emails marketing.'));
};
