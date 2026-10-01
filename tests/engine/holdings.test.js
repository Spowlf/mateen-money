import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toMicro, mulMicro, convertMinor, quoteSymbol, marketOpen, readYahooChart, readFlex, xmlElements, flexDate, liveInvestment, gbpOf,
} from '../../src/engine/holdings.js';

const FLEX = readFileSync(new URL('../fixtures/flex.xml', import.meta.url), 'utf8');
const RATES = [
  { id: '2026-09-30:SGD', forDate: '2026-09-30', currency: 'SGD', perGbp: 1.725 },
  { id: '2026-09-30:USD', forDate: '2026-09-30', currency: 'USD', perGbp: 1.35 },
];

test('micro: decimal text to exact millionths', () => {
  assert.equal(toMicro('184.8563'), 184856300);
  assert.equal(toMicro('60'), 60000000);
  assert.equal(toMicro('69.6000'), 69600000);
  assert.equal(toMicro('-0.5'), -500000);
  assert.equal(toMicro('1,234.5'), 1234500000);
  assert.equal(toMicro('0.0000005'), 1);   // half a millionth rounds up
  assert.equal(toMicro('.25'), 250000);
  assert.equal(toMicro(''), null);
  assert.equal(toMicro('abc'), null);
});

test('micro: units × price to the cent, past 2^53 on the way', () => {
  assert.equal(mulMicro(toMicro('184.8563'), toMicro('69.6'), 'USD'), 1286600);   // US$12,866.00 (12,865.99848)
  assert.equal(mulMicro(toMicro('191.7271'), toMicro('60'), 'USD'), 1150363);    // US$11,503.63 (11,503.626)
  assert.equal(mulMicro(toMicro('6.779'), toMicro('381.11'), 'USD'), 258354);    // US$2,583.54
  assert.equal(mulMicro(toMicro('1000000'), toMicro('9000.123456'), 'USD'), 900012345600);
  assert.equal(mulMicro(toMicro('-2'), toMicro('1.005'), 'USD'), -201);          // half away from zero
  assert.equal(mulMicro(toMicro('3'), toMicro('1200'), 'JPY'), 3600);
});

test('convert: one currency to another through GBP at the latest rate', () => {
  // US$100.00 = £74.07... = S$127.78
  assert.equal(convertMinor(10000, 'USD', 'SGD', RATES), 12778);
  assert.equal(convertMinor(10000, 'USD', 'GBP', RATES), 7407);
  assert.equal(convertMinor(10000, 'GBP', 'SGD', RATES), 17250);
  assert.equal(convertMinor(10000, 'SGD', 'SGD', RATES), 10000);
  assert.equal(convertMinor(10000, 'EUR', 'SGD', RATES), null);
  assert.equal(gbpOf(17250, 'SGD', RATES), 10000);
});

test('quotes: IBKR’s exchange picks the ticker the price is fetched for', () => {
  assert.equal(quoteSymbol('SPUS', 'ARCA'), 'SPUS');
  assert.equal(quoteSymbol('ISDW', 'LSEETF'), 'ISDW.L');
  assert.equal(quoteSymbol('ES3', 'SGX'), 'ES3.SI');
  assert.equal(quoteSymbol('BRK B', 'NYSE'), 'BRK-B');
  assert.equal(quoteSymbol('XYZ', 'SOMEWHERE'), 'XYZ');
});

test('market hours: each market on its own clock, weekdays only', () => {
  // Thursday 1 Oct 2026. London is on BST (UTC+1), New York on EDT (UTC−4).
  const at = (h, m = 0) => Date.UTC(2026, 9, 1, h, m);
  assert.equal(marketOpen('ISDW.L', at(6, 59)), false);   // 07:59 London
  assert.equal(marketOpen('ISDW.L', at(7, 0)), true);     // 08:00
  assert.equal(marketOpen('ISDW.L', at(15, 35)), false);  // 16:35
  assert.equal(marketOpen('SPUS', at(13, 29)), false);    // 09:29 New York
  assert.equal(marketOpen('SPUS', at(13, 30)), true);
  assert.equal(marketOpen('SPUS', at(19, 59)), true);
  assert.equal(marketOpen('SPUS', at(20, 0)), false);
  assert.equal(marketOpen('ES3.SI', at(1, 0)), true);     // 09:00 Singapore
  assert.equal(marketOpen('SPUS', Date.UTC(2026, 9, 3, 15)), false);   // Saturday
});

