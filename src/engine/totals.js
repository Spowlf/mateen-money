// Totals for any date range: a month, a year, a term, a week, a trip.
// { excludeTrips } leaves out spending on a trip (Overview toggle only): a Set of the live trips'
// ids, so a payment still pointing at a deleted trip counts, or true for any trip.

import { addMonthsKey, monthStart, monthEnd } from './dates.js';
import { amountInRange } from './allowance.js';

export const isLive = (row) => !row.deletedAt;

const inRange = (e, from, to) => e.date >= from && e.date <= to;
const onTrip = (e, excludeTrips) => e.kind === 'spend' && !!e.tripId && (excludeTrips === true || excludeTrips.has(e.tripId));
const keep = (e, excludeTrips) => isLive(e) && !(excludeTrips && onTrip(e, excludeTrips));

/** Spending and income in [from, to]. Spread income counts its share for the range. */
export function periodTotals(entries, { from, to, excludeTrips = false }) {
  let spent = 0;
  let income = 0;
  let count = 0;
  let estimated = false;
  for (const e of entries) {
    if (!keep(e, excludeTrips)) continue;
    if (e.kind === 'income') {
      const part = amountInRange(e, from, to);
      income += part;
      if (part && e.gbpStatus === 'estimated') estimated = true;
    } else if (inRange(e, from, to)) {
      spent += e.gbpPence ?? 0;
      count++;
      if (e.gbpStatus === 'estimated') estimated = true;
    }
  }
  return { from, to, spent, income, net: income - spent, count, estimated };
}

/**
 * Spending by category in [from, to], largest first. Entries still to sort form one row
 * with categoryId null. One object per category so a budget can be attached later.
 */
export function categoryRows(entries, categories, { from, to, excludeTrips = false }) {
  const byId = new Map();
  let total = 0;
  for (const e of entries) {
    if (e.kind !== 'spend' || !keep(e, excludeTrips) || !inRange(e, from, to)) continue;
    const key = e.categoryId ?? null;
    const row = byId.get(key) ?? { categoryId: key, pence: 0, count: 0 };
    row.pence += e.gbpPence ?? 0;
    row.count++;
    total += e.gbpPence ?? 0;
    byId.set(key, row);
  }
  const names = new Map(categories.map((c) => [c.id, c]));
  const order = (id) => names.get(id)?.sort ?? 999;
  return [...byId.values()]
    .map((r) => ({
      ...r,
      name: r.categoryId === null ? 'To sort' : names.get(r.categoryId)?.name ?? 'Removed category',
      share: total ? r.pence / total : 0,
    }))
    .sort((a, b) => b.pence - a.pence || order(a.categoryId) - order(b.categoryId));
}

/** Calendar year (Jan–Dec) or academic year (Oct–Sep) containing date. */
export function yearRange(date, mode = 'calendar') {
  const [y, m] = date.split('-').map(Number);
  if (mode === 'academic') {
    const start = m >= 10 ? y : y - 1;
    return { from: `${start}-10-01`, to: `${start + 1}-09-30`, label: `${start}–${String(start + 1).slice(2)}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
}

/** The year so far: from the year's start to today (or the year's end if it's over). */
export function yearToDate(todayDate, mode = 'calendar') {
  const year = yearRange(todayDate, mode);
  return { ...year, to: todayDate < year.to ? todayDate : year.to };
}

export const monthRange = (key) => ({ from: monthStart(key), to: monthEnd(key) });

/** Terms are { id, name, start, end }. Returns the term containing date, or null. */
export function termOf(date, terms = []) {
  return terms.find((t) => !t.deletedAt && t.start && t.end && date >= t.start && date <= t.end) ?? null;
}

/** The trip whose dates contain date. If trips overlap, the one that started latest. */
export function suggestTrip(date, trips = []) {
  let best = null;
  for (const t of trips) {
    if (!isLive(t) || date < t.start || date > t.end) continue;
    if (!best || t.start > best.start) best = t;
  }
  return best;
}

/** The trip an entry is filed under unless it was set by hand. Only spending joins a trip. */
export function tripFor(entry, trips = []) {
  if (entry.tripManual) return entry.tripId ?? null;
  return entry.kind === 'spend' ? suggestTrip(entry.date, trips)?.id ?? null : null;
}

/**
 * After trips are added, redated, deleted or brought back: the entries whose trip changes,
 * as whole rows with the new tripId. Entries whose trip was set by hand are never moved.
 */
export function retrip(entries, trips) {
  const out = [];
  for (const e of entries) {
    if (!isLive(e) || e.tripManual || e.kind !== 'spend') continue;
    const tripId = tripFor(e, trips);
    if ((e.tripId ?? null) !== tripId) out.push({ ...e, tripId });
  }
  return out;
}

/** Each trip's total, count and category breakdown, newest trip first. */
export function tripTotals(entries, trips, categories) {
  return trips.filter(isLive)
    .map((trip) => {
      const own = entries.filter((e) => e.tripId === trip.id && e.kind === 'spend' && isLive(e));
      const rows = categoryRows(own, categories, { from: '0000-01-01', to: '9999-12-31' });
      return {
        trip,
        pence: rows.reduce((s, r) => s + r.pence, 0),
        count: own.length,
        estimated: own.some((e) => e.gbpStatus === 'estimated'),
        rows,
      };
    })
    .sort((a, b) => (a.trip.start < b.trip.start ? 1 : -1));
}

/** Difference between this and last. pct is null when last is zero. */
export function change(current, previous) {
  return { delta: current - previous, pct: previous ? Math.round(((current - previous) / previous) * 100) : null };
}

/** Spending and income per month for the n months ending at key (oldest first). */
export function monthlySeries(entries, key, n, options = {}) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addMonthsKey(key, -i);
    const t = periodTotals(entries, { ...monthRange(k), ...options });
    out.push({ month: k, spent: t.spent, income: t.income });
  }
  return out;
}

