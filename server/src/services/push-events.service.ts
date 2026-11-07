import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendPushNotification } from './notification.service';

type Row = Record<string, any>;

const onAppNotification = async (record: Row) => {
  const userId = typeof record.user_id === 'string' ? record.user_id : null;
  if (!userId || typeof record.title !== 'string' || typeof record.body !== 'string') return;

  const [{ data: profile, error: profileError }, { count, error: countError }] = await Promise.all([
    supabase.from('profiles').select('expo_push_token').eq('id', userId).maybeSingle(),
    supabase
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null),
  ]);
  if (profileError) throw profileError;
  if (countError) throw countError;
  if (!profile?.expo_push_token) return;

  const notificationData = record.data && typeof record.data === 'object' ? record.data : {};
  await sendPushNotification(
    profile.expo_push_token,
    record.title,
    record.body,
    { ...notificationData, type: record.notification_type, notificationId: record.id },
    count ?? 0,
  );
};

export const handlePushEvent = async (table: string, type: string, record: Row): Promise<boolean> => {
  try {
    if (table === 'app_notifications' && type === 'INSERT') await onAppNotification(record);
    return true;
  } catch (error) {
    logger.error('Erreur notification push:', error);
    return false;
  }
};
