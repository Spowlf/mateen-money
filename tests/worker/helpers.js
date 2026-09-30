// Test harness for the Worker: a fresh D1 per test, a fixed clock, and a fake Frankfurter.

import { fakeD1 } from '../../scripts/sqlite-d1.js';
import { handle, runScheduled } from '../../worker/src/index.js';

export const TOKEN = 'test-token';
export const ORIGIN = 'https://spowlf.github.io';
// Thursday 1 Oct 2026, 13:00 in London.
export const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);

/**
 * Frankfurter with base GBP. days maps 'YYYY-MM-DD' (or 'latest') to { date?, rates: { SGD: 1.7 } }.
 * Records every URL asked for in calls.
 */
export function fakeFrankfurter(days = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    const key = u.pathname.split('/').pop();
    const day = days[key];
    const symbols = (u.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
    if (!day) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    const rates = Object.fromEntries(Object.entries(day.rates).filter(([c]) => !symbols.length || symbols.includes(c)));
    return Response.json({ amount: 1, base: 'GBP', date: day.date ?? key, rates });
  };
  return { fetch, calls };
}

/** A Worker with its own empty database. */
export function makeWorker({ now = NOW, rates = {}, env: extra = {} } = {}) {
  const frankfurter = fakeFrankfurter(rates);
  const env = { DB: fakeD1(), API_TOKEN: TOKEN, ALLOWED_ORIGIN: ORIGIN, ...extra };
  const w = {
    env,
    frankfurter,
    now,
    deps: () => ({ now: w.now, fetch: frankfurter.fetch }),
    async request(method, path, { body, token = TOKEN, origin = ORIGIN, headers = {} } = {}) {
      const h = new Headers(headers);
      if (token) h.set('Authorization', `Bearer ${token}`);
      if (origin) h.set('Origin', origin);
      if (body !== undefined) h.set('Content-Type', 'application/json');
      const req = new Request(`https://api.example.com${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      return handle(req, env, w.deps());
    },
    /** Sends a request and returns { status, body } with the body parsed as JSON when it is JSON. */
    async call(method, path, options) {
      const res = await w.request(method, path, options);
      const type = res.headers.get('Content-Type') ?? '';
      const body = type.includes('json') ? await res.json() : await res.text();
      return { status: res.status, body, headers: res.headers };
    },
    scheduled: () => runScheduled(env, w.deps()),
    /** A fetch that reaches this Worker, for testing the app's API client against it. */
    fetch: async (url, init) => handle(new Request(url, init), env, w.deps()),
    /** Rows straight from the database, skipping the API. */
    rows: (table, where = '1 = 1', ...params) => env.DB.raw.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all(...params).map((r) => ({ ...r })),
  };
  return w;
}

/** A spend entry as the Log form sends it. */
export function manualEntry(extra = {}) {
  return {
    kind: 'spend', date: '2026-10-01', time: '12:30', at: NOW, amountMinor: 420, currency: 'GBP',
    merchant: 'Pret', vendorId: null, categoryId: 'eating-out', incomeType: null, methodId: 'card',
    note: null, tripId: null, tripManual: 0, source: 'manual', spreadMonths: 1, spreadStart: null, ...extra,
  };
}

/** The Shortcut's Apple Pay payload. */
export function applePay(extra = {}) {
  return { amount: '£4.20', merchant: 'PRET A MANGER #1234', card: 'Monzo', timestamp: '2026-10-01T13:00:00+01:00', ...extra };
}
