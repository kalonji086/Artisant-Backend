import axios from 'axios';
import { supabase } from './supabase';
import type { AdminStats, EmployerRequest, EmployerRequestStatus, Paginated, Profile, Quote, UserUpdateBody } from '../types';

const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Injecte le jeton de session Supabase sur chaque requête API
// Rafraîchit automatiquement si le token est absent mais la session existe
apiClient.interceptors.request.use(async (config) => {
  try {
    let {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token && session?.user) {
      await supabase.auth.refreshSession();
      const result = await supabase.auth.getSession();
      session = result.data.session;
    }

    if (session?.access_token) {
      config.headers.set('Authorization', `Bearer ${session.access_token}`);
    }
  } catch (error) {
    console.warn('[admin-web] Session Supabase indisponible pour la requête API:', error);
  }
  return config;
});

// Gère les erreurs d'authentification (401 = token expiré/invalide)
// Déconnecte et redirige vers la page de login
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await supabase.auth.signOut();
      // Utilise le chemin relatif avec la base de l'app
      const base = import.meta.env.BASE_URL || '/admin/';
      window.location.href = `${base}login`.replace(/\/+/g, '/');
    }
    return Promise.reject(error);
  }
);

export const api = {
  async get<T = any>(url: string): Promise<T> {
    const response = await apiClient.get<T>(url);
    return response.data;
  },

  async post<T = any>(url: string, data?: any): Promise<T> {
    const response = await apiClient.post<T>(url, data);
    return response.data;
  },

  async put<T = any>(url: string, data?: any): Promise<T> {
    const response = await apiClient.put<T>(url, data);
    return response.data;
  },

  async patch<T = any>(url: string, data?: any): Promise<T> {
    const response = await apiClient.patch<T>(url, data);
    return response.data;
  },

  async delete<T = any>(url: string): Promise<T> {
    const response = await apiClient.delete<T>(url);
    return response.data;
  },
};

export const AdminService = {
  getStats: () => apiClient.get<AdminStats>('/admin/stats'),

  getUsers: (params?: { search?: string; role?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<Profile>>('/admin/users', { params }),

  getQuotes: (params?: { status?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<Quote>>('/admin/quotes', { params }),

  getQuoteTemplates: () =>
    apiClient.get<{ template_key: 'fixed' | 'detailed'; name: string; html_content: string; updated_at: string }[]>('/admin/quote-templates'),

  updateQuoteTemplate: (key: 'fixed' | 'detailed', body: { name: string; html_content: string }) =>
    apiClient.put(`/admin/quote-templates/${key}`, body),

  getEmployerRequests: (params?: { status?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<EmployerRequest>>('/admin/employer-requests', { params }),

  updateEmployerRequest: (
    id: string,
    body: { status: Exclude<EmployerRequestStatus, 'pending'>; admin_notes?: string }
  ) => apiClient.patch<EmployerRequest>(`/admin/employer-requests/${id}`, body),

  updateUser: (id: string, body: UserUpdateBody) =>
    apiClient.patch<Profile>(`/admin/users/${id}`, body),

  suspendUser: (id: string, reason: string) =>
    apiClient.post<Profile>(`/admin/users/${id}/suspend`, { reason }),

  reactivateUser: (id: string, reason: string) =>
    apiClient.post<Profile>(`/admin/users/${id}/reactivate`, { reason }),

  deleteUser: (id: string, reason: string) =>
    apiClient.post<{ success: boolean }>(`/admin/users/${id}/delete`, { reason }),
};

/** Extrait un message utilisateur lisible depuis une erreur Axios/JS. */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: string } | undefined;
    if (body?.error) return body.error;
    if (!err.response) {
      return 'API indisponible — vérifiez que le service API répond sur /api/v1.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
};

export default apiClient;
