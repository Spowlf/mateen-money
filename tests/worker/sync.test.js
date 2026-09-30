import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry } from './helpers.js';
import { DEFAULT_CATEGORIES, DEFAULT_METHODS } from '../../src/engine/defaults.js';

test('sync: the first sync seeds default categories, payment methods and settings', async () => {
  const w = makeWorker();
  const { status, body } = await w.call('GET', '/sync?since=0');
  assert.equal(status, 200);
  assert.ok(body.rev > 0);
  assert.equal(body.today, '2026-10-01');
  const bySort = [...body.changes.categories].sort((a, b) => a.sort - b.sort);
  assert.deepEqual(bySort.map((c) => c.name), DEFAULT_CATEGORIES.map((c) => c.name));
  assert.deepEqual(body.changes.methods.map((m) => m.id).sort(), DEFAULT_METHODS.map((m) => m.id).sort());
  assert.deepEqual(body.changes.methods[0].symbolMemory, {});
  const settings = Object.fromEntries(body.changes.settings.map((s) => [s.id, s.value]));
  assert.deepEqual(settings.terms, []);   // term dates start blank
  assert.equal(settings.yearMode, 'academic');
  assert.equal(settings.excludeTrips, false);
  assert.deepEqual(body.changes.entries, []);
});

test('sync: since=rev returns only what changed after it, deletes included', async () => {
  const w = makeWorker();
  const first = (await w.call('GET', '/sync?since=0')).body;
  const none = (await w.call('GET', `/sync?since=${first.rev}`)).body;
  assert.equal(none.rev, first.rev);
  for (const rows of Object.values(none.changes)) assert.deepEqual(rows, []);

  await w.call('PUT', '/entries/e1', { body: manualEntry() });
  const after = (await w.call('GET', `/sync?since=${first.rev}`)).body;
  assert.ok(after.rev > first.rev);
  assert.deepEqual(after.changes.entries.map((e) => e.id), ['e1']);
  assert.deepEqual(after.changes.categories, []);

  await w.call('DELETE', '/entries/e1');
  const deleted = (await w.call('GET', `/sync?since=${after.rev}`)).body;
  assert.equal(deleted.changes.entries.length, 1);
  assert.ok(deleted.changes.entries[0].deletedAt > 0);
});

test('sync: seeding runs once, so a renamed default category keeps its new name', async () => {
  const w = makeWorker();
  await w.call('GET', '/sync?since=0');
  await w.call('PUT', '/categories/groceries', { body: { name: 'Food shop' } });
  await w.call('GET', '/sync?since=0');
  await w.scheduled();
  assert.equal(w.rows('categories', 'id = ?', 'groceries')[0].name, 'Food shop');
});

test('rows: a partial PUT keeps the fields it leaves out, and DELETE is a soft delete that PUT can undo', async () => {
  const w = makeWorker();
  await w.call('GET', '/sync?since=0');
  const res = await w.call('PUT', '/methods/card', { body: { feeBps: 299, walletCard: 'Monzo' } });
  assert.equal(res.status, 200);
  const card = res.body.changes.methods[0];
  assert.equal(card.name, 'Card');
  assert.equal(card.feeBps, 299);
  assert.deepEqual(card.symbolMemory, {});

  await w.call('DELETE', '/trips/t1');
  assert.equal((await w.call('DELETE', '/trips/t1')).status, 404);
  await w.call('PUT', '/trips/t1', { body: { name: 'Singapore', start: '2026-12-10', end: '2026-12-20' } });
  await w.call('DELETE', '/trips/t1');
  assert.ok(w.rows('trips')[0].deletedAt > 0);
  await w.call('PUT', '/trips/t1', { body: { deletedAt: null } });
  assert.equal(w.rows('trips')[0].deletedAt, null);
});

test('rows: missing required fields are refused with nothing changed', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/trips/t1', { body: { name: 'Singapore' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /^Nothing changed: /);
  assert.equal(w.rows('trips').length, 0);
});

test('rows: an alias gets its normalised name, and one already in use is refused', async () => {
  const w = makeWorker();
  await w.call('PUT', '/vendors/v1', { body: { name: 'Pret', categoryId: 'eating-out' } });
  await w.call('PUT', '/vendors/v2', { body: { name: 'Costa', categoryId: 'coffee-snacks' } });
  const res = await w.call('PUT', '/aliases/a1', { body: { vendorId: 'v1', alias: 'PRET A MANGER #1234' } });
  assert.equal(res.body.changes.aliases[0].aliasNorm, 'pret a manger');
  const clash = await w.call('PUT', '/aliases/a2', { body: { vendorId: 'v2', alias: 'Pret a Manger' } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'Nothing changed: that name already belongs to another vendor.');
});

test('rows: editing a vendor in the app marks it as edited by you', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/vendors/v1', { body: { name: 'Pret', categoryId: 'eating-out' } });
  assert.equal(res.body.changes.vendors[0].userEdited, 1);
});

test('rows: a monthly recurring item remembers its day of the month', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/recurring/r1', {
    body: { kind: 'spend', label: 'Phone', amountMinor: 1000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-31', categoryId: 'phone-utilities' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.changes.recurring[0].anchorDay, 31);
  assert.equal(res.body.changes.recurring[0].active, 1);
});
