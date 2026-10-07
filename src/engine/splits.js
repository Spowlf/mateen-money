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

import { formatMoney, toMinor, toDecimalText } from './money.js';
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
  if (parts.some((p) => !Number.isInteger(p.amountMinor) || p.amountMinor <= 0)) return paidBy ? 'Enter your share' : 'Enter an amount for each person';
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

const shareCache = new WeakMap();

/**
 * The payments as spending sees them: a split one's amountMinor, gbpPence and feePence are the
 * user's share (fee in proportion), with the whole bill kept as fullAmountMinor / fullGbpPence for
 * "of £40.00". Unsplit entries and income come back as they are (the same objects). Every spending
 * figure reads these; Net Worth, card balances and duplicate checks read the real entries.
 * Remembered per (entries, splits) pair, since screens ask on every render.
 */
export function withShares(entries, splits = []) {
  if (!splits.length) return entries;
  const cached = shareCache.get(entries);
  if (cached?.splits === splits) return cached.result;
  const byEntry = new Map();
  for (const s of splits) {
    if (!isLive(s)) continue;
    if (!byEntry.has(s.entryId)) byEntry.set(s.entryId, []);
    byEntry.get(s.entryId).push(s);
  }
  const result = byEntry.size ? entries.map((e) => {
    const own = e.kind === 'spend' ? byEntry.get(e.id) : null;
    if (!own) return e;
    const amountMinor = shareMinor(e, own);
    const gbpPence = shareGbpPence(e, own);
    const feePence = e.feePence && e.amountMinor ? Math.round((e.feePence * amountMinor) / e.amountMinor) : e.feePence;
    return { ...e, amountMinor, gbpPence, feePence, fullAmountMinor: e.amountMinor, fullGbpPence: e.gbpPence, split: true };
  }) : entries;
  shareCache.set(entries, { splits, result });
  return result;
}

// --- The Split block (Log, the edit sheet, Sort Payment) --------------------------------------
//
// Its state, kept in the Log form and its offline draft:
//   { paidBy: null | personId, with: [personId], mode: 'even' | 'amount', amounts: { personId: text }, share: text, open }
// with: the other people the bill is shared with (not who paid). amounts: by amount, when the user
// paid. share: by amount, the user's share when someone else paid.

// open: "Split this bill" was tapped, so the block stays open before anyone is picked.
export const emptySplit = () => ({ paidBy: null, with: [], mode: 'even', amounts: {}, share: '', open: false });

/** True when the Split block says the bill is shared with anyone (or someone else paid). */
export const isSplitOn = (split) => !!split && (!!split.paidBy || split.with.length > 0);

const minorOf = (text, currency) => {
  const m = toMinor(String(text ?? '').replace(/,/g, '').trim(), currency);
  return m === null ? 0 : m;
};

/**
 * The split as the Worker takes it: { paidBy, parts: [{ personId, amountMinor }] } (parts [] when
 * not split), and the user's share. Even: everyone, the payer and the user included, the same
 * whole number of minor units, the leftover to the user.
 */
export function splitParts(split, amountMinor, currency) {
  if (!isSplitOn(split)) return { paidBy: null, parts: [], shareMinor: amountMinor };
  const others = split.with.filter((id) => id !== split.paidBy);
  if (split.paidBy) {
    const shareMinor = split.mode === 'amount'
      ? minorOf(split.share, currency)
      : evenSplit(amountMinor, others.length + 2).mineMinor;
    return { paidBy: split.paidBy, parts: [{ personId: split.paidBy, amountMinor: shareMinor }], shareMinor };
  }
  if (split.mode === 'amount') {
    const parts = others.map((personId) => ({ personId, amountMinor: minorOf(split.amounts[personId], currency) }));
    return { paidBy: null, parts, shareMinor: amountMinor - parts.reduce((s, p) => s + p.amountMinor, 0) };
  }
  const { eachMinor, mineMinor } = evenSplit(amountMinor, others.length + 1);
  return { paidBy: null, parts: others.map((personId) => ({ personId, amountMinor: eachMinor })), shareMinor: mineMinor };
}

/** What's missing from the split, as the Save button says it, or null. */
export function splitMissing(split, amountMinor, currency) {
  if (!isSplitOn(split) || !amountMinor) return null;
  const { paidBy, parts } = splitParts(split, amountMinor, currency);
  if (!paidBy && !parts.length) return 'Pick who it’s split with';
  return validateSplit({ amountMinor, currency, paidBy, parts });
}

/** "split with Alex, Sam" / "Alex paid" / "Alex paid, split with Sam", for the summary line. */
export function splitPhrase(split, people) {
  if (!isSplitOn(split)) return null;
  const name = (id) => people.find((p) => p.id === id)?.name ?? 'Someone';
  const others = split.with.filter((id) => id !== split.paidBy).map(name);
  const parts = [];
  if (split.paidBy) parts.push(`${name(split.paidBy)} paid`);
  if (others.length) parts.push(`split with ${others.join(', ')}`);
  return parts.join(', ');
}

/**
 * The Split block's state for a saved payment and its splits (to edit it): by amount unless the
 * parts are exactly an even split.
 */
export function splitFromEntry(entry, splits) {
  const own = splitsOf(splits, entry.id);
  if (!own.length) return emptySplit();
  if (entry.paidBy) {
    const share = own.find((s) => s.direction === I_OWE)?.amountMinor ?? 0;
    const even = evenSplit(entry.amountMinor, 2).mineMinor === share;
    return { ...emptySplit(), paidBy: entry.paidBy, mode: even ? 'even' : 'amount', share: even ? '' : toDecimalText(share, entry.currency) };
  }
  const withIds = own.map((s) => s.personId);
  const even = evenSplit(entry.amountMinor, own.length + 1);
  const isEven = own.every((s) => s.amountMinor === even.eachMinor);
  return {
    ...emptySplit(),
    with: withIds,
    mode: isEven ? 'even' : 'amount',
    amounts: isEven ? {} : Object.fromEntries(own.map((s) => [s.personId, toDecimalText(s.amountMinor, entry.currency)])),
  };
}
