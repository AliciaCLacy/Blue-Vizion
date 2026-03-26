CREATE TABLE IF NOT EXISTS intake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT UNIQUE NOT NULL,
  agent_id TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  biometric_hash TEXT NOT NULL,
  service_code TEXT NOT NULL,
  ethnicity_code TEXT NOT NULL,
  remote_office_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending','awaiting_documents','qualified','unqualified')) NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  step TEXT NOT NULL,
  actor TEXT NOT NULL,
  result TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  issued_timestamp TEXT NOT NULL,
  deadline_timestamp TEXT NOT NULL,
  status TEXT CHECK (status IN ('open','received','expired')) NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id TEXT UNIQUE NOT NULL,
  candidate_number TEXT NOT NULL,
  documents_hash TEXT,
  watermark_hash TEXT,
  block_seal TEXT,
  notarized INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disqualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  update_type TEXT NOT NULL,
  agent_signature TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eod_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  run_window TEXT NOT NULL,
  processed INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
