import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, NOW } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

const phone = { kind: 'spend', label: 'Phone', amountMinor: 1000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-01', categoryId: 'phone-utilities', methodId: 'card' };

test('recurring: an item due today is added once, marked automatic, and its next date moves on', async () => {
  const w = makeWorker();
  await w.call('PUT', '/recurring/r1', { body: phone });
  await w.scheduled();
  const [e] = w.rows('entries');
  assert.deepEqual(
    [e.source, e.recurringId, e.occurrenceDate, e.date, e.merchant, e.categoryId, e.gbpPence, e.methodId],
    ['recurring', 'r1', '2026-10-01', '2026-10-01', 'Phone', 'phone-utilities', 1000, 'card'],
  );
  assert.equal(w.rows('recurring')[0].nextDate, '2026-11-01');
});

test('recurring: running the job twice adds nothing more', async () => {
  const w = makeWorker();
  await w.call('PUT', '/recurring/r1', { body: phone });
  await w.scheduled();
  await w.scheduled();
  assert.equal(w.rows('entries').length, 1);
});

test('recurring: an occurrence already stored is never added again, even if next date is set back', async () => {
  const w = makeWorker();
  await w.call('PUT', '/recurring/r1', { body: phone });
  await w.scheduled();
  await w.call('PUT', '/recurring/r1', { body: { nextDate: '2026-10-01' } });
  await w.scheduled();
  assert.equal(w.rows('entries').length, 1);
  assert.equal(w.rows('recurring')[0].nextDate, '2026-11-01');
});

test('recurring: missed days are caught up, each occurrence once', async () => {
  const w = makeWorker();
  await w.call('PUT', '/recurring/r1', { body: { ...phone, frequency: 'weekly', nextDate: '2026-09-17' } });
  await w.scheduled();
  assert.deepEqual(w.rows('entries').map((e) => e.date).sort(), ['2026-09-17', '2026-09-24', '2026-10-01']);
  assert.equal(w.rows('recurring')[0].nextDate, '2026-10-08');
});

test('recurring: paused, deleted and future items add nothing', async () => {
  const w = makeWorker();
  await w.call('PUT', '/recurring/r1', { body: { ...phone, active: 0 } });
  await w.call('PUT', '/recurring/r2', { body: phone });
  await w.call('DELETE', '/recurring/r2');
  await w.call('PUT', '/recurring/r3', { body: { ...phone, nextDate: '2026-10-02' } });
  await w.scheduled();
  assert.equal(w.rows('entries').length, 0);
});

test('recurring: the yearly allowance is added as income spread over Oct–Sep', async () => {
  const w = makeWorker();
  await w.call('PUT', '/recurring/r1', {
    body: { kind: 'income', label: 'Allowance', amountMinor: 1200000, currency: 'GBP', frequency: 'yearly', nextDate: '2026-09-28', incomeType: 'allowance', spreadMonths: 12 },
  });
  await w.scheduled();
  const [e] = w.rows('entries');
  assert.deepEqual([e.kind, e.incomeType, e.spreadStart, e.spreadMonths, e.gbpPence], ['income', 'allowance', '2026-10', 12, 1200000]);
});

test('rates: once an entry\'s date has passed, its estimate is replaced by that date\'s rate', async () => {
  const w = makeWorker({ now: NOW - DAY, rates: { latest: { date: '2026-09-29', rates: { SGD: 1.7 } }, '2026-09-30': { rates: { SGD: 1.75 } } } });
  await w.call('PUT', '/entries/e1', { body: manualEntry({ date: '2026-09-30', amountMinor: 1250, currency: 'SGD' }) });
  assert.deepEqual([w.rows('entries')[0].gbpPence, w.rows('entries')[0].gbpStatus], [735, 'estimated']);

  w.now = NOW;
  await w.scheduled();
  const e = w.rows('entries')[0];
  assert.deepEqual([e.gbpPence, e.gbpStatus, e.rate], [714, 'final', 1.75]);
  assert.ok(e.rev > 1);
});

test('rates: statement amounts and final entries are left alone', async () => {
  const w = makeWorker({ now: NOW - DAY, rates: { latest: { date: '2026-09-29', rates: { SGD: 1.7 } }, '2026-09-30': { rates: { SGD: 1.75 } } } });
  await w.call('PUT', '/entries/e1', { body: manualEntry({ date: '2026-09-30', amountMinor: 1250, currency: 'SGD', gbpStatus: 'statement', gbpPence: 740 }) });
  await w.call('PUT', '/entries/e2', { body: manualEntry({ date: '2026-09-30' }) });
  const before = w.rows('entries');
  w.now = NOW;
  await w.scheduled();
  assert.deepEqual(w.rows('entries'), before);
});

test('rates: the job keeps latest rates for recurring foreign items, and survives Frankfurter being down', async () => {
  const w = makeWorker({ rates: { latest: { date: '2026-09-30', rates: { EUR: 1.15 } } } });
  await w.call('PUT', '/recurring/r1', { body: { ...phone, currency: 'EUR', nextDate: '2026-12-01' } });
  await w.scheduled();
  assert.deepEqual(w.rows('rates').map((r) => r.id), ['2026-09-30:EUR']);

  const down = makeWorker({ rates: {} });
  await down.call('PUT', '/recurring/r1', { body: { ...phone, currency: 'EUR' } });
  await down.scheduled();
  const [e] = down.rows('entries');
  assert.deepEqual([e.gbpPence, e.gbpStatus], [null, 'estimated']);
});
