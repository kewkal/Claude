import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = process.env.GHL_DB_PATH || join(ROOT, 'data', 'ghl.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  pw_hash    TEXT NOT NULL,
  pw_salt    TEXT NOT NULL,
  name       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  category         TEXT,
  phone            TEXT,
  email            TEXT,
  website          TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  postal_code      TEXT,
  country          TEXT,
  lat              REAL,
  lng              REAL,
  rating           REAL,
  review_count     INTEGER,
  place_id         TEXT UNIQUE,
  source           TEXT NOT NULL DEFAULT 'manual',
  status           TEXT NOT NULL DEFAULT 'new',
  score            INTEGER NOT NULL DEFAULT 0,
  pipeline_value   INTEGER NOT NULL DEFAULT 0,
  tags             TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  search_query     TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_contacted_at TEXT,
  next_action_at   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_city    ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_score   ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_next    ON leads(next_action_at);

CREATE TABLE IF NOT EXISTS calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  lead_name    TEXT,
  phone        TEXT,
  direction    TEXT NOT NULL DEFAULT 'outbound',
  outcome      TEXT NOT NULL DEFAULT 'no_answer',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  notes        TEXT NOT NULL DEFAULT '',
  script_id    INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
  provider     TEXT,
  provider_sid TEXT,
  recording_url TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calls_lead    ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);

CREATE TABLE IF NOT EXISTS scripts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'call',
  segment    TEXT NOT NULL DEFAULT 'general',
  subject    TEXT,
  body       TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  uses       INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT 'Discovery call',
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  status     TEXT NOT NULL DEFAULT 'confirmed',
  notes      TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(starts_at);

CREATE TABLE IF NOT EXISTS availability (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday   INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min   INTEGER NOT NULL,
  slot_min  INTEGER NOT NULL DEFAULT 30,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS onboarding_forms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  intro       TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_responses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id      INTEGER REFERENCES onboarding_forms(id) ON DELETE CASCADE,
  lead_id      INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  client_name  TEXT,
  business     TEXT,
  email        TEXT,
  phone        TEXT,
  answers_json TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'new',
  brief_path   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resp_created ON onboarding_responses(created_at DESC);

CREATE TABLE IF NOT EXISTS daily_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  day           TEXT NOT NULL UNIQUE,
  target_hours  REAL NOT NULL DEFAULT 0,
  worked_hours  REAL NOT NULL DEFAULT 0,
  focus         TEXT NOT NULL DEFAULT '',
  wins          TEXT NOT NULL DEFAULT '',
  blockers      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT,
  title      TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  lead_id    INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day);

CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT NOT NULL,
  task        TEXT NOT NULL,
  input_json  TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued',
  output      TEXT NOT NULL DEFAULT '',
  queue_path  TEXT,
  started_at  TEXT,
  finished_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON agent_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS email_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'queued',
  provider    TEXT,
  provider_id TEXT,
  error       TEXT,
  sent_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON email_outbox(created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  direction    TEXT NOT NULL DEFAULT 'outbound',
  channel      TEXT NOT NULL DEFAULT 'sms',
  to_addr      TEXT,
  from_addr    TEXT,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'queued',
  source       TEXT NOT NULL DEFAULT 'manual',
  provider_sid TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_lead    ON messages(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS sequences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger     TEXT NOT NULL DEFAULT 'manual',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id   INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  channel       TEXT NOT NULL DEFAULT 'email',
  subject       TEXT,
  body          TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_steps_seq ON sequence_steps(sequence_id, position);

CREATE TABLE IF NOT EXISTS enrollments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id  INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'active',
  step_index   INTEGER NOT NULL DEFAULT 0,
  next_run_at  TEXT,
  stop_reason  TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE (sequence_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_enroll_due ON enrollments(status, next_run_at);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  dedupe_key   TEXT UNIQUE,
  run_at       TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  result       TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ran_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, run_at);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  meta_json  TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_lead ON activity(lead_id, created_at DESC);
`;

db.exec(SCHEMA);

/**
 * Columns added after the first release. ALTER TABLE ADD COLUMN is the only
 * safe migration here — it never touches existing rows, and re-running it on
 * an already-migrated database is a no-op we swallow.
 */
const LATER_COLUMNS = [
  ['leads', 'site_status', 'TEXT'],
  ['leads', 'site_checked_at', 'TEXT'],
  ['leads', 'site_platform', 'TEXT'],
  ['leads', 'site_title', 'TEXT'],
  ['leads', 'has_meta_pixel', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'has_google_tag', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'has_google_ads', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'has_analytics', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'runs_ads', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'mobile_ready', 'INTEGER'],
  ['leads', 'has_ssl', 'INTEGER'],
  ['leads', 'tags_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['leads', 'pitch_angle', 'TEXT'],
  ['leads', 'is_chain', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'chain_reason', 'TEXT'],
  ['leads', 'owner_name', 'TEXT'],
  ['leads', 'owner_role', 'TEXT'],
  ['leads', 'owner_source', 'TEXT'],
  ['leads', 'owner_confidence', 'INTEGER'],
  ['leads', 'owner_email', 'TEXT'],
  ['leads', 'owner_email_kind', 'TEXT'],
  ['leads', 'owner_email_confidence', 'INTEGER'],
  ['leads', 'emails_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['leads', 'recovery_score', 'INTEGER'],
  ['leads', 'recovery_reasons', 'TEXT'],
  ['leads', 'recovery_gaps', "TEXT NOT NULL DEFAULT '{}'"],
  ['leads', 'recovery_chat', 'TEXT'],
  ['leads', 'recovery_booking', 'TEXT'],
  ['leads', 'recovery_email_tool', 'TEXT'],
  ['leads', 'recovery_review_tool', 'TEXT'],
  ['leads', 'recovery_form', 'INTEGER'],
  ['leads', 'recovery_click_to_call', 'INTEGER'],
];

for (const [table, column, type] of LATER_COLUMNS) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // Already there.
  }
}

db.exec('CREATE INDEX IF NOT EXISTS idx_leads_runs_ads ON leads(runs_ads)');
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_site_status ON leads(site_status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_is_chain ON leads(is_chain)');
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_recovery ON leads(recovery_score DESC)');

/** Run a SELECT and return all rows. */
export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/** Run a SELECT and return the first row or undefined. */
export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/** Run an INSERT/UPDATE/DELETE. Returns { changes, lastInsertRowid }. */
export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** Wrap fn in a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export { DB_PATH, ROOT };
