import { describe, expect, it } from 'vitest';
import type { Product, SaleRecord, Supplier } from '../types';
import { addDaysISO } from './date';
import { analyzeDemand } from './demand';

const TODAY = new Date(2026, 5, 30); // 30 Jun 2026
const TRACKING_SINCE = addDaysISO(-60, TODAY);

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-milk',
    sku: 'R101',
    name: 'Milk 1L',
    category: 'Dairy',
    currentStock: 40,
    reorderLevel: 10,
    averageDailySales: 5,
    leadTimeDays: 1,
    expiryDate: null,
    supplierName: 'FreshPastures Dairy',
    supplierId: 'sup-1',
    unit: 'L',
    unitCost: 62,
    sellingPrice: 70,
    createdAt: addDaysISO(-120, TODAY),
    updatedAt: addDaysISO(-120, TODAY),
    ...overrides,
  };
}

/** n daily sales lines of `quantity` each, ending with `endOffset` days ago. */
function dailySales(
  productId: string,
  quantity: number,
  days: number,
  startOffset: number,
  price: number | null = 70,
): SaleRecord[] {
  return Array.from({ length: days }, (_, index) => ({
    id: `${productId}-${startOffset - index}`,
    productId,
    sku: 'SKU',
    quantity,
    unitPrice: price,
    soldAt: addDaysISO(-(startOffset + index), TODAY),
    source: 'import' as const,
    createdAt: TODAY.toISOString(),
  }));
}

const suppliers: Supplier[] = [
  {
    id: 'sup-1',
    name: 'FreshPastures Dairy',
    leadTimeDays: 1,
    active: true,
    createdAt: '',
    updatedAt: '',
  },
];

describe('analyzeDemand without history', () => {
  it('reports insufficient history instead of zero demand', () => {
    const report = analyzeDemand(
      { products: [product()], sales: [], trackingSince: null, suppliers },
      { today: TODAY },
    );
    expect(report.summary.hasHistory).toBe(false);
    expect(report.summary.unitsSold).toBe(0);
    expect(report.items[0].classification).toBe('insufficient-history');
    expect(report.items[0].trend).toBe('unknown');
    expect(report.items[0].reasons.join(' ')).toMatch(/sales history/i);
    // Not labelled as a slow mover, because there is no evidence either way.
    expect(report.summary.slowMovingCount).toBe(0);
  });

  it('judges a recently added product on its imported sales, not its record age', () => {
    const report = analyzeDemand(
      {
        products: [product({ id: 'p-imported', createdAt: addDaysISO(-3, TODAY) })],
        sales: dailySales('p-imported', 4, 21, 0),
        trackingSince: TRACKING_SINCE,
        suppliers,
      },
      { today: TODAY },
    );
    const item = report.items[0];
    expect(item.classification).not.toBe('insufficient-history');
    expect(item.unitsSold).toBe(84);
    // Velocity is per day across the full 30-day window, not only selling days.
    expect(item.velocity).toBeCloseTo(2.8, 1);
  });

  it('treats a brand-new product as unclassified even when the shop has history', () => {
    const sales = [
      ...dailySales('p-milk', 5, 30, 0),
      ...dailySales('p-new', 0, 0, 0),
    ];
    const report = analyzeDemand(
      {
        products: [
          product(),
          product({ id: 'p-new', sku: 'R200', name: 'New Item', currentStock: 10, createdAt: addDaysISO(-3, TODAY) }),
        ],
        sales,
        trackingSince: TRACKING_SINCE,
        suppliers,
      },
      { today: TODAY },
    );
    const fresh = report.items.find((item) => item.productId === 'p-new')!;
    expect(fresh.classification).toBe('insufficient-history');
    expect(fresh.reasons.join(' ')).toMatch(/demand is judged after/i);
  });
});

