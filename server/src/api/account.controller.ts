import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

type AuthenticatedRequest = Request & {
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> };
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
