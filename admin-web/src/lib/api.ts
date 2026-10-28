import axios from 'axios';
import { supabase } from './supabase';
import type {
  AdminEmailCampaign,
  AdminPlatformSettings,
  AdminStats,
  EmailAudience,
  EmployerRequest,
  EmployerRequestStatus,
  Paginated,
  Profile,
  Quote,
} from '../types';

interface AdminSettingsResponse {
  settings: AdminPlatformSettings;
  emailProvider: { name: string; configured: boolean };
}

interface EmailAudienceResponse {
  audience: EmailAudience;
  recipientCount: number;
  campaignLimit: number;
  emailProviderConfigured: boolean;
}

interface EmailCampaignResponse {
  audience: EmailAudience;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: AdminEmailCampaign['status'];
  historySaved: boolean;
  error?: string;
  warning?: string;
}

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : '/api/v1');

const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Injecte le jeton de session Supabase sur chaque requête API
apiClient.interceptors.request.use(async (config) => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers.set('Authorization', `Bearer ${session.access_token}`);
    }
  } catch (error) {
    console.warn('[admin-web] Session Supabase indisponible pour la requête API:', error);
  }
  return config;
});

export const AdminService = {
  getStats: () => apiClient.get<AdminStats>('/admin/stats'),

  getUsers: (params?: { search?: string; role?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<Profile>>('/admin/users', { params }),

  getQuotes: (params?: { status?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<Quote>>('/admin/quotes', { params }),

  getEmployerRequests: (params?: { status?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<EmployerRequest>>('/admin/employer-requests', { params }),

  getSettings: () => apiClient.get<AdminSettingsResponse>('/admin/settings'),

  updateSettings: (settings: Omit<AdminPlatformSettings, 'updated_at' | 'updated_by'>) =>
    apiClient.put<AdminSettingsResponse>('/admin/settings', settings),

  sendTestEmail: (to: string) =>
    apiClient.post<{ message: string }>('/admin/email/test', { to }),

  getEmailAudience: (role: EmailAudience) =>
    apiClient.get<EmailAudienceResponse>('/admin/email/audience', { params: { role } }),

  sendEmailCampaign: (campaign: {
    audience: EmailAudience;
    subject: string;
    body: string;
    expectedRecipientCount: number;
    confirmed: true;
  }) => apiClient.post<EmailCampaignResponse>('/admin/email/campaigns', campaign),

  getEmailCampaignHistory: () => apiClient.get<AdminEmailCampaign[]>('/admin/email/campaigns'),

  updateEmployerRequest: (
    id: string,
    body: { status: Exclude<EmployerRequestStatus, 'pending'>; admin_notes?: string }
  ) => apiClient.patch<EmployerRequest>(`/admin/employer-requests/${id}`, body),
};

/** Extrait un message utilisateur lisible depuis une erreur Axios/JS. */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: string } | undefined;
    if (body?.error) return body.error;
    if (!err.response) {
      return 'Serveur API injoignable — vérifiez que le server/ tourne (npm run dev) et sa variable VITE_API_URL.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
};

export default apiClient;
