import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, submitDraft } from '../src/db/drafts.js';
import { emptyForm, missing, formToEntry, isBlank } from '../src/engine/draft.js';
import { OfflineError, ApiError } from '../src/errors.js';

// A stand-in for IndexedDB that survives "reloads" (new store objects over the same map).
function memoryKv(map = new Map()) {
  return {
    map,
    get: async (k) => structuredClone(map.get(k)),
    set: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => { map.delete(k); },
  };
}

const filled = () => ({ ...emptyForm({ id: 'e-1', date: '2026-10-01', time: '12:30', methodId: 'cash' }), amount: '4.20', vendorName: 'Pret', categoryId: 'coffee-snacks' });

test('draft: every edit is kept, so closing the app loses nothing', async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  await store.save({ ...filled(), amount: '4' });
  await store.save(filled());
  const reopened = createDraftStore(memoryKv(kv.map));
  assert.deepEqual(await reopened.load(), filled());
});

test('draft: saving offline keeps it', async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  const r = await submitDraft({ form: filled(), store, send: async () => { throw new OfflineError(); } });
  assert.equal(r.status, 'offline');
  assert.deepEqual(await createDraftStore(memoryKv(kv.map)).load(), filled());
});

test('draft: a server error keeps it too', async () => {
  const store = createDraftStore(memoryKv());
  const r = await submitDraft({ form: filled(), store, send: async () => { throw new ApiError(500, 'Nothing changed: the server had a problem.'); } });
  assert.deepEqual(r, { status: 'error', message: 'Nothing changed: the server had a problem.' });
  assert.deepEqual(await store.load(), filled());
});

test('draft: cleared only once the backend confirms', async () => {
  const store = createDraftStore(memoryKv());
  let sent;
  const r = await submitDraft({ form: filled(), store, now: 1000, send: async (entry) => { sent = entry; assert.deepEqual(await store.load(), filled()); return entry; } });
  assert.equal(r.status, 'saved');
  assert.equal(await store.load(), null);
  assert.deepEqual([sent.id, sent.amountMinor, sent.currency, sent.merchant, sent.at], ['e-1', 420, 'GBP', 'Pret', 1000]);
});

test('draft: retrying uses the same id, so a save that did land is not added twice', async () => {
  const store = createDraftStore(memoryKv());
  const ids = [];
  const send = async (entry) => { ids.push(entry.id); if (ids.length === 1) throw new OfflineError(); return entry; };
  await submitDraft({ form: filled(), store, send, id: 'fresh-1' });
  await submitDraft({ form: await store.load(), store, send, id: 'fresh-2' });
  assert.deepEqual(ids, ['e-1', 'e-1']);
});

test('draft: one at a time; a blank form removes it', async () => {
  const kv = memoryKv();
  const store = createDraftStore(kv);
  await store.save(filled());
  await store.save({ ...filled(), amount: '9.99' });
  assert.equal(kv.map.size, 1);
  assert.equal((await store.load()).amount, '9.99');
  await store.save(emptyForm({ date: '2026-10-01' }));
  assert.equal(await store.load(), null);
});

test('form: the Save button says what is missing', () => {
  const f = emptyForm({ date: '2026-10-01' });
  assert.equal(missing(f), 'Enter an amount');
  assert.equal(missing({ ...f, amount: '0' }), 'Enter an amount');
  assert.equal(missing({ ...f, amount: '4.2' }), 'Pick a merchant');
  assert.equal(missing({ ...f, amount: '4.2', vendorName: 'Pret' }), 'Pick a category');
  assert.equal(missing(filled()), null);
  assert.equal(missing({ ...f, kind: 'income', amount: '50' }), 'Pick a type of income');
  assert.equal(isBlank(f), true);
});

test('form: income keeps its spread, spending never has one', () => {
  const inc = formToEntry({ ...emptyForm({ date: '2026-09-28' }), kind: 'income', amount: '6000', incomeType: 'allowance', spreadMonths: 12, spreadStart: '2026-10', categoryId: 'x', methodId: 'card' }, { id: 'a' });
  assert.deepEqual([inc.spreadMonths, inc.spreadStart, inc.categoryId, inc.methodId, inc.amountMinor], [12, '2026-10', null, null, 600000]);
  const sp = formToEntry({ ...filled(), spreadMonths: 12, spreadStart: '2026-10' }, { id: 'b' });
  assert.deepEqual([sp.spreadMonths, sp.spreadStart], [1, null]);
});
