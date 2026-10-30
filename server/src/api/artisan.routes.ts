import { Router } from 'express';
import { getArtisans, updateArtisanProfile } from './artisan.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/v1/artisans:
 *   get:
 *     summary: Récupérer la liste des artisans
 *     tags: [Artisans]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *         description: Latitude
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *         description: Longitude
 *       - in: query
 *         name: radius
 *         schema: { type: integer }
 *         description: Rayon en mètres
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Nom de la catégorie
 *     responses:
 *       200:
 *         description: Liste des artisans
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Profile'
 */
router.get('/', getArtisans);

/**
 * @swagger
 * /api/v1/artisans/profile:
 *   put:
 *     summary: Mettre à jour le profil de l'artisan connecté
 *     tags: [Artisans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name: { type: string }
 *               phone: { type: string }
 *               description: { type: string }
 *               is_available: { type: boolean }
 *               address: { type: string }
 *     responses:
 *       200:
 *         description: Profil mis à jour
 *       401:
 *         description: Non authentifié
 */
router.put('/profile', authenticate, updateArtisanProfile);

export default router;
