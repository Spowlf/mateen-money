// Every spending figure counts only the user's share of a split bill: £40 paid, £30 owed back,
// £10 of spending. One assertion per summary, so a missed one fails by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withShares, periodTotals, categoryRows, tripTotals, monthHeadline, monthForecast, budgetStatus, overview,
  weekSummary, groupByDay, findHabits, unusualCategories, largestPurchases, searchEntries,
} from '../../src/engine/index.js';

const TODAY = '2026-10-15';
const cats = [{ id: 'food', name: 'Food', sort: 0, archived: 0 }, { id: 'snacks', name: 'Snacks', sort: 1, archived: 0 }];
const trips = [{ id: 't', name: 'Leeds', start: '2026-10-04', end: '2026-10-06', deletedAt: null }];
const bill = { id: 'e1', kind: 'spend', date: '2026-10-05', time: '12:00', at: null, amountMinor: 4000, currency: 'GBP', gbpPence: 4000, feePence: 0, gbpStatus: 'final', merchant: 'Dishoom', vendorId: 'v', categoryId: 'food', tripId: 't', spreadMonths: 1, deletedAt: null };
const owedBack = { id: 's1', entryId: 'e1', personId: 'alex', amountMinor: 3000, currency: 'GBP', direction: 'owedToMe', settlementId: null, deletedAt: null };
const entries = withShares([bill], [owedBack]);
const budgets = [{ id: 'month:2026-10', categoryId: 'month', fromMonth: '2026-10', amountPence: 50000, deletedAt: null }];

test('shares: a split bill becomes its share, the whole bill kept beside it', () => {
  const [e] = entries;
  assert.deepEqual([e.amountMinor, e.gbpPence, e.fullAmountMinor, e.fullGbpPence, e.split], [1000, 1000, 4000, 4000, true]);
  // Unsplit, income, and no splits at all: the very same rows.
  const income = { ...bill, id: 'i', kind: 'income' };
  assert.equal(withShares([bill], [])[0], bill);
  assert.equal(withShares([income], [{ ...owedBack, entryId: 'i' }])[0], income);
  // A deleted split doesn't count.
  assert.equal(withShares([bill], [{ ...owedBack, deletedAt: 1 }])[0].amountMinor, 4000);
  // Asked again with the same rows, the same answer (no work redone).
  const rows = [bill];
  const splits = [owedBack];
  assert.equal(withShares(rows, splits), withShares(rows, splits));
});

test('shares: the foreign card fee is shared in proportion', () => {
  const [e] = withShares([{ ...bill, gbpPence: 4120, feePence: 120 }], [owedBack]);
  assert.deepEqual([e.gbpPence, e.feePence], [1030, 30]);
});

test('period totals', () => assert.equal(periodTotals(entries, { from: '2026-10-01', to: '2026-10-31' }).spent, 1000));
test('category rows', () => assert.equal(categoryRows(entries, cats, { from: '2026-10-01', to: '2026-10-31' })[0].pence, 1000));
test('trip totals', () => assert.equal(tripTotals(entries, trips, cats)[0].pence, 1000));
test('Log headline', () => assert.equal(monthHeadline({ entries, month: '2026-10', todayDate: TODAY }).spent, 1000));
test('forecast', () => assert.equal(monthForecast({ entries, todayDate: TODAY }).spent, 1000));
test('budget', () => assert.equal(budgetStatus({ entries, budgets, month: '2026-10', todayDate: TODAY }).spentPence, 1000));
test('Overview totals and Spending by Category', () => {
  const o = overview({ entries, categories: cats, trips, period: { kind: 'month', month: '2026-10' }, todayDate: TODAY, yearMode: 'academic', terms: [] });
  assert.equal(o.totals.spent, 1000);
  assert.equal(o.rows[0].pence, 1000);
  assert.equal(o.trips[0].pence, 1000);
  assert.equal(o.series.reduce((s, x) => s + (x.spent ?? 0), 0), 1000);
});
test('weekly summary and review', () => {
  const s = weekSummary({ entries, categories: cats, todayDate: '2026-10-11' });
  assert.equal(s.totalPence, 1000);
  assert.equal(largestPurchases(entries, '2026-10-05', '2026-10-11')[0].gbpPence, 1000);
  const unusual = unusualCategories({ entries, categories: cats, weekStart: '2026-10-05' });
  assert.ok(unusual.every((u) => u.pence <= 1000));
});
test('History day totals and search', () => {
  assert.equal(groupByDay(entries, TODAY)[0].spent, 1000);
  assert.equal(searchEntries(entries, { kind: 'spend' }, { vendors: [], categories: cats })[0].amountMinor, 1000);
});
test('habits count a split small buy as small', () => {
  // Eight £8.00 snacks, £6.00 of each owed back: £2.00 buys, £16.00 in all, under the £20.00 bar…
  const many = Array.from({ length: 10 }, (_, i) => ({ ...bill, id: `h${i}`, date: `2026-10-0${(i % 7) + 5 > 9 ? 9 : (i % 7) + 3}`, amountMinor: 800, gbpPence: 800, categoryId: 'snacks', merchant: `Shop ${i}`, vendorId: `v${i}`, tripId: null }));
  const splits = many.map((e, i) => ({ ...owedBack, id: `x${i}`, entryId: e.id, amountMinor: 600 }));
  const habits = findHabits({ entries: withShares(many, splits), vendors: [], categories: cats, trips: [], end: '2026-10-11' });
  // …so ten £2.00 buys add up to £20.00: the habit is found from the shares, not the £8.00 bills.
  assert.equal(habits.length, 1);
  assert.equal(habits[0].pence, 2000);
});
