// Scoreboard: how the current database does against the rows read by hand in the audit of 8 Nov 2026.
// Usage: npm run scoreboard [-- path/to/database.db]
// Prints totals per label. Holdout rows are only ever counted, never listed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const LABELS = fileURLToPath(new URL('../docs/labels/', import.meta.url));
export const WRONG = ['comparator', 'duplicate', 'standard', 'junk', 'owner'];
const ORDER = ['right', ...WRONG, 'stage', 'backbone', 'unsure'];
const ACTIVE = `('RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION')`;
const GROUPS = [['late', 'Phase 3+'], ['early', 'Phase 1-2']];
export const key = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function parseCsv(text) {
  const rows = [[]]; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (ch === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || rows.at(-1).length) rows.at(-1).push(cell); else rows.pop();
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function loadLabels(dir = LABELS) {
  const read = (f, part) => parseCsv(readFileSync(dir + f, 'utf8')).map(r => ({ ...r, part }));
  return { rows: [...read('work.csv', 'work'), ...read('holdout.csv', 'holdout')], baselineNames: new Set(readFileSync(dir + 'baseline-names.txt', 'utf8').split('\n').filter(Boolean)) };
}

function loadCurrent(db) {
  const programs = db.prepare('SELECT id, name, company, aliases, status_label FROM program').all();
  const byId = new Map(), byNameCompany = new Map(), byAlias = new Map(), byName = new Map();
  for (const p of programs) {
    Object.assign(p, { trials: new Set(), topActive: 0 });
    byId.set(p.id, p);
    byNameCompany.set(key(p.name) + '|' + key(p.company), p);
    if (!byName.has(key(p.name))) byName.set(key(p.name), []);
    byName.get(key(p.name)).push(p);
    let aliases = [];
    try { aliases = JSON.parse(p.aliases || '[]'); } catch { /* an unreadable alias list just gives no alias matches */ }
    for (const a of aliases) byAlias.set(key(a.name) + '|' + key(p.company), p);
  }
  const byTrial = new Map();
  for (const { nct, program_id } of db.prepare('SELECT nct, program_id FROM trial_program').all()) {
    const p = byId.get(program_id);
    if (!p) continue;
    p.trials.add(nct);
    if (!byTrial.has(nct)) byTrial.set(nct, []);
    byTrial.get(nct).push(p);
  }
  for (const { program_id, top } of db.prepare(`SELECT tp.program_id, MAX(t.phase) top FROM trial_program tp JOIN trial t ON t.nct = tp.nct WHERE t.status IN ${ACTIVE} AND t.phase >= 1 GROUP BY 1`).all()) {
    if (byId.has(program_id)) byId.get(program_id).topActive = top;
  }
  const mergedTo = new Map(db.prepare(`SELECT member_id, program_id FROM program_merge WHERE role = 'merged'`).all().map(m => [m.member_id, byId.get(m.program_id)]));
  return { programs, byId, byNameCompany, byAlias, byName, byTrial, mergedTo };
}

// Where has this labelled row gone? same | newId | absorbed (its name now sits on another row of that company)
// | moved (same name, other company, shared trial) | unmatched (a row whose name and company did not exist on 8 Nov took over its trials) | gone
function find(row, now, baselineNames) {
  const nameKey = key(row.drug), trials = row.trials.split(' ');
  const shares = p => trials.some(t => p.trials.has(t));
  let p = now.byId.get(row.row_id);
  if (p) return { state: 'same', p };
  p = now.byNameCompany.get(nameKey + '|' + key(row.company));
  if (p) return { state: 'newId', p };
  p = now.mergedTo.get(row.row_id) || now.byAlias.get(nameKey + '|' + key(row.company));
  if (p) return { state: 'absorbed', p };
  p = (now.byName.get(nameKey) || []).find(shares);
  if (p) return { state: 'moved', p };
  const fresh = [...new Set(trials.flatMap(t => now.byTrial.get(t) || []))].filter(c => !baselineNames.has(key(c.name) + '|' + key(c.company)));
  return fresh.length ? { state: 'unmatched', candidates: fresh } : { state: 'gone' };
}

// Outcome for scoring: still = shown today, gone = removed or lost, inactive = found but no active trial, unmatched = cannot tell.
export function score(rows, baselineNames, db) {
  const now = loadCurrent(db);
  const results = rows.map(row => {
    const hit = find(row, now, baselineNames);
    let outcome;
    if (hit.state === 'unmatched') outcome = 'unmatched';
    else if (hit.state === 'gone' || !hit.p.trials.size) outcome = 'gone';
    else if (!hit.p.topActive) outcome = 'inactive';
    else if (hit.state === 'same' && row.label === 'owner' && key(hit.p.company) !== key(row.company)) outcome = 'gone'; // the row now shows another company
    else if (hit.state === 'moved') outcome = row.label === 'owner' ? 'gone' : 'unmatched'; // the owner fix; anywhere else a person must read it
    else if (hit.state === 'absorbed') outcome = row.label === 'right' ? 'still' : 'gone';
    else outcome = 'still';
    return { ...row, ...hit, outcome };
  });
  // Two right rows on one row now: both drugs were right, so one has been lost.
  const onProgram = new Map();
  for (const r of results.filter(r => r.label === 'right' && r.outcome === 'still')) {
    if (!onProgram.has(r.p.id)) onProgram.set(r.p.id, []);
    onProgram.get(r.p.id).push(r);
  }
  for (const group of onProgram.values()) {
    group.sort((a, b) => (b.state === 'same') - (a.state === 'same'));
    for (const r of group.slice(1)) { r.outcome = 'gone'; r.mergedRight = group[0].p; }
  }
  const claimed = new Set(results.filter(r => r.p && r.outcome === 'still').map(r => r.p.id));
  const unlabelledLate = now.programs.filter(p => p.topActive >= 3 && !claimed.has(p.id)).length;
  return { results, unlabelledLate, lateNow: now.programs.filter(p => p.topActive >= 3).length };
}

const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '-';
const n = v => v.toLocaleString('en-US');
const pad = (s, w) => String(s).padStart(w);
const tally = (rows, label, outcome) => rows.filter(r => (!label || r.label === label) && (!outcome || r.outcome === outcome)).length;
const isWrong = r => WRONG.includes(r.label);

function auditLine(rows, name) {
  const count = l => tally(rows, l);
  const wrong = rows.filter(isWrong).length;
  return `${name}: ${n(wrong)} wrong of ${n(rows.length)} (${pct(wrong, rows.length)}): ${WRONG.map(l => `${l} ${count(l)}`).join(', ')}. Not counted as wrong: stage ${count('stage')}, backbone ${count('backbone')}, unsure ${count('unsure')}, right ${n(count('right'))}.`;
}

export function report({ results, unlabelledLate, lateNow }, dbPath) {
  const out = [`Scoreboard against the audit of 8 Nov 2026. Database: ${dbPath}`, '', 'What the audit found (all labelled rows; these never change):'];
  for (const [g, name] of GROUPS) out.push('  ' + auditLine(results.filter(r => r.group === g), name));
  const work = results.filter(r => r.part === 'work'), holdout = results.filter(r => r.part === 'holdout');
  for (const [g, name] of GROUPS) {
    const rows = work.filter(r => r.group === g);
    out.push('', `${name}, working rows (${n(rows.length)}):`, `  ${'label'.padEnd(11)}${pad('rows', 7)}${pad('still there', 13)}${pad('gone', 7)}${pad('no active trial', 17)}${pad("can't match", 13)}`);
    for (const l of ORDER) out.push(`  ${l.padEnd(11)}${pad(tally(rows, l), 7)}${pad(tally(rows, l, 'still'), 13)}${pad(tally(rows, l, 'gone'), 7)}${pad(tally(rows, l, 'inactive'), 17)}${pad(tally(rows, l, 'unmatched'), 13)}`);
    const wrong = rows.filter(isWrong), right = rows.filter(r => r.label === 'right');
    out.push(`  Wrong rows removed: ${tally(wrong, null, 'gone')} of ${wrong.length} (${pct(tally(wrong, null, 'gone'), wrong.length)}). Right rows lost: ${tally(right, null, 'gone')} of ${right.length} (${pct(tally(right, null, 'gone'), right.length)}).`);
    const stage = rows.filter(r => r.label === 'stage' && r.p);
    if (stage.length) out.push(`  Stage rows now showing a different stage: ${stage.filter(r => (r.p.status_label || '') !== r.status_label || r.p.topActive !== Number(r.top_phase)).length} of ${tally(rows, 'stage')}.`);
  }
  out.push('', `Holdout, totals only (${n(holdout.length)} rows; never tune against these):`);
  for (const [g, name] of GROUPS) {
    const rows = holdout.filter(r => r.group === g), wrong = rows.filter(isWrong), right = rows.filter(r => r.label === 'right');
    out.push(`  ${name}: wrong removed ${tally(wrong, null, 'gone')} of ${wrong.length}; right lost ${tally(right, null, 'gone')} of ${right.length}; no active trial ${tally(rows, null, 'inactive')}; can't match ${tally(rows, null, 'unmatched')}.`);
  }
  out.push('', `Phase 3+ rows in the database today: ${n(lateNow)}, of which ${n(unlabelledLate)} match no labelled row (new or renamed, not scored).`);
  const list = (title, rows, line) => { if (rows.length) out.push('', `${title} (working rows):`, ...rows.map(r => `  ${r.drug} | ${r.company} | ${r.label} | ${line(r)}`)); };
  list('Right rows lost', work.filter(r => r.label === 'right' && r.outcome === 'gone'), r =>
    r.mergedRight ? `merged with another right row: ${r.mergedRight.name}` : `no row found; trials ${r.trials}`);
  list("Can't match, needs a person to read", work.filter(r => r.outcome === 'unmatched'), r =>
    r.state === 'moved' ? `same name now under ${r.p.company}` : `trials now on new row(s): ${r.candidates.map(c => `${c.name} (${c.company})`).join('; ')}`);
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.argv[2] || 'data/openpipeline.db';
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const { rows, baselineNames } = loadLabels();
  console.log(report(score(rows, baselineNames, db), dbPath));
}
