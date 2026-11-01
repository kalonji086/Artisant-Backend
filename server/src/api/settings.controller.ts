import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendEmail, generateEmailTemplate } from '../lib/email';

type AuthenticatedRequest = Request & { user?: { id: string } };

export const getPlatformSettings = async (req: Request, res: Response) => {
  try {
    let { data, error } = await supabase
      .from('admin_platform_settings')
      .select('*')
      .single();

    // Si la table est vide, insérer une ligne par défaut
    if (error?.code === 'PGRST116') {
      console.log('[SETTINGS] Table empty, inserting default settings...');
      const { data: inserted, error: insertError } = await supabase
        .from('admin_platform_settings')
        .insert({
          id: true,
          platform_name: 'ARTISANTS',
          support_email: 'support@artisants.com',
          sender_name: 'ARTISANTS',
          sender_email: 'noreply@artisants.com',
          reply_to_email: '',
        })
        .select()
        .single();

      if (insertError) throw insertError;
      data = inserted;
    } else if (error) {
      throw error;
    }

    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la récupération des paramètres';
    logger.error('Erreur lors de la récupération des paramètres', { error: message });
    // Retourner les valeurs par défaut au lieu de l'erreur
    res.json({
      id: true,
      platform_name: 'ARTISANTS',
      support_email: 'support@artisants.com',
      sender_name: 'ARTISANTS',
      sender_email: 'noreply@artisants.com',
      reply_to_email: '',
      updated_at: new Date().toISOString(),
      updated_by: null,
    });
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

  const { recipientType, audience, subject, body, specificEmail, specificUserId } = req.body;

  if (!recipientType || !subject || !body) {
    return res.status(400).json({ error: 'Type de destinataire, sujet et contenu requis' });
  }

  if (!['all', 'specific', 'email'].includes(recipientType)) {
    return res.status(400).json({ error: 'Type de destinataire invalide' });
  }

  try {
    let recipients: string[] = [];

    // Déterminer les destinataires en fonction du type
    if (recipientType === 'all') {
      if (!audience || !['client', 'artisan'].includes(audience)) {
        return res.status(400).json({ error: 'Public requis pour "Tous"' });
      }
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', audience);

      if (error) throw error;

      // Récupérer les emails depuis auth.users
      if (profiles && profiles.length > 0) {
        const userIds = profiles.map((p) => p.id);
        const { data: users, error: userError } = await supabase.auth.admin.listUsers();

        if (userError) throw userError;

        recipients = (users?.users || [])
          .filter((u) => userIds.includes(u.id))
          .map((u) => u.email || '')
          .filter(Boolean);
      }
    } else if (recipientType === 'specific') {
      if (!specificUserId) {
        return res.status(400).json({ error: 'User ID requis pour un utilisateur spécifique' });
      }
      const { data: user, error } = await supabase.auth.admin.getUserById(specificUserId);
      if (error || !user?.user?.email) throw new Error('Utilisateur non trouvé');
      recipients = [user.user.email];
    } else if (recipientType === 'email') {
      if (!specificEmail || !specificEmail.includes('@')) {
        return res.status(400).json({ error: 'Email valide requis' });
      }
      recipients = [specificEmail];
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'Aucun destinataire trouvé' });
    }

    // Générer le template d'email avec le logo
    const logoUrl = `${process.env.APP_URL || 'http://localhost:3000'}/logo.png`;
    const htmlContent = generateEmailTemplate(subject, body, undefined, undefined, logoUrl);

    // Envoyer l'email via Brevo
    console.log('[EMAIL] Sending to', recipients.length, 'recipients...');
    const emailResult = await sendEmail({
      to: recipients,
      subject,
      htmlContent,
    });
    console.log('[EMAIL] Sent successfully:', emailResult.messageId);

    // Enregistrer la campagne en base de données
    console.log('[EMAIL] Recording campaign...');
    const { data: campaign, error: campaignError } = await supabase
      .from('admin_email_campaigns')
      .insert({
        created_by: admin.id,
        audience: audience || recipientType,
        subject,
        recipient_count: recipients.length,
        sent_count: recipients.length,
        failed_count: 0,
        status: 'sent',
      })
      .select()
      .single();

    if (campaignError) {
      console.error('[EMAIL] Campaign insert error:', campaignError);
      logger.warn('Campaign recording failed', { error: campaignError.message });
      // Continue anyway since email was sent
    } else {
      console.log('[EMAIL] Campaign recorded:', campaign?.id);
    }

    logger.info('Email campaign sent', {
      admin_id: admin.id,
      recipient_count: recipients.length,
      recipient_type: recipientType,
      brevo_message_id: emailResult.messageId,
    });

    res.json({
      success: true,
      message: `Email envoyé à ${recipients.length} destinataire(s)`,
      messageId: emailResult.messageId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de l\'envoi de l\'email';
    logger.error('Erreur lors de l\'envoi de l\'email', { error: message, admin_id: admin.id });
    res.status(500).json({ error: message });
  }
};
