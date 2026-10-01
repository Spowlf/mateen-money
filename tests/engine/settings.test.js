import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentToBps, bpsToPercent, checkTerms, moveCategory, nextSort } from '../../src/engine/settings.js';

test('fees: a percentage becomes basis points and back', () => {
  assert.equal(percentToBps('2.99'), 299);
  assert.equal(percentToBps('2.99%'), 299);
  assert.equal(percentToBps('3'), 300);
  assert.equal(percentToBps(''), 0);
  assert.equal(percentToBps('0.005'), 1);   // rounds half up
  assert.equal(percentToBps('100'), 10000);
  assert.equal(percentToBps('100.01'), null);
  assert.equal(percentToBps('two'), null);
  assert.equal(percentToBps('-1'), null);
  assert.equal(bpsToPercent(299), '2.99');
  assert.equal(bpsToPercent(250), '2.5');
  assert.equal(bpsToPercent(300), '3');
  assert.equal(bpsToPercent(1000), '10');
  assert.equal(bpsToPercent(0), '0');
});

const terms = (...dates) => ['Michaelmas', 'Lent', 'Easter'].map((name, i) => ({
  id: name.toLowerCase(), name, start: dates[i]?.[0] ?? null, end: dates[i]?.[1] ?? null,
}));

test('terms: blank terms and properly dated terms are fine', () => {
  assert.equal(checkTerms(terms()), null);
  assert.equal(checkTerms(terms(['2026-10-06', '2026-12-04'], ['2027-01-19', '2027-03-19'])), null);
  assert.equal(checkTerms(terms(['2026-10-06', '2026-10-06'])), null);
});

test('terms: half-dated, backwards or overlapping terms say what to fix', () => {
  assert.equal(checkTerms(terms(['2026-10-06', null])), 'give Michaelmas Term both a first and a last day.');
  assert.equal(checkTerms(terms(['2026-12-04', '2026-10-06'])), 'end Michaelmas Term on or after its first day.');
  assert.equal(checkTerms(terms(['2026-10-06', '2026-12-04'], ['2026-12-04', '2027-03-19'])),
    'start Lent Term after Michaelmas Term ends on 4 Dec 2026.');
  assert.equal(checkTerms(terms(['6 Oct', '4 Dec'])), 'pick the dates for Michaelmas Term.');
  assert.equal(checkTerms('terms'), 'send the terms as a list.');
});

const cats = [
  { id: 'a', name: 'A', sort: 0, archived: 0 },
  { id: 'b', name: 'B', sort: 1, archived: 0 },
  { id: 'x', name: 'X', sort: 2, archived: 1 },
  { id: 'c', name: 'C', sort: 3, archived: 0 },
];

test('categories: moving swaps with the neighbour, skipping archived ones', () => {
  assert.deepEqual(moveCategory(cats, 'b', 1), [{ id: 'b', sort: 3 }, { id: 'c', sort: 1 }]);
  assert.deepEqual(moveCategory(cats, 'b', -1), [{ id: 'b', sort: 0 }, { id: 'a', sort: 1 }]);
  assert.deepEqual(moveCategory(cats, 'a', -1), []);
  assert.deepEqual(moveCategory(cats, 'c', 1), []);
});

test('categories: equal sort values are renumbered so the move sticks', () => {
  const same = [{ id: 'a', name: 'A', sort: 0 }, { id: 'b', name: 'B', sort: 0 }, { id: 'c', name: 'C', sort: 0 }];
  assert.deepEqual(moveCategory(same, 'c', -1), [{ id: 'c', sort: 1 }, { id: 'b', sort: 2 }]);
  assert.equal(nextSort(cats), 4);
  assert.equal(nextSort([]), 0);
});
