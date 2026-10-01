// The Mateen Money API: a Cloudflare Worker in front of D1.
//
//   GET    /sync?since=rev        everything changed after rev (0 = everything)
//   PUT    /entries/:id           add or edit an entry; the Worker prices it
//   POST   /entries/:id/sort      file a To sort entry: { vendorId?, categoryId?, vendorName?, currency? }
//   PUT    /:table/:id            add or edit a vendor, alias, category, method, recurring item, trip, review, setting,
//                                  account or balance
//   POST   /batch                 accounts, balances and linked cards in one write: { accounts?, balances?, methods? }
//   DELETE /:table/:id            soft delete (Undo is a PUT with deletedAt: null)
//   POST   /restore               replace everything with a backup file's contents
//   POST   /applepay              the Shortcut's payment; replies with one line of text
//   GET    /summary               the weekly summary, as text
//   POST   /summary               the same, for the week just ended where the phone is: { timestamp }
//   GET    /prices                the latest prices and IBKR's sync status: { prices, ibkr }
//   POST   /prices/refresh        the same, fetching every ticker first (at most once a minute)
//   POST   /ibkr/sync             sync IBKR now; replies with the status (then GET /sync for the rows)
//
// Every route needs "Authorization: Bearer <API_TOKEN>". Writes reply { rev, changes }.

import { partsInZone, partsFromIso, validTimeZone, DEFAULT_TIME_ZONE, weekSummary, weeklyText, findHabits, readBackup, BACKUP_TABLES } from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { createStore } from './store.js';
import { HttpError, json, text, withCors, authorised, readJson, refuse } from './http.js';
import { saveEntry, sortEntry, ingestApplePay } from './entries.js';
import { saveRow, saveBatch, deleteRow, ensureSeeded } from './rows.js';
import { addRecurring, refreshRates, saveSnapshot } from './jobs.js';
import { syncIbkr, ibkrStatus, ibkrConfigured } from './ibkr.js';
import { refreshPrices, storedPrices } from './prices.js';

const TEXT_ROUTES = new Set(['applepay', 'summary']);

/** The request's store and clock. "today" is in the synced time zone setting (London until it's set). */
async function context(env, deps) {
  const now = deps.now ?? Date.now();
  const store = createStore(env.DB);
  await ensureSeeded(store, now);
  const setting = await store.get('settings', 'timeZone');
  const timeZone = setting && !setting.deletedAt && validTimeZone(setting.value) ? setting.value : DEFAULT_TIME_ZONE;
  return {
    store,
    now,
    timeZone,
    today: partsInZone(now, timeZone).date,
    fetch: deps.fetch ?? ((...args) => fetch(...args)),
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); })),
  };
}

/** Prices and IBKR's sync status, for Net Worth. */
async function pricesBody(ctx, env, prices) {
  return { prices, ibkr: { configured: ibkrConfigured(env), status: await ibkrStatus(ctx.store) } };
}

