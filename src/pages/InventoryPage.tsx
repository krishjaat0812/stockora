import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownUp,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FilterX,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Product, ProductInsight } from '../types';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  TextInput,
  cn,
} from '../components/ui';
import { ExpiryStatusBadge, StockStatusBadge } from '../components/inventory-badges';
import { ProductFormDialog } from '../components/ProductFormDialog';
import { ImportCsvDialog } from '../components/ImportCsvDialog';
import { ProductDetailDrawer } from '../components/ProductDetailDrawer';
import { DeleteProductDialog } from '../components/DeleteProductDialog';
import { useToast } from '../components/toast';
import { formatCover, reorderFormula } from '../lib/inventory';
import { fileStamp, inventoryTable } from '../lib/csv';
import { ExportDeniedError, exportCsv } from '../lib/download';
import { useAction } from '../auth/AuthContext';
import { formatNumber } from '../lib/format';
import { formatDate } from '../lib/date';

type StatusFilter = 'all' | 'low' | 'near-expiry' | 'expired' | 'both' | 'healthy';
type SortKey =
  | 'name-asc'
  | 'name-desc'
  | 'stock-asc'
  | 'stock-desc'
  | 'cover-asc'
  | 'cover-desc'
  | 'expiry-asc'
  | 'expiry-desc';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'low', label: 'Low stock' },
  { value: 'near-expiry', label: 'Near expiry' },
  { value: 'both', label: 'Combined risk' },
  { value: 'expired', label: 'Expired' },
  { value: 'healthy', label: 'Healthy' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'name-asc', label: 'Product name (A–Z)' },
  { value: 'name-desc', label: 'Product name (Z–A)' },
  { value: 'stock-asc', label: 'Stock (low to high)' },
  { value: 'stock-desc', label: 'Stock (high to low)' },
  { value: 'cover-asc', label: 'Days of cover (low to high)' },
  { value: 'cover-desc', label: 'Days of cover (high to low)' },
  { value: 'expiry-asc', label: 'Expiry (soonest first)' },
  { value: 'expiry-desc', label: 'Expiry (latest first)' },
];

const PAGE_SIZES = [6, 10, 25, 50];

function matchesStatus(insight: ProductInsight, filter: StatusFilter): boolean {
  switch (filter) {
    case 'low':
      return insight.isLowStock;
    case 'near-expiry':
      return insight.isNearExpiry;
    case 'expired':
      return insight.isExpired;
    case 'both':
      return insight.risk === 'both';
    case 'healthy':
      return insight.risk === 'healthy';
    default:
      return true;
  }
}

function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function sortRows(rows: ProductInsight[], sort: SortKey): ProductInsight[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'name-desc':
        return b.product.name.localeCompare(a.product.name);
      case 'stock-asc':
        return a.product.currentStock - b.product.currentStock;
      case 'stock-desc':
        return b.product.currentStock - a.product.currentStock;
      case 'cover-asc':
        return compareNullable(a.daysOfCover, b.daysOfCover, 1);
      case 'cover-desc':
        return compareNullable(a.daysOfCover, b.daysOfCover, -1);
      case 'expiry-asc':
        return compareNullable(a.daysRemaining, b.daysRemaining, 1);
      case 'expiry-desc':
        return compareNullable(a.daysRemaining, b.daysRemaining, -1);
      case 'name-asc':
      default:
        return a.product.name.localeCompare(b.product.name);
    }
  });
  return sorted;
}

function PageButton({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'h-8 min-w-8 rounded-md border px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-line bg-white text-ink hover:bg-canvas',
      )}
    >
      {children}
    </button>
  );
}

