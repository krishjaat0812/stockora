import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, apiPatch, apiPost, apiPut } from '../auth/api';
import type { ActionId, FeatureId } from '../shared/features';

/** Typed access to the admin API + a small data-loading hook. */

export interface AdminMetrics {
  totalClients: number;
  activeClients: number;
  suspendedClients: number;
  totalUsers: number;
  ownerUsers: number;
  adminUsers: number;
  customizedClients: number;
  pendingInvitations: number;
  recentActions: AuditEntry[];
  securityEvents: AuditEntry[];
  recentPermissionChanges: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  orgId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

export interface ClientListItem {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  planId: string;
  planName: string;
  ownerEmail: string | null;
  ownerName: string | null;
  lastLoginAt: string | null;
  enabledFeatures: number;
  totalFeatures: number;
  customized: boolean;
  createdAt: string;
}

export interface FeatureAccessRow {
  id: FeatureId;
  label: string;
  description: string;
  group: string;
  dependencies: FeatureId[];
  planDefault: boolean;
  override: boolean | null;
  effective: boolean;
  /** Actions this feature actually performs — the only controls offered. */
  supportedActions: ActionId[];
  /** Explicit choices an administrator has made (absent = allowed by default). */
  actionOverrides: Partial<Record<ActionId, boolean>>;
  /** What the client can actually do right now, after feature + action rules. */
  actions: Record<ActionId, boolean>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type FeatureActionSelection = Partial<Record<FeatureId, Partial<Record<ActionId, boolean>>>>;

export interface ClientDetail {
  client: {
    id: string;
    name: string;
    status: 'active' | 'suspended';
    planId: string;
    planName: string;
    createdAt: string;
    updatedAt: string;
  };
  features: FeatureAccessRow[];
  members: Array<{
    id: string;
    email: string;
    display_name: string;
    status: string;
    last_login_at: string | null;
    role: string;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    display_name: string;
    created_at: string;
    expires_at: string;
    accepted_at: string | null;
  }>;
  recentActivity: AuditEntry[];
  stats: {
    productCount: number | null;
    stateUpdatedAt: string | null;
    memberCount: number;
    overrideCount: number;
  };
}

export interface PlanSummary {
  id: string;
  name: string;
  description: string;
  features: FeatureId[];
}

export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  role: 'super_admin' | 'admin';
  status: string;
  capabilities: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SecurityPolicy {
  minLength: number;
  sessionTtlHours: number;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  resetTtlMinutes: number;
  /** Global default: may clients change their own passwords? */
  allowClientPasswordChange: boolean;
  updatedAt: string;
  hashing: string;
}

export interface ClientPasswordPolicy {
  orgId: string;
  orgName?: string;
  /** 'inherit' follows the global policy; otherwise it overrides it. */
  override: 'inherit' | 'allow' | 'deny';
  globalDefault: boolean;
  /** What actually applies to this client's users right now. */
  effective: boolean;
}

export interface Paged {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (current: T | null) => T | null) => void;
}

/** Loads `loader` whenever `deps` change; returns data/error/loading/reload. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (cancelled || !aliveRef.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || !aliveRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load data.');
      })
      .finally(() => {
        if (!cancelled && aliveRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const patch = useCallback(
    (updater: (current: T | null) => T | null) => setData((current) => updater(current)),
    [],
  );

  return { data, error, loading, reload, setData: patch };
}

export const adminApi = {
  metrics: () => apiFetch<AdminMetrics>('/api/admin/metrics'),
  clients: (params: URLSearchParams) =>
    apiFetch<{ clients: ClientListItem[] } & Paged>(`/api/admin/clients?${params.toString()}`),
  createClient: (body: { organizationName: string; ownerName: string; email: string; planId: string }) =>
    apiPost<{ ok: boolean; orgId: string; setupLink?: string; devNotice?: string }>(
      '/api/admin/clients',
      body,
    ),
  client: (id: string) => apiFetch<ClientDetail>(`/api/admin/clients/${id}`),
  reinvite: (id: string, body: { email: string; ownerName?: string }) =>
    apiPost<{ ok: boolean; setupLink?: string; devNotice?: string }>(
      `/api/admin/clients/${id}/invitations`,
      body,
    ),
  updateClient: (id: string, body: { name?: string; status?: string; planId?: string }) =>
    apiPatch<{ ok: boolean; changed: string[]; revokedSessions: number }>(
      `/api/admin/clients/${id}`,
      body,
    ),
  clientFeatures: (id: string) =>
    apiFetch<{
      orgId: string;
      orgName: string;
      planId: string;
      planName: string;
      features: FeatureAccessRow[];
      effectiveCount: number;
    }>(`/api/admin/clients/${id}/features`),
  saveClientFeatures: (id: string, selection: FeatureId[], actions?: FeatureActionSelection) =>
    apiPut<{
      ok: boolean;
      changed: Array<{ feature: FeatureId; from: boolean; to: boolean }>;
      planName: string;
      features: FeatureAccessRow[];
      effectiveCount: number;
    }>(`/api/admin/clients/${id}/features`, { selection, actions }),
  clientPasswordPolicy: (id: string) =>
    apiFetch<ClientPasswordPolicy>(`/api/admin/clients/${id}/password-policy`),
  saveClientPasswordPolicy: (id: string, policy: 'inherit' | 'allow' | 'deny') =>
    apiPut<{ ok: boolean } & ClientPasswordPolicy>(`/api/admin/clients/${id}/password-policy`, {
      policy,
    }),
  /** Administrator sets a client account's password directly (server-revokes all its sessions). */
  setClientPassword: (id: string, body: { userId: string; password: string }) =>
    apiPost<{ ok: boolean; userId: string; revokedSessions: number }>(
      `/api/admin/clients/${id}/password`,
      body,
    ),
  resetClientFeatures: (id: string) =>
    apiPost<{ ok: boolean; planName: string; features: FeatureAccessRow[] }>(
      `/api/admin/clients/${id}/features/reset`,
    ),
  plans: () => apiFetch<{ plans: PlanSummary[] }>('/api/admin/plans'),
  savePlan: (planId: string, features: FeatureId[]) =>
    apiPut<{ ok: boolean; features: FeatureId[]; affectedOrganizations: number }>(
      `/api/admin/plans/${planId}`,
      { features },
    ),
  auditLogs: (params: URLSearchParams) =>
    apiFetch<{ logs: AuditEntry[]; actions: string[] } & Paged>(
      `/api/admin/audit-logs?${params.toString()}`,
    ),
  securityPolicy: () => apiFetch<SecurityPolicy>('/api/admin/security-policy'),
  saveSecurityPolicy: (body: {
    minLength: number;
    sessionTtlHours: number;
    loginMaxAttempts: number;
    loginWindowMinutes: number;
    resetTtlMinutes: number;
    allowClientPasswordChange: boolean;
  }) => apiPut<SecurityPolicy>('/api/admin/security-policy', body),
  staff: () => apiFetch<{ staff: StaffMember[]; capabilityCatalog: string[] }>('/api/admin/staff'),
  inviteStaff: (body: { email: string; displayName: string; capabilities: string[] }) =>
    apiPost<{ ok: boolean; userId: string; setupLink?: string; devNotice?: string }>(
      '/api/admin/staff',
      body,
    ),
  updateStaff: (
    id: string,
    body: { capabilities?: string[]; status?: string; displayName?: string },
  ) => apiPatch<{ ok: boolean; changed: string[] }>(`/api/admin/staff/${id}`, body),
};

