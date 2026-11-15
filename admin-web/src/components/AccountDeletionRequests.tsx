import { useCallback, useEffect, useState } from 'react';
import { AdminService, apiErrorMessage, type AccountDeletionRequest } from '../lib/api';

const STATUS_LABELS: Record<AccountDeletionRequest['status'], string> = {
  pending: 'À traiter',
  processing: 'En cours',
  completed: 'Terminée',
  rejected: 'Refusée',
};

export default function AccountDeletionRequests() {
  const [requests, setRequests] = useState<AccountDeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await AdminService.getAccountDeletionRequests();
      setRequests(data.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les demandes de suppression.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (request: AccountDeletionRequest, status: AccountDeletionRequest['status']) => {
    setBusyId(request.id);
    setError(null);
    try {
      const { data } = await AdminService.updateAccountDeletionRequest(request.id, { status });
      setRequests((current) => current.map((item) => item.id === request.id ? data.request : item));
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de mettre à jour la demande.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-ink">Demandes de suppression de compte</h2>
          <p className="mt-1 text-sm text-muted">Demandes transmises depuis l’application mobile</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-60"
        >
          Actualiser
        </button>
      </div>

      {error ? <p role="alert" className="px-5 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="px-5 py-5 text-sm text-muted">Chargement des demandes…</p>
      ) : requests.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">Aucune demande de suppression.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {requests.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{request.full_name || request.email}</p>
                <p className="truncate text-sm text-muted">{request.email}</p>
                <p className="mt-1 text-xs text-muted">
                  Reçue le {new Date(request.requested_at).toLocaleString('fr-FR')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                  {STATUS_LABELS[request.status]}
                </span>
                {request.status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => void updateStatus(request, 'processing')}
                    disabled={busyId === request.id}
                    className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {busyId === request.id ? 'Mise à jour…' : 'Prendre en charge'}
                  </button>
                ) : null}
                {request.status === 'processing' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void updateStatus(request, 'completed')}
                      disabled={busyId === request.id}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Terminer
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateStatus(request, 'rejected')}
                      disabled={busyId === request.id}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-ink disabled:opacity-60"
                    >
                      Refuser
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
