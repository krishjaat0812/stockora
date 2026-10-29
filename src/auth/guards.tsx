import { type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, Lock, ShieldOff } from 'lucide-react';
import {
  FEATURE_MAP,
  FEATURE_ROUTES,
  fallbackRoute,
  type FeatureId,
} from '../shared/features';
import { Button, Card, EmptyState } from '../components/ui';
import { useAuth } from './AuthContext';

/**
 * Route-level authorization. These guards decide what the *browser* renders;
 * the Worker independently rejects the same requests, so bypassing the UI
 * never grants data or actions.
 */

export function FullScreenLoader({ label = 'Loading Stockora…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-primary" aria-hidden="true" />
        <p className="text-sm font-medium text-muted">{label}</p>
      </div>
    </div>
  );
}

function SuspendedScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Card className="max-w-md p-6">
        <EmptyState
          icon={<ShieldOff className="h-6 w-6 text-crit" aria-hidden="true" />}
          title="Account suspended"
          description="This account has been suspended by your administrator. Your data is retained but inaccessible. Contact your administrator to restore access."
          action={<Button onClick={onSignOut}>Sign out</Button>}
        />
      </Card>
    </div>
  );
}

/** Everything except the public auth pages requires a live session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader label="Checking your session…" />;
  if (status === 'suspended') return <SuspendedScreen onSignOut={() => void logout()} />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/** The client panel is for shop accounts; administrators land in /admin. */
export function RequireClient({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== 'owner') return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** The admin panel requires an administrator role. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, status, landing } = useAuth();
  if (status === 'loading') return <FullScreenLoader label="Checking your session…" />;
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return <Navigate to={status === 'authenticated' ? landing : '/login'} replace />;
  }
  return <>{children}</>;
}

export function FeatureUnavailable({
  feature,
  reason,
}: {
  feature: FeatureId;
  reason?: string;
}) {
  const { permissions } = useAuth();
  const definition = FEATURE_MAP[feature];
  const fallback = fallbackRoute(permissions);
  return (
    <Card className="p-5">
      <EmptyState
        icon={<Lock className="h-6 w-6 text-muted" aria-hidden="true" />}
        title={
          reason
            ? `${definition?.label ?? 'This feature'} isn’t available to your account`
            : `${definition?.label ?? 'This feature'} isn’t enabled for your account`
        }
        description={
          reason ??
          `Your administrator controls which Stockora features your shop can use. Ask them to enable ${definition?.label ?? feature} if you need it.`
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link to={fallback}>
              <Button variant="secondary">
                Go to {FEATURE_ROUTES.some((route) => route.path === fallback) ? 'my workspace' : 'settings'}
              </Button>
            </Link>
            <Link to="/security">
              <Button variant="ghost">Account &amp; security</Button>
            </Link>
          </div>
        }
      />
    </Card>
  );
}

/**
 * Wraps a feature-gated client page. Checks both that the feature is enabled
 * *and* that the administrator still allows viewing it — the Worker applies
 * the identical rules to every request the page makes.
 */
export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureId;
  children: ReactNode;
}) {
  const { can, canDo } = useAuth();
  if (!can(feature)) return <FeatureUnavailable feature={feature} />;
  if (!canDo(feature, 'view')) {
    return (
      <FeatureUnavailable
        feature={feature}
        reason="Your administrator has restricted access to this section. Contact them if you believe this is a mistake."
      />
    );
  }
  return <>{children}</>;
}

export function DeniedBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm font-medium text-[#78350F]" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
