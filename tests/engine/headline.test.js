import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthHeadline, headlineReason } from '../../src/engine/headline.js';
import { monthShare, amountInRange, defaultSpreadStart } from '../../src/engine/allowance.js';
import { spend, income } from './fixtures.js';

// £6,000.05 net of rent, paid 28 Sep 2026, covering Oct 2026 – Sep 2027.
const allowance = income('2026-09-28', 600005, { incomeType: 'allowance', spreadMonths: 12, spreadStart: '2026-10' });

test('allowance spread: equal monthly shares, remainder in the last month, total exact', () => {
  assert.equal(monthShare(allowance, '2026-09'), 0);
  assert.equal(monthShare(allowance, '2026-10'), 50000);
  assert.equal(monthShare(allowance, '2027-08'), 50000);
  assert.equal(monthShare(allowance, '2027-09'), 50005);
  assert.equal(monthShare(allowance, '2027-10'), 0);
  let sum = 0;
  for (const m of ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09']) sum += monthShare(allowance, m);
  assert.equal(sum, 600005);
});

test('allowance spread: default start is the academic year', () => {
  assert.equal(defaultSpreadStart('2026-09-28', { incomeType: 'allowance', spreadMonths: 12 }), '2026-10');
  assert.equal(defaultSpreadStart('2026-10-02', { incomeType: 'allowance', spreadMonths: 12 }), '2026-10');
  assert.equal(defaultSpreadStart('2027-03-01', { incomeType: 'allowance', spreadMonths: 12 }), '2026-10');
  assert.equal(defaultSpreadStart('2027-03-01', { incomeType: 'family', spreadMonths: 3 }), '2027-03');
});

test('allowance spread: part months count pro rata by days', () => {
  // 6 Oct – 4 Dec: 26/31 of October, all of November, 4/31 of December.
  const expected = Math.floor((50000 * 26) / 31) + 50000 + Math.floor((50000 * 4) / 31);
  assert.equal(amountInRange(allowance, '2026-10-06', '2026-12-04'), expected);
  assert.equal(amountInRange(allowance, '2026-10-01', '2027-09-30'), 600005);
});

test('headline: allowance share minus spending', () => {
  const entries = [allowance, spend('2026-10-01', 1250), spend('2026-10-03', 4000), spend('2026-09-30', 9999)];
  const h = monthHeadline({ entries, month: '2026-10', todayDate: '2026-10-03' });
  assert.equal(h.incomeReceived, 50000);
  assert.equal(h.spent, 5250);
  assert.equal(h.left, 44750);
  assert.equal(h.negative, false);
  assert.equal(h.daysLeft, 29);
});

test('headline: the allowance counts even in months after it arrived', () => {
  const h = monthHeadline({ entries: [allowance], month: '2027-03', todayDate: '2027-03-10' });
  assert.equal(h.incomeReceived, 50000);
});

test('headline: recurring income and costs still due this month', () => {
  const recurring = [
    { id: 'r1', kind: 'spend', label: 'Phone', amountMinor: 1000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-20', anchorDay: 20, active: 1 },
    { id: 'r2', kind: 'income', label: 'Tutoring', amountMinor: 3000, currency: 'GBP', frequency: 'weekly', nextDate: '2026-10-16', active: 1 },
    { id: 'r3', kind: 'spend', label: 'Next month', amountMinor: 999, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01', active: 1 },
  ];
  const h = monthHeadline({ entries: [allowance, spend('2026-10-02', 2000)], recurring, month: '2026-10', todayDate: '2026-10-10' });
  assert.equal(h.costsDue, 1000);
  assert.equal(h.incomeDue, 3000 * 3); // 16, 23, 30 Oct
  assert.equal(h.left, 50000 + 9000 - 2000 - 1000);
});

test('headline: an upcoming yearly allowance counts only its share', () => {
  const recurring = [{ id: 'r4', kind: 'income', label: 'Allowance', amountMinor: 600000, currency: 'GBP', frequency: 'yearly', nextDate: '2026-10-05', incomeType: 'allowance', spreadMonths: 12, active: 1 }];
  const h = monthHeadline({ entries: [], recurring, month: '2026-10', todayDate: '2026-10-01' });
  assert.equal(h.incomeDue, 50000);
});

test('headline: recurring in another currency uses the latest rate and is estimated', () => {
  const recurring = [{ id: 'r5', kind: 'spend', label: 'SG phone', amountMinor: 1697, currency: 'SGD', frequency: 'monthly', nextDate: '2026-10-20', active: 1 }];
  const h = monthHeadline({ entries: [], recurring, rates: [{ forDate: '2026-09-30', currency: 'SGD', perGbp: 1.697 }], month: '2026-10', todayDate: '2026-10-01' });
  assert.equal(h.costsDue, 1000);
  assert.equal(h.estimated, true);
});

test('headline: red when negative, trips included, deleted entries ignored', () => {
  const entries = [income('2026-10-01', 10000), spend('2026-10-02', 8000, 'travel', { tripId: 't1' }), spend('2026-10-03', 5000), spend('2026-10-04', 99999, 'other', { deletedAt: 1 })];
  const h = monthHeadline({ entries, month: '2026-10', todayDate: '2026-10-05' });
  assert.equal(h.left, -3000);
  assert.equal(h.negative, true);
});

test('headline: entries still waiting for a rate are counted, not guessed', () => {
  const h = monthHeadline({ entries: [spend('2026-10-02', 0, 'other', { gbpPence: null })], month: '2026-10', todayDate: '2026-10-05' });
  assert.equal(h.unpriced, 1);
  assert.equal(h.spent, 0);
});

test('headline: income still waiting for a rate is flagged, only in the months it counts in', () => {
  const euros = income('2026-10-02', 0, { currency: 'EUR', gbpPence: null, gbpStatus: 'estimated' });
  const h = monthHeadline({ entries: [euros], month: '2026-10', todayDate: '2026-10-05' });
  assert.deepEqual([h.unpricedIncome, h.unpriced, h.incomeReceived], [1, 0, 0]);
  assert.equal(monthHeadline({ entries: [euros], month: '2026-11', todayDate: '2026-11-05' }).unpricedIncome, 0);
  const spread = income('2026-09-28', 0, { incomeType: 'allowance', spreadMonths: 12, spreadStart: '2026-10', gbpPence: null });
  assert.equal(monthHeadline({ entries: [spread], month: '2027-03', todayDate: '2027-03-05' }).unpricedIncome, 1);
});

test('headline: a past month has nothing still due and no days left', () => {
  const recurring = [{ id: 'r1', kind: 'spend', label: 'Phone', amountMinor: 1000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-20', active: 1 }];
  const h = monthHeadline({ entries: [], recurring, month: '2026-10', todayDate: '2026-11-25' });
  assert.deepEqual([h.costsDue, h.daysLeft], [0, 0]);
});

test('cash you already had: logged as income, it counts in full in the month it was logged', () => {
  const cash = income('2026-10-01', 15000, { incomeType: 'cash' });
  const entries = [cash, spend('2026-10-03', 2890)];
  const oct = monthHeadline({ entries, month: '2026-10', todayDate: '2026-10-05' });
  assert.deepEqual([oct.incomeReceived, oct.left, oct.negative], [15000, 12110, false]);
  // Anything left at the end of the month doesn't carry into the next one.
  assert.equal(monthHeadline({ entries, month: '2026-11', todayDate: '2026-11-01' }).incomeReceived, 0);
});

test('headline reason: says why it is below zero while nothing has come in this month', () => {
  const none = monthHeadline({ entries: [], month: '2026-10', todayDate: '2026-10-05' });
  assert.equal(headlineReason(none), 'Log your income and spending to see what’s left.');
  const spentOnly = monthHeadline({ entries: [spend('2026-10-03', 2890)], month: '2026-10', todayDate: '2026-10-05' });
  assert.equal(headlineReason(spentOnly),
    '£28.90 spent and nothing coming in this month yet. Log your existing cash, or your allowance, as income to see what’s left.');
  const both = monthHeadline({ entries: [income('2026-10-01', 15000, { incomeType: 'cash' }), spend('2026-10-03', 2890)], month: '2026-10', todayDate: '2026-10-05' });
  assert.equal(headlineReason(both), '£150 coming in, £28.90 spent and £0 still due this month.');
});
