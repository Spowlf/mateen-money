// Moves between the user's own accounts: the transfers table through the generic routes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, NOW } from './helpers.js';

const hsbc = { id: 'hsbc', name: 'HSBC', kind: 'current', currency: 'GBP' };
const revolut = { id: 'revolut', name: 'Revolut', kind: 'current', currency: 'SGD' };
const move = (extra = {}) => ({
  date: '2026-10-01', fromAccountId: 'hsbc', fromAmountMinor: 50000, fromCurrency: 'GBP',
  toAccountId: 'revolut', toAmountMinor: 86520, toCurrency: 'SGD', ...extra,
});

async function withAccounts() {
  const w = makeWorker();
  await w.call('POST', '/batch', { body: { accounts: [hsbc, revolut] } });
  return w;
}

test('moves: saved and deleted through the generic routes, under one rev each', async () => {
  const w = await withAccounts();
  const saved = await w.call('PUT', '/transfers/m1', { body: move() });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.changes.transfers[0].rev, saved.body.rev);
  assert.equal(w.rows('transfers')[0].toAmountMinor, 86520);
  const gone = await w.call('DELETE', '/transfers/m1');
  assert.equal(gone.status, 200);
  assert.ok(w.rows('transfers')[0].deletedAt);
  // Undo: put it back.
  assert.equal((await w.call('PUT', '/transfers/m1', { body: { deletedAt: null } })).status, 200);
  assert.equal(w.rows('transfers')[0].deletedAt, null);
});

test('moves: what a move must have', async () => {
  const w = await withAccounts();
  const refused = async (body) => (await w.call('PUT', '/transfers/m', { body })).body.error;
  assert.equal(await refused(move({ toAccountId: 'hsbc' })), 'Nothing changed: pick two different accounts.');
  assert.equal(await refused(move({ fromAmountMinor: 0 })), 'Nothing changed: enter an amount above zero.');
  assert.equal(await refused(move({ toAmountMinor: -5 })), 'Nothing changed: enter an amount above zero.');
  assert.equal(await refused(move({ toAmountMinor: 1.5 })), 'Nothing changed: enter an amount above zero.');
  assert.equal(await refused(move({ toCurrency: 'dollars' })), 'Nothing changed: pick a currency.');
  assert.equal(await refused(move({ date: '2026-10-02' })), 'Nothing changed: pick a date up to today.');
  assert.equal(await refused(move({ date: 'soon' })), 'Nothing changed: pick a date up to today.');
  assert.equal(await refused(move({ toAccountId: null })), 'Nothing changed: fill in every field.');
  assert.equal(await refused(move({ toAccountId: 'cimb' })), 'Nothing changed: that account was deleted.');
  assert.equal(w.rows('transfers').length, 0);
});

test('moves: a deleted account takes no new moves, but its old ones can still be deleted', async () => {
  const w = await withAccounts();
  await w.call('PUT', '/transfers/m1', { body: move() });
  await w.call('DELETE', '/accounts/revolut');
  assert.equal((await w.call('PUT', '/transfers/m2', { body: move() })).body.error, 'Nothing changed: that account was deleted.');
  assert.equal((await w.call('DELETE', '/transfers/m1')).status, 200);
});

test('moves: kept by a backup and restore, with their updatedAt', async () => {
  const w = await withAccounts();
  await w.call('PUT', '/transfers/m1', { body: move() });
  const { body } = await w.call('GET', '/sync?since=0');
  const tables = Object.fromEntries(Object.entries(body.changes).map(([n, rows]) => [n, rows.filter((r) => !r.deletedAt)]));
  const updatedAt = tables.transfers[0].updatedAt;
  await w.call('DELETE', '/transfers/m1');
  const res = await w.call('POST', '/restore', { body: { app: 'mateen-money', version: 1, exportedAt: NOW, tables } });
  assert.equal(res.status, 200);
  const [row] = w.rows('transfers');
  assert.equal(row.deletedAt, null);
  assert.equal(row.updatedAt, updatedAt);
});

test('moves: the nightly snapshot counts them', async () => {
  const w = makeWorker();
  const dbs = { id: 'dbs', name: 'DBS', kind: 'current', currency: 'GBP' };
  const bal = (accountId, amountMinor) => ({ id: `${accountId}:2026-09-30`, accountId, date: '2026-09-30', amountMinor, currency: 'GBP', deletedAt: null });
  await w.call('POST', '/batch', { body: { accounts: [hsbc, dbs], balances: [bal('hsbc', 100000), bal('dbs', 0)] } });
  // A move out of one GBP account into another, losing £1.00 on the way.
  await w.call('PUT', '/transfers/m1', { body: move({ toAccountId: 'dbs', toAmountMinor: 49900, toCurrency: 'GBP' }) });
  await w.scheduled();
  assert.equal(w.rows('snapshots')[0].gbpPence, 100000 - 100);
});
