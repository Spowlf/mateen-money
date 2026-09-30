import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, applePay } from './helpers.js';

const rates = { latest: { date: '2026-09-30', rates: { JPY: 200, CNY: 9.5 } } };

async function arrive(w, extra) {
  await w.call('POST', '/applepay', { body: applePay(extra) });
  return w.rows('entries', "source = 'applepay'").at(-1);
}

test('To sort: assigning to an existing vendor saves the merchant as an alias, so the next payment sorts itself', async () => {
  const w = makeWorker();
  await w.call('PUT', '/entries/e0', { body: manualEntry({ merchant: 'Pret', date: '2026-09-20' }) });
  const vendorId = w.rows('vendors')[0].id;
  const e = await arrive(w);
  assert.equal(e.categoryId, null);

  const res = await w.call('POST', `/entries/${e.id}/sort`, { body: { vendorId } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.changes.entries[0].vendorId, res.body.changes.entries[0].categoryId], [vendorId, 'eating-out']);
  assert.deepEqual(res.body.changes.aliases.map((a) => [a.vendorId, a.alias, a.aliasNorm]), [[vendorId, 'PRET A MANGER #1234', 'pret a manger']]);

  const reply = await w.call('POST', '/applepay', { body: applePay({ merchant: 'PRET A MANGER #0042', timestamp: '2026-10-01T17:00:00+01:00' }) });
  assert.equal(reply.body, '£4.20 at Pret, Eating out');
});

test('To sort: picking only a category makes the merchant a new vendor with that category', async () => {
  const w = makeWorker();
  const e = await arrive(w);
  const res = await w.call('POST', `/entries/${e.id}/sort`, { body: { categoryId: 'coffee-snacks', vendorName: 'Pret' } });
  const [v] = res.body.changes.vendors;
  assert.deepEqual([v.name, v.categoryId, v.currency, v.useCount], ['Pret', 'coffee-snacks', 'GBP', 1]);
  assert.equal(res.body.changes.aliases[0].aliasNorm, 'pret a manger');
  assert.equal(res.body.changes.entries[0].categoryId, 'coffee-snacks');

  const reply = await w.call('POST', '/applepay', { body: applePay({ timestamp: '2026-10-01T17:00:00+01:00' }) });
  assert.equal(reply.body, '£4.20 at Pret, Coffee and snacks');
});

test('To sort: with no vendor name, the new vendor is named as the payment arrived and needs no alias', async () => {
  const w = makeWorker();
  const e = await arrive(w, { merchant: 'Sainsburys' });
  const res = await w.call('POST', `/entries/${e.id}/sort`, { body: { categoryId: 'groceries' } });
  assert.equal(res.body.changes.vendors[0].name, 'Sainsburys');
  assert.equal(res.body.changes.aliases, undefined);
});

test('To sort: other waiting payments from the same merchant are sorted at the same time', async () => {
  const w = makeWorker();
  const a = await arrive(w);
  await arrive(w, { merchant: 'PRET A MANGER #1234', timestamp: '2026-10-01T09:00:00+01:00' });
  await arrive(w, { merchant: 'COSTA', timestamp: '2026-10-01T10:00:00+01:00' });
  const res = await w.call('POST', `/entries/${a.id}/sort`, { body: { categoryId: 'coffee-snacks' } });
  assert.equal(res.body.changes.entries.length, 2);
  assert.deepEqual(w.rows('entries', 'categoryId IS NULL').map((e) => e.merchant), ['COSTA']);
});

test('To sort: a vendor with no category takes the one picked', async () => {
  const w = makeWorker();
  await w.call('PUT', '/vendors/v1', { body: { name: 'Pret', categoryId: null } });
  const e = await arrive(w);
  await w.call('POST', `/entries/${e.id}/sort`, { body: { vendorId: 'v1', categoryId: 'eating-out' } });
  assert.equal(w.rows('vendors', "id = 'v1'")[0].categoryId, 'eating-out');
});

test('To sort: answering the currency re-reads the amount in that currency and remembers it for the card', async () => {
  const w = makeWorker({ rates });
  const e = await arrive(w, { amount: '¥500' });
  assert.deepEqual([e.currency, e.amountMinor, e.needsCurrency], ['JPY', 500, 1]);
  const res = await w.call('POST', `/entries/${e.id}/sort`, { body: { currency: 'CNY' } });
  const fixed = res.body.changes.entries[0];
  assert.deepEqual([fixed.currency, fixed.amountMinor, fixed.needsCurrency, fixed.gbpPence], ['CNY', 50000, 0, 5263]);
  assert.deepEqual(res.body.changes.methods[0].symbolMemory, { '¥': 'CNY' });
});

test('To sort: sorting a missing or deleted entry changes nothing', async () => {
  const w = makeWorker();
  assert.equal((await w.call('POST', '/entries/nope/sort', { body: { categoryId: 'groceries' } })).status, 404);
  const e = await arrive(w);
  const bad = await w.call('POST', `/entries/${e.id}/sort`, { body: { vendorId: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Nothing changed: that vendor no longer exists.');
  const empty = await w.call('POST', `/entries/${e.id}/sort`, { body: {} });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'Nothing changed: pick a vendor or a category.');
});
