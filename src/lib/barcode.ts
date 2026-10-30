import type { Product } from '../types';

/**
 * Barcode rules shared by the browser and the Worker, so a barcode accepted
 * by the product form is the same one the POS lookup will find.
 *
 * Stockora deliberately does not require a specific symbology: retail shops
 * use EAN-13/UPC-A labels, in-house Code128 stickers and supplier codes alike.
 * The rules below therefore validate a safe, unambiguous character set and a
 * sensible length, and treat checksums as a *hint* for manual entry rather
 * than a hard rejection (internal codes often fail a retail checksum).
 *
 * A barcode is never interchangeable with the SKU: the SKU is Stockora's own
 * identifier, the barcode is what hardware reads, and a product may carry
 * several barcodes but exactly one SKU.
 */

export const BARCODE_MIN_LENGTH = 4;
export const BARCODE_MAX_LENGTH = 64;

/** Letters, digits and the separators that appear on printed labels. */
const BARCODE_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Normalises raw scanner/manual input: trims, drops the spaces some
 * keyboard-wedge scanners transmit around Code 39 values, and collapses
 * repeated separators. Case is preserved (Code 128 is case-sensitive).
 */
export function normalizeBarcode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/\s+/g, '');
}

/** Returns an error message when the barcode is not usable, otherwise null. */
export function barcodeFormatError(raw: string | null | undefined): string | null {
  const code = normalizeBarcode(raw);
  if (!code) return null; // absence is allowed (barcode is optional)
  if (code.length < BARCODE_MIN_LENGTH) {
    return `Barcode must be at least ${BARCODE_MIN_LENGTH} characters.`;
  }
  if (code.length > BARCODE_MAX_LENGTH) {
    return `Barcode must be at most ${BARCODE_MAX_LENGTH} characters.`;
  }
  if (!BARCODE_PATTERN.test(code)) {
    return 'Barcode may only contain letters, numbers, dots, dashes or underscores.';
  }
  return null;
}

export function isValidBarcode(raw: string | null | undefined): boolean {
  return barcodeFormatError(raw) === null && normalizeBarcode(raw).length > 0;
}

/**
 * GTIN/EAN check digit (mod-10). Used to offer a hint when a cashier types a
 * retail barcode by hand — never to reject a scanned or stored code, because
 * many shops use internal codes that are not GTINs.
 */
export function eanCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const weight = (digits.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when an 8/12/13-digit numeric code carries a valid check digit. */
export function hasValidRetailChecksum(code: string): boolean | null {
  const normalized = normalizeBarcode(code);
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(normalized)) return null; // not applicable
  const expected = eanCheckDigit(normalized.slice(0, -1));
  return expected === Number(normalized.slice(-1));
}

/** Normalises a list of alternative barcodes: trimmed, deduped, validated. */
export function normalizeAltBarcodes(raw: string[] | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const code = normalizeBarcode(entry);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

/** Every barcode a product is reachable by (primary + alternatives). */
export function productBarcodes(product: Product): string[] {
  const codes = [product.barcode ?? '', ...normalizeAltBarcodes(product.altBarcodes)];
  return codes.map(normalizeBarcode).filter(Boolean);
}

/**
 * Finds the product a barcode resolves to inside one tenant's product list.
 * The caller always passes the authenticated organisation's own products, so
 * a lookup can never cross tenants.
 */
export function findProductByBarcode(products: Product[], raw: string): Product | undefined {
  const code = normalizeBarcode(raw);
  if (!code) return undefined;
  const lower = code.toLowerCase();
  return products.find((product) =>
    productBarcodes(product).some((candidate) => candidate.toLowerCase() === lower),
  );
}

/**
 * Returns the product that already owns this barcode in the same shop, or
 * undefined when the code is free. `excludeProductId` skips the product
 * being edited.
 */
export function barcodeConflict(
  products: Product[],
  raw: string,
  excludeProductId?: string,
): Product | undefined {
  const code = normalizeBarcode(raw);
  if (!code) return undefined;
  const lower = code.toLowerCase();
  return products.find(
    (product) =>
      product.id !== excludeProductId &&
      productBarcodes(product).some((candidate) => candidate.toLowerCase() === lower),
  );
}

/**
 * Error message when assigning `raw` (a primary barcode or one alternative)
 * to a product would collide with another product in the same shop, which
 * would make checkout ambiguous. Null when the assignment is safe.
 */
export function barcodeAssignmentError(
  products: Product[],
  raw: string,
  excludeProductId?: string,
): string | null {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  const format = barcodeFormatError(code);
  if (format) return format;
  const conflict = barcodeConflict(products, code, excludeProductId);
  if (conflict) {
    return `Barcode ${code} already belongs to ${conflict.name} (${conflict.sku}). Barcodes must be unique in your shop.`;
  }
  return null;
}

/** True when any barcode of the product implies the product is sold. */
export function matchesProductQuery(product: Product, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (product.sku.toLowerCase().includes(needle)) return true;
  if (product.name.toLowerCase().includes(needle)) return true;
  if (product.category.toLowerCase().includes(needle)) return true;
  return productBarcodes(product).some((code) => code.toLowerCase().includes(needle));
}
