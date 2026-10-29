import { Link } from 'react-router-dom';
import { Mail, MapPin, Package, Pencil, Phone, Trash2, Truck } from 'lucide-react';
import type { CurrencyCode, Product, Supplier } from '../types';
import { Badge, Button, Drawer, EmptyState } from './ui';
import { supplierForProduct, supplierInitials, supplierStats } from '../lib/suppliers';
import { formatCurrency, formatNumber } from '../lib/format';
import { formatDate } from '../lib/date';

function ContactRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 break-words text-ink">{children}</div>
    </div>
  );
}

export function SupplierDetailDrawer({
  supplier,
  products,
  currency,
  canEdit,
  canDelete,
  onClose,
  onEdit,
  onDelete,
}: {
  supplier: Supplier | null;
  products: Product[];
  currency: CurrencyCode;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (supplier: Supplier) => void;
  onDelete: (supplier: Supplier) => void;
}) {
  if (!supplier) return null;
  const stats = supplierStats(supplier, products);
  const linked = products
    .filter((product) => supplierForProduct(product, [supplier])?.id === supplier.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Drawer
      open
      onClose={onClose}
      title={supplier.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={supplier.active ? 'ok' : 'neutral'}>
            {supplier.active ? 'Active' : 'Inactive'}
          </Badge>
          <span className="text-xs text-muted">
            Lead time {supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? '' : 's'}
          </span>
        </span>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {canDelete ? (
            <Button
              variant="secondary"
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onDelete(supplier)}
            >
              Delete
            </Button>
          ) : null}
          {canEdit ? (
            <Button icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => onEdit(supplier)}>
              Edit supplier
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-sm font-bold text-primary-dark">
            {supplierInitials(supplier.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{supplier.contactName ?? 'No contact person'}</p>
            <p className="text-xs text-muted">
              {stats.productCount} linked product{stats.productCount === 1 ? '' : 's'}
              {supplier.leadTimeDays > 0 ? ` · ${supplier.leadTimeDays}-day lead time` : ''}
            </p>
          </div>
        </div>

        <div className="space-y-2.5 rounded-xl border border-line bg-canvas/60 p-3.5">
          {supplier.email ? (
            <ContactRow icon={<Mail className="h-4 w-4" aria-hidden="true" />}>
              <a href={`mailto:${supplier.email}`} className="hover:underline">
                {supplier.email}
              </a>
            </ContactRow>
          ) : null}
          {supplier.phone ? (
            <ContactRow icon={<Phone className="h-4 w-4" aria-hidden="true" />}>
              <a href={`tel:${supplier.phone.replace(/\s/g, '')}`} className="hover:underline">
                {supplier.phone}
              </a>
            </ContactRow>
          ) : null}
          {supplier.address ? (
            <ContactRow icon={<MapPin className="h-4 w-4" aria-hidden="true" />}>{supplier.address}</ContactRow>
          ) : null}
          {supplier.paymentTerms ? (
            <ContactRow icon={<Truck className="h-4 w-4" aria-hidden="true" />}>
              Payment terms: {supplier.paymentTerms}
            </ContactRow>
          ) : null}
          {!supplier.email && !supplier.phone && !supplier.address && !supplier.paymentTerms ? (
            <p className="text-sm text-muted">No contact details recorded yet.</p>
          ) : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink">Linked stock</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line p-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Products</dt>
              <dd className="mt-0.5 text-lg font-bold text-ink tnum">{formatNumber(stats.productCount)}</dd>
            </div>
            <div className="rounded-lg border border-line p-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Stock value</dt>
              <dd className="mt-0.5 text-lg font-bold text-ink tnum">{formatCurrency(stats.stockValue, currency)}</dd>
            </div>
            <div className="rounded-lg border border-line p-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Low stock</dt>
              <dd className="mt-0.5 text-lg font-bold text-ink tnum">{formatNumber(stats.lowStockCount)}</dd>
            </div>
            <div className="rounded-lg border border-line p-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Out of stock</dt>
              <dd className="mt-0.5 text-lg font-bold text-ink tnum">{formatNumber(stats.outOfStockCount)}</dd>
            </div>
          </dl>
        </div>

        {linked.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">Products supplied</h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {linked.map((product) => {
                const low = product.currentStock <= product.reorderLevel;
                return (
                  <li key={product.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{product.name}</p>
                      <p className="text-[11px] text-muted">
                        {product.sku} · {product.category}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-semibold text-ink tnum">
                        {formatNumber(product.currentStock)} {product.unit ?? ''}
                      </span>
                      {product.currentStock <= 0 ? (
                        <Badge tone="crit">Out</Badge>
                      ) : low ? (
                        <Badge tone="warn">Low</Badge>
                      ) : (
                        <Badge tone="ok">OK</Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Link
              to="/inventory"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-dark hover:underline"
            >
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              View these products in Inventory
            </Link>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<Package className="h-5 w-5" aria-hidden="true" />}
            title="No linked products yet"
            description="Link this supplier from a product's form to see its stock and reorder needs here."
          />
        )}

        {supplier.notes ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">Notes</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted">{supplier.notes}</p>
          </div>
        ) : null}

        <p className="text-[11px] text-muted">
          Added {formatDate(supplier.createdAt.slice(0, 10))} · Last updated {formatDate(supplier.updatedAt.slice(0, 10))}
        </p>
      </div>
    </Drawer>
  );
}
