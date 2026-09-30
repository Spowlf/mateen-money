import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodTotals, categoryRows, yearRange, yearToDate, termOf, suggestTrip, tripTotals, retrip, change, monthlySeries } from '../../src/engine/totals.js';
import { topCategories, sortChoices, toSortNudge } from '../../src/engine/sort.js';
import { CATEGORIES, spend, income } from './fixtures.js';

const OCT = { from: '2026-10-01', to: '2026-10-31' };
const trip = { id: 't1', name: 'Summer in Singapore', start: '2026-10-10', end: '2026-10-20' };
const entries = [
  spend('2026-10-02', 3000, 'groceries'),
  spend('2026-10-12', 8000, 'travel', { tripId: 't1' }),
  spend('2026-10-13', 2000, 'eating-out', { tripId: 't1' }),
  spend('2026-10-14', 1000, null),
  income('2026-10-01', 50000),
];

test('trip exclusion: totals leave out trip entries only when asked', () => {
  assert.equal(periodTotals(entries, OCT).spent, 14000);
  assert.equal(periodTotals(entries, { ...OCT, excludeTrips: true }).spent, 4000);
  assert.equal(periodTotals(entries, { ...OCT, excludeTrips: true }).income, 50000);
});

test('trip exclusion: category rows and yearly totals follow the toggle', () => {
  const rows = categoryRows(entries, CATEGORIES, { ...OCT, excludeTrips: true });
  assert.deepEqual(rows.map((r) => r.categoryId), ['groceries', null]);
  assert.equal(rows[1].name, 'To sort');
  const year = yearRange('2026-10-15', 'academic');
  assert.equal(periodTotals(entries, { ...year, excludeTrips: true }).spent, 4000);
});

test('category rows: largest first with shares', () => {
  const rows = categoryRows(entries, CATEGORIES, OCT);
  assert.deepEqual(rows.map((r) => [r.categoryId, r.pence]), [['travel', 8000], ['groceries', 3000], ['eating-out', 2000], [null, 1000]]);
  assert.equal(rows[0].share, 8000 / 14000);
});

test('trip totals: each trip with its category breakdown', () => {
  const [t] = tripTotals(entries, [trip], CATEGORIES);
  assert.equal(t.pence, 10000);
  assert.deepEqual(t.rows.map((r) => r.categoryId), ['travel', 'eating-out']);
});

test('trip exclusion: only spending on a live trip is left out', () => {
  const more = [
    ...entries,
    spend('2026-10-15', 500, 'eating-out', { tripId: 'gone' }),
    income('2026-10-11', 700, { tripId: 't1' }),
  ];
  const t = periodTotals(more, { ...OCT, excludeTrips: new Set(['t1']) });
  assert.deepEqual([t.spent, t.income], [4500, 50700]);
  assert.deepEqual(categoryRows(more, CATEGORIES, { ...OCT, excludeTrips: new Set(['t1']) }).map((r) => r.categoryId), ['groceries', null, 'eating-out']);
});

test('trip totals: a trip that hasn\'t started yet costs nothing so far', () => {
  const later = { id: 't9', name: 'Paris', start: '2027-03-01', end: '2027-03-05' };
  const [t] = tripTotals(entries, [later], CATEGORIES);
  assert.deepEqual([t.pence, t.count, t.rows], [0, 0, []]);
});

test('trip totals: count and estimated flag for the trip sheet', () => {
  const est = [...entries, spend('2026-10-15', 900, 'travel', { tripId: 't1', gbpStatus: 'estimated' })];
  const [t] = tripTotals(est, [trip], CATEGORIES);
  assert.deepEqual([t.pence, t.count, t.estimated], [10900, 3, true]);
});

