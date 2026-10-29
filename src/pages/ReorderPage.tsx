import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calculator,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  PackageCheck,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Sigma,
} from 'lucide-react';
import type { ProductInsight } from '../types';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, EmptyState, Select, cn } from '../components/ui';
import { RiskBadge } from '../components/inventory-badges';
import { ProductDetailDrawer } from '../components/ProductDetailDrawer';
import { useToast } from '../components/toast';
import { formatCover, reorderFormula, reorderRows } from '../lib/inventory';
import { fileStamp, reorderTable } from '../lib/csv';
import { ExportDeniedError, exportCsv } from '../lib/download';
import { useAction } from '../auth/AuthContext';
import { formatNumber } from '../lib/format';

type StockFilter = 'all' | 'low' | 'healthy';
type SortKey = 'cover-asc' | 'qty-desc' | 'expiry-asc' | 'name-asc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'cover-asc', label: 'Lowest days of cover' },
  { value: 'qty-desc', label: 'Largest suggested quantity' },
  { value: 'expiry-asc', label: 'Soonest expiry' },
  { value: 'name-asc', label: 'Product name (A–Z)' },
];

function recommendationLabel(insight: ProductInsight) {
  if (insight.risk === 'both') {
    return { label: 'Review expiry first', tone: 'warn' as const };
  }
  if (insight.risk === 'low-only') {
    return { label: 'Reorder suggested', tone: 'primary' as const };
  }
  return { label: 'Within lead-time demand', tone: 'info' as const };
}

