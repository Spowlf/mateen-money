// Which currency a payment is in, and its GBP value.
// Rates are "units of currency per £1" (Frankfurter with base GBP), stored as
// { forDate: 'YYYY-MM-DD', currency, perGbp }. forDate is the date the rate was asked for.

import { exponent } from './money.js';

/** Currencies the app offers in pickers, most likely first. */
export const COMMON_CURRENCIES = ['GBP', 'EUR', 'USD', 'SGD', 'JPY', 'CNY', 'HKD', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'MYR', 'THB', 'KRW', 'INR'];

// Symbol → the currencies it can mean. One entry means it's unambiguous.
export const SYMBOL_CURRENCIES = {
  '£': ['GBP'], '€': ['EUR'], 'US$': ['USD'], 'S$': ['SGD'], 'HK$': ['HKD'], 'AU$': ['AUD'], 'A$': ['AUD'],
  'CA$': ['CAD'], 'C$': ['CAD'], 'NZ$': ['NZD'], 'NT$': ['TWD'], 'R$': ['BRL'], 'CN¥': ['CNY'], 'JP¥': ['JPY'],
  'CHF': ['CHF'], 'zł': ['PLN'], 'Kč': ['CZK'], 'RM': ['MYR'], 'Rp': ['IDR'], '₩': ['KRW'], '₹': ['INR'],
  '฿': ['THB'], '₪': ['ILS'], '₱': ['PHP'],
  '$': ['USD', 'SGD', 'AUD', 'CAD', 'HKD', 'NZD'],
  '¥': ['JPY', 'CNY'],
  'kr': ['SEK', 'NOK', 'DKK', 'ISK'],
};

/**
 * Picks the currency for parsed amount text.
 * - An ISO code in the text wins.
 * - An unambiguous symbol gives its currency.
 * - An ambiguous symbol uses the card's remembered answer ({ '$': 'SGD' }), else asks.
 * - No symbol: the card's default currency, else GBP.
 * Returns { currency, ambiguous, candidates }. When ambiguous, currency is a best guess
 * (the first candidate) so a GBP estimate can still be shown.
 */
export function resolveCurrency({ symbol = null, code = null, symbolMemory = {}, cardDefault = null } = {}) {
  if (code) return { currency: code, ambiguous: false, candidates: [code] };
  if (symbol) {
    const candidates = SYMBOL_CURRENCIES[symbol] ?? [];
    if (candidates.length === 1) return { currency: candidates[0], ambiguous: false, candidates };
    if (symbolMemory[symbol]) return { currency: symbolMemory[symbol], ambiguous: false, candidates };
    if (candidates.length) return { currency: candidates[0], ambiguous: true, candidates };
  }
  return { currency: cardDefault || 'GBP', ambiguous: false, candidates: [] };
}

/**
 * GBP value of an amount. Foreign currency pays the payment method's fee (basis points:
 * 299 = 2.99%) on top. GBP never pays a fee.
 * Returns { basePence, feePence, gbpPence }.
 */
export function convertToGbp({ amountMinor, currency, perGbp, feeBps = 0 }) {
  if (currency === 'GBP') return { basePence: amountMinor, feePence: 0, gbpPence: amountMinor };
  if (!(perGbp > 0)) throw new Error(`No rate for ${currency}`);
  const basePence = Math.round((amountMinor * 100) / (10 ** exponent(currency) * perGbp));
  const feePence = Math.round((basePence * feeBps) / 10000);
  return { basePence, feePence, gbpPence: basePence + feePence };
}

/**
 * The rate to use for a currency on a date.
 * - "final": a rate fetched for that exact date, once the date has passed (ECB publishes
 *   in the afternoon, and weekends use Friday's rate, which Frankfurter returns for the date).
 * - "estimated": otherwise, the latest rate we have for that currency.
 * Returns { perGbp, status, forDate } or null if there's no rate at all.
 */
export function rateFor(rates, currency, date, todayDate) {
  if (currency === 'GBP') return { perGbp: 1, status: 'final', forDate: date };
  let exact = null;
  let latest = null;
  for (const r of rates) {
    if (r.currency !== currency) continue;
    if (r.forDate === date) exact = r;
    if (!latest || r.forDate > latest.forDate) latest = r;
  }
  if (exact && date < todayDate) return { perGbp: exact.perGbp, status: 'final', forDate: date };
  const use = exact ?? latest;
  return use ? { perGbp: use.perGbp, status: 'estimated', forDate: use.forDate } : null;
}

/**
 * Fills in an entry's GBP fields from its amount, currency, rates and fee.
 * A statement override (gbpStatus 'statement') is never recalculated.
 * An entry with no rate available keeps gbpPence null and status 'estimated'.
 * Income is converted at the rate with no fee: the fee is only charged on payments.
 */
export function priceEntry(entry, { rates, feeBps = 0, todayDate }) {
  if (entry.gbpStatus === 'statement') return entry;
  if (entry.kind === 'income') feeBps = 0;
  const rate = rateFor(rates, entry.currency, entry.date, todayDate);
  if (!rate) return { ...entry, gbpPence: null, feePence: 0, feeBps, rate: null, gbpStatus: 'estimated' };
  const { gbpPence, feePence } = convertToGbp({ amountMinor: entry.amountMinor, currency: entry.currency, perGbp: rate.perGbp, feeBps });
  return {
    ...entry,
    gbpPence,
    feePence,
    feeBps: entry.currency === 'GBP' ? 0 : feeBps,
    rate: entry.currency === 'GBP' ? null : rate.perGbp,
    gbpStatus: rate.status,
  };
}

/** GBP value of a planned amount (a recurring item) at the latest rate, no fee. */
export function estimateGbp(amountMinor, currency, rates) {
  if (currency === 'GBP') return amountMinor;
  const rate = rateFor(rates, currency, '9999-12-31', '0000-01-01');
  return rate ? convertToGbp({ amountMinor, currency, perGbp: rate.perGbp }).gbpPence : 0;
}
