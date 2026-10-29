import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Download,
  Info,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, InfoNote, SectionCard, cn } from '../components/ui';
import { useToast } from '../components/toast';
import {
  DEMO_ACCEPTANCE,
  categorySummary,
  healthDistribution,
  priorityDistribution,
  reorderRows,
} from '../lib/inventory';
import {
  actionTable,
  expiryTable,
  fileStamp,
  inventoryTable,
  reorderTable,
} from '../lib/csv';
import { ExportDeniedError, exportCsv } from '../lib/download';
import { useAction } from '../auth/AuthContext';
import { formatCurrency, formatNumber } from '../lib/format';

export default function ReportsPage() {
  const {
    insights,
    products,
    settings,
    metrics,
    actionQueue,
    reviewedKeys,
  } = useStockora();
  const toast = useToast();
  const canExport = useAction('csv_export', 'export');

  const runExport = async (
    view: 'inventory' | 'actions' | 'expiry' | 'reorder',
    filename: string,
    table: Parameters<typeof exportCsv>[1],
    successMessage: string,
  ) => {
    try {
      await exportCsv(filename, table, view);
    } catch (err) {
      toast.error(
        'Export not allowed',
        err instanceof ExportDeniedError ? err.message : 'Export failed. Try again.',
      );
      return;
    }
    toast.success('Export ready', successMessage);
  };

  const health = useMemo(() => healthDistribution(insights), [insights]);
  const priorities = useMemo(() => priorityDistribution(insights), [insights]);
  const categories = useMemo(() => categorySummary(insights), [insights]);
  const reorder = useMemo(
    () => reorderRows(insights).filter((insight) => !insight.isExpired),
    [insights],
  );

  const liveFlags = metrics.lowStock + metrics.nearExpiry;
  const totalStockValue = categories.reduce((sum, category) => sum + category.stockValue, 0);
  const categoriesWithCost = categories.some((category) => category.stockValue > 0);

  const exports = [
    {
      label: 'Inventory',
      description: `${products.length} products with stock and expiry fields`,
      onClick: () =>
        void runExport(
          'inventory',
          `stockora-inventory-${fileStamp()}.csv`,
          inventoryTable(products),
          'Full product list downloaded as CSV.',
        ),
    },
    {
      label: 'Action Center',
      description: `${actionQueue.length} prioritized actions with suggested steps`,
      onClick: () =>
        void runExport(
          'actions',
          `stockora-actions-${fileStamp()}.csv`,
          actionTable(actionQueue, reviewedKeys),
          'All current actions downloaded as CSV.',
        ),
    },
    {
      label: 'Expiry Monitor',
      description: `${insights.filter((insight) => insight.product.expiryDate).length} products with recorded expiry dates`,
      onClick: () =>
        void runExport(
          'expiry',
          `stockora-expiry-${fileStamp()}.csv`,
          expiryTable(insights),
          'Grouped expiry data downloaded as CSV.',
        ),
    },
    {
      label: 'Reorder Planner',
      description: `${reorder.length} replenishment suggestions with formula inputs`,
      onClick: () =>
        void runExport(
          'reorder',
          `stockora-reorder-${fileStamp()}.csv`,
          reorderTable(reorder, settings.safetyBufferDays),
          'Suggestions downloaded as CSV.',
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports & Impact"
        description="Distribution, category totals and a controlled acceptance-test comparison. Live inventory figures are kept separate from the seeded test baseline."
      />

      {canExport ? (
      <section aria-labelledby="exports-title">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="exports-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Download className="h-4 w-4 text-primary" aria-hidden="true" /> Export reports
          </h2>
          <span className="text-[11px] text-muted">CSV · opens in Excel or Sheets</span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {exports.map((item) => (
            <Card key={item.label} className="flex flex-col gap-2 p-3.5">
              <div>
                <p className="text-sm font-semibold text-ink">{item.label}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted">{item.description}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-auto self-start"
                icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={item.onClick}
              >
                Export CSV
              </Button>
            </Card>
          ))}
        </div>
      </section>
      ) : null}

      <section aria-label="Live inventory summary" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Total products', value: metrics.total, tone: 'text-ink', icon: <Boxes className="h-4 w-4" /> },
          { label: 'Healthy', value: metrics.healthy, tone: 'text-ok', icon: <CheckCircle2 className="h-4 w-4" /> },
          { label: 'Low stock', value: metrics.lowStock, tone: 'text-warn', icon: <AlertTriangle className="h-4 w-4" /> },
          { label: 'Near expiry', value: metrics.nearExpiry, tone: 'text-info', icon: <Layers className="h-4 w-4" /> },
          { label: 'Combined risk', value: metrics.combined, tone: 'text-crit', icon: <ShieldCheck className="h-4 w-4" /> },
          { label: 'Expired', value: metrics.expired, tone: 'text-crit', icon: <ShieldCheck className="h-4 w-4" /> },
        ].map((item) => (
          <Card key={item.label} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{item.label}</p>
              <span className={cn('opacity-70', item.tone)} aria-hidden="true">{item.icon}</span>
            </div>
            <p className={cn('tnum mt-1 text-xl font-bold', item.tone)}>{formatNumber(item.value)}</p>
            <p className="text-[10px] text-muted">Live inventory</p>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <SectionCard
          title="Inventory health distribution"
          description="Mutually exclusive categories derived from current stock and expiry rules."
          className="xl:col-span-6"
          icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
        >
          <ul className="space-y-3">
            {health.map((slice) => {
              const total = slice.key === 'expired' ? metrics.total : Math.max(1, metrics.total - metrics.expired);
              const percent = total === 0 ? 0 : Math.round((slice.count / total) * 100);
              return (
                <li key={slice.key}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                      <span className="truncate font-medium text-ink">{slice.label}</span>
                    </span>
                    <span className="shrink-0 text-muted">
                      <span className="tnum font-semibold text-ink">{slice.count}</span> · {percent}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{ width: `${percent}%`, backgroundColor: slice.color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-4 text-muted">
            Expired products are excluded from the four live-health categories and reported separately. Each product is
            counted once.
          </p>
        </SectionCard>

        <SectionCard
          title="Action priority distribution"
          description="How many products sit in each action tier right now."
          className="xl:col-span-6"
          icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}
        >
          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorities} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 0 }} barCategoryGap={14}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={112}
                  tick={{ fontSize: 11, fill: '#17211B' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#F0FDF4' }}
                  formatter={(value) => [`${value} product${Number(value) === 1 ? '' : 's'}`, 'Count']}
                  contentStyle={{ borderRadius: 10, border: '1px solid #E4EAE5', fontSize: 12 }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                  {priorities.map((item) => (
                    <Cell key={item.priority} fill={item.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            Priority 0 expired · 1 combined risk · 2 low stock only · 3 near expiry only. Products outside these tiers
            are healthy or have no recorded expiry risk.
          </p>
        </SectionCard>
      </div>

      <SectionCard
        title="Category-level stock overview"
        description={`Stock value uses recorded unit costs${categoriesWithCost ? '' : ' (none recorded yet)'}.`}
        icon={<Layers className="h-4 w-4" aria-hidden="true" />}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <caption className="sr-only">Category totals for products, units, risks and stock value</caption>
            <thead className="table-head">
              <tr>
                <th scope="col" className="px-4 py-2.5">Category</th>
                <th scope="col" className="px-4 py-2.5 text-right">Products</th>
                <th scope="col" className="px-4 py-2.5 text-right">Units in stock</th>
                <th scope="col" className="px-4 py-2.5 text-right">Low stock</th>
                <th scope="col" className="px-4 py-2.5 text-right">Near expiry</th>
                <th scope="col" className="px-4 py-2.5 text-right">Expired</th>
                <th scope="col" className="px-4 py-2.5 text-right">Stock value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {categories.map((category) => (
                <tr key={category.category} className="hover:bg-primary-soft/30">
                  <td className="px-4 py-2.5 text-sm font-medium text-ink">{category.category}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm text-muted">{category.products}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-medium text-ink">{formatNumber(category.units)}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm text-muted">{category.lowStock}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm text-muted">{category.expiring}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm text-muted">
                    <span className={category.expired > 0 ? 'font-semibold text-crit' : ''}>{category.expired}</span>
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-sm text-ink">
                    {category.missingCost > 0 && category.stockValue === 0
                      ? 'Not recorded'
                      : formatCurrency(category.stockValue, settings.currency)}
                  </td>
                </tr>
              ))}
              {categories.length > 0 ? (
                <tr className="bg-canvas/70">
                  <th scope="row" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    Total
                  </th>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-semibold text-ink">{metrics.total}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-semibold text-ink">{formatNumber(metrics.unitsInStock)}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-semibold text-ink">{metrics.lowStock}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-semibold text-ink">{metrics.nearExpiry}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-semibold text-ink">{metrics.expired}</td>
                  <td className="tnum px-4 py-2.5 text-right text-sm font-semibold text-ink">
                    {formatCurrency(totalStockValue, settings.currency)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {categories.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No categories yet. Add products or import a CSV to populate the report.
          </p>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Controlled demo impact"
        description="Acceptance-test comparison from the seeded dataset — not a measurement of real-world performance."
        icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        action={<Badge tone="warn">Seeded test dataset</Badge>}
      >
        <div className="grid gap-3 lg:grid-cols-5">
          {[
            { label: 'Expected individual risk flags', value: DEMO_ACCEPTANCE.expectedIndividualRiskFlags, hint: 'Low stock + near expiry conditions' },
            { label: 'Low-stock-only flags detected', value: DEMO_ACCEPTANCE.lowStockOnlyFlagsDetected, hint: 'Stock-only monitoring would see these' },
            { label: 'Combined flags detected', value: DEMO_ACCEPTANCE.combinedFlagsDetected, hint: 'Stockora’s combined rules' },
            { label: 'Distinct affected products', value: DEMO_ACCEPTANCE.distinctAffectedProducts, hint: 'Milk, Bread, Juice, Yogurt' },
            { label: 'Expected false alarms', value: DEMO_ACCEPTANCE.expectedFalseAlarms, hint: 'Under specified acceptance tests' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-line bg-canvas/50 p-3">
              <p className="text-[10px] font-semibold uppercase leading-4 tracking-wide text-muted">{item.label}</p>
              <p className="tnum mt-1 text-2xl font-bold text-ink">{item.value}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-muted">{item.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-line bg-white p-3.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">How the comparison works</h3>
          <p className="mt-1.5 text-[12px] leading-5 text-muted">
            The seeded dataset contains seven individual risk conditions across four products: three low-stock
            conditions (Milk, Bread, Yogurt) and four near-expiry conditions (Milk, Bread, Juice, Yogurt). A stock-only
            check detects 3 of the 7 flags and would miss Juice entirely, because its stock is healthy. Stockora’s
            expiry-aware rules detect 7 of 7 flags with no false alarms under the acceptance tests.
          </p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-warn/20 bg-warn-soft/40 px-3 py-2 text-[11px] leading-4 text-[#78350F]">
              <span className="font-semibold">Stock-only view:</span> 3 / 7 flags · 3 distinct products · misses Juice.
            </div>
            <div className="rounded-lg border border-ok/20 bg-ok-soft/50 px-3 py-2 text-[11px] leading-4 text-[#14532D]">
              <span className="font-semibold">Stockora combined view:</span> 7 / 7 flags · 4 distinct products · 0 false
              alarms.
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-primary/20 bg-primary-soft/40 p-3.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-dark">Live inventory now</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted">Individual risk flags</dt>
                <dd className="tnum text-lg font-semibold text-ink">
                  {liveFlags}
                  <span className="ml-1 text-[10px] font-normal text-muted">({metrics.lowStock} low + {metrics.nearExpiry} expiry)</span>
                </dd>
              </div>
              <div>
                <dt className="text-muted">Distinct affected products</dt>
                <dd className="tnum text-lg font-semibold text-ink">{actionQueue.length}</dd>
              </div>
            </dl>
            <p className="mt-1.5 text-[10px] leading-4 text-muted">
              These figures change with your inventory. The seeded baseline above stays fixed for the demonstration.
            </p>
          </div>
          <div className="rounded-xl border border-line p-3.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">What this does not claim</h3>
            <ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-muted">
              <li>• No real-world waste reduction, revenue gain or cost saving is measured or claimed.</li>
              <li>• The comparison uses a controlled six-product acceptance dataset only.</li>
              <li>• Reorder quantities are suggestions, not purchase orders.</li>
              <li>• Expiry dates are recorded data, not a food-safety guarantee.</li>
            </ul>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <InfoNote tone="info" icon={<Info className="h-4 w-4" aria-hidden="true" />}>
          Reports are calculated from the same inventory source as the dashboard, action list and planner. There are no
          separately maintained totals.
        </InfoNote>
        <InfoNote tone="warn" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
          Stock value is an estimate from optional unit cost fields. Products without a cost are excluded from the value
          column, so the total may understate the true stock value.
        </InfoNote>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-2 p-3.5">
        <p className="text-[11px] text-muted">Need the detailed records? All four CSV exports include every derived field.</p>
        <Link to="/inventory" className="text-[11px] font-semibold text-primary-dark hover:underline">
          Go to inventory →
        </Link>
      </Card>
    </div>
  );
}
