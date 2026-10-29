/**
 * Everything Calculator — pure retail business calculation logic.
 *
 * Every formula lives here so the UI, the reports and the tests share one
 * implementation instead of re-deriving the same arithmetic in components.
 *
 * Honesty rules applied throughout:
 *  - No function invents data. A figure that cannot be computed returns
 *    `value: null` with a `message` explaining exactly what input is missing.
 *  - Nothing here is a trained model. Growth, forecast and risk figures are
 *    rule-based arithmetic over the numbers the retailer entered, and the UI
 *    labels them as estimates.
 *  - Currency conversion is deliberately absent: no exchange-rate source is
 *    configured, so no rate is displayed or guessed.
 */

import type { Product, Settings } from '../types';
import { daysUntil } from './date';
import { reorderQuantity as reorderQuantityFromProduct } from './inventory';

/** Result of a calculation that may be unavailable for missing/invalid input. */
export interface CalcOutcome {
  value: number | null;
  /** Why the value is unavailable, or a caveat the user must see. Never a unit. */
  message: string | null;
  /** Short unit label for the value (e.g. `%`, `units`, `days`). */
  unit: string | null;
}

function ok(value: number, unit: string | null = null): CalcOutcome {
  if (!Number.isFinite(value)) {
    return { value: null, message: 'The inputs do not produce a finite number.', unit: null };
  }
  return { value, message: null, unit };
}

function na(message: string): CalcOutcome {
  return { value: null, message, unit: null };
}

function isCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Rounds to `decimals` places without floating-point drift in the display. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/* ------------------------------------------------------------------ *
 * A. Inventory calculators
 * ------------------------------------------------------------------ */

/** Current stock value at purchase cost: `stock × purchase cost per unit`. */
export function inventoryPurchaseValue(stock: number, unitCost: number): CalcOutcome {
  if (!isCount(stock) || !isCount(unitCost)) {
    return na('Enter a stock quantity and a purchase cost per unit (both zero or more).');
  }
  return ok(round(stock * unitCost));
}

/** Total inventory selling value: `stock × selling price per unit`. */
export function potentialSellingValue(stock: number, sellingPrice: number): CalcOutcome {
  if (!isCount(stock) || !isCount(sellingPrice)) {
    return na('Enter a stock quantity and a selling price per unit (both zero or more).');
  }
  return ok(round(stock * sellingPrice));
}

/** Potential gross profit: `stock × (selling price − purchase cost)`. */
export function potentialGrossProfit(
  stock: number,
  sellingPrice: number,
  unitCost: number,
): CalcOutcome {
  if (!isCount(stock) || !isCount(sellingPrice) || !isCount(unitCost)) {
    return na('Enter stock, selling price and purchase cost.');
  }
  return ok(round(stock * (sellingPrice - unitCost)));
}

/**
 * Gross profit margin: `(selling price − purchase cost) / selling price × 100`.
 * Undefined when the selling price is zero, because it would divide by zero.
 */
export function grossProfitMargin(sellingPrice: number, unitCost: number): CalcOutcome {
  if (!isCount(sellingPrice) || !isCount(unitCost)) {
    return na('Enter a selling price and a purchase cost.');
  }
  if (sellingPrice === 0) {
    return na('Gross profit margin is undefined when the selling price is zero.');
  }
  return ok(round(((sellingPrice - unitCost) / sellingPrice) * 100, 2), '%');
}

/** Markup percentage: `(selling price − purchase cost) / purchase cost × 100`. */
export function markupPercent(sellingPrice: number, unitCost: number): CalcOutcome {
  if (!isCount(sellingPrice) || !isCount(unitCost)) {
    return na('Enter a selling price and a purchase cost.');
  }
  if (unitCost === 0) {
    return na('Markup percentage is undefined when the purchase cost is zero.');
  }
  return ok(round(((sellingPrice - unitCost) / unitCost) * 100, 2), '%');
}

/** Days of stock remaining: `current stock ÷ average daily sales`. */
export function daysOfStockRemaining(currentStock: number, averageDailySales: number): CalcOutcome {
  if (!isCount(currentStock) || !isCount(averageDailySales)) {
    return na('Enter the current stock and the average daily sales.');
  }
  if (averageDailySales === 0) {
    return na('N/A — days of stock remaining cannot be calculated when daily sales are zero.');
  }
  return ok(round(currentStock / averageDailySales, 2), 'days');
}

