import { supabase } from './supabase';

export interface ArtisanSuggestion {
  id: string;
  full_name: string | null;
  phone: string | null;
  profession: string | null;
  city: string | null;
  rating: number | null;
  is_available: boolean;
  open_quotes: number;
  distance_m: number | null;
}

export interface QuoteSuggestion {
  id: string;
  client_name: string | null;
  description: string | null;
  status: string;
  created_at: string;
  distance_m: number | null;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T;
}

export const Dispatch = {
  async suggestArtisans(quoteId: string, limit = 10) {
    return unwrap<ArtisanSuggestion[]>(
      await supabase.rpc('admin_suggest_artisans', { p_quote_id: quoteId, p_limit: limit })
    );
  },

  async suggestQuotes(artisanId: string, limit = 10) {
    return unwrap<QuoteSuggestion[]>(
      await supabase.rpc('admin_suggest_quotes', { p_artisan_id: artisanId, p_limit: limit })
    );
  },

  async assign(quoteId: string, artisanId: string) {
    const { error } = await supabase.rpc('admin_assign_quote', {
      p_quote_id: quoteId,
      p_artisan_id: artisanId,
    });
    if (error) throw new Error(error.message);
  },
};

export function formatDistance(meters: number | null): string {
  if (meters == null) return 'position inconnue';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
