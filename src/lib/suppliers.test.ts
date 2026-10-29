import { describe, expect, it } from 'vitest';
import type { Product, Supplier } from '../types';
import {
  EMPTY_SUPPLIER_FORM,
  filterSuppliers,
  supplierForProduct,
  supplierInitials,
  supplierStats,
  validateSupplierForm,
  validateSupplierInput,
} from './suppliers';

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    name: 'AgriMart Wholesale',
    contactName: 'Ravi Menon',
    email: 'orders@agrimart.example',
    phone: '+91 98290 11223',
    address: '12 Market Road',
    leadTimeDays: 3,
    paymentTerms: 'Net 15',
    notes: '',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'R102',
    name: 'Rice 5kg',
    category: 'Staples',
    currentStock: 4,
    reorderLevel: 8,
    averageDailySales: 2,
    leadTimeDays: 3,
    expiryDate: null,
    supplierName: 'AgriMart Wholesale',
    supplierId: 'sup-1',
    unitCost: 420,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('validateSupplierInput', () => {
  const base = {
    name: 'New Supplier',
    leadTimeDays: 2,
    active: true,
  };

  it('accepts a minimal supplier', () => {
    expect(validateSupplierInput(base, { suppliers: [] })).toEqual({});
  });

  it('requires a name and rejects duplicates (case-insensitive)', () => {
    expect(validateSupplierInput({ ...base, name: '  ' }, { suppliers: [] }).name).toBeDefined();
    expect(validateSupplierInput({ ...base, name: 'agrimart wholesale' }, { suppliers: [supplier()] }).name).toBeDefined();
    // Editing the same record does not count as a duplicate of itself.
    expect(
      validateSupplierInput({ ...base, name: 'AgriMart Wholesale' }, { suppliers: [supplier()], editingId: 'sup-1' }),
    ).toEqual({});
  });

  it('validates email and phone formats but allows them to be empty', () => {
    expect(validateSupplierInput({ ...base, email: 'not-an-email' }, { suppliers: [] }).email).toBeDefined();
    expect(validateSupplierInput({ ...base, email: 'buyer@shop.co.in' }, { suppliers: [] }).email).toBeUndefined();
    expect(validateSupplierInput({ ...base, phone: 'call me' }, { suppliers: [] }).phone).toBeDefined();
    expect(validateSupplierInput({ ...base, phone: '' }, { suppliers: [] }).phone).toBeUndefined();
  });

  it('requires a whole non-negative lead time within a year', () => {
    expect(validateSupplierInput({ ...base, leadTimeDays: -1 }, { suppliers: [] }).leadTimeDays).toBeDefined();
    expect(validateSupplierInput({ ...base, leadTimeDays: 1.5 }, { suppliers: [] }).leadTimeDays).toBeDefined();
    expect(validateSupplierInput({ ...base, leadTimeDays: 400 }, { suppliers: [] }).leadTimeDays).toBeDefined();
    expect(validateSupplierInput({ ...base, leadTimeDays: 0 }, { suppliers: [] }).leadTimeDays).toBeUndefined();
  });
});

describe('validateSupplierForm', () => {
  it('maps the form to an input and trims empty optional fields to undefined', () => {
    const result = validateSupplierForm(
      { ...EMPTY_SUPPLIER_FORM, name: '  DailyBake Ltd. ', leadTimeDays: '1', email: '' },
      { suppliers: [] },
    );
    expect(result.errors).toEqual({});
    expect(result.input).toMatchObject({ name: 'DailyBake Ltd.', leadTimeDays: 1, email: undefined });
  });

  it('returns null input and inline errors when the lead time is blank', () => {
    const result = validateSupplierForm({ ...EMPTY_SUPPLIER_FORM, name: 'X' }, { suppliers: [] });
    expect(result.input).toBeNull();
    expect(result.errors.leadTimeDays).toBeDefined();
  });
});

describe('filterSuppliers', () => {
  const list = [
    supplier(),
    supplier({
      id: 'sup-2',
      name: 'DailyBake Ltd.',
      contactName: 'Anita',
      email: 'hello@dailybake.example',
      phone: '+91 141 400 7788',
      active: false,
    }),
  ];

  it('matches name, contact, email and phone, case-insensitively', () => {
    expect(filterSuppliers(list, { query: 'agrimart' }).map((item) => item.id)).toEqual(['sup-1']);
    expect(filterSuppliers(list, { query: 'ANITA' }).map((item) => item.id)).toEqual(['sup-2']);
    expect(filterSuppliers(list, { query: '98290' }).map((item) => item.id)).toEqual(['sup-1']);
    expect(filterSuppliers(list, { query: 'nobody' })).toEqual([]);
  });

  it('filters by active status', () => {
    expect(filterSuppliers(list, { status: 'active' }).map((item) => item.id)).toEqual(['sup-1']);
    expect(filterSuppliers(list, { status: 'inactive' }).map((item) => item.id)).toEqual(['sup-2']);
    expect(filterSuppliers(list, { status: 'all' })).toHaveLength(2);
  });
});

describe('supplier-product relationship', () => {
  it('resolves by id first, then by legacy supplier name', () => {
    const suppliers = [supplier()];
    expect(supplierForProduct(product(), suppliers)?.id).toBe('sup-1');
    expect(supplierForProduct({ supplierId: null, supplierName: 'agrimart wholesale' }, suppliers)?.id).toBe('sup-1');
    expect(supplierForProduct({ supplierId: null, supplierName: 'Unknown' }, suppliers)).toBeUndefined();
  });

  it('summarises linked products without counting other suppliers', () => {
    const products = [
      product(),
      product({ id: 'p2', sku: 'R103', currentStock: 0, unitCost: 32, supplierId: 'sup-2', supplierName: 'DailyBake' }),
    ];
    const stats = supplierStats(supplier(), products);
    expect(stats.productCount).toBe(1);
    expect(stats.lowStockCount).toBe(1);
    expect(stats.outOfStockCount).toBe(0);
    expect(stats.stockValue).toBe(4 * 420);
    expect(stats.categories).toEqual(['Staples']);
  });
});

describe('supplierInitials', () => {
  it('builds a two-letter monogram', () => {
    expect(supplierInitials('AgriMart Wholesale')).toBe('AW');
    expect(supplierInitials('FreshPastures')).toBe('FR');
    expect(supplierInitials('   ')).toBe('?');
  });
});
