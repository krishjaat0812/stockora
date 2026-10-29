import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSeedProducts } from '../data/seed';
import { reorderQuantity } from './inventory';
import {
  breakEvenSales,
  breakEvenUnits,
  compareSupplierQuotes,
  compareUnitPrices,
  contributionMarginRatio,
  dateDifferenceDays,
  daysOfStockRemaining,
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
  purchaseDiscount,
  purchaseOrderTotal,
  revenueAfterDiscount,
  revenueAtRisk,
  safetyStockUnits,
  salesGrowthPercent,
  simplifyRatio,
  stockShortageValue,
  stockTurnoverRatio,
  suggestedReorderQuantity,
  summarizeInventory,
  unitProfit,
  unitsForTargetProfit,
  unsoldBeforeExpiry,
  wastePercent,
} from './calculator';

const TODAY = new Date(2026, 9, 25);
const products = createSeedProducts(TODAY, '2026-10-25T08:00:00.000Z');

describe('A — inventory calculators', () => {
  it('values stock at purchase cost and at selling price', () => {
    expect(inventoryPurchaseValue(25, 420).value).toBe(10500);
    expect(potentialSellingValue(25, 485).value).toBe(12125);
    expect(potentialGrossProfit(25, 485, 420).value).toBe(1625);
  });

  it('rejects negative inputs instead of producing a number', () => {
    expect(inventoryPurchaseValue(-1, 10).value).toBeNull();
    expect(inventoryPurchaseValue(-1, 10).message).toMatch(/zero or more/i);
  });

  it('returns a validation message when the selling price is zero for margin', () => {
    const margin = grossProfitMargin(0, 40);
    expect(margin.value).toBeNull();
    expect(margin.message).toMatch(/undefined when the selling price is zero/i);
  });

  it('calculates margin and markup, guarding a zero purchase cost', () => {
    expect(grossProfitMargin(100, 60).value).toBe(40);
    expect(markupPercent(100, 60).value).toBeCloseTo(66.67, 1);
    const markup = markupPercent(100, 0);
    expect(markup.value).toBeNull();
    expect(markup.message).toMatch(/purchase cost is zero/i);
  });

  it('reports N/A for days of cover when daily sales are zero', () => {
    const cover = daysOfStockRemaining(30, 0);
    expect(cover.value).toBeNull();
    expect(cover.message).toMatch(/N\/A/i);
    expect(daysOfStockRemaining(30, 3).value).toBe(10);
  });

  it('matches the Reorder Planner formula exactly for every seeded product', () => {
    for (const product of products) {
      const result = suggestedReorderQuantity({
        averageDailySales: product.averageDailySales,
        leadTimeDays: product.leadTimeDays,
        safetyDays: DEFAULT_SETTINGS.safetyBufferDays,
        currentStock: product.currentStock,
      });
      expect(result.value).toBe(reorderQuantity(product, DEFAULT_SETTINGS.safetyBufferDays));
    }
    // and the documented worked example
    expect(
      suggestedReorderQuantity({
        averageDailySales: 12,
        leadTimeDays: 1,
        safetyDays: 2,
        currentStock: 8,
      }).value,
    ).toBe(28);
  });

  it('never returns a negative reorder quantity', () => {
    expect(
      suggestedReorderQuantity({
        averageDailySales: 2,
        leadTimeDays: 3,
        safetyDays: 2,
        currentStock: 25,
      }).value,
    ).toBe(0);
  });

  it('computes safety stock, turnover, carrying cost and dead/shortage values', () => {
    expect(safetyStockUnits(12, 2).value).toBe(24);
    expect(stockTurnoverRatio(120000, 20000).value).toBe(6);
    expect(stockTurnoverRatio(120000, 0).value).toBeNull();
    expect(inventoryCarryingCost(20000, 18).value).toBe(3600);
    expect(deadStockValue(40, 28).value).toBe(1120);
    expect(stockShortageValue(70, 62).value).toBe(4340);
  });
});