test('quotes: read from Yahoo’s chart endpoint, pence made pounds', () => {
  const chart = (meta) => ({ chart: { result: [{ meta }] } });
  assert.deepEqual(readYahooChart(chart({ currency: 'USD', regularMarketPrice: 69.71, chartPreviousClose: 69.6, regularMarketTime: 1790850000 }), 'ISDW.L'),
    { id: 'ISDW.L', currency: 'USD', priceMicro: 69710000, prevCloseMicro: 69600000, quoteAt: 1790850000000 });
  assert.deepEqual(readYahooChart(chart({ currency: 'GBp', regularMarketPrice: 812.5, previousClose: 800, regularMarketTime: 1 }), 'VUSA.L'),
    { id: 'VUSA.L', currency: 'GBP', priceMicro: 8125000, prevCloseMicro: 8000000, quoteAt: 1000 });
  assert.equal(readYahooChart({ chart: { result: null, error: { code: 'Not Found' } } }, 'NOPE'), null);
  assert.equal(readYahooChart(chart({ currency: 'USD', regularMarketPrice: 0 }), 'X'), null);
});

test('flex: dates in any of IBKR’s formats', () => {
  assert.equal(flexDate('20261001'), '2026-10-01');
  assert.equal(flexDate('2026-10-01'), '2026-10-01');
  assert.equal(flexDate('20260911;202000'), '2026-09-11');
  assert.equal(flexDate(''), null);
});

test('flex: attributes read, entities decoded', () => {
  assert.deepEqual(xmlElements('<A x="1" y="S&amp;P" /><A x="2"/>', 'A'), [{ x: '1', y: 'S&P' }, { x: '2' }]);
});

test('flex: the statement’s NAV, holdings and activity', () => {
  const f = readFlex(FLEX);
  assert.equal(f.ibkrAccount, 'U1234567');
  assert.equal(f.baseCurrency, 'SGD');
  // The latest day's net asset value.
  assert.equal(f.reportDate, '2026-10-01');
  assert.equal(f.navMinor, 3445631);
  assert.deepEqual(f.positions.map((p) => [p.symbol, p.quote, p.currency, p.unitsMicro, p.closeMicro]), [
    ['SPUS', 'SPUS', 'USD', 191727100, 60000000],
    ['ISDW', 'ISDW.L', 'USD', 184856300, 69600000],
    // Listed as a summary and a lot: counted once.
    ['GLD', 'GLD', 'USD', 6779000, 381110000],
  ]);
  // Value and cost in SGD at IBKR's rate.
  assert.equal(f.positions[0].valueBaseMinor, 1473404);   // 11,503.626 × 1.280817 = 14,734.0397
  assert.equal(f.positions[0].costBaseMinor, 1216776);
  assert.equal(f.positions[0].name, 'SP FUNDS S&P 500 SHARIA INDUSTRY EXCLUSIONS ETF');
});

test('flex: trades and cash become activity, each once', () => {
  const { activity } = readFlex(FLEX);
  const by = Object.fromEntries(activity.map((a) => [a.id, a]));
  assert.deepEqual(by['trade:5550001'], { id: 'trade:5550001', date: '2026-09-02', type: 'buy', symbol: 'ISDW', unitsMicro: 10000000, priceMicro: 68900000, amountMinor: 69025, currency: 'USD' });
  assert.deepEqual([by['trade:5550002'].type, by['trade:5550002'].unitsMicro, by['trade:5550002'].amountMinor], ['sell', 500000, 18900]);
  assert.deepEqual([by['cash:7770001'].type, by['cash:7770001'].amountMinor, by['cash:7770001'].date], ['dividend', 249, '2026-09-11']);
  assert.equal(by['cash:7770002'].type, 'tax');
  assert.deepEqual([by['cash:7770003'].type, by['cash:7770003'].amountMinor], ['deposit', 50000]);
  assert.deepEqual([by['cash:7770004'].type, by['cash:7770004'].amountMinor], ['withdrawal', -10000]);
  assert.equal(by['cash:7770005'], undefined);
  assert.equal(activity.length, 6);
});

