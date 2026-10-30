import { uuid } from './db';
import type { Env } from './env';

/**
 * Append-only audit log. Never records passwords, hashes, reset/invite
 * tokens or session cookies: metadata keys matching sensitive names are
 * redacted before the row is written, and callers pass ids rather than
 * secrets wherever possible.
 */

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  orgId?: string | null;
  outcome?: AuditOutcome;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY = /(password|token|secret|cookie|hash|authorization)/i;
const MAX_VALUE_LENGTH = 300;

export function sanitizeMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return '{}';
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) {
      clean[key] = '[redacted]';
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      clean[key] = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    } else if (Array.isArray(value)) {
      clean[key] = value
        .slice(0, 30)
        .map((item) => (typeof item === 'string' ? item.slice(0, 80) : String(item)));
    } else {
      clean[key] = JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
    }
  }
  return JSON.stringify(clean);
}

export async function recordAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, at, actor_user_id, actor_email, action, target_type, target_id, org_id, outcome, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        new Date().toISOString(),
        entry.actorUserId ?? null,
        entry.actorEmail ?? null,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.orgId ?? null,
        entry.outcome ?? 'success',
        sanitizeMetadata(entry.metadata),
      )
      .run();
  } catch (error) {
    // Auditing must never take down the requested operation, but the failure
    // is surfaced in the server log for operators.
    console.error('audit write failed', entry.action, error);
  }
}

export const AUDIT_ACTIONS = [
  'login.success',
  'login.failed',
  'login.locked_out',
  'logout',
  'password.changed',
  'password.reset.requested',
  'password.reset.completed',
  'client.password_reset',
  'session.revoked',
  'invitation.created',
  'invitation.accepted',
  'client.created',
  'client.renamed',
  'client.suspended',
  'client.activated',
  'client.plan_changed',
  'features.updated',
  'features.reset_to_plan',
  'plan.features_updated',
  'sales.history_imported',
  'sales.history_cleared',
  'pos.sale_completed',
  'pos.sale_confirmed',
  'pos.sale_cancelled',
  'security.policy_updated',
  'client.password_policy_updated',
  'staff.invited',
  'staff.updated',
  'access.denied',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Action groups used by the admin audit-log filter. */
export const AUDIT_CATEGORIES: Record<string, AuditAction[]> = {
  authentication: ['login.success', 'login.failed', 'login.locked_out', 'logout'],
  password: [
    'password.changed',
    'password.reset.requested',
    'password.reset.completed',
    'client.password_reset',
    'session.revoked',
  ],
  clients: [
    'client.created',
    'client.renamed',
    'client.suspended',
    'client.activated',
    'client.plan_changed',
    'invitation.created',
    'invitation.accepted',
  ],
  permissions: ['features.updated', 'features.reset_to_plan', 'plan.features_updated'],
  data: [
    'sales.history_imported',
    'sales.history_cleared',
    'pos.sale_completed',
    'pos.sale_confirmed',
    'pos.sale_cancelled',
  ],
  administration: [
    'security.policy_updated',
    'client.password_policy_updated',
    'staff.invited',
    'staff.updated',
    'access.denied',
  ],
};
