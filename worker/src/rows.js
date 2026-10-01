// Saving and deleting rows other than entries (vendors, categories, methods, recurring, trips...),
// and the first-run seed.

import {
  normaliseMerchant, parse, checkTerms, validFeeBps, validTimeZone, retrip, DEFAULT_TIME_ZONE, DEFAULT_CATEGORIES, DEFAULT_METHODS, INCOME_TYPES, FREQUENCIES,
} from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { refuse } from './http.js';
import { validDate, validCurrency } from './entries.js';

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const METHOD_KINDS = new Set(['card', 'cash', 'transfer']);
const FREQUENCY_IDS = new Set(FREQUENCIES.map((f) => f.id));
const INCOME_IDS = new Set(INCOME_TYPES.map((t) => t.id));
const ONE_OFF_IDS = new Set(INCOME_TYPES.filter((t) => t.oneOff).map((t) => t.id));

// Settings the app writes, and what each may hold.
const SETTING_CHECKS = {
  terms: checkTerms,
  yearMode: (v) => (v === 'academic' || v === 'calendar' ? null : 'pick academic or calendar year.'),
  excludeTrips: (v) => (typeof v === 'boolean' ? null : 'choose on or off.'),
  timeZone: (v) => (validTimeZone(v) ? null : 'pick a time zone from the list.'),
};

function check(name, row) {
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

/** PUT /:table/:id: add a row, or change the fields sent (others are kept). */
export async function saveRow(ctx, name, id, body) {
  const { store } = ctx;
  const { fields, defaults } = TABLES[name];
  const existing = await store.get(name, id);
  const row = existing ? { ...existing } : { id, deletedAt: null, ...structuredClone(defaults) };
  for (const f of [...fields, 'deletedAt']) if (f in body) row[f] = body[f] ?? null;
  tidy(name, row);
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
  const problem = check(name, row);
  if (problem) throw refuse(problem);
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

/** DELETE /:table/:id: a soft delete, so Undo is a PUT with deletedAt: null. */
export async function deleteRow(ctx, name, id) {
  const row = await ctx.store.get(name, id);
  if (!row) throw refuse('that no longer exists.', 404);
  if ((name === 'vendors' || name === 'trips') && !row.deletedAt) return saveRow(ctx, name, id, { deletedAt: ctx.now });
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
