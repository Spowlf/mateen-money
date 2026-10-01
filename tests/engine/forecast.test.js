import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthHeadline, headlineFigure } from '../../src/engine/headline.js';
import {
  safeToSpend, safeToSpendLine, dailyRates, monthForecast, forecastLine, forecastRow, forecastReason,
} from '../../src/engine/forecast.js';
import { spend, income } from './fixtures.js';

const hlFor = (entries, todayDate, recurring = []) => monthHeadline({ entries, recurring, month: todayDate.slice(0, 7), todayDate });

test('safe to spend: left ÷ days left, today included', () => {
  // £500 in, £35 out on 10 Oct: £465 over 22 days (10–31 Oct).
  const hl = hlFor([income('2026-10-01', 50000), spend('2026-10-02', 3500)], '2026-10-10');
  const safe = safeToSpend(hl);
  assert.deepEqual(safe, { perDay: Math.floor(46500 / 22), daysLeft: 22 });
  assert.equal(safeToSpendLine(safe, '2026-10'), 'To stay within this month’s income, spend no more than £21.13 a day.');
});

test('safe to spend: a negative headline says how far over', () => {
  const hl = hlFor([income('2026-10-01', 10000), spend('2026-10-02', 13000)], '2026-10-05');
  const safe = safeToSpend(hl);
  assert.deepEqual(safe, { over: 3000, daysLeft: 27 });
  assert.equal(safeToSpendLine(safe, '2026-10'), 'Over by £30.00 this month.');
});

test('safe to spend: the last day of the month is all of what is left', () => {
  const hl = hlFor([income('2026-10-01', 10000), spend('2026-10-02', 2500)], '2026-10-31');
  const safe = safeToSpend(hl);
  assert.deepEqual(safe, { perDay: 7500, daysLeft: 1 });
  assert.equal(safeToSpendLine(safe, '2026-10'), 'To stay within this month’s income, spend no more than £75.00 today, the last day of October.');
});

