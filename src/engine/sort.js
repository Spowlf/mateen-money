// One-tap choices for entries in "To sort".

import { addDays } from './dates.js';
import { matchVendor } from './vendors.js';
import { isLive } from './totals.js';

export const TO_SORT_NUDGE = 10;
const RECENT_DAYS = 90;

/**
 * The n most-used categories: by count over the last 90 days, then all time, ties by the
 * categories' own order, topped up from that order so there are always n (if n exist).
 */
export function topCategories(entries, categories, { todayDate, n = 4 } = {}) {
  const live = categories.filter((c) => isLive(c) && !c.archived);
  const liveIds = new Set(live.map((c) => c.id));
  const since = todayDate ? addDays(todayDate, -RECENT_DAYS) : '0000-01-01';
  const recent = new Map();
  const ever = new Map();
  for (const e of entries) {
    if (!isLive(e) || e.kind !== 'spend' || !liveIds.has(e.categoryId)) continue;
    ever.set(e.categoryId, (ever.get(e.categoryId) ?? 0) + 1);
    if (e.date >= since) recent.set(e.categoryId, (recent.get(e.categoryId) ?? 0) + 1);
  }
  const ranked = [...live].sort((a, b) => (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0)
    || (ever.get(b.id) ?? 0) - (ever.get(a.id) ?? 0)
    || a.sort - b.sort);
  return ranked.slice(0, n);
}

/**
 * Choices for one To sort entry: its most likely vendor (by alias similarity; never an exact
 * match, which would already have been applied) and the top 4 categories.
 */
export function sortChoices(entry, { vendors = [], aliases = [], entries = [], categories = [], todayDate }) {
  const { exact, suggestion } = matchVendor(entry.merchant, vendors, aliases);
  return {
    vendor: exact ?? suggestion ?? null,
    categories: topCategories(entries, categories, { todayDate, n: 4 }),
  };
}

/** "10 to sort. It takes about a minute." once more than 10 are waiting. */
export function toSortNudge(count) {
  return count > TO_SORT_NUDGE ? `${count} to sort. It takes about a minute.` : null;
}
