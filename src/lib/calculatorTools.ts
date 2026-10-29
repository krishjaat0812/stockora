/**
 * Business Calculator tool registry.
 *
 * Each entry is pure data: the inputs it needs, the formula it applies and the
 * labelled results it produces. The page renders whatever is declared here, so
 * adding a calculator means adding one object — never new UI code. Every
 * `compute` delegates to `lib/calculator.ts`, which is independently tested.
 */

import type { Product, Settings } from '../types';
import { daysUntil } from './date';
import {
  arithmetic,
  averageTransactionValue,
  breakEvenSales,
  breakEvenUnits,
  compareSupplierQuotes,
  compareUnitPrices,
  contributionMarginRatio,
  dateDifferenceDays,
  daysOfStockRemaining,
  daysOfInventoryHeld,
  daysUntilExpiry,
  deadStockValue,
  discountBeforeLoss,
  discountImpact,
  discountedPrice,
  expiryRecoveryRate,
  forecastUnits,
  grossProfit,
  grossProfitMargin,
  gstAmount,
  gstExclusive,
  gstInclusive,
  inventoryCarryingCost,
  inventoryPurchaseValue,
  landedUnitCost,
  lossReductionFromDiscount,
  markupPercent,
  netProfitEstimate,
  operatingExpenseRatio,
  percentChange,
  percentOf,
  potentialGrossProfit,
  potentialSellingValue,
  priceForTargetMargin,
  purchaseCostAtRisk,
  purchaseDiscount,
  revenueAfterDiscount,
  revenueAtRisk,
  safetyStockUnits,
  salesGrowthPercent,
  simplifyRatio,
  stockShortageValue,
  stockTurnoverRatio,
  suggestedReorderQuantity,
  unitProfit,
  unitsForTargetProfit,
  unitsSoldPerDay,
  unsoldBeforeExpiry,
  wastePercent,
  type CalcOutcome,
  type ArithmeticOperator,
} from './calculator';

export type CalculatorCategory = 'inventory' | 'profit' | 'purchase' | 'sales' | 'expiry' | 'general';

export const CATEGORY_ORDER: CalculatorCategory[] = [
  'inventory',
  'profit',
  'purchase',
  'sales',
  'expiry',
  'general',
];

export const CATEGORY_META: Record<CalculatorCategory, { label: string; description: string }> = {
  inventory: {
    label: 'Inventory',
    description: 'Stock value, cover, reorder levels, turnover and dead stock.',
  },
  profit: {
    label: 'Profit & loss',
    description: 'Margins, markups, break-even, expenses and discount impact.',
  },
  purchase: {
    label: 'Purchase & supplier',
    description: 'Order totals, discounts, GST and supplier quote comparison.',
  },
  sales: {
    label: 'Sales',
    description: 'Revenue, transaction value, growth, rates and sales targets.',
  },
  expiry: {
    label: 'Expiry & waste',
    description: 'Value at risk before expiry, markdown ceilings and recovery.',
  },
  general: {
    label: 'General',
    description: 'Percentages, ratios, unit prices, dates and plain arithmetic.',
  },
};

export type ToolInputType = 'number' | 'date' | 'select';

export interface ToolInputDef {
  key: string;
  label: string;
  type?: ToolInputType;
  unit?: string;
  /** Prefilled value so every calculator is usable without setup. */
  defaultValue?: number | string;
  options?: Array<{ value: string; label: string }>;
  /**
   * Reserved keys (`stock`, `unitCost`, `sellingPrice`, `averageDailySales`,
   * `leadTimeDays`, `safetyDays`, `daysUntilExpiry`) can be filled from a
   * selected inventory product when the tool supports prefill.
   */
  fromProduct?: boolean;
  help?: string;
}

export interface ToolOutput {
  label: string;
  value: number | null;
  unit: string | null;
  message: string | null;
  /** Render the value as money in the shop's currency. */
  currency?: boolean;
  /** A non-numeric result line (e.g. "Supplier B is cheaper"). */
  text?: string;
}

export type ToolValues = Record<string, number | string | null>;

export interface ToolDefinition {
  id: string;
  category: CalculatorCategory;
  name: string;
  description: string;
  /** Shown under the results so the arithmetic is never hidden. */
  formula: string;
  inputs: ToolInputDef[];
  /** Enables the "Load a product from inventory" picker. */
  prefill?: boolean;
  compute: (values: ToolValues) => ToolOutput[];
}

/** Reserved prefill keys and where their value comes from. */
export const PREFILL_KEYS = [
  'stock',
  'unitCost',
  'sellingPrice',
  'averageDailySales',
  'leadTimeDays',
  'safetyDays',
  'daysUntilExpiry',
] as const;

export interface PrefillContext {
  safetyBufferDays: number;
  today?: Date;
}

