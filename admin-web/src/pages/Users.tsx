import { useCallback, useEffect, useState } from 'react';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { SearchIcon, ToolIcon, TrendIcon, UsersIcon } from '../components/icons';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader, StatStrip } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import { useStats } from '../lib/useStats';
import type { Paginated, Profile } from '../types';
import { formatDate, formatNumber, initials } from '../utils/format';

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

  const load = useCallback(async () => {
    setLoading(true);
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
                  <th className="px-4 py-3">Rôle</th>
                  <th className="px-4 py-3">Disponibilité</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">Téléphone</th>
                  <th className="px-4 py-3">Inscrit le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.data.map((profile) => (
                  <tr key={profile.id} className="transition hover:bg-brand-light/40">
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
                    <td className="px-4 py-3">
                      <StatusBadge value={profile.role ?? 'client'} />
                    </td>
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
    </div>
  );
}