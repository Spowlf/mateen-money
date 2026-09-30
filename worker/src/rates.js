// ECB rates from Frankfurter, base GBP. Only the Worker fetches them; the phone gets them by sync.
// A failed fetch is never an error: the entry stays "estimated" and the next run tries again.

import { rateFor } from '../../src/engine/currency.js';

export const FRANKFURTER = 'https://api.frankfurter.dev/v1';

/**
 * Rates for currencies on a day ('YYYY-MM-DD' or 'latest'). A date's rows are stored under the
 * date asked for (a weekend gets Friday's rate); 'latest' is stored under the date it is for.
 */
export async function fetchRates(fetch, day, currencies) {
  if (!currencies.length) return [];
  try {
    const res = await fetch(`${FRANKFURTER}/${day}?base=GBP&symbols=${currencies.join(',')}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    const forDate = day === 'latest' ? data.date : day;
    return Object.entries(data.rates ?? {})
      .filter(([, perGbp]) => perGbp > 0)
      .map(([currency, perGbp]) => ({ id: `${forDate}:${currency}`, forDate, currency, perGbp }));
  } catch {
    return [];
  }
}

/**
 * Fetches whatever is missing to price needs ([{ currency, date }]):
 * - a date that has passed and has no rate of its own gets that date's rate;
 * - a currency with no rate at all gets the latest;
 * - currencies in alsoLatest get the latest regardless (the daily refresh).
 * Returns { rates: every rate now known, fresh: rows new or changed, to store }.
 */
export async function ensureRates({ fetch, rates, needs, today, alsoLatest = [] }) {
  const known = [...rates];
  const fresh = [];
  const add = (rows) => {
    for (const r of rows) {
      const old = known.find((k) => k.id === r.id);
      if (old && old.perGbp === r.perGbp) continue;
      if (old) known.splice(known.indexOf(old), 1);
      known.push(r);
      fresh.push(r);
    }
  };

  const foreign = needs.filter((n) => n.currency && n.currency !== 'GBP');
  const byDate = new Map();
  for (const { currency, date } of foreign) {
    if (date < today && !known.some((r) => r.currency === currency && r.forDate === date)) {
      if (!byDate.has(date)) byDate.set(date, new Set());
      byDate.get(date).add(currency);
    }
  }
  for (const [date, currencies] of byDate) add(await fetchRates(fetch, date, [...currencies]));

  const latest = new Set(alsoLatest.filter((c) => c !== 'GBP'));
  for (const { currency } of foreign) if (!rateFor(known, currency, today, today)) latest.add(currency);
  if (latest.size) add(await fetchRates(fetch, 'latest', [...latest].sort()));

  return { rates: known, fresh };
}
