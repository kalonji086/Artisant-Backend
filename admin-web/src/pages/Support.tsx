import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CheckIcon, ChatIcon, ClockIcon, InboxIcon, TrashIcon } from '../components/icons';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader, StatStrip } from '../components/ui';
import { formatDate, formatNumber } from '../utils/format';

type RequestType = 'help' | 'account_deletion';
type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

interface SupportRequest {
  id: string;
  request_type: RequestType;
  status: SupportStatus;
  email: string;
  full_name: string | null;
  subject: string | null;
  message: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_TABS = [
  { value: '', label: 'Toutes' },
  { value: 'open', label: 'Ouvertes' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'resolved', label: 'Résolues' },
  { value: 'closed', label: 'Fermées' },
];

const STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  resolved: 'Résolue',
  closed: 'Fermée',
};

const STATUS_TONE: Record<SupportStatus, string> = {
  open: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-700',
};

const NEXT_STATUSES: SupportStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

export default function Support() {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | RequestType>('');
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let query = supabase
      .from('support_requests')
      .select('id, request_type, status, email, full_name, subject, message, admin_notes, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (statusFilter) query = query.eq('status', statusFilter);
    if (typeFilter) query = query.eq('request_type', typeFilter);
    const { data, error: err } = await query;
    if (err) setError('Impossible de charger les demandes de support.');
    else setRequests((data ?? []) as SupportRequest[]);
    setLoading(false);
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Temps réel : une nouvelle demande ou un changement de statut rafraîchit la liste.
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 300);
    };
    const channel = supabase
      .channel('support-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, refresh)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const selected = useMemo(() => requests.find((r) => r.id === selectedId) ?? null, [requests, selectedId]);

  useEffect(() => {
    setNotes(selected?.admin_notes ?? '');
  }, [selected?.id, selected?.admin_notes]);

  const counts = useMemo(
    () => ({
      open: requests.filter((r) => r.status === 'open').length,
      deletion: requests.filter((r) => r.request_type === 'account_deletion' && r.status !== 'closed').length,
    }),
    [requests],
  );

  const updateRequest = async (patch: Partial<Pick<SupportRequest, 'status' | 'admin_notes'>>) => {
    if (!selected) return;
    setSaving(true);
    const { error: err } = await supabase
      .from('support_requests')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', selected.id);
    setSaving(false);
    if (err) {
      setFlash('Mise à jour impossible. Réessayez.');
      return;
    }
    setFlash('Demande mise à jour.');
    void load();
  };

  return (
    <div>
      <PageHeader
        title="Support"
        subtitle="Demandes d'aide et de suppression de compte, reçues en temps réel"
        icon={<ChatIcon className="h-6 w-6" />}
      />

      <StatStrip
        tiles={[
          { label: 'Ouvertes', value: formatNumber(counts.open), icon: <InboxIcon className="h-5 w-5" />, tone: 'amber' },
          { label: 'Suppressions à traiter', value: formatNumber(counts.deletion), icon: <TrashIcon className="h-5 w-5" />, tone: 'brand' },
          { label: 'Affichées', value: formatNumber(requests.length), icon: <ClockIcon className="h-5 w-5" />, tone: 'violet' },
          { label: 'Résolues', value: formatNumber(requests.filter((r) => r.status === 'resolved').length), icon: <CheckIcon className="h-5 w-5" />, tone: 'green' },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterTabs options={STATUS_TABS} value={statusFilter} onChange={setStatusFilter} />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | RequestType)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">Tous les types</option>
          <option value="help">Aide</option>
          <option value="account_deletion">Suppression de compte</option>
        </select>
        {flash && <span className="text-sm text-emerald-700">{flash}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white">
          {loading ? (
            <LoadingBlock />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : requests.length === 0 ? (
            <EmptyState title="Aucune demande" hint="Les nouvelles demandes apparaîtront ici automatiquement." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selectedId === r.id ? 'bg-slate-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">
                        {r.request_type === 'account_deletion' ? 'Suppression de compte' : r.subject || 'Demande d\'aide'}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500">{r.email}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{formatDate(r.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          {!selected ? (
            <EmptyState title="Sélectionnez une demande" hint="Le détail et les actions apparaîtront ici." />
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {selected.request_type === 'account_deletion' ? 'Suppression de compte' : 'Aide'}
                </p>
                <h2 className="text-lg font-semibold text-slate-800">{selected.subject || 'Sans sujet'}</h2>
                <p className="text-sm text-slate-600">
                  {selected.full_name ? `${selected.full_name} · ` : ''}
                  <a className="text-brand underline" href={`mailto:${selected.email}`}>{selected.email}</a>
                </p>
                <p className="text-xs text-slate-400">Reçue le {formatDate(selected.created_at)}</p>
              </div>

              <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selected.message}</div>

              {selected.request_type === 'account_deletion' && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Vérifiez l'identité du demandeur, supprimez le compte dans Supabase Auth puis passez la demande à « Résolue ».
                </p>
              )}

              <div>
                <label className="text-sm font-medium text-slate-700">Statut</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {NEXT_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={saving || selected.status === s}
                      onClick={() => void updateRequest({ status: s })}
                      className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${
                        selected.status === s ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="support-notes" className="text-sm font-medium text-slate-700">Notes internes</label>
                <textarea
                  id="support-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
                />
                <button
                  type="button"
                  disabled={saving || notes === (selected.admin_notes ?? '')}
                  onClick={() => void updateRequest({ admin_notes: notes.trim() || null })}
                  className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">
                  Enregistrer les notes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
