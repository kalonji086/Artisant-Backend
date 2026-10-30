const numberFormatter = new Intl.NumberFormat('fr-FR');

export const formatNumber = (n: number): string => numberFormatter.format(n);

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const MONTH_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

/** Transforme une clé 'YYYY-MM' en libellé court 'janv.', 'févr.', ... */
export const monthLabel = (key: string): string => {
  const month = parseInt(key.slice(5, 7), 10);
  return MONTH_SHORT[month - 1] ?? key;
};

export const formatPrice = (price: number | string | null | undefined): string => {
  if (price === null || price === undefined || price === '') return '—';
  const n = typeof price === 'string' ? parseFloat(price) : price;
  if (Number.isNaN(n)) return String(price);
  return `${numberFormatter.format(n)} €`;
};

/** Initiales pour les avatars (2 lettres max). */
export const initials = (name: string | null | undefined): string => {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
};
