import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestPasswordResetCode } from './auth.controller';

const router = Router();

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes. Réessayez dans quelques minutes.' },
});

router.post('/password-reset/request', passwordResetLimiter, requestPasswordResetCode);

export default router;
