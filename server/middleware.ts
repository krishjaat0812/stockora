import type { MiddlewareHandler } from 'hono';
import { CONTENT_FEATURES, type ActionId, type FeatureId, type Permissions } from '../src/shared/features';
import { recordAudit } from './audit';
import {
  computeAccess,
  hasCapability,
  isAdminRole,
  readSessionToken,
  resolveSession,
  type AuthContext,
} from './auth/session';
import type { Env } from './env';

export type Variables = {
  auth: AuthContext;
  permissions: Permissions;
  actions: Record<FeatureId, Record<ActionId, boolean>>;
};

export type AppEnv = { Bindings: Env; Variables: Variables };

export function deny(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ code, message, ...extra }, { status });
}

/**
 * Authenticates the session cookie. Anonymous, expired, revoked, invited or
 * disabled principals never reach a handler; a suspended organisation is
 * rejected here so existing sessions lose access immediately.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c.req.header('Cookie'));
  const auth = token ? await resolveSession(c.env, token) : null;
  if (!auth) return deny(401, 'unauthenticated', 'Sign in to continue.');
  if (auth.orgId && auth.orgStatus === 'suspended') {
    return deny(403, 'account_suspended', 'This account has been suspended. Contact your administrator.');
  }
  const access = await computeAccess(c.env, auth);
  c.set('auth', auth);
  c.set('permissions', access.permissions);
  c.set('actions', access.actions);
  await next();
};

/** Platform administrators only (Super Admin or Admin role). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get('auth');
  if (!auth || !isAdminRole(auth.role)) {
    if (auth) {
      await recordAudit(c.env, {
        action: 'access.denied',
        actorUserId: auth.userId,
        actorEmail: auth.email,
        outcome: 'denied',
        metadata: { path: c.req.path, method: c.req.method, reason: 'admin role required' },
      });
    }
    return deny(403, 'admin_required', 'Administrator access is required.');
  }
  await next();
};

/** Granular administrative capability, e.g. "features:write". */
export function requireCapability(capability: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth || !hasCapability(auth, capability)) {
      if (auth) {
        await recordAudit(c.env, {
          action: 'access.denied',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          outcome: 'denied',
          metadata: { path: c.req.path, method: c.req.method, reason: `missing capability ${capability}` },
        });
      }
      return deny(403, 'forbidden', 'You do not have permission to perform this action.');
    }
    await next();
  };
}

/**
 * A client organisation feature gate, e.g. inventory or csv_export.
 *
 * Requires both that the feature is enabled *and* that viewing it is still
 * permitted — denying View closes the feature's API surface completely, so
 * "enabled but hidden" can never leave an unreachable-but-callable endpoint.
 */
export function requireFeature(feature: FeatureId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const permissions = c.get('permissions');
    const actions = c.get('actions');
    if (!permissions || !permissions[feature]) {
      return deny(403, 'feature_disabled', 'This feature is not enabled for your account.', {
        feature,
      });
    }
    if (!actions?.[feature]?.view) {
      return deny(403, 'action_denied', 'Your administrator has restricted access to this feature.', {
        feature,
        action: 'view',
      });
    }
    await next();
  };
}

/**
 * A specific action inside an enabled feature, e.g. deleting a product or
 * exporting CSV. Checked on the server for every protected operation —
 * hiding the button in the browser is a courtesy, not the control.
 */
export function requireAction(feature: FeatureId, action: ActionId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const actions = c.get('actions');
    const permissions = c.get('permissions');
    // A missing entry fails closed: unknown feature or absent lookup denies.
    if (!permissions?.[feature] || !actions?.[feature]?.[action]) {
      return deny(403, 'action_denied', 'You do not have permission to perform this action.', {
        feature,
        action,
      });
    }
    await next();
  };
}

/** The organisation must have at least one inventory-data feature it may view. */
export const requireContentAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const permissions = c.get('permissions');
  const actions = c.get('actions');
  const viewable = permissions
    ? CONTENT_FEATURES.some((feature) => permissions[feature] && actions?.[feature]?.view)
    : false;
  if (!viewable) {
    return deny(403, 'no_content_access', 'No inventory features are enabled for your account.');
  }
  await next();
};

/** Client panel routes require a linked organisation. */
export const requireOrganization: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get('auth');
  if (!auth?.orgId) {
    return deny(403, 'no_organization', 'This account is not linked to a shop.');
  }
  await next();
};
