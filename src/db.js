// One small SQLite file holds everything: trials, drugs, aliases, approvals, users, requests.
// SQLite was chosen over Postgres because the whole index is ~200 MB, runs on a $5 server,
// and backs up by copying one file.
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// A working copy in <repo>/.<tool>/worktrees/<name> has no database of its own: it uses the main folder's data/openpipeline.db,
// the one copy every working copy shares (`npm run data` refreshes it from the live site).
const OWN = new URL('../data/openpipeline.db', import.meta.url).pathname;
const SHARED = OWN.replace(/\/\.[a-z]+\/worktrees\/[^/]+\/data\//, '/data/');
export const DB_PATH = process.env.DB_PATH || (existsSync(OWN) || !existsSync(SHARED) ? OWN : SHARED);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Registry data (ClinicalTrials.gov, via the official API or AACT)
CREATE TABLE IF NOT EXISTS trial (
  nct TEXT PRIMARY KEY,
  title TEXT,
  status TEXT,             -- RECRUITING, ACTIVE_NOT_RECRUITING, COMPLETED, ...
  phase INTEGER,           -- 1..4 highest phase (PHASE1/PHASE2 -> 2, PHASE2/PHASE3 -> 3)
  phase_label TEXT,        -- as registered, e.g. "Phase 2/3"
  start_date TEXT,
  primary_completion TEXT,
  completion TEXT,
  enrollment INTEGER,
  sponsor TEXT,
  sponsor_class TEXT,
  collaborators TEXT,      -- JSON array
  conditions TEXT,         -- JSON array
  keywords TEXT,           -- JSON array
  countries TEXT,          -- JSON array
  n_sites INTEGER,
  last_update TEXT
);
CREATE TABLE IF NOT EXISTS intervention (
  nct TEXT NOT NULL REFERENCES trial(nct) ON DELETE CASCADE,
  type TEXT, name TEXT, other_names TEXT  -- JSON array
);
CREATE INDEX IF NOT EXISTS ix_int_nct ON intervention(nct);
-- A trial's arms as registered: type is EXPERIMENTAL, ACTIVE_COMPARATOR, PLACEBO_COMPARATOR, SHAM_COMPARATOR, NO_INTERVENTION or OTHER.
CREATE TABLE IF NOT EXISTS trial_arm (
  nct TEXT NOT NULL, label TEXT, type TEXT,
  interventions TEXT         -- JSON array, written "Drug: name" by the registry
);
CREATE INDEX IF NOT EXISTS ix_arm_nct ON trial_arm(nct);
-- The registry's standard disease terms for a trial (MeSH). ancestor=1: a broader term above one of the trial's own.
CREATE TABLE IF NOT EXISTS trial_mesh (nct TEXT NOT NULL, term TEXT NOT NULL, ancestor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (nct, term, ancestor));
CREATE TABLE IF NOT EXISTS site (
  nct TEXT NOT NULL REFERENCES trial(nct) ON DELETE CASCADE,
  facility TEXT, city TEXT, country TEXT
);
CREATE INDEX IF NOT EXISTS ix_site_nct ON site(nct);

-- openFDA approvals (Drugs@FDA)
CREATE TABLE IF NOT EXISTS fda_approval (
  appl_no TEXT, brand TEXT, ingredient TEXT, sponsor TEXT, approval_date TEXT, appl_type TEXT,
  PRIMARY KEY (appl_no, ingredient, brand)
);
CREATE INDEX IF NOT EXISTS ix_fda_ing ON fda_approval(ingredient);
-- FDA established pharmacologic class by single ingredient, from openFDA's NDC directory (every listed US product).
-- Drugs@FDA gives a class for only about a quarter of approvals; this fills the rest (src/ingest/openfda.js).
CREATE TABLE IF NOT EXISTS fda_class (ingredient TEXT PRIMARY KEY, epc TEXT);
-- What an approved drug is for: the "Indications and usage" section of its FDA label, by application (src/ingest/fdalabels.js).
CREATE TABLE IF NOT EXISTS fda_label (appl_no TEXT PRIMARY KEY, set_id TEXT, indications TEXT, effective_time TEXT, fetched_at TEXT);
-- The company's own approvals of a drug row with no active trial (scripts/approved-idle.mjs), for its label. Rewritten by src/ingest/fdalabels.js.
CREATE TABLE IF NOT EXISTS program_label (program_id TEXT NOT NULL, appl_no TEXT NOT NULL, PRIMARY KEY (program_id, appl_no));

-- Curated layer: companies, drugs, aliases, catalysts (seeded by hand, every row sourced)
CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY, name TEXT, country TEXT, ticker TEXT, listed INTEGER,
  sponsor_patterns TEXT    -- JSON array of lowercase substrings that identify this company as a registry sponsor
);
CREATE TABLE IF NOT EXISTS drug (
  id TEXT PRIMARY KEY,     -- canonical name, lowercase
  name TEXT,               -- display name
  companies TEXT,          -- JSON array of company ids
  mechanism TEXT,
  mechanism_confirmed INTEGER DEFAULT 0,
  tags TEXT,               -- space-separated: glp amylin oral other sirna
  curated INTEGER DEFAULT 1,
  status_override TEXT,    -- e.g. "Approved (China)", "Filed (US)"
  status_level INTEGER,    -- 4 filed, 5 approved
  status_source TEXT,      -- URL for the override
  status_news INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS drug_alias (
  alias_norm TEXT NOT NULL, alias TEXT, drug_id TEXT NOT NULL REFERENCES drug(id) ON DELETE CASCADE,
  confirmed INTEGER DEFAULT 1, source TEXT,
  PRIMARY KEY (alias_norm, drug_id)
);
CREATE TABLE IF NOT EXISTS area_exclusion (area TEXT, name_norm TEXT, reason TEXT, PRIMARY KEY (area, name_norm));
CREATE TABLE IF NOT EXISTS catalyst (
  id INTEGER PRIMARY KEY, drug_id TEXT, date TEXT, what TEXT, source_url TEXT, news INTEGER DEFAULT 1, confirmed INTEGER DEFAULT 0
);

-- Built by link.js: which trial tests which program (drug + sponsor company)
CREATE TABLE IF NOT EXISTS program (
  id TEXT PRIMARY KEY,     -- drug id, or "auto:<name>|<sponsor>" for uncurated drugs
  drug_id TEXT, name TEXT, aliases TEXT, company TEXT, company_ids TEXT, mechanism TEXT, mechanism_confirmed INTEGER,
  tags TEXT, curated INTEGER, china INTEGER,
  status_label TEXT, status_level INTEGER, status_source TEXT, status_news INTEGER
);
CREATE TABLE IF NOT EXISTS trial_program (
  nct TEXT NOT NULL, program_id TEXT NOT NULL, matched_on TEXT, PRIMARY KEY (nct, program_id)
);
CREATE INDEX IF NOT EXISTS ix_tp_prog ON trial_program(program_id);
-- Another company's marketed drug named in a trial (by brand, or with a country label: "US-Prolia"), kept as a comparison,
-- not as a drug of the trial's sponsor. copy=1 when the trial title says it tests a copy (biosimilar, equivalence, PK comparison).
CREATE TABLE IF NOT EXISTS comparator (
  nct TEXT NOT NULL, name TEXT, name_norm TEXT, ingredient_norm TEXT, owner TEXT, copy INTEGER, matched_on TEXT, PRIMARY KEY (nct, name_norm)
);
CREATE INDEX IF NOT EXISTS ix_comp_name ON comparator(name_norm);
CREATE INDEX IF NOT EXISTS ix_comp_ing ON comparator(ingredient_norm);

-- Product tables
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT (datetime('now')),
  plan TEXT DEFAULT 'free', founding INTEGER DEFAULT 0, stripe_customer TEXT, last_seen TEXT
);
CREATE TABLE IF NOT EXISTS login_token (token_hash TEXT PRIMARY KEY, email TEXT, expires_at TEXT, used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS session (token_hash TEXT PRIMARY KEY, user_id INTEGER, expires_at TEXT);
CREATE TABLE IF NOT EXISTS api_key (
  id INTEGER PRIMARY KEY, user_id INTEGER, key_hash TEXT UNIQUE, prefix TEXT, created_at TEXT DEFAULT (datetime('now')), revoked INTEGER DEFAULT 0
);
-- MCP connector sign-in (src/oauth.js). Apps register themselves; codes and tokens are stored as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS oauth_client (client_id TEXT PRIMARY KEY, info TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS oauth_request (id_hash TEXT PRIMARY KEY, client_id TEXT, params TEXT, expires_at TEXT);
CREATE TABLE IF NOT EXISTS oauth_code (code_hash TEXT PRIMARY KEY, client_id TEXT, user_id INTEGER, challenge TEXT, redirect_uri TEXT, resource TEXT, expires_at TEXT);
CREATE TABLE IF NOT EXISTS oauth_token (token_hash TEXT PRIMARY KEY, kind TEXT, client_id TEXT, user_id INTEGER, resource TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, detail TEXT, at TEXT DEFAULT (datetime('now'))  -- kind: landscape | mcp
);
CREATE INDEX IF NOT EXISTS ix_usage ON usage(user_id, kind, at);
-- The different drugs each account has seen (src/limits.js): the day it first saw each one in the last 30 days.
CREATE TABLE IF NOT EXISTS drug_seen (user_id INTEGER, program_id TEXT, first_day TEXT, PRIMARY KEY (user_id, program_id));
CREATE INDEX IF NOT EXISTS ix_drug_seen ON drug_seen(user_id, first_day);
-- Public pages opened signed out, per computer (an IPv4 address or an IPv6 /64) and day (src/limits.js).
CREATE TABLE IF NOT EXISTS visitor_day (day TEXT, ip TEXT, pages INTEGER DEFAULT 0, stopped INTEGER DEFAULT 0, PRIMARY KEY (day, ip));
CREATE TABLE IF NOT EXISTS saved_landscape (
  id INTEGER PRIMARY KEY, user_id INTEGER, query TEXT, phase_min INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS area_request (
  id INTEGER PRIMARY KEY, email TEXT, area TEXT, role TEXT, page TEXT, referrer TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment (
  id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, plan TEXT, amount INTEGER, currency TEXT, stripe_session TEXT UNIQUE,
  livemode INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- What changed between two registry loads (written by src/ingest/changes.js).
-- kind: new_trial | phase | status | date (primary completion moved) | catalyst (new hand-checked catalyst)
--       | approval | rejection | delay | opinion | filing | withdrawal (regulator decisions, src/ingest/decisions.js)
-- date = the ClinicalTrials.gov release the change appeared in (YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS change (
  id INTEGER PRIMARY KEY, date TEXT, kind TEXT, nct TEXT, program_id TEXT, field TEXT, before TEXT, after TEXT,
  source_url TEXT, detected_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_change_date ON change(date);
CREATE INDEX IF NOT EXISTS ix_change_nct ON change(nct);

-- SEC filings per company (src/ingest/edgar.js). kind: deal (8-K item 1.01) | share_sale (8-K item 3.02) | offering (S-1, F-1, 424B) | filing (other 8-K, 6-K)
CREATE TABLE IF NOT EXISTS filing (
  accession TEXT PRIMARY KEY, company_id TEXT, cik INTEGER, date TEXT, form TEXT, items TEXT, kind TEXT, url TEXT, description TEXT,
  found_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_filing_co ON filing(company_id, date);

-- ---------- World data ----------
-- One row per registry record (ClinicalTrials.gov, EU CTIS, EU CTR, China CDE, jRCT, ANZCTR). Each keeps its own link.
-- Contact names, phones and emails are never stored (no column for them; loaders pass records through match.js recordRow()).
CREATE TABLE IF NOT EXISTS trial_record (
  registry TEXT NOT NULL,          -- ctgov | ctis | euctr | cde | jrct | anzctr
  record_id TEXT NOT NULL,         -- NCT06172478, 2026-525472-26-00, CTR20250935, jRCT2031230001
  url TEXT, study_id TEXT, title TEXT, title_lang TEXT, sponsor_raw TEXT, company_id TEXT,
  phase INTEGER, phase_label TEXT, status TEXT, start_date TEXT, primary_completion TEXT,
  conditions TEXT, protocol_code TEXT, protocol_code_norm TEXT, utn TEXT,
  xrefs TEXT,                      -- JSON array of other registries' numbers this record lists
  countries TEXT, last_updated TEXT, first_seen TEXT DEFAULT (datetime('now')), last_seen TEXT, raw_hash TEXT,
  PRIMARY KEY (registry, record_id)
);
CREATE INDEX IF NOT EXISTS ix_tr_study ON trial_record(study_id);
CREATE INDEX IF NOT EXISTS ix_tr_code ON trial_record(protocol_code_norm);
CREATE INDEX IF NOT EXISTS ix_tr_utn ON trial_record(utn);
-- A study groups the records of one trial. id = the NCT number if there is one, else the first other record id.
CREATE TABLE IF NOT EXISTS study (
  id TEXT PRIMARY KEY, title TEXT, phase INTEGER, phase_label TEXT, status TEXT, start_date TEXT, primary_completion TEXT,
  registries TEXT, n_records INTEGER, updated_at TEXT
);
-- Why each record is in its study. rule: own (the study's first record) | xref | utn | protocol | hand
CREATE TABLE IF NOT EXISTS study_link (
  registry TEXT NOT NULL, record_id TEXT NOT NULL, study_id TEXT NOT NULL, rule TEXT, evidence TEXT, decided_by TEXT, date TEXT,
  PRIMARY KEY (registry, record_id)
);
CREATE INDEX IF NOT EXISTS ix_sl_study ON study_link(study_id);
-- Regulator decisions from EMA's daily file, openFDA and company SEC filings.
-- kind: approval | rejection | delay | opinion | filing | withdrawal. region: US, EU, CN, JP, AU.
CREATE TABLE IF NOT EXISTS regulatory_decision (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, agency TEXT, region TEXT, drug_id TEXT, program_id TEXT, product TEXT, inn TEXT, holder TEXT,
  kind TEXT, indication TEXT, decision_date TEXT, source_url TEXT, quote TEXT, found_at TEXT DEFAULT (datetime('now')), confirmed INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_rd_prog ON regulatory_decision(program_id, decision_date);
-- Other names of a company: seed name, registry patterns, legal names, Chinese names, former names, subsidiaries.
CREATE TABLE IF NOT EXISTS company_alias (
  company_id TEXT NOT NULL, alias TEXT, alias_norm TEXT NOT NULL, lang TEXT, kind TEXT, auto INTEGER DEFAULT 0, evidence_url TEXT,
  PRIMARY KEY (alias_norm, company_id)
);
-- Review queue: anything weaker than hard evidence. type: study | drug | company | decision. status: open | accepted | rejected
CREATE TABLE IF NOT EXISTS match_candidate (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, left_id TEXT NOT NULL, right_id TEXT NOT NULL, score REAL, reasons TEXT, source_url TEXT,
  status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (type, left_id, right_id)
);
-- Answers from official drug lists (src/ingest/druglists.js), kept so reloads do not ask again. list: gsrs | nci.
-- query: the registry name as looked up (salt words stripped, lowercase). hits: JSON, only what grouping needs.
CREATE TABLE IF NOT EXISTS drug_list_lookup (list TEXT NOT NULL, query TEXT NOT NULL, hits TEXT, error TEXT, fetched_at TEXT, PRIMARY KEY (list, query));
-- Automatic rows merged into one drug by an official list entry. role: kept | merged | owner collaborates.
-- evidence: JSON [{ list, id, name, url }] (UNII page or NCI dictionary page).
CREATE TABLE IF NOT EXISTS program_merge (program_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT, sponsor TEXT, trials INTEGER, role TEXT, evidence TEXT, date TEXT,
  PRIMARY KEY (program_id, member_id));
-- Read verdicts (seed/row-verdicts.csv, applied by src/ingest/verdicts.js after every reload). Keyed on the drug name and
-- company as key() in src/scoreboard.js spells them, plus the trials the row was read with ("NCT:intervention-key" list),
-- because row ids change between reloads. program_id/action/acted_at say what happened on the last reload:
-- dropped | merged | flagged | kept | queued | rejected | absent.
CREATE TABLE IF NOT EXISTS row_verdict (
  name_key TEXT NOT NULL, company_key TEXT NOT NULL, drug TEXT, company TEXT, trials TEXT,
  verdict TEXT, confidence TEXT, duplicate_of TEXT, reason TEXT, evidence TEXT, read_at TEXT, reader TEXT,
  approval_label TEXT, approval_source TEXT,   -- a stage verdict's confirmed approval ("Approved (China)" + source URL): sets the row's status
  target TEXT, target_trial TEXT,              -- what the drug acts on, as a trial states it ("PD-1", "GLP-1 + GIP", "unknown"), and that trial; stored only, the row's mechanism is not changed
  program_id TEXT, action TEXT, acted_at TEXT,
  PRIMARY KEY (name_key, company_key)
);
-- Hand-checked "these are not the same" pairs (seed files). type: study | drug | company. a < b.
CREATE TABLE IF NOT EXISTS not_same (type TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, reason TEXT, PRIMARY KEY (type, a, b));

-- Weekly email: one row per user per week sent, so a re-run never sends twice.
CREATE TABLE IF NOT EXISTS digest_log (user_id INTEGER, week TEXT, sent_at TEXT DEFAULT (datetime('now')), changes INTEGER, PRIMARY KEY (user_id, week));
-- Rows a person has already had in a Monday email (src/digest.js), so no change is sent twice. key: drug|date|words|link.
CREATE TABLE IF NOT EXISTS digest_item (user_id INTEGER NOT NULL, key TEXT NOT NULL, week TEXT, PRIMARY KEY (user_id, key));
-- The other emails (src/digest.js). kind: welcome (once per person) | news (big-news email on Free, at most one a week)
-- | upgrade (once, when someone who had the Free welcome pays for Solo).
-- day: the day it was sent (YYYY-MM-DD); ref: what it was about (the landscape, or the decisions it announced, as JSON).
CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, ref TEXT, sent_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_mail_log ON mail_log(user_id, kind, day);
-- Pages opened in a real browser (src/visits.js): the page tells us once it has loaded. No address and no
-- account: visitor is a code from the address and browser with a salt that changes every day, so it cannot be traced back.
-- ref: the site that sent them (host only, empty for our own pages or none); device: phone | tablet | computer.
CREATE TABLE IF NOT EXISTS page_view (id INTEGER PRIMARY KEY, day TEXT, path TEXT, ref TEXT, utm TEXT, device TEXT, visitor TEXT, signed_in INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_page_view ON page_view(day);
-- Each step of the hourly job (src/jobrun.js): whether it worked. ok: 1 worked, 0 failed.
-- mailed: the website's hourly timer has looked at it (src/jobrun.js alertJobs).
CREATE TABLE IF NOT EXISTS job_run (id INTEGER PRIMARY KEY, name TEXT, started_at TEXT, finished_at TEXT, ok INTEGER, code INTEGER, mailed INTEGER);
CREATE INDEX IF NOT EXISTS ix_job_run ON job_run(name, id);
-- Payment trouble from Stripe (src/billing.js): kind payment_failed | cancel_planned | ended. done_at: the admin has dealt with it.
CREATE TABLE IF NOT EXISTS billing_event (id INTEGER PRIMARY KEY, kind TEXT, email TEXT, customer TEXT, amount INTEGER, currency TEXT,
  detail TEXT, stripe_id TEXT UNIQUE, at TEXT DEFAULT (datetime('now')), done_at TEXT, done_note TEXT);
-- Emails that did not send (src/mail.js): kind signin | talk | admin | welcome | hello | news | upgrade | monday. Shown on the
-- admin dashboard's Today and Emails. user_id: the account with that address, if any.
CREATE TABLE IF NOT EXISTS mail_fail (id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now')), user_id INTEGER, email TEXT, kind TEXT, subject TEXT, error TEXT);
-- People the admin has followed up from the admin dashboard's Today (src/admin.js): kind checkout (left at checkout) | allowance (near the
-- free drug allowance). The row comes back only when it happens again after done_at.
CREATE TABLE IF NOT EXISTS follow_up (id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, done_at TEXT DEFAULT (datetime('now')), note TEXT);
-- Accounts deleted from the admin dashboard (src/admin.js deleteAccount): only that one was deleted, when and by whom. No email, nothing else.
CREATE TABLE IF NOT EXISTS deleted_account (user_id INTEGER, deleted_at TEXT DEFAULT (datetime('now')), by TEXT);
`;

let db;
export function getDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Columns added after the first deploy (CREATE TABLE IF NOT EXISTS does not add them to existing tables).
const COLUMNS = {
  user: { digest_off: 'INTEGER DEFAULT 0', digest_token: 'TEXT',
    news_off: 'INTEGER DEFAULT 0',     // 1 = no big-news emails (Free); digest_off covers the Monday email
    signin_via: 'TEXT',                // how they last signed in: 'email' (link or code) or 'google'; Settings shows it
    signup_ip: 'TEXT',                 // the computer the account was made from (src/limits.js: 5 new accounts a day from one)
    came_from: 'TEXT',                 // why the account was made (src/server.js cameFrom): follow:drug, ai:Claude, shared:landscape…
    card_fp: 'TEXT',                   // Stripe's fingerprint of the card that paid (src/billing.js noteCard: one card, two accounts)
    first_ref: 'TEXT', first_page: 'TEXT',  // the site and our page of the visit that led to the account (src/visits.js)
    solo_until: 'TEXT',                // Solo given free from the admin dashboard until this day (YYYY-MM-DD); then back to Free by itself
    guide_done: 'TEXT',                // the setup guide's steps seen done, "pick,search": a tick never goes back. NULL = never worked out
    guide_hidden: 'INTEGER DEFAULT 0' }, // 0 = the setup guide shows, 1 = hidden by hand (Settings shows it again), 2 = finished
  visitor_day: { agent: 'TEXT' },        // the program name behind the computer's last signed-out page (bot watch)
  page_view: { country: 'TEXT' },        // two-letter country from the address at the time (src/country.js); the address is not kept
  payment: { delivered_at: 'TEXT', done_note: 'TEXT' },   // a custom landscape order: when it was delivered (the 48-hour clock), and a note
  company: { cik: 'INTEGER',             // SEC company number (seed/sec.js); null = not covered by SEC
    parent_id: 'TEXT' },                 // hand-checked owner (seed companyParents); matching treats the two as one company
  trial: { summary: 'TEXT',               // sponsor's brief summary from ClinicalTrials.gov
    org_study_id: 'TEXT',                 // sponsor's protocol code ("NN9838-4975")
    secondary_ids: 'TEXT' },              // JSON [{id, type, domain}]: EudraCT, EU CT, WHO UTN, other registries' numbers
  intervention: { description: 'TEXT' }, // sponsor's description of the drug or treatment arm
  fda_approval: { epc: 'TEXT' },          // FDA established pharmacologic class(es) from openFDA, "; "-joined
  // drug_alias.kind: canonical | code | name | brand | inn | chinese | japanese | salt | eu_substance | unii
  drug_alias: { kind: 'TEXT', lang: 'TEXT', auto: 'INTEGER DEFAULT 0', evidence_url: 'TEXT' },
  trial_program: { study_id: 'TEXT' },
  program: { list_url: 'TEXT', flag: 'TEXT' },   // list_url: official list entry behind an automatic merge; flag: a high-confidence read verdict that needs a person (owner | stage | backbone)
  // JSON [{role, name, substance, sub, other, org}]: a record's test and comparator drugs (CTIS: EU substance code and other names)
  trial_record: { products: 'TEXT' },
  // Regulator decisions in the feed (kind approval | rejection | delay | opinion | filing | withdrawal):
  // field = agency (EMA, FDA, SEC), after = product, quote = the source's own words.
  change: { region: 'TEXT', decision_date: 'TEXT', quote: 'TEXT' },
  // Review page (src/review.js): who published or dismissed an item, when, the feed row a publish added (for undo), and a note.
  match_candidate: { decided_by: 'TEXT', decided_at: 'TEXT', change_id: 'INTEGER', decided_note: 'TEXT' },
  row_verdict: { approval_label: 'TEXT', approval_source: 'TEXT', target: 'TEXT', target_trial: 'TEXT' },
  // Sign-in email: the 6-digit code beside the link, and wrong tries at it. Talk to us: the message and company.
  login_token: { code_hash: 'TEXT', tries: 'INTEGER DEFAULT 0' },
  area_request: { message: 'TEXT', company: 'TEXT', done_at: 'TEXT', done_note: 'TEXT' },   // done: the admin has answered it
  // A follow is a landscape (kind empty: its search words in `query`), or one drug or company (kind 'drug' | 'company',
  // ref = its id, query = its name: Home finds its changes by name, as the company page lists its drugs).
  saved_landscape: { kind: 'TEXT', ref: 'TEXT' },
};
function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}

export const meta = {
  get: k => getDb().prepare('SELECT v FROM meta WHERE k=?').pluck().get(k),
  set: (k, v) => getDb().prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)),
};

// "LY-3305677", "ly3305677 injection" -> "ly3305677"; "Bofanglutida" stays distinct (alias table handles it)
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(injection|tablets?|capsules?|oral|subcutaneous|sc|iv|solution|for injection|placebo-matched|dose \w+|mg|low|high)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
