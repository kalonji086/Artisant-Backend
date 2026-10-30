import { Router, Request, Response, NextFunction } from 'express';
import { handleSupabaseWebhook } from './webhook.controller';

const router = Router();

/**
 * @swagger
 * /api/v1/webhooks/supabase:
 *   post:
 *     summary: Webhook Supabase (événements de base de données)
 *     tags: [Webhooks]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               table:
 *                 type: string
 *               type:
 *                 type: string
 *               record:
 *                 type: object
 *     headers:
 *       x-webhook-secret:
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: Webhook reçu
 *       401:
 *         description: Clé webhook invalide
 */
const verifyWebhookSecret = (req: Request, res: Response, next: NextFunction) => {
  const secretKey = req.headers['x-webhook-secret'];

  if (!secretKey || secretKey !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Non autorisé - clé webhook invalide' });
  }

  next();
};

router.post('/supabase', verifyWebhookSecret, handleSupabaseWebhook);

export default router;
