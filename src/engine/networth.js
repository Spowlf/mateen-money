// Net worth: what you own, beside the spending tracker and never inside it. Nothing here changes
// the headline, budget, forecast or Overview.
//
// Accounts { id, name, kind, currency, sort } hold dated balance snapshots typed in by hand
// { id: accountId:date, accountId, date, amountMinor, currency }: the latest live one is the balance.
// Each account keeps its own currency; the total is in GBP at the latest stored rate.

import { daysBetween, formatDay, addDays, addMonths, monthKey, monthStart } from './dates.js';
import { convertToGbp, rateFor } from './currency.js';
import { toMinor, exponent, formatMoney } from './money.js';
import { isLive } from './totals.js';
import { liveInvestment } from './holdings.js';
import { settlementMinor } from './splits.js';

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

/** A net worth row carried on from its typed balance by something logged since. */
const isCarried = (r) => r.payments > 0 || r.income > 0 || r.settled > 0 || r.moved > 0;

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
 * go back on, and income logged into the account (entries[].accountId, which wins over its
 * card's account) goes on. Other income can't be seen.
 * A payment in another currency is converted through its GBP value (fee included) at the latest
 * rate. A settle-up with a friend naming the account (settlements[].accountId) moves it in or out,
 * converted the same way. A move between accounts (transfers) takes the amount sent off its From
 * account and puts the amount received on its To account, each in its own currency.
 * Returns { amountMinor, payments, income, settled, moved } (rows counted), or the balance as it is
 * when nothing has happened since.
 */
export function carriedBalance({ balance, accountId, methods = [], entries = [], rates = [], settlements = [], transfers = [] }) {
  if (!balance) return null;
  const linked = new Set(methods.filter((m) => isLive(m) && m.accountId === accountId).map((m) => m.id));
  let amountMinor = balance.amountMinor;
  let payments = 0;
  let income = 0;
  const into = (e) => (e.accountId ? e.accountId === accountId : linked.has(e.methodId));
  for (const e of entries) {
    if (!isLive(e) || !into(e) || !afterBalance(e, balance)) continue;
    const minor = e.currency === balance.currency ? e.amountMinor : e.gbpPence == null ? null : fromGbp(e.gbpPence, balance.currency, rates);
    if (minor === null) continue;
    amountMinor += e.kind === 'income' ? minor : -minor;
    if (e.kind === 'income' && e.accountId) income += 1; else payments += 1;
  }
  // Settling up with a friend moves money in or out of the account it names (a 0 one names none).
  let settled = 0;
  for (const t of settlements) {
    if (!isLive(t) || t.accountId !== accountId || !t.amountMinor || !afterBalance({ date: t.date, at: t.updatedAt ?? null }, balance)) continue;
    const signed = settlementMinor(t);
    const minor = t.currency === balance.currency ? signed : convertThroughGbp(signed, t.currency, balance.currency, rates);
    if (minor === null) continue;
    amountMinor += minor;
    settled += 1;
  }
  let moved = 0;
  for (const m of transfers) {
    if (!isLive(m) || !afterBalance({ date: m.date, at: m.updatedAt ?? null }, balance)) continue;
    for (const [id, signed, currency] of [[m.fromAccountId, -m.fromAmountMinor, m.fromCurrency], [m.toAccountId, m.toAmountMinor, m.toCurrency]]) {
      if (id !== accountId) continue;
      const minor = currency === balance.currency ? signed : convertThroughGbp(signed, currency, balance.currency, rates);
      if (minor === null) continue;
      amountMinor += minor;
      moved += 1;
    }
  }
  return { amountMinor, payments, income, settled, moved };
}

/** What a move of amountMinor sent in one currency should arrive as in another, at the latest rates; null without them. */
export function estimateReceived(amountMinor, from, to, rates) {
  return from === to ? amountMinor : convertThroughGbp(amountMinor, from, to, rates);
}

/** Minor units of one currency in another through GBP at the latest rates, or null without them. */
function convertThroughGbp(minor, from, to, rates) {
  const got = latestGbp(minor, from, rates);
  return got ? fromGbp(got.pence, to, rates) : null;
}

/**
 * Everything Net Worth shows.
 * Returns {
 *   totalPence,          every account with a balance and a rate, in GBP
 *   estimated,           true when any of it was converted from another currency or carried on
 *   carried: [row]       balances carried on with card payments, or income into them, logged since
 *   rateDate,            the oldest rate date used ('YYYY-MM-DD'), or null
 *   groups: [{ kind, name, pence, share, accounts: [row] }]   kinds with accounts, in ACCOUNT_KINDS order
 *   stale: [row]         balances over STALE_DAYS old
 *   noBalance: [row]     accounts with no balance yet
 *   noRate: [row]        balances waiting for an exchange rate (left out of the total)
 * }
 * Each row is { account, balance, amountMinor (carried on, or moved with prices), payments, income (entries logged since), settled (settle-ups since), live, currency, pence, daysOld, stale }.
 * live is liveInvestment()'s answer for an account with holdings (from holdings and prices), else null.
 * methods and entries carry each balance on (see carriedBalance); without them it's as typed.
 * share is the group's part of the total (0 when the total isn't above zero).
 */
export function netWorth({ accounts, balances, rates, todayDate, methods = [], entries = [], holdings = [], prices = [], settlements = [], transfers = [] }) {
  const rows = accounts.filter(isLive).sort(byOrder).map((account) => {
    const balance = latestBalance(balances, account.id);
    // An account with holdings (IBKR) moves with prices; any other is carried on with card payments.
    const live = holdings.some((h) => isLive(h) && h.accountId === account.id)
      ? liveInvestment({ account, balance, holdings, prices, rates }) : null;
    const carried = live
      ? { amountMinor: live.amountMinor, payments: 0, income: 0, settled: 0, moved: 0 }
      : carriedBalance({ balance, accountId: account.id, methods, entries, rates, settlements, transfers });
    const got = balance ? latestGbp(carried.amountMinor, balance.currency, rates) : null;
    const daysOld = balance ? Math.max(0, daysBetween(balance.date, todayDate)) : null;
    return {
      account,
      balance,
      amountMinor: carried?.amountMinor ?? null,
      payments: carried?.payments ?? 0,
      income: carried?.income ?? 0,
      settled: carried?.settled ?? 0,
      moved: carried?.moved ?? 0,
      live,
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
    estimated: rateDates.length > 0 || rows.some((r) => isCarried(r) || r.live?.pricedAt),
    carried: rows.filter(isCarried),
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

// --- The Net Worth tab: changes, the month's split and the chart ------------------------------

/**
 * A change, signed so colour is never needed: "+£12.50", "−£12.50", "£0.00". Gains and losses
 * stay neutral in colour.
 */
export function signedMoney(minor, currency = 'GBP') {
  const text = formatMoney(Math.abs(Math.round(minor)), currency);
  return minor > 0 ? `+${text}` : minor < 0 ? `−${text}` : text;
}

/** A share as a signed percentage to one decimal: 0.0321 → "+3.2%", -0.5 → "−50.0%". */
export function signedPct(fraction) {
  const text = `${Math.abs(fraction * 100).toFixed(1)}%`;
  return text === '0.0%' ? text : fraction > 0 ? `+${text}` : `−${text}`;
}

/** The rate for currency stored for date or the latest before it, else the earliest stored. null with none. */
export function rateOnOrBefore(rates, currency, date) {
  if (currency === 'GBP') return { perGbp: 1, forDate: date };
  let before = null;
  let earliest = null;
  for (const r of rates) {
    if (r.currency !== currency) continue;
    if (r.forDate <= date && (!before || r.forDate > before.forDate)) before = r;
    if (!earliest || r.forDate < earliest.forDate) earliest = r;
  }
  const use = before ?? earliest;
  return use ? { perGbp: use.perGbp, forDate: use.forDate } : null;
}

const toGbp = (minor, currency, rate) => convertToGbp({ amountMinor: minor, currency, perGbp: rate.perGbp }).gbpPence;

/**
 * Net worth against the latest saved day before today (snapshots, one a day). Returns
 * { pence, from } (from the snapshot's date: yesterday, or an earlier day when none was saved),
 * or null when there's none.
 */
export function dayChange({ snapshots, totalPence, todayDate }) {
  let last = null;
  for (const s of snapshots) if (isLive(s) && s.date < todayDate && (!last || s.date > last.date)) last = s;
  return last ? { pence: totalPence - last.gbpPence, from: last.date } : null;
}

/** IBKR activity that moves money into (+) or out of (−) the account, rather than earning it. */
const MONEY_MOVES = new Set(['deposit', 'withdrawal']);

/**
 * How net worth has changed since the 1st, split three ways that add up to it:
 *   marketPence    investments' moves in their own currency (prices, dividends, interest, fees),
 *                  less money moved in or out of them
 *   currencyPence  exchange rates: each account's balance at the 1st, at today's rate less the 1st's
 *   balancesPence  everything else: bank balances typed or carried on, and money moved into investments
 * Each account starts from its balance before the 1st (carried on to the 1st, at the rate then), or,
 * added this month, from its first balance. Returns {
 *   from: 'YYYY-MM-01', pence, marketPence, currencyPence, balancesPence, investments (any counted)
 * } or null when no account has a balance to start from.
 */
export function monthChange({ accounts, balances, rates, todayDate, methods = [], entries = [], holdings = [], prices = [], activity = [], settlements = [], transfers = [] }) {
  const from = monthStart(monthKey(todayDate));
  const nw = netWorth({ accounts, balances, rates, todayDate, methods, entries, holdings, prices, settlements, transfers });
  const out = { from, pence: 0, marketPence: 0, currencyPence: 0, balancesPence: 0, investments: false };
  let counted = 0;
  for (const r of nw.groups.flatMap((g) => g.accounts)) {
    if (r.pence === null) continue;
    const id = r.account.id;
    const own = balances.filter((b) => isLive(b) && b.accountId === id);
    const before = latestBalance(own.filter((b) => b.date < from), id);
    const first = before ?? own.filter((b) => b.date >= from).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
    if (!first) continue;
    const startDate = before ? addDays(from, -1) : first.date;
    const currency = first.currency;
    // Carried on to the 1st with card payments logged before it; an investment's close stands as it is.
    const startMinor = before && !r.live
      ? carriedBalance({
        balance: before, accountId: id, methods, entries: entries.filter((e) => e.date < from), rates,
        settlements: settlements.filter((t) => t.date < from), transfers: transfers.filter((m) => m.date < from),
      }).amountMinor
      : first.amountMinor;
    const thenRate = rateOnOrBefore(rates, currency, startDate);
    const nowRate = currency === 'GBP' ? { perGbp: 1 } : rateFor(rates, currency, '9999-12-31', '0000-01-01');
    if (!thenRate || !nowRate) continue;
    const startGbp = toGbp(startMinor, currency, thenRate);
    // A balance now in another currency than at the start: all of it is a balance change.
    const startAtNow = currency === r.currency ? toGbp(startMinor, currency, nowRate) : startGbp;
    out.currencyPence += startAtNow - startGbp;
    const local = r.pence - startAtNow;
    if (r.live) {
      out.investments = true;
      const movedIn = activity.filter((a) => isLive(a) && a.accountId === id && MONEY_MOVES.has(a.type)
        && (before ? a.date >= from : a.date > first.date))
        .reduce((sum, a) => {
          const minor = convertMinorLatest(a.amountMinor, a.currency, rates);
          return minor === null ? sum : sum + minor;
        }, 0);
      out.marketPence += local - movedIn;
      out.balancesPence += movedIn;
    } else {
      out.balancesPence += local;
    }
    out.pence += r.pence - startGbp;
    counted += 1;
  }
  return counted ? out : null;
}

/** Minor units of currency in pence at the latest rate, or null without one. */
function convertMinorLatest(minor, currency, rates) {
  const got = latestGbp(minor, currency, rates);
  return got ? got.pence : null;
}

/** The chart's ranges: the months each goes back, null for everything. */
export const WORTH_RANGES = [
  { id: '6m', label: '6 Months', months: 6 },
  { id: 'year', label: 'Year', months: 12 },
  { id: 'all', label: 'All', months: null },
];

/**
 * Net worth day by day for the chart: each saved day in the range (oldest first), with today's
 * figure as it is now in place of today's snapshot. Returns { points: [{ date, pence }], from }.
 */
export function worthSeries({ snapshots, totalPence, todayDate, range = '6m' }) {
  const months = WORTH_RANGES.find((r) => r.id === range)?.months ?? null;
  const from = months === null ? null : addMonths(todayDate, -months);
  const points = snapshots
    .filter((s) => isLive(s) && s.date < todayDate && (from === null || s.date >= from))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((s) => ({ date: s.date, pence: s.gbpPence }));
  if (totalPence !== null && totalPence !== undefined) points.push({ date: todayDate, pence: totalPence });
  return { points, from: from ?? points[0]?.date ?? todayDate };
}

/**
 * An axis for values that needn't start at zero (a line): clean steps that cover min to max.
 * Returns { min, max, step, ticks }. A flat line gets room above and below it.
 */
export function rangeScale(minPence, maxPence, steps = 4) {
  let lo = Math.min(minPence, maxPence);
  let hi = Math.max(minPence, maxPence);
  if (hi === lo) {
    const pad = Math.max(Math.abs(hi) * 0.05, 10000);
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((x) => x >= raw);
  // Whole pounds at least, so the ticks read £1,500, never £1,512.37.
  const clean = Math.max(step, 100);
  const min = Math.floor(lo / clean) * clean;
  const max = Math.ceil(hi / clean) * clean;
  const ticks = [];
  for (let t = min; t <= max + clean / 2; t += clean) ticks.push(t);
  return { min, max, step: clean, ticks };
}
