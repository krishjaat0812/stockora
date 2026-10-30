import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSeedProducts, createSeedSuppliers } from '../data/seed';
import { addDaysISO } from './date';
import { buildInsights } from './inventory';
import { analyzeDemand } from './demand';
import {
  addScanToCart,
  applyCancelOrder,
  applyCheckout,
  applyCompleteOrder,
  computeTotals,
  removeFromCart,
  salesMetrics,
  salesOrdersTable,
  setCartQuantity,
  toPosProduct,
  type CartItem,
  type CheckoutContext,
  type CheckoutInput,
} from './pos';
import type { PersistedState, PosSettings, Product, SaleOrder } from '../types';

const TODAY = new Date(2026, 9, 25); // 25 Oct 2026 — same reference date as the other suites
const TIMESTAMP = '2026-10-25T08:00:00.000Z';

const MILK = 'seed-r101';
const RICE = 'seed-r102';
const BREAD = 'seed-r103';

function settingsWith(pos: Partial<PosSettings> = {}, overrides: Partial<PersistedState['settings']> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    notifications: { ...DEFAULT_SETTINGS.notifications },
    pos: { ...DEFAULT_SETTINGS.pos, ...pos },
  };
}

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    version: 1,
    products: createSeedProducts(TODAY, TIMESTAMP),
    suppliers: createSeedSuppliers(TIMESTAMP),
    sales: [],
    salesTrackingSince: null,
    settings: settingsWith(),
    activity: [],
    notifications: [],
    reviews: [],
    notifiedKeys: [],
    saleOrders: [],
    inventoryMovements: [],
    receiptCounter: 0,
    seededOn: TIMESTAMP,
    ...overrides,
  };
}

function makeCtx(allowDiscount = false): CheckoutContext {
  let counter = 0;
  return {
    now: TODAY,
    cashierId: 'user-1',
    cashierName: 'Demo Cashier',
    allowDiscount,
    newId: () => `gen-${++counter}`,
  };
}

function checkoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    idempotencyKey: 'checkout-key-0001',
    lines: [{ productId: MILK, quantity: 2 }],
    paymentMethod: 'cash',
    amountReceived: 200,
    ...overrides,
  };
}

function cartItemFor(product: Product, quantity = 1): CartItem {
  const pos = toPosProduct(product, DEFAULT_SETTINGS, TODAY);
  return {
    productId: pos.id,
    sku: pos.sku,
    name: pos.name,
    barcode: pos.barcode,
    unit: pos.unit,
    unitPrice: pos.sellingPrice ?? 0,
    taxRatePct: pos.taxRatePct,
    allowFractional: pos.allowFractional,
    availableStock: pos.currentStock,
    quantity,
    lineDiscountPct: 0,
    expiryDate: pos.expiryDate,
    daysRemaining: pos.daysRemaining,
    expired: pos.expired,
    nearExpiry: pos.nearExpiry,
  };
}

function productIn(state: PersistedState, id: string): Product {
  const product = state.products.find((item) => item.id === id);
  if (!product) throw new Error(`missing product ${id}`);
  return product;
}

// ---------------------------------------------------------------------------
// Cart behaviour (browser side only — never touches stock)
// ---------------------------------------------------------------------------

