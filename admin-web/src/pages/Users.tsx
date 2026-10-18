import { useCallback, useEffect, useState } from 'react';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { SearchIcon } from '../components/icons';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { Paginated, Profile } from '../types';
import { formatDate, initials } from '../utils/format';

const ROLE_OPTIONS = [
  { value: '', label: 'Tous les rôles' },
  { value: 'client', label: 'Clients' },
  { value: 'artisan', label: 'Artisans' },
  { value: 'admin', label: 'Admins' },
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
        subtitle="Tous les comptes de la plateforme (clients, artisans, admins)"
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou adresse…"
            aria-label="Rechercher un utilisateur"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pr-3 pl-9 text-sm text-ink placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrer par rôle"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
              <thead className="bg-gray-50/70 text-left text-xs font-semibold tracking-wide text-muted uppercase">
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
                  <tr key={profile.id} className="transition hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-dark">
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
                    <td className="px-4 py-3 text-muted">
                      {profile.role === 'artisan'
                        ? profile.is_available
                          ? 'Disponible'
                          : 'Indisponible'
                        : '—'}
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