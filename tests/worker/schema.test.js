import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../../scripts/sqlite-d1.js';
import { TABLES } from '../../worker/src/tables.js';
import { SYNCED } from '../../src/db/schema.js';

const columnsOf = (db, table) => db.raw.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);

test('schema: every synced table exists with the columns the Worker writes', () => {
  const db = fakeD1();
  assert.deepEqual(Object.keys(TABLES).sort(), [...SYNCED].sort());
  for (const [name, { columns }] of Object.entries(TABLES)) {
    assert.deepEqual(columnsOf(db, name).sort(), [...columns].sort(), name);
    for (const c of ['id', 'updatedAt', 'deletedAt', 'rev']) assert.ok(columns.includes(c), `${name}.${c}`);
  }
});

test('schema: a budgets table is reserved for later', () => {
  const db = fakeD1();
  assert.deepEqual(columnsOf(db, 'budgets').sort(), ['amountPence', 'categoryId', 'deletedAt', 'fromMonth', 'id', 'rev', 'updatedAt'].sort());
});

test('schema: a recurring occurrence can only be stored once', () => {
  const db = fakeD1();
  const insert = (id) => db.raw.prepare(`INSERT INTO entries (id, kind, date, amountMinor, currency, recurringId, occurrenceDate, updatedAt, rev)
    VALUES (?, 'spend', '2026-10-01', 1000, 'GBP', 'r1', '2026-10-01', 0, 1)`).run(id);
  insert('a');
  assert.throws(() => insert('b'), /UNIQUE/);
});

test('schema: a live alias name belongs to one vendor, but a deleted one frees it', () => {
  const db = fakeD1();
  const insert = (id, deletedAt = null) => db.raw.prepare(`INSERT INTO aliases (id, vendorId, alias, aliasNorm, updatedAt, deletedAt, rev)
    VALUES (?, 'v1', 'PRET', 'pret', 0, ?, 1)`).run(id, deletedAt);
  insert('a', 5);
  insert('b');
  assert.throws(() => insert('c'), /UNIQUE/);
});
