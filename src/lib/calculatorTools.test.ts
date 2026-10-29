import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSeedProducts } from '../data/seed';
import {
  CALCULATOR_TOOLS,
  CATEGORY_ORDER,
  applyPrefill,
  defaultValues,
  prefillContext,
  toolsForCategory,
} from './calculatorTools';

const TODAY = new Date(2026, 9, 25);
const products = createSeedProducts(TODAY, '2026-10-25T08:00:00.000Z');
const milk = products[0];

describe('calculator tool registry', () => {
  it('has unique ids and covers every declared category', () => {
    const ids = CALCULATOR_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of CATEGORY_ORDER) {
      expect(toolsForCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('gives every tool a name, a description and a stated formula', () => {
    for (const tool of CALCULATOR_TOOLS) {
      expect(tool.name.length).toBeGreaterThan(2);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.formula.length).toBeGreaterThan(5);
      expect(tool.inputs.length).toBeGreaterThan(0);
    }
  });

  it('produces a labelled result for every output with the default inputs', () => {
    for (const tool of CALCULATOR_TOOLS) {
      const outputs = tool.compute(defaultValues(tool));
      expect(outputs.length, `${tool.id} produced no outputs`).toBeGreaterThan(0);
      for (const output of outputs) {
        expect(output.label.length).toBeGreaterThan(2);
        // Every row must either carry a number, explain why it cannot, or show text.
        const hasContent =
          output.value !== null || output.message !== null || (output.text ?? '').length > 0;
        expect(hasContent, `${tool.id} → "${output.label}" is empty`).toBe(true);
      }
    }
  });

  it('returns a real number for every numeric tool', () => {
    // These two report a shape rather than an amount, so a number is not expected.
    const textOnly = new Set(['ratio']);
    for (const tool of CALCULATOR_TOOLS) {
      if (tool.inputs.some((input) => input.type === 'date')) continue;
      if (textOnly.has(tool.id)) continue;
      const outputs = tool.compute(defaultValues(tool));
      expect(
        outputs.some((output) => output.value !== null),
        `${tool.id} produced no numeric result`,
      ).toBe(true);
    }
  });

  it('never throws for empty, blank or negative input', () => {
    for (const tool of CALCULATOR_TOOLS) {
      const blank = tool.inputs.reduce<Record<string, string>>((acc, input) => {
        acc[input.key] = '';
        return acc;
      }, {});
      expect(() => tool.compute(blank), `${tool.id} threw on blank input`).not.toThrow();
      const negative = tool.inputs.reduce<Record<string, number>>((acc, input) => {
        acc[input.key] = -5;
        return acc;
      }, {});
      expect(() => tool.compute(negative), `${tool.id} threw on negative input`).not.toThrow();
    }
  });

  it('prefills a tool from an inventory product without touching other inputs', () => {
    const tool = CALCULATOR_TOOLS.find((entry) => entry.id === 'reorder-quantity')!;
    const context = prefillContext(DEFAULT_SETTINGS, TODAY);
    const applied = applyPrefill(tool, defaultValues(tool), milk, context);
    expect(applied.stock).toBe(8);
    expect(applied.averageDailySales).toBe(12);
    expect(applied.leadTimeDays).toBe(1);
    expect(applied.safetyDays).toBe(2);
    const outputs = tool.compute(applied);
    expect(outputs[0].value).toBe(28);
  });

  it('prefills the expiry tool with the real days remaining', () => {
    const tool = CALCULATOR_TOOLS.find((entry) => entry.id === 'expiry-at-risk')!;
    const juice = products.find((product) => product.sku === 'R104')!;
    const applied = applyPrefill(tool, defaultValues(tool), juice, prefillContext(DEFAULT_SETTINGS, TODAY));
    expect(applied.daysUntilExpiry).toBe(2);
    expect(applied.stock).toBe(30);
    expect(applied.sellingPrice).toBe(100);
    const outputs = tool.compute(applied);
    expect(outputs.find((output) => output.label === 'Estimated unsold units')?.value).toBe(24);
  });

  it('leaves the default in place when the product does not record a value', () => {
    const tool = CALCULATOR_TOOLS.find((entry) => entry.id === 'inventory-value')!;
    const withoutCost = { ...milk, unitCost: null };
    const applied = applyPrefill(tool, defaultValues(tool), withoutCost, prefillContext(DEFAULT_SETTINGS, TODAY));
    expect(applied.unitCost).toBe(62); // the tool's own default, not a fabricated number
    expect(applied.sellingPrice).toBe(70);
  });

  it('only offers product prefill on tools that opt in', () => {
    for (const tool of CALCULATOR_TOOLS) {
      const hasPrefillInput = tool.inputs.some((input) => input.fromProduct);
      if (hasPrefillInput) expect(tool.prefill).toBe(true);
    }
  });
});
