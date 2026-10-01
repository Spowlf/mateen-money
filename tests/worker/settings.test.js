// Settings, Plan and History writes: what the Worker accepts, and backup restore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, applePay, NOW } from './helpers.js';

const TERMS = [
  { id: 'michaelmas-2025', name: 'Michaelmas', year: 2025, start: '2025-10-07', end: '2025-12-05' },
  { id: 'michaelmas-2026', name: 'Michaelmas', year: 2026, start: '2026-10-06', end: '2026-12-04' },
];

const phone = { kind: 'spend', label: 'Phone', amountMinor: 1000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-10-15', categoryId: 'phone-utilities' };

test('methods: a fee from 0 to 100% and a known kind are kept; anything else changes nothing', async () => {
  const w = makeWorker();
  assert.equal((await w.call('PUT', '/methods/m1', { body: { name: ' Monzo ', kind: 'card', feeBps: 0 } })).body.changes.methods[0].name, 'Monzo');
  const bad = [
    [{ feeBps: 10001 }, 'Nothing changed: enter a fee from 0 to 100%.'],
    [{ feeBps: 2.5 }, 'Nothing changed: enter a fee from 0 to 100%.'],
    [{ kind: 'crypto' }, 'Nothing changed: pick Card, Cash or Bank Transfer.'],
    [{ name: '  ' }, 'Nothing changed: fill in every field.'],
  ];
  for (const [body, message] of bad) {
    const res = await w.call('PUT', '/methods/m1', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, message);
  }
  assert.equal(w.rows('methods', "id = 'm1'")[0].feeBps, 0);
});

test('settings: term dates are checked before they are kept', async () => {
  const w = makeWorker();
  assert.equal((await w.call('PUT', '/settings/terms', { body: { value: TERMS } })).status, 200);
  const overlap = [...TERMS, { id: 'lent-2026', name: 'Lent', year: 2026, start: '2026-12-01', end: '2027-03-01' }];
  const res = await w.call('PUT', '/settings/terms', { body: { value: overlap } });
  assert.equal(res.body.error, 'Nothing changed: start Lent term after Michaelmas term ends on 4 Dec 2026.');
  const twice = [...TERMS, { ...TERMS[1], id: 'michaelmas-2026b', start: '2027-10-05', end: '2027-12-03' }];
  assert.equal((await w.call('PUT', '/settings/terms', { body: { value: twice } })).body.error, 'Nothing changed: enter Michaelmas term 2026 once.');
  assert.equal((await w.call('PUT', '/settings/yearMode', { body: { value: 'fiscal' } })).status, 400);
  assert.deepEqual(JSON.parse(w.rows('settings', "id = 'terms'")[0].value), TERMS);
});

test('recurring: a cost or income with a known frequency; income needs its type', async () => {
  const w = makeWorker();
  const ok = await w.call('PUT', '/recurring/r1', { body: phone });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.changes.recurring[0].anchorDay, 15);
  const cases = [
    [{ ...phone, frequency: 'daily' }, 'Nothing changed: pick how often.'],
    [{ ...phone, kind: 'income', incomeType: null }, 'Nothing changed: pick a type of income.'],
    [{ ...phone, label: '' }, 'Nothing changed: fill in every field.'],
  ];
  for (const [body, message] of cases) assert.equal((await w.call('PUT', '/recurring/r2', { body })).body.error, message);
  const allowance = await w.call('PUT', '/recurring/r3', { body: { ...phone, kind: 'income', incomeType: 'allowance', spreadMonths: 12, categoryId: 'other' } });
  assert.deepEqual([allowance.body.changes.recurring[0].categoryId, allowance.body.changes.recurring[0].spreadMonths], [null, 12]);
});

test('vendors: renaming keeps the old name as an alias, so payments under it are still filed', async () => {
  const w = makeWorker();
  const v = (await w.call('PUT', '/entries/e1', { body: manualEntry({ merchant: 'Pret A Manger' }) })).body.changes.vendors[0];
  const res = await w.call('PUT', `/vendors/${v.id}`, { body: { name: 'Pret' } });
  assert.deepEqual(res.body.changes.aliases.map((a) => [a.vendorId, a.aliasNorm]), [[v.id, 'pret a manger']]);
  const note = await w.call('POST', '/applepay', { body: applePay({ merchant: 'PRET A MANGER', timestamp: '2026-10-01T16:00:00+01:00' }) });
  assert.equal(note.body, '£4.20 at Pret, Food');
  // A change that doesn't change the name adds nothing.
  assert.equal((await w.call('PUT', `/vendors/${v.id}`, { body: { categoryId: 'snacks' } })).body.changes.aliases, undefined);
});

test('vendors: renaming to one of its own aliases drops that alias, so renaming back leaves the names as they were', async () => {
  const w = makeWorker();
  const v = (await w.call('PUT', '/entries/e1', { body: manualEntry({ merchant: 'Pret A Manger' }) })).body.changes.vendors[0];
  await w.call('PUT', '/aliases/a1', { body: { vendorId: v.id, alias: 'PRET' } });
  await w.call('PUT', `/vendors/${v.id}`, { body: { name: 'Pret' } });
  const live = () => w.rows('aliases', 'deletedAt IS NULL').map((a) => a.aliasNorm).sort();
  assert.deepEqual(live(), ['pret a manger']);
  await w.call('PUT', `/vendors/${v.id}`, { body: { name: 'Pret A Manger' } });
  assert.deepEqual(live(), ['pret']);
});

