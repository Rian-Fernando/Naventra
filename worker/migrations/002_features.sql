-- Migration for an already-deployed database (run once).
-- Adds the feature vector to open predictions and the training-dataset table.

ALTER TABLE predictions ADD COLUMN features_json TEXT;

CREATE TABLE IF NOT EXISTS samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  icao          TEXT NOT NULL,
  iata          TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  callsign      TEXT NOT NULL,
  actual_runway TEXT,
  runway_ok     INTEGER,
  eta_err_sec   INTEGER,
  features_json TEXT NOT NULL,
  outcome_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts DESC);
CREATE INDEX IF NOT EXISTS idx_samples_icao ON samples(icao);
