import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ActivityEntry,
  AppNotification,
  InventoryMovement,
  PersistedState,
  Product,
  ProductInput,
  ProductInsight,
  ReviewRecord,
  SaleOrder,
  SaleRecord,
  Settings,
  Supplier,
  SupplierInput,
} from '../types';
import {
  DEFAULT_SETTINGS,
  createSeedProducts,
  createSeedSales,
  createSeedSuppliers,
} from '../data/seed';
import { validateSupplierInput, type SupplierFieldErrors } from '../lib/suppliers';
import { buildActionQueue, buildBriefing, buildInsights, computeMetrics } from '../lib/inventory';
import { formatDate } from '../lib/date';
import { validateProductInput, type ProductFieldErrors } from '../lib/validation';
import { ApiError, apiFetch } from '../auth/api';
import { useAuth } from '../auth/AuthContext';

/**
 * The organisation's workspace store. The single source of truth lives in
 * the Worker (D1, scoped to the signed-in organisation) — localStorage is no
 * longer used. Mutations update the UI immediately and synchronise changed
 * top-level fields to the server; the server re-validates and re-checks
 * feature permissions on every write.
 */

const STATE_VERSION = 1;
const RETRY_DELAY_MS = 5000;

export type MutationResult = { ok: true; id?: string } | { ok: false; errors: ProductFieldErrors };
export type SupplierMutationResult =
  | { ok: true; id: string }
  | { ok: false; errors: SupplierFieldErrors };

export interface SalesImportResult {
  added: number;
  skippedDuplicates: number;
  errors: Array<{ row: number; sku?: string; message: string }>;
  errorCount: number;
  totalSales: number;
}