/**
 * Values a product can supply for a prefill-enabled tool. Fields the product
 * does not record are simply omitted, so the tool keeps its own default and the
 * user can see what is missing rather than reading a fabricated number.
 */
export function prefillFromProduct(
  product: Product,
  context: PrefillContext,
): Record<string, number> {
  const values: Record<string, number> = { stock: product.currentStock };
  if (typeof product.unitCost === 'number' && Number.isFinite(product.unitCost)) {
    values.unitCost = product.unitCost;
  }
  if (typeof product.sellingPrice === 'number' && Number.isFinite(product.sellingPrice)) {
    values.sellingPrice = product.sellingPrice;
  }
  values.averageDailySales = product.averageDailySales;
  values.leadTimeDays = product.leadTimeDays;
  values.safetyDays = context.safetyBufferDays;
  const days = daysUntil(product.expiryDate, context.today);
  if (days !== null) values.daysUntilExpiry = days;
  return values;
}

function num(values: ToolValues, key: string): number {
  const raw = values[key];
  if (raw === null || raw === undefined || raw === '') return Number.NaN;
  return Number(raw);
}

function text(values: ToolValues, key: string): string {
  const raw = values[key];
  return typeof raw === 'string' ? raw : '';
}

function out(label: string, result: CalcOutcome, currency = false): ToolOutput {
  return { label, value: result.value, unit: result.unit, message: result.message, currency };
}

function note(label: string, textValue: string): ToolOutput {
  return { label, value: null, unit: null, message: null, text: textValue };
}

const NUMBER = 'number' as const;
const DATE = 'date' as const;

