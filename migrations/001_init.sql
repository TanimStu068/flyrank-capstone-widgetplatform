CREATE TABLE tenants (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  api_key_hash  TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

CREATE TABLE widgets (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('signup','contact','cta','popover')),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  button_text  TEXT NOT NULL DEFAULT 'Submit',
  fields       TEXT NOT NULL,
  display      TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_widgets_tenant ON widgets (tenant_id, created_at);

CREATE TABLE submissions (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  widget_id       TEXT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL,
  data            TEXT NOT NULL,
  ip_hash         TEXT,
  origin          TEXT,
  country         TEXT,
  country_code    TEXT,
  region          TEXT,
  city            TEXT,
  geo_provider    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
-- the retried action happens once: same key on same widget => same submission
CREATE UNIQUE INDEX uq_submissions_idem ON submissions (widget_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_submissions_tenant_seq  ON submissions (tenant_id, seq DESC);
CREATE INDEX idx_submissions_widget_seq  ON submissions (widget_id, seq DESC);
CREATE INDEX idx_submissions_tenant_time ON submissions (tenant_id, created_at);

-- spam that was dropped; counted on the dashboard, never stored as a lead
CREATE TABLE blocked_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  widget_id  TEXT NOT NULL,
  tenant_id  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_blocked_tenant_time ON blocked_events (tenant_id, created_at);

-- transactional outbox: written in the same transaction as the submission
CREATE TABLE jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  run_at     INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_due ON jobs (status, run_at);
