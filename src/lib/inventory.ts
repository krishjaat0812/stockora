import type {
  ActionPriority,
  ExpiryStatus,
  Product,
  ProductInsight,
  RiskCategory,
  Settings,
} from '../types';
import { daysUntil, formatDate, parseISODate } from './date';

export const DEFAULT_EXPIRY_THRESHOLD = 3;
export const DEFAULT_SAFETY_BUFFER = 2;

/** Epsilon guard so float noise (e.g. 4.000000000001) does not add a phantom unit. */
const EPSILON = 1e-9;

export interface RuleSettings {
  expiryThreshold: number;
  safetyBufferDays: number;
}

export function isLowStock(product: Product): boolean {
  return product.currentStock <= product.reorderLevel;
}

/** Days of cover = current stock / average daily sales. Null when daily sales are zero. */
export function daysOfCover(product: Product): number | null {
  if (!Number.isFinite(product.averageDailySales) || product.averageDailySales <= 0) {
    return null;
  }
  return product.currentStock / product.averageDailySales;
}

/**
 * Suggested reorder quantity:
 * max(0, ceil(avgDailySales * (leadTimeDays + safetyBufferDays) - currentStock))
 * This is a suggestion, never a confirmed purchase order.
 */
export function reorderQuantity(product: Product, safetyBufferDays: number): number {
  const buffer = Number.isFinite(safetyBufferDays) && safetyBufferDays >= 0 ? safetyBufferDays : DEFAULT_SAFETY_BUFFER;
  const lead = Number.isFinite(product.leadTimeDays) && product.leadTimeDays >= 0 ? product.leadTimeDays : 0;
  const required = product.averageDailySales * (lead + buffer);
  return Math.max(0, Math.ceil(required - product.currentStock - EPSILON));
}

export function expiryStatus(product: Product, threshold: number, today?: Date): ExpiryStatus {
  const days = daysUntil(product.expiryDate, today);
  if (days === null) return 'missing';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= threshold) return 'near';
  return 'ok';
}

export function riskCategory(
  product: Product,
  settings: RuleSettings,
  today?: Date,
): RiskCategory {
  const low = isLowStock(product);
  const days = daysUntil(product.expiryDate, today);
  if (days !== null && days < 0) return 'expired';
  const near = days !== null && days >= 0 && days <= settings.expiryThreshold;
  if (low && near) return 'both';
  if (low) return 'low-only';
  if (near) return 'expiry-only';
  return 'healthy';
}

export function priorityForRisk(risk: RiskCategory): ActionPriority | null {
  switch (risk) {
    case 'expired':
      return 0;
    case 'both':
      return 1;
    case 'low-only':
      return 2;
    case 'expiry-only':
      return 3;
    default:
      return null;
  }
}

export function suggestedActionFor(risk: RiskCategory): string {
  switch (risk) {
    case 'expired':
      return 'Remove from sale and follow applicable safety and disposal procedures.';
    case 'both':
      return 'Review expiry risk and replenishment needs before deciding the next action.';
    case 'low-only':
      return 'Reorder based on current demand and supplier lead time.';
    case 'expiry-only':
      return 'Prioritize eligible stock rotation and review permitted markdown options.';
    default:
      return 'No action needed. Keep monitoring stock and expiry.';
  }
}

function buildReasons(product: Product, days: number | null, risk: RiskCategory): string[] {
  const reasons: string[] = [];
  if (isLowStock(product)) {
    reasons.push(
      product.currentStock === product.reorderLevel
        ? `Stock (${product.currentStock}) is at the reorder level (${product.reorderLevel}).`
        : `Stock (${product.currentStock}) is at or below the reorder level (${product.reorderLevel}).`,
    );
  }
  if (days !== null && days < 0) {
    const overdue = Math.abs(days);
    reasons.push(
      `Expired ${overdue} day${overdue === 1 ? '' : 's'} ago on ${formatDate(product.expiryDate)}.`,
    );
  } else if (days === 0) {
    reasons.push(`Expires today (${formatDate(product.expiryDate)}).`);
  } else if (days !== null && days <= 30) {
    reasons.push(`Expires in ${days} day${days === 1 ? '' : 's'} on ${formatDate(product.expiryDate)}.`);
  } else if (days !== null && risk === 'both') {
    reasons.push(`Expires on ${formatDate(product.expiryDate)}.`);
  }
  return reasons;
}

