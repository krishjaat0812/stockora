/** Calendar-date helpers. All calculations use local calendar days to avoid timezone drift. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseISODate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  // Reject impossible dates such as 2026-02-31.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function toISODate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(from: Date = new Date()): string {
  return toISODate(startOfDay(from));
}

export function addDays(days: number, from: Date = new Date()): Date {
  const date = startOfDay(from);
  date.setDate(date.getDate() + days);
  return date;
}

export function addDaysISO(days: number, from: Date = new Date()): string {
  return toISODate(addDays(days, from));
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function differenceInCalendarDays(to: Date, from: Date): number {
  const a = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  const b = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function daysUntil(expiryDate: string | null | undefined, today: Date = new Date()): number | null {
  const expiry = parseISODate(expiryDate);
  if (!expiry) return null;
  return differenceInCalendarDays(expiry, startOfDay(today));
}

export function formatDate(iso: string | null | undefined): string {
  const date = parseISODate(iso);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(value: string, now: Date = new Date()): string {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(value.slice(0, 10));
}

/** Human label for a number of remaining days. */
export function daysRemainingLabel(days: number | null): string {
  if (days === null) return 'No expiry date';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'}`;
}
