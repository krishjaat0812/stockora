import { Hono } from 'hono';
import { effectivePermissions, fallbackRoute, type ActionPermissions, type Permissions } from '../../src/shared/features';
import { recordAudit } from '../audit';
import { dummyVerify, hashPassword, validatePassword, verifyPassword } from '../auth/password';
import {
  attachSessionCookie,
  canChangeOwnPassword,
  clearSessionCookie,
  computeAccess,
  cookieSecure,
  createSession,
  revokeSession,
  revokeUserSessions,
  resolveSession,
  readSessionToken,
  type AuthContext,
} from '../auth/session';
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  newToken,
  recordLoginAttempt,
  sha256Hex,
} from '../auth/ratelimit';
import { getSecurityPolicy, uuid } from '../db';
import type { Env } from '../env';
import { clientIp, isEmail, readJson, respond } from '../http';
import { requireUser, type AppEnv } from '../middleware';

/**
 * Authentication endpoints: login (with rate limiting), logout, session
 * introspection, forgot/reset password (single-use expiring tokens),
 * change password, and invitation acceptance for admin-created accounts.
 */

interface SessionPayload {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: AuthContext['role'];
    capabilities: string[];
  };
  org: { id: string; name: string; planId: string | null } | null;
  permissions: Permissions;
  /** Per-action permissions inside each enabled feature (enforced server-side). */
  actions: ActionPermissions;
  /** Whether the administrator's password policy currently allows this user to change their own password. */
  canChangePassword: boolean;
  /** Convenience for the client router; permissions are enforced server-side too. */
  landing: string;
}

async function buildSessionPayload(env: Env, auth: AuthContext): Promise<SessionPayload> {
  const access = await computeAccess(env, auth);
  const canChangePassword = await canChangeOwnPassword(env, auth);
  const isStaff = auth.role !== 'owner';
  return {
    user: {
      id: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
      role: auth.role,
      capabilities: auth.capabilities,
    },
    org: auth.orgId ? { id: auth.orgId, name: auth.orgName ?? 'Your shop', planId: auth.planId } : null,
    permissions: access.permissions,
    actions: access.actions,
    canChangePassword,
    landing: isStaff ? '/admin' : fallbackRoute(access.permissions),
  };
}

function devOrigin(c: { req: { header: (name: string) => string | undefined } }, env: Env): string {
  return (
    c.req.header('Origin')?.replace(/\/$/, '') ??
    (env.APP_ORIGINS ?? '').split(',')[0]?.trim() ??
    'http://localhost:5173'
  );
}