/**
 * Basic reorder quantity:
 * `max(0, ceil(average daily sales × (lead time + safety days) − current stock))`.
 * This mirrors the Reorder Planner's rule exactly; it does not replace it.
 */
export function suggestedReorderQuantity(input: {
  averageDailySales: number;
  leadTimeDays: number;
  safetyDays: number;
  currentStock: number;
}): CalcOutcome {
  const { averageDailySales, leadTimeDays, safetyDays, currentStock } = input;
  if (!isCount(averageDailySales) || !isCount(leadTimeDays) || !isCount(safetyDays) || !isCount(currentStock)) {
    return na('Enter average daily sales, lead time, safety days and current stock.');
  }
  const required = averageDailySales * (leadTimeDays + safetyDays);
  return ok(Math.max(0, Math.ceil(required - currentStock - 1e-9)), 'units');
}

/**
 * Safety stock: demand expected to be covered during the safety-buffer window
 * (`average daily sales × safety days`). It is a policy figure, not a forecast.
 */
export function safetyStockUnits(averageDailySales: number, safetyDays: number): CalcOutcome {
  if (!isCount(averageDailySales) || !isCount(safetyDays)) {
    return na('Enter average daily sales and the number of safety days.');
  }
  return ok(Math.ceil(averageDailySales * safetyDays), 'units');
}

/** Stock turnover ratio: `cost of goods sold ÷ average inventory value`. */
export function stockTurnoverRatio(cogs: number, averageInventoryValue: number): CalcOutcome {
  if (!isCount(cogs) || !isCount(averageInventoryValue)) {
    return na('Enter the cost of goods sold and the average inventory value.');
  }
  if (averageInventoryValue === 0) {
    return na('Stock turnover is undefined when the average inventory value is zero.');
  }
  return ok(round(cogs / averageInventoryValue, 2), '×');
}

/** Inventory carrying cost: `average inventory value × annual carrying rate`. */
export function inventoryCarryingCost(
  averageInventoryValue: number,
  annualCarryingRatePercent: number,
): CalcOutcome {
  if (!isCount(averageInventoryValue) || !isCount(annualCarryingRatePercent)) {
    return na('Enter the average inventory value and a carrying-cost rate.');
  }
  return ok(round((averageInventoryValue * annualCarryingRatePercent) / 100), 'per year');
}

/** Dead stock value: `units that are not selling × purchase cost per unit`. */
export function deadStockValue(deadUnits: number, unitCost: number): CalcOutcome {
  if (!isCount(deadUnits) || !isCount(unitCost)) {
    return na('Enter the dead-stock units and the purchase cost per unit.');
  }
  return ok(round(deadUnits * unitCost));
}

/** Stock shortage value: `units short of the reorder quantity × purchase cost`. */
export function stockShortageValue(shortageUnits: number, unitCost: number): CalcOutcome {
  if (!isCount(shortageUnits) || !isCount(unitCost)) {
    return na('Enter the shortage units and the purchase cost per unit.');
  }
  return ok(round(shortageUnits * unitCost));
}

/* ------------------------------------------------------------------ *
 * B. Profit & loss calculators
 * ------------------------------------------------------------------ */

/** Profit per unit: `selling price − purchase cost`. */
export function unitProfit(sellingPrice: number, unitCost: number): CalcOutcome {
  if (!isCount(sellingPrice) || !isCount(unitCost)) {
    return na('Enter a selling price and a purchase cost.');
  }
  return ok(round(sellingPrice - unitCost), 'per unit');
}

/** Gross profit for a quantity sold: `units × (selling price − purchase cost)`. */
export function grossProfit(
  unitsSold: number,
  sellingPrice: number,
  unitCost: number,
): CalcOutcome {
  if (!isCount(unitsSold) || !isCount(sellingPrice) || !isCount(unitCost)) {
    return na('Enter units sold, selling price and purchase cost.');
  }
  return ok(round(unitsSold * (sellingPrice - unitCost)));
}

/** Net profit estimate: `gross profit − operating expenses`. */
export function netProfitEstimate(grossProfitValue: number, operatingExpenses: number): CalcOutcome {
  if (!Number.isFinite(grossProfitValue) || !isCount(operatingExpenses)) {
    return na('Enter the gross profit and the operating expenses.');
  }
  return ok(round(grossProfitValue - operatingExpenses));
}

