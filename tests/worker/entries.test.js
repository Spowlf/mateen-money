import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, NOW } from './helpers.js';

const rates = {
  latest: { date: '2026-09-30', rates: { SGD: 1.7, EUR: 1.15, JPY: 200 } },
  '2026-09-29': { rates: { SGD: 1.75 } },
};

test('entries: a GBP entry is saved at its own value and comes back with its rev', async () => {
  const w = makeWorker();
  const { status, body } = await w.call('PUT', '/entries/e1', { body: manualEntry() });
  assert.equal(status, 200);
  const e = body.changes.entries[0];
  assert.equal(e.id, 'e1');
  assert.equal(e.gbpPence, 420);
  assert.equal(e.feePence, 0);
  assert.equal(e.gbpStatus, 'final');
  assert.equal(e.updatedAt, NOW);
  assert.equal(e.rev, body.rev);
  assert.equal(w.rows('entries').length, 1);
});

test('entries: saving the same id again updates it instead of adding a copy', async () => {
  const w = makeWorker();
  await w.call('PUT', '/entries/e1', { body: manualEntry() });
  await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 500 }) });
  const rows = w.rows('entries');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gbpPence, 500);
});

test('entries: vendor memory remembers category, currency and payment method', async () => {
  const w = makeWorker();
  const first = (await w.call('PUT', '/entries/e1', { body: manualEntry() })).body;
  const vendor = first.changes.vendors[0];
  assert.equal(first.changes.entries[0].vendorId, vendor.id);
  assert.deepEqual([vendor.name, vendor.categoryId, vendor.currency, vendor.methodId, vendor.useCount], ['Pret', 'food', 'GBP', 'card', 1]);

  // Same vendor typed again, a different category this time: memory follows, use count grows.
  await w.call('PUT', '/entries/e2', { body: manualEntry({ merchant: 'pret', categoryId: 'snacks', methodId: 'cash' }) });
  let v = w.rows('vendors');
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].categoryId, v[0].methodId, v[0].useCount], ['snacks', 'cash', 2]);

  // Editing an existing entry isn't a new use.
  await w.call('PUT', '/entries/e2', { body: manualEntry({ merchant: 'pret', categoryId: 'snacks', methodId: 'cash', note: 'Flat white' }) });
  v = w.rows('vendors');
  assert.equal(v[0].useCount, 2);
});

test('entries: income needs no vendor and keeps its spread', async () => {
  const w = makeWorker();
  const body = manualEntry({ kind: 'income', merchant: null, categoryId: null, incomeType: 'allowance', amountMinor: 1200000, spreadMonths: 12, date: '2026-09-28' });
  const res = await w.call('PUT', '/entries/i1', { body });
  assert.equal(res.status, 200);
  const e = res.body.changes.entries[0];
  assert.equal(e.spreadStart, '2026-10');
  assert.equal(e.spreadMonths, 12);
  assert.equal(res.body.changes.vendors, undefined);
});

test('currency: a foreign entry today uses the latest rate, is estimated, and pays the method fee', async () => {
  const w = makeWorker({ rates });
  await w.call('PUT', '/methods/card', { body: { feeBps: 299 } });
  const res = await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 1250, currency: 'SGD' }) });
  const e = res.body.changes.entries[0];
  // 12.50 / 1.7 = £7.35, fee 2.99% = 22p.
  assert.deepEqual([e.gbpPence, e.feePence, e.feeBps, e.rate, e.gbpStatus], [757, 22, 299, 1.7, 'estimated']);
  assert.deepEqual(w.rows('rates').map((r) => [r.id, r.perGbp]), [['2026-09-30:SGD', 1.7]]);
});

test('currency: a foreign entry dated in the past gets that date\'s rate and is final', async () => {
  const w = makeWorker({ rates });
  const res = await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 1250, currency: 'SGD', date: '2026-09-29' }) });
  const e = res.body.changes.entries[0];
  assert.deepEqual([e.gbpPence, e.gbpStatus, e.rate], [714, 'final', 1.75]);
  assert.ok(w.frankfurter.calls.some((u) => u.includes('/2026-09-29?')));
});