async function route(request, ctx, env) {
  const url = new URL(request.url);
  const [first, id, action, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const method = request.method;
  if (rest.length) return null;

  if (method === 'GET' && first === 'sync' && !id) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    return json({ ...(await ctx.store.since(since)), today: ctx.today });
  }
  if ((method === 'GET' || method === 'POST') && first === 'summary' && !id) {
    // The Shortcut sends the phone's time with its offset, so the week is the one just ended where you are.
    const sent = method === 'POST' ? partsFromIso((await readJson(request)).timestamp) : null;
    const [entries, categories, vendors, trips] = await Promise.all(['entries', 'categories', 'vendors', 'trips'].map((t) => ctx.store.live(t)));
    const summary = weekSummary({ entries, categories, todayDate: sent?.date ?? ctx.today });
    return text(weeklyText(summary, findHabits({ entries, vendors, categories, trips, end: summary.end })));
  }
  if (method === 'POST' && first === 'applepay' && !id) {
    return text(await ingestApplePay(ctx, await readJson(request)));
  }
  if (method === 'POST' && first === 'restore' && !id) {
    const backup = await readJson(request);
    const check = readBackup(backup);
    if (!check.ok) throw new HttpError(400, check.message);
    const tables = Object.fromEntries(BACKUP_TABLES.map((name) => [name, (backup.tables[name] ?? []).filter((r) => !r.deletedAt)]));
    if (!tables.categories.length) throw refuse('this backup has no categories.');
    return json(await ctx.store.replaceAll(tables, ctx.now));
  }
  if (method === 'GET' && first === 'prices' && !id) {
    return json(await pricesBody(ctx, env, await storedPrices(env.DB)));
  }
  if (method === 'POST' && first === 'prices' && id === 'refresh' && !action) {
    return json(await pricesBody(ctx, env, await refreshPrices(ctx, env.DB, { all: true })));
  }
  if (method === 'POST' && first === 'ibkr' && id === 'sync' && !action) {
    if (!ibkrConfigured(env)) throw refuse('add the IBKR token and query id to the Worker first (docs/ibkr.md).');
    return json({ status: await syncIbkr(ctx, env, { force: true }) });
  }
  if (method === 'POST' && first === 'batch' && !id) {
    return json(await saveBatch(ctx, await readJson(request)));
  }
  if (first === 'entries' && id && action === 'sort' && method === 'POST') {
    return json(await sortEntry(ctx, id, await readJson(request)));
  }
  if (action || !id || !TABLES[first]?.clientWrites) return null;
  if (method === 'PUT' && first === 'entries') return json(await saveEntry(ctx, id, await readJson(request)));
  if (method === 'PUT') return json(await saveRow(ctx, first, id, await readJson(request)));
  if (method === 'DELETE') return json(await deleteRow(ctx, first, id));
  return null;
}

function failure(err, asText) {
  let status = 500;
  let message = 'Nothing changed: something went wrong on the server. Try again.';
  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (/UNIQUE constraint failed: aliases/.test(err?.message)) {
    status = 409;
    message = 'Nothing changed: that name already belongs to another merchant.';
  } else if (/constraint failed/.test(err?.message)) {
    status = 400;
    message = 'Nothing changed: some details are missing or not allowed.';
  } else {
    console.error(err);
  }
  return asText ? text(message, status) : json({ error: message }, status);
}

/** Handles one request. deps lets tests fix the clock and fake Frankfurter. */
export async function handle(request, env, deps = {}) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env);
  const first = new URL(request.url).pathname.split('/')[1];
  const asText = TEXT_ROUTES.has(first);
  let response;
  if (!authorised(request, env)) {
    response = failure(new HttpError(401, 'Check the backend token in Settings.'), asText);
  } else {
    try {
      const ctx = await context(env, deps);
      response = (await route(request, ctx, env)) ?? failure(new HttpError(404, 'Nothing changed: there is nothing at this address.'), asText);
    } catch (err) {
      response = failure(err, asText);
    }
  }
  return withCors(response, request, env);
}

/** The every-15-minutes cron (wrangler.toml): markets only. */
export const MARKETS_CRON = '*/15 * * * *';

/**
 * The crons. Every 6 hours: add recurring items that are due and refresh rates. Every run: sync
 * IBKR when it's due, fetch prices for open markets, and save today's net worth. One step failing
 * never stops the others.
 */
export async function runScheduled(env, deps = {}, cron = null) {
  const ctx = await context(env, deps);
  const step = async (fn) => { try { return await fn(); } catch (err) { console.error(err); return null; } };
  if (cron !== MARKETS_CRON) {
    await step(() => addRecurring(ctx));
    await step(() => refreshRates(ctx));
  }
  await step(() => syncIbkr(ctx, env));
  const prices = (await step(() => refreshPrices(ctx, env.DB))) ?? [];
  await step(() => saveSnapshot(ctx, prices));
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(runScheduled(env, { now: event.scheduledTime }, event.cron)),
};
