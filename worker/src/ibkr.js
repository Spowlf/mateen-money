// IBKR through the Flex Web Service: once a night the Worker asks for the user's Flex Query
// (docs/ibkr.md), then writes the account's close as a balance, replaces its holdings and adds
// new activity, in one write. The token and query id are Worker secrets:
//   IBKR_FLEX_TOKEN, IBKR_FLEX_QUERY_ID
// A statement still being made is asked for again a few times, then left to the next run.

import { readFlex, xmlText, balanceId, isIbkrName } from '../../src/engine/index.js';
import { ensureRates } from './rates.js';

export const FLEX = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const HEADERS = { 'User-Agent': 'MateenMoney/1.0' };
// Waits between asks while IBKR makes the statement (ms).
const WAITS = [3000, 5000, 10000, 15000];
// A sync that worked keeps the next one away this long; one that didn't, an hour.
const SYNC_EVERY = 20 * 60 * 60 * 1000;
const RETRY_EVERY = 60 * 60 * 1000;

export const ibkrConfigured = (env) => !!(env.IBKR_FLEX_TOKEN && env.IBKR_FLEX_QUERY_ID);

/** The sync's last result, for the app: { at, ok, reportDate, message } or null. */
export async function ibkrStatus(store) {
  const raw = await store.getMeta('ibkrStatus');
  return raw ? JSON.parse(raw) : null;
}

async function setStatus(store, status) {
  await store.setMeta('ibkrStatus', JSON.stringify(status));
}

/**
 * Asks IBKR for the statement. Returns { xml } or { message } (why not, in the app's words).
 */
export async function fetchFlex({ fetch, token, queryId, sleep }) {
  const get = async (url) => {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    return res.ok ? res.text() : null;
  };
  try {
    const sent = await get(`${FLEX}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`);
    if (!sent) return { message: 'IBKR didn’t answer.' };
    if (xmlText(sent, 'Status') !== 'Success') {
      return { message: `IBKR said: ${xmlText(sent, 'ErrorMessage') ?? 'the request was turned down'}.` };
    }
    const ref = xmlText(sent, 'ReferenceCode');
    const base = xmlText(sent, 'Url') ?? `${FLEX}/GetStatement`;
    for (let i = 0; i <= WAITS.length; i++) {
      const got = await get(`${base}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(ref)}&v=3`);
      if (got && got.includes('<FlexQueryResponse')) return { xml: got };
      // 1019: still being made. Anything else won't change by asking again.
      if (got && xmlText(got, 'ErrorCode') !== '1019') {
        return { message: `IBKR said: ${xmlText(got, 'ErrorMessage') ?? 'the statement couldn’t be made'}.` };
      }
      if (i < WAITS.length) await sleep(WAITS[i]);
    }
    return { message: 'IBKR was still making the statement. It’s asked for again within the hour.' };
  } catch {
    return { message: 'IBKR couldn’t be reached.' };
  }
}

/**
 * The account IBKR's figures go into: the one in the ibkrAccountId setting, else an investment
 * account named like IBKR, else a new "IBKR" account in the report's base currency.
 * Returns { account, created }.
 */
async function ibkrAccount(store, baseCurrency) {
  const setting = await store.get('settings', 'ibkrAccountId');
  const accounts = await store.live('accounts');
  const chosen = setting && !setting.deletedAt && accounts.find((a) => a.id === setting.value);
  if (chosen) return { account: chosen, created: false };
  const named = accounts.find((a) => a.kind === 'investment' && isIbkrName(a.name));
  if (named) return { account: named, created: true };
  const sort = Math.min(0, ...accounts.map((a) => a.sort ?? 0)) - 1;
  return { account: { id: 'ibkr', name: 'IBKR', kind: 'investment', currency: baseCurrency, sort, deletedAt: null }, created: true };
}

const SAME = ['symbol', 'exchange', 'quote', 'name', 'currency', 'unitsMicro', 'closeMicro', 'valueBaseMinor', 'costBaseMinor', 'reportDate'];

