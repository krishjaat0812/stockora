import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Database,
  FilePlus2,
  Info,
  Search,
  TrendingDown,
  TrendingUp,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  InfoNote,
  SectionCard,
  Select,
  TextInput,
  cn,
} from '../components/ui';
import { SalesImportDialog } from '../components/SalesImportDialog';
import { DemandDetailDrawer, TREND_META } from '../components/DemandDetailDrawer';
import { useToast } from '../components/toast';
import { useAction } from '../auth/AuthContext';
import {
  CLASSIFICATION_META,
  DEMAND_WINDOWS,
  FLAG_META,
  analyzeDemand,
  type DemandClassification,
  type DemandWindow,
} from '../lib/demand';
import { buildCsv } from '../lib/csv';
import { createSeedSales } from '../data/seed';
import { formatCurrency, formatNumber } from '../lib/format';
import { formatDate } from '../lib/date';
import { ApiError } from '../auth/api';

const CLASSIFICATION_ORDER: DemandClassification[] = [
  'best-seller',
  'steady',
  'slow-moving',
  'insufficient-history',
];

function KpiTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'crit' | 'info';
  icon: React.ReactNode;
}) {
  const tones = {
    neutral: 'bg-canvas text-ink',
    ok: 'bg-ok-soft text-[#166534]',
    warn: 'bg-warn-soft text-[#92400E]',
    crit: 'bg-crit-soft text-[#991B1B]',
    info: 'bg-info-soft text-[#1E40AF]',
  } as const;
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
          <p className="mt-1 text-xl font-bold text-ink tnum">{value}</p>
          {hint ? <p className="mt-0.5 text-[11px] leading-4 text-muted">{hint}</p> : null}
        </div>
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
          {icon}
        </span>
      </div>
    </Card>
  );
}

