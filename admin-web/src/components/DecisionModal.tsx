import { useEffect, useState } from 'react';
import { Spinner } from './ui';

interface DecisionModalProps {
  open: boolean;
  /** 'approve' → validation verte, 'reject' → validation rouge */
  tone: 'approve' | 'reject';
  title: string;
  subtitle?: string;
  error?: string | null;
  confirmLabel: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}

/** Modale légère pour approuver / rejeter une demande (avec note optionnelle). */
export default function DecisionModal({
  open,
  tone,
  title,
  subtitle,
  error,
  confirmLabel,
  loading = false,
  onClose,
  onConfirm,
}: DecisionModalProps) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) setNotes('');
  }, [open]);

  if (!open) return null;

  const confirmClass =
    tone === 'approve'
      ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'
      : 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="decision-modal-title" className="text-lg font-bold text-ink">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </p>
        ) : null}

        <label className="mt-5 block text-sm font-medium text-ink" htmlFor="decision-notes">
          Note admin <span className="font-normal text-muted">(optionnelle)</span>
        </label>
        <textarea
          id="decision-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Motif, commentaire interne…"
          className="mt-1.5 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-ink placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(notes.trim())}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition focus:ring-2 focus:outline-none disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? <Spinner className="h-4 w-4 text-white" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
