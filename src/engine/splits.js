// Split payments: a bill shared with other people. The payment keeps the full amount charged
// (so card balances, Apple Pay duplicates and statements still see the real charge); the user's
// own share is what counts as spending. Who owes whom is kept per person and per currency until
// it's settled up, whole, into or out of an account.
//
// splits:      { id, entryId, personId, amountMinor, currency, direction, settlementId }, one per
//              person per bill, in the bill's currency. direction 'owedToMe' (the user paid) or
//              'iOwe' (that person paid the whole bill: entries.paidBy is their id).
// settlements: { id, personId, date, amountMinor, currency, direction ('in' | 'out'), accountId }.
// See docs/superpowers/specs/2026-10-07-split-expenses-design.md.

import { formatMoney } from './money.js';
import { isLive } from './totals.js';

export const OWED_TO_ME = 'owedToMe';
export const I_OWE = 'iOwe';

/**
 * A bill split evenly between count people, the user included. Each other person gets the same
 * whole number of minor units; what's left over goes to the user, never to a friend.
 * Returns { eachMinor, mineMinor }.
 */
export function evenSplit(totalMinor, count) {
  if (!(count >= 1)) return { eachMinor: 0, mineMinor: totalMinor };
  const eachMinor = Math.floor(totalMinor / count);
  return { eachMinor, mineMinor: totalMinor - eachMinor * (count - 1) };
}

/** An entry's live splits. */
export const splitsOf = (splits, entryId) => splits.filter((s) => isLive(s) && s.entryId === entryId);

const sum = (rows) => rows.reduce((total, s) => total + s.amountMinor, 0);

/**
 * The user's share of a payment, in its own currency. Unsplit: all of it. A friend paid: the one
 * split the user owes them. The user paid: the amount less what the others owe.
 */
export function shareMinor(entry, splits) {
  const own = splitsOf(splits, entry.id);
  if (!own.length) return entry.amountMinor;
  if (entry.paidBy) return sum(own.filter((s) => s.direction === I_OWE));
  return entry.amountMinor - sum(own.filter((s) => s.direction === OWED_TO_ME));
}

/**
 * The user's share in pence: the payment's GBP value (fee included) in proportion, so the fee is
 * shared too. null while the payment has no GBP value; an unsplit payment's own value.
 */
export function shareGbpPence(entry, splits) {
  if (entry.gbpPence == null) return null;
  const share = shareMinor(entry, splits);
  if (share === entry.amountMinor || !entry.amountMinor) return entry.gbpPence;
  return Math.round((entry.gbpPence * share) / entry.amountMinor);
}

/** True when a payment is split (with anyone, either way). */
export const isSplit = (entry, splits) => splitsOf(splits, entry.id).length > 0;

/**
 * What's wrong with a split, in the words the Save button shows, or null. parts are the other
 * people's parts: [{ personId, amountMinor }]. With paidBy (a person paid), there's one part, to
 * them: the user's share.
 */
export function validateSplit({ amountMinor, currency, paidBy = null, parts = [] }) {
  if (!parts.length) return paidBy ? 'Enter your share' : null;
  if (parts.some((p) => !Number.isInteger(p.amountMinor) || p.amountMinor <= 0)) return 'Enter an amount for each person';
  if (new Set(parts.map((p) => p.personId)).size !== parts.length) return 'Pick each person once';
  if (paidBy && (parts.length !== 1 || parts[0].personId !== paidBy)) return 'Enter your share';
  if (sum(parts) > amountMinor) {
    return paidBy ? `Your share is more than ${formatMoney(amountMinor, currency)}` : `Shares add up to more than ${formatMoney(amountMinor, currency)}`;
  }
  return null;
}

/**
 * Who owes what. Only live splits not yet settled count, and only for live entries when entries
 * are given. Returns, per person with anything open or settled before (by name):
 *   [{ person, open: [{ currency, netMinor, splitIds }], settled: [settlement, newest first] }]
 * netMinor above zero: they owe the user; below: the user owes them; 0: even, with bills to close.
 */
export function owed({ people, splits, settlements = [], entries = null }) {
  const liveEntries = entries && new Set(entries.filter(isLive).map((e) => e.id));
  const out = [];
  for (const person of people) {
    const mine = splits.filter((s) => isLive(s) && s.personId === person.id && !s.settlementId
      && (!liveEntries || liveEntries.has(s.entryId)));
    const byCurrency = new Map();
    for (const s of mine) {
      const line = byCurrency.get(s.currency) ?? { currency: s.currency, netMinor: 0, splitIds: [] };
      line.netMinor += s.direction === OWED_TO_ME ? s.amountMinor : -s.amountMinor;
      line.splitIds.push(s.id);
      byCurrency.set(s.currency, line);
    }
    const settled = settlements.filter((t) => isLive(t) && t.personId === person.id)
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
    if (!byCurrency.size && !settled.length) continue;
    out.push({ person, open: [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)), settled });
  }
  return out.sort((a, b) => a.person.name.localeCompare(b.person.name));
}

/** "Alex owes you £12.50", "You owe Sam S$8.00", "Even". */
export function owedPhrase(name, line) {
  if (line.netMinor > 0) return `${name} owes you ${formatMoney(line.netMinor, line.currency)}`;
  if (line.netMinor < 0) return `You owe ${name} ${formatMoney(-line.netMinor, line.currency)}`;
  return 'Even';
}

/**
 * A settle-up's amount as it moved the account: money in (they paid the user) above zero,
 * money out below.
 */
export const settlementMinor = (t) => (t.direction === 'out' ? -t.amountMinor : t.amountMinor);
