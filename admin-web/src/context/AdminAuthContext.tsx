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
import { supabase, supabaseConfigError } from '../lib/supabase';

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
    let authStateObserved = false;
    let profileRequest = 0;

    const applySession = (newSession: Session | null) => {
      setSession(newSession);
      setProfile(null);

      if (!newSession?.user) {
        profileRequest += 1;
        setProfileReady(true);
        return;
      }

      setProfileReady(false);
      const requestId = ++profileRequest;
      void fetchProfile(newSession.user.id).then((fetched) => {
        if (active && requestId === profileRequest) {
          setProfile(fetched);
          setProfileReady(true);
        }
      });
    };

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;
        if (!authStateObserved) applySession(data.session);
      } catch (error) {
        console.warn('[admin-web] Impossible de restaurer la session:', error);
        if (active && !authStateObserved) applySession(null);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      authStateObserved = true;
      applySession(newSession);
    });

    return () => {
      active = false;
      profileRequest += 1;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (supabaseConfigError) return supabaseConfigError;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message === 'Invalid login credentials') {
        return 'Email ou mot de passe incorrect.';
      }
      if (/invalid api key/i.test(error.message)) {
        return 'Clé API Supabase invalide. Vérifiez VITE_SUPABASE_ANON_KEY dans la configuration de déploiement, puis reconstruisez le dashboard.';
      }
      return `Connexion impossible : ${error.message}`;
    }

    setProfileReady(false);
    const fetched = await fetchProfile(data.user.id);
    if (!fetched || fetched.role !== 'admin') {
      await supabase.auth.signOut();
      setProfile(null);
      setProfileReady(true);
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
