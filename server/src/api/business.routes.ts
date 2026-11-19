import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createBusinessClientContract,
  listBusinessClientContracts,
  listEligibleBusinessClientQuotes,
  listMyBusinessClientContracts,
  signBusinessClientContract,
} from './business-client-contract.controller';
import {
  addBusinessFavorite,
  applyToBusinessJob,
  createBusinessContract,
  createBusinessJob,
  createBusinessPayment,
  getBusinessAccess,
  getBusinessDashboard,
  getBusinessProfile,
  getBusinessReports,
  inviteBusinessMember,
  listBusinessApplications,
  listBusinessContracts,
  listBusinessFavorites,
  listBusinessJobs,
  listBusinessPayments,
  listBusinessProjects,
  listBusinessTeam,
  listMyBusinessApplications,
  listMyBusinessContracts,
  removeBusinessFavorite,
  revokeBusinessMember,
  searchBusinessArtisans,
  searchBusinessJobs,
  signBusinessContract,
  sendBusinessContract,
  updateBusinessApplication,
  updateBusinessJob,
  updateBusinessPayment,
  updateBusinessProfile,
  updateBusinessProject,
} from './business-workspace.controller';

const router = Router();
router.use(authenticate);

router.get('/access', getBusinessAccess);
router.get('/dashboard', getBusinessDashboard);
router.get('/profile', getBusinessProfile);
router.patch('/profile', updateBusinessProfile);

router.get('/jobs/search', searchBusinessJobs);
router.get('/jobs', listBusinessJobs);
router.post('/jobs', createBusinessJob);
router.patch('/jobs/:id', updateBusinessJob);
router.post('/jobs/:id/applications', applyToBusinessJob);

router.get('/applications/my', listMyBusinessApplications);
router.get('/applications', listBusinessApplications);
router.patch('/applications/:id', updateBusinessApplication);

router.get('/artisans', searchBusinessArtisans);
router.get('/favorites', listBusinessFavorites);
router.post('/favorites/:artisanId', addBusinessFavorite);
router.delete('/favorites/:artisanId', removeBusinessFavorite);

router.get('/projects', listBusinessProjects);
router.patch('/projects/:id', updateBusinessProject);

router.get('/contracts', listBusinessContracts);
router.get('/contracts/my', listMyBusinessContracts);
router.post('/contracts', createBusinessContract);
router.post('/contracts/:id/sign', signBusinessContract);
router.post('/contracts/:id/send', sendBusinessContract);

router.get('/client-contracts/eligible-quotes', listEligibleBusinessClientQuotes);
router.get('/client-contracts/my', listMyBusinessClientContracts);
router.get('/client-contracts', listBusinessClientContracts);
router.post('/client-contracts', createBusinessClientContract);
router.post('/client-contracts/:id/sign', signBusinessClientContract);

router.get('/payments', listBusinessPayments);
router.post('/payments', createBusinessPayment);
router.patch('/payments/:id', updateBusinessPayment);

router.get('/reports', getBusinessReports);
router.get('/team', listBusinessTeam);
router.post('/team/invitations', inviteBusinessMember);
router.delete('/team/:id', revokeBusinessMember);

export default router;