test('safe to spend: recurring costs still due come off first', () => {
  const recurring = [{ id: 'r1', kind: 'spend', label: 'Gym', amountMinor: 2000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-25', active: 1 }];
  const hl = hlFor([income('2026-10-01', 32000)], '2026-10-17', recurring);
  assert.equal(safeToSpend(hl).perDay, Math.floor(30000 / 15));
});

test('safe to spend: trips always count, whatever the toggle (it follows the headline)', () => {
  const trip = spend('2026-10-03', 20000, 'travel', { tripId: 't1' });
  const hl = hlFor([income('2026-10-01', 50000), trip], '2026-10-11');
  assert.equal(safeToSpend(hl).perDay, Math.floor(30000 / 21));
});

test('safe to spend: with a budget it divides what is left of the budget', () => {
  const hl = hlFor([income('2026-10-01', 100000), spend('2026-10-02', 3500)], '2026-10-10');
  const budget = { budgetPence: 50000, spentPence: 3500, costsDue: 0, leftPence: 46500 - 0 - 0 };
  const fig = headlineFigure(hl, budget);
  assert.equal(fig.basis, 'budget');
  const safe = safeToSpend(fig);
  assert.deepEqual(safe, { perDay: Math.floor(46500 / 22), daysLeft: 22 });
  assert.equal(safeToSpendLine(safe, '2026-10', { basis: 'budget' }), 'To stay within budget, spend no more than £21.13 a day.');
  assert.equal(safeToSpendLine({ over: 3000, daysLeft: 9 }, '2026-10', { basis: 'budget' }), 'Over budget by £30.00 this month.');
});

test('safe to spend: an estimated headline carries a ~', () => {
  assert.equal(safeToSpendLine({ perDay: 1240, daysLeft: 9 }, '2026-10', { estimated: true }), 'To stay within this month’s income, spend no more than ~£12.40 a day.');
  assert.equal(safeToSpendLine(null, '2026-10'), null);
});

// 8 weeks of history before October: £14 a day (£784 over 56 days, from 6 Aug).
const history = [];
for (let d = 0; d < 56; d++) history.push(spend(isoAdd('2026-08-06', d), 1400, 'groceries'));
function isoAdd(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

test('daily rate: day 1 is mostly history', () => {
  const entries = [...history, spend('2026-10-01', 7000)];
  const { rates, weight, historyDays } = dailyRates(entries, '2026-10-01');
  assert.equal(historyDays, 56);
  assert.equal(weight, 1 / 7);
  assert.equal(Math.round(rates.get('all')), Math.round((1 / 7) * 7000 + (6 / 7) * 1400));
});

test('daily rate: one big early purchase does not swing it', () => {
  const entries = [...history, spend('2026-10-02', 30000)];
  const day2 = dailyRates(entries, '2026-10-02').rates.get('all');
  // Unblended, it would be £150 a day; blended it's (2/7)·£150 + (5/7)·£14.
  assert.equal(Math.round(day2), Math.round((2 / 7) * 15000 + (5 / 7) * 1400));
  assert.ok(day2 < 5500);
});

test('daily rate: day 7 and after use this month alone', () => {
  const entries = [...history, spend('2026-10-02', 7000), spend('2026-10-09', 1000)];
  assert.equal(dailyRates(entries, '2026-10-07').rates.get('all'), 7000 / 7);
  assert.equal(dailyRates(entries, '2026-10-10').rates.get('all'), 8000 / 10);
  assert.equal(dailyRates(entries, '2026-10-10').weight, 1);
});

test('daily rate: history counts only from the first payment', () => {
  // First payment 22 Sep: 9 days of history, £90 in all.
  const entries = [spend('2026-09-22', 9000), spend('2026-10-01', 2000)];
  const { rates, historyDays } = dailyRates(entries, '2026-10-02');
  assert.equal(historyDays, 9);
  assert.equal(rates.get('all'), (2 / 7) * (2000 / 2) + (5 / 7) * (9000 / 9));
});

test('daily rate: with no history this month stands alone', () => {
  const { rates, weight } = dailyRates([spend('2026-10-01', 600)], '2026-10-03');
  assert.equal(weight, 1);
  assert.equal(rates.get('all'), 200);
});

test('daily rate: leaves out recurring items, and trips when the toggle is on', () => {
  const entries = [
    spend('2026-10-02', 1000),
    spend('2026-10-03', 5000, 'other', { recurringId: 'r1', source: 'recurring' }),
    spend('2026-10-04', 9000, 'travel', { tripId: 't1' }),
  ];
  assert.equal(dailyRates(entries, '2026-10-10').rates.get('all'), 10000 / 10);
  assert.equal(dailyRates(entries, '2026-10-10', { excludeTrips: new Set(['t1']) }).rates.get('all'), 1000 / 10);
  // A payment filed under a deleted trip counts as an ordinary one.
  assert.equal(dailyRates(entries, '2026-10-10', { excludeTrips: new Set(['t2']) }).rates.get('all'), 10000 / 10);
});

test('daily rate: leaves out a booking for a trip, paid outside its dates, whatever the toggle', () => {
  const trips = [{ id: 't1', name: 'Singapore', start: '2027-01-05', end: '2027-01-20' }];
  const entries = [
    spend('2026-11-02', 1000),
    spend('2026-11-03', 40000, 'travel', { tripId: 't1', tripManual: 1 }),
  ];
  assert.equal(dailyRates(entries, '2026-11-10', { trips }).rates.get('all'), 1000 / 10);
  assert.equal(dailyRates(entries, '2026-11-10', { trips, excludeTrips: new Set(['t1']) }).rates.get('all'), 1000 / 10);
  // A booking under a deleted trip counts as ordinary spending again.
  const deleted = [{ ...trips[0], deletedAt: 1 }];
  assert.equal(dailyRates(entries, '2026-11-10', { trips: deleted }).rates.get('all'), 41000 / 10);
  // Nor does it count in the history blended into the next month's first days (29 days from 2 Nov).
  assert.equal(Math.round(dailyRates(entries, '2026-12-01', { trips }).rates.get('all')), Math.round((6 / 7) * (1000 / 29)));
});

test('daily rate: spending during the trip still sets the pace when trips are in', () => {
  const trips = [{ id: 't1', name: 'Singapore', start: '2027-01-05', end: '2027-01-20' }];
  const entries = [spend('2027-01-06', 3000, 'food', { tripId: 't1' })];
  assert.equal(dailyRates(entries, '2027-01-10', { trips }).rates.get('all'), 3000 / 10);
});

test('forecast: a trip booking counts in spent so far but not in the pace', () => {
  const trips = [{ id: 't1', name: 'Singapore', start: '2027-01-05', end: '2027-01-20' }];
  const entries = [income('2026-11-01', 100000), spend('2026-11-02', 1000), spend('2026-11-03', 40000, 'travel', { tripId: 't1', tripManual: 1 })];
  const f = monthForecast({ entries, trips, todayDate: '2026-11-10' });
  assert.equal(f.spent, 41000);
  assert.equal(f.dailyPence, 100);
  assert.equal(f.forecast, 41000 + 100 * 20);
});

test('forecast: spent + still due + pace × days after today', () => {
  const recurring = [{ id: 'r1', kind: 'spend', label: 'Phone', amountMinor: 1500, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-20', active: 1 }];
  const entries = [income('2026-10-01', 100000), spend('2026-10-03', 20000), spend('2026-10-08', 10000)];
  const f = monthForecast({ entries, recurring, todayDate: '2026-10-10' });
  assert.equal(f.daysAfter, 21);
  assert.equal(f.dailyPence, 3000);
  assert.equal(f.forecast, 30000 + 1500 + 3000 * 21);
  assert.equal(f.spare, 100000 - f.forecast);
  assert.equal(forecastLine(f), 'At this pace: £945.00 by 31 October, £55.00 to spare.');
  assert.deepEqual(forecastRow(f), { title: 'Spending by 31 Oct', amount: '£945.00', spare: '£55.00 to spare', over: false });
  // With a budget the pace is compared with it, not with the income.
  assert.equal(forecastLine(f, 85000), 'At this pace: £945.00 by 31 October, £95.00 over budget.');
  assert.deepEqual(forecastRow(f, 85000), { title: 'Spending by 31 Oct', amount: '£945.00', spare: '£95.00 over budget', over: true });
  assert.deepEqual(forecastRow(f, 100000), { title: 'Spending by 31 Oct', amount: '£945.00', spare: '£55.00 under budget', over: false });
  assert.equal(forecastReason(f), 'Counts £300.00 spent, £15.00 of recurring costs still due and about £30.00 a day for the 21 days left.');
});

test('forecast: more than you have', () => {
  const f = monthForecast({ entries: [income('2026-10-01', 40000), spend('2026-10-05', 30000)], todayDate: '2026-10-10' });
  assert.equal(f.forecast, 30000 + 3000 * 21);
  assert.equal(forecastLine(f), 'At this pace: £930.00 by 31 October, £530.00 more than you have.');
  assert.deepEqual(forecastRow(f), { title: 'Spending by 31 Oct', amount: '£930.00', spare: '£530.00 more than you have', over: true });
});

test('forecast: trips count in spent so far but not in the pace when left out', () => {
  const entries = [income('2026-10-01', 100000), spend('2026-10-02', 1000), spend('2026-10-04', 9000, 'travel', { tripId: 't1' })];
  const all = monthForecast({ entries, todayDate: '2026-10-10' });
  const out = monthForecast({ entries, todayDate: '2026-10-10', excludeTrips: new Set(['t1']) });
  assert.equal(all.spent, 10000);
  assert.equal(out.spent, 10000);
  assert.equal(all.forecast, 10000 + 1000 * 21);
  assert.equal(out.forecast, 10000 + 100 * 21);
});

test('forecast: the last day adds no pace', () => {
  const f = monthForecast({ entries: [income('2026-10-01', 50000), spend('2026-10-05', 31000)], todayDate: '2026-10-31' });
  assert.equal(f.daysAfter, 0);
  assert.equal(f.forecast, 31000);
  assert.equal(forecastReason(f), 'Counts £310.00 spent. Today is the last day of the month.');
});

test('forecast: the first week blends the pace without explaining it', () => {
  const f = monthForecast({ entries: [...history, income('2026-10-01', 50000), spend('2026-10-01', 700)], todayDate: '2026-10-01' });
  assert.equal(f.blended, true);
  assert.doesNotMatch(forecastReason(f), /blends/);
});

test('forecast: the reason adds up to the figure, to the penny', () => {
  // £475.87 on the 1st: a daily rate with a fraction of a penny.
  const f = monthForecast({ entries: [income('2026-10-01', 160000), spend('2026-10-01', 47587)], todayDate: '2026-10-01' });
  assert.ok(Number.isInteger(f.dailyPence));
  assert.equal(f.forecast, f.spent + f.costsDue + f.dailyPence * f.daysAfter);
});
