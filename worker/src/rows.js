// Saving and deleting rows other than entries (vendors, categories, methods, recurring, trips...),
// and the first-run seed.

import {
  normaliseMerchant, parse, checkTerms, validFeeBps, validTimeZone, retrip, balanceId, DEFAULT_TIME_ZONE, DEFAULT_CATEGORIES, DEFAULT_METHODS, INCOME_TYPES, FREQUENCIES, ACCOUNT_KINDS,
} from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { refuse } from './http.js';
import { validDate, validCurrency } from './entries.js';
import { ensureRates } from './rates.js';
import { personInUse } from './splits.js';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const METHOD_KINDS = new Set(['card', 'cash', 'transfer']);
const FREQUENCY_IDS = new Set(FREQUENCIES.map((f) => f.id));
const INCOME_IDS = new Set(INCOME_TYPES.map((t) => t.id));
const ONE_OFF_IDS = new Set(INCOME_TYPES.filter((t) => t.oneOff).map((t) => t.id));
const ACCOUNT_KIND_IDS = new Set(ACCOUNT_KINDS.map((k) => k.id));

// Settings the app writes, and what each may hold.
const SETTING_CHECKS = {
  terms: checkTerms,
  yearMode: (v) => (v === 'academic' || v === 'calendar' ? null : 'pick academic or calendar year.'),
  excludeTrips: (v) => (typeof v === 'boolean' ? null : 'choose on or off.'),
  timeZone: (v) => (validTimeZone(v) ? null : 'pick a time zone from the list.'),
};

function check(name, row, today) {
  if (row.deletedAt) return null;
  if (TABLES[name].required.some((f) => blank(row[f]))) return 'fill in every field.';
  if (name === 'trips' && (!validDate(row.start) || !validDate(row.end))) return 'pick the dates.';
  if (name === 'trips' && row.end < row.start) return 'end the trip on or after its first day.';
  if (name === 'methods') {
    if (!METHOD_KINDS.has(row.kind)) return 'pick Card, Cash or Bank Transfer.';
    if (!validFeeBps(row.feeBps)) return 'enter a fee from 0 to 100%.';
  }
  if (name === 'recurring') {
    if (row.kind !== 'spend' && row.kind !== 'income') return 'choose a cost or income.';
    if (!FREQUENCY_IDS.has(row.frequency)) return 'pick how often.';
    if (!validDate(row.nextDate)) return 'pick the next date.';
    if (!Number.isInteger(row.amountMinor) || row.amountMinor <= 0) return 'enter an amount above zero.';
    if (!validCurrency(row.currency)) return 'pick a currency.';
    if (row.kind === 'income' && !INCOME_IDS.has(row.incomeType)) return 'pick a type of income.';
    if (row.kind === 'income' && ONE_OFF_IDS.has(row.incomeType)) return 'log existing cash once, on the Log screen.';
    if (!Number.isInteger(row.spreadMonths) || row.spreadMonths < 1 || row.spreadMonths > 24) return 'spread it over 1 to 24 months.';
  }
  if (name === 'budgets') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.fromMonth) || row.id !== `${row.categoryId}:${row.fromMonth}`) return 'pick the month it starts.';
    if (!Number.isInteger(row.amountPence) || row.amountPence < 0) return 'enter a budget of £0.00 or more.';
  }
  if (name === 'settings' && SETTING_CHECKS[row.id]) return SETTING_CHECKS[row.id](row.value);
  if (name === 'accounts') {
    if (!ACCOUNT_KIND_IDS.has(row.kind)) return 'pick Current Account, Savings or Investments.';
    if (!validCurrency(row.currency)) return 'pick a currency.';
  }
  if (name === 'balances') {
    if (!validDate(row.date) || row.id !== balanceId(row.accountId, row.date)) return 'pick the date of the balance.';
    if (row.date > today) return 'pick today or an earlier day.';
    if (!Number.isInteger(row.amountMinor)) return 'enter the balance.';
    if (!validCurrency(row.currency)) return 'pick a currency.';
  }
  if (name === 'transfers') {
    if (row.fromAccountId === row.toAccountId) return 'pick two different accounts.';
    const amounts = [row.fromAmountMinor, row.toAmountMinor];
    if (amounts.some((a) => !Number.isInteger(a) || a <= 0)) return 'enter an amount above zero.';
    if (!validCurrency(row.fromCurrency) || !validCurrency(row.toCurrency)) return 'pick a currency.';
    if (!validDate(row.date) || row.date > today) return 'pick a date up to today.';
  }
  return null;
}

