import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../utils/format';
import { useAdminAuth } from '../context/AdminAuthContext';

type ActivityLog = {
  id: string;
  actor_role: 'client' | 'artisan' | 'admin' | 'system' | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  created_at: string;
};

const MAX_ITEMS = 30;

const ACTION_LABEL: Record<string, string> = {
  'account.created': 'a créé un compte',
  'profile.updated': 'a modifié son profil',
  'profile.role_changed': 'a changé de rôle',
  'quote.created': 'a créé une demande de devis',
  'quote.status_changed': 'a mis à jour le statut d’un devis',
  'chat.message_sent': 'a envoyé un message',
  'chat.admin_message_sent': 'a répondu à un message',
  'employer_request.approved': 'a approuvé une demande employeur',
  'employer_request.rejected': 'a rejeté une demande employeur',
  'employer_request.pending': 'a remis une demande en attente',
  'legal.saved': 'a modifié un document légal',
  'legal.reset': 'a réinitialisé un document légal',
  'settings.updated': 'a modifié les paramètres',
  'campaign.sent': 'a envoyé une campagne email',
};

const ROLE_LABEL: Record<NonNullable<ActivityLog['actor_role']>, string> = {
  client: 'Client',
  artisan: 'Artisan',
  admin: 'Admin',
  system: 'Système',
};

function readSeenAt(storageKey: string) {
  const initial = new Date().toISOString();
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    localStorage.setItem(storageKey, initial);
    return initial;
  } catch {
    return initial;
  }
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

export default function AdminActivityBell() {
  const navigate = useNavigate();
  const { session } = useAdminAuth();
  const storageKey = `artisants-admin-activity-seen-at:${session?.user.id ?? 'admin'}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ActivityLog[]>([]);
  const [seenAt, setSeenAt] = useState(() => readSeenAt(storageKey));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadLatest = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('id, actor_role, actor_name, action, entity_type, created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_ITEMS);
      if (error) throw error;
      const latest = (data ?? []) as ActivityLog[];
      setItems((current) => {
        const byId = new Map([...current, ...latest].map((item) => [item.id, item]));
        return [...byId.values()]
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, MAX_ITEMS);
      });
      setLoadError(false);
    } catch (error) {
      console.error('[admin-activity] chargement des activités impossible:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const channel = supabase
      .channel('admin-activity-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, (payload) => {
        const row = payload.new as ActivityLog;
        if (!active) return;
        setItems((current) => [row, ...current.filter((item) => item.id !== row.id)]
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, MAX_ITEMS));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void loadLatest();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[admin-activity] abonnement Realtime indisponible:', status);
          void loadLatest();
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [loadLatest]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const unseenCount = useMemo(
    () => items.filter((item) => item.created_at > seenAt).length,
    [items, seenAt],
  );

  const toggle = () => {
    if (!open && items.length > 0) {
      const newest = items.reduce(
        (latest, item) => item.created_at > latest ? item.created_at : latest,
        seenAt,
      );
      try {
        localStorage.setItem(storageKey, newest);
      } catch (error) {
        console.error('[admin-activity] mémorisation de la lecture impossible:', error);
      }
      setSeenAt(newest);
    }
    setOpen((current) => !current);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unseenCount > 0 ? `Activités récentes, ${unseenCount} nouvelles` : 'Activités récentes'}
        aria-expanded={open}
        className="relative rounded-xl p-2 text-slate-600 transition hover:bg-slate-100 hover:text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/40"
      >
        <span className="block h-5 w-5"><BellIcon /></span>
        {unseenCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unseenCount > 99 ? '99+' : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <section
          aria-label="Activités récentes des utilisateurs"
          className="absolute right-0 top-full z-50 mt-3 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Activités récentes</h2>
              <p className="text-xs text-slate-500">Mises à jour en temps réel</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-slate-50">
              Fermer
            </button>
          </div>

          <div className="max-h-[min(65vh,28rem)] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Chargement des activités…</p>
            ) : loadError ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-rose-700">Les activités n’ont pas pu être chargées.</p>
                <button type="button" onClick={() => void loadLatest()} className="mt-2 text-xs font-semibold text-brand">
                  Réessayer
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Aucune activité pour le moment.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => {
                  const role = item.actor_role ?? 'system';
                  const isNew = item.created_at > seenAt;
                  return (
                    <li key={item.id} className={isNew ? 'bg-sky-50/70' : ''}>
                      <div className="flex gap-3 px-4 py-3">
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${isNew ? 'bg-rose-500' : 'bg-slate-300'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800">
                            <span className="font-semibold">{item.actor_name ?? 'Utilisateur inconnu'}</span>{' '}
                            {ACTION_LABEL[item.action] ?? item.action}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {ROLE_LABEL[role]}{item.entity_type ? ` · ${item.entity_type}` : ''}
                          </p>
                          <time className="mt-1 block text-[11px] text-slate-400">{formatDateTime(item.created_at)}</time>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/logs');
            }}
            className="w-full border-t border-slate-100 px-4 py-3 text-center text-sm font-semibold text-brand transition hover:bg-slate-50"
          >
            Voir le journal complet
          </button>
        </section>
      )}
    </div>
  );
}