export function buildInsight(
  product: Product,
  settings: RuleSettings,
  today?: Date,
): ProductInsight {
  const days = daysUntil(product.expiryDate, today);
  const low = isLowStock(product);
  const expired = days !== null && days < 0;
  const near = days !== null && days >= 0 && days <= settings.expiryThreshold;
  const risk = riskCategory(product, settings, today);
  const priority = priorityForRisk(risk);
  return {
    product,
    daysRemaining: days,
    expiryStatus: days === null ? 'missing' : days < 0 ? 'expired' : days === 0 ? 'today' : days <= settings.expiryThreshold ? 'near' : 'ok',
    isLowStock: low,
    isNearExpiry: near,
    isExpired: expired,
    risk,
    daysOfCover: daysOfCover(product),
    // Expired stock is removed, not replenished, so no quantity is suggested.
    reorderQuantity: expired ? 0 : reorderQuantity(product, settings.safetyBufferDays),
    reasons: buildReasons(product, days, risk),
    suggestedAction: suggestedActionFor(risk),
    priority,
    actionKey: priority === null ? null : `${product.id}:${risk}`,
    stockStatus: product.currentStock <= 0 ? 'out' : low ? 'low' : 'healthy',
  };
}

export function buildInsights(
  products: Product[],
  settings: RuleSettings,
  today?: Date,
): ProductInsight[] {
  return products.map((product) => buildInsight(product, settings, today));
}

function compareNullableAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // unknown cover sorts last, explicitly
  if (b === null) return -1;
  return a - b;
}

