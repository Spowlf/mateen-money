// Plan: recurring costs and income, what they come to each month, and what's next.

import { occurrencesUpTo } from './recurring.js';
import { estimateGbp } from './currency.js';
import { isLive } from './totals.js';

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
 */
export function planSummary(recurring, { rates = [] } = {}) {
  const live = recurring.filter(isLive);
  const active = (i) => i.active !== 0 && i.active !== false;
  const sorted = (kind) => [...live.filter((i) => i.kind === kind && active(i)).sort(byNext),
    ...live.filter((i) => i.kind === kind && !active(i)).sort(byNext)];
  const total = (kind) => live.filter((i) => i.kind === kind && active(i)).reduce((s, i) => s + monthlyEquivalent(i, rates), 0);
  return {
    costs: sorted('spend'),
    income: sorted('income'),
    monthlyCosts: total('spend'),
    monthlyIncome: total('income'),
    estimated: live.some((i) => active(i) && i.currency !== 'GBP'),
  };
}

/** Occurrences on or before today that the next scheduled run will add (a start date in the past). */
export function catchUpDates(item, todayDate) {
  return occurrencesUpTo({ ...item, active: 1, deletedAt: null }, todayDate);
}
