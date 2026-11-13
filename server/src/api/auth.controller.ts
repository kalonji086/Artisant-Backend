import { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { buildEmailFooter, escapeHtml, getBranding } from '../lib/branding';
import { generateEmailTemplate, sendEmail } from '../lib/email';
import { firstRpcRow, formatLoginLockout } from '../lib/login-lockout';
import { logger } from '../lib/logger';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS_RE = /^\d{4,15}$/;
const GENERIC_RESPONSE = {
  message: 'Si un compte correspond à cette adresse, un code de vérification lui a été envoyé.',
};
const INVALID_CREDENTIALS = 'Adresse e-mail ou mot de passe invalide.';

export const loginWithPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!EMAIL_RE.test(email) || email.length > 254 || !password || password.length > 1024) {
      return res.status(400).json({ error: INVALID_CREDENTIALS });
    }

    const { data: lockoutData, error: lockoutError } = await supabase.rpc('get_auth_login_lockout', {
      p_email: email,
    });
    if (lockoutError) {
      logger.error('Vérification du verrouillage de connexion impossible', { error: lockoutError.message });
      return res.status(503).json({ error: 'Le service de connexion est temporairement indisponible.' });
    }

    const lockout = firstRpcRow(lockoutData);
    if (lockout?.locked_until && Date.parse(lockout.locked_until) > Date.now()) {
      const { data: retryData, error: retryError } = await supabase.rpc('record_auth_login_failure', {
        p_email: email,
      });
      if (retryError) {
        logger.error('Mise à jour du verrouillage après une nouvelle tentative impossible', {
          error: retryError.message,
        });
        return res.status(503).json({ error: 'Le service de connexion est temporairement indisponible.' });
      }

      const retryState = firstRpcRow(retryData);
      return res.status(423).json({
        error: formatLoginLockout(retryState?.locked_until ?? lockout.locked_until),
      });
    }

    const authClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    );
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      if (error && error.code === 'email_not_confirmed') {
        return res.status(401).json({ error: INVALID_CREDENTIALS });
      }
      if (error && error.status !== 400 && error.status !== 401 && error.status !== 403) {
        logger.warn('Service de connexion indisponible ou compte non confirmé', {
          status: error.status,
          code: error.code,
        });
        return res.status(503).json({ error: 'Le service de connexion est temporairement indisponible.' });
      }
      if (error?.status === 403) {
        return res.status(401).json({ error: INVALID_CREDENTIALS });
      }

      const { data: failureData, error: failureError } = await supabase.rpc('record_auth_login_failure', {
        p_email: email,
      });
      if (failureError) {
        logger.error('Enregistrement de l’échec de connexion impossible', { error: failureError.message });
        return res.status(503).json({ error: 'Le service de connexion est temporairement indisponible.' });
      }

      const failure = firstRpcRow(failureData);
      if (failure?.locked_until && Date.parse(failure.locked_until) > Date.now()) {
        logger.warn('Compte temporairement verrouillé après des échecs de connexion', {
          lockLevel: failure.lock_level,
        });
        return res.status(423).json({ error: formatLoginLockout(failure.locked_until) });
      }

      return res.status(401).json({ error: INVALID_CREDENTIALS });
    }

    const { error: resetError } = await supabase.rpc('reset_auth_login_lockout', { p_email: email });
    if (resetError) {
      logger.error('Réinitialisation du verrouillage de connexion impossible', { error: resetError.message });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (error) {
    next(error);
  }
};

export const checkSignupIdentifiers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';
    const email = EMAIL_RE.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : '';
    const phone = PHONE_DIGITS_RE.test(rawPhone) ? rawPhone : '';
    if (!email && !phone) {
      return res.status(400).json({ error: 'Adresse e-mail ou numéro invalide.' });
    }

    const { data, error } = await supabase.rpc('check_signup_identifiers', {
      p_email: email,
      p_phone: phone,
    });
    if (error) {
      logger.error('Vérification des identifiants d’inscription impossible', { error: error.message });
      return res.status(503).json({ error: 'Vérification temporairement indisponible.' });
    }

    const identifiers = firstRpcRow(data);
    if (!identifiers) {
      logger.error('La vérification des identifiants d’inscription n’a retourné aucun résultat');
      return res.status(503).json({ error: 'Vérification temporairement indisponible.' });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      unavailable: identifiers.email_unavailable || identifiers.phone_unavailable,
    });
  } catch (error) {
    next(error);
  }
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