/** Names are stored without stray spaces. */
function tidy(name, row) {
  for (const f of ['name', 'label', 'alias', 'walletCard']) if (typeof row[f] === 'string') row[f] = row[f].trim();
  if (name === 'methods' && row.walletCard === '') row.walletCard = null;
  if (name === 'recurring') {
    if (row.kind === 'income') row.categoryId = null;
    else { row.incomeType = null; row.spreadMonths = 1; }
  }
}

/** The stored row with the fields sent laid over it (a new row starts from the table's defaults). */
async function merged(store, name, id, body) {
  const { fields, defaults } = TABLES[name];
  const existing = await store.get(name, id);
  const row = existing ? { ...existing } : { id, deletedAt: null, ...structuredClone(defaults) };
  for (const f of [...fields, 'deletedAt']) if (f in body) row[f] = body[f] ?? null;
  tidy(name, row);
  return { existing, row };
}

/** PUT /:table/:id: add a row, or change the fields sent (others are kept). */
export async function saveRow(ctx, name, id, body) {
  if (BATCH_TABLES.includes(name)) return saveBatch(ctx, { [name]: [{ ...body, id }] });
  const { store } = ctx;
  const { existing, row } = await merged(store, name, id, body);
  const writes = { [name]: [row] };

  if (name === 'vendors') {
    row.userEdited = 1;
    writes.aliases = await vendorAliases(store, existing, row, ctx.now);
  }
  if (name === 'aliases') {
    row.aliasNorm = normaliseMerchant(row.alias);
    if (!row.aliasNorm) throw refuse('enter a name with letters in it.');
    const clash = !row.deletedAt && (await store.all('aliases', 'deletedAt IS NULL AND aliasNorm = ? AND id != ?', row.aliasNorm, id)).length;
    if (clash) throw refuse('that name already belongs to another merchant.', 409);
  }
  if (name === 'recurring' && row.anchorDay == null && row.frequency !== 'weekly' && validDate(row.nextDate)) {
    row.anchorDay = parse(row.nextDate)[2];
  }
  const problem = check(name, row, ctx.today);
  if (problem) throw refuse(problem);
  if (name === 'people' && (row.archived || row.deletedAt) && !(existing?.archived || existing?.deletedAt)) {
    const busy = await personInUse(store, id);
    if (busy) throw refuse(busy, 409);
  }
  // A move names two live accounts (a deleted account's old moves can still be deleted).
  if (name === 'transfers' && !row.deletedAt) {
    for (const accountId of [row.fromAccountId, row.toAccountId]) {
      const account = await store.get('accounts', accountId);
      if (!account || account.deletedAt) throw refuse('that account was deleted.');
    }
  }
  if (name === 'trips') writes.entries = await tripEntries(store, existing, row);
  return store.write(writes, ctx.now);
}

/**
 * Payments that move when a trip is added, redated, deleted or brought back: those on its
 * days join it, those no longer on them leave. Ones whose trip was set by hand never move.
 */
async function tripEntries(store, before, after) {
  const same = before && before.start === after.start && before.end === after.end && !before.deletedAt === !after.deletedAt;
  if (same) return [];
  const trips = (await store.live('trips')).filter((t) => t.id !== after.id).concat(after);
  const candidates = await store.all('entries', "deletedAt IS NULL AND tripManual = 0 AND kind = 'spend'");
  return retrip(candidates, trips);
}

/**
 * Alias changes that go with a vendor edit:
 * - renamed: the old name becomes an alias, so payments still arriving under it are filed;
 * - deleted: its aliases go too, freeing the names for another vendor;
 * - brought back: the aliases deleted with it come back.
 */
