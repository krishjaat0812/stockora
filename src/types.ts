export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  currentStock: number;
  reorderLevel: number;
  averageDailySales: number;
  leadTimeDays: number;
  /** ISO calendar date (yyyy-mm-dd) or null when not recorded. */
  expiryDate: string | null;
  supplierName?: string;
  /** Links this product to a supplier record; supplierName stays the CSV-facing label. */
  supplierId?: string | null;
  unit?: string;
  unitCost?: number | null;
  /**
   * Optional selling price per unit. Used for margin and stock-value estimates
   * in the Business Calculator and Reports, and as the authoritative price at
   * the POS; stock decisions never depend on it.
   */
  sellingPrice?: number | null;
  /** Primary barcode (EAN/UPC/Code128 style). Unique within the shop. */
  barcode?: string | null;
  /** Alternative barcodes that also resolve to this product at the POS. */
  altBarcodes?: string[];
  /** Tax rate in percent applied at checkout (e.g. GST). null/0 = untaxed. */
  taxRatePct?: number | null;
  /** true when the product is sold by weight/measure and may be sold in decimal quantities. */
  allowFractional?: boolean;
  /** false = kept for history and reporting but not sellable at the POS. */
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Editable product fields, used by both the form and CSV import. */
export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

export interface NotificationPreferences {
  lowStock: boolean;
  nearExpiry: boolean;
  expired: boolean;
  dataUpdates: boolean;
}

export interface Settings {
  shopName: string;
  expiryThreshold: number;
  safetyBufferDays: number;
  currency: CurrencyCode;
  notifications: NotificationPreferences;
  pos: PosSettings;
}

/** Shop-level Point of Sale configuration. */
export interface PosSettings {
  /** Payment methods the cashier may select at checkout. */
  paymentMethods: PaymentMethod[];
  /** When true, product selling prices are treated as tax-inclusive. */
  taxInclusive: boolean;
  /**
   * When true, a sale stays in "pending payment" until the cashier confirms
   * the money was received; stock is deducted only at that confirmation.
   */
  requirePaymentConfirmation: boolean;
  /** Footer printed on receipts (e.g. GSTIN, address, thank-you note). */
  receiptFooter: string;
}

export type ExpiryStatus = 'expired' | 'today' | 'near' | 'ok' | 'missing';

/** Exactly one health category per product. Expired is its own state. */
export type RiskCategory =
  | 'healthy'
  | 'low-only'
  | 'expiry-only'
  | 'both'
  | 'expired';

/** 0 = expired (safety), 1 = combined risk, 2 = low stock only, 3 = near expiry only. */
export type ActionPriority = 0 | 1 | 2 | 3;

export interface ProductInsight {
  product: Product;
  daysRemaining: number | null;
  expiryStatus: ExpiryStatus;
  isLowStock: boolean;
  isNearExpiry: boolean;
  isExpired: boolean;
  risk: RiskCategory;
  daysOfCover: number | null;
  reorderQuantity: number;
  reasons: string[];
  suggestedAction: string;
  priority: ActionPriority | null;
  /** Stable key for the current risk state; used for review tracking. */
  actionKey: string | null;
  stockStatus: 'out' | 'low' | 'healthy';
}

export interface ActivityEntry {
  id: string;
  type:
    | 'product-added'
    | 'product-updated'
    | 'product-deleted'
    | 'stock-updated'
    | 'supplier-added'
    | 'supplier-updated'
    | 'supplier-deleted'
    | 'sales-imported'
    | 'sales-cleared'
    | 'sale'
    | 'import'
    | 'reviewed'
    | 'settings'
    | 'reset';
  message: string;
  detail?: string;
  at: string;
}

export type AppNotificationKind = 'low-stock' | 'near-expiry' | 'expired' | 'import' | 'product';

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Dedupe key for condition-driven notifications. */
  key?: string;
  productId?: string;
  link?: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
}

export interface ReviewRecord {
  productId: string;
  actionKey: string;
  reviewedAt: string;
}

/** A supplier the shop buys from. Contact details are shop-private data. */
export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Typical days between placing an order and receiving stock. */
  leadTimeDays: number;
  paymentTerms?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Editable supplier fields (form + validation). */
export type SupplierInput = Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * One recorded sales transaction line. Sales history is an append-only ledger:
 * it is the only source of real demand, and it is never edited in place.
 */
