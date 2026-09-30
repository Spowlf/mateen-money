// The scheduled jobs: add recurring items that are due, and refresh rates.
// Both are safe to run any number of times.

import { dueOccurrences, recurringEntry, priceEntry, tripFor } from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { ensureRates } from './rates.js';

const ENTRY_DEFAULTS = Object.fromEntries(TABLES.entries.columns.map((c) => [c, TABLES.entries.defaults[c] ?? null]));

const feeOf = (methods, id) => methods.find((m) => m.id === id)?.feeBps ?? 0;

/**
 * Adds every occurrence due up to today (catching up on missed days) and moves nextDate on.
 * An occurrence already stored is skipped by the database (unique recurringId + occurrenceDate).
 */
export async function addRecurring(ctx) {
  const { store, today } = ctx;
  const [items, methods, trips, rates] = await Promise.all(['recurring', 'methods', 'trips', 'rates'].map((t) => store.live(t)));
  const entries = [];
  const moved = [];
  for (const item of items) {
    const { dates, nextDate } = dueOccurrences(item, today);
    if (!dates.length) continue;
    for (const date of dates) {
      const entry = { ...ENTRY_DEFAULTS, ...recurringEntry(item, date), id: crypto.randomUUID(), gbpStatus: 'estimated', deletedAt: null };
      entries.push({ ...entry, tripId: tripFor(entry, trips) });
    }
    moved.push({ ...item, nextDate });
  }
  if (!entries.length) return;
  const got = await ensureRates({ fetch: ctx.fetch, rates, needs: entries, today });
  const priced = entries.map((e) => priceEntry(e, { rates: got.rates, feeBps: feeOf(methods, e.methodId), todayDate: today }));
  await store.write({ entries: priced, recurring: moved, rates: got.fresh }, ctx.now, { insertOnly: ['entries'] });
}

/**
 * Replaces estimates with each date's own rate once the date has passed, and keeps the latest
 * rates fresh for recurring items and entries still waiting. Statement amounts are never touched.
 */
export async function refreshRates(ctx) {
  const { store, today } = ctx;
  const [waiting, items, methods, rates] = await Promise.all([
    store.all('entries', "deletedAt IS NULL AND gbpStatus = 'estimated' AND currency != 'GBP'"),
    store.live('recurring'),
    store.live('methods'),
    store.live('rates'),
  ]);
  const alsoLatest = [...new Set([...items.filter((i) => i.active), ...waiting].map((x) => x.currency))].filter((c) => c !== 'GBP');
  const got = await ensureRates({ fetch: ctx.fetch, rates, needs: waiting, today, alsoLatest });
  const changed = [];
  for (const e of waiting) {
    const p = priceEntry(e, { rates: got.rates, feeBps: feeOf(methods, e.methodId), todayDate: today });
    if (p.gbpPence !== e.gbpPence || p.gbpStatus !== e.gbpStatus || p.rate !== e.rate || p.feePence !== e.feePence) changed.push(p);
  }
  await store.write({ entries: changed, rates: got.fresh }, ctx.now);
}
