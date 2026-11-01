import axios from 'axios';
import { logger } from './logger';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'noreply@artisants.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'ARTISANTS';

const brevoClient = axios.create({
  baseURL: 'https://api.brevo.com/v3',
  headers: {
    'api-key': BREVO_API_KEY,
    'Content-Type': 'application/json',
  },
});

export interface EmailOptions {
  to: string | string[];
  subject: string;
  htmlContent: string;
  textContent?: string;
}

/** Envoie un email via Brevo */
export const sendEmail = async (options: EmailOptions) => {
  if (!BREVO_API_KEY) {
    logger.error('BREVO_API_KEY not configured');
    throw new Error('Email service not configured');
  }

  const recipients = Array.isArray(options.to)
    ? options.to.map((email) => ({ email }))
    : [{ email: options.to }];

  try {
    const response = await brevoClient.post('/smtp/email', {
      sender: {
        name: BREVO_SENDER_NAME,
        email: BREVO_SENDER_EMAIL,
      },
      to: recipients,
      subject: options.subject,
      htmlContent: options.htmlContent,
      textContent: options.textContent || options.htmlContent.replace(/<[^>]*>/g, ''),
    });

    logger.info('Email sent via Brevo', {
      messageId: response.data.messageId,
      recipients: recipients.length,
    });

    return response.data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send email';
    logger.error('Failed to send email via Brevo', { error: message });
    throw error;
  }
};

/** Génère un template d'email HTML avec le style de ARTISANTS */
export const generateEmailTemplate = (
  title: string,
  content: string,
  ctaText?: string,
  ctaUrl?: string
): string => {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; background-color: #f9fafb; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px 20px; text-align: center; }
    .logo { color: white; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 1px; }
    .logo-sub { color: rgba(255,255,255,0.9); font-size: 12px; margin: 5px 0 0 0; letter-spacing: 2px; }
    .content { padding: 40px 20px; color: #1f2937; }
    .title { font-size: 24px; font-weight: bold; color: #1f2937; margin: 0 0 20px 0; }
    .text { font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px 0; }
    .cta { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 12px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .cta:hover { opacity: 0.9; }
    .footer { background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
    .footer-text { margin: 0; }
    .divider { height: 1px; background-color: #e5e7eb; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p class="logo">ARTISANTS</p>
      <p class="logo-sub">PLATEFORME</p>
    </div>

    <div class="content">
      <h1 class="title">${title}</h1>
      <div class="text">${content}</div>
      ${ctaText && ctaUrl ? `<a href="${ctaUrl}" class="cta">${ctaText}</a>` : ''}
    </div>

    <div class="footer">
      <p class="footer-text">© 2026 ARTISANTS. Tous droits réservés.</p>
      <p class="footer-text">Cette plateforme met en relation artisans et clients pour des services de qualité.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
};
