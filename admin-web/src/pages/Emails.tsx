import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { AdminEmailCampaign, EmailAudience } from '../types';
import { formatDate } from '../utils/format';

type Flash = { tone: 'success' | 'warning' | 'error'; message: string } | null;
type AudiencePreview = {
  recipientCount: number;
  campaignLimit: number;
  emailProviderConfigured: boolean;
};

const EMPTY_PREVIEW: AudiencePreview = {
  recipientCount: 0,
  campaignLimit: 5000,
  emailProviderConfigured: false,
};

const roleLabel: Record<EmailAudience, string> = {
  client: 'Clients',
  artisan: 'Artisans',
};

const campaignStatusLabel: Record<AdminEmailCampaign['status'], string> = {
  sent: 'Envoyée',
  partial: 'Partielle',
  failed: 'Échec',
};

const campaignStatusClass: Record<AdminEmailCampaign['status'], string> = {
  sent: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700',
};

const fieldClass =
  'mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

export default function Emails() {
  const [audience, setAudience] = useState<EmailAudience>('client');
  const [preview, setPreview] = useState<AudiencePreview>(EMPTY_PREVIEW);
  const [history, setHistory] = useState<AdminEmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const loadAudience = useCallback(async (selectedAudience: EmailAudience) => {
    const { data } = await AdminService.getEmailAudience(selectedAudience);
    setPreview({
      recipientCount: data.recipientCount,
      campaignLimit: data.campaignLimit,
      emailProviderConfigured: data.emailProviderConfigured,
    });
  }, []);

  const loadHistory = useCallback(async () => {
    const { data } = await AdminService.getEmailCampaignHistory();
    setHistory(data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadAudience(audience), loadHistory()]);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Impossible de charger le module e-mail.'));
    } finally {
      setLoading(false);
    }
  }, [audience, loadAudience, loadHistory]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeAudience = async (value: EmailAudience) => {
    setAudience(value);
    setConfirmed(false);
    setPreviewLoading(true);
    setFlash(null);
    try {
      await loadAudience(value);
    } catch (loadError) {
      setFlash({
        tone: 'error',
        message: apiErrorMessage(loadError, 'Impossible de charger ce segment.'),
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || !preview.emailProviderConfigured) return;

    setSending(true);
    setFlash(null);
    try {
      const { data } = await AdminService.sendEmailCampaign({
        audience,
        subject: subject.trim(),
        body: body.trim(),
        expectedRecipientCount: preview.recipientCount,
        confirmed: true,
      });
      setFlash({
        tone: data.status === 'sent' ? 'success' : data.status === 'partial' ? 'warning' : 'error',
        message:
          data.error ??
          data.warning ??
          `Campagne ${data.status === 'sent' ? 'envoyée' : 'terminée'} : ${data.sentCount} e-mail(s) envoyé(s), ${data.failedCount} échec(s).` +
            (data.historySaved ? '' : ' L’historique n’a pas pu être enregistré.'),
      });
      setSubject('');
      setBody('');
      setConfirmed(false);
      await Promise.all([loadAudience(audience), loadHistory()]);
    } catch (sendError) {
      setFlash({
        tone: 'error',
        message: apiErrorMessage(sendError, 'Impossible d’envoyer la campagne.'),
      });
      try {
        await loadAudience(audience);
      } catch (refreshError) {
        console.error('Impossible de rafraîchir le segment après l’erreur d’envoi:', refreshError);
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) return <LoadingBlock label="Chargement du module e-mail…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const canSend =
    preview.emailProviderConfigured &&
    preview.recipientCount > 0 &&
    preview.recipientCount <= preview.campaignLimit &&
    confirmed &&
    subject.trim().length >= 3 &&
    body.trim().length > 0 &&
    !sending &&
    !previewLoading;

  const flashClass =
    flash?.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : flash?.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-rose-200 bg-rose-50 text-rose-800';

  return (
    <div>
      <PageHeader
        title="Envoi de mails"
        subtitle="Préparez une communication et envoyez-la à un segment clients ou artisans."
      />

      {flash ? (
        <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm ${flashClass}`}>
          {flash.message}
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <form onSubmit={sendCampaign} className="space-y-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Nouvelle campagne</h2>
              <p className="mt-1 text-sm text-muted">
                Chaque destinataire reçoit un message individuel; les adresses restent privées.
              </p>
            </div>
            <span
              className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
                preview.emailProviderConfigured
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              Brevo {preview.emailProviderConfigured ? 'configuré' : 'non configuré'}
            </span>
          </div>

          <label className="block text-sm font-medium text-ink" htmlFor="email-audience">
            Segment destinataire
            <select
              id="email-audience"
              value={audience}
              onChange={(event) => void changeAudience(event.target.value as EmailAudience)}
              className={fieldClass}
            >
              <option value="client">Clients</option>
              <option value="artisan">Artisans</option>
            </select>
          </label>

          <div className="rounded-xl border border-brand/20 bg-brand-light/50 px-4 py-3">
            <p className="text-sm font-semibold text-brand-dark">
              {previewLoading
                ? 'Calcul du segment…'
                : `${preview.recipientCount.toLocaleString('fr-FR')} destinataire(s) avec adresse e-mail`}
            </p>
            <p className="mt-1 text-xs text-muted">
              Limite par campagne : {preview.campaignLimit.toLocaleString('fr-FR')}. Les comptes
              Admin ne sont jamais inclus.
            </p>
          </div>

          {preview.recipientCount > preview.campaignLimit ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Ce segment dépasse la limite. Réduisez le public ou envoyez la campagne en plusieurs segments.
            </p>
          ) : null}

          <label className="block text-sm font-medium text-ink" htmlFor="campaign-subject">
            Objet
            <input
              id="campaign-subject"
              required
              minLength={3}
              maxLength={180}
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
                setConfirmed(false);
              }}
              className={fieldClass}
              placeholder="Ex. Informations importantes sur ARTISANTS"
            />
          </label>

          <label className="block text-sm font-medium text-ink" htmlFor="campaign-body">
            Message
            <textarea
              id="campaign-body"
              required
              maxLength={4000}
              rows={8}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setConfirmed(false);
              }}
              className={fieldClass}
              placeholder="Rédigez le contenu du message…"
            />
            <span className="mt-1 block text-right text-xs text-muted">{body.length}/4000</span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              Je confirme l’envoi à l’ensemble des {preview.recipientCount.toLocaleString('fr-FR')}{' '}
              {roleLabel[audience].toLowerCase()} et suis autorisé à leur adresser ce message.
            </span>
          </label>

          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Envoi en cours…' : `Envoyer aux ${roleLabel[audience].toLowerCase()}`}
          </button>
        </form>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold text-ink">Historique des campagnes</h2>
            <p className="mt-1 text-sm text-muted">Les 20 derniers envois administratifs.</p>
          </div>

          {history.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="Aucune campagne envoyée"
                hint="Les campagnes terminées apparaîtront ici."
              />
            </div>
          ) : (
            <ol className="mt-5 divide-y divide-gray-100">
              {history.map((campaign) => (
                <li key={campaign.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                      {campaign.subject}
                    </p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${campaignStatusClass[campaign.status]}`}>
                      {campaignStatusLabel[campaign.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {roleLabel[campaign.audience]} · {campaign.sent_count}/{campaign.recipient_count} envoyé(s)
                    {campaign.failed_count > 0 ? ` · ${campaign.failed_count} échec(s)` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted">{formatDate(campaign.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
