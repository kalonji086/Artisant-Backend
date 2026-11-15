import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { createAccountDeletionRequest, sendPasswordResetOtp } from './account.controller';

const router = Router();

router.post('/password-reset-otp', sendPasswordResetOtp);
router.post('/deletion-requests', authenticate, createAccountDeletionRequest);

export default router;
