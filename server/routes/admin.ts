import { Hono } from 'hono';
import {
  ACTIONS,
  FEATURES,
  FEATURE_ACTIONS,
  FEATURE_IDS,
  PLANS,
  effectiveActionsForFeature,
  planById,
  validateFeatureSelection,
  type ActionId,
  type FeatureId,
} from '../../src/shared/features';
import { recordAudit } from '../audit';
import { HASHING_DESCRIPTION, hashPassword, validatePassword, verifyPassword } from '../auth/password';
import { newToken, sha256Hex } from '../auth/ratelimit';
import { revokeOrgSessions, revokeUserSessions } from '../auth/session';
import { getSecurityPolicy, uuid } from '../db';
import type { Env } from '../env';
import { isEmail, readJson, respond } from '../http';
import { requireAdmin, requireCapability, requireUser, type AppEnv } from '../middleware';

/**
 * Admin Panel API: client management, invitations, per-client feature access,
 * plan defaults, security policies, staff accounts and audit logs. Every
 * route is guarded by session + admin role + a granular capability, and all
 * writes are recorded in the audit log.
 */

interface OrgRow {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  plan_id: string;
  created_at: string;
  updated_at: string;
}

interface FeatureAccessRow {
  id: FeatureId;
  label: string;
  description: string;
  group: string;
  dependencies: FeatureId[];
  planDefault: boolean;
  override: boolean | null;
  effective: boolean;
  /** Actions this feature actually performs (the only ones the admin UI offers). */
  supportedActions: ActionId[];
  /** Explicit per-action choices made by an administrator (null = plan default). */
  actionOverrides: Partial<Record<ActionId, boolean>>;
  /** Fully resolved action permissions the client currently has. */
  actions: Record<ActionId, boolean>;
  updatedAt: string | null;
  updatedBy: string | null;
}

async function getOrg(env: Env, id: string): Promise<OrgRow | null> {
  return env.DB.prepare('SELECT * FROM organizations WHERE id = ?')
    .bind(id)
    .first<OrgRow>();
}

async function orgOr404(c: { env: Env; req: { param: (k: string) => string } }, id: string) {
  const org = await getOrg(c.env, id);
  if (!org) {
    return { error: respond({ code: 'not_found', message: 'Client not found.' }, { status: 404 }) };
  }
  return { org };
}

async function loadFeatureAccess(
  env: Env,
  org: OrgRow,
): Promise<{ rows: FeatureAccessRow[]; planName: string }> {
  const planDefaults = new Set(
    (
      await env.DB.prepare('SELECT feature_id FROM plan_features WHERE plan_id = ?')
        .bind(org.plan_id)
        .all<{ feature_id: FeatureId }>()
    ).results?.map((row) => row.feature_id) ?? [],
  );
  const overrideRows = await env.DB.prepare(
    'SELECT feature_id, enabled, updated_at, updated_by FROM org_feature_overrides WHERE org_id = ?',
  )
    .bind(org.id)
    .all<{ feature_id: FeatureId; enabled: number; updated_at: string; updated_by: string | null }>();
  const actionRows = await env.DB.prepare(
    'SELECT feature_id, action, allowed, updated_at, updated_by FROM org_feature_actions WHERE org_id = ?',
  )
    .bind(org.id)
    .all<{
      feature_id: FeatureId;
      action: ActionId;
      allowed: number;
      updated_at: string;
      updated_by: string | null;
    }>();
  const overrides = new Map(
    (overrideRows.results ?? []).map((row) => [
      row.feature_id,
      { enabled: row.enabled === 1, updatedAt: row.updated_at, updatedBy: row.updated_by },
    ]),
  );
  const actionOverrides = new Map<FeatureId, Partial<Record<ActionId, boolean>>>();
  for (const row of actionRows.results ?? []) {
    const forFeature = actionOverrides.get(row.feature_id) ?? {};
    forFeature[row.action] = row.allowed === 1;
    actionOverrides.set(row.feature_id, forFeature);
  }
  const rows: FeatureAccessRow[] = FEATURES.map((feature) => {
    const override = overrides.get(feature.id);
    const planDefault = planDefaults.has(feature.id);
    const effective = feature.globallyEnabled ? (override ? override.enabled : planDefault) : false;
    const explicit = actionOverrides.get(feature.id) ?? {};
    return {
      id: feature.id,
      label: feature.label,
      description: feature.description,
      group: feature.group,
      dependencies: feature.dependencies,
      planDefault,
      override: override ? override.enabled : null,
      effective,
      supportedActions: FEATURE_ACTIONS[feature.id],
      actionOverrides: explicit,
      actions: effectiveActionsForFeature({
        feature: feature.id,
        featureEnabled: effective,
        overrides: explicit,
      }),
      updatedAt: override?.updatedAt ?? null,
      updatedBy: override?.updatedBy ?? null,
    };
  });
  const planName = planById(org.plan_id)?.name ?? org.plan_id;
  return { rows, planName };
}

async function orgStats(env: Env, orgId: string) {
  const stateRow = await env.DB.prepare('SELECT state_json, updated_at FROM org_state WHERE org_id = ?')
    .bind(orgId)
    .first<{ state_json: string; updated_at: string }>();
  let productCount: number | null = null;
  if (stateRow) {
    try {
      const parsed = JSON.parse(stateRow.state_json) as { products?: unknown[] };
      productCount = Array.isArray(parsed.products) ? parsed.products.length : 0;
    } catch {
      productCount = null;
    }
  }
  const memberCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?')
    .bind(orgId)
    .first<{ n: number }>();
  const overrideCount = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM org_feature_overrides WHERE org_id = ?',
  )
    .bind(orgId)
    .first<{ n: number }>();
  return {
    productCount,
    stateUpdatedAt: stateRow?.updated_at ?? null,
    memberCount: memberCount?.n ?? 0,
    overrideCount: overrideCount?.n ?? 0,
  };
}

