/**
 * Stockora backend acceptance tests.
 *
 * Runs real HTTP checks against the local Worker (wrangler dev on :8787).
 * Covers acceptance tests 2–8 and 10 from the enhancement brief:
 * admin/client separation, feature permissions, live revocation, tenant
 * isolation, password security, suspension, audit logging and failure
 * handling. Requires the server: `npm run dev:server`.
 *
 * Usage: npm run api:test
 */

const BASE = process.env.STOCKORA_API ?? 'http://127.0.0.1:8787';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@stockora.dev';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'StockoraAdmin!2026';
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@freshmart.dev';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'StockoraShop!2026';

const TEMP_RESET_PASSWORD = 'TempResetPass!2026x';
/** Used by the administrator-set-password test, then restored to OWNER_PASSWORD. */
const ADMIN_SET_PASSWORD = 'AdminSetPassphrase!2026';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(method, path, { body, cookie, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origin !== undefined) headers.Origin = origin;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, json: null, text: '', headers: new Headers(), session: null, error: String(error) };
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const setCookie = res.headers.get('set-cookie') ?? '';
  const sessionMatch = /stockora_session=([^;]+)/.exec(setCookie);
  return {
    status: res.status,
    json,
    text,
    headers: res.headers,
    session: sessionMatch ? `stockora_session=${sessionMatch[1]}` : null,
  };
}

/**
 * The full feature set is read from the server catalogue at run time. A
 * hardcoded list would silently disable every feature added after it was
 * written, because the permissions API takes the complete intended selection.
 */
let FULL_ACCESS = [];

async function loadFullAccess(cookie) {
  const catalogue = await req('GET', '/api/admin/plans', { cookie });
  const features = catalogue.json?.catalog ?? [];
  FULL_ACCESS = features.filter((feature) => feature.globallyEnabled).map((feature) => feature.id);
  return FULL_ACCESS;
}

