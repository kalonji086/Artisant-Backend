import { Router } from 'express';
import { createQuoteRequest, updateQuoteStatus } from './quote.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/quotes:
 *   post:
 *     summary: Créer une demande de devis
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - artisan_id
 *               - service_id
 *               - description
 *             properties:
 *               artisan_id:
 *                 type: string
 *                 format: uuid
 *               service_id:
 *                 type: string
 *                 format: uuid
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Devis créé
 *       400:
 *         description: Données invalides
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Interdit (artisan = client)
 */
router.post('/', authenticate, createQuoteRequest);

/**
 * @swagger
 * /api/v1/quotes/{id}:
 *   patch:
 *     summary: Mettre à jour le statut d'un devis (artisan uniquement)
 *     tags: [Quotes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, accepted, rejected, completed]
 *               price:
 *                 type: string
 *     responses:
 *       200:
 *         description: Devis mis à jour
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Interdit (pas le propriétaire)
 *       404:
 *         description: Devis non trouvé
 */
router.patch('/:id', authenticate, updateQuoteStatus);

export default router;