function parseCapabilities(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

const VALID_CAPABILITIES = ['clients:read', 'clients:write', 'features:write', 'security:write', 'audit:read'];

export function buildAdminRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser, requireAdmin);

  // ---------- Dashboard ----------

  app.get('/metrics', requireCapability('clients:read'), async (c) => {
    const one = async (sql: string, ...binds: unknown[]) => {
      const row = await c.env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
      return row?.n ?? 0;
    };
    const [
      totalClients,
      activeClients,
      suspendedClients,
      totalUsers,
      ownerUsers,
      adminUsers,
      customizedClients,
    ] = await Promise.all([
      one('SELECT COUNT(*) AS n FROM organizations'),
      one("SELECT COUNT(*) AS n FROM organizations WHERE status = 'active'"),
      one("SELECT COUNT(*) AS n FROM organizations WHERE status = 'suspended'"),
      one("SELECT COUNT(*) AS n FROM users WHERE status != 'invited'"),
      one("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'"),
      one("SELECT COUNT(*) AS n FROM users WHERE role IN ('admin','super_admin')"),
      one('SELECT COUNT(DISTINCT org_id) AS n FROM org_feature_overrides'),
    ]).then((values) => values as [number, number, number, number, number, number, number]);
    const pendingRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM invitations WHERE accepted_at IS NULL AND expires_at > ?',
    )
      .bind(new Date().toISOString())
      .first<{ n: number }>();
    const pendingInvitations = pendingRow?.n ?? 0;

    const recent = await c.env.DB.prepare(
      'SELECT * FROM audit_logs ORDER BY at DESC LIMIT 10',
    ).all<AuditRow>();
    const securityEvents = await c.env.DB.prepare(
      `SELECT * FROM audit_logs WHERE action IN ('login.failed','login.locked_out','password.changed','password.reset.requested','password.reset.completed','client.password_reset','session.revoked','access.denied')
       ORDER BY at DESC LIMIT 8`,
    ).all<AuditRow>();
    const recentPermissionChanges = await c.env.DB.prepare(
      `SELECT * FROM audit_logs WHERE action IN ('features.updated','features.reset_to_plan','plan.features_updated')
       ORDER BY at DESC LIMIT 5`,
    ).all<AuditRow>();

    return respond({
      totalClients,
      activeClients,
      suspendedClients,
      totalUsers,
      ownerUsers,
      adminUsers,
      customizedClients,
      pendingInvitations,
      recentActions: (recent.results ?? []).map(mapAudit),
      securityEvents: (securityEvents.results ?? []).map(mapAudit),
      recentPermissionChanges: (recentPermissionChanges.results ?? []).map(mapAudit),
    });
  });

  // ---------- Clients ----------

  app.get('/clients', requireCapability('clients:read'), async (c) => {
    const query = c.req.query();
    const search = (query.q ?? '').trim().toLowerCase();
    const status = query.status ?? 'all';
    const sort = query.sort ?? 'created';
    const dir = query.dir === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 10));

    const orgs = (await c.env.DB.prepare('SELECT * FROM organizations').all<OrgRow>()).results ?? [];
    const enriched = await Promise.all(
      orgs.map(async (org) => {
        const owner = await c.env.DB.prepare(
          `SELECT u.email, u.display_name, u.last_login_at FROM users u
           JOIN memberships m ON m.user_id = u.id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1`,
        )
          .bind(org.id)
          .first<{ email: string; display_name: string; last_login_at: string | null }>();
        const enabledCount = await c.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM plan_features WHERE plan_id = ?
           UNION ALL
           SELECT COUNT(*) AS n FROM org_feature_overrides WHERE org_id = ? AND enabled = 1`,
        )
          .bind(org.plan_id, org.id)
          .all<{ n: number }>();
        const planDefaults = enabledCount.results?.[0]?.n ?? 0;
        const extraGrants = enabledCount.results?.[1]?.n ?? 0;
        const overrides = await c.env.DB.prepare(
          'SELECT COUNT(*) AS n FROM org_feature_overrides WHERE org_id = ?',
        )
          .bind(org.id)
          .first<{ n: number }>();
        const totalFeatures = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM plan_features WHERE plan_id = ?')
          .bind(org.plan_id)
          .first<{ n: number }>();
        return {
          id: org.id,
          name: org.name,
          status: org.status,
          planId: org.plan_id,
          planName: planById(org.plan_id)?.name ?? org.plan_id,
          ownerEmail: owner?.email ?? null,
          ownerName: owner?.display_name ?? null,
          lastLoginAt: owner?.last_login_at ?? null,
          enabledFeatures: Math.min(FEATURE_IDS.length, planDefaults + extraGrants),
          totalFeatures: totalFeatures?.n ?? FEATURE_IDS.length,
          customized: (overrides?.n ?? 0) > 0,
          createdAt: org.created_at,
        };
      }),
    );

    const filtered = enriched.filter((org) => {
      if (status !== 'all' && org.status !== status) return false;
      if (!search) return true;
      return (
        org.name.toLowerCase().includes(search) ||
        (org.ownerEmail ?? '').toLowerCase().includes(search) ||
        (org.ownerName ?? '').toLowerCase().includes(search) ||
        org.planName.toLowerCase().includes(search)
      );
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sort === 'name') cmp = a.name.localeCompare(b.name);
      else if (sort === 'status') cmp = a.status.localeCompare(b.status);
      else if (sort === 'features') cmp = a.enabledFeatures - b.enabledFeatures;
      else if (sort === 'login') cmp = (a.lastLoginAt ?? '').localeCompare(b.lastLoginAt ?? '');
      else cmp = a.createdAt.localeCompare(b.createdAt);
      return dir === 'asc' ? cmp : -cmp;
    });

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return respond({
      clients: filtered.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      pages,
    });
  });

  app.post('/clients', requireCapability('clients:write'), async (c) => {
    const parsed = await readJson<{ organizationName?: string; ownerName?: string; email?: string; planId?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const name = (parsed.body.organizationName ?? '').trim();
    const ownerName = (parsed.body.ownerName ?? '').trim();
    const email = (parsed.body.email ?? '').trim().toLowerCase();
    const planId = parsed.body.planId ?? 'starter';

    const errors: Record<string, string> = {};
    if (name.length < 2 || name.length > 80) errors.organizationName = 'Enter an organisation name (2–80 characters).';
    if (!isEmail(email)) errors.email = 'Enter a valid email address.';
    if (!planById(planId)) errors.planId = 'Choose a valid plan.';
    if (Object.keys(errors).length > 0) {
      return respond({ code: 'validation', message: 'Check the highlighted fields.', errors }, { status: 400 });
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      return respond(
        { code: 'duplicate_email', message: 'A user with this email already exists.', errors: { email: 'This email is already registered.' } },
        { status: 409 },
      );
    }

    const auth = c.get('auth');
    const now = new Date().toISOString();
    const orgId = uuid();
    const userId = uuid();
    const token = newToken(32);
    const expiresAt = new Date(Date.now() + 14 * 24 * 3_600_000).toISOString();

    await c.env.DB.prepare(
      "INSERT INTO organizations (id, name, status, plan_id, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
    )
      .bind(orgId, name, planId, now, now)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, capabilities, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'owner', 'invited', '[]', ?, ?)`,
    )
      .bind(userId, email, ownerName || name, now, now)
      .run();
    await c.env.DB.prepare('INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)')
      .bind(userId, orgId, 'owner')
      .run();
    await c.env.DB.prepare(
      'INSERT INTO invitations (id, org_id, email, display_name, capabilities, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(orgId ? uuid() : uuid(), orgId, email, ownerName || name, '[]', await sha256Hex(token), auth.userId, now, expiresAt)
      .run();

    await recordAudit(c.env, {
      action: 'client.created',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId,
      targetType: 'organization',
      targetId: orgId,
      metadata: { name, email, planId },
    });
    await recordAudit(c.env, {
      action: 'invitation.created',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId,
      targetType: 'invitation',
      targetId: email,
      metadata: { email },
    });

    const body: Record<string, unknown> = { ok: true, orgId, userId };
    if (c.env.DEV_LINKS === 'true') {
      body.setupLink = `${(c.req.header('Origin') ?? (c.env.APP_ORIGINS ?? '').split(',')[0]?.trim() ?? 'http://localhost:5173')}/invite/${token}`;
      body.devNotice =
        'Email delivery is not configured in this environment. Send this account-setup link to the client yourself; it expires in 14 days and can be used once.';
    }
    return respond(body, { status: 201 });
  });

  app.get('/clients/:id', requireCapability('clients:read'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const { rows, planName } = await loadFeatureAccess(c.env, org);
    const members = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?`,
    )
      .bind(org.id)
      .all();
    const invitations = await c.env.DB.prepare(
      'SELECT id, email, display_name, created_at, expires_at, accepted_at FROM invitations WHERE org_id = ? ORDER BY created_at DESC',
    )
      .bind(org.id)
      .all();
    const audit = await c.env.DB.prepare(
      'SELECT * FROM audit_logs WHERE org_id = ? ORDER BY at DESC LIMIT 15',
    )
      .bind(org.id)
      .all<AuditRow>();
    return respond({
      client: {
        id: org.id,
        name: org.name,
        status: org.status,
        planId: org.plan_id,
        planName,
        createdAt: org.created_at,
        updatedAt: org.updated_at,
      },
      features: rows,
      members: members.results ?? [],
      invitations: invitations.results ?? [],
      recentActivity: (audit.results ?? []).map(mapAudit),
      stats: await orgStats(c.env, org.id),
    });
  });

  /** Issues a fresh setup link when the original invitation was lost. */
  app.post('/clients/:id/invitations', requireCapability('clients:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const parsed = await readJson<{ email?: string; ownerName?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const email = (parsed.body.email ?? '').trim().toLowerCase();
    if (!isEmail(email)) {
      return respond({ code: 'validation', message: 'Enter a valid email address.' }, { status: 400 });
    }
    const auth = c.get('auth');
    const now = new Date().toISOString();
    const token = newToken(32);

    // The invited account (if any) must still be pending, not an active user.
    const existingUser = await c.env.DB.prepare('SELECT id, status FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; status: string }>();
    if (existingUser && existingUser.status === 'active') {
      const membership = await c.env.DB.prepare(
        'SELECT org_id FROM memberships WHERE user_id = ? AND org_id = ?',
      )
        .bind(existingUser.id, org.id)
        .first();
      if (membership) {
        return respond(
          { code: 'account_exists', message: 'This owner already has an active account for this client.' },
          { status: 409 },
        );
      }
    }

    await c.env.DB.prepare(
      'INSERT INTO invitations (id, org_id, email, display_name, capabilities, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        uuid(),
        org.id,
        email,
        (parsed.body.ownerName ?? '').trim() || email,
        '[]',
        await sha256Hex(token),
        auth.userId,
        now,
        new Date(Date.now() + 14 * 24 * 3_600_000).toISOString(),
      )
      .run();
    await recordAudit(c.env, {
      action: 'invitation.created',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: org.id,
      targetType: 'invitation',
      targetId: email,
      metadata: { email, reissued: true },
    });
    const body: Record<string, unknown> = { ok: true };
    if (c.env.DEV_LINKS === 'true') {
      body.setupLink = `${(c.req.header('Origin') ?? (c.env.APP_ORIGINS ?? '').split(',')[0]?.trim() ?? 'http://localhost:5173')}/invite/${token}`;
      body.devNotice =
        'Email delivery is not configured in this environment. Send this new setup link to the client yourself; it replaces the previous invitation link.';
    }
    return respond(body, { status: 201 });
  });

  app.patch('/clients/:id', requireCapability('clients:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const parsed = await readJson<{ name?: string; status?: string; planId?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const auth = c.get('auth');
    const changes: Array<{ field: string; from: unknown; to: unknown; action: string }> = [];

    const name = parsed.body.name?.trim();
    if (name !== undefined) {
      if (name.length < 2 || name.length > 80) {
        return respond({ code: 'validation', message: 'Organisation name must be 2–80 characters.' }, { status: 400 });
      }
      if (name !== org.name) changes.push({ field: 'name', from: org.name, to: name, action: 'client.renamed' });
    }
    const status = parsed.body.status;
    if (status !== undefined) {
      if (status !== 'active' && status !== 'suspended') {
        return respond({ code: 'validation', message: 'Status must be active or suspended.' }, { status: 400 });
      }
      if (status !== org.status) {
        changes.push({
          field: 'status',
          from: org.status,
          to: status,
          action: status === 'suspended' ? 'client.suspended' : 'client.activated',
        });
      }
    }
    const planId = parsed.body.planId;
    if (planId !== undefined && planId !== org.plan_id) {
      if (!planById(planId)) {
        return respond({ code: 'validation', message: 'Choose a valid plan.' }, { status: 400 });
      }
      changes.push({ field: 'plan_id', from: org.plan_id, to: planId, action: 'client.plan_changed' });
    }

    if (changes.length === 0) return respond({ ok: true, changed: [] });

    const now = new Date().toISOString();
    for (const change of changes) {
      await c.env.DB.prepare(`UPDATE organizations SET ${change.field} = ?, updated_at = ? WHERE id = ?`)
        .bind(change.to, now, org.id)
        .run();
      await recordAudit(c.env, {
        action: change.action,
        actorUserId: auth.userId,
        actorEmail: auth.email,
        orgId: org.id,
        targetType: 'organization',
        targetId: org.id,
        metadata: { from: String(change.from), to: String(change.to) },
      });
    }

    let revokedSessions = 0;
    if (changes.some((change) => change.field === 'status' && change.to === 'suspended')) {
      revokedSessions = await revokeOrgSessions(c.env, org.id);
      await recordAudit(c.env, {
        action: 'session.revoked',
        actorUserId: auth.userId,
        actorEmail: auth.email,
        orgId: org.id,
        metadata: { reason: 'organization suspended', revoked: revokedSessions },
      });
    }

    const updated = await getOrg(c.env, org.id);
    return respond({
      ok: true,
      changed: changes.map((change) => change.field),
      revokedSessions,
      client: updated,
    });
  });

  // ---------- Feature access ----------

  app.get('/clients/:id/features', requireCapability('clients:read'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const { rows, planName } = await loadFeatureAccess(c.env, org);
    return respond({
      orgId: org.id,
      orgName: org.name,
      planId: org.plan_id,
      planName,
      features: rows,
      effectiveCount: rows.filter((row) => row.effective).length,
    });
  });

  app.put('/clients/:id/features', requireCapability('features:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const parsed = await readJson<{
      selection?: FeatureId[];
      actions?: Partial<Record<FeatureId, Partial<Record<ActionId, boolean>>>>;
    }>(c);
    if ('error' in parsed) return parsed.error;
    const selection = Array.isArray(parsed.body.selection) ? parsed.body.selection : null;
    if (!selection || selection.some((item) => typeof item !== 'string')) {
      return respond({ code: 'validation', message: 'Send the full list of enabled features.' }, { status: 400 });
    }
    const unique = [...new Set(selection)];
    const validation = validateFeatureSelection(unique);
    if (!validation.ok) {
      return respond(
        {
          code: 'invalid_selection',
          message: validation.errors[0]?.message ?? 'Invalid feature selection.',
          errors: validation.errors.map((error) => ({ feature: error.feature, message: error.message })),
        },
        { status: 400 },
      );
    }

    const actionSelection =
      parsed.body.actions && typeof parsed.body.actions === 'object' && !Array.isArray(parsed.body.actions)
        ? parsed.body.actions
        : null;
    if (parsed.body.actions != null && !actionSelection) {
      return respond({ code: 'validation', message: 'actions must be an object.' }, { status: 400 });
    }
    if (actionSelection) {
      for (const [featureId, map] of Object.entries(actionSelection)) {
        if (!FEATURE_IDS.includes(featureId as FeatureId)) {
          return respond(
            { code: 'validation', message: `Unknown feature "${featureId}".` },
            { status: 400 },
          );
        }
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
          return respond(
            { code: 'validation', message: `actions.${featureId} must be an object.` },
            { status: 400 },
          );
        }
        const supported = new Set<ActionId>(FEATURE_ACTIONS[featureId as FeatureId]);
        for (const [action, value] of Object.entries(map)) {
          if (!ACTIONS.includes(action as ActionId) || !supported.has(action as ActionId)) {
            return respond(
              {
                code: 'validation',
                message: `Action "${action}" does not apply to ${featureId}.`,
              },
              { status: 400 },
            );
          }
          if (typeof value !== 'boolean') {
            return respond(
              { code: 'validation', message: `actions.${featureId}.${action} must be true or false.` },
              { status: 400 },
            );
          }
        }
      }
    }

    const planDefaults = new Set(
      (
        await c.env.DB.prepare('SELECT feature_id FROM plan_features WHERE plan_id = ?')
          .bind(org.plan_id)
          .all<{ feature_id: FeatureId }>()
      ).results?.map((row) => row.feature_id) ?? [],
    );
    const desired = new Set(unique);
    const changes: Array<{ feature: FeatureId; from: boolean; to: boolean }> = [];
    const now = new Date().toISOString();
    const auth = c.get('auth');

    const existingOverrides = (
      await c.env.DB.prepare('SELECT feature_id, enabled FROM org_feature_overrides WHERE org_id = ?')
        .bind(org.id)
        .all<{ feature_id: FeatureId; enabled: number }>()
    ).results ?? [];
    const existingMap = new Map(existingOverrides.map((row) => [row.feature_id, row.enabled === 1]));

    for (const feature of FEATURE_IDS) {
      const planAllows = planDefaults.has(feature);
      const currentlyEffective = existingMap.has(feature) ? existingMap.get(feature)! : planAllows;
      const want = desired.has(feature);
      if (currentlyEffective !== want) changes.push({ feature, from: currentlyEffective, to: want });
    }

    for (const feature of FEATURE_IDS) {
      const planAllows = planDefaults.has(feature);
      const want = desired.has(feature);
      if (want !== planAllows) {
        await c.env.DB.prepare(
          `INSERT INTO org_feature_overrides (org_id, feature_id, enabled, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(org_id, feature_id) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
          .bind(org.id, feature, want ? 1 : 0, auth.userId, now)
          .run();
      } else {
        await c.env.DB.prepare('DELETE FROM org_feature_overrides WHERE org_id = ? AND feature_id = ?')
          .bind(org.id, feature)
          .run();
      }
    }
    // ---------- Per-action overrides ----------
    // Only explicit denials are stored: an allow is the default, so
    // "restore plan defaults" stays a single delete.
    const actionChanges: string[] = [];
    if (actionSelection) {
      const previousRows = (
        await c.env.DB.prepare(
          'SELECT feature_id, action, allowed FROM org_feature_actions WHERE org_id = ?',
        )
          .bind(org.id)
          .all<{ feature_id: FeatureId; action: ActionId; allowed: number }>()
      ).results ?? [];
      const previous = new Map<string, boolean>();
      for (const row of previousRows) previous.set(`${row.feature_id}.${row.action}`, row.allowed === 1);

      for (const [featureId, map] of Object.entries(actionSelection)) {
        const feature = featureId as FeatureId;
        // Only the features present in this payload are re-synced, so a
        // partial request can never silently clear another feature's rules.
        await c.env.DB.prepare(
          'DELETE FROM org_feature_actions WHERE org_id = ? AND feature_id = ?',
        )
          .bind(org.id, feature)
          .run();
        if (!desired.has(feature)) continue; // a disabled feature needs no action rows
        for (const action of FEATURE_ACTIONS[feature]) {
          const requested = map[action];
          const allowed = requested === undefined ? true : requested;
          const wasAllowed = previous.get(`${feature}.${action}`) ?? true;
          if (wasAllowed !== allowed) {
            actionChanges.push(`${feature}.${action}: ${wasAllowed ? 'on' : 'off'} → ${allowed ? 'on' : 'off'}`);
          }
          if (allowed) continue; // default — no row
          await c.env.DB.prepare(
            `INSERT INTO org_feature_actions (org_id, feature_id, action, allowed, updated_by, updated_at)
             VALUES (?, ?, ?, 0, ?, ?)
             ON CONFLICT(org_id, feature_id, action) DO UPDATE SET allowed = 0, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          )
            .bind(org.id, feature, action, auth.userId, now)
            .run();
        }
      }
    }

    await c.env.DB.prepare('UPDATE organizations SET updated_at = ? WHERE id = ?').bind(now, org.id).run();

    if (changes.length > 0 || actionChanges.length > 0) {
      await recordAudit(c.env, {
        action: 'features.updated',
        actorUserId: auth.userId,
        actorEmail: auth.email,
        orgId: org.id,
        targetType: 'organization',
        targetId: org.id,
        metadata: {
          changes: [
            ...changes.map((change) => `${change.feature}: ${change.from ? 'on' : 'off'} → ${change.to ? 'on' : 'off'}`),
            ...actionChanges,
          ],
        },
      });
    }

    const { rows, planName } = await loadFeatureAccess(c.env, org);
    return respond({
      ok: true,
      changed: changes,
      planName,
      features: rows,
      effectiveCount: rows.filter((row) => row.effective).length,
    });
  });

  app.post('/clients/:id/features/reset', requireCapability('features:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const auth = c.get('auth');
    await c.env.DB.prepare('DELETE FROM org_feature_overrides WHERE org_id = ?').bind(org.id).run();
    await c.env.DB.prepare('DELETE FROM org_feature_actions WHERE org_id = ?').bind(org.id).run();
    await c.env.DB.prepare('UPDATE organizations SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), org.id)
      .run();
    await recordAudit(c.env, {
      action: 'features.reset_to_plan',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: org.id,
      targetType: 'organization',
      targetId: org.id,
      metadata: { planId: org.plan_id },
    });
    const { rows, planName } = await loadFeatureAccess(c.env, org);
    return respond({ ok: true, planName, features: rows });
  });

  // ---------- Plans ----------

  app.get('/plans', requireCapability('clients:read'), async (c) => {
    const planRows = (await c.env.DB.prepare('SELECT * FROM plans ORDER BY sort_order').all<{
      id: string;
      name: string;
      description: string;
    }>()).results ?? [];
    const featureRows = (await c.env.DB.prepare('SELECT plan_id, feature_id FROM plan_features').all<{
      plan_id: string;
      feature_id: FeatureId;
    }>()).results ?? [];
    return respond({
      plans: planRows.map((plan) => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        features: featureRows.filter((row) => row.plan_id === plan.id).map((row) => row.feature_id),
      })),
      catalog: FEATURES,
    });
  });

  app.put('/plans/:id', requireCapability('features:write'), async (c) => {
    const planId = c.req.param('id');
    const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE id = ?').bind(planId).first();
    if (!plan) return respond({ code: 'not_found', message: 'Plan not found.' }, { status: 404 });
    const parsed = await readJson<{ features?: FeatureId[] }>(c);
    if ('error' in parsed) return parsed.error;
    const selection = Array.isArray(parsed.body.features) ? [...new Set(parsed.body.features)] : null;
    if (!selection) {
      return respond({ code: 'validation', message: 'Send the list of enabled features.' }, { status: 400 });
    }
    const validation = validateFeatureSelection(selection);
    if (!validation.ok) {
      return respond(
        { code: 'invalid_selection', message: validation.errors[0]?.message ?? 'Invalid selection.' },
        { status: 400 },
      );
    }
    const auth = c.get('auth');
    await c.env.DB.prepare('DELETE FROM plan_features WHERE plan_id = ?').bind(planId).run();
    for (const feature of selection) {
      await c.env.DB.prepare('INSERT INTO plan_features (plan_id, feature_id) VALUES (?, ?)')
        .bind(planId, feature)
        .run();
    }
    const affected = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM organizations WHERE plan_id = ?')
      .bind(planId)
      .first<{ n: number }>();
    await recordAudit(c.env, {
      action: 'plan.features_updated',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      targetType: 'plan',
      targetId: planId,
      metadata: { features: selection, affectedOrganizations: affected?.n ?? 0 },
    });
    return respond({ ok: true, features: selection, affectedOrganizations: affected?.n ?? 0 });
  });

  // ---------- Audit logs ----------

  interface AuditRow {
    id: string;
    at: string;
    actor_user_id: string | null;
    actor_email: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    org_id: string | null;
    outcome: string;
    metadata: string;
  }

  app.get('/audit-logs', requireCapability('audit:read'), async (c) => {
    const query = c.req.query();
    const search = (query.q ?? '').trim().toLowerCase();
    const actionFilter = query.action ?? 'all';
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 25));

    const rows = (await c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY at DESC LIMIT 500').all<AuditRow>())
      .results ?? [];
    const filtered = rows.filter((row) => {
      if (actionFilter !== 'all' && row.action !== actionFilter) return false;
      if (!search) return true;
      return (
        row.action.toLowerCase().includes(search) ||
        (row.actor_email ?? '').toLowerCase().includes(search) ||
        (row.target_id ?? '').toLowerCase().includes(search) ||
        (row.metadata ?? '').toLowerCase().includes(search)
      );
    });
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return respond({
      logs: filtered.slice(start, start + pageSize).map(mapAudit),
      total,
      page,
      pageSize,
      pages,
      actions: [...new Set(rows.map((row) => row.action))].sort(),
    });
  });

  // ---------- Security policy & staff ----------

  app.get('/security-policy', requireCapability('security:write'), async (c) => {
    const policy = await getSecurityPolicy(c.env);
    return respond({
      minLength: policy.min_password_length,
      sessionTtlHours: policy.session_ttl_hours,
      loginMaxAttempts: policy.login_max_attempts,
      loginWindowMinutes: policy.login_window_minutes,
      resetTtlMinutes: policy.reset_ttl_minutes,
      allowClientPasswordChange: policy.allow_client_password_change === 1,
      updatedAt: policy.updated_at,
      hashing: HASHING_DESCRIPTION,
    });
  });

  app.put('/security-policy', requireCapability('security:write'), async (c) => {
    const parsed = await readJson<{
      minLength?: number;
      sessionTtlHours?: number;
      loginMaxAttempts?: number;
      loginWindowMinutes?: number;
      resetTtlMinutes?: number;
      allowClientPasswordChange?: boolean;
    }>(c);
    if ('error' in parsed) return parsed.error;
    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.min(max, Math.max(min, Math.round(num)));
    };
    const current = await getSecurityPolicy(c.env);
    const next = {
      min_password_length: clamp(parsed.body.minLength, 8, 128, current.min_password_length),
      session_ttl_hours: clamp(parsed.body.sessionTtlHours, 1, 24 * 30, current.session_ttl_hours),
      login_max_attempts: clamp(parsed.body.loginMaxAttempts, 3, 50, current.login_max_attempts),
      login_window_minutes: clamp(parsed.body.loginWindowMinutes, 1, 240, current.login_window_minutes),
      reset_ttl_minutes: clamp(parsed.body.resetTtlMinutes, 5, 1440, current.reset_ttl_minutes),
      allow_client_password_change:
        parsed.body.allowClientPasswordChange === undefined
          ? current.allow_client_password_change
          : parsed.body.allowClientPasswordChange
            ? 1
            : 0,
    };
    await c.env.DB.prepare(
      `UPDATE security_policies SET min_password_length = ?, session_ttl_hours = ?, login_max_attempts = ?, login_window_minutes = ?, reset_ttl_minutes = ?, allow_client_password_change = ?, updated_at = ? WHERE id = 1`,
    )
      .bind(
        next.min_password_length,
        next.session_ttl_hours,
        next.login_max_attempts,
        next.login_window_minutes,
        next.reset_ttl_minutes,
        next.allow_client_password_change,
        new Date().toISOString(),
      )
      .run();
    const auth = c.get('auth');
    await recordAudit(c.env, {
      action: 'security.policy_updated',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      metadata: {
        ...(next as unknown as Record<string, unknown>),
        // Deliberately named so the audit redactor keeps this readable:
        // "may clients change their own password" is the decision of record.
        selfServiceChangeAllowed: next.allow_client_password_change === 1,
        scope: 'global',
      },
    });
    return respond({
      ok: true,
      ...next,
      allowClientPasswordChange: next.allow_client_password_change === 1,
    });
  });

  // ---------- Per-client password policy ----------

  const PASSWORD_POLICIES = ['inherit', 'allow', 'deny'] as const;
  type PasswordPolicy = (typeof PASSWORD_POLICIES)[number];

  async function readPasswordPolicy(
    env: Env,
    org: OrgRow,
  ): Promise<{ override: PasswordPolicy; globalDefault: boolean; effective: boolean }> {
    const row = await env.DB.prepare('SELECT password_change_policy FROM organizations WHERE id = ?')
      .bind(org.id)
      .first<{ password_change_policy: string | null }>();
    const raw = row?.password_change_policy;
    const override: PasswordPolicy =
      raw === 'allow' || raw === 'deny' ? raw : 'inherit';
    const globalDefault = (await getSecurityPolicy(env)).allow_client_password_change === 1;
    return {
      override,
      globalDefault,
      effective: override === 'inherit' ? globalDefault : override === 'allow',
    };
  }

  app.get('/clients/:id/password-policy', requireCapability('security:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const policy = await readPasswordPolicy(c.env, lookup.org);
    return respond({ orgId: lookup.org.id, orgName: lookup.org.name, ...policy });
  });

  app.put('/clients/:id/password-policy', requireCapability('security:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const parsed = await readJson<{ policy?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const policy = parsed.body.policy;
    if (!PASSWORD_POLICIES.includes(policy as PasswordPolicy)) {
      return respond(
        { code: 'validation', message: 'Send policy as "inherit", "allow" or "deny".' },
        { status: 400 },
      );
    }
    const now = new Date().toISOString();
    await c.env.DB.prepare('UPDATE organizations SET password_change_policy = ?, updated_at = ? WHERE id = ?')
      .bind(policy, now, org.id)
      .run();
    const auth = c.get('auth');
    const resolved = await readPasswordPolicy(c.env, org);
    await recordAudit(c.env, {
      action: 'client.password_policy_updated',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: org.id,
      targetType: 'organization',
      targetId: org.id,
      metadata: {
        scope: 'client',
        override: resolved.override,
        selfServiceChangeAllowed: resolved.effective,
        globalDefaultAllowed: resolved.globalDefault,
      },
    });
    return respond({ ok: true, orgId: org.id, ...resolved });
  });

  /**
   * Administrator sets a client's password directly. The client app has no
   * self-service password form, so this is the supported path. The password
   * is validated against the same policy as self-service resets, stored only
   * as a PBKDF2 hash, and every live session of that account is revoked.
   */
  app.post('/clients/:id/password', requireCapability('security:write'), async (c) => {
    const lookup = await orgOr404(c, c.req.param('id'));
    if ('error' in lookup) return lookup.error;
    const org = lookup.org;
    const parsed = await readJson<{ userId?: string; password?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const userId = (parsed.body.userId ?? '').trim();
    const password = parsed.body.password ?? '';
    if (!userId) {
      return respond(
        { code: 'validation', message: 'Choose the account whose password you want to set.' },
        { status: 400 },
      );
    }
    const member = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.status, u.password_hash
         FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE u.id = ? AND m.org_id = ?`,
    )
      .bind(userId, org.id)
      .first<{ id: string; email: string; display_name: string; status: string; password_hash: string | null }>();
    if (!member) {
      return respond(
        { code: 'not_found', message: 'That account does not belong to this client.' },
        { status: 404 },
      );
    }
    if (member.status === 'invited') {
      return respond(
        {
          code: 'invitation_pending',
          message: 'This account has not finished setup — send a setup link instead.',
        },
        { status: 409 },
      );
    }
    if (member.status === 'suspended') {
      return respond(
        { code: 'suspended', message: 'Reactivate this account before setting a password.' },
        { status: 409 },
      );
    }

    const policy = await getSecurityPolicy(c.env);
    const errors = validatePassword(password, { minLength: policy.min_password_length }, {
      email: member.email,
      displayName: member.display_name,
    });
    if (errors.length > 0) {
      return respond(
        { code: 'weak_password', message: errors[0], errors },
        { status: 400 },
      );
    }
    if (member.password_hash && (await verifyPassword(member.password_hash, password))) {
      return respond(
        { code: 'unchanged', message: 'Choose a password the account does not already use.' },
        { status: 400 },
      );
    }

    const auth = c.get('auth');
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(password), new Date().toISOString(), member.id)
      .run();
    // Sign the account out everywhere: the old password must stop working now.
    const revoked = await revokeUserSessions(c.env, member.id);
    await recordAudit(c.env, {
      action: 'client.password_reset',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: org.id,
      targetType: 'user',
      targetId: member.id,
      metadata: { email: member.email, revokedSessions: revoked, scope: 'admin_set' },
    });
    return respond({ ok: true, userId: member.id, revokedSessions: revoked });
  });

  app.get('/staff', requireCapability('security:write'), async (c) => {
    const rows = (
      await c.env.DB.prepare(
        "SELECT id, email, display_name, role, status, capabilities, last_login_at, created_at FROM users WHERE role IN ('admin','super_admin') ORDER BY created_at",
      ).all()
    ).results ?? [];
    return respond({
      staff: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        capabilities: parseCapabilities(String(row.capabilities ?? '[]')),
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      })),
      capabilityCatalog: VALID_CAPABILITIES,
    });
  });

  app.post('/staff', requireCapability('security:write'), async (c) => {
    const parsed = await readJson<{ email?: string; displayName?: string; capabilities?: string[] }>(c);
    if ('error' in parsed) return parsed.error;
    const email = (parsed.body.email ?? '').trim().toLowerCase();
    const displayName = (parsed.body.displayName ?? '').trim();
    const capabilities = Array.isArray(parsed.body.capabilities)
      ? parsed.body.capabilities.filter((item) => VALID_CAPABILITIES.includes(item))
      : [];
    if (!isEmail(email)) {
      return respond({ code: 'validation', message: 'Enter a valid email address.' }, { status: 400 });
    }
    if (displayName.length < 2) {
      return respond({ code: 'validation', message: 'Enter the administrator’s name.' }, { status: 400 });
    }
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      return respond({ code: 'duplicate_email', message: 'A user with this email already exists.' }, { status: 409 });
    }
    const auth = c.get('auth');
    if (auth.role !== 'super_admin' && capabilities.length > 0) {
      // Admins may not mint accounts with more authority than their own set.
      const own = auth.capabilities;
      const elevated = capabilities.filter((capability) => !own.includes(capability));
      if (elevated.length > 0) {
        return respond(
          { code: 'forbidden', message: 'You cannot grant capabilities you do not hold yourself.' },
          { status: 403 },
        );
      }
    }

    const now = new Date().toISOString();
    const userId = uuid();
    const token = newToken(32);
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, capabilities, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'admin', 'invited', ?, ?, ?)`,
    )
      .bind(userId, email, displayName, JSON.stringify(capabilities), now, now)
      .run();
    await c.env.DB.prepare(
      'INSERT INTO invitations (id, org_id, email, display_name, capabilities, token_hash, created_by, created_at, expires_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(uuid(), email, displayName, JSON.stringify(capabilities), await sha256Hex(token), auth.userId, now, new Date(Date.now() + 14 * 24 * 3_600_000).toISOString())
      .run();
    await recordAudit(c.env, {
      action: 'staff.invited',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      targetType: 'user',
      targetId: email,
      metadata: { capabilities },
    });
    const body: Record<string, unknown> = { ok: true, userId };
    if (c.env.DEV_LINKS === 'true') {
      body.setupLink = `${(c.req.header('Origin') ?? (c.env.APP_ORIGINS ?? '').split(',')[0]?.trim() ?? 'http://localhost:5173')}/invite/${token}`;
      body.devNotice = 'Email delivery is not configured in this environment. Send this setup link to the administrator yourself.';
    }
    return respond(body, { status: 201 });
  });

  app.patch('/staff/:id', requireCapability('security:write'), async (c) => {
    const userId = c.req.param('id');
    const auth = c.get('auth');
    const target = await c.env.DB.prepare("SELECT id, email, role, status, capabilities FROM users WHERE id = ? AND role IN ('admin','super_admin')")
      .bind(userId)
      .first<{ id: string; email: string; role: string; status: string; capabilities: string }>();
    if (!target) return respond({ code: 'not_found', message: 'Administrator not found.' }, { status: 404 });
    if (target.role === 'super_admin' && auth.role !== 'super_admin') {
      return respond({ code: 'forbidden', message: 'Only a Super Admin can modify a Super Admin.' }, { status: 403 });
    }
    const parsed = await readJson<{ capabilities?: string[]; status?: string; displayName?: string }>(c);
    if ('error' in parsed) return parsed.error;

    const updates: string[] = [];
    const binds: unknown[] = [];
    const changes: string[] = [];
    if (Array.isArray(parsed.body.capabilities)) {
      const capabilities = parsed.body.capabilities.filter((item) => VALID_CAPABILITIES.includes(item));
      if (target.role === 'super_admin') {
        return respond({ code: 'forbidden', message: 'Super Admin capabilities are fixed.' }, { status: 403 });
      }
      updates.push('capabilities = ?');
      binds.push(JSON.stringify(capabilities));
      changes.push(`capabilities: ${parseCapabilities(target.capabilities).join('|') || 'none'} → ${capabilities.join('|') || 'none'}`);
    }
    if (parsed.body.status !== undefined) {
      if (!['active', 'disabled'].includes(parsed.body.status)) {
        return respond({ code: 'validation', message: 'Status must be active or disabled.' }, { status: 400 });
      }
      if (target.id === auth.userId && parsed.body.status === 'disabled') {
        return respond({ code: 'forbidden', message: 'You cannot disable your own account.' }, { status: 403 });
      }
      updates.push('status = ?');
      binds.push(parsed.body.status);
      changes.push(`status: ${target.status} → ${parsed.body.status}`);
    }
    if (parsed.body.displayName !== undefined) {
      const name = parsed.body.displayName.trim();
      if (name.length < 2) {
        return respond({ code: 'validation', message: 'Name must be at least 2 characters.' }, { status: 400 });
      }
      updates.push('display_name = ?');
      binds.push(name);
      changes.push('display name updated');
    }
    if (updates.length === 0) return respond({ ok: true, changed: [] });

    binds.push(new Date().toISOString(), userId);
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...binds)
      .run();
    if (parsed.body.status === 'disabled') {
      await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .bind(new Date().toISOString(), userId)
        .run();
    }
    await recordAudit(c.env, {
      action: 'staff.updated',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      targetType: 'user',
      targetId: target.email,
      metadata: { changes },
    });
    return respond({ ok: true, changed: changes });
  });

  return app;
}

function mapAudit(row: {
  id: string;
  at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  org_id: string | null;
  outcome: string;
  metadata: string;
}) {
  let metadata: unknown = {};
  try {
    metadata = JSON.parse(row.metadata || '{}');
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    at: row.at,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    orgId: row.org_id,
    outcome: row.outcome,
    metadata,
  };
}
