import { useEffect, useMemo, useState } from 'react';
import { Calculator, CalendarClock, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Product } from '../types';
import { useStockora } from '../store/StockoraContext';
import { useToast } from './toast';
import { Button, Field, InfoNote, Modal, NumberInput, Select, TextInput, cn } from './ui';
import {
  EMPTY_PRODUCT_FORM,
  productToForm,
  validateProductForm,
  type ProductFieldErrors,
  type ProductFormValues,
} from '../lib/validation';
import { buildInsight, formatCover, expiryLabel } from '../lib/inventory';
import { formatDate } from '../lib/date';

export function ProductFormDialog({
  open,
  onClose,
  product,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
  onSaved?: (id?: string) => void;
}) {
  const { products, settings, suppliers, createProduct, updateProduct } = useStockora();
  const toast = useToast();
  const [values, setValues] = useState<ProductFormValues>(EMPTY_PRODUCT_FORM);
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = product ? productToForm(product) : EMPTY_PRODUCT_FORM;
    // Adopt a matching supplier record for products saved before linking existed.
    if (!initial.supplierId && initial.supplierName) {
      const match = suppliers.find(
        (supplier) => supplier.name.trim().toLowerCase() === initial.supplierName.trim().toLowerCase(),
      );
      if (match) initial.supplierId = match.id;
    }
    setValues(initial);
    setErrors({});
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);

  const categories = useMemo(
    () => [...new Set(products.map((item) => item.category))].sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const preview = useMemo(() => {
    const stock = Number(values.currentStock);
    const reorder = Number(values.reorderLevel);
    const sales = Number(values.averageDailySales);
    const lead = Number(values.leadTimeDays);
    if (![stock, reorder, sales, lead].every(Number.isFinite)) return null;
    if (values.currentStock.trim() === '' || values.reorderLevel.trim() === '') return null;
    const draft: Product = {
      id: 'preview',
      sku: values.sku || 'PREVIEW',
      name: values.name || 'New product',
      category: values.category || 'Uncategorised',
      currentStock: stock,
      reorderLevel: reorder,
      averageDailySales: sales,
      leadTimeDays: lead,
      expiryDate: values.expiryDate || null,
      createdAt: '',
      updatedAt: '',
    };
    return buildInsight(draft, settings);
  }, [values, settings]);

  const updateField = (field: keyof ProductFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const updateSupplierLink = (supplierId: string) => {
    const match = suppliers.find((supplier) => supplier.id === supplierId);
    setValues((current) => ({
      ...current,
      supplierId,
      supplierName: match?.name ?? '',
    }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const result = validateProductForm(values, {
      products,
      editingId: product?.id,
    });
    if (!result.input) {
      setErrors(result.errors);
      setSubmitting(false);
      toast.error('Check the highlighted fields', 'The product was not saved yet.');
      const firstError = Object.keys(result.errors)[0];
      if (firstError) document.getElementById(`product-${firstError}`)?.focus();
      return;
    }
    const mutation = product ? updateProduct(product.id, result.input) : createProduct(result.input);
    if (!mutation.ok) {
      setErrors(mutation.errors);
      setSubmitting(false);
      toast.error('Could not save product', 'A field needs attention before saving.');
      return;
    }
    toast.success(
      product ? 'Product updated' : 'Product added',
      `${result.input.name} saved. Dashboard, actions and reports were recalculated.`,
    );
    setSubmitting(false);
    onSaved?.(mutation.id);
    onClose();
  };

  const errorProps = (field: keyof ProductFormValues) => ({
    invalid: Boolean(errors[field]),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `product-${field}-error` : undefined,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Edit product' : 'Add product'}
      description={
        product
          ? 'Update stock, demand or expiry details. All derived metrics recalculate immediately.'
          : 'Add a product to monitor low stock, expiry risk and replenishment needs.'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" loading={submitting}>
            {product ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="SKU" htmlFor="product-sku" error={errors.sku} required hint="Unique code, e.g. R107">
            <TextInput
              id="product-sku"
              value={values.sku}
              onChange={(event) => updateField('sku', event.target.value)}
              placeholder="R107"
              autoComplete="off"
              maxLength={32}
              {...errorProps('sku')}
            />
          </Field>
          <Field label="Product name" htmlFor="product-name" error={errors.name} required>
            <TextInput
              id="product-name"
              value={values.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="Butter 250g"
              maxLength={80}
              {...errorProps('name')}
            />
          </Field>
          <Field label="Category" htmlFor="product-category" error={errors.category} required>
            <TextInput
              id="product-category"
              value={values.category}
              onChange={(event) => updateField('category', event.target.value)}
              placeholder="Dairy & Chilled"
              list="product-category-options"
              maxLength={40}
              {...errorProps('category')}
            />
            <datalist id="product-category-options">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </Field>
          <Field label="Unit of measure" htmlFor="product-unit" error={errors.unit} hint="Optional, e.g. L, pack, loaf">
            <TextInput
              id="product-unit"
              value={values.unit}
              onChange={(event) => updateField('unit', event.target.value)}
              placeholder="pack"
              maxLength={16}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-canvas/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-ink">Stock & demand</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Current stock" htmlFor="product-currentStock" error={errors.currentStock} required>
              <NumberInput
                id="product-currentStock"
                value={values.currentStock}
                onChange={(event) => updateField('currentStock', event.target.value)}
                min={0}
                step={1}
                placeholder="8"
                {...errorProps('currentStock')}
              />
            </Field>
            <Field label="Reorder level" htmlFor="product-reorderLevel" error={errors.reorderLevel} required>
              <NumberInput
                id="product-reorderLevel"
                value={values.reorderLevel}
                onChange={(event) => updateField('reorderLevel', event.target.value)}
                min={0}
                step={1}
                placeholder="10"
                {...errorProps('reorderLevel')}
              />
            </Field>
            <Field
              label="Avg daily sales"
              htmlFor="product-averageDailySales"
              error={errors.averageDailySales}
              required
            >
              <NumberInput
                id="product-averageDailySales"
                value={values.averageDailySales}
                onChange={(event) => updateField('averageDailySales', event.target.value)}
                min={0}
                step={0.1}
                placeholder="12"
                {...errorProps('averageDailySales')}
              />
            </Field>
            <Field label="Lead time (days)" htmlFor="product-leadTimeDays" error={errors.leadTimeDays} required>
              <NumberInput
                id="product-leadTimeDays"
                value={values.leadTimeDays}
                onChange={(event) => updateField('leadTimeDays', event.target.value)}
                min={0}
                step={1}
                placeholder="1"
                {...errorProps('leadTimeDays')}
              />
            </Field>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-muted">
            Average daily sales of 0 is allowed. Days of cover is then shown as N/A instead of dividing by zero.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Expiry date"
            htmlFor="product-expiryDate"
            error={errors.expiryDate}
            hint="Optional. Leave empty when the expiry date is not recorded."
          >
            <TextInput
              id="product-expiryDate"
              type="date"
              value={values.expiryDate}
              onChange={(event) => updateField('expiryDate', event.target.value)}
              {...errorProps('expiryDate')}
            />
          </Field>
          <Field
            label={`Unit cost (${settings.currency})`}
            htmlFor="product-unitCost"
            error={errors.unitCost}
            hint="Optional. Used for stock value estimates and margins."
          >
            <NumberInput
              id="product-unitCost"
              value={values.unitCost}
              onChange={(event) => updateField('unitCost', event.target.value)}
              min={0}
              step={0.01}
              placeholder="62"
              {...errorProps('unitCost')}
            />
          </Field>
          <Field
            label={`Selling price (${settings.currency})`}
            htmlFor="product-sellingPrice"
            error={errors.sellingPrice}
            hint="Optional. Used for margin estimates and selling-value totals."
          >
            <NumberInput
              id="product-sellingPrice"
              value={values.sellingPrice}
              onChange={(event) => updateField('sellingPrice', event.target.value)}
              min={0}
              step={0.01}
              placeholder="70"
              {...errorProps('sellingPrice')}
            />
          </Field>
        </div>

        {suppliers.length > 0 ? (
          <Field
            label="Supplier"
            htmlFor="product-supplierId"
            error={errors.supplierName}
            hint="Optional. Suppliers hold contact details and lead times."
          >
            <Select
              id="product-supplierId"
              value={values.supplierId}
              onChange={(event) => updateSupplierLink(event.target.value)}
            >
              <option value="">No supplier</option>
              {[...suppliers]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </Select>
            <p className="mt-1.5 text-xs text-muted">
              Manage contacts on the{' '}
              <Link to="/suppliers" className="font-semibold text-primary-dark hover:underline">
                Suppliers page
              </Link>
              .
            </p>
          </Field>
        ) : (
          <Field label="Supplier name" htmlFor="product-supplierName" error={errors.supplierName} hint="Optional">
            <TextInput
              id="product-supplierName"
              value={values.supplierName}
              onChange={(event) => updateField('supplierName', event.target.value)}
              placeholder="FreshPastures Dairy"
              maxLength={80}
            />
          </Field>
        )}

        {preview ? (
          <div className="rounded-xl border border-primary/20 bg-primary-soft/50 p-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-primary-dark">Live calculation preview</h3>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-muted">Stock status</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  {preview.isLowStock ? 'Low stock' : 'Healthy'}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Expiry</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  {preview.expiryStatus === 'missing'
                    ? 'No date'
                    : `${expiryLabel(preview)}${preview.daysRemaining !== null ? ` (${formatDate(values.expiryDate)})` : ''}`}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Days of cover</dt>
                <dd className="mt-0.5 font-semibold text-ink">{formatCover(preview.daysOfCover)}</dd>
              </div>
              <div>
                <dt className="text-muted">Suggested reorder</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  {preview.isExpired
                    ? 'Not applicable'
                    : `${preview.reorderQuantity} unit${preview.reorderQuantity === 1 ? '' : 's'}`}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        <InfoNote tone="info" icon={<Info className="h-4 w-4" aria-hidden="true" />}>
          Reorder suggestions use demand and supplier lead time plus your safety buffer of{' '}
          <strong>{settings.safetyBufferDays} day{settings.safetyBufferDays === 1 ? '' : 's'}</strong>. They are
          recommendations only — no order is placed automatically.
        </InfoNote>

        <p className={cn('text-[11px] text-muted', Object.keys(errors).length === 0 && 'hidden')}>
          Fields marked with an error above need attention before saving.
        </p>
      </form>
    </Modal>
  );
}
