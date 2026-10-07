-- Split payments: who paid a bill. Run once on a database made before it:
--   npx wrangler d1 execute mateen-money --remote --command "ALTER TABLE entries ADD COLUMN paidBy TEXT"
-- (--remote --file can fail with "Authentication error [code: 10000]" where --command works.)
-- The new people, splits and settlements tables come from worker/schema.sql, which only adds tables
-- that aren't there yet:
--   npx wrangler d1 execute mateen-money --remote --file worker/schema.sql
ALTER TABLE entries ADD COLUMN paidBy TEXT;
