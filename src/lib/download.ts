import { buildCsv, type CsvTable } from './csv';

/** Triggers a browser download for an in-memory CSV string or table. */
export function downloadCsvText(filename: string, csvText: string): void {
  // A BOM keeps Excel happy with UTF-8 content such as the rupee sign.
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Pure client-side download; only used for the static CSV template. */
export function downloadCsv(filename: string, table: CsvTable): void {
  downloadCsvText(filename, buildCsv(table));
}

export class ExportDeniedError extends Error {
  feature = 'csv_export';
  constructor(message: string) {
    super(message);
    this.name = 'ExportDeniedError';
  }
}

/**
 * Server-authorized CSV export. The Worker checks the csv_export feature
 * permission and streams the file back; the rows are exactly what the user
 * is currently viewing (filters included).
 */
export async function exportCsv(
  filename: string,
  table: CsvTable,
  view: 'inventory' | 'actions' | 'expiry' | 'reorder',
): Promise<void> {
  const response = await fetch('/api/state/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stockora-Client': 'web' },
    credentials: 'same-origin',
    body: JSON.stringify({ table, filename, view }),
  });
  if (!response.ok) {
    let message = 'Export failed. Try again.';
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep default message
    }
    if (response.status === 403) throw new ExportDeniedError(message);
    throw new Error(message);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const name = match?.[1] ?? (filename.endsWith('.csv') ? filename : `${filename}.csv`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
