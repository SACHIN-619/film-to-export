-- Store image files in the database so they survive Render's ephemeral disk.
CREATE TABLE IF NOT EXISTS media_files (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  data          BYTEA NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(batch_id, filename)
);

