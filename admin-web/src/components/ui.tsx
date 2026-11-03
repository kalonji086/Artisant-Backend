import type { ReactNode } from 'react';
import { AlertIcon, InboxIcon } from './icons';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4Z" />
    </svg>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {icon ? (
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-sky-500 text-white shadow-lg shadow-brand/30">
            {icon}
          </span>
        ) : (
          <span className="h-10 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-brand to-sky-400" />
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tone = 'brand' | 'green' | 'amber' | 'violet' | 'rose' | 'sky';

const TONE_STYLES: Record<Tone, string> = {
  brand: 'from-brand to-sky-500 shadow-brand/30',
  green: 'from-emerald-500 to-teal-400 shadow-emerald-500/30',
  amber: 'from-amber-500 to-orange-400 shadow-amber-500/30',
  violet: 'from-violet-500 to-fuchsia-400 shadow-violet-500/30',
  rose: 'from-rose-500 to-pink-400 shadow-rose-500/30',
  sky: 'from-sky-500 to-cyan-400 shadow-sky-500/30',
};

export interface Tile {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone?: Tone;
}

export function StatStrip({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${TONE_STYLES[t.tone ?? 'brand']}`}
          >
            {t.icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium tracking-wide text-muted uppercase">{t.label}</p>
            <p className="text-2xl font-bold tracking-tight text-ink">{t.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilterTabs({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
            value === o.value
              ? 'bg-gradient-to-r from-brand to-sky-500 text-white shadow-md shadow-brand/25'
              : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  icon,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>
      {title ? (
        <header className="flex items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-brand-light/70 to-white px-5 py-4">
          {icon ? (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand shadow-sm ring-1 ring-brand/15">
              {icon}
            </span>
          ) : null}
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
          </div>
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
      <AlertIcon className="mx-auto h-8 w-8 text-rose-500" />
      <p className="mt-3 text-sm font-medium text-rose-800">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
        >
          Réessayer
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <InboxIcon className="mx-auto h-8 w-8 text-gray-400" />
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function LoadingBlock({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-white p-10">
      <Spinner className="h-5 w-5 text-brand" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}
