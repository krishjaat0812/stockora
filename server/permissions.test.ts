import { describe, expect, it } from 'vitest';
import {
  CONTENT_FEATURES,
  DEFAULT_PLAN_ID,
  FEATURE_IDS,
  PLANS,
  dependentFeatures,
  effectivePermissions,
  fallbackRoute,
  routeForFeature,
  validateFeatureSelection,
  type FeatureId,
} from '../src/shared/features';

const ALL = FEATURE_IDS;

describe('effectivePermissions', () => {
  it('denies everything when the account or organisation is not active', () => {
    const permissions = effectivePermissions({ accountActive: false, planFeatures: ALL });
    for (const id of FEATURE_IDS) expect(permissions[id]).toBe(false);
  });

  it('grants exactly the plan features for a fresh organisation with no overrides', () => {
    const starter = PLANS.find((plan) => plan.id === 'starter')!;
    const permissions = effectivePermissions({
      accountActive: true,
      planFeatures: starter.features,
      overrides: {},
    });
    expect(permissions.dashboard).toBe(true);
    expect(permissions.inventory).toBe(true);
    expect(permissions.expiry_monitor).toBe(true);
    expect(permissions.reports).toBe(false);
    expect(permissions.reorder_planner).toBe(false);
    expect(permissions.csv_export).toBe(false);
  });

  it('lets an explicit grant override the plan default', () => {
    const starter = PLANS.find((plan) => plan.id === 'starter')!;
    const permissions = effectivePermissions({
      accountActive: true,
      planFeatures: starter.features,
      overrides: { reports: true },
    });
    expect(permissions.reports).toBe(true);
  });

  it('lets an explicit denial override the plan default', () => {
    const premium = PLANS.find((plan) => plan.id === 'premium')!;
    const permissions = effectivePermissions({
      accountActive: true,
      planFeatures: premium.features,
      overrides: { csv_export: false },
    });
    expect(permissions.csv_export).toBe(false);
    expect(permissions.csv_import).toBe(true);
  });

  it('denies everything when no plan and no overrides exist (safe default)', () => {
    const permissions = effectivePermissions({ accountActive: true, planFeatures: [], overrides: {} });
    for (const id of FEATURE_IDS) expect(permissions[id]).toBe(false);
  });

  it('handles null plan/overrides inputs without granting access', () => {
    const permissions = effectivePermissions({ accountActive: true, planFeatures: null, overrides: null });
    for (const id of FEATURE_IDS) expect(permissions[id]).toBe(false);
  });
});

describe('validateFeatureSelection', () => {
  it('accepts a valid selection', () => {
    expect(validateFeatureSelection(ALL).ok).toBe(true);
    expect(validateFeatureSelection(['dashboard', 'inventory', 'notifications']).ok).toBe(true);
  });

  it('rejects dependent features when inventory is off', () => {
    const result = validateFeatureSelection(['dashboard', 'action_center']);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.feature).toBe('action_center');
  });

  it('rejects csv features without inventory', () => {
    expect(validateFeatureSelection(['csv_import']).ok).toBe(false);
    expect(validateFeatureSelection(['csv_export']).ok).toBe(false);
  });

  it('rejects unknown feature ids', () => {
    const result = validateFeatureSelection(['inventory', 'made_up'] as FeatureId[]);
    expect(result.ok).toBe(false);
  });
});

describe('dependentFeatures', () => {
  it('lists features that must turn off when inventory is disabled', () => {
    const affected = dependentFeatures('inventory', ALL).sort();
    expect(affected).toEqual(
      [
        'action_center',
        'business_calculator',
        'csv_export',
        'csv_import',
        'expiry_monitor',
        'reorder_planner',
        'suppliers',
        'demand_analytics',
      ].sort(),
    );
  });

  it('returns nothing for a leaf feature', () => {
    expect(dependentFeatures('dashboard', ALL)).toEqual([]);
    expect(dependentFeatures('notifications', ALL)).toEqual([]);
  });
});

describe('fallback routing', () => {
  it('lands on the first permitted feature route', () => {
    const permissions = effectivePermissions({
      accountActive: true,
      planFeatures: ['inventory', 'expiry_monitor'],
      overrides: {},
    });
    expect(fallbackRoute(permissions)).toBe('/inventory');
    expect(routeForFeature('expiry_monitor')).toBe('/expiry');
  });

  it('falls back to settings when no content route is permitted', () => {
    const permissions = effectivePermissions({ accountActive: true, planFeatures: [], overrides: {} });
    expect(fallbackRoute(permissions)).toBe('/settings');
  });

  it('every page-backed feature has a route and the default plan is valid', () => {
    const pageFeatures: FeatureId[] = [
      'dashboard',
      'inventory',
      'action_center',
      'expiry_monitor',
      'reorder_planner',
      'reports',
      'suppliers',
      'demand_analytics',
      'business_calculator',
    ];
    expect(routeForFeature('business_calculator')).toBe('/calculator');
    expect(routeForFeature('suppliers')).toBe('/suppliers');
    expect(routeForFeature('demand_analytics')).toBe('/demand');
    for (const feature of pageFeatures) {
      expect(routeForFeature(feature)).toBeDefined();
    }
    // CSV features are operations, not pages — they must not claim routes.
    expect(routeForFeature('csv_import')).toBeUndefined();
    expect(routeForFeature('csv_export')).toBeUndefined();
    // Every page feature is part of the content set.
    for (const feature of pageFeatures) expect(CONTENT_FEATURES).toContain(feature);
    const defaultPlan = PLANS.find((plan) => plan.id === DEFAULT_PLAN_ID);
    expect(defaultPlan).toBeDefined();
    expect(validateFeatureSelection(defaultPlan!.features).ok).toBe(true);
  });
});
