import { DEFAULT_PLAN_ID, FEATURES, PLANS } from '../src/shared/features';
import {
  DEFAULT_SETTINGS,
  createSeedProducts,
  createSeedSales,
  createSeedSuppliers,
} from '../src/data/seed';
import type { PersistedState } from '../src/types';
import type { Env } from './env';
import { hashPassword } from './auth/password';

/**
 * Idempotent schema (CREATE ... IF NOT EXISTS) plus first-run bootstrap:
 * feature/plan catalogue, the platform administrator and a demo client
 * organisation. Runs once per isolate behind an in-module guard.
 *
 * D1's exec() splits statements on newlines, so multi-line DDL is applied
 * statement-by-statement through batch() instead.
 */

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('super_admin','admin','owner')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  capabilities TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  plan_id TEXT NOT NULL DEFAULT 'starter',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (user_id, org_id)
)`,
  `CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE IF NOT EXISTS plan_features (
  plan_id TEXT NOT NULL REFERENCES plans(id),
  feature_id TEXT NOT NULL,
  PRIMARY KEY (plan_id, feature_id)
)`,
  `CREATE TABLE IF NOT EXISTS org_feature_overrides (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  feature_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, feature_id)
)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
)`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
  `CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, at)',
  `CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  capabilities TEXT NOT NULL DEFAULT '[]',
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS org_state (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  org_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  metadata TEXT NOT NULL DEFAULT '{}'
)`,
  'CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at)',
  'CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id)',
  `CREATE TABLE IF NOT EXISTS org_feature_actions (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  feature_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view','create','edit','delete','export')),
  allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, feature_id, action)
)`,
  `CREATE TABLE IF NOT EXISTS security_policies (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  min_password_length INTEGER NOT NULL DEFAULT 12,
  session_ttl_hours INTEGER NOT NULL DEFAULT 168,
  login_max_attempts INTEGER NOT NULL DEFAULT 5,
  login_window_minutes INTEGER NOT NULL DEFAULT 15,
  reset_ttl_minutes INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
)`,
];

export const DEFAULT_SECURITY_POLICY = {
  min_password_length: 12,
  session_ttl_hours: 168,
  login_max_attempts: 5,
  login_window_minutes: 15,
  reset_ttl_minutes: 30,
  allow_client_password_change: 1,
};

export interface SecurityPolicyRow {
  min_password_length: number;
  session_ttl_hours: number;
  login_max_attempts: number;
  login_window_minutes: number;
  reset_ttl_minutes: number;
  /** Global default: 1 = clients may change their own password, 0 = blocked. */
  allow_client_password_change: number;
  updated_at: string;
}

/**
 * Columns added after the first release. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so each statement is attempted once per
 * isolate and a duplicate-column error means it already applied.
 */
const COLUMN_MIGRATIONS = [
  `ALTER TABLE security_policies ADD COLUMN allow_client_password_change INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE organizations ADD COLUMN password_change_policy TEXT NOT NULL DEFAULT 'inherit'`,
];

