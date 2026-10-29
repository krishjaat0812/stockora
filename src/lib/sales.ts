import type { Product, SaleRecord } from '../types';
import { buildCsv, parseCsvText, type CsvTable } from './csv';
import { todayISO } from './date';
import { parseISODate } from './date';

/**
 * Sales-history import. A shop exports (or transcribes) lines of
 * date + SKU + quantity (+ optional price) and Stockora turns them into an
 * append-only ledger used by demand analytics. Nothing is inferred: a row that
 * cannot be matched to a product is reported, never guessed.
 */

export interface SalesImportError {
  row: number;
  sku?: string;
  message: string;
}

export interface SalesImportSummary {
  valid: SaleRecord[];
  errors: SalesImportError[];
  totalRows: number;
  duplicates: number;
  /** Earliest sale date among the accepted rows. */
  earliest: string | null;
  fileError?: string;
}

export const SALES_TEMPLATE: CsvTable = {
  headers: ['date', 'sku', 'quantity', 'unit_price'],
  rows: [
    ['2026-01-04', 'R101', 12, 70],
    ['2026-01-04', 'R102', 2, 485],
    ['2026-01-05', 'R103', 9, 40],
  ],
};

export function salesTemplateCsv(): string {
  return buildCsv(SALES_TEMPLATE);
}

