// Recurring costs and income. An item's nextDate is the next occurrence not yet added;
// it advances only when that occurrence's entry is added, so "still due" never double counts.

import { addDays, addMonths, parse } from './dates.js';
import { defaultSpreadStart } from './allowance.js';

const MONTHS_PER = { monthly: 1, termly: 4, yearly: 12 };
const MAX_STEPS = 1000;

/** The occurrence after date. Monthly items keep their day (the 31st comes back after February). */
export function step(date, frequency, anchorDay) {
  if (frequency === 'weekly') return addDays(date, 7);
  const months = MONTHS_PER[frequency];
  if (!months) throw new Error(`Unknown frequency ${frequency}`);
  return addMonths(date, months, anchorDay ?? parse(date)[2]);
}

const isLive = (item) => !item.deletedAt && item.active !== 0 && item.active !== false;

/** Occurrences from item.nextDate up to and including upTo. */
export function occurrencesUpTo(item, upTo) {
  const out = [];
  if (!isLive(item) || !item.nextDate) return out;
  let d = item.nextDate;
  for (let i = 0; d <= upTo && i < MAX_STEPS; i++) {
    out.push(d);
    d = step(d, item.frequency, item.anchorDay);
  }
  return out;
}

/**
 * What the scheduled job should add today: every occurrence up to today (catching up on
 * missed days), and the nextDate to store afterwards.
 */
export function dueOccurrences(item, todayDate) {
  const dates = occurrencesUpTo(item, todayDate);
  if (!dates.length) return { dates, nextDate: item.nextDate };
  return { dates, nextDate: step(dates[dates.length - 1], item.frequency, item.anchorDay) };
}

/** Occurrences not yet added that fall in [from, to]. */
export function upcomingBetween(item, from, to) {
  return occurrencesUpTo(item, to).filter((d) => d >= from);
}

/** The entry an occurrence becomes (id and GBP fields are added by the caller). */
export function recurringEntry(item, date) {
  const spread = (item.spreadMonths ?? 1) > 1;
  return {
    kind: item.kind,
    date,
    time: null,
    at: null,
    amountMinor: item.amountMinor,
    currency: item.currency,
    merchant: item.label,
    vendorId: item.vendorId ?? null,
    categoryId: item.kind === 'spend' ? item.categoryId ?? null : null,
    incomeType: item.kind === 'income' ? item.incomeType ?? 'other' : null,
    methodId: item.methodId ?? null,
    note: null,
    tripId: null,
    tripManual: 0,
    source: 'recurring',
    recurringId: item.id,
    occurrenceDate: date,
    spreadStart: spread ? defaultSpreadStart(date, { incomeType: item.incomeType, spreadMonths: item.spreadMonths }) : null,
    spreadMonths: spread ? item.spreadMonths : 1,
    needsCurrency: 0,
    symbol: null,
  };
}
