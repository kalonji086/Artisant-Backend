import type { Pagination as PaginationType } from '../types';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface PaginationProps {
  pagination: PaginationType;
  onPage: (page: number) => void;
}

export default function Pagination({ pagination, onPage }: PaginationProps) {
  const { page, totalPages, total } = pagination;
  if (total === 0) return null;

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm sm:flex-row">
      <p className="text-sm text-muted">
        {total} résultat{total > 1 ? 's' : ''} — page {page} / {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Précédent
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Suivant
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
