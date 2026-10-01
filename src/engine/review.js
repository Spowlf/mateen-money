// The weekly review: when it's due, the streak, and categories that ran high.

import { addDays, monthKey } from './dates.js';
import { reviewWeek, usualWeeks, weekSummary } from './summary.js';
import { categoryRows, isLive } from './totals.js';
import { gbp } from './money.js';
import { budgetStatus } from './budgets.js';
import { findHabits } from './habits.js';

export const UNUSUAL_RATIO = 1.5;        // more than 50% above the 8-week average
export const UNUSUAL_MIN_EXTRA = 1500;   // and at least £15 above it, so a tiny usual doesn't flag every week
export const NEW_CATEGORY_MIN = 2000;    // £20: a category with no history counts as unusual from here

/**
 * The review is due from Sunday for the week ending that Sunday, until it's completed.
 * reviews are { weekStart, completedAt }. Not due before anything was logged that week or earlier.
 */
export function reviewDue({ todayDate, reviews = [], entries = [] }) {
  const weekStart = reviewWeek(todayDate);
  const weekEnd = addDays(weekStart, 6);
  const done = reviews.some((r) => isLive(r) && r.weekStart === weekStart);
  const hasData = entries.some((e) => isLive(e) && e.date <= weekEnd);
  return { due: !done && hasData, weekStart, weekEnd };
}

/**
 * Weeks reviewed in a row, counting back from the review week. If this week's review isn't
 * done yet, the streak still counts up to last week.
 */
export function reviewStreak(reviews, todayDate) {
  const done = new Set(reviews.filter(isLive).map((r) => r.weekStart));
  let ws = reviewWeek(todayDate);
  if (!done.has(ws)) ws = addDays(ws, -7);
  let n = 0;
  while (done.has(ws)) { n++; ws = addDays(ws, -7); }
  return n;
}

/**
 * Categories more than 50% and at least £15 above their average over the usual weeks
 * (extraPence is how far above). A category with no spending in those weeks counts if it
 * reached £20 (pct is null). Largest excess first.
 */
export function unusualCategories({ entries, categories, weekStart }) {
  const weekEnd = addDays(weekStart, 6);
  const weeks = usualWeeks(entries, weekStart);
  if (!weeks.length) return [];
  const history = new Map();
  for (const ws of weeks) {
    for (const r of categoryRows(entries, categories, { from: ws, to: addDays(ws, 6) })) {
      history.set(r.categoryId, (history.get(r.categoryId) ?? 0) + r.pence);
    }
  }
  const out = [];
  for (const r of categoryRows(entries, categories, { from: weekStart, to: weekEnd })) {
    if (r.categoryId === null) continue;
    const averagePence = Math.round((history.get(r.categoryId) ?? 0) / weeks.length);
    if (averagePence === 0) {
      if (r.pence >= NEW_CATEGORY_MIN) out.push({ ...r, averagePence, pct: null });
    } else if (r.pence > averagePence * UNUSUAL_RATIO && r.pence - averagePence >= UNUSUAL_MIN_EXTRA) {
      out.push({ ...r, averagePence, extraPence: r.pence - averagePence, pct: Math.round(((r.pence - averagePence) / averagePence) * 100) });
    }
  }
  return out.sort((a, b) => (b.pence - b.averagePence) - (a.pence - a.averagePence));
}

/** "Groceries: £95.00, £35.00 more than your usual £60.00." Pounds, not a percentage, which runs wild on a small usual. */
export function unusualLine(u) {
  if (u.pct === null) return `${u.name}: ${gbp(u.pence)}, with nothing here in the weeks before.`;
  return `${u.name}: ${gbp(u.pence)}, ${gbp(u.pence - u.averagePence)} more than your usual ${gbp(u.averagePence)}.`;
}

/** The review's steps. Sorting comes first, and only while something is waiting. */
export const reviewSteps = ({ toSort }) => (toSort > 0 ? ['sort', 'week', 'unusual'] : ['week', 'unusual']);

/**
 * Everything the review card on Log shows, or null when no review is due. budget is this month's
 * budget status (null with no budget); a warning shows with anything unusual when it isn't 'ok'.
 * habits are the 4 weeks' frequent buys (see habits.js), shown in the same step.
 */
export function reviewCard({ entries, categories, vendors = [], trips = [], reviews = [], todayDate, budgets = [], recurring = [], rates = [], excludeTrips = false }) {
  const { due, weekStart, weekEnd } = reviewDue({ todayDate, reviews, entries });
  if (!due) return null;
  const summary = weekSummary({ entries, categories, todayDate, start: weekStart });
  return {
    weekStart,
    weekEnd,
    summary,
    unusual: unusualCategories({ entries, categories, weekStart }),
    habits: findHabits({ entries, vendors, categories, trips, end: weekEnd }),
    streak: reviewStreak(reviews, todayDate),
    toSort: summary.toSort,
    month: monthKey(todayDate),
    budget: budgetStatus({ entries, trips, budgets, recurring, rates, month: monthKey(todayDate), todayDate, excludeTrips }),
  };
}
