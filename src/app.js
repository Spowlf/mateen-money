// Boot: load the local copy, show the screen, then sync in the background.

import { idb } from './db/idb.js';
import { createRepo } from './db/repo.js';
import { renderLog } from './ui/log.js';
import { renderOverview } from './ui/overview.js';
import { renderHistory } from './ui/history.js';
import { renderPlan } from './ui/plan.js';
import { renderSettings } from './ui/settings.js';
import { toast } from './ui/dom.js';
import { toSortEntries, syncedPhrase } from './engine/index.js';
import { OfflineError, ApiError } from './errors.js';

const SCREENS = {
  log: { title: 'Log', render: renderLog },
  overview: { title: 'Overview', render: renderOverview },
  history: { title: 'History', render: renderHistory },
  plan: { title: 'Plan', render: renderPlan },
  settings: { title: 'Settings', render: renderSettings },
};
const RESYNC_MS = 30 * 1000;

const repo = createRepo({ db: idb });
let current = null;
let lastSyncTry = 0;
let syncOk = false;
const app = { repo, onConnected: () => { syncOk = true; lastSyncTry = Date.now(); renderStatus(); } };

function renderStatus() {
  const synced = document.getElementById('synced');
  // "Last synced" shows when the copy on screen may be out of date.
  synced.hidden = !repo.connected() || syncOk;
  synced.textContent = `${syncedPhrase(repo.state.lastSyncedAt)}.`;
  const count = toSortEntries(repo.state.entries).length;
  const badge = document.getElementById('to-sort-badge');
  badge.hidden = !count;
  badge.textContent = count;
  badge.setAttribute('aria-label', `${count} to sort`);
}

function show() {
  const name = SCREENS[location.hash.slice(1)] ? location.hash.slice(1) : 'log';
  current?.view?.destroy?.();
  const root = document.getElementById('view');
  document.getElementById('title').textContent = SCREENS[name].title;
  document.title = `${SCREENS[name].title}: Mateen Money`;
  const gear = document.getElementById('settings');
  if (name === 'settings') gear.setAttribute('aria-current', 'page');
  else gear.removeAttribute('aria-current');
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.screen === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  current = { name, view: SCREENS[name].render(root, app) };
  document.getElementById('scroller').scrollTo(0, 0);
}

async function sync({ quiet = true } = {}) {
  if (!repo.connected()) return;
  lastSyncTry = Date.now();
  try {
    await repo.sync();
    syncOk = true;
  } catch (err) {
    syncOk = false;
    if (err instanceof ApiError && !quiet) toast(err.message);
    else if (err instanceof ApiError && err.status === 401) toast(err.message);
    else if (!(err instanceof OfflineError)) console.error(err);
  }
  renderStatus();
}

async function boot() {
  try {
    await repo.load();
  } catch (err) {
    console.error(err);
    toast('This phone’s storage couldn’t be opened. Close the app and open it again.');
  }
  repo.subscribe(() => { current?.view?.refresh?.(); renderStatus(); });
  document.getElementById('settings').addEventListener('click', () => { location.hash = '#settings'; });
  window.addEventListener('hashchange', show);
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => { syncOk = false; renderStatus(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSyncTry > RESYNC_MS) sync();
  });
  show();
  renderStatus();
  navigator.storage?.persist?.().catch(() => {});
  sync();
}

function showUpdate() {
  const button = document.getElementById('update');
  if (!button.hidden) return;
  button.onclick = () => location.reload();
  button.hidden = false;
}

// Asks the service worker to look for new app files on coming back to the screen, since a home
// screen app resumed from the background doesn't reload. (Opening it refreshes every file anyway.)
// At most once a minute.
const CHECK_MS = 60 * 1000;
let lastCheck = Date.now();
function checkForUpdate() {
  if (Date.now() - lastCheck < CHECK_MS || !navigator.onLine) return;
  lastCheck = Date.now();
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => {});
    reg.active?.postMessage({ type: 'check' });
  }).catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'updated') showUpdate(); });
  const hadController = !!navigator.serviceWorker.controller;   // a first install is not an update
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdate(); });
}

boot();
