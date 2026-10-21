// Plan: recurring costs and income, what they come to each month, and what's next.

import { occurrencesUpTo } from './recurring.js';
import { estimateGbp } from './currency.js';
import { isLive } from './totals.js';
import { monthShare } from './allowance.js';
import { monthKey } from './dates.js';

// How many times each frequency happens in a year. Termly is every 4 months.
const PER_YEAR = { weekly: 52, monthly: 12, termly: 3, yearly: 1 };

/** What an item comes to in an average month, in GBP pence at the latest rate, rounded down. */
export function monthlyEquivalent(item, rates = []) {
  const gbpPence = estimateGbp(item.amountMinor, item.currency, rates);
  return Math.floor((gbpPence * (PER_YEAR[item.frequency] ?? 0)) / 12);
}

const byNext = (a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.label.localeCompare(b.label));

/**
 * Live recurring items split into costs and income, soonest first, paused ones last.
 * Totals are per average month and count active items only. estimated is true when a
 * foreign-currency item is in a total.
 * Income already logged but spread over months (the allowance) is coming in too while it lasts:
 * spread lists the ones covering this month, and this month's share is in monthlyIncome.
 */
export function planSummary(recurring, { rates = [], entries = [], todayDate = null } = {}) {
  const live = recurring.filter(isLive);
  const active = (i) => i.active !== 0 && i.active !== false;
  const sorted = (kind) => [...live.filter((i) => i.kind === kind && active(i)).sort(byNext),
    ...live.filter((i) => i.kind === kind && !active(i)).sort(byNext)];
  const total = (kind) => live.filter((i) => i.kind === kind && active(i)).reduce((s, i) => s + monthlyEquivalent(i, rates), 0);
  const month = todayDate && monthKey(todayDate);
  const spread = month ? entries.filter((e) => isLive(e) && e.kind === 'income' && (e.spreadMonths ?? 1) > 1)
    .map((e) => ({ entry: e, monthPence: monthShare(e, month) })).filter((x) => x.monthPence > 0) : [];
  return {
    costs: sorted('spend'),
    income: sorted('income'),
    spread,
    monthlyCosts: total('spend'),
    monthlyIncome: total('income') + spread.reduce((s, x) => s + x.monthPence, 0),
    estimated: live.some((i) => active(i) && i.currency !== 'GBP'),
  };
}

/** Occurrences on or before today that the next scheduled run will add (a start date in the past). */
export function catchUpDates(item, todayDate) {
  return occurrencesUpTo({ ...item, active: 1, deletedAt: null }, todayDate);
}
