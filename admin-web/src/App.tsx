import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { useAdminAuth } from './context/AdminAuthContext';
import Dashboard from './pages/Dashboard';
import EmployerRequests from './pages/EmployerRequests';
import Login from './pages/Login';
import Quotes from './pages/Quotes';
import Users from './pages/Users';

function FullscreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <Spinner className="h-8 w-8 text-brand" />
    </div>
  );
}

/** Garde de route : session active + rôle admin requis. */
function Protected({ children }: { children: ReactNode }) {
  const { isLoading, session, isAdmin, profileReady } = useAdminAuth();
  const location = useLocation();

  if (isLoading || !profileReady) return <FullscreenLoader />;
  if (!session || !isAdmin) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="utilisateurs" element={<Users />} />
        <Route path="devis" element={<Quotes />} />
        <Route path="demandes-employeur" element={<EmployerRequests />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
