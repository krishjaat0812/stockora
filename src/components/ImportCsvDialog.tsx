import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import type { ImportSummary } from '../types';
import { useStockora } from '../store/StockoraContext';
import { useAction } from '../auth/AuthContext';
import { apiPost } from '../auth/api';
import { useToast } from './toast';
import { Button, InfoNote, Modal, cn } from './ui';
import { SAMPLE_CSV, parseInventoryCsv } from '../lib/csv';
import { downloadCsv } from '../lib/download';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function ImportCsvDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { products, refreshFromStorage } = useStockora();
  const canImport = useAction('csv_import', 'create');
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) return;
    setFileName('');
    setRawText('');
    setSummary(null);
    setReplaceExisting(false);
    setFileError(null);
    setReading(false);
    setImporting(false);
    setDragActive(false);
  }, [open]);

  const loadFile = async (file: File) => {
    setFileError(null);
    setSummary(null);
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setFileError('Choose a .csv file. Excel workbooks must be exported to CSV first.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError('That file is larger than 2 MB. Split the inventory into smaller files.');
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      setRawText(text);
      setSummary(parseInventoryCsv(text, products, { replaceExisting }));
    } catch {
      setFileError('The file could not be read. Try saving it again as CSV.');
    } finally {
      setReading(false);
    }
  };

  const reparse = (replace: boolean) => {
    setReplaceExisting(replace);
    if (rawText) setSummary(parseInventoryCsv(rawText, products, { replaceExisting: replace }));
  };

  const handleImport = async () => {
    if (!summary || summary.valid.length === 0 || importing) return;
    setImporting(true);
    try {
      // The Worker re-parses and re-validates the CSV, applies it to this
      // organisation's workspace and enforces the csv_import permission.
      const result = await apiPost<{ added: number; updated: number }>('/api/state/import', {
        text: rawText,
        replaceExisting,
      });
      await refreshFromStorage();
      toast.success(
        'Inventory imported',
        `${result.added} product${result.added === 1 ? '' : 's'} added${
          result.updated > 0 ? `, ${result.updated} updated` : ''
        }. Metrics were recalculated.`,
      );
      onClose();
    } catch (err) {
      toast.error('Import failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setImporting(false);
    }
  };

  const skipped = summary?.errors.length ?? 0;
  const validCount = summary?.valid.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import inventory from CSV"
      description={
        canImport
          ? 'Upload a CSV, review every row, then confirm. Invalid rows are reported and never imported silently.'
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {summary ? (
            <Button onClick={handleImport} disabled={validCount === 0} loading={importing}>
              {validCount === 0
                ? 'Nothing to import'
                : `Import ${validCount} product${validCount === 1 ? '' : 's'}`}
            </Button>
          ) : (
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => downloadCsv('stockora-inventory-template.csv', SAMPLE_CSV)}
            >
              Download template
            </Button>
          )}
        </>
      }
    >
      {!canImport ? (
        <InfoNote tone="warn" icon={<Upload className="h-4 w-4" aria-hidden="true" />}>
          <span className="font-semibold">CSV Import isn’t enabled for your account.</span>{' '}
          Ask your administrator to turn it on in Feature access.
        </InfoNote>
      ) : (
      <div className="space-y-4">
        <div
          className={cn(
            'rounded-xl border-2 border-dashed p-4 text-center transition-colors',
            dragActive ? 'border-primary bg-primary-soft/60' : 'border-line bg-canvas/40',
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void loadFile(file);
          }}
        >
          <FileSpreadsheet className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-ink">
            {fileName || 'Choose a CSV file or drop it here'}
          </p>
          <p className="mt-1 text-[11px] text-muted">Up to 2 MB · UTF-8 · .csv only</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload className="h-4 w-4" aria-hidden="true" />}
              onClick={() => inputRef.current?.click()}
              loading={reading}
            >
              {fileName ? 'Choose another file' : 'Choose CSV file'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => downloadCsv('stockora-inventory-template.csv', SAMPLE_CSV)}
            >
              Sample template
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Choose a CSV file to import"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = '';
            }}
          />
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-xs text-ink">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(event) => reparse(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-muted/50 text-primary focus:ring-primary"
          />
          <span>
            <span className="font-semibold">Update existing products</span> with matching SKUs
            <span className="block text-muted">Leave unchecked to reject rows whose SKU already exists.</span>
          </span>
        </label>

        <details className="rounded-lg border border-line bg-white px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-ink">
            Required columns and date format
          </summary>
          <div className="mt-2 space-y-1.5 text-[11px] leading-4 text-muted">
            <p>
              Required: <strong className="text-ink">SKU, Product Name, Category, Current Stock, Reorder Level,
              Average Daily Sales, Lead Time Days</strong>.
            </p>
            <p>Optional: Expiry Date, Supplier Name, Unit, Unit Cost.</p>
            <p>Dates use YYYY-MM-DD (DD/MM/YYYY is also accepted). Numeric fields cannot be negative.</p>
          </div>
        </details>

        {fileError ? (
          <InfoNote tone="crit" icon={<XCircle className="h-4 w-4" aria-hidden="true" />}>
            {fileError}
          </InfoNote>
        ) : null}

        {summary?.fileError ? (
          <InfoNote tone="crit" icon={<XCircle className="h-4 w-4" aria-hidden="true" />}>
            {summary.fileError}
          </InfoNote>
        ) : null}

        {summary && !summary.fileError ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-line bg-white px-2 py-2.5">
                <p className="tnum text-lg font-semibold text-ok">{validCount}</p>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Ready</p>
              </div>
              <div className="rounded-lg border border-line bg-white px-2 py-2.5">
                <p className="tnum text-lg font-semibold text-crit">{skipped}</p>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Skipped</p>
              </div>
              <div className="rounded-lg border border-line bg-white px-2 py-2.5">
                <p className="tnum text-lg font-semibold text-info">{summary.updatedCount}</p>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Updates</p>
              </div>
            </div>

            {skipped > 0 ? (
              <div className="rounded-lg border border-crit/20 bg-crit-soft/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[#991B1B]">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  {skipped} row{skipped === 1 ? '' : 's'} cannot be imported
                </p>
                <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1 text-[11px] leading-4">
                  {summary.errors.map((error) => (
                    <li key={`${error.row}-${error.message}`} className="text-[#7F1D1D]">
                      <span className="font-semibold">Row {error.row}{error.sku ? ` · ${error.sku}` : ''}:</span>{' '}
                      {error.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-[#7F1D1D]">
                  These rows will not be imported. Fix them in the CSV and upload again.
                </p>
              </div>
            ) : validCount > 0 ? (
              <InfoNote tone="ok" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>
                All {validCount} row{validCount === 1 ? '' : 's'} passed validation.
              </InfoNote>
            ) : null}

            {validCount > 0 ? (
              <div className="overflow-hidden rounded-lg border border-line">
                <p className="border-b border-line bg-canvas/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Preview (first {Math.min(5, validCount)} of {validCount})
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-xs">
                    <thead className="table-head">
                      <tr>
                        <th className="px-3 py-2" scope="col">SKU</th>
                        <th className="px-3 py-2" scope="col">Product</th>
                        <th className="px-3 py-2 text-right" scope="col">Stock</th>
                        <th className="px-3 py-2" scope="col">Expiry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-white">
                      {summary.valid.slice(0, 5).map((row) => (
                        <tr key={row.sku}>
                          <td className="tnum px-3 py-2 font-medium text-ink">{row.sku}</td>
                          <td className="px-3 py-2 text-ink">{row.name}</td>
                          <td className="tnum px-3 py-2 text-right text-ink">{row.currentStock}</td>
                          <td className="tnum px-3 py-2 text-muted">{row.expiryDate ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      )}
    </Modal>
  );
}
