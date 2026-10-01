import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netWorth, carriedBalance, balanceMinor, latestBalance, latestGbp, balanceId, balanceRows, undoRows, staleLine, updatedPhrase, STALE_DAYS,
} from '../../src/engine/networth.js';

const TODAY = '2026-10-01';
const account = (id, kind, currency, extra = {}) => ({ id, name: id.toUpperCase(), kind, currency, sort: 0, deletedAt: null, ...extra });
const balance = (accountId, date, amountMinor, currency, extra = {}) => ({
  id: balanceId(accountId, date), accountId, date, amountMinor, currency, deletedAt: null, updatedAt: 0, ...extra,
});
// Units of currency per £1.
const RATES = [
  { id: '2026-09-30:SGD', forDate: '2026-09-30', currency: 'SGD', perGbp: 1.725 },
  { id: '2026-09-29:SGD', forDate: '2026-09-29', currency: 'SGD', perGbp: 1.7 },
  { id: '2026-09-30:USD', forDate: '2026-09-30', currency: 'USD', perGbp: 1.35 },
];

test('net worth: the latest live balance is the balance', () => {
  const balances = [
    balance('dbs', '2026-08-27', 100000, 'SGD'),
    balance('dbs', '2026-09-30', 215040, 'SGD'),
    balance('dbs', '2026-10-01', 999999, 'SGD', { deletedAt: 5 }),
    balance('hsbc', '2026-10-01', 1, 'GBP'),
  ];
  assert.equal(latestBalance(balances, 'dbs').amountMinor, 215040);
  assert.equal(latestBalance(balances, 'cimb'), null);
});

test('net worth: the latest saved wins on the same date', () => {
  const balances = [
    { ...balance('dbs', '2026-09-30', 100, 'SGD'), id: 'a', updatedAt: 2 },
    { ...balance('dbs', '2026-09-30', 200, 'SGD'), id: 'b', updatedAt: 9 },
  ];
  assert.equal(latestBalance(balances, 'dbs').amountMinor, 200);
});

test('net worth: converted to GBP at the latest rate, without a fee', () => {
  assert.deepEqual(latestGbp(2001676, 'SGD', RATES), { pence: 1160392, forDate: '2026-09-30' });
  assert.deepEqual(latestGbp(124055, 'GBP', RATES), { pence: 124055, forDate: null });
  assert.equal(latestGbp(100, 'EUR', RATES), null);
});

test('net worth: totals each kind and the whole, in GBP', () => {
  const accounts = [
    account('dbs', 'current', 'SGD', { sort: 1 }),
    account('hsbc', 'current', 'GBP', { sort: 2 }),
    account('revolut', 'current', 'SGD', { sort: 3 }),
    account('cimb', 'savings', 'SGD'),
  ];
  const balances = [
    balance('dbs', '2026-08-27', 215040, 'SGD'),
    balance('hsbc', TODAY, 124055, 'GBP'),
    balance('revolut', TODAY, 54889, 'SGD'),
    balance('cimb', TODAY, 2001676, 'SGD'),
  ];
  const nw = netWorth({ accounts, balances, rates: RATES, todayDate: TODAY });
  // 215040 / 1.725 = 124661; 54889 / 1.725 = 31820; 2001676 / 1.725 = 1160392.
  assert.equal(nw.totalPence, 124661 + 124055 + 31820 + 1160392);
  assert.deepEqual(nw.groups.map((g) => [g.kind, g.pence]), [['savings', 1160392], ['current', 124661 + 124055 + 31820]]);
  assert.deepEqual(nw.groups[1].accounts.map((r) => r.account.id), ['dbs', 'hsbc', 'revolut']);
  assert.ok(Math.abs(nw.groups.reduce((s, g) => s + g.share, 0) - 1) < 1e-9);
  assert.equal(nw.estimated, true);
  assert.equal(nw.rateDate, '2026-09-30');
});

