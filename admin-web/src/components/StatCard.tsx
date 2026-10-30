import type { ReactNode } from 'react';

export type StatTone = 'brand' | 'green' | 'amber' | 'violet' | 'rose' | 'cyan';

const TONES: Record<StatTone, { box: string; icon: string }> = {
  brand: { box: 'bg-brand-light', icon: 'text-brand' },
  green: { box: 'bg-emerald-50', icon: 'text-emerald-600' },
  amber: { box: 'bg-amber-50', icon: 'text-amber-600' },
  violet: { box: 'bg-violet-50', icon: 'text-violet-600' },
  rose: { box: 'bg-rose-50', icon: 'text-rose-600' },
  cyan: { box: 'bg-cyan-50', icon: 'text-cyan-600' },
};

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: ReactNode;
  tone?: StatTone;
}

export default function StatCard({ label, value, hint, icon, tone = 'brand' }: StatCardProps) {
  const palette = TONES[tone];
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        </div>
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${palette.box} ${palette.icon}`}>
          {icon}
        </span>
      </div>
    </div>
  );
}
