declare module 'sib-api-v3-sdk' {
  export interface ApiClient {
    static instance: ApiClient;
    authentications: Record<string, unknown>;
  }

  export interface SendSmtpEmail {
    subject?: string;
    htmlContent?: string;
    sender?: { name: string; email: string };
    to?: { email: string }[];
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
    sender: { name: string; email: string };
    to: { email: string }[];
  }

  export class TransactionalEmailsApi {
    sendTransacEmail(sendSmtpEmail: SendSmtpEmail): Promise<{ messageId: string }>;
  }
}
