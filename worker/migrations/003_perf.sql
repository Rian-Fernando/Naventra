-- Migration 003 — cut D1 rows_read (run once against the live database).
--
-- The scorecard and health endpoints were running COUNT(*) over the ever-growing
-- `samples` table on every request (full table scan = the whole table counted as
-- rows_read, on a hot path polled every ~45s). This adds a running per-airport
-- training-row counter to `model` so the count is read from ~3 rows instead, and
-- adds composite indexes so the per-minute arr-rate query is a small range scan.
--
-- Apply:  cd worker && npx wrangler d1 execute naventra --remote --file=migrations/003_perf.sql

-- Running training-row counter, backfilled once from the existing samples.
ALTER TABLE model ADD COLUMN samples INTEGER NOT NULL DEFAULT 0;
UPDATE model SET samples = (SELECT COUNT(*) FROM samples s WHERE s.icao = model.icao);

-- Composite indexes for the per-airport + time-window queries (arr-rate, 24h).
CREATE INDEX IF NOT EXISTS idx_samples_icao_ts ON samples(icao, ts);
CREATE INDEX IF NOT EXISTS idx_land_icao_ts ON landings(icao, ts);
