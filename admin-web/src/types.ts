export type ProfileRole = 'client' | 'artisan';
export type QuoteStatus = 'pending' | 'accepted' | 'rejected' | 'completed';
export type EmployerRequestStatus = 'pending' | 'approved' | 'rejected';
export type EmailAudience = 'client' | 'artisan';

export interface AdminPlatformSettings {
  platform_name: string;
  support_email: string;
  sender_name: string;
  sender_email: string;
  reply_to_email: string;
  updated_at: string;
  updated_by: string | null;
}

export interface AdminEmailCampaign {
  id: string;
  audience: EmailAudience;
  subject: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  status: 'sent' | 'partial' | 'failed';
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: ProfileRole | null;
  avatar_url: string | null;
  is_available: boolean | null;
  rating: number | null;
  address: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  client_id: string;
  artisan_id: string;
  service_id: string | null;
  description: string | null;
  status: QuoteStatus;
  price: number | string | null;
  created_at: string;
  client_name?: string;
  artisan_name?: string;
}

export interface EmployerRequest {
  id: string;
  user_id: string | null;
  company_name: string;
  company_email: string;
  industry: string;
  contact_person: string;
  hiring_needs: string | null;
  expected_hires: number | null;
  status: EmployerRequestStatus;
  admin_notes: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface AdminStats {
  totals: {
    users: number;
    clients: number;
    artisans: number;
    activeArtisans: number;
    quotes: number;
    quotesPending: number;
    jobs: number;
    categories: number;
    employerRequestsPending: number;
  };
  quotesByStatus: { status: QuoteStatus; count: number }[];
  signupsByMonth: { month: string; count: number }[];
  servicesByCategory: { category: string; count: number }[];
  recentUsers: Pick<Profile, 'id' | 'full_name' | 'role' | 'avatar_url' | 'created_at'>[];
  recentQuotes: Quote[];
}
