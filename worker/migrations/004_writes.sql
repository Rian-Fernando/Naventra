-- Migration 004 — cut D1 rows written (run once against the live database).
--
-- D1 counts every index entry an insert touches as another "row written", and
-- the free plan allows 100,000 a day per ACCOUNT. These two indexes on
-- `samples` are unused — the dataset export pages by id and the arrival-rate
-- query uses the covering idx_samples_icao_ts — yet they made every training
-- row cost 5 writes instead of 3. (Open predictions moved to one state row per
-- hub in the same release, so the `predictions` table empties itself.)
--
-- Apply:  cd worker && npx wrangler d1 execute naventra --remote --file=migrations/004_writes.sql
DROP INDEX IF EXISTS idx_samples_ts;
DROP INDEX IF EXISTS idx_samples_icao;
