import { useCallback, useEffect, useState } from 'react';
import { Dispatch, formatDistance, type ArtisanSuggestion, type QuoteSuggestion } from '../lib/dispatch';
import { Spinner } from './ui';

export type AssignTarget =
  | { kind: 'quote'; id: string; label: string }
  | { kind: 'artisan'; id: string; label: string };

interface Props {
  target: AssignTarget;
  onAssigned: () => void;
  onClose: () => void;
}

/**
 * Suggestions d'assignation triées par distance.
 * - cible = devis : artisans les plus proches du client
 * - cible = artisan : devis à assigner les plus proches de l'artisan
 */
export default function AssignPanel({ target, onAssigned, onClose }: Props) {
  const [artisans, setArtisans] = useState<ArtisanSuggestion[]>([]);
  const [quotes, setQuotes] = useState<QuoteSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<'fixed' | 'detailed'>('fixed');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (target.kind === 'quote') setArtisans(await Dispatch.suggestArtisans(target.id));
      else setQuotes(await Dispatch.suggestQuotes(target.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [target.kind, target.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (quoteId: string, artisanId: string, busyKey: string) => {
    setBusyId(busyKey);
    setError(null);
    try {
      await Dispatch.assign(quoteId, artisanId, templateKey);
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignation impossible.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            {target.kind === 'quote' ? 'Assigner ce devis à…' : 'Attribuer à cet artisan…'}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{target.label}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-gray-100"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>

      {error ? <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}

      <label className="mt-3 block text-xs font-medium text-muted">
        Modèle à transmettre à l’artisan
        <select
          value={templateKey}
          onChange={(event) => setTemplateKey(event.target.value as 'fixed' | 'detailed')}
          className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-ink"
        >
          <option value="fixed">Devis forfaitaire</option>
          <option value="detailed">Devis détaillé</option>
        </select>
      </label>

      {loading ? (
        <div className="mt-4 flex justify-center">
          <Spinner className="h-5 w-5 text-brand" />
        </div>
      ) : target.kind === 'quote' ? (
        <ul className="mt-3 divide-y divide-gray-100">
          {artisans.length === 0 ? (
            <li className="py-3 text-sm text-muted">Aucun artisan disponible.</li>
          ) : (
            artisans.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{a.full_name ?? 'Artisan'}</p>
                  <p className="truncate text-xs text-muted">
                    {[a.profession, a.city].filter(Boolean).join(' · ') || '—'} ·{' '}
                    <span className="font-medium text-brand-dark">{formatDistance(a.distance_m)}</span> ·{' '}
                    {a.open_quotes} en cours
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void assign(target.id, a.id, a.id)}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
                >
                  {busyId === a.id ? '…' : 'Assigner'}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {quotes.length === 0 ? (
            <li className="py-3 text-sm text-muted">Aucun devis en attente d'assignation.</li>
          ) : (
            quotes.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{q.client_name ?? 'Client'}</p>
                  <p className="truncate text-xs text-muted">
                    {q.description || '—'} ·{' '}
                    <span className="font-medium text-brand-dark">{formatDistance(q.distance_m)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void assign(q.id, target.id, q.id)}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
                >
                  {busyId === q.id ? '…' : 'Attribuer'}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
