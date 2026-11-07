export const firstRpcRow = <T>(data: T | T[] | null): T | null =>
  Array.isArray(data) ? data[0] ?? null : data;

export const formatLoginLockout = (lockedUntil: string): string => {
  const remainingMinutes = Math.max(1, Math.ceil((Date.parse(lockedUntil) - Date.now()) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const wait = hours > 0
    ? `${hours} h${minutes > 0 ? ` ${minutes} min` : ''}`
    : `${minutes} min`;
  return `Trop de tentatives. Réessayez dans ${wait}.`;
};
