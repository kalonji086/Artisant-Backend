import { logger } from '../lib/logger';
import SibApiV3Sdk = require('sib-api-v3-sdk');

export interface AdminEmailSender {
  name: string;
  email: string;
  replyToEmail?: string;
}

export interface EmailRecipient {
  email: string;
  name?: string;
}

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'] as { apiKey: string };
apiKey.apiKey = process.env.BREVO_API_KEY || '';

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

export const isEmailProviderConfigured = () => Boolean(process.env.BREVO_API_KEY?.trim());

const requireEmailProvider = () => {
  if (!isEmailProviderConfigured()) {
    throw new Error('Le fournisseur e-mail Brevo n’est pas configuré sur le serveur.');
  }
};

const applySender = (email: SibApiV3Sdk.SendSmtpEmail, sender?: AdminEmailSender) => {
  email.sender = {
    name: sender?.name || 'ARTISANTS',
    email: sender?.email || 'noreply@artisants.com',
  };
  if (sender?.replyToEmail) {
    email.replyTo = { email: sender.replyToEmail, name: sender.name };
  }
};

export const EmailTemplates = {
  WELCOME_ARTISAN: (name: string) => ({
    subject: 'Bienvenue chez ARTISANTS !',
    htmlContent: `
      <h1>Bienvenue ${name} !</h1>
      <p>Nous sommes ravis de vous compter parmi nos artisans.</p>
      <p>Votre profil est en cours de validation. Vous serez informé dès que vous pourrez commencer à recevoir des demandes de devis.</p>
      <br/>
      <p>L'équipe ARTISANTS</p>
    `
  }),
  WELCOME_CLIENT: (name: string) => ({
    subject: 'Bienvenue sur ARTISANTS',
    htmlContent: `
      <h1>Bonjour ${name},</h1>
      <p>Merci d'avoir rejoint ARTISANTS. Trouvez dès maintenant les meilleurs professionnels pour vos travaux.</p>
      <br/>
      <p>L'équipe ARTISANTS</p>
    `
  }),
  NEW_QUOTE_REQUEST: (artisanName: string, clientName: string) => ({
    subject: 'Nouvelle demande de devis !',
    htmlContent: `
      <h1>Bonjour ${artisanName},</h1>
      <p>Vous avez reçu une nouvelle demande de devis de la part de <b>${clientName}</b>.</p>
      <p>Connectez-vous à votre dashboard pour répondre à cette demande.</p>
      <br/>
      <p>L'équipe ARTISANTS</p>
    `
  })
};

export const sendEmail = async (to: string, template: { subject: string, htmlContent: string }) => {
  requireEmailProvider();
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.subject = template.subject;
  sendSmtpEmail.htmlContent = template.htmlContent;
  applySender(sendSmtpEmail);
  sendSmtpEmail.to = [{ email: to }];

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info('Email envoyé avec succès. MessageId:', data.messageId);
    return data;
  } catch (error) {
    logger.error('Erreur lors de l\'envoi de l\'email:', error);
    throw error;
  }
};

export const sendAdminTextEmail = async (
  to: string,
  subject: string,
  textContent: string,
  sender: AdminEmailSender
) => {
  requireEmailProvider();

  const message = new SibApiV3Sdk.SendSmtpEmail();
  message.subject = subject;
  message.textContent = textContent;
  applySender(message, sender);
  message.to = [{ email: to }];

  return apiInstance.sendTransacEmail(message);
};

export const sendAdminEmailBatch = async (
  recipients: EmailRecipient[],
  subject: string,
  textContent: string,
  sender: AdminEmailSender
) => {
  requireEmailProvider();
  if (recipients.length === 0 || recipients.length > 500) {
    throw new Error('Une campagne doit contenir entre 1 et 500 destinataires par lot.');
  }

  const message = new SibApiV3Sdk.SendSmtpEmail();
  message.subject = subject;
  message.textContent = textContent;
  applySender(message, sender);
  message.messageVersions = recipients.map((recipient) => ({
    to: [{
      email: recipient.email,
      ...(recipient.name ? { name: recipient.name } : {}),
    }],
  }));

  return apiInstance.sendTransacEmail(message);
};
