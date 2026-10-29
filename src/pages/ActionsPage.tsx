import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import type { ActionPriority, ProductInsight } from '../types';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, EmptyState, Select, cn } from '../components/ui';
import { PriorityBadge, RiskBadge } from '../components/inventory-badges';
import { ProductDetailDrawer } from '../components/ProductDetailDrawer';
import { useToast } from '../components/toast';
import { formatCover } from '../lib/inventory';
import { actionTable, fileStamp } from '../lib/csv';
import { ExportDeniedError, exportCsv } from '../lib/download';
import { useAction } from '../auth/AuthContext';
import { formatDate } from '../lib/date';

type ReviewFilter = 'all' | 'needs-review' | 'reviewed';

const PRIORITY_GROUPS: Array<{
  priority: ActionPriority;
  title: string;
  description: string;
  tone: 'crit' | 'warn' | 'info';
}> = [
  {
    priority: 0,
    title: 'Expired — remove from sale',
    description: 'Safety first. Expired stock must not be sold, discounted or distributed.',
    tone: 'crit',
  },
  {
    priority: 1,
    title: 'Combined risk',
    description: 'Low stock and near expiry together. Review expiry before deciding to reorder.',
    tone: 'crit',
  },
  {
    priority: 2,
    title: 'Low stock',
    description: 'At or below the reorder level, ordered by the lowest days of cover.',
    tone: 'warn',
  },
  {
    priority: 3,
    title: 'Near expiry only',
    description: 'Approaching expiry without a stock alert. Rotate stock and review markdowns.',
    tone: 'info',
  },
];

