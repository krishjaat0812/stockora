import { Hono } from 'hono';
import { recordAudit } from '../audit';
import { ensureOrgState, readOrgStateForUpdate, saveOrgStateCas, uuid } from '../db';
import { readJson, respond } from '../http';
import {
  requireAction,
  requireFeature,
  requireOrganization,
  requireUser,
  type AppEnv,
} from '../middleware';
import { findProductByBarcode, matchesProductQuery, normalizeBarcode } from '../../src/lib/barcode';
import {
  applyCancelOrder,
  applyCheckout,
  applyCompleteOrder,
  posSettings,
  salesCsv,
  toPosProduct,
  type CheckoutContext,
  type CheckoutInput,
  type CheckoutOutcome,
  type PosProduct,
} from '../../src/lib/pos';
import type { SaleOrder, SaleStatus } from '../../src/types';

/**
 * Point of Sale API.
 *
 * Every route is tenant-scoped through the authenticated session: the
 * organisation id never comes from the request, so one shop cannot look up,
 * sell or read another shop's products and transactions. Prices and stock are
 * always read server-side; the client only sends product ids and quantities.
 *
 * Mutating routes use compare-and-swap saves with revalidation, so two tills
 * racing for the last unit cannot oversell, and an idempotency key makes a
 * retried checkout return the existing transaction instead of deducting
 * stock twice.
 */

const CAS_ATTEMPTS = 4;

function statusForFailure(code: string): number {
  switch (code) {
    case 'discount_denied':
      return 403;
    case 'not_found':
      return 404;
    case 'insufficient_stock':
    case 'expired':
    case 'inactive':
    case 'price_missing':
    case 'write_conflict':
      return 409;
    case 'already_completed':
    case 'order_cancelled':
      return 409;
    default:
      return 400;
  }
}

/** Non-blocking sellability issues shown to the cashier after a scan. */
function issuesFor(product: PosProduct, expiryThreshold: number): string[] {
  const issues: string[] = [];
  if (!product.active) issues.push('inactive');
  if (product.sellingPrice === null) issues.push('price_missing');
  if (product.expired) issues.push('expired');
  if (product.currentStock <= 0) issues.push('out_of_stock');
  if (
    !product.expired &&
    product.nearExpiry &&
    product.daysRemaining !== null &&
    product.daysRemaining <= expiryThreshold
  ) {
    issues.push('near_expiry');
  }
  return issues;
}

function dateOf(order: SaleOrder): string {
  return order.soldAt ?? order.createdAt.slice(0, 10);
}

function respondFailure(outcome: Extract<CheckoutOutcome, { ok: false }>) {
  return respond(
    { code: outcome.code, message: outcome.message, productId: outcome.productId },
    { status: statusForFailure(outcome.code) },
  );
}

