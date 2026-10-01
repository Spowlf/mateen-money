// Monthly budgets per category, in GBP.
// A budget row says "from this month on": { id: 'categoryId:YYYY-MM', categoryId, fromMonth, amountPence }.
// A month's budget is the latest live row starting on or before it, so changing a budget writes a
// row for this month and earlier months keep theirs. amountPence 0 means no budget from that month.
// Every month's amount can be read back, so a rollover can be added later without a migration.
// Spending counts trips (it's real money); the Overview toggle only keeps trips out of the pace.

import { monthKey, monthStart, monthEnd, formatMonth } from './dates.js';
import { categoryRows, isLive } from './totals.js';
import { categoryForecasts } from './forecast.js';
import { gbp, gbpRounded } from './money.js';

export const budgetId = (categoryId, month) => `${categoryId}:${month}`;

/** The budget for a category in a month, in pence. 0 when there is none. */
export function budgetFor(budgets, categoryId, month) {
  let best = null;
  for (const b of budgets) {
    if (!isLive(b) || b.categoryId !== categoryId || b.fromMonth > month) continue;
    if (!best || b.fromMonth > best.fromMonth) best = b;
  }
  return best?.amountPence ?? 0;
}

/** Map(categoryId → pence) of every category with a budget in month. */
export function monthBudgets(budgets, month) {
  const out = new Map();
  for (const id of new Set(budgets.filter(isLive).map((b) => b.categoryId))) {
    const pence = budgetFor(budgets, id, month);
    if (pence > 0) out.set(id, pence);
  }
  return out;
}

/** The row that sets a category's budget from month on, or null if nothing would change. */
export function budgetChange(budgets, categoryId, month, amountPence) {
  if (budgetFor(budgets, categoryId, month) === amountPence) return null;
  return { id: budgetId(categoryId, month), categoryId, fromMonth: month, amountPence, deletedAt: null };
}

/**
 * Budget against spending for each budgeted category in month, in category order.
 * The month in progress also has a forecast; status is 'over' (spent more than the budget),
 * 'heading' (forecast to go over) or 'ok'. Past months have no forecast.
 */
export function budgetRows({ entries, categories, budgets = [], recurring = [], rates = [], month, todayDate, excludeTrips = false }) {
  const amounts = monthBudgets(budgets, month);
  if (!amounts.size) return [];
  const current = month === monthKey(todayDate);
  const forecasts = current ? categoryForecasts({ entries, recurring, rates, todayDate, excludeTrips }) : null;
  const spentRows = current ? null : new Map(categoryRows(entries, categories, { from: monthStart(month), to: monthEnd(month) }).map((r) => [r.categoryId, r.pence]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = [];
  for (const [categoryId, budgetPence] of amounts) {
    const category = byId.get(categoryId);
    // A removed category's budget stays in its old months, but not in this one.
    if (!category || (category.archived && month >= monthKey(todayDate))) continue;
    const spentPence = current ? forecasts.get(categoryId)?.spent ?? 0 : spentRows.get(categoryId) ?? 0;
    const forecastPence = current ? Math.max(forecasts.get(categoryId)?.forecast ?? 0, spentPence) : null;
    const status = spentPence > budgetPence ? 'over' : forecastPence !== null && forecastPence > budgetPence ? 'heading' : 'ok';
    out.push({
      categoryId,
      name: category.name,
      sort: category.sort ?? 999,
      budgetPence,
      spentPence,
      leftPence: budgetPence - spentPence,
      forecastPence,
      status,
      share: Math.min(spentPence / budgetPence, 1),
    });
  }
  return out.sort((a, b) => a.sort - b.sort);
}

/** "£12.50 left", "£5.20 over" or "On track for £180 of £150". */
export function budgetStatusText(r) {
  if (r.status === 'over') return `${gbp(-r.leftPence)} over`;
  if (r.status === 'heading') return `On track for ${gbpRounded(r.forecastPence)} of ${gbp(r.budgetPence, { whole: true })}`;
  return `${gbp(r.leftPence)} left`;
}

/** The line on Log under the categories: "Eating out: £34 left this month." */
export function budgetLogLine(r) {
  if (r.leftPence < 0) return `${r.name}: ${gbp(-r.leftPence, { whole: true })} over this month.`;
  return `${r.name}: ${gbp(r.leftPence, { whole: true })} left this month.`;
}

/** Budget warnings for the weekly review: over, or forecast to go over, this month. */
export function budgetWarnings(rows) {
  return rows.filter((r) => r.status !== 'ok');
}

/** "Food: £20 over its £150 budget for October." or "Food: on track for £180 of its £150 budget for October." */
export function budgetWarningLine(r, month) {
  const of = `its ${gbp(r.budgetPence, { whole: true })} budget for ${formatMonth(month).split(' ')[0]}`;
  if (r.status === 'over') return `${r.name}: ${gbp(-r.leftPence, { whole: true })} over ${of}.`;
  return `${r.name}: on track for ${gbpRounded(r.forecastPence)} of ${of}.`;
}

/** Pounds as typed ("150", "150.50") to pence; '' is no budget (0). null if it can't be read. */
export function budgetPence(text) {
  const s = String(text ?? '').trim().replace(/^£/, '').replace(/,/g, '');
  if (!s) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
