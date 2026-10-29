import type { Product, SaleRecord, Supplier } from '../types';
import { addDaysISO, daysUntil, differenceInCalendarDays, formatDate, parseISODate, todayISO } from './date';

/**
 * Product demand analytics.
 *
 * Everything here is derived from *recorded sales transactions* — never from
 * guessed numbers. When an organisation has not recorded enough history (or a
 * product is newly added), the product is classified as `insufficient-history`
 * rather than being reported as zero demand, so an absence of data can never
 * look like proof that an item does not sell.
 *
 * The module is pure so the Worker, the browser and the tests all agree.
 */

export type DemandClassification = 'best-seller' | 'steady' | 'slow-moving' | 'insufficient-history';
export type DemandFlag = 'stockout-risk' | 'overstock' | 'no-recent-sales';
export type DemandTrend = 'up' | 'down' | 'flat' | 'new' | 'unknown';

export const DEMAND_WINDOWS = [7, 30, 90] as const;
export type DemandWindow = (typeof DEMAND_WINDOWS)[number];

export const MIN_HISTORY_DAYS = 14;
export const OVERSTOCK_DAYS = 60;

export const CLASSIFICATION_META: Record<
  DemandClassification,
  { label: string; tone: 'ok' | 'warn' | 'crit' | 'info' | 'neutral'; description: string }
> = {
  'best-seller': {
    label: 'Best seller',
    tone: 'ok',
    description: 'Top quartile of recorded sales velocity in the selected window.',
  },
  steady: {
    label: 'Steady',
    tone: 'info',
    description: 'Selling regularly, below the top quartile.',
  },
  'slow-moving': {
    label: 'Slow moving',
    tone: 'warn',
    description: 'Little or no recorded sales while stock is still on hand.',
  },
  'insufficient-history': {
    label: 'Not enough history',
    tone: 'neutral',
    description: 'Too few days of recorded sales to judge demand. Not treated as zero demand.',
  },
};

export const FLAG_META: Record<DemandFlag, { label: string; tone: 'ok' | 'warn' | 'crit' | 'info' | 'neutral' }> = {
  'stockout-risk': { label: 'Stockout risk', tone: 'crit' },
  overstock: { label: 'Overstock', tone: 'warn' },
  'no-recent-sales': { label: 'No recent sales', tone: 'neutral' },
};

export interface ProductDemand {
  productId: string;
  sku: string;
  name: string;
  category: string;
  unitsSold: number;
  previousUnits: number;
  transactions: number;
  revenue: number;
  /** True when at least one sale in the window carried a price. */
  revenueAvailable: boolean;
  velocity: number;
  previousVelocity: number;
  trend: DemandTrend;
  /** Days of stock at the recorded velocity; null when nothing is selling. */
  coverageDays: number | null;
  classification: DemandClassification;
  flags: DemandFlag[];
  reasons: string[];
  recommendation: string;
  stock: number;
  unit: string | undefined;
  stockValue: number;
  daysTracked: number;
  lastSoldAt: string | null;
  expired: boolean;
  supplierId: string | null;
  supplierName: string | null;
  /** Advisory only — never applied to inventory automatically. */
  suggestedOrder: number;
}

export interface DemandSummary {
  windowDays: DemandWindow;
  trackingSince: string | null;
  trackingDays: number;
  hasHistory: boolean;
  unitsSold: number;
  revenue: number;
  revenueAvailable: boolean;
  transactions: number;
  bestSellerCount: number;
  steadyCount: number;
  slowMovingCount: number;
  insufficientCount: number;
  stockoutRiskCount: number;
  overstockCount: number;
  overstockValue: number;
  slowMovingValue: number;
}

export interface DemandReport {
  summary: DemandSummary;
  items: ProductDemand[];
  bestSellers: ProductDemand[];
  slowMovers: ProductDemand[];
  stockoutRisks: ProductDemand[];
  overstock: ProductDemand[];
}

export interface DemandOptions {
  windowDays?: DemandWindow | number;
  overstockDays?: number;
  minHistoryDays?: number;
  today?: Date;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function percentile75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(0.75 * (sorted.length - 1));
  return sorted[index];
}

