// Frozen test data. Engine tests use these, never real config, so changing a default never breaks a maths test.

export const CATEGORIES = Object.freeze([
  { id: 'groceries', name: 'Groceries', sort: 0, archived: 0 },
  { id: 'eating-out', name: 'Eating out', sort: 1, archived: 0 },
  { id: 'coffee-snacks', name: 'Coffee and snacks', sort: 2, archived: 0 },
  { id: 'transport', name: 'Transport', sort: 3, archived: 0 },
  { id: 'travel', name: 'Travel', sort: 4, archived: 0 },
  { id: 'going-out', name: 'Going out', sort: 5, archived: 0 },
  { id: 'other', name: 'Other', sort: 6, archived: 0 },
].map(Object.freeze));

let n = 0;

/** A spend entry in GBP. */
export function spend(date, pence, categoryId = 'groceries', extra = {}) {
  n += 1;
  return {
    id: `s${n}`, kind: 'spend', date, time: '12:00', at: null, amountMinor: pence, currency: 'GBP',
    gbpPence: pence, feePence: 0, gbpStatus: 'final', merchant: 'Shop', vendorId: null, categoryId,
    tripId: null, spreadMonths: 1, spreadStart: null, deletedAt: null, ...extra,
  };
}

/** An income entry in GBP. */
export function income(date, pence, extra = {}) {
  n += 1;
  return {
    id: `i${n}`, kind: 'income', date, amountMinor: pence, currency: 'GBP', gbpPence: pence, gbpStatus: 'final',
    incomeType: 'other', spreadMonths: 1, spreadStart: null, deletedAt: null, ...extra,
  };
}
