// Backup (JSON, everything) and CSV export (payments, for a spreadsheet).

import { toDecimalText } from './money.js';
import { INCOME_TYPES } from './defaults.js';
import { isLive } from './totals.js';

export const BACKUP_APP = 'mateen-money';
export const BACKUP_VERSION = 1;
/** Tables a backup holds, in the order they're restored. */
export const BACKUP_TABLES = ['categories', 'methods', 'vendors', 'aliases', 'trips', 'recurring', 'entries', 'reviews', 'rates', 'settings', 'budgets'];

/** Everything live, as one JSON-ready object. state has one array per table. */
export function backupData(state, { now }) {
  const tables = Object.fromEntries(BACKUP_TABLES.map((name) => [name, (state[name] ?? []).filter(isLive)]));
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, tables };
}

/**
 * Checks a parsed backup file before anything is replaced.
 * Returns { ok: true, exportedAt, counts } or { ok: false, message } (a "Nothing changed" reason).
 */
export function readBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP || !data.tables || typeof data.tables !== 'object') {
    return { ok: false, message: 'Nothing changed: this isn’t a Mateen Money backup.' };
  }
  if (data.version > BACKUP_VERSION) return { ok: false, message: 'Nothing changed: this backup is from a newer version of the app. Reload the app first.' };
  for (const name of BACKUP_TABLES) {
    const rows = data.tables[name] ?? [];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id)) {
      return { ok: false, message: 'Nothing changed: this backup is damaged.' };
    }
  }
  const counts = Object.fromEntries(BACKUP_TABLES.map((name) => [name, (data.tables[name] ?? []).length]));
  return { ok: true, exportedAt: Number(data.exportedAt) || null, counts };
}

/** One CSV cell: quoted when needed, and a leading = + - @ neutralised so a spreadsheet never runs it. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = ['Date', 'Time', 'Type', 'Merchant', 'Category', 'Amount', 'Currency', 'GBP', 'Fee GBP', 'GBP is', 'Paid with', 'Trip', 'Description', 'Added by'];
const STATUS = { final: 'Final', estimated: 'Estimated', statement: 'From statement' };
const SOURCE = { manual: 'You', applepay: 'Apple Pay', recurring: 'Plan' };

/** Live payments and income as CSV, oldest first. Amounts are plain decimals ("4.20"). */
export function entriesCsv({ entries, vendors = [], categories = [], methods = [], trips = [] }) {
  const name = (rows, id) => rows.find((r) => r.id === id)?.name ?? '';
  const rows = entries.filter(isLive).sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1)
    : (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : (a.at ?? 0) - (b.at ?? 0)));
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of rows) {
    const income = e.kind === 'income';
    lines.push([
      e.date,
      e.time ?? '',
      income ? 'Income' : 'Spending',
      name(vendors, e.vendorId) || e.merchant || '',
      income ? INCOME_TYPES.find((t) => t.id === e.incomeType)?.name ?? '' : name(categories, e.categoryId) || 'To sort',
      toDecimalText(e.amountMinor, e.currency),
      e.currency,
      e.gbpPence == null ? '' : toDecimalText(e.gbpPence, 'GBP'),
      e.feePence ? toDecimalText(e.feePence, 'GBP') : '',
      STATUS[e.gbpStatus] ?? '',
      name(methods, e.methodId),
      name(trips, e.tripId),
      e.note ?? '',
      SOURCE[e.source] ?? '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
