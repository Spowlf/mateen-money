// Spreading an amount evenly across months (the yearly allowance covers Oct–Sep).
// Each month gets floor(total / n); the last month also gets the remainder,
// so the shares always add up to the total exactly.

import { monthKey, monthStart, monthEnd, monthsBetween, addMonthsKey, overlapDays, daysInMonth } from './dates.js';

/**
 * Which month a spread starts. A 12-month allowance covers the academic year (Oct–Sep):
 * paid on 28 Sep 2026 it still covers Oct 2026 – Sep 2027. Anything else starts in its own month.
 */
export function defaultSpreadStart(date, { incomeType, spreadMonths } = {}) {
  if (incomeType === 'allowance' && spreadMonths === 12) {
    const [y, m] = date.split('-').map(Number);
    return `${m >= 9 ? y : y - 1}-10`;
  }
  return monthKey(date);
}

const spreadOf = (entry) => ({
  n: Math.max(1, entry.spreadMonths ?? 1),
  start: entry.spreadStart || monthKey(entry.date),
});

/** The part of an entry's GBP value that belongs to month key ('YYYY-MM'). */
export function monthShare(entry, key) {
  const total = entry.gbpPence ?? 0;
  const { n, start } = spreadOf(entry);
  const i = monthsBetween(start, key);
  if (i < 0 || i >= n) return 0;
  const base = Math.floor(total / n);
  return i === n - 1 ? total - base * (n - 1) : base;
}

/**
 * The part of an entry's GBP value that falls in [from, to]. Unspread entries count in full
 * on their date. Spread entries count each month's share, pro rata by days for part months
 * (a term that starts on 6 Oct), rounded down.
 */
export function amountInRange(entry, from, to) {
  const total = entry.gbpPence ?? 0;
  const { n, start } = spreadOf(entry);
  if (n === 1) return entry.date >= from && entry.date <= to ? total : 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const key = addMonthsKey(start, i);
    const ms = monthStart(key);
    const me = monthEnd(key);
    const days = overlapDays(ms, me, from, to);
    if (!days) continue;
    const share = monthShare(entry, key);
    const [y, m] = key.split('-').map(Number);
    const dim = daysInMonth(y, m);
    sum += days === dim ? share : Math.floor((share * days) / dim);
  }
  return sum;
}
