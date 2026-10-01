// Investments: IBKR's holdings and prices. Units and prices are integer millionths ("micro"),
// so fractional shares (184.8563) and prices (69.6000) are exact; their products pass 2^53, so
// they're multiplied with BigInt and rounded to minor units once.
//
// The IBKR account's balance is its net asset value at the last close, written by the nightly
// Flex sync as an ordinary balance row. During the day it moves with prices:
//   value = close NAV + Σ units × (live price − close price), converted to the account's currency.

import { exponent } from './money.js';
import { rateFor, convertToGbp } from './currency.js';
import { partsInZone, weekday, addDays } from './dates.js';
import { isLive } from './totals.js';

const MICRO = 1_000_000n;

/** Decimal text to integer millionths ("184.8563" → 184856300, "-2.5" → -2500000), or null. */
export function toMicro(text) {
  const s = String(text ?? '').trim().replace(/,/g, '');
  const m = /^([-+]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = (m[3] ?? '').padEnd(7, '0');
  let micro = Number(m[2] || '0') * 1e6 + Number(frac.slice(0, 6));
  if (Number(frac[6]) >= 5) micro += 1;
  return m[1] === '-' && micro ? -micro : micro;
}

/** a × b, where both are millionths, as minor units of currency, rounded half away from zero. */
export function mulMicro(aMicro, bMicro, currency) {
  const scale = MICRO * MICRO;
  const n = BigInt(aMicro) * BigInt(bMicro) * 10n ** BigInt(exponent(currency));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const rounded = (abs + scale / 2n) / scale;
  return Number(negative ? -rounded : rounded);
}

/** Minor units of one currency in another, through GBP at the latest rates. null without a rate. */
export function convertMinor(minor, from, to, rates) {
  if (from === to) return minor;
  const latest = (c) => rateFor(rates, c, '9999-12-31', '0000-01-01');
  let pence = minor;
  if (from !== 'GBP') {
    const r = latest(from);
    if (!r) return null;
    pence = (minor * 100) / (10 ** exponent(from) * r.perGbp);
  }
  if (to === 'GBP') return Math.round(pence);
  const r = latest(to);
  return r ? Math.round((pence * r.perGbp * 10 ** exponent(to)) / 100) : null;
}

// Exchanges as IBKR names them → the suffix Yahoo Finance adds to a ticker there.
const QUOTE_SUFFIX = {
  ARCA: '', NYSE: '', NASDAQ: '', AMEX: '', BATS: '', IEX: '', PINK: '',
  LSE: '.L', LSEETF: '.L', LSEIOB1: '.L', SGX: '.SI', SEHK: '.HK', ASX: '.AX', TSE: '.T', IBIS: '.DE', SBF: '.PA', AEB: '.AS',
};

/** The ticker a price is fetched for: 'SPUS', 'ISDW.L', 'ES3.SI'. */
export function quoteSymbol(symbol, exchange) {
  const suffix = QUOTE_SUFFIX[String(exchange ?? '').toUpperCase()] ?? '';
  return `${String(symbol).trim().replace(/\s+/g, '-')}${suffix}`;
}

// When each market trades (local time, weekdays). A ticker with no suffix is a US one.
const MARKETS = {
  '': { zone: 'America/New_York', open: '09:30', close: '16:00' },
  '.L': { zone: 'Europe/London', open: '08:00', close: '16:35' },
  '.SI': { zone: 'Asia/Singapore', open: '09:00', close: '17:16' },
  '.HK': { zone: 'Asia/Hong_Kong', open: '09:30', close: '16:10' },
  '.AX': { zone: 'Australia/Sydney', open: '10:00', close: '16:12' },
  '.T': { zone: 'Asia/Tokyo', open: '09:00', close: '15:30' },
  '.DE': { zone: 'Europe/Berlin', open: '09:00', close: '17:35' },
  '.PA': { zone: 'Europe/Paris', open: '09:00', close: '17:35' },
  '.AS': { zone: 'Europe/Amsterdam', open: '09:00', close: '17:35' },
};

const marketOf = (quote) => MARKETS[/\.[A-Z]+$/.exec(quote)?.[0] ?? ''] ?? MARKETS[''];

/** Whether a ticker's market is trading at ms (weekdays only; holidays aren't known). */
export function marketOpen(quote, ms) {
  const m = marketOf(quote);
  const { date, time } = partsInZone(ms, m.zone);
  return weekday(date) < 5 && time >= m.open && time < m.close;
}

/**
 * A quote from Yahoo Finance's chart endpoint (v8/finance/chart/<ticker>), or null if it can't be
 * read. Prices in pence ('GBp') become pounds. Returns { id, currency, priceMicro, prevCloseMicro, quoteAt }.
 */
export function readYahooChart(json, quote) {
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose;
  if (!(price > 0) || typeof meta.currency !== 'string') return null;
  const pence = meta.currency === 'GBp' || meta.currency === 'GBX';
  const micro = (n) => (n > 0 ? toMicro((pence ? n / 100 : n).toFixed(6)) : null);
  return {
    id: quote,
    currency: pence ? 'GBP' : meta.currency.toUpperCase(),
    priceMicro: micro(price),
    prevCloseMicro: micro(prev),
    quoteAt: Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime * 1000 : null,
  };
}

// --- IBKR Flex reports -----------------------------------------------------------------------

const ATTR = /([A-Za-z_][\w.-]*)="([^"]*)"/g;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every <tag ...> element's attributes, as objects. Flex XML keeps its data in attributes. */
export function xmlElements(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\s([^>]*?)/?>`, 'g');
  for (const m of String(xml).matchAll(re)) {
    const attrs = {};
    for (const [, k, v] of m[1].matchAll(ATTR)) attrs[k] = unescape(v);
    out.push(attrs);
  }
  return out;
}

/** The text inside the first <tag>…</tag>, or null. */
export const xmlText = (xml, tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(String(xml))?.[1]?.trim() ?? null;

/** Flex dates ('20261001', '2026-10-01', '20261001;153000') → 'YYYY-MM-DD', or null. */
export function flexDate(text) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(text ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const minorOf = (text, currency) => {
  const micro = toMicro(text);
  return micro === null ? null : mulMicro(micro, 1_000_000, currency);
};

const CASH_TYPES = {
  Dividends: 'dividend',
  'Payment In Lieu Of Dividends': 'dividend',
  'Withholding Tax': 'tax',
  'Deposits/Withdrawals': 'deposit',
  'Broker Interest Received': 'interest',
  'Broker Interest Paid': 'fee',
  'Other Fees': 'fee',
  'Commission Adjustments': 'fee',
};

/**
 * Reads a Flex Query statement (XML) with Open Positions, Net Asset Value in Base, Trades and
 * Cash Transactions. Returns null if it isn't one, else {
 *   ibkrAccount, baseCurrency, reportDate, navMinor (in base),
 *   positions: [{ key, symbol, exchange, quote, name, currency, unitsMicro, closeMicro, valueBaseMinor, costBaseMinor }],
 *   activity: [{ id, date, type, symbol, unitsMicro, priceMicro, amountMinor, currency }],
 * }
 * Units below zero (a short) are kept. Lines summed per symbol when IBKR splits them by lot.
 */
export function readFlex(xml) {
  const statement = xmlElements(xml, 'FlexStatement')[0];
  if (!statement) return null;
  const info = xmlElements(xml, 'AccountInformation')[0] ?? {};
  const navRows = xmlElements(xml, 'EquitySummaryByReportDateInBase')
    .map((r) => ({ date: flexDate(r.reportDate), total: r.total, currency: r.currency }))
    .filter((r) => r.date && r.total !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const nav = navRows.at(-1);
  const baseCurrency = (info.currency || nav?.currency || '').toUpperCase() || null;
  if (!nav || !baseCurrency) return null;

  const positions = new Map();
  const open = xmlElements(xml, 'OpenPosition');
  // A report can list a holding once (SUMMARY) or lot by lot (LOT): count it one way only.
  const summary = open.some((x) => x.levelOfDetail === 'SUMMARY');
  for (const p of open) {
    if (p.levelOfDetail && p.levelOfDetail !== (summary ? 'SUMMARY' : 'LOT')) continue;
    const currency = (p.currency || baseCurrency).toUpperCase();
    const fx = toMicro(p.fxRateToBase || '1') ?? 1_000_000;
    const units = toMicro(p.position) ?? 0;
    const key = p.conid || `${p.symbol}:${p.listingExchange ?? ''}`;
    const value = mulMicro(toMicro(p.positionValue) ?? 0, fx, baseCurrency);
    const cost = mulMicro(toMicro(p.costBasisMoney) ?? 0, fx, baseCurrency);
    const old = positions.get(key);
    if (old) {
      old.unitsMicro += units;
      old.valueBaseMinor += value;
      old.costBaseMinor += cost;
      continue;
    }
    positions.set(key, {
      key,
      symbol: p.symbol,
      exchange: p.listingExchange || p.exchange || '',
      quote: quoteSymbol(p.symbol, p.listingExchange || p.exchange),
      name: p.description || p.symbol,
      currency,
      unitsMicro: units,
      closeMicro: toMicro(p.markPrice),
      valueBaseMinor: value,
      costBaseMinor: cost,
    });
  }

  const activity = [];
  for (const t of xmlElements(xml, 'Trade')) {
    if (t.levelOfDetail && t.levelOfDetail !== 'EXECUTION') continue;
    const currency = (t.currency || baseCurrency).toUpperCase();
    const units = toMicro(t.quantity) ?? 0;
    const id = t.tradeID || t.transactionID || t.ibExecID;
    if (!id || !units) continue;
    activity.push({
      id: `trade:${id}`,
      date: flexDate(t.tradeDate || t.dateTime),
      type: units > 0 ? 'buy' : 'sell',
      symbol: t.symbol,
      unitsMicro: Math.abs(units),
      priceMicro: toMicro(t.tradePrice),
      // What it cost or brought in, commission included.
      amountMinor: Math.abs(minorOf(t.netCash ?? t.proceeds, currency) ?? 0),
      currency,
    });
  }
  for (const c of xmlElements(xml, 'CashTransaction')) {
    if (c.levelOfDetail && c.levelOfDetail !== 'DETAIL') continue;
    const type = CASH_TYPES[c.type];
    const currency = (c.currency || baseCurrency).toUpperCase();
    const amount = minorOf(c.amount, currency);
    const id = c.transactionID || c.actionID;
    if (!type || !id || amount === null) continue;
    activity.push({
      id: `cash:${id}`,
      date: flexDate(c.dateTime || c.reportDate || c.settleDate),
      type: type === 'deposit' && amount < 0 ? 'withdrawal' : type,
      symbol: c.symbol || null,
      unitsMicro: null,
      priceMicro: null,
      amountMinor: amount,
      currency,
    });
  }

  return {
    ibkrAccount: statement.accountId || info.accountId || null,
    baseCurrency,
    reportDate: nav.date,
    navMinor: minorOf(nav.total, baseCurrency),
    positions: [...positions.values()],
    activity: activity.filter((a) => a.date),
  };
}

// --- IBKR's value during the day ---------------------------------------------------------------

/** The next weekday after date: when a close's prices are first moved on by new ones. */
function nextTradingDay(date) {
  let next = addDays(date, 1);
  while (weekday(next) > 4) next = addDays(next, 1);
  return next;
}

/**
 * An investment account's value now, from its close (the balance the Flex sync wrote) and the
 * latest prices. Returns {
 *   amountMinor,     close NAV + price moves since, in the account's currency
 *   todayMinor,      Σ units × (price − previous close): the day's move, or null with no live price
 *   costMinor, gainMinor,   from IBKR's cost basis, or null without one
 *   pricedAt,        ms of the newest quote used, or null
 *   holdings: [{ holding, price, valueMinor (in base), todayMinor (base) }]
 * } or null when there's no close balance yet.
 * A price older than the close's next trading day is ignored, so a stale quote never moves it.
 */
export function liveInvestment({ account, balance, holdings, prices, rates }) {
  if (!balance) return null;
  const base = balance.currency;
  const mine = holdings.filter((h) => isLive(h) && h.accountId === account.id);
  const firstLiveDay = nextTradingDay(balance.date);
  let amountMinor = balance.amountMinor;
  let todayMinor = null;
  let pricedAt = null;
  let cost = 0;
  let hasCost = false;
  const rows = mine.map((h) => {
    const p = prices.find((x) => x.id === h.quote && x.currency === h.currency);
    const live = p?.priceMicro && p.quoteAt && partsInZone(p.quoteAt, 'UTC').date >= firstLiveDay ? p : null;
    let valueMinor = h.valueBaseMinor;
    let dayMinor = null;
    if (live && h.closeMicro !== null) {
      const move = convertMinor(mulMicro(h.unitsMicro, live.priceMicro - h.closeMicro, h.currency), h.currency, base, rates);
      if (move !== null) {
        amountMinor += move;
        valueMinor += move;
        pricedAt = Math.max(pricedAt ?? 0, live.quoteAt);
      }
      if (live.prevCloseMicro) {
        dayMinor = convertMinor(mulMicro(h.unitsMicro, live.priceMicro - live.prevCloseMicro, h.currency), h.currency, base, rates);
        if (dayMinor !== null) todayMinor = (todayMinor ?? 0) + dayMinor;
      }
    }
    if (h.costBaseMinor) { cost += h.costBaseMinor; hasCost = true; }
    return { holding: h, price: live, valueMinor, todayMinor: dayMinor };
  });
  const held = rows.reduce((s, r) => s + r.valueMinor, 0);
  return {
    amountMinor,
    todayMinor,
    costMinor: hasCost ? cost : null,
    gainMinor: hasCost ? held - cost : null,
    pricedAt,
    holdings: rows,
  };
}

/** GBP value of a base-currency amount at the latest rate (convertToGbp with no fee). */
export function gbpOf(minor, currency, rates) {
  if (currency === 'GBP') return minor;
  const r = rateFor(rates, currency, '9999-12-31', '0000-01-01');
  return r ? convertToGbp({ amountMinor: minor, currency, perGbp: r.perGbp }).gbpPence : null;
}
