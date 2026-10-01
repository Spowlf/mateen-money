import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupData, readBackup, csvCell, entriesCsv, BACKUP_TABLES } from '../../src/engine/export.js';
import { spend, income } from './fixtures.js';

test('backup: holds every live row of every table, and reads back', () => {
  const state = Object.fromEntries(BACKUP_TABLES.map((n) => [n, []]));
  state.entries = [spend('2026-10-01', 420, 'groceries', { id: 'a' }), spend('2026-10-01', 100, 'other', { id: 'b', deletedAt: 3 })];
  state.categories = [{ id: 'groceries', name: 'Groceries' }];
  const data = backupData(state, { now: 1000 });
  assert.equal(data.app, 'mateen-money');
  assert.equal(data.exportedAt, 1000);
  assert.deepEqual(data.tables.entries.map((e) => e.id), ['a']);
  const read = readBackup(JSON.parse(JSON.stringify(data)));
  assert.equal(read.ok, true);
  assert.equal(read.exportedAt, 1000);
  assert.equal(read.counts.entries, 1);
  assert.equal(read.counts.categories, 1);
});

test('backup: anything else is refused before it can replace data', () => {
  assert.deepEqual(readBackup(null), { ok: false, message: 'Nothing changed: this isn’t a Mateen Money backup.' });
  assert.deepEqual(readBackup({ app: 'miles', tables: {} }).ok, false);
  assert.deepEqual(readBackup({ app: 'mateen-money', version: 99, tables: {} }).message,
    'Nothing changed: this backup is from a newer version of the app. Reload the app first.');
  assert.deepEqual(readBackup({ app: 'mateen-money', version: 1, tables: { entries: [{ amountMinor: 1 }] } }).message,
    'Nothing changed: this backup is damaged.');
  assert.deepEqual(readBackup({ app: 'mateen-money', version: 1, tables: { entries: 'x' } }).ok, false);
});

test('csv: cells are quoted when needed, and formulas can\'t run', () => {
  assert.equal(csvCell('Pret'), 'Pret');
  assert.equal(csvCell('Coffee, cake'), '"Coffee, cake"');
  assert.equal(csvCell('The "good" one'), '"The ""good"" one"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+44 shop'), "'+44 shop");
  assert.equal(csvCell(null), '');
});

test('csv: payments oldest first, with names, amounts as decimals and GBP values', () => {
  const csv = entriesCsv({
    entries: [
      spend('2026-10-01', 757, 'eating-out', { amountMinor: 1250, currency: 'SGD', feePence: 22, gbpStatus: 'estimated', merchant: 'Lau Pa Sat', methodId: 'card', tripId: 't1', note: 'Dinner, with Sam', source: 'manual' }),
      spend('2026-09-30', 420, null, { merchant: 'PRET A MANGER', vendorId: null, source: 'applepay' }),
      income('2026-09-28', 1200000, { incomeType: 'allowance', time: null, source: 'recurring' }),
      spend('2026-09-30', 1, 'other', { deletedAt: 1 }),
    ],
    categories: [{ id: 'eating-out', name: 'Eating out' }],
    methods: [{ id: 'card', name: 'Card' }],
    trips: [{ id: 't1', name: 'Singapore' }],
  });
  assert.equal(csv, [
    'Date,Time,Type,Merchant,Category,Amount,Currency,GBP,Fee GBP,GBP is,Paid with,Trip,Description,Added by',
    '2026-09-28,,Income,,Allowance / stipend,12000.00,GBP,12000.00,,Final,,,,Plan',
    '2026-09-30,12:00,Spending,PRET A MANGER,To sort,4.20,GBP,4.20,,Final,,,,Apple Pay',
    '2026-10-01,12:00,Spending,Lau Pa Sat,Eating out,12.50,SGD,7.57,0.22,Estimated,Card,Singapore,"Dinner, with Sam",You',
    '',
  ].join('\r\n'));
});