/** Unified action queue: expired → combined → low stock → near expiry only. */
export function buildActionQueue(insights: ProductInsight[]): ProductInsight[] {
  const actionable = insights.filter((insight) => insight.priority !== null);
  const byName = (a: ProductInsight, b: ProductInsight) => a.product.name.localeCompare(b.product.name);
  return [...actionable].sort((a, b) => {
    if (a.priority !== b.priority) return (a.priority ?? 9) - (b.priority ?? 9);
    switch (a.priority) {
      case 0:
        return (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0) || byName(a, b);
      case 1:
        return (
          compareNullableAsc(a.daysOfCover, b.daysOfCover) ||
          compareNullableAsc(a.daysRemaining, b.daysRemaining) ||
          byName(a, b)
        );
      case 2:
        return compareNullableAsc(a.daysOfCover, b.daysOfCover) || byName(a, b);
      case 3:
        return compareNullableAsc(a.daysRemaining, b.daysRemaining) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}

export const HEALTH_CATEGORY_META: Record<
  RiskCategory,
  { label: string; shortLabel: string; color: string }
> = {
  healthy: { label: 'Healthy', shortLabel: 'Healthy', color: '#16A34A' },
  'low-only': { label: 'Low stock only', shortLabel: 'Low stock only', color: '#D97706' },
  'expiry-only': { label: 'Near expiry only', shortLabel: 'Near expiry only', color: '#2563EB' },
  both: { label: 'Low stock + near expiry', shortLabel: 'Both risks', color: '#DC2626' },
  expired: { label: 'Expired', shortLabel: 'Expired', color: '#991B1B' },
};

export interface HealthSlice {
  key: RiskCategory;
  label: string;
  count: number;
  percent: number;
  color: string;
}

export interface InventoryMetrics {
  total: number;
  lowStock: number;
  nearExpiry: number;
  expired: number;
  urgent: number;
  healthy: number;
  lowOnly: number;
  expiryOnly: number;
  combined: number;
  unitsInStock: number;
  needsReview: number;
  reviewed: number;
}

export function computeMetrics(
  insights: ProductInsight[],
  reviews: string[] = [],
): InventoryMetrics {
  const reviewedKeys = new Set(reviews);
  const actionable = insights.filter((insight) => insight.priority !== null);
  return {
    total: insights.length,
    lowStock: insights.filter((insight) => insight.isLowStock).length,
    nearExpiry: insights.filter((insight) => insight.isNearExpiry).length,
    expired: insights.filter((insight) => insight.isExpired).length,
    urgent: actionable.length,
    healthy: insights.filter((insight) => insight.risk === 'healthy').length,
    lowOnly: insights.filter((insight) => insight.risk === 'low-only').length,
    expiryOnly: insights.filter((insight) => insight.risk === 'expiry-only').length,
    combined: insights.filter((insight) => insight.risk === 'both').length,
    unitsInStock: insights.reduce((sum, insight) => sum + insight.product.currentStock, 0),
    needsReview: actionable.filter((insight) => !reviewedKeys.has(insight.actionKey ?? '')).length,
    reviewed: actionable.filter((insight) => reviewedKeys.has(insight.actionKey ?? '')).length,
  };
}

/**
 * Mutually exclusive health distribution.
 * Expired products are reported as their own category and excluded from the four live-health slices.
 */
export function healthDistribution(insights: ProductInsight[]): HealthSlice[] {
  const live = insights.filter((insight) => insight.risk !== 'expired');
  const total = live.length;
  const keys: RiskCategory[] = ['healthy', 'low-only', 'expiry-only', 'both'];
  const slices = keys.map((key) => {
    const count = live.filter((insight) => insight.risk === key).length;
    return {
      key,
      label: HEALTH_CATEGORY_META[key].label,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
      color: HEALTH_CATEGORY_META[key].color,
    };
  });
  const expiredCount = insights.filter((insight) => insight.risk === 'expired').length;
  if (expiredCount > 0) {
    const totalWithExpired = insights.length;
    slices.push({
      key: 'expired',
      label: HEALTH_CATEGORY_META.expired.label,
      count: expiredCount,
      percent: totalWithExpired === 0 ? 0 : Math.round((expiredCount / totalWithExpired) * 100),
      color: HEALTH_CATEGORY_META.expired.color,
    });
  }
  return slices;
}

export function buildBriefing(insights: ProductInsight[], settings: RuleSettings): string {
  if (insights.length === 0) {
    return 'No products yet. Add a product or import a CSV to start monitoring stock and expiry.';
  }
  const actionable = insights.filter((insight) => insight.priority !== null);
  if (actionable.length === 0) {
    return `All ${insights.length} products are healthy. No low-stock or expiry risks right now.`;
  }
  const low = insights.filter((insight) => insight.isLowStock).length;
  const expiryRisk = insights.filter((insight) => insight.isNearExpiry || insight.isExpired).length;
  const combined = insights.filter((insight) => insight.risk === 'both').length;
  const expired = insights.filter((insight) => insight.isExpired).length;
  const phrases: string[] = [];

  if (low > 0 && expiryRisk > 0) {
    phrases.push(
      `Review ${low} low-stock product${low === 1 ? '' : 's'} and prioritize ${expiryRisk} expiry-related risk${expiryRisk === 1 ? '' : 's'} (${combined} also low on stock).`,
    );
  } else if (low > 0) {
    phrases.push(`Review ${low} low-stock product${low === 1 ? '' : 's'} and replenish based on demand.`);
  } else if (expiryRisk > 0) {
    phrases.push(`Prioritize ${expiryRisk} expiry-related risk${expiryRisk === 1 ? '' : 's'} before stock rotation.`);
  }

  const withCover = insights
    .filter((insight) => insight.daysOfCover !== null)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const lowest = withCover[0];
  if (lowest && lowest.daysOfCover !== null && lowest.daysOfCover < settings.expiryThreshold + 1) {
    phrases.push(
      `${lowest.product.name} has the thinnest stock cover at ${lowest.daysOfCover.toFixed(1)} days.`,
    );
  }
  if (expired > 0) {
    phrases.push(
      `${expired} product${expired === 1 ? ' has' : 's have'} passed the recorded expiry date and should be removed from sale.`,
    );
  }

  const days = settings.expiryThreshold;
  return `${actionable.length} product${actionable.length === 1 ? '' : 's'} need${actionable.length === 1 ? 's' : ''} attention. ${phrases.join(' ')} Near-expiry threshold is ${days} day${days === 1 ? '' : 's'}.`;
}

export type ExpiryGroupKey = 'expired' | 'today' | 'd1-3' | 'd4-7' | 'later' | 'missing';

export const EXPIRY_GROUP_META: Record<
  ExpiryGroupKey,
  { label: string; description: string; tone: 'critical' | 'warning' | 'info' | 'neutral' }
> = {
  expired: {
    label: 'Expired',
    description: 'Past the recorded expiry date. Do not sell or distribute.',
    tone: 'critical',
  },
  today: {
    label: 'Expires today',
    description: 'Reached the expiry date today. Remove from sale unless verified otherwise.',
    tone: 'warning',
  },
  'd1-3': {
    label: 'Expiring within 1–3 days',
    description: 'Rotate to the front of shelf and review permitted markdowns.',
    tone: 'warning',
  },
  'd4-7': {
    label: 'Expiring within 4–7 days',
    description: 'Plan promotion or rotation in the coming week.',
    tone: 'info',
  },
  later: {
    label: 'Expiring later',
    description: 'More than 7 days of shelf life remaining.',
    tone: 'neutral',
  },
  missing: {
    label: 'Expiry date missing',
    description: 'Add an expiry date to include these products in expiry monitoring.',
    tone: 'neutral',
  },
};

export function expiryGroupFor(days: number | null): ExpiryGroupKey {
  if (days === null) return 'missing';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= 3) return 'd1-3';
  if (days <= 7) return 'd4-7';
  return 'later';
}

export interface ExpiryGroup {
  key: ExpiryGroupKey;
  label: string;
  description: string;
  tone: 'critical' | 'warning' | 'info' | 'neutral';
  items: ProductInsight[];
}

export function groupByExpiry(insights: ProductInsight[]): ExpiryGroup[] {
  const order: ExpiryGroupKey[] = ['expired', 'today', 'd1-3', 'd4-7', 'later', 'missing'];
  return order.map((key) => ({
    key,
    ...EXPIRY_GROUP_META[key],
    items: insights
      .filter((insight) => expiryGroupFor(insight.daysRemaining) === key)
      .sort((a, b) => compareNullableAsc(a.daysRemaining, b.daysRemaining) || a.product.name.localeCompare(b.product.name)),
  }));
}

export interface CategorySummary {
  category: string;
  products: number;
  units: number;
  lowStock: number;
  expiring: number;
  expired: number;
  stockValue: number;
  missingCost: number;
}

export function categorySummary(insights: ProductInsight[]): CategorySummary[] {
  const map = new Map<string, CategorySummary>();
  for (const insight of insights) {
    const { product } = insight;
    const entry =
      map.get(product.category) ??
      {
        category: product.category,
        products: 0,
        units: 0,
        lowStock: 0,
        expiring: 0,
        expired: 0,
        stockValue: 0,
        missingCost: 0,
      };
    entry.products += 1;
    entry.units += product.currentStock;
    if (insight.isLowStock) entry.lowStock += 1;
    if (insight.isNearExpiry) entry.expiring += 1;
    if (insight.isExpired) entry.expired += 1;
    if (product.unitCost !== null && product.unitCost !== undefined) {
      entry.stockValue += product.unitCost * product.currentStock;
    } else {
      entry.missingCost += 1;
    }
    map.set(product.category, entry);
  }
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category));
}

