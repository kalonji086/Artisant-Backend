declare module 'sib-api-v3-sdk' {
  export interface ApiClient {
    static instance: ApiClient;
    authentications: Record<string, unknown>;
  }

  export interface SendSmtpEmail {
    subject?: string;
    htmlContent?: string;
    textContent?: string;
    sender?: { name: string; email: string };
    to?: { email: string }[];
    replyTo?: { email: string; name?: string };
    messageVersions?: Array<{ to: { email: string; name?: string }[] }>;
  }

  export class ApiClient {
    static instance: ApiClient;
    authentications: Record<string, unknown>;
  }

  export class TransactionalEmailsApi {
    sendTransacEmail(sendSmtpEmail: SendSmtpEmail): Promise<{ messageId: string }>;
  }

  export const ApiClient: {
    instance: ApiClient;
    authenticated: (name: string, auth: unknown) => void;
  };

  export class SendSmtpEmail {
    subject: string;
    htmlContent: string;
    textContent: string;
    sender: { name: string; email: string };
    to: { email: string }[];
    replyTo: { email: string; name?: string };
    messageVersions: Array<{ to: { email: string; name?: string }[] }>;
  }

  export class TransactionalEmailsApi {
    sendTransacEmail(sendSmtpEmail: SendSmtpEmail): Promise<{ messageId: string }>;
  }
}