export interface StockoraContextValue {
  products: Product[];
  suppliers: Supplier[];
  sales: SaleRecord[];
  salesTrackingSince: string | null;
  /** POS transactions (server-written). Completed sales already sit in `sales`. */
  saleOrders: SaleOrder[];
  /** Stock movement ledger for completed sales. */
  inventoryMovements: InventoryMovement[];
  settings: Settings;
  activity: ActivityEntry[];
  notifications: AppNotification[];
  insights: ProductInsight[];
  actionQueue: ProductInsight[];
  metrics: ReturnType<typeof computeMetrics>;
  briefing: string;
  reviewedKeys: Set<string>;
  reviewedCount: number;
  lastSavedAt: string | null;
  persistenceError: string | null;
  loading: boolean;
  loadError: { code: string; message: string } | null;
  createProduct: (input: ProductInput) => MutationResult;
  updateProduct: (id: string, input: ProductInput) => MutationResult;
  deleteProduct: (id: string) => void;
  createSupplier: (input: SupplierInput) => SupplierMutationResult;
  updateSupplier: (id: string, input: SupplierInput) => SupplierMutationResult;
  deleteSupplier: (id: string) => void;
  importSales: (text: string, options?: { demo?: boolean }) => Promise<SalesImportResult>;
  clearSalesHistory: () => Promise<number>;
  updateSettings: (patch: Partial<Settings>) => void;
  resetDemoData: () => void;
  importProducts: (valid: ProductInput[]) => { added: number; updated: number };
  toggleReview: (insight: ProductInsight) => void;
  toggleReviewKey: (productId: string, key: string, productName: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  refreshFromStorage: () => Promise<void>;
  clearActivity: () => void;
}

const StockoraContext = createContext<StockoraContextValue | null>(null);

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function activityEntry(
  type: ActivityEntry['type'],
  message: string,
  detail?: string,
): ActivityEntry {
  return { id: uid(), type, message, detail, at: new Date().toISOString() };
}

function notificationForInsight(
  insight: ProductInsight,
  settings: Settings,
): AppNotification | null {
  const { product, risk, daysRemaining, reorderQuantity } = insight;
  const prefs = settings.notifications;
  const base = {
    id: uid(),
    createdAt: new Date().toISOString(),
    read: false,
    productId: product.id,
    link: `/inventory?product=${product.id}`,
    key: `risk:${product.id}:${risk}`,
  };

  if (risk === 'expired' && prefs.expired) {
    const overdue = Math.abs(daysRemaining ?? 0);
    return {
      ...base,
      kind: 'expired',
      severity: 'critical',
      title: `Expired: ${product.name}`,
      body: `${product.sku} passed its expiry date on ${formatDate(product.expiryDate)} (${overdue} day${overdue === 1 ? '' : 's'} ago). Remove from sale and follow disposal procedures.`,
    };
  }
  if (risk === 'both' && (prefs.lowStock || prefs.nearExpiry)) {
    return {
      ...base,
      kind: 'low-stock',
      severity: 'critical',
      title: `Low stock & near expiry: ${product.name}`,
      body: `${product.currentStock} ${product.unit ?? 'units'} left (reorder level ${product.reorderLevel}), expiring in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Suggested reorder: ${reorderQuantity} units — review expiry before ordering.`,
    };
  }
  if (risk === 'low-only' && prefs.lowStock) {
    return {
      ...base,
      kind: 'low-stock',
      severity: 'warning',
      title: `Low stock: ${product.name}`,
      body: `Stock ${product.currentStock} is at or below the reorder level ${product.reorderLevel}. Suggested reorder: ${reorderQuantity} units.`,
    };
  }
  if (risk === 'expiry-only' && prefs.nearExpiry) {
    return {
      ...base,
      kind: 'near-expiry',
      severity: daysRemaining === 0 ? 'critical' : 'warning',
      title: `Expiring soon: ${product.name}`,
      body:
        daysRemaining === 0
          ? `Expires today (${formatDate(product.expiryDate)}). Rotate or remove eligible stock per your policy.`
          : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left (expires ${formatDate(product.expiryDate)}). Prioritize stock rotation and review permitted markdowns.`,
    };
  }
  return null;
}

function buildConditionNotifications(
  insights: ProductInsight[],
  settings: Settings,
): AppNotification[] {
  return insights
    .map((insight) => notificationForInsight(insight, settings))
    .filter((item): item is AppNotification => item !== null);
}

function sortNotifications(items: AppNotification[]): AppNotification[] {
  return [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function createFreshState(now = new Date()): PersistedState {
  const timestamp = now.toISOString();
  const products = createSeedProducts(now, timestamp);
  const { sales, trackingSince } = createSeedSales(products, now, timestamp);
  const settings = DEFAULT_SETTINGS;
  const insights = buildInsights(products, settings);
  const notifications = buildConditionNotifications(insights, settings).slice(0, 8);
  return {
    version: STATE_VERSION,
    products,
    suppliers: createSeedSuppliers(timestamp),
    sales,
    salesTrackingSince: trackingSince,
    settings,
    activity: [
      activityEntry(
        'import',
        'Demo inventory loaded',
        `${products.length} sample products initialised`,
      ),
    ],
    notifications: sortNotifications(notifications),
    reviews: [],
    notifiedKeys: notifications.map((item) => item.key).filter((key): key is string => !!key),
    saleOrders: [],
    inventoryMovements: [],
    receiptCounter: 0,
    seededOn: timestamp,
  };
}

function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(raw?.notifications ?? {}) },
    pos: { ...DEFAULT_SETTINGS.pos, ...(raw?.pos ?? {}) },
  };
}

function hydrateServerState(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<PersistedState>;
  if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.products)) return null;
  return {
    version: STATE_VERSION,
    products: parsed.products,
    // Older documents predate suppliers and sales; empty defaults keep them
    // readable without re-seeding over real shop data.
    suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
    sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    salesTrackingSince:
      typeof parsed.salesTrackingSince === 'string' ? parsed.salesTrackingSince : null,
    settings: mergeSettings(parsed.settings),
    activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    notifiedKeys: Array.isArray(parsed.notifiedKeys)
      ? parsed.notifiedKeys.filter((key): key is string => typeof key === 'string')
      : [],
    // POS ledgers are server-written; missing fields mean an older document.
    saleOrders: Array.isArray(parsed.saleOrders) ? parsed.saleOrders : [],
    inventoryMovements: Array.isArray(parsed.inventoryMovements)
      ? parsed.inventoryMovements
      : [],
    receiptCounter:
      typeof parsed.receiptCounter === 'number' && Number.isFinite(parsed.receiptCounter)
        ? parsed.receiptCounter
        : 0,
    seededOn: parsed.seededOn ?? new Date().toISOString(),
  };
}

const SYNC_KEYS: Array<keyof PersistedState> = [
  'products',
  'suppliers',
  'settings',
  'activity',
  'notifications',
  'reviews',
  'notifiedKeys',
  'seededOn',
];

export function StockoraProvider({ children }: { children: ReactNode }) {
  const { can, refresh } = useAuth();
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
  const stateRef = useRef<PersistedState | null>(null);
  const pendingRef = useRef<Partial<PersistedState>>({});
  const flushingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Load the organisation's workspace from the server once per mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<unknown>('/api/state')
      .then((payload) => {
        if (cancelled) return;
        const hydrated = hydrateServerState(payload);
        if (!hydrated) {
          setLoadError({ code: 'bad_state', message: 'The workspace data could not be read.' });
          return;
        }
        stateRef.current = hydrated;
        setLoadError(null);
        forceRender();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const apiError = error instanceof ApiError ? error : null;
        setLoadError({
          code: apiError?.code ?? 'network',
          message:
            apiError?.message ??
            'Could not load your workspace. Check your connection and try again.',
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (Object.keys(pendingRef.current).length > 0) {
        const payload = pendingRef.current;
        pendingRef.current = {};
        try {
          await apiFetch('/api/state', {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          setPersistenceError(null);
          setLastSavedAt(new Date().toISOString());
        } catch (error) {
          const apiError = error instanceof ApiError ? error : null;
          if (apiError && apiError.status >= 400 && apiError.status < 500) {
            // The server rejected the write (permission change or validation).
            // Drop it — retrying cannot succeed — surface it, and refresh
            // permissions so the UI catches up with the server.
            setPersistenceError(apiError.message);
            void refresh();
            break;
          }
          // Transient failure: keep the payload and retry shortly.
          pendingRef.current = { ...payload, ...pendingRef.current };
          setPersistenceError('Could not save changes to the server. Retrying…');
          if (retryTimerRef.current === null) {
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              void flush();
            }, RETRY_DELAY_MS);
          }
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [refresh]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  /** Re-fetch the workspace from the server (header refresh, imports). */
  const refreshFromStorage = useCallback(async () => {
    const payload = await apiFetch<unknown>('/api/state');
    const hydrated = hydrateServerState(payload);
    if (!hydrated) throw new Error('Workspace data could not be read.');
    // Discard unsaved local edits in favour of the server copy.
    pendingRef.current = {};
    stateRef.current = hydrated;
    setLoadError(null);
    setPersistenceError(null);
    setLastSavedAt(new Date().toISOString());
    forceRender();
  }, []);

  const commit = useCallback(
    (updater: (current: PersistedState) => PersistedState) => {
      const prev = stateRef.current;
      if (!prev) return;
      const next = updater(prev);
      if (next === prev) return;
      const changed: Partial<PersistedState> = {};
      for (const key of SYNC_KEYS) {
        if (next[key] !== prev[key]) {
          (changed as Record<string, unknown>)[key] = next[key];
        }
      }
      stateRef.current = next;
      if (Object.keys(changed).length > 0) {
        pendingRef.current = { ...pendingRef.current, ...changed };
        void flush();
      }
      forceRender();
    },
    [flush],
  );

  const pushActivity = (current: PersistedState, entry: ActivityEntry): ActivityEntry[] =>
    [entry, ...current.activity].slice(0, 60);

  // Raise notifications only when a product's risk condition is new. Skipped
  // entirely when the Notifications feature is disabled for this account.
  const notificationsEnabled = can('notifications');
  const watchedProducts = stateRef.current?.products;
  const watchedSettings = stateRef.current?.settings;
  useEffect(() => {
    if (!notificationsEnabled) return;
    commit((current) => {
      const insights = buildInsights(current.products, current.settings);
      const desired = buildConditionNotifications(insights, current.settings);
      const desiredKeys = desired.map((item) => item.key).filter((key): key is string => !!key);
      const known = new Set(current.notifiedKeys);
      const fresh = desired.filter((item) => !item.key || !known.has(item.key));
      const sameKeys =
        desiredKeys.length === current.notifiedKeys.length &&
        desiredKeys.every((key, index) => current.notifiedKeys[index] === key);
      if (fresh.length === 0 && sameKeys) return current;
      return {
        ...current,
        notifications: sortNotifications([...fresh, ...current.notifications]).slice(0, 50),
        notifiedKeys: desiredKeys,
      };
    });
  }, [commit, notificationsEnabled, watchedProducts, watchedSettings]);

  // When the feature is disabled, clear local notifications once (the server
  // rejects notification writes without the feature, so clear only if we can).
  const notificationsClearedRef = useRef(false);
  useEffect(() => {
    if (notificationsEnabled) {
      notificationsClearedRef.current = false;
      return;
    }
    if (notificationsClearedRef.current) return;
    notificationsClearedRef.current = true;
    commit((current) =>
      current.notifications.length === 0 && current.notifiedKeys.length === 0
        ? current
        : { ...current, notifications: [], notifiedKeys: [] },
    );
  }, [notificationsEnabled, commit]);

  const createProduct = useCallback(
    (input: ProductInput): MutationResult => {
      const current = stateRef.current;
      if (!current) return { ok: false, errors: { name: 'Workspace is still loading.' } };
      const errors = validateProductInput(input, { products: current.products });
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      const now = new Date().toISOString();
      const product: Product = {
        ...input,
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        category: input.category.trim(),
        id: uid(),
        createdAt: now,
        updatedAt: now,
      };
      commit((state) => {
        const products = [...state.products, product];
        const notification: AppNotification | null =
          state.settings.notifications.dataUpdates && notificationsEnabled
            ? {
                id: uid(),
                kind: 'product',
                severity: 'success',
                title: 'Product added',
                body: `${product.name} (${product.sku}) is now being monitored.`,
                createdAt: now,
                read: false,
                productId: product.id,
                link: `/inventory?product=${product.id}`,
              }
            : null;
        return {
          ...state,
          products,
          activity: pushActivity(
            state,
            activityEntry('product-added', `Added ${product.name}`, `${product.sku} · ${product.category}`),
          ),
          notifications: notification
            ? [notification, ...state.notifications].slice(0, 50)
            : state.notifications,
        };
      });
      return { ok: true, id: product.id };
    },
    [commit, notificationsEnabled],
  );

  const updateProduct = useCallback(
    (id: string, input: ProductInput): MutationResult => {
      const current = stateRef.current;
      if (!current) return { ok: false, errors: { name: 'Workspace is still loading.' } };
      const existing = current.products.find((product) => product.id === id);
      if (!existing) return { ok: false, errors: { name: 'Product no longer exists.' } };
      const errors = validateProductInput(input, { products: current.products, editingId: id });
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      const now = new Date().toISOString();
      commit((state) => {
        const products = state.products.map((product) =>
          product.id === id
            ? {
                ...product,
                ...input,
                sku: input.sku.trim().toUpperCase(),
                name: input.name.trim(),
                updatedAt: now,
              }
            : product,
        );
        const stockChanged = existing.currentStock !== input.currentStock;
        const entry = stockChanged
          ? activityEntry(
              'stock-updated',
              `Stock updated for ${input.name}`,
              `${existing.currentStock} → ${input.currentStock}`,
            )
          : activityEntry('product-updated', `Edited ${input.name}`, input.sku);
        return { ...state, products, activity: pushActivity(state, entry) };
      });
      return { ok: true, id };
    },
    [commit],
  );

  const deleteProduct = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const existing = current?.products.find((product) => product.id === id);
      if (!existing) return;
      commit((state) => ({
        ...state,
        products: state.products.filter((product) => product.id !== id),
        reviews: state.reviews.filter((review) => review.productId !== id),
        activity: pushActivity(
          state,
          activityEntry('product-deleted', `Deleted ${existing.name}`, existing.sku),
        ),
      }));
    },
    [commit],
  );

  const createSupplier = useCallback(
    (input: SupplierInput): SupplierMutationResult => {
      const current = stateRef.current;
      if (!current) return { ok: false, errors: { name: 'Workspace is still loading.' } };
      const errors = validateSupplierInput(input, { suppliers: current.suppliers });
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      const now = new Date().toISOString();
      const supplier: Supplier = {
        ...input,
        name: input.name.trim(),
        id: uid(),
        createdAt: now,
        updatedAt: now,
      };
      commit((state) => ({
        ...state,
        suppliers: [...state.suppliers, supplier],
        activity: pushActivity(
          state,
          activityEntry('supplier-added', `Added supplier ${supplier.name}`, supplier.contactName),
        ),
      }));
      return { ok: true, id: supplier.id };
    },
    [commit],
  );

  const updateSupplier = useCallback(
    (id: string, input: SupplierInput): SupplierMutationResult => {
      const current = stateRef.current;
      if (!current) return { ok: false, errors: { name: 'Workspace is still loading.' } };
      const existing = current.suppliers.find((supplier) => supplier.id === id);
      if (!existing) return { ok: false, errors: { name: 'This supplier no longer exists.' } };
      const errors = validateSupplierInput(input, { suppliers: current.suppliers, editingId: id });
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      const now = new Date().toISOString();
      commit((state) => ({
        ...state,
        suppliers: state.suppliers.map((supplier) =>
          supplier.id === id
            ? { ...supplier, ...input, name: input.name.trim(), updatedAt: now }
            : supplier,
        ),
        // Keep the product's CSV-facing supplier label in step with the record.
        products: state.products.map((product) =>
          product.supplierId === id ? { ...product, supplierName: input.name.trim() } : product,
        ),
        activity: pushActivity(
          state,
          activityEntry('supplier-updated', `Updated supplier ${input.name.trim()}`, existing.name),
        ),
      }));
      return { ok: true, id };
    },
    [commit],
  );

  const deleteSupplier = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const existing = current?.suppliers.find((supplier) => supplier.id === id);
      if (!existing) return;
      commit((state) => ({
        ...state,
        suppliers: state.suppliers.filter((supplier) => supplier.id !== id),
        // Products stay; they simply lose the link. Stock is never deleted.
        products: state.products.map((product) =>
          product.supplierId === id ? { ...product, supplierId: null } : product,
        ),
        activity: pushActivity(
          state,
          activityEntry(
            'supplier-deleted',
            `Removed supplier ${existing.name}`,
            'Linked products were kept and unlinked',
          ),
        ),
      }));
    },
    [commit],
  );

  const importSales = useCallback(
    async (text: string, options?: { demo?: boolean }): Promise<SalesImportResult> => {
      const result = await apiFetch<SalesImportResult>('/api/state/sales/import', {
        method: 'POST',
        body: JSON.stringify({ text, demo: options?.demo === true }),
      });
      await refreshFromStorage();
      return result;
    },
    [refreshFromStorage],
  );

  const clearSalesHistory = useCallback(async (): Promise<number> => {
    const result = await apiFetch<{ removed: number }>('/api/state/sales', { method: 'DELETE' });
    await refreshFromStorage();
    return result.removed ?? 0;
  }, [refreshFromStorage]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      commit((current) => {
        const settings: Settings = {
          ...current.settings,
          ...patch,
          notifications: { ...current.settings.notifications, ...(patch.notifications ?? {}) },
        };
        const labels: string[] = [];
        if (patch.expiryThreshold !== undefined && patch.expiryThreshold !== current.settings.expiryThreshold) {
          labels.push(`near-expiry threshold ${patch.expiryThreshold} day${patch.expiryThreshold === 1 ? '' : 's'}`);
        }
        if (patch.safetyBufferDays !== undefined && patch.safetyBufferDays !== current.settings.safetyBufferDays) {
          labels.push(`safety buffer ${patch.safetyBufferDays} day${patch.safetyBufferDays === 1 ? '' : 's'}`);
        }
        if (patch.currency && patch.currency !== current.settings.currency) labels.push(`currency ${patch.currency}`);
        if (patch.shopName && patch.shopName !== current.settings.shopName) labels.push('shop name');
        if (
          patch.notifications &&
          JSON.stringify({ ...current.settings.notifications, ...patch.notifications }) !==
            JSON.stringify(current.settings.notifications)
        ) {
          labels.push('notification preferences');
        }
        return {
          ...current,
          settings,
          activity:
            labels.length > 0
              ? pushActivity(current, activityEntry('settings', 'Settings updated', labels.join(', ')))
              : current.activity,
        };
      });
    },
    [commit],
  );

  const resetDemoData = useCallback(() => {
    const fresh = createFreshState();
    const withResetActivity: PersistedState = {
      ...fresh,
      settings: DEFAULT_SETTINGS,
      activity: [
        activityEntry(
          'reset',
          'Demo data reset',
          'Demo products, suppliers and sample sales history restored; reviews cleared',
        ),
        ...fresh.activity,
      ],
    };
    commit(() => withResetActivity);
  }, [commit]);

  const importProducts = useCallback(
    (valid: ProductInput[]) => {
      const current = stateRef.current;
      if (!current) return { added: 0, updated: 0 };
      const existingSkus = new Set(current.products.map((product) => product.sku.trim().toLowerCase()));
      const added = valid.filter((input) => !existingSkus.has(input.sku.trim().toLowerCase())).length;
      const updated = valid.length - added;
      const now = new Date().toISOString();
      commit((state) => {
        const products = [...state.products];
        // A CSV carries a supplier *name*; link it to a supplier record when
        // one matches, without ever creating a supplier implicitly.
        const supplierIdByName = new Map(
          state.suppliers.map((supplier) => [supplier.name.trim().toLowerCase(), supplier.id]),
        );
        const linkSupplier = (input: ProductInput): string | null => {
          if (input.supplierId) return input.supplierId;
          const name = input.supplierName?.trim().toLowerCase();
          return name ? (supplierIdByName.get(name) ?? null) : null;
        };
        for (const input of valid) {
          const index = products.findIndex(
            (product) => product.sku.trim().toLowerCase() === input.sku.trim().toLowerCase(),
          );
          const supplierId = linkSupplier(input);
          if (index >= 0) {
            products[index] = {
              ...products[index],
              ...input,
              supplierId,
              sku: input.sku.trim().toUpperCase(),
              updatedAt: now,
            };
          } else {
            products.push({
              ...input,
              supplierId,
              sku: input.sku.trim().toUpperCase(),
              id: uid(),
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        const notification: AppNotification | null =
          state.settings.notifications.dataUpdates && notificationsEnabled
            ? {
                id: uid(),
                kind: 'import',
                severity: 'success',
                title: 'Inventory imported',
                body: `${added} product${added === 1 ? '' : 's'} added${updated > 0 ? `, ${updated} updated` : ''}. Metrics have been recalculated.`,
                createdAt: now,
                read: false,
                link: '/inventory',
              }
            : null;
        return {
          ...state,
          products,
          activity: pushActivity(
            state,
            activityEntry(
              'import',
              `Imported ${added + updated} product${added + updated === 1 ? '' : 's'}`,
              `${added} added · ${updated} updated`,
            ),
          ),
          notifications: notification
            ? [notification, ...state.notifications].slice(0, 50)
            : state.notifications,
        };
      });
      return { added, updated };
    },
    [commit, notificationsEnabled],
  );

  const toggleReviewKey = useCallback(
    (productId: string, key: string, productName: string) => {
      commit((current) => {
        const exists = current.reviews.some(
          (review) => review.productId === productId && review.actionKey === key,
        );
        const reviews: ReviewRecord[] = exists
          ? current.reviews.filter(
              (review) => !(review.productId === productId && review.actionKey === key),
            )
          : [...current.reviews, { productId, actionKey: key, reviewedAt: new Date().toISOString() }];
        return {
          ...current,
          reviews,
          activity: pushActivity(
            current,
            activityEntry(
              'reviewed',
              exists ? `Reopened action for ${productName}` : `Reviewed action for ${productName}`,
              exists ? 'Marked as needing review' : 'Marked as reviewed',
            ),
          ),
        };
      });
    },
    [commit],
  );

  const toggleReview = useCallback(
    (insight: ProductInsight) => {
      if (!insight.actionKey) return;
      toggleReviewKey(insight.product.id, insight.actionKey, insight.product.name);
    },
    [toggleReviewKey],
  );

  const markNotificationRead = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        notifications: current.notifications.map((item) =>
          item.id === id ? { ...item, read: true } : item,
        ),
      }));
    },
    [commit],
  );

  const markAllNotificationsRead = useCallback(() => {
    commit((current) => ({
      ...current,
      notifications: current.notifications.map((item) => ({ ...item, read: true })),
    }));
  }, [commit]);

  const dismissNotification = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        notifications: current.notifications.filter((item) => item.id !== id),
      }));
    },
    [commit],
  );

  const clearActivity = useCallback(() => {
    commit((current) => ({ ...current, activity: [] }));
  }, [commit]);

  const state = stateRef.current;
  const insights = useMemo(
    () => (state ? buildInsights(state.products, state.settings) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state?.products, state?.settings],
  );
  const actionQueue = useMemo(() => buildActionQueue(insights), [insights]);
  const reviewedKeys = useMemo(
    () => new Set((state?.reviews ?? []).map((review) => review.actionKey)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state?.reviews],
  );
  const metrics = useMemo(
    () => computeMetrics(insights, [...reviewedKeys]),
    [insights, reviewedKeys],
  );
  const briefing = useMemo(
    () => (state ? buildBriefing(insights, state.settings) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insights, state?.settings],
  );

  const value: StockoraContextValue = {
    products: state?.products ?? [],
    suppliers: state?.suppliers ?? [],
    sales: state?.sales ?? [],
    salesTrackingSince: state?.salesTrackingSince ?? null,
    saleOrders: state?.saleOrders ?? [],
    inventoryMovements: state?.inventoryMovements ?? [],
    settings: state?.settings ?? DEFAULT_SETTINGS,
    activity: state?.activity ?? [],
    notifications: state?.notifications ?? [],
    insights,
    actionQueue,
    metrics,
    briefing,
    reviewedKeys,
    reviewedCount: state?.reviews.length ?? 0,
    lastSavedAt,
    persistenceError,
    loading,
    loadError,
    createProduct,
    updateProduct,
    deleteProduct,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    importSales,
    clearSalesHistory,
    updateSettings,
    resetDemoData,
    importProducts,
    toggleReview,
    toggleReviewKey,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    refreshFromStorage,
    clearActivity,
  };

  return <StockoraContext.Provider value={value}>{children}</StockoraContext.Provider>;
}

export function useStockora(): StockoraContextValue {
  const context = useContext(StockoraContext);
  if (!context) throw new Error('useStockora must be used inside StockoraProvider');
  return context;
}

export { STATE_VERSION };
