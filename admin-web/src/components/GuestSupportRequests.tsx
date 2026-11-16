import { useCallback, useEffect, useState } from 'react';
import { AdminService, apiErrorMessage, type SupportRequest } from '../lib/api';
import { formatDateTime } from '../utils/format';

export default function GuestSupportRequests() {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await AdminService.getSupportRequests();
      setRequests(data.data);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Impossible de charger les demandes du centre d’aide.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (request: SupportRequest) => {
    if (busyId) return;
    setBusyId(request.id);
    setError(null);
    try {
      await AdminService.updateSupportRequestStatus(request.id, {
        status: request.status === 'pending' ? 'resolved' : 'pending',
      });
      await load();
    } catch (updateError) {
      setError(apiErrorMessage(updateError, 'Impossible de mettre à jour cette demande.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">Demandes du centre d’aide</h2>
          <p className="text-xs text-muted">Messages envoyés sans connexion à un compte.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          Actualiser
        </button>
      </div>
      {error ? <p role="alert" className="mb-3 text-sm text-red-700">{error}</p> : null}
      {loading ? (
        <p className="py-4 text-sm text-muted">Chargement des demandes…</p>
      ) : requests.length === 0 ? (
        <p className="py-4 text-sm text-muted">Aucune demande pour le moment.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {requests.map((request) => (
            <article key={request.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{request.full_name}</p>
                  <a href={`mailto:${request.email}`} className="break-all text-xs text-brand underline">
                    {request.email}
                  </a>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${request.status === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                  {request.status === 'pending' ? 'À traiter' : 'Traitée'}
                </span>
              </div>
              <p className="my-2 whitespace-pre-wrap break-words text-sm text-ink">{request.message}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2">
                <time className="text-[11px] text-muted">{formatDateTime(request.submitted_at)}</time>
                <button
                  type="button"
                  onClick={() => void updateStatus(request)}
                  disabled={busyId !== null}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busyId === request.id
                    ? 'Enregistrement…'
                    : request.status === 'pending'
                      ? 'Marquer comme traitée'
                      : 'Rouvrir'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
