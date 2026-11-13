import { NextFunction, Request, Response, Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getGooglePlayAccountId,
  getMySubscription,
  handleGooglePlayNotification,
  verifyMyGooglePlaySubscription,
} from './subscriptions.controller';

const router = Router();

const asyncRoute = (
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler => (req, res, next: NextFunction) => {
  void handler(req, res).catch(next);
};

/**
 * @swagger
 * /api/v1/subscriptions:
 *   get:
 *     summary: Lire l’abonnement et le quota de publications de l’artisan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Abonnement et consommation courants }
 *       403: { description: Réservé aux artisans }
 */
router.get('/', authenticate, asyncRoute(getMySubscription));
router.get('/account-id', authenticate, asyncRoute(getGooglePlayAccountId));

/**
 * @swagger
 * /api/v1/subscriptions/verify:
 *   post:
 *     summary: Vérifier un achat Google Play côté serveur
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, purchaseToken]
 *             properties:
 *               productId: { type: string }
 *               purchaseToken: { type: string }
 *     responses:
 *       200: { description: Achat vérifié et abonnement activé }
 *       402: { description: Achat inactif ou abonnement expiré }
 *       422: { description: Produit différent de l’achat vérifié }
 */
router.post('/verify', authenticate, asyncRoute(verifyMyGooglePlaySubscription));

/**
 * @swagger
 * /api/v1/subscriptions/google-play/notifications:
 *   post:
 *     summary: Recevoir les notifications de renouvellement Google Play (Pub/Sub)
 *     tags: [Subscriptions]
 *     responses:
 *       200: { description: Notification vérifiée et traitée }
 *       401: { description: Jeton Pub/Sub invalide }
 */
router.post('/google-play/notifications', asyncRoute(handleGooglePlayNotification));

export default router;
