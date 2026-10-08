import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netWorth, carriedBalance, monthChange, estimateReceived, balanceId } from '../../src/engine/networth.js';

// Moves between the user's own accounts (the transfers table).
const SAVED = Date.UTC(2026, 8, 27, 12);
const account = (id, kind, currency, extra = {}) => ({ id, name: id.toUpperCase(), kind, currency, sort: 0, deletedAt: null, ...extra });
const balance = (accountId, date, amountMinor, currency, extra = {}) => ({
  id: balanceId(accountId, date), accountId, date, amountMinor, currency, deletedAt: null, updatedAt: SAVED, ...extra,
});
const move = (extra) => ({
  id: 'm', date: '2026-09-28', fromAccountId: 'hsbc', fromAmountMinor: 50000, fromCurrency: 'GBP',
  toAccountId: 'revolut', toAmountMinor: 86520, toCurrency: 'SGD', deletedAt: null, updatedAt: SAVED + 1000, ...extra,
});
// Units of currency per £1.
const RATES = [
  { id: '2026-09-30:SGD', forDate: '2026-09-30', currency: 'SGD', perGbp: 1.725 },
  { id: '2026-09-30:USD', forDate: '2026-09-30', currency: 'USD', perGbp: 1.35 },
];
const hsbc = balance('hsbc', '2026-09-27', 200000, 'GBP');
const revolut = balance('revolut', '2026-09-27', 10000, 'SGD');

test('moves: the amount sent comes off From, the amount received goes on To', () => {
  assert.deepEqual(carriedBalance({ balance: hsbc, accountId: 'hsbc', transfers: [move()] }),
    { amountMinor: 200000 - 50000, payments: 0, income: 0, settled: 0, moved: 1 });
  assert.deepEqual(carriedBalance({ balance: revolut, accountId: 'revolut', transfers: [move()] }),
    { amountMinor: 10000 + 86520, payments: 0, income: 0, settled: 0, moved: 1 });
});

test('moves: one currency moves the same amount both ways', () => {
  const m = move({ toAccountId: 'dbs', toAmountMinor: 50000, toCurrency: 'GBP' });
  const dbs = balance('dbs', '2026-09-27', 0, 'GBP');
  assert.equal(carriedBalance({ balance: hsbc, accountId: 'hsbc', transfers: [m] }).amountMinor, 150000);
  assert.equal(carriedBalance({ balance: dbs, accountId: 'dbs', transfers: [m] }).amountMinor, 50000);
});

test('moves: a balance typed in another currency converts at the latest rate, or skips without one', () => {
  // A GBP balance on Revolut: S$86.25 in = £50.00.
  const typedInGbp = balance('revolut', '2026-09-27', 0, 'GBP');
  const got = carriedBalance({ balance: typedInGbp, accountId: 'revolut', transfers: [move({ toAmountMinor: 8625 })], rates: RATES });
  assert.deepEqual(got, { amountMinor: 5000, payments: 0, income: 0, settled: 0, moved: 1 });
  assert.deepEqual(carriedBalance({ balance: typedInGbp, accountId: 'revolut', transfers: [move()], rates: [] }),
    { amountMinor: 0, payments: 0, income: 0, settled: 0, moved: 0 });
});

test('moves: before the balance, the same day but saved before it, deleted or elsewhere don’t count', () => {
  const transfers = [
    move({ date: '2026-09-26' }),
    move({ date: '2026-09-27', updatedAt: SAVED - 1000 }),
    move({ deletedAt: 5 }),
    move({ fromAccountId: 'dbs' }),
  ];
  assert.deepEqual(carriedBalance({ balance: hsbc, accountId: 'hsbc', transfers }),
    { amountMinor: 200000, payments: 0, income: 0, settled: 0, moved: 0 });
  // The same day, saved after the balance: counts.
  assert.equal(carriedBalance({ balance: hsbc, accountId: 'hsbc', transfers: [move({ date: '2026-09-27' })] }).moved, 1);
});

