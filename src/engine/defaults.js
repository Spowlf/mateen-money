// Seed data shared by the Worker (first run) and the app (empty states). Ids are stable; never reuse one.

export const DEFAULT_CATEGORIES = [
  ['groceries', 'Groceries'],
  ['eating-out', 'Eating out'],
  ['coffee-snacks', 'Coffee and snacks'],
  ['takeaway', 'Takeaway and delivery'],
  ['transport', 'Transport'],
  ['travel', 'Travel'],
  ['rent-bills', 'Rent and college bills'],
  ['phone-utilities', 'Phone and utilities'],
  ['books', 'Books and course materials'],
  ['societies', 'Societies and events'],
  ['going-out', 'Going out'],
  ['shopping', 'Shopping'],
  ['health', 'Health and personal care'],
  ['subscriptions', 'Subscriptions'],
  ['gifts', 'Gifts'],
  ['other', 'Other'],
].map(([id, name], i) => ({ id, name, sort: i, archived: 0 }));

export const DEFAULT_METHODS = [
  { id: 'cash', name: 'Cash', kind: 'cash', feeBps: 0, walletCard: null, symbolMemory: {} },
  { id: 'card', name: 'Card', kind: 'card', feeBps: 0, walletCard: null, symbolMemory: {} },
  { id: 'transfer', name: 'Bank transfer', kind: 'transfer', feeBps: 0, walletCard: null, symbolMemory: {} },
];

// oneOff: logged once on Log, never planned as a recurring item.
// "Cash I already had" lets spending before the allowance arrives count against real money.
export const INCOME_TYPES = [
  ['allowance', 'Allowance / stipend'],
  ['cash', 'Cash I already had', true],
  ['work', 'Part-time work'],
  ['family', 'Family'],
  ['refund', 'Refund'],
  ['other', 'Other'],
].map(([id, name, oneOff = false]) => ({ id, name, oneOff }));

export const FREQUENCIES = [
  ['weekly', 'Every week'],
  ['monthly', 'Every month'],
  ['termly', 'Every term'],
  ['yearly', 'Every year'],
].map(([id, name]) => ({ id, name }));

export const TERM_NAMES = ['Michaelmas', 'Lent', 'Easter'];
