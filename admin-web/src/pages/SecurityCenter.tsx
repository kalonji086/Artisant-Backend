import { useCallback, useEffect, useState } from 'react';
import Pagination from '../components/Pagination';
import {
  AlertIcon,
  SearchIcon,
} from '../components/icons';
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  LoadingBlock,
  PageHeader,
} from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { AuthLoginSecurityEvent, Paginated, UserPushDevice } from '../types';
import { formatDateTime } from '../utils/format';

type EventStatus = 'open' | 'resolved' | 'all';
type Notice = { tone: 'success' | 'error'; message: string } | null;

const EMPTY_EVENTS: Paginated<AuthLoginSecurityEvent> = {
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

const STATUS_OPTIONS = [
  { value: 'open', label: 'À traiter' },
  { value: 'resolved', label: 'Traitées' },
  { value: 'all', label: 'Tout l’historique' },
];

export default function SecurityCenter() {
  const [status, setStatus] = useState<EventStatus>('open');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<Paginated<AuthLoginSecurityEvent>>(EMPTY_EVENTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuthLoginSecurityEvent | null>(null);
  const [devices, setDevices] = useState<UserPushDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadEvents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const response = await AdminService.getAuthLoginSecurityEvents({
        status,
        page,
        pageSize: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      setEvents(response.data);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Impossible de charger les alertes de sécurité.'));
    } finally {
      setLoading(false);
    }
  }, [status, page, debouncedSearch]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadEvents(true), 400);
    };
    const channel = supabase
      .channel('security-center-events')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'auth_login_security_events',
      }, refresh)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [loadEvents]);

  const loadDevices = useCallback(async (userId: string) => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const response = await AdminService.getUserPushDevices(userId);
      setDevices(response.data.data);
    } catch (error) {
      setDevicesError(apiErrorMessage(error, 'Impossible de charger les appareils enregistrés.'));
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    setDevices([]);
    setDevicesError(null);
    if (selected?.user_id) void loadDevices(selected.user_id);
  }, [selected?.id, selected?.user_id, loadDevices]);

  const handleBlock = async (event: AuthLoginSecurityEvent, blocked: boolean) => {
    if (!event.user_id || actionId) return;
    if (
      blocked
      && !window.confirm(`Bloquer le compte ${event.masked_identifier} ? L’utilisateur ne pourra plus se connecter et une notification e-mail sera tentée.`)
    ) return;

    setActionId(event.id);
    setNotice(null);
    try {
      const result = await AdminService.updateUserBlockedStatus(event.user_id, blocked);
      setStatus('all');
      if (!result.realtime) {
        setNotice({ tone: 'error', message: 'Compte modifié, mais la mise à jour en temps réel n’a pas pu être signalée.' });
      } else if (result.notificationSent === false) {
        setNotice({ tone: 'error', message: 'Compte bloqué, mais la notification par e-mail n’a pas pu être envoyée.' });
      } else {
        setNotice({
          tone: 'success',
          message: blocked ? 'Compte bloqué. Les alertes associées sont conservées dans l’historique.' : 'Compte débloqué.',
        });
      }
      if (blocked && status !== 'all') {
        setStatus('all');
      } else {
        await loadEvents(true);
      }
    } catch (error) {
      setNotice({ tone: 'error', message: apiErrorMessage(error, 'Impossible de modifier le statut du compte.') });
    } finally {
      setActionId(null);
    }
  };

  const resolveEvent = async (event: AuthLoginSecurityEvent) => {
    if (actionId) return;
    setActionId(event.id);
    setNotice(null);
    try {
      await AdminService.resolveAuthSecurityEvent(event.id);
      setNotice({ tone: 'success', message: 'Alerte marquée comme traitée.' });
      await loadEvents(true);
    } catch (error) {
      setNotice({ tone: 'error', message: apiErrorMessage(error, 'Impossible de clôturer cette alerte.') });
    } finally {
      setActionId(null);
    }
  };

  const removeDevice = async (device: UserPushDevice) => {
    if (!selected?.user_id || actionId) return;
    if (!window.confirm(`Retirer l’appareil ${device.token_hint} de l’envoi des notifications push ? Cette action ne déconnecte pas ses sessions.`)) {
      return;
    }

    setActionId(device.device_ref);
    setNotice(null);
    try {
      await AdminService.removeUserPushDevice(selected.user_id, device.device_ref);
      setNotice({ tone: 'success', message: 'Appareil retiré des notifications push. Ses sessions restent actives.' });
      await loadDevices(selected.user_id);
    } catch (error) {
      setNotice({ tone: 'error', message: apiErrorMessage(error, 'Impossible de retirer cet appareil.') });
    } finally {
      setActionId(null);
    }
  };

  const restoreDevice = async (device: UserPushDevice) => {
    if (!selected?.user_id || actionId) return;
    setActionId(device.device_ref);
    setNotice(null);
    try {
      await AdminService.restoreUserPushDevice(selected.user_id, device.device_ref);
      setNotice({ tone: 'success', message: 'Appareil réautorisé. Les notifications reprendront après sa prochaine synchronisation avec l’application.' });
      await loadDevices(selected.user_id);
    } catch (error) {
      setNotice({ tone: 'error', message: apiErrorMessage(error, 'Impossible de réautoriser cet appareil.') });
    } finally {
      setActionId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Centre de sécurité"
        subtitle="Alertes déclenchées après trois échecs de connexion, comptes et appareils de notification"
        icon={<AlertIcon className="h-6 w-6" />}
      />

      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Seuil de sécurité : 3 identifiants incorrects</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          Les IP et caractéristiques d’appareil proviennent de la requête de connexion et ne prouvent pas, à elles seules, l’identité de l’utilisateur. Les appareils push listés ne sont pas reliés de façon certaine à celui déclaré dans l’alerte. Leur retrait désactive les notifications, pas la session.
        </p>
      </div>

      <section className="mb-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5" aria-label="Filtres des alertes">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher l’identifiant masqué…"
              aria-label="Rechercher une alerte de sécurité"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-3 pl-9 text-sm text-ink placeholder:text-gray-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <FilterTabs
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setStatus(value as EventStatus);
              setPage(1);
            }}
          />
        </div>
      </section>

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${notice.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}
        >
          {notice.message}
        </p>
      ) : null}

      {loading ? (
        <LoadingBlock label="Chargement des alertes de sécurité…" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void loadEvents()} />
      ) : events.data.length === 0 ? (
        <EmptyState
          title="Aucune alerte trouvée"
          hint="Les tentatives ayant atteint le seuil de sécurité apparaîtront ici."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {events.data.map((event) => {
            const isSelected = selected?.id === event.id;
            const isLocked = Date.parse(event.locked_until) > Date.now();
            return (
              <article
                key={event.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm transition sm:p-5 ${isSelected ? 'border-brand ring-2 ring-brand/15' : event.resolved_at ? 'border-gray-100' : 'border-amber-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-ink">{event.masked_identifier}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${event.resolved_at ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-800'}`}>
                        {event.resolved_at ? 'Traitée' : 'À traiter'}
                      </span>
                      {event.user_id ? (
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${event.is_blocked ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {event.is_blocked ? 'Compte bloqué' : 'Compte actif'}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {event.user?.full_name ?? (event.user_id ? 'Utilisateur associé' : 'Aucun compte correspondant')}
                      {event.user?.role ? ` · ${event.user.role === 'artisan' ? 'Artisan' : 'Client'}` : ''}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-[11px] text-muted">{formatDateTime(event.created_at)}</p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">Échecs</dt>
                    <dd className="mt-1 font-bold text-ink">{event.failed_attempts}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Verrouillage automatique</dt>
                    <dd className="mt-1 font-bold text-ink">{event.lock_hours} h</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">État du verrou</dt>
                    <dd className={`mt-1 font-bold ${isLocked ? 'text-amber-700' : 'text-gray-600'}`}>
                      {isLocked ? 'En cours' : 'Expiré'}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">IP déclarée</dt>
                    <dd className="mt-1 break-all font-medium text-ink">{event.ip_address ?? 'Indisponible'}</dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-muted">Plateforme / appareil déclaré</dt>
                    <dd className="mt-1 truncate font-medium text-ink">
                      {[event.platform, event.device_model].filter(Boolean).join(' · ') || 'Indisponible'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  {event.user_id ? (
                    <>
                      <button
                        type="button"
                        disabled={actionId !== null}
                        onClick={() => void handleBlock(event, !event.is_blocked)}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${event.is_blocked ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                      >
                        {actionId === event.id ? 'Mise à jour…' : event.is_blocked ? 'Débloquer le compte' : 'Bloquer le compte'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(isSelected ? null : event)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
                      >
                        {isSelected ? 'Masquer les appareils' : 'Gérer les appareils'}
                      </button>
                    </>
                  ) : (
                    <p className="text-xs text-muted">Le compte ne correspond plus à un utilisateur actif; aucune action de compte n’est proposée.</p>
                  )}
                  {!event.resolved_at ? (
                    <button
                      type="button"
                      disabled={actionId !== null}
                      onClick={() => void resolveEvent(event)}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                      Marquer comme traitée
                    </button>
                  ) : null}
                </div>

                {isSelected && event.user_id ? (
                  <section className="mt-4 border-t border-gray-100 pt-4" aria-label="Appareils de notifications enregistrés">
                    <div className="mb-3">
                      <h3 className="text-sm font-bold text-ink">Appareils enregistrés pour les notifications</h3>
                      <p className="mt-1 text-xs text-muted">Cette liste montre les appareils push du compte, pas forcément l’appareil à l’origine de l’alerte. Le retrait ne déconnecte pas la session.</p>
                    </div>
                    {devicesLoading ? (
                      <p className="text-xs text-muted">Chargement des appareils…</p>
                    ) : devicesError ? (
                      <p role="alert" className="text-xs text-red-700">{devicesError}</p>
                    ) : devices.length === 0 ? (
                      <p className="rounded-lg bg-gray-50 p-3 text-xs text-muted">Aucun appareil de notification enregistré.</p>
                    ) : (
                      <ul className="space-y-2">
                        {devices.map((device) => (
                          <li key={device.device_ref} className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-xs font-semibold capitalize text-ink">
                                {device.platform} · jeton {device.token_hint}
                              </p>
                              <p className="mt-1 text-[11px] text-muted">
                                {device.revoked_at
                                  ? `Notifications retirées le ${formatDateTime(device.revoked_at)}`
                                  : `Mis à jour le ${formatDateTime(device.updated_at)}`}
                              </p>
                            </div>
                            {device.revoked_at ? (
                              <button
                                type="button"
                                disabled={actionId !== null}
                                onClick={() => void restoreDevice(device)}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                {actionId === device.device_ref ? 'Autorisation…' : 'Réautoriser les notifications'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={actionId !== null}
                                onClick={() => void removeDevice(device)}
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                              >
                                {actionId === device.device_ref ? 'Retrait…' : 'Retirer cet appareil'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {!loading && !loadError ? (
        <Pagination pagination={events.pagination} onPage={setPage} />
      ) : null}
    </div>
  );
}
