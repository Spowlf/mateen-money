// Safe to spend today and the month-end forecast.
// Safe to spend is the headline ÷ the days left (today included), so it always counts trips.
// The forecast adds day-to-day spending at this month's pace to what's spent and still due.
// Day-to-day spending leaves out recurring items, and trips when the Overview toggle is on,
// so one trip doesn't set the pace for the rest of the month.

import { addDays, daysBetween, monthKey, monthStart, monthEnd, parse, formatMonth } from './dates.js';
import { monthHeadline } from './headline.js';
import { upcomingBetween } from './recurring.js';
import { estimateGbp } from './currency.js';
import { isLive } from './totals.js';
import { gbp, gbpRounded } from './money.js';

export const BLEND_DAYS = 7;          // days 1–7 blend this month with the 8 weeks before it
export const HISTORY_DAYS = 56;       // the 8 weeks before the month

/** { perDay } (pence, rounded down) or { over } when the headline is negative. null outside the month. */
export function safeToSpend(hl) {
  if (!hl.daysLeft) return null;
  if (hl.left < 0) return { over: -hl.left, daysLeft: hl.daysLeft };
  return { perDay: Math.floor(hl.left / hl.daysLeft), daysLeft: hl.daysLeft };
}

/** "£12.40 a day for the rest of October." or "Over by £30.00 this month." */
export function safeToSpendLine(safe, month, { estimated = false } = {}) {
  if (!safe) return null;
  const tilde = estimated ? '~' : '';
  if (safe.over !== undefined) return `Over by ${tilde}${gbp(safe.over)} this month.`;
  const name = formatMonth(month).split(' ')[0];
  if (safe.daysLeft === 1) return `${tilde}${gbp(safe.perDay)} to spend today, the last day of ${name}.`;
  return `${tilde}${gbp(safe.perDay)} a day for the rest of ${name}.`;
}

const onTrip = (e, excludeTrips) => !!e.tripId && (excludeTrips === true || (excludeTrips instanceof Set && excludeTrips.has(e.tripId)));

/** Live, priced spending that isn't a recurring item (and isn't on a trip, when trips are left out). */
export const isDayToDay = (e, excludeTrips = false) => e.kind === 'spend' && isLive(e) && e.gbpPence != null
  && !e.recurringId && !(excludeTrips && onTrip(e, excludeTrips));

/**
 * Day-to-day pence per day for the month of todayDate, by key (keyOf(entry), e.g. its category).
 * Days 1–7 blend this month's average with the 8 weeks before the month, weighted by days
 * elapsed (day 3: 3/7 this month, 4/7 history). From day 7 it's this month's average alone.
 * History only counts days from the first logged payment; with none, this month stands alone.
 * Returns { rates: Map(key → pence a day, unrounded), elapsed, historyDays, weight }.
 */
export function dailyRates(entries, todayDate, { excludeTrips = false, keyOf = () => 'all' } = {}) {
  const from = monthStart(monthKey(todayDate));
  const elapsed = parse(todayDate)[2];
  const spends = entries.filter((e) => e.kind === 'spend' && isLive(e));
  const first = spends.reduce((min, e) => (min === null || e.date < min ? e.date : min), null);
  const historyFrom = addDays(from, -HISTORY_DAYS);
  const historyStart = first && first > historyFrom ? first : historyFrom;
  const historyDays = first && first < from ? daysBetween(historyStart, from) : 0;
  const weight = historyDays ? Math.min(elapsed, BLEND_DAYS) / BLEND_DAYS : 1;

  const month = new Map();
  const history = new Map();
  const add = (map, key, pence) => map.set(key, (map.get(key) ?? 0) + pence);
  for (const e of entries) {
    if (!isDayToDay(e, excludeTrips)) continue;
    if (e.date >= from && e.date <= todayDate) add(month, keyOf(e), e.gbpPence);
    else if (weight < 1 && e.date >= historyStart && e.date < from) add(history, keyOf(e), e.gbpPence);
  }
  const rates = new Map();
  for (const key of new Set([...month.keys(), ...history.keys()])) {
    const own = (month.get(key) ?? 0) / elapsed;
    const past = historyDays ? (history.get(key) ?? 0) / historyDays : 0;
    rates.set(key, weight * own + (1 - weight) * past);
  }
  return { rates, elapsed, historyDays, weight };
}

/**
 * The month-end forecast for the month of todayDate:
 * spent so far + recurring costs still due + day-to-day pace × days after today.
 * spare = everything coming in this month − forecast (negative: more than you have).
 */
