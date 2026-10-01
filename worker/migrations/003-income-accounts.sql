-- The Net Worth account an income entry went into, so that account's balance is carried on with
-- it. Run once on a database made before it:
--   npx wrangler d1 execute mateen-money --remote --command "ALTER TABLE entries ADD COLUMN accountId TEXT"
-- (--remote --file can fail with "Authentication error [code: 10000]" where --command works.)
ALTER TABLE entries ADD COLUMN accountId TEXT;
