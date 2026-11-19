import { useEffect, useState } from 'react';
import { AdminService } from '../lib/api';
import { supabase } from '../lib/supabase';

type SecurityEvent = {
  id: string;
  created_at: string;
  user_id: string | null;
  masked_identifier: string;
  ip_address: string | null;
  platform: string | null;
  device_model: string | null;
  failed_attempts: number;
  lock_hours: number;
  locked_until: string;
  resolved_at: string | null;
};

const RECENT_WINDOW_MS = 60 * 60 * 1000;

export default function SecurityLoginAlerts() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    void supabase
      .from('auth_login_security_events')
      .select('id, created_at, user_id, masked_identifier, ip_address, platform, device_model, failed_attempts, lock_hours, locked_until, resolved_at')
      .gte('created_at', since)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('[admin] Chargement des alertes de connexion impossible:', error);
          setLoadError('Les alertes de connexion sont indisponibles. Vérifiez que la migration 035 est appliquée et que votre session Admin est valide.');
          return;
        }
        setLoadError(null);
        setEvents((current) => {
          const merged = new Map<string, SecurityEvent>(
            (data ?? []).map((item) => [item.id, item as SecurityEvent])
          );
          for (const item of current) merged.set(item.id, item);
          return Array.from(merged.values())
            .filter((item) => !item.resolved_at)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, 5);
        });
      });

    const channel = supabase
      .channel('admin-auth-security-events')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'auth_login_security_events',
      }, (payload) => {
        const event = payload.new as SecurityEvent;
        if (payload.eventType === 'INSERT') {
          setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 5));
        } else if (payload.eventType === 'UPDATE' && event.resolved_at) {
          setEvents((current) => current.filter((item) => item.id !== event.id));
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeError(null);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[admin] Alertes de sécurité en temps réel indisponibles:', status);
          setRealtimeError('La réception en temps réel des alertes est indisponible. Vérifiez la publication Supabase Realtime et rechargez cette page.');
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  const dismiss = async (event: SecurityEvent) => {
    if (blockingId) return;
    setBlockingId(event.id);
    try {
      await AdminService.resolveAuthSecurityEvent(event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
    } catch (error) {
      console.error('[admin] Clôture de l’alerte de connexion impossible:', error);
      window.alert('L’alerte n’a pas pu être clôturée. Réessayez.');
    } finally {
      setBlockingId(null);
    }
  };

  const blockAccount = async (event: SecurityEvent) => {
    if (!event.user_id || blockingId) return;
    if (!window.confirm(`Bloquer le compte ${event.masked_identifier} après examen ? Un e-mail sera envoyé au compte si l’adresse est disponible.`)) {
      return;
    }
    setBlockingId(event.id);
    try {
      const result = await AdminService.updateUserBlockedStatus(event.user_id, true);
      window.alert(result.notificationSent === true
        ? 'Compte bloqué. La notification par e-mail a été envoyée.'
        : result.notificationSent === null
          ? 'Le compte était déjà bloqué. L’alerte a été clôturée.'
          : 'Compte bloqué, mais la notification par e-mail n’a pas pu être envoyée.');
      setEvents((current) => current.filter((item) => item.id !== event.id));
    } catch (error) {
      console.error('[admin] Blocage depuis une alerte de sécurité impossible:', error);
      window.alert('Le compte n’a pas pu être bloqué. Réessayez depuis la page Utilisateurs.');
    } finally {
      setBlockingId(null);
    }
  };

  const alertError = loadError ?? realtimeError;
  if (!events.length && !alertError) return null;

  return (
    <aside className="fixed right-4 top-20 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-3" aria-label="Alertes de sécurité">
      {alertError && (
        <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-800 shadow-xl">
          {alertError}
        </div>
      )}
      {events.map((event) => (
        <article key={event.id} className="rounded-xl border border-amber-300 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-900">Tentatives de connexion inhabituelles</p>
              <p className="mt-1 text-xs text-muted">
                {event.masked_identifier} · {new Date(event.created_at).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void dismiss(event)}
              className="rounded px-2 text-lg leading-none text-muted hover:bg-gray-100"
              aria-label="Fermer l’alerte">
              ×
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Échecs</dt><dd className="font-medium text-ink">{event.failed_attempts}</dd>
            <dt className="text-muted">Verrouillage temporaire</dt><dd className="font-medium text-ink">{event.lock_hours} h</dd>
            <dt className="text-muted">IP</dt><dd className="break-all font-medium text-ink">{event.ip_address ?? 'Indisponible'}</dd>
            <dt className="text-muted">Plateforme / appareil déclaré</dt>
            <dd className="break-words font-medium text-ink">
              {[event.platform, event.device_model].filter(Boolean).join(' · ') || 'Indisponible'}
            </dd>
          </dl>
          {event.user_id ? (
            <button
              type="button"
              onClick={() => void blockAccount(event)}
              disabled={blockingId !== null}
              className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
              {blockingId === event.id ? 'Blocage…' : 'Bloquer le compte et notifier'}
            </button>
          ) : (
            <p className="mt-3 text-xs text-muted">Aucun compte correspondant : aucune action de blocage proposée.</p>
          )}
        </article>
      ))}
    </aside>
  );
}
