import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signedMoney, signedPct, rateOnOrBefore, dayChange, monthChange, worthSeries, rangeScale, balanceId,
} from '../../src/engine/networth.js';
import { fromMicro, holdingRows, recentActivity, activityTitle, activityCash, liveInvestment } from '../../src/engine/holdings.js';

const TODAY = '2026-10-15';
const account = (id, kind, currency, extra = {}) => ({ id, name: id.toUpperCase(), kind, currency, sort: 0, deletedAt: null, ...extra });
const balance = (accountId, date, amountMinor, currency, extra = {}) => ({
  id: balanceId(accountId, date), accountId, date, amountMinor, currency, deletedAt: null, updatedAt: 0, ...extra,
});
const rate = (forDate, currency, perGbp) => ({ id: `${forDate}:${currency}`, forDate, currency, perGbp });

test('signed: gains and losses carry + and −, zero neither', () => {
  assert.equal(signedMoney(1250), '+£12.50');
  assert.equal(signedMoney(-123456), '−£1,234.56');
  assert.equal(signedMoney(0), '£0.00');
  assert.equal(signedMoney(-500, 'SGD'), '−S$5.00');
  assert.equal(signedPct(0.0321), '+3.2%');
  assert.equal(signedPct(-0.5), '−50.0%');
  assert.equal(signedPct(0.0001), '0.0%');
});

test('rate on or before: the day’s, else the latest before, else the earliest', () => {
  const rates = [rate('2026-09-30', 'SGD', 1.7), rate('2026-10-10', 'SGD', 1.75)];
  assert.equal(rateOnOrBefore(rates, 'SGD', '2026-10-10').perGbp, 1.75);
  assert.equal(rateOnOrBefore(rates, 'SGD', '2026-10-05').perGbp, 1.7);
  assert.equal(rateOnOrBefore(rates, 'SGD', '2026-01-01').perGbp, 1.7);
  assert.equal(rateOnOrBefore(rates, 'USD', '2026-10-05'), null);
  assert.equal(rateOnOrBefore(rates, 'GBP', '2026-10-05').perGbp, 1);
});

test('day change: against the latest day saved before today', () => {
  const snapshots = [
    { id: '2026-10-13', date: '2026-10-13', gbpPence: 100000 },
    { id: '2026-10-14', date: '2026-10-14', gbpPence: 101000 },
    { id: '2026-10-15', date: '2026-10-15', gbpPence: 999999 },
    { id: '2026-10-12', date: '2026-10-12', gbpPence: 1, deletedAt: 5 },
  ];
  assert.deepEqual(dayChange({ snapshots, totalPence: 100500, todayDate: TODAY }), { pence: -500, from: '2026-10-14' });
  assert.equal(dayChange({ snapshots: [], totalPence: 100500, todayDate: TODAY }), null);
});

test('month change: a GBP bank balance typed again is all a balance change', () => {
  const accounts = [account('hsbc', 'current', 'GBP')];
  const balances = [balance('hsbc', '2026-09-20', 100000, 'GBP'), balance('hsbc', '2026-10-10', 80000, 'GBP')];
  const m = monthChange({ accounts, balances, rates: [], todayDate: TODAY });
  assert.deepEqual(m, { from: '2026-10-01', pence: -20000, marketPence: 0, currencyPence: 0, balancesPence: -20000, investments: false });
});

test('month change: the pound moving changes a foreign balance with nothing typed', () => {
  const accounts = [account('cimb', 'savings', 'SGD')];
  const balances = [balance('cimb', '2026-09-20', 170000, 'SGD')];
  // S$1,700 was £1,000 at 1.70 on 30 Sep; at 1.75 now it's £971.43.
  const rates = [rate('2026-09-30', 'SGD', 1.7), rate('2026-10-14', 'SGD', 1.75)];
  const m = monthChange({ accounts, balances, rates, todayDate: TODAY });
  assert.equal(m.currencyPence, 97143 - 100000);
  assert.equal(m.balancesPence, 0);
  assert.equal(m.pence, m.currencyPence);
});

