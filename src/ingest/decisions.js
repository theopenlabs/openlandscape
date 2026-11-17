// Shared by the regulator loaders (ema.js, fda-decisions.js, sec-decisions.js): stores each decision once and puts it
// in the change feed when it is about a drug or program we track.
// change.kind: approval | rejection | delay | opinion | filing | withdrawal; region US, EU, CN, JP, AU.
// change.date is the day we found it (so the weekly email never misses a late source); decision_date is the regulator's date.
// The first run of each source only records what is already there (no feed rows), like changes.js does for trials.
// `--since YYYY-MM-DD` also puts decisions dated on or after that day in the feed (dated by their decision date).
import { getDb, meta } from '../db.js';
import { programResolver } from '../match.js';

export const KINDS = ['approval', 'rejection', 'delay', 'opinion', 'filing', 'withdrawal'];
const today = () => new Date().toISOString().slice(0, 10);

export function sinceArg(argv = process.argv) {
  const i = argv.indexOf('--since');
  return i > 0 && /^\d{4}-\d{2}-\d{2}$/.test(argv[i + 1] || '') ? argv[i + 1] : null;
}

// source: 'ema' | 'fda' | 'fda_crl' | 'sec'. since: see above.
export function decisionWriter({ db = getDb(), source, since = null } = {}) {
  const baseline = !meta.get(`decisions_baseline_${source}`);
  const resolve = programResolver(db);
  const ins = db.prepare(`INSERT OR IGNORE INTO regulatory_decision (key, agency, region, drug_id, program_id, product, inn, holder, kind, indication, decision_date, source_url, quote)
    VALUES (@key, @agency, @region, @drug_id, @program_id, @product, @inn, @holder, @kind, @indication, @decision_date, @source_url, @quote)`);
  // The same decision from two sources (a company's 8-K, then openFDA a week later) is one feed row. Companies repeat
  // news in later filings, so an SEC mention within 45 days of the same kind of decision is the same one (an application
  // is accepted once: 180 days for filings). Two decisions
  // from one regulator are always two rows (two efficacy supplements approved a week apart are two approvals).
  const twin = db.prepare(`SELECT 1 FROM change WHERE program_id=? AND kind=? AND region=? AND abs(julianday(decision_date) - julianday(?)) <= ?
    AND (field != ? OR field = 'SEC')`);
  const insC = db.prepare(`INSERT INTO change (date, kind, nct, program_id, field, before, after, source_url, region, decision_date, quote)
    VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)`);
  const out = { seen: 0, new: 0, matched: 0, changes: 0, baseline };
  // d: { key, agency, region, kind, product, inn, holder, indication, decision_date, source_url, quote, text,
  //      names (to find the program), company_id (optional), program (already resolved, optional) }
  function record(d) {
    if (!KINDS.includes(d.kind)) throw new Error(`unknown decision kind ${d.kind}`);
    out.seen++;
    const p = d.program || resolve({ names: d.names || [d.product, d.inn].filter(Boolean), holder: d.holder, company_id: d.company_id });
    const row = { inn: null, holder: null, indication: null, quote: null, product: null, ...d, program_id: p?.program_id || null, drug_id: p?.drug_id || null };
    if (!ins.run(row).changes) return null;
    out.new++;
    if (!p) return { stored: true };
    out.matched++;
    const announce = since ? d.decision_date >= since : !baseline;
    if (!announce || twin.get(p.program_id, d.kind, d.region, d.decision_date, d.kind === 'filing' ? 180 : d.agency === 'SEC' ? 45 : 10, d.agency)) return { stored: true, program_id: p.program_id };
    insC.run(since ? d.decision_date : today(), d.kind, p.program_id, d.agency, d.text || d.product, d.source_url, d.region, d.decision_date, d.quote || null);
    out.changes++;
    return { stored: true, program_id: p.program_id, change: true };
  }
  function done() {
    meta.set(`decisions_baseline_${source}`, meta.get(`decisions_baseline_${source}`) || new Date().toISOString());
    meta.set(`decisions_checked_${source}`, new Date().toISOString());
    return out;
  }
  return { record, done, transaction: fn => db.transaction(fn)() };
}

// Daily jobs run from the hourly script: once a day, from the given UTC hour on.
export function dueToday(source, hour) {
  const last = (meta.get(`decisions_checked_${source}`) || '').slice(0, 10);
  return last !== today() && new Date().getUTCHours() >= hour;
}

// The source's own words, trimmed at a sentence or word boundary.
export function clip(s, n = 400) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n), dot = cut.lastIndexOf('. ');
  return (dot > n * 0.5 ? cut.slice(0, dot + 1) : cut.slice(0, cut.lastIndexOf(' ')) + ' …');
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', reg: '®', trade: '™', bull: '•', middot: '·', hellip: '…', copy: '©', deg: '°', micro: 'µ', szlig: 'ß' };
// Accented letters: &ouml; &eacute; &ntilde; &ccedil; ...
const ACC = { uml: '\u0308', acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', cedil: '\u0327', ring: '\u030A' };
// Letters that are not an accent on a base letter (Bagsv&aelig;rd, K&oslash;benhavn); case matters.
const LIG = { aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', oelig: 'œ', OElig: 'Œ', eth: 'ð', thorn: 'þ' };
export function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (LIG[e] ?? ENT[e.toLowerCase()] ?? (ACC[e.slice(1)] ? (e[0] + ACC[e.slice(1)]).normalize('NFC') : m)));
}

// A decision a person approved on the review page: stored and put in the feed today, unless the feed already has it.
export function publishReviewed(d, db = getDb()) {
  const p = d.program;
  if (!p?.program_id || !KINDS.includes(d.kind)) return { published: false, why: 'no tracked drug' };
  db.prepare(`INSERT OR IGNORE INTO regulatory_decision (key, agency, region, drug_id, program_id, product, holder, kind, decision_date, source_url, quote)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(d.key, d.agency, d.region, p.drug_id || null, p.program_id, d.product || null, d.holder || null, d.kind, d.decision_date, d.source_url, d.quote || null);
  const twin = db.prepare(`SELECT 1 FROM change WHERE program_id=? AND kind=? AND region=? AND abs(julianday(decision_date) - julianday(?)) <= ?`)
    .get(p.program_id, d.kind, d.region, d.decision_date, d.kind === 'filing' ? 180 : 45);
  if (twin) return { published: false, why: 'already in the feed' };
  const r = db.prepare(`INSERT INTO change (date, kind, nct, program_id, field, before, after, source_url, region, decision_date, quote) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)`)
    .run(today(), d.kind, p.program_id, d.agency, d.text || d.product, d.source_url, d.region, d.decision_date, d.quote || null);
  return { published: true, change_id: Number(r.lastInsertRowid) };
}