describe('B — profit & loss calculators', () => {
  it('calculates unit and gross profit', () => {
    expect(unitProfit(70, 62).value).toBe(8);
    expect(grossProfit(30, 100, 85).value).toBe(450);
  });

  it('estimates net profit and the expense ratio', () => {
    expect(netProfitEstimate(50000, 32000).value).toBe(18000);
    expect(operatingExpenseRatio(32000, 80000).value).toBe(40);
    expect(operatingExpenseRatio(32000, 0).value).toBeNull();
  });

  it('calculates break-even units and sales with safe guards', () => {
    expect(breakEvenUnits(50000, 100, 60).value).toBe(1250);
    expect(contributionMarginRatio(100, 60).value).toBe(40);
    expect(breakEvenSales(50000, 40).value).toBe(125000);
    const unreachable = breakEvenUnits(50000, 60, 60);
    expect(unreachable.value).toBeNull();
    expect(unreachable.message).toMatch(/zero or negative/i);
    expect(breakEvenSales(50000, 0).value).toBeNull();
  });

  it('applies a discount and reports the profit given up', () => {
    expect(discountedPrice(100, 25).value).toBe(75);
    expect(discountedPrice(100, 120).value).toBeNull();
    const impact = discountImpact({ units: 50, sellingPrice: 100, unitCost: 60, discountPercent: 20 });
    expect(impact.profitBefore).toBe(2000);
    expect(impact.profitAfter).toBe(1000);
    expect(impact.profitLost).toBe(1000);
    expect(impact.revenueAfter).toBe(4000);
    expect(impact.message).toBeNull();
  });

  it('warns when a discount sells below purchase cost', () => {
    const impact = discountImpact({ units: 10, sellingPrice: 100, unitCost: 90, discountPercent: 30 });
    expect(impact.profitAfter).toBe(-200);
    expect(impact.message).toMatch(/below purchase cost/i);
  });

  it('prices for a target margin', () => {
    expect(priceForTargetMargin(60, 40).value).toBe(100);
    expect(priceForTargetMargin(60, 100).value).toBeNull();
  });
});

describe('C — purchase & supplier calculators', () => {
  it('totals purchase order lines', () => {
    expect(
      purchaseOrderTotal([
        { quantity: 12, unitCost: 58 },
        { quantity: 5, unitCost: 240 },
      ]).value,
    ).toBe(1896);
    expect(purchaseOrderTotal([]).value).toBeNull();
  });

  it('applies a purchase discount', () => {
    const result = purchaseDiscount(10000, 7.5);
    expect(result.discountAmount).toBe(750);
    expect(result.netPayable).toBe(9250);
    expect(purchaseDiscount(10000, 150).message).toMatch(/between 0% and 100%/i);
  });

  it('converts between GST-inclusive and GST-exclusive prices', () => {
    expect(gstInclusive(100, 18).value).toBe(118);
    expect(gstExclusive(118, 18).value).toBe(100);
    expect(gstAmount(100, 18).value).toBe(18);
    // A rate is required — nothing is assumed.
    expect(gstInclusive(100, -1).value).toBeNull();
  });

  it('allocates freight into an effective unit cost', () => {
    expect(landedUnitCost(58, 240, 12).value).toBe(78);
    expect(landedUnitCost(58, 240, 0).value).toBeNull();
  });

  it('ranks supplier quotes on all-in cost', () => {
    const comparison = compareSupplierQuotes([
      { name: 'AgriMart', quantity: 100, unitCost: 50, shippingAndHandling: 500 },
      { name: 'SunHarvest', quantity: 100, unitCost: 52, shippingAndHandling: 0 },
    ]);
    expect(comparison.rows).toHaveLength(2);
    const cheapest = comparison.rows.filter((row) => row.cheapest);
    expect(cheapest).toHaveLength(1);
    expect(cheapest[0].name).toBe('SunHarvest');
    expect(comparison.rows.find((row) => row.name === 'AgriMart')?.effectiveUnitCost).toBe(55);
    expect(compareSupplierQuotes([{ name: 'Only one', quantity: 5, unitCost: 10 }]).rows).toHaveLength(0);
  });
});

describe('D — sales calculators', () => {
  it('calculates revenue, transaction value and units per day', () => {
    expect(revenueAfterDiscount(100, 50, 10).value).toBe(4500);
    expect(salesGrowthPercent(1000, 1250).value).toBe(25);
    expect(salesGrowthPercent(0, 1250).value).toBeNull();
  });

  it('sizes a sales target and forecasts from the daily average', () => {
    expect(unitsForTargetProfit(50000, 20000, 100, 60).value).toBe(1750);
    expect(unitsForTargetProfit(50000, 20000, 60, 60).value).toBeNull();
    expect(forecastUnits(12, 7).value).toBe(84);
  });
});

