import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

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
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }

    (req as AuthenticatedRequest).user = { id: user.id };
    next();
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
};
