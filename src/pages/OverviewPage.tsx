import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  PackageX,
  Play,
  Plus,
  Receipt,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Truck,
  Upload,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, EmptyState, SectionCard, cn } from '../components/ui';
import { PriorityBadge } from '../components/inventory-badges';
import { ProductFormDialog } from '../components/ProductFormDialog';
import { ImportCsvDialog } from '../components/ImportCsvDialog';
import { useAction } from '../auth/AuthContext';
import { ProductDetailDrawer } from '../components/ProductDetailDrawer';
import { healthDistribution, formatCover } from '../lib/inventory';
import { formatNumber } from '../lib/format';
import { relativeTime } from '../lib/date';
import type { ActivityEntry, Product, RiskCategory } from '../types';

const KPI_TONES = {
  neutral: 'bg-canvas text-ink',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  info: 'bg-info-soft text-info',
  ok: 'bg-ok-soft text-ok',
  primary: 'bg-primary-soft text-primary-dark',
} as const;

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone,
  to,
  cta,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  tone: keyof typeof KPI_TONES;
  to: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="card group flex min-w-0 flex-col p-3.5 transition-colors hover:border-[#CBD5E1] hover:bg-primary-soft/20 sm:p-4"
      aria-label={`${label}: ${value}. ${cta}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-xs">{label}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', KPI_TONES[tone])} aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="tnum mt-2 text-2xl font-bold leading-none text-ink sm:text-[28px]">
        {formatNumber(value)}
      </p>
      <p className="mt-1.5 text-[11px] leading-4 text-muted">{hint}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[11px] font-semibold text-primary-dark">
        {cta}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

const FILTER_BY_RISK: Record<RiskCategory, string> = {
  healthy: '/inventory?filter=healthy',
  'low-only': '/inventory?filter=low',
  'expiry-only': '/inventory?filter=near-expiry',
  both: '/inventory?filter=both',
  expired: '/expiry?group=expired',
};

const ACTIVITY_ICONS: Record<ActivityEntry['type'], React.ReactNode> = {
  'product-added': <Plus className="h-3.5 w-3.5" aria-hidden="true" />,
  'product-updated': <Boxes className="h-3.5 w-3.5" aria-hidden="true" />,
  'product-deleted': <PackageX className="h-3.5 w-3.5" aria-hidden="true" />,
  'stock-updated': <Boxes className="h-3.5 w-3.5" aria-hidden="true" />,
  'supplier-added': <Truck className="h-3.5 w-3.5" aria-hidden="true" />,
  'supplier-updated': <Truck className="h-3.5 w-3.5" aria-hidden="true" />,
  'supplier-deleted': <Truck className="h-3.5 w-3.5" aria-hidden="true" />,
  'sales-imported': <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />,
  'sales-cleared': <Activity className="h-3.5 w-3.5" aria-hidden="true" />,
  sale: <Receipt className="h-3.5 w-3.5" aria-hidden="true" />,
  import: <Upload className="h-3.5 w-3.5" aria-hidden="true" />,
  reviewed: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  settings: <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />,
  reset: <Activity className="h-3.5 w-3.5" aria-hidden="true" />,
};

export default function OverviewPage() {
  const {
    products,
    insights,
    metrics,
    briefing,
    actionQueue,
    activity,
    settings,
    reviewedKeys,
  } = useStockora();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const canCreate = useAction('inventory', 'create');
  const canImportProducts = useAction('csv_import', 'create');
  const [detailId, setDetailId] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const slices = useMemo(() => healthDistribution(insights), [insights]);
  const chartData = slices.map((slice) => ({ ...slice }));
  const detailInsight = insights.find((insight) => insight.product.id === detailId) ?? null;
  const urgentPreview = actionQueue.slice(0, 4);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`Today · ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`}
        title="Overview"
        description={`What needs your attention at ${settings.shopName} today. Every figure is calculated from your current inventory.`}
        actions={
          <>
            {canImportProducts ? (
              <Button variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden="true" />} onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
            ) : null}
            {canCreate ? (
              <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openAdd}>
                Add product
              </Button>
            ) : null}
          </>
        }
      />

      <section
        aria-labelledby="briefing-title"
        className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-soft via-white to-canvas p-4 shadow-card sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-card" aria-hidden="true">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="briefing-title" className="text-sm font-semibold text-ink">
              Daily briefing
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-ink/80 sm:text-sm">{briefing}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-warn">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {metrics.lowStock} low stock
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-info">
                <CalendarClock className="h-3 w-3" aria-hidden="true" /> {metrics.nearExpiry} near expiry
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-crit">
                <ShieldAlert className="h-3 w-3" aria-hidden="true" /> {metrics.combined} combined
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-ok">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {metrics.healthy} healthy
              </span>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Inventory key metrics" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
        <KpiCard
          label="Total products"
          value={metrics.total}
          hint="Active SKUs being monitored"
          icon={<Boxes className="h-4 w-4" />}
          tone="primary"
          to="/inventory"
          cta="View inventory"
        />
        <KpiCard
          label="Low stock"
          value={metrics.lowStock}
          hint="At or below reorder level"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="warn"
          to="/inventory?filter=low"
          cta="Review low stock"
        />
        <KpiCard
          label="Near expiry"
          value={metrics.nearExpiry}
          hint={`Expiring within ${settings.expiryThreshold} day${settings.expiryThreshold === 1 ? '' : 's'}`}
          icon={<CalendarClock className="h-4 w-4" />}
          tone="info"
          to="/inventory?filter=near-expiry"
          cta="Open expiry monitor"
        />
        <KpiCard
          label="Urgent actions"
          value={metrics.urgent}
          hint={`${metrics.needsReview} still need review`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone="crit"
          to="/actions"
          cta="Open Action Center"
        />
        <KpiCard
          label="Healthy products"
          value={metrics.healthy}
          hint="No stock or expiry risk"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="ok"
          to="/inventory?filter=healthy"
          cta="See healthy stock"
        />
      </section>

      {products.length === 0 ? (
        <Card className="p-4 sm:p-6">
          <EmptyState
            icon={<Boxes className="h-5 w-5" />}
            title="Your inventory is empty"
            description="Add your first product or import a CSV to start monitoring stock levels, expiry risk and reorder needs."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {canCreate ? (
                  <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openAdd}>
                    Add product
                  </Button>
                ) : null}
                {canImportProducts ? (
                  <Button variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden="true" />} onClick={() => setImportOpen(true)}>
                    Import CSV
                  </Button>
                ) : null}
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-12">
            <SectionCard
              title="Inventory health"
              description="Each product is counted once across mutually exclusive states."
              className="xl:col-span-5"
              action={
                <span className="rounded-full bg-canvas px-2.5 py-1 text-[11px] font-semibold text-muted">
                  {metrics.total} products
                </span>
              }
            >
              <div className="relative">
                <div className="h-[210px] w-full sm:h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="count"
                        nameKey="label"
                        innerRadius="62%"
                        outerRadius="92%"
                        paddingAngle={2}
                        stroke="#FFFFFF"
                        strokeWidth={2}
                        onClick={(_, index) => {
                          const slice = slices[index];
                          if (slice) navigate(FILTER_BY_RISK[slice.key]);
                        }}
                        className="cursor-pointer focus:outline-none"
                        isAnimationActive={false}
                      >
                        {chartData.map((slice) => (
                          <Cell key={slice.key} fill={slice.count === 0 ? '#F1F5F2' : slice.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value} product${Number(value) === 1 ? '' : 's'}`, String(name)]}
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid #E4EAE5',
                          fontSize: 12,
                          boxShadow: '0 4px 6px -1px rgba(23,33,27,0.08)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="tnum text-2xl font-bold text-ink">{metrics.total}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Products</span>
                </div>
              </div>

              <ul className="mt-3 space-y-1">
                {slices.map((slice) => (
                  <li key={slice.key}>
                    <Link
                      to={FILTER_BY_RISK[slice.key]}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: slice.count === 0 ? '#D8E2DA' : slice.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{slice.label}</span>
                      <span className="tnum font-semibold text-ink">{slice.count}</span>
                      <span className="tnum w-9 text-right text-[11px] text-muted">{slice.percent}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard
              title="Urgent action preview"
              description="Highest-priority items from the unified action queue."
              className="xl:col-span-7"
              action={
                <Link
                  to="/actions"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary-dark hover:bg-primary-soft"
                >
                  View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              }
              bodyClassName="p-2 sm:p-3"
            >
              {urgentPreview.length === 0 ? (
                <div className="p-2">
                  <EmptyState
                    compact
                    icon={<CheckCircle2 className="h-5 w-5" />}
                    title="No urgent actions"
                    description="Stock cover and expiry dates are within your thresholds. Nothing needs attention right now."
                  />
                </div>
              ) : (
                <ul className="space-y-2">
                  {urgentPreview.map((insight) => {
                    const reviewed = reviewedKeys.has(insight.actionKey ?? '');
                    return (
                      <li
                        key={insight.product.id}
                        className="rounded-xl border border-line p-3 transition-colors hover:bg-canvas/60"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <PriorityBadge priority={insight.priority} />
                              {reviewed ? (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  Reviewed
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-sm font-semibold text-ink">{insight.product.name}</p>
                            <p className="tnum text-[11px] text-muted">
                              {insight.product.sku} · {insight.product.category}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-[11px]">
                            <span className="tnum rounded-md bg-canvas px-2 py-1 font-medium text-ink">
                              Stock {insight.product.currentStock}
                            </span>
                            <span className="tnum rounded-md bg-canvas px-2 py-1 font-medium text-ink">
                              Cover {formatCover(insight.daysOfCover)}
                            </span>
                            {insight.reorderQuantity > 0 ? (
                              <span className="tnum rounded-md bg-primary-soft px-2 py-1 font-medium text-primary-dark">
                                Reorder {insight.reorderQuantity}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted">
                          {insight.reasons[0] ?? 'Expiry risk needs review.'}{' '}
                          {insight.reasons[1] ?? ''}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-medium text-ink/80">{insight.suggestedAction}</p>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDetailId(insight.product.id)}
                            aria-label={`View details for ${insight.product.name}`}
                          >
                            View details
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <SectionCard
              title="Quick actions"
              description="Shortcuts for the most common inventory tasks."
              className="lg:col-span-5"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {canCreate ? (
                  <Button variant="secondary" className="justify-start" icon={<Plus className="h-4 w-4 text-primary" aria-hidden="true" />} onClick={openAdd}>
                    Add product
                  </Button>
                ) : null}
                {canImportProducts ? (
                  <Button variant="secondary" className="justify-start" icon={<Upload className="h-4 w-4 text-primary" aria-hidden="true" />} onClick={() => setImportOpen(true)}>
                    Import inventory
                  </Button>
                ) : null}
                <Link to="/actions" className="inline-flex h-10 items-center justify-start gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-[#CBD5E1] hover:bg-canvas">
                  <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" /> Open Action Center
                </Link>
                <Link to="/expiry" className="inline-flex h-10 items-center justify-start gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-[#CBD5E1] hover:bg-canvas">
                  <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" /> View expiring products
                </Link>
                <Link to="/reorder" className="inline-flex h-10 items-center justify-start gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-[#CBD5E1] hover:bg-canvas sm:col-span-2 lg:col-span-1 xl:col-span-2">
                  <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" /> Open Reorder Planner
                </Link>
                <Button
                  variant="secondary"
                  className="justify-start sm:col-span-2 lg:col-span-1 xl:col-span-2"
                  icon={<Play className="h-4 w-4 text-primary" aria-hidden="true" />}
                  onClick={() => window.dispatchEvent(new CustomEvent('stockora:start-tour'))}
                >
                  Start 3-minute demo tour
                </Button>
              </div>
              <div className="mt-3 rounded-lg bg-canvas px-3 py-2 text-[11px] leading-4 text-muted">
                Data saves automatically to your shop’s workspace. Use Settings to change the expiry threshold or safety buffer.
              </div>
            </SectionCard>

            <SectionCard
              title="Recent activity"
              description="Changes made to this inventory, newest first."
              className="lg:col-span-7"
              action={
                activity.length > 0 ? (
                  <span className="text-[11px] font-medium text-muted">{activity.length} events</span>
                ) : null
              }
            >
              {activity.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Activity className="h-5 w-5" />}
                  title="No activity recorded yet"
                  description="Add a product, update stock or import a CSV and the change will appear here."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {activity.slice(0, 5).map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas text-primary-dark" aria-hidden="true">
                        {ACTIVITY_ICONS[entry.type]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">{entry.message}</p>
                        {entry.detail ? <p className="truncate text-[11px] text-muted">{entry.detail}</p> : null}
                      </div>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {relativeTime(entry.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}

      <ProductFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        product={editing}
        onSaved={() => setEditing(null)}
      />
      <ImportCsvDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ProductDetailDrawer
        open={Boolean(detailInsight)}
        insight={detailInsight}
        onClose={() => setDetailId(null)}
        onEdit={(product) => {
          setDetailId(null);
          setEditing(product);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