test('moves: a move from a deleted account still counts on the live side', () => {
  const accounts = [account('revolut', 'current', 'SGD')];
  const nw = netWorth({ accounts, balances: [revolut], rates: RATES, todayDate: '2026-10-01', transfers: [move()] });
  assert.equal(nw.groups[0].accounts[0].amountMinor, 96520);
  assert.equal(nw.groups[0].accounts[0].moved, 1);
});

test('moves: net worth counts them, marked as carried on', () => {
  const accounts = [account('hsbc', 'current', 'GBP'), account('dbs', 'current', 'GBP')];
  const m = move({ toAccountId: 'dbs', toAmountMinor: 50000, toCurrency: 'GBP' });
  const nw = netWorth({ accounts, balances: [hsbc, balance('dbs', '2026-09-27', 0, 'GBP')], rates: [], todayDate: '2026-10-01', transfers: [m] });
  assert.equal(nw.totalPence, 200000);
  assert.equal(nw.estimated, true);
  assert.deepEqual(nw.carried.map((r) => [r.account.id, r.moved]), [['dbs', 1], ['hsbc', 1]]);
});

test('moves: an account with holdings ignores them', () => {
  const accounts = [account('ibkr', 'investment', 'GBP')];
  const holdings = [{ id: 'h', accountId: 'ibkr', symbol: 'VWRP', quote: 'VWRP.L', currency: 'GBP', unitsMicro: 1_000_000, closeMicro: 100_000_000, valueBaseMinor: 10000, reportDate: '2026-09-27', deletedAt: null }];
  const ibkr = balance('ibkr', '2026-09-27', 10000, 'GBP');
  const m = move({ toAccountId: 'ibkr', toAmountMinor: 50000, toCurrency: 'GBP' });
  const nw = netWorth({ accounts, balances: [ibkr], rates: [], todayDate: '2026-10-01', holdings, transfers: [m] });
  assert.equal(nw.totalPence, 10000);
  assert.equal(nw.groups[0].accounts[0].moved, 0);
});

test('moves: this month, a move in one currency changes nothing', () => {
  const accounts = [account('hsbc', 'current', 'GBP'), account('dbs', 'current', 'GBP')];
  const balances = [balance('hsbc', '2026-09-20', 200000, 'GBP'), balance('dbs', '2026-09-20', 0, 'GBP')];
  const m = move({ date: '2026-10-05', toAccountId: 'dbs', toAmountMinor: 50000, toCurrency: 'GBP' });
  const got = monthChange({ accounts, balances, rates: [], todayDate: '2026-10-15', transfers: [m] });
  assert.equal(got.pence, 0);
  assert.equal(got.balancesPence, 0);
});

test('moves: one before the 1st carries into the month’s opening balances', () => {
  const accounts = [account('hsbc', 'current', 'GBP'), account('dbs', 'current', 'GBP')];
  const balances = [balance('hsbc', '2026-09-20', 200000, 'GBP'), balance('dbs', '2026-09-20', 0, 'GBP')];
  const m = move({ date: '2026-09-25', toAccountId: 'dbs', toAmountMinor: 50000, toCurrency: 'GBP' });
  const got = monthChange({ accounts, balances, rates: [], todayDate: '2026-10-15', transfers: [m] });
  assert.equal(got.pence, 0);
});

test('moves: the received estimate converts through GBP at the latest rates', () => {
  assert.equal(estimateReceived(50000, 'GBP', 'SGD', RATES), 86250);
  assert.equal(estimateReceived(86250, 'SGD', 'GBP', RATES), 50000);
  assert.equal(estimateReceived(1350, 'USD', 'SGD', RATES), 1725);
  assert.equal(estimateReceived(500, 'GBP', 'GBP', []), 500);
  assert.equal(estimateReceived(500, 'GBP', 'JPY', RATES), null);
});
