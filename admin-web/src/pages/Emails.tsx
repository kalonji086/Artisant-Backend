import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import RichEditor from '../components/RichEditor';
import { Spinner, PageHeader } from '../components/ui';
import { ClockIcon, MailIcon, SendIcon, TrashIcon } from '../components/icons';
import { useAdminAuth } from '../context/AdminAuthContext';
import { apiErrorMessage } from '../lib/api';
import {
  Marketing,
  type Campaign,
  type EmailTemplate,
  type Recurrence,
  type ScheduleType,
  type Segment,
} from '../lib/marketing';

type AudienceChoice = 'all' | 'client' | 'artisan' | 'list';

interface LocationState {
  campaign?: Campaign;
  mode?: 'edit' | 'duplicate';
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const defaultSchedule = () => toLocalInput(new Date(Date.now() + 60 * 60_000));

const SAMPLE = { '{{nom}}': 'Marie Dupont', '{{metier}}': 'Plombier', '{{ville}}': 'Paris', '{{email}}': 'marie@exemple.fr' };
const previewDoc = (html: string) => {
  let out = html;
  for (const [k, v] of Object.entries(SAMPLE)) out = out.split(k).join(v);
  return `<!doctype html><html><body style="margin:0;background:#f0f0f3;font-family:Arial,sans-serif;">
<div style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;">
<div style="background:#208aef;color:#fff;padding:20px;text-align:center;font-size:22px;font-weight:700;letter-spacing:1px;">ARTISANTS</div>
<div style="padding:32px 36px;color:#1f2937;font-size:15px;line-height:1.6;">${out}</div>
<div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px;text-align:center;font-size:12px;color:#6b7280;">Se désinscrire</div>
</div></body></html>`;
};

const fieldClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

function audienceFromSegment(s: Segment | null | undefined): AudienceChoice {
  if (s?.audience) return s.audience;
  return s?.emails?.length ? 'list' : 'client';
}

export default function Emails() {
  const navigate = useNavigate();
  const { session } = useAdminAuth();
  const state = (useLocation().state ?? {}) as LocationState;
  const source = state.campaign;
  const editingId = state.mode === 'edit' ? source?.id : undefined;

  const [name, setName] = useState(source?.name && state.mode === 'duplicate' ? `${source.name} (copie)` : source?.name ?? '');
  const [subject, setSubject] = useState(source?.subject ?? '');
  const [html, setHtml] = useState(source?.html_content ?? '');
  const [editor, setEditor] = useState({ key: 0, initial: source?.html_content ?? '' });

  const [audience, setAudience] = useState<AudienceChoice>(audienceFromSegment(source?.segment));
  const [profession, setProfession] = useState(source?.segment?.profession ?? '');
  const [city, setCity] = useState(source?.segment?.city ?? '');
  const [emailsText, setEmailsText] = useState((source?.segment?.emails ?? []).join('\n'));
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    source && source.schedule_type !== 'now' ? source.schedule_type : 'now'
  );
  const [scheduledAt, setScheduledAt] = useState(
    source?.next_run_at && new Date(source.next_run_at).getTime() > Date.now()
      ? toLocalInput(new Date(source.next_run_at))
      : defaultSchedule()
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(source?.recurrence ?? 'weekly');

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [testEmail, setTestEmail] = useState(session?.user.email ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    Marketing.listTemplates()
      .then((r) => setTemplates(r.data))
      .catch(() => undefined);
  }, []);

