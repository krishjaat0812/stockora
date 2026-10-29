/**
 * Single source of truth for Stockora's feature catalog, plans, dependency
 * rules and effective-permission calculation. Imported by both the browser
 * app and the Cloudflare Worker so the two never disagree about access.
 */

export type FeatureId =
  | 'dashboard'
  | 'inventory'
  | 'action_center'
  | 'expiry_monitor'
  | 'reorder_planner'
  | 'reports'
  | 'suppliers'
  | 'demand_analytics'
  | 'business_calculator'
  | 'csv_import'
  | 'csv_export'
  | 'notifications';

export type FeatureGroup = 'core' | 'monitoring' | 'data' | 'exchange';

export interface FeatureDef {
  id: FeatureId;
  label: string;
  description: string;
  group: FeatureGroup;
  /** Features that must also be enabled for this one to be usable. */
  dependencies: FeatureId[];
  /** Globally available in this build (kept for forward compatibility). */
  globallyEnabled: boolean;
}

export const FEATURES: FeatureDef[] = [
  {
    id: 'dashboard',
    label: 'Overview Dashboard',
    description: 'KPI cards, inventory health chart, briefing and recent activity.',
    group: 'core',
    dependencies: [],
    globallyEnabled: true,
  },
  {
    id: 'inventory',
    label: 'Inventory Management',
    description: 'Product list, add/edit/delete products and stock levels.',
    group: 'data',
    dependencies: [],
    globallyEnabled: true,
  },
  {
    id: 'action_center',
    label: 'Action Center',
    description: 'Prioritized unified queue of products needing attention.',
    group: 'monitoring',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'expiry_monitor',
    label: 'Expiry Monitor',
    description: 'Expiry groups, timelines and stock-rotation guidance.',
    group: 'monitoring',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'reorder_planner',
    label: 'Reorder Planner',
    description: 'Replenishment suggestions with formula breakdown.',
    group: 'monitoring',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    description: 'Health distribution, category overview and impact reports.',
    group: 'monitoring',
    dependencies: [],
    globallyEnabled: true,
  },
  {
    id: 'suppliers',
    label: 'Supplier Management',
    description: 'Supplier directory, contact details, lead times and product links.',
    group: 'data',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'demand_analytics',
    label: 'Demand Analytics',
    description: 'Recorded sales velocity, best sellers, slow movers, overstock and stockout risk.',
    group: 'monitoring',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'business_calculator',
    label: 'Business Calculator',
    description:
      'Retail calculation workspace: margins, markdowns, GST, break-even, supplier quotes and expiry loss.',
    group: 'monitoring',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'csv_import',
    label: 'CSV Import',
    description: 'Upload and validate inventory CSV files.',
    group: 'exchange',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'csv_export',
    label: 'CSV Export',
    description: 'Download inventory, action, expiry and reorder CSV files.',
    group: 'exchange',
    dependencies: ['inventory'],
    globallyEnabled: true,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'In-app stock and expiry alert inbox.',
    group: 'core',
    dependencies: [],
    globallyEnabled: true,
  },
];

export const FEATURE_IDS: FeatureId[] = FEATURES.map((feature) => feature.id);

export const FEATURE_MAP: Record<FeatureId, FeatureDef> = FEATURES.reduce(
  (acc, feature) => {
    acc[feature.id] = feature;
    return acc;
  },
  {} as Record<FeatureId, FeatureDef>,
);

export const GROUP_LABELS: Record<FeatureGroup, string> = {
  core: 'Core',
  data: 'Inventory data',
  monitoring: 'Monitoring & analysis',
  exchange: 'Data exchange',
};

/**
 * Features that read the organisation's inventory data. The organisation may
 * only load its workspace state when at least one of these is enabled.
 */
export const CONTENT_FEATURES: FeatureId[] = [
  'dashboard',
  'inventory',
  'action_center',
  'expiry_monitor',
  'reorder_planner',
  'reports',
  'suppliers',
  'demand_analytics',
  'business_calculator',
  'csv_import',
  'csv_export',
];

export interface Plan {
  id: string;
  name: string;
  description: string;
  features: FeatureId[];
}

/** Plan catalogue seeded into the database. Plans only ever *allow* features. */
export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Dashboard, inventory and expiry essentials for a single shop.',
    features: ['dashboard', 'inventory', 'expiry_monitor', 'notifications'],
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'Adds the Action Center, Reorder Planner, Suppliers, Demand Analytics, Business Calculator and CSV workflows.',
    features: [
      'dashboard',
      'inventory',
      'action_center',
      'expiry_monitor',
      'reorder_planner',
      'suppliers',
      'demand_analytics',
      'business_calculator',
      'notifications',
      'csv_import',
      'csv_export',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Every feature including Reports & Analytics.',
    features: [...FEATURE_IDS],
  },
];

