import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import Pagination from '../components/Pagination';
import { CopyIcon, SendIcon, TrashIcon } from '../components/icons';
import { apiErrorMessage } from '../lib/api';
import { Marketing, type Campaign, type CampaignStatus } from '../lib/marketing';
import { supabase } from '../lib/supabase';
import type { Pagination as PaginationType } from '../types';
import { formatDateTime, formatNumber } from '../utils/format';

const STATUS: Record<CampaignStatus, { label: string; className: string }> = {
  draft: { label: 'Brouillon', className: 'bg-gray-100 text-gray-700 ring-gray-200' },
  scheduled: { label: 'Programmée', className: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  sending: { label: 'Envoi en cours', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  sent: { label: 'Envoyée', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  partial: { label: 'Partielle', className: 'bg-orange-50 text-orange-700 ring-orange-200' },
  failed: { label: 'Échouée', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  cancelled: { label: 'Annulée', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Toutes' },
  { value: 'scheduled', label: 'Programmées' },
  { value: 'sending', label: 'En cours' },
  { value: 'sent', label: 'Envoyées' },
  { value: 'draft', label: 'Brouillons' },
  { value: 'failed', label: 'Échouées' },
  { value: 'cancelled', label: 'Annulées' },
];

const RECURRENCE = { daily: 'chaque jour', weekly: 'chaque semaine', monthly: 'chaque mois' } as const;
const EDITABLE: CampaignStatus[] = ['draft', 'scheduled', 'cancelled'];

const audienceLabel = (c: Campaign) => {
  const s = c.segment ?? {};
  const base = s.audience === 'client' ? 'Clients' : s.audience === 'artisan' ? 'Artisans' : s.audience === 'all' ? 'Tous' : `${s.emails?.length ?? 0} adresse(s)`;
  return [base, s.profession, s.city].filter(Boolean).join(' · ');
};

const scheduleLabel = (c: Campaign) => {
  if (c.status === 'scheduled' && c.next_run_at) {
    const when = formatDateTime(c.next_run_at);
    return c.schedule_type === 'recurring' && c.recurrence ? `${when} (${RECURRENCE[c.recurrence]})` : when;
  }
  return c.last_run_at ? formatDateTime(c.last_run_at) : formatDateTime(c.created_at);
};

interface Confirm {
  title: string;
  message: string;
  action: () => Promise<void>;
}

export default function Campaigns() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Campaign[]>([]);
  const [pagination, setPagination] = useState<PaginationType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await Marketing.listCampaigns({ status, page, pageSize: 15 });
        setItems(res.data);
        setPagination(res.pagination);
        setError(null);
        setSelected((prev) => new Set([...prev].filter((id) => res.data.some((c) => c.id === id))));
      } catch (err) {
        setError(apiErrorMessage(err, 'Impossible de charger les campagnes'));
      } finally {
        setLoading(false);
      }
    },
    [status, page]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Suivi en direct : tout changement de statut met la liste à jour sans recharger la page.
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), 500);
    };
    const channel = supabase
      .channel('campaigns-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_email_campaigns' }, refresh)
      .subscribe();
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const act = async (task: () => Promise<unknown>, okMessage: string) => {
    setWorking(true);
    setNotice(null);
    try {
      await task();
      setNotice(okMessage);
      await load(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Action impossible'));
    } finally {
      setWorking(false);
    }
  };

  const ask = (title: string, message: string, action: () => Promise<void>) => setConfirm({ title, message, action });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const totalSent = items.reduce((sum, c) => sum + c.sent_count, 0);
  const scheduledCount = items.filter((c) => c.status === 'scheduled').length;

  return (
    <div>
      <PageHeader
        title="Campagnes"
        subtitle="Suivi en temps réel des envois, programmation et historique."
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                ask('Vider l\'historique', 'Toutes les campagnes terminées (envoyées, échouées, annulées) seront supprimées définitivement.', () =>
                  act(() => Marketing.clearHistory(), 'Historique supprimé.')
                )
              }
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Vider l&apos;historique
            </button>
            <button type="button" onClick={() => navigate('/emails')} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
              Nouvelle campagne
            </button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          ['Campagnes (page)', formatNumber(items.length)],
          ['Programmées', formatNumber(scheduledCount)],
          ['Emails envoyés (page)', formatNumber(totalSent)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
            className={['rounded-full px-3 py-1.5 text-sm font-medium transition', status === f.value ? 'bg-brand text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'].join(' ')}
          >
            {f.label}
          </button>
        ))}
        {selected.size > 0 ? (
          <button
            type="button"
            onClick={() =>
              ask('Supprimer la sélection', `${selected.size} campagne(s) seront supprimées définitivement.`, () =>
                act(async () => {
                  await Marketing.bulkDelete([...selected]);
                  setSelected(new Set());
                }, 'Sélection supprimée.')
              )
            }
            className="ml-auto flex items-center gap-2 rounded-full bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
          >
            <TrashIcon className="h-4 w-4" /> Supprimer ({selected.size})
          </button>
        ) : null}
      </div>

      {notice ? <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</div> : null}

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState title="Aucune campagne" hint="Rédigez un email pour lancer votre première campagne." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((c) => c.id)))}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th className="px-4 py-3">Campagne</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Résultat</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((c) => {
                const meta = STATUS[c.status];
                return (
                  <tr key={c.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(c.id)} disabled={c.status === 'sending'} onChange={() => toggle(c.id)} aria-label={`Sélectionner ${c.subject}`} />
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <p className="truncate font-semibold text-ink">{c.name || c.subject}</p>
                      <p className="truncate text-xs text-muted">{c.subject}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{audienceLabel(c)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{scheduleLabel(c)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${meta.className}`}>
                        {c.status === 'sending' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" /> : null}
                        {meta.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {c.run_count > 0 || c.status !== 'scheduled'
                        ? `${formatNumber(c.sent_count)} / ${formatNumber(c.recipient_count)}${c.failed_count ? ` · ${c.failed_count} échec(s)` : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {EDITABLE.includes(c.status) ? (
                          <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand-light" onClick={() => navigate('/emails', { state: { campaign: c, mode: 'edit' } })}>
                            Modifier
                          </button>
                        ) : null}
                        {EDITABLE.includes(c.status) ? (
                          <button
                            type="button"
                            title="Envoyer maintenant"
                            aria-label="Envoyer maintenant"
                            className="rounded-lg p-1.5 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600"
                            onClick={() => ask('Envoyer maintenant', `« ${c.name || c.subject} » sera envoyée immédiatement.`, () => act(() => Marketing.sendNow(c.id), 'Envoi lancé.'))}
                          >
                            <SendIcon className="h-4 w-4" />
                          </button>
                        ) : null}
                        {c.status === 'scheduled' ? (
                          <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50" onClick={() => ask('Annuler la programmation', 'La campagne ne sera pas envoyée.', () => act(() => Marketing.cancel(c.id), 'Campagne annulée.'))}>
                            Annuler
                          </button>
                        ) : null}
                        <button type="button" title="Dupliquer" aria-label="Dupliquer" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => navigate('/emails', { state: { campaign: c, mode: 'duplicate' } })}>
                          <CopyIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Supprimer"
                          aria-label="Supprimer"
                          disabled={c.status === 'sending'}
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                          onClick={() => ask('Supprimer la campagne', `« ${c.name || c.subject} » sera supprimée définitivement.`, () => act(() => Marketing.remove(c.id), 'Campagne supprimée.'))}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination ? <Pagination pagination={pagination} onPage={setPage} /> : null}

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-ink">{confirm.title}</h2>
            <p className="mt-2 text-sm text-muted">{confirm.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Annuler
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  const action = confirm.action;
                  setConfirm(null);
                  void action();
                }}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