  const segment = useMemo<Segment>(() => {
    if (audience === 'list') {
      return { emails: emailsText.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) };
    }
    return { audience, profession: profession.trim() || undefined, city: city.trim() || undefined };
  }, [audience, profession, city, emailsText]);

  useEffect(() => setAudienceCount(null), [segment]);

  const fail = (err: unknown, fallback: string) => setNotice({ type: 'error', text: apiErrorMessage(err, fallback) });

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      fail(err, 'Une erreur est survenue');
    } finally {
      setBusy(null);
    }
  };

  const loadTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if ((html.replace(/<[^>]*>/g, '').trim() || subject) && !window.confirm('Remplacer le contenu actuel par ce modèle ?')) return;
    setSubject(t.subject);
    setHtml(t.html_content);
    setEditor((e) => ({ key: e.key + 1, initial: t.html_content }));
  };

  const saveTemplate = () => {
    const templateName = window.prompt('Nom du modèle');
    if (!templateName?.trim()) return;
    void run('template', async () => {
      const created = await Marketing.saveTemplate({ name: templateName.trim(), subject, html });
      setTemplates((prev) => [created, ...prev]);
      setNotice({ type: 'ok', text: 'Modèle enregistré.' });
    });
  };

  const removeTemplate = (id: string) => {
    if (!window.confirm('Supprimer ce modèle ?')) return;
    void run('template', async () => {
      await Marketing.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    });
  };

  const checkAudience = () =>
    void run('audience', async () => {
      setAudienceCount((await Marketing.countAudience(segment)).count);
    });

  const sendTest = () =>
    void run('test', async () => {
      await Marketing.sendTest({ to: testEmail.trim(), subject, html });
      setNotice({ type: 'ok', text: `Email de test envoyé à ${testEmail.trim()}.` });
    });

  const submit = (draft: boolean) => {
    if (!subject.trim()) return setNotice({ type: 'error', text: 'Saisissez un objet.' });
    if (!draft && scheduleType !== 'now' && !scheduledAt) return setNotice({ type: 'error', text: 'Choisissez une date et une heure.' });

    if (!draft && scheduleType === 'now') {
      const target = audienceCount !== null ? `${audienceCount} destinataire(s)` : 'le public sélectionné';
      if (!window.confirm(`Envoyer cet email maintenant à ${target} ?`)) return;
    }

    void run(draft ? 'draft' : 'send', async () => {
      const input = {
        name: name.trim() || undefined,
        subject: subject.trim(),
        html,
        segment,
        scheduleType: draft ? 'now' : scheduleType,
        scheduledAt: scheduleType !== 'now' ? new Date(scheduledAt).toISOString() : null,
        recurrence: scheduleType === 'recurring' ? recurrence : null,
        draft,
      } as const;

      if (editingId && !draft && scheduleType === 'now') {
        await Marketing.update(editingId, { ...input, scheduleType: 'now', draft: true });
        await Marketing.sendNow(editingId);
      } else if (editingId) {
        await Marketing.update(editingId, input);
      } else {
        await Marketing.create(input);
      }
      navigate('/campagnes');
    });
  };

  const sendLabel = scheduleType === 'now' ? 'Envoyer maintenant' : 'Programmer la campagne';

  return (
    <div>
      <PageHeader
        title={editingId ? 'Modifier la campagne' : 'Rédiger un email'}
        subtitle="Éditeur façon Word, audience ciblée et envoi immédiat ou programmé."
        icon={<MailIcon className="h-6 w-6" />}
      />

      {notice ? (
        <div
          role="status"
          className={['mb-4 rounded-xl border px-4 py-3 text-sm font-medium', notice.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'].join(' ')}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Nom de la campagne
              <input className={`${fieldClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Promo de printemps" maxLength={120} />
            </label>
            <label className="text-sm font-medium text-ink">
              Objet de l&apos;email
              <input className={`${fieldClass} mt-1`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. Bonjour {{nom}}, du nouveau sur ARTISANTS" maxLength={200} />
            </label>
          </div>

          <RichEditor key={editor.key} initialHtml={editor.initial} onChange={setHtml} />
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-ink">Audience</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                ['client', 'Clients'],
                ['artisan', 'Artisans'],
                ['all', 'Tous'],
                ['list', 'Liste d\'emails'],
              ] as [AudienceChoice, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAudience(value)}
                  className={['rounded-lg border px-3 py-2 text-sm font-medium transition', audience === value ? 'border-brand bg-brand-light text-brand-dark' : 'border-gray-200 text-gray-600 hover:bg-gray-50'].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>

            {audience === 'list' ? (
              <textarea className={`${fieldClass} mt-3 h-24`} value={emailsText} onChange={(e) => setEmailsText(e.target.value)} placeholder="Une adresse par ligne, ou séparées par des virgules" />
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input className={fieldClass} value={profession} onChange={(e) => setProfession(e.target.value)} placeholder="Métier (option)" />
                <input className={fieldClass} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville (option)" />
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <button type="button" onClick={checkAudience} disabled={busy !== null} className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                {busy === 'audience' ? 'Calcul…' : 'Compter les destinataires'}
              </button>
              {audienceCount !== null ? <span className="text-sm font-bold text-brand-dark">{audienceCount} destinataire(s)</span> : null}
            </div>
            <p className="mt-2 text-xs text-muted">Les personnes désinscrites sont exclues automatiquement.</p>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <ClockIcon className="h-4 w-4" /> Programmation
            </h2>
            <select className={`${fieldClass} mt-3`} value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)}>
              <option value="now">Envoyer maintenant</option>
              <option value="once">Programmer à une date précise</option>
              <option value="recurring">Campagne récurrente</option>
            </select>
            {scheduleType !== 'now' ? (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-medium text-muted">
                  {scheduleType === 'recurring' ? 'Premier envoi' : 'Date et heure d\'envoi'}
                  <input type="datetime-local" className={`${fieldClass} mt-1`} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </label>
                {scheduleType === 'recurring' ? (
                  <label className="block text-xs font-medium text-muted">
                    Fréquence
                    <select className={`${fieldClass} mt-1`} value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                      <option value="daily">Tous les jours</option>
                      <option value="weekly">Toutes les semaines</option>
                      <option value="monthly">Tous les mois</option>
                    </select>
                  </label>
                ) : null}
                <p className="text-xs text-muted">Heure de votre navigateur ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy !== null}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
            >
              {busy === 'send' ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}
              {sendLabel}
            </button>
            <button type="button" onClick={() => submit(true)} disabled={busy !== null} className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
              Enregistrer comme brouillon
            </button>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-ink">Aperçu et test</h2>
            <button type="button" onClick={() => setShowPreview(true)} className="mt-3 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
              Voir l&apos;aperçu
            </button>
            <div className="mt-3 flex gap-2">
              <input type="email" className={fieldClass} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Votre adresse" />
              <button type="button" onClick={sendTest} disabled={busy !== null || !testEmail || !subject.trim()} className="shrink-0 rounded-lg bg-gray-800 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-900 disabled:opacity-50">
                {busy === 'test' ? '…' : 'Tester'}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">Modèles</h2>
              <button type="button" onClick={saveTemplate} disabled={busy !== null} className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
                Enregistrer le message
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="mt-3 text-xs text-muted">Aucun modèle enregistré.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {templates.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                    <button type="button" onClick={() => loadTemplate(t.id)} className="min-w-0 flex-1 truncate text-left text-sm text-ink">
                      {t.name}
                    </button>
                    <button type="button" onClick={() => removeTemplate(t.id)} className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Supprimer ${t.name}`}>
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {showPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <p className="truncate text-sm font-semibold text-ink">{subject || 'Sans objet'}</p>
              <button type="button" onClick={() => setShowPreview(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Fermer
              </button>
            </div>
            <iframe title="Aperçu de l'email" sandbox="" srcDoc={previewDoc(html)} className="flex-1" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
