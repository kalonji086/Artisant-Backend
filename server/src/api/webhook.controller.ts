import { Request, Response } from 'express';
import { EmailTemplates, sendEmail } from '../services/email.service';

export const handleSupabaseWebhook = async (req: Request, res: Response) => {
  const { record, type, table } = req.body;

  // Supabase envoie les données de l'insertion dans 'record'
  if (table === 'profiles' && type === 'INSERT') {
    const { email, full_name, role } = record;

    try {
      if (role === 'artisan') {
        await sendEmail(email, EmailTemplates.WELCOME_ARTISAN(full_name));
      } else {
        await sendEmail(email, EmailTemplates.WELCOME_CLIENT(full_name));
      }
      console.log(`Mail de bienvenue envoyé à ${email}`);
    } catch (error) {
      console.error('Erreur webhook email:', error);
    }
  }

  res.status(200).json({ received: true });
};