export const DEFAULT_PLAN_ID = 'starter';

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export type Permissions = Record<FeatureId, boolean>;

function allPermissions(value: boolean): Permissions {
  return FEATURE_IDS.reduce((acc, id) => {
    acc[id] = value;
    return acc;
  }, {} as Permissions);
}

/**
 * Effective permissions, in precedence order:
 *
 *  1. The account and organisation must be active — otherwise everything is denied.
 *  2. The feature must be globally enabled in this build.
 *  3. The assigned plan must allow the feature (if a plan is assigned).
 *  4. An explicit organisation override always wins over the plan default.
 *  5. The caller's role is checked separately by the server (admin vs owner).
 *  6. Data access is further scoped to the organisation by the data layer.
 *
 * Any unexpected input fails closed (everything denied).
 */
export function effectivePermissions(input: {
  accountActive: boolean;
  planFeatures?: Iterable<FeatureId> | null;
  overrides?: Partial<Record<FeatureId, boolean>> | null;
}): Permissions {
  if (!input.accountActive) return allPermissions(false);
  const plan = new Set<FeatureId>(input.planFeatures ?? []);
  const overrides = input.overrides ?? {};
  const result = {} as Permissions;
  for (const feature of FEATURES) {
    const planAllows = plan.size > 0 ? plan.has(feature.id) : false;
    const override = overrides[feature.id];
    const granted = override !== undefined && override !== null ? override : planAllows;
    result[feature.id] = Boolean(feature.globallyEnabled && granted);
  }
  return result;
}

// ---------- Per-action permissions ----------

/**
 * The actions an administrator can grant or deny *within* an enabled
 * feature. Feature-level access answers "may they use this module?"; action
 * permissions answer "what may they do with it?" — for example Inventory can
 * be enabled while product deletion stays denied.
 */
export type ActionId = 'view' | 'create' | 'edit' | 'delete' | 'export';

export const ACTIONS: ActionId[] = ['view', 'create', 'edit', 'delete', 'export'];

export const ACTION_LABELS: Record<ActionId, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  export: 'Export',
};

export const ACTION_DESCRIPTIONS: Record<ActionId, string> = {
  view: 'Open the page and read its data.',
  create: 'Add new records.',
  edit: 'Change existing records.',
  delete: 'Remove records permanently.',
  export: 'Download data as a CSV file.',
};

/**
 * Which actions each feature actually performs. The admin UI only offers
 * these — a control the backend cannot enforce must never be displayed.
 */
export const FEATURE_ACTIONS: Record<FeatureId, ActionId[]> = {
  dashboard: ['view'],
  inventory: ['view', 'create', 'edit', 'delete'],
  action_center: ['view', 'edit'],
  expiry_monitor: ['view', 'edit'],
  reorder_planner: ['view', 'edit', 'export'],
  reports: ['view', 'export'],
  suppliers: ['view', 'create', 'edit', 'delete'],
  demand_analytics: ['view', 'create', 'delete'],
  business_calculator: ['view'],
  csv_import: ['view', 'create'],
  csv_export: ['view', 'export'],
  notifications: ['view', 'edit', 'delete'],
};

/** Explicit per-organisation denials/grants, keyed by feature then action. */
export type ActionOverrides = Partial<Record<ActionId, boolean>>;
export type ActionOverrideMap = Partial<Record<FeatureId, ActionOverrides>>;

/** Fully resolved action permissions for every feature. */
export type ActionPermissions = Record<FeatureId, Record<ActionId, boolean>>;

/**
 * Effective actions for one feature, in precedence order:
 *
 *  1. A disabled feature grants nothing, whatever the overrides say.
 *  2. An action the feature does not perform is always false.
 *  3. An explicit organisation override wins.
 *  4. Anything else defaults to allowed — enabling a feature means usable.
 *  5. `view` is the master switch: denying it denies every other action, so
 *     "enabled but invisible" can never leave an unreachable API surface.
 *
 * Fails closed on unknown input.
 */
