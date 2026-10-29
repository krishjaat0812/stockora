import { describe, expect, it } from 'vitest';
import type { ProductInput } from '../types';
import { createSeedProducts } from '../data/seed';
import { EMPTY_PRODUCT_FORM, productToForm, validateProductForm, validateProductInput } from './validation';

const products = createSeedProducts(new Date(2026, 9, 25), '2026-10-25T08:00:00.000Z');

const baseInput: ProductInput = {
  sku: 'R201',
  name: 'Butter 250g',
  category: 'Dairy & Chilled',
  currentStock: 12,
  reorderLevel: 6,
  averageDailySales: 3,
  leadTimeDays: 2,
  expiryDate: '2026-11-08',
  supplierName: 'FreshPastures',
  unit: 'pack',
  unitCost: 58,
};

describe('product input validation', () => {
  it('accepts a valid product', () => {
    expect(validateProductInput(baseInput, { products })).toEqual({});
  });

  it('rejects duplicate SKUs case-insensitively', () => {
    const errors = validateProductInput({ ...baseInput, sku: 'r101' }, { products });
    expect(errors.sku).toMatch(/already exists/i);
  });

  it('allows a product to keep its own SKU while editing', () => {
    const milk = products.find((product) => product.sku === 'R101')!;
    const errors = validateProductInput(
      { ...baseInput, sku: 'R101' },
      { products, editingId: milk.id },
    );
    expect(errors.sku).toBeUndefined();
  });

  it('rejects negative or fractional stock and reorder levels', () => {
    expect(validateProductInput({ ...baseInput, currentStock: -1 }, { products }).currentStock).toMatch(/negative/i);
    expect(validateProductInput({ ...baseInput, currentStock: 1.5 }, { products }).currentStock).toMatch(/whole number/i);
    expect(validateProductInput({ ...baseInput, reorderLevel: -2 }, { products }).reorderLevel).toMatch(/negative/i);
  });

  it('rejects negative sales and lead time but allows zero sales', () => {
    expect(validateProductInput({ ...baseInput, averageDailySales: -3 }, { products }).averageDailySales).toMatch(/negative/i);
    expect(validateProductInput({ ...baseInput, averageDailySales: 0 }, { products }).averageDailySales).toBeUndefined();
    expect(validateProductInput({ ...baseInput, leadTimeDays: -2 }, { products }).leadTimeDays).toMatch(/negative/i);
    expect(validateProductInput({ ...baseInput, leadTimeDays: 0 }, { products }).leadTimeDays).toBeUndefined();
  });

  it('rejects invalid dates and negative unit cost', () => {
    expect(validateProductInput({ ...baseInput, expiryDate: '2026-02-31' }, { products }).expiryDate).toMatch(/valid expiry date/i);
    expect(validateProductInput({ ...baseInput, unitCost: -5 }, { products }).unitCost).toMatch(/negative/i);
    expect(validateProductInput({ ...baseInput, expiryDate: null }, { products }).expiryDate).toBeUndefined();
  });

  it('requires name, category and a valid SKU format', () => {
    const errors = validateProductInput({ ...baseInput, sku: 'a b', name: '', category: '' }, { products });
    expect(errors.sku).toBeTruthy();
    expect(errors.name).toMatch(/required/i);
    expect(errors.category).toMatch(/required/i);
  });

  it('flags SKUs reserved by an in-file CSV import', () => {
    const errors = validateProductInput(baseInput, { products, extraSkus: ['r201'] });
    expect(errors.sku).toMatch(/already exists/i);
  });
});

describe('product form parsing', () => {
  const validForm = {
    ...EMPTY_PRODUCT_FORM,
    sku: ' r301 ',
    name: '  Oat Milk  ',
    category: ' Dairy ',
    currentStock: '7',
    reorderLevel: '5',
    averageDailySales: '2.5',
    leadTimeDays: '2',
    expiryDate: '',
  };

  it('normalises SKU and trimmed text, and leaves expiry empty', () => {
    const result = validateProductForm(validForm, { products });
    expect(result.errors).toEqual({});
    expect(result.input).toMatchObject({
      sku: 'R301',
      name: 'Oat Milk',
      category: 'Dairy',
      currentStock: 7,
      averageDailySales: 2.5,
      expiryDate: null,
    });
  });

  it('reports missing and non-numeric values', () => {
    const result = validateProductForm(
      { ...EMPTY_PRODUCT_FORM, sku: 'R302', name: 'Test', category: 'Test' },
      { products },
    );
    expect(result.input).toBeNull();
    expect(result.errors.currentStock).toBeTruthy();
    expect(result.errors.reorderLevel).toBeTruthy();
    expect(result.errors.averageDailySales).toBeTruthy();
    expect(result.errors.leadTimeDays).toBeTruthy();
  });

  it('rejects duplicate and invalid values through the form', () => {
    const result = validateProductForm(
      { ...validForm, sku: 'R101', currentStock: '-2', unitCost: 'free' },
      { products },
    );
    expect(result.input).toBeNull();
    expect(result.errors.sku).toMatch(/already exists/i);
    expect(result.errors.currentStock).toMatch(/negative/i);
    expect(result.errors.unitCost).toMatch(/valid number/i);
  });

  it('prefills the form from an existing product', () => {
    const milk = products[0];
    const form = productToForm(milk);
    expect(form.sku).toBe('R101');
    expect(form.expiryDate).toBe(milk.expiryDate);
    expect(form.unitCost).toBe('62');
  });
});
