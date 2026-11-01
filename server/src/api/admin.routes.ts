import { Router } from 'express';
import {
  getAdminStats,
  getEmployerRequests,
  getQuotes,
  getUsers,
  updateEmployerRequestStatus,
  getDatabaseStatus,
} from './admin.controller';
import {
  getPlatformSettings,
  updatePlatformSettings,
  getEmailCampaigns,
  sendEmailCampaign,
} from './settings.controller';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Toutes les routes admin exigent : session valide + rôle 'admin'
router.use(authenticate, requireAdmin);

/**
 * @swagger
 * /api/v1/admin/stats:
 *   get:
 *     summary: Statistiques agrégées du tableau de bord admin
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques (KPIs, devis par statut, inscriptions, services)
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/stats', getAdminStats);

/**
 * @swagger
 * /api/v1/admin/users:
 *   get:
 *     summary: Liste paginée des utilisateurs (recherche + filtre rôle)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Recherche sur nom ou adresse
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [client, artisan] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Liste paginée des profils
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/users', getUsers);

/**
 * @swagger
 * /api/v1/admin/quotes:
 *   get:
 *     summary: Tous les devis de la plateforme
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, accepted, rejected, completed] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Liste paginée des devis
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/quotes', getQuotes);

/**
 * @swagger
 * /api/v1/admin/db-status:
 *   get:
 *     summary: Vérifier l'état de la base de données (tables manquantes)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: État de la base de données avec instructions de configuration
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/db-status', getDatabaseStatus);

/**
 * @swagger
 * /api/v1/admin/employer-requests:
 *   get:
 *     summary: Demandes d'accès employeur (approbation admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Liste paginée des demandes
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/employer-requests', getEmployerRequests);

/**
 * @swagger
 * /api/v1/admin/employer-requests/{id}:
 *   patch:
 *     summary: Approuver ou rejeter une demande employeur
 *     tags: [Admin]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *               admin_notes:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Demande mise à jour (profil employeur créé si approuvée)
 *       400:
 *         description: Données invalides
 *       404:
 *         description: Demande non trouvée
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.patch('/employer-requests/:id', updateEmployerRequestStatus);

/**
 * @swagger
 * /api/v1/admin/settings:
 *   get:
 *     summary: Récupérer les paramètres de la plateforme
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paramètres de la plateforme
 *       403:
 *         description: Accès réservé aux administrateurs
 *   patch:
 *     summary: Mettre à jour les paramètres de la plateforme
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platform_name:
 *                 type: string
 *               support_email:
 *                 type: string
 *                 format: email
 *               sender_name:
 *                 type: string
 *               sender_email:
 *                 type: string
 *                 format: email
 *               reply_to_email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Paramètres mis à jour
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/settings', getPlatformSettings);
router.patch('/settings', updatePlatformSettings);

/**
 * @swagger
 * /api/v1/admin/email-campaigns:
 *   get:
 *     summary: Historique des campagnes d'email
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Liste paginée des campagnes d'email
 *       403:
 *         description: Accès réservé aux administrateurs
 *   post:
 *     summary: Envoyer une campagne d'email
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [audience, subject, body]
 *             properties:
 *               audience:
 *                 type: string
 *                 enum: [client, artisan]
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: Campagne d'email envoyée
 *       400:
 *         description: Données invalides
 *       403:
 *         description: Accès réservé aux administrateurs
 */
router.get('/email-campaigns', getEmailCampaigns);
router.post('/email-campaigns', sendEmailCampaign);

export default router;
