import { NextFunction, Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { buildEmailFooter, escapeHtml, getBranding } from '../lib/branding';
import { generateEmailTemplate, sendEmail } from '../lib/email';
import { logger } from '../lib/logger';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_RESPONSE = {
  message: 'Si un compte correspond à cette adresse, un code de vérification lui a été envoyé.',
};

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'adresse masquée';
  return `${local.slice(0, 1)}***@${domain}`;
};

export const requestPasswordResetCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    if (error) {
      if (error.status === 404 || /user not found/i.test(error.message)) {
        return res.json(GENERIC_RESPONSE);
      }
      logger.error('Génération du code de récupération impossible', { error: error.message });
      return res.status(503).json({ error: 'Le service de récupération est temporairement indisponible.' });
    }

    if (!data.user?.id || !data.properties.email_otp) {
      logger.error('Supabase n’a pas retourné les données du code de récupération');
      return res.status(503).json({ error: 'Le service de récupération est temporairement indisponible.' });
    }

    const branding = await getBranding();
    const baseUrl = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://www.artisants.com')
      .replace(/\/+$/, '');
    const name = typeof data.user.user_metadata?.full_name === 'string'
      ? data.user.user_metadata.full_name.trim()
      : '';
    const content = `
      <p>Bonjour${name ? ` ${escapeHtml(name)}` : ''},</p>
      <p>Utilisez le code ci-dessous pour vérifier votre demande de réinitialisation de mot de passe :</p>
      <p style="margin:24px 0;padding:16px;text-align:center;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:32px;font-weight:700;letter-spacing:8px;">
        ${escapeHtml(data.properties.email_otp)}
      </p>
      <p>Ce code est à usage unique et expire selon la durée de validité configurée dans Supabase Auth. Si vous n’avez pas demandé cette réinitialisation, ignorez cet email.</p>
    `;
    const subject = 'Votre code de réinitialisation ARTISANTS';
    const htmlContent = generateEmailTemplate(
      'Réinitialiser votre mot de passe',
      content,
      undefined,
      undefined,
      `${baseUrl}/logo.png`,
      buildEmailFooter(branding, baseUrl),
    );

    await sendEmail({ to: email, subject, htmlContent });

    const role = data.user.user_metadata?.role;
    const actorRole = role === 'artisan' || role === 'client' || role === 'admin' ? role : 'system';
    const actorName = name || maskEmail(email);
    const { error: activityError } = await supabase.from('activity_logs').insert({
      actor_id: data.user.id,
      actor_role: actorRole,
      actor_name: actorName,
      action: 'account.password_reset_requested',
      entity_type: 'auth',
      entity_id: data.user.id,
      metadata: { email: maskEmail(email) },
    });
    if (activityError) {
      logger.error('Notification admin de réinitialisation impossible', { error: activityError.message });
      return res.status(503).json({ error: 'Le code a été envoyé, mais la notification administrateur a échoué.' });
    }

    return res.json(GENERIC_RESPONSE);
  } catch (error) {
    next(error);
  }
};
