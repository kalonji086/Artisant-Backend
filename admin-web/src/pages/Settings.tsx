import { useEffect, useState, type ReactNode } from 'react';
import { DocumentIcon, ExternalLinkIcon, MailIcon, MegaphoneIcon, SettingsIcon, ToolIcon } from '../components/icons';
import { Card, ErrorState, LoadingBlock, PageHeader, Spinner } from '../components/ui';
import { api, apiErrorMessage } from '../lib/api';
import LegalEditor from '../components/LegalEditor';

interface PlatformSettings {
  id: boolean;
  platform_name: string;
  support_email: string;
  sender_name: string;
  sender_email: string;
  reply_to_email: string;
  contact_email?: string;
  facebook_url?: string;
  github_url?: string;
  x_url?: string;
  linkedin_url?: string;
  instagram_url?: string;
  app_primary_color?: string;
  default_language?: string;
  default_theme?: string;
  maintenance_mode?: boolean;
  maintenance_message?: string;
  announcement?: string;
  allow_signups?: boolean;
  updated_at: string;
}

type EditableKey =
  | 'platform_name'
  | 'support_email'
  | 'sender_name'
  | 'sender_email'
  | 'reply_to_email'
  | 'contact_email'
  | 'facebook_url'
  | 'github_url'
  | 'x_url'
  | 'linkedin_url'
  | 'instagram_url'
  | 'app_primary_color'
  | 'default_language'
  | 'default_theme'
  | 'maintenance_message'
  | 'announcement';

