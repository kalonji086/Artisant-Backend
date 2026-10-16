const SibApiV3Sdk = require('sib-api-v3-sdk');

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

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
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.subject = template.subject;
  sendSmtpEmail.htmlContent = template.htmlContent;
  sendSmtpEmail.sender = { name: "ARTISANTS", email: "noreply@artisants.com" }; // À configurer dans Brevo
  sendSmtpEmail.to = [{ email: to }];

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Email envoyé avec succès. MessageId:', data.messageId);
    return data;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error);
    throw error;
  }
};
