-- The Net Worth account a planned income goes into, copied to each entry it adds. Run once on a
-- database made before it:
--   npx wrangler d1 execute mateen-money --remote --command "ALTER TABLE recurring ADD COLUMN accountId TEXT"
ALTER TABLE recurring ADD COLUMN accountId TEXT;
