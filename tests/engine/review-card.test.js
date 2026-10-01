import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCard, unusualLine, reviewSteps } from '../../src/engine/review.js';
import { CATEGORIES, spend } from './fixtures.js';

const WEEK = '2026-09-28';

function history() {
  const out = [];
  for (let i = 1; i <= 8; i++) {
    const monday = new Date(Date.UTC(2026, 8, 28 - 7 * i)).toISOString().slice(0, 10);
    out.push(spend(monday, 6000, 'groceries'), spend(monday, 4000, 'coffee-snacks'));
  }
  return out;
}

const entries = [
  ...history(),
  spend('2026-09-29', 9500, 'groceries'),
  spend('2026-09-30', 2500, 'going-out'),
  spend('2026-10-01', 1200, null),
];

test('review card: shown from Sunday with the week, the unusual categories and the streak', () => {
  const card = reviewCard({ entries, categories: CATEGORIES, reviews: [{ weekStart: '2026-09-21' }], todayDate: '2026-10-04' });
  assert.equal(card.weekStart, WEEK);
  assert.equal(card.summary.totalPence, 13200);
  assert.deepEqual(card.unusual.map((u) => u.categoryId), ['groceries', 'going-out']);
  assert.equal(card.streak, 1);
  assert.equal(card.toSort, 1);
});

test('review card: not shown once the week is reviewed, or before anything is logged', () => {
  assert.equal(reviewCard({ entries, categories: CATEGORIES, reviews: [{ weekStart: WEEK }], todayDate: '2026-10-04' }), null);
  assert.equal(reviewCard({ entries: [], categories: CATEGORIES, reviews: [], todayDate: '2026-10-04' }), null);
});

test('review steps: sorting comes first only while something is waiting', () => {
  assert.deepEqual(reviewSteps({ toSort: 2 }), ['sort', 'week', 'unusual']);
  assert.deepEqual(reviewSteps({ toSort: 0 }), ['week', 'unusual']);
});

test('unusual lines say how far above usual, or that the category is new', () => {
  assert.equal(unusualLine({ name: 'Groceries', pence: 9500, averagePence: 6000, pct: 58 }), 'Groceries: £95.00, 58% above your usual £60.00.');
  assert.equal(unusualLine({ name: 'Going out', pence: 2500, averagePence: 0, pct: null }), 'Going out: £25.00, with nothing here in the weeks before.');
});
