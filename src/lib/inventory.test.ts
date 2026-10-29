import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { DEFAULT_SETTINGS, createSeedProducts } from '../data/seed';
import {
  buildActionQueue,
  buildBriefing,
  buildInsight,
  buildInsights,
  categorySummary,
  computeMetrics,
  daysOfCover,
  expiryGroupFor,
  expiryStatus,
  groupByExpiry,
  healthDistribution,
  isLowStock,
  reorderQuantity,
  riskCategory,
} from './inventory';
import { addDaysISO } from './date';

/** Reference date keeps the seeded demo deterministic. */
const TODAY = new Date(2026, 9, 25);
const SEEDED_AT = '2026-10-25T08:00:00.000Z';
const products = createSeedProducts(TODAY, SEEDED_AT);
const insights = buildInsights(products, DEFAULT_SETTINGS, TODAY);
const bySku = (sku: string) => {
  const insight = insights.find((item) => item.product.sku === sku);
  if (!insight) throw new Error(`Missing seeded product ${sku}`);
  return insight;
};

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-product',
    sku: 'T001',
    name: 'Test Product',
    category: 'Testing',
    currentStock: 10,
    reorderLevel: 5,
    averageDailySales: 2,
    leadTimeDays: 2,
    expiryDate: addDaysISO(10, TODAY),
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...overrides,
  };
}

describe('Test A — initial seeded data', () => {
  it('loads six products and the correct risk counts', () => {
    expect(products).toHaveLength(6);
    const metrics = computeMetrics(insights);
    expect(metrics.lowStock).toBe(3);
    expect(metrics.nearExpiry).toBe(4);
    expect(metrics.urgent).toBe(4);
    expect(metrics.lowStock + metrics.nearExpiry).toBe(7);
    expect(buildActionQueue(insights)).toHaveLength(4);
  });

  it('reports the expected mutually exclusive health distribution', () => {
    const distribution = healthDistribution(insights);
    const counts = Object.fromEntries(distribution.map((slice) => [slice.key, slice.count]));
    expect(counts.healthy).toBe(2);
    expect(counts['low-only']).toBe(0);
    expect(counts['expiry-only']).toBe(1);
    expect(counts.both).toBe(3);
    expect(distribution).toHaveLength(4);
  });

  it('classifies the seeded products exactly as specified', () => {
    expect(bySku('R101').risk).toBe('both');
    expect(bySku('R102').risk).toBe('healthy');
    expect(bySku('R103').risk).toBe('both');
    expect(bySku('R104').risk).toBe('expiry-only');
    expect(bySku('R105').risk).toBe('both');
    expect(bySku('R106').risk).toBe('healthy');

    expect(bySku('R101').isLowStock).toBe(true);
    expect(bySku('R103').isLowStock).toBe(true);
    expect(bySku('R105').isLowStock).toBe(true);
    expect(bySku('R104').isLowStock).toBe(false);
    expect(bySku('R104').isNearExpiry).toBe(true);
  });

  it('calculates the expected days of cover', () => {
    expect(bySku('R103').daysOfCover?.toFixed(1)).toBe('0.4');
    expect(bySku('R101').daysOfCover?.toFixed(1)).toBe('0.7');
    expect(bySku('R105').daysOfCover?.toFixed(1)).toBe('0.7');
  });
});

describe('Test B — combined risk products appear once with both reasons', () => {
  it('includes Milk, Bread and Yogurt once each in the action queue', () => {
    const queue = buildActionQueue(insights);
    for (const sku of ['R101', 'R103', 'R105']) {
      const entries = queue.filter((insight) => insight.product.sku === sku);
      expect(entries).toHaveLength(1);
      expect(entries[0].risk).toBe('both');
      expect(entries[0].priority).toBe(1);
      expect(entries[0].reasons).toHaveLength(2);
      expect(entries[0].reasons.join(' ')).toMatch(/stock/i);
      expect(entries[0].reasons.join(' ')).toMatch(/expires/i);
    }
  });

  it('orders combined risk by days of cover with Bread first', () => {
    const queue = buildActionQueue(insights);
    expect(queue[0].product.sku).toBe('R103');
  });
});

describe('Test C — Juice is expiry-only', () => {
  it('is near expiry but not low stock and is not auto-replenished', () => {
    const juice = bySku('R104');
    expect(juice.isNearExpiry).toBe(true);
    expect(juice.isLowStock).toBe(false);
    expect(juice.risk).toBe('expiry-only');
    expect(juice.priority).toBe(3);
    expect(juice.reorderQuantity).toBe(0);
    expect(juice.suggestedAction).not.toMatch(/reorder/i);
    expect(juice.suggestedAction).toMatch(/rotation|markdown/i);
  });
});

