import { useCallback, useEffect, useState } from 'react';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { Paginated, Quote } from '../types';
import { formatDate, formatPrice } from '../utils/format';

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'pending', label: 'En attente' },
  { value: 'accepted', label: 'Acceptés' },
  { value: 'rejected', label: 'Rejetés' },
  { value: 'completed', label: 'Terminés' },
];

const EMPTY_PAGE: Paginated<Quote> = {
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

export default function Quotes() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Quote>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AdminService.getQuotes({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
      });
      setResult(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les devis.'));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Devis"
        subtitle="Toutes les demandes de devis de la plateforme"
        actions={
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrer par statut"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        }
      />

      {loading ? (
        <LoadingBlock label="Chargement des devis…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : result.data.length === 0 ? (
        <EmptyState
          title="Aucun devis trouvé"
          hint="Changez le filtre de statut ou attendez de nouvelles demandes."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50/70 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Réf.</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Artisan</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Prix</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Créé le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.data.map((quote) => (
                  <tr key={quote.id} className="transition hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {quote.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{quote.client_name}</td>
                    <td className="px-4 py-3 text-ink">{quote.artisan_name}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted">
                      {quote.description || '—'}
                    </td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-ink">
                      {formatPrice(quote.price)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={quote.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(quote.created_at)}
                    </td>
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
