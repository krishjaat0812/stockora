import { useMemo, useState } from 'react';
import {
  Building2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Select, TextInput, cn } from '../components/ui';
import { SupplierFormDialog } from '../components/SupplierFormDialog';
import { SupplierDetailDrawer } from '../components/SupplierDetailDrawer';
import { useToast } from '../components/toast';
import { useAction } from '../auth/AuthContext';
import { filterSuppliers, supplierForProduct, supplierInitials, supplierStats, type SupplierStatusFilter } from '../lib/suppliers';
import { formatCurrency, formatNumber } from '../lib/format';
import type { Supplier } from '../types';

function SummaryTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
          <p className="mt-1 text-xl font-bold text-ink tnum">{value}</p>
          {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-dark">
          {icon}
        </span>
      </div>
    </Card>
  );
}

export default function SuppliersPage() {
  const { suppliers, products, settings, deleteSupplier } = useStockora();
  const toast = useToast();
  const canCreate = useAction('suppliers', 'create');
  const canEdit = useAction('suppliers', 'edit');
  const canDelete = useAction('suppliers', 'delete');

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SupplierStatusFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null);

  const filtered = useMemo(
    () =>
      filterSuppliers(suppliers, { query, status }).sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [suppliers, query, status],
  );

  const stats = useMemo(() => {
    const rows = suppliers.map((supplier) => supplierStats(supplier, products));
    return {
      total: suppliers.length,
      active: suppliers.filter((supplier) => supplier.active).length,
      linked: products.filter((product) => Boolean(supplierForProduct(product, suppliers))).length,
      stockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
      lowStock: rows.reduce((sum, row) => sum + row.lowStockCount, 0),
    };
  }, [suppliers, products]);

  const detail = suppliers.find((supplier) => supplier.id === detailId) ?? null;
  const linkedForDelete = pendingDelete
    ? products.filter((product) => supplierForProduct(product, [pendingDelete])?.id === pendingDelete.id).length
    : 0;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setDetailId(null);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteSupplier(pendingDelete.id);
    toast.success(
      'Supplier removed',
      `${pendingDelete.name} was deleted. ${linkedForDelete} product${linkedForDelete === 1 ? '' : 's'} kept with stock intact.`,
    );
    if (detailId === pendingDelete.id) setDetailId(null);
    setPendingDelete(null);
  };

  const hasFilters = query.trim() !== '' || status !== 'all';

  return (
    <div>
      <PageHeader
        eyebrow="Supplier management"
        title="Suppliers"
        description="Keep supplier contacts, lead times and payment terms in one place, and see which products each one supplies."
        actions={
          canCreate ? (
            <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openCreate}>
              Add supplier
            </Button>
          ) : (
            <Badge tone="neutral" icon={<ShieldCheck className="h-3 w-3" aria-hidden="true" />}>
              Read-only access
            </Badge>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          label="Suppliers"
          value={formatNumber(stats.total)}
          hint={`${stats.active} active`}
        />
        <SummaryTile
          icon={<Truck className="h-4 w-4" aria-hidden="true" />}
          label="Linked products"
          value={formatNumber(stats.linked)}
          hint={`of ${stats.linked === products.length ? 'all' : formatNumber(products.length)} products`}
        />
        <SummaryTile
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
          label="Stock value"
          value={formatCurrency(stats.stockValue, settings.currency)}
          hint="Across linked products"
        />
        <SummaryTile
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Low-stock lines"
          value={formatNumber(stats.lowStock)}
          hint="At or below reorder level"
        />
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
              placeholder="Search name, contact, email or phone"
              className="pl-9"
              aria-label="Search suppliers"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as SupplierStatusFilter)}
              aria-label="Filter by status"
              className="w-full sm:w-40"
            >
              <option value="all">All suppliers</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </Select>
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                }}
              >
                Reset
              </Button>
            ) : null}
          </div>
        </div>

        {suppliers.length === 0 ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              icon={<Truck className="h-5 w-5" aria-hidden="true" />}
              title="No suppliers yet"
              description="Add the wholesalers and distributors you buy from. Products can then be linked to a supplier for lead times, contacts and stock value."
              action={
                canCreate ? (
                  <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={openCreate}>
                    Add your first supplier
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              compact
              icon={<Search className="h-5 w-5" aria-hidden="true" />}
              title="No matching suppliers"
              description="Try a different name, contact or status filter."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/60 text-left text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Supplier</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Contact</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Lead time</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Products</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Stock value</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((supplier) => {
                  const rowStats = supplierStats(supplier, products);
                  return (
                    <tr key={supplier.id} className={cn('group transition-colors hover:bg-canvas/50', !supplier.active && 'opacity-75')}>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setDetailId(supplier.id)}
                          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-[11px] font-bold text-primary-dark">
                            {supplierInitials(supplier.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink group-hover:text-primary-dark">
                              {supplier.name}
                            </span>
                            <span className="block truncate text-[11px] text-muted">
                              {supplier.contactName ?? 'No contact person'}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5 text-[12px] text-muted">
                          {supplier.email ? (
                            <span className="flex items-center gap-1.5 truncate">
                              <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {supplier.email}
                            </span>
                          ) : null}
                          {supplier.phone ? (
                            <span className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {supplier.phone}
                            </span>
                          ) : null}
                          {!supplier.email && !supplier.phone ? <span>No contact details</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tnum text-ink">
                        {supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? '' : 's'}
                      </td>
                      <td className="px-4 py-3 text-right tnum text-ink">
                        {formatNumber(rowStats.productCount)}
                        {rowStats.lowStockCount > 0 ? (
                          <span className="ml-1.5 text-[11px] font-semibold text-warn">
                            · {rowStats.lowStockCount} low
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tnum text-ink">
                        {formatCurrency(rowStats.stockValue, settings.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={supplier.active ? 'ok' : 'neutral'}>
                          {supplier.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => openEdit(supplier)}
                              className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Edit ${supplier.name}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(supplier)}
                              className="rounded-md p-1.5 text-muted hover:bg-crit-soft hover:text-crit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={`Delete ${supplier.name}`}
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
        )}
      </Card>

      <p className="mt-3 text-xs text-muted">
        Showing {formatNumber(filtered.length)} of {formatNumber(suppliers.length)} supplier
        {suppliers.length === 1 ? '' : 's'}. Supplier data is visible only to your shop.
      </p>

      <SupplierFormDialog
        open={formOpen}
        supplier={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(id) => {
          if (id) setDetailId(id);
        }}
      />

      <SupplierDetailDrawer
        supplier={detail}
        products={products}
        currency={settings.currency}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
        onDelete={(supplier) => {
          setPendingDelete(supplier);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'supplier'}?`}
        message={
          <>
            <p>
              {linkedForDelete > 0
                ? `${linkedForDelete} linked product${linkedForDelete === 1 ? '' : 's'} will keep all stock and expiry data — they simply lose the supplier link.`
                : 'This supplier is not linked to any products yet.'}
            </p>
            <p className="mt-2">This cannot be undone. Consider marking the supplier inactive instead if you may order again.</p>
          </>
        }
        confirmLabel="Delete supplier"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
