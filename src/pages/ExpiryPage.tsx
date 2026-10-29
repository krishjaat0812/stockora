import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Download,
  Eye,
  FilterX,
  ShieldAlert,
} from 'lucide-react';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, EmptyState, Select, TextInput, cn } from '../components/ui';
import { ExpiryStatusBadge, StockStatusBadge } from '../components/inventory-badges';
import { ProductDetailDrawer } from '../components/ProductDetailDrawer';
import { useToast } from '../components/toast';
import {
  EXPIRY_GROUP_META,
  expiryGroupFor,
  type ExpiryGroupKey,
} from '../lib/inventory';
import { expiryTable, fileStamp } from '../lib/csv';
import { ExportDeniedError, exportCsv } from '../lib/download';
import { useAction } from '../auth/AuthContext';
import { formatDate } from '../lib/date';

type WindowFilter = 'all' | 'near-expiry' | 'expired' | ExpiryGroupKey;

const WINDOW_OPTIONS: Array<{ value: WindowFilter; label: string }> = [
  { value: 'all', label: 'All expiry dates' },
  { value: 'near-expiry', label: 'Near expiry (within threshold)' },
  { value: 'expired', label: 'Expired only' },
  { value: 'today', label: 'Expires today' },
  { value: 'd1-3', label: 'Within 1–3 days' },
  { value: 'd4-7', label: 'Within 4–7 days' },
  { value: 'later', label: 'Later than 7 days' },
  { value: 'missing', label: 'Missing expiry date' },
];

const GROUP_ORDER: ExpiryGroupKey[] = ['expired', 'today', 'd1-3', 'd4-7', 'later', 'missing'];

const GROUP_STYLES: Record<ExpiryGroupKey, { border: string; chip: string; icon: JSX.Element }> = {
  expired: {
    border: 'border-l-crit',
    chip: 'bg-crit-soft text-[#991B1B]',
    icon: <ShieldAlert className="h-4 w-4 text-crit" aria-hidden="true" />,
  },
  today: {
    border: 'border-l-crit',
    chip: 'bg-crit-soft text-[#991B1B]',
    icon: <AlertTriangle className="h-4 w-4 text-crit" aria-hidden="true" />,
  },
  'd1-3': {
    border: 'border-l-warn',
    chip: 'bg-warn-soft text-[#92400E]',
    icon: <CalendarClock className="h-4 w-4 text-warn" aria-hidden="true" />,
  },
  'd4-7': {
    border: 'border-l-info',
    chip: 'bg-info-soft text-[#1E40AF]',
    icon: <CalendarClock className="h-4 w-4 text-info" aria-hidden="true" />,
  },
  later: {
    border: 'border-l-line',
    chip: 'bg-canvas text-muted',
    icon: <CalendarClock className="h-4 w-4 text-ok" aria-hidden="true" />,
  },
  missing: {
    border: 'border-l-line',
    chip: 'bg-canvas text-muted',
    icon: <CalendarX className="h-4 w-4 text-muted" aria-hidden="true" />,
  },
};

