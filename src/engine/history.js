// History: every payment and income, searched, filtered and grouped by day.

import { formatDay } from './dates.js';
import { toDecimalText } from './money.js';
import { normaliseMerchant } from './vendors.js';
import { INCOME_TYPES } from './defaults.js';
import { isLive } from './totals.js';

/** Category filter values besides category ids. */
export const TO_SORT = 'to-sort';
export const INCOME = 'income';

const newestFirst = (a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1)
  : (a.time ?? '') !== (b.time ?? '') ? ((a.time ?? '') < (b.time ?? '') ? 1 : -1)
    : (b.at ?? 0) - (a.at ?? 0) || (a.id < b.id ? 1 : -1));

/** The words an entry can be found by: vendor, merchant as it arrived, note, category, method, trip. */
function haystack(e, { vendors, categories, methods, trips }) {
  const words = [
    e.merchant,
    vendors.get(e.vendorId)?.name,
    e.note,
    e.kind === 'income' ? INCOME_TYPES.find((t) => t.id === e.incomeType)?.name : categories.get(e.categoryId)?.name,
    methods.get(e.methodId)?.name,
    e.card,
    trips.get(e.tripId)?.name,
  ].filter(Boolean);
  return `${words.join(' ').toLowerCase()} ${words.map(normaliseMerchant).join(' ')}`;
}

/**
 * Live entries matching the search and filters, newest first.
 * query matches names, notes, categories and amounts ("4.20" finds £4.20; "4" finds £4.xx and £40).
 * filters: { kind: 'spend' | 'income', categoryId: id | 'to-sort' | 'income', incomeType, tripId, methodId }, each null for any.
 */
export function searchEntries(entries, { query = '', kind = null, categoryId = null, incomeType = null, tripId = null, methodId = null } = {},
  { vendors = [], categories = [], methods = [], trips = [] } = {}) {
  const lookup = {
    vendors: new Map(vendors.map((v) => [v.id, v])),
    categories: new Map(categories.map((c) => [c.id, c])),
    methods: new Map(methods.map((m) => [m.id, m])),
    trips: new Map(trips.map((t) => [t.id, t])),
  };
  const q = query.trim().toLowerCase().replace(/^[£$€]/, '');
  const amountQuery = /^\d+(\.\d*)?$/.test(q) ? q : null;
  const words = q.split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (!isLive(e)) return false;
    if (kind && e.kind !== kind) return false;
    if (incomeType && (e.kind !== 'income' || e.incomeType !== incomeType)) return false;
    if (categoryId === TO_SORT && !(e.kind === 'spend' && (e.categoryId == null || e.needsCurrency))) return false;
    if (categoryId === INCOME && e.kind !== 'income') return false;
    if (categoryId && categoryId !== TO_SORT && categoryId !== INCOME && (e.kind !== 'spend' || e.categoryId !== categoryId)) return false;
    if (tripId && e.tripId !== tripId) return false;
    if (methodId && e.methodId !== methodId) return false;
    if (!words.length) return true;
    if (amountQuery) {
      const own = toDecimalText(e.amountMinor, e.currency);
      const inGbp = e.gbpPence != null ? toDecimalText(e.gbpPence, 'GBP') : '';
      if (own.startsWith(amountQuery) || inGbp.startsWith(amountQuery)) return true;
    }
    const text = haystack(e, lookup);
    return words.every((w) => text.includes(w));
  }).sort(newestFirst);
}

/**
 * Entries (already sorted newest first) grouped by day: [{ date, label, spent, income, entries }].
 * label is "Today" for today, otherwise "30 Sep 2026". Totals are GBP pence as charged
 * (spread income counts in full on its day here).
 */
export function groupByDay(entries, todayDate) {
  const groups = [];
  let current = null;
  for (const e of entries) {
    if (!current || current.date !== e.date) {
      current = { date: e.date, label: e.date === todayDate ? 'Today' : formatDay(e.date), spent: 0, income: 0, entries: [] };
      groups.push(current);
    }
    current.entries.push(e);
    if (e.kind === 'income') current.income += e.gbpPence ?? 0;
    else current.spent += e.gbpPence ?? 0;
  }
  return groups;
}
