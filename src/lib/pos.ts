import type {
  CurrencyCode,
  InventoryMovement,
  PaymentMethod,
  PosSettings,
  Product,
  PersistedState,
  SaleLine,
  SaleOrder,
  SaleRecord,
  Settings,
} from '../types';
import { daysUntil, todayISO } from './date';
import { normalizeBarcode } from './barcode';
import { mergeSales } from './sales';
import { buildCsv, type CsvTable } from './csv';

/**
 * Point of Sale domain logic.
 *
 * Everything that decides whether a sale may happen, what it costs and how
 * stock changes lives here as pure functions, so the Worker, the browser and
 * the tests all apply identical rules:
 *
 *  - Scanning only ever *reads* product data. Stock is deducted solely by
 *    `applyCheckout` when the transaction reaches the completed state (or by
 *    `applyCompleteOrder` when a pending payment is confirmed).
 *  - Sale completion mutates one organisation document in a single immutable
 *    step: order + sales-ledger lines + stock quantities + movements +
 *    activity are produced together, so a half-applied sale cannot exist.
 *  - `idempotencyKey` makes retries return the existing transaction instead
 *    of deducting stock twice.
 *  - Prices are always read from the product record, never from the client.
 */

export const MAX_CART_LINES = 100;
export const MAX_QUANTITY = 100_000;
export const MAX_MOVEMENTS = 5_000;

export const DEFAULT_POS_SETTINGS: PosSettings = {
  paymentMethods: ['cash', 'upi', 'card', 'other'],
  taxInclusive: false,
  requirePaymentConfirmation: false,
  receiptFooter: '',
};

/** POS settings with safe defaults for documents written before they existed. */
export function posSettings(settings: Settings): PosSettings {
  const pos = settings.pos;
  if (!pos || typeof pos !== 'object') return DEFAULT_POS_SETTINGS;
  const methods = Array.isArray(pos.paymentMethods) ? pos.paymentMethods : [];
  return {
    paymentMethods: methods.length > 0 ? methods : DEFAULT_POS_SETTINGS.paymentMethods,
    taxInclusive: pos.taxInclusive === true,
    requirePaymentConfirmation: pos.requirePaymentConfirmation === true,
    receiptFooter: typeof pos.receiptFooter === 'string' ? pos.receiptFooter : '',
  };
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Product payload for the POS (what the server returns for a scan or search)
// ---------------------------------------------------------------------------

export interface PosProduct {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string;
  unit: string | undefined;
  /** Authoritative selling price; null when the product has no price set. */
  sellingPrice: number | null;
  taxRatePct: number;
  allowFractional: boolean;
  active: boolean;
  currentStock: number;
  reorderLevel: number;
  expiryDate: string | null;
  daysRemaining: number | null;
  expired: boolean;
  nearExpiry: boolean;
  stockStatus: 'out' | 'low' | 'healthy';
}

export function toPosProduct(product: Product, settings: Settings, today?: Date): PosProduct {
  const days = daysUntil(product.expiryDate, today);
  const threshold = settings.expiryThreshold;
  const low = product.currentStock <= product.reorderLevel;
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    barcode: product.barcode ?? null,
    category: product.category,
    unit: product.unit,
    sellingPrice:
      product.sellingPrice === null || product.sellingPrice === undefined
        ? null
        : product.sellingPrice,
    taxRatePct:
      typeof product.taxRatePct === 'number' && Number.isFinite(product.taxRatePct)
        ? product.taxRatePct
        : 0,
    allowFractional: product.allowFractional === true,
    active: product.active !== false,
    currentStock: product.currentStock,
    reorderLevel: product.reorderLevel,
    expiryDate: product.expiryDate ?? null,
    daysRemaining: days,
    expired: days !== null && days < 0,
    nearExpiry: days !== null && days >= 0 && days <= threshold,
    stockStatus: product.currentStock <= 0 ? 'out' : low ? 'low' : 'healthy',
  };
}