test('month change: card payments before the 1st are taken off the start, ones since are balance changes', () => {
  const accounts = [account('hsbc', 'current', 'GBP')];
  const balances = [balance('hsbc', '2026-09-20', 100000, 'GBP')];
  const methods = [{ id: 'visa', accountId: 'hsbc' }];
  const spend = (id, date, amountMinor) => ({ id, kind: 'spend', date, amountMinor, currency: 'GBP', gbpPence: amountMinor, methodId: 'visa' });
  const entries = [spend('a', '2026-09-25', 3000), spend('b', '2026-10-05', 2000)];
  const m = monthChange({ accounts, balances, rates: [], methods, entries, todayDate: TODAY });
  assert.equal(m.pence, -2000);
  assert.equal(m.balancesPence, -2000);
});

test('month change: an account added this month counts from its first balance', () => {
  const accounts = [account('hsbc', 'current', 'GBP'), account('dbs', 'current', 'GBP')];
  const balances = [
    balance('hsbc', '2026-09-20', 100000, 'GBP'),
    balance('dbs', '2026-10-05', 50000, 'GBP'),
    balance('dbs', '2026-10-12', 45000, 'GBP'),
  ];
  const m = monthChange({ accounts, balances, rates: [], todayDate: TODAY });
  assert.equal(m.pence, -5000);
  assert.equal(monthChange({ accounts: [], balances: [], rates: [], todayDate: TODAY }), null);
});

test('month change: IBKR splits into market moves and money moved in, and it adds up', () => {
  const ibkr = account('ibkr', 'investment', 'SGD');
  const hsbc = account('hsbc', 'current', 'GBP');
  const balances = [
    balance('ibkr', '2026-09-30', 1000000, 'SGD'),   // S$10,000 at the September close
    balance('ibkr', '2026-10-14', 1190000, 'SGD'),   // S$11,900 at the latest close
    balance('hsbc', '2026-09-30', 200000, 'GBP'),
  ];
  const activity = [
    { id: 'ibkr:cash:1', accountId: 'ibkr', date: '2026-10-03', type: 'deposit', amountMinor: 170000, currency: 'SGD' },
    { id: 'ibkr:cash:0', accountId: 'ibkr', date: '2026-09-28', type: 'deposit', amountMinor: 999999, currency: 'SGD' },
    { id: 'ibkr:cash:2', accountId: 'ibkr', date: '2026-10-08', type: 'dividend', amountMinor: 5000, currency: 'SGD' },
  ];
  const holdings = [{ id: 'ibkr:1', accountId: 'ibkr', quote: 'SPUS', currency: 'USD', unitsMicro: 1e6, closeMicro: 1e6, valueBaseMinor: 1190000, costBaseMinor: 0 }];
  const rates = [rate('2026-09-30', 'SGD', 1.7), rate('2026-10-14', 'SGD', 1.75), rate('2026-10-14', 'USD', 1.35)];
  const m = monthChange({ accounts: [ibkr, hsbc], balances, rates, holdings, activity, todayDate: TODAY });
  // Start £5,882.35 (S$10,000 at 1.70); at 1.75 it's £5,714.29. Now S$11,900 is £6,800.00.
  assert.equal(m.currencyPence, 571429 - 588235);
  // The S$1,700 deposit is £971.43 moved in; the rest is the market.
  assert.equal(m.balancesPence, 97143);
  assert.equal(m.marketPence, 680000 - 571429 - 97143);
  assert.equal(m.pence, 680000 - 588235);
  assert.equal(m.marketPence + m.currencyPence + m.balancesPence, m.pence);
  assert.equal(m.investments, true);
});

test('worth series: saved days in the range, oldest first, with today as it is now', () => {
  const snapshots = ['2026-03-01', '2026-05-01', '2026-10-14', '2026-10-15'].map((date, i) => ({ id: date, date, gbpPence: (i + 1) * 100 }));
  const six = worthSeries({ snapshots, totalPence: 777, todayDate: TODAY, range: '6m' });
  assert.deepEqual(six.points, [{ date: '2026-05-01', pence: 200 }, { date: '2026-10-14', pence: 300 }, { date: TODAY, pence: 777 }]);
  assert.equal(six.from, '2026-04-15');
  const all = worthSeries({ snapshots, totalPence: 777, todayDate: TODAY, range: 'all' });
  assert.equal(all.points.length, 4);
  assert.equal(all.from, '2026-03-01');
});

