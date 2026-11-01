-- Broker desk: per-item tariff resolution (live USITC lookup or table fallback),
-- the restricted-materials screen, and recorded agent runs for replay.
ALTER TABLE items ADD COLUMN mfn_rate_pct DOUBLE PRECISION;
ALTER TABLE items ADD COLUMN rate_source TEXT;
ALTER TABLE items ADD COLUMN hts_line TEXT;
ALTER TABLE items ADD COLUMN rate_note TEXT;
ALTER TABLE items ADD COLUMN restricted TEXT;
ALTER TABLE batches ADD COLUMN transcript TEXT;

CREATE TABLE IF NOT EXISTS broker_runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES batches(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,            -- live | fixture
  events TEXT NOT NULL,          -- JSON array of {t, event}
  created_at TEXT NOT NULL
);
