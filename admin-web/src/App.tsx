import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import { useAdminAuth } from './context/AdminAuthContext';
import Dashboard from './pages/Dashboard';
import EmployerRequests from './pages/EmployerRequests';
import Emails from './pages/Emails';
import Campaigns from './pages/Campaigns';
import Login from './pages/Login';
import LiveMap from './pages/LiveMap';
import Quotes from './pages/Quotes';
import Messages from './pages/Messages';
import Settings from './pages/Settings';
import Support from './pages/Support';
import Logs from './pages/Logs';
import Users from './pages/Users';

/** Écran de chargement identique au splash de l'app : logo, nom et barre de progression. */
function FullscreenLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white">
      <img
        src="/logo.png"
        alt="Artisants"
        width={150}
        height={150}
        className="h-[150px] w-[150px] rounded-[33px] object-contain"
      />
      <span className="text-[26px] font-bold text-[#222]">Artisants</span>
      <div className="mt-3 h-1.5 w-[55%] overflow-hidden rounded-full bg-[#E5E7EB]">
        <div
          className="h-full rounded-full bg-[#007AFF]"
          style={{ animation: 'splash-progress 2200ms cubic-bezier(0.5, 1, 0.89, 1) forwards' }}
        />
      </div>
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
        <Route path="carte" element={<LiveMap />} />
        <Route path="devis" element={<Quotes />} />
        <Route path="messages" element={<Messages />} />
        <Route path="demandes-employeur" element={<EmployerRequests />} />
        <Route path="support" element={<Support />} />
        <Route path="logs" element={<Logs />} />
        <Route path="parametres" element={<Settings />} />
        <Route path="emails" element={<Emails />} />
        <Route path="campagnes" element={<Campaigns />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