/**
 * Writes a read statement (readFlex) for the account, in one write: the close as its balance,
 * holdings as reported (ones gone deleted), activity not seen before, and the latest rates for
 * the currencies involved. Rows that haven't changed aren't written again.
 */
export async function applyFlex(ctx, flex) {
  const { store, now } = ctx;
  const { account, created } = await ibkrAccount(store, flex.baseCurrency);
  const accountRow = account.currency === flex.baseCurrency && !created ? null : { ...account, currency: flex.baseCurrency };
  const balance = {
    id: balanceId(account.id, flex.reportDate), accountId: account.id, date: flex.reportDate,
    amountMinor: flex.navMinor, currency: flex.baseCurrency, deletedAt: null,
  };
  const oldBalance = await store.get('balances', balance.id);
  const before = await store.all('holdings', 'accountId = ?', account.id);
  const holdings = flex.positions.map((p) => ({
    id: `${account.id}:${p.key}`, accountId: account.id, symbol: p.symbol, exchange: p.exchange, quote: p.quote, name: p.name,
    currency: p.currency, unitsMicro: p.unitsMicro, closeMicro: p.closeMicro, valueBaseMinor: p.valueBaseMinor,
    costBaseMinor: p.costBaseMinor, reportDate: flex.reportDate, deletedAt: null,
  })).filter((h) => {
    const old = before.find((b) => b.id === h.id);
    return !old || old.deletedAt || SAME.some((k) => old[k] !== h[k]);
  });
  const kept = new Set(flex.positions.map((p) => `${account.id}:${p.key}`));
  const gone = before.filter((b) => !b.deletedAt && !kept.has(b.id)).map((b) => ({ ...b, deletedAt: now }));
  const known = new Set((await store.all('activity', 'accountId = ?', account.id)).map((a) => a.id));
  const activity = flex.activity.map((a) => ({ ...a, id: `${account.id}:${a.id}`, accountId: account.id, deletedAt: null }))
    .filter((a) => !known.has(a.id));
  const currencies = [...new Set([flex.baseCurrency, ...flex.positions.map((p) => p.currency)])].filter((c) => c !== 'GBP');
  const got = await ensureRates({ fetch: ctx.fetch, rates: await store.live('rates'), needs: currencies.map((c) => ({ currency: c, date: ctx.today })), today: ctx.today });
  const setting = created ? [{ id: 'ibkrAccountId', value: account.id, deletedAt: null }] : [];
  const sameBalance = oldBalance && !oldBalance.deletedAt && oldBalance.amountMinor === balance.amountMinor && oldBalance.currency === balance.currency;
  return store.write({
    accounts: accountRow ? [accountRow] : [],
    balances: sameBalance ? [] : [balance],
    holdings: [...holdings, ...gone],
    activity,
    rates: got.fresh,
    settings: setting,
  }, now, { insertOnly: ['activity'] });
}

/**
 * Syncs IBKR when it's due (or now, with force): once a day after a sync that worked, hourly
 * after one that didn't. Returns the status it saved, or null when it wasn't due or isn't set up.
 */
export async function syncIbkr(ctx, env, { force = false } = {}) {
  const { store, now } = ctx;
  if (!ibkrConfigured(env)) return null;
  const last = await ibkrStatus(store);
  if (!force && last && now - last.at < (last.ok ? SYNC_EVERY : RETRY_EVERY)) return null;
  const got = await fetchFlex({ fetch: ctx.fetch, token: env.IBKR_FLEX_TOKEN, queryId: env.IBKR_FLEX_QUERY_ID, sleep: ctx.sleep });
  let status;
  if (got.message) {
    status = { at: now, ok: false, reportDate: last?.reportDate ?? null, message: got.message };
  } else {
    const flex = readFlex(got.xml);
    if (!flex) {
      status = { at: now, ok: false, reportDate: last?.reportDate ?? null, message: 'The IBKR statement had no net asset value. Check the Flex Query has the sections in docs/ibkr.md.' };
    } else {
      await applyFlex(ctx, flex);
      status = { at: now, ok: true, reportDate: flex.reportDate, message: null };
    }
  }
  await setStatus(store, status);
  return status;
}
