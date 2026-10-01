-- The Net Worth account an income entry went into, so that account's balance is carried on with
-- it. Run once on a database made before it:
--   npx wrangler d1 execute mateen-money --remote --file worker/migrations/003-income-accounts.sql
ALTER TABLE entries ADD COLUMN accountId TEXT;
