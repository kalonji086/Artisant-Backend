import { useCallback, useEffect, useState } from 'react';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import AccountDeletionRequests from '../components/AccountDeletionRequests';
import { SearchIcon, ToolIcon, TrendIcon, UsersIcon } from '../components/icons';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader, StatStrip } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import { useStats } from '../lib/useStats';
import { supabase } from '../lib/supabase';
import type { Paginated, Profile, ProfileRole } from '../types';
import { formatDate, formatDateTime, formatNumber, initials } from '../utils/format';

const ROLE_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'client', label: 'Clients' },
  { value: 'artisan', label: 'Artisans' },
];

const EMPTY_PAGE: Paginated<Profile> = {
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

export default function Users() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Profile>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const stats = useStats();

  // Debounce de la recherche (400 ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await AdminService.getUsers({
        page,
        pageSize: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(role ? { role } : {}),
      });
      setResult(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les utilisateurs.'));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, role]);

  useEffect(() => {
    void load();
  }, [load]);

  // Suivi en direct : toute inscription ou modification de profil rafraîchit la liste sans recharger la page.
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), 500);
    };
    const channel = supabase
      .channel('users-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_details' }, refresh)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const selected = result.data.find((p) => p.id === selectedId) ?? null;

  const updateBlockedStatus = async (profile: Profile, blocked: boolean) => {
    if (
      blocked
      && !window.confirm(`Bloquer le compte de ${profile.full_name ?? 'cet utilisateur'} ?`)
    ) return null;

    setBlockingId(profile.id);
    try {
      return await AdminService.updateUserBlockedStatus(profile.id, blocked);
    } finally {
      setBlockingId(null);
    }
  };

  const handleListToggle = async (profile: Profile, blocked: boolean) => {
    setActionNotice(null);
    try {
      const response = await updateBlockedStatus(profile, blocked);
      if (!response) return;
      await load(true);
      if (!response.realtime) {
        setActionNotice({ type: 'error', message: 'Compte modifié, mais la mise à jour en temps réel n’a pas pu être signalée.' });
      } else if (response.notificationSent === false) {
        setActionNotice({ type: 'error', message: 'Compte bloqué, mais la notification par e-mail n’a pas pu être envoyée.' });
      } else {
        setActionNotice({
          type: 'success',
          message: blocked ? 'Compte bloqué.' : 'Compte débloqué.',
        });
      }
    } catch (err) {
      setActionNotice({ type: 'error', message: apiErrorMessage(err, 'Impossible de modifier cet utilisateur.') });
    }
  };

  return (
    <div>
      <PageHeader
        title="Gestion des utilisateurs"
        subtitle="Comptes clients et artisans de la plateforme"
        icon={<UsersIcon className="h-6 w-6" />}
      />

      <StatStrip
        tiles={[
          { label: 'Utilisateurs', value: stats ? formatNumber(stats.totals.users) : '—', icon: <UsersIcon className="h-5 w-5" />, tone: 'brand' },
          { label: 'Artisans', value: stats ? formatNumber(stats.totals.artisans) : '—', icon: <ToolIcon className="h-5 w-5" />, tone: 'green' },
          { label: 'Disponibles', value: stats ? formatNumber(stats.totals.activeArtisans) : '—', icon: <TrendIcon className="h-5 w-5" />, tone: 'amber' },
          { label: 'Clients', value: stats ? formatNumber(stats.totals.clients) : '—', icon: <UsersIcon className="h-5 w-5" />, tone: 'sky' },
        ]}
      />

      <AccountDeletionRequests />

      <section className="mb-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5" aria-label="Rechercher et filtrer les utilisateurs">
        <div className="mb-4">
          <h2 className="text-sm font-bold text-ink">Répertoire des comptes</h2>
          <p className="mt-1 text-xs text-muted">{formatNumber(result.pagination.total)} compte(s) correspondent aux filtres.</p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, e-mail, téléphone ou ville…"
              aria-label="Rechercher un utilisateur"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-3 pl-9 text-sm text-ink shadow-sm placeholder:text-gray-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <FilterTabs
            options={ROLE_OPTIONS}
            value={role}
            onChange={(v) => {
              setRole(v);
              setPage(1);
            }}
          />
        </div>
      </section>

      {actionNotice ? (
        <p
          role={actionNotice.type === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${actionNotice.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}
        >
          {actionNotice.message}
        </p>
      ) : null}

      {loading ? (
        <LoadingBlock label="Chargement des utilisateurs…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : result.data.length === 0 ? (
        <EmptyState
          title="Aucun utilisateur trouvé"
          hint="Essayez une autre recherche ou changez le filtre de rôle."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {result.data.map((profile) => (
            <article key={profile.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-brand/30 hover:shadow-md sm:p-5">
              <div className="flex items-start gap-3">
                <UserAvatar profile={profile} />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setSelectedId(profile.id)}
                    className="truncate text-left text-base font-bold text-ink hover:text-brand"
                  >
                    {profile.full_name ?? 'Sans nom'}
                  </button>
                  <p className="mt-0.5 truncate text-xs text-muted">{profile.email ?? profile.phone ?? 'Coordonnées non renseignées'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge value={profile.role ?? 'client'} />
                    {profile.role === 'artisan' && profile.business_type ? (
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                        {profile.business_type === 'enterprise' ? 'Entreprise' : 'Sous-traitance'}
                      </span>
                    ) : null}
                    {profile.role === 'artisan' ? (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${profile.is_available ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${profile.is_available ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        {profile.is_available ? 'Disponible' : 'Indisponible'}
                      </span>
                    ) : null}
                  </div>
                </div>
                {profile.rating !== null ? (
                  <span className="shrink-0 rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{Number(profile.rating).toFixed(1)} ★</span>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3 text-xs sm:grid-cols-3">
                <div className="min-w-0">
                  <p className="text-muted">Métier</p>
                  <p className="mt-1 truncate font-semibold text-ink">{profile.role === 'artisan' ? profile.profession ?? 'Non renseigné' : 'Client'}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted">Ville</p>
                  <p className="mt-1 truncate font-semibold text-ink">{profile.city ?? 'Non renseignée'}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted">Inscription</p>
                  <p className="mt-1 truncate font-semibold text-ink">{formatDate(profile.created_at)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <AccountSwitch
                  checked={!profile.is_blocked}
                  disabled={blockingId !== null}
                  label={`Accès au compte de ${profile.full_name ?? 'cet utilisateur'}`}
                  onChange={(active) => void handleListToggle(profile, !active)}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(profile.id)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
                >
                  Voir le profil
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {!loading && !error ? (
        <Pagination pagination={result.pagination} onPage={setPage} />
      ) : null}

      {selected ? (
        <UserDetails
          key={`${selected.id}-${selected.role}`}
          profile={selected}
          onClose={() => setSelectedId(null)}
          onRefresh={() => load(true)}
          onToggleBlocked={(blocked) => updateBlockedStatus(selected, blocked)}
          onDeleted={async () => {
            setSelectedId(null);
            await load(true);
          }}
        />
      ) : null}
    </div>
  );
}

const GENDER_LABELS: Record<string, string> = { homme: 'Homme', femme: 'Femme', autre: 'Autre' };

function UserAvatar({ profile, large = false }: { profile: Profile; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = large ? 'h-12 w-12 text-sm' : 'h-10 w-10 text-xs';

  return (
    <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand to-sky-400 font-bold text-white shadow-sm`}>
      {profile.avatar_url && !failed ? (
        <img
          src={profile.avatar_url}
          alt={`Photo de ${profile.full_name ?? 'l’utilisateur'}`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(profile.full_name)
      )}
    </span>
  );
}

function AccountSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div>
        <p className="text-xs font-semibold text-ink">Accès au compte</p>
        <p className={`mt-0.5 text-xs font-medium ${checked ? 'text-emerald-700' : 'text-red-700'}`}>
          {checked ? 'Actif' : 'Bloqué'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-red-400'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function UserDetails({
  profile,
  onClose,
  onRefresh,
  onToggleBlocked,
  onDeleted,
}: {
  profile: Profile;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToggleBlocked: (blocked: boolean) => Promise<unknown>;
  onDeleted: () => Promise<void>;
}) {
  const [nextRole, setNextRole] = useState<ProfileRole>(profile.role === 'artisan' ? 'artisan' : 'client');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const isArtisan = profile.role === 'artisan';
  const rows: [string, string][] = [
    ['Email', profile.email ?? '—'],
    ['Téléphone', profile.phone ?? '—'],
    ['Statut du compte', profile.is_blocked ? 'Bloqué' : 'Actif'],
    ...(isArtisan
      ? ([
          ['Date de naissance', profile.birth_date ? formatDate(profile.birth_date) : '—'],
          ['Genre', profile.gender ? (GENDER_LABELS[profile.gender] ?? profile.gender) : '—'],
          ['Adresse', profile.address ?? '—'],
          ['Ville', profile.city ?? '—'],
          ['Pays', profile.country ?? '—'],
          ['Métier', profile.profession ?? '—'],
          ['Années d\'expérience', profile.years_experience != null ? String(profile.years_experience) : '—'],
          ['Rayon d\'intervention', profile.service_radius_km != null ? `${profile.service_radius_km} km` : '—'],
          ['Description', profile.description ?? '—'],
          ['Disponibilité', profile.is_available ? 'Disponible' : 'Indisponible'],
        ] as [string, string][])
      : ([['Ville', profile.city ?? '—']] as [string, string][])),
    ['Conditions acceptées', profile.terms_accepted_at ? `${formatDateTime(profile.terms_accepted_at)} (v${profile.terms_version ?? '?'})` : 'Non enregistré'],
    ['Inscrit le', formatDateTime(profile.created_at)],
  ];

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await action();
      if (result === null) return;
      await onRefresh();
      if (
        typeof result === 'object'
        && result !== null
        && 'realtime' in result
        && result.realtime === false
      ) {
        setActionError('Compte modifié, mais le signal temps réel n’a pas pu être envoyé. Actualisez les autres vues.');
        return;
      }
      if (
        typeof result === 'object'
        && result !== null
        && 'notificationSent' in result
        && result.notificationSent === false
      ) {
        setActionError('Compte bloqué, mais la notification par e-mail n’a pas pu être envoyée.');
        return;
      }
      setActionSuccess(successMessage);
    } catch (error) {
      setActionError(apiErrorMessage(error, 'Impossible de modifier cet utilisateur.'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Supprimer définitivement le compte de ${profile.full_name ?? 'cet utilisateur'} ?`)) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await AdminService.deleteUser(profile.id);
      await onDeleted();
    } catch (error) {
      setActionError(apiErrorMessage(error, 'Impossible de supprimer cet utilisateur.'));
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Détails de l'utilisateur"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-lg overflow-y-auto bg-gray-50 shadow-2xl"
      >
        <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-brand p-6 text-white">
          <div className="mb-6 flex justify-end">
            <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20">
              ✕
            </button>
          </div>
          <div className="flex items-center gap-4">
            <UserAvatar profile={profile} large />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold">{profile.full_name ?? 'Sans nom'}</h2>
              <p className="mt-1 truncate text-sm text-white/70">{profile.email ?? profile.phone ?? 'Coordonnées non renseignées'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge value={profile.role ?? 'client'} />
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${profile.is_blocked ? 'bg-red-400/20 text-red-100' : 'bg-emerald-400/20 text-emerald-100'}`}>
                  {profile.is_blocked ? 'Bloqué' : 'Actif'}
                </span>
                {profile.business_type ? (
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
                    {profile.business_type === 'enterprise' ? 'Entreprise' : 'Sous-traitance'}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-4 sm:p-6">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-label="Informations du compte">
            <h3 className="mb-2 text-sm font-bold text-ink">Informations du compte</h3>
            <dl className="divide-y divide-gray-100 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="text-right font-medium break-words text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-label="Gestion du compte">
            <h3 className="mb-4 text-sm font-bold text-ink">Gestion du compte</h3>
            <div className="mb-5 flex items-center justify-between gap-4 rounded-xl bg-gray-50 p-3">
              <div>
                <p className="text-sm font-semibold text-ink">Accès à la plateforme</p>
                <p className="mt-1 text-xs text-muted">Désactivez ou réactivez l’accès de cet utilisateur.</p>
              </div>
              <AccountSwitch
                checked={!profile.is_blocked}
                disabled={actionLoading}
                label={`Accès au compte de ${profile.full_name ?? 'cet utilisateur'}`}
                onChange={(active) => void runAction(
                  () => onToggleBlocked(!active),
                  active ? 'Compte débloqué.' : 'Compte bloqué.'
                )}
              />
            </div>
            <label className="mb-2 block text-xs font-medium text-muted" htmlFor="user-role">Rôle du compte</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id="user-role"
                value={nextRole}
                disabled={actionLoading}
                onChange={(event) => setNextRole(event.target.value === 'artisan' ? 'artisan' : 'client')}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-ink disabled:opacity-60"
              >
                <option value="client">Client</option>
                <option value="artisan">Artisan</option>
              </select>
              <button
                type="button"
                disabled={actionLoading || nextRole === profile.role}
                onClick={() => void runAction(
                  () => AdminService.updateUserRole(profile.id, nextRole),
                  'Rôle mis à jour.'
                )}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Enregistrer le rôle
              </button>
            </div>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleDelete()}
              className="mt-4 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Supprimer l’utilisateur
            </button>
            {actionError ? <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p> : null}
            {actionSuccess ? <p role="status" className="mt-3 text-sm text-emerald-700">{actionSuccess}</p> : null}
          </section>
        </div>
      </aside>
    </div>
  );
}