describe('E — expiry & waste calculators', () => {
  it('estimates unsold units and the value at risk', () => {
    expect(unsoldBeforeExpiry(30, 6).value).toBe(24);
    expect(unsoldBeforeExpiry(4, 10).value).toBe(0);
    expect(revenueAtRisk(24, 100).value).toBe(2400);
  });

  it('finds the markdown ceiling that still covers cost', () => {
    expect(discountBeforeLoss(100, 85).value).toBe(15);
    const alreadyLosing = discountBeforeLoss(100, 100);
    expect(alreadyLosing.value).toBeNull();
    expect(alreadyLosing.message).toMatch(/at a loss/i);
  });

  it('caps recovery at the at-risk quantity', () => {
    const result = lossReductionFromDiscount({ atRiskUnits: 10, unitCost: 85, extraUnitsSold: 25 });
    expect(result.reduction).toBe(850);
    expect(result.message).toMatch(/capped/i);
  });

  it('calculates waste and recovery rates', () => {
    expect(wastePercent(6, 40).value).toBe(15);
    expect(wastePercent(6, 0).value).toBeNull();
    expect(expiryRecoveryRate(1200, 2400).value).toBe(50);
  });
});

describe('F — general calculators', () => {
  it('handles percentages, ratios and unit prices', () => {
    expect(percentOf(240, 7.5).value).toBe(18);
    expect(percentChange(80, 60).value).toBe(-25);
    expect(percentChange(0, 60).value).toBeNull();
    expect(simplifyRatio(60, 45)).toEqual({ left: 4, right: 3 });
    expect(simplifyRatio(1.5, 3)).toBeNull();
    // 110/500 = 0.22 per unit beats 240/1000 = 0.24 per unit.
    const comparison = compareUnitPrices({ price: 110, quantity: 500 }, { price: 240, quantity: 1000 });
    expect(comparison?.cheaper).toBe('A');
    expect(comparison?.pricePerUnitA).toBeCloseTo(0.22, 4);
    expect(comparison?.pricePerUnitB).toBeCloseTo(0.24, 4);
    expect(compareUnitPrices({ price: 10, quantity: 0 }, { price: 10, quantity: 5 })).toBeNull();
  });

  it('calculates date differences and days until expiry', () => {
    expect(dateDifferenceDays('2026-10-25', '2026-11-04').value).toBe(10);
    expect(dateDifferenceDays('not-a-date', '2026-11-04').value).toBeNull();
    expect(daysUntilExpiry('2026-10-28', TODAY).value).toBe(3);
    expect(daysUntilExpiry('', TODAY).value).toBeNull();
  });
});

describe('live inventory summary', () => {
  const summary = summarizeInventory(products, DEFAULT_SETTINGS, TODAY);

  it('sums stock, purchase value and selling value from the seeded data', () => {
    expect(summary.productCount).toBe(6);
    expect(summary.unitsInStock).toBe(112);
    expect(summary.purchaseValue).toBe(15019);
    expect(summary.sellingValue).toBe(17520);
    expect(summary.potentialGrossProfit).toBe(2501);
    expect(summary.missingCost).toBe(0);
    expect(summary.missingPrice).toBe(0);
  });

  it('values the reorder shortfall and the stock at risk from expiry', () => {
    expect(summary.shortageUnits).toBe(70);
    expect(summary.shortageValue).toBe(3288);
    // Juice only: 30 units, 3/day for the 2 remaining days => 24 at risk.
    expect(summary.atRiskProducts).toBe(1);
    expect(summary.atRiskUnits).toBe(24);
    expect(summary.atRiskCost).toBe(2040);
    expect(summary.atRiskRevenue).toBe(2400);
    expect(summary.nearExpiryProducts).toBe(4);
  });

  it('counts stock that is not selling as dead stock', () => {
    expect(summary.deadStockUnits).toBe(0);
    const withDeadStock = summarizeInventory(
      [...products, { ...products[0], id: 'p-dead', sku: 'R900', averageDailySales: 0, currentStock: 10, unitCost: 20, sellingPrice: 30 }],
      DEFAULT_SETTINGS,
      TODAY,
    );
    expect(withDeadStock.deadStockUnits).toBe(10);
    expect(withDeadStock.deadStockValue).toBe(200);
  });

  it('reports missing inputs instead of pretending a total is complete', () => {
    const partial = summarizeInventory(
      [{ ...products[0], unitCost: null, sellingPrice: null }],
      DEFAULT_SETTINGS,
      TODAY,
    );
    expect(partial.purchaseValue).toBe(0);
    expect(partial.sellingValue).toBe(0);
    expect(partial.missingCost).toBe(1);
    expect(partial.missingPrice).toBe(1);
    expect(partial.potentialGrossProfit).toBe(0);
    expect(partial.unitsInStock).toBe(8);
  });

  it('treats expired stock as fully at risk', () => {
    const expired = summarizeInventory(
      [{ ...products[0], id: 'p-expired', expiryDate: '2026-10-20', currentStock: 5, averageDailySales: 1 }],
      DEFAULT_SETTINGS,
      TODAY,
    );
    expect(expired.atRiskUnits).toBe(5);
    expect(expired.atRiskCost).toBe(310);
  });
});
