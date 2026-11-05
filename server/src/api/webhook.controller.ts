import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { EmailTemplates, sendEmail } from '../services/email.service';
import { supabase } from '../lib/supabase';
import { handlePushEvent } from '../services/push-events.service';

export const handleSupabaseWebhook = async (req: Request, res: Response) => {
  const { record, type, table, old_record } = req.body;

  if (table === 'chat_messages' || table === 'quotes') {
    await handlePushEvent(table, type, record ?? {}, old_record ?? null);
    res.status(200).json({ received: true });
    return;
  }

  // Supabase envoie les données de l'insertion dans 'record'
  if (table === 'profiles' && type === 'INSERT') {
    const { full_name, role } = record;

    try {
      // L'email n'est pas dans la table profiles : on le lit dans auth.users.
      const email: string | undefined =
        record.email ?? (await supabase.auth.admin.getUserById(record.id)).data.user?.email;
      if (!email) {
        logger.error(`Mail de bienvenue ignoré : email introuvable pour ${record.id}`);
        res.status(200).json({ received: true });
        return;
      }

      if (role === 'artisan') {
        await sendEmail(email, EmailTemplates.WELCOME_ARTISAN(full_name));
      } else {
        await sendEmail(email, EmailTemplates.WELCOME_CLIENT(full_name));
      }
      logger.info(`Mail de bienvenue envoyé à ${email}`);
    } catch (error) {
      logger.error('Erreur webhook email:', error);
    }
  }

  res.status(200).json({ received: true });
};
