// Applies read verdicts to the drug rows.
// A model read every Phase 3+ row against its trials and said what the row is: right, comparator, standard, duplicate,
// junk, owner, stage, backbone or unsure, with a confidence. The verdicts live in seed/row-verdicts.csv, keyed on the
// drug name and company and on the trials the row was read with, because link.js rebuilds every row on each reload
// and row ids move. Runs after link.js, druglists.js and onerow.js, so it sees the rows as the site would show them.
//   node src/ingest/verdicts.js              apply: load the seed, find each verdict's row today, act or queue
//   node src/ingest/verdicts.js --pick f.csv write the rows with an active trial that need (re)reading: no verdict, or new
//                                            trials since it; the phase column is the row's top active phase
// What happens, per verdict:
//   high confidence, automatic row:  comparator / standard / junk / backbone / rollover -> the row and its trial links are deleted;
//                                    duplicate -> folded into the row named in duplicate_of (program_merge, evidence
//                                    "read"); stage with a confirmed approval (approval_label + approval_source) -> the
//                                    row's status becomes that approval; owner / stage without one -> program.flag is
//                                    set, nothing else changes.
//   right, any confidence            nothing: a doubt about a row that stays is not worth a person's time.
//   medium or low, a hand-checked row, or a duplicate whose target is not found -> queued for a person
//                                    (match_candidate, type 'verdict'); the review page applies or dismisses it.
//   a person's earlier decision      accepted -> applied like high confidence; rejected -> left alone, not queued again.
//   row not found today              recorded as absent (renamed, merged away or no longer linked).
// Every reload re-applies everything, so a dropped row that link.js rebuilds is dropped again. Rows are only ever
// deleted or merged here when the reader was sure or a person agreed; a wrong drop is worse than a wrong row.
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { getDb, meta } from '../db.js';
import { parseCsv, key } from '../scoreboard.js';

const SEED = new URL('../../seed/row-verdicts.csv', import.meta.url);
const IDENTITY = new URL('../../seed/drug-identity.csv', import.meta.url);
// backbone and rollover rows go too: the company's drug is real, but these trials do not develop it.
export const DROP = new Set(['comparator', 'standard', 'junk', 'backbone', 'rollover']), FLAG = new Set(['owner', 'stage']);
const SCORE = { high: 0.9, medium: 0.6, low: 0.3 };
const ACTIVE = `('RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION')`;
const J = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };

export function readSeed(path = SEED) {
  return parseCsv(readFileSync(path, 'utf8')).map(r => ({ ...r, name_key: key(r.drug), company_key: key(r.company) }));
}
// Answers found on the web, kept in seed/drug-identity.csv by drug name and
// company like the read verdicts, and applied the same way: "same" folds the row into same_as (same company), "approved"
// sets the approval. Sure answers apply; the rest wait for a person on the review page (confidence medium).
//   kind, drug, company, same_as, approval, source_url, source_kind, quote, how, date
// Sure: a same-company twin settled by software or by a model quote found in the result; an approval on a regulator's
// own page. Exchange filings and company pages go to a person: they list many drugs, approved and planned, in one breath.
// Once a person has checked a line, "person" is added to how and it applies by itself.
export function readIdentity(path = IDENTITY) {
  let text; try { text = readFileSync(path, 'utf8'); } catch { return []; }
  return parseCsv(text).filter(r => r.kind === 'same' || r.kind === 'approved').map(r => {
    // A line a person checked ("person" in how) is sure whatever its source.
    const sure = (/software|quote checked/.test(r.how) && (r.kind === 'same' || r.source_kind === 'regulator')) || /\bperson\b/.test(r.how);
    return { drug: r.drug, company: r.company, trials: '', verdict: r.kind === 'same' ? 'duplicate' : 'stage', confidence: sure ? 'high' : 'medium',
      duplicate_of: r.kind === 'same' ? `${r.same_as} [${r.company}]` : '', reason: r.quote, evidence: r.source_url, read_at: r.date, reader: 'web: ' + r.how,
      approval_label: r.kind === 'approved' ? r.approval : '', approval_source: r.kind === 'approved' ? r.source_url : '', name_key: key(r.drug), company_key: key(r.company) };
  });
}
function loadVerdicts(db, verdicts) {
  db.exec('DELETE FROM row_verdict');
  const ins = db.prepare('INSERT OR REPLACE INTO row_verdict (name_key, company_key, drug, company, trials, verdict, confidence, duplicate_of, reason, evidence, read_at, reader, approval_label, approval_source, target, target_trial) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const v of verdicts) ins.run(v.name_key, v.company_key, v.drug, v.company, v.trials, v.verdict, v.confidence, v.duplicate_of, v.reason, v.evidence, v.read_at, v.reader, v.approval_label || null, v.approval_source || null, v.target || null, v.target_trial || null);
}

// The rows as they are now, indexed the ways a verdict can find them.
function current(db) {
  const programs = db.prepare('SELECT id, name, company, aliases, curated FROM program').all();
  const byId = new Map(), byNameCo = new Map(), byName = new Map();
  const add = (m, k, p) => { if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
  for (const p of programs) {
    byId.set(p.id, p); p.trials = new Set();
    // A row shared by partners names them all ("Daiichi Sankyo · AstraZeneca"): a verdict read under either name finds it.
    const cks = new Set([key(p.company), ...String(p.company || '').split(' · ').map(key)]);
    for (const n of new Set([p.name, ...J(p.aliases).map(a => a.name)].filter(Boolean).map(key))) { for (const ck of cks) add(byNameCo, n + '|' + ck, p); add(byName, n, p); }
  }
  const byTrialKey = new Map();
  for (const l of db.prepare('SELECT nct, program_id, matched_on FROM trial_program').all()) {
    const p = byId.get(l.program_id); if (!p) continue;
    p.trials.add(l.nct); add(byTrialKey, l.nct + ':' + key(l.matched_on), p);
  }
  const mergedTo = new Map(db.prepare("SELECT member_id, program_id FROM program_merge WHERE role='merged'").all().map(m => [m.member_id, m.program_id]));
  return { programs, byId, byNameCo, byName, byTrialKey, mergedTo };
}
// Which row a verdict is about today: the same name (or alias) under the same company; else the row that one of the
// verdict's trials now links through the same intervention name, provided every trial of that row was among the ones
// read (the row was renamed, not a bigger row that took the intervention over).
// Returns { p, by: 'name' | 'alias' | 'trial' }. An alias-only match means the row was folded into another row since it
// was read: the verdict is about the folded row, so nothing is done to the row that absorbed it.
export function findRow(v, now) {
  const own = now.byNameCo.get(v.name_key + '|' + v.company_key);
  if (own?.length) { const p = own.find(p => key(p.name) === v.name_key); return p ? { p, by: 'name' } : { p: own[0], by: 'alias' }; }
  const read = String(v.trials || '').split(' ').filter(Boolean), ncts = new Set(read.map(t => t.split(':')[0]));
  for (const t of read) for (const p of now.byTrialKey.get(t) || []) if ([...p.trials].every(n => ncts.has(n))) return { p, by: 'trial' };
  return null;
}
// The row a duplicate folds into: the name in duplicate_of ("Etentamig", "SYS6043 [CSPC]"). A company in brackets picks
// the row of that company; else same company first.
function findTarget(v, p, now) {
  const nk = key(v.duplicate_of.replace(/\s*\[[^\]]*\]\s*$/, '')), co = key((v.duplicate_of.match(/\[([^\]]*)\]\s*$/) || [])[1] || '');
  const cands = (now.byName.get(nk) || []).filter(q => q.id !== p.id && now.byId.has(q.id));
  if (!cands.length) return null;
  const said = co && cands.find(q => key(q.company) === co);
  if (said) return said;
  const named = cands.filter(q => key(q.name) === nk);   // rows called that, before rows that only list it as an other name
  return cands.find(q => key(q.company) === key(p.company)) || (named.length === 1 ? named[0] : null) || cands.find(q => [...q.trials].some(t => p.trials.has(t))) || (cands.length === 1 ? cands[0] : null);
}

