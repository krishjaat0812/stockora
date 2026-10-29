import type { Product, SaleRecord, Settings, Supplier } from '../types';
import { addDaysISO, todayISO } from '../lib/date';

interface SeedRow {
  sku: string;
  name: string;
  category: string;
  currentStock: number;
  averageDailySales: number;
  leadTimeDays: number;
  daysToExpiry: number | null;
  reorderLevel: number;
  supplierName: string;
  unit: string;
  unitCost: number;
  sellingPrice: number;
}

/**
 * Controlled demo dataset.
 * Expiry dates are anchored to the day the demo data was seeded/reset so the
 * walkthrough stays predictable. Reset demo data re-anchors them to today.
 */
const SEED_ROWS: SeedRow[] = [
  {
    sku: 'R101',
    name: 'Milk 1L',
    category: 'Dairy & Chilled',
    currentStock: 8,
    averageDailySales: 12,
    leadTimeDays: 1,
    daysToExpiry: 3,
    reorderLevel: 10,
    supplierName: 'FreshPastures Dairy',
    unit: 'L',
    unitCost: 62,
    sellingPrice: 70,
  },
  {
    sku: 'R102',
    name: 'Rice 5kg',
    category: 'Staples',
    currentStock: 25,
    averageDailySales: 2,
    leadTimeDays: 3,
    daysToExpiry: 180,
    reorderLevel: 8,
    supplierName: 'AgriMart Wholesale',
    unit: 'bag',
    unitCost: 420,
    sellingPrice: 485,
  },
  {
    sku: 'R103',
    name: 'Bread',
    category: 'Bakery',
    currentStock: 4,
    averageDailySales: 10,
    leadTimeDays: 1,
    daysToExpiry: 1,
    reorderLevel: 6,
    supplierName: 'DailyBake Ltd.',
    unit: 'loaf',
    unitCost: 32,
    sellingPrice: 40,
  },
  {
    sku: 'R104',
    name: 'Juice',
    category: 'Beverages',
    currentStock: 30,
    averageDailySales: 3,
    leadTimeDays: 2,
    daysToExpiry: 2,
    reorderLevel: 10,
    supplierName: 'SunOrchard Beverages',
    unit: 'bottle',
    unitCost: 85,
    sellingPrice: 100,
  },
  {
    sku: 'R105',
    name: 'Yogurt',
    category: 'Dairy & Chilled',
    currentStock: 5,
    averageDailySales: 7,
    leadTimeDays: 1,
    daysToExpiry: 2,
    reorderLevel: 8,
    supplierName: 'Alpine Creamery',
    unit: 'cup',
    unitCost: 45,
    sellingPrice: 55,
  },
  {
    sku: 'R106',
    name: 'Soap',
    category: 'Household',
    currentStock: 40,
    averageDailySales: 1,
    leadTimeDays: 4,
    daysToExpiry: 300,
    reorderLevel: 10,
    supplierName: 'PureCare Supplies',
    unit: 'bar',
    unitCost: 28,
    sellingPrice: 35,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'Sobhasaria Demo Store',
  expiryThreshold: 3,
  safetyBufferDays: 2,
  currency: 'INR',
  notifications: {
    lowStock: true,
    nearExpiry: true,
    expired: true,
    dataUpdates: true,
  },
};

function productId(sku: string): string {
  return `seed-${sku.toLowerCase()}`;
}

export function supplierIdForName(name: string): string {
  return `seed-sup-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/** Contact details for the demo suppliers referenced by the seed products. */
const SEED_SUPPLIERS: Array<Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'FreshPastures Dairy',
    contactName: 'Meera Iyer',
    email: 'orders@freshpastures.example',
    phone: '+91 98290 11001',
    address: 'Plot 8, Dairy Colony, Jaipur',
    leadTimeDays: 1,
    paymentTerms: 'Net 7',
    notes: 'Morning delivery before 7am. Chilled van only.',
    active: true,
  },
  {
    name: 'AgriMart Wholesale',
    contactName: 'Ravi Menon',
    email: 'sales@agrimart.example',
    phone: '+91 98290 11002',
    address: '12 Mandi Road, Jaipur',
    leadTimeDays: 3,
    paymentTerms: 'Net 15',
    notes: 'Minimum order 10 bags for free delivery.',
    active: true,
  },
  {
    name: 'DailyBake Ltd.',
    contactName: 'Anita Shah',
    email: 'hello@dailybake.example',
    phone: '+91 98290 11003',
    address: 'Baker Street 4, Jaipur',
    leadTimeDays: 1,
    paymentTerms: 'Cash on delivery',
    notes: 'Unsold bread can be returned the same evening.',
    active: true,
  },
  {
    name: 'SunOrchard Beverages',
    contactName: 'Dev Patel',
    email: 'supply@sunorchard.example',
    phone: '+91 98290 11004',
    address: 'Industrial Area Phase 2, Jaipur',
    leadTimeDays: 2,
    paymentTerms: 'Net 30',
    notes: '',
    active: true,
  },
  {
    name: 'Alpine Creamery',
    contactName: 'Sara Khan',
    email: 'orders@alpinecreamery.example',
    phone: '+91 98290 11005',
    address: 'Cold Chain Hub, Jaipur',
    leadTimeDays: 1,
    paymentTerms: 'Net 7',
    notes: 'Accepts returns within 24 hours of delivery.',
    active: true,
  },
  {
    name: 'PureCare Supplies',
    contactName: 'Vikram Rao',
    email: 'care@purecare.example',
    phone: '+91 98290 11006',
    address: 'Wholesale Market Block C, Jaipur',
    leadTimeDays: 4,
    paymentTerms: 'Net 21',
    notes: 'Order in cartons of 12.',
    active: true,
  },
];

export function createSeedSuppliers(timestamp: string = new Date().toISOString()): Supplier[] {
  return SEED_SUPPLIERS.map((supplier) => ({
    ...supplier,
    id: supplierIdForName(supplier.name),
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function createSeedProducts(today: Date = new Date(), timestamp: string = new Date().toISOString()): Product[] {
  return SEED_ROWS.map((row) => ({
    id: productId(row.sku),
    sku: row.sku,
    name: row.name,
    category: row.category,
    currentStock: row.currentStock,
    reorderLevel: row.reorderLevel,
    averageDailySales: row.averageDailySales,
    leadTimeDays: row.leadTimeDays,
    expiryDate: row.daysToExpiry === null ? null : addDaysISO(row.daysToExpiry, today),
    supplierName: row.supplierName,
    supplierId: supplierIdForName(row.supplierName),
    unit: row.unit,
    unitCost: row.unitCost,
    sellingPrice: row.sellingPrice,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

/**
 * Sample sales transactions for the demo shop. Deterministic (seeded per SKU)
 * so the demo looks the same on every reset, and every row is marked
 * `source: 'demo'` so it is never mistaken for real trading history.
 */
export const DEMO_SALES_DAYS = 75;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Daily sales pattern per demo SKU. Soap is deliberately sparse (slow mover). */
const DEMO_SALES_PATTERN: Record<string, { base: number; everyNDays?: number }> = {
  R101: { base: 12 },
  R102: { base: 2 },
  R103: { base: 10 },
  R104: { base: 3 },
  R105: { base: 7 },
  R106: { base: 2, everyNDays: 5 },
};

export function createSeedSales(
  products: Product[],
  today: Date = new Date(),
  timestamp: string = new Date().toISOString(),
): { sales: SaleRecord[]; trackingSince: string } {
  const sales: SaleRecord[] = [];
  const start = DEMO_SALES_DAYS - 1;
  products.forEach((product, productIndex) => {
    const pattern = DEMO_SALES_PATTERN[product.sku];
    if (!pattern) return;
    const random = mulberry32(productIndex * 7919 + 13);
    for (let offset = start; offset >= 0; offset -= 1) {
      if (pattern.everyNDays && offset % pattern.everyNDays !== 0) continue;
      const quantity = Math.max(0, Math.round(pattern.base * (0.6 + random() * 0.8)));
      if (quantity === 0) continue;
      const soldAt = addDaysISO(-offset, today);
      sales.push({
        id: `seed-sale-${product.id}-${offset}`,
        productId: product.id,
        sku: product.sku,
        quantity,
        unitPrice: product.sellingPrice ?? null,
        soldAt,
        source: 'demo',
        createdAt: timestamp,
      });
    }
  });
  return { sales, trackingSince: addDaysISO(-start, today) };
}

export const SEEDED_ON = todayISO();
