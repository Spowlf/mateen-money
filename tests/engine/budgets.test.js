import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTH_BUDGET, budgetFor, budgetChange, budgetStatus, budgetStatusText, budgetDetail, budgetLogLine, budgetWarningLine, budgetPence,
} from '../../src/engine/budgets.js';
import { reviewCard } from '../../src/engine/review.js';
import { spend, income, CATEGORIES } from './fixtures.js';

const row = (fromMonth, amountPence, extra = {}) => ({ id: `month:${fromMonth}`, categoryId: MONTH_BUDGET, fromMonth, amountPence, deletedAt: null, ...extra });

test('budget: applies from its month on, never before', () => {
  const budgets = [row('2026-10', 50000)];
  assert.equal(budgetFor(budgets, '2026-09'), 0);
  assert.equal(budgetFor(budgets, '2026-10'), 50000);
  assert.equal(budgetFor(budgets, '2027-03'), 50000);
});

test('budget: a change keeps the earlier months as they were', () => {
  const budgets = [row('2026-10', 50000), row('2026-12', 45000), row('2027-02', 0)];
  assert.equal(budgetFor(budgets, '2026-11'), 50000);
  assert.equal(budgetFor(budgets, '2026-12'), 45000);
  assert.equal(budgetFor(budgets, '2027-01'), 45000);
  // 0: removed from February.
  assert.equal(budgetFor(budgets, '2027-02'), 0);
});

test('budget: deleted rows and old per-category rows are ignored', () => {
  const budgets = [row('2026-10', 50000), row('2026-11', 9000, { deletedAt: 1 }), { id: 'groceries:2026-11', categoryId: 'groceries', fromMonth: '2026-11', amountPence: 15000, deletedAt: null }];
  assert.equal(budgetFor(budgets, '2026-11'), 50000);
});

test('budget: a change writes this month’s row, or nothing if it’s the same', () => {
  const budgets = [row('2026-10', 50000)];
  assert.equal(budgetChange(budgets, '2026-11', 50000), null);
  assert.deepEqual(budgetChange(budgets, '2026-11', 45000),
    { id: 'month:2026-11', categoryId: 'month', fromMonth: '2026-11', amountPence: 45000, deletedAt: null });
  assert.equal(budgetChange([], '2026-10', 0), null);
});

test('budget status: none without a budget', () => {
  assert.equal(budgetStatus({ entries: [spend('2026-10-02', 3000)], month: '2026-10', todayDate: '2026-10-10' }), null);
});

test('budget status: this month has spent, left and a forecast; income doesn’t count', () => {
  const budgets = [row('2026-10', 50000)];
  const entries = [income('2026-10-01', 120000), spend('2026-10-02', 3000, 'groceries'), spend('2026-10-05', 2000, 'eating-out')];
  const b = budgetStatus({ entries, budgets, month: '2026-10', todayDate: '2026-10-10' });
  // £50 over 10 days → £5 a day: £50 + £105 = £155 of £500.
  assert.equal(b.spentPence, 5000);
  assert.equal(b.leftPence, 45000);
  assert.equal(b.forecastPence, 5000 + 500 * 21);
  assert.equal(b.status, 'ok');
  assert.equal(b.share, 0.1);
  assert.equal(budgetStatusText(b), '£450.00 left');
  assert.equal(budgetDetail(b), '£50 spent');
  assert.equal(budgetLogLine(b), '£450 of your £500 budget left this month.');
  assert.equal(budgetWarningLine(b), null);
});

test('budget status: forecast to go over, and over', () => {
  const budgets = [row('2026-10', 50000)];
  const heading = budgetStatus({ entries: [spend('2026-10-03', 30000)], budgets, month: '2026-10', todayDate: '2026-10-10' });
  assert.equal(heading.status, 'heading');
  assert.equal(heading.forecastPence, 30000 + 3000 * 21);
  assert.equal(budgetStatusText(heading), 'On track for £930');
  assert.equal(budgetWarningLine(heading), 'On track for £930 of your £500 budget for October.');
  const over = budgetStatus({ entries: [spend('2026-10-03', 52050)], budgets, month: '2026-10', todayDate: '2026-10-10' });
  assert.equal(over.status, 'over');
  assert.equal(over.share, 1);
  assert.equal(budgetStatusText(over), '£20.50 over');
  assert.equal(budgetLogLine(over), '£20.50 over your £500 budget this month.');
  assert.equal(budgetWarningLine(over), '£20.50 over your £500 budget for October.');
});

test('budget status: recurring costs count, still due ones as used', () => {
  const budgets = [row('2026-10', 5000)];
  const recurring = [{ id: 'r1', kind: 'spend', label: 'Spotify', amountMinor: 1199, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-20', categoryId: 'other', active: 1 }];
  const b = budgetStatus({ entries: [spend('2026-10-02', 1500, 'other', { recurringId: 'r0' })], budgets, recurring, month: '2026-10', todayDate: '2026-10-10' });
  assert.equal(b.spentPence, 1500);
  assert.equal(b.costsDue, 1199);
  assert.equal(b.leftPence, 5000 - 1500 - 1199);
  assert.equal(b.forecastPence, 1500 + 1199);
  assert.equal(budgetDetail(b), '£15 spent and £11.99 still due');
});

test('budget status: trips count; the toggle only takes them out of the pace', () => {
  const budgets = [row('2026-10', 50000)];
  const entries = [spend('2026-10-02', 1000), spend('2026-10-04', 4000, 'travel', { tripId: 't1' })];
  const all = budgetStatus({ entries, budgets, month: '2026-10', todayDate: '2026-10-10' });
  const out = budgetStatus({ entries, budgets, month: '2026-10', todayDate: '2026-10-10', excludeTrips: new Set(['t1']) });
  assert.equal(all.spentPence, 5000);
  assert.equal(out.spentPence, 5000);
  assert.equal(all.forecastPence, 5000 + 500 * 21);
  assert.equal(out.forecastPence, 5000 + 100 * 21);
});

test('budget status: past months are budget against actual, with no forecast', () => {
  const budgets = [row('2026-09', 40000), row('2026-10', 50000)];
  const entries = [spend('2026-09-10', 45000), spend('2026-10-02', 1000)];
  const sep = budgetStatus({ entries, budgets, month: '2026-09', todayDate: '2026-10-10' });
  assert.equal(sep.budgetPence, 40000);
  assert.equal(sep.spentPence, 45000);
  assert.equal(sep.forecastPence, null);
  assert.equal(sep.status, 'over');
  assert.equal(budgetStatus({ entries, budgets, month: '2026-08', todayDate: '2026-10-10' }), null);
});

test('weekly review: the budget comes with its status', () => {
  const budgets = [row('2026-10', 10000)];
  // Sunday 11 Oct: the review for 5–11 Oct is due.
  const entries = [spend('2026-10-03', 6000, 'eating-out'), spend('2026-10-06', 3000)];
  const card = reviewCard({ entries, categories: CATEGORIES, todayDate: '2026-10-11', budgets });
  assert.equal(card.budget.status, 'heading');
  assert.equal(reviewCard({ entries, categories: CATEGORIES, todayDate: '2026-10-11' }).budget, null);
});

test('budget amounts: pounds as typed', () => {
  assert.equal(budgetPence('500'), 50000);
  assert.equal(budgetPence('£1,200.5'), 120050);
  assert.equal(budgetPence(''), 0);
  assert.equal(budgetPence('12.345'), null);
  assert.equal(budgetPence('abc'), null);
});
