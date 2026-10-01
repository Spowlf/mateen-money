// The app's data: the last-synced copy in memory (state) and in IndexedDB, and every change the
// screens may make. The backend is the source of truth: each change is sent first, and the rows it
// answers with are what gets stored. Screens read state and change it only through this module.

import { SYNCED } from './schema.js';
import { createApi } from './api.js';
import { createDraftStore, submitDraft } from './drafts.js';

/**
 * db is the storage adapter: { getAll, putMany, clear, getMeta, setMeta, deleteMeta }
 * (IndexedDB in the app, see idb.js; a Map in tests).
 */
export function createRepo({ db, fetch, now = () => Date.now() }) {
  const state = Object.fromEntries(SYNCED.map((name) => [name, []]));
  state.connection = null;
  state.rev = 0;
  state.lastSyncedAt = null;
  state.lastBackupAt = null;

  const api = createApi({ fetch, connection: () => state.connection });
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) fn(); };

  /**
   * Stores rows the backend sent, in IndexedDB and in state. A row older than the copy already
   * here is skipped: a sync that set off before a save can answer after it. { all } keeps every
   * row (a full sync on connecting, which may be a backend that started again).
   */
  async function apply(changes = {}, { all = false } = {}) {
    for (const [name, sent] of Object.entries(changes)) {
      if (!sent?.length || !state[name]) continue;
      const byId = new Map(state[name].map((r) => [r.id, r]));
      const rows = all ? sent : sent.filter((r) => !(r.rev < byId.get(r.id)?.rev));
      if (!rows.length) continue;
      await db.putMany(name, rows);
      for (const r of rows) byId.set(r.id, r);
      state[name] = [...byId.values()];
    }
  }

  async function applyWrite(result) {
    await apply(result.changes);
    changed();
    return result;
  }

  const repo = {
    state,
    api,
    draft: createDraftStore({ get: (k) => db.getMeta(k), set: (k, v) => db.setMeta(k, v), delete: (k) => db.deleteMeta(k) }),

    /** Calls fn whenever state changes (after a sync or a save). Returns a function to stop. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async load() {
      for (const name of SYNCED) state[name] = await db.getAll(name);
      state.connection = (await db.getMeta('connection')) ?? null;
      state.rev = (await db.getMeta('rev')) ?? 0;
      state.lastSyncedAt = (await db.getMeta('lastSyncedAt')) ?? null;
      state.lastBackupAt = (await db.getMeta('lastBackupAt')) ?? null;
    },

    connected: () => !!(state.connection?.apiBase && state.connection?.token),

    /** Pulls everything changed since the last sync. */
    async sync() {
      const data = await api.get(`/sync?since=${state.rev}`);
      await apply(data.changes);
      state.rev = data.rev;
      state.lastSyncedAt = now();
      await db.setMeta('rev', state.rev);
      await db.setMeta('lastSyncedAt', state.lastSyncedAt);
      changed();
      return data;
    },

    /**
     * Checks the address and token with a full sync before keeping them. A different backend
     * replaces the local copy. A failed check changes nothing.
     */
    async connect({ apiBase, token }) {
      const connection = { apiBase: apiBase.trim().replace(/\/+$/, ''), token: token.trim() };
      const data = await createApi({ fetch, connection: () => connection }).get('/sync?since=0');
      if (state.connection?.apiBase !== connection.apiBase) {
        await db.clear(SYNCED);
        for (const name of SYNCED) state[name] = [];
      }
      state.connection = connection;
      await db.setMeta('connection', connection);
      await apply(data.changes, { all: true });
      state.rev = data.rev;
      state.lastSyncedAt = now();
      await db.setMeta('rev', state.rev);
      await db.setMeta('lastSyncedAt', state.lastSyncedAt);
      changed();
    },

    /** Saves the Log form. Returns { status: 'saved', entry } | { status: 'offline' } | { status: 'error', message }. */
    async saveForm(form) {
      return submitDraft({
        form,
        store: repo.draft,
        id: crypto.randomUUID(),
        now: now(),
        send: async (entry) => {
          const result = await applyWrite(await api.put(`/entries/${encodeURIComponent(entry.id)}`, entry));
          return result.changes.entries?.[0];
        },
      });
    },

    async deleteEntry(id) {
      return applyWrite(await api.del(`/entries/${encodeURIComponent(id)}`));
    },

    /** Undo for a delete: the entry as it was, live again. */
    async restoreEntry(id) {
      const entry = state.entries.find((e) => e.id === id);
      return applyWrite(await api.put(`/entries/${encodeURIComponent(id)}`, { ...entry, deletedAt: null }));
    },

    /** Edits an entry from History: the fields sent replace the stored ones; the backend reprices it. */
    async saveEntry(entry) {
      return applyWrite(await api.put(`/entries/${encodeURIComponent(entry.id)}`, entry));
    },

    /** Adds or changes a row of another table (vendors, categories, methods, recurring, trips...). */
    async saveRow(table, id, fields) {
      return applyWrite(await api.put(`/${table}/${encodeURIComponent(id)}`, fields));
    },

    /** Accounts and balances in one write, all or nothing: { accounts?: [row], balances?: [row] }. */
    async saveBatch(changes) {
      return applyWrite(await api.post('/batch', changes));
    },

    async deleteRow(table, id) {
      return applyWrite(await api.del(`/${table}/${encodeURIComponent(id)}`));
    },

    /** Undo for a delete. */
    async restoreRow(table, id) {
      return applyWrite(await api.put(`/${table}/${encodeURIComponent(id)}`, { deletedAt: null }));
    },

    /** Replaces everything on the backend with a backup, then pulls the result. */
    async restoreBackup(data) {
      await api.post('/restore', data);
      return repo.sync();
    },

    /** Remembers when a backup was last saved (this phone only). */
    async markBackedUp(at = now()) {
      state.lastBackupAt = at;
      await db.setMeta('lastBackupAt', at);
    },

    /** A synced setting's value, or fallback when it isn't set. */
    setting(id, fallback = null) {
      const row = state.settings.find((s) => s.id === id && !s.deletedAt);
      return row ? row.value : fallback;
    },

    async setSetting(id, value) {
      return applyWrite(await api.put(`/settings/${encodeURIComponent(id)}`, { value }));
    },

    /** Records the weekly review for the week starting weekStart (its id), once. */
    async completeReview(weekStart) {
      const done = state.reviews.find((r) => r.id === weekStart && !r.deletedAt);
      if (done) return { rev: state.rev, changes: {} };
      return applyWrite(await api.put(`/reviews/${encodeURIComponent(weekStart)}`, { weekStart, completedAt: now(), deletedAt: null }));
    },

    /** Files a To sort payment: { vendorId?, categoryId?, vendorName?, currency? }. */
    async sortEntry(id, choice) {
      return applyWrite(await api.post(`/entries/${encodeURIComponent(id)}/sort`, choice));
    },
  };
  return repo;
}