function createdDaysAgo(product: Product, today: Date): number | null {
  const created = parseISODate(product.createdAt?.slice(0, 10));
  if (!created) return null;
  return Math.max(0, differenceInCalendarDays(today, created));
}

export function analyzeDemand(
  input: {
    products: Product[];
    sales: SaleRecord[];
    trackingSince?: string | null;
    suppliers?: Supplier[];
  },
  options: DemandOptions = {},
): DemandReport {
  const today = options.today ?? new Date();
  const todayIso = todayISO(today);
  const requested = Number(options.windowDays ?? 30);
  const windowDays: DemandWindow = (DEMAND_WINDOWS as readonly number[]).includes(requested)
    ? (requested as DemandWindow)
    : 30;
  const overstockDays = options.overstockDays ?? OVERSTOCK_DAYS;
  const minHistoryDays = options.minHistoryDays ?? MIN_HISTORY_DAYS;

  const windowStart = addDaysISO(-(windowDays - 1), today);
  const previousStart = addDaysISO(-(windowDays * 2 - 1), today);
  const previousEnd = addDaysISO(-windowDays, today);

  const sales = input.sales.filter((sale) => parseISODate(sale.soldAt) !== null && sale.soldAt <= todayIso);
  const firstSale = sales.reduce<string | null>(
    (earliest, sale) => (earliest === null || sale.soldAt < earliest ? sale.soldAt : earliest),
    null,
  );
  const trackingSince = input.trackingSince && input.trackingSince <= todayIso ? input.trackingSince : firstSale;
  const trackingDays = trackingSince
    ? Math.max(0, differenceInCalendarDays(today, parseISODate(trackingSince) ?? today) + 1)
    : 0;
  const orgHistorySufficient = trackingDays >= minHistoryDays;
  // A period-over-period trend is only meaningful when the previous window is
  // fully covered by recorded history; otherwise it is withheld.
  const previousObserved = trackingSince !== null && previousStart >= trackingSince;

  const supplierById = new Map((input.suppliers ?? []).map((supplier) => [supplier.id, supplier]));
  const supplierByName = new Map(
    (input.suppliers ?? []).map((supplier) => [supplier.name.trim().toLowerCase(), supplier]),
  );

  interface Draft {
    product: Product;
    units: number;
    previousUnits: number;
    transactions: number;
    revenue: number;
    revenueAvailable: boolean;
    lastSoldAt: string | null;
    daysAvailable: number;
    velocity: number;
    previousVelocity: number;
    eligible: boolean;
    historyReason: string | null;
  }

  const drafts: Draft[] = input.products.map((product) => {
    const productSales = sales.filter((sale) => sale.productId === product.id);
    const current = productSales.filter((sale) => sale.soldAt >= windowStart);
    const previous = productSales.filter(
      (sale) => sale.soldAt >= previousStart && sale.soldAt <= previousEnd,
    );
    const units = current.reduce((sum, sale) => sum + Math.max(0, sale.quantity), 0);
    const previousUnits = previous.reduce((sum, sale) => sum + Math.max(0, sale.quantity), 0);
    const priced = current.filter((sale) => sale.unitPrice !== null && sale.unitPrice !== undefined);
    const revenue = priced.reduce((sum, sale) => sum + (sale.unitPrice ?? 0) * sale.quantity, 0);
    const lastSoldAt = productSales.reduce<string | null>(
      (latest, sale) => (latest === null || sale.soldAt > latest ? sale.soldAt : latest),
      null,
    );

    const ageDays = createdDaysAgo(product, today);
    const hasRecordedSales = productSales.length > 0;
    // A product with real (possibly imported) sales going back before its
    // record was created is judged on the sales, not on the record's age.
    const daysAvailable = Math.max(
      1,
      Math.min(
        windowDays,
        trackingDays > 0 ? trackingDays : windowDays,
        hasRecordedSales || ageDays === null ? windowDays : ageDays + 1,
      ),
    );

    // Enough history means: the organisation has tracked sales long enough,
    // and either this product has sales evidence or it has existed long enough
    // inside that window to judge an absence of sales.
    let historyReason: string | null = null;
    if (!orgHistorySufficient) {
      historyReason = `Only ${trackingDays} day${trackingDays === 1 ? '' : 's'} of sales history recorded so far; at least ${minHistoryDays} days are needed before judging demand.`;
    } else if (!hasRecordedSales && ageDays !== null && ageDays + 1 < minHistoryDays) {
      historyReason = `Added ${ageDays + 1} day${ageDays === 0 ? '' : 's'} ago; demand is judged after ${minHistoryDays} days of sales.`;
    }

    const eligible = historyReason === null;
    return {
      product,
      units,
      previousUnits,
      transactions: current.length,
      revenue,
      revenueAvailable: priced.length > 0,
      lastSoldAt,
      daysAvailable,
      velocity: units / daysAvailable,
      previousVelocity: previousUnits / Math.max(1, Math.min(windowDays, daysAvailable)),
      eligible,
      historyReason,
    };
  });

  const threshold = percentile75(drafts.filter((draft) => draft.eligible && draft.velocity > 0).map((draft) => draft.velocity));

  const items: ProductDemand[] = drafts.map((draft) => {
    const { product } = draft;
    const stock = Math.max(0, product.currentStock);
    const stockValue = (product.unitCost ?? 0) * stock;
    const coverageDays = draft.velocity > 0 ? stock / draft.velocity : null;
    const expired = product.expiryDate !== null && (daysUntil(product.expiryDate, today) ?? 0) < 0;
    const leadTime = Number.isFinite(product.leadTimeDays) ? product.leadTimeDays : 0;

    let classification: DemandClassification;
    if (!draft.eligible) classification = 'insufficient-history';
    else if (draft.units === 0) classification = 'slow-moving';
    else if (draft.velocity > 0 && draft.velocity >= threshold) classification = 'best-seller';
    else classification = 'steady';

    const flags: DemandFlag[] = [];
    // Expired stock cannot be sold, so reorder advice would be unsafe.
    if (
      draft.eligible &&
      !expired &&
      (stock <= 0
        ? draft.units > 0 || draft.lastSoldAt !== null
        : draft.velocity > 0 && coverageDays !== null && coverageDays <= leadTime + 1)
    ) {
      flags.push('stockout-risk');
    }
    if (draft.units === 0) {
      if (draft.eligible && stock > 0) flags.push('overstock');
      if (draft.eligible) flags.push('no-recent-sales');
    } else if (coverageDays !== null && coverageDays > overstockDays) {
      flags.push('overstock');
    }

    let trend: DemandTrend;
    if (!draft.eligible || !previousObserved) trend = 'unknown';
    else if (draft.previousUnits === 0 && draft.units > 0) trend = 'new';
    else if (draft.previousUnits === 0 && draft.units === 0) trend = 'flat';
    else {
      const change = (draft.units - draft.previousUnits) / draft.previousUnits;
      trend = change >= 0.15 ? 'up' : change <= -0.15 ? 'down' : 'flat';
    }

    const supplier =
      (product.supplierId ? supplierById.get(product.supplierId) : undefined) ??
      (product.supplierName ? supplierByName.get(product.supplierName.trim().toLowerCase()) : undefined);

    const reasons: string[] = [];
    if (draft.historyReason) reasons.push(draft.historyReason);
    if (draft.units > 0) {
      reasons.push(
        `${round(draft.units, 2)} ${product.unit ?? 'units'} sold in the last ${windowDays} days (${round(draft.velocity, 2)}/day).`,
      );
    } else if (draft.eligible) {
      reasons.push(`No sales recorded in the last ${windowDays} days.`);
    }
    if (draft.lastSoldAt) reasons.push(`Last recorded sale: ${formatDate(draft.lastSoldAt)}.`);
    reasons.push(
      coverageDays === null
        ? `${stock} ${product.unit ?? 'units'} in stock; no recorded demand, so cover cannot be calculated.`
        : `${stock} ${product.unit ?? 'units'} in stock = about ${round(coverageDays, 1)} days of cover at the recorded velocity.`,
    );
    if (draft.eligible && !previousObserved) {
      reasons.push(
        `No trend shown: recorded history does not yet cover the previous ${windowDays}-day period.`,
      );
    }
    if (draft.units > 0 && trend !== 'unknown') {
      reasons.push(
        trend === 'new'
          ? `No sales in the previous ${windowDays}-day period — demand may be new.`
          : `Previous ${windowDays}-day period: ${round(draft.previousUnits, 2)} units (trend ${trend}).`,
      );
    }
    if (expired) reasons.push(`This stock expired on ${formatDate(product.expiryDate)} and must not be sold.`);

    const suggestedOrder =
      draft.velocity > 0 ? Math.max(0, Math.ceil(draft.velocity * (leadTime + 7) - stock)) : 0;

    let recommendation: string;
    if (expired) {
      recommendation =
        'Expired stock: remove it from sale and follow your disposal procedure before any demand or reorder decision.';
    } else if (!draft.eligible) {
      recommendation =
        'No demand verdict yet. Keep recording sales for this item — it is never counted as zero demand just because history is short.';
    } else if (flags.includes('stockout-risk')) {
      recommendation = `Reorder soon: about ${suggestedOrder} ${product.unit ?? 'units'} would cover the ${leadTime}-day lead time plus a week of current demand.`;
    } else if (classification === 'slow-moving' && stock > 0) {
      recommendation =
        'Do not reorder yet. Review shelf position, pricing and range fit before buying more stock.';
    } else if (flags.includes('overstock')) {
      recommendation = `Hold replenishment: stock covers more than ${overstockDays} days of recorded demand. Review promotions only for in-date stock.`;
    } else if (classification === 'best-seller') {
      recommendation = `Protect availability: keep at least ${Math.max(1, Math.ceil(draft.velocity * (leadTime + 3)))} ${product.unit ?? 'units'} on hand for lead time plus safety stock.`;
    } else {
      recommendation = 'Demand is steady. Reorder when stock falls to the reorder level.';
    }

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unitsSold: round(draft.units, 2),
      previousUnits: round(draft.previousUnits, 2),
      transactions: draft.transactions,
      revenue: round(draft.revenue, 2),
      revenueAvailable: draft.revenueAvailable,
      velocity: round(draft.velocity, 2),
      previousVelocity: round(draft.previousVelocity, 2),
      trend,
      coverageDays: coverageDays === null ? null : round(coverageDays, 1),
      classification,
      flags,
      reasons,
      recommendation,
      stock,
      unit: product.unit,
      stockValue: round(stockValue, 2),
      daysTracked: draft.daysAvailable,
      lastSoldAt: draft.lastSoldAt,
      expired,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? product.supplierName ?? null,
      suggestedOrder,
    };
  });

  const summary: DemandSummary = {
    windowDays,
    trackingSince,
    trackingDays,
    hasHistory: trackingDays > 0,
    unitsSold: round(items.reduce((sum, item) => sum + item.unitsSold, 0), 2),
    revenue: round(items.reduce((sum, item) => sum + item.revenue, 0), 2),
    revenueAvailable: items.some((item) => item.revenueAvailable),
    transactions: items.reduce((sum, item) => sum + item.transactions, 0),
    bestSellerCount: items.filter((item) => item.classification === 'best-seller').length,
    steadyCount: items.filter((item) => item.classification === 'steady').length,
    slowMovingCount: items.filter((item) => item.classification === 'slow-moving').length,
    insufficientCount: items.filter((item) => item.classification === 'insufficient-history').length,
    stockoutRiskCount: items.filter((item) => item.flags.includes('stockout-risk')).length,
    overstockCount: items.filter((item) => item.flags.includes('overstock')).length,
    overstockValue: round(
      items
        .filter((item) => item.flags.includes('overstock'))
        .reduce((sum, item) => sum + item.stockValue, 0),
      2,
    ),
    slowMovingValue: round(
      items
        .filter((item) => item.classification === 'slow-moving')
        .reduce((sum, item) => sum + item.stockValue, 0),
      2,
    ),
  };

  const byUnits = [...items].sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name));
  return {
    summary,
    items: byUnits,
    bestSellers: byUnits.filter((item) => item.classification === 'best-seller').slice(0, 5),
    slowMovers: [...items]
      .filter((item) => item.classification === 'slow-moving')
      .sort((a, b) => b.stockValue - a.stockValue),
    stockoutRisks: byUnits.filter((item) => item.flags.includes('stockout-risk')),
    overstock: [...items]
      .filter((item) => item.flags.includes('overstock'))
      .sort((a, b) => b.stockValue - a.stockValue),
  };
}
