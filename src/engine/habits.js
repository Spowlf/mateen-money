// Habits worth a second look: a merchant you keep going back to, and lots of small buys in one
// category. Facts only, never advice: the app can't see prices, so it never claims a saving.

import { addDays } from './dates.js';
import { gbp } from './money.js';
import { isLive } from './totals.js';
import { normaliseMerchant } from './vendors.js';
import { tidyName } from './form.js';

export const HABIT_DAYS = 28;            // the 4 weeks ending on the review week's Sunday
export const FREQUENT_VISITS = 8;        // twice a week or more
export const SMALL_MAX = 500;            // a small buy is under £5
export const SMALL_BUYS = 8;
export const HABIT_MIN_PENCE = 2000;     // and it has to add up to £20
export const HABIT_LIMIT = 3;

/**
 * Up to 3 habits in the 4 weeks ending on end, largest total first:
 * { kind: 'merchant', key, name, count, pence } or { kind: 'small', key, name, count, pence }.
 * Day-to-day spending only: recurring costs and spending on a live trip don't count (a trip
 * isn't a habit). A merchant is its vendor, or its cleaned name while it waits in To sort.
 * A category's small buys are left out when the merchant habits already cover most of them.
 */
export function findHabits({ entries, vendors = [], categories = [], trips = [], end }) {
  const from = addDays(end, -(HABIT_DAYS - 1));
  const liveTrips = new Set(trips.filter(isLive).map((t) => t.id));
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const spends = entries.filter((e) => isLive(e) && e.kind === 'spend' && e.date >= from && e.date <= end
    && e.source !== 'recurring' && !(e.tripId && liveTrips.has(e.tripId)));

  const byMerchant = new Map();
  for (const e of spends) {
    const key = e.vendorId ?? normaliseMerchant(e.merchant);
    if (!key) continue;
    const m = byMerchant.get(key) ?? { kind: 'merchant', key, name: vendorName.get(e.vendorId) ?? tidyName(e.merchant), count: 0, pence: 0, ids: new Set() };
    m.count++; m.pence += e.gbpPence ?? 0; m.ids.add(e.id);
    byMerchant.set(key, m);
  }
  const merchants = [...byMerchant.values()].filter((m) => m.count >= FREQUENT_VISITS && m.pence >= HABIT_MIN_PENCE);

  const byCategory = new Map();
  for (const e of spends) {
    if (e.categoryId == null || (e.gbpPence ?? 0) >= SMALL_MAX) continue;
    const c = byCategory.get(e.categoryId) ?? { kind: 'small', key: e.categoryId, name: categories.find((x) => x.id === e.categoryId)?.name ?? 'Other', count: 0, pence: 0, ids: [] };
    c.count++; c.pence += e.gbpPence ?? 0; c.ids.push(e.id);
    byCategory.set(e.categoryId, c);
  }
  const inMerchants = new Set(merchants.flatMap((m) => [...m.ids]));
  const covered = (c) => c.ids.filter((id) => inMerchants.has(id)).length * 2 > c.count;
  const small = [...byCategory.values()].filter((c) => c.count >= SMALL_BUYS && c.pence >= HABIT_MIN_PENCE && !covered(c));

  return [...merchants, ...small]
    .sort((a, b) => b.pence - a.pence || b.count - a.count || (a.name < b.name ? -1 : 1))
    .slice(0, HABIT_LIMIT)
    .map(({ kind, key, name, count, pence }) => ({ kind, key, name, count, pence }));
}

/** "Tesco: 14 times in 4 weeks, £63.20 in all." or "Coffee and Snacks: 11 buys under £5.00 in 4 weeks, £31.40 in all." */
export function habitLine(h) {
  if (h.kind === 'merchant') return `${h.name}: ${h.count} times in 4 weeks, ${gbp(h.pence)} in all.`;
  return `${h.name}: ${h.count} buys under ${gbp(SMALL_MAX)} in 4 weeks, ${gbp(h.pence)} in all.`;
}
