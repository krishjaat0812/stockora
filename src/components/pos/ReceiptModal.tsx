import { Printer, Receipt as ReceiptIcon } from 'lucide-react';
import type { SaleOrder, Settings } from '../../types';
import { PAYMENT_METHOD_LABELS } from '../../types';
import { formatCurrency } from '../../lib/format';
import { formatDateTime } from '../../lib/date';
import { printReceipt } from '../../lib/print';
import { Badge, Button, Modal } from '../ui';

/**
 * Post-sale receipt view. Printing uses the browser's own print dialog (no
 * PDF library exists in Stockora), and a receipt can only be opened for a
 * transaction that exists on the server — pending ones are clearly marked.
 */
export function ReceiptModal({
  open,
  order,
  settings,
  onClose,
}: {
  open: boolean;
  order: SaleOrder | null;
  settings: Settings;
  onClose: () => void;
}) {
  if (!order) return null;
  const money = (value: number) => formatCurrency(value, order.currency ?? settings.currency);
  const discounts = order.lineDiscountTotal + order.orderDiscountTotal;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Receipt ${order.receiptNumber}`}
      description={
        order.status === 'completed'
          ? 'Sale completed — stock has been deducted.'
          : 'Payment pending — stock has NOT been deducted yet.'
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            icon={<Printer className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              const started = printReceipt(order, settings);
              if (!started) {
                window.alert(
                  'Your browser blocked the print window. Allow pop-ups for this site, then try again.',
                );
              }
            }}
          >
            Print receipt
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-line bg-canvas/60 p-4 font-mono text-[12px] leading-5 text-ink">
        <div className="text-center">
          <p className="text-[13px] font-bold">{settings.shopName}</p>
          <p className="text-muted">{order.taxInclusive ? 'Prices include tax' : 'Prices exclude tax'}</p>
        </div>
        <div className="my-2 border-t border-dashed border-line" />
        <div className="flex justify-between gap-3">
          <span>{order.receiptNumber}</span>
          <Badge tone={order.status === 'completed' ? 'ok' : 'warn'}>
            {order.status === 'completed' ? 'PAID' : 'PENDING PAYMENT'}
          </Badge>
        </div>
        <p className="text-muted">
          {formatDateTime(order.completedAt ?? order.createdAt)} · {order.cashierName}
        </p>
        <div className="my-2 border-t border-dashed border-line" />
        <ul className="space-y-1.5">
          {order.lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-sans text-[13px] font-semibold">{line.name}</span>
                <span className="text-muted">
                  {line.sku} × {line.quantity} @ {money(line.unitPrice)}
                  {line.taxRatePct > 0 ? ` · GST ${line.taxRatePct}%` : ''}
                  {line.lineDiscountPct > 0 ? ` · −${line.lineDiscountPct}%` : ''}
                </span>
              </span>
              <span className="tnum shrink-0 font-semibold">{money(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="my-2 border-t border-dashed border-line" />
        <dl className="space-y-1">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tnum">{money(order.subtotal)}</dd>
          </div>
          {discounts > 0 ? (
            <div className="flex justify-between text-warn">
              <dt>Discounts</dt>
              <dd className="tnum">−{money(discounts)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt>Tax</dt>
            <dd className="tnum">{money(order.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1 text-[15px] font-bold">
            <dt>Total</dt>
            <dd className="tnum">{money(order.total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Payment</dt>
            <dd>{PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}</dd>
          </div>
          {order.amountReceived !== null ? (
            <div className="flex justify-between">
              <dt>Received</dt>
              <dd className="tnum">{money(order.amountReceived)}</dd>
            </div>
          ) : null}
          {order.changeDue !== null && order.changeDue > 0 ? (
            <div className="flex justify-between">
              <dt>Change due</dt>
              <dd className="tnum">{money(order.changeDue)}</dd>
            </div>
          ) : null}
        </dl>
        {order.warnings && order.warnings.length > 0 ? (
          <div className="mt-2 rounded-lg border border-warn/40 bg-warn-soft p-2 font-sans text-[12px] text-[#78350F]">
            <ReceiptIcon className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {order.warnings.join(' ')}
          </div>
        ) : null}
        <p className="mt-3 text-center text-muted">{settings.pos?.receiptFooter || 'Thank you.'}</p>
      </div>
    </Modal>
  );
}
