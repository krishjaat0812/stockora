import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSeedProducts } from '../data/seed';
import { buildInsights } from './inventory';
import {
  actionTable,
  buildCsv,
  expiryTable,
  inventoryTable,
  parseCsvText,
  parseInventoryCsv,
  reorderTable,
  SAMPLE_CSV,
} from './csv';

const TODAY = new Date(2026, 9, 25);
const products = createSeedProducts(TODAY, '2026-10-25T08:00:00.000Z');
const insights = buildInsights(products, DEFAULT_SETTINGS, TODAY);

const HEADER =
  'SKU,Product Name,Category,Current Stock,Reorder Level,Average Daily Sales,Lead Time Days,Expiry Date,Supplier Name,Unit,Unit Cost';

describe('CSV parsing', () => {
  it('parses quoted fields, escaped quotes and embedded commas', () => {
    const parsed = parseCsvText('SKU,Name\r\nR1,"Butter, salted"\r\nR2,"Say ""fresh"""\r\n');
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([
      ['SKU', 'Name'],
      ['R1', 'Butter, salted'],
      ['R2', 'Say "fresh"'],
    ]);
  });

  it('reports an unclosed quote instead of silently truncating', () => {
    const parsed = parseCsvText('SKU,Name\nR1,"Butter');
    expect(parsed.error).toBeTruthy();
  });

  it('builds CSV with correct escaping and a trailing newline', () => {
    const csv = buildCsv({ headers: ['A', 'B'], rows: [['x,y', 'line "quote"']] });
    expect(csv).toBe('A,B\r\n"x,y","line ""quote"""\r\n');
  });

  it('provides a usable sample template', () => {
    expect(SAMPLE_CSV.headers[0]).toBe('SKU');
    expect(SAMPLE_CSV.rows).toHaveLength(3);
    expect(buildCsv(SAMPLE_CSV).split('\r\n').length).toBeGreaterThan(3);
  });
});

describe('Test I — CSV import validation', () => {
  it('imports a valid row with optional fields', () => {
    const summary = parseInventoryCsv(
      `${HEADER}
R201,Butter 250g,Dairy & Chilled,12,6,3,2,2026-11-08,FreshPastures Dairy,pack,58`,
      products,
    );
    expect(summary.fileError).toBeUndefined();
    expect(summary.errors).toHaveLength(0);
    expect(summary.valid).toHaveLength(1);
    expect(summary.valid[0]).toMatchObject({
      sku: 'R201',
      name: 'Butter 250g',
      currentStock: 12,
      reorderLevel: 6,
      averageDailySales: 3,
      leadTimeDays: 2,
      expiryDate: '2026-11-08',
      unitCost: 58,
    });
    expect(summary.updatedCount).toBe(0);
    expect(summary.totalRows).toBe(1);
  });

  it('accepts DD/MM/YYYY dates and normalises them', () => {
    const summary = parseInventoryCsv(
      `${HEADER}\nR202,Coffee,Beverages,9,4,1.5,5,08/11/2026,Highland,pack,240`,
      products,
    );
    expect(summary.valid).toHaveLength(1);
    expect(summary.valid[0].expiryDate).toBe('2026-11-08');
  });

  it('reports invalid rows with row numbers and keeps valid rows', () => {
    const summary = parseInventoryCsv(
      `${HEADER}
R301,Good product,Test,5,2,1,1,2026-12-01,,,10
R302,,Missing name,5,2,1,1,,,,
R303,Negative stock,Test,-5,2,1,1,,,,
R304,Bad date,Test,5,2,1,1,2026-02-31,,,,
R305,No sales,Test,5,2,0,1,,,,
R306,Free item,Test,5,2,1,1,,,,-2`,
      products,
    );
    expect(summary.valid.map((row) => row.sku)).toEqual(['R301', 'R305']);
    expect(summary.errors).toHaveLength(4);
    const messages = summary.errors.map((error) => `${error.row}:${error.message}`).join(' | ');
    expect(messages).toMatch(/3:.*name is required/i);
    expect(messages).toMatch(/4:.*stock cannot be negative/i);
    expect(messages).toMatch(/5:.*expiry date/i);
    expect(messages).toMatch(/7:.*unit cost cannot be negative/i);
    expect(summary.skippedCount).toBe(4);
  });

  it('rejects duplicate SKUs inside the same file', () => {
    const summary = parseInventoryCsv(
      `${HEADER}
R401,First,Test,5,2,1,1,,,,
R401,Second,Test,6,2,1,1,,,,
`,
      products,
    );
    expect(summary.valid).toHaveLength(1);
    expect(summary.errors[0].message).toMatch(/appears more than once/i);
  });

  it('detects existing SKUs and can update them when enabled', () => {
    const text = `${HEADER}\nR101,Milk 1L Updated,Dairy & Chilled,9,10,12,1,2026-11-30,FreshPastures,L,62`;
    const rejected = parseInventoryCsv(text, products);
    expect(rejected.valid).toHaveLength(0);
    expect(rejected.errors[0].message).toMatch(/already exists/i);

    const replaced = parseInventoryCsv(text, products, { replaceExisting: true });
    expect(replaced.valid).toHaveLength(1);
    expect(replaced.updatedCount).toBe(1);
  });

  it('reports missing required columns as a file error', () => {
    const summary = parseInventoryCsv('SKU,Product Name\nR501,Only two columns', products);
    expect(summary.fileError).toMatch(/missing required column/i);
    expect(summary.valid).toHaveLength(0);
  });

  it('reports an empty file and non-numeric values clearly', () => {
    expect(parseInventoryCsv('', products).fileError).toMatch(/empty/i);
    const summary = parseInventoryCsv(
      `${HEADER}\nR502,Bad numbers,Test,abc,2,1,1,,,,\n`,
      products,
    );
    expect(summary.errors[0].message).toMatch(/current stock must be a number/i);
  });

  it('accepts a row with a missing expiry date', () => {
    const summary = parseInventoryCsv(`${HEADER}\nR503,No expiry,Test,5,2,1,1,,,,\n`, products);
    expect(summary.errors).toHaveLength(0);
    expect(summary.valid[0].expiryDate).toBeNull();
  });
});

describe('CSV exports', () => {
  it('exports the actual inventory rows', () => {
    const table = inventoryTable(products);
    expect(table.rows).toHaveLength(6);
    expect(table.rows[0][0]).toBe('R101');
    expect(table.headers).toContain('Expiry Date');
  });

  it('exports derived action data with review state', () => {
    const reviewed = new Set([insights[0].actionKey ?? '']);
    const table = actionTable(insights, reviewed);
    expect(table.rows).toHaveLength(6);
    expect(table.headers).toContain('Suggested Reorder Qty');
    expect(table.rows.some((row) => row.includes('Reviewed'))).toBe(true);
  });

  it('exports expiry groups and reorder suggestions', () => {
    const expiry = expiryTable(insights);
    expect(expiry.rows.find((row) => row[1] === 'R103')?.[0]).toBe('Expiring within 1–3 days');
    expect(expiry.rows.find((row) => row[1] === 'R102')?.[0]).toBe('Expiring later');

    const reorder = reorderTable(insights, DEFAULT_SETTINGS.safetyBufferDays);
    expect(reorder.headers).toContain('Safety Buffer Days');
    expect(reorder.rows.find((row) => row[0] === 'R101')?.[9]).toBe(28);
  });
});
