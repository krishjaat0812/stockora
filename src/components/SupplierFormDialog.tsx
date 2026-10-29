import { useEffect, useState } from 'react';
import type { Supplier } from '../types';
import { useStockora } from '../store/StockoraContext';
import { useToast } from './toast';
import { Button, Field, InfoNote, Modal, NumberInput, Textarea, TextInput, cn } from './ui';
import {
  EMPTY_SUPPLIER_FORM,
  supplierToForm,
  validateSupplierForm,
  type SupplierFieldErrors,
  type SupplierFormValues,
} from '../lib/suppliers';

export function SupplierFormDialog({
  open,
  onClose,
  supplier,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  supplier?: Supplier | null;
  onSaved?: (id?: string) => void;
}) {
  const { suppliers, createSupplier, updateSupplier } = useStockora();
  const toast = useToast();
  const [values, setValues] = useState<SupplierFormValues>(EMPTY_SUPPLIER_FORM);
  const [errors, setErrors] = useState<SupplierFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(supplier ? supplierToForm(supplier) : EMPTY_SUPPLIER_FORM);
    setErrors({});
    setSubmitting(false);
  }, [open, supplier]);

  const update = (field: keyof SupplierFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const result = validateSupplierForm(values, { suppliers, editingId: supplier?.id });
    if (!result.input) {
      setErrors(result.errors);
      setSubmitting(false);
      toast.error('Check the highlighted fields', 'The supplier was not saved yet.');
      const firstError = Object.keys(result.errors)[0];
      if (firstError) document.getElementById(`supplier-${firstError}`)?.focus();
      return;
    }
    const mutation = supplier ? updateSupplier(supplier.id, result.input) : createSupplier(result.input);
    if (!mutation.ok) {
      setErrors(mutation.errors);
      setSubmitting(false);
      toast.error('Could not save supplier', 'A field needs attention before saving.');
      return;
    }
    toast.success(
      supplier ? 'Supplier updated' : 'Supplier added',
      `${result.input.name} is ready to link to products.`,
    );
    setSubmitting(false);
    onSaved?.(mutation.id);
    onClose();
  };

  const errorProps = (field: keyof SupplierFormValues) => ({
    invalid: Boolean(errors[field]),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `supplier-${field}-error` : undefined,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Edit supplier' : 'Add supplier'}
      description={
        supplier
          ? 'Update contact details, lead time or status. Linked products are not changed.'
          : 'Store the people and terms behind your stock so reordering is never guesswork.'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="supplier-form" loading={submitting}>
            {supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier name" htmlFor="supplier-name" error={errors.name} required>
            <TextInput
              id="supplier-name"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="FreshPastures Dairy"
              maxLength={80}
              autoComplete="organization"
              {...errorProps('name')}
            />
          </Field>
          <Field label="Contact person" htmlFor="supplier-contactName" error={errors.contactName} hint="Optional">
            <TextInput
              id="supplier-contactName"
              value={values.contactName}
              onChange={(event) => update('contactName', event.target.value)}
              placeholder="Meera Iyer"
              maxLength={80}
              autoComplete="name"
              {...errorProps('contactName')}
            />
          </Field>
          <Field label="Email" htmlFor="supplier-email" error={errors.email} hint="Used for order follow-ups.">
            <TextInput
              id="supplier-email"
              type="email"
              value={values.email}
              onChange={(event) => update('email', event.target.value)}
              placeholder="orders@supplier.com"
              maxLength={120}
              autoComplete="email"
              {...errorProps('email')}
            />
          </Field>
          <Field label="Phone" htmlFor="supplier-phone" error={errors.phone} hint="Optional">
            <TextInput
              id="supplier-phone"
              type="tel"
              value={values.phone}
              onChange={(event) => update('phone', event.target.value)}
              placeholder="+91 98290 11001"
              maxLength={20}
              autoComplete="tel"
              {...errorProps('phone')}
            />
          </Field>
          <Field label="Lead time (days)" htmlFor="supplier-leadTimeDays" error={errors.leadTimeDays} required>
            <NumberInput
              id="supplier-leadTimeDays"
              value={values.leadTimeDays}
              onChange={(event) => update('leadTimeDays', event.target.value)}
              min={0}
              max={365}
              step={1}
              placeholder="3"
              {...errorProps('leadTimeDays')}
            />
          </Field>
          <Field label="Payment terms" htmlFor="supplier-paymentTerms" error={errors.paymentTerms} hint="Optional, e.g. Net 15">
            <TextInput
              id="supplier-paymentTerms"
              value={values.paymentTerms}
              onChange={(event) => update('paymentTerms', event.target.value)}
              placeholder="Net 15"
              maxLength={60}
              {...errorProps('paymentTerms')}
            />
          </Field>
        </div>

        <Field label="Address" htmlFor="supplier-address" error={errors.address} hint="Optional. Delivery or billing address.">
          <Textarea
            id="supplier-address"
            value={values.address}
            onChange={(event) => update('address', event.target.value)}
            rows={2}
            maxLength={200}
            placeholder="12 Mandi Road, Jaipur"
            {...errorProps('address')}
          />
        </Field>

        <Field label="Notes" htmlFor="supplier-notes" error={errors.notes} hint="Ordering quirks, minimum order, return policy…">
          <Textarea
            id="supplier-notes"
            value={values.notes}
            onChange={(event) => update('notes', event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Minimum order 10 bags for free delivery."
            {...errorProps('notes')}
          />
        </Field>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-canvas p-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Active supplier</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              Inactive suppliers stay linked to their products but are flagged as not currently used.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={values.active}
            aria-label="Active supplier"
            onClick={() => setValues((current) => ({ ...current, active: !current.active }))}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              values.active ? 'bg-primary' : 'bg-line',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card',
                values.active ? 'right-0.5' : 'left-0.5',
              )}
            />
          </button>
        </div>

        <InfoNote tone="info">
          Supplier records are private to your shop. Deleting a supplier never deletes products or stock — those
          products are simply unlinked.
        </InfoNote>
      </form>
    </Modal>
  );
}