describe('Test D — live stock change', () => {
  it('recalculates when Rice stock drops from 25 to 6 and back', () => {
    const lowRice = buildInsight({ ...products.find((p) => p.sku === 'R102')!, currentStock: 6 }, DEFAULT_SETTINGS, TODAY);
    expect(lowRice.isLowStock).toBe(true);
    expect(lowRice.risk).toBe('low-only');
    expect(lowRice.priority).toBe(2);

    const lowMetrics = computeMetrics([...insights.filter((i) => i.product.sku !== 'R102'), lowRice]);
    expect(lowMetrics.lowStock).toBe(4);
    expect(lowMetrics.urgent).toBe(5);
    expect(buildActionQueue([...insights.filter((i) => i.product.sku !== 'R102'), lowRice])).toHaveLength(5);

    const distribution = healthDistribution([...insights.filter((i) => i.product.sku !== 'R102'), lowRice]);
    expect(distribution.find((slice) => slice.key === 'healthy')?.count).toBe(1);
    expect(distribution.find((slice) => slice.key === 'low-only')?.count).toBe(1);

    const restored = buildInsight(products.find((p) => p.sku === 'R102')!, DEFAULT_SETTINGS, TODAY);
    expect(restored.risk).toBe('healthy');
    expect(restored.isLowStock).toBe(false);
  });
});

describe('Test E — expiry threshold change', () => {
  it('keeps Bread near expiry and clears Milk, Juice and Yogurt at a 1-day threshold', () => {
    const strict = buildInsights(products, { ...DEFAULT_SETTINGS, expiryThreshold: 1 }, TODAY);
    const get = (sku: string) => strict.find((insight) => insight.product.sku === sku)!;
    expect(get('R103').isNearExpiry).toBe(true);
    expect(get('R101').isNearExpiry).toBe(false);
    expect(get('R104').isNearExpiry).toBe(false);
    expect(get('R105').isNearExpiry).toBe(false);

    const metrics = computeMetrics(strict);
    expect(metrics.lowStock).toBe(3);
    expect(metrics.nearExpiry).toBe(1);
    expect(metrics.combined).toBe(1);
    expect(metrics.expiryOnly).toBe(0);
    expect(get('R101').risk).toBe('low-only');
  });
});

describe('Test F — reorder quantity formula', () => {
  it('matches the specified quantities', () => {
    const quantities = Object.fromEntries(insights.map((insight) => [insight.product.sku, insight.reorderQuantity]));
    expect(quantities.R101).toBe(28); // ceil(12 × (1 + 2) − 8)
    expect(quantities.R102).toBe(0);
    expect(quantities.R103).toBe(26); // ceil(10 × (1 + 2) − 4)
    expect(quantities.R104).toBe(0);
    expect(quantities.R105).toBe(16); // ceil(7 × (1 + 2) − 5)
    expect(quantities.R106).toBe(0);
  });

  it('never returns a negative quantity and respects the safety buffer', () => {
    expect(reorderQuantity(makeProduct({ currentStock: 200 }), 2)).toBe(0);
    expect(reorderQuantity(makeProduct({ averageDailySales: 0 }), 2)).toBe(0);
    expect(reorderQuantity(makeProduct({ averageDailySales: 10, leadTimeDays: 1, currentStock: 4 }), 2)).toBe(26);
    expect(reorderQuantity(makeProduct({ averageDailySales: 1.1, leadTimeDays: 2, currentStock: 0.4 }), 2)).toBe(4);
  });
});

describe('Test G — expired product handling', () => {
  it('classifies a past date as expired and never recommends selling or discounting', () => {
    const expired = buildInsight(
      makeProduct({ expiryDate: addDaysISO(-2, TODAY), currentStock: 3, reorderLevel: 5 }),
      DEFAULT_SETTINGS,
      TODAY,
    );
    expect(expired.isExpired).toBe(true);
    expect(expired.isNearExpiry).toBe(false);
    expect(expired.risk).toBe('expired');
    expect(expired.priority).toBe(0);
    expect(expired.suggestedAction).toMatch(/remove from sale/i);
    expect(expired.suggestedAction).not.toMatch(/discount|sell|markdown/i);
    expect(expired.reasons.join(' ')).toMatch(/expired/i);

    const queue = buildActionQueue([...insights, expired]);
    expect(queue[0].product.sku).toBe('T001');
    expect(queue[0].priority).toBe(0);
  });
});

