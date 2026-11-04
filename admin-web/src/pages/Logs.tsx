import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ClockIcon } from '../components/icons';
import { Card, EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader } from '../components/ui';
import { formatDateTime, formatNumber } from '../utils/format';

type ActorRole = 'client' | 'artisan' | 'admin' | 'system';

interface ActivityLog {
  id: string;
  actor_id: string | null;
  actor_role: ActorRole | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const ROLE_TABS = [
  { value: '', label: 'Tous' },
  { value: 'client', label: 'Clients' },
  { value: 'artisan', label: 'Artisans' },
  { value: 'admin', label: 'Admin' },
  { value: 'system', label: 'Système' },
];

const ROLE_LABEL: Record<ActorRole, string> = {
  client: 'Client',
  artisan: 'Artisan',
  admin: 'Admin',
  system: 'Système',
};

const ROLE_TONE: Record<ActorRole, string> = {
  client: 'bg-blue-100 text-blue-800',
  artisan: 'bg-emerald-100 text-emerald-800',
  admin: 'bg-violet-100 text-violet-800',
  system: 'bg-slate-200 text-slate-700',
};

const ACTION_LABEL: Record<string, string> = {
  'account.created': 'Compte créé',
  'profile.updated': 'Profil modifié',
  'profile.role_changed': 'Rôle modifié',
  'quote.created': 'Demande de devis créée',
  'quote.status_changed': 'Statut de devis modifié',
  'chat.message_sent': 'Message envoyé',
  'chat.admin_message_sent': 'Réponse admin envoyée',
  'employer_request.approved': 'Demande employeur approuvée',
  'employer_request.rejected': 'Demande employeur rejetée',
  'employer_request.pending': 'Demande employeur remise en attente',
  'legal.saved': 'Document légal enregistré',
  'legal.reset': 'Document légal réinitialisé',
  'settings.updated': 'Paramètres modifiés',
  'campaign.sent': 'Campagne email envoyée',
};

const describeAction = (action: string): string => ACTION_LABEL[action] ?? action;

const MAX_ROWS = 300;

export default function Logs() {
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let query = supabase
      .from('activity_logs')
      .select('id, actor_id, actor_role, actor_name, action, entity_type, entity_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (roleFilter) query = query.eq('actor_role', roleFilter);
    const { data, error: err } = await query;
    if (err) setError('Impossible de charger le journal.');
    else setLogs((data ?? []) as ActivityLog[]);
    setLoading(false);
  }, [roleFilter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Temps réel : chaque nouvelle action apparaît immédiatement en tête du journal.
  useEffect(() => {
    const channel = supabase
      .channel('activity-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_logs' },
        (payload) => {
          const row = payload.new as ActivityLog;
          if (roleFilter && row.actor_role !== roleFilter) return;
          setLogs((prev) => [row, ...prev].slice(0, MAX_ROWS));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roleFilter]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) =>
      [l.actor_name, l.action, describeAction(l.action), l.entity_type, l.entity_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [logs, search]);

  return (
    <div>
      <PageHeader
        title="Logs"
        subtitle="Actions des admins, artisans et clients, en temps réel"
        icon={<ClockIcon className="h-6 w-6" />}
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <FilterTabs options={ROLE_TABS} value={roleFilter} onChange={setRoleFilter} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un nom ou une action…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:w-72"
        />
      </div>

      <Card>
        <p className="mb-3 text-xs text-slate-500">
          {formatNumber(visible.length)} entrée(s) affichée(s) sur les {formatNumber(MAX_ROWS)} dernières
        </p>
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : visible.length === 0 ? (
          <EmptyState title="Aucune action" hint="Les actions apparaîtront ici automatiquement." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((log) => {
              const role = log.actor_role ?? 'system';
              const meta = log.metadata ?? {};
              const detail = Object.entries(meta)
                .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · ');
              return (
                <li key={log.id} className="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-4">
                  <time className="shrink-0 text-xs text-slate-500 md:w-40">{formatDateTime(log.created_at)}</time>
                  <span className={`inline-flex w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_TONE[role]}`}>
                    {ROLE_LABEL[role]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900">
                      <span className="font-medium">{log.actor_name ?? 'Utilisateur inconnu'}</span>{' '}
                      <span className="text-slate-700">{describeAction(log.action)}</span>
                    </p>
                    {(log.entity_type || detail) && (
                      <p className="truncate text-xs text-slate-500">
                        {log.entity_type ? `${log.entity_type}${log.entity_id ? ` #${log.entity_id.slice(0, 8)}` : ''}` : ''}
                        {detail ? ` — ${detail}` : ''}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
