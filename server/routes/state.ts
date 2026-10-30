import { Hono } from 'hono';
import type { Context } from 'hono';
import type { FeatureId, ActionId } from '../../src/shared/features';
import { parseInventoryCsv, buildCsv, type CsvTable } from '../../src/lib/csv';
import { validateProductInput } from '../../src/lib/validation';
import { MAX_SUPPLIERS, validateSupplierInput } from '../../src/lib/suppliers';
import { earliestSaleDate, mergeSales, parseSalesCsv } from '../../src/lib/sales';
import type {
  ActivityEntry,
  PersistedState,
  Product,
  ProductInput,
  Supplier,
} from '../../src/types';
import { ensureOrgState, saveOrgState, uuid } from '../db';
import { readJson, respond } from '../http';
import {
  requireAction,
  requireContentAccess,
  requireFeature,
  requireOrganization,
  requireUser,
  type AppEnv,
} from '../middleware';
import { recordAudit } from '../audit';

/**
 * The organisation's workspace state (products, settings, activity,
 * notifications, reviews). The organisation always comes from the session —
 * never from the request — so one client can never read or write another
 * client's data. Writes are permission-checked per field.
 */

type StatePatch = Partial<PersistedState>;

function currentAuth(c: Context<AppEnv>) {
  return c.get('auth');
}

function validateProducts(products: Product[]): string | null {
  const seen = new Set<string>();
  for (const product of products) {
    const sku = typeof product.sku === 'string' ? product.sku.trim().toLowerCase() : '';
    if (seen.has(sku)) return `Duplicate SKU "${product.sku}" in the submitted inventory.`;
    seen.add(sku);
    const errors = validateProductInput(product, { products, editingId: product.id });
    const messages = Object.values(errors).filter(Boolean);
    if (messages.length > 0) return `${product.sku || 'A product'}: ${messages[0]}`;
  }
  return null;
}

const FIELD_FEATURES: Array<{ key: keyof PersistedState; feature: FeatureId | 'content' }> = [
  { key: 'products', feature: 'inventory' },
  { key: 'suppliers', feature: 'suppliers' },
  { key: 'settings', feature: 'content' }, // account settings are always the owner's own
  { key: 'reviews', feature: 'content' },
  { key: 'activity', feature: 'content' },
  { key: 'notifications', feature: 'notifications' },
  { key: 'notifiedKeys', feature: 'notifications' },
  { key: 'seededOn', feature: 'content' },
];

/**
 * Works out which inventory *actions* a submitted product list performs, so
 * the server can deny precisely: a client allowed to add products but not to
 * delete them may still save their edits — the offending subset is what gets
 * rejected, not the whole write.
 *
 * Returns null when nothing impermissible happens.
 */
export function collectionActionViolation<T extends { id: string }>(
  before: T[],
  after: T[],
  allowed: Record<ActionId, boolean>,
  noun: string,
): string | null {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterIds = new Set(after.map((item) => item.id));
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (!previous) added += 1;
    else if (JSON.stringify(previous) !== JSON.stringify(item)) modified += 1;
  }
  for (const item of before) {
    if (!afterIds.has(item.id)) removed += 1;
  }
  if (added > 0 && !allowed.create) {
    return `You do not have permission to add ${noun} (${added} new in this request).`;
  }
  if (modified > 0 && !allowed.edit) {
    return `You do not have permission to edit ${noun} (${modified} changed in this request).`;
  }
  if (removed > 0 && !allowed.delete) {
    return `You do not have permission to delete ${noun} (${removed} removed in this request).`;
  }
  return null;
}

export function productActionViolation(
  before: Product[],
  after: Product[],
  allowed: Record<ActionId, boolean>,
): string | null {
  return collectionActionViolation(before, after, allowed, 'products');
}

/** Validates the whole supplier list the same way products are validated. */
export function validateSuppliers(suppliers: Supplier[]): string | null {
  if (suppliers.length > MAX_SUPPLIERS) {
    return `A shop can store at most ${MAX_SUPPLIERS} suppliers.`;
  }
  const seen = new Set<string>();
  for (const supplier of suppliers) {
    const name = typeof supplier.name === 'string' ? supplier.name.trim().toLowerCase() : '';
    if (seen.has(name)) return `Duplicate supplier "${supplier.name}".`;
    seen.add(name);
    const errors = validateSupplierInput(supplier, { suppliers, editingId: supplier.id });
    const messages = Object.values(errors).filter(Boolean);
    if (messages.length > 0) return `${supplier.name || 'A supplier'}: ${messages[0]}`;
  }
  return null;
}

