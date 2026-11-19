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
    const modules = nextStatus === 'rejected' || nextStatus === 'revoked' ? [] : getSelectedModules(request);
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

  const getSelectedModules = (request: ArtisanBusinessVerification) =>
    selectedModules[request.id] ?? (request.assigned_modules.length ? request.assigned_modules : ALL_MODULES);

  const setModuleEnabled = (
    request: ArtisanBusinessVerification,
    module: ArtisanBusinessModule,
    enabled: boolean
  ) => {
    setSelectedModules((current) => {
      const selected = current[request.id]
        ?? (request.assigned_modules.length ? request.assigned_modules : ALL_MODULES);
      return {
        ...current,
        [request.id]: enabled
          ? Array.from(new Set([...selected, module]))
          : selected.filter((item) => item !== module),
      };
    });
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/70 shadow-sm">
      <header className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-5 py-6 text-white sm:px-7">
        <div className="pointer-events-none absolute -top-20 right-0 h-56 w-56 rounded-full bg-indigo-400/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-indigo-200 uppercase">Espace de contrôle</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Vérification des artisans</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              Examinez les preuves, gérez les accès entreprise et suivez les décisions en temps réel.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-2 backdrop-blur">
              <p className="text-[11px] font-medium text-slate-300">Dossiers affichés</p>
              <p className="text-lg font-bold">{result.pagination.total}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              disabled={loading}
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50">
              {loading ? 'Actualisation…' : 'Actualiser'}
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-5 p-4 sm:p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Filtrer les dossiers</p>
            <p className="text-xs text-slate-400">Mise à jour en temps réel</p>
          </div>
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
          <p role={flash.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm font-medium ${flash.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
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
          <div className="space-y-5">
            {result.data.map((request) => {
              const modules = getSelectedModules(request);
              const businessTone = request.business_type === 'enterprise'
                ? 'border-violet-200 bg-violet-50 text-violet-700'
                : 'border-cyan-200 bg-cyan-50 text-cyan-700';
              const statusTone = request.status === 'approved'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : request.status === 'rejected' || request.status === 'revoked'
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : request.status === 'in_review'
                    ? 'border-blue-200 bg-blue-50 text-blue-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800';

              return (
                <article key={request.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                  <div className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ring-1 ${request.business_type === 'enterprise' ? 'bg-violet-100 text-violet-700 ring-violet-200' : 'bg-cyan-100 text-cyan-700 ring-cyan-200'}`}>
                          {request.company_name.trim().slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-bold text-slate-900">{request.company_name}</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Reçue le {formatDate(request.created_at)} · {request.country}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${businessTone}`}>
                          {request.business_type === 'enterprise' ? 'Entreprise' : 'Sous-traitance'}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}>
                          {STATUS_LABELS[request.status]}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1.05fr_0.95fr]">
                    <div className="space-y-5">
                      <section>
                        <h4 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Informations légales</h4>
                        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <dt className="text-[11px] font-medium text-slate-500">Immatriculation</dt>
                            <dd className="mt-1 break-all text-sm font-semibold text-slate-800">{request.registration_number}</dd>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <dt className="text-[11px] font-medium text-slate-500">Identifiant fiscal</dt>
                            <dd className="mt-1 break-all text-sm font-semibold text-slate-800">{request.tax_number}</dd>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                            <dt className="text-[11px] font-medium text-slate-500">Adresse</dt>
                            <dd className="mt-1 text-sm font-semibold text-slate-800">{request.company_address}</dd>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                            <dt className="text-[11px] font-medium text-slate-500">Représentant</dt>
                            <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{request.contact_person}</dd>
                            <dd className="mt-1 break-all text-xs text-slate-500">{request.contact_email} · {request.contact_phone}</dd>
                          </div>
                        </dl>
                      </section>

                      <section>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h4 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Justificatifs</h4>
                          <span className="text-[11px] text-slate-400">Liens privés et temporaires</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(Object.keys(PROOF_LABELS) as (keyof typeof PROOF_LABELS)[]).map((proofType) => (
                            <a
                              key={proofType}
                              href={request.documents[proofType].signed_url}
                              target="_blank"
                              rel="noreferrer"
                              className="group flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:bg-brand-light/30 hover:text-brand">
                              <span>{PROOF_LABELS[proofType]}</span>
                              <span aria-hidden="true" className="text-lg text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand">↗</span>
                            </a>
                          ))}
                        </div>
                      </section>
                    </div>

                    <div className="space-y-4">
                      <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <legend className="px-2 text-sm font-bold text-slate-900">Accès aux modules</legend>
                        <div className="mb-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                          <span className="text-xs text-slate-500">Modules activés</span>
                          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                            {modules.length} / {BUSINESS_MODULE_OPTIONS.length}
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {BUSINESS_MODULE_OPTIONS.map((module) => {
                            const checked = modules.includes(module.value);
                            return (
                              <div key={module.value} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? 'border-emerald-100 bg-white' : 'border-slate-200 bg-slate-100/70'}`}>
                                <span className={`text-xs font-semibold ${checked ? 'text-slate-800' : 'text-slate-500'}`}>{module.label}</span>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={checked}
                                  aria-label={`${module.label} ${checked ? 'activé' : 'désactivé'}`}
                                  disabled={busyId === request.id}
                                  onClick={() => setModuleEnabled(request, module.value, !checked)}
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-1 ring-black/5 transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-slate-500">
                          Les changements sont enregistrés avec la décision ou via « Enregistrer les modules » pour un dossier déjà approuvé.
                        </p>
                      </fieldset>

                      {request.review_note ? (
                        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          <span className="font-semibold">Note précédente :</span> {request.review_note}
                        </p>
                      ) : null}

                      <div>
                        <label className="block text-xs font-bold text-slate-600" htmlFor={`business-review-${request.id}`}>
                          Note de suivi / raison de rejet
                        </label>
                        <textarea
                          id={`business-review-${request.id}`}
                          value={notes[request.id] ?? ''}
                          onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                          maxLength={1000}
                          rows={3}
                          placeholder="Obligatoire pour rejeter la demande"
                          className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/10"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                        {request.status === 'approved' ? (
                          <>
                            <button type="button" onClick={() => void decide(request, 'approved')} disabled={busyId !== null} className="rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50">
                              {busyId === request.id ? 'Enregistrement…' : 'Enregistrer les modules'}
                            </button>
                            <button type="button" onClick={() => void decide(request, 'revoked')} disabled={busyId !== null} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                              Retirer le statut
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => void decide(request, 'in_review')} disabled={busyId !== null} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-800 transition hover:bg-blue-100 disabled:opacity-50">
                              Mettre en examen
                            </button>
                            <button type="button" onClick={() => void decide(request, 'pending')} disabled={busyId !== null} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50">
                              Laisser en attente
                            </button>
                            <button type="button" onClick={() => void decide(request, 'approved')} disabled={busyId !== null} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
                              Approuver
                            </button>
                            <button type="button" onClick={() => void decide(request, 'rejected')} disabled={busyId !== null} className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50">
                              Rejeter
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!loading && !error ? <Pagination pagination={result.pagination} onPage={setPage} /> : null}
      </div>
    </section>
  );
}
