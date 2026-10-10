// The app's data layer against the real Worker (through fetch) and an in-memory stand-in for IndexedDB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo } from '../src/db/repo.js';
import { createApi } from '../src/db/api.js';
import { OfflineError, ApiError } from '../src/errors.js';
import { emptyForm } from '../src/engine/draft.js';
import { makeWorker, applePay, TOKEN, NOW } from './worker/helpers.js';

const BASE = 'https://api.example.com';

/** IndexedDB stand-in that survives "reloads": new repos over the same maps. */
function memoryDb(stores = new Map(), meta = new Map()) {
  const table = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  return {
    stores,
    meta,
    readAll: async (names, keys) => ({
      tables: Object.fromEntries(names.map((n) => [n, [...table(n).values()].map((r) => structuredClone(r))])),
      meta: Object.fromEntries(keys.map((k) => [k, structuredClone(meta.get(k))])),
    }),
    putMany: async (name, rows) => { for (const r of rows) table(name).set(r.id, structuredClone(r)); },
    clear: async (names) => { for (const n of names) table(n).clear(); },
    getMeta: async (key) => structuredClone(meta.get(key)),
    setMeta: async (key, value) => { meta.set(key, structuredClone(value)); },
    deleteMeta: async (key) => { meta.delete(key); },
  };
}

async function connected(w, db = memoryDb()) {
  const repo = createRepo({ db, fetch: w.fetch, now: () => w.now });
  await repo.load();
  await repo.connect({ apiBase: `${BASE}/`, token: TOKEN });
  return repo;
}

const form = (extra = {}) => ({
  ...emptyForm({ id: 'e1', date: '2026-10-01', time: '12:30', methodId: 'card' }),
  amount: '4.20', vendorName: 'Pret', categoryId: 'eating-out', ...extra,
});

test('api: no connection set up asks you to connect, without calling anything', async () => {
  let called = false;
  const api = createApi({ fetch: async () => { called = true; }, connection: () => ({}) });
  await assert.rejects(api.get('/sync'), (err) => err instanceof ApiError && err.message === 'Connect to your backend in Settings.');
  assert.equal(called, false);
});

test('api: a network failure is "offline"; a refusal carries the server\'s message', async () => {
  const offline = createApi({ fetch: async () => { throw new TypeError('Load failed'); }, connection: () => ({ apiBase: BASE, token: 't' }) });
  await assert.rejects(offline.get('/sync'), OfflineError);
  const w = makeWorker();
  const wrong = createApi({ fetch: w.fetch, connection: () => ({ apiBase: BASE, token: 'wrong' }) });
  await assert.rejects(wrong.get('/sync'), (err) => err instanceof ApiError && err.status === 401 && err.message === 'Check the backend token in Settings.');
});

test('repo: connecting syncs everything, and the copy opens again offline', async () => {
  const w = makeWorker();
  const db = memoryDb();
  const repo = await connected(w, db);
  assert.equal(repo.state.categories.length, 15);
  assert.equal(repo.state.lastSyncedAt, NOW);

  const offline = createRepo({ db, fetch: async () => { throw new TypeError('offline'); } });
  await offline.load();
  assert.equal(offline.state.categories.length, 15);
  assert.equal(offline.state.lastSyncedAt, NOW);
  await assert.rejects(offline.sync(), OfflineError);
  assert.equal(offline.state.categories.length, 15);
});

test('repo: a later sync pulls only what changed, including payments from the Shortcut', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  await w.call('POST', '/applepay', { body: applePay() });
  await repo.sync();
  assert.deepEqual(repo.state.entries.map((e) => e.merchant), ['PRET A MANGER #1234']);
});

test('repo: saving the form stores the entry and its vendor, and clears the draft', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  await repo.draft.save(form());
  const result = await repo.saveForm(form());
  assert.equal(result.status, 'saved');
  assert.equal(result.entry.gbpPence, 420);
  assert.deepEqual(repo.state.entries.map((e) => e.id), ['e1']);
  assert.deepEqual(repo.state.vendors.map((v) => v.name), ['Pret']);
  assert.equal(await repo.draft.load(), null);
});

test('repo: saving offline keeps the draft, and it saves once back online', async () => {
  const w = makeWorker();
  let online = false;
  const db = memoryDb();
  const fetch = async (url, init) => { if (!online) throw new TypeError('offline'); return w.fetch(url, init); };
  const first = createRepo({ db, fetch, now: () => w.now });
  await first.load();
  await db.setMeta('connection', { apiBase: BASE, token: TOKEN });
  await first.load();
  assert.deepEqual(await first.saveForm(form()), { status: 'offline' });

  // The app is closed and opened again, then the signal comes back.
  const second = createRepo({ db, fetch, now: () => w.now });
  await second.load();
  const draft = await second.draft.load();
  assert.equal(draft.amount, '4.20');
  online = true;
  assert.equal((await second.saveForm(draft)).status, 'saved');
  assert.equal(w.rows('entries').length, 1);
});

test('repo: undo after saving deletes the entry, and undo after deleting brings it back', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  const { entry } = await repo.saveForm(form());
  await repo.deleteEntry(entry.id);
  assert.ok(repo.state.entries[0].deletedAt);
  await repo.restoreEntry(entry.id);
  assert.equal(repo.state.entries[0].deletedAt, null);
  assert.equal(w.rows('entries')[0].deletedAt, null);
});