// ---------------------------------------------------------------------------
// Cart (browser side only — a cart never mutates stock)
// ---------------------------------------------------------------------------

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  unit: string | undefined;
  /** Server-provided unit price at scan time. */
  unitPrice: number;
  taxRatePct: number;
  allowFractional: boolean;
  availableStock: number;
  quantity: number;
  lineDiscountPct: number;
  expiryDate: string | null;
  daysRemaining: number | null;
  expired: boolean;
  nearExpiry: boolean;
}

/**
 * Adds a scanned product to the cart. A repeat scan of the same product at
 * the same price increments quantity by one (the consistent, configurable-by-
 * code rule) instead of creating a duplicate line.
 */
export function addScanToCart(items: CartItem[], product: PosProduct): CartItem[] {
  const existing = items.find(
    (item) => item.productId === product.id && item.unitPrice === (product.sellingPrice ?? 0),
  );
  if (existing) {
    return items.map((item) =>
      item === existing ? { ...item, quantity: clampLineQuantity(item, item.quantity + 1) } : item,
    );
  }
  return [
    ...items,
    {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      barcode: product.barcode,
      unit: product.unit,
      unitPrice: product.sellingPrice ?? 0,
      taxRatePct: product.taxRatePct,
      allowFractional: product.allowFractional,
      availableStock: product.currentStock,
      quantity: clampLineQuantity({ allowFractional: product.allowFractional }, 1),
      lineDiscountPct: 0,
      expiryDate: product.expiryDate,
      daysRemaining: product.daysRemaining,
      expired: product.expired,
      nearExpiry: product.nearExpiry,
    },
  ];
}

function clampLineQuantity(
  line: { allowFractional: boolean },
  quantity: number,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 1;
  const capped = Math.min(quantity, MAX_QUANTITY);
  return line.allowFractional ? Math.round(capped * 1000) / 1000 : Math.round(capped);
}

/** Returns the new cart plus an error message when the quantity is invalid. */
export function setCartQuantity(
  items: CartItem[],
  productId: string,
  quantity: number,
): { items: CartItem[]; error?: string } {
  const line = items.find((item) => item.productId === productId);
  if (!line) return { items };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { items, error: 'Quantity must be greater than zero, or remove the item.' };
  }
  if (!line.allowFractional && !Number.isInteger(quantity)) {
    return { items, error: `${line.name} is sold in whole units only.` };
  }
  if (quantity > line.availableStock) {
    return {
      items,
      error: `Only ${line.availableStock} ${line.unit ?? 'units'} of ${line.name} in stock.`,
    };
  }
  const next = items.map((item) =>
    item.productId === productId ? { ...item, quantity: clampLineQuantity(line, quantity) } : item,
  );
  return { items: next };
}

export function removeFromCart(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.productId !== productId);
}

// ---------------------------------------------------------------------------
// Totals (used by both the POS preview and the authoritative server pass)
// ---------------------------------------------------------------------------

export interface TotalsLineInput {
  quantity: number;
  unitPrice: number;
  taxRatePct: number;
  lineDiscountPct: number;
}

export interface TotalsLineResult {
  gross: number;
  lineDiscountAmount: number;
  orderDiscountShare: number;
  taxableBase: number;
  taxAmount: number;
  lineTotal: number;
}

export interface TotalsResult {
  /** Sum of quantity × price before any discount. */
  subtotal: number;
  lineDiscountTotal: number;
  orderDiscountTotal: number;
  taxTotal: number;
  /** Amount the tax was calculated from, after discounts. */
  taxableAmount: number;
  /** Amount payable. Prices are tax-inclusive when the shop is configured that way. */
  total: number;
  lines: TotalsLineResult[];
}

/**
 * Money model (2-decimal rounding at line level, totals are sums of lines so
 * the receipt always reconciles):
 *
 *   gross   = quantity × unit price
 *   net     = gross − line discount%
 *   net     = net − order discount% (allocated proportionally per line)
 *   exclusive tax: taxable = net;            tax = taxable × rate;  total = taxable + tax
 *   inclusive tax: taxable = net ÷ (1+rate); tax = net − taxable;   total = net
 */
