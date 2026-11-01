import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Settings {
  id: boolean;
  platform_name: string;
  support_email: string;
  sender_name: string;
  sender_email: string;
  reply_to_email: string;
  updated_at: string;
}

export default function Settings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const data = await api.get('/admin/settings');
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement');
      console.error('Erreur:', err);
    } finally {
      setLoading(false);
    }
  };

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
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
      console.error('Erreur:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto mb-4"></div>
          <p className="text-muted">Chargement des paramètres...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-ink">Paramètres</h1>
        <p className="mt-1 text-sm text-muted">Gérez les paramètres de la plateforme ARTISANTS</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          ✗ {error}
        </div>
      )}

      {saved && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
          ✓ Paramètres enregistrés avec succès
        </div>
      )}

      {settings && (
        <form onSubmit={handleSave} className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Nom de la plateforme</label>
              <input
                type="text"
                value={settings.platform_name}
                onChange={(e) => setSettings({ ...settings, platform_name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">Email de support</label>
              <input
                type="email"
                value={settings.support_email}
                onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">Nom de l'expéditeur</label>
              <input
                type="text"
                value={settings.sender_name}
                onChange={(e) => setSettings({ ...settings, sender_name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">Email d'envoi</label>
              <input
                type="email"
                value={settings.sender_email}
                onChange={(e) => setSettings({ ...settings, sender_email: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">Email de réponse</label>
              <input
                type="email"
                value={settings.reply_to_email}
                onChange={(e) => setSettings({ ...settings, reply_to_email: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div className="text-xs text-muted">
              Dernière modification : {new Date(settings.updated_at).toLocaleString('fr-FR')}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
