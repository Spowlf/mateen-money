// The synced tables' columns, as in worker/schema.sql (a test checks they match).
// required: fields a new row must have. json: columns stored as JSON text.
// clientWrites: false for tables only the Worker writes.

const SYSTEM = ['id', 'updatedAt', 'deletedAt', 'rev'];

// defaults: values a new row starts with (columns not listed start as null).
const table = (fields, { required = [], json = [], clientWrites = true, defaults = {} } = {}) => ({
  columns: [...SYSTEM, ...fields],
  fields,
  required,
  json,
  clientWrites,
  defaults,
});

export const TABLES = {
  entries: table([
    'kind', 'date', 'time', 'at', 'amountMinor', 'currency', 'gbpPence', 'feePence', 'feeBps', 'rate', 'gbpStatus',
    'merchant', 'vendorId', 'categoryId', 'incomeType', 'methodId', 'note', 'tripId', 'tripManual', 'source',
    'recurringId', 'occurrenceDate', 'spreadStart', 'spreadMonths', 'needsCurrency', 'symbol', 'card',
  ], {
    required: ['kind', 'date', 'amountMinor', 'currency'],
    defaults: { feePence: 0, feeBps: 0, gbpStatus: 'estimated', tripManual: 0, source: 'manual', spreadMonths: 1, needsCurrency: 0 },
  }),
  vendors: table(['name', 'categoryId', 'currency', 'methodId', 'useCount', 'userEdited'], { required: ['name'], defaults: { useCount: 0, userEdited: 0 } }),
  aliases: table(['vendorId', 'alias', 'aliasNorm'], { required: ['vendorId', 'alias'] }),
  categories: table(['name', 'sort', 'archived'], { required: ['name'], defaults: { sort: 0, archived: 0 } }),
  methods: table(['name', 'kind', 'feeBps', 'walletCard', 'symbolMemory'], {
    required: ['name'], json: ['symbolMemory'], defaults: { kind: 'card', feeBps: 0, symbolMemory: {} },
  }),
  recurring: table([
    'kind', 'label', 'amountMinor', 'currency', 'frequency', 'nextDate', 'anchorDay', 'categoryId', 'vendorId',
    'incomeType', 'methodId', 'spreadMonths', 'active',
  ], { required: ['kind', 'label', 'amountMinor', 'currency', 'frequency', 'nextDate'], defaults: { spreadMonths: 1, active: 1 } }),
  trips: table(['name', 'start', 'end'], { required: ['name', 'start', 'end'] }),
  reviews: table(['weekStart', 'completedAt'], { required: ['weekStart', 'completedAt'] }),
  rates: table(['forDate', 'currency', 'perGbp'], { clientWrites: false }),
  settings: table(['value'], { required: ['value'], json: ['value'] }),
  budgets: table(['categoryId', 'fromMonth', 'amountPence'], { required: ['categoryId', 'fromMonth', 'amountPence'] }),
  accounts: table(['name', 'kind', 'currency', 'sort'], { required: ['name', 'kind', 'currency'], defaults: { sort: 0 } }),
  balances: table(['accountId', 'date', 'amountMinor', 'currency'], { required: ['accountId', 'date', 'amountMinor', 'currency'] }),
};

/** A row as the API sends it: JSON columns parsed. */
export function fromDb(name, row) {
  if (!row) return row;
  const out = { ...row };
  for (const c of TABLES[name].json) out[c] = out[c] == null ? null : JSON.parse(out[c]);
  return out;
}