test('repo: sorting a To sort payment updates the entry, vendor and alias in the local copy', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  await w.call('POST', '/applepay', { body: applePay() });
  await repo.sync();
  const id = repo.state.entries[0].id;
  await repo.sortEntry(id, { categoryId: 'coffee-snacks', vendorName: 'Pret' });
  assert.equal(repo.state.entries[0].categoryId, 'coffee-snacks');
  assert.deepEqual(repo.state.vendors.map((v) => v.name), ['Pret']);
  assert.deepEqual(repo.state.aliases.map((a) => a.aliasNorm), ['pret a manger']);
});

test('repo: connecting to a different backend replaces the local copy', async () => {
  const a = makeWorker();
  const db = memoryDb();
  const repo = await connected(a, db);
  await repo.saveForm(form());
  const b = makeWorker();
  const other = createRepo({ db, fetch: b.fetch, now: () => b.now });
  await other.load();
  await other.connect({ apiBase: 'https://other.example.com', token: TOKEN });
  assert.deepEqual(other.state.entries, []);
});

test('repo: settings read with a fallback, and a change is saved to the backend', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  assert.equal(repo.setting('yearMode'), 'academic');
  assert.equal(repo.setting('missing', 'fallback'), 'fallback');
  await repo.setSetting('excludeTrips', true);
  assert.equal(repo.setting('excludeTrips'), true);
  assert.equal(JSON.parse(w.rows('settings', "id = 'excludeTrips'")[0].value), true);
});

test('repo: completing a weekly review records the week once', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  await repo.completeReview('2026-09-28');
  await repo.completeReview('2026-09-28');
  assert.deepEqual(repo.state.reviews.map((r) => [r.id, r.weekStart, r.completedAt]), [['2026-09-28', '2026-09-28', NOW]]);
  assert.equal(w.rows('reviews').length, 1);
});

test('repo: a wrong token changes nothing locally and says what to check', async () => {
  const w = makeWorker();
  const repo = createRepo({ db: memoryDb(), fetch: w.fetch });
  await repo.load();
  await assert.rejects(repo.connect({ apiBase: BASE, token: 'wrong' }), { message: 'Check the backend token in Settings.' });
  assert.equal(repo.connected(), false);
});

test('repo: rows are added, changed, deleted and brought back through the backend', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  await repo.saveRow('trips', 't1', { name: 'Singapore', start: '2026-12-10', end: '2026-12-20' });
  await repo.saveRow('trips', 't1', { name: 'Singapore and KL' });
  assert.deepEqual(repo.state.trips.map((t) => [t.name, t.start]), [['Singapore and KL', '2026-12-10']]);
  await repo.deleteRow('trips', 't1');
  assert.ok(repo.state.trips[0].deletedAt);
  await repo.restoreRow('trips', 't1');
  assert.equal(repo.state.trips[0].deletedAt, null);
});

test('repo: editing an entry keeps its id and reprices it', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  const { entry } = await repo.saveForm(form());
  await repo.saveEntry({ ...entry, amountMinor: 500, note: 'Two coffees' });
  assert.deepEqual(repo.state.entries.map((e) => [e.id, e.gbpPence, e.note]), [['e1', 500, 'Two coffees']]);
});

test('repo: restoring a backup replaces the backend and the local copy', async () => {
  const w = makeWorker();
  const repo = await connected(w);
  await repo.saveForm(form());
  const { backupData } = await import('../src/engine/export.js');
  const backup = JSON.parse(JSON.stringify(backupData(repo.state, { now: NOW })));
  await repo.saveForm(form({ id: 'e2', amount: '9.99' }));
  await repo.restoreBackup(backup);
  assert.deepEqual(repo.state.entries.filter((e) => !e.deletedAt).map((e) => e.id), ['e1']);
  await repo.markBackedUp(NOW);
  assert.equal(repo.state.lastBackupAt, NOW);
});

test('repo: a sync that answers after a save never puts back the older copy', async () => {
  const w = makeWorker();
  // While gate is set, a sync's answer is held back after the backend has written it.
  let gate = null;
  let answered;
  const fetch = async (url, init) => {
    const res = await w.fetch(url, init);
    if (gate && String(url).includes('/sync')) { answered(); await gate; }
    return res;
  };
  const repo = createRepo({ db: memoryDb(), fetch, now: () => w.now });
  await repo.load();
  await repo.connect({ apiBase: BASE, token: TOKEN });
  const { entry } = await repo.saveForm(form());
  await repo.saveEntry({ ...entry, note: 'First' });

  // A sync sets off, the backend answers with the "First" note, then a save lands before it's read.
  let release;
  gate = new Promise((go) => { release = go; });
  const reached = new Promise((go) => { answered = go; });
  const syncing = repo.sync();
  await reached;
  gate = null;
  await repo.saveEntry({ ...entry, note: 'Second' });
  release();
  await syncing;
  assert.equal(repo.state.entries[0].note, 'Second');
  await repo.sync();
  assert.equal(repo.state.entries[0].note, 'Second');
});

test('repo: prices are fetched outside sync and kept for opening offline', async () => {
  const w = makeWorker();
  const db = memoryDb();
  const repo = await connected(w, db);
  let told = 0;
  repo.subscribe(() => { told += 1; });
  const data = await repo.refreshPrices();
  assert.deepEqual(data.prices, []);
  assert.deepEqual(repo.state.ibkr, { configured: false, status: null });
  assert.equal(told, 1);
  // Opened again (offline): the last prices are there.
  const again = createRepo({ db, fetch: async () => { throw new TypeError('offline'); }, now: () => w.now });
  await again.load();
  assert.deepEqual(again.state.ibkr, { configured: false, status: null });
});
