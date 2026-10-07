// Split payments on the Worker: saving splits with a payment, the rules around them, settling up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, applePay, NOW } from './helpers.js';

const RATES = { latest: { date: '2026-09-30', rates: { SGD: 1.725 } } };
const bill = (extra = {}) => manualEntry({ amountMinor: 4000, merchant: 'Dishoom', ...extra });

async function setup() {
  const w = makeWorker({ rates: RATES });
  await w.call('PUT', '/people/alex', { body: { name: 'Alex' } });
  await w.call('PUT', '/people/sam', { body: { name: 'Sam' } });
  await w.call('POST', '/batch', { body: { accounts: [{ id: 'hsbc', name: 'HSBC', kind: 'current', currency: 'GBP' }] } });
  return w;
}
const liveSplits = (w, entryId = 'e1') => w.rows('splits', 'entryId = ? AND deletedAt IS NULL', entryId)
  .map((s) => [s.personId, s.amountMinor, s.direction, s.currency]).sort();

test('splits: saved with the payment in one write, in its currency', async () => {
  const w = await setup();
  const res = await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }, { personId: 'sam', amountMinor: 1500 }] }) });
  assert.equal(res.status, 200);
  assert.deepEqual(liveSplits(w), [['alex', 1500, 'owedToMe', 'GBP'], ['sam', 1500, 'owedToMe', 'GBP']]);
  assert.ok(res.body.changes.splits.every((s) => s.rev === res.body.rev));
  // The payment keeps the full amount charged.
  assert.equal(w.rows('entries')[0].amountMinor, 4000);
});

test('splits: an edit replaces them; the same person keeps their row', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }, { personId: 'sam', amountMinor: 1500 }] }) });
  const alexId = w.rows('splits', "personId = 'alex'")[0].id;
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 2000 }] }) });
  assert.deepEqual(liveSplits(w), [['alex', 2000, 'owedToMe', 'GBP']]);
  assert.equal(w.rows('splits', "personId = 'alex' AND deletedAt IS NULL")[0].id, alexId);
  assert.ok(w.rows('splits', "personId = 'sam'")[0].deletedAt);
  // [] unsplits it.
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [] }) });
  assert.deepEqual(liveSplits(w), []);
});

test('splits: an edit that doesn’t send them keeps them', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  assert.equal((await w.call('PUT', '/entries/e1', { body: bill({ note: 'birthday' }) })).status, 200);
  assert.deepEqual(liveSplits(w), [['alex', 1500, 'owedToMe', 'GBP']]);
});

test('splits: a new amount or currency needs the split sent again', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  const amount = await w.call('PUT', '/entries/e1', { body: bill({ amountMinor: 5000 }) });
  assert.equal(amount.body.error, 'Nothing changed: split it again for the new amount.');
  const currency = await w.call('PUT', '/entries/e1', { body: bill({ currency: 'SGD' }) });
  assert.equal(currency.body.error, 'Nothing changed: split it again in the new currency.');
  const ok = await w.call('PUT', '/entries/e1', { body: bill({ currency: 'SGD', splits: [{ personId: 'alex', amountMinor: 2000 }] }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(liveSplits(w), [['alex', 2000, 'owedToMe', 'SGD']]);
});

test('splits: what’s refused', async () => {
  const w = await setup();
  const refused = async (body) => (await w.call('PUT', '/entries/e1', { body })).body.error;
  assert.equal(await refused(bill({ splits: [{ personId: 'alex', amountMinor: 2500 }, { personId: 'sam', amountMinor: 2000 }] })), 'Nothing changed: shares add up to more than £40.00.');
  assert.equal(await refused(bill({ splits: [{ personId: 'alex', amountMinor: 0 }] })), 'Nothing changed: enter an amount for each person.');
  assert.equal(await refused(bill({ splits: [{ personId: 'nobody', amountMinor: 100 }] })), 'Nothing changed: pick people who are still in your list.');
  assert.equal(await refused(bill({ kind: 'income', incomeType: 'other', categoryId: null, splits: [{ personId: 'alex', amountMinor: 100 }] })), 'Nothing changed: income can’t be split.');
  assert.equal(await refused(bill({ needsCurrency: 1, splits: [{ personId: 'alex', amountMinor: 100 }] })), 'Nothing changed: pick the currency first.');
  assert.equal(w.rows('entries').length, 0);
  assert.equal(w.rows('splits').length, 0);
});

test('splits: a friend paid; no card, one split to them, your share', async () => {
  const w = await setup();
  const res = await w.call('PUT', '/entries/e1', { body: bill({ paidBy: 'alex', methodId: 'card', splits: [{ personId: 'alex', amountMinor: 1000 }] }) });
  assert.equal(res.status, 200);
  const [e] = w.rows('entries');
  assert.deepEqual([e.paidBy, e.methodId, e.amountMinor], ['alex', null, 4000]);
  assert.deepEqual(liveSplits(w), [['alex', 1000, 'iOwe', 'GBP']]);
  const refused = async (body) => (await w.call('PUT', '/entries/e2', { body })).body.error;
  assert.equal(await refused(bill({ paidBy: 'alex' })), 'Nothing changed: enter your share of what they paid.');
  assert.equal(await refused(bill({ paidBy: 'alex', splits: [{ personId: 'sam', amountMinor: 1000 }] })), 'Nothing changed: enter your share.');
  assert.equal(await refused(bill({ paidBy: 'nobody', splits: [{ personId: 'nobody', amountMinor: 1000 }] })), 'Nothing changed: pick who paid from your list.');
});

test('splits: a bill a friend paid never swallows your own Apple Pay payment', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ amountMinor: 420, merchant: 'Pret', paidBy: 'alex', splits: [{ personId: 'alex', amountMinor: 210 }] }) });
  await w.call('POST', '/applepay', { body: applePay() });
  assert.equal(w.rows('entries', 'deletedAt IS NULL').length, 2);
});