export const CALCULATOR_TOOLS: ToolDefinition[] = [
  /* ---------------- A. Inventory ---------------- */
  {
    id: 'inventory-value',
    category: 'inventory',
    name: 'Stock value & gross profit',
    description: 'What the stock cost, what it should sell for, and the gross profit in between.',
    formula: 'purchase value = stock × unit cost · selling value = stock × selling price',
    prefill: true,
    inputs: [
      { key: 'stock', label: 'Stock quantity', type: NUMBER, defaultValue: 8, fromProduct: true },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, unit: 'per unit', defaultValue: 62, fromProduct: true },
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, unit: 'per unit', defaultValue: 70, fromProduct: true },
    ],
    compute: (values) => [
      out('Inventory purchase value', inventoryPurchaseValue(num(values, 'stock'), num(values, 'unitCost')), true),
      out('Potential selling value', potentialSellingValue(num(values, 'stock'), num(values, 'sellingPrice')), true),
      out(
        'Potential gross profit',
        potentialGrossProfit(num(values, 'stock'), num(values, 'sellingPrice'), num(values, 'unitCost')),
        true,
      ),
    ],
  },
  {
    id: 'gross-margin',
    category: 'inventory',
    name: 'Gross margin & markup',
    description: 'Margin is measured against the selling price; markup is measured against the cost.',
    formula: 'margin = (price − cost) ÷ price × 100 · markup = (price − cost) ÷ cost × 100',
    prefill: true,
    inputs: [
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100, fromProduct: true },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 60, fromProduct: true },
    ],
    compute: (values) => [
      out('Gross profit margin', grossProfitMargin(num(values, 'sellingPrice'), num(values, 'unitCost'))),
      out('Markup percentage', markupPercent(num(values, 'sellingPrice'), num(values, 'unitCost'))),
    ],
  },
  {
    id: 'days-of-cover',
    category: 'inventory',
    name: 'Days of stock remaining',
    description: 'How long the current stock lasts at the recorded average daily sales.',
    formula: 'days of cover = current stock ÷ average daily sales',
    prefill: true,
    inputs: [
      { key: 'stock', label: 'Current stock', type: NUMBER, defaultValue: 30, fromProduct: true },
      { key: 'averageDailySales', label: 'Average daily sales', type: NUMBER, unit: 'per day', defaultValue: 3, fromProduct: true },
    ],
    compute: (values) => [
      out('Days of stock remaining', daysOfStockRemaining(num(values, 'stock'), num(values, 'averageDailySales'))),
    ],
  },
  {
    id: 'reorder-quantity',
    category: 'inventory',
    name: 'Reorder quantity & safety stock',
    description: 'The Reorder Planner formula, plus the safety-stock policy behind it.',
    formula: 'reorder = max(0, ceil(avg daily sales × (lead time + safety days) − current stock))',
    prefill: true,
    inputs: [
      { key: 'averageDailySales', label: 'Average daily sales', type: NUMBER, unit: 'per day', defaultValue: 12, fromProduct: true },
      { key: 'leadTimeDays', label: 'Supplier lead time', type: NUMBER, unit: 'days', defaultValue: 1, fromProduct: true },
      { key: 'safetyDays', label: 'Safety days', type: NUMBER, unit: 'days', defaultValue: 2, fromProduct: true, help: 'Defaults to your Settings safety buffer.' },
      { key: 'stock', label: 'Current stock', type: NUMBER, defaultValue: 8, fromProduct: true },
    ],
    compute: (values) => [
      out(
        'Suggested reorder quantity',
        suggestedReorderQuantity({
          averageDailySales: num(values, 'averageDailySales'),
          leadTimeDays: num(values, 'leadTimeDays'),
          safetyDays: num(values, 'safetyDays'),
          currentStock: num(values, 'stock'),
        }),
      ),
      out('Safety stock (demand over safety days)', safetyStockUnits(num(values, 'averageDailySales'), num(values, 'safetyDays'))),
    ],
  },
  {
    id: 'turnover-carrying',
    category: 'inventory',
    name: 'Stock turnover & carrying cost',
    description: 'How many times the stock turns over in a year, and what holding it costs.',
    formula: 'turnover = COGS ÷ average inventory value · carrying cost = average inventory value × rate',
    inputs: [
      { key: 'cogs', label: 'Cost of goods sold', type: NUMBER, unit: 'per year', defaultValue: 480000 },
      { key: 'averageInventoryValue', label: 'Average inventory value', type: NUMBER, defaultValue: 60000 },
      { key: 'carryingRate', label: 'Annual carrying-cost rate', type: NUMBER, unit: '%', defaultValue: 18, help: 'A rate you choose — storage, insurance, spoilage and tied-up capital.' },
    ],
    compute: (values) => {
      const turnover = stockTurnoverRatio(num(values, 'cogs'), num(values, 'averageInventoryValue'));
      return [
        out('Stock turnover ratio', turnover),
        out('Days of inventory held', daysOfInventoryHeld(turnover.value ?? Number.NaN)),
        out('Annual carrying cost', inventoryCarryingCost(num(values, 'averageInventoryValue'), num(values, 'carryingRate')), true),
      ];
    },
  },
  {
    id: 'dead-shortage',
    category: 'inventory',
    name: 'Dead stock & shortage value',
    description: 'The money tied up in stock that is not selling, and the money needed to refill what is short.',
    formula: 'dead stock value = unsold units × unit cost · shortage value = short units × unit cost',
    inputs: [
      { key: 'deadUnits', label: 'Dead-stock units', type: NUMBER, defaultValue: 40 },
      { key: 'shortageUnits', label: 'Units short of the reorder quantity', type: NUMBER, defaultValue: 70 },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 28 },
    ],
    compute: (values) => [
      out('Dead stock value', deadStockValue(num(values, 'deadUnits'), num(values, 'unitCost')), true),
      out('Stock shortage value', stockShortageValue(num(values, 'shortageUnits'), num(values, 'unitCost')), true),
    ],
  },

  /* ---------------- B. Profit & loss ---------------- */
  {
    id: 'profit-per-unit',
    category: 'profit',
    name: 'Product profit & net estimate',
    description: 'Profit on a quantity sold, then minus your operating expenses.',
    formula: 'unit profit = price − cost · gross profit = units × unit profit · net = gross profit − expenses',
    prefill: true,
    inputs: [
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100, fromProduct: true },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 60, fromProduct: true },
      { key: 'units', label: 'Units sold', type: NUMBER, defaultValue: 30 },
      { key: 'operatingExpenses', label: 'Operating expenses for the period', type: NUMBER, defaultValue: 500 },
    ],
    compute: (values) => {
      const gross = grossProfit(num(values, 'units'), num(values, 'sellingPrice'), num(values, 'unitCost'));
      return [
        out('Profit per unit', unitProfit(num(values, 'sellingPrice'), num(values, 'unitCost')), true),
        out('Gross profit', gross, true),
        out('Net profit estimate', netProfitEstimate(gross.value ?? Number.NaN, num(values, 'operatingExpenses')), true),
      ];
    },
  },
  {
    id: 'margin-target',
    category: 'profit',
    name: 'Price for a target margin',
    description: 'The selling price needed to hit a margin you choose.',
    formula: 'price = cost ÷ (1 − target margin ÷ 100)',
    prefill: true,
    inputs: [
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 60, fromProduct: true },
      { key: 'targetMargin', label: 'Target gross margin', type: NUMBER, unit: '%', defaultValue: 40 },
    ],
    compute: (values) => [
      out('Required selling price', priceForTargetMargin(num(values, 'unitCost'), num(values, 'targetMargin')), true),
    ],
  },
  {
    id: 'break-even',
    category: 'profit',
    name: 'Break-even point',
    description: 'The units and revenue needed before the shop covers its fixed costs.',
    formula: 'break-even units = fixed costs ÷ (price − variable cost per unit)',
    inputs: [
      { key: 'fixedCosts', label: 'Fixed costs', type: NUMBER, unit: 'per period', defaultValue: 50000 },
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100 },
      { key: 'variableCost', label: 'Variable cost per unit', type: NUMBER, defaultValue: 60 },
    ],
    compute: (values) => {
      const ratio = contributionMarginRatio(num(values, 'sellingPrice'), num(values, 'variableCost'));
      return [
        out('Contribution margin ratio', ratio),
        out('Break-even units', breakEvenUnits(num(values, 'fixedCosts'), num(values, 'sellingPrice'), num(values, 'variableCost'))),
        out('Break-even sales value', breakEvenSales(num(values, 'fixedCosts'), ratio.value ?? Number.NaN), true),
      ];
    },
  },
  {
    id: 'expense-ratio',
    category: 'profit',
    name: 'Operating expense ratio',
    description: 'How much of each rupee of revenue goes to running the shop.',
    formula: 'expense ratio = operating expenses ÷ revenue × 100',
    inputs: [
      { key: 'operatingExpenses', label: 'Operating expenses', type: NUMBER, defaultValue: 32000 },
      { key: 'revenue', label: 'Revenue', type: NUMBER, defaultValue: 80000 },
    ],
    compute: (values) => [
      out('Operating expense ratio', operatingExpenseRatio(num(values, 'operatingExpenses'), num(values, 'revenue'))),
    ],
  },
  {
    id: 'discount-impact',
    category: 'profit',
    name: 'Discount impact on profit',
    description: 'What a markdown does to the price and to the profit you keep.',
    formula: 'discounted price = price × (1 − discount ÷ 100) · profit lost = profit before − profit after',
    prefill: true,
    inputs: [
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100, fromProduct: true },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 60, fromProduct: true },
      { key: 'units', label: 'Units in the promotion', type: NUMBER, defaultValue: 50 },
      { key: 'discount', label: 'Discount', type: NUMBER, unit: '%', defaultValue: 20 },
    ],
    compute: (values) => {
      const impact = discountImpact({
        units: num(values, 'units'),
        sellingPrice: num(values, 'sellingPrice'),
        unitCost: num(values, 'unitCost'),
        discountPercent: num(values, 'discount'),
      });
      return [
        out('Discounted selling price', discountedPrice(num(values, 'sellingPrice'), num(values, 'discount')), true),
        out('Revenue after discount', { value: impact.revenueAfter, unit: null, message: impact.message }, true),
        out('Profit before discount', { value: impact.profitBefore, unit: null, message: null }, true),
        out('Profit after discount', { value: impact.profitAfter, unit: null, message: null }, true),
        out('Profit given up', { value: impact.profitLost, unit: null, message: null }, true),
      ];
    },
  },

  /* ---------------- C. Purchase & supplier ---------------- */
  {
    id: 'purchase-order',
    category: 'purchase',
    name: 'Purchase order & landed cost',
    description: 'What one order line costs once freight is allocated per unit.',
    formula: 'goods total = quantity × unit cost · landed unit cost = unit cost + freight ÷ quantity',
    prefill: true,
    inputs: [
      { key: 'quantity', label: 'Quantity ordered', type: NUMBER, defaultValue: 12 },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 58, fromProduct: true },
      { key: 'shipping', label: 'Shipping & handling', type: NUMBER, defaultValue: 240 },
      { key: 'discount', label: 'Purchase discount', type: NUMBER, unit: '%', defaultValue: 5 },
    ],
    compute: (values) => {
      const goodsTotal = num(values, 'quantity') * num(values, 'unitCost');
      const discount = purchaseDiscount(goodsTotal, num(values, 'discount'));
      return [
        out('Goods total', { value: Number.isFinite(goodsTotal) ? goodsTotal : null, unit: null, message: null }, true),
        out('Purchase discount', { value: discount.discountAmount, unit: null, message: discount.message }, true),
        out('Invoice total after discount', { value: discount.netPayable, unit: null, message: discount.message }, true),
        out('Effective cost per unit (with freight)', landedUnitCost(num(values, 'unitCost'), num(values, 'shipping'), num(values, 'quantity')), true),
      ];
    },
  },
  {
    id: 'gst-on-price',
    category: 'purchase',
    name: 'Add GST to a price',
    description: 'Turn a GST-exclusive price into the price the customer pays.',
    formula: 'inclusive = base × (1 + GST ÷ 100) · GST amount = base × GST ÷ 100',
    inputs: [
      { key: 'basePrice', label: 'GST-exclusive price', type: NUMBER, defaultValue: 100 },
      { key: 'gstRate', label: 'GST rate', type: NUMBER, unit: '%', defaultValue: 18, help: 'Rates vary by product — enter the rate for the item you are pricing.' },
    ],
    compute: (values) => [
      out('GST-inclusive price', gstInclusive(num(values, 'basePrice'), num(values, 'gstRate')), true),
      out('GST amount', gstAmount(num(values, 'basePrice'), num(values, 'gstRate')), true),
    ],
  },
  {
    id: 'gst-from-inclusive',
    category: 'purchase',
    name: 'Remove GST from a price',
    description: 'Work back from a shelf price to the pre-tax price and the tax inside it.',
    formula: 'exclusive = inclusive ÷ (1 + GST ÷ 100)',
    inputs: [
      { key: 'inclusivePrice', label: 'GST-inclusive price', type: NUMBER, defaultValue: 118 },
      { key: 'gstRate', label: 'GST rate', type: NUMBER, unit: '%', defaultValue: 18 },
    ],
    compute: (values) => {
      const exclusive = gstExclusive(num(values, 'inclusivePrice'), num(values, 'gstRate'));
      const base = exclusive.value ?? Number.NaN;
      return [
        out('GST-exclusive price', exclusive, true),
        out('GST amount included', gstAmount(base, num(values, 'gstRate')), true),
      ];
    },
  },
  {
    id: 'supplier-compare',
    category: 'purchase',
    name: 'Supplier quote comparison',
    description: 'Ranks two quotes on all-in cost, including allocated freight.',
    formula: 'effective unit cost = unit cost + freight ÷ quantity',
    inputs: [
      { key: 'qtyA', label: 'Supplier A quantity', type: NUMBER, defaultValue: 100 },
      { key: 'costA', label: 'Supplier A unit cost', type: NUMBER, defaultValue: 50 },
      { key: 'shipA', label: 'Supplier A freight', type: NUMBER, defaultValue: 500 },
      { key: 'qtyB', label: 'Supplier B quantity', type: NUMBER, defaultValue: 100 },
      { key: 'costB', label: 'Supplier B unit cost', type: NUMBER, defaultValue: 52 },
      { key: 'shipB', label: 'Supplier B freight', type: NUMBER, defaultValue: 0 },
    ],
    compute: (values) => {
      const comparison = compareSupplierQuotes([
        { name: 'Supplier A', quantity: num(values, 'qtyA'), unitCost: num(values, 'costA'), shippingAndHandling: num(values, 'shipA') },
        { name: 'Supplier B', quantity: num(values, 'qtyB'), unitCost: num(values, 'costB'), shippingAndHandling: num(values, 'shipB') },
      ]);
      const rows: ToolOutput[] = comparison.rows.map((row) =>
        out(`Supplier ${row.name.endsWith('A') ? 'A' : 'B'} effective unit cost`, {
          value: row.effectiveUnitCost,
          unit: row.cheapest ? 'cheapest' : 'per unit',
          message: null,
        }, true),
      );
      if (comparison.message) return [note('Comparison unavailable', comparison.message)];
      const cheapest = comparison.rows.find((row) => row.cheapest);
      return [...rows, note('Lowest all-in cost', `${cheapest?.name ?? '—'} at the effective unit cost shown. This ranks quotes only — no order is placed.`)];
    },
  },
  {
    id: 'invoice-discount',
    category: 'purchase',
    name: 'Supplier invoice discount',
    description: 'The discount taken off an invoice and the amount left to pay.',
    formula: 'discount = subtotal × discount ÷ 100 · net payable = subtotal − discount',
    inputs: [
      { key: 'subtotal', label: 'Invoice subtotal', type: NUMBER, defaultValue: 10000 },
      { key: 'discount', label: 'Discount', type: NUMBER, unit: '%', defaultValue: 7.5 },
    ],
    compute: (values) => {
      const result = purchaseDiscount(num(values, 'subtotal'), num(values, 'discount'));
      return [
        out('Discount amount', { value: result.discountAmount, unit: null, message: result.message }, true),
        out('Net payable', { value: result.netPayable, unit: null, message: result.message }, true),
      ];
    },
  },

  /* ---------------- D. Sales ---------------- */
  {
    id: 'revenue-discount',
    category: 'sales',
    name: 'Sales revenue',
    description: 'Revenue at full price and after a discount.',
    formula: 'revenue = units × price · after discount = units × price × (1 − discount ÷ 100)',
    prefill: true,
    inputs: [
      { key: 'units', label: 'Units sold', type: NUMBER, defaultValue: 100 },
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 50, fromProduct: true },
      { key: 'discount', label: 'Discount', type: NUMBER, unit: '%', defaultValue: 10 },
    ],
    compute: (values) => [
      out('Total sales revenue', revenueAfterDiscount(num(values, 'units'), num(values, 'sellingPrice'), 0), true),
      out('Revenue after discount', revenueAfterDiscount(num(values, 'units'), num(values, 'sellingPrice'), num(values, 'discount')), true),
    ],
  },
  {
    id: 'sales-growth',
    category: 'sales',
    name: 'Sales growth',
    description: 'The change between two periods, as a percentage.',
    formula: 'growth = (current − previous) ÷ previous × 100',
    inputs: [
      { key: 'previousSales', label: 'Previous period sales', type: NUMBER, defaultValue: 1000 },
      { key: 'currentSales', label: 'Current period sales', type: NUMBER, defaultValue: 1250 },
    ],
    compute: (values) => [
      out('Sales growth', salesGrowthPercent(num(values, 'previousSales'), num(values, 'currentSales'))),
    ],
  },
  {
    id: 'sales-rate',
    category: 'sales',
    name: 'Sales rate & forecast',
    description: 'Units per day, and what that rate projects over a forward period.',
    formula: 'units per day = units ÷ days · forecast = average daily sales × days',
    prefill: true,
    inputs: [
      { key: 'units', label: 'Units sold', type: NUMBER, defaultValue: 84 },
      { key: 'days', label: 'Days in the period', type: NUMBER, defaultValue: 7 },
      { key: 'forecastDays', label: 'Days to project forward', type: NUMBER, defaultValue: 30 },
    ],
    compute: (values) => {
      const rate = unitsSoldPerDay(num(values, 'units'), num(values, 'days'));
      return [
        out('Units sold per day', rate),
        out('Projected units', forecastUnits(rate.value ?? Number.NaN, num(values, 'forecastDays'))),
      ];
    },
  },
  {
    id: 'target-profit',
    category: 'sales',
    name: 'Sales target for a profit',
    description: 'The units and revenue needed to reach a profit target.',
    formula: 'units = (fixed costs + target profit) ÷ (price − variable cost per unit)',
    inputs: [
      { key: 'fixedCosts', label: 'Fixed costs', type: NUMBER, defaultValue: 50000 },
      { key: 'targetProfit', label: 'Target profit', type: NUMBER, defaultValue: 20000 },
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100 },
      { key: 'variableCost', label: 'Variable cost per unit', type: NUMBER, defaultValue: 60 },
    ],
    compute: (values) => {
      const units = unitsForTargetProfit(
        num(values, 'fixedCosts'),
        num(values, 'targetProfit'),
        num(values, 'sellingPrice'),
        num(values, 'variableCost'),
      );
      return [
        out('Units required', units),
        out('Revenue required', {
          value: units.value === null ? null : units.value * num(values, 'sellingPrice'),
          unit: null,
          message: units.message,
        }, true),
      ];
    },
  },
  {
    id: 'transaction-value',
    category: 'sales',
    name: 'Average transaction value',
    description: 'What an average customer spends per transaction.',
    formula: 'average transaction value = revenue ÷ transactions',
    inputs: [
      { key: 'revenue', label: 'Revenue', type: NUMBER, defaultValue: 45000 },
      { key: 'transactions', label: 'Number of transactions', type: NUMBER, defaultValue: 300 },
    ],
    compute: (values) => [
      out('Average transaction value', averageTransactionValue(num(values, 'revenue'), num(values, 'transactions')), true),
    ],
  },

  /* ---------------- E. Expiry & waste ---------------- */
  {
    id: 'expiry-at-risk',
    category: 'expiry',
    name: 'Value at risk before expiry',
    description: 'Units expected to remain when the shelf life runs out, and what they cost.',
    formula: 'unsold = max(0, stock − average daily sales × days remaining)',
    prefill: true,
    inputs: [
      { key: 'stock', label: 'Current stock', type: NUMBER, defaultValue: 30, fromProduct: true },
      { key: 'averageDailySales', label: 'Average daily sales', type: NUMBER, unit: 'per day', defaultValue: 3, fromProduct: true },
      { key: 'daysUntilExpiry', label: 'Days until expiry', type: NUMBER, unit: 'days', defaultValue: 2, fromProduct: true },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 85, fromProduct: true },
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100, fromProduct: true },
    ],
    compute: (values) => {
      const forecast = forecastUnits(num(values, 'averageDailySales'), num(values, 'daysUntilExpiry'));
      const unsold = unsoldBeforeExpiry(num(values, 'stock'), forecast.value ?? Number.NaN);
      return [
        out('Expected sales before expiry', forecast),
        out('Estimated unsold units', unsold),
        out('Purchase cost at risk', purchaseCostAtRisk(unsold.value ?? Number.NaN, num(values, 'unitCost')), true),
        out('Potential revenue at risk', revenueAtRisk(unsold.value ?? Number.NaN, num(values, 'sellingPrice')), true),
      ];
    },
  },
  {
    id: 'discount-ceiling',
    category: 'expiry',
    name: 'Markdown ceiling',
    description: 'The deepest discount that still covers the purchase cost.',
    formula: 'max discount = (price − cost) ÷ price × 100',
    prefill: true,
    inputs: [
      { key: 'sellingPrice', label: 'Selling price per unit', type: NUMBER, defaultValue: 100, fromProduct: true },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 85, fromProduct: true },
    ],
    compute: (values) => [
      out('Largest discount without a loss', discountBeforeLoss(num(values, 'sellingPrice'), num(values, 'unitCost'))),
      out('Profit per unit at full price', unitProfit(num(values, 'sellingPrice'), num(values, 'unitCost')), true),
    ],
  },
  {
    id: 'loss-recovery',
    category: 'expiry',
    name: 'Loss reduction from a markdown',
    description: 'How much of the at-risk cost a promotion is expected to recover. The extra units sold is your estimate, not the app\u2019s assumption.',
    formula: 'reduction = (at-risk units − units sold because of the markdown) × unit cost',
    inputs: [
      { key: 'atRiskUnits', label: 'Units at risk', type: NUMBER, defaultValue: 24 },
      { key: 'unitCost', label: 'Purchase cost per unit', type: NUMBER, defaultValue: 85 },
      { key: 'extraUnitsSold', label: 'Extra units the markdown should sell', type: NUMBER, defaultValue: 15 },
    ],
    compute: (values) => {
      const result = lossReductionFromDiscount({
        atRiskUnits: num(values, 'atRiskUnits'),
        unitCost: num(values, 'unitCost'),
        extraUnitsSold: num(values, 'extraUnitsSold'),
      });
      return [
        out('Cost at risk without a markdown', { value: result.lossWithoutDiscount, unit: null, message: result.message }, true),
        out('Cost still at risk after the markdown', { value: result.lossWithDiscount, unit: null, message: null }, true),
        out('Potential loss avoided', { value: result.reduction, unit: null, message: null }, true),
      ];
    },
  },
  {
    id: 'waste-rate',
    category: 'expiry',
    name: 'Waste percentage',
    description: 'The share of stock written off in a period.',
    formula: 'waste % = wasted units ÷ total units × 100',
    inputs: [
      { key: 'wasteUnits', label: 'Wasted units', type: NUMBER, defaultValue: 6 },
      { key: 'totalUnits', label: 'Total units handled', type: NUMBER, defaultValue: 40 },
    ],
    compute: (values) => [out('Waste percentage', wastePercent(num(values, 'wasteUnits'), num(values, 'totalUnits')))],
  },
  {
    id: 'recovery-rate',
    category: 'expiry',
    name: 'Expiry recovery rate',
    description: 'How much of the value at risk was actually recovered through markdowns or returns.',
    formula: 'recovery rate = recovered value ÷ value at risk × 100',
    inputs: [
      { key: 'recoveredValue', label: 'Value recovered', type: NUMBER, defaultValue: 1200 },
      { key: 'valueAtRisk', label: 'Value that was at risk', type: NUMBER, defaultValue: 2400 },
    ],
    compute: (values) => [
      out('Expiry recovery rate', expiryRecoveryRate(num(values, 'recoveredValue'), num(values, 'valueAtRisk'))),
    ],
  },

  /* ---------------- F. General ---------------- */
  {
    id: 'percent-of',
    category: 'general',
    name: 'Percentage of a value',
    description: 'A percentage taken from an amount.',
    formula: 'result = value × percent ÷ 100',
    inputs: [
      { key: 'value', label: 'Value', type: NUMBER, defaultValue: 240 },
      { key: 'percent', label: 'Percentage', type: NUMBER, unit: '%', defaultValue: 7.5 },
    ],
    compute: (values) => [out('Result', percentOf(num(values, 'value'), num(values, 'percent')))],
  },
  {
    id: 'percent-change',
    category: 'general',
    name: 'Percentage increase or decrease',
    description: 'How far one value moved from another.',
    formula: 'change = (to − from) ÷ from × 100',
    inputs: [
      { key: 'fromValue', label: 'From value', type: NUMBER, defaultValue: 80 },
      { key: 'toValue', label: 'To value', type: NUMBER, defaultValue: 60 },
    ],
    compute: (values) => [out('Percentage change', percentChange(num(values, 'fromValue'), num(values, 'toValue')))],
  },
  {
    id: 'ratio',
    category: 'general',
    name: 'Ratio simplifier',
    description: 'Reduces a ratio to its lowest whole numbers.',
    formula: 'both sides ÷ their greatest common divisor',
    inputs: [
      { key: 'left', label: 'First number', type: NUMBER, defaultValue: 60 },
      { key: 'right', label: 'Second number', type: NUMBER, defaultValue: 45 },
    ],
    compute: (values) => {
      const left = num(values, 'left');
      const right = num(values, 'right');
      const simplified = simplifyRatio(left, right);
      if (!simplified) {
        return [note('Simplified ratio', 'Enter two whole numbers greater than zero to simplify a ratio.')];
      }
      return [note('Simplified ratio', `${left} : ${right} = ${simplified.left} : ${simplified.right}`)];
    },
  },
  {
    id: 'unit-price',
    category: 'general',
    name: 'Unit price comparison',
    description: 'Which pack size is better value per unit.',
    formula: 'price per unit = pack price ÷ pack quantity',
    inputs: [
      { key: 'qtyA', label: 'Pack A quantity', type: NUMBER, defaultValue: 500 },
      { key: 'priceA', label: 'Pack A price', type: NUMBER, defaultValue: 110 },
      { key: 'qtyB', label: 'Pack B quantity', type: NUMBER, defaultValue: 1000 },
      { key: 'priceB', label: 'Pack B price', type: NUMBER, defaultValue: 240 },
    ],
    compute: (values) => {
      const comparison = compareUnitPrices(
        { price: num(values, 'priceA'), quantity: num(values, 'qtyA') },
        { price: num(values, 'priceB'), quantity: num(values, 'qtyB') },
      );
      if (!comparison) return [note('Comparison unavailable', 'Enter a price and a quantity above zero for both packs.')];
      return [
        out('Pack A price per unit', { value: comparison.pricePerUnitA, unit: null, message: null }, true),
        out('Pack B price per unit', { value: comparison.pricePerUnitB, unit: null, message: null }, true),
        note(
          'Better value',
          comparison.cheaper === 'equal'
            ? 'Both packs cost the same per unit.'
            : `Pack ${comparison.cheaper} is cheaper per unit.`,
        ),
      ];
    },
  },
  {
    id: 'date-difference',
    category: 'general',
    name: 'Date difference',
    description: 'Calendar days between two dates.',
    formula: 'later date − earlier date, in days',
    inputs: [
      { key: 'fromDate', label: 'Start date', type: DATE, defaultValue: '' },
      { key: 'toDate', label: 'End date', type: DATE, defaultValue: '' },
    ],
    compute: (values) => [
      out('Days between the dates', dateDifferenceDays(text(values, 'fromDate'), text(values, 'toDate'))),
    ],
  },
  {
    id: 'days-to-expiry',
    category: 'general',
    name: 'Days until expiry',
    description: 'How many days of shelf life are left from today.',
    formula: 'expiry date − today, in calendar days',
    inputs: [{ key: 'expiryDate', label: 'Expiry date', type: DATE, defaultValue: '' }],
    compute: (values) => [out('Days until expiry', daysUntilExpiry(text(values, 'expiryDate')))],
  },
  {
    id: 'arithmetic',
    category: 'general',
    name: 'Arithmetic',
    description: 'Plain addition, subtraction, multiplication and division.',
    formula: 'the operation you choose, applied to the two numbers',
    inputs: [
      { key: 'a', label: 'First number', type: NUMBER, defaultValue: 1250 },
      {
        key: 'operator',
        label: 'Operation',
        type: 'select',
        defaultValue: 'add',
        options: [
          { value: 'add', label: 'Add (+)' },
          { value: 'subtract', label: 'Subtract (−)' },
          { value: 'multiply', label: 'Multiply (×)' },
          { value: 'divide', label: 'Divide (÷)' },
        ],
      },
      { key: 'b', label: 'Second number', type: NUMBER, defaultValue: 250 },
    ],
    compute: (values) => [
      out('Result', arithmetic(num(values, 'a'), text(values, 'operator') as ArithmeticOperator, num(values, 'b'))),
    ],
  },
];