/** Operating expense ratio: `operating expenses ÷ revenue × 100`. */
export function operatingExpenseRatio(
  operatingExpenses: number,
  revenue: number,
): CalcOutcome {
  if (!isCount(operatingExpenses) || !isCount(revenue)) {
    return na('Enter the operating expenses and the revenue.');
  }
  if (revenue === 0) {
    return na('The expense ratio is undefined when revenue is zero.');
  }
  return ok(round((operatingExpenses / revenue) * 100, 2), '% of revenue');
}

/** Break-even units: `fixed costs ÷ (selling price − variable cost per unit)`. */
export function breakEvenUnits(
  fixedCosts: number,
  sellingPrice: number,
  variableCostPerUnit: number,
): CalcOutcome {
  if (!isCount(fixedCosts) || !isCount(sellingPrice) || !isCount(variableCostPerUnit)) {
    return na('Enter fixed costs, selling price and variable cost per unit.');
  }
  const contribution = sellingPrice - variableCostPerUnit;
  if (contribution <= 0) {
    return na('Every sale loses money: the contribution per unit is zero or negative.');
  }
  return ok(Math.ceil(fixedCosts / contribution), 'units');
}

/** Break-even sales value: `fixed costs ÷ contribution margin ratio`. */
export function breakEvenSales(fixedCosts: number, contributionMarginRatioPercent: number): CalcOutcome {
  if (!isCount(fixedCosts) || !Number.isFinite(contributionMarginRatioPercent)) {
    return na('Enter the fixed costs and the contribution margin ratio.');
  }
  if (contributionMarginRatioPercent <= 0) {
    return na('Break-even sales are undefined when the contribution margin is zero or negative.');
  }
  return ok(round(fixedCosts / (contributionMarginRatioPercent / 100)));
}

/** Contribution margin ratio: `(selling price − variable cost) ÷ selling price × 100`. */
export function contributionMarginRatio(
  sellingPrice: number,
  variableCostPerUnit: number,
): CalcOutcome {
  if (!isCount(sellingPrice) || !isCount(variableCostPerUnit)) {
    return na('Enter the selling price and the variable cost per unit.');
  }
  if (sellingPrice === 0) {
    return na('The contribution margin ratio is undefined when the selling price is zero.');
  }
  return ok(round(((sellingPrice - variableCostPerUnit) / sellingPrice) * 100, 2), '%');
}

/** Discounted selling price: `original price × (1 − discount ÷ 100)`. */
export function discountedPrice(originalPrice: number, discountPercent: number): CalcOutcome {
  if (!isCount(originalPrice) || !Number.isFinite(discountPercent)) {
    return na('Enter the original price and a discount percentage.');
  }
  if (discountPercent < 0 || discountPercent > 100) {
    return na('A discount must be between 0% and 100%.');
  }
  return ok(round(originalPrice * (1 - discountPercent / 100)));
}

export interface DiscountImpact {
  profitBefore: number | null;
  profitAfter: number | null;
  profitLost: number | null;
  revenueAfter: number | null;
  message: string | null;
}

/**
 * Profit after a discount, and how much profit the discount gives up.
 * A discount below cost is reported rather than hidden.
 */
export function discountImpact(input: {
  units: number;
  sellingPrice: number;
  unitCost: number;
  discountPercent: number;
}): DiscountImpact {
  const { units, sellingPrice, unitCost, discountPercent } = input;
  if (!isCount(units) || !isCount(sellingPrice) || !isCount(unitCost)) {
    return {
      profitBefore: null,
      profitAfter: null,
      profitLost: null,
      revenueAfter: null,
      message: 'Enter units, selling price and purchase cost.',
    };
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return {
      profitBefore: null,
      profitAfter: null,
      profitLost: null,
      revenueAfter: null,
      message: 'A discount must be between 0% and 100%.',
    };
  }
  const discounted = round(sellingPrice * (1 - discountPercent / 100));
  const profitBefore = round(units * (sellingPrice - unitCost));
  const profitAfter = round(units * (discounted - unitCost));
  return {
    profitBefore,
    profitAfter,
    profitLost: round(profitBefore - profitAfter),
    revenueAfter: round(units * discounted),
    message:
      discounted < unitCost
        ? 'This discount sells below purchase cost, so the remaining units would make a loss.'
        : null,
  };
}