test('re-filing: payments on a trip\'s days join it, and ones no longer on them leave', () => {
  const list = [
    spend('2026-10-11', 100, 'travel'),                                       // now on the trip
    spend('2026-10-25', 200, 'travel', { tripId: 't1' }),                     // no longer on it
    spend('2026-10-12', 300, 'travel', { tripManual: 1 }),                    // set by hand: left alone
    spend('2026-10-26', 400, 'travel', { tripId: 't1', tripManual: 1 }),      // set by hand: left alone
    spend('2026-10-13', 500, 'travel', { tripId: 't1' }),                     // already right
    spend('2026-10-14', 600, 'travel', { deletedAt: 5 }),                     // deleted
    income('2026-10-11', 50000, { spreadMonths: 12 }),                        // income never joins a trip
  ];
  const moved = retrip(list, [trip]);
  assert.deepEqual(moved.map((e) => [e.amountMinor, e.tripId]), [[100, 't1'], [200, null]]);
  assert.equal(moved[0].date, '2026-10-11');   // whole rows, ready to write
});

test('re-filing: a deleted trip lets go of its payments, and the next trip on those days takes them', () => {
  const list = [spend('2026-10-17', 100, 'travel', { tripId: 't2' })];
  const inner = { id: 't2', name: 'Weekend in KL', start: '2026-10-16', end: '2026-10-18', deletedAt: 9 };
  assert.deepEqual(retrip(list, [trip, inner]).map((e) => e.tripId), ['t1']);
  assert.deepEqual(retrip(list, [inner]).map((e) => e.tripId), [null]);
});

test('trip suggestion by date', () => {
  assert.equal(suggestTrip('2026-10-15', [trip])?.id, 't1');
  assert.equal(suggestTrip('2026-10-20', [trip])?.id, 't1');
  assert.equal(suggestTrip('2026-10-21', [trip]), null);
  const inner = { id: 't2', name: 'Weekend in KL', start: '2026-10-16', end: '2026-10-18' };
  assert.equal(suggestTrip('2026-10-17', [trip, inner])?.id, 't2');
});

test('years: calendar and academic', () => {
  assert.deepEqual(yearRange('2027-03-01', 'academic'), { from: '2026-10-01', to: '2027-09-30', label: '2026–27' });
  assert.deepEqual(yearRange('2026-10-01', 'academic'), { from: '2026-10-01', to: '2027-09-30', label: '2026–27' });
  assert.deepEqual(yearRange('2026-09-30', 'academic').from, '2025-10-01');
  assert.deepEqual(yearRange('2026-10-01'), { from: '2026-01-01', to: '2026-12-31', label: '2026' });
  assert.equal(yearToDate('2026-10-15', 'academic').to, '2026-10-15');
});

test('terms: blank dates match nothing', () => {
  const terms = [{ id: 'm', name: 'Michaelmas', start: '2026-10-06', end: '2026-12-04' }, { id: 'l', name: 'Lent', start: '', end: '' }];
  assert.equal(termOf('2026-11-01', terms)?.name, 'Michaelmas');
  assert.equal(termOf('2027-02-01', terms), null);
});

test('change vs last month', () => {
  assert.deepEqual(change(12000, 10000), { delta: 2000, pct: 20 });
  assert.deepEqual(change(5000, 0), { delta: 5000, pct: null });
});

test('monthly series for income vs spending', () => {
  const s = monthlySeries(entries, '2026-10', 2);
  assert.deepEqual(s, [{ month: '2026-09', spent: 0, income: 0 }, { month: '2026-10', spent: 14000, income: 50000 }]);
});

test('To sort: top 4 categories by recent use, topped up in order', () => {
  const used = [spend('2026-09-20', 1, 'transport'), spend('2026-09-21', 1, 'transport'), spend('2026-09-22', 1, 'going-out'), spend('2026-01-01', 1, 'other')];
  assert.deepEqual(topCategories(used, CATEGORIES, { todayDate: '2026-10-01' }).map((c) => c.id), ['transport', 'going-out', 'other', 'groceries']);
});

test('To sort: choices offer the likely vendor', () => {
  const vendors = [{ id: 'v1', name: 'Pret', categoryId: 'coffee-snacks' }];
  const c = sortChoices({ merchant: 'PRET A MANGER' }, { vendors, categories: CATEGORIES, todayDate: '2026-10-01' });
  assert.equal(c.vendor?.id, 'v1');
  assert.equal(c.categories.length, 4);
});

test('To sort nudge above 10', () => {
  assert.equal(toSortNudge(10), null);
  assert.equal(toSortNudge(11), '11 to sort. It takes about a minute.');
});
