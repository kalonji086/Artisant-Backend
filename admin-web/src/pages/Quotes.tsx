import { useCallback, useEffect, useState } from 'react';
import AssignPanel, { type AssignTarget } from '../components/AssignPanel';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader, StatStrip } from '../components/ui';
import { CheckIcon, ClockIcon, DocumentIcon, InboxIcon } from '../components/icons';
import { AdminService, apiErrorMessage } from '../lib/api';
import { useStats } from '../lib/useStats';
import type { Paginated, Quote } from '../types';
import { formatDate, formatNumber, formatPrice } from '../utils/format';
import QuoteTemplates from './QuoteTemplates';

const STATUS_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'unassigned', label: 'À assigner' },
  { value: 'assigned', label: 'Assignés' },
  { value: 'pending', label: 'En attente' },
  { value: 'accepted', label: 'Acceptés' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'rejected', label: 'Rejetés' },
  { value: 'completed', label: 'Terminés' },
  { value: 'quote_sent', label: 'Devis envoyés' },
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
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [editingTemplates, setEditingTemplates] = useState(false);
  const stats = useStats();
  const countOf = (s: string) => stats?.quotesByStatus.find((q) => q.status === s)?.count ?? 0;
  const dash = (n: number) => (stats ? formatNumber(n) : '—');

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
      {editingTemplates ? (
        <QuoteTemplates onClose={() => setEditingTemplates(false)} />
      ) : (
      <>
      <PageHeader
        title="Devis"
        subtitle="Toutes les demandes de devis de la plateforme"
        icon={<DocumentIcon className="h-6 w-6" />}
      />
      <div className="mb-4 flex justify-end">
        <button type="button" onClick={() => setEditingTemplates(true)} className="rounded-lg border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-light">
          Gérer les modèles
        </button>
      </div>

      <StatStrip
        tiles={[
          { label: 'Total devis', value: dash(stats?.totals.quotes ?? 0), icon: <DocumentIcon className="h-5 w-5" />, tone: 'brand' },
          { label: 'À assigner', value: dash(countOf('unassigned')), icon: <InboxIcon className="h-5 w-5" />, tone: 'amber' },
          { label: 'En attente', value: dash(stats?.totals.quotesPending ?? 0), icon: <ClockIcon className="h-5 w-5" />, tone: 'violet' },
          { label: 'Acceptés', value: dash(countOf('accepted')), icon: <CheckIcon className="h-5 w-5" />, tone: 'green' },
        ]}
      />

      <div className="mb-4">
        <FilterTabs
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </div>

      {assignTarget ? (
        <div className="mb-4 max-w-2xl">
          <AssignPanel
            key={assignTarget.id}
            target={assignTarget}
            onAssigned={() => {
              setAssignTarget(null);
              void load();
            }}
            onClose={() => setAssignTarget(null)}
          />
        </div>
      ) : null}

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
              <thead className="bg-gradient-to-r from-brand-light/70 to-gray-50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Réf.</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Artisan</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Prix</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Créé le</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.data.map((quote) => (
                  <tr key={quote.id} className="transition hover:bg-brand-light/40">
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {quote.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{quote.client_name}</td>
                    <td className="px-4 py-3 text-ink">{quote.artisan_name}</td>
                    <td className="max-w-xs px-4 py-3 text-muted">
                      {(quote.category || quote.title) && (
                        <div className="truncate text-xs font-semibold text-ink">
                          {[quote.category, quote.title].filter(Boolean).join(' · ')}
                          {quote.urgency === 'urgent' ? ' · URGENT' : ''}
                        </div>
                      )}
                      <div className="truncate">{quote.description || '—'}</div>
                      {quote.address && <div className="truncate text-xs">📍 {quote.address}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-ink">
                      {quote.proposal_total != null && quote.proposal_currency
                        ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 }).format(Number(quote.proposal_total))} ${quote.proposal_currency}`
                        : formatPrice(quote.price)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={quote.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDate(quote.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {quote.status === 'unassigned' || quote.status === 'assigned' || quote.status === 'pending' || quote.status === 'rejected' ? (
                        <button
                          type="button"
                          onClick={() =>
                            setAssignTarget({
                              kind: 'quote',
                              id: quote.id,
                              label: `${quote.client_name ?? 'Client'} — ${quote.description || 'Sans description'}`,
                            })
                          }
                          className="rounded-lg bg-gradient-to-r from-brand to-sky-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
                        >
                          {quote.status === 'unassigned' ? 'Assigner' : 'Réassigner'}
                        </button>
                      ) : null}
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
      </>
      )}
    </div>
  );
}
