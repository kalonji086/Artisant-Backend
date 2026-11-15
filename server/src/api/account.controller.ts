import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendEmail, generateEmailTemplate } from '../lib/email';
import { buildEmailFooter, getBranding } from '../lib/branding';

type AuthenticatedRequest = Request & {
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> };
};

export const sendPasswordResetOtp = async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }

  const genericResponse = {
    success: true,
    message: 'Si cette adresse correspond à un compte, un code de récupération lui sera envoyé.',
  };

  try {
    const { data, error } = await supabase.auth.admin.generateLink({ type: 'recovery', email });
    if (error) {
      if (error.code === 'user_not_found') return res.json(genericResponse);
      logger.error('Génération du code de récupération impossible', {
        error: error.message,
        code: error.code,
      });
      return res.status(500).json({ error: 'Impossible de préparer le code de récupération.' });
    }

    const otp = data?.properties?.email_otp;
    if (!otp || !/^\d{8}$/.test(otp)) {
      logger.error('Longueur de code de récupération inattendue', {
        length: otp?.length ?? 0,
      });
      return res.status(500).json({
        error: 'Le code de récupération doit être configuré sur 8 chiffres.',
      });
    }

    const branding = await getBranding();
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const htmlContent = generateEmailTemplate(
      'Code de récupération de votre compte',
      `<p>Vous avez demandé à réinitialiser le mot de passe de votre compte ARTISANTS.</p>
       <p>Entrez le code à usage unique ci-dessous dans l’application :</p>
       <p style="margin:28px 0;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#1877f2;">${otp}</p>
       <p>Si vous n’êtes pas à l’origine de cette demande, ignorez cet email. Ne partagez ce code avec personne.</p>`,
      undefined,
      undefined,
      `${baseUrl}/logo.png`,
      buildEmailFooter(branding, baseUrl)
    );

    await sendEmail({
      to: email,
      subject: 'Votre code de récupération ARTISANTS',
      htmlContent,
      textContent: `Vous avez demandé à réinitialiser votre mot de passe ARTISANTS. Votre code de récupération est : ${otp}. Ne le partagez avec personne.`,
    });

    logger.info('Code de récupération envoyé via Brevo');
    return res.json(genericResponse);
  } catch (error) {
    logger.error('Envoi du code de récupération impossible', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({ error: 'Impossible d’envoyer le code par email. Réessayez plus tard.' });
  }
};

export const createAccountDeletionRequest = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user?.id || !user.email) {
    return res.status(400).json({ error: 'Adresse email du compte introuvable' });
  }

  const { data: existing, error: existingError } = await supabase
    .from('account_deletion_requests')
    .select('id, status, requested_at')
    .eq('user_id', user.id)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  if (existingError) {
    logger.error('Erreur lecture demande de suppression', { user_id: user.id, error: existingError.message });
    return res.status(500).json({ error: 'Impossible de vérifier une demande existante' });
  }
  if (existing) return res.json({ request: existing, already_requested: true });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    logger.error('Erreur lecture profil pour demande de suppression', {
      user_id: user.id,
      error: profileError.message,
    });
    return res.status(500).json({ error: 'Impossible de charger le profil du compte' });
  }

  const metadataName = user.user_metadata?.full_name;
  const fullName = profile?.full_name ?? (typeof metadataName === 'string' ? metadataName : null);
  const { data: request, error } = await supabase
    .from('account_deletion_requests')
    .insert({
      user_id: user.id,
      email: user.email,
      full_name: fullName,
    })
    .select('id, status, requested_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Une demande de suppression est déjà en cours de traitement' });
    }
    logger.error('Erreur création demande de suppression', { user_id: user.id, error: error.message });
    return res.status(500).json({ error: 'Impossible d’enregistrer votre demande' });
  }

  logger.info('Demande de suppression de compte créée', {
    user_id: user.id,
    request_id: request.id,
  });
  return res.status(201).json({ request, already_requested: false });
};
