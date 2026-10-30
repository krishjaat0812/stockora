import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSeedProducts } from '../data/seed';
import {
  barcodeAssignmentError,
  barcodeConflict,
  barcodeFormatError,
  eanCheckDigit,
  findProductByBarcode,
  hasValidRetailChecksum,
  isValidBarcode,
  normalizeAltBarcodes,
  normalizeBarcode,
  productBarcodes,
} from './barcode';
import { validateProductInput, type ProductFormValues } from './validation';
import type { Product, ProductInput } from '../types';

const TODAY = new Date(2026, 9, 25);
const products = createSeedProducts(TODAY, '2026-10-25T08:00:00.000Z');

function productFrom(product: Product): ProductInput {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = product;
  return input;
}

describe('barcode format rules', () => {
  it('normalises scanner whitespace without changing case', () => {
    expect(normalizeBarcode('  8901234000014 ')).toBe('8901234000014');
    expect(normalizeBarcode('AB 12 34')).toBe('AB1234');
    expect(normalizeBarcode(null)).toBe('');
  });

  it('accepts retail and supplier codes, rejects junk', () => {
    expect(barcodeFormatError('8901234000014')).toBeNull();
    expect(barcodeFormatError('')).toBeNull(); // optional field
    expect(barcodeFormatError('ABC-123_x')).toBeNull();
    expect(barcodeFormatError('123')).toMatch(/at least/i);
    expect(barcodeFormatError('12$34')).toMatch(/only contain/i);
    expect(barcodeFormatError('x'.repeat(65))).toMatch(/at most/i);
    expect(isValidBarcode('8901234000014')).toBe(true);
    expect(isValidBarcode('')).toBe(false);
  });

  it('validates retail check digits but never requires them', () => {
    expect(eanCheckDigit('400638133393')).toBe(1); // 4006381333931 is a valid EAN-13
    expect(hasValidRetailChecksum('4006381333931')).toBe(true);
    expect(hasValidRetailChecksum('4006381333932')).toBe(false);
    expect(hasValidRetailChecksum('ABC123')).toBeNull(); // not a GTIN — not applicable
    // A store-internal 13-digit code with a bad checksum is still accepted.
    expect(barcodeFormatError('1234567890123')).toBeNull();
  });

  it('seeded demo products carry scannable EAN-13 codes', () => {
    for (const product of products) {
      expect(product.barcode).toBeTruthy();
      expect(hasValidRetailChecksum(product.barcode!)).toBe(true);
    }
  });
});

describe('barcode lookup inside one tenant', () => {
  it('finds the product for a known barcode', () => {
    const found = findProductByBarcode(products, '8901234000014');
    expect(found?.sku).toBe('R101');
  });

  it('finds products by alternative barcode as well', () => {
    const withAlt: Product = { ...products[0], altBarcodes: ['4006381333931'] };
    const list = [withAlt, ...products.slice(1)];
    expect(findProductByBarcode(list, '4006381333931')?.sku).toBe('R101');
    expect(findProductByBarcode(list, '8901234000014')?.sku).toBe('R101');
  });

  it('returns nothing for an unknown barcode (no product is invented)', () => {
    expect(findProductByBarcode(products, '0000000000000')).toBeUndefined();
    expect(findProductByBarcode(products, '')).toBeUndefined();
  });

  it('never sees another tenant’s barcode', () => {
    // A second shop with its own product list — lookups only take one list.
    const otherShop: Product[] = [
      {
        ...products[0],
        id: 'other-1',
        sku: 'X1',
        name: 'Other shop milk',
        barcode: '1111111111116',
      },
    ];
    expect(findProductByBarcode(products, '1111111111116')).toBeUndefined();
    expect(findProductByBarcode(otherShop, '8901234000014')).toBeUndefined();
    expect(findProductByBarcode(otherShop, '1111111111116')?.id).toBe('other-1');
  });

  it('reports the product that already owns a barcode', () => {
    const conflict = barcodeConflict(products, '8901234000021');
    expect(conflict?.sku).toBe('R102');
    expect(barcodeConflict(products, '8901234000014', products[0].id)).toBeUndefined();
    expect(barcodeAssignmentError(products, '8901234000021')).toMatch(/already belongs to Rice 5kg \(R102\)/);
    expect(barcodeAssignmentError(products, '8901234999999')).toBeNull();
  });

  it('exposes every barcode a product answers to', () => {
    const product: Product = { ...products[0], altBarcodes: ['4006381333931', ' 4006381333931 '] };
    expect(productBarcodes(product)).toEqual(['8901234000014', '4006381333931']);
    // Case is preserved (Code 128 is case-sensitive) but whitespace is trimmed.
    expect(normalizeAltBarcodes([' a1 ', 'A1 ', 'b2'])).toEqual(['a1', 'A1', 'b2']);
  });
});

