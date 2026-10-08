// The data model. D1 (worker/schema.sql) is the source of truth; IndexedDB holds the last-synced
// copy with the same field names, plus device-only rows in `meta`.
//
// Every synced record has:
//   id         string   client UUID (server UUID for Shortcut and scheduled rows; stable ids for seeds)
//   updatedAt  number   ms timestamp of the last change
//   deletedAt  number?  ms timestamp; set means deleted (so Undo just clears it)
//   rev        number   server-wide change counter, for GET /sync?since=rev
// Money is integer minor units (see exponent() in src/engine/money.js). Dates are 'YYYY-MM-DD'.

export const DB_NAME = 'mateen-money';
export const DB_VERSION = 6;   // 2: budgets; 3: accounts and balances; 4: holdings, activity, snapshots; 5: people, splits, settlements; 6: transfers

/** Tables that sync from the backend. */
export const SYNCED = ['entries', 'vendors', 'aliases', 'categories', 'methods', 'recurring', 'trips', 'reviews', 'rates', 'settings', 'budgets', 'accounts', 'balances', 'holdings', 'activity', 'snapshots', 'people', 'splits', 'settlements', 'transfers'];

// store name -> { keyPath, indexes: { name: keyPath } }
export const STORES = {
  entries: { keyPath: 'id', indexes: { byDate: 'date' } },
  vendors: { keyPath: 'id', indexes: {} },
  aliases: { keyPath: 'id', indexes: {} },
  categories: { keyPath: 'id', indexes: {} },
  methods: { keyPath: 'id', indexes: {} },
  recurring: { keyPath: 'id', indexes: {} },
  trips: { keyPath: 'id', indexes: {} },
  reviews: { keyPath: 'id', indexes: {} },
  rates: { keyPath: 'id', indexes: {} },
  settings: { keyPath: 'id', indexes: {} },   // synced preferences: { id: key, value }
  budgets: { keyPath: 'id', indexes: {} },
  accounts: { keyPath: 'id', indexes: {} },
  balances: { keyPath: 'id', indexes: {} },
  holdings: { keyPath: 'id', indexes: {} },
  activity: { keyPath: 'id', indexes: {} },
  snapshots: { keyPath: 'id', indexes: {} },
  people: { keyPath: 'id', indexes: {} },
  splits: { keyPath: 'id', indexes: {} },
  settlements: { keyPath: 'id', indexes: {} },
  transfers: { keyPath: 'id', indexes: {} },
  meta: { keyPath: 'key', indexes: {} },      // device only: { key, value } (token, rev, lastSyncedAt, draft)
};

/**
 * @typedef {Object} Entry  A payment or income.
 * @property {string} id
 * @property {'spend'|'income'} kind
 * @property {string} date            'YYYY-MM-DD', local to where it happened
 * @property {string|null} time       'HH:MM' local wall-clock
 * @property {number|null} at         ms instant of the payment (duplicate check, ordering)
 * @property {number} amountMinor     original amount in minor units of currency
 * @property {string} currency        ISO code, e.g. 'SGD'
 * @property {number|null} gbpPence   GBP value including any fee; null until a rate exists
 * @property {number} feePence        the foreign-currency fee part of gbpPence
 * @property {number} feeBps          fee rate used, basis points (299 = 2.99%)
 * @property {number|null} rate       units of currency per £1 used
 * @property {'final'|'estimated'|'statement'} gbpStatus  'statement' = typed from the statement, never recalculated
 * @property {string|null} merchant   name as it arrived or was typed (kept so history reads right after renames)
 * @property {string|null} vendorId
 * @property {string|null} categoryId spend only; null = in "To sort"
 * @property {string|null} incomeType income only: allowance | cash | work | family | refund | other
 * @property {string|null} methodId   payment method
 * @property {string|null} note
 * @property {string|null} tripId
 * @property {0|1} tripManual         1 = the trip was set by hand, so date changes don't re-suggest it
 * @property {'manual'|'applepay'|'recurring'} source
 * @property {string|null} recurringId      set on rows added automatically
 * @property {string|null} occurrenceDate   with recurringId, unique: an occurrence is added once only
 * @property {string|null} spreadStart      'YYYY-MM' first month of a spread
 * @property {number} spreadMonths          1 = not spread; 12 = the yearly allowance
 * @property {0|1} needsCurrency      1 = ambiguous symbol, ask which currency in "To sort"
 * @property {string|null} symbol     the ambiguous symbol as it arrived ('$')
 * @property {string|null} card       Wallet card name as it arrived (for remembering symbols)
 * @property {string|null} paidBy     a person's id when they paid the whole bill (see src/engine/splits.js); null = you
 */

/**
 * @typedef {Object} Vendor  Vendor memory.
 * @property {string} id
 * @property {string} name
 * @property {string|null} categoryId
 * @property {string|null} currency
 * @property {string|null} methodId
 * @property {number} useCount
 * @property {0|1} userEdited
 */

/**
 * @typedef {Object} Alias  Another name a vendor arrives as.
 * @property {string} id
 * @property {string} vendorId
 * @property {string} alias       as it arrived ("PRET A MANGER #1234")
 * @property {string} aliasNorm   normaliseMerchant(alias); unique among live aliases
 */

/**
 * @typedef {Object} Category
 * @property {string} id      stable ('groceries'), or a UUID for ones you add
 * @property {string} name
 * @property {number} sort
 * @property {0|1} archived   kept so old entries still show their category
 */

