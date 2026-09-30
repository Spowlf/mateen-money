import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyEquivalent, planSummary, catchUpDates } from '../../src/engine/plan.js';

const item = (extra) => ({ id: 'r', kind: 'spend', label: 'Item', amountMinor: 1200, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-15', active: 1, deletedAt: null, ...extra });
const rates = [{ forDate: '2026-09-30', currency: 'SGD', perGbp: 1.7 }];

test('plan: each frequency comes to its average month, rounded down', () => {
  assert.equal(monthlyEquivalent(item({ frequency: 'monthly' })), 1200);
  assert.equal(monthlyEquivalent(item({ frequency: 'weekly', amountMinor: 1000 })), 4333);   // £10 × 52 / 12
  assert.equal(monthlyEquivalent(item({ frequency: 'termly', amountMinor: 1000 })), 250);    // 3 a year
  assert.equal(monthlyEquivalent(item({ frequency: 'yearly', amountMinor: 1000 })), 83);
  assert.equal(monthlyEquivalent(item({ currency: 'SGD', amountMinor: 1700 }), rates), 1000);
});

test('plan: costs and income apart, soonest first, paused last and left out of the totals', () => {
  const p = planSummary([
    item({ id: 'phone', label: 'Phone', nextDate: '2026-10-20', amountMinor: 1000 }),
    item({ id: 'gym', label: 'Gym', nextDate: '2026-10-05', amountMinor: 2500 }),
    item({ id: 'paused', label: 'Paused', nextDate: '2026-10-01', active: 0 }),
    item({ id: 'old', label: 'Old', deletedAt: 9 }),
    item({ id: 'job', kind: 'income', label: 'Job', frequency: 'weekly', amountMinor: 6000 }),
  ]);
  assert.deepEqual(p.costs.map((i) => i.id), ['gym', 'phone', 'paused']);
  assert.deepEqual(p.income.map((i) => i.id), ['job']);
  assert.equal(p.monthlyCosts, 3500);
  assert.equal(p.monthlyIncome, 26000);
  assert.equal(p.estimated, false);
});

test('plan: a foreign-currency item makes the totals estimated', () => {
  assert.equal(planSummary([item({ currency: 'SGD' })], { rates }).estimated, true);
});

test('plan: a start date in the past lists what the next run will catch up', () => {
  assert.deepEqual(catchUpDates(item({ frequency: 'weekly', nextDate: '2026-09-17' }), '2026-10-01'), ['2026-09-17', '2026-09-24', '2026-10-01']);
  assert.deepEqual(catchUpDates(item({ nextDate: '2026-10-02' }), '2026-10-01'), []);
});
