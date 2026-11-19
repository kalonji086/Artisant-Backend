export type ProfileRole = 'client' | 'artisan';
export type QuoteStatus = 'unassigned' | 'assigned' | 'pending' | 'accepted' | 'rejected' | 'completed';
export type EmployerRequestStatus = 'pending' | 'approved' | 'rejected';
export type ArtisanBusinessType = 'enterprise' | 'subcontractor';
export type ArtisanBusinessModule =
  | 'dashboard' | 'jobs' | 'applications' | 'artisans' | 'projects' | 'messages'
  | 'contracts' | 'payments' | 'favorites' | 'reports' | 'team' | 'profile' | 'support';
export type ArtisanBusinessVerificationStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'revoked';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: ProfileRole | null;
  business_type?: ArtisanBusinessType | null;
  is_blocked: boolean;
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
  created_at: string;
}

export interface AuthLoginSecurityEvent {
  id: string;
  created_at: string;
  user_id: string | null;
  masked_identifier: string;
  ip_address: string | null;
  platform: string | null;
  device_model: string | null;
  failed_attempts: number;
  lock_hours: number;
  locked_until: string;
  resolved_at: string | null;
  resolved_by: string | null;
  user: Pick<Profile, 'id' | 'full_name' | 'role'> | null;
  is_blocked: boolean;
}

export interface UserPushDevice {
  device_ref: string;
  token_hint: string;
  platform: 'ios' | 'android' | 'unknown';
  created_at: string | null;
  updated_at: string;
  revoked_at: string | null;
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

export interface ArtisanBusinessVerification {
  id: string;
  user_id: string;
  business_type: ArtisanBusinessType;
  company_name: string;
  country: string;
  registration_number: string;
  tax_number: string;
  company_address: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  status: ArtisanBusinessVerificationStatus;
  assigned_modules: ArtisanBusinessModule[];
  review_note: string | null;
  documents: Record<'registration' | 'tax' | 'representative_id' | 'authorization', {
    path: string;
    signed_url: string;
  }>;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
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
    enterprises: number;
    subcontractors: number;
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
