// The Overview's figures for a month, a year or a term.

import { addMonthsKey, addDays, monthKey, monthEnd, formatMonth, formatDayShort, addMonths, daysBetween } from './dates.js';
import { periodTotals, categoryRows, yearRange, monthRange, tripTotals, change, isLive } from './totals.js';
import { yearTerms, termLabel, shiftTerm } from './terms.js';
import { monthForecast } from './forecast.js';

/**
 * The dates a period covers. period is { kind: 'month', month: 'YYYY-MM' },
 * { kind: 'year', date } or { kind: 'term', year, name } (year as in terms.js).
 * Returns { kind, from, to, end, label, current }, or null for a term without dates:
 * to is where the figures stop (see below), end is the period's last day.
 */
export function periodRange(period, { todayDate, yearMode = 'calendar', terms = [] }) {
  if (period.kind === 'month') {
    const { from, to } = monthRange(period.month);
    return { kind: 'month', from, to, end: to, label: formatMonth(period.month), current: period.month === monthKey(todayDate) };
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
  return { kind: period.kind, from, to: end, end: to, label, current };
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

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 to 12 Oct", "29 Sep to 5 Oct" */
function daySpan(from, to) {
  const [a, b] = [formatDayShort(from), formatDayShort(to)];
  return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]} to ${b}` : `${a} to ${b}`;
}

/**
 * The period's income and spending in steps: a month and a term week by week (numbered; a month's
 * weeks start on the 1st, 8th, 15th, 22nd and 29th, a term's on its first day), a year month by month.
 * Steps that start after today (or after range.to) haven't happened, so they're null. Spread income is counted up to the end
 * of each step and differenced, so the steps add up to the period's income exactly.
 * Returns [{ from, to, label, title, income, spent }], oldest first.
 */
export function periodSeries(entries, range, { todayDate, excludeTrips = false }) {
  const steps = [];
  if (range.kind === 'year') {
    for (let k = monthKey(range.from); monthRange(k).from <= range.end; k = addMonthsKey(k, 1)) {
      steps.push({ ...monthRange(k), label: MONTH_SHORT[Number(k.slice(5)) - 1], title: formatMonth(k) });
    }
  } else {
    for (let from = range.from, i = 1; from <= range.end; from = addDays(from, 7), i++) {
      const to = addDays(from, 6) < range.end ? addDays(from, 6) : range.end;
      steps.push({ from, to, label: String(i), title: `Week ${i}, ${daySpan(from, to)}` });
      if (to === range.end) break;
    }
  }
  let incomeBefore = 0;
  return steps.map((step) => {
    if (step.from > range.to || step.from > todayDate) return { ...step, income: null, spent: null };
    const to = step.to < range.to ? step.to : range.to;
    const income = periodTotals(entries, { from: range.from, to, excludeTrips }).income;
    const spent = periodTotals(entries, { from: step.from, to, excludeTrips }).spent;
    const out = { ...step, income: income - incomeBefore, spent };
    incomeBefore = income;
    return out;
  });
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
  return {
    range,
    totals,
    rows: categoryRows(entries, categories, options),
    compare,
    weekly: period.kind === 'term' && range.from <= todayDate ? perWeek(totals.spent, range.from, range.to, todayDate) : null,
    series: periodSeries(entries, range, { todayDate, excludeTrips: options.excludeTrips }),
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