const ACTION_LABELS: Record<string, string> = {
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in',
  'login.locked_out': 'Sign-in locked out (rate limit)',
  logout: 'Signed out',
  'password.changed': 'Password changed',
  'password.reset.requested': 'Password reset requested',
  'password.reset.completed': 'Password reset completed',
  'session.revoked': 'Sessions revoked',
  'invitation.created': 'Invitation created',
  'invitation.accepted': 'Invitation accepted',
  'client.created': 'Client created',
  'client.renamed': 'Client renamed',
  'client.suspended': 'Client suspended',
  'client.activated': 'Client activated',
  'client.plan_changed': 'Plan changed',
  'features.updated': 'Feature access updated',
  'features.reset_to_plan': 'Features reset to plan defaults',
  'plan.features_updated': 'Plan defaults updated',
  'security.policy_updated': 'Security policy updated',
  'client.password_policy_updated': 'Client password policy updated',
  'client.password_reset': 'Password set by administrator',
  'staff.invited': 'Administrator invited',
  'staff.updated': 'Administrator updated',
  'access.denied': 'Access denied',
};

export function describeAudit(entry: AuditEntry): string {
  return ACTION_LABELS[entry.action] ?? entry.action;
}

export const CAPABILITY_LABELS: Record<string, string> = {
  'clients:read': 'View clients and dashboard metrics',
  'clients:write': 'Invite, suspend and edit clients; assign plans',
  'features:write': 'Change client feature access and plan defaults',
  'security:write': 'Manage password policy and staff accounts',
  'audit:read': 'Read administrative audit logs',
};

export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  authentication: 'Authentication',
  password: 'Password & sessions',
  clients: 'Client management',
  permissions: 'Feature permissions',
  administration: 'Administration',
};
