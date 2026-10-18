import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface AdminProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  avatar_url: string | null;
}

interface AdminAuthContextType {
  session: Session | null;
  profile: AdminProfile | null;
  isLoading: boolean;
  isAdmin: boolean;
  /** Retourne null si OK, sinon un message d'erreur utilisateur. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

const fetchProfile = async (userId: string): Promise<AdminProfile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[admin-web] Impossible de lire le profil:', error.message);
    return null;
  }
  return (data as AdminProfile | null) ?? null;
};

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) {
          setProfile(await fetchProfile(data.session.user.id));
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void init();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        void fetchProfile(newSession.user.id).then(setProfile);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return error.message === 'Invalid login credentials'
        ? 'Email ou mot de passe incorrect.'
        : `Connexion impossible : ${error.message}`;
    }

    const fetched = await fetchProfile(data.user.id);
    if (!fetched || fetched.role !== 'admin') {
      await supabase.auth.signOut();
      return "Accès réservé aux administrateurs : ce compte n'a pas le rôle admin.";
    }

    setProfile(fetched);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      isLoading,
      isAdmin: profile?.role === 'admin',
      signIn,
      signOut,
    }),
    [session, profile, isLoading, signIn, signOut]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export const useAdminAuth = (): AdminAuthContextType => {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth doit être utilisé dans <AdminAuthProvider>');
  }
  return ctx;
};
