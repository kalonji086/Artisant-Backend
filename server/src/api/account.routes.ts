import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import {
  createAccountDeletionRequest,
  createGuestSupportRequest,
  sendDeletionRequestOtp,
  sendPasswordResetOtp,
} from './account.controller';
import {
  getMyBusinessVerification as getMyArtisanBusinessVerification,
  submitBusinessVerification as submitArtisanBusinessVerification,
} from './business-verification.controller';
import { loginWithSecurity } from './auth-security.controller';

const router = Router();

const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes, veuillez réessayer plus tard.' },
});
const deletionOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, veuillez réessayer plus tard.' },
});
const loginAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez plus tard.' },
});

router.post('/password-reset-otp', sendPasswordResetOtp);
router.post('/login', loginAttemptLimiter, loginWithSecurity);
router.post('/deletion-request-otp', deletionOtpLimiter, sendDeletionRequestOtp);
router.post('/deletion-requests', authenticate, createAccountDeletionRequest);
router.post('/support-requests', publicFormLimiter, createGuestSupportRequest);
router.get('/business-verification', authenticate, getMyArtisanBusinessVerification);
router.post('/business-verification', authenticate, submitArtisanBusinessVerification);

export default router;
