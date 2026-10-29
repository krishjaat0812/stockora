import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  effectiveActionPermissions,
  effectivePermissions,
  fallbackRoute,
  type ActionId,
  type ActionPermissions,
  type FeatureId,
  type Permissions,
} from '../shared/features';
import { EVENTS, apiFetch, apiPost, type SessionPayload, type SessionUser } from './api';

/**
 * Holds the authenticated session and the organisation's effective feature
 * permissions, exactly as the server computed them. The server re-checks
 * every request; this context only drives navigation and rendering, and
 * refreshes periodically so live permission changes land without a re-login.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'suspended';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  org: SessionPayload['org'];
  permissions: Permissions;
  /** Per-action permissions, mirroring what the server enforces on each request. */
  actions: ActionPermissions;
  /** Whether this user may change their own password under the administrator's policy. */
  canChangePassword: boolean;
  landing: string;
  can: (feature: FeatureId) => boolean;
  /** Whether a specific action inside an enabled feature is permitted. */
  canDo: (feature: FeatureId, action: ActionId) => boolean;
  login: (email: string, password: string) => Promise<SessionPayload>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DENIED: Permissions = effectivePermissions({ accountActive: false });
const DENIED_ACTIONS: ActionPermissions = effectiveActionPermissions({ permissions: DENIED });
const REFRESH_INTERVAL_MS = 20_000;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<SessionPayload | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const payload = await apiFetch<SessionPayload>('/api/auth/session');
      setSession(payload);
      setStatus('authenticated');
    } catch (error) {
      const code = (error as { code?: string }).code;
      setSession(null);
      setStatus(code === 'account_suspended' ? 'suspended' : 'anonymous');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep permissions fresh: an administrator can change access while the
  // client is signed in, and suspension must take effect quickly.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, refresh]);

  useEffect(() => {
    const onUnauthenticated = () => {
      setSession(null);
      setStatus('anonymous');
    };
    const onSuspended = () => {
      setSession(null);
      setStatus('suspended');
    };
    const onFeatureDenied = () => {
      void refresh();
    };
    window.addEventListener(EVENTS.unauthenticated, onUnauthenticated);
    window.addEventListener(EVENTS.suspended, onSuspended);
    window.addEventListener(EVENTS.featureDenied, onFeatureDenied);
    return () => {
      window.removeEventListener(EVENTS.unauthenticated, onUnauthenticated);
      window.removeEventListener(EVENTS.suspended, onSuspended);
      window.removeEventListener(EVENTS.featureDenied, onFeatureDenied);
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const payload = await apiPost<SessionPayload>('/api/auth/login', { email, password });
    setSession(payload);
    setStatus('authenticated');
    return payload;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // Even if the server call fails, drop the local session state.
    }
    setSession(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = session?.permissions ?? DENIED;
    const actions = session?.actions ?? DENIED_ACTIONS;
    return {
      status,
      user: session?.user ?? null,
      org: session?.org ?? null,
      permissions,
      actions,
      canChangePassword: session?.canChangePassword ?? false,
      landing: session?.landing ?? '/login',
      can: (feature: FeatureId) => Boolean(permissions[feature]),
      canDo: (feature: FeatureId, action: ActionId) =>
        Boolean(permissions[feature] && actions[feature]?.[action]),
      login,
      logout,
      refresh,
    };
  }, [status, session, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Convenience hook for feature-scoped rendering (buttons, sections). */
export function useFeature(feature: FeatureId): boolean {
  return useAuth().can(feature);
}

/** Convenience hook for action-scoped rendering (add, edit, delete, export). */
export function useAction(feature: FeatureId, action: ActionId): boolean {
  return useAuth().canDo(feature, action);
}

export { fallbackRoute };
