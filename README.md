# Stockora — Smart Retail Inventory & Expiry Assistant

**Smarter stock. Less waste. Better decisions.**

Stockora is a working retail inventory decision assistant for grocery shops, convenience stores and small supermarkets. It combines stock monitoring, expiry tracking, days-of-cover analysis and replenishment suggestions into one prioritized picture of what needs attention today.

This is a functional application, not a visual mock. Every figure is derived from the current inventory; every listed control performs its stated action.

Stockora is a multi-tenant application. Each shop's workspace lives in a Cloudflare D1 database and is scoped to the signed-in organisation on the server; the browser is never trusted for roles, feature access or organisation scope. A platform administrator manages clients, plan-based feature access and security policy from the Admin Panel.

---

## Quick start

Requirements: Node.js 18+ (developed on Node 24) and npm.

```bash
npm install
npm run dev        # SPA on http://127.0.0.1:5173
npm run dev:server # Worker + local D1 on http://127.0.0.1:8787 (run alongside)
npm run test       # 204 business-logic tests
npm run typecheck  # browser and Worker TypeScript
npm run build      # typecheck + production build
npm run api:test   # API integration tests against a running Worker
```

The Vite dev server proxies `/api` to the Worker, so both processes must be running to sign in. Local development needs no API keys or paid services; Cloudflare's `workerd` runs locally through Wrangler with a local D1 database.

