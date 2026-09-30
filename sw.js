// Service worker: precache every file at install, then stale-while-revalidate for same-origin GETs,
// and tell open pages when a file really changed ("Updated, tap to reload").
// The API is on another origin, so it's never cached here; offline data comes from IndexedDB.
// When you add a front-end file, add it to FILES (a test checks this).

const CACHE = 'mateen-money-v3';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'src/app.js',
  'src/errors.js',
  'src/db/api.js',
  'src/db/drafts.js',
  'src/db/idb.js',
  'src/db/repo.js',
  'src/db/schema.js',
  'src/engine/allowance.js',
  'src/engine/currency.js',
  'src/engine/dates.js',
  'src/engine/defaults.js',
  'src/engine/draft.js',
  'src/engine/export.js',
  'src/engine/form.js',
  'src/engine/headline.js',
  'src/engine/history.js',
  'src/engine/index.js',
  'src/engine/money.js',
  'src/engine/overview.js',
  'src/engine/plan.js',
  'src/engine/recurring.js',
  'src/engine/review.js',
  'src/engine/settings.js',
  'src/engine/terms.js',
  'src/engine/sort.js',
  'src/engine/summary.js',
  'src/engine/totals.js',
  'src/engine/vendors.js',
  'src/ui/backup.js',
  'src/ui/charts.js',
  'src/ui/dom.js',
  'src/ui/entry-sheet.js',
  'src/ui/format.js',
  'src/ui/headline.js',
  'src/ui/history.js',
  'src/ui/log.js',
  'src/ui/overview.js',
  'src/ui/plan.js',
  'src/ui/review.js',
  'src/ui/settings.js',
  'src/ui/sort-sheet.js',
  'src/ui/vendor-sheet.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so a new install gets fresh files.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function sameBody(a, b) {
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
  return true;
}

async function announce(url) {
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const w of windows) w.postMessage({ type: 'updated', url });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const before = cached?.clone();
    const fresh = fetch(req).then(async (res) => {
      if (!res.ok) return res;
      const changed = before && !(await sameBody(before, res.clone()));
      await cache.put(req, res.clone());
      if (changed) await announce(req.url);
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  }));
});
