// The scheduled jobs: add recurring items that are due, refresh rates, and save the day's net worth.
// All are safe to run any number of times.

import { dueOccurrences, recurringEntry, priceEntry, tripFor, netWorth } from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { ensureRates } from './rates.js';

const ENTRY_DEFAULTS = Object.fromEntries(TABLES.entries.columns.map((c) => [c, TABLES.entries.defaults[c] ?? null]));

const feeOf = (methods, id) => methods.find((m) => m.id === id)?.feeBps ?? 0;

/**
 * Adds every occurrence due up to today (catching up on missed days) and moves nextDate on.
 * An occurrence already stored is skipped by the database (unique recurringId + occurrenceDate).
 */
export async function addRecurring(ctx) {
  const writes = await dueWrites(ctx, await ctx.store.live('recurring'));
  if (writes) await ctx.store.write(writes, ctx.now, { insertOnly: ['entries'] });
}

/**
 * The writes that add items' occurrences due up to today (write them with insertOnly entries),
 * or null when none is due. Saving a plan dated today or earlier uses it too, so the entry
 * lands with the plan instead of on the next run.
 */
export async function dueWrites(ctx, items) {
  const { store, today } = ctx;
  const [methods, trips, rates] = await Promise.all(['methods', 'trips', 'rates'].map((t) => store.live(t)));
  const entries = [];
  const moved = [];
  for (const item of items) {
    if (item.deletedAt) continue;
    const { dates, nextDate } = dueOccurrences(item, today);
    if (!dates.length) continue;
    for (const date of dates) {
      const entry = { ...ENTRY_DEFAULTS, ...recurringEntry(item, date), id: crypto.randomUUID(), gbpStatus: 'estimated', deletedAt: null };
      entries.push({ ...entry, tripId: tripFor(entry, trips) });
    }
    moved.push({ ...item, nextDate });
  }
  if (!entries.length) return null;
  const got = await ensureRates({ fetch: ctx.fetch, rates, needs: entries, today });
  const priced = entries.map((e) => priceEntry(e, { rates: got.rates, feeBps: feeOf(methods, e.methodId), todayDate: today }));
  return { entries: priced, recurring: moved, rates: got.fresh };
}

/**
 * Replaces estimates with each date's own rate once the date has passed, and keeps the latest
 * rates fresh for recurring items, entries still waiting and accounts. Statement amounts are never touched.
 */
export async function refreshRates(ctx) {
  const { store, today } = ctx;
  const [waiting, items, methods, rates, accounts] = await Promise.all([
    store.all('entries', "deletedAt IS NULL AND gbpStatus = 'estimated' AND currency != 'GBP'"),
    store.live('recurring'),
    store.live('methods'),
    store.live('rates'),
    store.live('accounts'),
  ]);
  // Net Worth converts each account at the latest rate, so its currencies stay fresh too.
  const alsoLatest = [...new Set([...items.filter((i) => i.active), ...waiting, ...accounts].map((x) => x.currency))].filter((c) => c !== 'GBP');
  const got = await ensureRates({ fetch: ctx.fetch, rates, needs: waiting, today, alsoLatest });
  const changed = [];
  for (const e of waiting) {
    const p = priceEntry(e, { rates: got.rates, feeBps: feeOf(methods, e.methodId), todayDate: today });
    if (p.gbpPence !== e.gbpPence || p.gbpStatus !== e.gbpStatus || p.rate !== e.rate || p.feePence !== e.feePence) changed.push(p);
  }
  await store.write({ entries: changed, rates: got.fresh }, ctx.now);
}

/**
 * Saves today's net worth in GBP for the chart (one row a day, id the date). Each run replaces
 * today's figure, so the last run of the day, after the markets close, is the one kept.
 * Nothing is written when there are no accounts or the figure hasn't moved.
 */
export async function saveSnapshot(ctx, prices) {
  const { store, today } = ctx;
  const [accounts, balances, rates, methods, entries, holdings, settlements, transfers] = await Promise.all(
    ['accounts', 'balances', 'rates', 'methods', 'entries', 'holdings', 'settlements', 'transfers'].map((t) => store.live(t)),
  );
  if (!accounts.length) return;
  const nw = netWorth({ accounts, balances, rates, methods, entries, holdings, prices, settlements, transfers, todayDate: today });
  if (!nw.groups.some((g) => g.accounts.some((r) => r.pence !== null))) return;
  const old = await store.get('snapshots', today);
  if (old && !old.deletedAt && old.gbpPence === nw.totalPence) return;
  await store.write({ snapshots: [{ id: today, date: today, gbpPence: nw.totalPence, deletedAt: null }] }, ctx.now);
}