export function monthForecast({ entries, recurring = [], rates = [], todayDate, excludeTrips = false }) {
  const month = monthKey(todayDate);
  const hl = monthHeadline({ entries, recurring, rates, month, todayDate });
  const pace = dailyRates(entries, todayDate, { excludeTrips });
  const dailyPence = pace.rates.get('all') ?? 0;
  const daysAfter = daysBetween(todayDate, monthEnd(month));
  const projected = Math.round(dailyPence * daysAfter);
  const forecast = hl.spent + hl.costsDue + projected;
  return {
    month,
    end: monthEnd(month),
    spent: hl.spent,
    costsDue: hl.costsDue,
    dailyPence: Math.round(dailyPence),
    daysAfter,
    projected,
    forecast,
    coming: hl.incomeReceived + hl.incomeDue,
    spare: hl.incomeReceived + hl.incomeDue - forecast,
    blended: pace.weight < 1,
    estimated: hl.estimated,
  };
}

/**
 * Each category's forecast for the month of todayDate (spending to sort is left out):
 * Map(categoryId → { spent, costsDue, dailyPence, forecast }). Spent counts trips, as the
 * month total does; the pace leaves them out when the toggle is on.
 */
export function categoryForecasts({ entries, recurring = [], rates = [], todayDate, excludeTrips = false }) {
  const month = monthKey(todayDate);
  const from = monthStart(month);
  const to = monthEnd(month);
  const out = new Map();
  const row = (id) => {
    if (!out.has(id)) out.set(id, { categoryId: id, spent: 0, costsDue: 0, dailyPence: 0, forecast: 0 });
    return out.get(id);
  };
  for (const e of entries) {
    if (e.kind !== 'spend' || !isLive(e) || e.categoryId == null || e.gbpPence == null || e.date < from || e.date > to) continue;
    row(e.categoryId).spent += e.gbpPence;
  }
  for (const item of recurring) {
    if (item.kind !== 'spend' || !item.categoryId) continue;
    for (const _ of upcomingBetween(item, from, to)) row(item.categoryId).costsDue += estimateGbp(item.amountMinor, item.currency, rates);
  }
  const pace = dailyRates(entries.filter((e) => e.categoryId != null), todayDate, { excludeTrips, keyOf: (e) => e.categoryId });
  for (const [id, daily] of pace.rates) row(id).dailyPence = daily;
  const daysAfter = daysBetween(todayDate, to);
  for (const r of out.values()) {
    r.forecast = r.spent + r.costsDue + Math.round(r.dailyPence * daysAfter);
    r.dailyPence = Math.round(r.dailyPence);
  }
  return out;
}

/** "At this pace: £1,240 by 31 October, £40 more than you have." */
export function forecastLine(f) {
  const tilde = f.estimated ? '~' : '';
  const [, , d] = parse(f.end);
  const by = `${tilde}${gbpRounded(f.forecast)} by ${d} ${formatMonth(f.month).split(' ')[0]}`;
  if (f.spare < 0) return `At this pace: ${by}, ${tilde}${gbpRounded(-f.spare)} more than you have.`;
  return `At this pace: ${by}, ${tilde}${gbpRounded(f.spare)} to spare.`;
}

/**
 * The forecast as a row of the Overview totals: what the figure is, the figure, and how it compares.
 * { title: 'Spending by 31 Oct', amount: '£945', spare: '£55 to spare' | '£530 more than you have', over }
 */
export function forecastRow(f) {
  const tilde = f.estimated ? '~' : '';
  const [, , d] = parse(f.end);
  return {
    title: `Spending by ${d} ${formatMonth(f.month).split(' ')[0].slice(0, 3)}`,
    amount: `${tilde}${gbpRounded(f.forecast)}`,
    spare: f.spare < 0 ? `${tilde}${gbpRounded(-f.spare)} more than you have` : `${tilde}${gbpRounded(f.spare)} to spare`,
    over: f.spare < 0,
  };
}

/** How the forecast is counted, next to it. */
export function forecastReason(f) {
  const parts = [`${gbpRounded(f.spent)} spent`];
  if (f.costsDue) parts.push(`${gbpRounded(f.costsDue)} of recurring costs still due`);
  if (!f.daysAfter) return `Counts ${parts.join(' and ')}. Today is the last day of the month.`;
  const days = f.daysAfter === 1 ? 'the 1 day left' : `the ${f.daysAfter} days left`;
  parts.push(`about ${gbp(f.dailyPence)} a day for ${days}`);
  return `Counts ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
}