test('net worth: all in GBP is exact, not estimated', () => {
  const nw = netWorth({ accounts: [account('hsbc', 'current', 'GBP')], balances: [balance('hsbc', TODAY, 500, 'GBP')], rates: [], todayDate: TODAY });
  assert.equal(nw.totalPence, 500);
  assert.equal(nw.estimated, false);
  assert.equal(nw.rateDate, null);
});

test('net worth: kinds show investments, then savings, then current accounts', () => {
  const accounts = [account('a', 'current', 'GBP'), account('b', 'investment', 'GBP'), account('c', 'savings', 'GBP')];
  const balances = accounts.map((a) => balance(a.id, TODAY, 100, 'GBP'));
  assert.deepEqual(netWorth({ accounts, balances, rates: [], todayDate: TODAY }).groups.map((g) => g.name), ['Investments', 'Savings', 'Current Accounts']);
});

test('net worth: deleted accounts and their balances are left out', () => {
  const accounts = [account('a', 'current', 'GBP'), account('b', 'current', 'GBP', { deletedAt: 3 })];
  const balances = [balance('a', TODAY, 100, 'GBP'), balance('b', TODAY, 900, 'GBP')];
  const nw = netWorth({ accounts, balances, rates: [], todayDate: TODAY });
  assert.equal(nw.totalPence, 100);
  assert.equal(nw.groups[0].accounts.length, 1);
});

test('net worth: an account with no balance yet, or no rate yet, is named and not counted', () => {
  const accounts = [account('a', 'current', 'GBP'), account('b', 'savings', 'GBP'), account('c', 'savings', 'EUR')];
  const balances = [balance('a', TODAY, 100, 'GBP'), balance('c', TODAY, 500, 'EUR')];
  const nw = netWorth({ accounts, balances, rates: RATES, todayDate: TODAY });
  assert.equal(nw.totalPence, 100);
  assert.deepEqual(nw.noBalance.map((r) => r.account.id), ['b']);
  assert.deepEqual(nw.noRate.map((r) => r.account.id), ['c']);
});

test('net worth: an overdraft takes away from the total', () => {
  const accounts = [account('a', 'current', 'GBP'), account('b', 'savings', 'GBP')];
  const balances = [balance('a', TODAY, -2000, 'GBP'), balance('b', TODAY, 10000, 'GBP')];
  assert.equal(netWorth({ accounts, balances, rates: [], todayDate: TODAY }).totalPence, 8000);
});

test('net worth: a balance stays in the currency it was typed in', () => {
  // The account moved to GBP, but its last balance was typed in SGD.
  const nw = netWorth({ accounts: [account('a', 'current', 'GBP')], balances: [balance('a', TODAY, 172500, 'SGD')], rates: RATES, todayDate: TODAY });
  assert.equal(nw.totalPence, 100000);
  assert.equal(nw.groups[0].accounts[0].currency, 'SGD');
});

test('stale: over 30 days old gets a warning; 30 days doesn’t', () => {
  const accounts = [account('dbs', 'current', 'SGD'), account('cimb', 'savings', 'SGD'), account('hsbc', 'current', 'GBP')];
  const balances = [
    balance('dbs', '2026-08-27', 1, 'SGD'),   // 35 days
    balance('cimb', '2026-09-01', 1, 'SGD'),  // 30 days
    balance('hsbc', TODAY, 1, 'GBP'),
  ];
  const nw = netWorth({ accounts, balances, rates: RATES, todayDate: TODAY });
  assert.equal(STALE_DAYS, 30);
  assert.deepEqual(nw.stale.map((r) => [r.account.id, r.daysOld]), [['dbs', 35]]);
  assert.equal(staleLine(nw.stale), 'DBS was last updated 35 days ago.');
});

