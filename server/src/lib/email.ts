import { logger } from './logger';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'noreply@artisants.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'ARTISANTS';

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
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL,
        },
        to: recipients,
        subject: options.subject,
        htmlContent: options.htmlContent,
        textContent: options.textContent || options.htmlContent.replace(/<[^>]*>/g, ''),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `Brevo API error: ${response.status}`);
    }

    const data = await response.json();

    logger.info('Email sent via Brevo', {
      messageId: data.messageId,
      recipients: recipients.length,
    });

    return data;
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
  ctaUrl?: string,
  logoUrl?: string,
  footerHtml?: string
): string => {
  // Logo par défaut si pas fourni
  const logo = logoUrl || 'https://via.placeholder.com/80/3b82f6/ffffff?text=A';

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background-color: #f8f9fa; }
    .wrapper { width: 100%; background-color: #f8f9fa; padding: 20px 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px 30px; text-align: center; }
    .logo-container { margin-bottom: 20px; }
    .logo { width: 80px; height: 80px; border-radius: 50%; background: rgba(255,255,255,0.2); display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .logo img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .brand-name { color: white; font-size: 26px; font-weight: 700; margin: 0; letter-spacing: 0.5px; }
    .brand-subtitle { color: rgba(255,255,255,0.95); font-size: 13px; margin: 6px 0 0 0; font-weight: 500; letter-spacing: 1px; }
    .content { padding: 40px 30px; color: #1f2937; }
    .content-title { font-size: 22px; font-weight: 600; color: #111827; margin: 0 0 16px 0; line-height: 1.3; }
    .content-text { font-size: 15px; line-height: 1.6; color: #4b5563; margin: 0 0 20px 0; }
    .cta { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 20px 0; transition: opacity 0.2s; }
    .cta:hover { opacity: 0.95; }
    .divider { height: 1px; background-color: #e5e7eb; margin: 24px 0; }
    .footer { background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer-text { margin: 0; font-size: 13px; color: #6b7280; line-height: 1.6; }
    .footer-text strong { color: #374151; }
    .social-links { margin-top: 20px; }
    .social-links a { color: #3b82f6; text-decoration: none; margin: 0 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-container">
          <div class="logo">
            <img src="${logo}" alt="ARTISANTS Logo">
          </div>
        </div>
        <p class="brand-name">ARTISANTS</p>
        <p class="brand-subtitle">PLATEFORME</p>
      </div>

      <div class="content">
        <h1 class="content-title">${title}</h1>
        <div class="content-text">${content}</div>
        ${ctaText && ctaUrl ? `<a href="${ctaUrl}" class="cta">${ctaText}</a>` : ''}
      </div>

      <div class="footer">
        ${
          footerHtml ??
          `<p class="footer-text"><strong>ARTISANTS</strong> — Plateforme de mise en relation artisans & clients</p>
        <p class="footer-text" style="margin-top: 20px; font-size: 12px; color: #9ca3af;">© 2026 ARTISANTS. Tous droits réservés.</p>`
        }
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
};
