import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { useAdminAuth } from '../context/AdminAuthContext';
import { supabaseConfigError } from '../lib/supabase';

export default function Login() {
  const { session, isAdmin, profileReady, signIn } = useAdminAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Si une session existe et que le profil est prêt, rediriger si admin
  if (session && profileReady && isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signInError = await signIn(email.trim(), password);
      if (signInError) {
        setError(signInError);
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible. Réessayez.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-xl font-black text-white shadow-lg shadow-brand/30">
            A
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">ARTISANTS</h1>
          <p className="mt-1 text-sm text-muted">Tableau de bord administrateur</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-ink">Connexion</h2>
          <p className="mt-1 text-sm text-muted">
            Réservé aux comptes disposant du rôle <strong>admin</strong>.
          </p>

          {supabaseConfigError ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              Configuration Supabase invalide : {supabaseConfigError}
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-5">
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@artisants.com"
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-ink placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div className="mt-4">
            <label htmlFor="password" className="block text-sm font-medium text-ink">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-ink placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || Boolean(supabaseConfigError)}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark focus:ring-2 focus:ring-brand/40 focus:outline-none disabled:opacity-60"
          >
            {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
            {submitting ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Promouvez un compte en admin via la migration SQL{' '}
          <code className="rounded bg-gray-200 px-1">supabase_migrations/001_admin_role.sql</code>.
        </p>
      </div>
    </div>
  );
}