export default function ExpiryPage() {
  const { insights, settings, metrics } = useStockora();
  const toast = useToast();
  const canExport = useAction('csv_export', 'export');
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailId, setDetailId] = useState<string | null>(null);

  const category = searchParams.get('category') ?? 'all';
  const windowParam = (searchParams.get('group') ?? 'all') as WindowFilter;
  const windowFilter = WINDOW_OPTIONS.some((option) => option.value === windowParam) ? windowParam : 'all';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const categories = useMemo(
    () => [...new Set(insights.map((insight) => insight.product.category))].sort((a, b) => a.localeCompare(b)),
    [insights],
  );

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const filtered = useMemo(
    () =>
      insights.filter((insight) => {
        if (category !== 'all' && insight.product.category !== category) return false;
        if (from || to) {
          const expiry = insight.product.expiryDate;
          if (!expiry) return false;
          if (from && expiry < from) return false;
          if (to && expiry > to) return false;
        }
        if (windowFilter === 'all') return true;
        if (windowFilter === 'near-expiry') return insight.isNearExpiry;
        return expiryGroupFor(insight.daysRemaining) === windowFilter;
      }),
    [insights, category, from, to, windowFilter],
  );

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((key) => ({
        key,
        ...EXPIRY_GROUP_META[key],
        items: filtered
          .filter((insight) => expiryGroupFor(insight.daysRemaining) === key)
          .sort((a, b) => {
            if (a.daysRemaining === null && b.daysRemaining === null) return a.product.name.localeCompare(b.product.name);
            if (a.daysRemaining === null) return 1;
            if (b.daysRemaining === null) return -1;
            return a.daysRemaining - b.daysRemaining;
          }),
      })).filter((group) => group.items.length > 0),
    [filtered],
  );

  const detailInsight = insights.find((insight) => insight.product.id === detailId) ?? null;
  const hasFilters = category !== 'all' || windowFilter !== 'all' || Boolean(from) || Boolean(to);

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const exportExpiry = async () => {
    try {
      await exportCsv(`stockora-expiry-${fileStamp()}.csv`, expiryTable(filtered), 'expiry');
    } catch (err) {
      toast.error(
        'Export not allowed',
        err instanceof ExportDeniedError ? err.message : 'Export failed. Try again.',
      );
      return;
    }
    toast.success(
      'Expiry monitor exported',
      `${filtered.length} product${filtered.length === 1 ? '' : 's'} exported with the current filters.`,
    );
  };

  const quickCounts = useMemo(() => {
    const count = (key: ExpiryGroupKey) =>
      insights.filter((insight) => expiryGroupFor(insight.daysRemaining) === key).length;
    return {
      expired: count('expired'),
      today: count('today'),
      d1: count('d1-3'),
      d4: count('d4-7'),
      missing: count('missing'),
    };
  }, [insights]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expiry Monitor"
        description={`Grouped shelf-life risk using your ${settings.expiryThreshold}-day near-expiry threshold. Expired stock is always separated from sellable stock.`}
        actions={
          canExport ? (
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void exportExpiry()}
              disabled={filtered.length === 0}
            >
              Export CSV
            </Button>
          ) : null
        }
      />

      <div className="rounded-xl border border-crit/20 bg-crit-soft/40 p-3.5">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-crit" aria-hidden="true" />
          <div className="text-[12px] leading-5 text-[#7F1D1D]">
            <p className="font-semibold">Expired products must not be sold, discounted or distributed.</p>
            <p className="mt-0.5">
              Remove them from sale and follow applicable safety and disposal procedures. For products approaching
              expiry, rotate stock and only use markdowns where the product is still eligible for sale.
            </p>
            <p className="mt-1 text-[11px] text-[#991B1B]">
              Expiry dates are recorded inventory data, not a food-safety guarantee. Check packaging and local rules.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Expired', value: quickCounts.expired, tone: 'text-crit', sub: 'Remove from sale' },
          { label: 'Expires today', value: quickCounts.today, tone: 'text-crit', sub: 'Check before selling' },
          { label: 'Within 1–3 days', value: quickCounts.d1, tone: 'text-warn', sub: 'Rotate first' },
          { label: 'Within 4–7 days', value: quickCounts.d4, tone: 'text-info', sub: 'Plan promotions' },
          { label: 'Missing dates', value: quickCounts.missing, tone: 'text-ink', sub: 'Add expiry data' },
        ].map((item) => (
          <Card key={item.label} className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{item.label}</p>
            <p className={cn('tnum mt-1 text-xl font-bold', item.tone)}>{item.value}</p>
            <p className="text-[10px] text-muted">{item.sub}</p>
          </Card>
        ))}
      </div>

      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <label htmlFor="expiry-window" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Expiry window
            </label>
            <Select
              id="expiry-window"
              value={windowFilter}
              onChange={(event) => updateParams({ group: event.target.value === 'all' ? null : event.target.value })}
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="expiry-category" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Category
            </label>
            <Select
              id="expiry-category"
              value={category}
              onChange={(event) => updateParams({ category: event.target.value === 'all' ? null : event.target.value })}
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="expiry-from" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Expiry from
            </label>
            <TextInput
              id="expiry-from"
              type="date"
              value={from}
              onChange={(event) => updateParams({ from: event.target.value })}
            />
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="expiry-to" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Expiry to
            </label>
            <TextInput
              id="expiry-to"
              type="date"
              value={to}
              onChange={(event) => updateParams({ to: event.target.value })}
            />
          </div>
          <div className="flex items-end lg:col-span-2">
            <Button
              variant="secondary"
              className="w-full"
              icon={<FilterX className="h-4 w-4" aria-hidden="true" />}
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              Clear
            </Button>
          </div>
        </div>
        <p className="mt-2.5 border-t border-line pt-2.5 text-[11px] text-muted" aria-live="polite">
          Showing <span className="font-semibold text-ink">{filtered.length}</span> of {insights.length} products ·{' '}
          {metrics.nearExpiry} near expiry · {metrics.expired} expired
        </p>
      </Card>

      {grouped.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" />}
            title="No products in this expiry view"
            description="Adjust the expiry window, category or date range to see products, or add expiry dates from the inventory page."
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="secondary" onClick={exportExpiry} disabled>
                  Nothing to export
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => {
            const style = GROUP_STYLES[group.key];
            return (
              <Card key={group.key} className={cn('overflow-hidden border-l-4', style.border)}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {style.icon}
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-ink">{group.label}</h2>
                      <p className="text-[11px] leading-4 text-muted">{group.description}</p>
                    </div>
                  </div>
                  <span className={cn('tnum rounded-full px-2.5 py-1 text-[11px] font-semibold', style.chip)}>
                    {group.items.length} product{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {group.items.map((insight) => {
                    const { product } = insight;
                    return (
                      <li
                        key={product.id}
                        className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                          <p className="tnum text-[11px] text-muted">
                            {product.sku} · {product.category} · stock {product.currentStock}
                            {product.unit ? ` ${product.unit}` : ''}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <StockStatusBadge insight={insight} />
                            <ExpiryStatusBadge insight={insight} />
                          </div>
                          <p className="mt-1.5 max-w-md text-[11px] leading-4 text-muted">
                            <span className="font-semibold text-ink">Next step:</span> {insight.suggestedAction}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="tnum text-[11px] font-medium text-ink">{formatDate(product.expiryDate)}</p>
                            <p className="text-[10px] text-muted">
                              {insight.daysRemaining === null
                                ? 'Record an expiry date'
                                : insight.daysRemaining < 0
                                  ? 'Past recorded expiry'
                                  : `${insight.daysRemaining} day${insight.daysRemaining === 1 ? '' : 's'} remaining`}
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                            onClick={() => setDetailId(product.id)}
                            aria-label={`View details for ${product.name}`}
                          >
                            View
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {group.key === 'missing' ? (
                  <p className="border-t border-line bg-canvas/60 px-3.5 py-2 text-[11px] text-muted">
                    Products without an expiry date are excluded from expiry-risk counts. Add a date to include them.
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <ProductDetailDrawer
        open={Boolean(detailInsight)}
        insight={detailInsight}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