async function applyColumnMigrations(env: Env): Promise<void> {
  for (const statement of COLUMN_MIGRATIONS) {
    try {
      await env.DB.prepare(statement).run();
    } catch (error) {
      const message = String((error as { message?: string })?.message ?? error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }
}

export function uuid(): string {
  return crypto.randomUUID();
}

async function seedCatalogue(env: Env): Promise<void> {
  for (let i = 0; i < PLANS.length; i += 1) {
    const plan = PLANS[i];
    await env.DB.prepare(
      'INSERT INTO plans (id, name, description, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(plan.id, plan.name, plan.description, i)
      .run();
    for (const feature of plan.features) {
      await env.DB.prepare(
        'INSERT INTO plan_features (plan_id, feature_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(plan.id, feature)
        .run();
    }
  }
  await env.DB.prepare(
    "INSERT INTO security_policies (id, min_password_length, session_ttl_hours, login_max_attempts, login_window_minutes, reset_ttl_minutes, allow_client_password_change, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(
      DEFAULT_SECURITY_POLICY.min_password_length,
      DEFAULT_SECURITY_POLICY.session_ttl_hours,
      DEFAULT_SECURITY_POLICY.login_max_attempts,
      DEFAULT_SECURITY_POLICY.login_window_minutes,
      DEFAULT_SECURITY_POLICY.reset_ttl_minutes,
      DEFAULT_SECURITY_POLICY.allow_client_password_change,
      new Date().toISOString(),
    )
    .run();
  // Features unknown to this build are removed from plan mappings so the
  // database never grants a feature the code cannot enforce.
  const placeholders = FEATURES.map(() => '?').join(',');
  await env.DB.prepare(
    `DELETE FROM plan_features WHERE feature_id NOT IN (${placeholders})`,
  )
    .bind(...FEATURES.map((feature) => feature.id))
    .run();
}

async function seedUsers(env: Env): Promise<void> {
  const now = new Date().toISOString();
  // Demo accounts (and their documented passwords) exist only for local
  // development. Any other environment must supply its own credentials, so a
  // public deployment can never expose a known administrator password.
  const demoMode = env.DEV_LINKS === 'true';

  const adminEmail = (env.SEED_ADMIN_EMAIL ?? 'admin@stockora.dev').toLowerCase();
  const configuredAdminPassword = env.SEED_ADMIN_PASSWORD?.trim();
  const existingAdmin = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(adminEmail)
    .first();
  if (!existingAdmin) {
    if (!configuredAdminPassword && !demoMode) {
      console.warn(
        '[stockora] No administrator account exists. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in the deployment environment and redeploy to bootstrap one.',
      );
    } else {
      await env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, role, status, capabilities, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'super_admin', 'active', ?, ?, ?)`,
      )
        .bind(
          uuid(),
          adminEmail,
          await hashPassword(configuredAdminPassword ?? 'StockoraAdmin!2026'),
          'Platform Administrator',
          JSON.stringify(['*']),
          now,
          now,
        )
        .run();
    }
  }

  const ownerEmail = (env.SEED_OWNER_EMAIL ?? 'owner@freshmart.dev').toLowerCase();
  const ownerPassword = env.SEED_OWNER_PASSWORD?.trim() ?? (demoMode ? 'StockoraShop!2026' : '');
  const existingOwner = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(ownerEmail)
    .first();
  if (!existingOwner && ownerPassword) {
    const orgId = uuid();
    const userId = uuid();
    await env.DB.prepare(
      `INSERT INTO organizations (id, name, status, plan_id, created_at, updated_at)
       VALUES (?, 'FreshMart Demo Store', 'active', ?, ?, ?)`,
    )
      .bind(orgId, 'premium', now, now).run();
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, capabilities, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', '[]', ?, ?)`,
    )
      .bind(userId, ownerEmail, await hashPassword(ownerPassword), 'Demo Shop Owner', now, now).run();
    await env.DB.prepare('INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)')
      .bind(userId, orgId, 'owner')
      .run();
    // Demo org starts on the Premium plan with no overrides.
    await env.DB.prepare(
      'INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    )
      .bind(userId, orgId, 'owner')
      .run();
  }

  // Guarantee the default plan row referenced by new organisations exists.
  if (!PLANS.some((plan) => plan.id === DEFAULT_PLAN_ID)) {
    throw new Error(`Default plan ${DEFAULT_PLAN_ID} is missing from the plan catalogue`);
  }
}

let readyPromise: Promise<void> | null = null;

/** Runs schema + bootstrap once per isolate. */
export function ensureReady(env: Env): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await env.DB.batch(SCHEMA_STATEMENTS.map((statement) => env.DB.prepare(statement)));
      await applyColumnMigrations(env);
      await seedCatalogue(env);
      await seedUsers(env);
    })().catch((error) => {
      readyPromise = null; // allow retry after a transient failure
      throw error;
    });
  }
  return readyPromise;
}

export async function getSecurityPolicy(env: Env): Promise<SecurityPolicyRow> {
  const row = await env.DB.prepare('SELECT * FROM security_policies WHERE id = 1').first<
    SecurityPolicyRow
  >();
  return row ?? { ...DEFAULT_SECURITY_POLICY, updated_at: new Date().toISOString() };
}

const STATE_VERSION = 1;

/**
 * Documents written before suppliers and sales history existed are read with
 * safe empty defaults. This is intentionally additive: the version stays 1 so
 * an existing organisation is never re-seeded over its real data.
 */
export function normalizePersistedState(raw: PersistedState): PersistedState {
  return {
    ...raw,
    suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : [],
    sales: Array.isArray(raw.sales) ? raw.sales : [],
    salesTrackingSince:
      typeof raw.salesTrackingSince === 'string' ? raw.salesTrackingSince : null,
  };
}

/**
 * Returns the organisation's workspace state, creating the controlled demo
 * dataset the first time the organisation is used. Each organisation owns
 * exactly one state document; no organisation id is ever taken from the
 * caller — it always comes from the authenticated session.
 */
export async function ensureOrgState(
  env: Env,
  orgId: string,
  shopName?: string | null,
): Promise<PersistedState> {
  const existing = await env.DB.prepare('SELECT state_json FROM org_state WHERE org_id = ?')
    .bind(orgId)
    .first<{ state_json: string }>();
  if (existing) {
    try {
      const parsed = JSON.parse(existing.state_json) as PersistedState;
      if (parsed && parsed.version === STATE_VERSION && Array.isArray(parsed.products)) {
        return normalizePersistedState(parsed);
      }
    } catch {
      // fall through and re-seed a corrupted document
    }
  }
  const timestamp = new Date().toISOString();
  const products = createSeedProducts(new Date(), timestamp);
  const { sales, trackingSince } = createSeedSales(products, new Date(), timestamp);
  const settings =
    shopName && shopName !== DEFAULT_SETTINGS.shopName
      ? { ...DEFAULT_SETTINGS, shopName }
      : DEFAULT_SETTINGS;
  const state: PersistedState = {
    version: STATE_VERSION,
    products,
    suppliers: createSeedSuppliers(timestamp),
    sales,
    salesTrackingSince: trackingSince,
    settings,
    activity: [
      {
        id: uuid(),
        type: 'import',
        message: 'Demo inventory loaded',
        detail: `${products.length} sample products initialised`,
        at: timestamp,
      },
    ],
    notifications: [],
    reviews: [],
    notifiedKeys: [],
    seededOn: timestamp,
  };
  await env.DB.prepare(
    `INSERT INTO org_state (org_id, state_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
  )
    .bind(orgId, JSON.stringify(state), timestamp)
    .run();
  return state;
}

export async function saveOrgState(env: Env, orgId: string, state: PersistedState): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO org_state (org_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(org_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at',
  )
    .bind(orgId, JSON.stringify(state), new Date().toISOString())
    .run();
}
