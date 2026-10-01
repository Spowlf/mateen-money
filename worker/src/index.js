// The Mateen Money API: a Cloudflare Worker in front of D1.
//
//   GET    /sync?since=rev        everything changed after rev (0 = everything)
//   PUT    /entries/:id           add or edit an entry; the Worker prices it
//   POST   /entries/:id/sort      file a To sort entry: { vendorId?, categoryId?, vendorName?, currency? }
//   PUT    /:table/:id            add or edit a vendor, alias, category, method, recurring item, trip, review or setting
//   DELETE /:table/:id            soft delete (Undo is a PUT with deletedAt: null)
//   POST   /restore               replace everything with a backup file's contents
//   POST   /applepay              the Shortcut's payment; replies with one line of text
//   GET    /summary               the weekly summary, as text
//   POST   /summary               the same, for the week just ended where the phone is: { timestamp }
//
// Every route needs "Authorization: Bearer <API_TOKEN>". Writes reply { rev, changes }.

import { partsInZone, partsFromIso, validTimeZone, DEFAULT_TIME_ZONE, weekSummary, weeklyText, findHabits, readBackup, BACKUP_TABLES } from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { createStore } from './store.js';
import { HttpError, json, text, withCors, authorised, readJson, refuse } from './http.js';
import { saveEntry, sortEntry, ingestApplePay } from './entries.js';
import { saveRow, deleteRow, ensureSeeded } from './rows.js';
import { addRecurring, refreshRates } from './jobs.js';

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
  };
}

async function route(request, ctx) {
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
      response = (await route(request, ctx)) ?? failure(new HttpError(404, 'Nothing changed: there is nothing at this address.'), asText);
    } catch (err) {
      response = failure(err, asText);
    }
  }
  return withCors(response, request, env);
}

/** The cron: add recurring items that are due, then refresh rates. */
export async function runScheduled(env, deps = {}) {
  const ctx = await context(env, deps);
  await addRecurring(ctx);
  await refreshRates(ctx);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(runScheduled(env, { now: event.scheduledTime })),
};
