// The Overview's figures for a month, a year or a term.

import { addMonthsKey, monthKey, monthEnd, formatMonth, addMonths, daysBetween } from './dates.js';
import { periodTotals, categoryRows, yearRange, monthRange, tripTotals, change, monthlySeries, isLive } from './totals.js';
import { yearTerms, termLabel, shiftTerm } from './terms.js';
import { monthForecast } from './forecast.js';

const MONTHS_OF_HISTORY = 6;

/**
 * The dates a period covers. period is { kind: 'month', month: 'YYYY-MM' },
 * { kind: 'year', date } or { kind: 'term', year, name } (year as in terms.js).
 * Returns { kind, from, to, label, current }, or null for a term without dates.
 */
export function periodRange(period, { todayDate, yearMode = 'calendar', terms = [] }) {
  if (period.kind === 'month') {
    return { kind: 'month', ...monthRange(period.month), label: formatMonth(period.month), current: period.month === monthKey(todayDate) };
  }
  let from;
  let to;
  let label;
  if (period.kind === 'year') {
    ({ from, to, label } = yearRange(period.date, yearMode));
  } else {
    const term = yearTerms(terms, period.year).find((t) => t.name === period.name);
    if (!term?.start || !term?.end) return null;
    ({ start: from, end: to } = term);
    label = termLabel(term);
  }
  // One in progress runs to the end of this month (not today), so spread income counts this
  // month's whole share, exactly as the month view does. Spending after today doesn't exist yet.
  const current = todayDate >= from && todayDate <= to;
  const thisMonthEnd = monthEnd(monthKey(todayDate));
  const end = current && thisMonthEnd < to ? thisMonthEnd : to;
  return { kind: period.kind, from, to: end, label: current ? `${label} so far` : label, current };
}

/** The period n months, years or terms away. */
export function shiftPeriod(period, n) {
  if (period.kind === 'month') return { kind: 'month', month: addMonthsKey(period.month, n) };
  if (period.kind === 'year') return { kind: 'year', date: addMonths(period.date, 12 * n) };
  return { kind: 'term', ...shiftTerm(period, n) };
}

/** Spending per week over the days of a term so far (at least a week). */
export function perWeek(spent, from, to, todayDate) {
  const last = todayDate < to ? todayDate : to;
  const days = Math.max(daysBetween(from, last) + 1, 7);
  return Math.round((spent * 7) / days);
}

/** "12% more than September", "About the same as September", or null when there's nothing to compare. */
export function changeVsPrevious(current, previous, previousKey, currentKey, { soFar = false } = {}) {
  const { pct } = change(current, previous);
  if (pct === null) return null;
  const name = formatMonth(previousKey);
  const month = previousKey.slice(0, 4) === currentKey.slice(0, 4) ? name.split(' ')[0] : name;
  const label = soFar ? `by this point in ${month}` : month;
  if (Math.abs(pct) < 2) return `About the same as ${label}`;
  return `${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than ${label}`;
}

/** Everything the Overview shows for a period, or null if the period has no dates. */
export function overview({ entries, categories, trips = [], recurring = [], rates = [], period, todayDate, yearMode, terms, excludeTrips = false }) {
  const range = periodRange(period, { todayDate, yearMode, terms });
  if (!range) return null;
  // A payment still filed under a deleted trip counts as an ordinary one.
  const options = { from: range.from, to: range.to, excludeTrips: excludeTrips && new Set(trips.filter(isLive).map((t) => t.id)) };
  const totals = periodTotals(entries, options);
  let compare = null;
  if (period.kind === 'month') {
    // A month in progress is compared with the same days of last month, not all of it.
    const prev = addMonthsKey(period.month, -1);
    const prevRange = range.current ? { from: monthRange(prev).from, to: addMonths(todayDate, -1) } : monthRange(prev);
    compare = changeVsPrevious(totals.spent, periodTotals(entries, { ...prevRange, excludeTrips: options.excludeTrips }).spent, prev, period.month, { soFar: range.current });
  }
  const thisMonth = monthKey(todayDate);
  const lastMonth = monthKey(range.to) < thisMonth ? monthKey(range.to) : thisMonth;
  return {
    range,
    totals,
    rows: categoryRows(entries, categories, options),
    compare,
    weekly: period.kind === 'term' && range.from <= todayDate ? perWeek(totals.spent, range.from, range.to, todayDate) : null,
    series: monthlySeries(entries, lastMonth, MONTHS_OF_HISTORY, { excludeTrips: options.excludeTrips }),
    trips: tripTotals(entries, trips, categories),
    // The month in progress only: where spending ends up at this pace.
    forecast: period.kind === 'month' && range.current
      ? monthForecast({ entries, trips, recurring, rates, todayDate, excludeTrips: options.excludeTrips })
      : null,
  };
}

/** A y-axis in whole steps of 1, 2 or 5 (× a power of ten), with at most four steps. Pence in, pence out. */
export function niceScale(maxPence, steps = 4) {
  const top = maxPence > 0 ? maxPence : 10000;   // an empty chart still gets an axis
  const raw = top / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * power).find((s) => s >= raw);
  const max = Math.ceil(top / step) * step;
  const ticks = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { step, max, ticks };
}
