// A thin promise wrapper over IndexedDB, shaped as the storage adapter repo.js expects.

import { DB_NAME, DB_VERSION, STORES } from './schema.js';

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [index, keyPath] of Object.entries(def.indexes)) store.createIndex(index, keyPath);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer copy of the app needs the database: let go of it. The next call reopens it.
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
  });
  return dbPromise;
}

async function run(names, mode, work) {
  const db = await openDb();
  const tx = db.transaction(names, mode);
  const result = work(tx);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The change was cancelled.'));
  });
}

export const idb = {
  getAll: (name) => run([name], 'readonly', (tx) => tx.objectStore(name).getAll()),
  putMany: (name, rows) => run([name], 'readwrite', (tx) => { const s = tx.objectStore(name); for (const r of rows) s.put(r); }),
  clear: (names) => run(names, 'readwrite', (tx) => { for (const n of names) tx.objectStore(n).clear(); }),
  getMeta: async (key) => (await run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(key)))?.value,
  setMeta: (key, value) => run(['meta'], 'readwrite', (tx) => { tx.objectStore('meta').put({ key, value }); }),
  deleteMeta: (key) => run(['meta'], 'readwrite', (tx) => { tx.objectStore('meta').delete(key); }),
};
