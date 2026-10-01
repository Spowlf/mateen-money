import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetFor, monthBudgets, budgetChange, budgetRows, budgetStatusText, budgetLogLine, budgetWarningLine, budgetPence,
} from '../../src/engine/budgets.js';
import { reviewCard } from '../../src/engine/review.js';
import { spend, CATEGORIES } from './fixtures.js';

const row = (categoryId, fromMonth, amountPence, extra = {}) => ({ id: `${categoryId}:${fromMonth}`, categoryId, fromMonth, amountPence, deletedAt: null, ...extra });

test('budgets: a budget applies from its month on, never before', () => {
  const budgets = [row('eating-out', '2026-10', 15000)];
  assert.equal(budgetFor(budgets, 'eating-out', '2026-09'), 0);
  assert.equal(budgetFor(budgets, 'eating-out', '2026-10'), 15000);
  assert.equal(budgetFor(budgets, 'eating-out', '2027-03'), 15000);
  assert.equal(budgetFor(budgets, 'groceries', '2026-10'), 0);
});

test('budgets: a change keeps the earlier months as they were', () => {
  const budgets = [row('eating-out', '2026-10', 15000), row('eating-out', '2026-12', 12000), row('eating-out', '2027-02', 0)];
  assert.equal(budgetFor(budgets, 'eating-out', '2026-11'), 15000);
  assert.equal(budgetFor(budgets, 'eating-out', '2026-12'), 12000);
  assert.equal(budgetFor(budgets, 'eating-out', '2027-01'), 12000);
  // 0: removed from February.
  assert.equal(budgetFor(budgets, 'eating-out', '2027-02'), 0);
  assert.deepEqual([...monthBudgets(budgets, '2027-01')], [['eating-out', 12000]]);
  assert.equal(monthBudgets(budgets, '2027-02').size, 0);
});

test('budgets: deleted rows are ignored', () => {
  const budgets = [row('eating-out', '2026-10', 15000), row('eating-out', '2026-11', 9000, { deletedAt: 1 })];
  assert.equal(budgetFor(budgets, 'eating-out', '2026-11'), 15000);
});

test('budgets: a change writes this month’s row, or nothing if it’s the same', () => {
  const budgets = [row('eating-out', '2026-10', 15000)];
  assert.equal(budgetChange(budgets, 'eating-out', '2026-11', 15000), null);
  assert.deepEqual(budgetChange(budgets, 'eating-out', '2026-11', 12000),
    { id: 'eating-out:2026-11', categoryId: 'eating-out', fromMonth: '2026-11', amountPence: 12000, deletedAt: null });
  assert.equal(budgetChange([], 'groceries', '2026-10', 0), null);
});

test('budget rows: this month has spent, left and a forecast', () => {
  const budgets = [row('groceries', '2026-10', 20000), row('eating-out', '2026-10', 10000)];
  const entries = [
    spend('2026-10-02', 3000, 'groceries'),
    spend('2026-10-05', 2000, 'groceries'),
    spend('2026-10-06', 2500, 'eating-out'),
  ];
  const rows = budgetRows({ entries, categories: CATEGORIES, budgets, month: '2026-10', todayDate: '2026-10-10' });
  assert.deepEqual(rows.map((r) => r.categoryId), ['groceries', 'eating-out']);
  const [groceries, eatingOut] = rows;
  // Groceries: £50 over 10 days → £5 a day, £50 + £105 = £155 of £200.
  assert.equal(groceries.spentPence, 5000);
  assert.equal(groceries.leftPence, 15000);
  assert.equal(groceries.forecastPence, 5000 + 500 * 21);
  assert.equal(groceries.status, 'ok');
  assert.equal(budgetStatusText(groceries), '£150.00 left');
  // Eating out: £25 at £2.50 a day → £77.50, under £100.
  assert.equal(eatingOut.forecastPence, 2500 + 250 * 21);
  assert.equal(eatingOut.status, 'ok');
});

test('budget rows: forecast to go over, and over', () => {
  const budgets = [row('eating-out', '2026-10', 10000), row('groceries', '2026-10', 4000)];
  const entries = [spend('2026-10-03', 6000, 'eating-out'), spend('2026-10-04', 4520, 'groceries')];
  const rows = budgetRows({ entries, categories: CATEGORIES, budgets, month: '2026-10', todayDate: '2026-10-10' });
  const groceries = rows.find((r) => r.categoryId === 'groceries');
  const eatingOut = rows.find((r) => r.categoryId === 'eating-out');
  assert.equal(eatingOut.status, 'heading');
  assert.equal(eatingOut.forecastPence, 6000 + 600 * 21);
  assert.equal(budgetStatusText(eatingOut), 'On track for £186 of £100');
  assert.equal(groceries.status, 'over');
  assert.equal(budgetStatusText(groceries), '£5.20 over');
  assert.equal(groceries.share, 1);
});

