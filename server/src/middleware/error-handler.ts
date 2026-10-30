import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Erreurs de validation Zod
  if (err instanceof ZodError) {
    logger.error('Erreur de validation Zod', { errors: err.errors });
    return res.status(400).json({
      error: 'Données de requête invalides',
      details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  // Erreur HTTP standard
  if (err instanceof Error && 'statusCode' in err) {
    const statusCode = (err as { statusCode: number }).statusCode;
    logger.error(`Erreur HTTP ${statusCode}`, { message: err.message });
    return res.status(statusCode).json({ error: err.message });
  }

  // Erreur inconnue
  logger.error('Erreur interne du serveur', { error: err instanceof Error ? err.stack : String(err) });
  return res.status(500).json({ error: 'Erreur interne du serveur' });
};