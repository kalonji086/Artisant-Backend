import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import {
  getRegistrationOptions,
  registerRestoreCredential,
  getAuthenticationOptions,
  authenticateWithRestoreCredential,
} from './restore.controller';

const router = Router();

const restoreLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});

router.post('/registration-options', authenticate, restoreLimiter, getRegistrationOptions);
router.post('/register', authenticate, restoreLimiter, registerRestoreCredential);
router.post('/authentication-options', restoreLimiter, getAuthenticationOptions);
router.post('/authenticate', restoreLimiter, authenticateWithRestoreCredential);

export default router;
