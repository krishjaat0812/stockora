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
   * Optional selling price per unit. Used only for margin and stock-value
   * estimates in the Business Calculator and Reports; stock decisions never
   * depend on it.
   */
  sellingPrice?: number | null;
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
  /** Provenance: imported from a POS export, entered manually, or sample data. */
  source: 'import' | 'manual' | 'demo';
  createdAt: string;
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
