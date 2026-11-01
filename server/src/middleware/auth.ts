import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

type AuthenticatedRequest = Request & { user?: { id: string } };

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Header Authorization invalide. Utilisez le format: Bearer <token>' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn('Token invalide ou expiré', { error: error?.message });
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }

    (req as AuthenticatedRequest).user = { id: user.id };
    next();
  } catch (err) {
    logger.error('Erreur lors de la validation du token', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
};

/**
 * Restreint l'accès aux utilisateurs dont le profil a le rôle 'admin'.
 * À enchaîner APRÈS `authenticate` (lit le rôle via le client service-role).
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as AuthenticatedRequest).user;

  if (!user?.id) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      logger.error('Erreur lors de la lecture du profil admin', {
        userId: user.id,
        errorCode: (error as any).code,
        errorMessage: error.message,
      });
      return res.status(500).json({
        error: 'Erreur serveur lors de la vérification des droits d\'accès',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    if (!profile) {
      logger.warn('Profil introuvable pour utilisateur authentifié', { userId: user.id });
      return res.status(403).json({
        error: 'Profil administrateur introuvable',
        details: 'Veuillez contacter un administrateur pour corriger votre compte'
      });
    }

    if (profile.role !== 'admin') {
      logger.warn('Utilisateur sans rôle admin tente d\'accéder à une route admin', {
        userId: user.id,
        currentRole: profile.role,
        userName: profile.full_name,
      });
      return res.status(403).json({
        error: 'Accès réservé aux administrateurs',
        details: `Votre rôle actuel est: ${profile.role}`
      });
    }

    next();
  } catch (err) {
    logger.error('Exception lors de la vérification du rôle admin', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Erreur serveur lors de la vérification des droits' });
  }
};