describe('Inventory rules and edge cases', () => {
  it('triggers low stock when stock equals the reorder level', () => {
    expect(isLowStock(makeProduct({ currentStock: 8, reorderLevel: 8 }))).toBe(true);
    expect(isLowStock(makeProduct({ currentStock: 9, reorderLevel: 8 }))).toBe(false);
  });

  it('treats zero days remaining as expiring today, not expired', () => {
    const today = buildInsight(makeProduct({ expiryDate: addDaysISO(0, TODAY) }), DEFAULT_SETTINGS, TODAY);
    expect(today.expiryStatus).toBe('today');
    expect(today.isExpired).toBe(false);
    expect(today.isNearExpiry).toBe(true);
    expect(today.reasons.join(' ')).toMatch(/expires today/i);
    expect(expiryStatus(makeProduct({ expiryDate: addDaysISO(-1, TODAY) }), 3, TODAY)).toBe('expired');
  });

  it('returns N/A days of cover when average daily sales is zero', () => {
    expect(daysOfCover(makeProduct({ averageDailySales: 0 }))).toBeNull();
    const insight = buildInsight(makeProduct({ averageDailySales: 0 }), DEFAULT_SETTINGS, TODAY);
    expect(insight.daysOfCover).toBeNull();
  });

  it('handles missing expiry dates without classifying them as near expiry', () => {
    const insight = buildInsight(makeProduct({ expiryDate: null }), DEFAULT_SETTINGS, TODAY);
    expect(insight.expiryStatus).toBe('missing');
    expect(insight.isNearExpiry).toBe(false);
    expect(insight.risk).toBe('healthy');
  });

  it('sorts low-stock products with unknown cover last', () => {
    const a = buildInsight(makeProduct({ id: 'a', sku: 'A', name: 'Alpha', currentStock: 1, reorderLevel: 5, averageDailySales: 0 }), DEFAULT_SETTINGS, TODAY);
    const b = buildInsight(makeProduct({ id: 'b', sku: 'B', name: 'Beta', currentStock: 1, reorderLevel: 5, averageDailySales: 5 }), DEFAULT_SETTINGS, TODAY);
    const queue = buildActionQueue([a, b]);
    expect(queue.map((insight) => insight.product.sku)).toEqual(['B', 'A']);
  });

  it('builds mutually exclusive health categories', () => {
    const categories = insights.map((insight) => insight.risk);
    expect(categories).toHaveLength(products.length);
    expect(computeMetrics(insights).healthy).toBe(2);
  });

  it('groups products by expiry window', () => {
    const groups = groupByExpiry(insights);
    expect(groups.map((group) => group.key)).toEqual(['expired', 'today', 'd1-3', 'd4-7', 'later', 'missing']);
    expect(groups.find((group) => group.key === 'd1-3')?.items.map((i) => i.product.sku)).toEqual([
      'R103',
      'R104',
      'R105',
      'R101',
    ]);
    expect(groups.find((group) => group.key === 'later')?.items).toHaveLength(2);
    expect(expiryGroupFor(-1)).toBe('expired');
    expect(expiryGroupFor(0)).toBe('today');
    expect(expiryGroupFor(8)).toBe('later');
    expect(expiryGroupFor(null)).toBe('missing');
  });

  it('summarizes categories with stock value from recorded unit costs', () => {
    const summary = categorySummary(insights);
    const dairy = summary.find((category) => category.category === 'Dairy & Chilled');
    expect(dairy).toBeDefined();
    expect(dairy?.products).toBe(2);
    expect(dairy?.stockValue).toBe(8 * 62 + 5 * 45);
    expect(dairy?.lowStock).toBe(2);
  });

  it('produces a briefing from live counts', () => {
    const briefing = buildBriefing(insights, DEFAULT_SETTINGS);
    expect(briefing).toMatch(/4 products need attention/);
    expect(briefing).toMatch(/3 low-stock/);
    expect(briefing).toMatch(/4 expiry/);
  });

  it('reports no risk for an empty inventory and when everything is healthy', () => {
    expect(buildBriefing([], DEFAULT_SETTINGS)).toMatch(/no products yet/i);
    const healthy = products.filter((product) => ['R102', 'R106'].includes(product.sku));
    expect(buildBriefing(buildInsights(healthy, DEFAULT_SETTINGS, TODAY), DEFAULT_SETTINGS)).toMatch(/are healthy/i);
  });

  it('recalculates changes when the safety buffer changes', () => {
    const noBuffer = buildInsights(products, { ...DEFAULT_SETTINGS, safetyBufferDays: 0 }, TODAY);
    const milk = noBuffer.find((insight) => insight.product.sku === 'R101');
    expect(milk?.reorderQuantity).toBe(4); // ceil(12 × 1 − 8)
  });

  it('keeps risk prioritization ordered as expired, combined, low, expiry', () => {
    const expired = buildInsight(makeProduct({ id: 'x', sku: 'X', name: 'Expired item', expiryDate: addDaysISO(-1, TODAY) }), DEFAULT_SETTINGS, TODAY);
    const queue = buildActionQueue([...insights, expired]);
    const priorities = queue.map((insight) => insight.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => Number(a) - Number(b)));
    expect(priorities[0]).toBe(0);
  });

  it('does not classify expired products in the four live health slices', () => {
    const expired = buildInsight(makeProduct({ id: 'y', sku: 'Y', name: 'Old milk', expiryDate: addDaysISO(-3, TODAY) }), DEFAULT_SETTINGS, TODAY);
    const distribution = healthDistribution([...insights, expired]);
    expect(distribution.find((slice) => slice.key === 'expired')?.count).toBe(1);
    expect(distribution.filter((slice) => slice.key !== 'expired').reduce((sum, slice) => sum + slice.count, 0)).toBe(6);
    expect(riskCategory({ ...expired.product, currentStock: 0 }, DEFAULT_SETTINGS, TODAY)).toBe('expired');
  });
});
