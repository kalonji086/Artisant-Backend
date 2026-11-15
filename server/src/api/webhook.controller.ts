import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { EmailTemplates, sendEmail } from '../services/email.service';
import { sendPushNotification } from '../services/notification.service';

type JsonRecord = Record<string, unknown>;
type PushKind = 'message' | 'quote';

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (record: JsonRecord, field: string): string | null =>
  typeof record[field] === 'string' ? record[field] as string : null;

const handleAppNotification = async (record: JsonRecord) => {
  const userId = stringField(record, 'user_id');
  const kind = stringField(record, 'kind');
  const title = stringField(record, 'title');
  const body = stringField(record, 'body');
  if (!userId || !title || !body || (kind !== 'message' && kind !== 'quote')) return;

  const [{ data: devices, error: devicesError }, { data: preferences, error: preferencesError }] =
    await Promise.all([
      supabase.from('push_devices').select('expo_push_token').eq('user_id', userId),
      supabase
        .from('user_preferences')
        .select('notify_messages, notify_quotes')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

  if (devicesError) throw devicesError;
  if (preferencesError) throw preferencesError;
  if (!devices?.length) return;
  if (kind === 'message' && preferences?.notify_messages === false) return;
  if (kind === 'quote' && preferences?.notify_quotes === false) return;

  const data = isRecord(record.data) ? record.data : {};
  const notificationId = stringField(record, 'id');
  const pushData = { ...data, ...(notificationId ? { notification_id: notificationId } : {}) };
  const failures: Error[] = [];

  await Promise.all(devices.map(async ({ expo_push_token: token }) => {
    try {
      const tickets = await sendPushNotification(token, title, body, pushData);
      for (const ticket of tickets) {
        if (ticket.status !== 'error') continue;
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const { error } = await supabase
            .from('push_devices')
            .delete()
            .eq('user_id', userId)
            .eq('expo_push_token', token);
          if (error) throw error;
        } else {
          throw new Error(`Expo Push: ${ticket.message}`);
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }));

  if (failures.length) {
    throw new Error(`Échec d’envoi vers ${failures.length} appareil(s): ${failures[0].message}`);
  }
};

export const handleSupabaseWebhook = async (req: Request, res: Response) => {
  const payload = isRecord(req.body) ? req.body : {};
  const record = isRecord(payload.record) ? payload.record : null;
  const type = stringField(payload, 'type');
  const table = stringField(payload, 'table');

  if (table === 'profiles' && type === 'INSERT' && record) {
    const userId = stringField(record, 'id');
    const fullName = stringField(record, 'full_name') || 'Bonjour';
    const role = stringField(record, 'role');
    if (userId) {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error) throw error;
        const email = data.user?.email;
        if (email) {
          await sendEmail(
            email,
            role === 'artisan'
              ? EmailTemplates.WELCOME_ARTISAN(fullName)
              : EmailTemplates.WELCOME_CLIENT(fullName)
          );
        }
      } catch (error) {
        logger.error('Erreur webhook mail de bienvenue:', { error });
      }
    }
  }

  if (table === 'app_notifications' && type === 'INSERT' && record) {
    try {
      await handleAppNotification(record);
    } catch (error) {
      logger.error('Erreur webhook notification push:', { error });
      return res.status(502).json({ error: 'Échec de traitement de la notification push.' });
    }
  }

  return res.status(200).json({ received: true });
};
