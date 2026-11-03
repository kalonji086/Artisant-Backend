import { api } from './api';
import type { Pagination } from '../types';

export interface Segment {
  audience?: 'all' | 'client' | 'artisan';
  profession?: string;
  city?: string;
  emails?: string[];
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled';
export type ScheduleType = 'now' | 'once' | 'recurring';
export type Recurrence = 'daily' | 'weekly' | 'monthly';

export interface Campaign {
  id: string;
  name: string | null;
  subject: string;
  html_content: string | null;
  segment: Segment | null;
  schedule_type: ScheduleType;
  scheduled_at: string | null;
  recurrence: Recurrence | null;
  status: CampaignStatus;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html_content: string;
  created_at: string;
}

export interface CampaignInput {
  name?: string;
  subject: string;
  html: string;
  segment: Segment;
  scheduleType: ScheduleType;
  scheduledAt?: string | null;
  recurrence?: Recurrence | null;
  draft?: boolean;
}

const base = '/admin/marketing';

export const Marketing = {
  listCampaigns: (params: { status?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 20));
    return api.get<{ data: Campaign[]; pagination: Pagination }>(`${base}/campaigns?${q}`);
  },
  create: (input: CampaignInput) => api.post<Campaign>(`${base}/campaigns`, input),
  update: (id: string, input: CampaignInput) => api.patch<Campaign>(`${base}/campaigns/${id}`, input),
  sendNow: (id: string) => api.post(`${base}/campaigns/${id}/send`),
  cancel: (id: string) => api.post(`${base}/campaigns/${id}/cancel`),
  remove: (id: string) => api.delete(`${base}/campaigns/${id}`),
  bulkDelete: (ids: string[]) => api.post<{ deleted: number }>(`${base}/campaigns/bulk-delete`, { ids }),
  clearHistory: () => api.delete<{ deleted: number }>(`${base}/campaigns`),
  sendTest: (body: { to: string; subject: string; html: string }) => api.post(`${base}/test`, body),
  countAudience: (segment: Segment) => api.post<{ count: number }>(`${base}/audience`, { segment }),
  listTemplates: () => api.get<{ data: EmailTemplate[] }>(`${base}/templates`),
  saveTemplate: (body: { name: string; subject: string; html: string }) =>
    api.post<EmailTemplate>(`${base}/templates`, body),
  deleteTemplate: (id: string) => api.delete(`${base}/templates/${id}`),
};