test('flex: not a statement', () => {
  assert.equal(readFlex('<FlexStatementResponse><Status>Fail</Status></FlexStatementResponse>'), null);
});

// IBKR's value during the day.
const ibkr = { id: 'ibkr', kind: 'investment', currency: 'SGD' };
const close = { id: 'ibkr:2026-10-01', accountId: 'ibkr', date: '2026-10-01', amountMinor: 3445631, currency: 'SGD' };
const holdingsFrom = () => readFlex(FLEX).positions.map((p) => ({ ...p, id: `ibkr:${p.key}`, accountId: 'ibkr', deletedAt: null }));
const FRIDAY_NOON_NY = Date.UTC(2026, 9, 2, 16);

test('live: no newer prices, the close stands', () => {
  const live = liveInvestment({ account: ibkr, balance: close, holdings: holdingsFrom(), prices: [], rates: RATES });
  assert.equal(live.amountMinor, 3445631);
  assert.equal(live.todayMinor, null);
  assert.equal(live.pricedAt, null);
});

test('live: the close plus each holding’s move since, in SGD', () => {
  const prices = [
    { id: 'SPUS', currency: 'USD', priceMicro: 61000000, prevCloseMicro: 60000000, quoteAt: FRIDAY_NOON_NY },
    { id: 'ISDW.L', currency: 'USD', priceMicro: 69600000, prevCloseMicro: 69600000, quoteAt: FRIDAY_NOON_NY },
  ];
  const live = liveInvestment({ account: ibkr, balance: close, holdings: holdingsFrom(), prices, rates: RATES });
  // SPUS up US$1.00 × 191.7271 = US$191.73 = S$244.99 at the app's rates.
  assert.equal(live.amountMinor, 3445631 + 24499);
  assert.equal(live.todayMinor, 24499);
  assert.equal(live.pricedAt, FRIDAY_NOON_NY);
  assert.equal(live.holdings[0].valueMinor, 1473404 + 24499);
});

test('live: a quote from the close’s own day or before never moves it', () => {
  const prices = [{ id: 'SPUS', currency: 'USD', priceMicro: 99000000, prevCloseMicro: 60000000, quoteAt: Date.UTC(2026, 9, 1, 19) }];
  assert.equal(liveInvestment({ account: ibkr, balance: close, holdings: holdingsFrom(), prices, rates: RATES }).amountMinor, 3445631);
});

test('live: after a Friday close, Monday’s prices count', () => {
  const friday = { ...close, date: '2026-10-02' };
  const monday = Date.UTC(2026, 9, 5, 15);
  const prices = [{ id: 'GLD', currency: 'USD', priceMicro: 391110000, prevCloseMicro: 381110000, quoteAt: monday }];
  const live = liveInvestment({ account: ibkr, balance: friday, holdings: holdingsFrom(), prices, rates: RATES });
  // US$10.00 × 6.779 = US$67.79 = S$86.62
  assert.equal(live.amountMinor - friday.amountMinor, 8662);
});

test('live: a price in another currency than the holding’s is ignored', () => {
  const prices = [{ id: 'SPUS', currency: 'GBP', priceMicro: 1, prevCloseMicro: 1, quoteAt: FRIDAY_NOON_NY }];
  assert.equal(liveInvestment({ account: ibkr, balance: close, holdings: holdingsFrom(), prices, rates: RATES }).amountMinor, 3445631);
});

test('live: gain is value less IBKR’s cost', () => {
  const live = liveInvestment({ account: ibkr, balance: close, holdings: holdingsFrom(), prices: [], rates: RATES });
  const f = readFlex(FLEX);
  const cost = f.positions.reduce((s, p) => s + p.costBaseMinor, 0);
  const value = f.positions.reduce((s, p) => s + p.valueBaseMinor, 0);
  assert.equal(live.costMinor, cost);
  assert.equal(live.gainMinor, value - cost);
});

test('live: nothing without a close yet', () => {
  assert.equal(liveInvestment({ account: ibkr, balance: null, holdings: [], prices: [], rates: RATES }), null);
});
