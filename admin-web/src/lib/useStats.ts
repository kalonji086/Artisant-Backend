import { useEffect, useState } from 'react';
import type { AdminStats } from '../types';
import { AdminService } from './api';

/** Chiffres clés pour les bandeaux de statistiques ; silencieux en cas d'échec. */
export function useStats(): AdminStats | null {
  const [stats, setStats] = useState<AdminStats | null>(null);
  useEffect(() => {
    let active = true;
    AdminService.getStats()
      .then((res) => active && setStats(res.data))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return stats;
}