export default function InventoryPage() {
  const { products, insights, settings } = useStockora();
  const toast = useToast();
  const canImport = useAction('csv_import', 'create');
  const canExport = useAction('csv_export', 'export');
  const canCreate = useAction('inventory', 'create');
  const canEdit = useAction('inventory', 'edit');
  const canDelete = useAction('inventory', 'delete');
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const q = searchParams.get('q') ?? '';
  const statusParam = (searchParams.get('filter') ?? 'all') as StatusFilter;
  const status = STATUS_OPTIONS.some((option) => option.value === statusParam) ? statusParam : 'all';
  const category = searchParams.get('category') ?? 'all';
  const sortParam = (searchParams.get('sort') ?? 'name-asc') as SortKey;
  const sort = SORT_OPTIONS.some((option) => option.value === sortParam) ? sortParam : 'name-asc';
  const sizeParam = Number(searchParams.get('size') ?? '10');
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 10;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const activeProductId = searchParams.get('product');

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const updateParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return insights.filter((insight) => {
      if (!matchesStatus(insight, status)) return false;
      if (category !== 'all' && insight.product.category !== category) return false;
      if (!needle) return true;
      return (
        insight.product.name.toLowerCase().includes(needle) ||
        insight.product.sku.toLowerCase().includes(needle)
      );
    });
  }, [insights, q, status, category]);

  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);
  const activeInsight = insights.find((insight) => insight.product.id === activeProductId) ?? null;
  const hasFilters = Boolean(q) || status !== 'all' || category !== 'all' || sort !== 'name-asc';

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const exportInventory = async () => {
    const rows = sorted.map((insight) => insight.product);
    try {
      await exportCsv(`stockora-inventory-${fileStamp()}.csv`, inventoryTable(rows), 'inventory');
    } catch (err) {
      toast.error(
        'Export not allowed',
        err instanceof ExportDeniedError ? err.message : 'Export failed. Try again.',
      );
      return;
    }
    toast.success(
      'Inventory exported',
      `${rows.length} product${rows.length === 1 ? '' : 's'} exported with the current filters applied.`,
    );
  };

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const filterSummary = [
    status !== 'all' ? STATUS_OPTIONS.find((option) => option.value === status)?.label : null,
    category !== 'all' ? category : null,
    q ? `“${q}”` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Search, filter and maintain every product. Stock status, expiry risk, days of cover and reorder suggestions recalculate as soon as you save."
        actions={
          <>
            {canImport ? (
              <Button
                variant="secondary"
                icon={<Upload className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setImportOpen(true)}
              >
                Import
              </Button>
            ) : null}
            {canExport ? (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void exportInventory()}
              >
                Export CSV
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

      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <label htmlFor="inventory-search" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <TextInput
                id="inventory-search"
                value={q}
                onChange={(event) => updateParams({ q: event.target.value })}
                placeholder="Product name or SKU"
                className="pl-9"
              />
            </div>
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="inventory-category" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Category
            </label>
            <Select
              id="inventory-category"
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
            <label htmlFor="inventory-status" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Status
            </label>
            <Select
              id="inventory-status"
              value={status}
              onChange={(event) => updateParams({ filter: event.target.value === 'all' ? null : event.target.value })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-3">
            <label htmlFor="inventory-sort" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Sort by
            </label>
            <div className="relative">
              <ArrowDownUp className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
              <Select
                id="inventory-sort"
                value={sort}
                onChange={(event) => updateParams({ sort: event.target.value })}
                className="pl-8"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="font-semibold text-ink">
              {filtered.length} of {products.length}
            </span>
            <span>products shown</span>
            {filterSummary.map((item) => (
              <Badge key={item} tone="primary">
                {item}
              </Badge>
            ))}
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" icon={<FilterX className="h-4 w-4" aria-hidden="true" />} onClick={resetFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </Card>

      {products.length === 0 ? (
        <Card className="p-4 sm:p-6">
          <EmptyState
            icon={<Boxes className="h-5 w-5" />}
            title="No products in inventory"
            description="Add your first product or import a CSV to begin. All dashboards and reports will populate automatically."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {canCreate ? (
                  <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openAdd}>
                    Add product
                  </Button>
                ) : null}
                {canImport ? (
                  <Button variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden="true" />} onClick={() => setImportOpen(true)}>
                    Import CSV
                  </Button>
                ) : null}
              </div>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-4 sm:p-6">
          <EmptyState
            icon={<PackageSearch className="h-5 w-5" />}
            title="No products match these filters"
            description="Adjust the search term, category or status filter to see products."
            action={
              <Button variant="secondary" onClick={resetFilters}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-card lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left">
                <caption className="sr-only">
                  Inventory products with stock, expiry and reorder information
                </caption>
                <thead className="table-head">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">SKU</th>
                    <th scope="col" className="px-3 py-2.5">Product</th>
                    <th scope="col" className="px-3 py-2.5">Category</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Stock</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Reorder lvl</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Avg sales</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Cover</th>
                    <th scope="col" className="px-3 py-2.5">Expiry</th>
                    <th scope="col" className="px-3 py-2.5">Stock status</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Suggested reorder</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageRows.map((insight) => {
                    const { product } = insight;
                    const breakdown = reorderFormula(product, settings.safetyBufferDays);
                    return (
                      <tr key={product.id} className="transition-colors hover:bg-primary-soft/30">
                        <td className="table-cell tnum whitespace-nowrap font-medium text-muted">{product.sku}</td>
                        <td className="table-cell">
                          <button
                            type="button"
                            onClick={() => updateParams({ product: product.id }, false)}
                            className="max-w-[200px] truncate text-left font-semibold text-ink hover:text-primary-dark hover:underline"
                          >
                            {product.name}
                          </button>
                          <p className="text-[11px] text-muted">
                            {product.supplierName ?? 'Supplier not recorded'}
                          </p>
                        </td>
                        <td className="table-cell whitespace-nowrap text-muted">{product.category}</td>
                        <td className="table-cell tnum text-right font-semibold text-ink">
                          {product.unit ? `${formatNumber(product.currentStock)} ${product.unit}` : formatNumber(product.currentStock)}
                        </td>
                        <td className="table-cell tnum text-right text-muted">{product.reorderLevel}</td>
                        <td className="table-cell tnum text-right text-muted">
                          {formatNumber(product.averageDailySales, product.averageDailySales % 1 === 0 ? 0 : 1)}
                        </td>
                        <td className="table-cell tnum whitespace-nowrap text-right font-medium text-ink">
                          {formatCover(insight.daysOfCover)}
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          <ExpiryStatusBadge insight={insight} />
                          <p className="mt-0.5 text-[10px] text-muted">{formatDate(product.expiryDate)}</p>
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          <StockStatusBadge insight={insight} />
                        </td>
                        <td className="table-cell text-right">
                          <span
                            className="tnum inline-flex min-w-8 justify-end font-semibold text-primary-dark"
                            title={breakdown.formula}
                          >
                            {insight.reorderQuantity}
                          </span>
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => updateParams({ product: product.id }, false)}
                              className="rounded-md p-1.5 text-muted hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`View ${product.name}`}
                              title="View details"
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </button>
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(product);
                                  setFormOpen(true);
                                }}
                                className="rounded-md p-1.5 text-muted hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={`Edit ${product.name}`}
                                title="Edit product"
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(product)}
                                className="rounded-md p-1.5 text-muted hover:bg-crit-soft hover:text-crit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={`Delete ${product.name}`}
                                title="Delete product"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile and tablet card list */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:hidden">
            {pageRows.map((insight) => {
              const { product } = insight;
              return (
                <Card key={product.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => updateParams({ product: product.id }, false)}
                      className="min-w-0 text-left"
                    >
                      <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                      <p className="tnum text-[11px] text-muted">
                        {product.sku} · {product.category}
                      </p>
                    </button>
                    {insight.reorderQuantity > 0 ? (
                      <span className="tnum shrink-0 rounded-md bg-primary-soft px-2 py-1 text-[11px] font-semibold text-primary-dark">
                        Reorder {insight.reorderQuantity}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StockStatusBadge insight={insight} />
                    <ExpiryStatusBadge insight={insight} />
                  </div>
                  <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-canvas px-2.5 py-2 text-center">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Stock</dt>
                      <dd className="tnum text-sm font-semibold text-ink">
                        {product.currentStock}
                        {product.unit ? <span className="text-[11px] font-normal text-muted"> {product.unit}</span> : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Cover</dt>
                      <dd className="tnum text-sm font-semibold text-ink">{formatCover(insight.daysOfCover)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Expiry</dt>
                      <dd className="tnum text-sm font-semibold text-ink">{formatDate(product.expiryDate)}</dd>
                    </div>
                  </dl>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted">
                      Reorder level{' '}
                      <span className="tnum font-semibold text-ink">{product.reorderLevel}</span>
                    </p>
                    <div className="flex items-center gap-1">
                      <Button variant="secondary" size="sm" onClick={() => updateParams({ product: product.id }, false)}>
                        View
                      </Button>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(product);
                            setFormOpen(true);
                          }}
                          className="rounded-md border border-line p-2 text-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Edit ${product.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(product)}
                          className="rounded-md border border-line p-2 text-muted hover:bg-crit-soft hover:text-crit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Delete ${product.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-line bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-muted">
              Showing <span className="tnum font-semibold text-ink">{sorted.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, sorted.length)}</span> of{' '}
              <span className="tnum font-semibold text-ink">{sorted.length}</span> products
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="inventory-page-size" className="text-[11px] text-muted">
                Rows per page
              </label>
              <Select
                id="inventory-page-size"
                value={String(pageSize)}
                onChange={(event) => updateParams({ size: event.target.value })}
                className="h-8 w-[70px] py-1 text-xs"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-1">
                <PageButton
                  label="Previous page"
                  onClick={() => updateParams({ page: String(currentPage - 1) }, false)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </PageButton>
                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .filter((number) => Math.abs(number - currentPage) <= 1 || number === 1 || number === totalPages)
                  .map((number, index, array) => (
                    <span key={number} className="flex items-center gap-1">
                      {index > 0 && number - array[index - 1] > 1 ? (
                        <span className="px-0.5 text-xs text-muted" aria-hidden="true">…</span>
                      ) : null}
                      <PageButton
                        label={`Page ${number}`}
                        active={number === currentPage}
                        onClick={() => updateParams({ page: String(number) }, false)}
                      >
                        {number}
                      </PageButton>
                    </span>
                  ))}
                <PageButton
                  label="Next page"
                  onClick={() => updateParams({ page: String(currentPage + 1) }, false)}
                  disabled={currentPage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </PageButton>
              </div>
            </div>
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
      <DeleteProductDialog product={deleteTarget} onClose={() => setDeleteTarget(null)} />
      <ProductDetailDrawer
        open={Boolean(activeInsight)}
        insight={activeInsight}
        onClose={() => updateParams({ product: null }, false)}
        onEdit={(product) => {
          updateParams({ product: null }, false);
          setEditing(product);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
