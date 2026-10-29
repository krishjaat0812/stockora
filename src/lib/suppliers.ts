import type { Product, Supplier, SupplierInput } from '../types';
import { isLowStock } from './inventory';

/**
 * Supplier domain logic shared by the browser and the Worker. Validation runs
 * on both sides: the form for inline feedback, the API so a crafted request
 * cannot store an invalid supplier.
 */

export interface SupplierFormValues {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  leadTimeDays: string;
  paymentTerms: string;
  notes: string;
  active: boolean;
}

export type SupplierFieldErrors = Partial<Record<keyof SupplierFormValues, string>>;

export const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  leadTimeDays: '',
  paymentTerms: '',
  notes: '',
  active: true,
};

export const MAX_SUPPLIERS = 500;

/** Local part@domain.tld — deliberately permissive but rejects obvious typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_PATTERN = /^[+]?[\d\s().-]{6,20}$/;

export function supplierToForm(supplier: Supplier): SupplierFormValues {
  return {
    name: supplier.name,
    contactName: supplier.contactName ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    address: supplier.address ?? '',
    leadTimeDays: String(supplier.leadTimeDays),
    paymentTerms: supplier.paymentTerms ?? '',
    notes: supplier.notes ?? '',
    active: supplier.active,
  };
}

export function validateSupplierInput(
  input: SupplierInput,
  options: { suppliers: Supplier[]; editingId?: string },
): SupplierFieldErrors {
  const errors: SupplierFieldErrors = {};
  const name = input.name.trim();

  if (!name) {
    errors.name = 'Supplier name is required.';
  } else if (name.length > 80) {
    errors.name = 'Keep the name under 80 characters.';
  } else {
    const normalized = name.toLowerCase();
    const duplicate = options.suppliers.some(
      (supplier) => supplier.id !== options.editingId && supplier.name.trim().toLowerCase() === normalized,
    );
    if (duplicate) errors.name = 'A supplier with this name already exists.';
  }

  if (input.contactName && input.contactName.trim().length > 80) {
    errors.contactName = 'Keep the contact name under 80 characters.';
  }

  if (input.email && input.email.trim()) {
    const email = input.email.trim();
    if (email.length > 120) errors.email = 'Keep the email under 120 characters.';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';
  }

  if (input.phone && input.phone.trim()) {
    const phone = input.phone.trim();
    if (!PHONE_PATTERN.test(phone)) {
      errors.phone = 'Use digits, spaces, +, dashes or brackets (6–20 characters).';
    }
  }

  if (input.address && input.address.trim().length > 200) {
    errors.address = 'Keep the address under 200 characters.';
  }

  if (!Number.isFinite(input.leadTimeDays)) {
    errors.leadTimeDays = 'Enter the supplier lead time.';
  } else if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0) {
    errors.leadTimeDays = 'Lead time must be a whole number of days.';
  } else if (input.leadTimeDays > 365) {
    errors.leadTimeDays = 'Lead time must be 365 days or fewer.';
  }

  if (input.paymentTerms && input.paymentTerms.trim().length > 60) {
    errors.paymentTerms = 'Keep payment terms under 60 characters.';
  }

  if (input.notes && input.notes.trim().length > 500) {
    errors.notes = 'Keep notes under 500 characters.';
  }

  return errors;
}

export function validateSupplierForm(
  values: SupplierFormValues,
  options: { suppliers: Supplier[]; editingId?: string },
): { errors: SupplierFieldErrors; input: SupplierInput | null } {
  const errors: SupplierFieldErrors = {};
  const leadTimeRaw = values.leadTimeDays.trim();

  if (!leadTimeRaw) errors.leadTimeDays = 'Enter the supplier lead time.';
  else if (Number.isNaN(Number(leadTimeRaw))) errors.leadTimeDays = 'Enter a valid number of days.';

  const input: SupplierInput = {
    name: values.name.trim(),
    contactName: values.contactName.trim() || undefined,
    email: values.email.trim() || undefined,
    phone: values.phone.trim() || undefined,
    address: values.address.trim() || undefined,
    leadTimeDays: leadTimeRaw === '' ? Number.NaN : Number(leadTimeRaw),
    paymentTerms: values.paymentTerms.trim() || undefined,
    notes: values.notes.trim() || undefined,
    active: values.active,
  };

  const merged = validateSupplierInput(input, options);
  for (const key of Object.keys(merged) as Array<keyof SupplierFieldErrors>) {
    if (merged[key]) errors[key] = merged[key];
  }

  const hasErrors = Object.keys(errors).length > 0;
  return { errors, input: hasErrors ? null : input };
}

export type SupplierStatusFilter = 'all' | 'active' | 'inactive';

/** Free-text search across the fields a shopkeeper would actually recall. */
export function filterSuppliers(
  suppliers: Supplier[],
  options: { query?: string; status?: SupplierStatusFilter } = {},
): Supplier[] {
  const query = (options.query ?? '').trim().toLowerCase();
  const status = options.status ?? 'all';
  return suppliers.filter((supplier) => {
    if (status === 'active' && !supplier.active) return false;
    if (status === 'inactive' && supplier.active) return false;
    if (!query) return true;
    const haystack = [
      supplier.name,
      supplier.contactName,
      supplier.email,
      supplier.phone,
      supplier.address,
      supplier.paymentTerms,
      supplier.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

/** Suppliers are matched to a product either by id or by the legacy name field. */
export function supplierForProduct(
  product: Pick<Product, 'supplierId' | 'supplierName'>,
  suppliers: Supplier[],
): Supplier | undefined {
  if (product.supplierId) {
    const byId = suppliers.find((supplier) => supplier.id === product.supplierId);
    if (byId) return byId;
  }
  const name = product.supplierName?.trim().toLowerCase();
  if (!name) return undefined;
  return suppliers.find((supplier) => supplier.name.trim().toLowerCase() === name);
}

export function supplierProducts(supplier: Supplier, products: Product[]): Product[] {
  return products.filter((product) => supplierForProduct(product, [supplier])?.id === supplier.id);
}

export interface SupplierStats {
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  stockValue: number;
  categories: string[];
}

export function supplierStats(supplier: Supplier, products: Product[]): SupplierStats {
  const linked = supplierProducts(supplier, products);
  const categories = [...new Set(linked.map((product) => product.category))].sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    productCount: linked.length,
    lowStockCount: linked.filter((product) => isLowStock(product)).length,
    outOfStockCount: linked.filter((product) => product.currentStock <= 0).length,
    stockValue: linked.reduce(
      (sum, product) => sum + (product.unitCost ?? 0) * Math.max(0, product.currentStock),
      0,
    ),
    categories,
  };
}

/** Two-letter monogram for the supplier avatar. */
export function supplierInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
