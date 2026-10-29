import type { ImportSummary, Product, ProductInput, ProductInsight } from '../types';
import { EXPIRY_GROUP_META, expiryGroupFor } from './inventory';
import { formatCover } from './inventory';
import { isValidDateString } from './inventory';
import { parseISODate, toISODate } from './date';
import { validateProductInput } from './validation';

export interface CsvTable {
  headers: string[];
  rows: (string | number)[][];
}

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(table: CsvTable): string {
  const lines = [table.headers.map(csvEscape).join(',')];
  for (const row of table.rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export interface ParsedCsv {
  rows: string[][];
  error: string | null;
}

/** RFC 4180 style parser with quoted fields, escaped quotes and embedded newlines. */
export function parseCsvText(text: string): ParsedCsv {
  const input = text.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let unclosedQuote = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field.trim() === '') {
        field = '';
        inQuotes = true;
      } else {
        field += char;
      }
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (inQuotes) unclosedQuote = true;
  row.push(field);
  rows.push(row);

  const cleaned = rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));

  if (unclosedQuote) {
    return { rows: cleaned, error: 'The file has an unclosed quoted value. Check the CSV formatting.' };
  }
  if (cleaned.length === 0) {
    return { rows: [], error: 'The file is empty.' };
  }
  return { rows: cleaned, error: null };
}

export const REQUIRED_CSV_COLUMNS = [
  'sku',
  'name',
  'category',
  'currentstock',
  'reorderlevel',
  'averagedailysales',
  'leadtimedays',
] as const;

const HEADER_ALIASES: Record<string, string> = {
  sku: 'sku',
  productsku: 'sku',
  code: 'sku',
  name: 'name',
  productname: 'name',
  product: 'name',
  category: 'category',
  currentstock: 'currentstock',
  stock: 'currentstock',
  quantity: 'currentstock',
  qty: 'currentstock',
  reorderlevel: 'reorderlevel',
  reorder: 'reorderlevel',
  minstock: 'reorderlevel',
  averagedailysales: 'averagedailysales',
  avgdailysales: 'averagedailysales',
  dailysales: 'averagedailysales',
  ads: 'averagedailysales',
  leadtimedays: 'leadtimedays',
  leadtime: 'leadtimedays',
  expirydate: 'expirydate',
  expiry: 'expirydate',
  bestbefore: 'expirydate',
  suppliername: 'suppliername',
  supplier: 'suppliername',
  unit: 'unit',
  uom: 'unit',
  unitcost: 'unitcost',
  cost: 'unitcost',
  purchasecost: 'unitcost',
  price: 'unitcost',
  sellingprice: 'sellingprice',
  sellprice: 'sellingprice',
  saleprice: 'sellingprice',
  retailprice: 'sellingprice',
  mrp: 'sellingprice',
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_\-()]/g, '');
}

function parseCsvDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isValidDateString(value)) return value;
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (dayFirst) {
    const iso = `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
    if (isValidDateString(iso)) return iso;
  }
  return null;
}

export const SAMPLE_CSV: CsvTable = {
  headers: [
    'SKU',
    'Product Name',
    'Category',
    'Current Stock',
    'Reorder Level',
    'Average Daily Sales',
    'Lead Time Days',
    'Expiry Date',
    'Supplier Name',
    'Unit',
    'Unit Cost',
    'Selling Price',
  ],
  rows: [
    ['R201', 'Butter 250g', 'Dairy & Chilled', 12, 6, 3, 2, toISODate(new Date(Date.now() + 14 * 86_400_000)), 'FreshPastures Dairy', 'pack', 58, 70],
    ['R202', 'Coffee 100g', 'Beverages', 9, 4, 1.5, 5, '', 'Highland Roasters', 'pack', 240, 299],
    ['R203', 'Tomato Ketchup 500g', 'Condiments', 3, 8, 2, 4, toISODate(new Date(Date.now() + 200 * 86_400_000)), 'SunHarvest Foods', 'bottle', 110, 135],
  ],
};

/**
 * Parses and validates an inventory CSV. Invalid rows are reported with row
 * numbers and never silently dropped.
 */
export function parseInventoryCsv(
  text: string,
  products: Product[],
  options: { replaceExisting: boolean } = { replaceExisting: false },
): ImportSummary {
  const parsed = parseCsvText(text);
  const summary: ImportSummary = {
    valid: [],
    errors: [],
    updatedCount: 0,
    skippedCount: 0,
    totalRows: 0,
    fileError: parsed.error ?? undefined,
  };
  if (parsed.error) return summary;

  const [headerRow, ...dataRows] = parsed.rows;
  const headerMap = new Map<number, string>();
  const unknownHeaders: string[] = [];
  headerRow.forEach((header, index) => {
    const mapped = HEADER_ALIASES[normalizeHeader(header)];
    if (mapped) headerMap.set(index, mapped);
    else if (header.trim()) unknownHeaders.push(header.trim());
  });

  const present = new Set(headerMap.values());
  const missing = REQUIRED_CSV_COLUMNS.filter((column) => !present.has(column));
  if (missing.length > 0) {
    summary.fileError = `Missing required column${missing.length === 1 ? '' : 's'}: ${missing
      .map((column) => column.replace(/([a-z])([A-Z])/g, '$1 $2'))
      .join(', ')}. Download the sample template to see the expected format.`;
    return summary;
  }

  const seenSkus = new Map<string, number>();
  const existing = new Map(products.map((product) => [product.sku.trim().toLowerCase(), product]));

  dataRows.forEach((cells, index) => {
    const rowNumber = index + 2; // header is row 1
    summary.totalRows += 1;
    const get = (column: string): string => {
      for (const [cellIndex, mapped] of headerMap.entries()) {
        if (mapped === column) return (cells[cellIndex] ?? '').trim();
      }
      return '';
    };

    const rawSku = get('sku');
    const errors: string[] = [];

    const num = (column: string, label: string, required = true): number => {
      const raw = get(column);
      if (raw === '') {
        if (required) errors.push(`${label} is required.`);
        return Number.NaN;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        errors.push(`${label} must be a number (found "${raw}").`);
        return Number.NaN;
      }
      return value;
    };

    const currentStock = num('currentstock', 'Current stock');
    const reorderLevel = num('reorderlevel', 'Reorder level');
    const averageDailySales = num('averagedailysales', 'Average daily sales');
    const leadTimeDays = num('leadtimedays', 'Lead time days');

    let expiryDate: string | null = null;
    const rawExpiry = get('expirydate');
    if (rawExpiry) {
      expiryDate = parseCsvDate(rawExpiry);
      if (!expiryDate) errors.push(`Expiry date "${rawExpiry}" is not a valid date (use YYYY-MM-DD).`);
    }

    let unitCost: number | null = null;
    const rawCost = get('unitcost');
    if (rawCost !== '') {
      const value = Number(rawCost);
      if (!Number.isFinite(value)) errors.push(`Unit cost must be a number (found "${rawCost}").`);
      else unitCost = value;
    }

    let sellingPrice: number | null = null;
    const rawPrice = get('sellingprice');
    if (rawPrice !== '') {
      const value = Number(rawPrice);
      if (!Number.isFinite(value)) {
        errors.push(`Selling price must be a number (found "${rawPrice}").`);
      } else sellingPrice = value;
    }

    const input: ProductInput = {
      sku: rawSku,
      name: get('name'),
      category: get('category'),
      currentStock,
      reorderLevel,
      averageDailySales,
      leadTimeDays,
      expiryDate,
      supplierName: get('suppliername') || undefined,
      unit: get('unit') || undefined,
      unitCost,
      sellingPrice,
    };

    const normalizedSku = rawSku.toLowerCase();
    if (normalizedSku && seenSkus.has(normalizedSku)) {
      errors.push(`SKU "${rawSku}" appears more than once in this file (also row ${seenSkus.get(normalizedSku)}).`);
    }

    const existingProduct = normalizedSku ? existing.get(normalizedSku) : undefined;
    let isUpdate = false;
    if (existingProduct) {
      if (options.replaceExisting) isUpdate = true;
      else errors.push(`SKU "${rawSku}" already exists in inventory. Enable "Update existing products" to replace it.`);
    }

    const fieldErrors = validateProductInput(input, {
      products,
      editingId: isUpdate ? existingProduct?.id : undefined,
    });
    for (const message of Object.values(fieldErrors)) {
      if (message) errors.push(message);
    }

    if (errors.length > 0) {
      summary.errors.push({
        row: rowNumber,
        sku: rawSku || undefined,
        message: [...new Set(errors)].join(' '),
      });
      summary.skippedCount += 1;
      return;
    }

    seenSkus.set(normalizedSku, rowNumber);
    summary.valid.push({ ...input, sku: input.sku.trim().toUpperCase(), name: input.name.trim(), category: input.category.trim() });
    if (isUpdate) summary.updatedCount += 1;
  });

  if (unknownHeaders.length > 0 && summary.valid.length === 0 && summary.errors.length === 0) {
    summary.fileError = `No product rows found. Unrecognised columns: ${unknownHeaders.join(', ')}.`;
  }

  return summary;
}

export function inventoryTable(products: Product[]): CsvTable {
  return {
    headers: [
      'SKU',
      'Product Name',
      'Category',
      'Current Stock',
      'Reorder Level',
      'Average Daily Sales',
      'Lead Time Days',
      'Expiry Date',
      'Supplier Name',
      'Unit',
      'Unit Cost',
      'Selling Price',
    ],
    rows: products.map((product) => [
      product.sku,
      product.name,
      product.category,
      product.currentStock,
      product.reorderLevel,
      product.averageDailySales,
      product.leadTimeDays,
      product.expiryDate ?? '',
      product.supplierName ?? '',
      product.unit ?? '',
      product.unitCost ?? '',
      product.sellingPrice ?? '',
    ]),
  };
}

export function actionTable(insights: ProductInsight[], reviewedKeys: Set<string>): CsvTable {
  return {
    headers: [
      'Priority',
      'Risk',
      'SKU',
      'Product Name',
      'Category',
      'Current Stock',
      'Reorder Level',
      'Avg Daily Sales',
      'Lead Time Days',
      'Days of Cover',
      'Expiry Date',
      'Days Remaining',
      'Suggested Reorder Qty',
      'Reason',
      'Suggested Action',
      'Review Status',
    ],
    rows: insights.map((insight) => [
      insight.priority === null ? '' : `P${insight.priority}`,
      insight.risk,
      insight.product.sku,
      insight.product.name,
      insight.product.category,
      insight.product.currentStock,
      insight.product.reorderLevel,
      insight.product.averageDailySales,
      insight.product.leadTimeDays,
      insight.daysOfCover === null ? 'N/A' : insight.daysOfCover.toFixed(1),
      insight.product.expiryDate ?? '',
      insight.daysRemaining ?? '',
      insight.reorderQuantity,
      insight.reasons.join(' '),
      insight.suggestedAction,
      reviewedKeys.has(insight.actionKey ?? '') ? 'Reviewed' : 'Needs review',
    ]),
  };
}

export function expiryTable(insights: ProductInsight[]): CsvTable {
  return {
    headers: [
      'Expiry Group',
      'SKU',
      'Product Name',
      'Category',
      'Remaining Stock',
      'Expiry Date',
      'Days Remaining',
      'Stock Status',
      'Expiry Status',
      'Recommended Action',
    ],
    rows: insights.map((insight) => [
      EXPIRY_GROUP_META[expiryGroupFor(insight.daysRemaining)].label,
      insight.product.sku,
      insight.product.name,
      insight.product.category,
      insight.product.currentStock,
      insight.product.expiryDate ?? '',
      insight.daysRemaining ?? '',
      insight.stockStatus,
      insight.expiryStatus,
      insight.isExpired
        ? 'Remove from sale and follow applicable safety and disposal procedures.'
        : insight.suggestedAction,
    ]),
  };
}

export function reorderTable(insights: ProductInsight[], safetyBufferDays: number): CsvTable {
  return {
    headers: [
      'SKU',
      'Product Name',
      'Category',
      'Current Stock',
      'Reorder Level',
      'Average Daily Sales',
      'Lead Time Days',
      'Safety Buffer Days',
      'Days of Cover',
      'Suggested Reorder Quantity',
      'Expiry Note',
      'Review Status',
    ],
    rows: insights.map((insight) => [
      insight.product.sku,
      insight.product.name,
      insight.product.category,
      insight.product.currentStock,
      insight.product.reorderLevel,
      insight.product.averageDailySales,
      insight.product.leadTimeDays,
      safetyBufferDays,
      formatCover(insight.daysOfCover),
      insight.reorderQuantity,
      insight.isExpired
        ? 'Expired — do not replenish without review'
        : insight.isNearExpiry
          ? `Expires in ${insight.daysRemaining} day(s) — review before ordering`
          : '',
      insight.isExpired ? 'Not recommended' : 'Suggested',
    ]),
  };
}

/** Date suffix for export filenames, e.g. 2026-10-25. */
export function fileStamp(date: Date = new Date()): string {
  const parsed = parseISODate(toISODate(date));
  return parsed ? toISODate(parsed) : 'export';
}
