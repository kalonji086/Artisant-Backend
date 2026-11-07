export type ProfileRole = 'client' | 'artisan';
export type QuoteStatus = 'unassigned' | 'assigned' | 'pending' | 'accepted' | 'in_progress' | 'rejected' | 'completed';
export type EmployerRequestStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: ProfileRole | null;
  avatar_url: string | null;
  is_available: boolean | null;
  rating: number | null;
  address: string | null;
  city?: string | null;
  profession?: string | null;
  description?: string | null;
  email?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  country?: string | null;
  years_experience?: number | null;
  service_radius_km?: number | null;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  is_suspended?: boolean;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  created_at: string;
}

export interface UserUpdateBody {
  reason: string;
  full_name?: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  profession?: string | null;
  description?: string | null;
  role?: ProfileRole;
}

export interface Quote {
  id: string;
  client_id: string;
  artisan_id: string | null;
  latitude?: number | null;
  longitude?: number | null;
  service_id: string | null;
  description: string | null;
  category?: string | null;
  title?: string | null;
  urgency?: 'flexible' | 'normal' | 'urgent' | null;
  address?: string | null;
  budget?: number | string | null;
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
  servicesByCategory: { categoryId: string; category: string; count: number }[];
  artisansByService: { id: string; category: string; service: string; count: number }[];
  serviceStatsUnavailable: boolean;
  serviceCatalogAvailable: boolean;
  serviceAssignmentsAvailable: boolean;
  recentUsers: Pick<Profile, 'id' | 'full_name' | 'role' | 'avatar_url' | 'created_at'>[];
  recentQuotes: Quote[];
}