test('splits: deleted with their payment and back with Undo', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  await w.call('PUT', '/entries/e2', { body: bill({ splits: [{ personId: 'sam', amountMinor: 1000 }] }) });
  const del = await w.call('DELETE', '/entries/e1');
  assert.equal(del.status, 200);
  assert.ok(del.body.changes.splits[0].deletedAt);
  assert.deepEqual(liveSplits(w), []);
  const entry = w.rows('entries', "id = 'e1'")[0];
  await w.call('PUT', '/entries/e1', { body: { ...entry, deletedAt: null } });
  assert.deepEqual(liveSplits(w), [['alex', 1500, 'owedToMe', 'GBP']]);
  // A friend-paid bill comes back too, without asking for the share again.
  await w.call('PUT', '/entries/e3', { body: bill({ paidBy: 'alex', splits: [{ personId: 'alex', amountMinor: 1000 }] }) });
  await w.call('DELETE', '/entries/e3');
  const e3 = w.rows('entries', "id = 'e3'")[0];
  assert.equal((await w.call('PUT', '/entries/e3', { body: { ...e3, deletedAt: null } })).status, 200);
  assert.equal(liveSplits(w, 'e3').length, 1);
});

test('settle: nets one person in one currency, stamps their splits, one write', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  await w.call('PUT', '/entries/e2', { body: bill({ paidBy: 'alex', splits: [{ personId: 'alex', amountMinor: 250 }] }) });
  await w.call('PUT', '/entries/e3', { body: bill({ currency: 'SGD', splits: [{ personId: 'alex', amountMinor: 2000 }] }) });
  await w.call('PUT', '/entries/e4', { body: bill({ splits: [{ personId: 'sam', amountMinor: 900 }] }) });
  const res = await w.call('POST', '/settle', { body: { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  assert.equal(res.status, 200);
  const [t] = w.rows('settlements');
  assert.deepEqual([t.amountMinor, t.direction, t.currency, t.accountId], [1250, 'in', 'GBP', 'hsbc']);
  const stamped = w.rows('splits', "settlementId = 't1'");
  assert.equal(stamped.length, 2);
  assert.ok(stamped.every((s) => s.rev === t.rev));
  // Alex's S$ bill and Sam's bill stay open.
  assert.equal(w.rows('splits', 'settlementId IS NULL').length, 2);
});

test('settle: you owe them, money out', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ paidBy: 'sam', splits: [{ personId: 'sam', amountMinor: 800 }] }) });
  await w.call('POST', '/settle', { body: { id: 't1', personId: 'sam', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  const [t] = w.rows('settlements');
  assert.deepEqual([t.amountMinor, t.direction], [800, 'out']);
});

test('settle: bills that cancel out close at 0, with no account', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 500 }] }) });
  await w.call('PUT', '/entries/e2', { body: bill({ paidBy: 'alex', splits: [{ personId: 'alex', amountMinor: 500 }] }) });
  const res = await w.call('POST', '/settle', { body: { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  assert.equal(res.status, 200);
  const [t] = w.rows('settlements');
  assert.deepEqual([t.amountMinor, t.accountId], [0, null]);
  assert.equal(w.rows('splits', 'settlementId IS NULL').length, 0);
});

test('settle: what’s refused', async () => {
  const w = await setup();
  const refused = async (body) => (await w.call('POST', '/settle', { body })).body.error;
  const base = { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' };
  assert.equal(await refused(base), 'Nothing changed: nothing is owed in GBP.');
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  assert.equal(await refused({ ...base, accountId: null }), 'Nothing changed: pick the account it went into.');
  assert.equal(await refused({ ...base, accountId: 'nowhere' }), 'Nothing changed: pick the account it went into.');
  assert.equal(await refused({ ...base, date: '2026-10-02' }), 'Nothing changed: pick today or an earlier day.');
  assert.equal(await refused({ ...base, personId: 'nobody' }), 'Nothing changed: pick someone in your list.');
  assert.equal(await refused({ ...base, currency: 'pounds' }), 'Nothing changed: pick a currency.');
  assert.equal(await refused({ ...base, id: '' }), 'Nothing changed: send the settle-up with its id.');
  assert.equal(w.rows('settlements').length, 0);
});

test('settled bills are locked until the settle-up is undone', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  await w.call('POST', '/settle', { body: { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  const locked = 'Nothing changed: Alex already settled this bill. Undo that settle-up first.';
  assert.equal((await w.call('PUT', '/entries/e1', { body: bill({ amountMinor: 5000 }) })).body.error, locked);
  assert.equal((await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1000 }] }) })).body.error, locked);
  assert.equal((await w.call('DELETE', '/entries/e1')).body.error, locked);
  // Other fields still save, and sending the same split again is fine.
  assert.equal((await w.call('PUT', '/entries/e1', { body: bill({ note: 'birthday', splits: [{ personId: 'alex', amountMinor: 1500 }] }) })).status, 200);
  // Undo: the bill opens again, and can change.
  const undo = await w.call('DELETE', '/settlements/t1');
  assert.equal(undo.status, 200);
  assert.equal(w.rows('splits', 'settlementId IS NULL AND deletedAt IS NULL').length, 1);
  assert.ok(w.rows('settlements')[0].deletedAt);
  assert.equal((await w.call('PUT', '/entries/e1', { body: bill({ amountMinor: 5000, splits: [{ personId: 'alex', amountMinor: 2500 }] }) })).status, 200);
});