test('budget rows: recurring costs still due count towards the forecast', () => {
  const budgets = [row('other', '2026-10', 1500)];
  const recurring = [{ id: 'r1', kind: 'spend', label: 'Spotify', amountMinor: 1199, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-20', categoryId: 'other', active: 1 }];
  const [r] = budgetRows({ entries: [spend('2026-10-02', 500, 'other', { recurringId: 'r0' })], categories: CATEGORIES, budgets, recurring, month: '2026-10', todayDate: '2026-10-10' });
  assert.equal(r.forecastPence, 500 + 1199);
  assert.equal(r.status, 'heading');
});

test('budget rows: trips count against the budget; the toggle only takes them out of the pace', () => {
  const budgets = [row('eating-out', '2026-10', 10000)];
  const entries = [spend('2026-10-02', 1000, 'eating-out'), spend('2026-10-04', 4000, 'eating-out', { tripId: 't1' })];
  const [all] = budgetRows({ entries, categories: CATEGORIES, budgets, month: '2026-10', todayDate: '2026-10-10' });
  const [out] = budgetRows({ entries, categories: CATEGORIES, budgets, month: '2026-10', todayDate: '2026-10-10', excludeTrips: new Set(['t1']) });
  assert.equal(all.spentPence, 5000);
  assert.equal(out.spentPence, 5000);
  assert.equal(all.forecastPence, 5000 + 500 * 21);
  assert.equal(out.forecastPence, 5000 + 100 * 21);
});

test('budget rows: past months are budget against actual, with no forecast', () => {
  const budgets = [row('eating-out', '2026-09', 8000), row('eating-out', '2026-10', 12000)];
  const entries = [spend('2026-09-10', 9000, 'eating-out'), spend('2026-10-02', 1000, 'eating-out')];
  const [sep] = budgetRows({ entries, categories: CATEGORIES, budgets, month: '2026-09', todayDate: '2026-10-10' });
  assert.equal(sep.budgetPence, 8000);
  assert.equal(sep.spentPence, 9000);
  assert.equal(sep.forecastPence, null);
  assert.equal(sep.status, 'over');
  assert.deepEqual(budgetRows({ entries, categories: CATEGORIES, budgets, month: '2026-08', todayDate: '2026-10-10' }), []);
});

test('budget rows: a removed category drops out of this month but stays in old ones', () => {
  const categories = CATEGORIES.map((c) => (c.id === 'going-out' ? { ...c, archived: 1 } : c));
  const budgets = [row('going-out', '2026-09', 5000)];
  assert.equal(budgetRows({ entries: [], categories, budgets, month: '2026-10', todayDate: '2026-10-10' }).length, 0);
  assert.equal(budgetRows({ entries: [], categories, budgets, month: '2026-09', todayDate: '2026-10-10' }).length, 1);
});

test('budget lines: Log, and the review’s warnings', () => {
  const base = { name: 'Eating out', budgetPence: 15000 };
  assert.equal(budgetLogLine({ ...base, leftPence: 3400 }), 'Eating out: £34 left this month.');
  assert.equal(budgetLogLine({ ...base, leftPence: 3450 }), 'Eating out: £34.50 left this month.');
  assert.equal(budgetLogLine({ ...base, leftPence: -500 }), 'Eating out: £5 over this month.');
  assert.equal(budgetWarningLine({ ...base, status: 'over', leftPence: -2000 }, '2026-10'), 'Eating out: £20 over its £150 budget for October.');
  assert.equal(budgetWarningLine({ ...base, status: 'heading', forecastPence: 18040 }, '2026-10'), 'Eating out: on track for £180 of its £150 budget for October.');
});

test('weekly review: categories forecast to go over their budget are flagged', () => {
  const budgets = [row('eating-out', '2026-10', 10000), row('groceries', '2026-10', 50000)];
  // Sunday 11 Oct: the review for 5–11 Oct is due.
  const entries = [spend('2026-10-03', 6000, 'eating-out'), spend('2026-10-06', 3000, 'groceries')];
  const card = reviewCard({ entries, categories: CATEGORIES, todayDate: '2026-10-11', budgets });
  assert.deepEqual(card.budgetWarnings.map((r) => [r.categoryId, r.status]), [['eating-out', 'heading']]);
  assert.equal(reviewCard({ entries, categories: CATEGORIES, todayDate: '2026-10-11' }).budgetWarnings.length, 0);
});

test('budget amounts: pounds as typed', () => {
  assert.equal(budgetPence('150'), 15000);
  assert.equal(budgetPence('£1,200.5'), 120050);
  assert.equal(budgetPence(''), 0);
  assert.equal(budgetPence('12.345'), null);
  assert.equal(budgetPence('abc'), null);
});