export default function DemandPage() {
  const {
    products,
    suppliers,
    sales,
    salesTrackingSince,
    settings,
    importSales,
    clearSalesHistory,
  } = useStockora();
  const toast = useToast();
  const canImport = useAction('demand_analytics', 'create');
  const canDelete = useAction('demand_analytics', 'delete');

  const [windowDays, setWindowDays] = useState<DemandWindow>(30);
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState<'all' | DemandClassification>('all');
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const report = useMemo(
    () =>
      analyzeDemand(
        { products, suppliers, sales, trackingSince: salesTrackingSince },
        { windowDays },
      ),
    [products, suppliers, sales, salesTrackingSince, windowDays],
  );

  const hasDemoRows = useMemo(() => sales.some((sale) => sale.source === 'demo'), [sales]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return report.items.filter((item) => {
      if (classification !== 'all' && item.classification !== classification) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) ||
        item.sku.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term) ||
        (item.supplierName ?? '').toLowerCase().includes(term)
      );
    });
  }, [report.items, query, classification]);

  const chartData = useMemo(
    () =>
      [...report.items]
        .filter((item) => item.unitsSold > 0)
        .slice(0, 6)
        .map((item) => ({
          name: item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name,
          units: item.unitsSold,
          id: item.productId,
        })),
    [report.items],
  );

  const detail = report.items.find((item) => item.productId === detailId) ?? null;
  const summary = report.summary;

  const loadSample = async () => {
    if (loadingSample) return;
    setLoadingSample(true);
    try {
      const demo = createSeedSales(products);
      const table = {
        headers: ['date', 'sku', 'quantity', 'unit_price'],
        rows: demo.sales.map((sale) => [sale.soldAt, sale.sku, sale.quantity, sale.unitPrice ?? '']),
      };
      const result = await importSales(buildCsv(table), { demo: true });
      toast.success(
        'Sample sales loaded',
        `${result.added} demo transactions added and clearly labelled as sample data.`,
      );
    } catch (error) {
      toast.error(
        'Could not load sample data',
        error instanceof ApiError ? error.message : 'Try again in a moment.',
      );
    } finally {
      setLoadingSample(false);
    }
  };

  const clearHistory = async () => {
    setConfirmClear(false);
    try {
      const removed = await clearSalesHistory();
      toast.success('Sales history cleared', `${removed} recorded line(s) removed. Inventory was not changed.`);
    } catch (error) {
      toast.error(
        'Could not clear sales history',
        error instanceof ApiError ? error.message : 'Try again in a moment.',
      );
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Product demand analytics"
        title="Demand Analytics"
        description="See what actually sells, what is slowing down, and where stock is at risk — calculated from your recorded sales transactions."
        actions={
          <>
            {canDelete && sales.length > 0 ? (
              <Button
                variant="secondary"
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setConfirmClear(true)}
              >
                Clear history
              </Button>
            ) : null}
            {canImport ? (
              <Button
                icon={<Upload className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setImportOpen(true)}
              >
                Import sales
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Analysis window">
          {DEMAND_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setWindowDays(days)}
              aria-pressed={windowDays === days}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                windowDays === days ? 'bg-primary text-white' : 'text-muted hover:bg-canvas hover:text-ink',
              )}
            >
              Last {days} days
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {summary.hasHistory
            ? `Sales recorded since ${formatDate(summary.trackingSince)} · ${formatNumber(summary.transactions)} transaction line(s) in this window`
            : 'No sales history recorded yet'}
        </p>
      </div>

      {hasDemoRows ? (
        <div className="mb-4">
          <InfoNote tone="warn" icon={<Database className="h-4 w-4" aria-hidden="true" />}>
            <span className="font-semibold">Sample data in use. </span>
            Some transactions are demo rows generated for the walkthrough, not real shop sales. Clear the history and
            import your own export when you are ready.
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Units sold"
          value={formatNumber(summary.unitsSold, summary.unitsSold % 1 === 0 ? 0 : 1)}
          hint={`${summary.windowDays}-day window`}
          tone="info"
          icon={<Boxes className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Revenue"
          value={summary.revenueAvailable ? formatCurrency(summary.revenue, settings.currency) : '—'}
          hint={summary.revenueAvailable ? 'Priced lines only' : 'No prices recorded'}
          tone="ok"
          icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Best sellers"
          value={formatNumber(summary.bestSellerCount)}
          hint="Top quartile velocity"
          tone="ok"
          icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Slow movers"
          value={formatNumber(summary.slowMovingCount)}
          hint={summary.slowMovingValue > 0 ? `${formatCurrency(summary.slowMovingValue, settings.currency)} in stock` : 'No sales in window'}
          tone="warn"
          icon={<TrendingDown className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Stockout risk"
          value={formatNumber(summary.stockoutRiskCount)}
          hint="Cover below lead time"
          tone="crit"
          icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Overstock value"
          value={formatCurrency(summary.overstockValue, settings.currency)}
          hint={`${summary.overstockCount} product(s) over 60 days`}
          tone="warn"
          icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
        />
      </div>

      {sales.length === 0 ? (
        <Card className="p-4 sm:p-6">
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
            title="Demand needs sales history"
            description="Import a CSV of recorded sales (date, SKU, quantity, optional price). Until then, products are shown as “not enough history” rather than being called slow movers."
            action={
              canImport ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    icon={<Upload className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setImportOpen(true)}
                  >
                    Import sales CSV
                  </Button>
                  <Button
                    variant="secondary"
                    loading={loadingSample}
                    icon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => void loadSample()}
                  >
                    Load sample history
                  </Button>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
            <SectionCard
              title="Units sold by product"
              description={`Top sellers in the last ${summary.windowDays} days, from recorded transactions.`}
              icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
            >
              {chartData.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Info className="h-5 w-5" aria-hidden="true" />}
                  title="No sales in this window"
                  description="Try a longer window, or import more recent sales lines."
                />
              ) : (
                <div className="h-[268px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#667085' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={118}
                        tick={{ fontSize: 11, fill: '#17211B' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value) => [`${formatNumber(Number(value), 1)} units`, 'Sold']}
                        contentStyle={{
                          borderRadius: 12,
                          border: '1px solid #E4EAE5',
                          fontSize: 12,
                          boxShadow: '0 4px 6px -1px rgba(23,33,27,0.08)',
                        }}
                      />
                      <Bar dataKey="units" radius={[0, 6, 6, 0]}>
                        {chartData.map((row, index) => (
                          <Cell key={row.id} fill={index === 0 ? '#14532D' : '#15803D'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Needs a decision"
              description="Advisory findings from recorded demand — nothing is changed automatically."
              icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            >
              <ul className="space-y-2">
                {[...report.stockoutRisks.slice(0, 3), ...report.overstock.filter((item) => !report.stockoutRisks.includes(item)).slice(0, 3)]
                  .slice(0, 5)
                  .map((item) => (
                    <li key={item.productId}>
                      <button
                        type="button"
                        onClick={() => setDetailId(item.productId)}
                        className="flex w-full items-start justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:bg-canvas/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">{item.name}</span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-muted">{item.recommendation}</span>
                        </span>
                        <span className="shrink-0">
                          {item.flags.includes('stockout-risk') ? (
                            <Badge tone="crit">Stockout</Badge>
                          ) : (
                            <Badge tone="warn">Overstock</Badge>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                {report.stockoutRisks.length === 0 && report.overstock.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Info className="h-5 w-5" aria-hidden="true" />}
                    title="Nothing urgent"
                    description="No stockout or overstock findings in this window."
                  />
                ) : null}
              </ul>
            </SectionCard>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <TextInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search product, SKU, category or supplier"
                  className="pl-9"
                  aria-label="Search demand rows"
                />
              </div>
              <Select
                value={classification}
                onChange={(event) => setClassification(event.target.value as 'all' | DemandClassification)}
                aria-label="Filter by demand classification"
                className="w-full sm:w-52"
              >
                <option value="all">All demand signals</option>
                {CLASSIFICATION_ORDER.map((key) => (
                  <option key={key} value={key}>
                    {CLASSIFICATION_META[key].label}
                  </option>
                ))}
              </Select>
            </div>

            {filtered.length === 0 ? (
              <div className="p-4 sm:p-6">
                <EmptyState
                  compact
                  icon={<Search className="h-5 w-5" aria-hidden="true" />}
                  title="No products match"
                  description="Change the search term or demand filter."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line bg-canvas/60 text-left text-[11px] uppercase tracking-wide text-muted">
                      <th scope="col" className="px-4 py-2.5 font-semibold">Product</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Sold</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Per day</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Trend</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Cover</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Demand signal</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Guidance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filtered.map((item) => {
                      const meta = CLASSIFICATION_META[item.classification];
                      const trend = TREND_META[item.trend];
                      return (
                        <tr
                          key={item.productId}
                          className="cursor-pointer transition-colors hover:bg-canvas/50"
                          onClick={() => setDetailId(item.productId)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-ink">{item.name}</p>
                            <p className="text-[11px] text-muted">
                              {item.sku} · {item.category}
                              {item.expired ? ' · expired' : ''}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right tnum text-ink">{formatNumber(item.unitsSold, item.unitsSold % 1 === 0 ? 0 : 1)}</td>
                          <td className="px-4 py-3 text-right tnum text-ink">{formatNumber(item.velocity, 2)}</td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', trend.tone)}>
                              {trend.icon}
                              {trend.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tnum text-ink">
                            {item.coverageDays === null ? '—' : `${formatNumber(item.coverageDays, 1)}d`}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                              {item.flags
                                .filter((flag) => flag !== 'no-recent-sales')
                                .map((flag) => (
                                  <Badge key={flag} tone={FLAG_META[flag].tone}>
                                    {FLAG_META[flag].label}
                                  </Badge>
                                ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="max-w-[280px] text-xs leading-5 text-muted">{item.recommendation}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-2">
            <InfoNote tone="info" icon={<Info className="h-4 w-4" aria-hidden="true" />}>
              <span className="font-semibold">How this is calculated. </span>
              Velocity is recorded units divided by tracked days. A product is a best seller when its velocity is in
              the top quartile, slow moving when it has no sales in the window despite at least 14 days of history, and
              “not enough history” when the data cannot support a verdict. Overstock means more than 60 days of cover at
              the recorded rate; stockout risk means cover is shorter than the supplier lead time. Expired stock is never
              recommended for sale.
            </InfoNote>
            {summary.insufficientCount > 0 ? (
              <InfoNote tone="warn">
                {summary.insufficientCount} product{summary.insufficientCount === 1 ? ' is' : 's are'} waiting for more
                history. They are deliberately not counted as zero demand.
              </InfoNote>
            ) : null}
            {canImport ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                  Import more sales lines
                </Button>
                {sales.length > 0 ? (
                  <Button variant="ghost" size="sm" loading={loadingSample} onClick={() => void loadSample()}>
                    Add sample history
                  </Button>
                ) : null}
                <span className="text-[11px] text-muted">
                  {sales.length} recorded line{sales.length === 1 ? '' : 's'} stored for this shop.
                </span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <SalesImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <DemandDetailDrawer
        item={detail}
        windowDays={summary.windowDays}
        currency={settings.currency}
        onClose={() => setDetailId(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Clear sales history?"
        message={
          <>
            <p>
              This removes all {formatNumber(sales.length)} recorded sales line(s). Products, stock levels, prices and
              suppliers stay exactly as they are.
            </p>
            <p className="mt-2">Demand analytics will show “not enough history” until you import sales again.</p>
          </>
        }
        confirmLabel="Clear history"
        destructive
        onConfirm={() => void clearHistory()}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
