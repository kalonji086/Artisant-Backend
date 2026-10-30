import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const isValidSupabaseUrl = (value: string | undefined): value is string => {
  if (!value) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

const isValidSupabaseKey = (value: string | undefined): value is string =>
  Boolean(value && (value.startsWith('eyJ') || value.startsWith('sb_publishable_')));

export const supabaseConfigError =
  !isValidSupabaseUrl(supabaseUrl)
    ? 'URL Supabase absente ou invalide. Vérifiez VITE_SUPABASE_URL.'
    : !isValidSupabaseKey(supabaseAnonKey)
      ? 'Clé publique Supabase absente ou invalide. Vérifiez VITE_SUPABASE_ANON_KEY et reconstruisez le dashboard.'
      : null;

if (supabaseConfigError) {
  console.error(`[admin-web] ${supabaseConfigError}`);
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