export function effectiveActionsForFeature(input: {
  feature: FeatureId;
  featureEnabled: boolean;
  overrides?: ActionOverrides | null;
}): Record<ActionId, boolean> {
  const supported = new Set(FEATURE_ACTIONS[input.feature] ?? []);
  const overrides = input.overrides ?? {};
  const viewAllowed = Boolean(
    input.featureEnabled &&
      supported.has('view') &&
      (overrides.view === undefined ? true : overrides.view),
  );
  const result = {} as Record<ActionId, boolean>;
  for (const action of ACTIONS) {
    const override = overrides[action];
    result[action] = Boolean(
      input.featureEnabled &&
        viewAllowed &&
        supported.has(action) &&
        (override === undefined ? true : override),
    );
  }
  return result;
}

export function effectiveActionPermissions(input: {
  permissions: Permissions;
  overrides?: ActionOverrideMap | null;
}): ActionPermissions {
  const result = {} as ActionPermissions;
  for (const feature of FEATURES) {
    result[feature.id] = effectiveActionsForFeature({
      feature: feature.id,
      featureEnabled: Boolean(input.permissions[feature.id]),
      overrides: input.overrides?.[feature.id],
    });
  }
  return result;
}

/** True when any action on any feature was narrowed away from its default. */
export function hasActionOverrides(overrides: ActionOverrideMap | null | undefined): boolean {
  if (!overrides) return false;
  return Object.values(overrides).some((feature) =>
    feature ? Object.keys(feature).length > 0 : false,
  );
}

export interface SelectionValidation {
  ok: boolean;
  errors: Array<{ feature: FeatureId; message: string }>;
}

/**
 * Validates a requested set of enabled features against the dependency rules.
 * Enabling a feature whose dependency is off is invalid; disabling a feature
 * while dependents remain on is invalid (the caller must send the full
 * intended selection, e.g. turning Inventory off also turns its dependents off).
 */
export function validateFeatureSelection(
  enabled: Iterable<FeatureId>,
  allValid: Iterable<FeatureId> = FEATURE_IDS,
): SelectionValidation {
  const set = new Set(enabled);
  const known = new Set(allValid);
  const errors: Array<{ feature: FeatureId; message: string }> = [];
  for (const id of set) {
    if (!known.has(id)) {
      errors.push({ feature: id, message: `Unknown feature "${id}".` });
      continue;
    }
    const def = FEATURE_MAP[id];
    for (const dep of def.dependencies) {
      if (!set.has(dep)) {
        errors.push({
          feature: id,
          message: `${def.label} requires ${FEATURE_MAP[dep].label} to be enabled.`,
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Features that must be switched off when `feature` is disabled. */
export function dependentFeatures(feature: FeatureId, enabled: Iterable<FeatureId>): FeatureId[] {
  const set = new Set(enabled);
  const affected = new Set<FeatureId>();
  const walk = (id: FeatureId) => {
    for (const candidate of set) {
      if (affected.has(candidate)) continue;
      if (FEATURE_MAP[candidate].dependencies.includes(id)) {
        affected.add(candidate);
        walk(candidate);
      }
    }
  };
  walk(feature);
  return [...affected];
}

export type RouteDef = { path: string; feature: FeatureId; label: string };

/** Client routes that are gated by a feature permission. */
export const FEATURE_ROUTES: RouteDef[] = [
  { path: '/', feature: 'dashboard', label: 'Overview' },
  { path: '/inventory', feature: 'inventory', label: 'Inventory' },
  { path: '/actions', feature: 'action_center', label: 'Action Center' },
  { path: '/expiry', feature: 'expiry_monitor', label: 'Expiry Monitor' },
  { path: '/reorder', feature: 'reorder_planner', label: 'Reorder Planner' },
  { path: '/reports', feature: 'reports', label: 'Reports & Impact' },
  { path: '/suppliers', feature: 'suppliers', label: 'Suppliers' },
  { path: '/demand', feature: 'demand_analytics', label: 'Demand Analytics' },
  { path: '/calculator', feature: 'business_calculator', label: 'Business Calculator' },
];

/** Route path for a feature (used for fallbacks and navigation). */
export function routeForFeature(feature: FeatureId): string | undefined {
  return FEATURE_ROUTES.find((route) => route.feature === feature)?.path;
}

/**
 * Landing route for a client whose current page became unavailable: the first
 * feature route they are still permitted to use. Settings and Security are
 * always permitted, so this never returns undefined in practice.
 */
export function fallbackRoute(permissions: Permissions): string {
  const route = FEATURE_ROUTES.find((entry) => permissions[entry.feature]);
  return route?.path ?? '/settings';
}
