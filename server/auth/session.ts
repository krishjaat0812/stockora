import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  CONTENT_FEATURES,
  effectiveActionPermissions,
  effectivePermissions,
  type ActionId,
  type ActionOverrideMap,
  type ActionPermissions,
  type FeatureId,
  type Permissions,
} from '../../src/shared/features';
import { getSecurityPolicy, uuid } from '../db';
import type { Env } from '../env';
import { sha256Hex, newToken } from './ratelimit';

/**
 * Session lifecycle (opaque random token in an HttpOnly cookie; only its
 * SHA-256 is stored) and the authorization middleware used by every API
 * route. Authorization decisions are made here, server-side, never in the
 * browser: a tampered client cannot grant itself features or roles.
 */

export const SESSION_COOKIE = 'stockora_session';

export type UserRole = 'super_admin' | 'admin' | 'owner';

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  capabilities: string[];
  sessionId: string;
  orgId: string | null;
  orgName: string | null;
  orgStatus: 'active' | 'suspended' | null;
  planId: string | null;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface AuthUserRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: string;
  capabilities: string;
  org_id: string | null;
  org_name: string | null;
  org_status: 'active' | 'suspended' | null;
  plan_id: string | null;
}

const SESSION_SELECT = `
  SELECT s.id AS session_id, s.expires_at, s.revoked_at,
         u.id, u.email, u.display_name, u.role, u.status, u.capabilities,
         o.id AS org_id, o.name AS org_name, o.status AS org_status, o.plan_id
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN memberships m ON m.user_id = u.id
  LEFT JOIN organizations o ON o.id = m.org_id
  WHERE s.token_hash = ?
`;

interface SessionJoinRow {
  session_id: string;
  expires_at: string;
  revoked_at: string | null;
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: string;
  capabilities: string;
  org_id: string | null;
  org_name: string | null;
  org_status: 'active' | 'suspended' | null;
  plan_id: string | null;
}

function toAuth(row: SessionJoinRow): AuthContext {
  let capabilities: string[] = [];
  try {
    const parsed = JSON.parse(row.capabilities);
    if (Array.isArray(parsed)) capabilities = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    capabilities = [];
  }
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    capabilities,
    sessionId: row.session_id,
    orgId: row.org_id,
    orgName: row.org_name,
    orgStatus: row.org_status,
    planId: row.plan_id,
  };
}

export async function createSession(
  env: Env,
  userId: string,
  options: { ttlHours?: number; userAgent?: string } = {},
): Promise<{ token: string; expiresAt: string }> {
  const policy = await getSecurityPolicy(env);
  const ttlHours = options.ttlHours ?? policy.session_ttl_hours;
  const token = newToken(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(uuid(), userId, tokenHash, now.toISOString(), expiresAt, now.toISOString(), options.userAgent ?? null)
    .run();
  return { token, expiresAt };
}

export async function resolveSession(env: Env, token: string): Promise<AuthContext | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(SESSION_SELECT)
    .bind(tokenHash)
    .first<SessionJoinRow>();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.status !== 'active') return null; // invited/disabled users hold no session
  // Sliding last-seen bookkeeping (throttled to once a minute).
  const seenKey = `stockora.seen.${row.session_id}`;
  const lastSeen = Number((globalThis as Record<string, unknown>)[seenKey] ?? 0);
  if (Date.now() - lastSeen > 60_000) {
    (globalThis as Record<string, unknown>)[seenKey] = Date.now();
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.session_id)
      .run();
  }
  return toAuth(row);
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), sessionId)
    .run();
}

export async function revokeUserSessions(
  env: Env,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const now = new Date().toISOString();
  const result = exceptSessionId
    ? await env.DB.prepare(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
      )
        .bind(now, userId, exceptSessionId)
        .run()
    : await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .bind(now, userId)
        .run();
  return result.meta.changes ?? 0;
}

export async function revokeOrgSessions(env: Env, orgId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ?
     WHERE revoked_at IS NULL
       AND user_id IN (SELECT user_id FROM memberships WHERE org_id = ?)`,
  )
    .bind(now, orgId)
    .run();
  return result.meta.changes ?? 0;
}

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)stockora_session=([^;]+)/.exec(cookieHeader);
  return match ? decodeURIComponent(match[1]) : null;
}

export function attachSessionCookie(
  headers: Headers,
  token: string,
  options: { secure: boolean; maxAge: number },
): void {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${options.maxAge}`];
  if (options.secure) parts.push('Secure');
  headers.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(headers: Headers, secure: boolean): void {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  headers.append('Set-Cookie', parts.join('; '));
}

