import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, toDecimalText, formatMoney, parseAmountText, exponent } from '../../src/engine/money.js';
import { convertToGbp, rateFor, priceEntry, resolveCurrency, estimateGbp } from '../../src/engine/currency.js';

test('toMinor converts text without floating point drift', () => {
  assert.equal(toMinor('19.99'), 1999);
  assert.equal(toMinor('0.1'), 10);
  assert.equal(toMinor('12'), 1200);
  assert.equal(toMinor('12.345'), 1235);
  assert.equal(toMinor('12.344'), 1234);
  assert.equal(toMinor('500', 'JPY'), 500);
  assert.equal(toMinor('500.6', 'JPY'), 501);
  assert.equal(toMinor('abc'), null);
  assert.equal(toMinor(''), null);
});

test('zero-decimal currencies', () => {
  assert.equal(exponent('JPY'), 0);
  assert.equal(exponent('KRW'), 0);
  assert.equal(exponent('SGD'), 2);
  assert.equal(toDecimalText(1250, 'GBP'), '12.50');
  assert.equal(toDecimalText(500, 'JPY'), '500');
});

test('formatMoney uses a prefix and thousands separators', () => {
  assert.equal(formatMoney(123450, 'GBP'), '£1,234.50');
  assert.equal(formatMoney(1250, 'SGD'), 'S$12.50');
  assert.equal(formatMoney(-420, 'GBP'), '-£4.20');
  assert.equal(formatMoney(100000, 'GBP', { whole: true }), '£1,000');
  assert.equal(formatMoney(100050, 'GBP', { whole: true }), '£1,000.50');
  assert.equal(formatMoney(500, 'JPY'), '¥500');
  assert.equal(formatMoney(1200, 'CHF'), 'CHF 12.00');
});

test('parseAmountText reads payment notification amounts', () => {
  assert.deepEqual(parseAmountText('£4.20'), { value: '4.20', symbol: '£', code: null, negative: false });
  assert.equal(parseAmountText('S$12.50').symbol, 'S$');
  assert.equal(parseAmountText('US$3').symbol, 'US$');
  assert.equal(parseAmountText('$3.00').symbol, '$');
  assert.equal(parseAmountText('4,20 €').value, '4.20');
  assert.equal(parseAmountText('1.234,56 kr').value, '1234.56');
  assert.equal(parseAmountText('£1,234.56').value, '1234.56');
  assert.equal(parseAmountText('¥1,500').value, '1500');
  assert.deepEqual(parseAmountText('SGD 12.50'), { value: '12.50', symbol: null, code: 'SGD', negative: false });
  assert.equal(parseAmountText('12.50SGD').code, 'SGD');
  assert.equal(parseAmountText('CHF 9.90').symbol, 'CHF');
  assert.equal(parseAmountText('-£4.20').negative, true);
  assert.equal(parseAmountText('4.20').symbol, null);
  assert.equal(parseAmountText('£'), null);
  assert.equal(parseAmountText(''), null);
});

test('resolveCurrency: codes, clear symbols, remembered answers, and asking', () => {
  assert.equal(resolveCurrency({ symbol: '£' }).currency, 'GBP');
  assert.equal(resolveCurrency({ symbol: 'S$' }).currency, 'SGD');
  assert.equal(resolveCurrency({ code: 'SGD', symbol: '$' }).currency, 'SGD');
  const ask = resolveCurrency({ symbol: '$' });
  assert.equal(ask.ambiguous, true);
  assert.ok(ask.candidates.includes('SGD') && ask.candidates.includes('USD'));
  const remembered = resolveCurrency({ symbol: '$', symbolMemory: { $: 'SGD' } });
  assert.deepEqual([remembered.currency, remembered.ambiguous], ['SGD', false]);
  assert.equal(resolveCurrency({ symbol: '¥' }).ambiguous, true);
  assert.equal(resolveCurrency({}).currency, 'GBP');
  assert.equal(resolveCurrency({ cardDefault: 'SGD' }).currency, 'SGD');
});

test('conversion: GBP is untouched and never pays a fee', () => {
  assert.deepEqual(convertToGbp({ amountMinor: 420, currency: 'GBP', perGbp: 1, feeBps: 299 }), { basePence: 420, feePence: 0, gbpPence: 420 });
});

