import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evenSplit, shareMinor, shareGbpPence, isSplit, validateSplit, owed, owedPhrase, settlementMinor, OWED_TO_ME, I_OWE,
} from '../../src/engine/splits.js';
import { carriedBalance, netWorth } from '../../src/engine/networth.js';
import { findDuplicate } from '../../src/engine/vendors.js';

const pay = (amountMinor, extra = {}) => ({ id: 'e1', kind: 'spend', amountMinor, currency: 'GBP', gbpPence: amountMinor, deletedAt: null, ...extra });
let n = 0;
const split = (personId, amountMinor, extra = {}) => {
  n += 1;
  return { id: `s${n}`, entryId: 'e1', personId, amountMinor, currency: 'GBP', direction: OWED_TO_ME, settlementId: null, deletedAt: null, ...extra };
};
const ALEX = { id: 'alex', name: 'Alex', archived: 0, deletedAt: null };
const SAM = { id: 'sam', name: 'Sam', archived: 0, deletedAt: null };

test('even split: each friend the same whole amount, the leftover to you', () => {
  assert.deepEqual(evenSplit(4000, 4), { eachMinor: 1000, mineMinor: 1000 });
  // £10.00 three ways: 333p each to two friends, 334p to you.
  assert.deepEqual(evenSplit(1000, 3), { eachMinor: 333, mineMinor: 334 });
  // £0.05 three ways: a penny each to them, 3p to you.
  assert.deepEqual(evenSplit(5, 3), { eachMinor: 1, mineMinor: 3 });
  // A zero-decimal currency's minor unit is the yen itself, so ¥1,000 three ways is ¥333 each, ¥334 yours.
  assert.deepEqual(evenSplit(1000, 3), { eachMinor: 333, mineMinor: 334 });
  assert.deepEqual(evenSplit(1001, 2), { eachMinor: 500, mineMinor: 501 });
  // Just you: all of it.
  assert.deepEqual(evenSplit(1234, 1), { eachMinor: 1234, mineMinor: 1234 });
});

test('share: unsplit is the whole payment', () => {
  const e = pay(4000);
  assert.equal(shareMinor(e, []), 4000);
  assert.equal(shareGbpPence(e, []), 4000);
  assert.equal(isSplit(e, []), false);
});

test('share: you paid, the others’ parts come off', () => {
  const e = pay(4000);
  const splits = [split('alex', 1500), split('sam', 1500), split('sam', 999, { entryId: 'other' }), split('alex', 777, { deletedAt: 5 })];
  assert.equal(shareMinor(e, splits), 1000);
  assert.equal(shareGbpPence(e, splits), 1000);
  assert.equal(isSplit(e, splits), true);
});

test('share: paying entirely for someone else leaves you nothing', () => {
  assert.equal(shareMinor(pay(4000), [split('alex', 4000)]), 0);
  assert.equal(shareGbpPence(pay(4000), [split('alex', 4000)]), 0);
});

test('share: a friend paid, your share is what you owe them', () => {
  const e = pay(4000, { paidBy: 'alex', methodId: null });
  assert.equal(shareMinor(e, [split('alex', 1000, { direction: I_OWE })]), 1000);
});

test('share in GBP: the fee is shared in proportion; none until priced', () => {
  // S$40.00 cost £23.88 with a £0.69 fee; a quarter is yours.
  const e = pay(4000, { currency: 'SGD', gbpPence: 2388 + 69, feePence: 69 });
  const splits = [split('alex', 3000, { currency: 'SGD' })];
  assert.equal(shareMinor(e, splits), 1000);
  assert.equal(shareGbpPence(e, splits), Math.round((2457 * 1000) / 4000));
  assert.equal(shareGbpPence({ ...e, gbpPence: null }, splits), null);
});

test('validate: what the Save button says', () => {
  const base = { amountMinor: 4000, currency: 'GBP' };
  assert.equal(validateSplit({ ...base, parts: [] }), null);
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 3000 }] }), null);
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 4000 }] }), null);
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 2500 }, { personId: 'sam', amountMinor: 2000 }] }), 'Shares add up to more than £40.00');
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 0 }] }), 'Enter an amount for each person');
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 1.5 }] }), 'Enter an amount for each person');
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 100 }, { personId: 'alex', amountMinor: 100 }] }), 'Pick each person once');
});

test('validate: a friend paid, one part, to them, no more than the bill', () => {
  const base = { amountMinor: 4000, currency: 'SGD', paidBy: 'alex' };
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 1000 }] }), null);
  assert.equal(validateSplit({ ...base, parts: [] }), 'Enter your share');
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'sam', amountMinor: 1000 }] }), 'Enter your share');
  assert.equal(validateSplit({ ...base, parts: [{ personId: 'alex', amountMinor: 5000 }] }), 'Your share is more than S$40.00');
});

test('owed: netted per person and per currency, both ways', () => {
  const splits = [
    split('alex', 1500),                                          // Alex owes you £15.00
    split('alex', 250, { entryId: 'e2', direction: I_OWE }),      // you owe Alex £2.50
    split('alex', 2000, { entryId: 'e3', currency: 'SGD' }),      // Alex owes you S$20.00
    split('sam', 800, { entryId: 'e4', currency: 'SGD', direction: I_OWE }),
  ];
  const rows = owed({ people: [SAM, ALEX], splits });
  assert.deepEqual(rows.map((r) => r.person.name), ['Alex', 'Sam']);
  assert.deepEqual(rows[0].open.map((l) => [l.currency, l.netMinor, l.splitIds.length]), [['GBP', 1250, 2], ['SGD', 2000, 1]]);
  assert.deepEqual(rows[1].open.map((l) => [l.currency, l.netMinor]), [['SGD', -800]]);
  assert.equal(owedPhrase('Alex', rows[0].open[0]), 'Alex owes you £12.50');
  assert.equal(owedPhrase('Sam', rows[1].open[0]), 'You owe Sam S$8.00');
});

