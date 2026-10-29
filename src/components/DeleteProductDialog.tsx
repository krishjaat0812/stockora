import type { Product } from '../types';
import { useStockora } from '../store/StockoraContext';
import { useToast } from './toast';
import { ConfirmDialog } from './ui';

export function DeleteProductDialog({
  product,
  onClose,
  onDeleted,
}: {
  product: Product | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { deleteProduct } = useStockora();
  const toast = useToast();

  return (
    <ConfirmDialog
      open={Boolean(product)}
      title={product ? `Delete ${product.name}?` : 'Delete product?'}
      message={
        <div className="space-y-2">
          <p>
            <strong className="text-ink">{product?.name}</strong> ({product?.sku}) will be removed from inventory,
            dashboards, actions and reports.
          </p>
          <p className="font-medium text-ink">This cannot be undone from the app. Export a CSV first if you need a copy.</p>
        </div>
      }
      confirmLabel="Delete product"
      destructive
      onCancel={onClose}
      onConfirm={() => {
        if (product) {
          deleteProduct(product.id);
          toast.success('Product deleted', `${product.name} was removed and all metrics were recalculated.`);
        }
        onClose();
        onDeleted?.();
      }}
    />
  );
}
