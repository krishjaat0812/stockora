import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  LayoutDashboard,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { cn } from '../components/ui';
import { Logo, LogoMark } from '../components/Logo';

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/clients', label: 'Clients', icon: Users },
  { to: '/admin/features', label: 'Feature access', icon: SlidersHorizontal },
  { to: '/admin/security', label: 'Security & staff', icon: ShieldCheck },
  { to: '/admin/audit-logs', label: 'Audit logs', icon: ScrollText },
];

function adminMeta(pathname: string): { title: string; description: string } {
  if (pathname.startsWith('/admin/clients/')) {
    return { title: 'Client detail', description: 'Account, features and activity' };
  }
  const match = ADMIN_NAV.find((item) => item.to === pathname) ?? ADMIN_NAV[0];
  const descriptions: Record<string, string> = {
    '/admin': 'Platform health at a glance',
    '/admin/clients': 'Invite, suspend and manage client organisations',
    '/admin/features': 'Control which modules each client can use',
    '/admin/security': 'Password policy, sessions and staff accounts',
    '/admin/audit-logs': 'Every administrative and security event',
  };
  return { title: match.label, description: descriptions[match.to] ?? '' };
}

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Admin navigation">
      {ADMIN_NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/admin'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                isActive ? 'bg-primary-soft text-primary-dark' : 'text-muted hover:bg-canvas hover:text-ink',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, org, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = useMemo(() => adminMeta(location.pathname), [location.pathname]);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.title = `${meta.title} | Stockora Admin`;
  }, [meta.title]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const initials = (user?.displayName ?? 'Admin')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-white px-4 py-5 lg:flex"
        aria-label="Admin sidebar"
      >
        <Link to="/admin" className="mb-1 flex items-center gap-2 px-1" aria-label="Stockora admin">
          <Logo />
        </Link>
        <p className="mb-6 mt-1 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
          Administration
        </p>
        <AdminNavLinks />
        <div className="mt-auto rounded-xl border border-line bg-canvas/70 p-3">
          <p className="truncate text-[11px] font-semibold text-ink" title={user?.email}>
            {user?.email}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {user?.role === 'super_admin' ? 'Super Admin' : 'Admin'} · platform access
          </p>
          {org ? (
            <Link
              to="/"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark hover:underline"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Open shop workspace
            </Link>
          ) : null}
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
              aria-label="Open admin navigation"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <Link to="/admin" className="flex items-center gap-2 lg:hidden" aria-label="Stockora admin home">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-bold tracking-tight text-ink">Stockora</span>
            </Link>
            <div className="hidden min-w-0 shrink-0 lg:block">
              <p className="truncate text-sm font-semibold text-ink">{meta.title}</p>
              <p className="truncate text-[11px] text-muted">{meta.description}</p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-primary-dark sm:inline-flex">
                Admin panel
              </span>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-dark text-xs font-bold text-white ring-2 ring-white transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Admin account menu"
                >
                  {initials}
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    aria-label="Admin account"
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-xl border border-line bg-white shadow-pop"
                  >
                    <div className="border-b border-line px-4 py-3">
                      <p className="truncate text-sm font-semibold text-ink">{user?.displayName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted">{user?.email}</p>
                    </div>
                    {org ? (
                      <Link
                        role="menuitem"
                        to="/"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-canvas"
                      >
                        <ArrowLeft className="h-4 w-4 text-muted" aria-hidden="true" /> Shop workspace
                      </Link>
                    ) : null}
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => void logout()}
                      className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas"
                    >
                      <LogOut className="h-4 w-4 text-muted" aria-hidden="true" /> Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main id="admin-main" className="mx-auto w-full max-w-[1440px] px-3 pb-16 pt-4 sm:px-5 sm:pt-6 lg:px-8">
          {children}
        </main>
        <footer className="border-t border-line px-4 py-4 text-center text-[11px] text-muted lg:px-8">
          Stockora Administration · Client access, feature permissions and account security
        </footer>
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close admin navigation"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation menu"
            className="relative flex h-full w-[86%] max-w-[320px] flex-col border-r border-line bg-white px-4 py-4"
          >
            <div className="flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 rounded-lg bg-primary-soft px-3 py-2 text-xs font-semibold text-primary-dark">
              Administration
            </p>
            <div className="mt-3 flex-1 overflow-y-auto">
              <AdminNavLinks onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="border-t border-line pt-3">
              <p className="truncate px-1 text-[11px] font-medium text-ink">{user?.email}</p>
              <button
                type="button"
                onClick={() => void logout()}
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-canvas"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