test('stale: several are named together', () => {
  const rows = ['dbs', 'cimb', 'hsbc'].map((id) => ({ account: { name: id.toUpperCase() }, daysOld: 40 }));
  assert.equal(staleLine(rows), 'DBS, CIMB and HSBC haven’t been updated in over 30 days.');
  assert.equal(staleLine(rows.slice(0, 2)), 'DBS and CIMB haven’t been updated in over 30 days.');
  assert.equal(staleLine([]), null);
});

test('updated: today, else the date', () => {
  assert.equal(updatedPhrase(TODAY, TODAY), 'Updated today');
  assert.equal(updatedPhrase('2026-08-27', TODAY), 'Updated 27 Aug 2026');
});

test('update balances: one row per account typed, in its currency, keyed by the day', () => {
  const accounts = [account('dbs', 'current', 'SGD'), account('hsbc', 'current', 'GBP'), account('cimb', 'savings', 'SGD')];
  const balances = [balance('hsbc', TODAY, 124055, 'GBP')];
  const rows = balanceRows({ accounts, balances, typed: { dbs: 215040, hsbc: 124055, cimb: null }, date: TODAY });
  // HSBC is the same as today's already; CIMB was left blank.
  assert.deepEqual(rows, [{ id: 'dbs:2026-10-01', accountId: 'dbs', date: TODAY, amountMinor: 215040, currency: 'SGD', deletedAt: null }]);
});

test('update balances: typing the same amount on a new day still records the day', () => {
  const accounts = [account('hsbc', 'current', 'GBP')];
  const balances = [balance('hsbc', '2026-09-01', 500, 'GBP')];
  assert.equal(balanceRows({ accounts, balances, typed: { hsbc: 500 }, date: TODAY }).length, 1);
});

test('update balances: zero is a balance', () => {
  const rows = balanceRows({ accounts: [account('a', 'current', 'GBP')], balances: [], typed: { a: 0 }, date: TODAY });
  assert.equal(rows[0].amountMinor, 0);
});

test('undo: puts a changed row back and deletes a new one', () => {
  const old = balance('a', TODAY, 100, 'GBP');
  const rows = [{ ...old, amountMinor: 200 }, balance('b', TODAY, 300, 'GBP')];
  assert.deepEqual(undoRows(rows, [old], 77), [old, { ...rows[1], deletedAt: 77 }]);
});

test('balance text: below zero and thousands commas are fine', () => {
  assert.equal(balanceMinor('20,016.76', 'SGD'), 2001676);
  assert.equal(balanceMinor('-1,240.55', 'GBP'), -124055);
  assert.equal(balanceMinor('−25', 'GBP'), -2500);
  assert.equal(balanceMinor('0', 'GBP'), 0);
  assert.equal(balanceMinor('-0', 'GBP'), 0);
  assert.equal(balanceMinor('1200', 'JPY'), 1200);
  assert.equal(balanceMinor('', 'GBP'), null);
  assert.equal(balanceMinor('12a', 'GBP'), null);
});

// Carrying a balance on with card payments logged since it was typed.
const SAVED = Date.UTC(2026, 8, 27, 12, 0);   // 27 Sep 2026, 13:00 in London
const card = (id, accountId, extra = {}) => ({ id, name: id, accountId, deletedAt: null, ...extra });
const pay = (date, amountMinor, currency, methodId, extra = {}) => ({
  id: `${date}:${amountMinor}:${methodId}`, kind: 'spend', date, at: null, amountMinor, currency, gbpPence: null, methodId, deletedAt: null, ...extra,
});

test('carried: payments with a linked card since the balance come off', () => {
  const balance = balance0();
  const methods = [card('dbs-visa', 'dbs'), card('monzo', 'hsbc')];
  const entries = [
    pay('2026-09-28', 450, 'SGD', 'dbs-visa'),
    pay('2026-09-30', 1200, 'SGD', 'dbs-visa'),
    pay('2026-09-29', 999, 'SGD', 'monzo'),        // another account's card
    pay('2026-09-26', 777, 'SGD', 'dbs-visa'),     // before the balance
    pay('2026-09-29', 5000, 'SGD', 'dbs-visa', { deletedAt: 3 }),
    pay('2026-09-29', 300, 'SGD', null),            // no card
  ];
  assert.deepEqual(carriedBalance({ balance, accountId: 'dbs', methods, entries, rates: RATES }), { amountMinor: 230010 - 450 - 1200, payments: 2 });
});