/** Price needed to achieve a target gross margin: `cost ÷ (1 − margin ÷ 100)`. */
export function priceForTargetMargin(unitCost: number, targetMarginPercent: number): CalcOutcome {
  if (!isCount(unitCost) || !Number.isFinite(targetMarginPercent)) {
    return na('Enter the purchase cost and a target margin.');
  }
  if (targetMarginPercent < 0 || targetMarginPercent >= 100) {
    return na('A target margin must be at least 0% and below 100%.');
  }
  return ok(round(unitCost / (1 - targetMarginPercent / 100)));
}

/* ------------------------------------------------------------------ *
 * C. Purchase & supplier calculators
 * ------------------------------------------------------------------ */

/** Purchase order total from quantity/unit-cost lines. */
export function purchaseOrderTotal(
  lines: Array<{ quantity: number; unitCost: number }>,
): CalcOutcome {
  if (lines.length === 0) return na('Add at least one order line.');
  let total = 0;
  for (const line of lines) {
    if (!isCount(line.quantity) || !isCount(line.unitCost)) {
      return na('Every order line needs a quantity and a unit cost (both zero or more).');
    }
    total += line.quantity * line.unitCost;
  }
  return ok(round(total));
}

export interface PurchaseDiscountResult {
  subtotal: number;
  discountAmount: number;
  netPayable: number;
  message: string | null;
}

/** Purchase discount and net payable: `subtotal × discount ÷ 100`. */
export function purchaseDiscount(subtotal: number, discountPercent: number): PurchaseDiscountResult {
  if (!isCount(subtotal) || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return {
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      discountAmount: 0,
      netPayable: 0,
      message: 'Enter a subtotal and a discount between 0% and 100%.',
    };
  }
  const discountAmount = round((subtotal * discountPercent) / 100);
  return {
    subtotal: round(subtotal),
    discountAmount,
    netPayable: round(subtotal - discountAmount),
    message: null,
  };
}

/** GST-inclusive price: `base price × (1 + GST ÷ 100)`. */
export function gstInclusive(basePrice: number, gstPercent: number): CalcOutcome {
  if (!isCount(basePrice) || !Number.isFinite(gstPercent) || gstPercent < 0) {
    return na('Enter a base price and a GST rate of 0% or more.');
  }
  return ok(round(basePrice * (1 + gstPercent / 100)));
}

/** GST-exclusive price: `inclusive price ÷ (1 + GST ÷ 100)`. */
export function gstExclusive(inclusivePrice: number, gstPercent: number): CalcOutcome {
  if (!isCount(inclusivePrice) || !Number.isFinite(gstPercent) || gstPercent < 0) {
    return na('Enter an inclusive price and a GST rate of 0% or more.');
  }
  return ok(round(inclusivePrice / (1 + gstPercent / 100)));
}

/** GST amount contained in a base price: `base price × GST ÷ 100`. */
export function gstAmount(basePrice: number, gstPercent: number): CalcOutcome {
  if (!isCount(basePrice) || !Number.isFinite(gstPercent) || gstPercent < 0) {
    return na('Enter a base price and a GST rate of 0% or more.');
  }
  return ok(round((basePrice * gstPercent) / 100));
}

/**
 * Effective purchase cost per unit including freight:
 * `unit cost + (shipping & handling ÷ quantity)`.
 */
export function landedUnitCost(unitCost: number, shippingAndHandling: number, quantity: number): CalcOutcome {
  if (!isCount(unitCost) || !isCount(shippingAndHandling) || !isCount(quantity)) {
    return na('Enter the unit cost, shipping/handling and a quantity.');
  }
  if (quantity === 0) {
    return na('Freight cannot be allocated per unit when the quantity is zero.');
  }
  return ok(round(unitCost + shippingAndHandling / quantity, 2), 'per unit');
}

export interface SupplierQuote {
  name: string;
  quantity: number;
  unitCost: number;
  shippingAndHandling?: number;
}

export interface SupplierComparisonRow {
  name: string;
  effectiveUnitCost: number;
  lineTotal: number;
  cheapest: boolean;
}

export interface SupplierComparison {
  rows: SupplierComparisonRow[];
  message: string | null;
}

/**
 * Compares supplier quotes for the same requirement on the all-in cost
 * (unit cost plus allocated freight). It ranks quotes; it does not order.
 */
