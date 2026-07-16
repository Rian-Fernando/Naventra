-- Naventra always-on tracker — D1 schema.

-- Open predictions: one row per aircraft locked on approach, awaiting outcome.
CREATE TABLE IF NOT EXISTS predictions (
  id            TEXT PRIMARY KEY,   -- icao|hex
  icao          TEXT NOT NULL,
  callsign      TEXT NOT NULL,
  lock_ts       INTEGER NOT NULL,
  lock_oct      INTEGER NOT NULL,
  pred_runway   TEXT NOT NULL,
  raw_eta_ts    INTEGER NOT NULL,
  pred_eta_ts   INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  sample_json   TEXT,               -- last airborne sample {lat,lon,track,agl,distNm,seq}
  features_json TEXT                -- lock-time feature vector (see features.js)
);
CREATE INDEX IF NOT EXISTS idx_pred_icao ON predictions(icao);

-- Training dataset: one labeled row per graded landing. features_json holds all
-- inputs at lock time; outcome_json holds the observed labels. Grows 24/7 and
-- is exported as JSONL for offline model training.
CREATE TABLE IF NOT EXISTS samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  icao          TEXT NOT NULL,
  iata          TEXT NOT NULL,
  ts            INTEGER NOT NULL,   -- touchdown time
  callsign      TEXT NOT NULL,
  actual_runway TEXT,
  runway_ok     INTEGER,
  eta_err_sec   INTEGER,
  features_json TEXT NOT NULL,
  outcome_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts DESC);
CREATE INDEX IF NOT EXISTS idx_samples_icao ON samples(icao);

-- Graded landings (rolling history for display).
CREATE TABLE IF NOT EXISTS landings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  icao       TEXT NOT NULL,
  iata       TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  callsign   TEXT NOT NULL,
  items_json TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  total      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_land_ts ON landings(ts DESC);

-- Aggregate accuracy per airport + category (the all-time scorecard).
CREATE TABLE IF NOT EXISTS stats (
  icao    TEXT NOT NULL,
  cat     TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (icao, cat)
);

-- Learned model parameters per airport.
CREATE TABLE IF NOT EXISTS model (
  icao        TEXT PRIMARY KEY,
  rwy_json    TEXT NOT NULL DEFAULT '{}',   -- { octant: { runwayEnd: count } }
  eta_ema     REAL NOT NULL DEFAULT 0,
  eta_n       INTEGER NOT NULL DEFAULT 0,
  landings    INTEGER NOT NULL DEFAULT 0,
  updated_ts  INTEGER NOT NULL DEFAULT 0
);

-- Per-airport bookkeeping (gate map, last run) as a small JSON blob.
CREATE TABLE IF NOT EXISTS state (
  icao      TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_ts INTEGER NOT NULL DEFAULT 0
);
