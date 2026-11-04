import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
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

/** Splash identique à SplashLoader de l'app : barre jusqu'à 85 %, puis 100 % et fondu une fois prêt. */
const SPLASH_MIN_MS = 2200;
let splashPlayed = false;

function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [width, setWidth] = useState('0%');
  const [opacity, setOpacity] = useState(1);
  const [finishing, setFinishing] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth('85%'));
    const timer = setTimeout(() => setMinElapsed(true), SPLASH_MIN_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!ready || !minElapsed) return;
    setFinishing(true);
    setWidth('100%');
    setOpacity(0);
    const timer = setTimeout(() => onDoneRef.current(), 650);
    return () => clearTimeout(timer);
  }, [ready, minElapsed]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white"
      style={{ opacity, transition: 'opacity 350ms linear' }}
    >
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
          style={{
            width,
            transition: finishing
              ? 'width 300ms linear'
              : `width ${SPLASH_MIN_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`,
          }}
        />
      </div>
    </div>
  );
}

/** Garde de route : session active + rôle admin requis. */
function Protected({ children }: { children: ReactNode }) {
  const { isLoading, session, isAdmin, profileReady } = useAdminAuth();
  const location = useLocation();
  const [splashDone, setSplashDone] = useState(splashPlayed);

  if (!splashDone) {
    return (
      <Splash
        ready={!isLoading && profileReady}
        onDone={() => {
          splashPlayed = true;
          setSplashDone(true);
        }}
      />
    );
  }
  if (isLoading || !profileReady) return <Splash ready={false} onDone={() => {}} />;
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
