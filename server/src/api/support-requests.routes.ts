import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const router = Router();

// Formulaire d'aide public : limité par IP pour éviter le spam dans l'admin Support.
const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de demandes, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TYPES = ['help', 'account_deletion'] as const;

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

router.post('/', supportLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const requestType = REQUEST_TYPES.includes(body.request_type) ? body.request_type : null;
    const email = text(body.email, 254)?.toLowerCase() ?? null;
    const message = text(body.message, 2000);

    if (!requestType) return res.status(400).json({ error: 'Type de demande invalide' });
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse email invalide' });
    if (!message || message.length < 10) return res.status(400).json({ error: 'Message trop court' });

    const { error } = await supabase.from('support_requests').insert({
      request_type: requestType,
      email,
      full_name: text(body.full_name, 120),
      subject: text(body.subject, 120),
      message,
      status: 'open',
    });
    if (error) {
      logger.error('Enregistrement de la demande d\'aide échoué', { error: error.message });
      return res.status(500).json({ error: 'Une erreur est survenue. Réessayez plus tard.' });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