export function buildAuthRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/login', async (c) => {
    const parsed = await readJson<{ email?: string; password?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const email = (parsed.body.email ?? '').trim().toLowerCase();
    const password = parsed.body.password ?? '';
    const ip = clientIp(c);

    if (!email || !password) {
      return respond({ code: 'missing_fields', message: 'Enter your email and password.' }, { status: 400 });
    }

    const limit = await checkLoginRateLimit(c.env, email, ip);
    if (!limit.allowed) {
      await recordAudit(c.env, {
        action: 'login.locked_out',
        actorEmail: email,
        outcome: 'denied',
        metadata: { ip },
      });
      return respond(
        {
          code: 'rate_limited',
          message: 'Too many sign-in attempts. Try again in a few minutes.',
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const user = await c.env.DB.prepare(
      `SELECT u.*, m.org_id FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       WHERE u.email = ?`,
    )
      .bind(email)
      .first<{
        id: string;
        email: string;
        password_hash: string | null;
        display_name: string;
        role: AuthContext['role'];
        status: string;
        capabilities: string;
        org_id: string | null;
      }>();

    const fail = async (message: string) => {
      await recordLoginAttempt(c.env, email, ip);
      await recordAudit(c.env, {
        action: 'login.failed',
        actorUserId: user?.id ?? null,
        actorEmail: email,
        outcome: 'failure',
        metadata: { ip },
      });
      return respond({ code: 'invalid_credentials', message }, { status: 401 });
    };

    if (!user || !user.password_hash) {
      await dummyVerify(password); // equalize timing for unknown accounts
      return fail('Invalid email or password.');
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) return fail('Invalid email or password.');

    if (user.status === 'invited') {
      return respond(
        {
          code: 'invitation_pending',
          message: 'Finish setting up your account with your invitation link before signing in.',
        },
        { status: 403 },
      );
    }
    if (user.status !== 'active') {
      return respond({ code: 'account_disabled', message: 'This account has been disabled.' }, { status: 403 });
    }

    let orgStatus: 'active' | 'suspended' | null = null;
    let orgId: string | null = null;
    if (user.org_id) {
      const org = await c.env.DB.prepare('SELECT id, status FROM organizations WHERE id = ?')
        .bind(user.org_id)
        .first<{ id: string; status: 'active' | 'suspended' }>();
      orgId = org?.id ?? null;
      orgStatus = org?.status ?? null;
      if (org?.status === 'suspended') {
        await recordLoginAttempt(c.env, email, ip);
        await recordAudit(c.env, {
          action: 'login.failed',
          actorUserId: user.id,
          actorEmail: email,
          orgId,
          outcome: 'denied',
          metadata: { reason: 'organization suspended', ip },
        });
        return respond(
          {
            code: 'account_suspended',
            message: 'This account has been suspended. Contact your administrator.',
          },
          { status: 403 },
        );
      }
    }

    const policy = await getSecurityPolicy(c.env);
    const { token } = await createSession(c.env, user.id, {
      ttlHours: policy.session_ttl_hours,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });
    await clearLoginAttempts(c.env, email, ip);
    await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), user.id)
      .run();
    await recordAudit(c.env, {
      action: 'login.success',
      actorUserId: user.id,
      actorEmail: email,
      orgId,
      metadata: { ip },
    });

    const auth: AuthContext = {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      capabilities: (() => {
        try {
          const parsedCaps = JSON.parse(user.capabilities);
          return Array.isArray(parsedCaps) ? parsedCaps.filter((item): item is string => typeof item === 'string') : [];
        } catch {
          return [];
        }
      })(),
      sessionId: 'login',
      orgId,
      orgName: null,
      orgStatus,
      planId: null,
    };
    // Re-resolve to obtain the full profile (org name/plan) for the payload.
    const resolved = (await resolveSession(c.env, token)) ?? auth;
    const payload = await buildSessionPayload(c.env, resolved);

    const response = respond(payload);
    attachSessionCookie(response.headers, token, {
      secure: cookieSecure(c.env),
      maxAge: policy.session_ttl_hours * 3600,
    });
    return response;
  });

  app.post('/logout', requireUser, async (c) => {
    const auth = c.get('auth');
    await revokeSession(c.env, auth.sessionId);
    await recordAudit(c.env, {
      action: 'logout',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: auth.orgId,
    });
    const response = respond({ ok: true });
    clearSessionCookie(response.headers, cookieSecure(c.env));
    return response;
  });

  app.post('/logout-all', requireUser, async (c) => {
    const auth = c.get('auth');
    const revoked = await revokeUserSessions(c.env, auth.userId);
    await recordAudit(c.env, {
      action: 'session.revoked',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: auth.orgId,
      metadata: { scope: 'all sessions', revoked },
    });
    const response = respond({ ok: true, revoked });
    clearSessionCookie(response.headers, cookieSecure(c.env));
    return response;
  });

  app.get('/session', async (c) => {
    const token = readSessionToken(c.req.header('Cookie'));
    const auth = token ? await resolveSession(c.env, token) : null;
    if (!auth) {
      return respond({ code: 'unauthenticated', message: 'No active session.' }, { status: 401 });
    }
    if (auth.orgId && auth.orgStatus === 'suspended') {
      return respond(
        { code: 'account_suspended', message: 'This account has been suspended.' },
        { status: 403 },
      );
    }
    return respond(await buildSessionPayload(c.env, auth));
  });

  app.post('/forgot', async (c) => {
    const parsed = await readJson<{ email?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const email = (parsed.body.email ?? '').trim().toLowerCase();
    const generic = {
      ok: true as const,
      message:
        'If an account exists for that address, a password reset link has been issued. The link expires shortly and can be used once.',
    };
    if (!isEmail(email)) return respond(generic);
    const user = await c.env.DB.prepare("SELECT id, email, display_name FROM users WHERE email = ? AND status != 'disabled'")
      .bind(email)
      .first<{ id: string; email: string; display_name: string }>();
    if (!user) return respond(generic);

    const policy = await getSecurityPolicy(c.env);
    const token = newToken(32);
    await c.env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        user.id,
        await sha256Hex(token),
        new Date().toISOString(),
        new Date(Date.now() + policy.reset_ttl_minutes * 60_000).toISOString(),
      )
      .run();
    await recordAudit(c.env, {
      action: 'password.reset.requested',
      actorUserId: user.id,
      actorEmail: user.email,
      outcome: 'success',
    });

    if (c.env.DEV_LINKS === 'true') {
      return respond({
        ...generic,
        message: `${generic.message} Email delivery is not configured in this environment — use the development link below.`,
        devResetLink: `${devOrigin(c, c.env)}/reset-password/${token}`,
      });
    }
    return respond(generic);
  });

  app.post('/reset', async (c) => {
    const parsed = await readJson<{ token?: string; password?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const token = parsed.body.token ?? '';
    const password = parsed.body.password ?? '';
    if (!token) {
      return respond({ code: 'invalid_token', message: 'This reset link is invalid or has expired.' }, { status: 400 });
    }
    const row = await c.env.DB.prepare(
      `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.email, u.display_name
       FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ?`,
    )
      .bind(await sha256Hex(token))
      .first<{ id: string; user_id: string; expires_at: string; used_at: string | null; email: string; display_name: string }>();
    const invalid = respond(
      { code: 'invalid_token', message: 'This reset link is invalid or has expired. Request a new one.' },
      { status: 400 },
    );
    if (!row) return invalid;
    if (row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return invalid;

    const policy = await getSecurityPolicy(c.env);
    const errors = validatePassword(password, { minLength: policy.min_password_length }, {
      email: row.email,
      displayName: row.display_name,
    });
    if (errors.length > 0) {
      return respond(
        { code: 'weak_password', message: errors[0], errors },
        { status: 400 },
      );
    }

    await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(password), new Date().toISOString(), row.user_id)
      .run();
    await c.env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.id)
      .run();
    const revoked = await revokeUserSessions(c.env, row.user_id);
    await recordAudit(c.env, {
      action: 'password.reset.completed',
      actorUserId: row.user_id,
      actorEmail: row.email,
      metadata: { sessionsRevoked: revoked },
    });
    return respond({ ok: true, sessionsRevoked: revoked });
  });

  app.post('/change-password', requireUser, async (c) => {
    const auth = c.get('auth');

    // The administrator decides whether this account may change its own
    // password. Checked here on the trusted backend — the client merely
    // hides the form, which is not a control.
    if (!(await canChangeOwnPassword(c.env, auth))) {
      await recordAudit(c.env, {
        action: 'access.denied',
        actorUserId: auth.userId,
        actorEmail: auth.email,
        orgId: auth.orgId,
        outcome: 'denied',
        metadata: {
          path: '/api/auth/change-password',
          method: 'POST',
          reason: 'password change blocked by administrator policy',
        },
      });
      return respond(
        {
          code: 'password_change_disabled',
          message:
            'Your administrator has disabled password changes for this account. Contact your administrator to reset it.',
        },
        { status: 403 },
      );
    }

    const parsed = await readJson<{ currentPassword?: string; newPassword?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const currentPassword = parsed.body.currentPassword ?? '';
    const newPassword = parsed.body.newPassword ?? '';

    const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(auth.userId)
      .first<{ password_hash: string | null }>();
    const valid = user?.password_hash ? await verifyPassword(user.password_hash, currentPassword) : false;
    if (!valid) {
      return respond(
        { code: 'invalid_current', message: 'Your current password is incorrect.' },
        { status: 400 },
      );
    }

    const policy = await getSecurityPolicy(c.env);
    const errors = validatePassword(newPassword, { minLength: policy.min_password_length }, {
      email: auth.email,
      displayName: auth.displayName,
    });
    if (errors.length > 0) {
      return respond({ code: 'weak_password', message: errors[0], errors }, { status: 400 });
    }
    if (await verifyPassword(user!.password_hash!, newPassword)) {
      return respond(
        { code: 'unchanged', message: 'Choose a password you have not used before.' },
        { status: 400 },
      );
    }

    await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(newPassword), new Date().toISOString(), auth.userId)
      .run();
    const revoked = await revokeUserSessions(c.env, auth.userId, auth.sessionId);
    await recordAudit(c.env, {
      action: 'password.changed',
      actorUserId: auth.userId,
      actorEmail: auth.email,
      orgId: auth.orgId,
      metadata: { otherSessionsRevoked: revoked },
    });
    return respond({ ok: true, otherSessionsRevoked: revoked });
  });

  app.get('/invite/:token', async (c) => {
    const token = c.req.param('token');
    const row = await c.env.DB.prepare(
      `SELECT i.id, i.email, i.display_name, i.expires_at, i.accepted_at, o.name AS org_name
       FROM invitations i LEFT JOIN organizations o ON o.id = i.org_id
       WHERE i.token_hash = ?`,
    )
      .bind(await sha256Hex(token))
      .first<{ id: string; email: string; display_name: string; expires_at: string; accepted_at: string | null; org_name: string | null }>();
    const invalid = respond(
      { code: 'invalid_invitation', message: 'This invitation link is invalid or has expired.' },
      { status: 400 },
    );
    if (!row || row.accepted_at || new Date(row.expires_at).getTime() <= Date.now()) return invalid;
    const policy = await getSecurityPolicy(c.env);
    return respond({
      email: row.email,
      displayName: row.display_name,
      organizationName: row.org_name,
      minLength: policy.min_password_length,
    });
  });

  app.post('/invite/accept', async (c) => {
    const parsed = await readJson<{ token?: string; password?: string; displayName?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const token = parsed.body.token ?? '';
    const password = parsed.body.password ?? '';
    const displayName = (parsed.body.displayName ?? '').trim();

    const invitation = await c.env.DB.prepare(
      'SELECT id, org_id, email, display_name, capabilities, expires_at, accepted_at FROM invitations WHERE token_hash = ?',
    )
      .bind(await sha256Hex(token))
      .first<{
        id: string;
        org_id: string | null;
        email: string;
        display_name: string;
        capabilities: string | null;
        expires_at: string;
        accepted_at: string | null;
      }>();
    const invalid = respond(
      { code: 'invalid_invitation', message: 'This invitation link is invalid or has expired.' },
      { status: 400 },
    );
    if (!invitation || invitation.accepted_at || new Date(invitation.expires_at).getTime() <= Date.now()) {
      return invalid;
    }

    const policy = await getSecurityPolicy(c.env);
    const finalName = displayName || invitation.display_name;
    const errors = validatePassword(password, { minLength: policy.min_password_length }, {
      email: invitation.email,
      displayName: finalName,
    });
    if (errors.length > 0) {
      return respond({ code: 'weak_password', message: errors[0], errors }, { status: 400 });
    }

    const existing = await c.env.DB.prepare('SELECT id, status FROM users WHERE email = ?')
      .bind(invitation.email)
      .first<{ id: string; status: string }>();
    let userId: string;
    const now = new Date().toISOString();
    if (existing) {
      if (existing.status === 'active') {
        return respond(
          { code: 'account_exists', message: 'An account with this email already exists. Sign in instead.' },
          { status: 409 },
        );
      }
      userId = existing.id;
      await c.env.DB.prepare(
        "UPDATE users SET password_hash = ?, display_name = ?, status = 'active', capabilities = ?, updated_at = ? WHERE id = ?",
      )
        .bind(
          await hashPassword(password),
          finalName || invitation.display_name,
          JSON.stringify(invitation.capabilities ?? []),
          now,
          userId,
        )
        .run();
    } else {
      userId = uuid();
      await c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, role, status, capabilities, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
        .bind(
          userId,
          invitation.email,
          await hashPassword(password),
          finalName || invitation.display_name,
          invitation.org_id ? 'owner' : 'admin',
          invitation.org_id ? '[]' : JSON.stringify(invitation.capabilities ?? []),
          now,
          now,
        )
        .run();
    }
    if (invitation.org_id) {
      await c.env.DB.prepare(
        'INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(userId, invitation.org_id, 'owner')
        .run();
    }
    await c.env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ?')
      .bind(now, invitation.id)
      .run();

    const { token: sessionToken } = await createSession(c.env, userId, {
      ttlHours: policy.session_ttl_hours,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });
    await recordAudit(c.env, {
      action: 'invitation.accepted',
      actorUserId: userId,
      actorEmail: invitation.email,
      orgId: invitation.org_id,
      targetType: 'invitation',
      targetId: invitation.id,
    });
    const resolved = await resolveSession(c.env, sessionToken);
    if (!resolved) {
      return respond({ code: 'server_error', message: 'Account created but sign-in failed. Please sign in.' }, { status: 500 });
    }
    const response = respond(await buildSessionPayload(c.env, resolved));
    attachSessionCookie(response.headers, sessionToken, {
      secure: cookieSecure(c.env),
      maxAge: policy.session_ttl_hours * 3600,
    });
    return response;
  });

  return app;
}