test('conversion: SGD at 1.697 per £1', () => {
  // S$16.97 = £10.00 exactly
  assert.equal(convertToGbp({ amountMinor: 1697, currency: 'SGD', perGbp: 1.697 }).gbpPence, 1000);
  // S$12.50 / 1.697 = £7.3659… → 737p
  assert.equal(convertToGbp({ amountMinor: 1250, currency: 'SGD', perGbp: 1.697 }).gbpPence, 737);
});

test('conversion: zero-decimal currency', () => {
  // ¥2,000 at 208.59 per £1 = £9.588… → 959p
  assert.equal(convertToGbp({ amountMinor: 2000, currency: 'JPY', perGbp: 208.59 }).gbpPence, 959);
});

test('conversion: the method fee is added on top of the GBP value', () => {
  const r = convertToGbp({ amountMinor: 1697, currency: 'SGD', perGbp: 1.697, feeBps: 299 });
  assert.deepEqual(r, { basePence: 1000, feePence: 30, gbpPence: 1030 });
  // 2.75% of 737p = 20.27 → 20p
  assert.equal(convertToGbp({ amountMinor: 1250, currency: 'SGD', perGbp: 1.697, feeBps: 275 }).feePence, 20);
  assert.equal(convertToGbp({ amountMinor: 1250, currency: 'SGD', perGbp: 1.697, feeBps: 0 }).feePence, 0);
});

test('conversion without a rate throws', () => {
  assert.throws(() => convertToGbp({ amountMinor: 100, currency: 'SGD', perGbp: 0 }));
});

const RATES = [
  { forDate: '2026-09-28', currency: 'SGD', perGbp: 1.70 },
  { forDate: '2026-09-30', currency: 'SGD', perGbp: 1.697 },
  { forDate: '2026-09-30', currency: 'USD', perGbp: 1.3286 },
];

test('rateFor: final only for that date once the date has passed', () => {
  assert.deepEqual(rateFor(RATES, 'SGD', '2026-09-30', '2026-10-01'), { perGbp: 1.697, status: 'final', forDate: '2026-09-30' });
  assert.equal(rateFor(RATES, 'SGD', '2026-09-30', '2026-09-30').status, 'estimated');
  // No rate for 1 Oct yet: estimated from the latest.
  assert.deepEqual(rateFor(RATES, 'SGD', '2026-10-01', '2026-10-01'), { perGbp: 1.697, status: 'estimated', forDate: '2026-09-30' });
  assert.equal(rateFor(RATES, 'EUR', '2026-10-01', '2026-10-01'), null);
  assert.equal(rateFor(RATES, 'GBP', '2026-10-01', '2026-10-01').status, 'final');
});

test('priceEntry marks estimates and keeps a statement override', () => {
  const entry = { date: '2026-10-01', amountMinor: 1697, currency: 'SGD', gbpStatus: null };
  const est = priceEntry(entry, { rates: RATES, feeBps: 299, todayDate: '2026-10-01' });
  assert.deepEqual([est.gbpPence, est.feePence, est.gbpStatus, est.rate], [1030, 30, 'estimated', 1.697]);

  const later = priceEntry({ ...entry, date: '2026-09-30' }, { rates: RATES, feeBps: 0, todayDate: '2026-10-02' });
  assert.equal(later.gbpStatus, 'final');

  const statement = { ...entry, gbpPence: 1049, gbpStatus: 'statement' };
  assert.equal(priceEntry(statement, { rates: RATES, feeBps: 299, todayDate: '2026-10-05' }), statement);

  const noRate = priceEntry({ ...entry, currency: 'EUR' }, { rates: RATES, todayDate: '2026-10-01' });
  assert.deepEqual([noRate.gbpPence, noRate.gbpStatus], [null, 'estimated']);
});

test('priceEntry converts foreign income at the rate with no fee: the fee is only charged on payments', () => {
  const income = { kind: 'income', date: '2026-10-01', amountMinor: 1697, currency: 'SGD', gbpStatus: null };
  const priced = priceEntry(income, { rates: RATES, feeBps: 299, todayDate: '2026-10-01' });
  assert.deepEqual([priced.gbpPence, priced.feePence, priced.feeBps, priced.rate], [1000, 0, 0, 1.697]);
});

test('estimateGbp uses the latest rate and no fee', () => {
  assert.equal(estimateGbp(1697, 'SGD', RATES), 1000);
  assert.equal(estimateGbp(500, 'GBP', RATES), 500);
  assert.equal(estimateGbp(500, 'EUR', RATES), 0);
});