export default function ReorderPage() {
  const { insights, settings, reviewedKeys, toggleReviewKey } = useStockora();
  const toast = useToast();
  const canExport = useAction('csv_export', 'export');
  const [category, setCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<SortKey>('cover-asc');
  const [detailId, setDetailId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(insights.map((insight) => insight.product.category))].sort((a, b) => a.localeCompare(b)),
    [insights],
  );

  const expiredCount = insights.filter((insight) => insight.isExpired).length;
  const recommendations = useMemo(
    () => reorderRows(insights).filter((insight) => !insight.isExpired),
    [insights],
  );

  const filtered = useMemo(() => {
    const rows = recommendations.filter((insight) => {
      if (category !== 'all' && insight.product.category !== category) return false;
      if (stockFilter === 'low' && !insight.isLowStock) return false;
      if (stockFilter === 'healthy' && insight.isLowStock) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'qty-desc':
          return b.reorderQuantity - a.reorderQuantity;
        case 'expiry-asc':
          if (a.daysRemaining === null && b.daysRemaining === null) return a.product.name.localeCompare(b.product.name);
          if (a.daysRemaining === null) return 1;
          if (b.daysRemaining === null) return -1;
          return a.daysRemaining - b.daysRemaining;
        case 'name-asc':
          return a.product.name.localeCompare(b.product.name);
        case 'cover-asc':
        default:
          if (a.daysOfCover === null && b.daysOfCover === null) return a.product.name.localeCompare(b.product.name);
          if (a.daysOfCover === null) return 1;
          if (b.daysOfCover === null) return -1;
          return a.daysOfCover - b.daysOfCover;
      }
    });
  }, [recommendations, category, stockFilter, sort]);

  const totalUnits = filtered.reduce((sum, insight) => sum + insight.reorderQuantity, 0);
  const lowestCover = filtered.reduce<number | null>((min, insight) => {
    if (insight.daysOfCover === null) return min;
    return min === null ? insight.daysOfCover : Math.min(min, insight.daysOfCover);
  }, null);
  const nearExpiryWithoutNeed = insights.filter(
    (insight) => insight.isNearExpiry && insight.reorderQuantity === 0,
  );
  const detailInsight = insights.find((insight) => insight.product.id === detailId) ?? null;

  const toggleRecommendationReview = (insight: ProductInsight) => {
    const key = `reorder:${insight.product.id}`;
    const reviewed = reviewedKeys.has(key);
    toggleReviewKey(insight.product.id, key, insight.product.name);
    toast.success(
      reviewed ? 'Recommendation reopened' : 'Recommendation reviewed',
      reviewed
        ? `${insight.product.name} is back in the review queue.`
        : 'Review saved. No purchase order was placed and stock is unchanged.',
    );
  };

  const exportReorder = async () => {
    try {
      await exportCsv(
        `stockora-reorder-${fileStamp()}.csv`,
        reorderTable(filtered, settings.safetyBufferDays),
        'reorder',
      );
    } catch (err) {
      toast.error(
        'Export not allowed',
        err instanceof ExportDeniedError ? err.message : 'Export failed. Try again.',
      );
      return;
    }
    toast.success(
      'Reorder plan exported',
      `${filtered.length} recommendation${filtered.length === 1 ? '' : 's'} exported with the current filters.`,
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reorder Planner"
        description={`Suggested replenishment from demand, supplier lead time and your ${settings.safetyBufferDays}-day safety buffer. Suggestions only — no orders are placed.`}
        actions={
          canExport ? (
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void exportReorder()}
              disabled={filtered.length === 0}
            >
              Export CSV
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Products to review', value: formatNumber(recommendations.length), sub: 'Suggestions above zero', tone: 'text-ink' },
          { label: 'Units suggested', value: formatNumber(filtered.reduce((sum, item) => sum + item.reorderQuantity, 0)), sub: 'For the current filter', tone: 'text-primary-dark' },
          { label: 'Safety buffer', value: `${settings.safetyBufferDays}d`, sub: 'Applied to every lead time', tone: 'text-info' },
          { label: 'Lowest cover', value: lowestCover === null ? 'N/A' : `${lowestCover.toFixed(1)}d`, sub: 'Among filtered products', tone: 'text-warn' },
        ].map((item) => (
          <Card key={item.label} className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{item.label}</p>
            <p className={cn('tnum mt-1 text-xl font-bold', item.tone)}>{item.value}</p>
            <p className="text-[10px] text-muted">{item.sub}</p>
          </Card>
        ))}
      </div>

      <Card className="p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-dark" aria-hidden="true">
              <Sigma className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Formula transparency</h2>
              <p className="text-[11px] text-muted">Target stock cover = demand × (lead time + safety buffer)</p>
            </div>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary-dark hover:bg-primary-soft"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Change safety buffer
          </Link>
        </div>
        <p className="mt-2.5 overflow-x-auto rounded-lg bg-canvas px-3 py-2 font-mono text-[11px] leading-5 text-ink">
          max(0, ceil(avg_daily_sales × (lead_time_days + {settings.safetyBufferDays}) − current_stock))
        </p>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          The quantity is rounded up so a product is not under-stocked before the next delivery. Suggestions do not
          account for shelf-life. For products that are also near expiry, confirm demand before ordering.
        </p>
      </Card>

      <Card className="p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div>
            <label htmlFor="reorder-category" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Category
            </label>
            <Select id="reorder-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="reorder-stock" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Stock status
            </label>
            <Select
              id="reorder-stock"
              value={stockFilter}
              onChange={(event) => setStockFilter(event.target.value as StockFilter)}
            >
              <option value="all">All products needing stock</option>
              <option value="low">Low stock only</option>
              <option value="healthy">Above reorder level</option>
            </Select>
          </div>
          <div>
            <label htmlFor="reorder-sort" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Sort by
            </label>
            <Select id="reorder-sort" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<PackageCheck className="h-5 w-5" />}
            title="No replenishment needed"
            description={
              recommendations.length === 0
                ? 'Current stock covers demand through each supplier lead time plus your safety buffer. No suggested quantities right now.'
                : 'No products match these filters. Try another category or stock status.'
            }
            action={
              recommendations.length === 0 ? (
                <Link to="/inventory" className="text-sm font-semibold text-primary-dark hover:underline">
                  Review inventory
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCategory('all');
                    setStockFilter('all');
                  }}
                >
                  Reset filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-card lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] border-collapse text-left">
                <caption className="sr-only">Suggested replenishment quantities with formula inputs</caption>
                <thead className="table-head">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">Product</th>
                    <th scope="col" className="px-3 py-2.5">SKU</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Stock</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Reorder level</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Avg sales</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Lead time</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Buffer</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Cover</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Suggested qty</th>
                    <th scope="col" className="px-3 py-2.5">Status</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((insight) => {
                    const { product } = insight;
                    const breakdown = reorderFormula(product, settings.safetyBufferDays);
                    const reviewKey = `reorder:${product.id}`;
                    const reviewed = reviewedKeys.has(reviewKey);
                    const status = recommendationLabel(insight);
                    return (
                      <tr key={product.id} className="transition-colors hover:bg-primary-soft/30">
                        <td className="table-cell">
                          <button
                            type="button"
                            onClick={() => setDetailId(product.id)}
                            className="max-w-[170px] truncate text-left font-semibold text-ink hover:text-primary-dark hover:underline"
                          >
                            {product.name}
                          </button>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {insight.isNearExpiry ? <RiskBadge risk="expiry-only" /> : null}
                            {insight.isLowStock ? <RiskBadge risk="low-only" /> : null}
                          </div>
                        </td>
                        <td className="table-cell tnum whitespace-nowrap text-muted">{product.sku}</td>
                        <td className="table-cell tnum text-right font-semibold text-ink">{product.currentStock}</td>
                        <td className="table-cell tnum text-right text-muted">{product.reorderLevel}</td>
                        <td className="table-cell tnum text-right text-muted">{formatNumber(product.averageDailySales, product.averageDailySales % 1 === 0 ? 0 : 1)}</td>
                        <td className="table-cell tnum text-right text-muted">{product.leadTimeDays}d</td>
                        <td className="table-cell tnum text-right text-muted">{settings.safetyBufferDays}d</td>
                        <td className="table-cell tnum whitespace-nowrap text-right font-medium text-ink">
                          {formatCover(insight.daysOfCover)}
                        </td>
                        <td className="table-cell text-right">
                          <span className="tnum font-semibold text-primary-dark" title={breakdown.formula}>
                            {insight.reorderQuantity}
                          </span>
                          <p className="text-[10px] text-muted">{breakdown.unitFormula}</p>
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <Badge tone={status.tone}>{status.label}</Badge>
                            {insight.isNearExpiry ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warn">
                                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                                Expires in {insight.daysRemaining}d
                              </span>
                            ) : null}
                            {reviewed ? (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Reviewed</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => toggleRecommendationReview(insight)}
                              icon={reviewed ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                              aria-label={reviewed ? `Reopen recommendation for ${product.name}` : `Mark recommendation reviewed for ${product.name}`}
                            >
                              {reviewed ? 'Reopen' : 'Review'}
                            </Button>
                            <button
                              type="button"
                              onClick={() => setDetailId(product.id)}
                              className="rounded-md p-2 text-muted hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`View details for ${product.name}`}
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2.5 lg:hidden">
            {filtered.map((insight) => {
              const { product } = insight;
              const breakdown = reorderFormula(product, settings.safetyBufferDays);
              const reviewKey = `reorder:${product.id}`;
              const reviewed = reviewedKeys.has(reviewKey);
              const status = recommendationLabel(insight);
              return (
                <Card key={product.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                      <p className="tnum text-[11px] text-muted">
                        {product.sku} · {product.category}
                      </p>
                    </div>
                    <span className="tnum shrink-0 rounded-lg bg-primary-soft px-2.5 py-1.5 text-sm font-bold text-primary-dark" title={breakdown.formula}>
                      +{insight.reorderQuantity}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {insight.isNearExpiry ? (
                      <Badge tone="warn" icon={<ShieldAlert className="h-3 w-3" aria-hidden="true" />}>
                        Expires in {insight.daysRemaining}d
                      </Badge>
                    ) : null}
                    {reviewed ? <Badge tone="primary">Reviewed</Badge> : null}
                  </div>
                  <dl className="mt-2.5 grid grid-cols-4 gap-1 rounded-lg bg-canvas px-2 py-2 text-center text-xs">
                    <div>
                      <dt className="text-[9px] uppercase tracking-wide text-muted">Stock</dt>
                      <dd className="tnum font-semibold text-ink">{product.currentStock}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] uppercase tracking-wide text-muted">Sales/d</dt>
                      <dd className="tnum font-semibold text-ink">{formatNumber(product.averageDailySales, product.averageDailySales % 1 === 0 ? 0 : 1)}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] uppercase tracking-wide text-muted">Lead</dt>
                      <dd className="tnum font-semibold text-ink">{product.leadTimeDays}d</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] uppercase tracking-wide text-muted">Cover</dt>
                      <dd className="tnum font-semibold text-ink">{formatCover(insight.daysOfCover)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 overflow-x-auto rounded bg-canvas px-2 py-1.5 font-mono text-[10px] text-muted">
                    {breakdown.formula}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toggleRecommendationReview(insight)}
                      icon={reviewed ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    >
                      {reviewed ? 'Reopen' : 'Mark reviewed'}
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setDetailId(product.id)}>
                      Details
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <div className="grid gap-2.5 lg:grid-cols-2">
        <Card className="flex items-start gap-2 p-3.5">
          <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-[11px] leading-4 text-muted">
            <span className="font-semibold text-ink">{formatNumber(totalUnits)} units</span> suggested across{' '}
            {filtered.length} product{filtered.length === 1 ? '' : 's'} in this view. Quantities are recommendations —
            confirm with your supplier before ordering.
          </p>
        </Card>
        <Card className="flex items-start gap-2 p-3.5">
          <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <div className="text-[11px] leading-4 text-muted">
            {expiredCount > 0 ? (
              <p className="mb-1">
                <span className="font-semibold text-crit">{expiredCount} expired product{expiredCount === 1 ? '' : 's'}</span>{' '}
                are excluded from replenishment. Handle them under expiry safety rules.
              </p>
            ) : null}
            {nearExpiryWithoutNeed.length > 0 ? (
              <p>
                {nearExpiryWithoutNeed.length} near-expiry product
                {nearExpiryWithoutNeed.length === 1 ? ' has' : 's have'} no replenishment need. Use the Expiry Monitor
                for rotation and markdown decisions.
              </p>
            ) : (
              <p>Products already covered through their lead time are not listed.</p>
            )}
          </div>
        </Card>
      </div>

      <ProductDetailDrawer
        open={Boolean(detailInsight)}
        insight={detailInsight}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
