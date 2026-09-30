import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, dueOccurrences, upcomingBetween, recurringEntry } from '../../src/engine/recurring.js';

const phone = { id: 'r1', kind: 'spend', label: 'Phone', amountMinor: 1000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-31', anchorDay: 31, categoryId: 'other', active: 1 };

test('step keeps a monthly item on its day, clamped in short months', () => {
  assert.equal(step('2026-10-31', 'monthly', 31), '2026-11-30');
  assert.equal(step('2026-11-30', 'monthly', 31), '2026-12-31');
  assert.equal(step('2027-01-31', 'monthly', 31), '2027-02-28');
  assert.equal(step('2026-10-01', 'weekly'), '2026-10-08');
  assert.equal(step('2026-10-01', 'termly'), '2027-02-01');
  assert.equal(step('2026-10-01', 'yearly'), '2027-10-01');
});

test('recurring: nothing is due before its date', () => {
  assert.deepEqual(dueOccurrences(phone, '2026-10-30'), { dates: [], nextDate: '2026-10-31' });
});

test('recurring: due on its date, then nextDate moves on', () => {
  assert.deepEqual(dueOccurrences(phone, '2026-10-31'), { dates: ['2026-10-31'], nextDate: '2026-11-30' });
});

test('recurring: added once and only once when the job runs twice', () => {
  const first = dueOccurrences(phone, '2026-10-31');
  const after = { ...phone, nextDate: first.nextDate };
  assert.deepEqual(dueOccurrences(after, '2026-10-31').dates, []);
});

test('recurring: missed days are caught up, each occurrence once', () => {
  const weekly = { ...phone, frequency: 'weekly', nextDate: '2026-10-01', anchorDay: null };
  const r = dueOccurrences(weekly, '2026-10-20');
  assert.deepEqual(r.dates, ['2026-10-01', '2026-10-08', '2026-10-15']);
  assert.equal(r.nextDate, '2026-10-22');
});

test('recurring: paused or deleted items never fire', () => {
  assert.deepEqual(dueOccurrences({ ...phone, active: 0 }, '2027-01-01').dates, []);
  assert.deepEqual(dueOccurrences({ ...phone, deletedAt: 1 }, '2027-01-01').dates, []);
});

test('upcomingBetween lists occurrences not yet added in a range', () => {
  const weekly = { ...phone, frequency: 'weekly', nextDate: '2026-10-08', anchorDay: null };
  assert.deepEqual(upcomingBetween(weekly, '2026-10-01', '2026-10-31'), ['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
  // Overdue occurrences from last month don't count in this one.
  assert.deepEqual(upcomingBetween({ ...weekly, nextDate: '2026-09-24' }, '2026-10-01', '2026-10-07'), ['2026-10-01']);
});

test('recurringEntry: the allowance spreads over the academic year', () => {
  const allowance = { id: 'r2', kind: 'income', label: 'Allowance', amountMinor: 600000, currency: 'GBP', frequency: 'yearly', incomeType: 'allowance', spreadMonths: 12 };
  const e = recurringEntry(allowance, '2026-09-28');
  assert.deepEqual([e.source, e.recurringId, e.occurrenceDate, e.spreadStart, e.spreadMonths, e.categoryId],
    ['recurring', 'r2', '2026-09-28', '2026-10', 12, null]);
  assert.equal(recurringEntry(allowance, '2027-01-05').spreadStart, '2026-10');
  assert.equal(recurringEntry(phone, '2026-10-31').spreadStart, null);
});
