import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import {
  adminEmailAudienceSchema,
  adminEmailCampaignSchema,
  adminEmailTestSchema,
  updateAdminSettingsSchema,
} from '../lib/validation';
import {
  AdminEmailSender,
  EmailRecipient,
  isEmailProviderConfigured,
  sendAdminEmailBatch,
  sendAdminTextEmail,
} from '../services/email.service';

type AuthenticatedRequest = Request & { user?: { id: string } };
type EmailAudience = 'client' | 'artisan';

interface AdminSettings {
  platform_name: string;
  support_email: string;
  sender_name: string;
  sender_email: string;
  reply_to_email: string;
  updated_at: string;
  updated_by: string | null;
}

const SETTINGS_TABLE = 'admin_platform_settings';
const CAMPAIGNS_TABLE = 'admin_email_campaigns';
const CAMPAIGN_LIMIT = 5000;
const EMAIL_BATCH_SIZE = 500;
const USER_PAGE_SIZE = 1000;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Erreur inconnue du service e-mail.';

const getSettings = async () => {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select('platform_name, support_email, sender_name, sender_email, reply_to_email, updated_at, updated_by')
    .eq('id', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('Paramètres introuvables. Appliquez la migration 006_admin_platform_settings.sql.');
  }

  return data as AdminSettings;
};

const getSender = (settings: AdminSettings): AdminEmailSender => ({
  name: settings.sender_name,
  email: settings.sender_email,
  ...(settings.reply_to_email ? { replyToEmail: settings.reply_to_email } : {}),
});

const getAudienceRecipients = async (audience: EmailAudience): Promise<EmailRecipient[]> => {
  const profileIds = new Set<string>();

  for (let offset = 0; ; offset += USER_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', audience)
      .order('id')
      .range(offset, offset + USER_PAGE_SIZE - 1);

    if (error) throw error;
    for (const profile of data ?? []) {
      profileIds.add(profile.id);
    }

    if (!data || data.length < USER_PAGE_SIZE) break;
  }

  if (profileIds.size === 0) return [];

  const recipients = new Map<string, EmailRecipient>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USER_PAGE_SIZE,
    });

    if (error) throw error;
    for (const user of data.users) {
      if (profileIds.has(user.id) && user.email) {
        recipients.set(user.id, { email: user.email });
      }
    }

    if (data.users.length < USER_PAGE_SIZE) break;
  }

  return Array.from(recipients.values()).sort((a, b) =>
    a.email.localeCompare(b.email)
  );
};

export const getAdminSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    res.json({
      settings,
      emailProvider: {
        name: 'Brevo',
        configured: isEmailProviderConfigured(),
      },
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error('Impossible de récupérer les paramètres admin', { error: message });
    res.status(500).json({ error: message });
  }
};

