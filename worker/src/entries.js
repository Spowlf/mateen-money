// Saving entries: from the Log form, from "To sort", and from the Apple Pay Shortcut.
// The Worker prices every entry, since it holds the rates, and keeps vendor memory up to date.
// ctx is { store, now, today, fetch, timeZone }.

import {
  priceEntry, resolveCurrency, parseAmountText, toMinor, toDecimalText, formatMoney, gbp,
  matchVendor, normaliseMerchant, findDuplicate, DUPLICATE_WINDOW_MS, tripFor,
  defaultSpreadStart, partsFromIso, partsInZone, INCOME_TYPES,
} from '../../src/engine/index.js';
import { TABLES } from './tables.js';
import { ensureRates } from './rates.js';
import { refuse } from './http.js';

const ENTRY_DEFAULTS = Object.fromEntries(TABLES.entries.columns.map((c) => [c, TABLES.entries.defaults[c] ?? null]));

// Fields the app may set. The rest (GBP value, rev, source...) belong to the Worker.
const CLIENT_FIELDS = ['kind', 'date', 'time', 'at', 'amountMinor', 'currency', 'merchant', 'vendorId', 'categoryId',
  'incomeType', 'methodId', 'note', 'tripId', 'tripManual', 'spreadStart', 'spreadMonths', 'needsCurrency', 'deletedAt'];

const INCOME_IDS = new Set(INCOME_TYPES.map((t) => t.id));
const isInt = (n) => Number.isInteger(n);

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === date;
}

export const validCurrency = (c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);

function checkEntry(e) {
  if (e.kind !== 'spend' && e.kind !== 'income') return 'choose spending or income.';
  if (!isInt(e.amountMinor) || e.amountMinor <= 0) return 'enter an amount above zero.';
  if (!validDate(e.date)) return 'pick a date.';
  if (e.time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) return 'pick a time.';
  if (!validCurrency(e.currency)) return 'pick a currency.';
  if (e.kind === 'income' && !INCOME_IDS.has(e.incomeType)) return 'pick a type of income.';
  if (e.gbpStatus === 'statement' && (!isInt(e.gbpPence) || e.gbpPence < 0)) return 'enter the amount from your statement.';
  if (!isInt(e.spreadMonths) || e.spreadMonths < 1 || e.spreadMonths > 24) return 'spread it over 1 to 24 months.';
  return null;
}

const same = (a, b) => Object.keys(b).every((k) => JSON.stringify(a?.[k]) === JSON.stringify(b[k]));

const newVendor = (name, extra = {}) => ({
  id: crypto.randomUUID(), name, categoryId: null, currency: null, methodId: null, useCount: 0, userEdited: 0, deletedAt: null, ...extra,
});

/** Fetches any rates the entries need, then prices them with their payment method's fee. */
async function price(ctx, entries, methods, rates) {
  const needs = entries.filter((e) => e.gbpStatus !== 'statement').map((e) => ({ currency: e.currency, date: e.date }));
  const got = await ensureRates({ fetch: ctx.fetch, rates, needs, today: ctx.today });
  const priced = entries.map((e) => {
    const feeBps = methods.find((m) => m.id === e.methodId)?.feeBps ?? 0;
    return priceEntry(e, { rates: got.rates, feeBps, todayDate: ctx.today });
  });
  return { priced, freshRates: got.fresh };
}

function suggestTripFor(e, trips) {
  return { ...e, tripId: tripFor(e, trips) };
}

