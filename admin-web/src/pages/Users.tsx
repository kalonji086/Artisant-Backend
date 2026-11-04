import { useCallback, useEffect, useState } from 'react';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { SearchIcon, ToolIcon, TrendIcon, UsersIcon } from '../components/icons';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader, StatStrip } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import { useStats } from '../lib/useStats';
import { supabase } from '../lib/supabase';
import type { Paginated, Profile } from '../types';
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

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
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

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou adresse…"
            aria-label="Rechercher un utilisateur"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pr-3 pl-9 text-sm text-ink shadow-sm placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gradient-to-r from-brand-light/70 to-gray-50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Utilisateur</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Rôle</th>
                  <th className="px-4 py-3">Métier</th>
                  <th className="px-4 py-3">Disponibilité</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">Téléphone</th>
                  <th className="px-4 py-3">Inscrit le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.data.map((profile) => (
                  <tr
                    key={profile.id}
                    onClick={() => setSelectedId(profile.id)}
                    className="cursor-pointer transition hover:bg-brand-light/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-sky-400 text-xs font-bold text-white shadow-sm">
                          {initials(profile.full_name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {profile.full_name ?? 'Sans nom'}
                          </p>
                          <p className="truncate text-xs text-muted">{profile.address ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{profile.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={profile.role ?? 'client'} />
                    </td>
                    <td className="px-4 py-3 text-muted">{profile.role === 'artisan' ? (profile.profession ?? '—') : '—'}</td>
                    <td className="px-4 py-3">
                      {profile.role === 'artisan' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                          <span className={`h-2 w-2 rounded-full ${profile.is_available ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          {profile.is_available ? 'Disponible' : 'Indisponible'}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {profile.rating !== null ? `${Number(profile.rating).toFixed(1)} ★` : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted">{profile.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(profile.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error ? (
        <Pagination pagination={result.pagination} onPage={setPage} />
      ) : null}

      {selected ? <UserDetails profile={selected} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

const GENDER_LABELS: Record<string, string> = { homme: 'Homme', femme: 'Femme', autre: 'Autre' };

function UserDetails({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const isArtisan = profile.role === 'artisan';
  const rows: [string, string][] = [
    ['Email', profile.email ?? '—'],
    ['Téléphone', profile.phone ?? '—'],
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Détails de l'utilisateur"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand to-sky-400 font-bold text-white">
              {initials(profile.full_name)}
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">{profile.full_name ?? 'Sans nom'}</h2>
              <StatusBadge value={profile.role ?? 'client'} />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            ✕
          </button>
        </div>
        <dl className="divide-y divide-gray-100 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-3">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-medium break-words text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}