export function computeTotals(
  inputs: TotalsLineInput[],
  orderDiscountPct: number,
  taxInclusive: boolean,
): TotalsResult {
  const orderPct = clampPercent(orderDiscountPct);
  const lines = inputs.map((input) => {
    const gross = round2(clampPercentSafe(input.quantity) * input.unitPrice);
    const lineDisc = round2(gross * (clampPercent(input.lineDiscountPct) / 100));
    const net = round2(gross - lineDisc);
    const orderShare = round2(net * (orderPct / 100));
    const afterOrder = round2(net - orderShare);
    const rate = clampPercent(input.taxRatePct);
    let taxableBase: number;
    let taxAmount: number;
    let lineTotal: number;
    if (taxInclusive) {
      taxableBase = rate > 0 ? round2(afterOrder / (1 + rate / 100)) : afterOrder;
      taxAmount = round2(afterOrder - taxableBase);
      lineTotal = afterOrder;
    } else {
      taxableBase = afterOrder;
      taxAmount = round2(taxableBase * (rate / 100));
      lineTotal = round2(taxableBase + taxAmount);
    }
    return { gross, lineDiscountAmount: lineDisc, orderDiscountShare: orderShare, taxableBase, taxAmount, lineTotal };
  });
  const sum = (pick: (line: TotalsLineResult) => number) =>
    round2(lines.reduce((total, line) => total + pick(line), 0));
  return {
    subtotal: sum((line) => line.gross),
    lineDiscountTotal: sum((line) => line.lineDiscountAmount),
    orderDiscountTotal: sum((line) => line.orderDiscountShare),
    taxTotal: sum((line) => line.taxAmount),
    taxableAmount: sum((line) => line.taxableBase),
    total: sum((line) => line.lineTotal),
    lines,
  };
}

function clampPercentSafe(quantity: number): number {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

// ---------------------------------------------------------------------------
// Checkout (pure — the Worker wraps it in an atomic compare-and-swap save)
// ---------------------------------------------------------------------------

export interface CheckoutLineInput {
  productId: string;
  quantity: number;
  lineDiscountPct?: number;
}

export interface CheckoutInput {
  idempotencyKey: string;
  lines: CheckoutLineInput[];
  orderDiscountPct?: number;
  paymentMethod: PaymentMethod;
  /** Cash tendered. Informational — no payment provider is involved. */
  amountReceived?: number | null;
  /** Explicit cashier confirmation that money was received. */
  paymentConfirmed?: boolean;
  note?: string;
}

export interface CheckoutContext {
  now: Date;
  cashierId: string;
  cashierName: string;
  /** Server-resolved: whether this operator may apply discounts. */
  allowDiscount: boolean;
  newId: () => string;
}

export interface CheckoutSuccess {
  ok: true;
  order: SaleOrder;
  /** True when this idempotency key had already produced an order. */
  duplicate: boolean;
  state: PersistedState;
}

export interface CheckoutFailure {
  ok: false;
  code: string;
  message: string;
  productId?: string;
}

export type CheckoutOutcome = CheckoutSuccess | CheckoutFailure;

function fail(code: string, message: string, productId?: string): CheckoutFailure {
  return { ok: false, code, message, productId };
}

function newReceiptNumber(counter: number): string {
  return `RCPT-${String(counter + 1).padStart(6, '0')}`;
}

interface ResolvedLine {
  input: CheckoutLineInput;
  product: Product;
  pos: PosProduct;
  warning?: string;
}

/**
 * Server-side line validation: existence, sellability, price, expiry, stock
 * and quantity rules against the *current* tenant state. Used by checkout and
 * again when confirming a pending payment, so stock can never go negative.
 */
function resolveLines(
  state: PersistedState,
  input: CheckoutInput,
  settings: Settings,
  now: Date,
): ResolvedLine[] | CheckoutFailure {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return fail('empty_cart', 'Add at least one product before checkout.');
  if (lines.length > MAX_CART_LINES) {
    return fail('cart_too_large', `A sale can contain at most ${MAX_CART_LINES} lines.`);
  }

  const seen = new Set<string>();
  const resolved: ResolvedLine[] = [];

  for (const line of lines) {
    if (!line || typeof line.productId !== 'string' || !line.productId) {
      return fail('invalid_line', 'Every cart line must reference a product.');
    }
    if (seen.has(line.productId)) {
      return fail('duplicate_line', 'The same product appears twice in this sale.', line.productId);
    }
    seen.add(line.productId);

    const product = state.products.find((item) => item.id === line.productId);
    if (!product) {
      return fail('not_found', 'A product in this sale no longer exists. Refresh and try again.', line.productId);
    }
    if (product.active === false) {
      return fail('inactive', `${product.name} is not available for sale.`, product.id);
    }

    const quantity = line.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      return fail('invalid_quantity', `Quantity for ${product.name} must be greater than zero.`, product.id);
    }
    if (quantity > MAX_QUANTITY) {
      return fail('invalid_quantity', `Quantity for ${product.name} is too large.`, product.id);
    }
    const fractionalOk = Math.round(quantity * 1000) / 1000 === quantity;
    if (product.allowFractional !== true && !Number.isInteger(quantity)) {
      return fail('fractional_not_allowed', `${product.name} is sold in whole units only.`, product.id);
    }
    if (!fractionalOk) {
      return fail('invalid_quantity', 'Quantities may use at most three decimal places.', product.id);
    }

    const price = product.sellingPrice;
    if (price === null || price === undefined || !Number.isFinite(price) || price < 0) {
      return fail(
        'price_missing',
        `${product.name} has no selling price. Set a price in Inventory before selling it.`,
        product.id,
      );
    }

    const days = daysUntil(product.expiryDate, now);
    if (days !== null && days < 0) {
      return fail(
        'expired',
        `${product.name} expired on ${product.expiryDate} and cannot be sold.`,
        product.id,
      );
    }

    if (quantity > product.currentStock) {
      return fail(
        'insufficient_stock',
        `Only ${product.currentStock} ${product.unit ?? 'units'} of ${product.name} in stock (you asked for ${quantity}).`,
        product.id,
      );
    }

    const pos = toPosProduct(product, settings, now);
    const warning =
      days !== null && days <= settings.expiryThreshold
        ? `${product.name} expires in ${days} day${days === 1 ? '' : 's'} (${product.expiryDate}).`
        : undefined;

    resolved.push({ input: line, product, pos, warning });
  }

  return resolved;
}

