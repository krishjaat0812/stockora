import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeIndianRupee,
  Calculator as CalculatorIcon,
  CalendarClock,
  ClipboardList,
  Info,
  Package,
  PackageX,
  Percent,
  ReceiptText,
  Sigma,
  TrendingUp,
} from 'lucide-react';
import type { CurrencyCode } from '../types';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Card,
  EmptyState,
  InfoNote,
  NumberInput,
  SectionCard,
  Select,
  TextInput,
  cn,
} from '../components/ui';
import { formatCurrency, formatNumber } from '../lib/format';
import { summarizeInventory } from '../lib/calculator';
import {
  CALCULATOR_TOOLS,
  CATEGORY_META,
  CATEGORY_ORDER,
  applyPrefill,
  defaultValues,
  prefillContext,
  toolsForCategory,
  type CalculatorCategory,
  type ToolDefinition,
  type ToolOutput,
  type ToolValues,
} from '../lib/calculatorTools';

const CATEGORY_ICONS: Record<CalculatorCategory, typeof Package> = {
  inventory: Package,
  profit: TrendingUp,
  purchase: ReceiptText,
  sales: BadgeIndianRupee,
  expiry: CalendarClock,
  general: Sigma,
};

function formatValue(value: number, unit: string | null, currency: boolean, code: CurrencyCode): string {
  if (currency) return formatCurrency(value, code);
  const decimals = Number.isInteger(value) ? 0 : 2;
  const formatted = formatNumber(value, decimals);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** One result row: the number when there is one, otherwise the reason why not. */
function OutputRow({ output, currency }: { output: ToolOutput; currency: CurrencyCode }) {
  const formatted = output.value === null ? null : formatValue(output.value, output.unit, Boolean(output.currency), currency);
  return (
    <div className="flex flex-col gap-1 border-b border-line/70 py-2 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-xs leading-5 text-muted">{output.label}</dt>
      <dd className="min-w-0 text-sm font-semibold text-ink sm:text-right">
        {formatted ? (
          <span className="tnum">{formatted}</span>
        ) : output.text ? (
          <span className="font-medium text-ink">{output.text}</span>
        ) : (
          <span className="font-normal text-muted">{output.message ?? 'Unavailable'}</span>
        )}
        {formatted && output.message ? (
          <span className="mt-1 block text-[11px] font-normal leading-4 text-warn">{output.message}</span>
        ) : null}
      </dd>
    </div>
  );
}

function ToolCard({
  tool,
  values,
  onChange,
  currency,
}: {
  tool: ToolDefinition;
  values: ToolValues;
  onChange: (next: ToolValues) => void;
  currency: CurrencyCode;
}) {
  const outputs = useMemo(() => tool.compute(values), [tool, values]);
  const { products, settings } = useStockora();
  const context = useMemo(() => prefillContext(settings), [settings]);
  const [productId, setProductId] = useState('');

  const prefillOptions = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  function loadProduct(id: string) {
    setProductId(id);
    const product = products.find((entry) => entry.id === id);
    if (!product) return;
    onChange(applyPrefill(tool, values, product, context));
  }

  return (
    <Card className="flex flex-col p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <CalculatorIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{tool.name}</h3>
          <p className="mt-1 text-xs leading-5 text-muted">{tool.description}</p>
        </div>
      </div>

      {tool.prefill ? (
        <div className="mt-3">
          <label className="field-label" htmlFor={`${tool.id}-product`}>
            Load a product from inventory
          </label>
          <Select
            id={`${tool.id}-product`}
            value={productId}
            onChange={(event) => loadProduct(event.target.value)}
          >
            <option value="">Choose a product (optional)</option>
            {prefillOptions.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.sku})
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            Fills the inputs this product records. Anything it does not record keeps the default shown.
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tool.inputs.map((input) => {
          const raw = values[input.key];
          const id = `${tool.id}-${input.key}`;
          if (input.type === 'select') {
            return (
              <div key={input.key} className="min-w-0">
                <label className="field-label" htmlFor={id}>
                  {input.label}
                </label>
                <Select
                  id={id}
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(event) => onChange({ ...values, [input.key]: event.target.value })}
                >
                  {(input.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            );
          }
          if (input.type === 'date') {
            return (
              <div key={input.key} className="min-w-0">
                <label className="field-label" htmlFor={id}>
                  {input.label}
                </label>
                <TextInput
                  id={id}
                  type="date"
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(event) => onChange({ ...values, [input.key]: event.target.value })}
                />
              </div>
            );
          }
          return (
            <div key={input.key} className="min-w-0">
              <label className="field-label" htmlFor={id}>
                {input.label}
                {input.unit ? <span className="ml-1 font-normal text-muted">({input.unit})</span> : null}
              </label>
              <NumberInput
                id={id}
                value={raw === null || raw === undefined ? '' : String(raw)}
                onChange={(event) => onChange({ ...values, [input.key]: event.target.value })}
                step="any"
                min={0}
              />
              {input.help ? <p className="mt-1 text-[11px] leading-4 text-muted">{input.help}</p> : null}
            </div>
          );
        })}
      </div>

      <dl className="mt-4 rounded-xl border border-line bg-canvas/60 px-3 py-1.5">
        {outputs.map((output) => (
          <OutputRow key={output.label} output={output} currency={currency} />
        ))}
      </dl>

      <p className="mt-2 text-[11px] leading-4 text-muted">
        <span className="font-semibold text-ink/80">Formula:</span> {tool.formula}
      </p>
    </Card>
  );
}

export default function CalculatorPage() {
  const { products, settings } = useStockora();
  const [category, setCategory] = useState<CalculatorCategory>('inventory');
  const [valuesByTool, setValuesByTool] = useState<Record<string, ToolValues>>(() =>
    CALCULATOR_TOOLS.reduce<Record<string, ToolValues>>((acc, tool) => {
      acc[tool.id] = defaultValues(tool);
      return acc;
    }, {}),
  );

  const summary = useMemo(() => summarizeInventory(products, settings), [products, settings]);
  const tools = useMemo(() => toolsForCategory(category), [category]);
  const meta = CATEGORY_META[category];

  const partialData = summary.missingCost > 0 || summary.missingPrice > 0;

  return (
    <>
      <PageHeader
        eyebrow="Business calculator"
        title="Everything Calculator"
        description="Run the retail arithmetic behind your decisions — margins, markdowns, GST, supplier quotes, break-even and expiry loss. Every tool is live: change a number and the result updates."
      />

      {products.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<Package className="h-5 w-5" aria-hidden="true" />}
            title="No inventory yet"
            description="The calculator's live figures need products. Add stock in Inventory, or import a CSV, and this dashboard fills in. The individual tools below work without any products."
            action={
              <Link to="/inventory">
                <Badge tone="primary">Go to Inventory</Badge>
              </Link>
            }
          />
        </Card>
      ) : (
        <SectionCard
          title="Live inventory figures"
          description="Derived from your current products — not from the calculator's own inputs."
          icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
          className="mb-4"
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Units in stock',
                value: formatNumber(summary.unitsInStock),
                note: `${formatNumber(summary.productCount)} products`,
                tone: 'neutral' as const,
              },
              {
                label: 'Purchase value',
                value: formatCurrency(summary.purchaseValue, settings.currency),
                note: `from ${formatNumber(summary.costedProducts)} products with a cost`,
                tone: 'neutral' as const,
              },
              {
                label: 'Selling value',
                value: formatCurrency(summary.sellingValue, settings.currency),
                note: `from ${formatNumber(summary.pricedProducts)} products with a price`,
                tone: 'neutral' as const,
              },
              {
                label: 'Potential gross profit',
                value: formatCurrency(summary.potentialGrossProfit, settings.currency),
                note: 'products with both cost and price',
                tone: summary.potentialGrossProfit >= 0 ? ('ok' as const) : ('crit' as const),
              },
              {
                label: 'Dead stock value',
                value: formatCurrency(summary.deadStockValue, settings.currency),
                note: `${formatNumber(summary.deadStockUnits)} units with no recorded sales`,
                tone: summary.deadStockValue > 0 ? ('warn' as const) : ('neutral' as const),
              },
              {
                label: 'Reorder shortfall',
                value: formatCurrency(summary.shortageValue, settings.currency),
                note: `${formatNumber(summary.shortageUnits)} units suggested`,
                tone: summary.shortageUnits > 0 ? ('warn' as const) : ('neutral' as const),
              },
              {
                label: 'Value at risk before expiry',
                value: formatCurrency(summary.atRiskCost, settings.currency),
                note: `${formatNumber(summary.atRiskUnits)} units in ${formatNumber(summary.atRiskProducts)} products`,
                tone: summary.atRiskProducts > 0 ? ('crit' as const) : ('neutral' as const),
              },
              {
                label: 'Products near expiry',
                value: formatNumber(summary.nearExpiryProducts),
                note: `within your ${settings.expiryThreshold}-day threshold`,
                tone: summary.nearExpiryProducts > 0 ? ('warn' as const) : ('neutral' as const),
              },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-line bg-white px-3 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tile.label}</dt>
                <dd className="mt-1 text-lg font-bold text-ink tnum">{tile.value}</dd>
                <dd className="mt-1 text-[11px] leading-4 text-muted">{tile.note}</dd>
              </div>
            ))}
          </dl>

          {partialData ? (
            <div className="mt-3">
              <InfoNote tone="warn" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
                {summary.missingCost > 0
                  ? `${formatNumber(summary.missingCost)} product${summary.missingCost === 1 ? '' : 's'} record no unit cost`
                  : 'Every product records a unit cost'}
                {summary.missingPrice > 0
                  ? ` and ${formatNumber(summary.missingPrice)} record no selling price. Value totals cover only the products that record the figure, so they are lower bounds — not the whole shop.`
                  : '. Every product records a selling price.'}
              </InfoNote>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/reorder">
              <Badge tone="primary" icon={<ClipboardList className="h-3 w-3" aria-hidden="true" />}>
                Open Reorder Planner
              </Badge>
            </Link>
            <Link to="/expiry">
              <Badge tone="warn" icon={<CalendarClock className="h-3 w-3" aria-hidden="true" />}>
                Open Expiry Monitor
              </Badge>
            </Link>
          </div>
        </SectionCard>
      )}

      <div
        className="mb-4 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Calculator categories"
      >
        {CATEGORY_ORDER.map((key) => {
          const Icon = CATEGORY_ICONS[key];
          const active = key === category;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                active
                  ? 'border-primary bg-primary-soft text-primary-dark'
                  : 'border-line bg-white text-muted hover:border-[#CBD5E1] hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {CATEGORY_META[key].label}
            </button>
          );
        })}
      </div>

      <div className="mb-3">
        <h2 className="panel-title">{meta.label} calculators</h2>
        <p className="mt-0.5 text-xs leading-5 text-muted">{meta.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {tools.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            values={valuesByTool[tool.id]}
            onChange={(next) => setValuesByTool((prev) => ({ ...prev, [tool.id]: next }))}
            currency={settings.currency}
          />
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <InfoNote tone="info" icon={<Info className="h-4 w-4" aria-hidden="true" />}>
          These are labelled estimates. Every figure is arithmetic on the numbers you enter or the
          data recorded in your inventory — no trained model, market feed or supplier acknowledgement
          is involved. Nothing here places an order or sends a message.
        </InfoNote>
        <InfoNote tone="info" icon={<Percent className="h-4 w-4" aria-hidden="true" />}>
          GST calculations use the rate you enter. Different products can carry different rates, and
          nothing here is tax advice — confirm rates with your accountant.
        </InfoNote>
        <InfoNote tone="info" icon={<PackageX className="h-4 w-4" aria-hidden="true" />}>
          Currency conversion is not offered: no exchange-rate source is configured, so no rate is
          displayed or estimated. All money is in your shop currency ({settings.currency}).
        </InfoNote>
      </div>
    </>
  );
}
