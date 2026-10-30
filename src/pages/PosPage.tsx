import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  Receipt,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useStockora } from '../store/StockoraContext';
import { useAction } from '../auth/AuthContext';
import { ApiError, apiFetch } from '../auth/api';
import { PageHeader } from '../components/PageHeader';
// The camera decoder is a sizeable dependency and most tills use USB scanners,
// so it is only fetched when the cashier actually opens the camera.
const CameraScanner = lazy(() =>
  import('../components/pos/CameraScanner').then((module) => ({ default: module.CameraScanner })),
);
import { ReceiptModal } from '../components/pos/ReceiptModal';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SectionCard,
  Spinner,
  TextInput,
  cn,
} from '../components/ui';
import { useToast } from '../components/toast';
import {
  addScanToCart,
  computeTotals,
  posSettings,
  removeFromCart,
  setCartQuantity,
  type CartItem,
} from '../lib/pos';
import type { PosProduct } from '../lib/pos';
import { formatCurrency } from '../lib/format';
import { PAYMENT_METHOD_LABELS, type PaymentMethod, type SaleOrder } from '../types';

/**
 * Scan & Sell — the barcode till.
 *
 * Rules this page enforces (all re-checked by the Worker):
 *  - Scanning only adds to the on-screen cart; stock is deducted exclusively
 *    by the server when the checkout completes.
 *  - Prices come from the server lookup, never from anything typed here.
 *  - One idempotency key per cart, persisted with it, so a retry after a
 *    network failure or refresh cannot record the sale twice.
 *  - The global keyboard listener lets a USB scanner type without clicking
 *    the input first, while never stealing focus from other fields or dialogs.
 */

const CART_KEY = 'stockora.pos.cart.v2';
/** One physical scan produces Enter within this window; ignore the duplicate. */
const SCAN_DEDUPE_MS = 400;

