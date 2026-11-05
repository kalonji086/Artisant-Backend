import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendPushNotification } from './notification.service';

type Row = Record<string, any>;

const tokenOf = async (userId: string | null | undefined): Promise<string | null> => {
  if (!userId) return null;
  const { data } = await supabase.from('profiles').select('expo_push_token').eq('id', userId).maybeSingle();
  return (data?.expo_push_token as string | null) ?? null;
};

const nameOf = async (userId: string): Promise<string> => {
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return (data?.full_name as string | null) ?? 'Artisant';
};

const notify = async (userId: string | null | undefined, title: string, body: string, data: Row) => {
  const token = await tokenOf(userId);
  if (token) await sendPushNotification(token, title, body, data);
};

const STATUS_TEXT: Record<string, string> = {
  accepted: 'a accepté votre demande',
  in_progress: 'a commencé le travail',
  completed: 'a terminé le travail',
  rejected: 'a refusé votre demande',
};

const onChatMessage = async (record: Row) => {
  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('kind, user_a, user_b')
    .eq('id', record.conversation_id)
    .maybeSingle();
  if (!conv) return;

  let recipient: string | null = null;
  if (conv.kind === 'support') {
    // Seul le message de l'équipe notifie l'utilisateur.
    recipient = record.sender_is_admin ? conv.user_a : null;
  } else {
    recipient = record.sender_id === conv.user_a ? conv.user_b : conv.user_a;
  }
  if (!recipient || recipient === record.sender_id) return;

  const title = record.sender_is_admin ? 'Artisant' : await nameOf(record.sender_id);
  await notify(recipient, title, String(record.content).slice(0, 120), {
    type: 'chat',
    conversationId: record.conversation_id,
  });
};

const onQuote = async (type: string, record: Row, old: Row | null) => {
  const data = { type: 'quote', quoteId: record.id };

  if (type === 'INSERT') {
    if (record.artisan_id) {
      await notify(record.artisan_id, 'Nouvelle demande', record.title ?? record.category ?? 'Un client vous a écrit', data);
    }
    return;
  }

  const assignedNow =
    record.artisan_id && (record.artisan_id !== old?.artisan_id || (record.status !== old?.status && record.status === 'assigned'));
  if (assignedNow && (record.status === 'assigned' || record.status === 'pending')) {
    await notify(record.artisan_id, 'Nouveau devis attribué', record.title ?? record.category ?? 'Une demande vous a été attribuée', data);
    if (record.status === 'assigned') {
      await notify(record.client_id, 'Artisan attribué', 'Votre demande a été attribuée à un artisan.', data);
    }
    return;
  }

  if (record.status !== old?.status && STATUS_TEXT[record.status]) {
    const who = record.artisan_id ? await nameOf(record.artisan_id) : 'L’artisan';
    await notify(record.client_id, 'Mise à jour de votre demande', `${who} ${STATUS_TEXT[record.status]}.`, data);
  }
};

export const handlePushEvent = async (table: string, type: string, record: Row, old: Row | null) => {
  try {
    if (table === 'chat_messages' && type === 'INSERT') await onChatMessage(record);
    else if (table === 'quotes') await onQuote(type, record, old);
  } catch (error) {
    logger.error('Erreur notification push:', error);
  }
};
