import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatIcon, SendIcon } from '../components/icons';
import { EmptyState, ErrorState, FilterTabs, LoadingBlock, PageHeader } from '../components/ui';
import { api, apiErrorMessage } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../utils/format';

interface ChatProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  phone: string | null;
}

interface Conversation {
  id: string;
  kind: 'direct' | 'support';
  user_a: string;
  user_b: string | null;
  last_message: string | null;
  last_message_at: string;
  unread: number;
  user_a_profile: ChatProfile | null;
  user_b_profile: ChatProfile | null;
}

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_is_admin: boolean;
  content: string;
  created_at: string;
}

const KIND_OPTIONS = [
  { value: 'support', label: 'Support (Artisant)' },
  { value: 'direct', label: 'Client ↔ Artisan' },
];

const ROLE_LABEL: Record<string, string> = { client: 'Client', artisan: 'Artisan', admin: 'Admin' };

const titleOf = (c: Conversation) =>
  c.kind === 'support'
    ? `${c.user_a_profile?.full_name ?? 'Utilisateur'} (${ROLE_LABEL[c.user_a_profile?.role ?? ''] ?? '—'})`
    : `${c.user_a_profile?.full_name ?? 'Client'} ↔ ${c.user_b_profile?.full_name ?? 'Artisan'}`;

export default function Messages() {
  const [kind, setKind] = useState<'support' | 'direct'>('support');
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    try {
      const data = await api.get<Conversation[]>(`/admin/chat/conversations?kind=${kind}`);
      setConvs(data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les conversations.'));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const loadMessages = useCallback(async (id: string, markRead: boolean) => {
    try {
      setMessages(await api.get<ChatMessage[]>(`/admin/chat/conversations/${id}/messages`));
      if (markRead) {
        await api.post(`/admin/chat/conversations/${id}/read`);
        void loadConvs();
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les messages.'));
    }
  }, [loadConvs]);

  useEffect(() => {
    setLoading(true);
    setActiveId(null);
    void loadConvs();
  }, [loadConvs]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-chat-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => void loadConvs())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        void loadConvs();
        if ((payload.new as { conversation_id?: string }).conversation_id === activeId && activeId) {
          void loadMessages(activeId, true);
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeId, loadConvs, loadMessages]);

  useEffect(() => {
    if (activeId) void loadMessages(activeId, true);
    else setMessages([]);
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const active = convs.find((c) => c.id === activeId) ?? null;

  const send = async () => {
    const content = text.trim();
    if (!content || !activeId || sending) return;
    setSending(true);
    try {
      await api.post(`/admin/chat/conversations/${activeId}/messages`, { content });
      setText('');
      await loadMessages(activeId, false);
      void loadConvs();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'envoyer le message."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Répondez aux utilisateurs en temps réel — vos réponses apparaissent sous le nom « Artisant »."
        icon={<ChatIcon className="h-6 w-6" />}
      />
      <div className="mb-4">
        <FilterTabs options={KIND_OPTIONS} value={kind} onChange={(v) => setKind(v as 'support' | 'direct')} />
      </div>
      {error && <ErrorState message={error} onRetry={() => void loadConvs()} />}
      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
            {convs.length === 0 ? (
              <EmptyState title="Aucune conversation" hint="Elles apparaissent dès qu'un utilisateur écrit." />
            ) : (
              convs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left transition hover:bg-brand-light/40 ${
                    activeId === c.id ? 'bg-brand-light/60' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{titleOf(c)}</p>
                    <p className="truncate text-xs text-muted">{c.last_message ?? 'Aucun message'}</p>
                    <p className="text-[11px] text-muted">{formatDateTime(c.last_message_at)}</p>
                  </div>
                  {c.unread > 0 && (
                    <span className="mt-1 rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{c.unread}</span>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="flex min-h-[50vh] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {!active ? (
              <div className="m-auto p-6 text-sm text-muted">Sélectionnez une conversation.</div>
            ) : (
              <>
                <div className="border-b border-gray-100 px-5 py-3">
                  <p className="font-semibold text-ink">{titleOf(active)}</p>
                  {active.user_a_profile?.phone && <p className="text-xs text-muted">{active.user_a_profile.phone}</p>}
                </div>
                <div className="flex max-h-[55vh] flex-1 flex-col gap-2 overflow-y-auto bg-gray-50 p-4">
                  {messages.length === 0 && <p className="m-auto text-sm text-muted">Aucun message.</p>}
                  {messages.map((m) => {
                    const mine = m.sender_is_admin;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                          mine ? 'self-end bg-brand text-white' : 'self-start bg-white text-ink'
                        }`}
                      >
                        {mine && <p className="text-[11px] font-semibold opacity-80">Artisant</p>}
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>{formatDateTime(m.created_at)}</p>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
                {active.kind === 'support' ? (
                  <form
                    className="flex gap-2 border-t border-gray-100 p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={2000}
                      placeholder="Répondre en tant que « Artisant »…"
                      className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                    <button
                      type="submit"
                      disabled={!text.trim() || sending}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <SendIcon className="h-4 w-4" /> Envoyer
                    </button>
                  </form>
                ) : (
                  <p className="border-t border-gray-100 p-3 text-center text-xs text-muted">
                    Discussion privée client ↔ artisan : consultation uniquement.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