test('people: removing someone with bills open is refused; once settled it’s fine', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  const busy = 'Nothing changed: Alex still has bills to settle. Settle up first.';
  assert.equal((await w.call('PUT', '/people/alex', { body: { archived: 1 } })).body.error, busy);
  assert.equal((await w.call('DELETE', '/people/alex')).body.error, busy);
  await w.call('POST', '/settle', { body: { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  assert.equal((await w.call('PUT', '/people/alex', { body: { archived: 1 } })).status, 200);
  // Archived, they stay on their old bill, which still saves.
  assert.equal((await w.call('PUT', '/entries/e1', { body: bill({ note: 'x', splits: [{ personId: 'alex', amountMinor: 1500 }] }) })).status, 200);
  // But can't join a new one.
  assert.equal((await w.call('PUT', '/entries/e2', { body: bill({ splits: [{ personId: 'alex', amountMinor: 100 }] }) })).body.error, 'Nothing changed: pick people who are still in your list.');
});

test('people, splits and settle-ups sync, and splits and settle-ups can’t be written directly', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  await w.call('POST', '/settle', { body: { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  const { body } = await w.call('GET', '/sync?since=0');
  assert.equal(body.changes.people.length, 2);
  assert.equal(body.changes.splits.length, 1);
  assert.equal(body.changes.settlements.length, 1);
  assert.equal((await w.call('PUT', '/splits/x', { body: { amountMinor: 1 } })).status, 404);
  assert.equal((await w.call('PUT', '/settlements/x', { body: { amountMinor: 1 } })).status, 404);
});

test('restore brings back people, splits and settle-ups', async () => {
  const w = await setup();
  await w.call('PUT', '/entries/e1', { body: bill({ splits: [{ personId: 'alex', amountMinor: 1500 }] }) });
  await w.call('POST', '/settle', { body: { id: 't1', personId: 'alex', currency: 'GBP', accountId: 'hsbc', date: '2026-10-01' } });
  const tables = (await w.call('GET', '/sync?since=0')).body.changes;
  const restoreBody = { app: 'mateen-money', version: 1, exportedAt: NOW, tables };
  const fresh = makeWorker({ rates: RATES });
  assert.equal((await fresh.call('POST', '/restore', { body: restoreBody })).status, 200);
  assert.equal(fresh.rows('people', 'deletedAt IS NULL').length, 2);
  assert.equal(fresh.rows('splits', "settlementId = 't1'").length, 1);
  assert.equal(fresh.rows('settlements', 'deletedAt IS NULL').length, 1);
});