export interface PriorityBucket {
  priority: ActionPriority;
  label: string;
  color: string;
  count: number;
}

export function priorityDistribution(insights: ProductInsight[]): PriorityBucket[] {
  const buckets: Array<Omit<PriorityBucket, 'count'>> = [
    { priority: 0, label: 'Expired', color: '#991B1B' },
    { priority: 1, label: 'Combined risk', color: '#DC2626' },
    { priority: 2, label: 'Low stock only', color: '#D97706' },
    { priority: 3, label: 'Near expiry only', color: '#2563EB' },
  ];
  return buckets.map((bucket) => ({
    ...bucket,
    count: insights.filter((insight) => insight.priority === bucket.priority).length,
  }));
}

/** Products that need replenishment consideration (suggested quantity above zero). */
export function reorderRows(insights: ProductInsight[]): ProductInsight[] {
  return insights
    .filter((insight) => insight.reorderQuantity > 0)
    .sort((a, b) => {
      if (a.daysOfCover === null && b.daysOfCover === null) return a.product.name.localeCompare(b.product.name);
      if (a.daysOfCover === null) return 1;
      if (b.daysOfCover === null) return -1;
      return a.daysOfCover - b.daysOfCover;
    });
}

export function reorderFormula(product: Product, safetyBufferDays: number) {
  const required = product.averageDailySales * (product.leadTimeDays + safetyBufferDays);
  return {
    formula: `max(0, ceil(${product.averageDailySales} × (${product.leadTimeDays} + ${safetyBufferDays}) − ${product.currentStock}))`,
    unitFormula: `max(0, ceil(${product.averageDailySales} × ${product.leadTimeDays + safetyBufferDays} − ${product.currentStock}))`,
    required: Math.ceil(required - EPSILON),
    quantity: reorderQuantity(product, safetyBufferDays),
  };
}

export function formatCover(cover: number | null): string {
  return cover === null ? 'N/A' : `${cover.toFixed(1)} days`;
}

export function expiryLabel(insight: ProductInsight): string {
  const { daysRemaining } = insight;
  if (daysRemaining === null) return 'No expiry date';
  if (daysRemaining < 0) return `Expired ${Math.abs(daysRemaining)}d ago`;
  if (daysRemaining === 0) return 'Expires today';
  return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`;
}

/** Only valid ISO dates are useful; kept as a helper for import validation. */
export function isValidDateString(value: string): boolean {
  return parseISODate(value) !== null;
}

export const DEMO_ACCEPTANCE = {
  expectedIndividualRiskFlags: 7,
  lowStockOnlyFlagsDetected: 3,
  combinedFlagsDetected: 7,
  distinctAffectedProducts: 4,
  expectedFalseAlarms: 0,
} as const;

export function settingsRules(settings: Pick<Settings, 'expiryThreshold' | 'safetyBufferDays'>): RuleSettings {
  return {
    expiryThreshold: settings.expiryThreshold,
    safetyBufferDays: settings.safetyBufferDays,
  };
}
