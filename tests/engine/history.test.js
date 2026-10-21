import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchEntries, groupByDay, vendorSpending, TO_SORT, INCOME } from '../../src/engine/history.js';
import { CATEGORIES, spend, income } from './fixtures.js';

const vendors = [{ id: 'v1', name: 'Pret' }, { id: 'v2', name: 'Sainsbury’s' }];
const methods = [{ id: 'card', name: 'Card' }, { id: 'cash', name: 'Cash' }];
const trips = [{ id: 't1', name: 'Singapore', start: '2026-09-28', end: '2026-10-05' }];
const context = { vendors, categories: CATEGORIES, methods, trips };

const entries = [
  spend('2026-09-30', 420, 'coffee-snacks', { id: 'a', vendorId: 'v1', merchant: 'PRET A MANGER #1234', methodId: 'card', time: '08:10' }),
  spend('2026-09-30', 3150, 'groceries', { id: 'b', vendorId: 'v2', merchant: 'Sainsbury’s', methodId: 'card', time: '18:00', note: 'Big shop' }),
  spend('2026-10-01', 1250, 'eating-out', { id: 'c', merchant: 'Lau Pa Sat', currency: 'SGD', amountMinor: 1250, gbpPence: 735, methodId: 'cash', tripId: 't1' }),
  spend('2026-10-01', 999, null, { id: 'd', merchant: 'SQ *CORNER CAFE', methodId: 'card', time: '09:00' }),
  income('2026-09-28', 1200000, { id: 'e', incomeType: 'allowance', merchant: 'College' }),
  spend('2026-10-01', 500, 'other', { id: 'gone', deletedAt: 5 }),
];

const ids = (rows) => rows.map((e) => e.id);

test('history: newest first, by date then time, deleted entries left out', () => {
  assert.deepEqual(ids(searchEntries(entries, {}, context)), ['c', 'd', 'b', 'a', 'e']);
});

test('history: search finds the vendor, the name it arrived as, a note, a category, a method or a trip', () => {
  assert.deepEqual(ids(searchEntries(entries, { query: 'pret' }, context)), ['a']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'manger' }, context)), ['a']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'big shop' }, context)), ['b']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'Groceries' }, context)), ['b']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'singapore' }, context)), ['c']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'allowance' }, context)), ['e']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'corner cafe' }, context)), ['d']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'sainsburys' }, context)), ['b']);
  assert.deepEqual(ids(searchEntries(entries, { query: 'nothing like this' }, context)), []);
});

test('history: an amount finds the entry in its own currency or in pounds', () => {
  assert.deepEqual(ids(searchEntries(entries, { query: '4.20' }, context)), ['a']);
  assert.deepEqual(ids(searchEntries(entries, { query: '£31' }, context)), ['b']);
  assert.deepEqual(ids(searchEntries(entries, { query: '12.50' }, context)), ['c']);
  assert.deepEqual(ids(searchEntries(entries, { query: '7.35' }, context)), ['c']);
});

test('history: filters by category, To sort, income, trip and payment method, and combine', () => {
  assert.deepEqual(ids(searchEntries(entries, { categoryId: 'groceries' }, context)), ['b']);
  assert.deepEqual(ids(searchEntries(entries, { categoryId: TO_SORT }, context)), ['d']);
  assert.deepEqual(ids(searchEntries(entries, { categoryId: INCOME }, context)), ['e']);
  assert.deepEqual(ids(searchEntries(entries, { tripId: 't1' }, context)), ['c']);
  assert.deepEqual(ids(searchEntries(entries, { methodId: 'card' }, context)), ['d', 'b', 'a']);
  assert.deepEqual(ids(searchEntries(entries, { methodId: 'card', query: 'cafe' }, context)), ['d']);
});

test('history: the Payments and Income tabs filter by kind, and income by its type', () => {
  const more = [...entries, income('2026-09-29', 5000, { id: 'f', incomeType: 'family' })];
  assert.deepEqual(ids(searchEntries(more, { kind: 'spend' }, context)), ['c', 'd', 'b', 'a']);
  assert.deepEqual(ids(searchEntries(more, { kind: 'income' }, context)), ['f', 'e']);
  assert.deepEqual(ids(searchEntries(more, { kind: 'income', incomeType: 'family' }, context)), ['f']);
  assert.deepEqual(ids(searchEntries(more, { kind: 'income', query: 'college' }, context)), ['e']);
});

test('history: groups by day with each day\'s spending and income, "Today" only for today', () => {
  const groups = groupByDay(searchEntries(entries, {}, context), '2026-10-01');
  assert.deepEqual(groups.map((g) => [g.label, g.spent, g.income, ids(g.entries)]), [
    ['Today', 735 + 999, 0, ['c', 'd']],
    ['30 Sep 2026', 3150 + 420, 0, ['b', 'a']],
    ['28 Sep 2026', 0, 1200000, ['e']],
  ]);
});

test('history: filters by merchant', () => {
  assert.deepEqual(ids(searchEntries(entries, { vendorId: 'v1' }, context)), ['a']);
  assert.deepEqual(ids(searchEntries(entries, { vendorId: 'v2', query: 'pret' }, context)), []);
});

test('history: a merchant\'s spending, week by week from its first payment, then month by month', () => {
  const at = [
    spend('2026-10-01', 300, 'food', { id: 'm1', vendorId: 'v1', gbpStatus: 'estimated' }),
    spend('2026-10-03', 250, 'food', { id: 'm2', vendorId: 'v1' }),
    spend('2026-10-19', 420, 'food', { id: 'm3', vendorId: 'v1' }),
    spend('2026-10-04', 999, 'food', { id: 'other', vendorId: 'v2' }),
    spend('2026-10-05', 100, 'food', { id: 'gone', vendorId: 'v1', deletedAt: 5 }),
    income('2026-10-05', 420, { id: 'refund', vendorId: 'v1', incomeType: 'refund' }),
  ];
  const s = vendorSpending(at, 'v1', '2026-10-21');
  assert.deepEqual([s.count, s.pence, s.last, s.estimated, s.step], [3, 970, '2026-10-19', true, 'Week']);
  assert.deepEqual(s.steps.map((w) => [w.label, w.short, w.title, w.spent]), [
    ['28 Sep', '28', 'Week of 28 Sep 2026', 550],
    ['5 Oct', '5', 'Week of 5 Oct 2026', 0],
    ['12 Oct', '12', 'Week of 12 Oct 2026', 0],
    ['19 Oct', '19', 'Week of 19 Oct 2026', 420],
  ]);
  // Past 12 weeks it goes by month, a year at most.
  const months = vendorSpending([...at, spend('2026-06-30', 100, 'food', { vendorId: 'v1' })], 'v1', '2026-10-21');
  assert.deepEqual(months.steps.map((m) => [m.label, m.spent]), [['Jun', 100], ['Jul', 0], ['Aug', 0], ['Sep', 0], ['Oct', 970]]);
  assert.equal(vendorSpending([spend('2024-01-01', 100, 'food', { vendorId: 'v1' })], 'v1', '2026-10-21').steps.length, 12);
  assert.deepEqual(vendorSpending([], 'v1', '2026-10-21').steps.map((w) => w.label), ['19 Oct']);
});
