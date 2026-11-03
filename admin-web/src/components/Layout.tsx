import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useAdminPresence, useLiveCounts, useSessionDuration } from '../lib/presence';
import { initials } from '../utils/format';
import {
  BriefcaseIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CloseIcon,
  DocumentIcon,
  GridIcon,
  LogoutIcon,
  MailIcon,
  MapIcon,
  MegaphoneIcon,
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

interface NavGroup {
  title: string;
  items: NavItem[];
}

const icon = 'h-5 w-5 shrink-0';

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Pilotage',
    items: [
      { to: '/', label: 'Tableau de bord', icon: <GridIcon className={icon} />, end: true },
      { to: '/carte', label: 'Carte en direct', icon: <MapIcon className={icon} /> },
    ],
  },
  {
    title: 'Opérations',
    items: [
      { to: '/utilisateurs', label: 'Utilisateurs', icon: <UsersIcon className={icon} /> },
      { to: '/devis', label: 'Devis', icon: <DocumentIcon className={icon} /> },
      { to: '/demandes-employeur', label: 'Demandes employeur', icon: <BriefcaseIcon className={icon} /> },
    ],
  },
  {
    title: 'Communication',
    items: [
      { to: '/emails', label: 'Rédiger un email', icon: <MailIcon className={icon} /> },
      { to: '/campagnes', label: 'Campagnes', icon: <MegaphoneIcon className={icon} /> },
    ],
  },
  {
    title: 'Système',
    items: [{ to: '/parametres', label: 'Paramètres', icon: <SettingsIcon className={icon} /> }],
  },
];

const COLLAPSE_KEY = 'artisants-admin-sidebar-collapsed';
const SESSION_KEY = 'artisants-admin-session-start';

export default function Layout() {
  const { profile, session, signOut } = useAdminAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [confirmLogout, setConfirmLogout] = useState(false);

  const name = profile?.full_name ?? 'Administrateur';
  const { artisans, clients } = useLiveCounts();
  const { admins, events, connected } = useAdminPresence(session?.user.id, name);
  const duration = useSessionDuration();
  const logo = `${import.meta.env.BASE_URL}logo.png`;

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  const hideWhenCollapsed = collapsed ? 'lg:hidden' : '';

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'group relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-all duration-200',
      collapsed ? 'px-3 lg:justify-center lg:px-0' : 'px-3',
      isActive
        ? 'bg-gradient-to-r from-brand to-sky-500 text-white shadow-lg shadow-brand/30'
        : 'text-slate-300 hover:bg-white/10 hover:text-white',
    ].join(' ');

  const dot = connected ? 'bg-emerald-400' : 'bg-rose-500';

  return (
    <div className="flex min-h-screen">
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-gradient-to-b from-[#0b1b33] via-[#0d2548] to-[#0b1b33] text-white shadow-2xl transition-all duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          collapsed ? 'lg:w-20' : 'lg:w-72',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div
          className={[
            'flex items-center border-b border-white/10 px-4 py-4',
            collapsed ? 'justify-between lg:justify-center' : 'justify-between',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            <img src={logo} alt="Logo ARTISANTS" className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-0.5 shadow-md" />
            <div className={['leading-tight', hideWhenCollapsed].join(' ')}>
              <p className="text-base font-extrabold tracking-[0.18em] text-white">ARTISANTS</p>
              <p className="text-xs font-medium text-sky-300">Administration</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fermer le menu"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className={['mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500', hideWhenCollapsed].join(' ')}>
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={linkClass}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.icon}
                    <span className={hideWhenCollapsed}>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-3 border-t border-white/10 p-3">
          {events.map((e) => (
            <div
              key={e.id}
              className={[
                'animate-pulse rounded-lg px-3 py-2 text-xs font-medium',
                hideWhenCollapsed,
                e.kind === 'join' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200',
              ].join(' ')}
            >
              {e.name} {e.kind === 'join' ? 'vient de se connecter' : 'vient de se déconnecter'}
            </div>
          ))}

          <div className={['grid grid-cols-2 gap-2 text-center', hideWhenCollapsed].join(' ')}>
            <div className="rounded-xl bg-white/5 px-2 py-2">
              <p className="text-lg font-bold text-white">{artisans}</p>
              <p className="text-[11px] text-slate-400">Artisans en ligne</p>
            </div>
            <div className="rounded-xl bg-white/5 px-2 py-2">
              <p className="text-lg font-bold text-white">{clients}</p>
              <p className="text-[11px] text-slate-400">Clients en ligne</p>
            </div>
          </div>

          <div className={['flex items-center gap-3 rounded-xl bg-white/5 p-2.5', collapsed ? 'lg:justify-center' : ''].join(' ')}>
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
              {initials(profile?.full_name ?? null)}
              <span className={['absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[#0d2548]', dot].join(' ')} />
            </span>
            <div className={['min-w-0 flex-1', hideWhenCollapsed].join(' ')}>
              <p className="truncate text-sm font-semibold text-white">{name}</p>
              <p className="truncate text-[11px] text-slate-400">
                {connected ? 'En ligne' : 'Hors ligne'} · session {duration} · {admins} admin{admins > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              title="Se déconnecter"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500 hover:text-white"
            >
              <LogoutIcon className="h-5 w-5 shrink-0" />
              <span className={hideWhenCollapsed}>Se déconnecter</span>
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden rounded-xl bg-white/5 px-3 text-slate-300 transition hover:bg-white/10 hover:text-white lg:block"
              aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
            >
              {collapsed ? <ChevronsRightIcon className="h-5 w-5" /> : <ChevronsLeftIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-200/70 bg-white/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <img src={logo} alt="" className="h-8 w-8 rounded-lg lg:hidden" />
          <p className="hidden text-sm text-muted sm:block">Plateforme ARTISANTS — espace administrateur</p>

          <div className="ml-auto flex items-center gap-3">
            <span
              className={[
                'hidden items-center gap-2 rounded-full px-3 py-1 text-xs font-medium sm:inline-flex',
                connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
              ].join(' ')}
            >
              <span className={['h-2 w-2 rounded-full', dot, connected ? 'animate-pulse' : ''].join(' ')} />
              {connected ? 'Connecté en temps réel' : 'Connexion perdue'}
            </span>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink">{name}</p>
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

      {confirmLogout ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-ink">Se déconnecter ?</h2>
            <p className="mt-2 text-sm text-muted">Votre session administrateur sera fermée.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem(SESSION_KEY);
                  void signOut();
                }}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
