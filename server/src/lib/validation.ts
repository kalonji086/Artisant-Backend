import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createCorrelationLogger } from './logger';

// Schéma de validation pour la création de devis
export const createQuoteSchema = z.object({
  body: z.object({
    artisan_id: z.string().uuid('artisan_id doit être un UUID valide'),
    service_id: z.string().uuid('service_id doit être un UUID valide'),
    description: z.string().min(1, 'La description est requise').max(1000),
  }),
});

// Schéma de validation pour la mise à jour de statut de devis
export const updateQuoteStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('ID de devis invalide'),
  }),
  body: z.object({
    status: z.enum(['pending', 'accepted', 'rejected', 'completed']),
    price: z.string().optional(),
  }),
});

// Schéma de validation pour la mise à jour du profil artisan
export const updateArtisanProfileSchema = z.object({
  body: z.object({
    full_name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').optional(),
    phone: z.string().min(8, 'Numéro de téléphone invalide').optional(),
    description: z.string().max(2000).optional(),
    is_available: z.boolean().optional(),
    location: z.string().optional(),
    address: z.string().optional(),
  }),
});

// Middleware de validation Zod générique
export const validate = (schema: z.ZodTypeAny) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req);
      next();
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Données de requête invalides',
          details: err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
};

// Type pour étendre Request avec le logger
export interface ValidatedRequest extends Request {
  correlationId?: string;
  logger?: ReturnType<typeof createCorrelationLogger>;
}