import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, shiftPeriod, overview, changeVsPrevious, niceScale, perWeek } from '../../src/engine/overview.js';
import { CATEGORIES, spend, income } from './fixtures.js';

const TODAY = '2026-10-15';
const terms = [
  { id: 'michaelmas-2025', name: 'Michaelmas', year: 2025, start: '2025-10-07', end: '2025-12-05' },
  { id: 'michaelmas-2026', name: 'Michaelmas', year: 2026, start: '2026-10-06', end: '2026-12-04' },
  { id: 'easter-2026', name: 'Easter', year: 2026, start: '2027-04-20', end: '2027-06-12' },
];
const MICHAELMAS = { kind: 'term', year: 2026, name: 'Michaelmas' };

test('periods: a month is the whole calendar month', () => {
  assert.deepEqual(periodRange({ kind: 'month', month: '2026-10' }, { todayDate: TODAY }),
    { kind: 'month', from: '2026-10-01', to: '2026-10-31', label: 'October 2026', current: true });
  assert.equal(periodRange({ kind: 'month', month: '2026-09' }, { todayDate: TODAY }).current, false);
});

test('periods: this year runs to the end of this month and says so; past years are whole', () => {
  // To the end of the month, not today, so the allowance counts this month's full share, as in the month view.
  assert.deepEqual(periodRange({ kind: 'year', date: TODAY }, { todayDate: TODAY, yearMode: 'academic' }),
    { kind: 'year', from: '2026-10-01', to: '2026-10-31', label: '2026–27 so far', current: true });
  assert.deepEqual(periodRange({ kind: 'year', date: '2025-10-15' }, { todayDate: TODAY, yearMode: 'academic' }),
    { kind: 'year', from: '2025-10-01', to: '2026-09-30', label: '2025–26', current: false });
  assert.equal(periodRange({ kind: 'year', date: TODAY }, { todayDate: TODAY, yearMode: 'calendar' }).label, '2026 so far');
});

test('periods: a term uses its year\'s dates, and a term with blank dates has none', () => {
  assert.deepEqual(periodRange(MICHAELMAS, { todayDate: TODAY, terms }),
    { kind: 'term', from: '2026-10-06', to: '2026-10-31', label: 'Michaelmas Term 2026 so far', current: true });
  assert.deepEqual(periodRange({ ...MICHAELMAS, year: 2025 }, { todayDate: TODAY, terms }),
    { kind: 'term', from: '2025-10-07', to: '2025-12-05', label: 'Michaelmas Term 2025', current: false });
  const endsSoon = [{ id: 'michaelmas-2026', name: 'Michaelmas', year: 2026, start: '2026-10-06', end: '2026-10-20' }];
  assert.equal(periodRange(MICHAELMAS, { todayDate: TODAY, terms: endsSoon }).to, '2026-10-20');
  assert.equal(periodRange({ kind: 'term', year: 2026, name: 'Easter' }, { todayDate: TODAY, terms }).label, 'Easter Term 2027');
  assert.equal(periodRange({ kind: 'term', year: 2026, name: 'Lent' }, { todayDate: TODAY, terms }), null);
  assert.equal(periodRange({ kind: 'term', year: 2030, name: 'Michaelmas' }, { todayDate: TODAY, terms }), null);
});

test('periods: stepping back and forward crosses year ends', () => {
  assert.deepEqual(shiftPeriod({ kind: 'month', month: '2026-01' }, -1), { kind: 'month', month: '2025-12' });
  assert.deepEqual(shiftPeriod({ kind: 'month', month: '2026-12' }, 1), { kind: 'month', month: '2027-01' });
  assert.deepEqual(shiftPeriod({ kind: 'year', date: '2026-10-15' }, -1), { kind: 'year', date: '2025-10-15' });
  assert.deepEqual(shiftPeriod(MICHAELMAS, -1), { kind: 'term', year: 2025, name: 'Easter' });
});

test('change vs last month: a percentage, or nothing to compare with', () => {
  assert.equal(changeVsPrevious(11200, 10000, '2026-09', '2026-10'), '12% more than September');
  assert.equal(changeVsPrevious(8800, 10000, '2026-09', '2026-10'), '12% less than September');
  assert.equal(changeVsPrevious(10040, 10000, '2026-09', '2026-10'), 'About the same as September');
  assert.equal(changeVsPrevious(5000, 10000, '2025-12', '2026-01'), '50% less than December 2025');
  assert.equal(changeVsPrevious(5000, 0, '2026-09', '2026-10'), null);
});