async function vendorAliases(store, before, after, now) {
  if (!before) return [];
  const own = await store.all('aliases', 'vendorId = ?', after.id);
  if (after.deletedAt && !before.deletedAt) return own.filter((a) => !a.deletedAt).map((a) => ({ ...a, deletedAt: now }));
  if (!after.deletedAt && before.deletedAt) return own.filter((a) => a.deletedAt === before.deletedAt).map((a) => ({ ...a, deletedAt: null }));
  const oldNorm = normaliseMerchant(before.name);
  const newNorm = normaliseMerchant(after.name);
  if (after.deletedAt || !oldNorm || oldNorm === newNorm) return [];
  // An alias that is now the vendor's own name has nothing left to do.
  const out = own.filter((a) => !a.deletedAt && a.aliasNorm === newNorm).map((a) => ({ ...a, deletedAt: now }));
  const taken = await store.all('aliases', 'deletedAt IS NULL AND aliasNorm = ?', oldNorm);
  if (!taken.length) out.push({ id: crypto.randomUUID(), vendorId: after.id, alias: before.name, aliasNorm: oldNorm, deletedAt: null });
  return out;
}

/** Tables saved through saveBatch, so a balance and its new account land together. */
export const BATCH_TABLES = ['accounts', 'balances'];
// saveBatch also takes methods, so an account and the cards linked to it are saved together.
const BATCH_BODY = [...BATCH_TABLES, 'methods'];

/**
 * POST /batch { accounts?: [row], balances?: [row], methods?: [row] }: accounts, balances and the
 * cards linked to them in one write, all or nothing ("Update balances" saves every account at once). Each row has its id and the fields to
 * change. A live balance needs a live account in its own currency. Fetches a rate for a currency
 * that has none, so the total can count it straight away.
 */
export async function saveBatch(ctx, body) {
  const { store } = ctx;
  const writes = {};
  for (const name of BATCH_BODY) {
    const sent = body?.[name] ?? [];
    if (!Array.isArray(sent)) throw refuse('send a list of rows.');
    writes[name] = [];
    for (const b of sent) {
      if (!b || typeof b.id !== 'string' || !b.id) throw refuse('send each row with its id.');
      const { row } = await merged(store, name, b.id, b);
      const problem = check(name, row, ctx.today);
      if (problem) throw refuse(problem);
      writes[name].push(row);
    }
  }
  for (const b of writes.balances.filter((r) => !r.deletedAt)) {
    const account = writes.accounts.find((a) => a.id === b.accountId) ?? await store.get('accounts', b.accountId);
    if (!account || account.deletedAt) throw refuse('add the account first.');
    if (account.currency !== b.currency) throw refuse(`enter the balance in ${account.currency}, the account’s currency.`);
  }
  for (const m of writes.methods.filter((r) => !r.deletedAt && r.accountId)) {
    const account = writes.accounts.find((a) => a.id === m.accountId) ?? await store.get('accounts', m.accountId);
    if (!account || account.deletedAt) throw refuse('link the card to an account that exists.');
  }
  const needs = writes.balances.filter((b) => !b.deletedAt).map((b) => ({ currency: b.currency, date: ctx.today }));
  const got = await ensureRates({ fetch: ctx.fetch, rates: await store.live('rates'), needs, today: ctx.today });
  return store.write({ ...writes, rates: got.fresh }, ctx.now);
}

/** DELETE /:table/:id: a soft delete, so Undo is a PUT with deletedAt: null. */
export async function deleteRow(ctx, name, id) {
  const row = await ctx.store.get(name, id);
  if (!row) throw refuse('that no longer exists.', 404);
  if ((name === 'vendors' || name === 'trips' || name === 'people') && !row.deletedAt) return saveRow(ctx, name, id, { deletedAt: ctx.now });
  return ctx.store.write({ [name]: [{ ...row, deletedAt: row.deletedAt ?? ctx.now }] }, ctx.now);
}

/** Default categories, payment methods and settings, written once. Never overwrites an edit. */
export async function ensureSeeded(store, now) {
  if (await store.getMeta('seeded')) return;
  const live = (row) => ({ ...row, deletedAt: null });
  await store.write({
    categories: DEFAULT_CATEGORIES.map(live),
    methods: DEFAULT_METHODS.map(live),
    settings: [
      { id: 'terms', value: [] },   // blank until entered, per year (see terms.js)
      { id: 'yearMode', value: 'academic' },
      { id: 'excludeTrips', value: false },
      { id: 'timeZone', value: DEFAULT_TIME_ZONE },
    ].map(live),
  }, now, { insertOnly: ['categories', 'methods', 'settings'] });
  await store.setMeta('seeded', 1);
}