export function toolsForCategory(category: CalculatorCategory): ToolDefinition[] {
  return CALCULATOR_TOOLS.filter((tool) => tool.category === category);
}

export function toolById(id: string): ToolDefinition | undefined {
  return CALCULATOR_TOOLS.find((tool) => tool.id === id);
}

/** Default values for a tool's inputs, used to seed its form. */
export function defaultValues(tool: ToolDefinition): ToolValues {
  return tool.inputs.reduce<ToolValues>((acc, input) => {
    acc[input.key] = input.defaultValue ?? (input.type === DATE ? '' : 0);
    return acc;
  }, {});
}

/**
 * Applies a product's values to a prefill-enabled tool without discarding the
 * user's other inputs. Fields the product does not record keep their default.
 */
export function applyPrefill(tool: ToolDefinition, values: ToolValues, product: Product, context: PrefillContext): ToolValues {
  const available = prefillFromProduct(product, context);
  const next = { ...values };
  for (const input of tool.inputs) {
    if (!input.fromProduct) continue;
    const value = available[input.key];
    if (typeof value === 'number' && Number.isFinite(value)) next[input.key] = value;
  }
  return next;
}

/** Settings a tool may read for defaults (safety days, today's date). */
export function prefillContext(settings: Pick<Settings, 'safetyBufferDays'>, today?: Date): PrefillContext {
  return { safetyBufferDays: settings.safetyBufferDays, today };
}
