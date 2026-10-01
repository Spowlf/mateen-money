// Net worth: what you own, beside the spending tracker and never inside it. Nothing here changes
// the headline, budget, forecast or Overview.
//
// Accounts { id, name, kind, currency, sort } hold dated balance snapshots typed in by hand
// { id: accountId:date, accountId, date, amountMinor, currency }: the latest live one is the balance.
// Each account keeps its own currency; the total is in GBP at the latest stored rate.

import { daysBetween, formatDay } from './dates.js';
import { convertToGbp, rateFor } from './currency.js';
import { toMinor, exponent } from './money.js';
import { isLive } from './totals.js';

/** Kinds of account, in the order Net Worth shows them. */
export const ACCOUNT_KINDS = [
  { id: 'investment', name: 'Investments', one: 'Investments' },
  { id: 'savings', name: 'Savings', one: 'Savings' },
  { id: 'current', name: 'Current Accounts', one: 'Current Account' },
];

/** A balance older than this many days gets a warning. */
export const STALE_DAYS = 30;

/** One balance per account per day: typing it again the same day replaces it. */
export const balanceId = (accountId, date) => `${accountId}:${date}`;

const byOrder = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** An account's latest live balance (the latest date; the latest saved on a tie), or null. */
export function latestBalance(balances, accountId) {
  let best = null;
  for (const b of balances) {
    if (!isLive(b) || b.accountId !== accountId) continue;
    if (!best || b.date > best.date || (b.date === best.date && (b.updatedAt ?? 0) > (best.updatedAt ?? 0))) best = b;
  }
  return best;
}

/**
 * An amount in GBP at the latest rate stored for its currency (no fee: nothing is being paid).
 * Returns { pence, forDate } (forDate null for GBP), or null when there's no rate yet.
 */
export function latestGbp(amountMinor, currency, rates) {
  if (currency === 'GBP') return { pence: amountMinor, forDate: null };
  const rate = rateFor(rates, currency, '9999-12-31', '0000-01-01');
  if (!rate) return null;
  return { pence: convertToGbp({ amountMinor, currency, perGbp: rate.perGbp }).gbpPence, forDate: rate.forDate };
}

/** Pence to minor units of currency at the latest stored rate, or null with no rate. */
function fromGbp(pence, currency, rates) {
  if (currency === 'GBP') return pence;
  const rate = rateFor(rates, currency, '9999-12-31', '0000-01-01');
  return rate ? Math.round((pence * rate.perGbp * 10 ** exponent(currency)) / 100) : null;
}

/**
 * Whether a payment came after a balance was typed: on a later day, or on its day after it
 * was saved (the bank's figure already held that day's earlier payments).
 */
const afterBalance = (entry, balance) => entry.date > balance.date
  || (entry.date === balance.date && entry.at != null && balance.updatedAt != null && entry.at > balance.updatedAt);

/**
 * An account's balance carried on from the last one typed: card payments logged since with a
 * payment method linked to the account (methods[].accountId) come off, refunds to those cards
 * go back on. Income with no card, and money moved between accounts, can't be seen.
 * A payment in another currency is converted through its GBP value (fee included) at the latest
 * rate. Returns { amountMinor, payments } (payments counted), or the balance as it is when
 * nothing has happened since.
 */
export function carriedBalance({ balance, accountId, methods = [], entries = [], rates = [] }) {
  if (!balance) return null;
  const linked = new Set(methods.filter((m) => isLive(m) && m.accountId === accountId).map((m) => m.id));
  let amountMinor = balance.amountMinor;
  let payments = 0;
  if (!linked.size) return { amountMinor, payments };
  for (const e of entries) {
    if (!isLive(e) || !linked.has(e.methodId) || !afterBalance(e, balance)) continue;
    const minor = e.currency === balance.currency ? e.amountMinor : e.gbpPence == null ? null : fromGbp(e.gbpPence, balance.currency, rates);
    if (minor === null) continue;
    amountMinor += e.kind === 'income' ? minor : -minor;
    payments += 1;
  }
  return { amountMinor, payments };
}

/**
 * Everything Net Worth shows.
 * Returns {
 *   totalPence,          every account with a balance and a rate, in GBP
 *   estimated,           true when any of it was converted from another currency or carried on
 *   carried: [row]       balances carried on with card payments logged since
 *   rateDate,            the oldest rate date used ('YYYY-MM-DD'), or null
 *   groups: [{ kind, name, pence, share, accounts: [row] }]   kinds with accounts, in ACCOUNT_KINDS order
 *   stale: [row]         balances over STALE_DAYS old
 *   noBalance: [row]     accounts with no balance yet
 *   noRate: [row]        balances waiting for an exchange rate (left out of the total)
 * }
 * Each row is { account, balance, amountMinor (carried on), payments, currency, pence, daysOld, stale }.
 * methods and entries carry each balance on (see carriedBalance); without them it's as typed.
 * share is the group's part of the total (0 when the total isn't above zero).
 */