/** Cookie helpers used by the auth routes (thin wrappers for testability). */
export const cookies = { getCookie, setCookie, deleteCookie };

/**
 * Effective permissions for the authenticated principal. Fails closed:
 * any error during lookup denies everything rather than granting access.
 */
export interface ResolvedAccess {
  permissions: Permissions;
  actions: ActionPermissions;
}

function deniedAccess(): ResolvedAccess {
  const permissions = effectivePermissions({ accountActive: false });
  return { permissions, actions: effectiveActionPermissions({ permissions, overrides: null }) };
}

/**
 * Feature entitlements *and* per-action permissions for the principal, both
 * resolved server-side from the database on every request — nothing is read
 * from the browser, so a revoked permission takes effect on the very next
 * call rather than when a stale client cache expires.
 */
export async function computeAccess(env: Env, auth: AuthContext): Promise<ResolvedAccess> {
  try {
    if (!auth.orgId || auth.orgStatus !== 'active') return deniedAccess();

    const planRows = await env.DB.prepare('SELECT feature_id FROM plan_features WHERE plan_id = ?')
      .bind(auth.planId)
      .all<{ feature_id: FeatureId }>();
    const overrideRows = await env.DB.prepare(
      'SELECT feature_id, enabled FROM org_feature_overrides WHERE org_id = ?',
    )
      .bind(auth.orgId)
      .all<{ feature_id: FeatureId; enabled: number }>();
    const actionRows = await env.DB.prepare(
      'SELECT feature_id, action, allowed FROM org_feature_actions WHERE org_id = ?',
    )
      .bind(auth.orgId)
      .all<{ feature_id: FeatureId; action: ActionId; allowed: number }>();

    const overrides: Partial<Record<FeatureId, boolean>> = {};
    for (const row of overrideRows.results ?? []) {
      overrides[row.feature_id] = row.enabled === 1;
    }
    const permissions = effectivePermissions({
      accountActive: true,
      planFeatures: (planRows.results ?? []).map((row) => row.feature_id),
      overrides,
    });

    const actionOverrides: ActionOverrideMap = {};
    for (const row of actionRows.results ?? []) {
      if (!actionOverrides[row.feature_id]) actionOverrides[row.feature_id] = {};
      actionOverrides[row.feature_id]![row.action] = row.allowed === 1;
    }

    return {
      permissions,
      actions: effectiveActionPermissions({ permissions, overrides: actionOverrides }),
    };
  } catch {
    return deniedAccess(); // safe default: deny everything
  }
}

export async function computePermissions(env: Env, auth: AuthContext): Promise<Permissions> {
  return (await computeAccess(env, auth)).permissions;
}

/**
 * Whether this principal may change their own password right now.
 *
 * Precedence: platform administrators are always allowed (they administer
 * the policy itself); a per-organisation override wins over the global
 * default. Fails closed — an unreadable policy blocks the change rather
 * than silently permitting it.
 */
export async function canChangeOwnPassword(env: Env, auth: AuthContext): Promise<boolean> {
  if (isAdminRole(auth.role)) return true;
  if (!auth.orgId || auth.orgStatus !== 'active') return false;
  try {
    const org = await env.DB.prepare('SELECT password_change_policy FROM organizations WHERE id = ?')
      .bind(auth.orgId)
      .first<{ password_change_policy: string | null }>();
    const override = org?.password_change_policy;
    if (override === 'allow') return true;
    if (override === 'deny') return false;
    const policy = await getSecurityPolicy(env);
    return policy.allow_client_password_change === 1;
  } catch {
    return false;
  }
}

export function hasContentAccess(permissions: Permissions): boolean {
  return CONTENT_FEATURES.some((feature) => permissions[feature]);
}

export function isAdminRole(role: UserRole): boolean {
  return role === 'super_admin' || role === 'admin';
}

export function hasCapability(auth: AuthContext, capability: string): boolean {
  if (auth.role === 'super_admin') return true;
  if (!isAdminRole(auth.role)) return false;
  return auth.capabilities.includes(capability);
}

export function cookieSecure(env: Env): boolean {
  return env.COOKIE_SECURE === 'true';
}
