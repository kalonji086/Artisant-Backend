import { useCallback, useEffect, useState } from 'react';
import DecisionModal from '../components/DecisionModal';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { CheckIcon, CloseIcon } from '../components/icons';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { EmployerRequest, Paginated } from '../types';
import { formatDate } from '../utils/format';

const TABS = [
  { value: '', label: 'Toutes' },
  { value: 'pending', label: 'En attente' },
  { value: 'approved', label: 'Approuvées' },
  { value: 'rejected', label: 'Rejetées' },
];

const EMPTY_PAGE: Paginated<EmployerRequest> = {
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

type Flash = { tone: 'ok' | 'error'; message: string } | null;
type DecisionTarget = { request: EmployerRequest; tone: 'approve' | 'reject' };

export default function EmployerRequests() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<EmployerRequest>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionTarget | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AdminService.getEmployerRequests({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
      });
      setResult(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les demandes employeur.'));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

  const confirmDecision = async (notes: string) => {
    if (!decision) return;
    setDecisionLoading(true);
    setDecisionError(null);
    try {
      const approved = decision.tone === 'approve';
      await AdminService.updateEmployerRequest(decision.request.id, {
        status: approved ? 'approved' : 'rejected',
        ...(notes ? { admin_notes: notes } : {}),
      });
      setFlash({
        tone: 'ok',
        message: approved
          ? `Demande de « ${decision.request.company_name} » approuvée — profil employeur activé.`
          : `Demande de « ${decision.request.company_name} » rejetée.`,
      });
      setDecisionError(null);
      setDecision(null);
      await load();
    } catch (err) {
      setDecisionError(apiErrorMessage(err, 'Mise à jour impossible.'));
    } finally {
      setDecisionLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Demandes employeur"
        subtitle="Validez les entreprises souhaitant publier des offres d'emploi"
      />

      {/* Onglets de filtre */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={[
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              status === tab.value
                ? 'bg-brand text-white shadow-sm shadow-brand/30'
                : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {flash ? (
        <div
          role="status"
          className={[
            'mb-4 rounded-xl px-4 py-3 text-sm font-medium',
            flash.tone === 'ok'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-rose-200 bg-rose-50 text-rose-800',
          ].join(' ')}
        >
          {flash.message}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label="Chargement des demandes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : result.data.length === 0 ? (
        <EmptyState
          title="Aucune demande dans cette catégorie"
          hint="Les nouvelles demandes d'entreprise apparaîtront ici."
        />
      ) : (
        <div className="space-y-3">
          {result.data.map((request) => (
            <div
              key={request.id}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">{request.company_name}</h3>
                    <StatusBadge value={request.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {request.industry} · contact : {request.contact_person} ({request.company_email}){' '}
                    · demandée le {formatDate(request.created_at)}
                  </p>
                  {request.hiring_needs ? (
                    <p className="mt-2 max-w-3xl text-sm text-gray-700">
                      <span className="font-medium text-ink">Besoin :</span> {request.hiring_needs}
                      {request.expected_hires ? ` (${request.expected_hires} embauche(s) prévue(s))` : ''}
                    </p>
                  ) : null}
                  {request.admin_notes ? (
                    <p className="mt-2 max-w-3xl rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <span className="font-semibold">Note admin :</span> {request.admin_notes}
                    </p>
                  ) : null}
                </div>

                {request.status === 'pending' ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionError(null);
                        setDecision({ request, tone: 'approve' });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <CheckIcon className="h-4 w-4" />
                      Approuver
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionError(null);
                        setDecision({ request, tone: 'reject' });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <CloseIcon className="h-4 w-4" />
                      Rejeter
                    </button>
                  </div>
                ) : request.approved_at ? (
                  <p className="shrink-0 text-xs text-muted">
                    Traitée le {formatDate(request.approved_at)}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error ? (
        <Pagination pagination={result.pagination} onPage={setPage} />
      ) : null}

      <DecisionModal
        open={decision !== null}
        tone={decision?.tone ?? 'approve'}
        title={decision?.tone === 'approve' ? 'Approuver la demande ?' : 'Rejeter la demande ?'}
        subtitle={
          decision ? `${decision.request.company_name} — ${decision.request.industry}` : undefined
        }
        error={decisionError}
        confirmLabel={decision?.tone === 'approve' ? 'Approuver' : 'Rejeter'}
        loading={decisionLoading}
        onClose={() => {
          setDecision(null);
          setDecisionError(null);
        }}
        onConfirm={(notes) => void confirmDecision(notes)}
      />
    </div>
  );
}