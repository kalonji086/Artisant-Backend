import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { createAccountDeletionRequest } from './account.controller';

const router = Router();

router.post('/deletion-requests', authenticate, createAccountDeletionRequest);

export default router;