/** PUT /entries/:id: add or edit an entry from the app. */
export async function saveEntry(ctx, id, body) {
  const { store } = ctx;
  const existing = await store.get('entries', id);
  const e = { ...ENTRY_DEFAULTS, ...existing, id };
  for (const f of CLIENT_FIELDS) if (f in body) e[f] = body[f] ?? null;
  e.tripManual = e.tripManual ? 1 : 0;
  e.needsCurrency = e.needsCurrency ? 1 : 0;
  e.spreadMonths = e.spreadMonths ?? 1;

  // A statement amount is kept until the app asks to recalculate.
  if (body.gbpStatus === 'statement') {
    e.gbpStatus = 'statement';
    e.gbpPence = body.gbpPence ?? null;
    e.feePence = 0;
  } else if ('gbpStatus' in body || !existing) {
    e.gbpStatus = 'estimated';
  }

  if (e.kind === 'income') {
    e.categoryId = null;
    e.vendorId = null;
  } else {
    e.incomeType = null;
    e.spreadMonths = 1;
    e.spreadStart = null;
  }
  const problem = checkEntry(e);
  if (problem) throw refuse(problem);
  if (e.spreadMonths > 1 && !e.spreadStart) e.spreadStart = defaultSpreadStart(e.date, e);
  if (e.spreadMonths === 1) e.spreadStart = null;

  const [vendors, aliases, methods, trips, rates] = await Promise.all(
    ['vendors', 'aliases', 'methods', 'trips', 'rates'].map((t) => store.live(t)),
  );

  // Vendor memory: category, currency and payment method, as last used.
  const writes = { entries: [], vendors: [] };
  const merchant = e.merchant?.trim() || null;
  e.merchant = merchant;
  if (e.kind === 'spend' && merchant && !e.deletedAt) {
    const found = (e.vendorId && vendors.find((v) => v.id === e.vendorId)) || matchVendor(merchant, vendors, aliases).exact;
    const vendor = { ...(found ?? newVendor(merchant)) };
    // A new payment teaches the vendor its choices. An edit teaches only what was changed,
    // so fixing a note on an old payment never brings back an old category.
    const edit = existing && !existing.deletedAt && existing.vendorId === vendor.id;
    if (e.categoryId) {
      for (const f of ['categoryId', 'currency', 'methodId']) if (!edit || existing[f] !== e[f]) vendor[f] = e[f];
    }
    if (!existing) vendor.useCount = (vendor.useCount ?? 0) + 1;
    e.vendorId = vendor.id;
    if (!found || !same(found, vendor)) writes.vendors.push(vendor);
  }

  const { priced: [entry], freshRates } = await price(ctx, [suggestTripFor(e, trips)], methods, rates);
  writes.entries.push(entry);
  writes.rates = freshRates;
  return store.write(writes, ctx.now);
}

/** POST /entries/:id/sort: file a To sort entry under a vendor or category, or answer its currency. */
export async function sortEntry(ctx, id, body) {
  const { store } = ctx;
  let e = await store.get('entries', id);
  if (!e || e.deletedAt) throw refuse('that payment no longer exists.', 404);
  if (!body.vendorId && !body.categoryId && !body.currency) throw refuse('pick a vendor or a category.');
  if (body.currency && !validCurrency(body.currency)) throw refuse('pick a currency.');

  const [vendors, aliases, methods, rates, entries] = await Promise.all(
    ['vendors', 'aliases', 'methods', 'rates', 'entries'].map((t) => store.live(t)),
  );
  const writes = { entries: [], vendors: [], aliases: [], methods: [] };

  // The currency answer: re-read the amount as that currency, and remember it for this card.
  if (body.currency) {
    const text = toDecimalText(e.amountMinor, e.currency);
    e = { ...e, currency: body.currency, amountMinor: toMinor(text, body.currency), needsCurrency: 0 };
    const method = methods.find((m) => m.id === e.methodId);
    if (method && e.symbol) writes.methods.push({ ...method, symbolMemory: { ...method.symbolMemory, [e.symbol]: body.currency } });
  }

  let vendor = null;
  if (body.vendorId) {
    vendor = vendors.find((v) => v.id === body.vendorId);
    if (!vendor) throw refuse('that vendor no longer exists.');
    vendor = { ...vendor };
  } else if (body.categoryId) {
    const name = body.vendorName?.trim() || e.merchant || 'Unknown';
    vendor = matchVendor(name, vendors, aliases).exact ?? newVendor(name, { currency: e.currency, methodId: e.methodId });
    vendor = { ...vendor };
  }

  const sorted = [e];
  if (vendor) {
    if (body.categoryId) vendor.categoryId = body.categoryId;
    const norm = normaliseMerchant(e.merchant);
    // The merchant name as it arrived becomes an alias, so the next payment sorts itself.
    if (norm && norm !== normaliseMerchant(vendor.name) && !aliases.some((a) => a.aliasNorm === norm)) {
      writes.aliases.push({ id: crypto.randomUUID(), vendorId: vendor.id, alias: e.merchant, aliasNorm: norm, deletedAt: null });
    }
    // Other payments from the same merchant waiting in To sort go with it.
    if (norm && vendor.categoryId) {
      for (const other of entries) {
        if (other.id !== e.id && other.kind === 'spend' && other.categoryId == null && !other.needsCurrency
          && normaliseMerchant(other.merchant) === norm) sorted.push(other);
      }
    }
    for (let i = 0; i < sorted.length; i++) {
      sorted[i] = { ...sorted[i], vendorId: vendor.id, categoryId: body.categoryId ?? vendor.categoryId };
    }
    vendor.useCount = (vendor.useCount ?? 0) + sorted.length;
    writes.vendors.push(vendor);
  }

  const { priced, freshRates } = await price(ctx, sorted, writes.methods.length ? writes.methods.concat(methods) : methods, rates);
  writes.entries = priced;
  writes.rates = freshRates;
  return store.write(writes, ctx.now);
}

