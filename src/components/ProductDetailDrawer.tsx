import { useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import type { Product, ProductInsight } from '../types';
import { useStockora } from '../store/StockoraContext';
import { useToast } from './toast';
import { Badge, Button, Drawer, InfoNote } from './ui';
import { ExpiryStatusBadge, RiskBadge, StockStatusBadge } from './inventory-badges';
import { formatCover, reorderFormula } from '../lib/inventory';
import { formatCurrency, formatNumber } from '../lib/format';
import { formatDate, formatDateTime } from '../lib/date';
import { DeleteProductDialog } from './DeleteProductDialog';
import { useAction } from '../auth/AuthContext';

export function ProductDetailDrawer({
  open,
  insight,
  onClose,
  onEdit,
}: {
  open: boolean;
  insight: ProductInsight | null;
  onClose: () => void;
  onEdit?: (product: Product) => void;
}) {
  const { settings, reviewedKeys, toggleReview } = useStockora();
  const toast = useToast();
  const canEdit = useAction('inventory', 'edit');
  const canDelete = useAction('inventory', 'delete');
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!insight) return null;
  const { product } = insight;
  const reviewed = insight.actionKey ? reviewedKeys.has(insight.actionKey) : false;
  const breakdown = reorderFormula(product, settings.safetyBufferDays);

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={product.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="tnum font-medium text-ink">{product.sku}</span>
            <span aria-hidden="true">·</span>
            <span>{product.category}</span>
          </span>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setDeleteOpen(true)}
                className="text-crit hover:bg-crit-soft/60"
              >
                Delete
              </Button>
            ) : null}
            <div className="flex flex-1 justify-end gap-2">
              {insight.actionKey ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    toggleReview(insight);
                    toast.success(
                      reviewed ? 'Action reopened' : 'Marked as reviewed',
                      reviewed
                        ? `${product.name} is back in the needs-review queue.`
                        : 'Review state saved. No stock was changed or ordered.',
                    );
                  }}
                >
                  {reviewed ? 'Reopen action' : 'Mark reviewed'}
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  size="sm"
                  icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => onEdit?.(product)}
                >
                  Edit product
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <RiskBadge risk={insight.risk} />
            <StockStatusBadge insight={insight} />
            <ExpiryStatusBadge insight={insight} />
            {reviewed ? <Badge tone="primary">Reviewed</Badge> : null}
          </div>

          {insight.reasons.length > 0 ? (
            <div
              className={`rounded-xl border p-3.5 ${
                insight.isExpired
                  ? 'border-crit/25 bg-crit-soft/60'
                  : insight.priority === 1
                    ? 'border-crit/20 bg-crit-soft/40'
                    : 'border-warn/25 bg-warn-soft/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <ShieldAlert
                  className={`h-4 w-4 ${insight.isExpired ? 'text-crit' : 'text-warn'}`}
                  aria-hidden="true"
                />
                <h3 className="text-sm font-semibold text-ink">
                  {insight.isExpired ? 'Expired product' : 'Why this needs attention'}
                </h3>
              </div>
              <ul className="mt-2 space-y-1 text-[13px] leading-5 text-ink/80">
                {insight.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current" />
                    {reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 border-t border-current/10 pt-2.5 text-[13px] font-medium text-ink">
                Suggested action: {insight.suggestedAction}
              </p>
            </div>
          ) : (
            <InfoNote tone="ok" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>
              Stock is above the reorder level and the expiry date is outside your alert threshold.
            </InfoNote>
          )}

          <section aria-labelledby="drawer-metrics">
            <h3 id="drawer-metrics" className="text-xs font-semibold uppercase tracking-wide text-muted">
              Stock & demand
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-2.5">
              {[
                { label: 'Current stock', value: product.unit ? `${product.currentStock} ${product.unit}` : `${product.currentStock}` },
                { label: 'Reorder level', value: `${product.reorderLevel}` },
                { label: 'Avg daily sales', value: formatNumber(product.averageDailySales, product.averageDailySales % 1 === 0 ? 0 : 1) },
                { label: 'Lead time', value: `${product.leadTimeDays} day${product.leadTimeDays === 1 ? '' : 's'}` },
                { label: 'Days of cover', value: formatCover(insight.daysOfCover) },
                {
                  label: 'Suggested reorder',
                  value: insight.isExpired ? 'Not applicable' : `${insight.reorderQuantity} units`,
                },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-line bg-white p-3">
                  <dt className="text-[11px] font-medium text-muted">{item.label}</dt>
                  <dd className="tnum mt-0.5 text-lg font-semibold text-ink">{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="drawer-reorder" className="rounded-xl border border-line p-3.5">
            <h3 id="drawer-reorder" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Calculator className="h-4 w-4 text-primary" aria-hidden="true" /> Reorder calculation
            </h3>
            <p className="mt-2 rounded-lg bg-canvas px-3 py-2 font-mono text-[11px] leading-5 text-ink">
              {breakdown.formula}
            </p>
            <dl className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Required stock</dt>
                <dd className="tnum font-semibold text-ink">{breakdown.required} units</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Safety buffer</dt>
                <dd className="tnum font-semibold text-ink">{settings.safetyBufferDays} days</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] leading-4 text-muted">
              {insight.isExpired
                ? 'Expired stock is not given a replenishment suggestion. Remove it from sale and follow disposal procedures before ordering again.'
                : 'A suggestion only. No purchase order is created and no stock is changed.'}
            </p>
          </section>

          <section aria-labelledby="drawer-expiry">
            <h3 id="drawer-expiry" className="text-xs font-semibold uppercase tracking-wide text-muted">
              Expiry
            </h3>
            <div className="mt-2 space-y-2 rounded-xl border border-line p-3.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Expiry date</span>
                <span className="font-medium text-ink">{formatDate(product.expiryDate)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Status</span>
                <ExpiryStatusBadge insight={insight} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Alert threshold</span>
                <span className="tnum font-medium text-ink">{settings.expiryThreshold} days</span>
              </div>
            </div>
            {insight.isExpired ? (
              <div className="mt-2">
                <InfoNote tone="crit" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
                  Expired stock must not be sold, discounted or distributed for consumption. Follow applicable safety
                  and disposal procedures.
                </InfoNote>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="drawer-details">
            <h3 id="drawer-details" className="text-xs font-semibold uppercase tracking-wide text-muted">
              Product details
            </h3>
            <dl className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
              {[
                { label: 'Supplier', value: product.supplierName || 'Not recorded' },
                { label: 'Unit', value: product.unit || 'Not recorded' },
                {
                  label: 'Unit cost',
                  value:
                    product.unitCost === null || product.unitCost === undefined
                      ? 'Not recorded'
                      : formatCurrency(product.unitCost, settings.currency),
                },
                {
                  label: 'Selling price',
                  value:
                    product.sellingPrice === null || product.sellingPrice === undefined
                      ? 'Not recorded'
                      : formatCurrency(product.sellingPrice, settings.currency),
                },
                {
                  label: 'Gross margin on stock',
                  value:
                    product.unitCost === null ||
                    product.unitCost === undefined ||
                    product.sellingPrice === null ||
                    product.sellingPrice === undefined
                      ? 'Add cost and price to estimate'
                      : formatCurrency(
                          (product.sellingPrice - product.unitCost) * product.currentStock,
                          settings.currency,
                        ),
                },
                { label: 'Added', value: formatDateTime(product.createdAt) },
                { label: 'Last updated', value: formatDateTime(product.updatedAt) },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-muted">{item.label}</dt>
                  <dd className="text-right font-medium text-ink">{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </Drawer>

      <DeleteProductDialog
        product={deleteOpen ? product : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onClose}
      />
    </>
  );
}