describe('POS cart', () => {
  const products = createSeedProducts(TODAY, TIMESTAMP);
  const milk = products.find((item) => item.id === MILK)!;
  const rice = products.find((item) => item.id === RICE)!;

  it('adds multiple different products as separate lines', () => {
    let cart: CartItem[] = [];
    cart = addScanToCart(cart, toPosProduct(milk, DEFAULT_SETTINGS, TODAY));
    cart = addScanToCart(cart, toPosProduct(rice, DEFAULT_SETTINGS, TODAY));
    expect(cart).toHaveLength(2);
  });

  it('increments quantity on a repeated scan instead of duplicating the line', () => {
    let cart: CartItem[] = [];
    cart = addScanToCart(cart, toPosProduct(milk, DEFAULT_SETTINGS, TODAY));
    cart = addScanToCart(cart, toPosProduct(milk, DEFAULT_SETTINGS, TODAY));
    cart = addScanToCart(cart, toPosProduct(milk, DEFAULT_SETTINGS, TODAY));
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it('edits quantities within stock and rejects invalid values', () => {
    const cart = [cartItemFor(milk, 1)];
    const bumped = setCartQuantity(cart, MILK, 5);
    expect(bumped.items[0].quantity).toBe(5);
    expect(setCartQuantity(cart, MILK, 0).error).toMatch(/greater than zero/i);
    expect(setCartQuantity(cart, MILK, 99).error).toMatch(/only 8/i);
    expect(setCartQuantity(cart, MILK, 2.5).error).toMatch(/whole units/i);
  });

  it('allows fractional quantities only when the product permits them', () => {
    const weighted: Product = { ...milk, allowFractional: true, unit: 'kg' };
    const cart = [cartItemFor(weighted, 1)];
    const result = setCartQuantity(cart, MILK, 0.75);
    expect(result.error).toBeUndefined();
    expect(result.items[0].quantity).toBe(0.75);
  });

  it('removes lines', () => {
    expect(removeFromCart([cartItemFor(milk), cartItemFor(rice)], MILK)).toHaveLength(1);
  });

  it('scanning alone never changes stock', () => {
    const state = makeState();
    const before = productIn(state, MILK).currentStock;
    let cart: CartItem[] = [];
    cart = addScanToCart(cart, toPosProduct(productIn(state, MILK), state.settings, TODAY));
    expect(cart).toHaveLength(1);
    expect(productIn(state, MILK).currentStock).toBe(before);
    expect(state.saleOrders).toHaveLength(0);
    expect(state.sales).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

describe('POS totals', () => {
  it('adds tax on top of an exclusive price', () => {
    const totals = computeTotals(
      [{ quantity: 1, unitPrice: 100, taxRatePct: 18, lineDiscountPct: 0 }],
      0,
      false,
    );
    expect(totals.subtotal).toBe(100);
    expect(totals.taxTotal).toBe(18);
    expect(totals.total).toBe(118);
  });

  it('extracts tax from an inclusive price without changing the amount paid', () => {
    const totals = computeTotals(
      [{ quantity: 1, unitPrice: 118, taxRatePct: 18, lineDiscountPct: 0 }],
      0,
      true,
    );
    expect(totals.taxTotal).toBe(18);
    expect(totals.taxableAmount).toBe(100);
    expect(totals.total).toBe(118);
  });

  it('applies item then order discounts, taxes the discounted amount', () => {
    const line = computeTotals(
      [{ quantity: 1, unitPrice: 100, taxRatePct: 18, lineDiscountPct: 10 }],
      10,
      false,
    );
    expect(line.lineDiscountTotal).toBe(10);
    expect(line.orderDiscountTotal).toBe(9); // 10% of the discounted 90
    expect(line.taxableAmount).toBe(81);
    expect(line.taxTotal).toBe(14.58);
    expect(line.total).toBe(95.58);
  });

  it('totals always equal the sum of their lines', () => {
    const totals = computeTotals(
      [
        { quantity: 2, unitPrice: 70, taxRatePct: 0, lineDiscountPct: 0 },
        { quantity: 3, unitPrice: 12.5, taxRatePct: 5, lineDiscountPct: 0 },
        { quantity: 1, unitPrice: 100, taxRatePct: 12, lineDiscountPct: 0 },
      ],
      0,
      false,
    );
    const sum = totals.lines.reduce((total, line) => total + line.lineTotal, 0);
    expect(Number(sum.toFixed(2))).toBe(totals.total);
  });
});

// ---------------------------------------------------------------------------
// Checkout + automatic inventory deduction
// ---------------------------------------------------------------------------

describe('checkout and automatic inventory deduction', () => {
  it('completes a sale, deducts stock once and records every trace', () => {
    const state = makeState();
    const outcome = applyCheckout(state, checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { order, state: next } = outcome;
    expect(order.status).toBe('completed');
    expect(order.receiptNumber).toBe('RCPT-000001');
    expect(order.total).toBe(140); // 2 × 70, milk is untaxed
    expect(order.changeDue).toBe(60); // 200 tendered
    expect(order.cashierName).toBe('Demo Cashier');

    // Stock deducted exactly once.
    expect(productIn(next, MILK).currentStock).toBe(6);
    expect(productIn(state, MILK).currentStock).toBe(8); // input untouched

    // Sales ledger line uses the existing analytics model.
    expect(next.sales).toHaveLength(1);
    expect(next.sales[0]).toMatchObject({
      productId: MILK,
      quantity: 2,
      unitPrice: 70,
      soldAt: '2026-10-25',
      source: 'pos',
      saleId: order.id,
    });

    // Movement ledger keeps previous and resulting stock.
    expect(next.inventoryMovements).toHaveLength(1);
    expect(next.inventoryMovements[0]).toMatchObject({
      type: 'sale',
      quantityChange: -2,
      previousStock: 8,
      resultingStock: 6,
      saleId: order.id,
      actorId: 'user-1',
    });

    expect(next.activity[0].type).toBe('sale');
    expect(next.receiptCounter).toBe(1);
    expect(next.saleOrders).toHaveLength(1);
  });

  it('retrying the same checkout returns the existing sale without deducting again', () => {
    const state = makeState();
    const first = applyCheckout(state, checkoutInput(), makeCtx());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const retry = applyCheckout(first.state, checkoutInput(), makeCtx());
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.duplicate).toBe(true);
    expect(retry.order.id).toBe(first.order.id);
    expect(retry.state).toBe(first.state); // nothing written
    expect(productIn(retry.state, MILK).currentStock).toBe(6);
    expect(retry.state.sales).toHaveLength(1);
  });

  it('rejects a sale that exceeds available stock and changes nothing', () => {
    const state = makeState();
    const outcome = applyCheckout(
      state,
      checkoutInput({ lines: [{ productId: MILK, quantity: 99 }] }),
      makeCtx(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('insufficient_stock');
    expect(outcome.message).toMatch(/only 8/i);
    expect(productIn(state, MILK).currentStock).toBe(8);
    expect(state.sales).toHaveLength(0);
  });

  it('cannot oversell across two sequential sales of the same stock', () => {
    const state = makeState();
    const first = applyCheckout(
      state,
      checkoutInput({ idempotencyKey: 'oversell-key-a', lines: [{ productId: BREAD, quantity: 4 }] }),
      makeCtx(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(productIn(first.state, BREAD).currentStock).toBe(0);

    const second = applyCheckout(
      first.state,
      checkoutInput({ idempotencyKey: 'oversell-key-b', lines: [{ productId: BREAD, quantity: 1 }] }),
      makeCtx(),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('insufficient_stock');
  });

  it('refuses expired stock', () => {
    const state = makeState({
      products: createSeedProducts(TODAY, TIMESTAMP).map((product) =>
        product.id === MILK ? { ...product, expiryDate: addDaysISO(-1, TODAY) } : product,
      ),
    });
    const outcome = applyCheckout(state, checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('expired');
  });

  it('refuses products that are switched off for sale', () => {
    const state = makeState({
      products: createSeedProducts(TODAY, TIMESTAMP).map((product) =>
        product.id === MILK ? { ...product, active: false } : product,
      ),
    });
    const outcome = applyCheckout(state, checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('inactive');
  });

  it('blocks checkout when a product has no selling price', () => {
    const state = makeState({
      products: createSeedProducts(TODAY, TIMESTAMP).map((product) =>
        product.id === MILK ? { ...product, sellingPrice: null } : product,
      ),
    });
    const outcome = applyCheckout(state, checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('price_missing');
  });

  it('requires the discount permission for any discount', () => {
    const state = makeState();
    const denied = applyCheckout(
      state,
      checkoutInput({ orderDiscountPct: 10 }),
      makeCtx(false),
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.code).toBe('discount_denied');

    const allowed = applyCheckout(state, checkoutInput({ orderDiscountPct: 10 }), makeCtx(true));
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.order.total).toBe(126);
  });

  it('rejects payment methods the shop has not enabled', () => {
    const state = makeState({ settings: settingsWith({ paymentMethods: ['cash'] }) });
    const outcome = applyCheckout(state, checkoutInput({ paymentMethod: 'card' }), makeCtx());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('payment_method');
  });

  it('rejects short cash payments', () => {
    const outcome = applyCheckout(makeState(), checkoutInput({ amountReceived: 100 }), makeCtx());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('amount_insufficient');
  });

  it('rejects fractional quantities unless the product allows them', () => {
    const state = makeState();
    const outcome = applyCheckout(
      state,
      checkoutInput({ lines: [{ productId: MILK, quantity: 0.5 }] }),
      makeCtx(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('fractional_not_allowed');

    const weighted = makeState({
      products: createSeedProducts(TODAY, TIMESTAMP).map((product) =>
        product.id === MILK ? { ...product, allowFractional: true } : product,
      ),
    });
    const allowed = applyCheckout(
      weighted,
      checkoutInput({ lines: [{ productId: MILK, quantity: 0.5 }] }),
      makeCtx(),
    );
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(productIn(allowed.state, MILK).currentStock).toBe(7.5);
  });

  it('records near-expiry warnings on the transaction', () => {
    const outcome = applyCheckout(makeState(), checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Milk expires in 3 days and the default threshold is 3.
    expect(outcome.order.warnings?.[0]).toMatch(/Milk 1L expires in 3 days/);
  });

  it('applies each product’s own tax rate, never a universal one', () => {
    const outcome = applyCheckout(
      makeState(),
      checkoutInput({
        lines: [
          { productId: MILK, quantity: 1 }, // 0%
          { productId: RICE, quantity: 1 }, // 5%
        ],
        amountReceived: 600,
      }),
      makeCtx(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const taxLines = outcome.order.lines.map((line) => line.taxAmount);
    expect(taxLines).toEqual([0, 24.25]); // 485 × 5%
    expect(outcome.order.taxTotal).toBe(24.25);
  });
});

// ---------------------------------------------------------------------------
// Pending payment, confirmation and cancellation
// ---------------------------------------------------------------------------

describe('payment states', () => {
  const pendingSettings = settingsWith({ requirePaymentConfirmation: true });

  it('stages a sale as pending without touching stock', () => {
    const state = makeState({ settings: pendingSettings });
    const outcome = applyCheckout(state, checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.order.status).toBe('pending_payment');
    expect(productIn(outcome.state, MILK).currentStock).toBe(8);
    expect(outcome.state.sales).toHaveLength(0);
    expect(outcome.state.inventoryMovements).toHaveLength(0);
  });

  it('deducts stock exactly once when the payment is confirmed', () => {
    const state = makeState({ settings: pendingSettings });
    const created = applyCheckout(state, checkoutInput(), makeCtx());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const confirmed = applyCompleteOrder(created.state, created.order.id, makeCtx());
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.order.status).toBe('completed');
    expect(productIn(confirmed.state, MILK).currentStock).toBe(6);
    expect(confirmed.state.sales).toHaveLength(1);

    // A second confirmation is a no-op, not a second deduction.
    const again = applyCompleteOrder(confirmed.state, created.order.id, makeCtx());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(productIn(again.state, MILK).currentStock).toBe(6);
  });

  it('cancelling a pending sale leaves stock untouched', () => {
    const state = makeState({ settings: pendingSettings });
    const created = applyCheckout(state, checkoutInput(), makeCtx());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cancelled = applyCancelOrder(created.state, created.order.id, makeCtx());
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.order.status).toBe('cancelled');
    expect(productIn(cancelled.state, MILK).currentStock).toBe(8);
    expect(cancelled.state.sales).toHaveLength(0);
  });

  it('never cancels a completed sale (no refunds are implemented)', () => {
    const completed = applyCheckout(makeState(), checkoutInput(), makeCtx());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const attempt = applyCancelOrder(completed.state, completed.order.id, makeCtx());
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.code).toBe('already_completed');
    expect(productIn(completed.state, MILK).currentStock).toBe(6);
  });

  it('blocks confirming a pending sale whose stock has since sold out', () => {
    const state = makeState({ settings: pendingSettings });
    const created = applyCheckout(
      state,
      checkoutInput({ lines: [{ productId: BREAD, quantity: 4 }] }),
      makeCtx(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Another till sells the remaining bread before the payment is confirmed.
    const otherSale = applyCheckout(
      created.state,
      checkoutInput({
        idempotencyKey: 'other-key-0001',
        lines: [{ productId: BREAD, quantity: 1 }],
        paymentConfirmed: true, // a different till takes the stock immediately
      }),
      makeCtx(),
    );
    expect(otherSale.ok).toBe(true);
    if (!otherSale.ok) return;

    const confirmed = applyCompleteOrder(otherSale.state, created.order.id, makeCtx());
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.code).toBe('insufficient_stock');
  });
});

// ---------------------------------------------------------------------------
// Analytics, reorder and reports integration
// ---------------------------------------------------------------------------

describe('analytics, reorder and reports', () => {
  it('feeds completed POS sales into demand analytics', () => {
    const state = makeState({ salesTrackingSince: '2026-09-01' });
    const outcome = applyCheckout(state, checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const report = analyzeDemand(
      { products: outcome.state.products, sales: outcome.state.sales, trackingSince: outcome.state.salesTrackingSince },
      { windowDays: 7, today: TODAY },
    );
    const milk = report.items.find((item) => item.productId === MILK);
    expect(milk?.unitsSold).toBe(2);
    expect(milk?.transactions).toBe(1);
    expect(milk?.velocity).toBeGreaterThan(0);
    expect(report.summary.unitsSold).toBe(2);
  });

  it('updates reorder calculations from the new stock level', () => {
    const before = buildInsights(makeState().products, DEFAULT_SETTINGS, TODAY).find(
      (insight) => insight.product.id === MILK,
    );
    const outcome = applyCheckout(makeState(), checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = buildInsights(outcome.state.products, DEFAULT_SETTINGS, TODAY).find(
      (insight) => insight.product.id === MILK,
    );
    // Stock 8 → 6 means two more units are required to cover lead time + buffer.
    expect(after?.reorderQuantity).toBe((before?.reorderQuantity ?? 0) + 2);
  });

  it('reports metrics from completed POS transactions only', () => {
    const state = makeState();
    const completed = applyCheckout(state, checkoutInput(), makeCtx());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    const pendingState = makeState({
      settings: settingsWith({ requirePaymentConfirmation: true }),
    });
    const pending = applyCheckout(
      pendingState,
      checkoutInput({
        idempotencyKey: 'pending-key-0001',
        lines: [{ productId: RICE, quantity: 1 }],
        amountReceived: 1000,
      }),
      makeCtx(),
    );
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;

    const orders: SaleOrder[] = [...completed.state.saleOrders, ...pending.state.saleOrders];
    const metrics = salesMetrics(orders, { from: '2026-10-01', to: '2026-10-31' });
    expect(metrics.completedCount).toBe(1);
    expect(metrics.pendingCount).toBe(1);
    expect(metrics.unitsSold).toBe(2);
    expect(metrics.netSales).toBe(140);
    expect(metrics.taxCollected).toBe(0);
    expect(metrics.averageTransaction).toBe(140);
    expect(metrics.byPayment).toEqual([{ method: 'cash', count: 1, total: 140 }]);
    expect(metrics.topProducts[0]).toMatchObject({ productId: MILK, units: 2 });

    // Outside the range nothing is reported.
    const outside = salesMetrics(orders, { from: '2026-08-01', to: '2026-08-31' });
    expect(outside.completedCount).toBe(0);
    expect(outside.netSales).toBe(0);
  });

  it('exports sales rows for the requested range', () => {
    const outcome = applyCheckout(makeState(), checkoutInput(), makeCtx());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const table = salesOrdersTable(outcome.state.saleOrders, { from: '2026-10-01', to: '2026-10-31' }, 'INR');
    expect(table.headers).toContain('Receipt');
    expect(table.headers).toContain('Total');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][0]).toBe('RCPT-000001');
    expect(table.rows[0].map(String)).toContain('140.00');

    const empty = salesOrdersTable(outcome.state.saleOrders, { from: '2026-09-01', to: '2026-09-30' }, 'INR');
    expect(empty.rows).toHaveLength(0);
  });
});
