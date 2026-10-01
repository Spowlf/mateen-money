-- Mateen Money: the D1 database. The single source of truth.
-- Field names match src/db/schema.js exactly (camelCase), so rows need no mapping.
-- Every synced row has updatedAt (ms), deletedAt (ms, null = live) and rev (the change counter
-- the phone pulls from: GET /sync?since=rev). Money is integer minor units; dates are 'YYYY-MM-DD'.
-- Apply with: npx wrangler d1 execute mateen-money --remote --file worker/schema.sql

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', 0);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('spend', 'income')),
  date TEXT NOT NULL,
  time TEXT,
  at INTEGER,
  amountMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  gbpPence INTEGER,
  feePence INTEGER NOT NULL DEFAULT 0,
  feeBps INTEGER NOT NULL DEFAULT 0,
  rate REAL,
  gbpStatus TEXT NOT NULL DEFAULT 'estimated' CHECK (gbpStatus IN ('final', 'estimated', 'statement')),
  merchant TEXT,
  vendorId TEXT,
  categoryId TEXT,
  incomeType TEXT,
  methodId TEXT,
  note TEXT,
  tripId TEXT,
  tripManual INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'applepay', 'recurring')),
  recurringId TEXT,
  occurrenceDate TEXT,
  spreadStart TEXT,
  spreadMonths INTEGER NOT NULL DEFAULT 1,
  needsCurrency INTEGER NOT NULL DEFAULT 0,
  symbol TEXT,
  card TEXT,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_rev ON entries (rev);
CREATE INDEX IF NOT EXISTS entries_date ON entries (date);
CREATE INDEX IF NOT EXISTS entries_at ON entries (at);
-- A recurring occurrence is added once only, even if the job runs twice at the same moment.
CREATE UNIQUE INDEX IF NOT EXISTS entries_occurrence ON entries (recurringId, occurrenceDate) WHERE recurringId IS NOT NULL;

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  categoryId TEXT,
  currency TEXT,
  methodId TEXT,
  useCount INTEGER NOT NULL DEFAULT 0,
  userEdited INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vendors_rev ON vendors (rev);

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  vendorId TEXT NOT NULL,
  alias TEXT NOT NULL,
  aliasNorm TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS aliases_rev ON aliases (rev);
CREATE UNIQUE INDEX IF NOT EXISTS aliases_live_norm ON aliases (aliasNorm) WHERE deletedAt IS NULL;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS categories_rev ON categories (rev);

CREATE TABLE IF NOT EXISTS methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'card' CHECK (kind IN ('card', 'cash', 'transfer')),
  feeBps INTEGER NOT NULL DEFAULT 0,
  walletCard TEXT,
  symbolMemory TEXT NOT NULL DEFAULT '{}', -- JSON: { "$": "SGD" }
  accountId TEXT, -- the Net Worth account it draws from (migrations/002)
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS methods_rev ON methods (rev);

CREATE TABLE IF NOT EXISTS recurring (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('spend', 'income')),
  label TEXT NOT NULL,
  amountMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'termly', 'yearly')),
  nextDate TEXT NOT NULL,
  anchorDay INTEGER,
  categoryId TEXT,
  vendorId TEXT,
  incomeType TEXT,
  methodId TEXT,
  spreadMonths INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recurring_rev ON recurring (rev);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trips_rev ON trips (rev);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  weekStart TEXT NOT NULL,
  completedAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_rev ON reviews (rev);

-- ECB rates from Frankfurter, units of currency per £1. Written by the Worker only.
CREATE TABLE IF NOT EXISTS rates (
  id TEXT PRIMARY KEY, -- forDate:currency
  forDate TEXT NOT NULL,
  currency TEXT NOT NULL,
  perGbp REAL NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rates_rev ON rates (rev);

-- Synced preferences: terms, yearMode, excludeTrips. value is JSON.
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS settings_rev ON settings (rev);

-- The monthly budget: a row sets it from fromMonth on, so earlier months keep theirs.
-- id is categoryId:fromMonth, categoryId always 'month' (older per-category rows are ignored).
-- amountPence 0 = no budget from that month.
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  categoryId TEXT NOT NULL,
  fromMonth TEXT NOT NULL,
  amountPence INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS budgets_rev ON budgets (rev);

-- Net worth: accounts and their balances, typed in by hand. Nothing here touches spending.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('current', 'savings', 'investment')),
  currency TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_rev ON accounts (rev);

-- One balance per account per day (id is accountId:date), in the currency it was typed in.
-- The latest live one is the account's balance.
CREATE TABLE IF NOT EXISTS balances (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  date TEXT NOT NULL,
  amountMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS balances_rev ON balances (rev);

-- IBKR's holdings, replaced by each nightly Flex sync. Written by the Worker only. Units and prices
-- are integer millionths; value and cost are at the report's close, in the account's currency.
-- quote is the ticker prices are fetched for ('ISDW.L').
CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY, -- accountId:conid
  accountId TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT,
  quote TEXT NOT NULL,
  name TEXT,
  currency TEXT NOT NULL,
  unitsMicro INTEGER NOT NULL,
  closeMicro INTEGER,
  valueBaseMinor INTEGER NOT NULL DEFAULT 0,
  costBaseMinor INTEGER NOT NULL DEFAULT 0,
  reportDate TEXT,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS holdings_rev ON holdings (rev);

-- IBKR's trades, dividends and deposits, each added once (id from IBKR). Written by the Worker only.
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, -- accountId:trade:<id> / accountId:cash:<id>
  accountId TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  symbol TEXT,
  unitsMicro INTEGER,
  priceMicro INTEGER,
  amountMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_rev ON activity (rev);

-- Net worth in GBP, one row a day (id is the date), for the chart. Written by the Worker only.
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  gbpPence INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_rev ON snapshots (rev);

-- The latest price per ticker. Not synced (outside rev): a price tick isn't a data change.
-- The phone reads it with GET /prices.
CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY, -- the ticker, as holdings.quote
  currency TEXT NOT NULL,
  priceMicro INTEGER NOT NULL,
  prevCloseMicro INTEGER,
  quoteAt INTEGER,
  fetchedAt INTEGER NOT NULL
);
