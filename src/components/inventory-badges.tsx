import { AlertTriangle, CalendarClock, CheckCircle2, CircleSlash, Clock, PackageX, XCircle } from 'lucide-react';
import type { ProductInsight, RiskCategory } from '../types';
import { Badge } from './ui';

export function StockStatusBadge({ insight }: { insight: ProductInsight }) {
  if (insight.stockStatus === 'out') {
    return (
      <Badge tone="crit" icon={<PackageX className="h-3 w-3" aria-hidden="true" />}>
        Out of stock
      </Badge>
    );
  }
  if (insight.isLowStock) {
    return (
      <Badge tone="warn" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
        Low stock
      </Badge>
    );
  }
  return (
    <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}>
      Healthy
    </Badge>
  );
}

export function ExpiryStatusBadge({ insight }: { insight: ProductInsight }) {
  const { daysRemaining, expiryStatus } = insight;
  if (expiryStatus === 'missing') {
    return (
      <Badge tone="neutral" icon={<CircleSlash className="h-3 w-3" aria-hidden="true" />} title="No expiry date recorded">
        No date
      </Badge>
    );
  }
  if (expiryStatus === 'expired') {
    return (
      <Badge tone="crit" icon={<XCircle className="h-3 w-3" aria-hidden="true" />}>
        Expired {Math.abs(daysRemaining ?? 0)}d ago
      </Badge>
    );
  }
  if (expiryStatus === 'today') {
    return (
      <Badge tone="crit" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
        Expires today
      </Badge>
    );
  }
  if (expiryStatus === 'near') {
    return (
      <Badge tone="warn" icon={<Clock className="h-3 w-3" aria-hidden="true" />}>
        {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left
      </Badge>
    );
  }
  return (
    <Badge tone="ok" icon={<CalendarClock className="h-3 w-3" aria-hidden="true" />}>
      {daysRemaining} days left
    </Badge>
  );
}

const RISK_LABELS: Record<RiskCategory, { label: string; tone: 'ok' | 'warn' | 'crit' | 'info' | 'neutral' }> = {
  healthy: { label: 'Healthy', tone: 'ok' },
  'low-only': { label: 'Low stock', tone: 'warn' },
  'expiry-only': { label: 'Near expiry', tone: 'info' },
  both: { label: 'Low stock + expiry', tone: 'crit' },
  expired: { label: 'Expired', tone: 'crit' },
};

export function RiskBadge({ risk }: { risk: RiskCategory }) {
  const meta = RISK_LABELS[risk];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: ProductInsight['priority'] }) {
  if (priority === null) return <Badge tone="ok">No action</Badge>;
  const meta = {
    0: { label: 'P0 · Expired', tone: 'crit' as const },
    1: { label: 'P1 · Combined risk', tone: 'crit' as const },
    2: { label: 'P2 · Low stock', tone: 'warn' as const },
    3: { label: 'P3 · Near expiry', tone: 'info' as const },
  }[priority];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function ReviewedBadge({ reviewed }: { reviewed: boolean }) {
  return reviewed ? (
    <Badge tone="primary" icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}>
      Reviewed
    </Badge>
  ) : (
    <Badge tone="neutral">Needs review</Badge>
  );
}