export const updateAdminSettings = async (req: Request, res: Response) => {
  const validation = updateAdminSettingsSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Paramètres invalides.',
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

  try {
    const { data, error } = await supabase
      .from(SETTINGS_TABLE)
      .update({
        ...validation.data,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', true)
      .select('platform_name, support_email, sender_name, sender_email, reply_to_email, updated_at, updated_by')
      .single();

    if (error) throw error;
    res.json({ settings: data, emailProvider: { name: 'Brevo', configured: isEmailProviderConfigured() } });
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error('Impossible de mettre à jour les paramètres admin', { userId, error: message });
    res.status(500).json({ error: message });
  }
};

export const getEmailAudience = async (req: Request, res: Response) => {
  const validation = adminEmailAudienceSchema.safeParse(req.query.role);
  if (!validation.success) {
    return res.status(400).json({ error: 'Choisissez le segment client ou artisan.' });
  }

  try {
    const recipients = await getAudienceRecipients(validation.data);
    res.json({
      audience: validation.data,
      recipientCount: recipients.length,
      campaignLimit: CAMPAIGN_LIMIT,
      emailProviderConfigured: isEmailProviderConfigured(),
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error('Impossible de calculer le segment e-mail admin', { error: message });
    res.status(500).json({ error: message });
  }
};

export const getEmailCampaignHistory = async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from(CAMPAIGNS_TABLE)
      .select('id, audience, subject, recipient_count, sent_count, failed_count, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(data ?? []);
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error('Impossible de récupérer l’historique des campagnes e-mail', { error: message });
    res.status(500).json({ error: message });
  }
};

export const sendEmailTest = async (req: Request, res: Response) => {
  const validation = adminEmailTestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Saisissez une adresse e-mail valide.' });
  }
  if (!isEmailProviderConfigured()) {
    return res.status(503).json({ error: 'La clé API Brevo n’est pas configurée sur le serveur.' });
  }

  try {
    const settings = await getSettings();
    await sendAdminTextEmail(
      validation.data.to,
      `Test de configuration e-mail — ${settings.platform_name}`,
      `Votre configuration d’envoi e-mail pour ${settings.platform_name} fonctionne.`,
      getSender(settings)
    );
    res.json({ message: 'E-mail de test envoyé.' });
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error('Échec de l’envoi de l’e-mail de test admin', { error: message });
    res.status(502).json({ error: message });
  }
};

export const sendEmailCampaign = async (req: Request, res: Response) => {
  const validation = adminEmailCampaignSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Données de campagne invalides.',
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  if (!isEmailProviderConfigured()) {
    return res.status(503).json({ error: 'La clé API Brevo n’est pas configurée sur le serveur.' });
  }

  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

  const { audience, subject, body, expectedRecipientCount } = validation.data;

  try {
    const recipients = await getAudienceRecipients(audience);
    if (recipients.length !== expectedRecipientCount) {
      return res.status(409).json({
        error: 'Le nombre de destinataires a changé. Actualisez le segment et confirmez à nouveau.',
        recipientCount: recipients.length,
      });
    }
    if (recipients.length > CAMPAIGN_LIMIT) {
      return res.status(413).json({
        error: `La campagne dépasse la limite de ${CAMPAIGN_LIMIT} destinataires.`,
        recipientCount: recipients.length,
      });
    }
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'Aucun utilisateur avec une adresse e-mail dans ce segment.' });
    }

    const settings = await getSettings();
    const sender = getSender(settings);
    const content = `${body}\n\n— ${settings.platform_name}`;
    let sentCount = 0;
    let providerError: string | null = null;

    for (let offset = 0; offset < recipients.length; offset += EMAIL_BATCH_SIZE) {
      const batch = recipients.slice(offset, offset + EMAIL_BATCH_SIZE);
      try {
        await sendAdminEmailBatch(batch, subject, content, sender);
        sentCount += batch.length;
      } catch (error: unknown) {
        providerError = errorMessage(error);
        logger.error('Échec d’un lot de campagne e-mail admin', {
          audience,
          sentCount,
          failedCount: recipients.length - sentCount,
          error: providerError,
        });
        break;
      }
    }

    const failedCount = recipients.length - sentCount;
    const status = sentCount === 0 ? 'failed' : failedCount === 0 ? 'sent' : 'partial';
    const { error: historyError } = await supabase.from(CAMPAIGNS_TABLE).insert({
      created_by: userId,
      audience,
      subject,
      recipient_count: recipients.length,
      sent_count: sentCount,
      failed_count: failedCount,
      status,
    });

    if (historyError) {
      logger.error('Campagne envoyée mais historique e-mail non enregistré', {
        userId,
        audience,
        sentCount,
        failedCount,
        error: historyError.message,
      });
    }

    res.json({
      audience,
      recipientCount: recipients.length,
      sentCount,
      failedCount,
      status,
      historySaved: !historyError,
      ...(providerError && sentCount === 0
        ? { error: `Brevo a refusé la campagne : ${providerError}` }
        : providerError
          ? { warning: `Envoi partiel : ${providerError}` }
          : {}),
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    logger.error('Impossible d’envoyer la campagne e-mail admin', { audience, error: message });
    res.status(500).json({ error: message });
  }
};