test('vendors: deleting one lets go of its aliases, and undo brings them back', async () => {
  const w = makeWorker();
  const v = (await w.call('PUT', '/entries/e1', { body: manualEntry() })).body.changes.vendors[0];
  await w.call('PUT', '/aliases/a1', { body: { vendorId: v.id, alias: 'PRET A MANGER' } });
  const del = await w.call('DELETE', `/vendors/${v.id}`);
  assert.equal(del.body.changes.vendors[0].deletedAt, NOW);
  assert.equal(del.body.changes.aliases[0].deletedAt, NOW);
  const undo = await w.call('PUT', `/vendors/${v.id}`, { body: { deletedAt: null } });
  assert.equal(undo.body.changes.aliases[0].deletedAt, null);
  assert.equal((await w.call('DELETE', '/vendors/nope')).status, 404);
});

test('entries: editing an old payment teaches its vendor only what was changed', async () => {
  const w = makeWorker();
  await w.call('PUT', '/entries/old', { body: manualEntry({ categoryId: 'food' }) });
  await w.call('PUT', '/entries/new', { body: manualEntry({ categoryId: 'snacks', methodId: 'cash' }) });
  // Fixing the note on the old one keeps the vendor's newer choices.
  await w.call('PUT', '/entries/old', { body: manualEntry({ categoryId: 'food', note: 'With Sam' }) });
  assert.deepEqual(['categoryId', 'methodId'].map((f) => w.rows('vendors')[0][f]), ['snacks', 'cash']);
  // Changing its category is a choice worth remembering.
  await w.call('PUT', '/entries/old', { body: manualEntry({ categoryId: 'groceries', note: 'With Sam' }) });
  assert.deepEqual(['categoryId', 'methodId'].map((f) => w.rows('vendors')[0][f]), ['groceries', 'cash']);
});

async function backupOf(w) {
  const { body } = await w.call('GET', '/sync?since=0');
  const tables = Object.fromEntries(Object.entries(body.changes).map(([n, rows]) => [n, rows.filter((r) => !r.deletedAt)]));
  return { app: 'mateen-money', version: 1, exportedAt: NOW, tables };
}

test('restore: replaces everything with the backup, and a sync pulls the change', async () => {
  const w = makeWorker();
  await w.call('PUT', '/entries/keep', { body: manualEntry() });
  await w.call('PUT', '/categories/groceries', { body: { name: 'Food shop' } });
  const backup = await backupOf(w);
  const { rev } = (await w.call('GET', '/sync?since=0')).body;

  await w.call('PUT', '/entries/later', { body: manualEntry({ amountMinor: 999 }) });
  await w.call('DELETE', '/entries/keep');
  await w.call('PUT', '/categories/groceries', { body: { name: 'Groceries' } });

  const res = await w.call('POST', '/restore', { body: backup });
  assert.equal(res.status, 200);
  const live = w.rows('entries', 'deletedAt IS NULL').map((e) => e.id);
  assert.deepEqual(live, ['keep']);
  assert.equal(w.rows('categories', "id = 'groceries'")[0].name, 'Food shop');
  const pulled = (await w.call('GET', `/sync?since=${rev}`)).body.changes.entries;
  assert.deepEqual(pulled.map((e) => [e.id, e.deletedAt === null]).sort(), [['keep', true], ['later', false]]);
});

test('restore: a recurring occurrence already stored under another id doesn\'t block it', async () => {
  const w = makeWorker({ now: Date.UTC(2026, 9, 15, 12) });
  await w.call('PUT', '/recurring/r1', { body: phone });
  await w.scheduled();
  const backup = await backupOf(w);
  const occurrence = backup.tables.entries[0];
  backup.tables.entries = [{ ...occurrence, id: 'copy' }];
  assert.equal((await w.call('POST', '/restore', { body: backup })).status, 200);
  assert.deepEqual(w.rows('entries', 'deletedAt IS NULL').map((e) => [e.id, e.recurringId]), [['copy', 'r1']]);
});

test('restore: a damaged backup changes nothing at all', async () => {
  const w = makeWorker();
  await w.call('PUT', '/entries/keep', { body: manualEntry() });
  const backup = await backupOf(w);
  backup.tables.entries = [{ ...backup.tables.entries[0], id: 'bad', kind: 'gift' }];
  const res = await w.call('POST', '/restore', { body: backup });
  assert.equal(res.status, 400);
  assert.deepEqual(w.rows('entries', 'deletedAt IS NULL').map((e) => e.id), ['keep']);
  assert.equal((await w.call('POST', '/restore', { body: { app: 'other' } })).body.error, 'Nothing changed: this isn’t a Mateen Money backup.');
});

test('settings: the time zone starts as London and takes only a real time zone', async () => {
  const w = makeWorker();
  const sync = (await w.call('GET', '/sync?since=0')).body;
  assert.equal(sync.changes.settings.find((s) => s.id === 'timeZone').value, 'Europe/London');
  assert.equal((await w.call('PUT', '/settings/timeZone', { body: { value: 'Mars/Olympus' } })).status, 400);
  assert.equal((await w.call('PUT', '/settings/timeZone', { body: { value: 'Asia/Singapore' } })).status, 200);
  assert.equal((await w.call('GET', '/sync?since=0')).body.today, '2026-10-01');
});
