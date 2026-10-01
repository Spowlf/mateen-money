// The Log form's state (also the shape of the offline draft) and turning it into an entry.

import { toMinor } from './money.js';

/** A blank form. Things likely to repeat (currency, method, date) come from defaults. */
export function emptyForm({ id = null, date, time, currency = 'GBP', methodId = null, kind = 'spend' } = {}) {
  return {
    // Chosen when the form starts, so retrying a save that did reach the server updates it instead of adding a copy.
    id,
    kind,
    amount: '',
    currency,
    vendorName: '',
    vendorId: null,
    categoryId: null,
    incomeType: null,
    methodId,
    date,
    time,
    note: '',
    tripId: null,
    tripManual: false,
    spreadMonths: 1,
    spreadStart: null,
  };
}

/** Nothing worth keeping has been typed. */
export const isBlank = (form) => !form || (!form.amount && !form.vendorName?.trim() && !form.note?.trim());

/** What's still missing, as the Save button's label, or null when the form can be saved. */
export function missing(form) {
  const minor = toMinor(form.amount, form.currency);
  if (!minor) return 'Enter an amount';
  if (form.kind === 'income') return form.incomeType ? null : 'Pick a type of income';
  if (!form.vendorName?.trim()) return 'Pick a merchant';
  if (!form.categoryId) return 'Pick a category';
  return null;
}

/** The entry to send. GBP fields are filled in by the backend, which holds the rates. */
export function formToEntry(form, { id, now = Date.now() }) {
  const income = form.kind === 'income';
  return {
    id,
    kind: form.kind,
    date: form.date,
    time: form.time || null,
    at: now,
    amountMinor: toMinor(form.amount, form.currency),
    currency: form.currency,
    merchant: form.vendorName?.trim() || null,
    vendorId: form.vendorId,
    categoryId: income ? null : form.categoryId,
    incomeType: income ? form.incomeType : null,
    // Income isn't paid with anything.
    methodId: income ? null : form.methodId,
    note: form.note?.trim() || null,
    tripId: form.tripId,
    tripManual: form.tripManual ? 1 : 0,
    source: 'manual',
    spreadMonths: income && form.spreadMonths > 1 ? form.spreadMonths : 1,
    spreadStart: income && form.spreadMonths > 1 ? form.spreadStart : null,
  };
}