interface StoredCart {
  items: CartItem[];
  idempotencyKey: string;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function loadStoredCart(): StoredCart {
  try {
    const raw = window.sessionStorage.getItem(CART_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredCart;
      if (Array.isArray(parsed.items) && typeof parsed.idempotencyKey === 'string') {
        return parsed;
      }
    }
  } catch {
    // Corrupt or unavailable storage simply means a fresh cart.
  }
  return { items: [], idempotencyKey: newIdempotencyKey() };
}

type ScanFeedback = {
  kind: 'blocked' | 'error';
  title: string;
  detail: string;
  code?: string;
};

export default function PosPage() {
  const { products, settings, saleOrders, refreshFromStorage, loading } = useStockora();
  const toast = useToast();

  const canSell = useAction('pos', 'create');
  const canDiscount = useAction('pos', 'edit');
  const canCancel = useAction('pos', 'delete');
  const canEditInventory = useAction('inventory', 'edit');

  const posConfig = posSettings(settings);
  const currency = settings.currency;

  // ---- Cart state (kept across recoverable failures and page refreshes)
  const initial = useRef(loadStoredCart());
  const [cart, setCart] = useState<CartItem[]>(initial.current.items);
  const [idempotencyKey, setIdempotencyKey] = useState(initial.current.idempotencyKey);

  const [code, setCode] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [lastScan, setLastScan] = useState<{ name: string; at: number } | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ product: PosProduct; issues: string[] }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    posConfig.paymentMethods[0] ?? 'cash',
  );
  const [amountReceived, setAmountReceived] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [receiptOrder, setReceiptOrder] = useState<SaleOrder | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastSubmitRef = useRef<{ code: string; at: number } | null>(null);

  const overlayOpen = cameraOpen || searchOpen || receiptOrder !== null || clearOpen;

  // Persist the cart (with its transaction ID) so an accidental refresh does
  // not lose the sale — or, worse, generate a second transaction ID.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(CART_KEY, JSON.stringify({ items: cart, idempotencyKey }));
    } catch {
      // Storage full/blocked: the cart still works for this session.
    }
  }, [cart, idempotencyKey]);

  // Keep displayed stock in step with the server after any refresh (another
  // till may have sold the same product).
  useEffect(() => {
    setCart((items) => {
      let changed = false;
      const next = items.map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (product && product.currentStock !== item.availableStock) {
          changed = true;
          return { ...item, availableStock: product.currentStock };
        }
        return item;
      });
      return changed ? next : items;
    });
  }, [products]);

  // Keep the payment method valid if the shop reconfigures its list.
  useEffect(() => {
    if (!posConfig.paymentMethods.includes(paymentMethod)) {
      setPaymentMethod(posConfig.paymentMethods[0] ?? 'cash');
    }
  }, [posConfig.paymentMethods, paymentMethod]);

  const focusScanner = useCallback(() => {
    if (!overlayOpen) inputRef.current?.focus();
  }, [overlayOpen]);

  // ---- Global keyboard-wedge handling: scanning must not require a click.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (overlayOpen) return;
      const target = event.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inField) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length === 1) {
        // Printable character typed anywhere on the page goes to the scanner box.
        event.preventDefault();
        setCode((current) => current + event.key);
        setFeedback(null);
        inputRef.current?.focus();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.form?.requestSubmit();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [overlayOpen]);

  const totals = useMemo(
    () =>
      computeTotals(
        cart.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRatePct: item.taxRatePct,
          lineDiscountPct: item.lineDiscountPct,
        })),
        Number(orderDiscount) || 0,
        posConfig.taxInclusive,
      ),
    [cart, orderDiscount, posConfig.taxInclusive],
  );

  const amountNumber = amountReceived.trim() === '' ? null : Number(amountReceived);
  const changeDue =
    amountNumber !== null && Number.isFinite(amountNumber)
      ? Math.max(0, amountNumber - totals.total)
      : null;

  // ---- Lookup ----------------------------------------------------------------

  const addProduct = useCallback(
    (product: PosProduct, issues: string[]) => {
      if (issues.includes('expired')) {
        setFeedback({
          kind: 'blocked',
          title: 'Expired — cannot be sold',
          detail: `${product.name} passed its expiry date and is blocked at checkout.`,
          code: product.barcode ?? undefined,
        });
        toast.error('Expired product', `${product.name} cannot be sold.`);
        return;
      }
      if (issues.includes('inactive')) {
        setFeedback({
          kind: 'blocked',
          title: 'Not available for sale',
          detail: `${product.name} is switched off for selling in Inventory.`,
          code: product.barcode ?? undefined,
        });
        return;
      }
      if (issues.includes('price_missing') || product.sellingPrice === null) {
        setFeedback({
          kind: 'blocked',
          title: 'No selling price',
          detail: `Set a selling price for ${product.name} in Inventory before selling it.`,
          code: product.barcode ?? undefined,
        });
        return;
      }
      if (issues.includes('out_of_stock') || product.currentStock <= 0) {
        setFeedback({
          kind: 'blocked',
          title: 'Out of stock',
          detail: `${product.name} has no stock left.`,
          code: product.barcode ?? undefined,
        });
        return;
      }

      setCart((items) => addScanToCart(items, product));
      setFeedback(null);
      setLastScan({ name: product.name, at: Date.now() });
      if (issues.includes('near_expiry')) {
        toast.info(
          'Near expiry',
          `${product.name} expires in ${product.daysRemaining} day${product.daysRemaining === 1 ? '' : 's'}.`,
        );
      }
      focusScanner();
    },
    [focusScanner, toast],
  );

  const handleCode = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      const now = Date.now();
      const previous = lastSubmitRef.current;
      // Rapid duplicate Enter from a single scan: ignore, but keep scanning ready.
      if (previous && previous.code === value && now - previous.at < SCAN_DEDUPE_MS) {
        setCode('');
        return;
      }
      lastSubmitRef.current = { code: value, at: now };
      setCode('');
      setLookingUp(true);
      setFeedback(null);
      try {
        const payload = await apiFetch<{
          found: boolean;
          product: PosProduct;
          issues: string[];
        }>(`/api/pos/lookup?code=${encodeURIComponent(value)}`);
        addProduct(payload.product, payload.issues ?? []);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setFeedback({
            kind: 'error',
            title: 'Product not found',
            detail: `No product in ${settings.shopName} has the barcode ${value}. Search your products or assign this barcode in Inventory — nothing is created automatically.`,
            code: value,
          });
        } else if (error instanceof ApiError) {
          setFeedback({
            kind: 'error',
            title: 'Lookup failed',
            detail: error.message,
            code: value,
          });
        } else {
          setFeedback({
            kind: 'error',
            title: 'Cannot reach the server',
            detail: 'Check your connection and try the scan again. Nothing was added to the cart.',
            code: value,
          });
        }
        focusScanner();
      } finally {
        setLookingUp(false);
      }
    },
    [addProduct, focusScanner, settings.shopName],
  );

  // ---- Search ----------------------------------------------------------------

  useEffect(() => {
    if (!searchOpen) return;
    const query = searchQuery.trim();
    if (query === '') {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      apiFetch<{ products: Array<{ product: PosProduct; issues: string[] }> }>(
        `/api/pos/search?q=${encodeURIComponent(query)}`,
      )
        .then((payload) => {
          if (cancelled) return;
          setSearchResults(payload.products ?? []);
          setSearchError(null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchError(error instanceof ApiError ? error.message : 'Search failed. Try again.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchQuery]);

  // ---- Cart edits ------------------------------------------------------------

  const changeQuantity = (productId: string, quantity: number) => {
    const result = setCartQuantity(cart, productId, quantity);
    if (result.error) {
      toast.error('Quantity not changed', result.error);
      return;
    }
    setCart(result.items);
  };

  const clearCart = () => {
    setCart([]);
    setIdempotencyKey(newIdempotencyKey());
    setOrderDiscount('');
    setAmountReceived('');
    setPaymentConfirmed(false);
    setCheckoutError(null);
    setClearOpen(false);
    focusScanner();
  };

  // ---- Checkout --------------------------------------------------------------

  const completeSale = async () => {
    if (busy || cart.length === 0 || !canSell) return;
    setBusy(true);
    setCheckoutError(null);
    const orderDiscountPct = Number(orderDiscount) || 0;
    if (orderDiscountPct > 0 && !canDiscount) {
      setCheckoutError('You are not allowed to apply discounts.');
      setBusy(false);
      return;
    }
    try {
      const payload = await apiFetch<{ order: SaleOrder; duplicate: boolean }>(
        '/api/pos/checkout',
        {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey,
            lines: cart.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              lineDiscountPct: item.lineDiscountPct || undefined,
            })),
            orderDiscountPct: orderDiscountPct || undefined,
            paymentMethod,
            amountReceived: amountNumber,
            paymentConfirmed: posConfig.requirePaymentConfirmation ? paymentConfirmed : true,
          }),
        },
      );
      const order = payload.order;
      setReceiptOrder(order);
      if (order.status === 'completed') {
        toast.success(
          `Sale ${order.receiptNumber} completed`,
          `Stock updated for ${order.lines.length} product${order.lines.length === 1 ? '' : 's'} · ${formatCurrency(order.total, currency)}`,
        );
      } else {
        toast.info(
          `Sale ${order.receiptNumber} pending payment`,
          'Confirm payment to deduct stock. Nothing has been removed yet.',
        );
      }
      setCart([]);
      setIdempotencyKey(newIdempotencyKey());
      setOrderDiscount('');
      setAmountReceived('');
      setPaymentConfirmed(false);
      await refreshFromStorage();
    } catch (error) {
      if (error instanceof ApiError) {
        setCheckoutError(error.message);
        if (error.status === 409 || error.code === 'immutable_ledger') {
          // Stock or state moved underneath us — refresh so the cashier sees
          // current figures, but keep the cart and the same transaction ID.
          await refreshFromStorage().catch(() => undefined);
        }
      } else {
        setCheckoutError(
          'Connection problem — the sale was NOT recorded and no stock was deducted. Retrying is safe: this cart keeps the same transaction ID.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingPayment = async (orderId: string) => {
    try {
      await apiFetch(`/api/pos/orders/${encodeURIComponent(orderId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast.success('Payment confirmed', 'Stock has been deducted for this sale.');
      await refreshFromStorage();
    } catch (error) {
      toast.error(
        'Could not confirm payment',
        error instanceof ApiError ? error.message : 'Check your connection and try again.',
      );
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      await apiFetch(`/api/pos/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast.success('Transaction cancelled', 'No stock was deducted.');
      await refreshFromStorage();
    } catch (error) {
      toast.error(
        'Could not cancel',
        error instanceof ApiError ? error.message : 'Check your connection and try again.',
      );
    }
  };

  const recentOrders = useMemo(
    () => [...saleOrders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8),
    [saleOrders],
  );
  const todaysSales = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return saleOrders
      .filter((order) => order.status === 'completed' && order.soldAt === today)
      .reduce((sum, order) => sum + order.total, 0);
  }, [saleOrders]);
  const todaysCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return saleOrders.filter((order) => order.status === 'completed' && order.soldAt === today)
      .length;
  }, [saleOrders]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
        <Spinner className="h-7 w-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Point of Sale"
        title="Scan & Sell"
        description={`Scan a barcode or search a product, take payment, and ${settings.shopName}'s stock updates automatically when the sale completes.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary" icon={<Receipt className="h-3 w-3" aria-hidden="true" />}>
              Today: {formatCurrency(todaysSales, currency)} · {todaysCount} sale
              {todaysCount === 1 ? '' : 's'}
            </Badge>
            <Badge tone={posConfig.requirePaymentConfirmation ? 'warn' : 'ok'}>
              {posConfig.requirePaymentConfirmation ? 'Confirm payment to complete' : 'Auto-complete on sale'}
            </Badge>
            <Badge tone="info">{posConfig.taxInclusive ? 'Prices include tax' : 'Tax added at checkout'}</Badge>
          </div>
        }
      />

      {!canSell ? (
        <Card className="p-5">
          <EmptyState
            icon={<ScanBarcode className="h-5 w-5 text-muted" aria-hidden="true" />}
            title="Selling is switched off for your account"
            description="Your administrator has not granted you permission to record sales. You can still browse inventory."
          />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* ---------------- Scanner ---------------- */}
          <Card className="p-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCode(code);
              }}
              className="space-y-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <ScanBarcode
                    className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary"
                    aria-hidden="true"
                  />
                  <label htmlFor="pos-barcode-input" className="sr-only">
                    Barcode
                  </label>
                  <input
                    id="pos-barcode-input"
                    ref={inputRef}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="Scan a barcode or type it and press Enter…"
                    autoComplete="off"
                    inputMode="text"
                    className="tnum h-12 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-base font-semibold tracking-wide text-ink placeholder:text-[13px] placeholder:font-normal placeholder:tracking-normal placeholder:text-muted/80 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" loading={lookingUp} className="h-12 flex-1 sm:flex-none">
                    Look up
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12"
                    icon={<Camera className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setCameraOpen(true)}
                  >
                    Camera
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12"
                    icon={<Search className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => {
                      setSearchOpen(true);
                      setSearchQuery('');
                    }}
                  >
                    Search
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
                  Keyboard scanner ready — scan anywhere on this page; no clicking needed.
                </span>
                {lastScan ? (
                  <span className="font-semibold text-primary-dark">
                    Last scanned: {lastScan.name}
                  </span>
                ) : null}
              </div>
            </form>

            {feedback ? (
              <div
                role="alert"
                className={cn(
                  'mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm',
                  feedback.kind === 'blocked'
                    ? 'border-crit/30 bg-crit-soft text-[#991B1B]'
                    : 'border-warn/40 bg-warn-soft text-[#78350F]',
                )}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {feedback.title}
                    {feedback.code ? <span className="tnum ml-2 font-normal">{feedback.code}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5">{feedback.detail}</p>
                  {feedback.kind === 'error' && feedback.code ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSearchOpen(true);
                          setSearchQuery(feedback.code ?? '');
                        }}
                      >
                        Search products
                      </Button>
                      {canEditInventory ? (
                        <Button size="sm" variant="ghost" onClick={() => (window.location.href = '/inventory')}>
                          Assign barcode in Inventory
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setFeedback(null)}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  className="rounded p-1 text-muted/60 hover:bg-white/40"
                  aria-label="Dismiss scan message"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </Card>

          {/* ---------------- Cart ---------------- */}
          <SectionCard
            title={`Cart · ${cart.length} product${cart.length === 1 ? '' : 's'}`}
            description={
              cart.length === 0
                ? 'Scan a barcode or search to start a sale.'
                : 'Repeated scans of the same product increase its quantity.'
            }
            icon={<Receipt className="h-4 w-4" aria-hidden="true" />}
            action={
              cart.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setClearOpen(true)}>
                  Clear cart
                </Button>
              ) : null
            }
            bodyClassName="p-0"
          >
            {cart.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<ScanBarcode className="h-5 w-5 text-muted" aria-hidden="true" />}
                  title="No items yet"
                  description="Scan a product barcode, use the camera, or search for a product to add it here. Scanning alone never changes stock."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {cart.map((item) => {
                  const lineTotals = computeTotals(
                    [
                      {
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        taxRatePct: item.taxRatePct,
                        lineDiscountPct: item.lineDiscountPct,
                      },
                    ],
                    0,
                    posConfig.taxInclusive,
                  ).lines[0];
                  const lowStock = item.quantity >= item.availableStock;
                  return (
                    <li key={item.productId} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
                          <p className="tnum mt-0.5 text-[11px] text-muted">
                            {item.sku}
                            {item.barcode ? ` · ${item.barcode}` : ''} · stock{' '}
                            <span className={cn(lowStock && 'font-bold text-warn')}>
                              {item.availableStock}
                            </span>
                            {item.unit ? ` ${item.unit}` : ''}
                          </p>
                          {item.nearExpiry ? (
                            <p className="mt-0.5 text-[11px] font-medium text-warn">
                              Expires in {item.daysRemaining} day{item.daysRemaining === 1 ? '' : 's'} — review before selling.
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center rounded-lg border border-line bg-white">
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.productId, item.quantity - 1)}
                              className="flex h-8 w-8 items-center justify-center text-muted hover:text-ink"
                              aria-label={`Decrease ${item.name} quantity`}
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <input
                              type="number"
                              value={item.quantity}
                              min={1}
                              step={item.allowFractional ? 0.1 : 1}
                              onChange={(event) =>
                                changeQuantity(item.productId, Number(event.target.value))
                              }
                              aria-label={`${item.name} quantity`}
                              className="tnum h-8 w-12 border-x border-line text-center text-sm font-bold text-ink focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.productId, item.quantity + 1)}
                              className="flex h-8 w-8 items-center justify-center text-muted hover:text-ink"
                              aria-label={`Increase ${item.name} quantity`}
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          <div className="w-24 text-right">
                            <p className="tnum text-sm font-bold text-ink">
                              {formatCurrency(lineTotals.lineTotal, currency)}
                            </p>
                            <p className="tnum text-[11px] text-muted">
                              {formatCurrency(item.unitPrice, currency)} each
                              {item.taxRatePct > 0 ? ` · GST ${item.taxRatePct}%` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCart(removeFromCart(cart, item.productId))}
                            className="rounded-lg p-2 text-muted hover:bg-crit-soft hover:text-crit"
                            aria-label={`Remove ${item.name} from cart`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* ---------------- Payment & totals ---------------- */}
        <div className="space-y-4">
          <SectionCard
            title="Payment"
            icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            description="Stock is deducted only when this sale completes."
          >
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="tnum font-medium text-ink">{formatCurrency(totals.subtotal, currency)}</dd>
              </div>
              {totals.lineDiscountTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">Item discounts</dt>
                  <dd className="tnum font-medium text-warn">
                    −{formatCurrency(totals.lineDiscountTotal, currency)}
                  </dd>
                </div>
              ) : null}
              {totals.orderDiscountTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">Order discount</dt>
                  <dd className="tnum font-medium text-warn">
                    −{formatCurrency(totals.orderDiscountTotal, currency)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted">Tax{posConfig.taxInclusive ? ' (included)' : ''}</dt>
                <dd className="tnum font-medium text-ink">{formatCurrency(totals.taxTotal, currency)}</dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
                <dt className="text-sm font-semibold text-ink">Total payable</dt>
                <dd className="tnum text-2xl font-bold text-primary-dark">
                  {formatCurrency(totals.total, currency)}
                </dd>
              </div>
            </dl>

            <div className="mt-4 space-y-3">
              {canDiscount ? (
                <label className="block text-xs font-semibold text-ink">
                  Order discount (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={orderDiscount}
                    onChange={(event) => setOrderDiscount(event.target.value)}
                    placeholder="0"
                    className="input-base tnum mt-1"
                  />
                </label>
              ) : null}

              <div>
                <span className="text-xs font-semibold text-ink">Payment method</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {posConfig.paymentMethods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      aria-pressed={paymentMethod === method}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                        paymentMethod === method
                          ? 'border-primary bg-primary-soft text-primary-dark'
                          : 'border-line bg-white text-muted hover:border-[#CBD5E1]',
                      )}
                    >
                      {PAYMENT_METHOD_LABELS[method] ?? method}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  Recorded as cashier-confirmed — no payment gateway is connected.
                </p>
              </div>

              {paymentMethod === 'cash' ? (
                <label className="block text-xs font-semibold text-ink">
                  Amount received ({currency})
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={amountReceived}
                    onChange={(event) => setAmountReceived(event.target.value)}
                    placeholder={totals.total.toFixed(2)}
                    className="input-base tnum mt-1"
                  />
                  {changeDue !== null ? (
                    <span className="mt-1 block text-[13px] font-semibold text-primary-dark">
                      Change due: {formatCurrency(changeDue, currency)}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {posConfig.requirePaymentConfirmation ? (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-canvas/60 p-2.5 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={paymentConfirmed}
                    onChange={(event) => setPaymentConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary"
                  />
                  <span>
                    Payment received for this{' '}
                    {(PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod).toLowerCase()} sale —
                    complete it now and deduct stock.
                  </span>
                </label>
              ) : null}

              {checkoutError ? (
                <p role="alert" className="rounded-lg border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] font-medium text-[#991B1B]">
                  {checkoutError}
                </p>
              ) : null}

              <Button
                className="w-full"
                size="lg"
                loading={busy}
                disabled={cart.length === 0 || !canSell}
                onClick={() => void completeSale()}
              >
                {posConfig.requirePaymentConfirmation && !paymentConfirmed
                  ? 'Save as pending payment'
                  : `Complete sale · ${formatCurrency(totals.total, currency)}`}
              </Button>
              <p className="text-[11px] leading-4 text-muted">
                Double-pressing is safe: this cart carries a unique transaction ID, so a retry
                returns the same sale instead of deducting stock twice.
              </p>
            </div>
          </SectionCard>

          {/* ---------------- Recent transactions ---------------- */}
          <SectionCard
            title="Recent transactions"
            description="Newest first · receipts can be reprinted."
            icon={<Receipt className="h-4 w-4" aria-hidden="true" />}
            bodyClassName="p-0"
          >
            {recentOrders.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs text-muted">No transactions yet today.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recentOrders.map((order) => (
                  <li key={order.id} className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setReceiptOrder(order)}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`Open receipt ${order.receiptNumber}`}
                    >
                      <span className="tnum block truncate text-[13px] font-semibold text-ink">
                        {order.receiptNumber}
                      </span>
                      <span className="tnum block text-[11px] text-muted">
                        {formatCurrency(order.total, currency)} ·{' '}
                        {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod} ·{' '}
                        {order.lines.length} item{order.lines.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    <Badge tone={order.status === 'completed' ? 'ok' : order.status === 'cancelled' ? 'neutral' : 'warn'}>
                      {order.status === 'completed'
                        ? 'Paid'
                        : order.status === 'cancelled'
                          ? 'Cancelled'
                          : 'Pending'}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setReceiptOrder(order)}
                      className="rounded p-1.5 text-muted hover:bg-canvas hover:text-ink"
                      aria-label={`Print receipt ${order.receiptNumber}`}
                    >
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {order.status === 'pending_payment' && canSell ? (
                      <Button size="sm" variant="soft" onClick={() => void confirmPendingPayment(order.id)}>
                        Confirm
                      </Button>
                    ) : null}
                    {order.status === 'pending_payment' && canCancel ? (
                      <Button size="sm" variant="ghost" onClick={() => void cancelOrder(order.id)}>
                        Cancel
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ---------------- Overlays ---------------- */}
      {cameraOpen ? (
        <Suspense fallback={null}>
          <CameraScanner
            open
            onClose={() => {
              setCameraOpen(false);
              focusScanner();
            }}
            onDetect={(detected) => {
              void handleCode(detected);
            }}
          />
        </Suspense>
      ) : null}

      {searchOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/50 p-3 pt-[8vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Search products"
        >
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-modal">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Search products</h2>
                <p className="text-[11px] text-muted">Name, SKU or barcode — same lookup as scanning.</p>
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-ink"
                aria-label="Close search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="border-b border-line p-3">
              <label htmlFor="pos-search-input" className="sr-only">
                Search products
              </label>
              <TextInput
                id="pos-search-input"
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Butter, R101, 8901234…"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {searching ? (
                <p className="px-4 py-6 text-center text-sm text-muted">Searching…</p>
              ) : searchError ? (
                <p className="px-4 py-6 text-center text-sm text-crit">{searchError}</p>
              ) : searchResults.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  {searchQuery.trim() === '' ? 'Type to search your catalogue.' : 'No matching products.'}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {searchResults.map(({ product, issues }) => {
                    const blocked =
                      !product.active ||
                      product.sellingPrice === null ||
                      product.expired ||
                      product.currentStock <= 0;
                    return (
                      <li key={product.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                          <p className="tnum text-[11px] text-muted">
                            {product.sku} · {formatCurrency(product.sellingPrice ?? 0, currency)} · stock{' '}
                            {product.currentStock}
                            {issues.includes('near_expiry') ? ' · near expiry' : ''}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={blocked}
                          onClick={() => {
                            addProduct(product, issues);
                            setSearchOpen(false);
                          }}
                        >
                          {blocked ? (product.expired ? 'Expired' : 'Not sellable') : 'Add'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <ReceiptModal
        open={receiptOrder !== null}
        order={receiptOrder}
        settings={settings}
        onClose={() => setReceiptOrder(null)}
      />

      <ConfirmDialog
        open={clearOpen}
        title="Clear the cart?"
        message={`${cart.length} item${cart.length === 1 ? '' : 's'} will be removed. No sale has been recorded and no stock has changed.`}
        confirmLabel="Clear cart"
        destructive
        onCancel={() => setClearOpen(false)}
        onConfirm={clearCart}
      />
    </div>
  );
}