test('range scale: clean steps covering the values, not from zero', () => {
  const s = rangeScale(1234500, 1301000);
  assert.ok(s.min <= 1234500 && s.max >= 1301000);
  assert.ok(s.min > 0);
  assert.equal(s.ticks[0], s.min);
  assert.equal(s.ticks.at(-1), s.max);
  for (const t of s.ticks) assert.equal(t % 100, 0);
  const flat = rangeScale(500000, 500000);
  assert.ok(flat.min < 500000 && flat.max > 500000);
});

test('fromMicro: exact decimals with no trailing zeros', () => {
  assert.equal(fromMicro(184856300), '184.8563');
  assert.equal(fromMicro(2000000), '2');
  assert.equal(fromMicro(-2500000), '-2.5');
  assert.equal(fromMicro(1), '0.000001');
});

test('holding rows: value, today and gain per holding, largest first, with each one’s share', () => {
  const account = { id: 'ibkr' };
  const balanceRow = { date: '2026-10-14', amountMinor: 300000, currency: 'USD' };
  const holdings = [
    { id: 'a', accountId: 'ibkr', quote: 'GLD', currency: 'USD', unitsMicro: 1e6, closeMicro: 100e6, valueBaseMinor: 10000, costBaseMinor: 8000 },
    { id: 'b', accountId: 'ibkr', quote: 'SPUS', currency: 'USD', unitsMicro: 10e6, closeMicro: 30e6, valueBaseMinor: 30000, costBaseMinor: 0 },
  ];
  const prices = [{ id: 'GLD', currency: 'USD', priceMicro: 110e6, prevCloseMicro: 105e6, quoteAt: Date.UTC(2026, 9, 15, 15) }];
  const live = liveInvestment({ account, balance: balanceRow, holdings, prices, rates: [] });
  const v = holdingRows(live);
  assert.deepEqual(v.holdings.map((r) => r.holding.quote), ['SPUS', 'GLD']);
  const gld = v.holdings[1];
  assert.equal(gld.valueMinor, 11000);
  assert.equal(gld.todayMinor, 500);
  assert.equal(gld.gainMinor, 3000);
  assert.equal(gld.gainShare, 3000 / 8000);
  assert.equal(v.holdings[0].gainMinor, null);
  assert.equal(v.heldMinor, 41000);
  assert.equal(gld.share + v.holdings[0].share, 1);
});

test('activity: newest first, in words, signed as it moved the cash', () => {
  const rows = [
    { id: 'x:trade:1', accountId: 'x', date: '2026-10-01', type: 'buy', symbol: 'SPUS', unitsMicro: 2500000, amountMinor: 7000 },
    { id: 'x:cash:2', accountId: 'x', date: '2026-10-03', type: 'dividend', symbol: 'GLD', amountMinor: 120 },
    { id: 'x:cash:3', accountId: 'x', date: '2026-10-02', type: 'withdrawal', symbol: null, amountMinor: -5000 },
    { id: 'y:cash:4', accountId: 'y', date: '2026-10-09', type: 'deposit', amountMinor: 1 },
  ];
  assert.deepEqual(recentActivity(rows, 'x').map((a) => a.id), ['x:cash:2', 'x:cash:3', 'x:trade:1']);
  assert.equal(recentActivity(rows, 'x', 1).length, 1);
  assert.deepEqual(rows.map(activityTitle), ['Bought 2.5 SPUS', 'Dividend from GLD', 'Withdrawal', 'Deposit']);
  assert.deepEqual(rows.map(activityCash), [-7000, 120, -5000, 1]);
});

test('holding names: out of capitals, short words kept', async () => {
  const { holdingName } = await import('../../src/engine/holdings.js');
  assert.equal(holdingName('SPDR GOLD SHARES'), 'SPDR Gold Shares');
  assert.equal(holdingName('SP FUNDS S&P 500 SHARIA INDUSTRY'), 'SP Funds S&P 500 Sharia Industry');
  assert.equal(holdingName('iShares MSCI World'), 'iShares MSCI World');
});

test('holding names: acronyms with vowels stay in capitals', async () => {
  const { holdingName } = await import('../../src/engine/holdings.js');
  assert.equal(holdingName('ISHARES MSCI WORLD ISLAMIC UCITS ETF'), 'Ishares MSCI World Islamic UCITS ETF');
});
