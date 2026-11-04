import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createCorrelationLogger } from './logger';

// Schéma de validation pour la création de devis
export const createQuoteSchema = z.object({
  // Pas d'artisan_id : l'Admin assigne la demande à un artisan proche du client.
  service_id: z.string().uuid('service_id doit être un UUID valide').optional(),
  description: z.string().min(1, 'La description est requise').max(1000),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// Schéma de validation pour la mise à jour de statut de devis
export const updateQuoteStatusSchema = z.object({
  id: z.string().uuid('ID de devis invalide'),
  status: z.enum(['unassigned', 'assigned', 'pending', 'accepted', 'rejected', 'completed']),
  price: z.string().optional(),
});

// Schéma de validation pour la mise à jour du profil artisan
export const updateArtisanProfileSchema = z.object({
  full_name: z.string().min(2, 'Le nom doit contenir au moins 2 caractères').optional(),
  phone: z.string().min(8, 'Numéro de téléphone invalide').optional(),
  description: z.string().max(2000).optional(),
  is_available: z.boolean().optional(),
  location: z.string().optional(),
  address: z.string().optional(),
});

// Schéma de validation pour la mise à jour d'une demande employeur (admin)
export const updateEmployerRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  admin_notes: z.string().max(1000, 'Les notes admin sont limitées à 1000 caractères').optional(),
});

// Middleware de validation Zod générique
export const validate = (schema: z.ZodTypeAny) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
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
