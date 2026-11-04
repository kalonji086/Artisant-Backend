import { supabase } from './supabase';

export interface Branding {
  platformName: string;
  contactEmail: string;
  socials: { key: 'facebook' | 'github' | 'x' | 'linkedin' | 'instagram'; label: string; url: string; color: string }[];
}

export const DEFAULT_CONTACT_EMAIL = 'Togethertechsupport@gmail.com';
export const PUBLISHER_NAME = 'Guellord';

const SOCIALS = [
  { key: 'facebook', label: 'Facebook', column: 'facebook_url', color: '#1877f2' },
  { key: 'github', label: 'GitHub', column: 'github_url', color: '#24292f' },
  { key: 'x', label: 'X', column: 'x_url', color: '#000000' },
  { key: 'linkedin', label: 'LinkedIn', column: 'linkedin_url', color: '#0a66c2' },
  { key: 'instagram', label: 'Instagram', column: 'instagram_url', color: '#e4405f' },
] as const;

const TTL_MS = 60_000;
let cache: { at: number; value: Branding } | null = null;

export const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** N'accepte que des liens http(s) pour éviter tout javascript: dans les emails. */
export const safeUrl = (value: unknown): string => {
  const v = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
};

export const invalidateBranding = (): void => {
  cache = null;
};

export const getBranding = async (): Promise<Branding> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const { data } = await supabase.from('admin_platform_settings').select('*').maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;

  const value: Branding = {
    platformName: (row.platform_name as string) || 'ARTISANTS',
    contactEmail: (row.contact_email as string) || (row.support_email as string) || DEFAULT_CONTACT_EMAIL,
    socials: SOCIALS.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      url: safeUrl(row[s.column]),
    })).filter((s) => s.url),
  };
  cache = { at: Date.now(), value };
  return value;
};

/** Chemin public du formulaire de demande de suppression de compte (Play Store + emails). */
export const ACCOUNT_DELETION_PATH = '/account-deletion';

/** Lien vers la demande de suppression de compte, inséré dans les emails. */
export const accountDeletionLinkHtml = (baseUrl: string): string =>
  `<p style="margin:0 0 6px;font-size:12px;"><a href="${baseUrl}${ACCOUNT_DELETION_PATH}" style="color:#6b7280;">Demander la suppression de mon compte</a></p>`;

/** Pied de page commun aux emails : liens légaux, réseaux sociaux, contact et désinscription. */
export const buildEmailFooter = (branding: Branding, baseUrl: string, unsubUrl?: string): string => {
  const socials = branding.socials
    .map(
      (s) =>
        `<a href="${escapeHtml(s.url)}" target="_blank" style="display:inline-block;margin:0 4px 8px;padding:7px 14px;border-radius:999px;background:${s.color};color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;">${s.label}</a>`
    )
    .join('');

  const link = 'color:#208aef;text-decoration:none;';
  return `
    ${socials ? `<div style="margin-bottom:14px;">${socials}</div>` : ''}
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">
      <a href="${baseUrl}/legal/privacy" style="${link}">Politique de confidentialité</a>
      &nbsp;·&nbsp;
      <a href="${baseUrl}/legal/terms" style="${link}">Conditions d'utilisation</a>
    </p>
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">
      Une question ? <a href="mailto:${escapeHtml(branding.contactEmail)}" style="${link}">${escapeHtml(branding.contactEmail)}</a>
    </p>
    ${accountDeletionLinkHtml(baseUrl)}
    ${unsubUrl ? `<p style="margin:0 0 6px;font-size:12px;"><a href="${unsubUrl}" style="color:#6b7280;">Se désinscrire</a></p>` : ''}
    <p style="margin:8px 0 0;font-size:11px;color:#9ca3af;">© ${new Date().getFullYear()} ${escapeHtml(branding.platformName)}. Tous droits réservés.</p>`;
};
