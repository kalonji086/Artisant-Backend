import crypto from 'crypto';
import { supabase } from './supabase';
import { sendEmail } from './email';
import { logger } from './logger';
import { buildEmailFooter, escapeHtml, getBranding, type Branding } from './branding';

export interface Segment {
  audience?: 'all' | 'client' | 'artisan';
  profession?: string;
  city?: string;
  emails?: string[];
}

export interface Recipient {
  email: string;
  name: string;
  profession: string;
  city: string;
}

export type Recurrence = 'daily' | 'weekly' | 'monthly';

interface CampaignRow {
  id: string;
  subject: string;
  html_content: string | null;
  segment: Segment | null;
  schedule_type: 'now' | 'once' | 'recurring';
  recurrence: Recurrence | null;
  run_count: number;
}

const API_VERSION = '/api/v1';
const SEND_CONCURRENCY = 5;

const secret = () =>
  process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'artisants-dev-secret';

export const publicBaseUrl = (): string =>
  (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/+$/, '');

const sign = (email: string) => crypto.createHmac('sha256', secret()).update(email).digest('hex');

export const verifyUnsubscribe = (email: string, token: string): boolean => {
  const expected = Buffer.from(sign(email));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

const unsubscribeUrl = (baseUrl: string, email: string) =>
  `${baseUrl}${API_VERSION}/unsubscribe?e=${encodeURIComponent(Buffer.from(email).toString('base64url'))}&t=${sign(email)}`;

export const decodeUnsubscribeEmail = (value: string): string =>
  Buffer.from(value, 'base64url').toString('utf8').toLowerCase();


/** Retire les scripts, iframes et gestionnaires d'événements du contenu rédigé. */
export const sanitizeHtml = (html: string): string =>
  html
    .replace(/<\s*(script|iframe|object|embed|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');

const applyVariables = (text: string, r: Recipient, escape = true): string => {
  const v = (s: string) => (escape ? escapeHtml(s) : s);
  return text
    .replace(/\{\{\s*nom\s*\}\}/gi, v(r.name || 'Bonjour'))
    .replace(/\{\{\s*metier\s*\}\}/gi, v(r.profession))
    .replace(/\{\{\s*ville\s*\}\}/gi, v(r.city))
    .replace(/\{\{\s*email\s*\}\}/gi, v(r.email));
};

const wrapEmail = (bodyHtml: string, logoUrl: string, footerHtml: string, name: string): string => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f0f3;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f3;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#208aef;padding:24px;text-align:center;">
          <img src="${logoUrl}" alt="${escapeHtml(name)}" width="64" height="64" style="border-radius:14px;vertical-align:middle;">
          <span style="display:inline-block;vertical-align:middle;margin-left:12px;color:#fff;font-size:22px;font-weight:700;letter-spacing:1px;">${escapeHtml(name)}</span>
        </td></tr>
        <tr><td style="padding:32px 36px;color:#1f2937;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
        <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 36px;text-align:center;">
          ${footerHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export const renderEmail = (html: string, r: Recipient, baseUrl: string, branding: Branding): string =>
  wrapEmail(
    applyVariables(sanitizeHtml(html), r),
    `${baseUrl}/logo.png`,
    buildEmailFooter(branding, baseUrl, unsubscribeUrl(baseUrl, r.email)),
    branding.platformName
  );

const listAllUsers = async (): Promise<Map<string, string>> => {
  const emails = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const u of users) if (u.email) emails.set(u.id, u.email.toLowerCase());
    if (users.length < 1000) break;
  }
  return emails;
};

export const resolveAudience = async (segment: Segment): Promise<Recipient[]> => {
  const { data: unsub } = await supabase.from('email_unsubscribes').select('email');
  const blocked = new Set((unsub ?? []).map((u: { email: string }) => u.email.toLowerCase()));
  const result = new Map<string, Recipient>();

  for (const raw of segment.emails ?? []) {
    const email = raw.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.set(email, { email, name: '', profession: '', city: '' });
    }
  }

  const audience = segment.audience;
  if (audience) {
    let query = supabase.from('profiles').select('id, full_name, profession, city, role').in('role', ['client', 'artisan']);
    if (audience !== 'all') query = query.eq('role', audience);
    if (segment.profession) query = query.ilike('profession', segment.profession);
    if (segment.city) query = query.ilike('city', segment.city);
    const { data: profiles, error } = await query;
    if (error) throw error;

    const emails = await listAllUsers();
    for (const p of profiles ?? []) {
      const email = emails.get(p.id);
      if (!email) continue;
      result.set(email, {
        email,
        name: p.full_name ?? '',
        profession: p.profession ?? '',
        city: p.city ?? '',
      });
    }
  }

  return [...result.values()].filter((r) => !blocked.has(r.email));
};

export const computeNextRun = (from: Date, recurrence: Recurrence): Date => {
  const next = new Date(from);
  if (recurrence === 'daily') next.setDate(next.getDate() + 1);
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
};

/** Envoie la campagne à chaque destinataire (un email par personne) et met à jour son statut. */
export const runCampaign = async (campaign: CampaignRow, baseUrl: string): Promise<void> => {
  let sent = 0;
  let failed = 0;
  let total = 0;

  try {
    const recipients = await resolveAudience(campaign.segment ?? {});
    total = recipients.length;
    const branding = await getBranding();

    const queue = [...recipients];
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        try {
          await sendEmail({
            to: r.email,
            subject: applyVariables(campaign.subject, r, false),
            htmlContent: renderEmail(campaign.html_content ?? '', r, baseUrl, branding),
          });
          sent++;
        } catch (err) {
          failed++;
          logger.warn('Envoi campagne échoué', {
            campaign_id: campaign.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));
  } catch (err) {
    logger.error('Campagne en erreur', {
      campaign_id: campaign.id,
      error: err instanceof Error ? err.message : String(err),
    });
    failed = Math.max(failed, 1);
  }

  const now = new Date();
  const outcome = total === 0 && failed === 0 ? 'failed' : failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  const recurring = campaign.schedule_type === 'recurring' && campaign.recurrence;

  await supabase
    .from('admin_email_campaigns')
    .update({
      status: recurring ? 'scheduled' : outcome,
      next_run_at: recurring ? computeNextRun(now, campaign.recurrence as Recurrence).toISOString() : null,
      last_run_at: now.toISOString(),
      run_count: campaign.run_count + 1,
      recipient_count: total,
      sent_count: sent,
      failed_count: failed,
      updated_at: now.toISOString(),
    })
    .eq('id', campaign.id);
};

const CAMPAIGN_COLUMNS = 'id, subject, html_content, segment, schedule_type, recurrence, run_count';

/** Prend la main sur une campagne (évite un double envoi) puis l'exécute. */
export const claimAndRun = async (id: string, baseUrl: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('admin_email_campaigns')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['scheduled', 'draft'])
    .select(CAMPAIGN_COLUMNS)
    .maybeSingle();
  if (error || !data) return false;
  await runCampaign(data as CampaignRow, baseUrl);
  return true;
};

let schedulerRunning = false;

const tick = async () => {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    // Une campagne restée « en cours » trop longtemps (redémarrage du serveur) est marquée en échec.
    await supabase
      .from('admin_email_campaigns')
      .update({ status: 'failed' })
      .eq('status', 'sending')
      .lt('updated_at', new Date(Date.now() - 30 * 60_000).toISOString());

    const { data } = await supabase
      .from('admin_email_campaigns')
      .select('id')
      .eq('status', 'scheduled')
      .lte('next_run_at', new Date().toISOString())
      .limit(10);
    for (const c of data ?? []) await claimAndRun(c.id, publicBaseUrl());
  } catch (err) {
    logger.error('Planificateur de campagnes', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    schedulerRunning = false;
  }
};

export const startCampaignScheduler = (): NodeJS.Timeout => {
  void tick();
  return setInterval(() => void tick(), 60_000);
};