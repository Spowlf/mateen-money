// Seed data shared by the Worker (first run) and the app (empty states). Ids are stable; never reuse one.

export const DEFAULT_CATEGORIES = [
  ['delivery', 'Delivery'],
  ['societies', 'Events and Societies'],
  ['food', 'Food'],
  ['gifts', 'Gifts'],
  ['groceries', 'Groceries'],
  ['health', 'Health'],
  ['kelly', 'Kelly'],
  ['leisure', 'Leisure'],
  ['school', 'School'],
  ['snacks', 'Snacks'],
  ['subscriptions', 'Subscriptions'],
  ['transport', 'Transport'],
  ['travel', 'Travel'],
  ['utilities', 'Utilities'],
  ['other', 'Other'],
].map(([id, name], i) => ({ id, name, sort: i, archived: 0 }));

export const DEFAULT_METHODS = [
  { id: 'cash', name: 'Cash', kind: 'cash', feeBps: 0, walletCard: null, symbolMemory: {} },
  { id: 'card', name: 'Card', kind: 'card', feeBps: 0, walletCard: null, symbolMemory: {} },
  { id: 'transfer', name: 'Bank Transfer', kind: 'transfer', feeBps: 0, walletCard: null, symbolMemory: {} },
];

// oneOff: logged once on Log, never planned as a recurring item.
// "Cash I Already Had" lets spending before the allowance arrives count against real money.
export const INCOME_TYPES = [
  ['allowance', 'Allowance / Stipend'],
  ['cash', 'Cash I Already Had', true],
  ['work', 'Part-Time Work'],
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

// Where "today" is for the Worker (recurring items) and the review week, until Settings changes it.
export const DEFAULT_TIME_ZONE = 'Europe/London';

export const TERM_NAMES =['Michaelmas', 'Lent', 'Easter'];