export function compareSupplierQuotes(quotes: SupplierQuote[]): SupplierComparison {
  const usable = quotes.filter((quote) => isCount(quote.unitCost) && isCount(quote.quantity) && quote.quantity > 0);
  if (usable.length < 2) {
    return { rows: [], message: 'Add at least two supplier quotes with a quantity above zero.' };
  }
  const rows = usable.map((quote) => {
    const effective = round(quote.unitCost + (quote.shippingAndHandling ?? 0) / quote.quantity, 2);
    return {
      name: quote.name,
      effectiveUnitCost: effective,
      lineTotal: round(effective * quote.quantity),
      cheapest: false,
    };
  });
  const best = Math.min(...rows.map((row) => row.effectiveUnitCost));
  return {
    rows: rows.map((row) => ({ ...row, cheapest: row.effectiveUnitCost === best })),
    message: null,
  };
}

/* ------------------------------------------------------------------ *
 * D. Sales calculators
 * ------------------------------------------------------------------ */

/** Total sales revenue: `units sold × selling price`. */
export function totalSalesRevenue(unitsSold: number, sellingPrice: number): CalcOutcome {
  if (!isCount(unitsSold) || !isCount(sellingPrice)) {
    return na('Enter units sold and the selling price.');
  }
  return ok(round(unitsSold * sellingPrice));
}

/** Average transaction value: `revenue ÷ transactions`. */
export function averageTransactionValue(revenue: number, transactions: number): CalcOutcome {
  if (!isCount(revenue) || !isCount(transactions)) {
    return na('Enter the revenue and the number of transactions.');
  }
  if (transactions === 0) {
    return na('Average transaction value is undefined when there are no transactions.');
  }
  return ok(round(revenue / transactions, 2));
}

/** Units sold per day: `units ÷ days`. */
export function unitsSoldPerDay(unitsSold: number, days: number): CalcOutcome {
  if (!isCount(unitsSold) || !isCount(days)) {
    return na('Enter the units sold and the number of days.');
  }
  if (days === 0) {
    return na('Units per day is undefined for a period of zero days.');
  }
  return ok(round(unitsSold / days, 2), 'units/day');
}

/** Sales growth: `(current − previous) ÷ previous × 100`. */
export function salesGrowthPercent(previousSales: number, currentSales: number): CalcOutcome {
  if (!isCount(previousSales) || !isCount(currentSales)) {
    return na('Enter the previous and current sales figures.');
  }
  if (previousSales === 0) {
    return na('Growth is undefined when the previous period had no sales.');
  }
  return ok(round(((currentSales - previousSales) / previousSales) * 100, 2), '%');
}

/**
 * Units required to reach a target profit:
 * `(fixed costs + target profit) ÷ (selling price − variable cost)`.
 */
export function unitsForTargetProfit(
  fixedCosts: number,
  targetProfit: number,
  sellingPrice: number,
  variableCostPerUnit: number,
): CalcOutcome {
  if (!isCount(fixedCosts) || !isCount(targetProfit) || !isCount(sellingPrice) || !isCount(variableCostPerUnit)) {
    return na('Enter fixed costs, target profit, selling price and variable cost per unit.');
  }
  const contribution = sellingPrice - variableCostPerUnit;
  if (contribution <= 0) {
    return na('The target is unreachable: the contribution per unit is zero or negative.');
  }
  return ok(Math.ceil((fixedCosts + targetProfit) / contribution), 'units');
}

/**
 * Sales forecast from the historical daily average:
 * `average daily sales × days`. This is arithmetic on recorded demand — not a
 * trained forecast model — and the UI labels it as such.
 */
export function forecastUnits(averageDailySales: number, days: number): CalcOutcome {
  if (!isCount(averageDailySales) || !isCount(days)) {
    return na('Enter the average daily sales and the number of days.');
  }
  return ok(Math.round(averageDailySales * days), 'units');
}

/** Revenue after a discount: `units × selling price × (1 − discount ÷ 100)`. */
export function revenueAfterDiscount(
  unitsSold: number,
  sellingPrice: number,
  discountPercent: number,
): CalcOutcome {
  if (!isCount(unitsSold) || !isCount(sellingPrice)) {
    return na('Enter units sold and the selling price.');
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return na('A discount must be between 0% and 100%.');
  }
  return ok(round(unitsSold * sellingPrice * (1 - discountPercent / 100)));
}

/* ------------------------------------------------------------------ *
 * E. Expiry & waste calculators
 * ------------------------------------------------------------------ */

