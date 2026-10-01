import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHabits, habitLine } from '../../src/engine/habits.js';
import { reviewCard } from '../../src/engine/review.js';
import { CATEGORIES, spend } from './fixtures.js';

const END = '2026-10-04';                 // a review week's Sunday; the 4 weeks start 7 Sep
const VENDORS = [{ id: 'v-tesco', name: 'Tesco' }, { id: 'v-pret', name: 'Pret' }];

// n payments of pence each, one a day back from 4 Oct.
const daily = (n, pence, categoryId, extra) => Array.from({ length: n }, (_, i) =>
  spend(new Date(Date.UTC(2026, 9, 4 - i)).toISOString().slice(0, 10), pence, categoryId, extra));

test('habits: a merchant 8 times or more for £20 or more in the 4 weeks', () => {
  const entries = [...daily(10, 450, 'groceries', { vendorId: 'v-tesco' }), ...daily(7, 900, 'eating-out', { vendorId: 'v-pret' })];
  assert.deepEqual(findHabits({ entries, vendors: VENDORS, categories: CATEGORIES, end: END }),
    [{ kind: 'merchant', key: 'v-tesco', name: 'Tesco', count: 10, pence: 4500 }]);
});

test('habits: 8 visits that add up to under £20 are not a habit', () => {
  const entries = daily(8, 240, 'groceries', { vendorId: 'v-tesco' });
  assert.deepEqual(findHabits({ entries, vendors: VENDORS, categories: CATEGORIES, end: END }), []);
});

test('habits: only the 4 weeks ending on end count', () => {
  const inside = daily(7, 500, 'groceries', { vendorId: 'v-tesco' });
  const before = [spend('2026-09-06', 500, 'groceries', { vendorId: 'v-tesco' })];
  const after = [spend('2026-10-05', 500, 'groceries', { vendorId: 'v-tesco' })];
  assert.deepEqual(findHabits({ entries: [...inside, ...before, ...after], vendors: VENDORS, categories: CATEGORIES, end: END }), []);
  const first = [spend('2026-09-07', 500, 'groceries', { vendorId: 'v-tesco' })];
  assert.equal(findHabits({ entries: [...inside, ...first], vendors: VENDORS, categories: CATEGORIES, end: END })[0].count, 8);
});

test('habits: a merchant still in To sort is grouped by its cleaned name', () => {
  const entries = [...daily(5, 400, null, { merchant: 'TESCO STORES 3021' }), ...daily(4, 400, null, { merchant: 'Tesco Stores 1187' })];
  assert.deepEqual(findHabits({ entries, end: END }), [{ kind: 'merchant', key: 'tesco', name: 'Tesco', count: 9, pence: 3600 }]);
});

test('habits: many small buys in one category, across merchants', () => {
  const entries = daily(12, 300, 'coffee-snacks', { merchant: null }).map((e, i) => ({ ...e, merchant: `Cafe ${'ABCDEFGHIJKL'[i]}` }));
  assert.deepEqual(findHabits({ entries, categories: CATEGORIES, end: END }),
    [{ kind: 'small', key: 'coffee-snacks', name: 'Coffee and snacks', count: 12, pence: 3600 }]);
});

test('habits: small buys mostly from one frequent merchant show once, as the merchant', () => {
  const entries = [...daily(10, 300, 'coffee-snacks', { vendorId: 'v-pret' }), ...daily(2, 300, 'coffee-snacks', { merchant: 'Costa' })];
  assert.deepEqual(findHabits({ entries, vendors: VENDORS, categories: CATEGORIES, end: END }).map((h) => h.kind), ['merchant']);
});

test('habits: recurring costs, live trips, income and deleted rows are left out', () => {
  const entries = [
    ...daily(9, 400, 'groceries', { vendorId: 'v-tesco', source: 'recurring' }),
    ...daily(9, 400, 'groceries', { vendorId: 'v-pret', tripId: 't1' }),
    ...daily(9, 400, 'groceries', { vendorId: 'v-tesco', deletedAt: 1 }),
    ...daily(9, 400, 'groceries', { vendorId: 'v-tesco', kind: 'income' }),
  ];
  assert.deepEqual(findHabits({ entries, vendors: VENDORS, categories: CATEGORIES, trips: [{ id: 't1' }], end: END }), []);
  // A payment still pointing at a deleted trip is ordinary spending.
  const found = findHabits({ entries, vendors: VENDORS, categories: CATEGORIES, trips: [{ id: 't1', deletedAt: 1 }], end: END });
  assert.deepEqual(found.map((h) => h.name), ['Pret']);
});

test('habits: at most 3, largest total first', () => {
  const entries = ['a', 'b', 'c', 'd'].flatMap((v, i) => daily(8, 300 + i * 100, 'groceries', { vendorId: v }));
  const vendors = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
  assert.deepEqual(findHabits({ entries, vendors, categories: CATEGORIES, end: END }).map((h) => h.name), ['D', 'C', 'B']);
});

test('habit lines state the facts with the money in full', () => {
  assert.equal(habitLine({ kind: 'merchant', name: 'Tesco', count: 14, pence: 6320 }), 'Tesco: 14 times in 4 weeks, £63.20 in all.');
  assert.equal(habitLine({ kind: 'small', name: 'Coffee and snacks', count: 11, pence: 3140 }),
    'Coffee and snacks: 11 buys under £5.00 in 4 weeks, £31.40 in all.');
});

test('review card: carries the habits for the 4 weeks ending on its Sunday', () => {
  const entries = daily(10, 450, 'groceries', { vendorId: 'v-tesco' });
  const card = reviewCard({ entries, categories: CATEGORIES, vendors: VENDORS, todayDate: '2026-10-04' });
  assert.deepEqual(card.habits.map(habitLine), ['Tesco: 10 times in 4 weeks, £45.00 in all.']);
});
