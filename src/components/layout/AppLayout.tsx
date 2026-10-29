import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  Check,
  ChevronRight,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useStockora } from '../../store/StockoraContext';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, cn, ConfirmDialog, EmptyState, Spinner } from '../ui';
import { Logo, LogoMark } from '../Logo';
import { useToast } from '../toast';
import { relativeTime } from '../../lib/date';
import { mobileNavItems, pageMeta, permittedNavItems, type NavItem } from './nav';
import { DemoTour } from '../DemoTour';

function navLinkClass(active: boolean, compact: boolean): string {
  return cn(
    'group flex items-center rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
    compact ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
    active
      ? 'bg-primary-soft text-primary-dark'
      : 'text-muted hover:bg-canvas hover:text-ink',
  );
}

function BadgePill({ count, tone = 'crit' }: { count: number; tone?: 'crit' | 'warn' }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'tnum ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold',
        tone === 'crit' ? 'bg-crit-soft text-crit' : 'bg-warn-soft text-warn',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidebarNav({
  items,
  compact,
  actionCount,
  expiryCount,
  onNavigate,
}: {
  items: NavItem[];
  compact: boolean;
  actionCount: number;
  expiryCount: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Main navigation">
      {items.map((item) => {
        const Icon = item.icon;
        let badge: ReactNode = null;
        if (item.to === '/actions' && actionCount > 0) badge = <BadgePill count={actionCount} />;
        if (item.to === '/expiry' && expiryCount > 0) badge = <BadgePill count={expiryCount} tone="warn" />;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            aria-label={compact ? item.label : undefined}
            className={({ isActive }) => navLinkClass(isActive, compact)}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {!compact ? (
              <>
                <span className="truncate">{item.label}</span>
                {badge}
              </>
            ) : (
              <span className="sr-only">{item.label}</span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Sidebar({
  items,
  compact,
  actionCount,
  expiryCount,
  lastSavedAt,
  shopName,
}: {
  items: NavItem[];
  compact: boolean;
  actionCount: number;
  expiryCount: number;
  lastSavedAt: string | null;
  shopName: string;
}) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-white',
        compact
          ? 'w-[76px] px-3 py-4 md:flex lg:hidden'
          : 'w-[248px] px-4 py-5 lg:flex',
      )}
      aria-label={compact ? 'Compact sidebar' : 'Sidebar'}
    >
      <Link to="/" className={cn('mb-6 flex items-center rounded-lg', compact ? 'justify-center' : 'px-1')} aria-label="Stockora overview">
        {compact ? <LogoMark /> : <Logo />}
      </Link>

      <SidebarNav items={items} compact={compact} actionCount={actionCount} expiryCount={expiryCount} />

      <div className="mt-auto pt-4">
        {compact ? (
          <div className="flex flex-col items-center gap-1 rounded-xl bg-canvas px-2 py-3 text-center">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">Sync</span>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-canvas/70 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink">
              <Database className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Saved to your workspace
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {lastSavedAt ? `Synced ${relativeTime(lastSavedAt)}.` : 'Changes save automatically.'} Stored in your shop’s own workspace.
            </p>
            <Link
              to="/settings"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark hover:underline"
            >
              Data settings <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </Link>
            <p className="mt-3 truncate border-t border-line pt-2 text-[11px] font-medium text-muted" title={shopName}>
              {shopName}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function NotificationPanel({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (link?: string) => void;
}) {
  const {
    notifications,
    markAllNotificationsRead,
    markNotificationRead,
    dismissNotification,
  } = useStockora();
  const unread = notifications.filter((item) => !item.read).length;

  const icons = {
    'low-stock': <ShieldAlert className="h-4 w-4 text-warn" aria-hidden="true" />,
    'near-expiry': <ShieldAlert className="h-4 w-4 text-warn" aria-hidden="true" />,
    expired: <AlertCircle className="h-4 w-4 text-crit" aria-hidden="true" />,
    import: <Database className="h-4 w-4 text-ok" aria-hidden="true" />,
    product: <Check className="h-4 w-4 text-ok" aria-hidden="true" />,
  };

  return (
    <div
      className="fixed inset-x-2 top-[116px] z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-modal animate-slide-up sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:max-h-[520px] sm:w-[380px]"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Notifications</h2>
          <p className="text-[11px] text-muted">
            {notifications.length === 0
              ? 'No alerts right now'
              : `${unread} unread of ${notifications.length}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={markAllNotificationsRead}
            disabled={unread === 0}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-primary-dark hover:bg-primary-soft disabled:opacity-40"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Bell className="mx-auto h-6 w-6 text-muted/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink">You are all caught up</p>
            <p className="mt-1 text-xs text-muted">
              Stock and expiry alerts appear here when a product condition changes.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {notifications.map((item) => (
              <li key={item.id} className={cn('group relative', !item.read && 'bg-primary-soft/40')}>
                <button
                  type="button"
                  onClick={() => {
                    markNotificationRead(item.id);
                    onNavigate(item.link);
                  }}
                  className="flex w-full items-start gap-2.5 px-4 py-3 pr-9 text-left hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow-card">
                    {icons[item.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('truncate text-[13px]', item.read ? 'font-medium text-ink' : 'font-semibold text-ink')}>
                        {item.title}
                      </span>
                      {!item.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-muted">{item.body}</span>
                    <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-muted/80">
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => dismissNotification(item.id)}
                  className="absolute right-2 top-2 rounded p-1 text-muted/70 opacity-100 hover:bg-white hover:text-crit sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label={`Dismiss notification: ${item.title}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-line bg-canvas/60 px-4 py-2 text-center">
        <Link to="/actions" onClick={onClose} className="text-[11px] font-semibold text-primary-dark hover:underline">
          Open Action Center
        </Link>
      </div>
    </div>
  );
}

function MobileNavDrawer({
  items,
  open,
  onClose,
  actionCount,
  expiryCount,
  shopName,
}: {
  items: NavItem[];
  open: boolean;
  onClose: () => void;
  actionCount: number;
  expiryCount: number;
  shopName: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    }, 50);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="relative flex h-full w-[86%] max-w-[320px] flex-col border-r border-line bg-white px-4 py-4 animate-fade-in"
      >
        <div className="flex items-center justify-between">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Close navigation menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-4 truncate rounded-lg bg-canvas px-3 py-2 text-xs font-medium text-muted">
          {shopName}
        </p>
        <div className="mt-3 flex-1 overflow-y-auto">
          <SidebarNav
            items={items}
            compact={false}
            actionCount={actionCount}
            expiryCount={expiryCount}
            onNavigate={onClose}
          />
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <p className="px-3 text-[11px] leading-4 text-muted">
            Your workspace is stored in your shop’s account. Export a CSV from Inventory or Reports
            for offline copies.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProfileMenu({ onResetRequest }: { onResetRequest: () => void }) {
  const { settings } = useStockora();
  const { user, org, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = (user?.displayName || settings.shopName)
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  const isStaff = user?.role === 'admin' || user?.role === 'super_admin';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-dark text-xs font-bold text-white ring-2 ring-white transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials || 'ST'}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-pop animate-slide-up"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{user?.displayName || settings.shopName}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted" title={user?.email}>
              {user?.email}
            </p>
            <p className="mt-1 truncate text-[11px] font-medium text-primary-dark" title={org?.name ?? ''}>
              {org?.name ?? 'Platform account'}
            </p>
          </div>
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-canvas"
          >
            <SettingsIcon className="h-4 w-4 text-muted" aria-hidden="true" /> Shop settings
          </Link>
          <Link
            role="menuitem"
            to="/security"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-canvas"
          >
            <ShieldCheck className="h-4 w-4 text-muted" aria-hidden="true" /> Account &amp; security
          </Link>
          {isStaff ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/admin');
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas"
            >
              <LayoutDashboard className="h-4 w-4 text-muted" aria-hidden="true" /> Admin panel
            </button>
          ) : null}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onResetRequest();
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-crit hover:bg-crit-soft/50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reset demo data
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas"
          >
            <LogOut className="h-4 w-4 text-muted" aria-hidden="true" /> Sign out
          </button>
          <div className="border-t border-line bg-canvas/60 px-4 py-2 text-[11px] leading-4 text-muted">
            Workspace changes save automatically to your shop’s account.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Header({
  onOpenNav,
  onResetRequest,
}: {
  onOpenNav: () => void;
  onResetRequest: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, notifications, lastSavedAt, refreshFromStorage } = useStockora();
  const { can, user } = useAuth();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const notificationRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((item) => !item.read).length;
  const meta = pageMeta(location.pathname);

  useEffect(() => {
    setNotificationsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [notificationsOpen]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/inventory?q=${encodeURIComponent(trimmed)}` : '/inventory');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshFromStorage();
      toast.success('Data reloaded', 'Showing the latest data from your workspace.');
    } catch {
      toast.error('Refresh failed', 'Could not reload your workspace. Try again.');
    } finally {
      window.setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-8">
        <button
          type="button"
          onClick={onOpenNav}
          className="rounded-lg p-2 text-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <Link to="/" className="flex items-center gap-2 md:hidden" aria-label="Stockora home">
          <LogoMark className="h-8 w-8" />
          <span className="text-base font-bold tracking-tight text-ink">Stockora</span>
        </Link>

        <div className="hidden min-w-0 shrink-0 md:block">
          <p className="truncate text-sm font-semibold text-ink">{meta.title}</p>
          <p className="hidden truncate text-[11px] text-muted lg:block">{meta.description}</p>
        </div>

        <form onSubmit={submitSearch} role="search" className="ml-auto hidden max-w-sm flex-1 items-center md:flex lg:max-w-md">
          <label htmlFor="global-search" className="sr-only">
            Search products by name or SKU
          </label>
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="global-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products or SKU…"
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm placeholder:text-muted/80 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 sm:gap-2 md:ml-0">
          <button
            type="button"
            onClick={handleRefresh}
            className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex"
            title="Reload the latest workspace data from the server"
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-ok/40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
            </span>
            <span className="hidden lg:inline">{lastSavedAt ? `Synced ${relativeTime(lastSavedAt)}` : 'Workspace'}</span>
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
            <span className="sr-only">Refresh workspace data</span>
          </button>

          {can('notifications') ? (
          <div className="relative" ref={notificationRef}>
            <button
              type="button"
              onClick={() => setNotificationsOpen((value) => !value)}
              className="relative rounded-lg p-2 text-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unread > 0 ? (
                <span className="tnum absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-crit px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </button>
            {notificationsOpen ? (
              <NotificationPanel
                onClose={() => setNotificationsOpen(false)}
                onNavigate={(link) => {
                  setNotificationsOpen(false);
                  if (link) navigate(link);
                }}
              />
            ) : null}
          </div>
          ) : null}

          <ProfileMenu onResetRequest={onResetRequest} />

          <span className="sr-only">Signed in as {user?.email ?? settings.shopName}</span>
        </div>
      </div>

      <form onSubmit={submitSearch} role="search" className="border-t border-line/70 px-3 pb-2 md:hidden">
        <label htmlFor="mobile-global-search" className="sr-only">
          Search products by name or SKU
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            id="mobile-global-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products or SKU…"
            className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm placeholder:text-muted/80 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
        </div>
      </form>
    </header>
  );
}

function MobileBottomNav({ items, actionCount }: { items: NavItem[]; actionCount: number }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Primary navigation"
    >
      <ul className="flex items-stretch justify-around px-1">
        {items.map((item: NavItem) => {
          const Icon = item.icon;
          return (
            <li key={item.to} className="min-w-0 flex-1">
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold transition-colors',
                    isActive ? 'text-primary-dark' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('flex h-7 w-9 items-center justify-center rounded-full', isActive && 'bg-primary-soft')}>
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="max-w-full truncate">{item.shortLabel}</span>
                    {item.to === '/actions' && actionCount > 0 ? (
                      <span className="tnum absolute right-2 top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[9px] font-bold text-white" aria-label={`${actionCount} open actions`}>
                        {actionCount > 9 ? '9+' : actionCount}
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { metrics, settings, lastSavedAt, resetDemoData, persistenceError, insights, loading, loadError, refreshFromStorage } =
    useStockora();
  const { permissions } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const navItems = useMemo(() => permittedNavItems(permissions), [permissions]);
  const bottomItems = useMemo(() => mobileNavItems(permissions), [permissions]);

  const expiryCount = useMemo(
    () => insights.filter((insight) => insight.isNearExpiry || insight.isExpired).length,
    [insights],
  );
  const actionCount = metrics.needsReview;

  const handleReset = () => {
    resetDemoData();
    setResetOpen(false);
    toast.success('Demo data reset', 'Six demo products restored and review state cleared.');
  };

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      <Sidebar
        items={navItems}
        compact={false}
        actionCount={actionCount}
        expiryCount={expiryCount}
        lastSavedAt={lastSavedAt}
        shopName={settings.shopName}
      />
      <Sidebar
        items={navItems}
        compact
        actionCount={actionCount}
        expiryCount={expiryCount}
        lastSavedAt={lastSavedAt}
        shopName={settings.shopName}
      />

      <div className="md:pl-[76px] lg:pl-[248px]">
        <Header onOpenNav={() => setNavOpen(true)} onResetRequest={() => setResetOpen(true)} />
        {persistenceError ? (
          <div className="border-b border-warn/30 bg-warn-soft px-4 py-2 text-xs font-medium text-[#78350F] sm:px-6 lg:px-8" role="alert">
            {persistenceError}
          </div>
        ) : null}
        <main id="main-content" className="mx-auto w-full max-w-[1440px] px-3 pb-24 pt-4 sm:px-5 sm:pt-6 md:pb-10 lg:px-8">
          {loading ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
              <Spinner className="h-7 w-7 text-primary" />
              <p className="text-sm font-medium text-muted">Loading your workspace…</p>
            </div>
          ) : loadError ? (
            <Card className="p-6">
              <EmptyState
                icon={<Database className="h-5 w-5 text-crit" aria-hidden="true" />}
                title={loadError.code === 'no_content_access' ? 'No features enabled' : 'Workspace unavailable'}
                description={
                  loadError.code === 'no_content_access'
                    ? 'Your administrator has not enabled any inventory features for this account yet. Ask them to turn features on in the admin panel.'
                    : loadError.message
                }
                action={
                  <Button variant="secondary" onClick={() => void refreshFromStorage()}>
                    Try again
                  </Button>
                }
              />
            </Card>
          ) : (
            children
          )}
        </main>
        <footer className="hidden border-t border-line px-4 py-4 text-center text-[11px] text-muted md:block lg:px-8">
          Stockora · Smarter stock, less waste · {metrics.total} products in {settings.shopName} · Changes save
          automatically
        </footer>
      </div>

      <MobileBottomNav items={bottomItems} actionCount={actionCount} />
      <DemoTour />
      <MobileNavDrawer
        items={navItems}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        actionCount={actionCount}
        expiryCount={expiryCount}
        shopName={settings.shopName}
      />

      <ConfirmDialog
        open={resetOpen}
        title="Reset demo data?"
        message={
          <div className="space-y-2">
            <p>
              This restores the six seeded demo products, clears reviewed actions and activity, and returns expiry
              threshold and safety buffer to their defaults.
            </p>
            <p className="font-medium text-ink">Products and settings you have added will be removed. Export a CSV first if you need a copy.</p>
          </div>
        }
        confirmLabel="Reset demo data"
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={handleReset}
      />
    </div>
  );
}
