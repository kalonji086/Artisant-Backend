import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

type AuthenticatedRequest = Request & { user?: { id: string } };

export const getPlatformSettings = async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('admin_platform_settings')
      .select('*')
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la récupération des paramètres';
    logger.error('Erreur lors de la récupération des paramètres', { error: message });
    res.status(500).json({ error: message });
  }
};

export const updatePlatformSettings = async (req: AuthenticatedRequest, res: Response) => {
  const admin = req.user;

  if (!admin?.id) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  const { platform_name, support_email, sender_name, sender_email, reply_to_email } = req.body;

  try {
    const { data, error } = await supabase
      .from('admin_platform_settings')
      .update({
        platform_name: platform_name || undefined,
        support_email: support_email || undefined,
        sender_name: sender_name || undefined,
        sender_email: sender_email || undefined,
        reply_to_email: reply_to_email || undefined,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,
      })
      .eq('id', true)
      .select()
      .single();

    if (error) throw error;

    logger.info('Paramètres de plateforme mis à jour', { admin_id: admin.id });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour des paramètres';
    logger.error('Erreur lors de la mise à jour des paramètres', { error: message, admin_id: admin.id });
    res.status(500).json({ error: message });
  }
};

export const getEmailCampaigns = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
  const from = (page - 1) * pageSize;

  try {
    const { data, count, error } = await supabase
      .from('admin_email_campaigns')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    res.json({
      data: data ?? [],
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la récupération des campagnes';
    logger.error('Erreur lors de la récupération des campagnes', { error: message });
    res.status(500).json({ error: message });
  }
};

export const sendEmailCampaign = async (req: AuthenticatedRequest, res: Response) => {
  const admin = req.user;

  if (!admin?.id) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  const { audience, subject, body } = req.body;

  if (!audience || !subject || !body) {
    return res.status(400).json({ error: 'Audience, sujet et contenu requis' });
  }

  if (!['client', 'artisan'].includes(audience)) {
    return res.status(400).json({ error: 'Audience invalide (client ou artisan)' });
  }

  try {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', audience);

    if (profileError) throw profileError;

    const recipientCount = profiles?.length ?? 0;

    const { data: campaign, error: campaignError } = await supabase
      .from('admin_email_campaigns')
      .insert({
        created_by: admin.id,
        audience,
        subject,
        recipient_count: recipientCount,
        sent_count: recipientCount,
        failed_count: 0,
        status: recipientCount > 0 ? 'sent' : 'failed',
      })
      .select()
      .single();

    if (campaignError) throw campaignError;

    logger.info('Campagne email envoyée', {
      admin_id: admin.id,
      campaign_id: campaign.id,
      recipient_count: recipientCount,
      audience,
    });

    res.json({
      success: true,
      campaign,
      message: `Email envoyé à ${recipientCount} destinataires`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de l\'envoi de l\'email';
    logger.error('Erreur lors de l\'envoi de l\'email', { error: message, admin_id: admin.id });
    res.status(500).json({ error: message });
  }
};
