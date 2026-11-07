import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  checkSignupIdentifiers,
  loginWithPassword,
  requestPasswordResetCode,
} from './auth.controller';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});

const signupCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Vérifications trop fréquentes. Réessayez dans quelques minutes.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes. Réessayez dans quelques minutes.' },
});

router.post('/login', loginLimiter, loginWithPassword);
router.post('/signup-identifiers', signupCheckLimiter, checkSignupIdentifiers);
router.post('/password-reset/request', passwordResetLimiter, requestPasswordResetCode);

export default router;