const label = (entry, vendors) => vendors.find((v) => v.id === entry.vendorId)?.name ?? entry.merchant;

/**
 * POST /applepay: { amount, merchant, card, timestamp } from the Shortcut.
 * Returns the one line the Shortcut shows as a notification.
 */
export async function ingestApplePay(ctx, body) {
  const { store } = ctx;
  const parsed = parseAmountText(body?.amount);
  const merchant = typeof body?.merchant === 'string' ? body.merchant.trim() : '';
  if (!parsed) throw refuse('send the amount as text, like £4.20.');
  if (!merchant) throw refuse('send the merchant name from the Shortcut.');
  const card = typeof body.card === 'string' && body.card.trim() ? body.card.trim() : null;

  const [vendors, aliases, methods, trips, rates, categories] = await Promise.all(
    ['vendors', 'aliases', 'methods', 'trips', 'rates', 'categories'].map((t) => store.live(t)),
  );
  const writes = { entries: [], vendors: [], methods: [] };

  // The Wallet card becomes a payment method the first time it's seen.
  let method = card ? methods.find((m) => m.walletCard?.toLowerCase() === card.toLowerCase()) : null;
  if (card && !method) {
    method = { id: crypto.randomUUID(), name: card, kind: 'card', feeBps: 0, walletCard: card, symbolMemory: {}, deletedAt: null };
    writes.methods.push(method);
  }

  const { currency, ambiguous } = resolveCurrency({ symbol: parsed.symbol, code: parsed.code, symbolMemory: method?.symbolMemory ?? {} });
  const amountMinor = toMinor(parsed.value, currency);
  if (!amountMinor) throw refuse('send the amount as text, like £4.20.');
  const when = partsFromIso(body.timestamp) ?? partsInZone(ctx.now, ctx.timeZone);

  const nearby = await store.all('entries', 'deletedAt IS NULL AND at BETWEEN ? AND ?', when.at - DUPLICATE_WINDOW_MS, when.at + DUPLICATE_WINDOW_MS);
  const dup = findDuplicate({ amountMinor, currency, merchant, at: when.at }, nearby);
  if (dup) return `Already logged: ${formatMoney(amountMinor, currency)} at ${label(dup, vendors)}.`;

  const refund = parsed.negative;
  let e = {
    ...ENTRY_DEFAULTS,
    id: crypto.randomUUID(),
    kind: refund ? 'income' : 'spend',
    incomeType: refund ? 'refund' : null,
    date: when.date,
    time: when.time,
    at: when.at,
    amountMinor,
    currency,
    merchant,
    methodId: method?.id ?? null,
    source: 'applepay',
    needsCurrency: ambiguous ? 1 : 0,
    symbol: parsed.symbol,
    card,
  };

  // A known vendor (exact name or alias) is applied; a similar one is only suggested in the app.
  const vendor = refund ? null : matchVendor(merchant, vendors, aliases).exact;
  if (vendor) {
    e.vendorId = vendor.id;
    e.categoryId = vendor.categoryId;
    writes.vendors.push({ ...vendor, useCount: (vendor.useCount ?? 0) + 1 });
  }

  const { priced, freshRates } = await price(ctx, [suggestTripFor(e, trips)], writes.methods.concat(methods), rates);
  e = priced[0];
  writes.entries.push(e);
  writes.rates = freshRates;
  await store.write(writes, ctx.now);

  const money = formatMoney(amountMinor, currency);
  const inGbp = currency !== 'GBP' && e.gbpPence != null ? `, ~${gbp(e.gbpPence)}` : '';
  if (refund) return `Refund of ${money} from ${merchant}${inGbp}`;
  if (!vendor) return ambiguous ? 'New vendor: add a category and currency in the app.' : 'New vendor: add a category in the app.';
  const category = categories.find((c) => c.id === vendor.categoryId);
  if (!category) return `${money} at ${vendor.name}. Add a category in the app.`;
  const line = `${money} at ${vendor.name}, ${category.name}${inGbp}`;
  return ambiguous ? `${line}. Check the currency in the app.` : line;
}
