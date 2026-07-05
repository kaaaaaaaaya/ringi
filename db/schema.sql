CREATE TABLE IF NOT EXISTS receipts (
  id BIGSERIAL PRIMARY KEY,
  seq BIGINT NOT NULL UNIQUE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'BLOCK')),
  reason TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

-- Single-row lock target used to serialize receipt writes and prevent
-- prev_hash races when multiple agent actions land concurrently.
CREATE TABLE IF NOT EXISTS receipt_chain_lock (
  id INT PRIMARY KEY DEFAULT 1
);
INSERT INTO receipt_chain_lock (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Charter rules extracted from a DocumentSource (e.g. Notion). Activated
-- immediately on extraction (no human-approval gate) — `rule` retains the
-- full CharterRule JSON including its `source` provenance, so an incorrect
-- extraction can be traced back to the document/quote that produced it.
CREATE TABLE IF NOT EXISTS extracted_charter_rules (
  id BIGSERIAL PRIMARY KEY,
  rule_id TEXT NOT NULL UNIQUE,
  rule JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
