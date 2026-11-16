import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

type AuthenticatedRequest = Request & { user?: { id: string } };
type SupportRequestStatus = 'pending' | 'resolved';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getSupportRequests = async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('support_requests')
    .select('id, full_name, email, message, status, submitted_at, processed_at')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('Erreur lecture des demandes de support (admin)', { error: error.message });
    return res.status(500).json({ error: 'Impossible de charger les demandes de support' });
  }
  return res.json({ data });
};

export const updateSupportRequestStatus = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const status = req.body?.status;
  if (!UUID.test(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  if (status !== 'pending' && status !== 'resolved') {
    return res.status(400).json({ error: 'Statut de demande invalide' });
  }

  const { data, error } = await supabase
    .from('support_requests')
    .update({
      status,
      processed_at: status === 'resolved' ? new Date().toISOString() : null,
      processed_by: status === 'resolved' ? req.user?.id ?? null : null,
    })
    .eq('id', id)
    .select('id, full_name, email, message, status, submitted_at, processed_at')
    .maybeSingle();

  if (error) {
    logger.error('Erreur mise à jour de la demande de support', { id, error: error.message });
    return res.status(500).json({ error: 'Impossible de mettre à jour la demande de support' });
  }
  if (!data) return res.status(404).json({ error: 'Demande de support introuvable' });
  return res.json({ request: data });
};