export interface SaleRecord {
  id: string;
  productId: string;
  /** SKU as recorded at the time of sale, so history survives renames. */
  sku: string;
  quantity: number;
  /** Unit selling price at the time of sale, or null when not recorded. */
  unitPrice: number | null;
  /** Calendar date of the sale (yyyy-mm-dd). */
  soldAt: string;
  /**
   * Provenance: recorded at the POS, imported from a POS export, entered
   * manually, or sample data. POS lines carry the order they belong to.
   */
  source: 'pos' | 'import' | 'manual' | 'demo';
  /** The completed POS order this line belongs to (POS sales only). */
  saleId?: string;
  createdAt: string;
}

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  other: 'Other',
};

/**
 * POS transaction states. A cart exists only in the browser (a draft that is
 * never persisted); a saved order is either waiting for payment confirmation,
 * completed (stock deducted exactly once) or cancelled before completion
 * (stock untouched). Refunds are intentionally not implemented.
 */
export type SaleStatus = 'pending_payment' | 'completed' | 'cancelled';

/** One line of a completed or pending POS transaction, priced at sale time. */
export interface SaleLine {
  productId: string;
  sku: string;
  /** Product name at the time of sale. */
  name: string;
  quantity: number;
  /** Authoritative unit price taken from the product record at sale time. */
  unitPrice: number;
  taxRatePct: number;
  lineDiscountPct: number;
  lineDiscountAmount: number;
  /** Share of the order-level discount allocated to this line. */
  orderDiscountShare: number;
  taxAmount: number;
  /** What this line contributes to the amount payable. */
  lineTotal: number;
  /** Taxable base after discounts (net of tax when prices are tax-inclusive). */
  taxableBase: number;
}

export interface SaleOrder {
  id: string;
  /** Sequential receipt number, e.g. RCPT-000123. */
  receiptNumber: string;
  /** Client-supplied key; a retry with the same key returns this order. */
  idempotencyKey: string;
  status: SaleStatus;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Calendar date the sale completed (yyyy-mm-dd); null until completed. */
  soldAt: string | null;
  lines: SaleLine[];
  subtotal: number;
  lineDiscountTotal: number;
  orderDiscountPct: number;
  orderDiscountTotal: number;
  taxTotal: number;
  taxableAmount: number;
  /** Amount payable (tax-inclusive when the shop prices tax-inclusively). */
  total: number;
  taxInclusive: boolean;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  amountReceived: number | null;
  changeDue: number | null;
  paidAt: string | null;
  cashierId: string;
  cashierName: string;
  note?: string;
  /** Non-blocking advisories shown at checkout (e.g. near-expiry warning). */
  warnings?: string[];
}

/**
 * Stock ledger entry. Every completed POS sale records one movement per line
 * so stock changes remain traceable instead of being overwritten silently.
 */
export interface InventoryMovement {
  id: string;
  productId: string;
  sku: string;
  type: 'sale';
  /** Negative for a sale deduction. */
  quantityChange: number;
  previousStock: number;
  resultingStock: number;
  saleId: string;
  at: string;
  actorId: string;
  actorName: string;
}

export interface PersistedState {
  version: number;
  products: Product[];
  suppliers: Supplier[];
  sales: SaleRecord[];
  /** First day sales history is considered reliable; null until a sale exists. */
  salesTrackingSince: string | null;
  settings: Settings;
  activity: ActivityEntry[];
  notifications: AppNotification[];
  reviews: ReviewRecord[];
  /** Alert keys already raised, so unchanged conditions are not re-notified. */
  notifiedKeys: string[];
  /** POS transactions, newest last. Server-written; never accepted from the client. */
  saleOrders: SaleOrder[];
  /** Stock movement ledger for completed sales. Server-written only. */
  inventoryMovements: InventoryMovement[];
  /** Monotonic receipt sequence (RCPT-000123). Server-written only. */
  receiptCounter: number;
  seededOn: string;
}

export interface ImportRowError {
  row: number;
  sku?: string;
  message: string;
}

export interface ImportSummary {
  valid: ProductInput[];
  errors: ImportRowError[];
  updatedCount: number;
  skippedCount: number;
  totalRows: number;
  /** Set when the file itself cannot be used (missing columns, unreadable). */
  fileError?: string;
}
