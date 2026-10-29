import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  FEATURE_ACTIONS,
  FEATURE_IDS,
  effectiveActionPermissions,
  effectiveActionsForFeature,
} from '../src/shared/features';
import { productActionViolation } from './routes/state';
import { canChangeOwnPassword, type AuthContext } from './auth/session';
import type { Env } from './env';
import type { Product } from '../src/types';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u1',
    email: 'owner@freshmart.dev',
    displayName: 'Owner',
    role: 'owner',
    capabilities: [],
    sessionId: 's1',
    orgId: 'o1',
    orgName: 'FreshMart',
    orgStatus: 'active',
    planId: 'premium',
    ...overrides,
  };
}

/** Minimal D1 stand-in: prepare().bind().first() returns the configured row. */
function fakeEnv(row: unknown, opts: { orgRow?: unknown } = {}): Env {
  const orgRow = opts.orgRow ?? { password_change_policy: 'inherit' };
  return {
    DB: {
      prepare(sql: string) {
        const isOrg = sql.includes('FROM organizations');
        const resolve = () => (isOrg ? orgRow : row);
        // D1 exposes first() both directly and on a bound statement.
        return {
          first: async () => resolve(),
          bind() {
            return { first: async () => resolve() };
          },
        };
      },
    },
  } as unknown as Env;
}

describe('action permission resolution', () => {
  it('grants every supported action when the feature is enabled', () => {
    const result = effectiveActionsForFeature({
      feature: 'inventory',
      featureEnabled: true,
    });
    for (const action of FEATURE_ACTIONS.inventory) expect(result[action]).toBe(true);
  });

  it('denies everything when the feature is disabled, ignoring overrides', () => {
    const result = effectiveActionsForFeature({
      feature: 'inventory',
      featureEnabled: false,
      overrides: { view: true, create: true, edit: true, delete: true },
    });
    for (const action of ACTIONS) expect(result[action]).toBe(false);
  });

  it('never grants an action the feature does not perform', () => {
    const result = effectiveActionsForFeature({
      feature: 'business_calculator',
      featureEnabled: true,
      overrides: { create: true, delete: true, export: true },
    });
    expect(result.view).toBe(true);
    expect(result.create).toBe(false);
    expect(result.delete).toBe(false);
    expect(result.export).toBe(false);
  });

  it('honours an explicit denial', () => {
    const result = effectiveActionsForFeature({
      feature: 'inventory',
      featureEnabled: true,
      overrides: { delete: false },
    });
    expect(result.delete).toBe(false);
    expect(result.edit).toBe(true);
    expect(result.create).toBe(true);
  });

  it('treats View as the master switch', () => {
    const result = effectiveActionsForFeature({
      feature: 'inventory',
      featureEnabled: true,
      overrides: { view: false, edit: true },
    });
    for (const action of ACTIONS) expect(result[action]).toBe(false);
  });

  it('resolves every catalogued feature without throwing', () => {
    const permissions = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as Record<
      (typeof FEATURE_IDS)[number],
      boolean
    >;
    const map = effectiveActionPermissions({ permissions });
    for (const id of FEATURE_IDS) {
      expect(map[id].view).toBe(FEATURE_ACTIONS[id].includes('view'));
    }
  });
});

describe('product write diffing', () => {
  const base = {
    sku: 'R1',
    name: 'Rice',
    category: 'Groceries',
    currentStock: 10,
    reorderLevel: 5,
    averageDailySales: 1,
    leadTimeDays: 2,
    unitCost: 40,
    expiryDate: null,
    unit: 'kg',
    supplierName: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Product;

  const allowAll = { view: true, create: true, edit: true, delete: true, export: true };
  const readOnly = { view: true, create: false, edit: false, delete: false, export: false };

  it('allows an unchanged list', () => {
    expect(productActionViolation([base], [base], allowAll)).toBeNull();
    expect(productActionViolation([base], [base], readOnly)).toBeNull();
  });

  it('flags additions when create is denied', () => {
    const added = { ...base, id: 'p2', sku: 'R2' } as Product;
    expect(productActionViolation([base], [base, added], allowAll)).toBeNull();
    expect(productActionViolation([base], [base, added], readOnly)).toMatch(/add products/i);
  });

  it('flags edits when edit is denied', () => {
    const edited = { ...base, currentStock: 99 } as Product;
    expect(productActionViolation([base], [edited], readOnly)).toMatch(/edit products/i);
  });

  it('flags removals when delete is denied', () => {
    expect(productActionViolation([base], [], readOnly)).toMatch(/delete products/i);
    expect(productActionViolation([base], [], allowAll)).toBeNull();
  });

  it('reports the first blocking action when several apply', () => {
    const added = { ...base, id: 'p2' } as Product;
    const edited = { ...base, currentStock: 7 } as Product;
    expect(productActionViolation([base], [edited, added], readOnly)).toMatch(/add products/i);
  });
});

describe('password-change policy precedence', () => {
  it('always allows platform administrators', async () => {
    const env = fakeEnv({ allow_client_password_change: 0 }, {
      orgRow: { password_change_policy: 'deny' },
    });
    expect(await canChangeOwnPassword(env, auth({ role: 'super_admin' }))).toBe(true);
    expect(await canChangeOwnPassword(env, auth({ role: 'admin' }))).toBe(true);
  });

  it('follows the global default when the client has no override', async () => {
    expect(
      await canChangeOwnPassword(
        fakeEnv({ allow_client_password_change: 1 }, { orgRow: { password_change_policy: 'inherit' } }),
        auth(),
      ),
    ).toBe(true);
    expect(
      await canChangeOwnPassword(
        fakeEnv({ allow_client_password_change: 0 }, { orgRow: { password_change_policy: 'inherit' } }),
        auth(),
      ),
    ).toBe(false);
  });

  it('lets a per-client override beat the global default', async () => {
    expect(
      await canChangeOwnPassword(
        fakeEnv({ allow_client_password_change: 0 }, { orgRow: { password_change_policy: 'allow' } }),
        auth(),
      ),
    ).toBe(true);
    expect(
      await canChangeOwnPassword(
        fakeEnv({ allow_client_password_change: 1 }, { orgRow: { password_change_policy: 'deny' } }),
        auth(),
      ),
    ).toBe(false);
  });

  it('fails closed without an organisation or on a lookup error', async () => {
    expect(await canChangeOwnPassword(fakeEnv(null), auth({ orgId: null, orgStatus: null }))).toBe(
      false,
    );
    const broken = {
      DB: {
        prepare() {
          throw new Error('boom');
        },
      },
    } as unknown as Env;
    expect(await canChangeOwnPassword(broken, auth())).toBe(false);
  });

  it('denies a suspended organisation', async () => {
    expect(
      await canChangeOwnPassword(fakeEnv({ allow_client_password_change: 1 }), auth({ orgStatus: 'suspended' })),
    ).toBe(false);
  });
});
