// Net worth: accounts and their balances, saved together, all or nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker } from './helpers.js';

const TODAY = '2026-10-01';
const SGD = { latest: { date: '2026-09-30', rates: { SGD: 1.725, USD: 1.35 } } };
const cimb = { id: 'cimb', name: 'CIMB', kind: 'savings', currency: 'SGD' };
const hsbc = { id: 'hsbc', name: 'HSBC', kind: 'current', currency: 'GBP' };
const bal = (accountId, amountMinor, currency, date = TODAY) => ({ id: `${accountId}:${date}`, accountId, date, amountMinor, currency, deletedAt: null });

test('net worth: a new account and its first balance land in one write', async () => {
  const w = makeWorker({ rates: SGD });
  const res = await w.call('POST', '/batch', { body: { accounts: [cimb], balances: [bal('cimb', 2001676, 'SGD')] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.changes.accounts[0].rev, res.body.rev);
  assert.equal(res.body.changes.balances[0].rev, res.body.rev);
  assert.equal(w.rows('accounts')[0].sort, 0);
  assert.equal(w.rows('balances')[0].amountMinor, 2001676);
});

test('net worth: a balance in a currency with no rate fetches one, in the same write', async () => {
  const w = makeWorker({ rates: SGD });
  const res = await w.call('POST', '/batch', { body: { accounts: [cimb], balances: [bal('cimb', 100, 'SGD')] } });
  assert.deepEqual(res.body.changes.rates.map((r) => [r.id, r.perGbp]), [['2026-09-30:SGD', 1.725]]);
  // GBP needs none.
  const w2 = makeWorker({ rates: SGD });
  await w2.call('POST', '/batch', { body: { accounts: [hsbc], balances: [bal('hsbc', 100, 'GBP')] } });
  assert.equal(w2.frankfurter.calls.length, 0);
});

test('net worth: no rate to be had still saves the balance', async () => {
  const w = makeWorker();
  const res = await w.call('POST', '/batch', { body: { accounts: [cimb], balances: [bal('cimb', 100, 'SGD')] } });
  assert.equal(res.status, 200);
  assert.equal(w.rows('balances').length, 1);
});

test('net worth: one bad row and nothing is saved', async () => {
  const w = makeWorker({ rates: SGD });
  const res = await w.call('POST', '/batch', { body: { accounts: [cimb, hsbc], balances: [bal('cimb', 100, 'SGD'), bal('hsbc', 100, 'SGD')] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Nothing changed: enter the balance in GBP, the account’s currency.');
  assert.equal(w.rows('accounts').length, 0);
  assert.equal(w.rows('balances').length, 0);
});

test('net worth: the same day again replaces that day’s balance', async () => {
  const w = makeWorker({ rates: SGD });
  await w.call('POST', '/batch', { body: { accounts: [hsbc], balances: [bal('hsbc', 100, 'GBP')] } });
  await w.call('POST', '/batch', { body: { balances: [bal('hsbc', 250, 'GBP')] } });
  assert.deepEqual(w.rows('balances').map((b) => [b.id, b.amountMinor]), [['hsbc:2026-10-01', 250]]);
});

test('net worth: what an account and a balance must have', async () => {
  const w = makeWorker({ rates: SGD });
  const refused = async (body) => (await w.call('POST', '/batch', { body })).body.error;
  assert.equal(await refused({ accounts: [{ ...cimb, kind: 'pension' }] }), 'Nothing changed: pick Current Account, Savings or Investments.');
  assert.equal(await refused({ accounts: [{ ...cimb, currency: 'dollars' }] }), 'Nothing changed: pick a currency.');
  assert.equal(await refused({ accounts: [{ ...cimb, name: ' ' }] }), 'Nothing changed: fill in every field.');
  assert.equal(await refused({ balances: [bal('cimb', 100, 'SGD')] }), 'Nothing changed: add the account first.');
  await w.call('PUT', '/accounts/cimb', { body: cimb });
  assert.equal(await refused({ balances: [bal('cimb', 100, 'SGD', '2026-10-02')] }), 'Nothing changed: pick today or an earlier day.');
  assert.equal(await refused({ balances: [{ ...bal('cimb', 100, 'SGD'), id: 'cimb:2026-09-01' }] }), 'Nothing changed: pick the date of the balance.');
  assert.equal(await refused({ balances: [bal('cimb', 1.5, 'SGD')] }), 'Nothing changed: enter the balance.');
  assert.equal(await refused({ balances: 'all of them' }), 'Nothing changed: send a list of rows.');
  assert.equal(await refused({ balances: [{ accountId: 'cimb' }] }), 'Nothing changed: send each row with its id.');
  assert.equal(w.rows('balances').length, 0);
});

test('net worth: an overdraft is a balance', async () => {
  const w = makeWorker();
  const res = await w.call('POST', '/batch', { body: { accounts: [hsbc], balances: [bal('hsbc', -2500, 'GBP')] } });
  assert.equal(res.status, 200);
});

test('net worth: a single PUT is checked the same way', async () => {
  const w = makeWorker({ rates: SGD });
  await w.call('PUT', '/accounts/cimb', { body: cimb });
  const res = await w.call('PUT', '/balances/cimb:2026-10-01', { body: bal('cimb', 100, 'GBP') });
  assert.equal(res.status, 400);
  assert.equal((await w.call('PUT', '/accounts/cimb', { body: { name: 'CIMB FastSaver' } })).status, 200);
  assert.equal(w.rows('accounts')[0].name, 'CIMB FastSaver');
});

test('net worth: deleting an account and Undo', async () => {
  const w = makeWorker({ rates: SGD });
  await w.call('POST', '/batch', { body: { accounts: [hsbc], balances: [bal('hsbc', 100, 'GBP')] } });
  assert.equal((await w.call('DELETE', '/accounts/hsbc')).status, 200);
  assert.ok(w.rows('accounts')[0].deletedAt);
  await w.call('PUT', '/accounts/hsbc', { body: { deletedAt: null } });
  assert.equal(w.rows('accounts')[0].deletedAt, null);
});

test('net worth: accounts and balances sync and back up like everything else', async () => {
  const w = makeWorker({ rates: SGD });
  await w.call('POST', '/batch', { body: { accounts: [cimb], balances: [bal('cimb', 2001676, 'SGD')] } });
  const sync = await w.call('GET', '/sync?since=0');
  assert.equal(sync.body.changes.accounts.length, 1);
  assert.equal(sync.body.changes.balances.length, 1);
});

test('net worth: the scheduled run keeps each account’s currency rate fresh', async () => {
  const w = makeWorker({ rates: { latest: { date: '2026-10-01', rates: { SGD: 1.73, USD: 1.35 } } } });
  await w.call('PUT', '/accounts/cimb', { body: cimb });
  await w.scheduled();
  assert.ok(w.frankfurter.calls.some((u) => u.includes('/latest') && u.includes('SGD')));
  assert.ok(w.rows('rates', "currency = 'SGD'").length);
});

test('net worth: an account and the cards linked to it save together', async () => {
  const w = makeWorker({ rates: SGD });
  const res = await w.call('POST', '/batch', { body: { accounts: [hsbc], methods: [{ id: 'card', accountId: 'hsbc' }] } });
  assert.equal(res.status, 200);
  assert.equal(w.rows('methods', "id = 'card'")[0].accountId, 'hsbc');
  // The rest of the card is kept.
  assert.equal(w.rows('methods', "id = 'card'")[0].name, 'Card');
  const bad = await w.call('POST', '/batch', { body: { methods: [{ id: 'cash', accountId: 'nowhere' }] } });
  assert.equal(bad.body.error, 'Nothing changed: link the card to an account that exists.');
  // Unlinking.
  await w.call('POST', '/batch', { body: { methods: [{ id: 'card', accountId: null }] } });
  assert.equal(w.rows('methods', "id = 'card'")[0].accountId, null);
});
