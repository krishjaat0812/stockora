import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useStockora, type SalesImportResult } from '../store/StockoraContext';
import { useToast } from './toast';
import { Button, InfoNote, Modal } from './ui';
import { ApiError } from '../auth/api';
import { SALES_TEMPLATE } from '../lib/sales';
import { downloadCsv } from '../lib/download';

export function SalesImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { importSales } = useStockora();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SalesImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setText('');
    setResult(null);
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = async (selected: File | null) => {
    setError(null);
    setResult(null);
    if (!selected) {
      setFile(null);
      setText('');
      return;
    }
    if (!/\.csv$/i.test(selected.name) && selected.type !== 'text/csv') {
      setError('Choose a .csv file exported from your billing or POS system.');
      setFile(null);
      setText('');
      return;
    }
    if (selected.size > 2_000_000) {
      setError('That file is larger than 2 MB. Split it into smaller exports.');
      setFile(null);
      setText('');
      return;
    }
    try {
      const content = await selected.text();
      setFile(selected);
      setText(content);
    } catch {
      setError('The file could not be read. Try exporting it again.');
    }
  };

  const submit = async () => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await importSales(text);
      setResult(payload);
      if (payload.added > 0) {
        toast.success(
          'Sales history imported',
          `${payload.added} line${payload.added === 1 ? '' : 's'} added${payload.skippedDuplicates > 0 ? `, ${payload.skippedDuplicates} duplicate${payload.skippedDuplicates === 1 ? '' : 's'} skipped` : ''}.`,
        );
      } else {
        toast.info('Nothing new to import', 'Every row was either a duplicate or invalid.');
      }
      setFile(null);
      setText('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      const body = apiError?.body as { summary?: { errors?: SalesImportResult['errors'] } } | undefined;
      if (body?.summary?.errors) {
        setResult({
          added: 0,
          skippedDuplicates: 0,
          errors: body.summary.errors,
          errorCount: body.summary.errors.length,
          totalSales: 0,
        });
      }
      setError(apiError?.message ?? 'The import failed. Check the file and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import sales history"
      description="Turn your sales records into real demand analytics. Only recorded transactions are used — nothing is estimated."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!text}
            icon={<Upload className="h-4 w-4" aria-hidden="true" />}
          >
            Import sales
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <InfoNote tone="info" icon={<FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}>
          Required columns: <code className="font-mono text-[11px]">date</code>,{' '}
          <code className="font-mono text-[11px]">sku</code> and{' '}
          <code className="font-mono text-[11px]">quantity</code>. Add{' '}
          <code className="font-mono text-[11px]">unit_price</code> for revenue figures. Dates use YYYY-MM-DD.
          Rows are appended, and identical lines already stored are skipped, so re-uploading a file is safe.
        </InfoNote>

        <div className="rounded-xl border border-dashed border-line bg-canvas/50 p-4">
          <label
            htmlFor="sales-file"
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg px-2 py-4 text-center focus-within:ring-2 focus-within:ring-primary"
          >
            <Upload className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold text-ink">
              {file ? file.name : 'Choose a sales CSV file'}
            </span>
            <span className="text-xs text-muted">
              {file ? `${Math.max(1, Math.round(file.size / 1024))} KB selected` : 'up to 2 MB · 20,000 rows'}
            </span>
            <input
              ref={inputRef}
              id="sales-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void pick(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="mt-2 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => downloadCsv('stockora-sales-template.csv', SALES_TEMPLATE)}
            >
              Download template
            </Button>
          </div>
        </div>

        {text ? (
          <p className="text-xs text-muted">
            {Math.max(0, text.split(/\r?\n/).filter((line) => line.trim() !== '').length - 1)} data row(s) ready to
            validate.
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-crit/25 bg-crit-soft px-3 py-2.5 text-xs leading-5 text-[#7F1D1D]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {result ? (
          <div className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas/60 px-3 py-2.5 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-[#166534]">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {result.added} added
              </span>
              <span className="text-muted">{result.skippedDuplicates} duplicate(s) skipped</span>
              <span className={result.errorCount > 0 ? 'font-semibold text-[#991B1B]' : 'text-muted'}>
                {result.errorCount} row(s) rejected
              </span>
            </div>
            {result.errors.length > 0 ? (
              <div className="max-h-52 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted">
                      <th scope="col" className="px-3 py-1.5 font-semibold">Row</th>
                      <th scope="col" className="px-3 py-1.5 font-semibold">SKU</th>
                      <th scope="col" className="px-3 py-1.5 font-semibold">Problem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.errors.map((row) => (
                      <tr key={`${row.row}-${row.message}`}>
                        <td className="px-3 py-1.5 tnum text-muted">{row.row}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px] text-ink">{row.sku ?? '—'}</td>
                        <td className="px-3 py-1.5 text-ink">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {result.errorCount > result.errors.length ? (
              <p className="border-t border-line px-3 py-2 text-[11px] text-muted">
                Showing the first {result.errors.length} of {result.errorCount} rejected rows.
              </p>
            ) : null}
          </div>
        ) : null}

      </div>
    </Modal>
  );
}
