-- Links a payment method to the Net Worth account it draws from, so that account's balance is
-- carried on with the payments logged since it was typed. Run once on a database made before it:
--   npx wrangler d1 execute mateen-money --remote --file worker/migrations/002-method-accounts.sql
ALTER TABLE methods ADD COLUMN accountId TEXT;