describe('barcode assignment validation (form + server share this)', () => {
  const formValues: ProductFormValues = {
    sku: 'R301',
    name: 'New product',
    category: 'Test',
    currentStock: '10',
    reorderLevel: '2',
    averageDailySales: '1',
    leadTimeDays: '1',
    expiryDate: '',
    supplierName: '',
    supplierId: '',
    unit: '',
    unitCost: '',
    sellingPrice: '50',
    barcode: '8901234000021', // already used by Rice 5kg
    altBarcodes: '',
    taxRatePct: '5',
    allowFractional: false,
    active: true,
  };

  it('rejects a barcode that belongs to another product in the same shop', () => {
    const input = { ...productFrom(products[0]), ...stripForm(formValues) };
    const errors = validateProductInput(input, { products });
    expect(errors.barcode).toMatch(/already belongs to Rice 5kg/i);
  });

  it('accepts a unique barcode and normalises it', () => {
    const input = { ...productFrom(products[0]), ...stripForm(formValues), barcode: ' 8901234000090 ' };
    const errors = validateProductInput(input, { products });
    expect(errors.barcode).toBeUndefined();
  });

  it('rejects an alternative barcode that collides with another product', () => {
    const input = {
      ...productFrom(products[0]),
      ...stripForm(formValues),
      barcode: null,
      altBarcodes: ['8901234000038'],
    };
    const errors = validateProductInput(input, { products });
    expect(errors.altBarcodes).toMatch(/already belongs to Bread/i);
  });

  it('rejects an alternative barcode equal to the primary one', () => {
    const input = {
      ...productFrom(products[0]),
      ...stripForm(formValues),
      barcode: '8901234000090',
      altBarcodes: ['8901234000090'],
    };
    const errors = validateProductInput(input, { products });
    expect(errors.altBarcodes).toMatch(/different from the primary/i);
  });

  it('lets a product keep its own barcode while editing', () => {
    const milk = products[0];
    const errors = validateProductInput(
      { ...productFrom(milk) },
      { products, editingId: milk.id },
    );
    expect(errors.barcode).toBeUndefined();
  });

  it('rejects malformed barcodes', () => {
    const badBarcode = validateProductInput(
      { ...productFrom(products[0]), barcode: '12$34' },
      { products },
    );
    expect(badBarcode.barcode).toMatch(/only contain/i);
  });
});

/** Splits form strings into the typed ProductInput shape the form produces. */
function stripForm(values: ProductFormValues): Partial<ProductInput> {
  return {
    sku: values.sku,
    name: values.name,
    category: values.category,
    currentStock: Number(values.currentStock),
    reorderLevel: Number(values.reorderLevel),
    averageDailySales: Number(values.averageDailySales),
    leadTimeDays: Number(values.leadTimeDays),
    expiryDate: null,
    sellingPrice: Number(values.sellingPrice),
    barcode: values.barcode,
    altBarcodes: values.altBarcodes ? [values.altBarcodes] : [],
    taxRatePct: Number(values.taxRatePct),
    active: true,
    allowFractional: false,
  };
}

// Keep the default settings import meaningful for future barcode-related
// settings checks (e.g. per-shop code prefixes).
void DEFAULT_SETTINGS;