test('owed: even is zero with bills still to close', () => {
  const rows = owed({ people: [ALEX], splits: [split('alex', 500), split('alex', 500, { entryId: 'e2', direction: I_OWE })] });
  assert.equal(rows[0].open[0].netMinor, 0);
  assert.equal(rows[0].open[0].splitIds.length, 2);
  assert.equal(owedPhrase('Alex', rows[0].open[0]), 'Even');
});

test('owed: settled, deleted and deleted-entry splits are left out; settle-ups listed newest first', () => {
  const settlements = [
    { id: 't1', personId: 'alex', date: '2026-09-01', amountMinor: 100, currency: 'GBP', direction: 'in', deletedAt: null },
    { id: 't2', personId: 'alex', date: '2026-10-01', amountMinor: 200, currency: 'GBP', direction: 'in', deletedAt: null },
    { id: 't3', personId: 'alex', date: '2026-10-02', amountMinor: 300, currency: 'GBP', direction: 'in', deletedAt: 9 },
  ];
  const splits = [
    split('alex', 100, { settlementId: 't1' }),
    split('alex', 400, { deletedAt: 3 }),
    split('alex', 600, { entryId: 'gone' }),
    split('alex', 700, { entryId: 'e1' }),
  ];
  const entries = [pay(4000), { ...pay(600), id: 'gone', deletedAt: 4 }];
  const [row] = owed({ people: [ALEX, SAM], splits, settlements, entries });
  assert.deepEqual(row.open.map((l) => l.netMinor), [700]);
  assert.deepEqual(row.settled.map((t) => t.id), ['t2', 't1']);
  // Sam has nothing open and nothing settled: not listed.
  assert.equal(owed({ people: [ALEX, SAM], splits, settlements, entries }).length, 1);
});

test('owed: a person settled up with and nothing open is still listed', () => {
  const settlements = [{ id: 't1', personId: 'sam', date: '2026-09-01', amountMinor: 100, currency: 'GBP', direction: 'out', deletedAt: null }];
  const [row] = owed({ people: [SAM], splits: [], settlements });
  assert.deepEqual(row.open, []);
  assert.equal(row.settled.length, 1);
});

test('settlement: in is money in, out is money out', () => {
  assert.equal(settlementMinor({ amountMinor: 1250, direction: 'in' }), 1250);
  assert.equal(settlementMinor({ amountMinor: 1250, direction: 'out' }), -1250);
});

// Net Worth: a settle-up moves the account it names.
const RATES = [{ id: '2026-09-30:SGD', forDate: '2026-09-30', currency: 'SGD', perGbp: 1.725 }];
const SAVED = Date.UTC(2026, 8, 27, 12);
const typed = { id: 'hsbc:2026-09-27', accountId: 'hsbc', date: '2026-09-27', amountMinor: 50000, currency: 'GBP', deletedAt: null, updatedAt: SAVED };
const settle = (extra) => ({ id: 't', personId: 'alex', date: '2026-09-28', amountMinor: 1250, currency: 'GBP', direction: 'in', accountId: 'hsbc', deletedAt: null, ...extra });

test('carried: a settle-up into the account adds, one out of it takes off', () => {
  const got = carriedBalance({ balance: typed, accountId: 'hsbc', settlements: [settle(), settle({ id: 't2', direction: 'out', amountMinor: 500 })] });
  assert.deepEqual(got, { amountMinor: 50000 + 1250 - 500, payments: 0, income: 0, settled: 2 });
});

test('carried: settle-ups before the balance, into another account, deleted or of zero don’t count', () => {
  const settlements = [
    settle({ date: '2026-09-26' }),
    settle({ date: '2026-09-27', updatedAt: SAVED - 1000 }),     // the same day, before it was typed
    settle({ accountId: 'dbs' }),
    settle({ deletedAt: 3 }),
    settle({ amountMinor: 0, accountId: null }),
  ];
  assert.deepEqual(carriedBalance({ balance: typed, accountId: 'hsbc', settlements }), { amountMinor: 50000, payments: 0, income: 0, settled: 0 });
});

test('carried: a settle-up in another currency is converted at the latest rate', () => {
  // S$17.25 in = £10.00
  const got = carriedBalance({ balance: typed, accountId: 'hsbc', settlements: [settle({ amountMinor: 1725, currency: 'SGD' })], rates: RATES });
  assert.equal(got.amountMinor, 51000);
});

test('net worth: a settle-up counts in the total, marked estimated', () => {
  const accounts = [{ id: 'hsbc', name: 'HSBC', kind: 'current', currency: 'GBP', sort: 0, deletedAt: null }];
  const nw = netWorth({ accounts, balances: [typed], rates: [], todayDate: '2026-10-01', settlements: [settle()] });
  assert.equal(nw.totalPence, 51250);
  assert.equal(nw.estimated, true);
  assert.equal(nw.carried[0].settled, 1);
});

test('duplicates: a bill a friend paid never matches your own payment', () => {
  const at = Date.UTC(2026, 9, 1, 12);
  const incoming = { amountMinor: 4000, currency: 'GBP', merchant: 'Pret', at };
  const mine = { id: 'm', amountMinor: 4000, currency: 'GBP', merchant: 'Pret', at: at + 60000, deletedAt: null };
  assert.equal(findDuplicate(incoming, [mine])?.id, 'm');
  assert.equal(findDuplicate(incoming, [{ ...mine, paidBy: 'alex' }]), null);
});
