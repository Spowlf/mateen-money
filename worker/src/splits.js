// Split payments on the Worker: the splits saved with a payment, deleting and restoring them with
// it, settling up and undoing a settle-up, and the rules around people. Every change lands in one
// write with what it belongs to. See docs/superpowers/specs/2026-10-07-split-expenses-design.md.

import { validateSplit, OWED_TO_ME, I_OWE } from '../../src/engine/index.js';
import { refuse } from './http.js';
import { validDate, validCurrency } from './entries.js';

const live = (row) => row && !row.deletedAt;

/** The message that refuses changing a payment while any of its splits is settled, or null. */
async function settledLock(store, splits) {
  const settled = splits.filter((s) => s.settlementId);
  if (!settled.length) return null;
  const person = await store.get('people', settled[0].personId);
  return `${person?.name ?? 'Someone'} already settled this bill. Undo that settle-up first.`;
}

/** A payment's live splits, deleted with it at its own time, so they come back with it. */
const deleteWith = (splits, deletedAt) => splits.filter(live).map((s) => ({ ...s, deletedAt }));

/** Splits as a comparable list: person and amount, in person order. */
const shape = (rows) => JSON.stringify(rows.map((s) => [s.personId, s.amountMinor]).sort());

/**
 * The split rows to write with a payment being saved (PUT /entries/:id), or [] when its splits
 * don't change. body.splits ([{ id?, personId, amountMinor }], [] to unsplit) replaces the unsettled
 * ones; left out, they're kept, unless the payment's amount, currency, payer or kind changed, which
 * needs them sent again. A payment with a settled split can't change any of those. Deleting the
 * payment deletes its splits with it; bringing it back brings them back, or the ones sent.
 * Throws a refusal ("Nothing changed: …") for anything not allowed.
 */
export async function splitWrites(ctx, existing, entry, body) {
  const { store, now } = ctx;
  const all = existing ? await store.all('splits', 'entryId = ?', entry.id) : [];
  // Brought back from a delete: the splits deleted with it are its splits again.
  const restoring = !!existing?.deletedAt && !entry.deletedAt;
  const before = all.filter((s) => (restoring ? s.deletedAt === existing.deletedAt : !s.deletedAt));
  const sent = Array.isArray(body.splits) ? body.splits : null;
  if ('splits' in body && body.splits !== null && !sent) throw refuse('send the split as a list.');
  const changedFields = existing
    && ['amountMinor', 'currency', 'paidBy', 'kind'].some((f) => (existing[f] ?? null) !== (entry[f] ?? null));

  // A settled bill keeps its amount, currency, payer and split until that settle-up is undone.
  const lock = await settledLock(store, before);
  if (lock) {
    if (changedFields || (sent && shape(sent) !== shape(before)) || (entry.deletedAt && !existing.deletedAt)) throw refuse(lock, 409);
    return [];
  }

  // Deleted: its splits go with it; still deleted: they stay as they are.
  if (entry.deletedAt) return !existing || existing.deletedAt ? [] : deleteWith(before, entry.deletedAt);

  const reshaped = before.length && changedFields;
  if (!sent) {
    if (entry.paidBy && !before.length) throw refuse('enter your share of what they paid.');
    if (reshaped) throw refuse(existing.currency !== entry.currency ? 'split it again in the new currency.' : 'split it again for the new amount.');
    return restoring ? before.map((s) => ({ ...s, deletedAt: null })) : [];
  }

  if (sent.length && entry.kind === 'income') throw refuse('income can’t be split.');
  if (sent.length && entry.needsCurrency) throw refuse('pick the currency first.');
  const parts = sent.map((p) => ({ id: p?.id ?? null, personId: p?.personId, amountMinor: p?.amountMinor }));
  const people = await Promise.all(parts.map((p) => typeof p.personId === 'string' && store.get('people', p.personId)));
  parts.forEach((p, i) => {
    // Someone removed from the list stays on the bills they were already on.
    if (!live(people[i]) || (people[i].archived && !before.some((s) => s.personId === p.personId))) throw refuse('pick people who are still in your list.');
  });
  const problem = validateSplit({ amountMinor: entry.amountMinor, currency: entry.currency, paidBy: entry.paidBy, parts });
  if (problem) throw refuse(`${problem.charAt(0).toLowerCase()}${problem.slice(1)}.`);

  const direction = entry.paidBy ? I_OWE : OWED_TO_ME;
  const kept = new Set();
  const rows = parts.map((p) => {
    // The same person keeps their split's id, so a re-saved split isn't a new row.
    const old = before.find((s) => (p.id && s.id === p.id) || (!p.id && s.personId === p.personId && !kept.has(s.id)));
    if (old) kept.add(old.id);
    return {
      id: old?.id ?? (typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID()),
      entryId: entry.id, personId: p.personId, amountMinor: p.amountMinor, currency: entry.currency, direction, settlementId: null, deletedAt: null,
    };
  });
  // Splits left out are deleted; ones still deleted from before a restore stay as they are.
  const removed = restoring ? [] : before.filter((s) => !rows.some((r) => r.id === s.id)).map((s) => ({ ...s, deletedAt: now }));
  return [...rows, ...removed];
}

