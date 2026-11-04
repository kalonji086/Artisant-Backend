import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { logActivity } from '../lib/activity';

type AuthenticatedRequest = Request & { user?: { id: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res: Response, scope: string, err: unknown) => {
  logger.error(`Erreur chat admin (${scope})`, { error: err instanceof Error ? err.message : JSON.stringify(err) });
  return res.status(500).json({ error: 'Erreur lors du traitement des messages' });
};

export const listConversations = async (req: Request, res: Response) => {
  try {
    const kind = req.query.kind === 'direct' || req.query.kind === 'support' ? req.query.kind : null;
    let q = supabase
      .from('chat_conversations')
      .select('id, kind, user_a, user_b, quote_id, last_message, last_message_at, created_at')
      .order('last_message_at', { ascending: false })
      .limit(200);
    if (kind) q = q.eq('kind', kind);
    const { data: convs, error } = await q;
    if (error) throw error;
    const rows = convs ?? [];

    const ids = Array.from(new Set(rows.flatMap((c) => [c.user_a, c.user_b]).filter((x): x is string => !!x)));
    const { data: profs } = ids.length
      ? await supabase.from('profiles').select('id, full_name, role, phone').in('id', ids)
      : { data: [] };
    const byId = new Map((profs ?? []).map((p) => [p.id as string, p]));

    const convIds = rows.map((c) => c.id);
    const { data: unread } = convIds.length
      ? await supabase
          .from('chat_messages')
          .select('conversation_id')
          .in('conversation_id', convIds)
          .eq('sender_is_admin', false)
          .is('read_at', null)
      : { data: [] };
    const unreadBy = new Map<string, number>();
    (unread ?? []).forEach((m) => unreadBy.set(m.conversation_id, (unreadBy.get(m.conversation_id) ?? 0) + 1));

    return res.json(
      rows.map((c) => ({
        ...c,
        user_a_profile: byId.get(c.user_a) ?? null,
        user_b_profile: c.user_b ? (byId.get(c.user_b) ?? null) : null,
        unread: c.kind === 'support' ? (unreadBy.get(c.id) ?? 0) : 0,
      })),
    );
  } catch (err) {
    return fail(res, 'list', err);
  }
};

export const getConversationMessages = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, conversation_id, sender_id, sender_is_admin, content, created_at, read_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    return res.json(data ?? []);
  } catch (err) {
    return fail(res, 'messages', err);
  }
};

export const sendAdminMessage = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!UUID.test(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  if (!content || content.length > 2000) return res.status(400).json({ error: 'Message invalide (1 à 2000 caractères)' });
  if (!req.user?.id) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const { data: conv } = await supabase.from('chat_conversations').select('id, kind').eq('id', id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable' });
    if (conv.kind !== 'support') return res.status(403).json({ error: 'Seules les conversations support sont modifiables' });

    const { data: msg, error } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: id, sender_id: req.user.id, sender_is_admin: true, content })
      .select()
      .single();
    if (error) throw error;
    await supabase
      .from('chat_conversations')
      .update({ last_message: content.slice(0, 200), last_message_at: msg.created_at })
      .eq('id', id);
    await logActivity({ actorId: req.user.id, action: 'chat.admin_message_sent', entityType: 'chat_conversation', entityId: id });
    return res.status(201).json(msg);
  } catch (err) {
    return fail(res, 'send', err);
  }
};

export const markConversationRead = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  try {
    const { error } = await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', id)
      .eq('sender_is_admin', false)
      .is('read_at', null);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return fail(res, 'read', err);
  }
};

// L'Admin peut ouvrir une conversation support avec n'importe quel utilisateur.
export const startSupportWithUser = async (req: Request, res: Response) => {
  const userId = req.body?.user_id;
  if (typeof userId !== 'string' || !UUID.test(userId)) return res.status(400).json({ error: 'Utilisateur invalide' });
  try {
    const { data: existing } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('kind', 'support')
      .eq('user_a', userId)
      .maybeSingle();
    if (existing) return res.json(existing);
    const { data, error } = await supabase
      .from('chat_conversations')
      .insert({ kind: 'support', user_a: userId })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    return fail(res, 'start', err);
  }
};