const trip = { id: 't1', name: 'Singapore', start: '2026-10-10', end: '2026-10-12' };
const entries = [
  spend('2026-09-10', 10000, 'groceries'),
  spend('2026-10-02', 3000, 'groceries'),
  spend('2026-10-11', 8000, 'travel', { tripId: 't1' }),
  income('2026-10-01', 50000),
  spend('2026-10-20', 999, 'groceries', { deletedAt: 5 }),
];
const base = { entries, categories: CATEGORIES, trips: [trip], todayDate: TODAY, yearMode: 'academic', terms };

test('overview: a month\'s totals, categories, comparison and six months of history', () => {
  const o = overview({ ...base, period: { kind: 'month', month: '2026-10' } });
  assert.deepEqual([o.totals.spent, o.totals.income, o.totals.net], [11000, 50000, 39000]);
  assert.deepEqual(o.rows.map((r) => r.categoryId), ['travel', 'groceries']);
  assert.equal(o.compare, '10% more than by this point in September');
  assert.deepEqual(o.series.map((s) => s.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(o.trips[0].pence, 8000);
});

test('overview: this month so far compares with the same days of last month', () => {
  const early = [spend('2026-09-03', 2000, 'groceries'), spend('2026-09-25', 9000, 'groceries'), spend('2026-10-02', 3000, 'groceries')];
  const o = overview({ ...base, entries: early, period: { kind: 'month', month: '2026-10' }, todayDate: '2026-10-05' });
  assert.equal(o.compare, '50% more than by this point in September');
  const past = overview({ ...base, entries: early, period: { kind: 'month', month: '2026-09' }, todayDate: '2026-10-05' });
  assert.equal(past.compare, null);
});

test('overview: leaving trips out changes the totals, not the trips section', () => {
  const o = overview({ ...base, period: { kind: 'month', month: '2026-10' }, excludeTrips: true });
  assert.equal(o.totals.spent, 3000);
  assert.deepEqual(o.rows.map((r) => r.categoryId), ['groceries']);
  assert.equal(o.series.at(-1).spent, 3000);
  assert.equal(o.trips[0].pence, 8000);
});

test('overview: a year shows history up to this month, and no month comparison', () => {
  const o = overview({ ...base, period: { kind: 'year', date: TODAY } });
  assert.equal(o.range.label, '2026–27 so far');
  assert.deepEqual([o.totals.spent, o.totals.income], [11000, 50000]);
  assert.equal(o.compare, null);
  assert.equal(o.series.at(-1).month, '2026-10');
});

test('overview: a term with no dates yet gives no figures', () => {
  assert.equal(overview({ ...base, period: { kind: 'term', year: 2026, name: 'Lent' } }), null);
});

test('overview: a term says what it cost a week, counting only the days so far', () => {
  const o = overview({ ...base, period: MICHAELMAS });
  assert.equal(o.totals.spent, 8000);                    // from 6 Oct: the September and 2 Oct payments are before the term
  assert.equal(o.weekly, Math.round((8000 * 7) / 10));   // 6–15 Oct is 10 days
  assert.equal(overview({ ...base, period: { kind: 'month', month: '2026-10' } }).weekly, null);
  assert.equal(overview({ ...base, period: { kind: 'term', year: 2026, name: 'Easter' } }).weekly, null);   // not started
});

test('per week: a short stretch counts as a whole week, and a past term uses all its days', () => {
  assert.equal(perWeek(7000, '2026-10-06', '2026-12-04', '2026-10-07'), 7000);
  assert.equal(perWeek(8400, '2025-10-07', '2025-12-05', '2026-10-15'), Math.round((8400 * 7) / 60));
});

test('overview: a deleted trip\'s payments count even when trips are left out', () => {
  const gone = { ...trip, deletedAt: 5 };
  const o = overview({ ...base, trips: [gone], period: { kind: 'month', month: '2026-10' }, excludeTrips: true });
  assert.equal(o.totals.spent, 11000);
  assert.deepEqual(o.trips, []);
});

test('axis: round steps of 1, 2 or 5, at most four of them', () => {
  assert.deepEqual(niceScale(123456), { step: 50000, max: 150000, ticks: [0, 50000, 100000, 150000] });
  assert.deepEqual(niceScale(4000), { step: 1000, max: 4000, ticks: [0, 1000, 2000, 3000, 4000] });
  assert.deepEqual(niceScale(4001).ticks, [0, 2000, 4000, 6000]);
  assert.deepEqual(niceScale(0), { step: 5000, max: 10000, ticks: [0, 5000, 10000] });
});
