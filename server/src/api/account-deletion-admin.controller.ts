import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

type RequestStatus = 'pending' | 'processing' | 'completed' | 'rejected';
type AuthenticatedRequest = Request & { user?: { id: string } };

const isRequestStatus = (value: unknown): value is RequestStatus =>
  value === 'pending' || value === 'processing' || value === 'completed' || value === 'rejected';

export const getAccountDeletionRequests = async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .select('id, user_id, email, full_name, reason, details, status, requested_at, processed_at')
    .order('requested_at', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('Erreur lecture des demandes de suppression (admin)', { error: error.message });
    return res.status(500).json({ error: 'Impossible de charger les demandes de suppression' });
  }
  return res.json({ data });
};

export const updateAccountDeletionRequest = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const status = req.body?.status;
  if (!isRequestStatus(status)) {
    return res.status(400).json({ error: 'Statut de demande invalide' });
  }

  const { data, error } = await supabase
    .from('account_deletion_requests')
    .update({
      status,
      processed_at: status === 'completed' || status === 'rejected' ? new Date().toISOString() : null,
      processed_by: req.user?.id ?? null,
    })
    .eq('id', id)
    .select('id, user_id, email, full_name, reason, details, status, requested_at, processed_at')
    .maybeSingle();

  if (error) {
    logger.error('Erreur mise à jour demande de suppression (admin)', { id, error: error.message });
    return res.status(500).json({ error: 'Impossible de mettre à jour la demande' });
  }
  if (!data) return res.status(404).json({ error: 'Demande de suppression introuvable' });
  return res.json({ request: data });
};