async function main() {
  console.log(`Stockora API acceptance tests → ${BASE}\n`);

  const health = await req('GET', '/api/auth/session');
  if (health.status === 0) {
    console.error(`Cannot reach ${BASE}. Start the Worker with: npm run dev:server`);
    process.exit(2);
  }

  // ---------- Test 2: admin/client separation ----------
  console.log('\n[2] Admin/client separation');
  check('anonymous session is rejected', (await req('GET', '/api/auth/session')).status === 401);
  check(
    'anonymous state read is rejected',
    (await req('GET', '/api/state')).status === 401,
  );

  const badLogin = await req('POST', '/api/auth/login', {
    body: { email: OWNER_EMAIL, password: 'definitely-wrong-123' },
  });
  check('invalid credentials return 401 with a generic message',
    badLogin.status === 401 && /invalid email or password/i.test(badLogin.json?.message ?? ''),
    `status ${badLogin.status}`);

  const ownerLogin = await req('POST', '/api/auth/login', {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  check('valid client credentials sign in', ownerLogin.status === 200 && Boolean(ownerLogin.session));
  check('client session landing is a client route', ownerLogin.json?.landing === '/' || ownerLogin.json?.landing === '/settings',
    `landing=${ownerLogin.json?.landing}`);
  const ownerCookie = ownerLogin.session;

  const adminLogin = await req('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  check('administrator signs in', adminLogin.status === 200 && Boolean(adminLogin.session));
  const adminCookie = adminLogin.session;

  const catalogue = await loadFullAccess(adminCookie);
  check(
    'the server exposes its full feature catalogue',
    catalogue.length >= 9 && catalogue.includes('business_calculator'),
    `catalogue: ${catalogue.join(', ')}`,
  );

  check('client cannot call admin metrics API',
    (await req('GET', '/api/admin/metrics', { cookie: ownerCookie })).status === 403);
  check('client cannot call admin clients API',
    (await req('GET', '/api/admin/clients', { cookie: ownerCookie })).status === 403);
  check('client cannot change feature permissions',
    (await req('PUT', '/api/admin/clients/x/features', { cookie: ownerCookie, body: { selection: [] } })).status === 403);
  check('administrator cannot reach protected API anonymously',
    (await req('GET', '/api/admin/metrics')).status === 401);

  // ---------- Seed state + Test 1 sanity ----------
  console.log('\n[1] Seed data via API');
  const state = await req('GET', '/api/state', { cookie: ownerCookie });
  check('client state loads', state.status === 200 && Array.isArray(state.json?.products));
  const products = state.json?.products ?? [];
  // The demo organisation is a real workspace: products added through the UI or
  // imported from CSV legitimately remain. Assert the seeded dataset is intact
  // rather than that nobody has ever added anything.
  const SEEDED_SKUS = ['R101', 'R102', 'R103', 'R104', 'R105', 'R106'];
  const seededProducts = products.filter((product) => SEEDED_SKUS.includes(product.sku));
  check(
    'all six seeded products are present',
    seededProducts.length === 6,
    `found ${seededProducts.length} of 6 (${products.length} products in total)`,
  );
  const milk = products.find((p) => p.sku === 'R101');
  check('Milk 1L seed values', milk?.currentStock === 8 && milk?.reorderLevel === 10 && milk?.averageDailySales === 12);
  // Products stored before the optional selling price existed must still load.
  check(
    'optional selling price never corrupts a stored product',
    products.every(
      (product) =>
        product.sellingPrice === undefined ||
        product.sellingPrice === null ||
        (typeof product.sellingPrice === 'number' && Number.isFinite(product.sellingPrice) && product.sellingPrice >= 0),
    ),
  );

  // Round-trip the optional selling price through the real API.
  {
    const probe = {
      sku: 'R899',
      name: 'Selling Price Probe',
      category: 'Test',
      currentStock: 4,
      reorderLevel: 1,
      averageDailySales: 1,
      leadTimeDays: 1,
      expiryDate: null,
      unitCost: 10,
      sellingPrice: 12.5,
      id: 'price-probe-r899',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const written = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { products: [...products, probe] },
    });
    const readBack = await req('GET', '/api/state', { cookie: ownerCookie });
    const storedProbe = (readBack.json?.products ?? []).find((p) => p.sku === 'R899');
    check(
      'selling price round-trips through the API',
      written.status === 200 && storedProbe?.sellingPrice === 12.5,
      `status ${written.status}, sellingPrice ${storedProbe?.sellingPrice}`,
    );

    const negativePrice = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { products: [...products, { ...probe, sellingPrice: -3 }] },
    });
    check('negative selling price is rejected server-side', negativePrice.status === 400, `status ${negativePrice.status}`);

    // Leave the workspace exactly as it was found.
    await req('PUT', '/api/state', { cookie: ownerCookie, body: { products } });
  }

  // ---------- Test 5: tenant isolation ----------
  console.log('\n[5] Tenant isolation (two organisations)');
  const createB = await req('POST', '/api/admin/clients', {
    cookie: adminCookie,
    body: {
      organizationName: 'Beta Grocers Test',
      ownerName: 'Beta Owner',
      email: 'beta-owner@stockora.dev',
      planId: 'premium',
    },
  });
  check('admin can invite a second client',
    createB.status === 201 || createB.status === 409,
    `status ${createB.status}: ${createB.json?.message ?? ''}`);

  let betaCookie = null;
  if (createB.status === 201 && createB.json?.setupLink) {
    const token = createB.json.setupLink.split('/invite/')[1];
    const accept = await req('POST', '/api/auth/invite/accept', {
      body: { token, password: 'BetaShopPass!2026', displayName: 'Beta Owner' },
    });
    check('invitation acceptance creates the account and signs in',
      accept.status === 200 && Boolean(accept.session),
      `status ${accept.status}: ${accept.json?.message ?? ''}`);
    betaCookie = accept.session;
  } else {
    const betaLogin = await req('POST', '/api/auth/login', {
      body: { email: 'beta-owner@stockora.dev', password: 'BetaShopPass!2026' },
    });
    betaCookie = betaLogin.session;
    check('second client signs in on re-run', Boolean(betaCookie));
  }

  if (ownerCookie && betaCookie) {
    // A writes a product; B must never see it.
    const beforeA = await req('GET', '/api/state', { cookie: ownerCookie });
    const aProducts = [...(beforeA.json?.products ?? [])];
    aProducts.push({
      sku: 'R900',
      name: 'Isolation Probe Product',
      category: 'Test',
      currentStock: 5,
      reorderLevel: 1,
      averageDailySales: 1,
      leadTimeDays: 1,
      expiryDate: null,
      unitCost: null,
      id: 'iso-probe-r900',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const writeA = await req('PUT', '/api/state', { cookie: ownerCookie, body: { products: aProducts } });
    check('organisation A can write its own state', writeA.status === 200, `status ${writeA.status}`);

    const stateB = await req('GET', '/api/state', { cookie: betaCookie });
    const bSkus = (stateB.json?.products ?? []).map((p) => p.sku);
    check('organisation B does not see A’s product', !bSkus.includes('R900'), `B skus: ${bSkus.join(',')}`);

    // B writes its own state; A must be unaffected.
    const bProducts = [...(stateB.json?.products ?? [])];
    bProducts[0] = { ...bProducts[0], currentStock: 3 };
    await req('PUT', '/api/state', { cookie: betaCookie, body: { products: bProducts } });
    const stateA2 = await req('GET', '/api/state', { cookie: ownerCookie });
    const aMilk = (stateA2.json?.products ?? []).find((p) => p.sku === 'R101');
    check('A’s data unchanged by B’s write', aMilk?.currentStock === 8, `A milk=${aMilk?.currentStock}`);

    // Restore A’s original product list.
    await req('PUT', '/api/state', { cookie: ownerCookie, body: { products: beforeA.json.products } });
  }

  // ---------- Test 3 + 4: feature permissions & live revocation ----------
  console.log('\n[3/4] Feature permissions and live revocation');
  const adminOrgs = await req('GET', '/api/admin/clients?pageSize=100', { cookie: adminCookie });
  const orgA = (adminOrgs.json?.clients ?? []).find((c) => c.ownerEmail === OWNER_EMAIL)
    ?? (adminOrgs.json?.clients ?? [])[0];
  check('admin can list clients', Boolean(orgA), 'no client found');

  if (orgA) {
    const restricted = ['dashboard', 'notifications'];
    const restrict = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: restricted },
    });
    check('admin can restrict a client to dashboard-only',
      restrict.status === 200 && restrict.json?.changed?.length > 0,
      `status ${restrict.status}: ${restrict.json?.message ?? ''}`);

    // Same signed-in session, new restrictions:
    const writeAfter = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { products: state.json.products },
    });
    check('inventory writes are rejected while Inventory is disabled',
      writeAfter.status === 403 && writeAfter.json?.code === 'feature_disabled',
      `status ${writeAfter.status} code=${writeAfter.json?.code}`);
    check('state read still works with Dashboard enabled (read-only access)',
      (await req('GET', '/api/state', { cookie: ownerCookie })).status === 200);
    const exportAfter = await req('POST', '/api/state/export', {
      cookie: ownerCookie,
      body: { table: { headers: ['SKU'], rows: [['R101']] }, filename: 'probe' },
    });
    check('CSV export is rejected when CSV Export is disabled',
      exportAfter.status === 403 && exportAfter.json?.feature === 'csv_export',
      `status ${exportAfter.status}`);
    const importAfter = await req('POST', '/api/state/import', {
      cookie: ownerCookie,
      body: { text: 'sku,name,category,currentstock,reorderlevel,averagedailysales,leadtimedays\nR1,Test,Test,1,1,1,1', replaceExisting: false },
    });
    check('CSV import is rejected when CSV Import is disabled',
      importAfter.status === 403 && importAfter.json?.feature === 'csv_import',
      `status ${importAfter.status}`);
    const settingsAfter = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { settings: { ...state.json.settings } },
    });
    check('unrelated settings writes still work while Inventory is off',
      settingsAfter.status === 200,
      `status ${settingsAfter.status}`);

    // Invalid configuration: dependent feature without inventory.
    const invalid = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: ['action_center'] },
    });
    check('dependent features without inventory are rejected',
      invalid.status === 400 && invalid.json?.code === 'invalid_selection',
      `status ${invalid.status}`);

    // Restore full access.
    const restore = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS },
    });
    check('admin restores full feature access',
      restore.status === 200 && restore.json?.effectiveCount === FULL_ACCESS.length,
      `effectiveCount=${restore.json?.effectiveCount}`);
    const writeRestored = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { products: state.json.products },
    });
    check('inventory writes work again after re-grant (same session)',
      writeRestored.status === 200,
      `status ${writeRestored.status}`);

    // ---------- Suppliers & sales history ----------
    console.log('\n[2b] Supplier directory and sales history');
    const beforeSection = await req('GET', '/api/state', { cookie: ownerCookie });
    const originalSuppliers = beforeSection.json?.suppliers ?? [];
    const originalProducts = beforeSection.json?.products ?? [];
    const stamp = new Date().toISOString();
    const supplierProbe = {
      id: 'api-test-supplier',
      name: 'API Test Supplier',
      contactName: 'QA Contact',
      email: 'qa@supplier.example',
      phone: '+91 90000 00000',
      address: 'Test warehouse',
      leadTimeDays: 2,
      paymentTerms: 'Net 10',
      notes: '',
      active: true,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const addSupplier = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { suppliers: [...originalSuppliers, supplierProbe] },
    });
    check('a supplier can be created', addSupplier.status === 200, `status ${addSupplier.status}: ${addSupplier.json?.message ?? ''}`);
    const readSupplier = await req('GET', '/api/state', { cookie: ownerCookie });
    check(
      'the supplier round-trips with contact details',
      (readSupplier.json?.suppliers ?? []).some(
        (supplier) => supplier.id === supplierProbe.id && supplier.email === supplierProbe.email,
      ),
    );
    const badSupplier = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { suppliers: [...originalSuppliers, { ...supplierProbe, email: 'not-an-email' }] },
    });
    check('an invalid supplier email is rejected server-side',
      badSupplier.status === 400 && badSupplier.json?.code === 'validation',
      `status ${badSupplier.status}`);
    const duplicateSupplier = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: {
        suppliers: [
          ...originalSuppliers,
          supplierProbe,
          { ...supplierProbe, id: 'api-test-supplier-2', name: 'API Test Supplier' },
        ],
      },
    });
    check('duplicate supplier names are rejected',
      duplicateSupplier.status === 400,
      `status ${duplicateSupplier.status}`);

    // Feature gate: suppliers off must block supplier writes but not reads.
    const withoutSuppliers = FULL_ACCESS.filter((id) => id !== 'suppliers');
    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: withoutSuppliers },
    });
    const supplierDenied = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { suppliers: [...originalSuppliers, supplierProbe] },
    });
    check('supplier writes are rejected when the feature is disabled',
      supplierDenied.status === 403 && supplierDenied.json?.code === 'feature_disabled',
      `status ${supplierDenied.status} code=${supplierDenied.json?.code}`);
    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS },
    });
    const removeSupplier = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { suppliers: originalSuppliers },
    });
    check('the supplier can be removed again (products and other suppliers untouched)',
      removeSupplier.status === 200 &&
        ((await req('GET', '/api/state', { cookie: ownerCookie })).json?.suppliers ?? []).length ===
          originalSuppliers.length,
      `status ${removeSupplier.status}`);

    const day = (offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    // A throwaway product keeps the probe sales out of real demand analytics:
    // orphaned lines for a product that no longer exists are ignored.
    const probeProduct = {
      sku: 'R898',
      name: 'Demand Probe Product',
      category: 'Test',
      currentStock: 10,
      reorderLevel: 2,
      averageDailySales: 1,
      leadTimeDays: 2,
      expiryDate: null,
      id: 'api-test-demand-probe',
      createdAt: stamp,
      updatedAt: stamp,
    };
    const addProbe = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { products: [...originalProducts, probeProduct] },
    });
    check('a probe product is available for the sales test', addProbe.status === 200, `status ${addProbe.status}`);
    // Unique quantities per run keep the fixture repeatable without colliding
    // with lines a previous run already stored.
    const qtyBase = 1 + (Date.now() % 400) / 100;
    const salesCsv = `date,sku,quantity,unit_price\n${day(-2)},R898,${qtyBase},25\n${day(-1)},R898,${qtyBase + 1},25`;
    const firstImport = await req('POST', '/api/state/sales/import', {
      cookie: ownerCookie,
      body: { text: salesCsv, demo: true },
    });
    check('sales history can be imported',
      firstImport.status === 200 && firstImport.json?.added === 2,
      `status ${firstImport.status} added=${firstImport.json?.added}`);
    check('importing sales sets the tracking start date', Boolean(firstImport.json?.trackingSince));
    const secondImport = await req('POST', '/api/state/sales/import', {
      cookie: ownerCookie,
      body: { text: salesCsv, demo: true },
    });
    check('re-importing the same file skips duplicates instead of doubling demand',
      secondImport.status === 200 &&
        secondImport.json?.added === 0 &&
        secondImport.json?.skippedDuplicates === 2,
      `added=${secondImport.json?.added} duplicates=${secondImport.json?.skippedDuplicates}`);
    const salesState = await req('GET', '/api/state', { cookie: ownerCookie });
    check(
      'imported sales are labelled as demo data',
      (salesState.json?.sales ?? []).some((sale) => sale.source === 'demo'),
    );
    const unknownSku = await req('POST', '/api/state/sales/import', {
      cookie: ownerCookie,
      body: { text: `date,sku,quantity\n${day(-1)},NOPE,4` },
    });
    check('a sales row for an unknown SKU is rejected with a row error',
      unknownSku.status === 400 &&
        unknownSku.json?.code === 'no_valid_rows' &&
        String(unknownSku.json?.summary?.errors?.[0]?.message ?? '').includes('No product'),
      `status ${unknownSku.status}`);
    const futureSale = await req('POST', '/api/state/sales/import', {
      cookie: ownerCookie,
      body: { text: `date,sku,quantity\n${day(3)},R101,2` },
    });
    check('future-dated sales are rejected', futureSale.status === 400, `status ${futureSale.status}`);
    const salesViaPut = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { sales: [] },
    });
    check('sales history cannot be rewritten through the state endpoint',
      salesViaPut.status === 400 && salesViaPut.json?.code === 'immutable_history',
      `status ${salesViaPut.status}`);

    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS.filter((id) => id !== 'demand_analytics') },
    });
    const salesDenied = await req('POST', '/api/state/sales/import', {
      cookie: ownerCookie,
      body: { text: salesCsv },
    });
    check('sales imports are rejected when Demand Analytics is disabled',
      salesDenied.status === 403 && salesDenied.json?.feature === 'demand_analytics',
      `status ${salesDenied.status} code=${salesDenied.json?.code}`);
    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS },
    });
    const removeProbe = await req('PUT', '/api/state', {
      cookie: ownerCookie,
      body: { products: originalProducts },
    });
    check('the probe product is cleaned up after the sales test',
      removeProbe.status === 200 &&
        ((await req('GET', '/api/state', { cookie: ownerCookie })).json?.products ?? []).length ===
          originalProducts.length,
      `status ${removeProbe.status}`);

    // ---------- Test 7: suspension ----------
    console.log('\n[7] Account suspension');
    const suspend = await req('PATCH', `/api/admin/clients/${orgA.id}`, {
      cookie: adminCookie,
      body: { status: 'suspended' },
    });
    check('admin can suspend a client', suspend.status === 200, `status ${suspend.status}`);
    const suspendedState = await req('GET', '/api/state', { cookie: ownerCookie });
    check(
      'existing session is rejected immediately after suspension',
      (suspendedState.status === 403 && suspendedState.json?.code === 'account_suspended') ||
        (suspendedState.status === 401 && suspendedState.json?.code === 'unauthenticated'),
      `status ${suspendedState.status} code=${suspendedState.json?.code}`,
    );
    const suspendedLogin = await req('POST', '/api/auth/login', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    check('suspended account cannot sign in',
      suspendedLogin.status === 403 && suspendedLogin.json?.code === 'account_suspended',
      `status ${suspendedLogin.status}`);

    const reactivate = await req('PATCH', `/api/admin/clients/${orgA.id}`, {
      cookie: adminCookie,
      body: { status: 'active' },
    });
    check('admin can reactivate a client', reactivate.status === 200, `status ${reactivate.status}`);
    const reactivateLogin = await req('POST', '/api/auth/login', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    check('reactivated account signs in with its original password',
      reactivateLogin.status === 200,
      `status ${reactivateLogin.status}`);
    const restoredCookie = reactivateLogin.session ?? ownerCookie;
    const retained = await req('GET', '/api/state', { cookie: restoredCookie });
    check('inventory survived suspension (nothing deleted)',
      retained.status === 200 && (retained.json?.products?.length ?? 0) >= 6,
      `products=${retained.json?.products?.length}`);

    // ---------- Validation & CSV (Tests 10 + export/import subset) ----------
    console.log('\n[10] Validation, CSV and failure handling');
    const negative = await req('PUT', '/api/state', {
      cookie: restoredCookie,
      body: {
        products: [
          {
            sku: 'R777',
            name: 'Negative Stock',
            category: 'Test',
            currentStock: -5,
            reorderLevel: 1,
            averageDailySales: 1,
            leadTimeDays: 1,
            expiryDate: null,
            id: 'neg-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    check('negative stock is rejected server-side', negative.status === 400, `status ${negative.status}`);

    const exportOk = await req('POST', '/api/state/export', {
      cookie: restoredCookie,
      body: { table: { headers: ['SKU', 'Name'], rows: [['R101', 'Milk 1L']] }, filename: 'probe-export' },
    });
    check('CSV export succeeds when the feature is enabled',
      exportOk.status === 200 && (exportOk.headers.get('content-type') ?? '').includes('text/csv'),
      `status ${exportOk.status}`);
    check('CSV export sets a download filename',
      (exportOk.headers.get('content-disposition') ?? '').includes('filename="probe-export.csv"'));

    const importOk = await req('POST', '/api/state/import', {
      cookie: restoredCookie,
      body: {
        text: 'sku,name,category,currentstock,reorderlevel,averagedailysales,leadtimedays\nR880,API Imported,Test,12,4,2,3',
        replaceExisting: false,
      },
    });
    check('CSV import succeeds when the feature is enabled',
      importOk.status === 200 && importOk.json?.added === 1,
      `status ${importOk.status}: ${importOk.json?.message ?? ''}`);
    // Remove the imported probe product to leave seed data intact.
    const afterImport = await req('GET', '/api/state', { cookie: restoredCookie });
    const cleaned = (afterImport.json?.products ?? []).filter((p) => p.sku !== 'R880');
    if (cleaned.length !== (afterImport.json?.products ?? []).length) {
      await req('PUT', '/api/state', { cookie: restoredCookie, body: { products: cleaned } });
    }

    const badImport = await req('POST', '/api/state/import', {
      cookie: restoredCookie,
      body: { text: 'wrong,columns,here\n1,2,3', replaceExisting: false },
    });
    check('malformed CSV reports a specific error',
      badImport.status === 400 && typeof badImport.json?.message === 'string',
      `status ${badImport.status}`);

    check('unknown API routes return 404 JSON',
      (await req('GET', '/api/definitely-not-a-route')).status === 404);
    check('missing admin client returns 404',
      (await req('GET', '/api/admin/clients/nope', { cookie: adminCookie })).status === 404);

    const evilOrigin = await req('POST', '/api/auth/logout', {
      cookie: restoredCookie,
      origin: 'https://evil.example',
    });
    check('state-changing request from a foreign origin is rejected (CSRF)',
      evilOrigin.status === 403 && evilOrigin.json?.code === 'origin_denied',
      `status ${evilOrigin.status}`);
  }

  // ---------- Test 6: password security ----------
  console.log('\n[6] Password security');
  const ownerLogin2 = await req('POST', '/api/auth/login', {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  const owner2 = ownerLogin2.session;

  const forgot = await req('POST', '/api/auth/forgot', { body: { email: OWNER_EMAIL } });
  check('forgot-password returns a generic confirmation',
    forgot.status === 200 && typeof forgot.json?.message === 'string');
  check('development reset link is exposed (no email provider configured)',
    typeof forgot.json?.devResetLink === 'string' && forgot.json.devResetLink.includes('/reset-password/'),
    'enable DEV_LINKS on the Worker');
  const resetToken = forgot.json?.devResetLink?.split('/reset-password/')[1];

  if (resetToken) {
    const weakReset = await req('POST', '/api/auth/reset', {
      body: { token: resetToken, password: 'short' },
    });
    check('weak password is rejected by the reset flow',
      weakReset.status === 400 && weakReset.json?.code === 'weak_password',
      `status ${weakReset.status}`);
    const reset = await req('POST', '/api/auth/reset', {
      body: { token: resetToken, password: TEMP_RESET_PASSWORD },
    });
    check('reset token sets the new password', reset.status === 200, `status ${reset.status}: ${reset.json?.message ?? ''}`);

    const reuse = await req('POST', '/api/auth/reset', {
      body: { token: resetToken, password: 'AnotherPassphrase!2026' },
    });
    check('reset token is single-use', reuse.status === 400, `status ${reuse.status}`);

    const oldPw = await req('POST', '/api/auth/login', {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    check('old password no longer works after reset', oldPw.status === 401, `status ${oldPw.status}`);
    const newPw = await req('POST', '/api/auth/login', {
      body: { email: OWNER_EMAIL, password: TEMP_RESET_PASSWORD },
    });
    check('new password signs in', newPw.status === 200, `status ${newPw.status}`);
    check('sessions issued before the reset are revoked',
      (await req('GET', '/api/state', { cookie: owner2 })).status === 401,
      'pre-reset session still valid');

    const changeWrong = await req('POST', '/api/auth/change-password', {
      cookie: newPw.session,
      body: { currentPassword: 'not-the-password', newPassword: 'DifferentPassphrase!2026' },
    });
    check('change-password requires the correct current password',
      changeWrong.status === 400 && changeWrong.json?.code === 'invalid_current',
      `status ${changeWrong.status}`);

    const changeWeak = await req('POST', '/api/auth/change-password', {
      cookie: newPw.session,
      body: { currentPassword: TEMP_RESET_PASSWORD, newPassword: 'abc' },
    });
    check('change-password enforces the policy',
      changeWeak.status === 400 && changeWeak.json?.code === 'weak_password',
      `status ${changeWeak.status}`);

    // Restore the documented seed password so the dev DB matches the README.
    const changeBack = await req('POST', '/api/auth/change-password', {
      cookie: newPw.session,
      body: { currentPassword: TEMP_RESET_PASSWORD, newPassword: OWNER_PASSWORD },
    });
    check('password restored to the documented seed value after tests',
      changeBack.status === 200,
      `status ${changeBack.status}: ${changeBack.json?.message ?? ''}`);
  }

  // Rate limiting on a throwaway address (never exists, never locked for real users).
  console.log('\n[6b] Login rate limiting');
  let sawLimit = false;
  for (let attempt = 0; attempt < 7 && !sawLimit; attempt += 1) {
    const probe = await req('POST', '/api/auth/login', {
      body: { email: 'ratelimit-probe@stockora.dev', password: `wrong-${attempt}` },
    });
    if (probe.status === 429) sawLimit = true;
  }
  check('repeated failed logins are rate limited (429)', sawLimit, 'no lockout after 7 attempts');

  // ---------- Test 5b: per-action permissions ----------
  console.log('\n[5b] Per-action permissions');
  const ownerAction = await req('POST', '/api/auth/login', {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  const actionCookie = ownerAction.session;

  if (orgA) {
    const denyDelete = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: {
        selection: FULL_ACCESS,
        actions: { inventory: { view: true, create: true, edit: true, delete: false } },
      },
    });
    const inventoryRow = denyDelete.json?.features?.find((f) => f.id === 'inventory');
    check('admin can deny one action while the feature stays enabled',
      denyDelete.status === 200 && inventoryRow?.effective === true && inventoryRow?.actions?.delete === false,
      `status ${denyDelete.status} delete=${inventoryRow?.actions?.delete}`);

    const deniedSession = await req('GET', '/api/auth/session', { cookie: actionCookie });
    check('the client session reports the narrowed action immediately',
      deniedSession.json?.actions?.inventory?.delete === false &&
        deniedSession.json?.actions?.inventory?.edit === true,
      JSON.stringify(deniedSession.json?.actions?.inventory ?? null));

    const beforeDelete = await req('GET', '/api/state', { cookie: actionCookie });
    const currentProducts = beforeDelete.json?.products ?? [];
    const deleteAttempt = await req('PUT', '/api/state', {
      cookie: actionCookie,
      body: { products: currentProducts.slice(0, -1) },
    });
    check('deleting a product is rejected by the server when delete is denied',
      deleteAttempt.status === 403 && deleteAttempt.json?.code === 'action_denied',
      `status ${deleteAttempt.status} code=${deleteAttempt.json?.code}`);

    const editAttempt = await req('PUT', '/api/state', {
      cookie: actionCookie,
      body: {
        products: currentProducts.map((product, index) =>
          index === 0 ? { ...product, currentStock: product.currentStock + 1 } : product,
        ),
      },
    });
    check('editing a product still works when only delete is denied',
      editAttempt.status === 200,
      `status ${editAttempt.status}: ${editAttempt.json?.message ?? ''}`);

    const addAttempt = await req('PUT', '/api/state', {
      cookie: actionCookie,
      body: {
        products: [
          ...currentProducts,
          {
            sku: 'PROBE-ACTION',
            name: 'Action probe',
            category: 'Test',
            currentStock: 1,
            reorderLevel: 0,
            averageDailySales: 0,
            leadTimeDays: 1,
            unitCost: 1,
            expiryDate: null,
          },
        ],
      },
    });
    check('adding a product still works when only delete is denied',
      addAttempt.status === 200,
      `status ${addAttempt.status}: ${addAttempt.json?.message ?? ''}`);

    const denyExport = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: {
        selection: FULL_ACCESS,
        actions: {
          inventory: { view: true, create: true, edit: true, delete: true },
          csv_export: { view: true, export: false },
        },
      },
    });
    check('admin can deny CSV export while the feature stays enabled',
      denyExport.status === 200 &&
        denyExport.json?.features?.find((f) => f.id === 'csv_export')?.effective === true &&
        denyExport.json?.features?.find((f) => f.id === 'csv_export')?.actions?.export === false,
      `status ${denyExport.status}`);

    const exportDenied = await req('POST', '/api/state/export', {
      cookie: actionCookie,
      body: { table: { headers: ['sku'], rows: [['R101']] }, filename: 'probe' },
    });
    check('CSV export is rejected when the export action is denied',
      exportDenied.status === 403 && exportDenied.json?.code === 'action_denied',
      `status ${exportDenied.status} code=${exportDenied.json?.code}`);

    const viewDenied = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: {
        selection: FULL_ACCESS,
        actions: {
          inventory: { view: false },
          csv_export: { view: true, export: true },
        },
      },
    });
    const viewRow = viewDenied.json?.features?.find((f) => f.id === 'inventory');
    const viewBlocked = await req('PUT', '/api/state', {
      cookie: actionCookie,
      body: { products: currentProducts },
    });
    check('denying View closes the whole feature server-side',
      viewDenied.status === 200 &&
        viewRow?.actions?.view === false &&
        viewBlocked.status === 403 &&
        viewBlocked.json?.code === 'action_denied',
      `view=${viewRow?.actions?.view} write status=${viewBlocked.status}`);

    const unknownAction = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS, actions: { inventory: { teleport: true } } },
    });
    check('actions the feature does not perform are rejected',
      unknownAction.status === 400 && unknownAction.json?.code === 'validation',
      `status ${unknownAction.status}`);

    const partialWipe = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: {
        selection: FULL_ACCESS,
        actions: { csv_export: { view: true, export: true } },
      },
    });
    const inventoryAfterPartial = partialWipe.json?.features?.find((f) => f.id === 'inventory');
    check('a partial update does not clear another feature\u2019s restrictions',
      partialWipe.status === 200 && inventoryAfterPartial?.actions?.view === false,
      `inventory view=${inventoryAfterPartial?.actions?.view}`);

    const restoreActions = await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: {
        selection: FULL_ACCESS,
        actions: {
          inventory: { view: true, create: true, edit: true, delete: true },
          csv_export: { view: true, export: true },
        },
      },
    });
    const restoredInventory = restoreActions.json?.features?.find((f) => f.id === 'inventory');
    const restoredExport = restoreActions.json?.features?.find((f) => f.id === 'csv_export');
    check('actions can be restored to allowed',
      restoreActions.status === 200 &&
        restoredInventory?.actions?.delete === true &&
        restoredExport?.actions?.export === true,
      `delete=${restoredInventory?.actions?.delete} export=${restoredExport?.actions?.export}`);

    const exportAgain = await req('POST', '/api/state/export', {
      cookie: actionCookie,
      body: { table: { headers: ['sku'], rows: [['R101']] }, filename: 'probe' },
    });
    check('CSV export works again once the permission is restored',
      exportAgain.status === 200 && (exportAgain.text ?? '').includes('R101'),
      `status ${exportAgain.status}`);

    // Leave the workspace exactly as it was: no probe product, no overrides.
    const finalState = await req('GET', '/api/state', { cookie: actionCookie });
    const cleaned = (finalState.json?.products ?? []).filter((p) => p.sku !== 'PROBE-ACTION');
    if (cleaned.length !== (finalState.json?.products ?? []).length) {
      await req('PUT', '/api/state', { cookie: actionCookie, body: { products: cleaned } });
    }
    // Belt and braces: clear any action override this section may have left.
    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: {
        selection: FULL_ACCESS,
        actions: {
          inventory: { view: true, create: true, edit: true, delete: true },
          csv_export: { view: true, export: true },
          reports: { view: true, export: true },
        },
      },
    });
  } else {
    check('per-action permissions section ran', false, 'no client organisation found');
  }

  // ---------- Test 6c: administrator-controlled password policy ----------
  console.log('\n[6c] Client password-change policy');
  const policyOwner = await req('POST', '/api/auth/login', {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  const policyCookie = policyOwner.session;

  const denyGlobally = await req('PUT', '/api/admin/security-policy', {
    cookie: adminCookie,
    body: { allowClientPasswordChange: false },
  });
  check('administrator can disable self-service password changes globally',
    denyGlobally.status === 200 && denyGlobally.json?.allowClientPasswordChange === false,
    `status ${denyGlobally.status}`);

  const blockedChange = await req('POST', '/api/auth/change-password', {
    cookie: policyCookie,
    body: { currentPassword: 'wrong-on-purpose', newPassword: 'AnotherValidPass!2026' },
  });
  check('blocked client cannot change password through the API',
    blockedChange.status === 403 && blockedChange.json?.code === 'password_change_disabled',
    `status ${blockedChange.status} code=${blockedChange.json?.code}`);

  const blockedSession = await req('GET', '/api/auth/session', { cookie: policyCookie });
  check('session payload reports the password policy',
    blockedSession.json?.canChangePassword === false,
    `canChangePassword=${blockedSession.json?.canChangePassword}`);

  if (orgA) {
    const overrideAllow = await req('PUT', `/api/admin/clients/${orgA.id}/password-policy`, {
      cookie: adminCookie,
      body: { policy: 'allow' },
    });
    check('administrator can grant a per-client exception',
      overrideAllow.status === 200 && overrideAllow.json?.effective === true,
      `status ${overrideAllow.status}: ${overrideAllow.json?.message ?? ''}`);

    const allowedChange = await req('POST', '/api/auth/change-password', {
      cookie: policyCookie,
      body: { currentPassword: 'wrong-on-purpose', newPassword: 'AnotherValidPass!2026' },
    });
    check('per-client override beats the global policy',
      allowedChange.status === 400 && allowedChange.json?.code === 'invalid_current',
      `status ${allowedChange.status} code=${allowedChange.json?.code}`);

    const overrideDeny = await req('PUT', `/api/admin/clients/${orgA.id}/password-policy`, {
      cookie: adminCookie,
      body: { policy: 'deny' },
    });
    const denyOverrideChange = await req('POST', '/api/auth/change-password', {
      cookie: policyCookie,
      body: { currentPassword: 'wrong-on-purpose', newPassword: 'AnotherValidPass!2026' },
    });
    check('a per-client deny blocks even when the global policy allows',
      overrideDeny.status === 200 && denyOverrideChange.status === 403 &&
        denyOverrideChange.json?.code === 'password_change_disabled',
      `policy=${overrideDeny.status} change=${denyOverrideChange.status}`);

    const clientCannotSetPolicy = await req('PUT', `/api/admin/clients/${orgA.id}/password-policy`, {
      cookie: policyCookie,
      body: { policy: 'allow' },
    });
    check('client cannot change its own password policy',
      clientCannotSetPolicy.status === 403,
      `status ${clientCannotSetPolicy.status}`);

    const invalidPolicy = await req('PUT', `/api/admin/clients/${orgA.id}/password-policy`, {
      cookie: adminCookie,
      body: { policy: 'sometimes' },
    });
    check('unknown policy values are rejected',
      invalidPolicy.status === 400,
      `status ${invalidPolicy.status}`);

    await req('PUT', `/api/admin/clients/${orgA.id}/password-policy`, {
      cookie: adminCookie,
      body: { policy: 'inherit' },
    });
  }

  const allowGlobally = await req('PUT', '/api/admin/security-policy', {
    cookie: adminCookie,
    body: { allowClientPasswordChange: true },
  });
  check('global password policy restored after the test',
    allowGlobally.status === 200 && allowGlobally.json?.allowClientPasswordChange === true,
    `status ${allowGlobally.status}`);

  const restoredSession = await req('GET', '/api/auth/session', { cookie: policyCookie });
  check('password change allowed again after restoring the policy',
    restoredSession.json?.canChangePassword === true,
    `canChangePassword=${restoredSession.json?.canChangePassword}`);

  // Forgotten-password recovery is a separate workflow and stays available.
  const recoveryAfterBlock = await req('POST', '/api/auth/forgot', { body: { email: OWNER_EMAIL } });
  check('password recovery still works when self-service change is disabled',
    recoveryAfterBlock.status === 200 && typeof recoveryAfterBlock.json?.message === 'string',
    `status ${recoveryAfterBlock.status}`);

  // ---------- Test 6d: administrator sets a client password ----------
  console.log('\n[6d] Administrator sets a client password');
  if (orgA) {
    const detail = await req('GET', `/api/admin/clients/${orgA.id}`, { cookie: adminCookie });
    const ownerMember = (detail.json?.members ?? []).find((m) => m.email === OWNER_EMAIL);
    check('client detail lists the owner account',
      Boolean(ownerMember),
      `emails: ${(detail.json?.members ?? []).map((m) => m.email).join(',')}`);

    if (ownerMember) {
      const weakSet = await req('POST', `/api/admin/clients/${orgA.id}/password`, {
        cookie: adminCookie,
        body: { userId: ownerMember.id, password: 'short' },
      });
      check('weak password is rejected by the admin endpoint',
        weakSet.status === 400 && weakSet.json?.code === 'weak_password',
        `status ${weakSet.status} code=${weakSet.json?.code}`);

      const foreignUser = await req('POST', `/api/admin/clients/${orgA.id}/password`, {
        cookie: adminCookie,
        body: { userId: 'not-a-member', password: ADMIN_SET_PASSWORD },
      });
      check('an account outside the organisation is rejected',
        foreignUser.status === 404,
        `status ${foreignUser.status}`);

      const clientTries = await req('POST', `/api/admin/clients/${orgA.id}/password`, {
        cookie: policyCookie,
        body: { userId: ownerMember.id, password: ADMIN_SET_PASSWORD },
      });
      check('a client cannot use the admin password endpoint',
        clientTries.status === 403,
        `status ${clientTries.status}`);

      const adminSet = await req('POST', `/api/admin/clients/${orgA.id}/password`, {
        cookie: adminCookie,
        body: { userId: ownerMember.id, password: ADMIN_SET_PASSWORD },
      });
      check('administrator can set a client password',
        adminSet.status === 200 && adminSet.json?.ok === true,
        `status ${adminSet.status}: ${adminSet.json?.message ?? ''}`);

      const oldRejected = await req('POST', '/api/auth/login', {
        body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      });
      check('the old password stops working immediately',
        oldRejected.status === 401,
        `status ${oldRejected.status}`);

      const withNew = await req('POST', '/api/auth/login', {
        body: { email: OWNER_EMAIL, password: ADMIN_SET_PASSWORD },
      });
      check('the administrator-set password signs in',
        withNew.status === 200,
        `status ${withNew.status}`);

      const resetLogged = await req('GET', '/api/admin/audit-logs?pageSize=100', { cookie: adminCookie });
      check('the password change is written to the audit log',
        (resetLogged.json?.logs ?? []).some((entry) => entry.action === 'client.password_reset'),
        'no client.password_reset entry');

      // Restore the documented seed password so the dev DB matches the README.
      const restore = await req('POST', `/api/admin/clients/${orgA.id}/password`, {
        cookie: adminCookie,
        body: { userId: ownerMember.id, password: OWNER_PASSWORD },
      });
      check('password restored to the documented seed value after tests',
        restore.status === 200,
        `status ${restore.status}: ${restore.json?.message ?? ''}`);
    }
  } else {
    check('administrator password section ran', false, 'no client organisation found');
  }

  // ---------- Test 8: audit logging ----------
  console.log('\n[8] Audit logs');
  const audit = await req('GET', '/api/admin/audit-logs?pageSize=100', { cookie: adminCookie });
  check('administrator can read audit logs', audit.status === 200 && Array.isArray(audit.json?.logs));
  const logs = audit.json?.logs ?? [];
  check('audit contains permission changes',
    logs.some((entry) => entry.action === 'features.updated' && entry.outcome === 'success'));
  check('audit contains login events',
    logs.some((entry) => entry.action === 'login.success'));
  check('audit contains suspension events',
    logs.some((entry) => entry.action === 'client.suspended'));
  check('audit records actor and target for permission changes',
    logs.some(
      (entry) =>
        entry.action === 'features.updated' &&
        entry.actorEmail === ADMIN_EMAIL &&
        Boolean(entry.orgId),
    ));
  const auditText = JSON.stringify(logs);
  check('no passwords appear in audit metadata',
    !auditText.includes(ADMIN_PASSWORD) && !auditText.includes(OWNER_PASSWORD) &&
      !auditText.includes(TEMP_RESET_PASSWORD) && !auditText.includes(ADMIN_SET_PASSWORD));
  check('no reset tokens appear in audit metadata',
    !resetToken || !auditText.includes(resetToken));
  const freshOwnerLogin = await req('POST', '/api/auth/login', {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  const auditDenier =
    (await req('GET', '/api/admin/audit-logs', { cookie: freshOwnerLogin.session })).status === 403;
  check('client cannot read audit logs', auditDenier, 'expected 403 with a valid client session');

  // ---------- Test 15: barcode lookup & POS checkout ----------
  console.log('\n[15] Barcode & Point of Sale');
  const posCookie = freshOwnerLogin.session ?? ownerCookie;
  const anonLookup = await req('GET', '/api/pos/lookup?code=8901234000014');
  check('anonymous barcode lookup is rejected', anonLookup.status === 401);

  const seededLookup = await req('GET', '/api/pos/lookup?code=8901234000014', { cookie: posCookie });
  check('seeded barcode resolves to the right product',
    seededLookup.status === 200 && seededLookup.json?.product?.sku === 'R101',
    `sku=${seededLookup.json?.product?.sku}`);
  check('lookup returns the server-side selling price',
    typeof seededLookup.json?.product?.sellingPrice === 'number');

  const unknownLookup = await req('GET', '/api/pos/lookup?code=0000000000000', { cookie: posCookie });
  check('an unknown barcode returns 404 and invents nothing',
    unknownLookup.status === 404 && unknownLookup.json?.code === 'not_found',
    `status ${unknownLookup.status}`);

  const baseState = await req('GET', '/api/state', { cookie: posCookie });
  const originalProducts = baseState.json?.products ?? [];
  const stampNow = Date.now();
  const probe = {
    id: `pos-probe-${stampNow}`,
    sku: `POS${String(stampNow).slice(-6)}`,
    name: 'POS probe product',
    category: 'Test',
    currentStock: 5,
    reorderLevel: 2,
    averageDailySales: 1,
    leadTimeDays: 1,
    expiryDate: null,
    sellingPrice: 50,
    barcode: `9000${String(stampNow).slice(-8)}`,
    taxRatePct: 0,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const addProbe = await req('PUT', '/api/state', {
    cookie: posCookie,
    body: { products: [...originalProducts, probe] },
  });
  check('a product with a barcode can be saved',
    addProbe.status === 200,
    `status ${addProbe.status}: ${addProbe.json?.message ?? ''}`);

  const duplicateBarcode = await req('PUT', '/api/state', {
    cookie: posCookie,
    body: {
      products: [
        ...originalProducts,
        probe,
        { ...probe, id: `${probe.id}-dup`, sku: `${probe.sku}D`, name: 'Duplicate barcode probe' },
      ],
    },
  });
  check('a duplicate barcode in the same shop is rejected',
    duplicateBarcode.status === 400 && /already belongs/i.test(duplicateBarcode.json?.message ?? ''),
    `status ${duplicateBarcode.status}: ${duplicateBarcode.json?.message ?? ''}`);

  const probeLookup = await req('GET', `/api/pos/lookup?code=${probe.barcode}`, { cookie: posCookie });
  check('a newly assigned barcode is immediately scannable',
    probeLookup.status === 200 && probeLookup.json?.product?.id === probe.id);

  const idempotencyKey = `api-pos-${stampNow}`;
  const checkoutBody = {
    idempotencyKey,
    lines: [{ productId: probe.id, quantity: 2 }],
    paymentMethod: 'cash',
    amountReceived: 200,
  };
  const sale = await req('POST', '/api/pos/checkout', { cookie: posCookie, body: checkoutBody });
  check('checkout completes the sale',
    sale.status === 201 && sale.json?.order?.status === 'completed',
    `status ${sale.status}: ${sale.json?.message ?? ''}`);
  check('a receipt number is issued',
    /^RCPT-\d{6}$/.test(sale.json?.order?.receiptNumber ?? ''),
    `receipt=${sale.json?.order?.receiptNumber}`);

  const afterSale = await req('GET', '/api/state', { cookie: posCookie });
  const probeAfter = (afterSale.json?.products ?? []).find((product) => product.id === probe.id);
  check('stock is deducted exactly once',
    probeAfter?.currentStock === probe.currentStock - 2,
    `stock=${probeAfter?.currentStock}`);
  check('the sale line reaches the demand ledger',
    (afterSale.json?.sales ?? []).some(
      (row) => row.saleId === sale.json?.order?.id && row.source === 'pos',
    ));
  check('an inventory movement is recorded',
    (afterSale.json?.inventoryMovements ?? []).some(
      (movement) => movement.saleId === sale.json?.order?.id && movement.quantityChange === -2,
    ));

  const replay = await req('POST', '/api/pos/checkout', { cookie: posCookie, body: checkoutBody });
  check('a replayed checkout returns the same transaction',
    replay.status === 200 &&
      replay.json?.duplicate === true &&
      replay.json?.order?.id === sale.json?.order?.id,
    `status ${replay.status}`);
  const afterReplay = await req('GET', '/api/state', { cookie: posCookie });
  const probeAfterReplay = (afterReplay.json?.products ?? []).find((product) => product.id === probe.id);
  check('the replay does not deduct stock again',
    probeAfterReplay?.currentStock === probeAfter?.currentStock);

  const oversell = await req('POST', '/api/pos/checkout', {
    cookie: posCookie,
    body: {
      ...checkoutBody,
      idempotencyKey: `${idempotencyKey}-over`,
      lines: [{ productId: probe.id, quantity: 9999 }],
    },
  });
  check('insufficient stock is rejected',
    oversell.status === 409 && oversell.json?.code === 'insufficient_stock',
    `status ${oversell.status} code=${oversell.json?.code}`);

  const priceTamper = await req('POST', '/api/pos/checkout', {
    cookie: posCookie,
    body: {
      ...checkoutBody,
      idempotencyKey: `${idempotencyKey}-price`,
      lines: [{ productId: probe.id, quantity: 1, unitPrice: 1 }],
    },
  });
  check('a client-supplied price is ignored',
    priceTamper.status === 201 && priceTamper.json?.order?.lines?.[0]?.unitPrice === 50,
    `unitPrice=${priceTamper.json?.order?.lines?.[0]?.unitPrice}`);

  const ledgerTamper = await req('PUT', '/api/state', {
    cookie: posCookie,
    body: { saleOrders: [] },
  });
  check('POS transactions cannot be rewritten via the state endpoint',
    ledgerTamper.status === 400 && ledgerTamper.json?.code === 'immutable_ledger',
    `status ${ledgerTamper.status} code=${ledgerTamper.json?.code}`);

  if (orgA?.id) {
    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS.filter((id) => id !== 'pos') },
    });
    const posDenied = await req('GET', `/api/pos/lookup?code=${probe.barcode}`, { cookie: posCookie });
    check('POS lookup is blocked when the feature is disabled',
      posDenied.status === 403 && posDenied.json?.feature === 'pos',
      `status ${posDenied.status}`);
    const checkoutDenied = await req('POST', '/api/pos/checkout', {
      cookie: posCookie,
      body: { ...checkoutBody, idempotencyKey: `${idempotencyKey}-off` },
    });
    check('checkout is blocked when the feature is disabled',
      checkoutDenied.status === 403,
      `status ${checkoutDenied.status}`);
    await req('PUT', `/api/admin/clients/${orgA.id}/features`, {
      cookie: adminCookie,
      body: { selection: FULL_ACCESS },
    });
  }

  const adminPos = await req('GET', '/api/pos/lookup?code=8901234000014', { cookie: adminCookie });
  check('a platform administrator has no shop POS access',
    adminPos.status === 403,
    `status ${adminPos.status}`);

  const cleanupProbe = await req('PUT', '/api/state', {
    cookie: posCookie,
    body: { products: originalProducts },
  });
  check('the POS probe product is cleaned up', cleanupProbe.status === 200, `status ${cleanupProbe.status}`);

  // ---------- Summary ----------
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('test harness error', error);
  process.exit(1);
});
