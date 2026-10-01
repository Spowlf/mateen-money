// IBKR: the nightly Flex sync, prices, and the day's net worth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeWorker, NOW } from './helpers.js';
import { MARKETS_CRON } from '../../worker/src/index.js';

const FLEX = readFileSync(new URL('../fixtures/flex.xml', import.meta.url), 'utf8');
const IBKR_ENV = { IBKR_FLEX_TOKEN: 'flex-token', IBKR_FLEX_QUERY_ID: '999' };
const RATES = { latest: { date: '2026-09-30', rates: { SGD: 1.725, USD: 1.35 } } };
const HOUR = 60 * 60 * 1000;

const sent = (status = 'Success') => `<FlexStatementResponse timestamp="x"><Status>${status}</Status><ReferenceCode>REF1</ReferenceCode><Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>${status === 'Success' ? '' : '<ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired</ErrorMessage>'}</FlexStatementResponse>`;
const busy = '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>';

/** IBKR answering SendRequest, then GetStatement from a list (the last one repeats). */
function fakeIbkr({ statements = [FLEX], send = sent() } = {}) {
  let n = 0;
  return (url) => new Response(url.pathname.endsWith('SendRequest') ? send : statements[Math.min(n++, statements.length - 1)], { status: 200 });
}

/** Yahoo's chart endpoint with fixed quotes: { 'ISDW.L': [price, prevClose, ms] }. */
function fakeYahoo(quotes) {
  return (url) => {
    const quote = decodeURIComponent(url.pathname.split('/').pop());
    const q = quotes[quote];
    if (!q) return Response.json({ chart: { result: null, error: { code: 'Not Found' } } }, { status: 404 });
    return Response.json({ chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: q[0], chartPreviousClose: q[1], regularMarketTime: q[2] / 1000 } }] } });
  };
}

function worker({ ibkr = fakeIbkr(), yahoo = fakeYahoo({}), env = IBKR_ENV, now = NOW } = {}) {
  return makeWorker({ now, rates: RATES, env, routes: { 'ndcdyn.interactivebrokers.com': ibkr, 'query1.finance.yahoo.com': yahoo } });
}

test('ibkr: the sync writes the close as a balance, the holdings and the activity, in one write', async () => {
  const w = worker();
  const res = await w.call('POST', '/ibkr/sync');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.status, { at: NOW, ok: true, reportDate: '2026-10-01', message: null });
  // An IBKR account is made in the report's base currency, and remembered.
  assert.deepEqual(w.rows('accounts').map((a) => [a.id, a.name, a.kind, a.currency]), [['ibkr', 'IBKR', 'investment', 'SGD']]);
  assert.equal(JSON.parse(w.rows('settings', "id = 'ibkrAccountId'")[0].value), 'ibkr');
  assert.deepEqual(w.rows('balances').map((b) => [b.id, b.amountMinor, b.currency]), [['ibkr:2026-10-01', 3445631, 'SGD']]);
  assert.deepEqual(w.rows('holdings').map((h) => [h.id, h.quote, h.unitsMicro]), [
    ['ibkr:1001', 'SPUS', 191727100], ['ibkr:1002', 'ISDW.L', 184856300], ['ibkr:1003', 'GLD', 6779000],
  ]);
  assert.equal(w.rows('activity').length, 6);
  const revs = new Set(['accounts', 'balances', 'holdings', 'activity'].flatMap((t) => w.rows(t).map((r) => r.rev)));
  assert.equal(revs.size, 1);
  // The token went to IBKR only.
  assert.ok(w.calls.every((u) => u.startsWith('https://ndcdyn.interactivebrokers.com/')));
  assert.ok(w.calls[0].includes('SendRequest?t=flex-token&q=999&v=3'));
  assert.ok(w.calls[1].includes('GetStatement?t=flex-token&q=REF1&v=3'));
});

test('ibkr: an IBKR account added by hand is the one used', async () => {
  const w = worker();
  await w.call('POST', '/batch', { body: { accounts: [{ id: 'mine', name: 'Interactive Brokers', kind: 'investment', currency: 'GBP' }] } });
  await w.call('POST', '/ibkr/sync');
  assert.deepEqual(w.rows('accounts').map((a) => [a.id, a.currency]), [['mine', 'SGD']]);
  assert.equal(w.rows('balances')[0].accountId, 'mine');
});

