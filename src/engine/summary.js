// The weekly summary (Monday to Sunday) and its plain-text notification.

import { addDays, weekStart, weekday, formatDayShort } from './dates.js';
import { gbp, gbpRounded } from './money.js';
import { categoryRows, isLive } from './totals.js';

export const USUAL_WEEKS = 8;

/** The week being reviewed: this week on Sunday, last week Monday to Saturday. Returns its Monday. */
export function reviewWeek(todayDate) {
  const monday = weekStart(todayDate);
  return weekday(todayDate) === 6 ? monday : addDays(monday, -7);
}

const spends = (entries) => entries.filter((e) => e.kind === 'spend' && isLive(e));

function spentBetween(entries, from, to) {
  let sum = 0;
  for (const e of entries) if (e.date >= from && e.date <= to) sum += e.gbpPence ?? 0;
  return sum;
}

/**
 * The previous weeks used for "usual": up to 8 full weeks before start, counting only weeks
 * that end on or after the first logged spend (so a new tracker isn't compared with empty weeks).
 * Returns their Mondays, newest first.
 */
export function usualWeeks(entries, start) {
  const live = spends(entries);
  if (!live.length) return [];
  const first = live.reduce((min, e) => (e.date < min ? e.date : min), live[0].date);
  const weeks = [];
  for (let i = 1; i <= USUAL_WEEKS; i++) {
    const ws = addDays(start, -7 * i);
    if (addDays(ws, 6) < first) break;
    weeks.push(ws);
  }
  return weeks;
}

/** Average weekly spend over usualWeeks, rounded to the penny, or null if there are none. */
export function usualWeekSpend(entries, start) {
  const weeks = usualWeeks(entries, start);
  if (!weeks.length) return { averagePence: null, weeks: 0 };
  const live = spends(entries);
  const total = weeks.reduce((s, ws) => s + spentBetween(live, ws, addDays(ws, 6)), 0);
  return { averagePence: Math.round(total / weeks.length), weeks: weeks.length };
}

/** Spending with no category, and anything (a refund too) whose currency symbol needs an answer. */
export const toSortEntries = (entries) => entries
  .filter((e) => isLive(e) && ((e.kind === 'spend' && e.categoryId == null) || e.needsCurrency))
  .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || (a.date < b.date ? 1 : -1));

/** The 3 largest purchases in [from, to], largest first. */
export function largestPurchases(entries, from, to, n = 3) {
  return spends(entries)
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (b.gbpPence ?? 0) - (a.gbpPence ?? 0) || (a.date < b.date ? -1 : 1))
    .slice(0, n);
}

/** Every figure the weekly summary and review need. */
export function weekSummary({ entries, categories, todayDate, start = reviewWeek(todayDate) }) {
  const end = addDays(start, 6);
  const live = spends(entries);
  const totalPence = spentBetween(live, start, end);
  const { averagePence, weeks } = usualWeekSpend(entries, start);
  const rows = categoryRows(entries, categories, { from: start, to: end });
  return {
    start,
    end,
    totalPence,
    usualPence: averagePence,
    usualWeeks: weeks,
    changePct: averagePence ? Math.round(((totalPence - averagePence) / averagePence) * 100) : null,
    rows,
    top: rows.filter((r) => r.categoryId !== null).slice(0, 3),
    largest: largestPurchases(entries, start, end),
    toSort: toSortEntries(entries).length,
  };
}

/** How this week compares, as a phrase: "12% above your usual £127". */
export function comparePhrase(s) {
  if (s.usualPence === null) return null;
  const usual = gbpRounded(s.usualPence);
  if (s.usualPence === 0) return s.totalPence ? `your usual is ${usual}` : null;
  if (Math.abs(s.changePct) < 5) return `about your usual ${usual}`;
  return `${Math.abs(s.changePct)}% ${s.changePct > 0 ? 'above' : 'below'} your usual ${usual}`;
}

/**
 * The notification text.
 * "Week of 28 Sep: £142.30, 12% above your usual £127. Top: Food £48, Groceries £35, Snacks £20. 3 to sort."
 */
export function weeklyText(s) {
  const parts = [];
  const head = `Week of ${formatDayShort(s.start)}: ${gbp(s.totalPence)}`;
  const compare = comparePhrase(s);
  parts.push(compare ? `${head}, ${compare}.` : `${head}.`);
  if (s.top.length) parts.push(`Top: ${s.top.map((r) => `${r.name} ${gbpRounded(r.pence)}`).join(', ')}.`);
  parts.push(s.toSort === 0 ? 'Nothing to sort.' : `${s.toSort} to sort.`);
  return parts.join(' ');
}