// Act on one verdict for one row. Returns { action, note }. Caller holds the transaction.
export function applyVerdict(db, v, p, now = current(db), today = new Date().toISOString().slice(0, 10)) {
  if (!db.prepare('SELECT 1 FROM program WHERE id=?').get(p.id)) return { action: 'absent', note: 'row already removed in this pass' };
  if (!DROP.has(v.verdict) && !FLAG.has(v.verdict) && v.verdict !== 'duplicate') return { action: 'kept' };
  if (p.curated) return { action: 'skipped', note: 'hand-checked row: change the seed files instead' };
  if (DROP.has(v.verdict)) {
    db.prepare('DELETE FROM trial_program WHERE program_id=?').run(p.id);
    db.prepare('DELETE FROM program_merge WHERE program_id=?').run(p.id);
    db.prepare('DELETE FROM program WHERE id=?').run(p.id);
    now.byId.delete(p.id);
    return { action: 'dropped' };
  }
  if (v.verdict === 'duplicate') {
    const t = findTarget(v, p, now);
    // The other row was already folded into this one (it is this row's name or one of its other names): nothing left to do.
    const same = key(v.duplicate_of.replace(/\s*\[[^\]]*\]\s*$/, ''));
    if (!t && [p.name, ...J(p.aliases).map(a => a.name)].some(n => key(n) === same)) return { action: 'kept', note: 'already one row' };
    if (!t) return { action: 'skipped', note: `no row called "${v.duplicate_of}" to fold into` };
    const n = db.prepare('SELECT count(DISTINCT nct) FROM trial_program WHERE program_id=?').pluck().get(p.id);
    const evidence = JSON.stringify([{ list: 'read', name: 'read as a duplicate', reason: v.reason, evidence: v.evidence, reader: v.reader, read_at: v.read_at }]);
    db.prepare('INSERT OR IGNORE INTO trial_program (nct, program_id, matched_on) SELECT nct, ?, matched_on FROM trial_program WHERE program_id=?').run(t.id, p.id);
    db.prepare('DELETE FROM trial_program WHERE program_id=?').run(p.id);
    const insM = db.prepare('INSERT OR IGNORE INTO program_merge (program_id, member_id, name, sponsor, trials, role, evidence, date) VALUES (?,?,?,?,?,?,?,?)');
    insM.run(t.id, t.id, t.name, t.company, [...t.trials].length, 'kept', evidence, today);
    db.prepare('INSERT OR REPLACE INTO program_merge (program_id, member_id, name, sponsor, trials, role, evidence, date) VALUES (?,?,?,?,?,?,?,?)').run(t.id, p.id, p.name, p.company, n, 'merged', evidence, today);
    // The folded row's names become other names of the kept row, its list link and approval carry over when the kept row
    // has none (as onerow.js does), and anything that named the folded row now names the kept one.
    const from = db.prepare('SELECT list_url, status_label, status_level, status_source FROM program WHERE id=?').get(p.id) || {};
    if (from.list_url) db.prepare('UPDATE program SET list_url=coalesce(list_url, ?) WHERE id=?').run(from.list_url, t.id);
    if (from.status_level === 5) db.prepare('UPDATE program SET status_label=?, status_level=?, status_source=? WHERE id=? AND status_level IS NULL').run(from.status_label, from.status_level, from.status_source, t.id);
    const al = new Map(J(db.prepare('SELECT aliases FROM program WHERE id=?').pluck().get(t.id)).map(a => [key(a.name), a]));
    for (const nm of [p.name, ...J(p.aliases).map(a => a.name)]) if (nm && key(nm) !== key(t.name) && !al.has(key(nm))) al.set(key(nm), { name: nm, confirmed: 1, read: 1 });
    db.prepare('UPDATE program SET aliases=? WHERE id=?').run(JSON.stringify([...al.values()].slice(0, 20)), t.id);
    for (const sql of ['UPDATE regulatory_decision SET program_id=? WHERE program_id=?', 'UPDATE change SET program_id=? WHERE program_id=?', 'UPDATE OR IGNORE program_merge SET program_id=? WHERE program_id=?']) db.prepare(sql).run(t.id, p.id);
    db.prepare('DELETE FROM program_merge WHERE program_id=?').run(p.id);
    db.prepare('DELETE FROM program WHERE id=?').run(p.id);
    for (const nct of p.trials) t.trials.add(nct);
    now.byId.delete(p.id);
    return { action: 'merged', note: `into ${t.name} [${t.company}]`, target: t.id };
  }
  if (v.verdict === 'stage' && v.approval_label && /^https?:/.test(v.approval_source || '')) {
    db.prepare('UPDATE program SET status_label=?, status_level=5, status_source=?, flag=NULL WHERE id=?').run(v.approval_label, v.approval_source, p.id);
    return { action: 'approved', note: v.approval_label };
  }
  db.prepare('UPDATE program SET flag=? WHERE id=?').run(v.verdict, p.id);
  return { action: 'flagged' };
}

