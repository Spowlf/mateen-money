import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termYearOf, yearTerms, replaceYearTerms, termLabel, datedTerms, shiftTerm, termNow, inTermSpan, clampTerm, TERM_YEARS } from '../../src/engine/terms.js';

const t26 = [
  { id: 'michaelmas-2026', name: 'Michaelmas', year: 2026, start: '2026-10-06', end: '2026-12-04' },
  { id: 'lent-2026', name: 'Lent', year: 2026, start: '2027-01-19', end: '2027-03-19' },
];
const t25 = [{ id: 'michaelmas-2025', name: 'Michaelmas', year: 2025, start: '2025-10-07', end: '2025-12-05' }];

test('terms: a year runs from October; June and the summer after it belong to the year before', () => {
  assert.equal(termYearOf('2026-10-07'), 2026);
  assert.equal(termYearOf('2026-10-01'), 2026);
  assert.equal(termYearOf('2026-09-30'), 2025);
  assert.equal(termYearOf('2027-06-12'), 2026);
});

test('terms: each year has all three, blank until entered', () => {
  const y = yearTerms([...t25, ...t26], 2026);
  assert.deepEqual(y.map((t) => [t.id, t.start]), [['michaelmas-2026', '2026-10-06'], ['lent-2026', '2027-01-19'], ['easter-2026', null]]);
  assert.deepEqual(yearTerms([...t25, ...t26], 2027).map((t) => t.start), [null, null, null]);
});

test('terms: dates saved before terms had a year are read by their dates; old blanks are ignored', () => {
  const old = [
    { id: 'michaelmas', name: 'Michaelmas', start: '2026-10-06', end: '2026-12-04' },
    { id: 'lent', name: 'Lent', start: null, end: null },
  ];
  assert.equal(yearTerms(old, 2026)[0].start, '2026-10-06');
  assert.equal(yearTerms(old, 2026)[1].id, 'lent-2026');
  assert.equal(yearTerms(old, 2025)[0].start, null);
});

test('terms: saving one year keeps the others and drops blanks', () => {
  const year = yearTerms([...t25, ...t26], 2026).map((t) => (t.name === 'Lent' ? { ...t, start: null, end: null } : t));
  const saved = replaceYearTerms([...t25, ...t26], 2026, year);
  assert.deepEqual(saved.map((t) => t.id), ['michaelmas-2025', 'michaelmas-2026']);
  assert.equal(saved[1].year, 2026);
});

test('terms: labels name the calendar year the term falls in', () => {
  assert.equal(termLabel({ name: 'Michaelmas', year: 2026 }), 'Michaelmas term 2026');
  assert.equal(termLabel({ name: 'Lent', year: 2026 }), 'Lent term 2027');
  assert.equal(termLabel({ name: 'Easter', year: 2026, start: '2027-04-20' }), 'Easter term 2027');
});

test('terms: stepping goes term by term across years', () => {
  assert.deepEqual(shiftTerm({ year: 2026, name: 'Michaelmas' }, 1), { year: 2026, name: 'Lent' });
  assert.deepEqual(shiftTerm({ year: 2026, name: 'Easter' }, 1), { year: 2027, name: 'Michaelmas' });
  assert.deepEqual(shiftTerm({ year: 2026, name: 'Michaelmas' }, -1), { year: 2025, name: 'Easter' });
});

test('terms: the term to show first is this one, else the last one, else the next, else Michaelmas', () => {
  const all = [...t25, ...t26];
  assert.deepEqual(datedTerms(all).map((t) => t.id), ['michaelmas-2025', 'michaelmas-2026', 'lent-2026']);
  assert.deepEqual(termNow(all, '2026-11-01'), { year: 2026, name: 'Michaelmas' });
  assert.deepEqual(termNow(all, '2026-12-20'), { year: 2026, name: 'Michaelmas' });
  assert.deepEqual(termNow(t26, '2026-09-01'), { year: 2026, name: 'Michaelmas' });
  assert.deepEqual(termNow([], '2027-02-01'), { year: 2026, name: 'Michaelmas' });
});

test('terms: only Easter 2026 to Easter 2027 are offered', () => {
  assert.equal(inTermSpan({ year: 2025, name: 'Lent' }), false);
  assert.equal(inTermSpan({ year: 2025, name: 'Easter' }), true);
  assert.equal(inTermSpan({ year: 2026, name: 'Michaelmas' }), true);
  assert.equal(inTermSpan({ year: 2026, name: 'Easter' }), true);
  assert.equal(inTermSpan({ year: 2027, name: 'Michaelmas' }), false);
  assert.deepEqual(clampTerm({ year: 2027, name: 'Lent' }), { year: 2026, name: 'Easter' });
  assert.deepEqual(clampTerm({ year: 2024, name: 'Easter' }), { year: 2025, name: 'Easter' });
  assert.deepEqual(TERM_YEARS, [2025, 2026]);
  // With no dates after the last term, Overview still opens on a term in the span.
  assert.deepEqual(termNow([], '2027-10-05'), { year: 2026, name: 'Easter' });
});