function ActionCard({
  insight,
  reviewed,
  onView,
  onToggleReview,
}: {
  insight: ProductInsight;
  reviewed: boolean;
  onView: () => void;
  onToggleReview: () => void;
}) {
  const { product } = insight;
  const toneClasses =
    insight.priority === 0 || insight.priority === 1
      ? 'border-crit/20'
      : insight.priority === 2
        ? 'border-warn/25'
        : 'border-info/20';

  return (
    <article className={cn('rounded-xl border bg-white p-3.5 shadow-card sm:p-4', toneClasses)} aria-label={`${product.name} action`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={insight.priority} />
            <RiskBadge risk={insight.risk} />
            {reviewed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary-dark">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Reviewed
              </span>
            ) : null}
          </div>
          <h3 className="mt-1.5 truncate text-sm font-semibold text-ink sm:text-[15px]">{product.name}</h3>
          <p className="tnum text-[11px] text-muted">
            {product.sku} · {product.category}
            {product.supplierName ? ` · ${product.supplierName}` : ''}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4 sm:text-right">
          <div className="rounded-md bg-canvas px-2 py-1">
            <p className="text-[9px] uppercase tracking-wide text-muted">Stock</p>
            <p className="tnum text-sm font-semibold text-ink">
              {product.currentStock}
              {product.unit ? <span className="text-[10px] font-normal text-muted"> {product.unit}</span> : null}
            </p>
          </div>
          <div className="rounded-md bg-canvas px-2 py-1">
            <p className="text-[9px] uppercase tracking-wide text-muted">Cover</p>
            <p className="tnum text-sm font-semibold text-ink">{formatCover(insight.daysOfCover)}</p>
          </div>
          <div className="rounded-md bg-canvas px-2 py-1">
            <p className="text-[9px] uppercase tracking-wide text-muted">Expiry</p>
            <p className="tnum text-sm font-semibold text-ink">
              {insight.daysRemaining === null ? 'N/A' : `${insight.daysRemaining}d`}
            </p>
          </div>
          {insight.reorderQuantity > 0 ? (
            <div className="rounded-md bg-primary-soft px-2 py-1">
              <p className="text-[9px] uppercase tracking-wide text-primary-dark">Reorder</p>
              <p className="tnum text-sm font-semibold text-primary-dark">{insight.reorderQuantity}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg bg-canvas/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Why it needs attention</p>
          <ul className="mt-1 space-y-0.5 text-[12px] leading-5 text-ink/80">
            {insight.reasons.length > 0 ? (
              insight.reasons.map((reason) => (
                <li key={reason} className="flex gap-1.5">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                  {reason}
                </li>
              ))
            ) : (
              <li>Review the expiry risk and current stock before acting.</li>
            )}
          </ul>
          <p className="mt-1 text-[10px] text-muted">Expiry date {formatDate(product.expiryDate)}</p>
        </div>
        <div
          className={cn(
            'rounded-lg px-3 py-2',
            insight.priority === 0 ? 'bg-crit-soft/60' : insight.priority === 1 ? 'bg-crit-soft/40' : 'bg-primary-soft/60',
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Suggested next step</p>
          <p className="mt-1 text-[12px] font-medium leading-5 text-ink">{insight.suggestedAction}</p>
          {insight.isNearExpiry && insight.priority === 1 ? (
            <p className="mt-1 text-[11px] leading-4 text-[#7F1D1D]">
              Suggested reorder {insight.reorderQuantity} units — confirm demand and expiry risk first.
            </p>
          ) : null}
          {insight.isExpired ? (
            <p className="mt-1 text-[11px] leading-4 text-[#7F1D1D]">
              Do not sell or discount expired stock.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" icon={<Eye className="h-4 w-4" aria-hidden="true" />} onClick={onView}>
          View product
        </Button>
        <Button
          variant={reviewed ? 'soft' : 'primary'}
          size="sm"
          icon={reviewed ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          onClick={onToggleReview}
        >
          {reviewed ? 'Reopen action' : 'Mark as reviewed'}
        </Button>
      </div>
    </article>
  );
}

export default function ActionsPage() {
  const { actionQueue, reviewedKeys, toggleReview, metrics, insights } = useStockora();
  const toast = useToast();
  const canExport = useAction('csv_export', 'export');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | `${ActionPriority}`>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(actionQueue.map((insight) => insight.product.category))].sort((a, b) => a.localeCompare(b)),
    [actionQueue],
  );

  const filtered = useMemo(
    () =>
      actionQueue.filter((insight) => {
        const reviewed = reviewedKeys.has(insight.actionKey ?? '');
        if (reviewFilter === 'needs-review' && reviewed) return false;
        if (reviewFilter === 'reviewed' && !reviewed) return false;
        if (priorityFilter !== 'all' && insight.priority !== Number(priorityFilter)) return false;
        if (categoryFilter !== 'all' && insight.product.category !== categoryFilter) return false;
        return true;
      }),
    [actionQueue, reviewedKeys, reviewFilter, priorityFilter, categoryFilter],
  );

  const detailInsight = insights.find((insight) => insight.product.id === detailId) ?? null;

  const exportActions = async () => {
    try {
      await exportCsv(`stockora-actions-${fileStamp()}.csv`, actionTable(filtered, reviewedKeys), 'actions');
    } catch (err) {
      toast.error(
        'Export not allowed',
        err instanceof ExportDeniedError ? err.message : 'Export failed. Try again.',
      );
      return;
    }
    toast.success(
      'Action list exported',
      `${filtered.length} action${filtered.length === 1 ? '' : 's'} exported with the current filters.`,
    );
  };

  const handleToggleReview = (insight: ProductInsight) => {
    const wasReviewed = reviewedKeys.has(insight.actionKey ?? '');
    toggleReview(insight);
    toast.success(
      wasReviewed ? 'Action reopened' : 'Marked as reviewed',
      wasReviewed
        ? `${insight.product.name} is back in the needs-review queue.`
        : 'Review state saved. Stock, orders and sales are unchanged.',
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Action Center"
        description="One prioritized queue for stock and expiry risk. Every product appears once, with all of its reasons and a recommended next step."
        actions={
          canExport ? (
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void exportActions()}
              disabled={filtered.length === 0}
            >
              Export CSV
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Expired', value: metrics.expired, tone: 'text-crit', hint: 'Remove from sale' },
          { label: 'Combined risk', value: metrics.combined, tone: 'text-crit', hint: 'Stock + expiry' },
          { label: 'Low stock', value: metrics.lowOnly, tone: 'text-warn', hint: 'Below reorder level' },
          { label: 'Near expiry only', value: metrics.expiryOnly, tone: 'text-info', hint: 'No stock alert' },
          { label: 'Needs review', value: metrics.needsReview, tone: 'text-ink', hint: `${metrics.reviewed} reviewed` },
        ].map((item) => (
          <Card key={item.label} className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{item.label}</p>
            <p className={cn('tnum mt-1 text-xl font-bold', item.tone)}>{item.value}</p>
            <p className="text-[10px] text-muted">{item.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div>
            <label htmlFor="action-review-filter" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Review state
            </label>
            <Select
              id="action-review-filter"
              value={reviewFilter}
              onChange={(event) => setReviewFilter(event.target.value as ReviewFilter)}
            >
              <option value="all">All actions</option>
              <option value="needs-review">Needs review</option>
              <option value="reviewed">Reviewed</option>
            </Select>
          </div>
          <div>
            <label htmlFor="action-priority-filter" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Priority
            </label>
            <Select
              id="action-priority-filter"
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}
            >
              <option value="all">All priorities</option>
              <option value="0">P0 · Expired</option>
              <option value="1">P1 · Combined risk</option>
              <option value="2">P2 · Low stock</option>
              <option value="3">P3 · Near expiry only</option>
            </Select>
          </div>
          <div>
            <label htmlFor="action-category-filter" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Category
            </label>
            <Select
              id="action-category-filter"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {actionQueue.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<PackageCheck className="h-5 w-5" />}
            title="Nothing needs attention"
            description="No product is at or below its reorder level or within the expiry threshold. Keep monitoring from the Inventory page."
            action={
              <Link to="/inventory" className="text-sm font-semibold text-primary-dark hover:underline">
                Open inventory
              </Link>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="No actions match these filters"
            description="Change the review state, priority or category filter to see more actions."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setReviewFilter('all');
                  setPriorityFilter('all');
                  setCategoryFilter('all');
                }}
              >
                Reset filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {PRIORITY_GROUPS.map((group) => {
            const items = filtered.filter((insight) => insight.priority === group.priority);
            if (items.length === 0) return null;
            return (
              <section key={group.priority} aria-labelledby={`priority-${group.priority}`}>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-1">
                  <div>
                    <h2 id={`priority-${group.priority}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          group.tone === 'crit' ? 'bg-crit' : group.tone === 'warn' ? 'bg-warn' : 'bg-info',
                        )}
                        aria-hidden="true"
                      />
                      {group.title}
                      <span className="tnum rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted">
                        {items.length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">{group.description}</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {items.map((insight) => {
                    const reviewed = reviewedKeys.has(insight.actionKey ?? '');
                    return (
                      <ActionCard
                        key={insight.actionKey}
                        insight={insight}
                        reviewed={reviewed}
                        onView={() => setDetailId(insight.product.id)}
                        onToggleReview={() => handleToggleReview(insight)}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Card className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-[11px] leading-4 text-muted">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          Marking an action as reviewed records that you looked at it. It does not reorder, sell, discount or remove any
          stock. Expired products must be handled according to applicable safety procedures.
        </p>
        <Link
          to="/expiry"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary-dark hover:underline"
        >
          Open expiry monitor <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </Card>

      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
        Priority order: expired → combined risk → low stock → near expiry only.
      </p>

      <ProductDetailDrawer
        open={Boolean(detailInsight)}
        insight={detailInsight}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