test('ibkr: syncing again adds nothing new, and a sold holding is removed', async () => {
  const sold = FLEX.replace(/<OpenPosition[^>]*symbol="GLD"[^>]*\/>/g, '');
  const w = worker({ ibkr: fakeIbkr({ statements: [FLEX, FLEX, sold] }) });
  await w.call('POST', '/ibkr/sync');
  const rev = (await w.call('GET', '/sync?since=0')).body.rev;
  await w.call('POST', '/ibkr/sync');
  // Nothing changed, so nothing was written.
  assert.equal((await w.call('GET', '/sync?since=0')).body.rev, rev);
  assert.equal(w.rows('activity').length, 6);
  await w.call('POST', '/ibkr/sync');
  assert.deepEqual(w.rows('holdings', 'deletedAt IS NOT NULL').map((h) => h.symbol), ['GLD']);
});

test('ibkr: a statement still being made is asked for again', async () => {
  const w = worker({ ibkr: fakeIbkr({ statements: [busy, busy, FLEX] }) });
  const res = await w.call('POST', '/ibkr/sync');
  assert.equal(res.body.status.ok, true);
  assert.deepEqual(w.waits, [3000, 5000]);
});

test('ibkr: still not ready, or turned down, says why and changes nothing', async () => {
  const w = worker({ ibkr: fakeIbkr({ statements: [busy] }) });
  const res = await w.call('POST', '/ibkr/sync');
  assert.deepEqual([res.body.status.ok, res.body.status.message], [false, 'IBKR was still making the statement. It’s asked for again within the hour.']);
  assert.equal(w.rows('holdings').length, 0);
  const expired = worker({ ibkr: fakeIbkr({ send: sent('Fail') }) });
  assert.equal((await expired.call('POST', '/ibkr/sync')).body.status.message, 'IBKR said: Token has expired.');
});

test('ibkr: not set up, the route says how and the cron skips it', async () => {
  const w = worker({ env: {} });
  const res = await w.call('POST', '/ibkr/sync');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Nothing changed: add the IBKR token and query id to the Worker first (docs/ibkr.md).');
  await w.scheduled(MARKETS_CRON);
  assert.equal(w.calls.length, 0);
  assert.deepEqual((await w.call('GET', '/prices')).body.ibkr, { configured: false, status: null });
});

test('ibkr: the cron syncs once a day after it works, hourly after it doesn’t', async () => {
  const w = worker({ ibkr: fakeIbkr({ statements: [FLEX] }) });
  await w.scheduled(MARKETS_CRON);
  const asked = () => w.calls.filter((u) => u.includes('SendRequest')).length;
  assert.equal(asked(), 1);
  w.now = NOW + 15 * 60 * 1000;
  await w.scheduled(MARKETS_CRON);
  assert.equal(asked(), 1);
  w.now = NOW + 21 * HOUR;
  await w.scheduled(MARKETS_CRON);
  assert.equal(asked(), 2);

  const failing = worker({ ibkr: fakeIbkr({ send: sent('Fail') }) });
  await failing.scheduled(MARKETS_CRON);
  failing.now = NOW + 30 * 60 * 1000;
  await failing.scheduled(MARKETS_CRON);
  failing.now = NOW + HOUR + 1;
  await failing.scheduled(MARKETS_CRON);
  assert.equal(failing.calls.filter((u) => u.includes('SendRequest')).length, 2);
});

test('prices: fetched for the holdings’ tickers, kept out of sync', async () => {
  // Friday 2 Oct 2026, 16:00 UTC: London and New York both open.
  const now = Date.UTC(2026, 9, 2, 16);
  const yahoo = fakeYahoo({ SPUS: [61, 60, now - 60000], 'ISDW.L': [69.7, 69.6, now - 60000], GLD: [381.11, 381.11, now - 60000] });
  const w = worker({ yahoo, now });
  await w.call('POST', '/ibkr/sync');
  const rev = (await w.call('GET', '/sync?since=0')).body.rev;
  const res = await w.call('POST', '/prices/refresh');
  assert.deepEqual(res.body.prices.map((p) => [p.id, p.priceMicro, p.prevCloseMicro]).sort(), [
    ['GLD', 381110000, 381110000], ['ISDW.L', 69700000, 69600000], ['SPUS', 61000000, 60000000],
  ]);
  assert.deepEqual(res.body.ibkr, { configured: true, status: { at: now, ok: true, reportDate: '2026-10-01', message: null } });
  // Prices never bump rev.
  assert.equal((await w.call('GET', '/sync?since=0')).body.rev, rev);
  assert.equal((await w.call('GET', '/sync?since=0')).body.changes.prices, undefined);
});