/** Estimated unsold units before expiry: `max(0, stock − forecast demand)`. */
export function unsoldBeforeExpiry(currentQuantity: number, forecastDemand: number): CalcOutcome {
  if (!isCount(currentQuantity) || !isCount(forecastDemand)) {
    return na('Enter the current quantity and the forecast demand before expiry.');
  }
  return ok(round(Math.max(0, currentQuantity - forecastDemand), 2), 'units');
}

/** Purchase cost at risk: `estimated unsold units × purchase cost per unit`. */
export function purchaseCostAtRisk(unsoldUnits: number, unitCost: number): CalcOutcome {
  if (!isCount(unsoldUnits) || !isCount(unitCost)) {
    return na('Enter the unsold units and the purchase cost per unit.');
  }
  return ok(round(unsoldUnits * unitCost));
}

/** Potential revenue at risk: `estimated unsold units × selling price`. */
export function revenueAtRisk(unsoldUnits: number, sellingPrice: number): CalcOutcome {
  if (!isCount(unsoldUnits) || !isCount(sellingPrice)) {
    return na('Enter the unsold units and the selling price.');
  }
  return ok(round(unsoldUnits * sellingPrice));
}

/**
 * The largest discount that still keeps the price at or above purchase cost —
 * the markdown ceiling when the goal is to clear stock without selling at a loss.
 */
export function discountBeforeLoss(sellingPrice: number, unitCost: number): CalcOutcome {
  if (!isCount(sellingPrice) || !isCount(unitCost)) {
    return na('Enter the selling price and the purchase cost.');
  }
  if (sellingPrice === 0) {
    return na('A discount cannot be calculated from a selling price of zero.');
  }
  if (unitCost >= sellingPrice) {
    return na('The purchase cost already equals or exceeds the selling price, so any discount sells at a loss.');
  }
  return ok(round(((sellingPrice - unitCost) / sellingPrice) * 100, 2), '% off');
}

export interface LossReduction {
  lossWithoutDiscount: number | null;
  lossWithDiscount: number | null;
  reduction: number | null;
  message: string | null;
}

/**
 * How much of the at-risk cost a markdown is estimated to recover, given the
 * extra units the user expects to sell because of it. The uplift is an input,
 * never an assumption made by the app.
 */
export function lossReductionFromDiscount(input: {
  atRiskUnits: number;
  unitCost: number;
  extraUnitsSold: number;
}): LossReduction {
  const { atRiskUnits, unitCost, extraUnitsSold } = input;
  if (!isCount(atRiskUnits) || !isCount(unitCost) || !isCount(extraUnitsSold)) {
    return {
      lossWithoutDiscount: null,
      lossWithDiscount: null,
      reduction: null,
      message: 'Enter the at-risk units, the purchase cost and the extra units you expect to sell.',
    };
  }
  const covered = Math.min(extraUnitsSold, atRiskUnits);
  const withoutDiscount = round(atRiskUnits * unitCost);
  const withDiscount = round((atRiskUnits - covered) * unitCost);
  return {
    lossWithoutDiscount: withoutDiscount,
    lossWithDiscount: withDiscount,
    reduction: round(withoutDiscount - withDiscount),
    message:
      extraUnitsSold > atRiskUnits
        ? 'More units were entered than are at risk, so the recovery is capped at the at-risk quantity.'
        : null,
  };
}

/** Waste percentage: `waste units ÷ total units × 100`. */
export function wastePercent(wasteUnits: number, totalUnits: number): CalcOutcome {
  if (!isCount(wasteUnits) || !isCount(totalUnits)) {
    return na('Enter the wasted units and the total units.');
  }
  if (totalUnits === 0) {
    return na('Waste percentage is undefined when total units are zero.');
  }
  return ok(round((wasteUnits / totalUnits) * 100, 2), '%');
}

/** Expiry recovery rate: `recovered value ÷ value at risk × 100`. */
export function expiryRecoveryRate(recoveredValue: number, valueAtRisk: number): CalcOutcome {
  if (!isCount(recoveredValue) || !isCount(valueAtRisk)) {
    return na('Enter the recovered value and the value at risk.');
  }
  if (valueAtRisk === 0) {
    return na('Recovery rate is undefined when the value at risk is zero.');
  }
  return ok(round((recoveredValue / valueAtRisk) * 100, 2), '%');
}

