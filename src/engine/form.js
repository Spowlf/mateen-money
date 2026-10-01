// Rules for the Log form: the keypad, vendor memory, what clears after a save, and the lines it shows.

import { exponent } from './money.js';
import { normaliseMerchant } from './vendors.js';
import { formatDay, today, nowTime } from './dates.js';
import { INCOME_TYPES } from './defaults.js';

const MAX_DIGITS = 7;

/** The amount text after pressing a key ('0'–'9', '.', 'back'). Kept as text until saving. */
export function pressKey(amount, key, currency = 'GBP') {
  const a = amount ?? '';
  const e = exponent(currency);
  if (key === 'back') return a.slice(0, -1);
  if (key === '.') return e === 0 || a.includes('.') ? a : `${a || '0'}.`;
  if (!/^\d$/.test(key)) return a;
  const [, frac] = a.split('.');
  if (frac !== undefined && frac.length >= e) return a;
  if (a.replace('.', '').length >= MAX_DIGITS) return a;
  return a === '0' ? key : a + key;
}

/** Picking a vendor fills in what it remembers; gaps keep what the form has. */
export function applyVendor(form, vendor) {
  return {
    ...form,
    vendorId: vendor.id,
    vendorName: vendor.name,
    categoryId: vendor.categoryId ?? form.categoryId,
    currency: vendor.currency ?? form.currency,
    methodId: vendor.methodId ?? form.methodId,
  };
}

/** The form after a save: what won't repeat clears, what will (date, currency, method) stays. */
export function nextForm(form, { id, time }) {
  return {
    ...form,
    id,
    time,
    amount: '',
    vendorId: null,
    vendorName: '',
    categoryId: null,
    note: '',
    tripId: null,
    tripManual: false,
    spreadMonths: 1,
    spreadStart: null,
  };
}

/**
 * Vendors to offer as chips: most recently used first, then most used, then by name.
 * Typing filters them, names that start with the text first.
 */
export function vendorChoices(vendors, entries, query = '', n = 6) {
  const last = new Map();
  for (const e of entries) {
    if (e.deletedAt || !e.vendorId) continue;
    const key = `${e.date} ${String(e.at ?? 0).padStart(15, '0')}`;
    if (!last.has(e.vendorId) || key > last.get(e.vendorId)) last.set(e.vendorId, key);
  }
  const q = query.trim().toLowerCase();
  const rank = (v) => {
    if (!q) return 0;
    const name = v.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q) || normaliseMerchant(v.name).includes(normaliseMerchant(q) || q)) return 2;
    return -1;
  };
  return vendors
    .filter((v) => !v.deletedAt)
    .map((v) => ({ v, r: rank(v), last: last.get(v.id) ?? '' }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)
      || (b.v.useCount ?? 0) - (a.v.useCount ?? 0) || a.v.name.localeCompare(b.v.name))
    .slice(0, n)
    .map((x) => x.v);
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "PRET A MANGER #1234" → "Pret A Manger": a readable name for a new vendor. */
export function tidyName(merchant) {
  const norm = normaliseMerchant(merchant);
  if (!norm) return String(merchant ?? '').trim();
  return norm.split(' ').map(capitalise).join(' ');
}

/** "Last synced today at 14:05" or "Last synced 30 Sep 2026 at 09:00". */
export function syncedPhrase(ms, now = new Date()) {
  if (!ms) return 'Not synced yet';
  const d = new Date(ms);
  const day = today(d);
  return `Last synced ${day === today(now) ? 'today' : formatDay(day)} at ${nowTime(d)}`;
}

/** The one line under the keypad saying what else will be saved: "Food, on Card, today at 12:30". */
export function summaryLine(form, { categories = [], methods = [], accounts = [], trips = [], todayDate }) {
  const parts = [];
  if (form.kind === 'income') {
    const type = INCOME_TYPES.find((t) => t.id === form.incomeType);
    if (type) parts.push(type.name);
  } else {
    const category = categories.find((c) => c.id === form.categoryId);
    if (category) parts.push(category.name);
  }
  const method = form.kind !== 'income' && methods.find((m) => m.id === form.methodId);
  if (method) parts.push(`on ${method.name}`);
  const account = form.kind === 'income' && accounts.find((a) => a.id === form.accountId);
  if (account) parts.push(`into ${account.name}`);
  const day = form.date === todayDate ? 'today' : formatDay(form.date);
  parts.push(form.time ? `${day} at ${form.time}` : day);
  const trip = trips.find((t) => t.id === form.tripId);
  if (trip) parts.push(`${trip.name} trip`);
  if (form.kind === 'income' && form.spreadMonths > 1) parts.push(`spread over ${form.spreadMonths} months`);
  return capitalise(parts.join(', '));
}