describe('classification', () => {
  const products = [
    product({ id: 'p-milk', currentStock: 12, leadTimeDays: 1 }),
    product({ id: 'p-rice', sku: 'R102', name: 'Rice 5kg', currentStock: 40, unitCost: 420, sellingPrice: 485, supplierId: 'sup-1' }),
    product({ id: 'p-soap', sku: 'R106', name: 'Soap', currentStock: 500, unitCost: 28, sellingPrice: 35, supplierId: null, supplierName: 'PureCare Supplies' }),
    product({ id: 'p-dead', sku: 'R107', name: 'Old Stock', currentStock: 10, sellingPrice: 20, supplierId: null, supplierName: undefined }),
  ];
  const sales: SaleRecord[] = [
    ...dailySales('p-milk', 10, 30, 0),
    ...dailySales('p-rice', 2, 30, 0, 485),
    ...dailySales('p-soap', 1, 30, 0, 35),
    ...dailySales('p-rice', 2, 30, 30, 485), // previous period for the trend
  ];

  const report = analyzeDemand({ products, sales, trackingSince: TRACKING_SINCE, suppliers }, { today: TODAY });

  it('finds the best seller by recorded velocity', () => {
    expect(report.bestSellers.map((item) => item.productId)).toEqual(['p-milk']);
    expect(report.items.find((item) => item.productId === 'p-milk')!.velocity).toBe(10);
  });

  it('marks a product with no recorded sales as slow moving only when history is sufficient', () => {
    const dead = report.items.find((item) => item.productId === 'p-dead')!;
    expect(dead.classification).toBe('slow-moving');
    expect(dead.flags).toContain('no-recent-sales');
    expect(dead.flags).toContain('overstock');
    expect(dead.recommendation).toMatch(/do not reorder/i);
  });

  it('flags overstock by days of cover, with the stock value exposed', () => {
    const soap = report.items.find((item) => item.productId === 'p-soap')!;
    expect(soap.coverageDays).toBe(500);
    expect(soap.flags).toContain('overstock');
    expect(report.summary.overstockValue).toBeGreaterThanOrEqual(500 * 28);
  });

  it('flags stockout risk when cover is shorter than the lead time', () => {
    const milk = report.items.find((item) => item.productId === 'p-milk')!;
    expect(milk.flags).toContain('stockout-risk');
    expect(milk.suggestedOrder).toBeGreaterThan(0);
    expect(milk.recommendation).toMatch(/reorder soon/i);
  });

  it('calculates revenue only from lines that carried a price', () => {
    expect(report.summary.revenueAvailable).toBe(true);
    expect(report.summary.revenue).toBeCloseTo(10 * 30 * 70 + 2 * 30 * 485 + 30 * 35, 2);
  });
});

describe('trend and windows', () => {
  it('compares the selected window with the preceding one', () => {
    const products = [product({ id: 'p1', currentStock: 100 })];
    const sales = [...dailySales('p1', 4, 7, 0), ...dailySales('p1', 1, 7, 7)];
    const report = analyzeDemand(
      { products, sales, trackingSince: TRACKING_SINCE, suppliers },
      { today: TODAY, windowDays: 7 },
    );
    expect(report.summary.windowDays).toBe(7);
    expect(report.items[0].trend).toBe('up');
    expect(report.items[0].unitsSold).toBe(28);
    expect(report.items[0].previousUnits).toBe(7);
  });

  it('ignores future-dated sales and falls back to a 30-day window', () => {
    const products = [product({ id: 'p1', currentStock: 100 })];
    const sales = [
      ...dailySales('p1', 2, 10, 0),
      {
        id: 'future',
        productId: 'p1',
        sku: 'R101',
        quantity: 999,
        unitPrice: 70,
        soldAt: addDaysISO(3, TODAY),
        source: 'import' as const,
        createdAt: '',
      },
    ];
    const report = analyzeDemand(
      { products, sales, trackingSince: TRACKING_SINCE, suppliers },
      { today: TODAY, windowDays: 12 },
    );
    expect(report.summary.windowDays).toBe(30);
    expect(report.summary.unitsSold).toBe(20);
  });
});

describe('safety rules', () => {
  it('never recommends selling expired stock, even when it is overstocked', () => {
    const products = [
      product({ id: 'p-exp', name: 'Expired Yogurt', currentStock: 60, expiryDate: addDaysISO(-2, TODAY) }),
    ];
    const sales = dailySales('p-exp', 0, 0, 0);
    const report = analyzeDemand({ products, sales, trackingSince: TRACKING_SINCE, suppliers }, { today: TODAY });
    const item = report.items[0];
    expect(item.expired).toBe(true);
    expect(item.recommendation).toMatch(/remove it from sale/i);
    expect(item.flags).not.toContain('stockout-risk');
    expect(item.recommendation.toLowerCase()).not.toContain('markdown');
    expect(item.recommendation.toLowerCase()).not.toContain('discount');
  });

  it('reports only advisory order quantities and never mutates the product', () => {
    const products = [product({ id: 'p1', currentStock: 2, leadTimeDays: 3 })];
    const sales = dailySales('p1', 5, 30, 0);
    const before = JSON.parse(JSON.stringify(products));
    const report = analyzeDemand({ products, sales, trackingSince: TRACKING_SINCE, suppliers }, { today: TODAY });
    expect(products).toEqual(before);
    expect(report.items[0].suggestedOrder).toBeGreaterThan(0);
  });
});