function buildOrderAndDeduct(
  state: PersistedState,
  resolved: ResolvedLine[],
  input: CheckoutInput,
  ctx: CheckoutContext,
  status: 'completed' | 'pending_payment',
  receiptNumber: string,
  totals: TotalsResult,
  warnings: string[],
  orderId: string,
): { order: SaleOrder; state: PersistedState } {
  const pos = posSettings(state.settings);
  const nowIso = ctx.now.toISOString();
  const today = todayISO(ctx.now);
  const completed = status === 'completed';

  const lines: SaleLine[] = resolved.map((entry, index) => {
    const lineTotals = totals.lines[index];
    return {
      productId: entry.product.id,
      sku: entry.product.sku,
      name: entry.product.name,
      quantity: entry.input.quantity,
      unitPrice: entry.product.sellingPrice ?? 0,
      taxRatePct: entry.pos.taxRatePct,
      lineDiscountPct: clampPercent(entry.input.lineDiscountPct),
      lineDiscountAmount: lineTotals.lineDiscountAmount,
      orderDiscountShare: lineTotals.orderDiscountShare,
      taxAmount: lineTotals.taxAmount,
      lineTotal: lineTotals.lineTotal,
      taxableBase: lineTotals.taxableBase,
    };
  });

  const amountReceived =
    typeof input.amountReceived === 'number' && Number.isFinite(input.amountReceived)
      ? round2(input.amountReceived)
      : null;
  const changeDue = amountReceived !== null ? round2(Math.max(0, amountReceived - totals.total)) : null;

  const order: SaleOrder = {
    id: orderId,
    receiptNumber,
    idempotencyKey: input.idempotencyKey,
    status,
    createdAt: nowIso,
    completedAt: completed ? nowIso : null,
    cancelledAt: null,
    soldAt: completed ? today : null,
    lines,
    subtotal: totals.subtotal,
    lineDiscountTotal: totals.lineDiscountTotal,
    orderDiscountPct: clampPercent(input.orderDiscountPct),
    orderDiscountTotal: totals.orderDiscountTotal,
    taxTotal: totals.taxTotal,
    taxableAmount: totals.taxableAmount,
    total: totals.total,
    taxInclusive: pos.taxInclusive,
    currency: state.settings.currency,
    paymentMethod: input.paymentMethod,
    amountReceived,
    changeDue,
    paidAt: completed ? nowIso : null,
    cashierId: ctx.cashierId,
    cashierName: ctx.cashierName,
    note: typeof input.note === 'string' ? input.note.slice(0, 240) : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  const next: PersistedState = {
    ...state,
    saleOrders: [...state.saleOrders, order],
    receiptCounter: state.receiptCounter + 1,
  };
  if (!completed) return { order, state: next };

  // ---- The atomic part: stock deduction + ledger lines + movements + activity
  const movements: InventoryMovement[] = [];
  const ledgerLines: SaleRecord[] = resolved.map((entry) => ({
    id: ctx.newId(),
    productId: entry.product.id,
    sku: entry.product.sku,
    quantity: entry.input.quantity,
    unitPrice: entry.product.sellingPrice ?? null,
    soldAt: today,
    source: 'pos',
    saleId: order.id,
    createdAt: nowIso,
  }));

  const products = state.products.map((product) => {
    const entry = resolved.find((item) => item.product.id === product.id);
    if (!entry) return product;
    const previous = product.currentStock;
    const resulting = roundStock(previous - entry.input.quantity);
    movements.push({
      id: ctx.newId(),
      productId: product.id,
      sku: product.sku,
      type: 'sale',
      quantityChange: resulting - previous,
      previousStock: previous,
      resultingStock: resulting,
      saleId: order.id,
      at: nowIso,
      actorId: ctx.cashierId,
      actorName: ctx.cashierName,
    });
    return { ...product, currentStock: resulting, updatedAt: nowIso };
  });

  const movementLedger = [...state.inventoryMovements, ...movements].slice(-MAX_MOVEMENTS);
  const activityEntry = {
    id: ctx.newId(),
    type: 'sale' as const,
    message: `Sale ${order.receiptNumber} completed`,
    detail: `${lines.length} product${lines.length === 1 ? '' : 's'} · ${formatMoneyAmount(totals.total)} ${state.settings.currency} · ${order.paymentMethod.toUpperCase()}`,
    at: nowIso,
  };

  return {
    order,
    state: {
      ...next,
      products,
      sales: mergeSales(state.sales, ledgerLines),
      inventoryMovements: movementLedger,
      activity: [activityEntry, ...state.activity].slice(0, 60),
    },
  };
}

function roundStock(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

function formatMoneyAmount(value: number): string {
  return value.toFixed(2);
}

/**
 * Completes a checkout against the organisation's current state.
 *
 * Returns a new state on success; never mutates the input. When the same
 * idempotency key was already used, returns the previously created order with
 * `duplicate: true` and an unchanged state — so a double-click, browser retry
 * or network replay cannot deduct stock twice.
 */
export function applyCheckout(
  state: PersistedState,
  input: CheckoutInput,
  ctx: CheckoutContext,
): CheckoutOutcome {
  const key = (input.idempotencyKey ?? '').trim();
  if (!key || key.length < 8 || key.length > 128) {
    return fail('missing_idempotency_key', 'This checkout has no transaction ID. Refresh and try again.');
  }
  const existing = state.saleOrders.find((order) => order.idempotencyKey === key);
  if (existing) {
    return { ok: true, order: existing, duplicate: true, state };
  }

  const settings = state.settings;
  const pos = posSettings(settings);
  const method = input.paymentMethod;
  if (!pos.paymentMethods.includes(method)) {
    return fail('payment_method', 'That payment method is not enabled for this shop.');
  }

  const orderDiscountPct = clampPercent(input.orderDiscountPct);
  if (orderDiscountPct > 0 && !ctx.allowDiscount) {
    return fail('discount_denied', 'You are not allowed to apply order-level discounts.');
  }
  for (const line of Array.isArray(input.lines) ? input.lines : []) {
    const pct = clampPercent(line?.lineDiscountPct);
    if (pct > 0 && !ctx.allowDiscount) {
      return fail('discount_denied', 'You are not allowed to apply item discounts.');
    }
  }

  const resolved = resolveLines(state, input, settings, ctx.now);
  if ('ok' in resolved) return resolved;

  const totals = computeTotals(
    resolved.map((entry) => ({
      quantity: entry.input.quantity,
      unitPrice: entry.product.sellingPrice ?? 0,
      taxRatePct: entry.pos.taxRatePct,
      lineDiscountPct: clampPercent(entry.input.lineDiscountPct),
    })),
    orderDiscountPct,
    pos.taxInclusive,
  );

  const amountReceived =
    typeof input.amountReceived === 'number' && Number.isFinite(input.amountReceived)
      ? round2(input.amountReceived)
      : null;
  if (method === 'cash' && amountReceived !== null && amountReceived < totals.total) {
    return fail(
      'amount_insufficient',
      `Amount received (${formatMoneyAmount(amountReceived)}) is less than the total (${formatMoneyAmount(totals.total)}).`,
    );
  }

  const status: 'completed' | 'pending_payment' =
    pos.requirePaymentConfirmation && input.paymentConfirmed !== true
      ? 'pending_payment'
      : 'completed';

  const warnings = resolved
    .map((entry) => entry.warning)
    .filter((warning): warning is string => Boolean(warning));

  const orderId = ctx.newId();
  const receiptNumber = newReceiptNumber(state.receiptCounter);
  const { order, state: next } = buildOrderAndDeduct(
    state,
    resolved,
    input,
    ctx,
    status,
    receiptNumber,
    totals,
    warnings,
    orderId,
  );
  return { ok: true, order, duplicate: false, state: next };
}

/**
 * Confirms payment on a pending order: revalidates stock and price against
 * current inventory, then deducts. Idempotent — confirming an already
 * completed order returns it unchanged.
 */
export function applyCompleteOrder(
  state: PersistedState,
  orderId: string,
  ctx: CheckoutContext,
): CheckoutOutcome {
  const order = state.saleOrders.find((item) => item.id === orderId);
  if (!order) return fail('not_found', 'That transaction no longer exists.');
  if (order.status === 'completed') return { ok: true, order, duplicate: true, state };
  if (order.status === 'cancelled') {
    return fail('order_cancelled', 'This transaction was cancelled and cannot be completed.');
  }

  // Rebuild the request from the stored lines and re-run every stock rule:
  // the inventory may have changed while the payment was pending.
  const synthetic: CheckoutInput = {
    idempotencyKey: order.idempotencyKey,
    lines: order.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      lineDiscountPct: line.lineDiscountPct,
    })),
    orderDiscountPct: order.orderDiscountPct,
    paymentMethod: order.paymentMethod,
    amountReceived: order.amountReceived,
    paymentConfirmed: true,
    note: order.note,
  };
  const resolved = resolveLines(state, synthetic, state.settings, ctx.now);
  if ('ok' in resolved) return resolved;

  const totals = computeTotals(
    resolved.map((entry) => ({
      quantity: entry.input.quantity,
      unitPrice: entry.product.sellingPrice ?? 0,
      taxRatePct: entry.pos.taxRatePct,
      lineDiscountPct: clampPercent(entry.input.lineDiscountPct),
    })),
    order.orderDiscountPct,
    posSettings(state.settings).taxInclusive,
  );

  const nowIso = ctx.now.toISOString();
  const today = todayISO(ctx.now);
  const movements: InventoryMovement[] = [];
  const products = state.products.map((product) => {
    const entry = resolved.find((item) => item.product.id === product.id);
    if (!entry) return product;
    const previous = product.currentStock;
    const resulting = roundStock(previous - entry.input.quantity);
    movements.push({
      id: ctx.newId(),
      productId: product.id,
      sku: product.sku,
      type: 'sale',
      quantityChange: resulting - previous,
      previousStock: previous,
      resultingStock: resulting,
      saleId: order.id,
      at: nowIso,
      actorId: ctx.cashierId,
      actorName: ctx.cashierName,
    });
    return { ...product, currentStock: resulting, updatedAt: nowIso };
  });

  const ledgerLines: SaleRecord[] = resolved.map((entry) => ({
    id: ctx.newId(),
    productId: entry.product.id,
    sku: entry.product.sku,
    quantity: entry.input.quantity,
    unitPrice: entry.product.sellingPrice ?? null,
    soldAt: today,
    source: 'pos',
    saleId: order.id,
    createdAt: nowIso,
  }));

  const completed: SaleOrder = {
    ...order,
    status: 'completed',
    completedAt: nowIso,
    soldAt: today,
    paidAt: nowIso,
    // Price/stock may have changed while pending: record what was charged.
    lines: order.lines.map((line, index) => ({
      ...line,
      lineDiscountAmount: totals.lines[index]?.lineDiscountAmount ?? line.lineDiscountAmount,
      orderDiscountShare: totals.lines[index]?.orderDiscountShare ?? line.orderDiscountShare,
      taxAmount: totals.lines[index]?.taxAmount ?? line.taxAmount,
      lineTotal: totals.lines[index]?.lineTotal ?? line.lineTotal,
      taxableBase: totals.lines[index]?.taxableBase ?? line.taxableBase,
    })),
    subtotal: totals.subtotal,
    lineDiscountTotal: totals.lineDiscountTotal,
    orderDiscountTotal: totals.orderDiscountTotal,
    taxTotal: totals.taxTotal,
    taxableAmount: totals.taxableAmount,
    total: totals.total,
  };

  const next: PersistedState = {
    ...state,
    products,
    sales: mergeSales(state.sales, ledgerLines),
    inventoryMovements: [...state.inventoryMovements, ...movements].slice(-MAX_MOVEMENTS),
    saleOrders: state.saleOrders.map((item) => (item.id === order.id ? completed : item)),
    activity: [
      {
        id: ctx.newId(),
        type: 'sale' as const,
        message: `Sale ${completed.receiptNumber} completed`,
        detail: `${completed.lines.length} product${completed.lines.length === 1 ? '' : 's'} · ${formatMoneyAmount(completed.total)} ${state.settings.currency} · payment confirmed`,
        at: nowIso,
      },
      ...state.activity,
    ].slice(0, 60),
  };
  return { ok: true, order: completed, duplicate: false, state: next };
}

