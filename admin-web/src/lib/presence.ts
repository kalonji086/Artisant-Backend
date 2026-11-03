import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const ONLINE_WINDOW_MS = 5 * 60_000;

export interface LiveCounts {
  artisans: number;
  clients: number;
}

/** Nombre d'artisans et de clients actifs (position reçue ces 5 dernières minutes), en temps réel. */
export function useLiveCounts(): LiveCounts {
  const [counts, setCounts] = useState<LiveCounts>({ artisans: 0, clients: 0 });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const refresh = async () => {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const { data: locations } = await supabase
        .from('user_locations')
        .select('user_id')
        .gte('updated_at', since)
        .limit(2000);
      const ids = (locations ?? []).map((l: { user_id: string }) => l.user_id);
      if (!active) return;
      if (ids.length === 0) {
        setCounts({ artisans: 0, clients: 0 });
        return;
      }
      const { data: profiles } = await supabase.from('profiles').select('role').in('id', ids);
      if (!active) return;
      const roles = (profiles ?? []) as { role: string }[];
      setCounts({
        artisans: roles.filter((p) => p.role === 'artisan').length,
        clients: roles.filter((p) => p.role === 'client').length,
      });
    };

    // Regroupe les rafales d'évènements en un seul rafraîchissement.
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 1500);
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const channel = supabase
      .channel('layout-live-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_locations' }, schedule)
      .subscribe();

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, []);

  return counts;
}

export interface PresenceEvent {
  id: number;
  kind: 'join' | 'leave';
  name: string;
}

export interface AdminPresence {
  admins: number;
  events: PresenceEvent[];
  connected: boolean;
}

/** Présence des administrateurs connectés : entrées et sorties en direct. */
export function useAdminPresence(userId: string | undefined, name: string): AdminPresence {
  const [admins, setAdmins] = useState(1);
  const [events, setEvents] = useState<PresenceEvent[]>([]);
  const [connected, setConnected] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let counter = 0;
    const push = (kind: PresenceEvent['kind'], who: string) => {
      const id = ++counter;
      setEvents((prev) => [...prev.slice(-2), { id, kind, name: who }]);
      window.setTimeout(() => setEvents((prev) => prev.filter((e) => e.id !== id)), 5000);
    };

    const channel = supabase.channel('admins-presence', { config: { presence: { key: userId } } });
    channel
      .on('presence', { event: 'sync' }, () => setAdmins(Math.max(1, Object.keys(channel.presenceState()).length)))
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key !== userId) push('join', (newPresences[0] as { name?: string } | undefined)?.name ?? 'Un administrateur');
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        if (key !== userId) push('leave', (leftPresences[0] as { name?: string } | undefined)?.name ?? 'Un administrateur');
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ name, at: new Date().toISOString() });
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, name]);

  return { admins, events, connected };
}

const SESSION_KEY = 'artisants-admin-session-start';

/** Durée de la session en cours, mise à jour chaque minute. */
export function useSessionDuration(): string {
  const [start] = useState(() => {
    const saved = Number(sessionStorage.getItem(SESSION_KEY));
    if (saved) return saved;
    const now = Date.now();
    sessionStorage.setItem(SESSION_KEY, String(now));
    return now;
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const minutes = Math.floor((now - start) / 60_000);
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}