**Local demo accounts** are seeded on first run by the Worker (override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`):

| Role | Email | Password |
| --- | --- | --- |
| Platform administrator | `admin@stockora.dev` | `StockoraAdmin!2026` |
| Shop owner (FreshMart demo store, Premium plan) | `owner@freshmart.dev` | `StockoraShop!2026` |

These demo accounts are created **only when `DEV_LINKS=true`** (the local `.env` sets it). In any other environment the Worker creates an administrator only when `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are supplied, and it never creates the demo shop — so a public deployment cannot expose a documented password. If no administrator exists, the Worker logs a bootstrap instruction instead of inventing one.

---

## Stack

- React 18 + TypeScript (Vite)
- Tailwind CSS with a custom Stockora design system
- React Router 6 for real page navigation
- Recharts for the inventory-health donut and priority chart
- Lucide React icons
- Hono on a Cloudflare Worker for the API, with D1 for storage
- `@zxing/browser` for the optional camera barcode scanner (lazy-loaded, browser-side only)
- Vitest for the inventory, CSV, validation, calculator, barcode, POS, permission and password suites

---

## What is implemented

### Overview
- Five live KPI cards (total, low stock, near expiry, urgent actions, healthy) that link to filtered views.
- Daily briefing generated from current stock, expiry and settings.
- Mutually exclusive health donut with counts, percentages and clickable categories.
- Highest-priority action preview with stock, cover, expiry, reorder quantity and next step.
- Quick actions and recent activity feed with an empty state.

### Inventory
- Full CRUD with a validated form, duplicate-SKU protection, timeline-persisted timestamps and a delete confirmation.
- Search by name or SKU, category filter, status filters (low, near expiry, combined, expired, healthy), sorting by name, stock, cover or expiry, page sizes and pagination.
- Desktop/tablet table with every required column; a card layout on smaller screens (actions remain reachable).
- Product detail drawer with the reorder formula, expiry context, safety notes and review state.
- CSV export of the currently filtered list.

### Scan & Sell (POS)
- Three ways to scan: a USB/Bluetooth keyboard-wedge scanner (Enter or Tab suffix, input refocused after every scan), manual entry or paste, and an optional camera scanner (`@zxing/browser`, EAN-13 / UPC-A / EAN-8 / Code 128). The camera needs a secure context (HTTPS or localhost) and permission; frames are decoded in the browser and never stored or uploaded.
- Products carry a primary barcode plus optional alternative barcodes, separate from the SKU. Barcodes are trimmed, case-insensitive and unique **within the shop**; the same rule runs in the product form, the CSV import and the Worker, so two products can never answer to one code. Unknown codes show “Product not found” with the scanned value kept for review — no product, price or tax rate is invented.
- Scanning only reads. Each scan validates the code, resolves it inside the signed-in organisation, checks the product is active, priced, unexpired and in stock, then adds it to the cart. A repeat scan increments the existing line instead of duplicating it; fractional quantities are accepted only for products flagged as sold by weight or unit.
- Checkout re-reads every price and stock level on the server, then recalculates each line (item discount → proportional order discount → per-product tax, inclusive or exclusive, 2-decimal rounding with totals equal to the sum of lines). Stale carts, invalid quantities, unauthorised discounts and insufficient stock are rejected with a specific message.
- A sale completes in **one atomic write**: order + sales-ledger lines (`source: 'pos'`, linked by `saleId`) + stock deduction + inventory movements (previous/resulting stock, actor, sale id) + activity entry. Concurrent tills save through an `org_state.version` compare-and-swap, so two sales cannot both spend the same last unit.
- `idempotencyKey` is mandatory: a double-click, retry or replay returns the existing transaction with `duplicate: true` and moves no stock. Cancelling a pending sale leaves stock untouched, and a completed sale cannot be cancelled (no refunds are implemented).
- Payment: cash, UPI, card or other as enabled by the shop; cash records the amount tendered and the change due. This is a **cashier-confirmed record, not a processed payment** — no gateway is connected and no card, CVV or PIN is ever collected.
- Receipts use `RCPT-000001` numbering and print through the browser's print workflow with shop footer, cashier, per-line tax and totals; pending transactions print marked as awaiting payment. If `settings.pos.requirePaymentConfirmation` is on, checkout first saves a **pending** transaction and stock moves only when the cashier confirms — the confirmation revalidates stock before deducting.
- Permissions reuse the existing action model on a new `pos` feature (requires Inventory): `view` opens the till, `create` records/confirms a sale, `edit` applies discounts, `delete` cancels a pending sale, `export` downloads the sales CSV. Every POS endpoint enforces its own action server-side.

### Action Center
- One unified queue: expired (P0) → combined risk (P1) → low stock (P2) → near expiry only (P3).
- Each product appears once with all reasons, current stock, cover, expiry and recommended next step.
- Stock-only low items are ordered by lowest days of cover with unknown cover sorted last; near-expiry items by fewest days remaining.
- Review filtering, review/reopen control, and an explicit note that reviewing does not reorder, sell or remove stock.
- CSV export and category/priority/review filters.

### Expiry Monitor
- Six groups: expired, expires today, 1–3 days, 4–7 days, later, missing date.
- Expiry window, category and date-range filters.
- Remaining stock, date, days remaining, stock status and recommended next action per product.
- Expired products are separated from sellable stock and never given sell/discount guidance.

### Reorder Planner
- Suggested quantities from demand, lead time and safety buffer, with the formula visible globally and per row.
- Sort by cover, quantity or expiry; category and stock-status filters.
- Review tracking separate from Action Center reviews, plus CSV export.
- Expired products are excluded from replenishment. Combined-risk products carry an expiry warning.
- No orders are placed; the planner is explicitly advisory.

### Suppliers
- A private supplier directory per shop: name, contact person, email, phone, address, payment terms, lead time, notes and active/inactive status.
- Search across name, contact, email, phone and address; filter by status; sort active first then alphabetically.
- Summary tiles for supplier count, linked products, stock value at unit cost and low-stock lines.
- Supplier drawer with clickable email/phone, terms, linked products (with stock status) and a direct link into Inventory.
- Suppliers link to products through `supplierId`; products saved before linking existed are matched by name, and a CSV `Supplier Name` is auto-linked when it matches a record. Nothing is created implicitly.
- Deleting a supplier never deletes products or stock — the products are simply unlinked. Validation (name, duplicate, email, phone, lead time) runs in the form **and** on the server.

### Demand Analytics
- Works from **recorded sales transactions only** — no estimated or generated demand figures. Import a sales CSV (date, SKU, quantity, optional unit price) or load clearly labelled sample history for the demo.
- Window selector (7 / 30 / 90 days) with units sold, revenue, best sellers, slow movers, stockout risk and overstock value.
- Per-product velocity, day-over-day cover, trend versus the preceding window, classification and flags, each with a written explanation and an advisory recommendation.
- A product with too little history is labelled **“Not enough history”** and is never reported as zero demand. A product is slow-moving only when the shop has at least 14 days of history and the product has been recorded long enough for an absence of sales to mean something.
- Trends are withheld when recorded history does not cover the whole previous period, instead of comparing against a partial window.
- Expired stock is never recommended for sale, gets no reorder advice, and its overstock guidance points to disposal first.
- Sales rows are validated against this shop's SKUs, future dates are rejected, identical lines are skipped on re-import, and edits to history go through the import/clear endpoints only (the state endpoint rejects writes to the ledger).
- Import results list rejected rows with row numbers and reasons. History can be cleared without touching products, stock, prices or suppliers.

### Reports & Impact
- Live counts and mutually exclusive health distribution.
- Action priority distribution chart.
- Category overview with units, risks and stock value from optional unit costs.
- Four CSV exports: inventory, Action Center, expiry monitor, reorder planner.
- **Point of Sale · sales** section (shown only when the account can view POS): date-range net sales after discounts, completed/pending/cancelled counts, units sold, average transaction, discounts given, per-product tax collected, payment-method split, top products by units, recent receipts, and a server-built sales CSV export gated by `pos:export`. The figures come only from completed POS transactions — sample and imported demand rows are never mixed in.
- A **controlled seeded-dataset comparison** (3/7 stock-only flags vs 7/7 combined flags, 4 distinct products, 0 expected false alarms) kept separate from live statistics, with explicit “what this does not claim” notes.

### Business Calculator
- A live inventory panel derived from your own products: units in stock, purchase value, selling value, potential gross profit, dead-stock value, reorder shortfall, value at risk before expiry and near-expiry count.
- Six tool categories — Inventory, Profit & loss, Purchase & supplier, Sales, Expiry & waste and General — covering 33 calculators: stock value, margin and markup, days of cover, reorder quantity and safety stock, turnover and carrying cost, dead/shortage value, profit and net estimate, price for a target margin, break-even units and sales, expense ratio, discount impact, purchase order and landed cost, GST added and removed, supplier quote comparison, invoice discount, revenue, growth, sales rate and forecast, sales target for a profit, average transaction value, value at risk before expiry, markdown ceiling, loss reduction from a markdown, waste percentage, recovery rate, percentages, ratio simplification, unit-price comparison, date difference, days until expiry and plain arithmetic.
- Every tool states its formula and can load a product from inventory to fill the inputs that product actually records; fields it does not record keep their default rather than being invented.
- Results recalculate as you type. Figures that cannot be computed say why (for example margin with a zero selling price) instead of showing a misleading zero.

### Settings
- Shop name, currency, near-expiry threshold (default 3), safety buffer (default 2) and notification preferences.
- **Point of Sale**: accepted payment methods (at least one must stay enabled), tax-inclusive pricing, “require payment confirmation” (pending → completed instead of instant completion) and the receipt footer. Changes apply to the next checkout and are saved with the rest of the settings.
- Live preview of how threshold/buffer changes affect counts and suggested units before saving.
- Import, export, template download, reload from storage and reset demo data with confirmation.
- Settings persist and recalculation happens immediately after saving.

### Notifications
- In-app bell panel with unread count, per-item navigation, dismiss, mark-as-read and mark-all-read.
- Condition notifications are deduplicated by product risk state, so unchanged conditions do not create repeats.
- Import/product-change messages are event-driven. No email, SMS or push delivery is simulated because none is connected.

### Accounts, roles and feature access
- Two authenticated surfaces: the client panel (shop owners) and the Admin Panel (platform administrators). Sessions are server-side and revoked on suspension or password change.
- The administrator creates a client, which issues a one-time setup link, and can suspend, rename or move a client between plans at any time.
- Feature access is resolved on the server in one place: `src/shared/features.ts`. A feature is available when the account and organisation are active, the assigned plan allows it, and no explicit per-client override contradicts that. An override always wins over the plan.
- Dependency rules are enforced on both sides (for example, turning Inventory off also turns off Action Center, Expiry Monitor, Reorder Planner, Business Calculator and the CSV workflows), so the database cannot grant a feature the code cannot back.
- Plans: **Starter** (Dashboard, Inventory, Expiry Monitor, Notifications), **Growth** (adds Action Center, Reorder Planner, **Supplier Management**, **Demand Analytics**, Business Calculator, CSV import/export) and **Premium** (everything).
- **Per-action permissions.** Enabling a feature does not grant everything inside it: an administrator can separately allow or deny `view`, `create`, `edit`, `delete` and `export` for each feature, and the admin UI only offers the actions a feature actually performs. `view` is the master switch — denying it closes the feature completely. Denials are stored per organisation in `org_feature_actions` and re-checked on the server for every request: product writes are diffed so a client allowed to edit but not delete can still save its edits, CSV import/export require their own actions, and `requireFeature`/`requireContentAccess` reject requests when viewing has been withdrawn. The client's route guards, navigation and buttons read the same resolved values, so the UI matches what the server will actually allow.
- Every access change, client change, sign-in failure and security event is written to an audit log readable in the Admin Panel.
- Password policy (minimum length, session lifetime, lockout thresholds) is administrator-controlled and enforced by the Worker, and password changes hash with a per-password salt.
- **Password-change policy.** Whether a client may change their own password is an administrator decision: one global switch (Security & staff → *Allow clients to change their own passwords*) plus an optional per-client override (`inherit` / `allow` / `deny`) on the same page. Precedence is platform administrators are always allowed, then the client override, then the global default; an unreadable policy fails closed. The rule is enforced in `POST /api/auth/change-password`, which rejects with `403 password_change_disabled` before it ever looks at the current password. **The client app has no password-change form at all**: Account & security only shows the account summary and session control, with a note pointing at the administrator. Forgotten-password recovery is a separate workflow and stays available either way.
- **Administrator-set passwords.** Because clients cannot change their own password, the Admin Panel does it for them: `/admin/clients/:id` → *Set password* on a member opens a dialog that calls `POST /api/admin/clients/:id/password` (capability `security:write`). The password is validated against the organisation policy, stored only as a PBKDF2 hash, every live session of that account is revoked, and the change is written to the audit log as `client.password_reset`. Invited accounts must finish setup first and suspended accounts must be reactivated first — the server enforces both, not just the UI.
- The client navigation, route guards and API checks all read the same resolved permissions, so hiding a page in the browser is never the only protection.
- **Authentication.** Email + password sign-in for both panels, a show/hide password control, validated fields, a generic failure message that never reveals whether an account exists, and a loading state. Passwords are PBKDF2-SHA-256 with per-user salts; sessions are opaque random tokens stored as SHA-256 hashes in `HttpOnly`, `SameSite=Lax` cookies; login attempts are rate-limited per email + IP; reset and invitation tokens are hashed, single-use and expiring. Roles and account/organisation status are resolved server-side on every request, and one shop can never read another's inventory, suppliers, sales or reports.

---

## Architecture

```
src/
  data/seed.ts               Seeded demo products and default settings
  lib/
    date.ts                  Calendar-day helpers (ISO parsing, day differences)
    inventory.ts             Single source of truth for all business rules
    validation.ts            Shared field validation and form parsing
    suppliers.ts             Supplier validation, search, product linking and summaries
    demand.ts                Pure demand analytics (velocity, classification, flags, advice)
    sales.ts                 Sales CSV parsing, duplicate detection and ledger merging
    csv.ts                   RFC-4180 parser/builder, import validation, export tables
    calculator.ts            Pure retail formulas behind the Business Calculator
    barcode.ts               Barcode format/checksum rules, tenant-scoped lookup, duplicate detection
    pos.ts                   Cart, totals, atomic checkout, pending payment, cancel, sales metrics/CSV
    print.ts                 Browser receipt and barcode-label printing (DOM-only, excluded from the server tsconfig)
    calculatorTools.ts       Declarative registry of the 33 calculator tools
    format.ts                Number/currency/unit formatting
    *.test.ts                Vitest suites for rules, CSV, validation and calculators
  store/StockoraContext.tsx  Persistence, mutations, activity, alerts, derived state
  components/
    ui.tsx                   Buttons, badges, fields, modal, drawer, confirm, empty state
    layout/AppLayout.tsx     Sidebar, header, notifications, mobile navigation
    ProductFormDialog.tsx    Add/edit form with live calculation preview
    ProductDetailDrawer.tsx  Product insight drawer
    ImportCsvDialog.tsx      Upload → validate → review → confirm workflow
    SupplierFormDialog.tsx   Supplier create/edit form with server-mirrored validation
    SupplierDetailDrawer.tsx Supplier contact, terms and linked-stock panel
    SalesImportDialog.tsx    Sales history upload with per-row rejection report
    DemandDetailDrawer.tsx   Demand explanation, reasons and advisory recommendation
    DeleteProductDialog.tsx  Destructive confirmation
    inventory-badges.tsx     Stock, expiry, risk, priority and review badges
    toast.tsx                Accessible transient feedback
    pos/                     CameraScanner (lazy zxing decoder) and ReceiptModal (browser print)
  pages/                     Overview, Inventory, Suppliers, Demand, Actions, Expiry, Reorder,
                             Reports, Calculator, Settings, Security and the auth pages
  admin/                     Admin Panel: clients, feature access, security, audit logs
  auth/                      Session context, route guards and the API client
  shared/features.ts         Feature catalogue, plans, dependencies and resolution rules

server/
  index.ts                   Hono app: CSRF/origin gate, routes, static assets
  db.ts                      Idempotent schema, catalogue seeding, org state
  routes/                    auth.ts (sessions, invitations, resets), admin.ts, state.ts,
                             pos.ts (barcode lookup/search, checkout, confirm, cancel, sales export)
  auth/                      Password hashing, session lifecycle, login rate limiting
  audit.ts                   Append-only audit log writer
```

**One source of truth.** `StockoraContext` holds products, suppliers, the sales ledger, settings, reviews, activity and notifications. Sales history is appended by its own API endpoint rather than through the general state write, so the ledger cannot be rewritten by an unrelated save. `buildInsights()` derives expiry status, stock status, days of cover, reorder quantity, risk category and priority for every product on each state change. Pages read these derived values; no component keeps its own totals. KPI values, charts, actions, reports and CSV rows all come from the same array.

**Persistence.** The workspace document is stored per organisation in D1 (`org_state`), keyed by the organisation on the authenticated session. Mutations update the UI immediately and are written to the Worker, which re-validates the payload and re-checks feature permissions before saving. Sessions are opaque random tokens in an `HttpOnly` cookie; only their SHA-256 hash is stored, and state-changing requests are rejected when they arrive from a foreign origin. POS transactions live in the same organisation document (`saleOrders`, `inventoryMovements`, `receiptCounter`) and are written only by `/api/pos/*`; the general state endpoint rejects those keys, and checkout saves through a compare-and-swap on `org_state.version` with a bounded retry so two tills can never both deduct the same unit.

**Business logic is pure and testable.** `lib/inventory.ts` has no React or storage dependencies. The tests run against a fixed reference date so seeded expiry offsets stay deterministic.

### Rule summary

| Rule | Implementation |
| --- | --- |
| Low stock | `currentStock <= reorderLevel` (equality triggers) |
| Near expiry | `0 <= daysRemaining <= expiryThreshold`; 0 is “Expires Today” |
| Expired | `daysRemaining < 0`; separate status, never “near expiry” |
| Missing expiry | No date recorded; excluded from expiry-risk counts |
| Days of cover | `stock ÷ averageDailySales`; `N/A` when sales = 0 |
| Reorder quantity | `max(0, ceil(avgDailySales × (leadTimeDays + safetyBufferDays) − currentStock))` |
| Risk category | exactly one of Healthy, Low Stock Only, Near Expiry Only, Both; Expired is separate |
| Priority | Expired (P0) → Both (P1) → Low only (P2) → Near expiry only (P3) |
| Demand velocity | Recorded units ÷ tracked days in the selected window (7/30/90) |
| Best seller | Velocity in the top quartile of products with sufficient history |
| Slow moving | Zero recorded sales in the window, with ≥ 14 days of shop history and a product old enough to judge |
| Not enough history | Fewer than 14 days of shop history, or a newly added product with no sales — never counted as zero demand |
| Stockout risk | Cover ≤ lead time + 1 day, and the product is not expired |
| Overstock | Cover > 60 days at the recorded velocity, or no sales in the window while stock remains |
| Trend | Current window vs the preceding equal window; withheld when history does not cover that period |

### Worked calculations (seed data)

- **Milk 1L** — `ceil(12 × (1 + 2) − 8) = 28`; cover `8 ÷ 12 = 0.7`
- **Bread** — `ceil(10 × (1 + 2) − 4) = 26`; cover `4 ÷ 10 = 0.4`
- **Yogurt** — `ceil(7 × (1 + 2) − 5) = 16`; cover `5 ÷ 7 = 0.7`
- **Rice / Juice / Soap** — required stock is already covered → `0`

Expired products always show no replenishment quantity.

---

## Seeded demo dataset

Every seeded product carries a **valid EAN-13 barcode** so scanning can be demonstrated without hardware: R101 `8901234000014`, R102 `8901234000021`, R103 `8901234000038`, R104 `8901234000045`, R105 `8901234000052`, R106 `8901234000069`. Each also has its own tax rate (0 / 5 / 12 / 18 %), which is why checkout totals differ per product. Type a code into Scan & Sell, print a label from the product drawer, or scan a printed copy.

The six demo products are anchored to the day the dataset is created/reset. “Reset demo data” re-anchors expiry dates to today so the walkthrough stays predictable.

| SKU | Product | Stock | Avg daily sales | Lead time | Days to expiry | Reorder level |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| R101 | Milk 1L | 8 | 12 | 1 | 3 | 10 |
| R102 | Rice 5kg | 25 | 2 | 3 | 180 | 8 |
| R103 | Bread | 4 | 10 | 1 | 1 | 6 |
| R104 | Juice | 30 | 3 | 2 | 2 | 10 |
| R105 | Yogurt | 5 | 7 | 1 | 2 | 8 |
| R106 | Soap | 40 | 1 | 4 | 300 | 10 |

Expected classification with defaults (threshold 3, buffer 2):

| Product | Classification | Priority |
| --- | --- | --- |
| Milk | Low stock + near expiry | P1 |
| Bread | Low stock + near expiry | P1 |
| Yogurt | Low stock + near expiry | P1 |
| Juice | Near expiry only | P3 |
| Rice | Healthy | — |
| Soap | Healthy | — |

Health chart: Healthy 2 · Low stock only 0 · Near expiry only 1 · Both 3.
Individual risk flags: 7 (3 low + 4 expiry) across 4 distinct products.

### Demo suppliers and sample demand

A freshly seeded workspace also contains six suppliers (FreshPastures Dairy, AgriMart Wholesale, DailyBake Ltd., SunOrchard Beverages, Alpine Creamery and PureCare Supplies) linked to the demo products, each with contact details, payment terms and a lead time.

Demand analytics does **not** invent sales. A new workspace starts with an empty ledger; the Demand page offers *Import sales CSV* and, for walkthroughs, *Load sample history*, which adds 75 days of deterministic transactions for the six demo SKUs. Those rows carry `source: 'demo'`, and the page shows a “Sample data in use” notice until real history replaces them. Products with no recorded sales — including the manually added R109 Icecream in an existing demo workspace — correctly show “Not enough history” rather than “slow moving”.

With sample history loaded and a 30-day window, the demo shows two best sellers (Milk, Bread), steady Rice/Juice/Soap rather than fabricated bestsellers, one overstock finding (Soap, ~75 days of cover) and one unclassified product. Revenue shows “No prices recorded” unless the imported lines include `unit_price`.

---

## Supplier data and sales history

Suppliers are stored with the shop's workspace and linked to products by `supplierId` (with a legacy name match for older rows). The demo shop starts with six suppliers matching the seeded products, each with contact details, payment terms and lead time.

Demand analytics needs transactions. Import a CSV with `date, sku, quantity` and an optional `unit_price`:

```csv
date,sku,quantity,unit_price
2026-01-04,R101,12,70
2026-01-04,R102,2,485
```

Rules: dates are `YYYY-MM-DD` (or `YYYY/MM/DD`), quantity must be greater than zero, the SKU must exist in the same shop, and future dates are rejected. Re-uploading the same file is safe — identical lines are skipped. Sales lines are append-only; clearing history keeps every product, price and supplier intact. The demo's “Load sample history” adds 75 days of deterministic sample transactions that are labelled `demo` and flagged in the UI, so they are never mistaken for real trading data.

---

## CSV import / export

**Import** (Inventory or Settings):
1. Download the sample template (or use the documented columns).
2. Upload a `.csv` (max 2 MB). Dates accept `YYYY-MM-DD` or `DD/MM/YYYY`.
3. Every row is validated. Invalid rows are listed with row number, SKU and a specific reason; they are never imported silently.
4. Duplicate SKUs inside the file are rejected. Existing SKUs are rejected unless “Update existing products” is enabled.
5. Choose “Import N products”, or cancel before committing. All derived metrics are recalculated after import.

Required columns: `SKU, Product Name, Category, Current Stock, Reorder Level, Average Daily Sales, Lead Time Days`.
Optional: `Expiry Date, Supplier Name, Unit, Unit Cost, Selling Price`.

**Export** produces UTF-8 CSV with a BOM for Excel. Inventory, Action Center, Expiry Monitor and Reorder Planner each have their own export, reflecting the current filters where the page has them.

---

## Acceptance tests

### Automated (`npm run test`) — 204 tests, all passing
### API acceptance suite (`npm run api:test`) — 135 checks against a running Worker

`src/lib/inventory.test.ts`
- **A — initial data:** 6 products, 3 low, 4 near expiry, 4 distinct actions, 7 risk flags, health 2/0/1/3, cover values 0.4/0.7/0.7.
- **B — combined risk:** Milk, Bread and Yogurt each appear once with two reasons and P1; Bread first by cover.
- **C — expiry-only:** Juice is near expiry, not low stock, reorder 0, rotation/markdown guidance (no reorder wording).
- **D — live change:** Rice 25 → 6 becomes low stock and updates metrics/queue/health; back to 25 becomes healthy.
- **E — threshold:** at 1 day only Bread stays near expiry; low-stock count stays 3; Milk becomes low-only.
- **F — reorder:** 28 / 0 / 26 / 0 / 16 / 0 exactly; no negatives; fractional inputs round up safely.
- **G — expired:** negative days is expired (not near), P0, removal guidance, no sell/discount wording; no reorder quantity.
- Edge cases: equality triggers low stock, zero sales gives N/A cover, missing date is not near expiry, unknown cover sorts last, empty inventory briefing, safety buffer changes.

`src/lib/csv.test.ts`
- **I — CSV:** quoted fields/embedded commas/escaped quotes, unclosed quote error, DD/MM/YYYY dates, row-numbered validation errors, in-file duplicates, existing SKUs with/without update mode, missing columns, empty file, non-numeric values, export contents and review state.

`src/lib/validation.test.ts`
- Required fields, duplicate SKUs, own-SKU edit, negative/fractional numbers, zero sales allowed, invalid dates, negative cost, form normalization and prefill.

`src/lib/calculator.test.ts`
- Every formula, including the zero-denominator guards: margin with a zero price, markup with a zero cost, cover with zero sales, contribution margin at zero or negative, break-even sales at a zero margin ratio, waste and recovery rates against zero totals.
- The reorder calculator is asserted equal to the Reorder Planner's own `reorderQuantity()` for all six seeded products, so the two can never drift apart.
- Discount impact reports a loss when the discounted price falls below cost; the markdown ceiling refuses to suggest a discount that undercuts cost.
- Live summary over the seeded data: 112 units, purchase value 15,019, selling value 17,520, gross profit 2,501, shortfall 70 units / 3,288, at-risk 24 units / 2,040 cost / 2,400 revenue in 1 product, 4 products near expiry.
- Missing-input honesty: a product with no cost and no price yields zero totals **and** increments the missing counters rather than silently dropping out of the sum.

`src/lib/calculatorTools.test.ts`
- Registry integrity: unique ids, every category populated, every tool named with a stated formula, and no empty result row for the default inputs.
- Robustness: no tool throws on blank or negative input, and every non-date tool returns a real number (the ratio simplifier is asserted to be text-only).
- Prefill: loading Milk into the reorder tool gives `28` units; loading Juice into the expiry tool reads its real 2 days and 30 units and leaves the unrecorded selling price at the tool's default.

`src/lib/suppliers.test.ts`
- Required name, case-insensitive duplicate detection (including the “editing yourself” case), optional-but-validated email and phone, whole-day lead time bounds.
- Form mapping trims values and converts blanks to `undefined`; search matches name/contact/email/phone; status filter; product linking by id and by legacy name; per-supplier stock value and low-stock counts; monogram initials.

`src/lib/demand.test.ts`
- **No history:** products are `insufficient-history`, not slow movers; a new product stays unclassified even when the shop has history.
- **Imported history:** a recently created product is judged on 21 days of imported sales instead of being disqualified by its record age.
- **Classification:** best seller by recorded velocity, slow mover only with sufficient history, overstock by days of cover with stock value, stockout risk when cover is below lead time, revenue from priced lines only.
- **Windows and trend:** 7-day window compares with the preceding 7 days; unsupported windows fall back to 30; future-dated sales are ignored.
- **Safety:** expired stock is never recommended for sale (no “markdown”/“discount” wording), gets no stockout advice, and analysis never mutates the product.

`src/lib/barcode.test.ts`
- Format rules: trimmed scanner input, 4–64 characters, safe character set, optional field, and retail check digits treated as a hint (a valid EAN-13 passes, an internal code with a bad checksum is still accepted).
- Lookup: known barcode → correct product, alternative barcode → same product, unknown barcode → nothing invented, and a second shop's list never resolves another tenant's code.
- Duplicate assignment is rejected with the owning product named; editing a product keeps its own barcode valid; alternative barcodes that collide with another product or repeat the primary one are rejected; malformed codes fail.

`src/lib/pos.test.ts`
- Cart: multiple products, repeated scans incrementing one line, quantity edits, removal, whole-unit vs fractional rules, and stock unchanged by scanning alone.
- Totals: exclusive tax added, inclusive tax extracted without changing the amount paid, item-then-order discounts, and totals always equal to the sum of their lines.
- Checkout: stock deducted exactly once, ledger line with `source: 'pos'` and `saleId`, movement with previous/resulting stock, receipt `RCPT-000001`, change due, activity entry; replayed idempotency key returns the same order and moves no stock; insufficient stock, expired, inactive, missing price, short cash, disallowed payment method and discount-denied are all rejected without touching state; sequential sales cannot oversell the last unit.
- Payment states: pending checkout deducts nothing, confirmation deducts once and a second confirmation is a no-op, cancellation leaves stock untouched, a pending order cannot be confirmed after another till sold the stock, and completed sales cannot be cancelled.
- Integration: POS lines feed `analyzeDemand` (units, transactions, velocity), reorder quantities rise by the units sold, `salesMetrics` counts completed transactions only and respects the date range, and the CSV table exports receipt rows.

**API suite coverage** includes the earlier admin/client separation, tenant isolation, live feature and per-action revocation, suspension, password policy, reset flows, audit logging and CSV checks, plus the new supplier and sales-history block: supplier create/read, invalid email and duplicate rejection, supplier writes blocked when the feature is disabled, sales import with tracking start, duplicate-safe re-import, demo provenance, unknown SKU and future-date rejection, immutable ledger through `/api/state`, and sales import blocked when Demand Analytics is disabled. Probe products and suppliers are restored afterwards. The POS block adds: unauthenticated barcode lookup rejected, seeded barcode resolving to R101 with a server price, unknown barcode → 404 with no invented product, saving a product with a barcode, duplicate barcode rejected with the owning product named, new barcode immediately scannable, checkout completing with a receipt number, stock deducted exactly once, ledger line and inventory movement linked to the sale, replay returning the same transaction without a second deduction, oversell rejected with 409 `insufficient_stock`, a client-supplied price ignored, the state endpoint refusing `saleOrders` writes, lookup and checkout blocked when the `pos` feature is disabled, a platform administrator receiving 403, and the probe product removed afterwards.

### Browser verification performed during development

- **H — persistence:** added and edited products, reloaded the page, confirmed changes and settings survived; reset demo data restored the six products and cleared reviews.
- **I — CSV in the browser:** uploaded a mixed file (1 valid + 1 invalid row), saw the row-specific error and 1/1 summary, imported the valid row, confirmed the new product and recalculated metrics; export triggered a correctly named CSV download.
- **J — responsive:** at 320, 375, 768, 1024 and 1440 px, all seven pages reported no document-level horizontal overflow. Mobile navigation drawer, bottom navigation, card layouts, forms, dialogs and drawers were exercised. At 768 px the compact sidebar and card layout are used; at 1440 px the full sidebar and data table fit without horizontal scrolling.
- Form validation (required fields, duplicate SKU), edit/delete with confirmation, review/reopen, notification read/dismiss/navigation, empty-inventory states, settings threshold recalculation and reset were each exercised through the running app.

No claim is made that this app has been deployed to or measured in a live retail environment.

---

## Three-minute demo script

1. **0:00–0:30 — Overview.** Show the briefing, the five KPIs and the health donut (2 healthy / 0 low-only / 1 expiry-only / 3 combined). Point out that every number is live.
2. **0:30–1:00 — Action Center.** Show Bread, Milk and Yogurt once each as P1 combined risk with both reasons and a “review before reordering” step. Mark one as reviewed and show the review filter.
3. **1:00–1:30 — Expiry Monitor.** Show Juice as expiry-only: stock 30 (healthy) but 2 days left, so stock-only monitoring would miss it. Show the expired group behaviour if you add a past-dated product.
4. **1:30–2:00 — Reorder Planner.** Open Bread: `ceil(10 × (1 + 2) − 4) = 26 units`, cover 0.4 days. Confirm no order is placed.
5. **2:00–2:30 — Live update.** Edit Rice stock 25 → 6. It becomes low stock (P2), KPIs and the health chart update instantly. Restore 25 or reset afterwards.
6. **2:30–3:00 — Impact.** In Reports, show the controlled comparison: stock-only detection found 3/7 flags, combined detection 7/7 across 4 products, 0 expected false alarms. Resize to mobile for the card layout and bottom navigation.

**POS (2 extra minutes).** Open **Scan & Sell**, click the barcode field and type `8901234000014` (or scan a printed copy) → Milk 1L appears with stock 8 and price 70; scan again to show the quantity becoming 2 on one line, not two. Add a second product (bread `8901234000038`) to show per-product tax. Press *Complete sale* with cash 500 → change due is shown, the receipt opens with `RCPT-…`, and the header stock badge drops by the sold quantity. Now open **Inventory**: Milk is at 6 and the movement history/ledger shows the sale. Open **Overview** and **Demand Analytics** to show the same sale counted there, and **Reports → Point of Sale · sales** for the day's net sales. Scan a made-up code (`1234567890123`-style) to show the “Product not found” state that offers to search or assign the barcode instead of inventing a product.

**Optional extra, if the account's plan includes it:** open the Business Calculator and load Juice into the expiry tool. Its stock, cost and real days-until-expiry are pulled from inventory and the at-risk cost is recomputed live — the same rules you just saw, expressed as arithmetic.

**Suppliers and demand (2 extra minutes).** Open **Suppliers** → FreshPastures Dairy to show contact details, lead time and the linked Milk product. Then open **Demand Analytics**, pick a 30-day window and show that Milk and Bread are best sellers from recorded transactions while a newly added product without sales is labelled “Not enough history” — not zero demand. Click any row for the reasons behind the classification. Use *Load sample history* if the shop has no sales yet; the banner makes clear those rows are demo data.

Reset between demos with **Settings → Reset demo data** (or the profile menu). It restores products, thresholds, reviews and notifications.

---

## Accessibility and UX notes

- Semantic landmarks, skip link, labelled inputs, `<table>` headers with scopes, `aria-current` navigation and visible focus rings.
- Dialogs and drawers use `role="dialog"`, `aria-modal`, initial focus, Escape to close, focus trapping and focus restoration; body scroll is locked.
- Status is always communicated with text/icon as well as colour.
- Bottom navigation and slide-out navigation on mobile; compact icon rail on tablet; full sidebar on desktop.
- Toasts use an `aria-live` status region. Reduced-motion preferences disable animation.
- Numeric inputs use tabular figures, prevent wheel-driven value changes and validate inline.

## Honest limitations

- **POS payments are recorded, not processed.** No payment gateway, card terminal or UPI integration exists, so the method chosen at checkout is a cashier confirmation. Card numbers, CVVs and PINs are never requested, stored or logged.
- **No refunds or returns.** A completed sale cannot be cancelled through the UI or API. Reversing a sale requires a separate return transaction that restocks only resellable goods, which is not implemented — so the sales ledger is append-only.
- **No offline selling.** Stockora is an online web app: a lost connection shows a retryable error and blocks the sale rather than queueing it locally. A reliable offline queue with unique IDs, secure storage and server-side conflict resolution is documented future work, not a shipped feature.
- **No batch/lot tracking.** Expiry is recorded per product, so a sale deducts from that product's single stock figure and refuses expired products outright; FEFO across several batches with different expiry dates is not modelled.
- **Camera scanning needs a secure context** (HTTPS or localhost) and a supporting browser; permission denial and unsupported devices are handled with a message and manual entry stays available. USB/Bluetooth keyboard-wedge scanners need no driver, and no proprietary scanner SDK or electronic cash register is integrated.
- No accounting or supplier-system integration is connected, and no purchase order is created or sent automatically. Demand analytics now receive POS sales, but a shop that only transcribes sales by CSV still has no live feed, and Stockora never invents transactions to fill the gap.
- Demand labels describe recorded transactions only. A shop that has not recorded sales sees “not enough history”, not a demand verdict; recommendations are advisory and never change stock, prices or purchase orders.
- Email delivery is not configured. Invitation and password-reset links rely on the development link exposed when `DEV_LINKS=true`; production needs an email provider. Until then the supported recovery path is an administrator setting the password from the client page.
- Email verification and multi-factor authentication are not implemented; there is no self-service registration, so accounts exist only through an administrator invitation or deployment-time seeding.
- Supplier contacts are stored for reference and are not emailed or used to send orders automatically.
- Expiry dates are recorded inventory data, not a food-safety guarantee. The app directs expired stock to removal/disposal and never claims it is safe to sell.
- Reorder quantities are suggestions based only on demand, lead time and the configured buffer; supplier constraints, shelf life and promotions are not modelled.
- Stock value is an estimate from optional unit costs; missing costs reduce the reported total.
- The demo impact comparison is a controlled six-product acceptance test, not evidence of real-world waste or revenue outcomes. No such claims are made.
- The camera scanning library is lazy-loaded, but Recharts still ships in the main chunk (Vite reports a >500 kB chunk warning); this does not affect functionality.
- The Business Calculator is rule-based arithmetic on numbers you enter or data you have recorded. Its growth and forecast tools are not a trained model, and no market, supplier or benchmark feed is connected.
- Currency conversion is deliberately not offered: no exchange-rate source is configured, so no rate is displayed or estimated.
- GST tools use the rate you type. Rates differ by product, and nothing in the calculator is tax advice.
- Money totals in the live panel are lower bounds when products lack a cost or a price; the missing-input count is always shown next to the total.
- No purchase order is created, approved or sent anywhere by this module, and no supplier email address is used.