/* ------------------------------------------------------------------ *
 * F. General calculators
 * ------------------------------------------------------------------ */

/** Percentage of a value: `value × percent ÷ 100`. */
export function percentOf(value: number, percent: number): CalcOutcome {
  if (!Number.isFinite(value) || !Number.isFinite(percent)) {
    return na('Enter a value and a percentage.');
  }
  return ok(round((value * percent) / 100, 4));
}

/** Percentage increase or decrease from one value to another. */
export function percentChange(fromValue: number, toValue: number): CalcOutcome {
  if (!Number.isFinite(fromValue) || !Number.isFinite(toValue)) {
    return na('Enter both values.');
  }
  if (fromValue === 0) {
    return na('Percentage change is undefined when the starting value is zero.');
  }
  return ok(round(((toValue - fromValue) / fromValue) * 100, 2), '%');
}

/** Simplifies a ratio to its lowest whole numbers. */
export function simplifyRatio(left: number, right: number): { left: number; right: number } | null {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
  if (!Number.isInteger(left) || !Number.isInteger(right)) return null;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(left, right) || 1;
  return { left: left / divisor, right: right / divisor };
}

export interface UnitPriceComparison {
  pricePerUnitA: number;
  pricePerUnitB: number;
  cheaper: 'A' | 'B' | 'equal';
  message: string | null;
}

/** Compares two pack sizes by price per unit so packs can be compared fairly. */
export function compareUnitPrices(
  packA: { price: number; quantity: number },
  packB: { price: number; quantity: number },
): UnitPriceComparison | null {
  if (
    !isCount(packA.price) ||
    !isCount(packB.price) ||
    !isCount(packA.quantity) ||
    !isCount(packB.quantity) ||
    packA.quantity === 0 ||
    packB.quantity === 0
  ) {
    return null;
  }
  const pricePerUnitA = round(packA.price / packA.quantity, 4);
  const pricePerUnitB = round(packB.price / packB.quantity, 4);
  return {
    pricePerUnitA,
    pricePerUnitB,
    cheaper: pricePerUnitA === pricePerUnitB ? 'equal' : pricePerUnitA < pricePerUnitB ? 'A' : 'B',
    message: null,
  };
}

/** Calendar days between two ISO dates, counting the earlier date as day zero. */
export function dateDifferenceDays(fromISO: string, toISO: string): CalcOutcome {
  const from = daysUntil(fromISO, new Date(1970, 0, 1));
  if (from === null) return na('Enter a valid ISO start date (YYYY-MM-DD).');
  const to = daysUntil(toISO, new Date(1970, 0, 1));
  if (to === null) return na('Enter a valid ISO end date (YYYY-MM-DD).');
  return ok(to - from, 'days');
}

export type ArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide';

/** Plain arithmetic, reporting division by zero instead of returning Infinity. */
export function arithmetic(a: number, operator: ArithmeticOperator, b: number): CalcOutcome {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return na('Enter two numbers.');
  }
  switch (operator) {
    case 'add':
      return ok(round(a + b, 6));
    case 'subtract':
      return ok(round(a - b, 6));
    case 'multiply':
      return ok(round(a * b, 6));
    case 'divide':
      if (b === 0) return na('Division by zero is not defined.');
      return ok(round(a / b, 6));
    default:
      return na('Choose an operation.');
  }
}

/** Days of inventory held: `365 ÷ stock turnover ratio`. */
export function daysOfInventoryHeld(turnoverRatio: number): CalcOutcome {
  if (!Number.isFinite(turnoverRatio)) {
    return na('A stock turnover ratio is needed first.');
  }
  if (turnoverRatio <= 0) {
    return na('Days of inventory is undefined when the turnover ratio is zero.');
  }
  return ok(round(365 / turnoverRatio, 1), 'days');
}

/** Days until an expiry date, using the same calendar-day rule as the app. */
export function daysUntilExpiry(expiryISO: string, today: Date = new Date()): CalcOutcome {
  const days = daysUntil(expiryISO, today);
  if (days === null) return na('Enter a valid expiry date (YYYY-MM-DD).');
  return ok(days, 'days');
}

/* ------------------------------------------------------------------ *
 * Live inventory aggregation
 * ------------------------------------------------------------------ */

