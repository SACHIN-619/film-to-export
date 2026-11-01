-- Film-to-Export schema. Plain Postgres (works on Neon and Supabase).
-- Timestamps are ISO-8601 TEXT and JSON blobs are TEXT, so rows map 1:1 to the API DTOs.

CREATE TABLE IF NOT EXISTS seller (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'IN',
  email TEXT NOT NULL,
  iec TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- video | photos | fixture
  ai_mode TEXT NOT NULL,         -- live | simulation
  model TEXT,
  status TEXT NOT NULL,          -- drafting | ready | failed | published
  frame_count INTEGER NOT NULL DEFAULT 0,
  repaired BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS frames (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  path TEXT NOT NULL,            -- public URL path
  mime TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  status TEXT NOT NULL,          -- draft | confirmed | published | sold_out
  origin TEXT NOT NULL,          -- ai | fixture
  title_en TEXT NOT NULL,
  description_en TEXT NOT NULL,
  alt_lang TEXT NOT NULL,
  title_alt TEXT NOT NULL,
  description_alt TEXT NOT NULL,
  materials TEXT NOT NULL,
  dimensions TEXT,
  condition_grade TEXT NOT NULL,
  condition_notes TEXT NOT NULL,
  defects TEXT NOT NULL DEFAULT '[]',
  suggested_price_cents INTEGER NOT NULL,
  price_rationale TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  hs_suggested TEXT NOT NULL,
  hs_description TEXT NOT NULL,
  hs_rationale TEXT NOT NULL,
  hs_code TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT '{}',
  image_path TEXT,
  country_of_origin TEXT NOT NULL DEFAULT 'IN',
  sort_order INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  payments_mode TEXT NOT NULL,   -- sandbox | simulation
  paypal_order_id TEXT UNIQUE,
  capture_id TEXT,
  capture_status TEXT,
  buyer_name TEXT,
  buyer_email TEXT,
  buyer_address TEXT,
  buyer_country TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  inv_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  issued_at TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  paypal_invoice_id TEXT
);
