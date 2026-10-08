// Reading and writing D1. Every write goes through write(), which stamps updatedAt and the
// next rev in the same transaction as the rows, so a sync can never skip a change.

import { TABLES, fromDb } from './tables.js';
import { SYNCED } from '../../src/db/schema.js';

const q = (name) => `"${name}"`;
const NEXT_REV = "UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value";
const CURRENT_REV = "SELECT value FROM meta WHERE key = 'rev'";

function toDb(name, row, column) {
  const v = row[column];
  if (v === undefined) return null;
  if (TABLES[name].json.includes(column)) return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export function createStore(db) {
  const upsert = (name, row, insertOnly) => {
    const cols = TABLES[name].columns.filter((c) => c !== 'rev');
    const set = cols.filter((c) => c !== 'id').map((c) => `${q(c)} = excluded.${q(c)}`).concat('"rev" = excluded."rev"');
    const sql = `INSERT INTO ${q(name)} (${[...cols, 'rev'].map(q).join(', ')})
      VALUES (${cols.map(() => '?').join(', ')}, (${CURRENT_REV}))
      ${insertOnly ? 'ON CONFLICT DO NOTHING' : `ON CONFLICT (id) DO UPDATE SET ${set.join(', ')}`}`;
    return db.prepare(sql).bind(...cols.map((c) => toDb(name, row, c)));
  };

  return {
    async get(name, id) {
      return fromDb(name, await db.prepare(`SELECT * FROM ${q(name)} WHERE id = ?`).bind(id).first());
    },

    async all(name, where = '1 = 1', ...params) {
      const { results } = await db.prepare(`SELECT * FROM ${q(name)} WHERE ${where}`).bind(...params).all();
      return results.map((r) => fromDb(name, r));
    },

    live(name) {
      return this.all(name, 'deletedAt IS NULL');
    },

    /**
     * Writes rows ({ table: [row] }) in one transaction under one new rev.
     * Tables named in insertOnly never replace an existing row (seeds, recurring occurrences).
     * Returns { rev, changes } with the rows as written.
     */
    async write(changes, now, { insertOnly = [] } = {}) {
      const stamped = {};
      const statements = [db.prepare(NEXT_REV)];
      for (const [name, rows] of Object.entries(changes)) {
        if (!rows?.length) continue;
        stamped[name] = rows.map((r) => ({ ...r, updatedAt: now }));
        for (const row of stamped[name]) statements.push(upsert(name, row, insertOnly.includes(name)));
      }
      if (statements.length === 1) return { rev: null, changes: {} };
      const [{ results: [{ value: rev }] }] = await db.batch(statements);
      for (const rows of Object.values(stamped)) for (const r of rows) r.rev = rev;
      return { rev, changes: stamped };
    },

    /**
     * Replaces every synced table with tables ({ name: [row] }) in one transaction under one new
     * rev: every live row is deleted, then each given row is written as it is. All of it lands or
     * none of it does. Deleted payments let go of their recurring occurrence, so a restored copy
     * of the same occurrence can take its place.
     */
    async replaceAll(tables, now) {
      const statements = [db.prepare(NEXT_REV)];
      for (const name of SYNCED) {
        statements.push(db.prepare(`UPDATE ${q(name)} SET deletedAt = ?, updatedAt = ?, rev = (${CURRENT_REV}) WHERE deletedAt IS NULL`).bind(now, now));
      }
      statements.push(db.prepare('UPDATE entries SET recurringId = NULL, occurrenceDate = NULL WHERE deletedAt IS NOT NULL AND recurringId IS NOT NULL'));
      let count = 0;
      for (const name of SYNCED) {
        for (const row of tables[name] ?? []) {
          // Each row keeps the time it was last changed: a balance and the payments on its day are
          // ordered by it, so a restore mustn't move them.
          statements.push(upsert(name, { ...TABLES[name].defaults, ...row, updatedAt: Number.isInteger(row.updatedAt) ? row.updatedAt : now }));
          count++;
        }
      }
      const [{ results: [{ value: rev }] }] = await db.batch(statements);
      return { rev, count };
    },

    /** Everything changed after rev, from one consistent snapshot. */
    async since(rev) {
      const out = await db.batch([
        db.prepare(CURRENT_REV),
        ...SYNCED.map((name) => db.prepare(`SELECT * FROM ${q(name)} WHERE rev > ? ORDER BY rev, id`).bind(rev)),
      ]);
      const changes = {};
      SYNCED.forEach((name, i) => { changes[name] = out[i + 1].results.map((r) => fromDb(name, r)); });
      return { rev: out[0].results[0].value, changes };
    },

    async getMeta(key) {
      return db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first('value');
    },

    async setMeta(key, value) {
      await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, value).run();
    },
  };
}
