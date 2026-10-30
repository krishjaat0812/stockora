import type { CurrencyCode, PosSettings, Product, SaleOrder, Settings } from '../types';
import { PAYMENT_METHOD_LABELS, type SaleStatus } from '../types';
import { formatCurrency } from './format';

/**
 * Browser print support for receipts and barcode labels.
 *
 * Stockora has no PDF/document library, so printing uses the browser's own
 * print workflow: a self-contained document is opened in a print window and
 * the cashier/user prints or saves it as PDF from there. No receipt is ever
 * generated for a transaction that has not reached a terminal state — pending
 * receipts are clearly marked UNPAID and cancelled sales print nothing.
 */

const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: 'PAID',
  pending_payment: 'PENDING PAYMENT — NOT COMPLETED',
  cancelled: 'CANCELLED',
};

/** Opens a print window for the given document. Returns false when blocked. */
export function printHtml(title: string, bodyHtml: string): boolean {
  const printWindow = window.open('', '_blank', 'width=420,height=720');
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: #17211B; margin: 0; padding: 16px; }
  h1 { font-size: 15px; margin: 0 0 2px; text-align: center; }
  .center { text-align: center; }
  .muted { color: #667085; }
  hr { border: none; border-top: 1px dashed #9CA3AF; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 3px 2px; text-align: left; vertical-align: top; }
  th:last-child, td:last-child { text-align: right; }
  .totals td { padding: 2px; }
  .grand { font-size: 15px; font-weight: 700; }
  .status { display: inline-block; padding: 2px 8px; border: 2px solid #17211B; font-weight: 700; letter-spacing: 0.05em; margin: 6px 0; }
  .pending { border-color: #D97706; color: #D97706; }
  .label { text-align: center; }
  .label .name { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
  .label .meta { font-size: 11px; color: #444; }
  .label svg { max-width: 100%; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  // Give the window a beat to layout before the print dialog opens.
  window.setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
  return true;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

export function buildReceiptHtml(order: SaleOrder, settings: Settings): string {
  const pos: PosSettings = settings.pos ?? {
    paymentMethods: [],
    taxInclusive: false,
    requirePaymentConfirmation: false,
    receiptFooter: '',
  };
  const currency: CurrencyCode = order.currency ?? settings.currency;
  const money = (value: number) => formatCurrency(value, currency);
  const statusClass = order.status === 'pending_payment' ? ' pending' : '';
  const completedAt = order.completedAt
    ? new Date(order.completedAt).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date(order.createdAt).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  const rows = order.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.name)}<br /><span class="muted">${escapeHtml(line.sku)} × ${line.quantity}${line.lineDiscountPct > 0 ? ` · disc ${line.lineDiscountPct}%` : ''}</span></td>
        <td>${money(line.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const hasDiscounts = order.lineDiscountTotal + order.orderDiscountTotal > 0;
  const totals = `
    <tr class="totals"><td>Subtotal</td><td>${money(order.subtotal)}</td></tr>
    ${hasDiscounts ? `<tr class="totals"><td>Discounts</td><td>−${money(order.lineDiscountTotal + order.orderDiscountTotal)}</td></tr>` : ''}
    <tr class="totals"><td>Tax</td><td>${money(order.taxTotal)}</td></tr>
    <tr class="totals grand"><td>TOTAL</td><td>${money(order.total)}</td></tr>
    <tr class="totals"><td>Payment</td><td>${escapeHtml(PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod)}</td></tr>
    ${order.amountReceived !== null ? `<tr class="totals"><td>Received</td><td>${money(order.amountReceived)}</td></tr>` : ''}
    ${order.changeDue !== null && order.changeDue > 0 ? `<tr class="totals"><td>Change due</td><td>${money(order.changeDue)}</td></tr>` : ''}
  `;

  return `
<h1>${escapeHtml(settings.shopName)}</h1>
<p class="center muted">${order.taxInclusive ? 'Prices include tax' : 'Prices exclude tax'}</p>
<hr />
<p class="center"><strong>${escapeHtml(order.receiptNumber)}</strong><br />${escapeHtml(completedAt)}<br />Served by ${escapeHtml(order.cashierName)}</p>
<p class="center"><span class="status${statusClass}">${STATUS_LABELS[order.status]}</span></p>
<hr />
<table><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<hr />
<table class="totals">${totals}</table>
${order.note ? `<hr /><p class="muted">Note: ${escapeHtml(order.note)}</p>` : ''}
${order.warnings && order.warnings.length > 0 ? `<hr /><p class="muted">${order.warnings.map(escapeHtml).join('<br />')}</p>` : ''}
<hr />
<p class="center muted">${escapeHtml(pos.receiptFooter || 'Thank you for shopping with us.')}</p>
<p class="center muted">Stockora · Smarter stock, less waste</p>`;
}

/** Opens the browser print dialog for a sale receipt. */
export function printReceipt(order: SaleOrder, settings: Settings): boolean {
  return printHtml(`Receipt ${order.receiptNumber}`, buildReceiptHtml(order, settings));
}

// ---------------------------------------------------------------------------
// Barcode labels (real EAN-13 / UPC-A / EAN-8 symbols; other codes print as text)
// ---------------------------------------------------------------------------

const L_PATTERNS = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const R_PATTERNS = L_PATTERNS.map((pattern) =>
  pattern.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0')),
);
const G_PATTERNS = R_PATTERNS.map((pattern) => [...pattern].reverse().join(''));

/** Parity of the first six digits for each EAN-13 first digit (L or G). */
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG',
  'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

function encodeEan13(code: string): string | null {
  if (!/^\d{13}$/.test(code)) return null;
  const parity = EAN13_PARITY[Number(code[0])];
  let bits = '101'; // start guard
  for (let i = 1; i <= 6; i += 1) {
    const digit = Number(code[i]);
    bits += parity[i - 1] === 'L' ? L_PATTERNS[digit] : G_PATTERNS[digit];
  }
  bits += '01010'; // centre guard
  for (let i = 7; i <= 12; i += 1) bits += R_PATTERNS[Number(code[i])];
  bits += '101'; // end guard
  return bits;
}

function encodeEan8(code: string): string | null {
  if (!/^\d{8}$/.test(code)) return null;
  let bits = '101';
  for (let i = 0; i < 4; i += 1) bits += L_PATTERNS[Number(code[i])];
  bits += '01010';
  for (let i = 4; i < 8; i += 1) bits += R_PATTERNS[Number(code[i])];
  bits += '101';
  return bits;
}

/** Renders a scannable EAN-13/UPC-A/EAN-8 symbol as SVG, or null for other codes. */
export function barcodeSvg(code: string, options: { moduleWidth?: number; height?: number } = {}): string | null {
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 56;
  let bits: string | null = null;
  let displayDigits = code;
  if (/^\d{13}$/.test(code)) {
    bits = encodeEan13(code);
  } else if (/^\d{12}$/.test(code)) {
    // UPC-A is EAN-13 with a leading zero; the phantom digit is not printed.
    bits = encodeEan13(`0${code}`);
    displayDigits = code;
  } else if (/^\d{8}$/.test(code)) {
    bits = encodeEan8(code);
  }
  if (!bits) return null;

  const width = bits.length * moduleWidth;
  const bars: string[] = [];
  let index = 0;
  while (index < bits.length) {
    if (bits[index] === '1') {
      let start = index;
      while (index < bits.length && bits[index] === '1') index += 1;
      bars.push(
        `<rect x="${start * moduleWidth}" y="0" width="${(index - start) * moduleWidth}" height="${height}" fill="#000" />`,
      );
    } else {
      index += 1;
    }
  }
  const fontSize = 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + fontSize + 8}" viewBox="0 0 ${width} ${height + fontSize + 8}" role="img" aria-label="Barcode ${escapeHtml(displayDigits)}">
${bars.join('\n')}
<text x="${width / 2}" y="${height + fontSize + 2}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#000">${escapeHtml(displayDigits)}</text>
</svg>`;
}

/** Printable shelf label: product name, SKU, price and a real barcode symbol. */
export function buildProductLabelHtml(product: Product, settings: Settings): string {
  const code = (product.barcode ?? '').trim();
  const svg = code ? barcodeSvg(code) : null;
  const price =
    product.sellingPrice !== null && product.sellingPrice !== undefined
      ? formatCurrency(product.sellingPrice, settings.currency)
      : '';
  return `
<div class="label">
  <div class="name">${escapeHtml(product.name)}</div>
  <div class="meta">${escapeHtml(settings.shopName)} · SKU ${escapeHtml(product.sku)}${product.unit ? ` · per ${escapeHtml(product.unit)}` : ''}</div>
  ${price ? `<div class="name" style="font-size:16px;margin:4px 0;">${price}</div>` : ''}
  ${
    svg
      ? svg
      : code
        ? `<div style="font-family:monospace;font-size:16px;letter-spacing:0.08em;margin-top:6px;">${escapeHtml(code)}</div><div class="meta">(printed as text — not an EAN/UPC symbol)</div>`
        : `<div class="meta">No barcode assigned</div>`
  }
</div>`;
}

/** Opens the browser print dialog for a product's shelf label. */
export function printProductLabel(product: Product, settings: Settings): boolean {
  return printHtml(`Label ${product.sku}`, buildProductLabelHtml(product, settings));
}