export function netWorth({ accounts, balances, rates, todayDate, methods = [], entries = [] }) {
  const rows = accounts.filter(isLive).sort(byOrder).map((account) => {
    const balance = latestBalance(balances, account.id);
    const carried = carriedBalance({ balance, accountId: account.id, methods, entries, rates });
    const got = balance ? latestGbp(carried.amountMinor, balance.currency, rates) : null;
    const daysOld = balance ? Math.max(0, daysBetween(balance.date, todayDate)) : null;
    return {
      account,
      balance,
      amountMinor: carried?.amountMinor ?? null,
      payments: carried?.payments ?? 0,
      currency: balance?.currency ?? account.currency,
      pence: got?.pence ?? null,
      forDate: got?.forDate ?? null,
      daysOld,
      stale: daysOld !== null && daysOld > STALE_DAYS,
    };
  });

  const counted = rows.filter((r) => r.pence !== null);
  const totalPence = counted.reduce((sum, r) => sum + r.pence, 0);
  const rateDates = counted.map((r) => r.forDate).filter(Boolean).sort();
  const groups = ACCOUNT_KINDS.map((k) => {
    const mine = rows.filter((r) => r.account.kind === k.id);
    const pence = mine.reduce((sum, r) => sum + (r.pence ?? 0), 0);
    return { kind: k.id, name: k.name, pence, share: totalPence > 0 ? pence / totalPence : 0, accounts: mine };
  }).filter((g) => g.accounts.length);

  return {
    totalPence,
    estimated: rateDates.length > 0 || rows.some((r) => r.payments > 0),
    carried: rows.filter((r) => r.payments > 0),
    rateDate: rateDates[0] ?? null,
    groups,
    stale: rows.filter((r) => r.stale),
    noBalance: rows.filter((r) => !r.balance),
    noRate: rows.filter((r) => r.balance && r.pence === null),
  };
}

/**
 * A typed balance to minor units: like an amount, but it may be below zero (an overdraft) and
 * may carry thousands commas ("-1,240.55" → -124055). Returns null if it isn't a number.
 */
export function balanceMinor(text, currency) {
  const s = String(text ?? '').trim().replace(/,/g, '');
  const negative = /^[-−]/.test(s);
  const minor = toMinor(negative ? s.slice(1) : s, currency);
  if (minor === null) return null;
  return negative && minor ? -minor : minor;
}

/** "Updated today" / "Updated 27 Aug 2026". */
export const updatedPhrase = (date, todayDate) => `Updated ${date === todayDate ? 'today' : formatDay(date)}`;

/**
 * The warning for balances that haven't been updated in over STALE_DAYS days, or null.
 * "DBS was last updated 35 days ago." / "DBS and CIMB haven’t been updated in over 30 days."
 */
export function staleLine(stale) {
  if (!stale.length) return null;
  if (stale.length === 1) return `${stale[0].account.name} was last updated ${stale[0].daysOld} days ago.`;
  const names = stale.map((r) => r.account.name);
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} haven’t been updated in over ${STALE_DAYS} days.`;
}

/**
 * The balance rows to write for amounts typed on date ({ accountId: amountMinor }). An account
 * left blank (undefined or null) is skipped, and so is one whose balance on that date is already
 * the same. Each row is in its account's currency.
 */
export function balanceRows({ accounts, balances, typed, date }) {
  const out = [];
  for (const account of accounts.filter(isLive)) {
    const amountMinor = typed[account.id];
    if (amountMinor === undefined || amountMinor === null) continue;
    const id = balanceId(account.id, date);
    const same = balances.find((b) => b.id === id && isLive(b));
    if (same && same.amountMinor === amountMinor && same.currency === account.currency) continue;
    out.push({ id, accountId: account.id, date, amountMinor, currency: account.currency, deletedAt: null });
  }
  return out;
}

/**
 * What puts rows back as they were before writing them (Undo): each one's earlier version, or
 * a delete when it's new.
 */
export function undoRows(rows, before, now) {
  return rows.map((r) => {
    const old = before.find((b) => b.id === r.id);
    return old ? { ...old } : { ...r, deletedAt: now };
  });
}