const SOCIAL_FIELDS: { key: EditableKey; label: string; placeholder: string }[] = [
  { key: 'facebook_url', label: 'Facebook', placeholder: 'https://facebook.com/votrepage' },
  { key: 'github_url', label: 'GitHub', placeholder: 'https://github.com/votrecompte' },
  { key: 'x_url', label: 'X (Twitter)', placeholder: 'https://x.com/votrecompte' },
  { key: 'linkedin_url', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/votrepage' },
  { key: 'instagram_url', label: 'Instagram', placeholder: 'https://instagram.com/votrecompte' },
];

const INPUT =
  'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-ink shadow-sm placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setSettings(await api.get('/admin/settings'));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Erreur lors du chargement des paramètres.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSettings();
  }, []);

  const set = (key: EditableKey, value: string) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  const setFlag = (key: 'maintenance_mode' | 'allow_signups', value: boolean) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      setSaving(true);
      await api.patch('/admin/settings', {
        platform_name: settings.platform_name,
        support_email: settings.support_email,
        sender_name: settings.sender_name,
        sender_email: settings.sender_email,
        reply_to_email: settings.reply_to_email,
        contact_email: settings.contact_email,
        facebook_url: settings.facebook_url ?? '',
        github_url: settings.github_url ?? '',
        x_url: settings.x_url ?? '',
        linkedin_url: settings.linkedin_url ?? '',
        instagram_url: settings.instagram_url ?? '',
        app_primary_color: settings.app_primary_color ?? '#007AFF',
        default_language: settings.default_language ?? 'fr',
        default_theme: settings.default_theme ?? 'light',
        maintenance_mode: settings.maintenance_mode ?? false,
        maintenance_message: settings.maintenance_message ?? '',
        announcement: settings.announcement ?? '',
        allow_signups: settings.allow_signups ?? true,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Erreur lors de la sauvegarde.'));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <PageHeader
      title="Paramètres"
      subtitle="Identité de la plateforme et expéditeur des emails"
      icon={<SettingsIcon className="h-6 w-6" />}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <LoadingBlock label="Chargement des paramètres…" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        {header}
        <ErrorState message={error ?? 'Paramètres indisponibles.'} onRetry={() => void fetchSettings()} />
      </div>
    );
  }

  return (
    <div>
      {header}

      {error ? (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Paramètres enregistrés avec succès.
        </div>
      ) : null}

      <form onSubmit={handleSave} className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title="Plateforme" subtitle="Informations générales" icon={<ToolIcon className="h-5 w-5" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom de la plateforme">
                <input type="text" value={settings.platform_name} onChange={(e) => set('platform_name', e.target.value)} className={INPUT} />
              </Field>
              <Field label="Email de support" hint="Affiché aux utilisateurs pour toute demande d'aide.">
                <input type="email" value={settings.support_email} onChange={(e) => set('support_email', e.target.value)} className={INPUT} />
              </Field>
            </div>
          </Card>

          <Card title="Application mobile" subtitle="Appliqué en temps réel aux apps client et artisan" icon={<SettingsIcon className="h-5 w-5" />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Couleur principale">
                <div className="flex items-center gap-2">
                  <input type="color" value={settings.app_primary_color ?? '#007AFF'} onChange={(e) => set('app_primary_color', e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white p-1" />
                  <input type="text" value={settings.app_primary_color ?? '#007AFF'} onChange={(e) => set('app_primary_color', e.target.value)} className={INPUT} maxLength={7} />
                </div>
              </Field>
              <Field label="Langue par défaut">
                <select value={settings.default_language ?? 'fr'} onChange={(e) => set('default_language', e.target.value)} className={INPUT}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="Thème par défaut">
                <select value={settings.default_theme ?? 'light'} onChange={(e) => set('default_theme', e.target.value)} className={INPUT}>
                  <option value="light">Clair</option>
                  <option value="dark">Sombre</option>
                  <option value="system">Système</option>
                </select>
              </Field>
              <div className="sm:col-span-3">
                <Field label="Annonce (bandeau affiché dans l'app)" hint="Laissez vide pour ne rien afficher.">
                  <input type="text" value={settings.announcement ?? ''} onChange={(e) => set('announcement', e.target.value)} className={INPUT} maxLength={500} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-ink sm:col-span-3">
                <input type="checkbox" checked={settings.allow_signups ?? true} onChange={(e) => setFlag('allow_signups', e.target.checked)} />
                Autoriser les nouvelles inscriptions
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink sm:col-span-3">
                <input type="checkbox" checked={settings.maintenance_mode ?? false} onChange={(e) => setFlag('maintenance_mode', e.target.checked)} />
                Mode maintenance (bloque l'app pour les clients et artisans)
              </label>
              <div className="sm:col-span-3">
                <Field label="Message de maintenance">
                  <input type="text" value={settings.maintenance_message ?? ''} onChange={(e) => set('maintenance_message', e.target.value)} className={INPUT} maxLength={500} />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Expéditeur des emails" subtitle="Utilisé pour les campagnes et notifications" icon={<MailIcon className="h-5 w-5" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom de l'expéditeur">
                <input type="text" value={settings.sender_name} onChange={(e) => set('sender_name', e.target.value)} className={INPUT} />
              </Field>
              <Field label="Email d'envoi" hint="Doit être un expéditeur validé chez Brevo.">
                <input type="email" value={settings.sender_email} onChange={(e) => set('sender_email', e.target.value)} className={INPUT} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Email de réponse">
                  <input type="email" value={settings.reply_to_email} onChange={(e) => set('reply_to_email', e.target.value)} className={INPUT} />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Réseaux sociaux" subtitle="Affichés dans le pied de page des emails et des pages légales" icon={<MegaphoneIcon className="h-5 w-5" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <input
                    type="url"
                    value={settings[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className={INPUT}
                  />
                </Field>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Laissez un champ vide pour masquer le réseau. Les liens doivent commencer par https://</p>
          </Card>

          <Card title="Pages légales" subtitle="Contact et liens publics" icon={<DocumentIcon className="h-5 w-5" />}>
            <Field label="Email de contact (pages légales et emails)">
              <input type="email" value={settings.contact_email ?? ''} onChange={(e) => set('contact_email', e.target.value)} className={INPUT} />
            </Field>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                <ExternalLinkIcon className="h-4 w-4" /> Politique de confidentialité
              </a>
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                <ExternalLinkIcon className="h-4 w-4" /> Conditions d'utilisation
              </a>
            </div>
          </Card>

          <LegalEditor />

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? <Spinner className="h-4 w-4" /> : null}
              {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
            </button>
            <span className="text-xs text-muted">
              Dernière modification : {new Date(settings.updated_at).toLocaleString('fr-FR')}
            </span>
          </div>
        </div>

        <aside>
          <Card title="Aperçu de l'email" subtitle="Ce que verront vos destinataires" icon={<MailIcon className="h-5 w-5" />}>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium tracking-wide text-muted uppercase">De</dt>
                <dd className="font-medium text-ink">
                  {settings.sender_name || '—'} <span className="text-muted">&lt;{settings.sender_email || '—'}&gt;</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wide text-muted uppercase">Répondre à</dt>
                <dd className="text-ink">{settings.reply_to_email || '—'}</dd>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-[#0b1b33] to-[#0d2548] p-4 text-white">
                <p className="text-sm font-bold tracking-wide">{settings.platform_name || 'ARTISANTS'}</p>
                <p className="mt-1 text-xs text-white/70">Support : {settings.support_email || '—'}</p>
              </div>
            </dl>
          </Card>
        </aside>
      </form>
    </div>
  );
}
