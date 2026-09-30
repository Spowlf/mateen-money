import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  today, addDays, addMonths, daysBetween, weekday, weekStart, monthEnd, monthsBetween, addMonthsKey,
  overlapDays, formatDay, formatMonth, partsFromIso, partsInZone,
} from '../../src/engine/dates.js';

test('today uses local getters, not the UTC date', () => {
  const fake = { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 1 };
  assert.equal(today(fake), '2026-10-01');
});

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('addMonths clamps to the last day, and an anchor day comes back', () => {
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2027-02-28', 1, 31), '2027-03-31');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
});

test('daysBetween and weekday', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.equal(daysBetween('2026-10-31', '2026-10-01'), -30);
  assert.equal(weekday('2026-10-05'), 0); // Monday
  assert.equal(weekday('2026-10-04'), 6); // Sunday
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
  assert.equal(weekStart('2026-10-05'), '2026-10-05');
});

test('month helpers', () => {
  assert.equal(monthEnd('2027-02'), '2027-02-28');
  assert.equal(monthsBetween('2026-10', '2027-09'), 11);
  assert.equal(addMonthsKey('2026-12', 1), '2027-01');
  assert.equal(overlapDays('2026-10-01', '2026-10-31', '2026-10-06', '2026-12-04'), 26);
  assert.equal(overlapDays('2026-10-01', '2026-10-31', '2026-11-01', '2026-11-30'), 0);
});

test('formats dates as "30 Sep 2026"', () => {
  assert.equal(formatDay('2026-09-30'), '30 Sep 2026');
  assert.equal(formatMonth('2026-10'), 'October 2026');
});

test('partsFromIso keeps the local date of the offset it was written with', () => {
  const sg = partsFromIso('2026-10-01T00:30:00+08:00');
  assert.equal(sg.date, '2026-10-01');
  assert.equal(sg.time, '00:30');
  assert.equal(sg.at, Date.UTC(2026, 8, 30, 16, 30));
  assert.equal(partsFromIso('2026-10-01T12:34:56Z').time, '12:34');
  assert.equal(partsFromIso('2026-10-01 09:05').date, '2026-10-01');
  assert.equal(partsFromIso('1 Oct 2026 at 12:34'), null);
});

test('partsInZone gives the London date near midnight', () => {
  // 23:30 UTC on 30 Sep is 00:30 BST on 1 Oct.
  assert.equal(partsInZone(Date.UTC(2026, 8, 30, 23, 30)).date, '2026-10-01');
});