function balance0() {
  return { ...balance('dbs', '2026-09-27', 230010, 'SGD'), updatedAt: SAVED };
}

test('carried: on the balance’s own day, only payments after it was typed', () => {
  const methods = [card('dbs-visa', 'dbs')];
  const entries = [
    pay('2026-09-27', 100, 'SGD', 'dbs-visa', { at: SAVED - 60000 }),   // already in the bank's figure
    pay('2026-09-27', 200, 'SGD', 'dbs-visa', { at: SAVED + 60000 }),
    pay('2026-09-27', 400, 'SGD', 'dbs-visa'),                           // no time: can't tell, left out
  ];
  assert.equal(carriedBalance({ balance: balance0(), accountId: 'dbs', methods, entries }).amountMinor, 230010 - 200);
});

test('carried: a refund to a linked card goes back on', () => {
  const entries = [pay('2026-09-28', 1000, 'SGD', 'dbs-visa'), { ...pay('2026-09-29', 400, 'SGD', 'dbs-visa'), kind: 'income', incomeType: 'refund' }];
  const got = carriedBalance({ balance: balance0(), accountId: 'dbs', methods: [card('dbs-visa', 'dbs')], entries });
  assert.deepEqual(got, { amountMinor: 230010 - 1000 + 400, payments: 2 });
});

test('carried: a payment in another currency comes off through its GBP value', () => {
  // £10.00 (fee included) at S$1.725 = S$17.25.
  const entries = [pay('2026-09-28', 1000, 'GBP', 'dbs-visa', { gbpPence: 1000 }), pay('2026-09-28', 500, 'EUR', 'dbs-visa', { gbpPence: null })];
  const got = carriedBalance({ balance: balance0(), accountId: 'dbs', methods: [card('dbs-visa', 'dbs')], entries, rates: RATES });
  assert.deepEqual(got, { amountMinor: 230010 - 1725, payments: 1 });
});

test('carried: no linked card, or a removed one, leaves the balance as typed', () => {
  const entries = [pay('2026-09-28', 1000, 'SGD', 'dbs-visa')];
  assert.deepEqual(carriedBalance({ balance: balance0(), accountId: 'dbs', methods: [], entries }), { amountMinor: 230010, payments: 0 });
  assert.deepEqual(carriedBalance({ balance: balance0(), accountId: 'dbs', methods: [card('dbs-visa', 'dbs', { deletedAt: 1 })], entries }), { amountMinor: 230010, payments: 0 });
  assert.equal(carriedBalance({ balance: null, accountId: 'dbs' }), null);
});

test('net worth: carried balances count in the total and are marked estimated', () => {
  const accounts = [account('hsbc', 'current', 'GBP')];
  const balances = [{ ...balance('hsbc', '2026-09-27', 50000, 'GBP'), updatedAt: SAVED }];
  const nw = netWorth({ accounts, balances, rates: [], todayDate: TODAY, methods: [card('monzo', 'hsbc')], entries: [pay('2026-09-30', 1250, 'GBP', 'monzo', { gbpPence: 1250 })] });
  assert.equal(nw.totalPence, 48750);
  assert.equal(nw.estimated, true);
  assert.deepEqual(nw.carried.map((r) => [r.account.id, r.payments, r.amountMinor]), [['hsbc', 1, 48750]]);
  // Without payments it's exact.
  assert.equal(netWorth({ accounts, balances, rates: [], todayDate: TODAY }).estimated, false);
});