export interface InventoryValueSummary {
  productCount: number;
  unitsInStock: number;
  /** Purchase value of everything on hand, from products that record a cost. */
  purchaseValue: number;
  /** Selling value of everything on hand, from products that record a price. */
  sellingValue: number;
  /** Selling value minus purchase value for products that record both. */
  potentialGrossProfit: number;
  /** Products counting towards `purchaseValue` / `sellingValue`. */
  costedProducts: number;
  pricedProducts: number;
  missingCost: number;
  missingPrice: number;
  /** Stock that is not selling at all (zero recorded daily sales). */
  deadStockUnits: number;
  deadStockValue: number;
  /** Units short of the reorder suggestion, valued at purchase cost. */
  shortageUnits: number;
  shortageValue: number;
  /** Units expected to remain when the nearest expiry arrives. */
  atRiskUnits: number;
  atRiskCost: number;
  atRiskRevenue: number;
  atRiskProducts: number;
  /** Products with an expiry date inside the configured threshold, including expired. */
  nearExpiryProducts: number;
}

/**
 * Derives the live inventory figures the calculator's dashboard shows.
 * Values are only summed where the product records the needed input; the
 * missing-input counts are reported alongside so a partial total is never
 * presented as complete.
 */
export function summarizeInventory(
  products: Product[],
  settings: Pick<Settings, 'expiryThreshold' | 'safetyBufferDays'>,
  today: Date = new Date(),
): InventoryValueSummary {
  const summary: InventoryValueSummary = {
    productCount: products.length,
    unitsInStock: 0,
    purchaseValue: 0,
    sellingValue: 0,
    potentialGrossProfit: 0,
    costedProducts: 0,
    pricedProducts: 0,
    missingCost: 0,
    missingPrice: 0,
    deadStockUnits: 0,
    deadStockValue: 0,
    shortageUnits: 0,
    shortageValue: 0,
    atRiskUnits: 0,
    atRiskCost: 0,
    atRiskRevenue: 0,
    atRiskProducts: 0,
    nearExpiryProducts: 0,
  };

  for (const product of products) {
    const cost = product.unitCost;
    const price = product.sellingPrice;
    const hasCost = typeof cost === 'number' && Number.isFinite(cost);
    const hasPrice = typeof price === 'number' && Number.isFinite(price);

    summary.unitsInStock += product.currentStock;

    if (hasCost) {
      summary.costedProducts += 1;
      summary.purchaseValue += cost * product.currentStock;
    } else {
      summary.missingCost += 1;
    }
    if (hasPrice) {
      summary.pricedProducts += 1;
      summary.sellingValue += price * product.currentStock;
    } else {
      summary.missingPrice += 1;
    }
    if (hasCost && hasPrice) {
      summary.potentialGrossProfit += (price - cost) * product.currentStock;
    }

    if (product.averageDailySales <= 0 && product.currentStock > 0) {
      summary.deadStockUnits += product.currentStock;
      if (hasCost) summary.deadStockValue += cost * product.currentStock;
    }

    const reorder = reorderQuantityFromProduct(product, settings.safetyBufferDays);
    if (reorder > 0) {
      summary.shortageUnits += reorder;
      if (hasCost) summary.shortageValue += reorder * cost;
    }

    const daysRemaining = daysUntil(product.expiryDate, today);
    if (daysRemaining !== null) {
      const isNear = daysRemaining <= settings.expiryThreshold;
      if (isNear) summary.nearExpiryProducts += 1;
      // Expired stock is fully at risk; otherwise only the units expected to
      // remain once the shelf life runs out.
      const sellableWindow = Math.max(0, daysRemaining);
      const expectedSold = product.averageDailySales * sellableWindow;
      const atRisk = Math.max(0, product.currentStock - expectedSold);
      if (atRisk > 0) {
        summary.atRiskProducts += 1;
        summary.atRiskUnits += atRisk;
        if (hasCost) summary.atRiskCost += atRisk * cost;
        if (hasPrice) summary.atRiskRevenue += atRisk * price;
      }
    }
  }

  summary.purchaseValue = round(summary.purchaseValue);
  summary.sellingValue = round(summary.sellingValue);
  summary.potentialGrossProfit = round(summary.potentialGrossProfit);
  summary.deadStockValue = round(summary.deadStockValue);
  summary.shortageValue = round(summary.shortageValue);
  summary.atRiskUnits = round(summary.atRiskUnits, 2);
  summary.atRiskCost = round(summary.atRiskCost);
  summary.atRiskRevenue = round(summary.atRiskRevenue);

  return summary;
}