/**
 * Cancels a transaction that has not completed. Stock is untouched because
 * stock only moves at completion; completed sales are never cancelled here
 * (Stockora does not implement refunds).
 */
export function applyCancelOrder(
  state: PersistedState,
  orderId: string,
  ctx: CheckoutContext,
): CheckoutOutcome {
  const order = state.saleOrders.find((item) => item.id === orderId);
  if (!order) return fail('not_found', 'That transaction no longer exists.');
  if (order.status === 'cancelled') return { ok: true, order, duplicate: true, state };
  if (order.status === 'completed') {
    return fail(
      'already_completed',
      'This sale is completed; stock has been deducted. A completed sale cannot be cancelled.',
    );
  }
  const cancelled: SaleOrder = {
    ...order,
    status: 'cancelled',
    cancelledAt: ctx.now.toISOString(),
  };
  return {
    ok: true,
    order: cancelled,
    duplicate: false,
    state: {
      ...state,
      saleOrders: state.saleOrders.map((item) => (item.id === order.id ? cancelled : item)),
      activity: [
        {
          id: ctx.newId(),
          type: 'sale' as const,
          message: `Sale ${order.receiptNumber} cancelled`,
          detail: 'No stock was deducted for this transaction',
          at: ctx.now.toISOString(),
        },
        ...state.activity,
      ].slice(0, 60),
    },
  };
}

