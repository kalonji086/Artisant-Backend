import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { initials } from '../utils/format';
import {
  BriefcaseIcon,
  CloseIcon,
  DocumentIcon,
  GridIcon,
  MapIcon,
  LogoutIcon,
  MailIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: <GridIcon className="h-5 w-5" />, end: true },
  { to: '/utilisateurs', label: 'Utilisateurs', icon: <UsersIcon className="h-5 w-5" /> },
  { to: '/carte', label: 'Carte en direct', icon: <MapIcon className="h-5 w-5" /> },
  { to: '/devis', label: 'Devis', icon: <DocumentIcon className="h-5 w-5" /> },
  { to: '/demandes-employeur', label: 'Demandes employeur', icon: <BriefcaseIcon className="h-5 w-5" /> },
  { to: '/parametres', label: 'Paramètres', icon: <SettingsIcon className="h-5 w-5" /> },
  { to: '/emails', label: 'Emails', icon: <MailIcon className="h-5 w-5" /> },
];

export default function Layout() {
  const { profile, signOut } = useAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
      isActive
        ? 'bg-brand text-white shadow-sm shadow-brand/30'
        : 'text-gray-600 hover:bg-gray-100 hover:text-ink',
    ].join(' ');

  return (
    <div className="flex min-h-screen">
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-100 px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-black text-white">
              A
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-wide text-ink">ARTISANTS</p>
              <p className="text-[11px] text-muted">Administration</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer le menu"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Navigation principale">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={() => setSidebarOpen(false)}>
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-100 p-3">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <LogoutIcon className="h-5 w-5" />
            Se déconnecter
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <p className="hidden text-sm text-muted sm:block">
            Plateforme ARTISANTS — espace administrateur
          </p>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink">{profile?.full_name ?? 'Administrateur'}</p>
              <p className="text-xs text-muted">Rôle : admin</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-brand-dark">
              {initials(profile?.full_name ?? null)}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
