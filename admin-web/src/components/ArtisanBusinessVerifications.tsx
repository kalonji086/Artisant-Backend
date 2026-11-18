import { useCallback, useEffect, useState } from 'react';
import Pagination from './Pagination';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock } from './ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import { supabase } from '../lib/supabase';
import type {
  ArtisanBusinessModule,
  ArtisanBusinessVerification,
  ArtisanBusinessVerificationStatus,
  Paginated,
} from '../types';
import { formatDate } from '../utils/format';

const TABS = [
  { value: '', label: 'Toutes' },
  { value: 'pending', label: 'En attente' },
  { value: 'in_review', label: 'En examen' },
  { value: 'approved', label: 'Approuvées' },
  { value: 'rejected', label: 'Rejetées' },
  { value: 'revoked', label: 'Retirées' },
];

const EMPTY_PAGE: Paginated<ArtisanBusinessVerification> = {
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

const PROOF_LABELS = {
  registration: 'Preuve de création / immatriculation',
  tax: 'Preuve fiscale',
  representative_id: 'Identité du représentant',
  authorization: 'Mandat ou justificatif complémentaire',
} as const;

const BUSINESS_MODULE_OPTIONS: { value: ArtisanBusinessModule; label: string }[] = [
  { value: 'dashboard', label: 'Tableau de bord' },
  { value: 'jobs', label: 'Demandes' },
  { value: 'applications', label: 'Candidatures' },
  { value: 'artisans', label: 'Rechercher un artisan' },
  { value: 'projects', label: 'Projets' },
  { value: 'messages', label: 'Messages' },
  { value: 'contracts', label: 'Contrats' },
  { value: 'payments', label: 'Paiements' },
  { value: 'favorites', label: 'Favoris' },
  { value: 'reports', label: 'Rapports' },
  { value: 'team', label: 'Employés' },
  { value: 'profile', label: 'Profil entreprise' },
  { value: 'support', label: 'Assistance' },
];

const ALL_MODULES = BUSINESS_MODULE_OPTIONS.map(({ value }) => value);

const STATUS_LABELS: Record<ArtisanBusinessVerificationStatus, string> = {
  pending: 'En attente',
  in_review: 'En examen',
  approved: 'Approuvée',
  rejected: 'Rejetée',
  revoked: 'Retirée',
};

const STATUS_CLASSES: Record<ArtisanBusinessVerificationStatus, string> = {
  pending: 'bg-amber-50 text-amber-800',
  in_review: 'bg-blue-50 text-blue-800',
  approved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-rose-50 text-rose-800',
  revoked: 'bg-slate-100 text-slate-700',
};

type Flash = { tone: 'ok' | 'error'; message: string } | null;

export default function ArtisanBusinessVerifications() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedModules, setSelectedModules] = useState<Record<string, ArtisanBusinessModule[]>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await AdminService.getArtisanBusinessVerifications({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
      });
      setResult(response.data);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, 'Impossible de charger les demandes de vérification.'));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-artisan-business-verifications')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'artisan_business_verifications',
      }, () => void load())
      .subscribe((channelStatus) => {
        if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          console.warn('[admin] Synchronisation des demandes entreprise indisponible:', channelStatus);
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const decide = async (
    request: ArtisanBusinessVerification,
    nextStatus: ArtisanBusinessVerificationStatus
  ) => {
    const reviewNote = (notes[request.id] ?? '').trim();
    if (nextStatus === 'rejected' && reviewNote.length < 5) {
      setFlash({ tone: 'error', message: 'Saisissez une raison de rejet d’au moins 5 caractères.' });
      return;
    }
    if (nextStatus === 'revoked' && !window.confirm(`Retirer le statut entreprise de ${request.company_name} ? Tous ses modules entreprise seront désactivés.`)) {
      return;
    }
    const modules = nextStatus === 'rejected' || nextStatus === 'revoked'
      ? []
      : selectedModules[request.id] ?? (request.assigned_modules.length ? request.assigned_modules : ALL_MODULES);
    if (nextStatus === 'approved' && modules.length === 0) {
      setFlash({ tone: 'error', message: 'Attribuez au moins un module avant l’approbation.' });
      return;
    }
    setBusyId(request.id);
    setFlash(null);
    try {
      await AdminService.reviewArtisanBusinessVerification(request.id, {
        status: nextStatus,
        ...(reviewNote ? { review_note: reviewNote } : {}),
        modules,
      });
      setFlash({
        tone: 'ok',
        message: nextStatus === 'revoked'
          ? `Statut entreprise retiré pour ${request.company_name}.`
          : nextStatus === 'approved'
            ? `Demande de ${request.company_name} approuvée avec ${modules.length} module(s).`
            : `Demande de ${request.company_name} : ${STATUS_LABELS[nextStatus].toLowerCase()}.`,
      });
      await load();
    } catch (decisionError) {
      setFlash({ tone: 'error', message: apiErrorMessage(decisionError, 'La décision n’a pas pu être enregistrée.') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Vérification des artisans</h2>
          <p className="text-xs text-muted">Consultez les justificatifs privés et mettez à jour leur statut en direct.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">
          Actualiser
        </button>
      </div>

      <div className="mb-4">
        <FilterTabs
          options={TABS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>

      {flash ? (
        <p role={flash.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-sm ${flash.tone === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {flash.message}
        </p>
      ) : null}
      {loading ? (
        <LoadingBlock label="Chargement des dossiers…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => {
          setLoading(true);
          void load();
        }} />
      ) : result.data.length === 0 ? (
        <EmptyState title="Aucune demande dans cette catégorie" hint="Les demandes de statut artisan apparaîtront ici." />
      ) : (
        <div className="space-y-4">
          {result.data.map((request) => (
            <article key={request.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ink">{request.company_name}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {request.business_type === 'enterprise' ? 'Entreprise' : 'Sous-traitance'} · {request.country} · envoyée le {formatDate(request.created_at)}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[request.status]}`}>
                  {STATUS_LABELS[request.status]}
                </span>
              </div>

              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted">Immatriculation</dt><dd className="break-all text-ink">{request.registration_number}</dd></div>
                <div><dt className="text-xs text-muted">Identifiant fiscal</dt><dd className="break-all text-ink">{request.tax_number}</dd></div>
                <div><dt className="text-xs text-muted">Adresse</dt><dd className="text-ink">{request.company_address}</dd></div>
                <div><dt className="text-xs text-muted">Représentant</dt><dd className="text-ink">{request.contact_person} · {request.contact_email} · {request.contact_phone}</dd></div>
              </dl>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(Object.keys(PROOF_LABELS) as (keyof typeof PROOF_LABELS)[]).map((proofType) => (
                  <a
                    key={proofType}
                    href={request.documents[proofType].signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-brand underline">
                    {PROOF_LABELS[proofType]}
                  </a>
                ))}
              </div>

              <fieldset className="mt-4 rounded-lg border border-gray-200 p-3">
                <legend className="px-1 text-xs font-semibold text-ink">Modules entreprise à attribuer</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {BUSINESS_MODULE_OPTIONS.map((module) => {
                    const checked = (selectedModules[request.id]
                      ?? (request.assigned_modules.length ? request.assigned_modules : ALL_MODULES))
                      .includes(module.value);
                    return (
                      <label key={module.value} className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busyId === request.id}
                          onChange={(event) => {
                            const enabled = event.currentTarget.checked;
                            setSelectedModules((current) => {
                              const selected = current[request.id]
                                ?? (request.assigned_modules.length ? request.assigned_modules : ALL_MODULES);
                              return {
                                ...current,
                                [request.id]: enabled
                                  ? [...selected, module.value]
                                  : selected.filter((item) => item !== module.value),
                              };
                            });
                          }}
                        />
                        {module.label}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Les modifications prennent effet immédiatement après l’enregistrement.
                </p>
              </fieldset>

              {request.review_note ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="font-semibold">Note :</span> {request.review_note}
                </p>
              ) : null}

              <label className="mt-4 block text-xs font-semibold text-ink" htmlFor={`business-review-${request.id}`}>
                Note de suivi / raison de rejet
              </label>
              <textarea
                id={`business-review-${request.id}`}
                value={notes[request.id] ?? ''}
                onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                maxLength={1000}
                rows={2}
                placeholder="Obligatoire pour rejeter la demande"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {request.status === 'approved' ? (
                  <>
                    <button type="button" onClick={() => void decide(request, 'approved')} disabled={busyId !== null} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      Enregistrer les modules
                    </button>
                    <button type="button" onClick={() => void decide(request, 'revoked')} disabled={busyId !== null} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      Retirer le statut entreprise
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => void decide(request, 'in_review')} disabled={busyId !== null} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-800 disabled:opacity-50">
                      Mettre en examen
                    </button>
                    <button type="button" onClick={() => void decide(request, 'pending')} disabled={busyId !== null} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">
                      Laisser en attente
                    </button>
                    <button type="button" onClick={() => void decide(request, 'approved')} disabled={busyId !== null} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      Approuver
                    </button>
                    <button type="button" onClick={() => void decide(request, 'rejected')} disabled={busyId !== null} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      Rejeter
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!loading && !error ? <Pagination pagination={result.pagination} onPage={setPage} /> : null}
    </section>
  );
}
