// Trips: payments on a trip's days are filed under it, whenever the trip or the payment changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, applePay } from './helpers.js';

const singapore = { name: 'Singapore', start: '2026-10-10', end: '2026-10-20' };
const on = (w, id) => w.rows('entries', 'id = ?', id)[0].tripId;

async function withPayments(w) {
  await w.call('PUT', '/entries/before', { body: manualEntry({ date: '2026-10-09' }) });
  await w.call('PUT', '/entries/during', { body: manualEntry({ date: '2026-10-12' }) });
  await w.call('PUT', '/entries/by-hand', { body: manualEntry({ date: '2026-10-13', tripManual: 1 }) });
  await w.call('PUT', '/entries/allowance', { body: manualEntry({ kind: 'income', incomeType: 'allowance', categoryId: null, date: '2026-10-14' }) });
}

test('trips: adding a trip files the payments already on its days, in the same write', async () => {
  const w = makeWorker();
  await withPayments(w);
  const res = await w.call('PUT', '/trips/t1', { body: singapore });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changes.entries.map((e) => [e.id, e.tripId]), [['during', 't1']]);
  assert.equal(res.body.changes.entries[0].rev, res.body.rev);
  assert.deepEqual(['before', 'during', 'by-hand', 'allowance'].map((id) => on(w, id)), [null, 't1', null, null]);
});

test('trips: new dates move payments in and out; ones set by hand stay put', async () => {
  const w = makeWorker();
  await withPayments(w);
  await w.call('PUT', '/trips/t1', { body: singapore });
  await w.call('PUT', '/entries/by-hand', { body: manualEntry({ date: '2026-10-13', tripId: 't1', tripManual: 1 }) });
  const res = await w.call('PUT', '/trips/t1', { body: { start: '2026-10-05', end: '2026-10-11' } });
  assert.deepEqual(res.body.changes.entries.map((e) => [e.id, e.tripId]).sort(), [['before', 't1'], ['during', null]]);
  assert.equal(on(w, 'by-hand'), 't1');
});

test('trips: deleting one lets go of its payments, and undo files them again', async () => {
  const w = makeWorker();
  await withPayments(w);
  await w.call('PUT', '/trips/t1', { body: singapore });
  const del = await w.call('DELETE', '/trips/t1');
  assert.deepEqual(del.body.changes.entries.map((e) => [e.id, e.tripId]), [['during', null]]);
  const undo = await w.call('PUT', '/trips/t1', { body: { deletedAt: null } });
  assert.deepEqual(undo.body.changes.entries.map((e) => [e.id, e.tripId]), [['during', 't1']]);
});

test('trips: renaming a trip moves nothing', async () => {
  const w = makeWorker();
  await withPayments(w);
  await w.call('PUT', '/trips/t1', { body: singapore });
  const res = await w.call('PUT', '/trips/t1', { body: { name: 'Singapore and KL' } });
  assert.equal(res.body.changes.entries, undefined);
});

test('trips: an Apple Pay payment during a trip is filed under it; a refund is not', async () => {
  const w = makeWorker();
  await w.call('PUT', '/trips/t1', { body: { name: 'Autumn', start: '2026-09-28', end: '2026-10-03' } });
  const pay = await w.call('POST', '/applepay', { body: applePay() });
  assert.equal(pay.status, 200);
  assert.equal(w.rows('entries', "kind = 'spend'")[0].tripId, 't1');
  await w.call('POST', '/applepay', { body: applePay({ amount: '-£4.20', merchant: 'Boots' }) });
  assert.equal(w.rows('entries', "kind = 'income'")[0].tripId, null);
});
