import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressKey, applyVendor, nextForm, vendorChoices, tidyName, syncedPhrase, summaryLine } from '../../src/engine/form.js';
import { emptyForm } from '../../src/engine/draft.js';
import { CATEGORIES, spend } from './fixtures.js';

test('keypad: digits, one decimal point, two decimals at most', () => {
  const type = (keys, currency = 'GBP') => keys.split('').reduce((a, k) => pressKey(a, k === '<' ? 'back' : k, currency), '');
  assert.equal(type('12.50'), '12.50');
  assert.equal(type('12.505'), '12.50');
  assert.equal(type('1..2'), '1.2');
  assert.equal(type('.5'), '0.5');
  assert.equal(type('0'), '0');
  assert.equal(type('07'), '7');
  assert.equal(type('12<'), '1');
  assert.equal(type('<'), '');
});

test('keypad: at most seven digits', () => {
  assert.equal(['1', '2', '3', '4', '5', '6', '7', '8'].reduce((a, k) => pressKey(a, k), ''), '1234567');
  assert.equal(pressKey('12345.6', '7'), '12345.67');
  assert.equal(pressKey('12345.67', '8'), '12345.67');
});

test('keypad: zero-decimal currencies take no decimal point', () => {
  assert.equal(pressKey('500', '.', 'JPY'), '500');
});

const vendor = { id: 'v1', name: 'Pret', categoryId: 'eating-out', currency: 'GBP', methodId: 'card', useCount: 3 };

test('vendor memory: picking a vendor fills its category, currency and payment method', () => {
  const form = { ...emptyForm({ date: '2026-10-01', time: '12:00', methodId: 'cash' }), amount: '4.20' };
  const f = applyVendor(form, vendor);
  assert.deepEqual([f.vendorId, f.vendorName, f.categoryId, f.currency, f.methodId, f.amount], ['v1', 'Pret', 'eating-out', 'GBP', 'card', '4.20']);
});

test('vendor memory: a vendor with gaps keeps what the form already has', () => {
  const form = { ...emptyForm({ date: '2026-10-01', time: '12:00', methodId: 'cash', currency: 'SGD' }), categoryId: 'groceries' };
  const f = applyVendor(form, { id: 'v2', name: 'New place', categoryId: null, currency: null, methodId: null });
  assert.deepEqual([f.categoryId, f.currency, f.methodId], ['groceries', 'SGD', 'cash']);
});

test('after saving: amount, vendor and note clear; date, currency and method stay', () => {
  const form = { ...applyVendor(emptyForm({ id: 'a', date: '2026-09-30', time: '09:00', methodId: 'cash' }), vendor), amount: '4.20', note: 'Lunch', tripId: 't1', tripManual: true };
  const f = nextForm(form, { id: 'b', time: '12:31' });
  assert.deepEqual(
    [f.id, f.amount, f.vendorId, f.vendorName, f.categoryId, f.note, f.tripId, f.tripManual, f.date, f.time, f.currency, f.methodId, f.kind],
    ['b', '', null, '', null, '', null, false, '2026-09-30', '12:31', 'GBP', 'card', 'spend'],
  );
});

const vendors = [
  { id: 'a', name: 'Pret', useCount: 9 },
  { id: 'b', name: 'Sainsburys', useCount: 2 },
  { id: 'c', name: 'Costa', useCount: 5 },
  { id: 'd', name: 'Pizza Hut', useCount: 1 },
  { id: 'e', name: 'Gone', useCount: 99, deletedAt: 5 },
];

test('recent vendors: most recently used first, then most used', () => {
  const entries = [spend('2026-09-29', 100, 'groceries', { vendorId: 'b' }), spend('2026-09-20', 100, 'groceries', { vendorId: 'a' })];
  assert.deepEqual(vendorChoices(vendors, entries).map((v) => v.name), ['Sainsburys', 'Pret', 'Costa', 'Pizza Hut']);
  assert.deepEqual(vendorChoices(vendors, entries, '', 2).map((v) => v.name), ['Sainsburys', 'Pret']);
});

test('recent vendors: typing filters, names that start with it first', () => {
  assert.deepEqual(vendorChoices(vendors, [], 'p').map((v) => v.name), ['Pret', 'Pizza Hut']);
  assert.deepEqual(vendorChoices(vendors, [], 'hut').map((v) => v.name), ['Pizza Hut']);
  assert.deepEqual(vendorChoices(vendors, [], 'sta').map((v) => v.name), ['Costa']);
  assert.deepEqual(vendorChoices(vendors, [], 'gone'), []);
});

test('tidy names: a payment\'s merchant becomes a readable vendor name', () => {
  assert.equal(tidyName('PRET A MANGER #1234'), 'Pret A Manger');
  assert.equal(tidyName('SQ *CORNER CAFE LONDON'), 'Corner Cafe');
  assert.equal(tidyName("sainsbury's"), 'Sainsburys');
  assert.equal(tidyName('#1234'), '#1234');
});

test('last synced: today says the time, other days say the date', () => {
  const now = new Date(2026, 9, 1, 18, 0);
  assert.equal(syncedPhrase(new Date(2026, 9, 1, 14, 5).getTime(), now), 'Last synced today at 14:05');
  assert.equal(syncedPhrase(new Date(2026, 8, 30, 9, 0).getTime(), now), 'Last synced 30 Sep 2026 at 09:00');
  assert.equal(syncedPhrase(null, now), 'Not synced yet');
});

test('summary line: what will be saved besides the amount and vendor', () => {
  const methods = [{ id: 'card', name: 'Card' }];
  const trips = [{ id: 't1', name: 'Singapore' }];
  const base = { ...emptyForm({ date: '2026-10-01', time: '12:30', methodId: 'card' }), categoryId: 'eating-out' };
  const ctx = { categories: CATEGORIES, methods, trips, todayDate: '2026-10-01' };
  assert.equal(summaryLine(base, ctx), 'Eating out, on Card, today at 12:30');
  assert.equal(summaryLine({ ...base, date: '2026-09-30', tripId: 't1' }, ctx), 'Eating out, on Card, 30 Sep 2026 at 12:30, Singapore trip');
  assert.equal(summaryLine({ ...base, categoryId: null, methodId: null, time: null }, ctx), 'Today');
  assert.equal(summaryLine({ ...base, kind: 'income', incomeType: 'allowance', spreadMonths: 12 }, ctx), 'Allowance / Stipend, today at 12:30, spread over 12 months');
  assert.equal(summaryLine({ ...base, kind: 'income', incomeType: 'cash', accountId: 'rev' }, { ...ctx, accounts: [{ id: 'rev', name: 'Revolut' }] }), 'Existing Cash, into Revolut, today at 12:30');
});