// ---------------------------------------------------------------------------
// Sales reporting
// ---------------------------------------------------------------------------

export interface SalesMetrics {
  from: string;
  to: string;
  completedCount: number;
  pendingCount: number;
  cancelledCount: number;
  unitsSold: number;
  grossSales: number;
  discounts: number;
  taxCollected: number;
  /** Net sales after discounts (the amount customers paid, tax included). */
  netSales: number;
  averageTransaction: number;
  byPayment: Array<{ method: PaymentMethod; count: number; total: number }>;
  topProducts: Array<{ productId: string; sku: string; name: string; units: number; revenue: number }>;
}

/**
 * Financial metrics from completed POS transactions only. Demo/imported sales
 * rows live in the analytics ledger and are never mixed into these figures.
 * Date range filters on the completion date (soldAt).
 */
export function salesMetrics(
  orders: SaleOrder[],
  range: { from: string; to: string },
): SalesMetrics {
  const inRange = (order: SaleOrder) =>
    order.status === 'completed' &&
    order.soldAt !== null &&
    order.soldAt >= range.from &&
    order.soldAt <= range.to;
  const completed = orders.filter(inRange);
  const sumLines = (pick: (line: SaleLine) => number) =>
    round2(completed.reduce((total, order) => total + order.lines.reduce((s, line) => s + pick(line), 0), 0));

  const byPaymentMap = new Map<PaymentMethod, { count: number; total: number }>();
  const productMap = new Map<string, { sku: string; name: string; units: number; revenue: number }>();
  let unitsSold = 0;
  for (const order of completed) {
    const bucket = byPaymentMap.get(order.paymentMethod) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total = round2(bucket.total + order.total);
    byPaymentMap.set(order.paymentMethod, bucket);
    for (const line of order.lines) {
      unitsSold += line.quantity;
      const product = productMap.get(line.productId) ?? {
        sku: line.sku,
        name: line.name,
        units: 0,
        revenue: 0,
      };
      product.units += line.quantity;
      product.revenue = round2(product.revenue + line.lineTotal);
      productMap.set(line.productId, product);
    }
  }

  const netSales = round2(completed.reduce((total, order) => total + order.total, 0));
  return {
    from: range.from,
    to: range.to,
    completedCount: completed.length,
    pendingCount: orders.filter((order) => order.status === 'pending_payment').length,
    cancelledCount: orders.filter((order) => order.status === 'cancelled').length,
    unitsSold,
    grossSales: sumLines((line) => round2(line.quantity * line.unitPrice)),
    discounts: round2(
      sumLines((line) => line.lineDiscountAmount + line.orderDiscountShare),
    ),
    taxCollected: sumLines((line) => line.taxAmount),
    netSales,
    averageTransaction: completed.length > 0 ? round2(netSales / completed.length) : 0,
    byPayment: [...byPaymentMap.entries()]
      .map(([method, value]) => ({ method, count: value.count, total: value.total }))
      .sort((a, b) => b.total - a.total),
    topProducts: [...productMap.entries()]
      .map(([productId, value]) => ({ productId, ...value }))
      .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name)),
  };
}

