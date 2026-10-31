import axios from 'axios';
import { supabase } from './supabase';
import type { AdminStats, EmployerRequest, EmployerRequestStatus, Paginated, Profile, Quote } from '../types';

const apiClient = axios.create({
  baseURL: '/api/v1',
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
      return 'API indisponible — vérifiez que le service API répond sur /api/v1.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
};

export default apiClient;
