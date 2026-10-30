import type { Product, ProductInput } from '../types';
import { isValidDateString } from './inventory';
import {
  barcodeConflict,
  barcodeFormatError,
  normalizeAltBarcodes,
  normalizeBarcode,
} from './barcode';

export interface ProductFormValues {
  sku: string;
  name: string;
  category: string;
  currentStock: string;
  reorderLevel: string;
  averageDailySales: string;
  leadTimeDays: string;
  expiryDate: string;
  supplierName: string;
  supplierId: string;
  unit: string;
  unitCost: string;
  sellingPrice: string;
  /** Primary barcode, or empty when the product has none. */
  barcode: string;
  /** Alternative barcodes as a comma-separated list. */
  altBarcodes: string;
  /** Tax rate percent as text, empty = not taxed. */
  taxRatePct: string;
  /** Sold by weight/measure — allows decimal quantities at the POS. */
  allowFractional: boolean;
  /** false = retained but not sellable at the POS. */
  active: boolean;
}

export type ProductFieldErrors = Partial<Record<keyof ProductFormValues, string>>;

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  sku: '',
  name: '',
  category: '',
  currentStock: '',
  reorderLevel: '',
  averageDailySales: '',
  leadTimeDays: '',
  expiryDate: '',
  supplierName: '',
  supplierId: '',
  unit: '',
  unitCost: '',
  sellingPrice: '',
  barcode: '',
  altBarcodes: '',
  taxRatePct: '',
  allowFractional: false,
  active: true,
};

export function productToForm(product: Product): ProductFormValues {
  return {
    sku: product.sku,
    name: product.name,
    category: product.category,
    currentStock: String(product.currentStock),
    reorderLevel: String(product.reorderLevel),
    averageDailySales: String(product.averageDailySales),
    leadTimeDays: String(product.leadTimeDays),
    expiryDate: product.expiryDate ?? '',
    supplierName: product.supplierName ?? '',
    supplierId: product.supplierId ?? '',
    unit: product.unit ?? '',
    unitCost:
      product.unitCost === null || product.unitCost === undefined ? '' : String(product.unitCost),
    sellingPrice:
      product.sellingPrice === null || product.sellingPrice === undefined
        ? ''
        : String(product.sellingPrice),
    barcode: product.barcode ?? '',
    altBarcodes: (product.altBarcodes ?? []).join(', '),
    taxRatePct:
      product.taxRatePct === null || product.taxRatePct === undefined
        ? ''
        : String(product.taxRatePct),
    allowFractional: product.allowFractional === true,
    active: product.active !== false,
  };
}

export function validateProductInput(
  input: ProductInput,
  options: { products: Product[]; editingId?: string; extraSkus?: string[] },
): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  const sku = input.sku.trim();
  const name = input.name.trim();
  const category = input.category.trim();

  if (!sku) {
    errors.sku = 'SKU is required.';
  } else if (!/^[A-Za-z0-9._-]{2,32}$/.test(sku)) {
    errors.sku = 'Use 2–32 letters, numbers, dots, dashes or underscores.';
  } else {
    const normalized = sku.toLowerCase();
    const taken = options.products.some(
      (product) =>
        product.id !== options.editingId && product.sku.trim().toLowerCase() === normalized,
    );
    const takenExtra = (options.extraSkus ?? []).some(
      (extra) => extra.trim().toLowerCase() === normalized,
    );
    if (taken || takenExtra) errors.sku = 'This SKU already exists. Choose a unique SKU.';
  }

  if (!name) errors.name = 'Product name is required.';
  else if (name.length > 80) errors.name = 'Keep the name under 80 characters.';

  if (!category) errors.category = 'Category is required.';
  else if (category.length > 40) errors.category = 'Keep the category under 40 characters.';

  if (!Number.isFinite(input.currentStock)) {
    errors.currentStock = 'Enter a stock quantity.';
  } else if (input.currentStock < 0) {
    errors.currentStock = 'Stock cannot be negative.';
  } else if (!Number.isInteger(input.currentStock)) {
    errors.currentStock = 'Stock must be a whole number.';
  }

  if (!Number.isFinite(input.reorderLevel)) {
    errors.reorderLevel = 'Enter a reorder level.';
  } else if (input.reorderLevel < 0) {
    errors.reorderLevel = 'Reorder level cannot be negative.';
  } else if (!Number.isInteger(input.reorderLevel)) {
    errors.reorderLevel = 'Reorder level must be a whole number.';
  }

  if (!Number.isFinite(input.averageDailySales)) {
    errors.averageDailySales = 'Enter average daily sales (0 is allowed).';
  } else if (input.averageDailySales < 0) {
    errors.averageDailySales = 'Average daily sales cannot be negative.';
  } else if (input.averageDailySales > 1_000_000) {
    errors.averageDailySales = 'Enter a realistic daily sales figure.';
  }

  if (!Number.isFinite(input.leadTimeDays)) {
    errors.leadTimeDays = 'Enter the supplier lead time.';
  } else if (input.leadTimeDays < 0) {
    errors.leadTimeDays = 'Lead time cannot be negative.';
  } else if (!Number.isInteger(input.leadTimeDays)) {
    errors.leadTimeDays = 'Lead time must be a whole number of days.';
  } else if (input.leadTimeDays > 365) {
    errors.leadTimeDays = 'Lead time must be 365 days or fewer.';
  }

  if (input.expiryDate && !isValidDateString(input.expiryDate)) {
    errors.expiryDate = 'Enter a valid expiry date (YYYY-MM-DD).';
  }

  if (
    input.unitCost !== null &&
    input.unitCost !== undefined &&
    (!Number.isFinite(input.unitCost) || input.unitCost < 0)
  ) {
    errors.unitCost = 'Unit cost cannot be negative.';
  }

  if (
    input.sellingPrice !== null &&
    input.sellingPrice !== undefined &&
    (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0)
  ) {
    errors.sellingPrice = 'Selling price cannot be negative.';
  }

  // ---- Barcodes: format + tenant-wide uniqueness (primary and alternatives)
  const barcode = normalizeBarcode(input.barcode);
  if (barcode) {
    const formatError = barcodeFormatError(barcode);
    if (formatError) {
      errors.barcode = formatError;
    } else {
      const conflict = barcodeConflict(options.products, barcode, options.editingId);
      if (conflict) {
        errors.barcode = `Barcode ${barcode} already belongs to ${conflict.name} (${conflict.sku}). Barcodes must be unique in your shop.`;
      }
    }
  }

  const altBarcodes = normalizeAltBarcodes(input.altBarcodes);
  for (const alt of altBarcodes) {
    const formatError = barcodeFormatError(alt);
    if (formatError) {
      errors.altBarcodes = `Alternative barcode "${alt}": ${formatError}`;
      break;
    }
    if (alt.toLowerCase() === barcode.toLowerCase()) {
      errors.altBarcodes = 'Alternative barcodes must be different from the primary barcode.';
      break;
    }
    const conflict = barcodeConflict(options.products, alt, options.editingId);
    if (conflict) {
      errors.altBarcodes = `Barcode ${alt} already belongs to ${conflict.name} (${conflict.sku}). Barcodes must be unique in your shop.`;
      break;
    }
  }

  if (
    input.taxRatePct !== null &&
    input.taxRatePct !== undefined &&
    (!Number.isFinite(input.taxRatePct) || input.taxRatePct < 0 || input.taxRatePct > 100)
  ) {
    errors.taxRatePct = 'Tax rate must be between 0 and 100 percent.';
  }

  return errors;
}

function parseNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  // Accept "1,2"? No: only plain decimals, to keep CSV predictable.
  return Number(trimmed);
}

export function validateProductForm(
  values: ProductFormValues,
  options: { products: Product[]; editingId?: string; extraSkus?: string[] },
): { errors: ProductFieldErrors; input: ProductInput | null } {
  const errors: ProductFieldErrors = {};

  const numericFields: Array<
    'currentStock' | 'reorderLevel' | 'averageDailySales' | 'leadTimeDays'
  > = ['currentStock', 'reorderLevel', 'averageDailySales', 'leadTimeDays'];
  for (const field of numericFields) {
    if (values[field].trim() === '') {
      errors[field] =
        field === 'averageDailySales'
          ? 'Enter average daily sales (0 is allowed).'
          : 'This field is required.';
    } else if (Number.isNaN(parseNumber(values[field]))) {
      errors[field] = 'Enter a valid number.';
    }
  }

  const unitCostRaw = values.unitCost.trim();
  let unitCost: number | null = null;
  if (unitCostRaw !== '') {
    const parsed = parseNumber(unitCostRaw);
    if (Number.isNaN(parsed)) errors.unitCost = 'Enter a valid number.';
    else unitCost = parsed;
  }

  const expiryRaw = values.expiryDate.trim();
  if (expiryRaw && !isValidDateString(expiryRaw)) {
    errors.expiryDate = 'Enter a valid expiry date.';
  }

  const sellingPriceRaw = values.sellingPrice.trim();
  let sellingPrice: number | null = null;
  if (sellingPriceRaw !== '') {
    const parsed = parseNumber(sellingPriceRaw);
    if (Number.isNaN(parsed)) errors.sellingPrice = 'Enter a valid number.';
    else sellingPrice = parsed;
  }

  const barcodeRaw = values.barcode.trim();
  const barcode = barcodeRaw === '' ? null : normalizeBarcode(barcodeRaw);

  const altBarcodes = normalizeAltBarcodes(
    values.altBarcodes
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  const taxRateRaw = values.taxRatePct.trim();
  let taxRatePct: number | null = null;
  if (taxRateRaw !== '') {
    const parsed = parseNumber(taxRateRaw);
    if (Number.isNaN(parsed)) errors.taxRatePct = 'Enter a valid tax rate.';
    else taxRatePct = parsed;
  }

  const input: ProductInput = {
    sku: values.sku.trim().toUpperCase(),
    name: values.name.trim(),
    category: values.category.trim(),
    currentStock: parseNumber(values.currentStock),
    reorderLevel: parseNumber(values.reorderLevel),
    averageDailySales: parseNumber(values.averageDailySales),
    leadTimeDays: parseNumber(values.leadTimeDays),
    expiryDate: expiryRaw || null,
    supplierName: values.supplierName.trim() || undefined,
    supplierId: values.supplierId.trim() || null,
    unit: values.unit.trim() || undefined,
    unitCost,
    sellingPrice,
    barcode,
    altBarcodes,
    taxRatePct,
    allowFractional: values.allowFractional === true,
    active: values.active !== false,
  };

  const merged = { ...validateProductInput(input, options) };
  for (const key of Object.keys(merged) as Array<keyof ProductFieldErrors>) {
    if (merged[key]) errors[key] = merged[key];
  }

  const hasErrors = Object.keys(errors).length > 0;
  return { errors, input: hasErrors ? null : input };
}
