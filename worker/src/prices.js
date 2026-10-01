// Prices for the holdings' tickers, from Yahoo Finance's chart endpoint (one small adapter, so
// the source can be swapped). Only the Worker fetches them; they live in their own table,
// outside rev, and the phone reads them with GET /prices.
// A failed fetch keeps the last price; the Flex close stands until a newer one arrives.

import { readYahooChart, marketOpen } from '../../src/engine/index.js';

export const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (MateenMoney)' };
// On demand (opening Net Worth), at most this often.
export const REFRESH_MS = 60 * 1000;
// A price this old is fetched again even with its market shut, so each close is caught.
const STALE_MS = 6 * 60 * 60 * 1000;

/** One ticker's quote, or null. */
export async function fetchQuote(fetch, quote) {
  try {
    const res = await fetch(`${YAHOO}/${encodeURIComponent(quote)}?range=1d&interval=1d`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return readYahooChart(await res.json(), quote);
  } catch {
    return null;
  }
}

export async function storedPrices(db) {
  const { results } = await db.prepare('SELECT id, currency, priceMicro, prevCloseMicro, quoteAt, fetchedAt FROM prices').all();
  return results;
}

/** The tickers the live holdings need. */
async function wanted(store) {
  return [...new Set((await store.live('holdings')).map((h) => h.quote))].sort();
}

/**
 * Fetches prices and stores them. Scheduled: tickers whose market is open, and any price over
 * 6 hours old. On demand (all): every ticker, at most once a minute. Returns the stored prices.
 */
export async function refreshPrices(ctx, db, { all = false } = {}) {
  const { store, now } = ctx;
  const quotes = await wanted(store);
  const stored = await storedPrices(db);
  if (all) {
    const last = Number(await store.getMeta('pricesAt')) || 0;
    if (now - last < REFRESH_MS) return stored;
    await store.setMeta('pricesAt', now);
  }
  const due = quotes.filter((q) => {
    if (all) return true;
    const old = stored.find((p) => p.id === q);
    return marketOpen(q, now) || !old || now - old.fetchedAt > STALE_MS;
  });
  const got = (await Promise.all(due.map((q) => fetchQuote(ctx.fetch, q)))).filter(Boolean);
  if (got.length) {
    await db.batch(got.map((p) => db.prepare(`INSERT INTO prices (id, currency, priceMicro, prevCloseMicro, quoteAt, fetchedAt)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET currency = excluded.currency, priceMicro = excluded.priceMicro,
      prevCloseMicro = excluded.prevCloseMicro, quoteAt = excluded.quoteAt, fetchedAt = excluded.fetchedAt`)
      .bind(p.id, p.currency, p.priceMicro, p.prevCloseMicro, p.quoteAt, now)));
  }
  return storedPrices(db);
}