test('prices: on demand at most once a minute', async () => {
  const now = Date.UTC(2026, 9, 2, 16);
  const w = worker({ yahoo: fakeYahoo({ SPUS: [61, 60, now] }), now });
  await w.call('POST', '/ibkr/sync');
  const yahooCalls = () => w.calls.filter((u) => u.includes('yahoo')).length;
  await w.call('POST', '/prices/refresh');
  const first = yahooCalls();
  await w.call('POST', '/prices/refresh');
  assert.equal(yahooCalls(), first);
  w.now = now + 61000;
  await w.call('POST', '/prices/refresh');
  assert.ok(yahooCalls() > first);
});

test('prices: the cron fetches open markets, and a shut one only when its price is old', async () => {
  // Friday 2 Oct 2026, 18:00 UTC: London shut, New York open.
  const now = Date.UTC(2026, 9, 2, 18);
  const w = worker({ yahoo: fakeYahoo({ SPUS: [61, 60, now], 'ISDW.L': [69.7, 69.6, now - 2 * HOUR], GLD: [381, 381, now] }), now });
  await w.call('POST', '/ibkr/sync');
  await w.scheduled(MARKETS_CRON);
  const fetched = () => w.calls.filter((u) => u.includes('yahoo')).map((u) => decodeURIComponent(u.split('/').pop().split('?')[0]));
  // The first run has no price for ISDW.L yet, so it's fetched too.
  assert.deepEqual(fetched().sort(), ['GLD', 'ISDW.L', 'SPUS']);
  w.calls.length = 0;
  w.now = now + 15 * 60 * 1000;
  await w.scheduled(MARKETS_CRON);
  assert.deepEqual(fetched().sort(), ['GLD', 'SPUS']);
});

test('prices: a ticker Yahoo doesn’t know keeps the close', async () => {
  const now = Date.UTC(2026, 9, 2, 16);
  const w = worker({ yahoo: fakeYahoo({}), now });
  await w.call('POST', '/ibkr/sync');
  assert.deepEqual((await w.call('POST', '/prices/refresh')).body.prices, []);
});

test('snapshot: the day’s net worth in GBP, replaced by each run, one row a day', async () => {
  const now = Date.UTC(2026, 9, 2, 16);
  let spus = 61;
  const yahoo = (url) => fakeYahoo({ SPUS: [spus, 60, w.now] })(url);
  const w = worker({ yahoo, now });
  await w.call('POST', '/batch', { body: { accounts: [{ id: 'hsbc', name: 'HSBC', kind: 'current', currency: 'GBP' }], balances: [{ id: 'hsbc:2026-10-02', accountId: 'hsbc', date: '2026-10-02', amountMinor: 100000, currency: 'GBP' }] } });
  await w.scheduled(MARKETS_CRON);
  const [first] = w.rows('snapshots');
  assert.equal(first.id, '2026-10-02');
  // £1,000.00 + (S$34,456.31 + US$191.73 = S$244.99) / 1.725 = £1,000.00 + £20,116.79
  assert.equal(first.gbpPence, 100000 + Math.round(((3445631 + 24499) * 100) / (100 * 1.725)));
  spus = 62;
  w.now = now + 61 * 60 * 1000;
  await w.scheduled(MARKETS_CRON);
  const rows = w.rows('snapshots');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].gbpPence > first.gbpPence);
  // Unchanged: not written again.
  const rev = rows[0].rev;
  w.now += 15 * 60 * 1000;
  await w.scheduled(MARKETS_CRON);
  assert.equal(w.rows('snapshots')[0].rev, rev);
});

test('snapshot: nothing without accounts', async () => {
  const w = worker({ env: {} });
  await w.scheduled();
  assert.equal(w.rows('snapshots').length, 0);
});

test('ibkr: holdings and activity can’t be written by the app', async () => {
  const w = worker();
  assert.equal((await w.call('PUT', '/holdings/x', { body: { symbol: 'X' } })).status, 404);
  assert.equal((await w.call('PUT', '/snapshots/2026-10-01', { body: { gbpPence: 1 } })).status, 404);
});