export function buildPosRoutes() {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser, requireOrganization, requireFeature('pos'), requireAction('pos', 'view'));

  /**
   * Barcode lookup. Exact match on the primary or an alternative barcode
   * within this organisation only. Returns authoritative price/stock plus the
   * issues that would block checkout — the client never sends a price.
   */
  app.get('/lookup', async (c) => {
    const code = normalizeBarcode(c.req.query('code') ?? '');
    if (!code) {
      return respond({ code: 'missing_code', message: 'Provide a barcode to look up.' }, { status: 400 });
    }
    const auth = c.get('auth');
    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
    const product = findProductByBarcode(state.products, code);
    if (!product) {
      return respond(
        {
          code: 'not_found',
          message: `No product with barcode ${code}.`,
          barcode: code,
        },
        { status: 404 },
      );
    }
    const pos = toPosProduct(product, state.settings);
    return respond({
      found: true,
      barcode: code,
      product: pos,
      issues: issuesFor(pos, state.settings.expiryThreshold),
      currency: state.settings.currency,
      taxInclusive: posSettings(state.settings).taxInclusive,
    });
  });

  /** Manual product search (name / SKU / barcode) for the POS picker. */
  app.get('/search', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (!query) return respond({ products: [] });
    const auth = c.get('auth');
    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
    const results = state.products
      .filter((product) => matchesProductQuery(product, query))
      .slice(0, 20)
      .map((product) => {
        const pos = toPosProduct(product, state.settings);
        return { product: pos, issues: issuesFor(pos, state.settings.expiryThreshold) };
      });
    return respond({ products: results, currency: state.settings.currency });
  });

  /**
   * Completes (or, per shop policy, stages for payment confirmation) a sale.
   * The whole transaction — order, sales-ledger lines, stock deduction and
   * movements — is written in one atomic compare-and-swap save.
   */
  app.post('/checkout', requireAction('pos', 'create'), async (c) => {
    const parsed = await readJson<CheckoutInput>(c);
    if ('error' in parsed) return parsed.error;
    const input = parsed.body;
    const auth = c.get('auth');
    const actions = c.get('actions');
    const ctx: CheckoutContext = {
      now: new Date(),
      cashierId: auth.userId,
      cashierName: auth.displayName || auth.email,
      allowDiscount: Boolean(actions.pos?.edit),
      newId: uuid,
    };

    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const snapshot = await readOrgStateForUpdate(c.env, auth.orgId!, auth.orgName);
      const outcome = applyCheckout(snapshot.state, input, ctx);
      if (!outcome.ok) {
        await recordAudit(c.env, {
          action: 'access.denied',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          orgId: auth.orgId,
          outcome: 'denied',
          metadata: { path: '/api/pos/checkout', reason: outcome.code, productId: outcome.productId },
        });
        return respondFailure(outcome);
      }
      if (outcome.duplicate) {
        // Retry of an already-processed checkout: return the same transaction.
        return respond({ ok: true, order: outcome.order, duplicate: true });
      }
      const saved = await saveOrgStateCas(c.env, auth.orgId!, outcome.state, snapshot.version);
      if (saved) {
        await recordAudit(c.env, {
          action: outcome.order.status === 'completed' ? 'pos.sale_completed' : 'pos.sale_confirmed',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          orgId: auth.orgId,
          targetType: 'sale',
          targetId: outcome.order.id,
          metadata: {
            receipt: outcome.order.receiptNumber,
            status: outcome.order.status,
            total: outcome.order.total,
            paymentMethod: outcome.order.paymentMethod,
            lines: outcome.order.lines.length,
          },
        });
        return respond(
          { ok: true, order: outcome.order, duplicate: false },
          { status: 201 },
        );
      }
      // Another till wrote first — loop to re-read, re-validate and retry.
    }
    return respond(
      {
        code: 'write_conflict',
        message: 'Another sale was recorded at the same moment. Please try again — nothing was charged or deducted.',
      },
      { status: 409 },
    );
  });

  /** Confirms payment on a pending transaction and deducts stock exactly once. */
  app.post('/orders/:id/complete', requireAction('pos', 'create'), async (c) => {
    const orderId = c.req.param('id');
    const auth = c.get('auth');
    const ctx: CheckoutContext = {
      now: new Date(),
      cashierId: auth.userId,
      cashierName: auth.displayName || auth.email,
      allowDiscount: Boolean(c.get('actions').pos?.edit),
      newId: uuid,
    };
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const snapshot = await readOrgStateForUpdate(c.env, auth.orgId!, auth.orgName);
      const outcome = applyCompleteOrder(snapshot.state, orderId, ctx);
      if (!outcome.ok) return respondFailure(outcome);
      if (outcome.duplicate) return respond({ ok: true, order: outcome.order, duplicate: true });
      const saved = await saveOrgStateCas(c.env, auth.orgId!, outcome.state, snapshot.version);
      if (saved) {
        await recordAudit(c.env, {
          action: 'pos.sale_confirmed',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          orgId: auth.orgId,
          targetType: 'sale',
          targetId: outcome.order.id,
          metadata: {
            receipt: outcome.order.receiptNumber,
            status: outcome.order.status,
            total: outcome.order.total,
          },
        });
        return respond({ ok: true, order: outcome.order, duplicate: false }, { status: 201 });
      }
    }
    return respond(
      { code: 'write_conflict', message: 'Inventory changed while confirming. Please try again.' },
      { status: 409 },
    );
  });

  /** Cancels a transaction that has not completed. Completed sales cannot be cancelled. */
  app.post('/orders/:id/cancel', requireAction('pos', 'delete'), async (c) => {
    const orderId = c.req.param('id');
    const auth = c.get('auth');
    const ctx: CheckoutContext = {
      now: new Date(),
      cashierId: auth.userId,
      cashierName: auth.displayName || auth.email,
      allowDiscount: false,
      newId: uuid,
    };
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const snapshot = await readOrgStateForUpdate(c.env, auth.orgId!, auth.orgName);
      const outcome = applyCancelOrder(snapshot.state, orderId, ctx);
      if (!outcome.ok) return respondFailure(outcome);
      if (outcome.duplicate) return respond({ ok: true, order: outcome.order, duplicate: true });
      const saved = await saveOrgStateCas(c.env, auth.orgId!, outcome.state, snapshot.version);
      if (saved) {
        await recordAudit(c.env, {
          action: 'pos.sale_cancelled',
          actorUserId: auth.userId,
          actorEmail: auth.email,
          orgId: auth.orgId,
          targetType: 'sale',
          targetId: outcome.order.id,
          metadata: { receipt: outcome.order.receiptNumber, status: outcome.order.status },
        });
        return respond({ ok: true, order: outcome.order, duplicate: false });
      }
    }
    return respond(
      { code: 'write_conflict', message: 'The transaction changed while cancelling. Please try again.' },
      { status: 409 },
    );
  });

  /** Transaction history for the till and reports (tenant-scoped, date filtered). */
  app.get('/orders', async (c) => {
    const auth = c.get('auth');
    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
    const query = c.req.query();
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const status = (query.status ?? 'all') as SaleStatus | 'all';
    const from = (query.from ?? '').trim();
    const to = (query.to ?? '').trim();
    const filtered = state.saleOrders
      .filter((order) => (status === 'all' ? true : order.status === status))
      .filter((order) => {
        const date = dateOf(order);
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return respond({
      orders: filtered.slice(0, limit),
      total: filtered.length,
      receiptCounter: state.receiptCounter,
      paymentMethods: posSettings(state.settings).paymentMethods,
      taxInclusive: posSettings(state.settings).taxInclusive,
      requirePaymentConfirmation: posSettings(state.settings).requirePaymentConfirmation,
      currency: state.settings.currency,
    });
  });

  /** Server-built CSV export of POS transactions (authoritative rows). */
  app.post('/export', requireAction('pos', 'export'), async (c) => {
    const parsed = await readJson<{ from?: string; to?: string }>(c);
    if ('error' in parsed) return parsed.error;
    const auth = c.get('auth');
    const state = await ensureOrgState(c.env, auth.orgId!, auth.orgName);
    const now = new Date();
    const from = (parsed.body.from ?? '').trim() || '0000-01-01';
    const to = (parsed.body.to ?? '').trim() || now.toISOString().slice(0, 10);
    const csv = `﻿${salesCsv(state.saleOrders, { from, to }, state.settings.currency)}`;
    const stamp = to.replace(/[^0-9]/g, '-') || 'export';
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="stockora-sales-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  });

  return app;
}
