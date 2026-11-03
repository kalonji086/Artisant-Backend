import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  bulkDeleteCampaigns,
  cancelCampaign,
  clearHistory,
  countAudience,
  createCampaign,
  createTemplate,
  deleteCampaign,
  deleteTemplate,
  listCampaigns,
  listTemplates,
  sendCampaignNow,
  sendTestEmail,
  unsubscribe,
  updateCampaign,
} from './marketing.controller';

export const marketingRouter = Router();
marketingRouter.use(authenticate, requireAdmin);

marketingRouter.get('/campaigns', listCampaigns);
marketingRouter.post('/campaigns', createCampaign);
marketingRouter.post('/campaigns/bulk-delete', bulkDeleteCampaigns);
marketingRouter.delete('/campaigns', clearHistory);
marketingRouter.patch('/campaigns/:id', updateCampaign);
marketingRouter.post('/campaigns/:id/send', sendCampaignNow);
marketingRouter.post('/campaigns/:id/cancel', cancelCampaign);
marketingRouter.delete('/campaigns/:id', deleteCampaign);
marketingRouter.post('/test', sendTestEmail);
marketingRouter.post('/audience', countAudience);
marketingRouter.get('/templates', listTemplates);
marketingRouter.post('/templates', createTemplate);
marketingRouter.delete('/templates/:id', deleteTemplate);

export const unsubscribeRouter = Router();
unsubscribeRouter.get('/', unsubscribe);
