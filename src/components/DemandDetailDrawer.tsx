import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus, Package, TrendingUp, Truck } from 'lucide-react';
import type { ProductDemand, DemandTrend } from '../lib/demand';
import { CLASSIFICATION_META, FLAG_META } from '../lib/demand';
import { Badge, Drawer, InfoNote } from './ui';
import { formatCurrency, formatNumber } from '../lib/format';
import { formatDate } from '../lib/date';
import type { CurrencyCode } from '../types';

export const TREND_META: Record<DemandTrend, { label: string; icon: React.ReactNode; tone: string }> = {
  up: { label: 'Rising', icon: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-ok' },
  down: { label: 'Falling', icon: <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-crit' },
  flat: { label: 'Flat', icon: <Minus className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-muted' },
  new: { label: 'New', icon: <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-ok' },
  unknown: { label: 'Unknown', icon: <Minus className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-muted' },
};

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-base font-bold text-ink tnum">{value}</p>
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function DemandDetailDrawer({
  item,
  windowDays,
  currency,
  onClose,
}: {
  item: ProductDemand | null;
  windowDays: number;
  currency: CurrencyCode;
  onClose: () => void;
}) {
  if (!item) return null;
  const meta = CLASSIFICATION_META[item.classification];
  const trend = TREND_META[item.trend];

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-xs text-muted">{item.sku} · {item.category}</span>
        </span>
      }
      footer={
        <Link
          to={`/inventory?product=${item.productId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-dark hover:underline"
        >
          <Package className="h-4 w-4" aria-hidden="true" />
          Open in Inventory
        </Link>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <Metric label={`Units sold · ${windowDays}d`} value={formatNumber(item.unitsSold, item.unitsSold % 1 === 0 ? 0 : 2)} />
          <Metric
            label="Velocity"
            value={`${formatNumber(item.velocity, 2)}/day`}
            hint={`Over ${item.daysTracked} tracked day${item.daysTracked === 1 ? '' : 's'}`}
          />
          <Metric label="In stock" value={`${formatNumber(item.stock)} ${item.unit ?? ''}`} />
          <Metric
            label="Days of cover"
            value={item.coverageDays === null ? '—' : `${formatNumber(item.coverageDays, 1)}d`}
            hint={item.coverageDays === null ? 'No recorded demand' : undefined}
          />
          <Metric
            label="Revenue"
            value={item.revenueAvailable ? formatCurrency(item.revenue, currency) : '—'}
            hint={item.revenueAvailable ? `${item.transactions} transaction line(s)` : 'No prices recorded'}
          />
          <Metric label="Stock value" value={formatCurrency(item.stockValue, currency)} hint="At unit cost" />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trend.tone}`}>
              {trend.icon}
              {trend.label}
            </span>
            {item.flags.map((flag) => (
              <Badge key={flag} tone={FLAG_META[flag].tone}>
                {FLAG_META[flag].label}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{meta.description}</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink">Why this classification</h3>
          <ul className="mt-2 space-y-1.5">
            {item.reasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-sm leading-6 text-muted">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-line" aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <InfoNote tone={item.expired ? 'crit' : 'info'} icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}>
          <span className="font-semibold">Recommendation (advisory only): </span>
          {item.recommendation}
        </InfoNote>

        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Last recorded sale</dt>
            <dd className="font-medium text-ink">{item.lastSoldAt ? formatDate(item.lastSoldAt) : 'None recorded'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Suggested order (lead time + 7 days)</dt>
            <dd className="font-medium text-ink tnum">
              {item.suggestedOrder > 0 ? `${formatNumber(item.suggestedOrder)} ${item.unit ?? 'units'}` : 'None'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Supplier</dt>
            <dd className="flex items-center gap-1.5 font-medium text-ink">
              <Truck className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              {item.supplierName ?? 'Not linked'}
            </dd>
          </div>
        </dl>

        <p className="text-[11px] leading-4 text-muted">
          Derived from {item.transactions} recorded transaction line(s) in the last {windowDays} days. Stock levels and
          prices are never changed by this analysis.
        </p>
      </div>
    </Drawer>
  );
}
