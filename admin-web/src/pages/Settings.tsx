import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { AdminPlatformSettings } from '../types';

type ProviderStatus = { name: string; configured: boolean };
type Flash = { tone: 'success' | 'error'; message: string } | null;

const EMPTY_SETTINGS: Omit<AdminPlatformSettings, 'updated_at' | 'updated_by'> = {
  platform_name: '',
  support_email: '',
  sender_name: '',
  sender_email: '',
  reply_to_email: '',
};

const fieldClass =
  'mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
const labelClass = 'block text-sm font-medium text-ink';

export default function Settings() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testAddress, setTestAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await AdminService.getSettings();
      const { updated_at: _updatedAt, updated_by: _updatedBy, ...editableSettings } =
        data.settings;
      setSettings(editableSettings);
      setProvider(data.emailProvider);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Impossible de charger les paramètres.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFlash(null);
    try {
      const { data } = await AdminService.updateSettings(settings);
      const { updated_at: _updatedAt, updated_by: _updatedBy, ...editableSettings } =
        data.settings;
      setSettings(editableSettings);
      setProvider(data.emailProvider);
      setFlash({ tone: 'success', message: 'Paramètres enregistrés.' });
    } catch (saveError) {
      setFlash({
        tone: 'error',
        message: apiErrorMessage(saveError, 'Impossible d’enregistrer les paramètres.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTesting(true);
    setFlash(null);
    try {
      const { data } = await AdminService.sendTestEmail(testAddress.trim());
      setFlash({ tone: 'success', message: data.message });
    } catch (testError) {
      setFlash({
        tone: 'error',
        message: apiErrorMessage(testError, 'Impossible d’envoyer l’e-mail de test.'),
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <LoadingBlock label="Chargement des paramètres…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const flashClass =
    flash?.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-rose-200 bg-rose-50 text-rose-800';

  return (
    <div>
      <PageHeader
        title="Paramètres"
        subtitle="Informations de la plateforme et configuration des e-mails."
      />

      {flash ? (
        <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm ${flashClass}`}>
          {flash.message}
        </div>
      ) : null}

      <form onSubmit={saveSettings} className="max-w-3xl space-y-6">
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-ink">Plateforme</h2>
          <p className="mt-1 text-sm text-muted">
            Ces coordonnées sont utilisées dans les communications administratives.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={labelClass} htmlFor="platform-name">
              Nom de la plateforme
              <input
                id="platform-name"
                required
                maxLength={80}
                value={settings.platform_name}
                onChange={(event) =>
                  setSettings({ ...settings, platform_name: event.target.value })
                }
                className={fieldClass}
              />
            </label>

            <label className={labelClass} htmlFor="support-email">
              E-mail de support
              <input
                id="support-email"
                type="email"
                required
                maxLength={254}
                value={settings.support_email}
                onChange={(event) =>
                  setSettings({ ...settings, support_email: event.target.value })
                }
                className={fieldClass}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Expéditeur des e-mails</h2>
              <p className="mt-1 text-sm text-muted">
                Utilisé pour les e-mails de test et les campagnes de l’administration.
              </p>
            </div>
            <span
              className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
                provider?.configured
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              Brevo {provider?.configured ? 'configuré' : 'non configuré'}
            </span>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={labelClass} htmlFor="sender-name">
              Nom d’expéditeur
              <input
                id="sender-name"
                required
                maxLength={70}
                value={settings.sender_name}
                onChange={(event) =>
                  setSettings({ ...settings, sender_name: event.target.value })
                }
                className={fieldClass}
              />
            </label>

            <label className={labelClass} htmlFor="sender-email">
              Adresse d’expédition vérifiée dans Brevo
              <input
                id="sender-email"
                type="email"
                required
                maxLength={254}
                value={settings.sender_email}
                onChange={(event) =>
                  setSettings({ ...settings, sender_email: event.target.value })
                }
                className={fieldClass}
              />
            </label>

            <label className={labelClass} htmlFor="reply-to-email">
              Adresse de réponse (facultative)
              <input
                id="reply-to-email"
                type="email"
                maxLength={254}
                value={settings.reply_to_email}
                onChange={(event) =>
                  setSettings({ ...settings, reply_to_email: event.target.value })
                }
                className={fieldClass}
              />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
          </button>
          <span className="text-xs text-muted">
            La clé API Brevo reste uniquement dans l’environnement sécurisé du serveur.
          </span>
        </div>
      </form>

      <form
        onSubmit={sendTest}
        className="mt-8 max-w-3xl rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6"
      >
        <h2 className="text-base font-semibold text-ink">Tester l’envoi</h2>
        <p className="mt-1 text-sm text-muted">
          Envoie un message de contrôle avec l’expéditeur actuellement enregistré.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="test-address">Adresse de test</label>
          <input
            id="test-address"
            type="email"
            required
            maxLength={254}
            value={testAddress}
            onChange={(event) => setTestAddress(event.target.value)}
            placeholder="adresse@exemple.com"
            className={fieldClass}
          />
          <button
            type="submit"
            disabled={testing || !provider?.configured}
            className="shrink-0 rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand-dark transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? 'Envoi…' : 'Envoyer un test'}
          </button>
        </div>
      </form>
    </div>
  );
}
