import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { getPlatformSettings, updatePlatformSettings, getEmailCampaigns, sendEmailCampaign } from './settings.controller';

const router = Router();

router.get('/settings', authenticate, requireAdmin, getPlatformSettings);
router.patch('/settings', authenticate, requireAdmin, updatePlatformSettings);

router.get('/email-campaigns', authenticate, requireAdmin, getEmailCampaigns);
router.post('/email-campaigns', authenticate, requireAdmin, sendEmailCampaign);

export default router;
