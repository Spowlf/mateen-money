// One overall monthly spending budget, in GBP: the part of the month's money you mean to spend.
// A budget row says "from this month on": { id: 'month:YYYY-MM', categoryId: 'month', fromMonth, amountPence }.
// categoryId is always MONTH_BUDGET; rows left from per-category budgets are ignored.
// A month's budget is the latest live row starting on or before it, so changing the budget writes a
// row for this month and earlier months keep theirs. amountPence 0 means no budget from that month.
// Everything counts against it, as in the headline: recurring costs, trips and trip bookings.
// The Overview toggle only keeps trips out of the pace. Categories have no budgets; Overview shows
// each one's share of the budget instead.

import { monthKey, monthStart, monthEnd, formatMonth } from './dates.js';
import { periodTotals, isLive } from './totals.js';
import { monthForecast } from './forecast.js';
import { gbp, gbpRounded } from './money.js';

export const MONTH_BUDGET = 'month';

export const budgetId = (month) => `${MONTH_BUDGET}:${month}`;

/** The budget for a month, in pence. 0 when there is none. */
export function budgetFor(budgets, month) {
  let best = null;
  for (const b of budgets) {
    if (!isLive(b) || b.categoryId !== MONTH_BUDGET || b.fromMonth > month) continue;
    if (!best || b.fromMonth > best.fromMonth) best = b;
  }
  return best?.amountPence ?? 0;
}

/** The row that sets the budget from month on, or null if nothing would change. */
export function budgetChange(budgets, month, amountPence) {
  if (budgetFor(budgets, month) === amountPence) return null;
  return { id: budgetId(month), categoryId: MONTH_BUDGET, fromMonth: month, amountPence, deletedAt: null };
}

/**
 * The budget against spending in month, or null when there's no budget.
 * The month in progress counts recurring costs still due as used, and has a forecast;
 * status is 'over' (spent and due come to more than the budget), 'heading' (forecast to go over)
 * or 'ok'. Past months are budget against actual, with no forecast.
 */
export function budgetStatus({ entries, trips = [], budgets = [], recurring = [], rates = [], month, todayDate, excludeTrips = false }) {
  const budgetPence = budgetFor(budgets, month);
  if (!budgetPence) return null;
  const current = month === monthKey(todayDate);
  let spentPence;
  let costsDue = 0;
  let forecastPence = null;
  if (current) {
    const f = monthForecast({ entries, trips, recurring, rates, todayDate, excludeTrips });
    spentPence = f.spent;
    costsDue = f.costsDue;
    forecastPence = f.forecast;
  } else {
    spentPence = periodTotals(entries, { from: monthStart(month), to: monthEnd(month) }).spent;
  }
  const usedPence = spentPence + costsDue;
  const leftPence = budgetPence - usedPence;
  const status = leftPence < 0 ? 'over' : forecastPence !== null && forecastPence > budgetPence ? 'heading' : 'ok';
  return {
    month,
    budgetPence,
    spentPence,
    costsDue,
    leftPence,
    forecastPence,
    status,
    share: Math.min(usedPence / budgetPence, 1),
  };
}

/** Beside the budget: "£180.00 left", "£20.00 over" or "On track for £540". */
export function budgetStatusText(b) {
  if (b.status === 'over') return `${gbp(-b.leftPence)} over`;
  if (b.status === 'heading') return `On track for ${gbpRounded(b.forecastPence)}`;
  return `${gbp(b.leftPence)} left`;
}

/** How the budget is used so far: "£300 spent and £15 still due". */
export function budgetDetail(b) {
  const due = b.costsDue ? ` and ${gbp(b.costsDue, { whole: true })} still due` : '';
  return `${gbp(b.spentPence, { whole: true })} spent${due}`;
}

/** The line on Log for a payment: "£180 of your £500 budget left this month." */
export function budgetLogLine(b) {
  const of = `your ${gbp(b.budgetPence, { whole: true })} budget`;
  if (b.leftPence < 0) return `${gbp(-b.leftPence, { whole: true })} over ${of} this month.`;
  return `${gbp(b.leftPence, { whole: true })} of ${of} left this month.`;
}

/** The weekly review's warning, or null when the budget is on track. */
export function budgetWarningLine(b) {
  if (!b || b.status === 'ok') return null;
  const of = `your ${gbp(b.budgetPence, { whole: true })} budget for ${formatMonth(b.month).split(' ')[0]}`;
  if (b.status === 'over') return `${gbp(-b.leftPence, { whole: true })} over ${of}.`;
  return `On track for ${gbpRounded(b.forecastPence)} of ${of}.`;
}

/** Pounds as typed ("500", "500.50") to pence; '' is no budget (0). null if it can't be read. */
export function budgetPence(text) {
  const s = String(text ?? '').trim().replace(/^£/, '').replace(/,/g, '');
  if (!s) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