// The read verdicts plus the web answers; a web answer replaces a "right" read of the same row (it says more), never a drop.
export function allVerdicts() {
  const ids = readIdentity(), k = v => v.name_key + '|' + v.company_key, have = new Set(ids.map(k));
  return [...readSeed().filter(v => !(v.verdict === 'right' && have.has(k(v)))), ...ids];
}
export function applyVerdicts({ db = getDb(), verdicts = allVerdicts(), today = new Date().toISOString().slice(0, 10) } = {}) {
  const stats = { verdicts: verdicts.length, dropped: 0, merged: 0, approved: 0, flagged: 0, kept: 0, queued: 0, rejected: 0, absorbed: 0, absent: 0 };
  db.transaction(() => {
    loadVerdicts(db, verdicts);
    db.exec("UPDATE program SET flag=NULL WHERE flag IS NOT NULL; DELETE FROM match_candidate WHERE type='verdict' AND status='open'");
    const decided = new Map(db.prepare("SELECT left_id, right_id, status FROM match_candidate WHERE type='verdict'").all().map(c => [c.left_id + '|' + c.right_id, c.status]));
    const now = current(db);
    const record = db.prepare('UPDATE row_verdict SET program_id=?, action=?, acted_at=? WHERE name_key=? AND company_key=?');
    const queue = db.prepare("INSERT OR IGNORE INTO match_candidate (type, left_id, right_id, score, reasons) VALUES ('verdict', ?, ?, ?, ?)");
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    // Flags and drops first, then duplicates (a duplicate's target may be another verdict's row), then the rest.
    const order = v => FLAG.has(v.verdict) ? 0 : DROP.has(v.verdict) ? 1 : v.verdict === 'duplicate' ? 2 : 3;
    for (const v of verdicts.slice().sort((a, b) => order(a) - order(b))) {
      const k = v.name_key + '|' + v.company_key;
      const hit = findRow(v, now), p = hit?.p;
      if (!p || !now.byId.has(p.id)) { stats.absent++; record.run(null, 'absent', stamp, v.name_key, v.company_key); continue; }
      const status = decided.get(p.id + '|' + k);
      let r;
      if (hit.by === 'alias') r = { action: 'absorbed', note: `now an other name of ${p.name}` };
      else if (status === 'rejected') r = { action: 'rejected' };
      else if (v.confidence === 'high' || status === 'accepted' || v.verdict === 'right') r = applyVerdict(db, v, p, now, today);
      else r = { action: 'skipped', note: `${v.confidence} confidence` };
      if (r.action === 'skipped') {
        queue.run(p.id, k, SCORE[v.confidence] || 0.5, JSON.stringify({ verdict: v.verdict, confidence: v.confidence, duplicate_of: v.duplicate_of, reason: v.reason, evidence: v.evidence, approval_label: v.approval_label || '', approval_source: v.approval_source || '', drug: p.name, company: p.company, why: r.note, read_at: v.read_at, reader: v.reader }));
        r = { action: 'queued', note: r.note };
      }
      stats[r.action] = (stats[r.action] || 0) + 1;
      record.run(p.id, r.action + (r.note ? ': ' + r.note : ''), stamp, v.name_key, v.company_key);
    }
  })();
  meta.set('verdicts_applied_at', new Date().toISOString());
  return stats;
}

// Rows with an active trial that have no verdict yet, or that gained a trial since they were read. Each comes with its
// top active phase, so a read can be cut into late rows (3 and up) and early rows (1 and 2).
export function pickRows({ db = getDb(), verdicts = readSeed() } = {}) {
  const now = current(db);
  const top = new Map(db.prepare(`SELECT tp.program_id, MAX(t.phase) top FROM trial_program tp JOIN trial t ON t.nct = tp.nct WHERE t.status IN ${ACTIVE} GROUP BY 1`).all().map(r => [r.program_id, r.top || 0]));
  const read = new Map();   // program id -> trials it was read with
  for (const v of verdicts) { const p = findRow(v, now)?.p; if (p) read.set(p.id, new Set(String(v.trials || '').split(' ').filter(Boolean).map(t => t.split(':')[0]))); }
  const out = [];
  for (const [id, phase] of top) {
    const p = now.byId.get(id), seen = read.get(id);
    if (!p) continue;
    if (!seen) out.push({ row_id: id, why: 'no verdict', phase });
    else { const fresh = [...p.trials].filter(t => !seen.has(t)); if (fresh.length) out.push({ row_id: id, why: `new trials: ${fresh.slice(0, 5).join(' ')}`, phase }); }
  }
  const late = [...top.values()].filter(ph => ph >= 3).length;
  return { late, early: top.size - late, rows: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--pick') {
    const { late, early, rows } = pickRows(), out = process.argv[3] || 'reread.csv';
    const q = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    writeFileSync(out, 'row_id,why,phase\n' + rows.map(r => `${q(r.row_id)},${q(r.why)},${r.phase}`).join('\n') + '\n');
    const say = set => `${set.length} to read (${set.filter(r => r.why === 'no verdict').length} unread, ${set.filter(r => r.why !== 'no verdict').length} with new trials)`;
    console.log(`${late} rows with an active Phase 3+ trial, ${say(rows.filter(r => r.phase >= 3))}; ${early} early rows (active trials, none Phase 3+), ${say(rows.filter(r => r.phase < 3))} -> ${out}`);
  } else console.log(JSON.stringify(applyVerdicts()));
}