test('currency: with no rate reachable the entry still saves, estimated and without a GBP value', async () => {
  const w = makeWorker({ rates: {} });
  const res = await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 1250, currency: 'SGD' }) });
  assert.equal(res.status, 200);
  const e = res.body.changes.entries[0];
  assert.deepEqual([e.gbpPence, e.gbpStatus], [null, 'estimated']);
});

test('currency: a statement override is kept through later edits', async () => {
  const w = makeWorker({ rates });
  await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 1250, currency: 'SGD', gbpStatus: 'statement', gbpPence: 760 }) });
  const res = await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 1250, currency: 'SGD', note: 'Dinner' }) });
  const e = res.body.changes.entries[0];
  assert.deepEqual([e.gbpPence, e.gbpStatus, e.note], [760, 'statement', 'Dinner']);

  // Choosing to recalculate drops the override.
  const back = await w.call('PUT', '/entries/e1', { body: manualEntry({ amountMinor: 1250, currency: 'SGD', gbpStatus: 'estimated' }) });
  assert.equal(back.body.changes.entries[0].gbpPence, 735);
});

test('entries: invalid entries are refused and nothing is written', async () => {
  const w = makeWorker();
  const cases = [
    [{ amountMinor: 0 }, 'Nothing changed: enter an amount above zero.'],
    [{ amountMinor: 4.2 }, 'Nothing changed: enter an amount above zero.'],
    [{ date: '1 Oct' }, 'Nothing changed: pick a date.'],
    [{ date: '2026-02-30' }, 'Nothing changed: pick a date.'],
    [{ currency: 'pounds' }, 'Nothing changed: pick a currency.'],
    [{ kind: 'gift' }, 'Nothing changed: choose spending or income.'],
    [{ kind: 'income', incomeType: null }, 'Nothing changed: pick a type of income.'],
    [{ time: '25:00' }, 'Nothing changed: pick a time.'],
    [{ gbpStatus: 'statement', gbpPence: null }, 'Nothing changed: enter the amount from your statement.'],
  ];
  for (const [change, message] of cases) {
    const res = await w.call('PUT', '/entries/e1', { body: manualEntry(change) });
    assert.equal(res.status, 400, JSON.stringify(change));
    assert.equal(res.body.error, message);
  }
  assert.equal(w.rows('entries').length, 0);
  assert.equal(w.rows('vendors').length, 0);
});

test('entries: delete is a soft delete, and undo brings it back', async () => {
  const w = makeWorker();
  await w.call('PUT', '/entries/e1', { body: manualEntry() });
  const del = await w.call('DELETE', '/entries/e1');
  assert.equal(del.status, 200);
  assert.equal(del.body.changes.entries[0].deletedAt, NOW);
  const undo = await w.call('PUT', '/entries/e1', { body: { ...manualEntry(), deletedAt: null } });
  assert.equal(undo.body.changes.entries[0].deletedAt, null);
});

test('trips: an entry in a trip\'s dates is suggested for it, unless the trip was set by hand', async () => {
  const w = makeWorker();
  await w.call('PUT', '/trips/t1', { body: { name: 'Singapore', start: '2026-09-28', end: '2026-10-05' } });
  const auto = await w.call('PUT', '/entries/e1', { body: manualEntry() });
  assert.equal(auto.body.changes.entries[0].tripId, 't1');
  const byHand = await w.call('PUT', '/entries/e2', { body: manualEntry({ tripManual: 1, tripId: null }) });
  assert.equal(byHand.body.changes.entries[0].tripId, null);
  const outside = await w.call('PUT', '/entries/e3', { body: manualEntry({ date: '2026-10-06' }) });
  assert.equal(outside.body.changes.entries[0].tripId, null);
});

test('entries: cash you already had is income, logged once, never planned as a recurring item', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/entries/c1', { body: manualEntry({ kind: 'income', merchant: null, categoryId: null, incomeType: 'cash', amountMinor: 15000 }) });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.changes.entries[0].incomeType, res.body.changes.entries[0].gbpPence], ['cash', 15000]);
  const plan = await w.call('PUT', '/recurring/r1', {
    body: { kind: 'income', label: 'Cash', amountMinor: 15000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-15', incomeType: 'cash' },
  });
  assert.equal(plan.body.error, 'Nothing changed: log cash you already had once, on the Log screen.');
});
