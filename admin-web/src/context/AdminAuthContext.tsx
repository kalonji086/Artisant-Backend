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
  profileReady: boolean;
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
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) {
          const fetched = await fetchProfile(data.session.user.id);
          if (active) {
            setProfile(fetched);
            setProfileReady(true);
          }
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void init();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        void fetchProfile(newSession.user.id).then((fetched) => {
          if (active) {
            setProfile(fetched);
            setProfileReady(true);
          }
        });
      } else {
        setProfile(null);
        setProfileReady(true);
      }
    });

    const unsub = (subscription as unknown as { unsubscribe: () => void }).unsubscribe;
    return () => {
      active = false;
      if (unsub) unsub();
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
    setProfileReady(true);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setProfileReady(true);
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      isLoading,
      isAdmin: profile?.role === 'admin',
      profileReady,
      signIn,
      signOut,
    }),
    [session, profile, isLoading, profileReady, signIn, signOut]
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
