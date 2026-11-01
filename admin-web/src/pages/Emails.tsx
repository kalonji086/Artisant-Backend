import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface EmailCampaign {
  id: string;
  subject: string;
  audience: 'client' | 'artisan';
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  status: 'sent' | 'partial' | 'failed';
  created_at: string;
}

export default function Emails() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    recipientType: 'all' as 'all' | 'specific' | 'email',
    audience: 'client' as 'client' | 'artisan',
    subject: '',
    body: '',
    specificEmail: '',
    specificUserId: '',
  });

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/admin/email-campaigns?page=1&pageSize=10`);
      setCampaigns(data.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement');
      console.error('Erreur:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.subject.trim() || !formData.body.trim()) {
      setError('Sujet et message sont requis');
      return;
    }

    if (formData.recipientType === 'all' && !formData.audience) {
      setError('Veuillez sélectionner Clients ou Artisans');
      return;
    }

    if (formData.recipientType === 'email' && !formData.specificEmail.includes('@')) {
      setError('Email valide requis');
      return;
    }

    try {
      setSending(true);
      const result = await api.post('/admin/email-campaigns', {
        recipientType: formData.recipientType,
        audience: formData.audience || undefined,
        subject: formData.subject,
        body: formData.body,
        specificEmail: formData.recipientType === 'email' ? formData.specificEmail : undefined,
        specificUserId: formData.recipientType === 'specific' ? formData.specificUserId : undefined,
      });
      setSuccess(result.message);
      setFormData({
        recipientType: 'all',
        audience: 'client',
        subject: '',
        body: '',
        specificEmail: '',
        specificUserId: '',
      });
      setError(null);
      await fetchCampaigns();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi');
      console.error('Erreur:', err);
    } finally {
      setSending(false);
    }
  };

  const statusColors = {
    sent: 'bg-green-50 text-green-700',
    partial: 'bg-yellow-50 text-yellow-700',
    failed: 'bg-red-50 text-red-700',
  };

  const statusLabels = {
    sent: 'Envoyé',
    partial: 'Partiel',
    failed: 'Échoué',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-ink">Emails</h1>
        <p className="mt-1 text-sm text-muted">Historique et gestion des campagnes d'email</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          ✗ {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
          ✓ {success}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto mb-2"></div>
            <p className="text-muted text-sm">Chargement des campagnes...</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted">Aucune campagne d'email pour le moment</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-ink">Sujet</th>
                  <th className="px-6 py-3 text-left font-medium text-ink">Public</th>
                  <th className="px-6 py-3 text-left font-medium text-ink">Envoyé</th>
                  <th className="px-6 py-3 text-left font-medium text-ink">Statut</th>
                  <th className="px-6 py-3 text-left font-medium text-ink">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-ink max-w-xs truncate">{campaign.subject}</td>
                    <td className="px-6 py-3 text-ink capitalize">{campaign.audience}</td>
                    <td className="px-6 py-3 text-ink">
                      {campaign.sent_count} / {campaign.recipient_count}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${statusColors[campaign.status]}`}>
                        {statusLabels[campaign.status]}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-muted text-xs">
                      {new Date(campaign.created_at).toLocaleString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-ink mb-6">Envoyer un email</h2>
        <form onSubmit={handleSendEmail} className="space-y-6">
          {/* Type de destinataire */}
          <div>
            <label className="block text-sm font-medium text-ink mb-3">À qui envoyer ?</label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50" style={{borderColor: formData.recipientType === 'all' ? '#3b82f6' : '#e5e7eb', backgroundColor: formData.recipientType === 'all' ? '#eff6ff' : 'transparent'}}>
                <input
                  type="radio"
                  value="all"
                  checked={formData.recipientType === 'all'}
                  onChange={(e) => setFormData({ ...formData, recipientType: e.target.value as any })}
                  className="w-4 h-4"
                />
                <span className="flex-1">À tous les clients / artisans</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50" style={{borderColor: formData.recipientType === 'specific' ? '#3b82f6' : '#e5e7eb', backgroundColor: formData.recipientType === 'specific' ? '#eff6ff' : 'transparent'}}>
                <input
                  type="radio"
                  value="specific"
                  checked={formData.recipientType === 'specific'}
                  onChange={(e) => setFormData({ ...formData, recipientType: e.target.value as any })}
                  className="w-4 h-4"
                />
                <span className="flex-1">À un utilisateur spécifique</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50" style={{borderColor: formData.recipientType === 'email' ? '#3b82f6' : '#e5e7eb', backgroundColor: formData.recipientType === 'email' ? '#eff6ff' : 'transparent'}}>
                <input
                  type="radio"
                  value="email"
                  checked={formData.recipientType === 'email'}
                  onChange={(e) => setFormData({ ...formData, recipientType: e.target.value as any })}
                  className="w-4 h-4"
                />
                <span className="flex-1">À une adresse email</span>
              </label>
            </div>
          </div>

          {/* Audience (si "tous") */}
          {formData.recipientType === 'all' && (
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Public cible</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="client"
                    checked={formData.audience === 'client'}
                    onChange={(e) => setFormData({ ...formData, audience: e.target.value as any })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-ink">Tous les clients</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="artisan"
                    checked={formData.audience === 'artisan'}
                    onChange={(e) => setFormData({ ...formData, audience: e.target.value as any })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-ink">Tous les artisans</span>
                </label>
              </div>
            </div>
          )}

          {/* Email spécifique (si "email") */}
          {formData.recipientType === 'email' && (
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Adresse email</label>
              <input
                type="email"
                value={formData.specificEmail}
                onChange={(e) => setFormData({ ...formData, specificEmail: e.target.value })}
                placeholder="utilisateur@example.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
          )}

          {/* User ID spécifique (si "specific") */}
          {formData.recipientType === 'specific' && (
            <div>
              <label className="block text-sm font-medium text-ink mb-2">ID utilisateur</label>
              <input
                type="text"
                value={formData.specificUserId}
                onChange={(e) => setFormData({ ...formData, specificUserId: e.target.value })}
                placeholder="Collez l'UUID de l'utilisateur"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none font-mono text-xs"
              />
            </div>
          )}

          {/* Sujet */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Sujet</label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="Sujet de l'email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Message</label>
            <textarea
              rows={8}
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="Contenu de l'email (HTML supporté)..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none font-mono text-xs"
            />
            <p className="text-xs text-muted mt-2">💡 Conseil: Utilisez du HTML pour un meilleur formatage</p>
          </div>

          {/* Bouton d'envoi */}
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition disabled:opacity-50"
          >
            {sending ? 'Envoi en cours...' : '✉️ Envoyer l\'email'}
          </button>
        </form>
      </div>
    </div>
  );
}
