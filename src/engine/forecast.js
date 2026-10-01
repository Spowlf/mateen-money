// Safe to spend today and the month-end forecast.
// Safe to spend is the headline (budget left, or income left without a budget) ÷ the days left,
// today included, so it always counts trips. It's an allowance, never the pace.
// The forecast adds day-to-day spending at this month's pace to what's spent and still due.
// Day-to-day spending leaves out recurring items, bookings for a trip (filed under it but paid
// outside its dates), and trips when the Overview toggle is on, so one trip doesn't set the
// pace for the rest of the month.

import { addDays, daysBetween, monthKey, monthStart, monthEnd, parse, formatMonth } from './dates.js';
import { monthHeadline } from './headline.js';
import { isLive } from './totals.js';
import { gbp } from './money.js';

export const BLEND_DAYS = 7;          // days 1–7 blend this month with the 8 weeks before it
export const HISTORY_DAYS = 56;       // the 8 weeks before the month

/**
 * { perDay } (pence, rounded down) or { over } when the headline is negative. null outside the month.
 * figure is headlineFigure() (or anything with left and daysLeft).
 */
export function safeToSpend(figure) {
  if (!figure.daysLeft) return null;
  if (figure.left < 0) return { over: -figure.left, daysLeft: figure.daysLeft };
  return { perDay: Math.floor(figure.left / figure.daysLeft), daysLeft: figure.daysLeft };
}

/**
 * "To stay within budget, spend no more than £12.40 a day." or "Over budget by £30.00 this month."
 * Worded as a limit, so it can't be read as the pace or as a target to spend.
 * basis is the headline's: 'budget', or 'income' with no budget.
 */
export function safeToSpendLine(safe, month, { estimated = false, basis = 'income' } = {}) {
  if (!safe) return null;
  const tilde = estimated ? '~' : '';
  const within = basis === 'budget' ? 'within budget' : 'within this month’s income';
  if (safe.over !== undefined) return `${basis === 'budget' ? 'Over budget' : 'Over'} by ${tilde}${gbp(safe.over)} this month.`;
  if (safe.daysLeft === 1) return `To stay ${within}, spend no more than ${tilde}${gbp(safe.perDay)} today, the last day of ${formatMonth(month).split(' ')[0]}.`;
  return `To stay ${within}, spend no more than ${tilde}${gbp(safe.perDay)} a day.`;
}

const onTrip = (e, excludeTrips) => !!e.tripId && (excludeTrips === true || (excludeTrips instanceof Set && excludeTrips.has(e.tripId)));

/**
 * A payment filed under a live trip but dated outside it: a flight booked in November for a
 * January trip. tripsById holds live trips only, so a deleted trip's payments are ordinary.
 */
export const isTripBooking = (e, tripsById) => {
  const trip = e.tripId ? tripsById.get(e.tripId) : null;
  return !!trip && (e.date < trip.start || e.date > trip.end);
};

/**
 * Live, priced spending that isn't a recurring item or a trip booking
 * (and isn't on a trip, when trips are left out).
 */
export const isDayToDay = (e, excludeTrips = false, tripsById = new Map()) => e.kind === 'spend' && isLive(e) && e.gbpPence != null
  && !e.recurringId && !(excludeTrips && onTrip(e, excludeTrips)) && !isTripBooking(e, tripsById);

/**
 * Day-to-day pence per day for the month of todayDate, by key (keyOf(entry), e.g. its category).
 * Days 1–7 blend this month's average with the 8 weeks before the month, weighted by days
 * elapsed (day 3: 3/7 this month, 4/7 history). From day 7 it's this month's average alone.
 * History only counts days from the first logged payment; with none, this month stands alone.
 * Returns { rates: Map(key → pence a day, unrounded), elapsed, historyDays, weight }.
 */
export function dailyRates(entries, todayDate, { trips = [], excludeTrips = false, keyOf = () => 'all' } = {}) {
  const tripsById = new Map(trips.filter(isLive).map((t) => [t.id, t]));
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
    if (!isDayToDay(e, excludeTrips, tripsById)) continue;
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
export function monthForecast({ entries, trips = [], recurring = [], rates = [], todayDate, excludeTrips = false }) {
  const month = monthKey(todayDate);
  const hl = monthHeadline({ entries, recurring, rates, month, todayDate });
  const pace = dailyRates(entries, todayDate, { trips, excludeTrips });
  // Rounded to the penny first, so the reason's sum ("£X spent and about £Y a day for N days") adds up exactly.
  const dailyPence = Math.round(pace.rates.get('all') ?? 0);
  const daysAfter = daysBetween(todayDate, monthEnd(month));
  const projected = dailyPence * daysAfter;
  const forecast = hl.spent + hl.costsDue + projected;
  return {
    month,
    end: monthEnd(month),
    spent: hl.spent,
    costsDue: hl.costsDue,
    dailyPence,
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
 * How the forecast compares: with a budget (pence), against it ("£94.96 over budget"),
 * otherwise against everything coming in this month ("£55.00 to spare").
 */
function forecastCompare(f, budgetPence) {
  const tilde = f.estimated ? '~' : '';
  if (budgetPence) {
    const spare = budgetPence - f.forecast;
    return { text: spare < 0 ? `${tilde}${gbp(-spare)} over budget` : `${tilde}${gbp(spare)} under budget`, over: spare < 0 };
  }
  return { text: f.spare < 0 ? `${tilde}${gbp(-f.spare)} more than you have` : `${tilde}${gbp(f.spare)} to spare`, over: f.spare < 0 };
}

/** "At this pace: £1,240.00 by 31 October, £40.00 over budget." */
export function forecastLine(f, budgetPence = 0) {
  const tilde = f.estimated ? '~' : '';
  const [, , d] = parse(f.end);
  return `At this pace: ${tilde}${gbp(f.forecast)} by ${d} ${formatMonth(f.month).split(' ')[0]}, ${forecastCompare(f, budgetPence).text}.`;
}

/**
 * The forecast as a row of the Overview totals: what the figure is, the figure, and how it compares
 * (with the budget when there is one).
 * { title: 'Spending by 31 Oct', amount: '£945.00', spare: '£55.00 to spare' | '£94.96 over budget' | …, over }
 */
export function forecastRow(f, budgetPence = 0) {
  const tilde = f.estimated ? '~' : '';
  const [, , d] = parse(f.end);
  const c = forecastCompare(f, budgetPence);
  return {
    title: `Spending by ${d} ${formatMonth(f.month).split(' ')[0].slice(0, 3)}`,
    amount: `${tilde}${gbp(f.forecast)}`,
    spare: c.text,
    over: c.over,
  };
}

/** How the forecast is counted, next to it. */
export function forecastReason(f) {
  const parts = [`${gbp(f.spent)} spent`];
  if (f.costsDue) parts.push(`${gbp(f.costsDue)} of recurring costs still due`);
  if (!f.daysAfter) return `Counts ${parts.join(' and ')}. Today is the last day of the month.`;
  const days = f.daysAfter === 1 ? 'the 1 day left' : `the ${f.daysAfter} days left`;
  parts.push(`about ${gbp(f.dailyPence)} a day for ${days}`);
  return `Counts ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
}
