import { NextFunction, Request, Response, Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { generatePortfolioPresentation, importPortfolioPresentation } from './portfolio.controller';

const router = Router();

const asyncRoute = (
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler => (req, res, next: NextFunction) => {
  void handler(req, res).catch(next);
};

/**
 * @swagger
 * /api/v1/portfolio/import:
 *   post:
 *     summary: Importer une présentation PowerPoint dans le portfolio artisan
 *     tags: [Portfolio]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, source_path]
 *             properties:
 *               title: { type: string, maxLength: 120 }
 *               description: { type: string, maxLength: 3000 }
 *               source_path: { type: string, description: Chemin du fichier .pptx déjà chargé dans le bucket artisan-projects }
 *     responses:
 *       201: { description: Présentation importée et diapositives extraites }
 *       403: { description: Réservé aux artisans }
 *       422: { description: Présentation invalide ou sans photos JPEG/PNG }
 */
router.post('/import', authenticate, asyncRoute(importPortfolioPresentation));

/**
 * @swagger
 * /api/v1/portfolio/{id}/presentation:
 *   post:
 *     summary: Générer le PowerPoint d’une réalisation à partir de ses photos
 *     tags: [Portfolio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Présentation générée et enregistrée }
 *       403: { description: Réservé au propriétaire artisan }
 *       404: { description: Réalisation introuvable }
 */
router.post('/:id/presentation', authenticate, asyncRoute(generatePortfolioPresentation));

export default router;