/** CSV export of POS transactions (rows reflect the requested range). */
export function salesOrdersTable(
  orders: SaleOrder[],
  range: { from: string; to: string },
  currency: CurrencyCode,
): CsvTable {
  const rows = orders
    .filter(
      (order) =>
        order.soldAt !== null && order.soldAt >= range.from && order.soldAt <= range.to,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    headers: [
      'Receipt',
      'Status',
      'Date',
      'Completed At',
      'Cashier',
      'Payment Method',
      'Lines',
      'Units',
      'Subtotal',
      'Discounts',
      'Tax',
      'Total',
      'Currency',
      'SKUs',
    ],
    rows: rows.map((order) => [
      order.receiptNumber,
      order.status,
      order.soldAt ?? '',
      order.completedAt ?? '',
      order.cashierName,
      order.paymentMethod,
      order.lines.length,
      order.lines.reduce((sum, line) => sum + line.quantity, 0),
      order.subtotal.toFixed(2),
      (order.lineDiscountTotal + order.orderDiscountTotal).toFixed(2),
      order.taxTotal.toFixed(2),
      order.total.toFixed(2),
      currency,
      order.lines.map((line) => `${line.sku}×${line.quantity}`).join(' '),
    ]),
  };
}

export function salesCsv(orders: SaleOrder[], range: { from: string; to: string }, currency: CurrencyCode): string {
  return buildCsv(salesOrdersTable(orders, range, currency));
}

/** Receipt lookup by id (POS page + reprint). */
export function findOrder(orders: SaleOrder[], orderId: string): SaleOrder | undefined {
  return orders.find((order) => order.id === orderId);
}

/** Normalises the barcode sent to lookup, shared by client and server. */
export function normalizeLookupCode(raw: string): string {
  return normalizeBarcode(raw);
}