/**
 * @typedef {Object} Method  A payment method.
 * @property {string} id
 * @property {string} name
 * @property {'card'|'cash'|'transfer'} kind
 * @property {number} feeBps                   foreign-currency fee, basis points
 * @property {string|null} walletCard          card name the Shortcut sends, matched case-insensitively
 * @property {Object<string,string>} symbolMemory  answers to ambiguous symbols, e.g. { '$': 'SGD' }
 * @property {string|null} accountId          the Net Worth account it draws from, or null
 */

/**
 * @typedef {Object} Recurring  A recurring cost or income.
 * @property {string} id
 * @property {'spend'|'income'} kind
 * @property {string} label
 * @property {number} amountMinor
 * @property {string} currency
 * @property {'weekly'|'monthly'|'termly'|'yearly'} frequency   termly = every 4 months
 * @property {string} nextDate      next occurrence not yet added
 * @property {number|null} anchorDay day of month to keep (31 comes back after February)
 * @property {string|null} categoryId
 * @property {string|null} vendorId
 * @property {string|null} incomeType
 * @property {string|null} methodId
 * @property {number} spreadMonths  12 for the yearly allowance
 * @property {0|1} active
 */

/**
 * @typedef {Object} Trip
 * @property {string} id
 * @property {string} name
 * @property {string} start   'YYYY-MM-DD'
 * @property {string} end     'YYYY-MM-DD', inclusive
 */

/**
 * @typedef {Object} Review  A completed weekly review.
 * @property {string} id         the weekStart
 * @property {string} weekStart  Monday, 'YYYY-MM-DD'
 * @property {number} completedAt
 */

/**
 * @typedef {Object} Rate  ECB rate from Frankfurter.
 * @property {string} id        `${forDate}:${currency}`
 * @property {string} forDate   the date asked for (weekends return Friday's rate)
 * @property {string} currency
 * @property {number} perGbp    units of currency per £1
 */

/**
 * Settings rows ({ id, value }):
 *   terms         [{ id, name, start, end }]  blank until entered
 *   yearMode      'calendar' | 'academic'
 *   excludeTrips  boolean (Overview toggle)
 */

/**
 * @typedef {Object} Budget  The monthly budget from fromMonth on (see src/engine/budgets.js).
 * @property {string} id           `month:${fromMonth}`
 * @property {string} categoryId   always 'month' (rows from the old per-category budgets are ignored)
 * @property {string} fromMonth    'YYYY-MM'; a month's budget is the latest row on or before it
 * @property {number} amountPence  GBP; 0 = no budget from this month
 */

/**
 * @typedef {Object} Account  Somewhere money is kept, for Net Worth (see src/engine/networth.js).
 * @property {string} id
 * @property {string} name
 * @property {'current'|'savings'|'investment'} kind
 * @property {string} currency   the currency its balance is typed in
 * @property {number} sort
 */

/**
 * @typedef {Object} Balance  An account's balance on a day, typed in by hand.
 * @property {string} id           `${accountId}:${date}`, so the same day again replaces it
 * @property {string} accountId
 * @property {string} date         'YYYY-MM-DD'
 * @property {number} amountMinor  may be below zero (an overdraft)
 * @property {string} currency     as typed; the account's currency at the time
 */

/**
 * @typedef {Object} Holding  One IBKR holding at the last Flex sync (see src/engine/holdings.js).
 * @property {string} id              `${accountId}:${conid}`
 * @property {string} accountId
 * @property {string} symbol          'ISDW'
 * @property {string} exchange        IBKR's listing exchange, 'LSEETF'
 * @property {string} quote           the ticker prices are fetched for, 'ISDW.L'
 * @property {string} name
 * @property {string} currency        the currency it trades in
 * @property {number} unitsMicro      units held, in millionths
 * @property {number|null} closeMicro price at the report's close, in millionths
 * @property {number} valueBaseMinor  value at that close, in the account's currency
 * @property {number} costBaseMinor   IBKR's cost basis, in the account's currency
 * @property {string} reportDate
 */

/**
 * @typedef {Object} Activity  An IBKR trade, dividend, tax, fee, deposit or withdrawal.
 * @property {string} id   `${accountId}:trade:${id}` / `${accountId}:cash:${id}`
 * @property {string} accountId
 * @property {string} date
 * @property {'buy'|'sell'|'dividend'|'tax'|'interest'|'fee'|'deposit'|'withdrawal'} type
 * @property {string|null} symbol
 * @property {number|null} unitsMicro
 * @property {number|null} priceMicro
 * @property {number} amountMinor  in currency; a withdrawal, tax or fee below zero
 * @property {string} currency
 */

/**
 * @typedef {Object} Snapshot  Net worth on a day, in GBP, for the chart.
 * @property {string} id      the date
 * @property {string} date
 * @property {number} gbpPence
 */

/**
 * Split payments (see src/engine/splits.js):
 *   people       { id, name, sort, archived }
 *   splits       { id, entryId, personId, amountMinor, currency, direction: 'owedToMe' | 'iOwe', settlementId }
 *   settlements  { id, personId, date, amountMinor, currency, direction: 'in' | 'out', accountId }
 */

/**
 * Moves between the user's own accounts ("moves" to the user; see carriedBalance in src/engine/networth.js):
 *   transfers    { id, date, fromAccountId, fromAmountMinor, fromCurrency, toAccountId, toAmountMinor, toCurrency }
 */