/** DELETE /entries/:id: the payment and its splits, in one write; refused while settled. */
export async function deleteEntry(ctx, id) {
  const { store, now } = ctx;
  const row = await store.get('entries', id);
  if (!row) throw refuse('that no longer exists.', 404);
  if (row.deletedAt) return store.write({ entries: [row] }, now);
  const splits = await store.all('splits', 'entryId = ? AND deletedAt IS NULL', id);
  const lock = await settledLock(store, splits);
  if (lock) throw refuse(lock, 409);
  return store.write({ entries: [{ ...row, deletedAt: now }], splits: deleteWith(splits, now) }, now);
}

/**
 * POST /settle { id, personId, currency, accountId, date }: settles everything open with one person
 * in one currency, netted from the Worker's own rows. Writes the settle-up and stamps it on each
 * split, in one write. A net of zero closes the bills with a 0 settle-up and needs no account.
 */
export async function settle(ctx, body) {
  const { store, now } = ctx;
  const { id, personId, currency, accountId = null, date } = body ?? {};
  if (typeof id !== 'string' || !id) throw refuse('send the settle-up with its id.');
  if (await store.get('settlements', id)) throw refuse('that settle-up is already saved.', 409);
  const person = typeof personId === 'string' && await store.get('people', personId);
  if (!live(person)) throw refuse('pick someone in your list.');
  if (!validCurrency(currency)) throw refuse('pick a currency.');
  if (!validDate(date) || date > ctx.today) throw refuse('pick today or an earlier day.');
  const open = (await store.all('splits', 'personId = ? AND currency = ? AND deletedAt IS NULL AND settlementId IS NULL', personId, currency ?? ''));
  const entries = await Promise.all(open.map((s) => store.get('entries', s.entryId)));
  const rows = open.filter((s, i) => live(entries[i]));
  if (!rows.length) throw refuse(`nothing is owed in ${currency}.`);
  const net = rows.reduce((sum, s) => sum + (s.direction === OWED_TO_ME ? s.amountMinor : -s.amountMinor), 0);
  let account = null;
  if (net !== 0) {
    account = typeof accountId === 'string' && await store.get('accounts', accountId);
    if (!live(account) || !['current', 'savings'].includes(account.kind)) {
      throw refuse(`pick the account it ${net > 0 ? 'went into' : 'came out of'}.`);
    }
  }
  const settlement = {
    id, personId, date, amountMinor: Math.abs(net), currency, direction: net < 0 ? 'out' : 'in', accountId: account?.id ?? null, deletedAt: null,
  };
  return store.write({ settlements: [settlement], splits: rows.map((s) => ({ ...s, settlementId: id })) }, now);
}

/** DELETE /settlements/:id: undoes a settle-up, opening its splits again, in one write. */
export async function undoSettlement(ctx, id) {
  const { store, now } = ctx;
  const row = await store.get('settlements', id);
  if (!row) throw refuse('that no longer exists.', 404);
  if (row.deletedAt) return store.write({ settlements: [row] }, now);
  const splits = await store.all('splits', 'settlementId = ?', id);
  return store.write({ settlements: [{ ...row, deletedAt: now }], splits: splits.map((s) => ({ ...s, settlementId: null })) }, now);
}

/** A person can't be removed while anything with them is open. Returns the refusal message, or null. */
export async function personInUse(store, personId) {
  const open = await store.all('splits', 'personId = ? AND deletedAt IS NULL AND settlementId IS NULL', personId);
  const entries = await Promise.all(open.map((s) => store.get('entries', s.entryId)));
  if (!entries.some(live)) return null;
  const person = await store.get('people', personId);
  return `${person?.name ?? 'They'} still has bills to settle. Settle up first.`;
}