const HEADER_ALIASES: Record<string, 'date' | 'sku' | 'quantity' | 'unitprice'> = {
  date: 'date',
  soldat: 'date',
  saledate: 'date',
  transactiondate: 'date',
  day: 'date',
  sku: 'sku',
  productsku: 'sku',
  code: 'sku',
  productcode: 'sku',
  quantity: 'quantity',
  qty: 'quantity',
  units: 'quantity',
  unitssold: 'quantity',
  sold: 'quantity',
  unitprice: 'unitprice',
  price: 'unitprice',
  sellingprice: 'unitprice',
  rate: 'unitprice',
  mrp: 'unitprice',
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Stable identity for a sale line, used to skip re-imported duplicates. */
export function saleFingerprint(sale: Pick<SaleRecord, 'productId' | 'soldAt' | 'quantity' | 'unitPrice'>): string {
  return `${sale.productId}|${sale.soldAt}|${sale.quantity}|${sale.unitPrice ?? ''}`;
}

export function earliestSaleDate(sales: SaleRecord[]): string | null {
  return sales.reduce<string | null>(
    (earliest, sale) => (earliest === null || sale.soldAt < earliest ? sale.soldAt : earliest),
    null,
  );
}

export function parseSalesCsv(
  text: string,
  options: {
    products: Product[];
    existing: SaleRecord[];
    today?: Date;
    source?: SaleRecord['source'];
    makeId: () => string;
  },
): SalesImportSummary {
  const today = options.today ?? new Date();
  const todayIso = todayISO(today);
  const source = options.source ?? 'import';
  const summary: SalesImportSummary = {
    valid: [],
    errors: [],
    totalRows: 0,
    duplicates: 0,
    earliest: null,
  };

  if (text.length > 2_000_000) {
    summary.fileError = 'The file is larger than 2 MB. Split it into smaller exports.';
    return summary;
  }

  const parsed = parseCsvText(text);
  if (parsed.error) {
    summary.fileError = parsed.error;
    return summary;
  }

  const header = parsed.rows[0].map(normalizeHeader);
  const columnIndex: Partial<Record<'date' | 'sku' | 'quantity' | 'unitprice', number>> = {};
  header.forEach((cell, index) => {
    const mapped = HEADER_ALIASES[cell];
    if (mapped && columnIndex[mapped] === undefined) columnIndex[mapped] = index;
  });
  const missing = (['date', 'sku', 'quantity'] as const).filter((key) => columnIndex[key] === undefined);
  if (missing.length > 0) {
    summary.fileError = `Missing required column(s): ${missing.join(', ')}. Expected headers: date, sku, quantity, unit_price.`;
    return summary;
  }

  const body = parsed.rows.slice(1);
  summary.totalRows = body.length;
  if (body.length === 0) {
    summary.fileError = 'The file has headers but no sales rows.';
    return summary;
  }
  if (body.length > 20_000) {
    summary.fileError = 'Import at most 20,000 rows at a time. Split the export into smaller files.';
    return summary;
  }

  const productBySku = new Map(options.products.map((product) => [product.sku.trim().toLowerCase(), product]));
  const seen = new Set(options.existing.map(saleFingerprint));
  const createdAt = new Date().toISOString();

  body.forEach((cells, index) => {
    const rowNumber = index + 2; // header is row 1
    const read = (key: 'date' | 'sku' | 'quantity' | 'unitprice'): string => {
      const at = columnIndex[key];
      return at === undefined ? '' : (cells[at] ?? '').trim();
    };
    const sku = read('sku');
    if (!sku && cells.every((cell) => cell === '')) return;

    const dateRaw = read('date');
    const parsedDate = parseISODate(dateRaw) ?? parseISODate(isoFromLooseDate(dateRaw));
    if (!parsedDate) {
      summary.errors.push({ row: rowNumber, sku, message: 'Enter the sale date as YYYY-MM-DD.' });
      return;
    }
    const soldAt = todayISO(parsedDate);
    if (soldAt > todayIso) {
      summary.errors.push({ row: rowNumber, sku, message: 'Sale date cannot be in the future.' });
      return;
    }

    if (!sku) {
      summary.errors.push({ row: rowNumber, message: 'SKU is required.' });
      return;
    }
    const product = productBySku.get(sku.toLowerCase());
    if (!product) {
      summary.errors.push({ row: rowNumber, sku, message: `No product with SKU "${sku}".` });
      return;
    }

    const quantityRaw = read('quantity');
    const quantity = Number(quantityRaw);
    if (!quantityRaw || !Number.isFinite(quantity) || quantity <= 0) {
      summary.errors.push({ row: rowNumber, sku, message: 'Quantity must be a number greater than 0.' });
      return;
    }
    if (quantity > 100_000) {
      summary.errors.push({ row: rowNumber, sku, message: 'Quantity looks unrealistic (over 100,000).' });
      return;
    }
    const roundedQuantity = Math.round(quantity * 1000) / 1000;

    const priceRaw = read('unitprice');
    let unitPrice: number | null = null;
    if (priceRaw !== '') {
      const price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        summary.errors.push({ row: rowNumber, sku, message: 'Unit price must be zero or a positive number.' });
        return;
      }
      unitPrice = Math.round(price * 100) / 100;
    }

    const record: SaleRecord = {
      id: options.makeId(),
      productId: product.id,
      sku: product.sku,
      quantity: roundedQuantity,
      unitPrice,
      soldAt,
      source,
      createdAt,
    };
    const fingerprint = saleFingerprint(record);
    if (seen.has(fingerprint)) {
      summary.duplicates += 1;
      return;
    }
    seen.add(fingerprint);
    summary.valid.push(record);
    if (summary.earliest === null || soldAt < summary.earliest) summary.earliest = soldAt;
  });

  return summary;
}

/** Accepts 04/01/2026 and 2026/01/04 in addition to ISO; ambiguous formats are rejected. */
function isoFromLooseDate(value: string): string {
  if (!value) return '';
  const slash = /^(\d{4})[/](\d{1,2})[/](\d{1,2})$/.exec(value);
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
  }
  return '';
}

/** Keep the ledger bounded; the oldest lines beyond the cap are trimmed first. */
export const MAX_SALES_RECORDS = 20_000;

export function mergeSales(existing: SaleRecord[], incoming: SaleRecord[]): SaleRecord[] {
  if (incoming.length === 0) return existing;
  const merged = [...existing, ...incoming].sort((a, b) => (a.soldAt < b.soldAt ? -1 : a.soldAt > b.soldAt ? 1 : 0));
  return merged.length > MAX_SALES_RECORDS ? merged.slice(merged.length - MAX_SALES_RECORDS) : merged;
}