export function buildStateRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser, requireOrganization, requireContentAccess);

  app.get('/', async (c) => {
    const auth = currentAuth(c);
    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
    return respond(state);
  });

  app.put('/', async (c) => {
    const auth = currentAuth(c);
    const permissions = c.get('permissions');
    const actions = c.get('actions');
    const parsed = await readJson<StatePatch>(c);
    if ('error' in parsed) return parsed.error;
    const patch = parsed.body;
    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);

    // Per-field feature enforcement: hiding buttons is not security, so the
    // server rejects writes to features the organisation no longer holds or
    // may no longer view.
    for (const { key, feature } of FIELD_FEATURES) {
      if (!(key in patch)) continue;
      if (feature === 'content') continue; // account settings are the owner's own
      const id = feature as FeatureId;
      if (!permissions[id]) {
        return respond(
          {
            code: 'feature_disabled',
            message: `This feature is not enabled for your account (${key} writes are blocked).`,
            feature: id,
          },
          { status: 403 },
        );
      }
      if (!actions[id]?.view) {
        return respond(
          {
            code: 'action_denied',
            message: `Your administrator has restricted access to this feature (${key} writes are blocked).`,
            feature: id,
            action: 'view',
          },
          { status: 403 },
        );
      }
    }

    // Sales history and the POS ledgers are append-only: they are written only
    // by their own endpoints, where the server can validate, price and deduct
    // atomically. Accepting them here would let a client rewrite recorded
    // demand or invent completed sales.
    const IMMUTABLE_HISTORY_KEYS: Array<keyof PersistedState> = ['sales', 'salesTrackingSince'];
    if (IMMUTABLE_HISTORY_KEYS.some((key) => key in patch)) {
      return respond(
        {
          code: 'immutable_history',
          message: 'Sales history is changed only through the sales import endpoint.',
        },
        { status: 400 },
      );
    }
    const IMMUTABLE_LEDGER_KEYS: Array<keyof PersistedState> = [
      'saleOrders',
      'inventoryMovements',
      'receiptCounter',
    ];
    if (IMMUTABLE_LEDGER_KEYS.some((key) => key in patch)) {
      return respond(
        {
          code: 'immutable_ledger',
          message: 'Sales transactions and stock movements are written only by the Point of Sale.',
        },
        { status: 400 },
      );
    }

    if (patch.products !== undefined) {
      if (!Array.isArray(patch.products)) {
        return respond({ code: 'validation', message: 'products must be an array.' }, { status: 400 });
      }
      const invalid = validateProducts(patch.products as Product[]);
      if (invalid) {
        return respond({ code: 'validation', message: invalid }, { status: 400 });
      }
      const violation = productActionViolation(
        state.products,
        patch.products as Product[],
        actions.inventory,
      );
      if (violation) {
        await recordAudit(c.env, {
          action: 'access.denied',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          orgId: auth.orgId,
          outcome: 'denied',
          metadata: { path: '/api/state', method: 'PUT', reason: violation },
        });
        return respond({ code: 'action_denied', message: violation }, { status: 403 });
      }
    }

    if (patch.suppliers !== undefined) {
      if (!Array.isArray(patch.suppliers)) {
        return respond({ code: 'validation', message: 'suppliers must be an array.' }, { status: 400 });
      }
      const invalid = validateSuppliers(patch.suppliers as Supplier[]);
      if (invalid) {
        return respond({ code: 'validation', message: invalid }, { status: 400 });
      }
      const violation = collectionActionViolation(
        state.suppliers,
        patch.suppliers as Supplier[],
        actions.suppliers,
        'suppliers',
      );
      if (violation) {
        await recordAudit(c.env, {
          action: 'access.denied',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          orgId: auth.orgId,
          outcome: 'denied',
          metadata: { path: '/api/state', method: 'PUT', reason: violation },
        });
        return respond({ code: 'action_denied', message: violation }, { status: 403 });
      }
    }

    // Only the keys this client is allowed to sync are applied — unknown or
    // server-owned fields in the payload are ignored rather than merged in.
    const WRITABLE_KEYS: Array<keyof PersistedState> = [
      'products',
      'suppliers',
      'settings',
      'activity',
      'notifications',
      'reviews',
      'notifiedKeys',
      'seededOn',
    ];
    const next: PersistedState = { ...state, version: state.version };
    for (const key of WRITABLE_KEYS) {
      if (key in patch) {
        (next as unknown as Record<string, unknown>)[key] = (
          patch as Record<string, unknown>
        )[key];
      }
    }
    await saveOrgState(c.env, auth.orgId!, next);
    return respond({ ok: true, updatedAt: new Date().toISOString() });
  });

  app.post(
    '/import',
    requireFeature('csv_import'),
    requireFeature('inventory'),
    requireAction('csv_import', 'create'),
    async (c) => {
      const auth = currentAuth(c);
      const inventoryActions = c.get('actions').inventory;
      const parsed = await readJson<{ text?: string; replaceExisting?: boolean }>(c);
    if ('error' in parsed) return parsed.error;
    const text = parsed.body.text ?? '';
    const replaceExisting = parsed.body.replaceExisting === true;
    if (!text.trim()) {
      return respond({ code: 'validation', message: 'The uploaded file is empty.' }, { status: 400 });
    }

    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
    const summary = parseInventoryCsv(text, state.products, { replaceExisting });
    if (summary.fileError) {
      return respond({ code: 'file_error', message: summary.fileError, summary }, { status: 400 });
    }

    const now = new Date().toISOString();
    const products = [...state.products];
    let added = 0;
    let updated = 0;
    for (const input of summary.valid as ProductInput[]) {
      const index = products.findIndex(
        (product) => product.sku.trim().toLowerCase() === input.sku.trim().toLowerCase(),
      );
      if (index >= 0) updated += 1;
      else added += 1;
    }

    // An import both creates and edits inventory, so each is checked against
    // the same action permissions a manual write would face.
    if (added > 0 && !inventoryActions.create) {
      return respond(
        {
          code: 'action_denied',
          message: `You do not have permission to add products (${added} new rows in this file).`,
        },
        { status: 403 },
      );
    }
    if (updated > 0 && !inventoryActions.edit) {
      return respond(
        {
          code: 'action_denied',
          message: `You do not have permission to edit products (${updated} existing rows in this file).`,
        },
        { status: 403 },
      );
    }

    for (const input of summary.valid as ProductInput[]) {
      const index = products.findIndex(
        (product) => product.sku.trim().toLowerCase() === input.sku.trim().toLowerCase(),
      );
      if (index >= 0) {
        products[index] = {
          ...products[index],
          ...input,
          sku: input.sku.trim().toUpperCase(),
          updatedAt: now,
        };
      } else {
        products.push({
          ...input,
          sku: input.sku.trim().toUpperCase(),
          id: uuid(),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const entry: ActivityEntry = {
      id: uuid(),
      type: 'import',
      message: `Imported ${added + updated} product${added + updated === 1 ? '' : 's'}`,
      detail: `${added} added · ${updated} updated`,
      at: now,
    };
    await saveOrgState(c.env, auth.orgId!, {
      ...state,
      products,
      activity: [entry, ...state.activity].slice(0, 60),
    });

      return respond({
        ok: true,
        added,
        updated,
        summary: { ...summary, valid: [], updatedCount: updated },
      });
    },
  );

  /**
   * Sales history import. Rows are validated against this organisation's own
   * SKUs, duplicates are skipped, and the ledger is appended — never replaced —
   * so an accidental second upload cannot rewrite recorded demand.
   */
  app.post(
    '/sales/import',
    requireFeature('demand_analytics'),
    requireAction('demand_analytics', 'create'),
    async (c) => {
      const auth = currentAuth(c);
      const parsed = await readJson<{ text?: string; demo?: boolean }>(c);
      if ('error' in parsed) return parsed.error;
      const text = parsed.body.text ?? '';
      if (!text.trim()) {
        return respond({ code: 'validation', message: 'The uploaded file is empty.' }, { status: 400 });
      }
      const demo = parsed.body.demo === true;
      const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
      if (state.products.length === 0) {
        return respond(
          { code: 'validation', message: 'Add products before importing sales history.' },
          { status: 400 },
        );
      }

      const summary = parseSalesCsv(text, {
        products: state.products,
        existing: state.sales,
        source: demo ? 'demo' : 'import',
        makeId: uuid,
        today: new Date(),
      });
      if (summary.fileError) {
        return respond(
          { code: 'file_error', message: summary.fileError, summary: { ...summary, valid: [] } },
          { status: 400 },
        );
      }
      // An upload that is entirely duplicates is a no-op, not an error: the
      // file was already imported and the ledger stays unchanged.
      if (summary.valid.length === 0) {
        if (summary.duplicates > 0) {
          return respond({
            ok: true,
            added: 0,
            skippedDuplicates: summary.duplicates,
            errors: summary.errors.slice(0, 50),
            errorCount: summary.errors.length,
            trackingSince: state.salesTrackingSince,
            totalSales: state.sales.length,
          });
        }
        return respond(
          {
            code: 'no_valid_rows',
            message: 'No valid sales rows were found in the file.',
            summary: { ...summary, valid: [] },
          },
          { status: 400 },
        );
      }

      const sales = mergeSales(state.sales, summary.valid);
      const first = earliestSaleDate(summary.valid);
      const trackingSince =
        state.salesTrackingSince && first
          ? first < state.salesTrackingSince
            ? first
            : state.salesTrackingSince
          : (state.salesTrackingSince ?? first);
      const added = summary.valid.length;
      const stamp = new Date().toISOString();
      const entry: ActivityEntry = {
        id: uuid(),
        type: 'import',
        message: `Imported ${added} sales line${added === 1 ? '' : 's'}`,
        detail:
          summary.duplicates > 0
            ? `${summary.duplicates} duplicate line${summary.duplicates === 1 ? '' : 's'} skipped`
            : first
              ? `History from ${first}`
              : '',
        at: stamp,
      };
      await saveOrgState(c.env, auth.orgId!, {
        ...state,
        sales,
        salesTrackingSince: trackingSince,
        activity: [entry, ...state.activity].slice(0, 60),
      });
      await recordAudit(c.env, {
        action: 'sales.history_imported',
        actorUserId: auth.userId,
        actorEmail: auth.email,
        orgId: auth.orgId,
        metadata: {
          added,
          skippedDuplicates: summary.duplicates,
          rejected: summary.errors.length,
          demo,
          earliest: first,
        },
      });

      return respond({
        ok: true,
        added,
        skippedDuplicates: summary.duplicates,
        errors: summary.errors.slice(0, 50),
        errorCount: summary.errors.length,
        trackingSince,
        totalSales: sales.length,
      });
    },
  );

  /** Clears recorded sales history. Inventory is untouched. */
  app.delete(
    '/sales',
    requireFeature('demand_analytics'),
    requireAction('demand_analytics', 'delete'),
    async (c) => {
      const auth = currentAuth(c);
      const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
      const removed = state.sales.length;
      if (removed === 0) return respond({ ok: true, removed: 0 });
      const entry: ActivityEntry = {
        id: uuid(),
        type: 'reset',
        message: 'Sales history cleared',
        detail: `${removed} recorded line${removed === 1 ? '' : 's'} removed · inventory untouched`,
        at: new Date().toISOString(),
      };
      await saveOrgState(c.env, auth.orgId!, {
        ...state,
        sales: [],
        salesTrackingSince: null,
        activity: [entry, ...state.activity].slice(0, 60),
      });
      await recordAudit(c.env, {
        action: 'sales.history_cleared',
        actorUserId: auth.userId,
        actorEmail: auth.email,
        orgId: auth.orgId,
        metadata: { removed },
      });
      return respond({ ok: true, removed });
    },
  );

  app.post('/export', requireFeature('csv_export'), requireAction('csv_export', 'export'), async (c) => {
    const parsed = await readJson<{ table?: CsvTable; filename?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const table = parsed.body.table;
    if (
      !table ||
      !Array.isArray(table.headers) ||
      !Array.isArray(table.rows) ||
      table.headers.length === 0
    ) {
      return respond({ code: 'validation', message: 'Nothing to export.' }, { status: 400 });
    }
    const requested = (parsed.body.filename ?? 'stockora-export').replace(/\.csv$/i, '');
    const filename = /^[a-zA-Z0-9._-]{1,80}$/.test(requested) ? `${requested}.csv` : 'stockora-export.csv';
    const csv = `﻿${buildCsv(table)}`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  });

  return app;
}
