const META: Record<string, { label: string; className: string }> = {
  // Statuts de devis
  unassigned: { label: 'À assigner', className: 'bg-orange-50 text-orange-700 ring-orange-200' },
  assigned: { label: 'Assigné', className: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  pending: { label: 'En attente', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  accepted: { label: 'Accepté', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { label: 'Rejeté', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  completed: { label: 'Terminé', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  // Statuts de demande employeur
  approved: { label: 'Approuvée', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  // Rôles
  admin: { label: 'Admin', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
  client: { label: 'Client', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  artisan: { label: 'Artisan', className: 'bg-brand-light text-brand-dark ring-brand/30' },
  suspended: { label: 'Suspendu', className: 'bg-red-50 text-red-700 ring-red-200' },
};

export default function StatusBadge({ value }: { value: string }) {
  const meta = META[value] ?? { label: value, className: 'bg-gray-100 text-gray-600 ring-gray-200' };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
