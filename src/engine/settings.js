// Rules for what Settings edits: term dates, category order, payment method fees.
// Shared with the Worker, which checks the same things before saving.

import { toMinor, toDecimalText } from './money.js';
import { formatDay } from './dates.js';
import { isLive } from './totals.js';
import { termYearOf, termLabel } from './terms.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FEE_BPS = 10000;

/** "2.99" → 299 basis points. Returns null unless it's a percentage from 0 to 100. */
export function percentToBps(text) {
  const bps = toMinor(String(text ?? '').trim().replace(/%$/, '').trim() || '0', 'GBP');
  return bps === null || bps > MAX_FEE_BPS ? null : bps;
}

/** 299 → "2.99", 300 → "3", 0 → "0". */
export function bpsToPercent(bps) {
  return toDecimalText(bps ?? 0, 'GBP').replace(/\.?0+$/, '') || '0';
}

export const validFeeBps = (bps) => Number.isInteger(bps) && bps >= 0 && bps <= MAX_FEE_BPS;

/**
 * Checks term dates: [{ id, name, year, start, end }] (see terms.js). A term may be blank (both
 * dates null) or have both, ending on or after it starts, without overlapping another term,
 * and each year has each term once. Returns what to fix (a sentence fragment, like the
 * Worker's refusals) or null.
 */
export function checkTerms(terms) {
  if (!Array.isArray(terms)) return 'send the terms as a list.';
  for (const t of terms) {
    if (!t || typeof t.name !== 'string' || !t.name.trim() || typeof t.id !== 'string') return 'give every term a name.';
    const hasStart = t.start != null && t.start !== '';
    const hasEnd = t.end != null && t.end !== '';
    if (hasStart !== hasEnd) return `give ${t.name} term both a first and a last day.`;
    if (hasStart && (!DATE.test(t.start) || !DATE.test(t.end))) return `pick the dates for ${t.name} term.`;
    if (hasStart && t.end < t.start) return `end ${t.name} term on or after its first day.`;
    if (t.year != null && !Number.isInteger(t.year)) return `pick the year for ${t.name} term.`;
  }
  const seen = new Map();
  for (const t of terms.filter((x) => x.start)) {
    const key = `${t.name}:${t.year ?? termYearOf(t.start)}`;
    if (seen.has(key)) return `enter ${termLabel(seen.get(key))} once.`;
    seen.set(key, t);
  }
  const dated = terms.filter((t) => t.start).sort((a, b) => (a.start < b.start ? -1 : 1));
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].start <= dated[i - 1].end) return `start ${dated[i].name} term after ${dated[i - 1].name} term ends on ${formatDay(dated[i - 1].end)}.`;
  }
  return null;
}

/**
 * Moves a category up (-1) or down (+1) among the live, unarchived ones.
 * Returns the rows whose sort changes, as [{ id, sort }]: the two that swap, or every one
 * renumbered if their sort values weren't distinct. [] at the ends.
 */
export function moveCategory(categories, id, direction) {
  const list = categories.filter((c) => isLive(c) && !c.archived)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const i = list.findIndex((c) => c.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const distinct = new Set(list.map((c) => c.sort)).size === list.length;
  if (distinct) return [{ id: list[i].id, sort: list[j].sort }, { id: list[j].id, sort: list[i].sort }];
  const order = list.map((c) => c.id);
  [order[i], order[j]] = [order[j], order[i]];
  return order.map((cid, n) => ({ id: cid, sort: n })).filter((r) => list.find((c) => c.id === r.id).sort !== r.sort);
}

/** The sort value for a new category: after every other one. */
export const nextSort = (categories) => categories.reduce((m, c) => Math.max(m, c.sort ?? 0), -1) + 1;
