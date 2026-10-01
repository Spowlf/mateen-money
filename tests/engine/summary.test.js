import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewWeek, usualWeekSpend, weekSummary, weeklyText } from '../../src/engine/summary.js';
import { reviewDue, reviewStreak, unusualCategories } from '../../src/engine/review.js';
import { CATEGORIES, spend } from './fixtures.js';

// The review week: Mon 28 Sep – Sun 4 Oct 2026.
const WEEK = '2026-09-28';

test('reviewWeek: this week on Sunday, last week Monday to Saturday', () => {
  assert.equal(reviewWeek('2026-10-04'), WEEK);        // Sunday
  assert.equal(reviewWeek('2026-10-05'), WEEK);        // Monday after
  assert.equal(reviewWeek('2026-10-10'), WEEK);        // Saturday after
  assert.equal(reviewWeek('2026-10-11'), '2026-10-05'); // next Sunday
});

// £100 a week for 8 weeks before, then this week.
function history() {
  const out = [];
  for (let i = 1; i <= 8; i++) {
    const monday = new Date(Date.UTC(2026, 8, 28 - 7 * i)).toISOString().slice(0, 10);
    out.push(spend(monday, 6000, 'groceries'), spend(monday, 4000, 'coffee-snacks'));
  }
  return out;
}

test('weekly summary: total is Monday to Sunday only', () => {
  const entries = [...history(), spend('2026-09-28', 1000), spend('2026-10-04', 2000), spend('2026-10-05', 99999), spend('2026-09-27', 3000, 'other')];
  const s = weekSummary({ entries, categories: CATEGORIES, todayDate: '2026-10-04' });
  assert.equal(s.start, WEEK);
  assert.equal(s.end, '2026-10-04');
  assert.equal(s.totalPence, 3000);
});

test('weekly summary: usual week is the average of the last 8 weeks', () => {
  const entries = [...history(), spend('2026-09-30', 11200, 'eating-out')];
  const s = weekSummary({ entries, categories: CATEGORIES, todayDate: '2026-10-04' });
  assert.equal(s.usualPence, 10000);
  assert.equal(s.usualWeeks, 8);
  assert.equal(s.changePct, 12);
});

test('weekly summary: a new tracker only averages weeks since the first entry', () => {
  const entries = [spend('2026-09-15', 5000), spend('2026-09-22', 7000), spend('2026-09-29', 6000)];
  const u = usualWeekSpend(entries, WEEK);
  assert.deepEqual(u, { averagePence: 6000, weeks: 2 });
  assert.deepEqual(usualWeekSpend([spend('2026-09-29', 6000)], WEEK), { averagePence: null, weeks: 0 });
});

test('weekly summary: top 3 categories and To sort count', () => {
  const entries = [
    spend('2026-09-29', 4800, 'eating-out'), spend('2026-09-30', 3500, 'groceries'), spend('2026-10-01', 2000, 'coffee-snacks'),
    spend('2026-10-02', 500, 'transport'), spend('2026-10-03', 9000, null), spend('2026-08-01', 100, null),
  ];
  const s = weekSummary({ entries, categories: CATEGORIES, todayDate: '2026-10-04' });
  assert.deepEqual(s.top.map((r) => r.categoryId), ['eating-out', 'groceries', 'coffee-snacks']);
  assert.equal(s.toSort, 2);
  assert.equal(s.largest[0].gbpPence, 9000);
  assert.equal(s.largest.length, 3);
});

test('weekly summary text', () => {
  const entries = [...history(), spend('2026-09-29', 4800, 'eating-out'), spend('2026-09-30', 3500, 'groceries'), spend('2026-10-01', 2000, 'coffee-snacks'), spend('2026-10-02', 930, 'transport'), spend('2026-10-02', 1000, null)];
  const s = weekSummary({ entries, categories: CATEGORIES, todayDate: '2026-10-04' });
  assert.equal(weeklyText(s), 'Week of 28 Sep: £122.30, 22% above your usual £100.00. Top: Eating out £48.00, Groceries £35.00, Coffee and snacks £20.00. 1 to sort.');
});

test('weekly summary text: close to usual, nothing to sort, no history', () => {
  const near = weekSummary({ entries: [...history(), spend('2026-09-29', 10300)], categories: CATEGORIES, todayDate: '2026-10-04' });
  assert.match(weeklyText(near), /: £103\.00, about your usual £100\.00\. .*Nothing to sort\.$/);
  const fresh = weekSummary({ entries: [spend('2026-09-29', 500)], categories: CATEGORIES, todayDate: '2026-10-04' });
  assert.equal(weeklyText(fresh), 'Week of 28 Sep: £5.00. Top: Groceries £5.00. Nothing to sort.');
});

test('review is due from Sunday until completed', () => {
  const entries = [spend('2026-09-29', 500)];
  assert.equal(reviewDue({ todayDate: '2026-10-03', reviews: [], entries }).due, false); // Saturday: last week had no data
  assert.equal(reviewDue({ todayDate: '2026-10-04', reviews: [], entries }).due, true);
  assert.equal(reviewDue({ todayDate: '2026-10-07', reviews: [], entries }).due, true);
  assert.equal(reviewDue({ todayDate: '2026-10-07', reviews: [{ weekStart: WEEK }], entries }).due, false);
  assert.equal(reviewDue({ todayDate: '2026-10-04', reviews: [], entries: [] }).due, false);
});

test('review streak counts weeks in a row', () => {
  const reviews = ['2026-09-14', '2026-09-21', '2026-09-28'].map((weekStart) => ({ weekStart }));
  assert.equal(reviewStreak(reviews, '2026-10-04'), 3);
  assert.equal(reviewStreak(reviews.slice(0, 2), '2026-10-04'), 2); // this week not done yet: still 2
  assert.equal(reviewStreak(reviews.slice(0, 2), '2026-10-11'), 0); // a week was missed
  assert.equal(reviewStreak([{ weekStart: '2026-09-07' }, { weekStart: '2026-09-21' }, { weekStart: '2026-09-28' }], '2026-10-04'), 2);
});

test('unusual: categories more than 50% above their 8-week average', () => {
  const entries = [
    ...history(),                                   // groceries £60/wk, coffee £40/wk
    spend('2026-09-29', 9001, 'groceries'),          // +50.0…%: unusual
    spend('2026-09-30', 6000, 'coffee-snacks'),      // exactly +50%: not unusual
    spend('2026-10-01', 2500, 'going-out'),          // no history, over £20: unusual
    spend('2026-10-02', 1500, 'transport'),          // no history, under £20: not
  ];
  const u = unusualCategories({ entries, categories: CATEGORIES, weekStart: WEEK });
  assert.deepEqual(u.map((r) => [r.categoryId, r.pct]), [['groceries', 50], ['going-out', null]]);
  assert.equal(u[0].averagePence, 6000);
});
