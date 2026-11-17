// Matching across registries, drug names and companies.
// Principle: a wrong merge is worse than a duplicate. Records merge automatically only on hard evidence:
//   1. explicit cross-reference (a record lists the other's number),
//   2. the same WHO UTN,
//   3. the same cleaned sponsor protocol code AND the same company (code at least 6 characters, letters and digits).
// Anything weaker goes to the review queue (match_candidate) and is never merged automatically.
// Hand-checked seed lists (sameStudy, notSameStudy, notSameDrug, companyParents) always win.
import { createHash } from 'node:crypto';
import { getDb, norm } from './db.js';

// ---------- protocol codes ----------
const ROMAN = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X',
  'ⅰ': 'I', 'ⅱ': 'II', 'ⅲ': 'III', 'ⅳ': 'IV', 'ⅴ': 'V' };
// "UBT251-（Ⅱ-3）" and "ubt251 (II-3)" -> "UBT251II3". NFKC turns full-width letters, digits and brackets into plain ones.
export function normCode(s) {
  if (!s) return null;
  const t = String(s).replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴ]/g, c => ROMAN[c]).normalize('NFKC');
  return t.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}
// Short codes like "CR-001" or "PIC1" collide between companies: only codes of 6+ characters with letters and digits merge.
export const usableCode = c => !!c && c.length >= 6 && /[A-Z]/.test(c) && /\d/.test(c);

// ---------- registry numbers ----------
const IDS = [
  ['ctgov', /\bNCT\d{8}\b/gi, s => s.toUpperCase()],
  ['ctis', /\b20\d{2}-5\d{5}-\d{2}-\d{2}\b/g, s => s],
  ['euctr', /\b(?:19|20)\d{2}-\d{6}-\d{2}\b(?!-\d)/g, s => s],
  ['cde', /\bCTR\d{8}\b/gi, s => s.toUpperCase()],
  ['jrct', /\bjRCT[a-z]?\d{7,10}\b/gi, s => 'jRCT' + s.slice(4)],
  ['anzctr', /\bACTRN\d{14}\b/gi, s => s.toUpperCase()],
  ['chictr', /\bChiCTR-?[A-Z]{0,4}-?\d{6,}\b/gi, s => s],
];
export const UTN_RE = /\bU1111-\d{4}-\d{4}\b/i;
// Every registry number in a text or list: [{ registry, id }]
export function registryIds(text) {
  const s = Array.isArray(text) ? text.join(' ') : String(text || '');
  const out = [];
  for (const [registry, re, fix] of IDS) for (const m of s.matchAll(re)) out.push({ registry, id: fix(m[0]) });
  return out;
}
export function registryOf(id) { return registryIds(id)[0]?.registry || null; }

// ---------- companies ----------
// Legal forms only: "Novo Nordisk A/S" and "Novo Nordisk" are one name, "Hengrui Pharmaceuticals" and "Hengrui" are not.
const LEGAL = new Set(['inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'llc', 'lp', 'plc', 'ag', 'sa', 'se', 'nv', 'bv',
  'gmbh', 'kg', 'kgaa', 'spa', 'srl', 'sas', 'ab', 'as', 'asa', 'oy', 'oyj', 'kk', 'pty', 'pte', 'the']);
export function normCompany(s) {
  const t = String(s || '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1').replace(/\ba\/s\b/g, 'as');
  return t.split(/[^\p{L}\p{N}]+/u).filter(w => w && !LEGAL.has(w)).join('');
}
// resolve(sponsorName) -> a company id ("lilly"), the top parent if a hand-checked parent is set, or "name:<cleaned name>".
export function companyResolver(db = getDb()) {
  const cos = db.prepare('SELECT id, name, sponsor_patterns, parent_id FROM company').all();
  const parent = new Map(cos.map(c => [c.id, c.parent_id]));
  const root = id => { const seen = new Set(); while (parent.get(id) && !seen.has(id)) { seen.add(id); id = parent.get(id); } return id; };
  // Patterns match at the start of a word: "sun pharmaceutical" is not "Fosun Pharmaceutical".
  const esc = p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = cos.flatMap(c => JSON.parse(c.sponsor_patterns || '[]').map(p => [new RegExp('(?<![a-z0-9])' + esc(p)), c.id]));
  const alias = new Map(db.prepare('SELECT alias_norm, company_id FROM company_alias').all().map(a => [a.alias_norm, a.company_id]));
  const resolve = name => {
    if (!name) return null;
    const low = String(name).toLowerCase();
    const hit = pats.find(([p]) => p.test(low));
    if (hit) return root(hit[1]);
    const n = normCompany(name);
    if (!n) return null;
    if (alias.has(n)) return root(alias.get(n));
    return 'name:' + n;
  };
  resolve.root = root;
  return resolve;
}

// ---------- records ----------
// The only fields a registry record keeps. Everything else (contact people, phones, emails, site staff) is dropped here.
const RECORD_FIELDS = ['registry', 'record_id', 'url', 'title', 'title_lang', 'sponsor_raw', 'company_id', 'phase', 'phase_label', 'status', 'start_date',
  'primary_completion', 'conditions', 'protocol_code', 'countries', 'last_updated', 'products'];
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
export function recordRow(r, { xrefs = [], utn = null } = {}) {
  const row = {};
  for (const f of RECORD_FIELDS) row[f] = r[f] == null ? null : (typeof r[f] === 'string' ? r[f].replace(EMAIL, '') : r[f]);
  row.protocol_code_norm = normCode(row.protocol_code);
  const ids = registryIds(xrefs).filter(x => !(x.registry === row.registry && x.id === row.record_id));
  row.xrefs = JSON.stringify([...new Set(ids.map(x => x.id))]);
  row.utn = (utn || (Array.isArray(xrefs) ? xrefs.join(' ') : String(xrefs || '')).match(UTN_RE)?.[0] || '').toUpperCase() || null;
  row.raw_hash = createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 16);
  return row;
}
export function saveRecords(rows, db = getDb()) {
  const cols = [...RECORD_FIELDS, 'protocol_code_norm', 'xrefs', 'utn', 'raw_hash'];
  const ins = db.prepare(`INSERT INTO trial_record (${cols.join(',')}, last_seen) VALUES (${cols.map(c => '@' + c).join(',')}, datetime('now'))
    ON CONFLICT(registry, record_id) DO UPDATE SET ${cols.filter(c => c !== 'registry' && c !== 'record_id').map(c => `${c}=excluded.${c}`).join(', ')}, last_seen=excluded.last_seen`);
  db.transaction(() => { for (const r of rows) ins.run(r); })();
}

// ---------- studies ----------
const REG_ORDER = ['ctgov', 'ctis', 'euctr', 'cde', 'jrct', 'anzctr', 'chictr'];
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const titleWords = s => new Set(String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3));
function similarity(a, b) {
  const A = titleWords(a), B = titleWords(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
const dayOf = d => Date.parse(!d ? '' : d.length === 7 ? d + '-15' : d.length === 4 ? d + '-07-01' : d);

// Groups every trial_record into studies and writes study, study_link, match_candidate (type study).
// sameStudy: [[recordId, recordId, source]] from the seeds, applied last. not_same (type study) blocks pairs.
export function buildStudies({ db = getDb(), sameStudy = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const recs = db.prepare('SELECT * FROM trial_record').all();
  const K = r => `${r.registry}:${r.record_id}`;
  const byId = new Map(recs.map(r => [r.record_id.toUpperCase(), r]));
  const resolveCo = companyResolver(db);
  const coRoot = r => (r.company_id && !r.company_id.startsWith('name:') ? resolveCo.root(r.company_id) : r.company_id);
  const blocked = new Set(db.prepare("SELECT a, b FROM not_same WHERE type='study'").all().map(x => pairKey(x.a.toUpperCase(), x.b.toUpperCase())));
  const up = new Map(recs.map(r => [K(r), K(r)])), members = new Map(recs.map(r => [K(r), [r]]));
  const find = k => { while (up.get(k) !== k) { up.set(k, up.get(up.get(k))); k = up.get(k); } return k; };
  const how = new Map(), candidates = new Map();
  const counts = { xref: 0, utn: 0, protocol: 0, hand: 0, blocked: 0, candidates: 0 };
  const candidate = (a, b, score, reasons) => {
    const k = pairKey(a.record_id, b.record_id);
    if (!candidates.has(k)) candidates.set(k, { left: a.record_id < b.record_id ? a.record_id : b.record_id, right: a.record_id < b.record_id ? b.record_id : a.record_id, score, reasons });
  };
  // Why two groups must stay apart: one registry never holds two records of one study (except EU CTR's per-country copies,
  // which share one EudraCT number and so are one record here), and hand-checked "not the same" pairs.
  const conflict = (ga, gb) => {
    const A = members.get(ga), B = members.get(gb);
    const regs = new Set(A.map(r => r.registry));
    const dup = B.find(r => regs.has(r.registry));
    if (dup) return `both groups have a ${dup.registry} record`;
    for (const a of A) for (const b of B) if (blocked.has(pairKey(a.record_id.toUpperCase(), b.record_id.toUpperCase()))) return 'hand-checked: not the same study';
    return null;
  };
  const join = (a, b, rule, evidence, { force = false } = {}) => {
    const ga = find(K(a)), gb = find(K(b));
    if (ga === gb) return true;
    const why = force ? null : conflict(ga, gb);
    if (why) { counts.blocked++; candidate(a, b, 0.9, { rule, evidence, blocked: why }); return false; }
    const [big, small] = members.get(ga).length >= members.get(gb).length ? [ga, gb] : [gb, ga];
    up.set(small, big); members.get(big).push(...members.get(small)); members.delete(small);
    const ev = { rule, evidence: { ...evidence, with: null }, decided_by: rule === 'hand' ? 'hand' : 'auto', date: today };
    if (!how.has(K(a)) || rule === 'hand') how.set(K(a), { ...ev, evidence: { ...evidence, with: b.record_id } });
    if (!how.has(K(b)) || rule === 'hand') how.set(K(b), { ...ev, evidence: { ...evidence, with: a.record_id } });
    counts[rule]++;
    return true;
  };

  // 1. Explicit cross-references between different registries. (A record listing another record of its own
  //    registry is a related trial, such as an extension study, not the same one.) If the listed record itself lists
  //    other numbers of the first record's registry but not the first record, the two disagree (an extension listing
  //    its parent's number, a sponsor's copy error): queued, not merged, unless other evidence below joins them.
  const listsIn = (r, registry) => JSON.parse(r.xrefs || '[]').filter(id => registryOf(id) === registry).map(id => id.toUpperCase());
  //    An EU CT number written without its last part (2022-501463-40) or with another one (-01 for -00) points to the CTIS
  //    record with the same first three parts, if exactly one is loaded. (EudraCT numbers never start 5 after the year.)
  const ctisBase = new Map();
  for (const r of recs) if (r.registry === 'ctis') { const b = r.record_id.slice(0, 14); if (!ctisBase.has(b)) ctisBase.set(b, []); ctisBase.get(b).push(r); }
  const lookup = id => {
    const o = byId.get(id.toUpperCase());
    if (o) return o;
    const m = /^(20\d{2}-5\d{5}-\d{2})(?:-\d{2})?$/.exec(id);
    const hits = m ? ctisBase.get(m[1]) || [] : [];
    return hits.length === 1 ? hits[0] : null;
  };
  for (const r of recs) for (const id of JSON.parse(r.xrefs || '[]')) {
    const o = lookup(id);
    if (!o || o.registry === r.registry) continue;
    const back = listsIn(o, r.registry);
    if (back.length && !back.includes(r.record_id.toUpperCase()) && !back.some(b => lookup(b) === r)) { candidate(r, o, 0.7, { rule: 'xref', value: id, listed_by: r.record_id, note: `${o.record_id} lists ${back.join(', ')} instead` }); continue; }
    join(r, o, 'xref', o.record_id === id ? { value: id, listed_by: r.record_id } : { value: id, listed_by: r.record_id, matched: o.record_id });
  }
  //    Both list the same EudraCT number (one trial in the old EU register) while that record is not loaded: a CTIS trial
  //    moved over from the old register, and the NCT that lists its EudraCT number. If one registry has two records listing
  //    the number, it does not identify one study: queued instead.
  const byEudract = new Map();
  for (const r of recs) for (const id of JSON.parse(r.xrefs || '[]'))
    if (registryOf(id) === 'euctr' && !byId.has(id.toUpperCase()) && !/^20\d{2}-5\d{5}-\d{2}$/.test(id)) { if (!byEudract.has(id)) byEudract.set(id, []); byEudract.get(id).push(r); }
  for (const [id, list] of byEudract) {
    if (new Set(list.map(r => r.registry)).size < 2) continue;
    const perReg = {}; for (const r of list) perReg[r.registry] = (perReg[r.registry] || 0) + 1;
    if (Object.values(perReg).some(n => n > 1)) {
      for (const a of list) for (const b of list) if (a.registry < b.registry) candidate(a, b, 0.7, { rule: 'xref', value: id, note: 'EudraCT number listed by several records of one registry' });
      continue;
    }
    for (let i = 1; i < list.length; i++) join(list[0], list[i], 'xref', { value: id, listed_by: 'both' });
  }
  // 2. Same WHO UTN.
  const byUtn = new Map();
  for (const r of recs) if (r.utn) { if (!byUtn.has(r.utn)) byUtn.set(r.utn, []); byUtn.get(r.utn).push(r); }
  for (const [utn, list] of byUtn) for (let i = 1; i < list.length; i++) join(list[0], list[i], 'utn', { value: utn });
  // 3. Same cleaned protocol code and same company. If one registry has two records with the code, the code is not
  //    a study identifier for that company: queue the cross-registry pairs instead of merging.
  const byCode = new Map(), codeOnly = new Map();
  for (const r of recs) {
    if (!usableCode(r.protocol_code_norm)) continue;
    const co = coRoot(r);
    if (co) { const k = `${co}|${r.protocol_code_norm}`; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(r); }
    if (!codeOnly.has(r.protocol_code_norm)) codeOnly.set(r.protocol_code_norm, []);
    codeOnly.get(r.protocol_code_norm).push(r);
  }
  for (const [k, list] of byCode) {
    if (new Set(list.map(r => r.registry)).size < 2) continue;
    const perReg = {}; for (const r of list) perReg[r.registry] = (perReg[r.registry] || 0) + 1;
    const ambiguous = Object.entries(perReg).filter(([, n]) => n > 1).map(([reg]) => reg);
    if (ambiguous.length) {
      for (const a of list) for (const b of list) if (a.registry < b.registry)
        candidate(a, b, 0.7, { rule: 'protocol', value: k.split('|')[1], note: `code used by several ${ambiguous.join(', ')} records of this company` });
      continue;
    }
    for (let i = 1; i < list.length; i++) join(list[0], list[i], 'protocol', { value: list[i].protocol_code, matched: list[0].protocol_code, code: k.split('|')[1], company: k.split('|')[0] });
  }
  // Same code, different (or unknown) companies: a licensing partner or a collision. Never merged; queued.
  for (const [code, list] of codeOnly) {
    if (list.length > 6 || new Set(list.map(r => r.registry)).size < 2) continue;
    for (const a of list) for (const b of list)
      if (a.registry < b.registry && find(K(a)) !== find(K(b))) candidate(a, b, 0.5, { rule: 'protocol, different company', value: code, companies: [a.sponsor_raw, b.sponsor_raw] });
  }
  // 4. Same company, same phase, start dates within 60 days, similar titles and the same drug: queued with a score, never
  //    merged. Two drugs are the same when a name or code matches, or both names belong to one drug in drug_alias.
  //    A record that names no drug (CTIS holds back Phase 1 details) is not queued by this rule.
  const aliasDrugs = new Map();
  for (const x of db.prepare('SELECT alias_norm, drug_id FROM drug_alias').all()) { if (!aliasDrugs.has(x.alias_norm)) aliasDrugs.set(x.alias_norm, []); aliasDrugs.get(x.alias_norm).push(x.drug_id); }
  const drugKeys = new Map();
  const drugsOf = r => {
    if (!drugKeys.has(K(r))) {
      const keys = new Set();
      for (const p of JSON.parse(r.products || '[]')) for (const n of [p.name, p.substance, p.sub, ...(p.other || [])]) {
        for (const k of new Set([norm(n), norm(stripSalt(n))])) if (k.length >= 4 && !GENERIC_NAMES.has(k)) { keys.add(k); for (const d of aliasDrugs.get(k) || []) keys.add('drug:' + d); }
      }
      drugKeys.set(K(r), keys);
    }
    return drugKeys.get(K(r));
  };
  const byCo = new Map();
  for (const r of recs) { const co = coRoot(r); if (!co) continue; if (!byCo.has(co)) byCo.set(co, []); byCo.get(co).push(r); }
  for (const list of byCo.values()) {
    if (new Set(list.map(r => r.registry)).size < 2) continue;
    for (const a of list) for (const b of list) {
      if (a.registry >= b.registry || !a.phase || a.phase !== b.phase || find(K(a)) === find(K(b))) continue;
      const days = Math.abs(dayOf(a.start_date) - dayOf(b.start_date)) / 864e5;
      if (!(days <= 60)) continue;
      const sim = similarity(a.title, b.title);
      if (sim < 0.3) continue;
      const shared = [...drugsOf(a)].filter(k => drugsOf(b).has(k));
      if (!shared.length) continue;
      const drug = shared.find(k => k.startsWith('drug:'))?.slice(5) || shared[0];
      candidate(a, b, Math.round((0.3 + sim * 0.4) * 100) / 100, { rule: 'similar', phase: a.phase, start_days_apart: Math.round(days), title_similarity: Math.round(sim * 100) / 100, drug });
    }
  }
  // Hand-checked pairs, last: nothing automatic can undo them.
  for (const [x, y, source] of sameStudy) {
    const a = byId.get(String(x).toUpperCase()), b = byId.get(String(y).toUpperCase());
    if (a && b) join(a, b, 'hand', { source: source || 'seed' }, { force: true });
  }

  // ---------- write ----------
  const groups = [...members.values()];
  const studyId = list => list.slice().sort((a, b) => REG_ORDER.indexOf(a.registry) - REG_ORDER.indexOf(b.registry) || a.record_id.localeCompare(b.record_id))[0];
  const newest = list => list.slice().sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || '')))[0];
  const precise = (list, f) => list.map(r => r[f]).filter(Boolean).sort((a, b) => b.length - a.length)[0] || null;
  const titleOf = list => list.slice().sort((a, b) => (a.title_lang && a.title_lang !== 'en') - (b.title_lang && b.title_lang !== 'en') || REG_ORDER.indexOf(a.registry) - REG_ORDER.indexOf(b.registry))[0]?.title || null;
  db.transaction(() => {
    db.exec("DELETE FROM study; DELETE FROM study_link; DELETE FROM match_candidate WHERE type='study' AND status='open';");
    const insS = db.prepare('INSERT INTO study (id, title, phase, phase_label, status, start_date, primary_completion, registries, n_records, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insL = db.prepare('INSERT INTO study_link (registry, record_id, study_id, rule, evidence, decided_by, date) VALUES (?,?,?,?,?,?,?)');
    const setR = db.prepare('UPDATE trial_record SET study_id=? WHERE registry=? AND record_id=?');
    const setTP = db.prepare('UPDATE trial_program SET study_id=? WHERE nct=?');
    for (const list of groups) {
      const head = studyId(list), n = newest(list);
      insS.run(head.record_id, titleOf(list), n.phase, n.phase_label, n.status, precise(list, 'start_date'), precise(list, 'primary_completion'),
        JSON.stringify([...new Set(list.map(r => r.registry))]), list.length, n.last_updated);
      for (const r of list) {
        const h = r === head ? { rule: 'own', evidence: null, decided_by: 'auto', date: today } : how.get(K(r));
        insL.run(r.registry, r.record_id, head.record_id, h.rule, h.evidence ? JSON.stringify(h.evidence) : null, h.decided_by, h.date);
        setR.run(head.record_id, r.registry, r.record_id);
        if (r.registry === 'ctgov') setTP.run(head.record_id, r.record_id);
      }
    }
    const reviewed = new Set(db.prepare("SELECT left_id || '|' || right_id FROM match_candidate WHERE type='study'").pluck().all());
    const insC = db.prepare("INSERT OR IGNORE INTO match_candidate (type, left_id, right_id, score, reasons) VALUES ('study',?,?,?,?)");
    for (const c of candidates.values()) {
      const a = byId.get(c.left.toUpperCase()), b = byId.get(c.right.toUpperCase());
      if (find(K(a)) === find(K(b)) || reviewed.has(`${c.left}|${c.right}`)) continue;
      if (blocked.has(pairKey(c.left.toUpperCase(), c.right.toUpperCase()))) continue;   // hand-checked: not the same study
      insC.run(c.left, c.right, c.score, JSON.stringify(c.reasons)); counts.candidates++;
    }
  })();
  return { records: recs.length, studies: groups.length, merged_studies: groups.filter(g => g.length > 1).length, ...counts };
}

// ---------- drugs ----------
// Salt words removed before matching names ("inclisiran sodium" -> "inclisiran"); the same list link.js uses for openFDA.
export const stripSalt = s => String(s || '').toLowerCase().replace(/\s+(calcium|sodium|potassium|hydrochloride|hcl|mesylate|maleate|tartrate|acetate|citrate|sulfate|phosphate|besylate|fumarate|succinate|bromide|chloride|dihydrate|monohydrate)\b.*/g, '');

// An automatic alias comes only from a pairing the source itself makes (Drugs@FDA brand + ingredient, EMA medicine + INN).
// It is refused if the name already belongs to another drug (that would merge two drugs) or the pair is blocked by hand.
export function addAutoAlias(db, { alias, drug_id, kind, lang = 'en', evidence_url }) {
  const n = norm(alias);
  if (!n || n.length < 3) return 'too short';
  const have = db.prepare('SELECT drug_id FROM drug_alias WHERE alias_norm=?').pluck().all(n);
  if (have.includes(drug_id)) return 'exists';
  if (have.length) return 'names another drug';
  // notSameDrug pairs are names (cleaned): block if the new name is paired with any name of this drug.
  const names = JSON.stringify(db.prepare('SELECT alias_norm FROM drug_alias WHERE drug_id=?').pluck().all(drug_id));
  if (db.prepare("SELECT 1 FROM not_same WHERE type='drug' AND ((a=? AND b IN (SELECT value FROM json_each(?))) OR (b=? AND a IN (SELECT value FROM json_each(?))))").get(n, names, n, names)) return 'blocked by hand';
  db.prepare('INSERT INTO drug_alias (alias_norm, alias, drug_id, confirmed, source, kind, lang, auto, evidence_url) VALUES (?,?,?,1,?,?,?,1,?)')
    .run(n, alias, drug_id, `automatic: ${kind}`, kind, lang, evidence_url || null);
  return 'added';
}

// Finds the program a regulator decision or filing is about.
//   resolve({ names: ['Foundayo', 'orforglipron'], holder: 'Eli Lilly Nederland B.V.' }) -> { program_id, drug_id } | null
// Hand-checked drugs: any of their names, and the holder must be one of the drug's companies (or their subsidiaries).
// Other programs: the program's registry name, and the holder must look like the trial sponsor (same rule link.js uses).
// A biosimilar or generic by another company therefore never lands on the originator's program.
export function programResolver(db = getDb()) {
  const resolveCo = companyResolver(db);
  const alias = new Map();
  for (const a of db.prepare('SELECT alias_norm, drug_id FROM drug_alias').all()) {
    if (!alias.has(a.alias_norm)) alias.set(a.alias_norm, new Set());
    alias.get(a.alias_norm).add(a.drug_id);
  }
  const drugCos = new Map(db.prepare('SELECT id, companies FROM drug').all().map(d => [d.id, JSON.parse(d.companies || '[]')]));
  const curatedProg = new Set(db.prepare('SELECT id FROM program WHERE curated=1').pluck().all());
  const autoByName = new Map();
  for (const p of db.prepare('SELECT id, name, company FROM program WHERE curated=0').all()) {
    const k = norm(p.name); if (!autoByName.has(k)) autoByName.set(k, []); autoByName.get(k).push(p);
  }
  // Holder and sponsor are the same company when the first word (4+ letters) of one is a whole word of the other:
  // "ELI LILLY AND CO" = "Eli Lilly and Company"; "JANSSEN BIOTECH" is not "Bio-Thera Solutions".
  const words = s => String(s || '').toLowerCase().match(/[a-z]{4,}/g) || [];
  const sameCo = (a, b) => { const A = words(a), B = words(b); return !!A.length && !!B.length && (B.includes(A[0]) || A.includes(B[0])); };
  return function resolve({ names = [], holder = null, company_id = null }) {
    const co = company_id || (holder ? resolveCo(holder) : null);
    const keys = [...new Set(names.flatMap(n => [norm(n), norm(stripSalt(n))]).filter(k => k && k.length >= 3))];
    for (const k of keys) for (const d of alias.get(k) || []) {
      const owners = (drugCos.get(d) || []).map(c => resolveCo.root(c));
      if (co && owners.includes(co) && curatedProg.has(d)) return { program_id: d, drug_id: d, via: k };
    }
    for (const k of keys) {
      const hits = (autoByName.get(k) || []).filter(p => holder && sameCo(holder, p.company));
      if (hits.length === 1) return { program_id: hits[0].id, drug_id: null, via: k };
    }
    return null;
  };
}

// ---------- hand-checked overrides from the seed files ----------
// companyParents: [[childId or subsidiary name, parentId, source]]; notSameStudy: [[recordId, recordId, reason]];
// notSameDrug: [[name, name, reason]] (any names or codes of the two drugs); companyAliases: [[companyId, name, lang, kind, source]]. Also fills company_alias
// with each seed company's name and registry patterns, so matching knows them.
export function applySeedOverrides(db, seeds) {
  db.transaction(() => {
    db.exec("DELETE FROM not_same; DELETE FROM company_alias WHERE auto=0; UPDATE company SET parent_id=NULL;");
    const insN = db.prepare('INSERT OR IGNORE INTO not_same (type, a, b, reason) VALUES (?,?,?,?)');
    const insA = db.prepare('INSERT OR IGNORE INTO company_alias (company_id, alias, alias_norm, lang, kind, auto, evidence_url) VALUES (?,?,?,?,?,0,?)');
    const setP = db.prepare('UPDATE company SET parent_id=? WHERE id=?');
    for (const c of db.prepare('SELECT id, name FROM company').all()) insA.run(c.id, c.name, normCompany(c.name), 'en', 'name', null);
    for (const s of seeds) {
      for (const [a, b, why] of s.notSameStudy || []) { const [x, y] = [String(a).toUpperCase(), String(b).toUpperCase()].sort(); insN.run('study', x, y, why || null); }
      for (const [a, b, why] of s.notSameDrug || []) { const [x, y] = [norm(a), norm(b)].sort(); insN.run('drug', x, y, why || null); }
      for (const [child, par, src] of s.companyParents || []) {
        if (db.prepare('SELECT 1 FROM company WHERE id=?').get(child)) setP.run(par, child);
        else insA.run(par, child, normCompany(child), 'en', 'subsidiary', src || null);   // a subsidiary we have no row for: a name
      }
      for (const [co, name, lang, kind, src] of s.companyAliases || []) insA.run(co, name, normCompany(name), lang || 'en', kind || 'name', src || null);
    }
  })();
}

// The programs of each company, with every name they go by, for finding a drug named in a filing or letter.
//   const of = companyPrograms(db); of('lilly') -> [{ program_id, drug_id, name, names: Set of cleaned names }]
// Keys are what companyResolver returns: a seed company id (top parent) or "name:<cleaned sponsor name>".
const GENERIC_NAMES = new Set(['placebo', 'standardofcare', 'chemotherapy', 'insulin', 'metformin', 'saline', 'vaccine', 'antibody', 'injection', 'tablet', 'drug']);
export function companyPrograms(db = getDb()) {
  const resolveCo = companyResolver(db);
  const by = new Map();
  const add = (k, p) => { if (!k) return; if (!by.has(k)) by.set(k, []); by.get(k).push(p); };
  for (const p of db.prepare('SELECT id, drug_id, name, aliases, company, company_ids, curated FROM program').all()) {
    const names = new Set([p.name, ...JSON.parse(p.aliases || '[]').map(a => a.name)].map(n => norm(n)).filter(n => n.length >= 4 && !GENERIC_NAMES.has(n)));
    if (p.drug_id) for (const a of db.prepare("SELECT alias_norm FROM drug_alias WHERE drug_id=? AND source != 'misspelling'").pluck().all(p.drug_id)) if (a.length >= 4) names.add(a);
    const prog = { program_id: p.id, drug_id: p.drug_id, name: p.name, curated: !!p.curated, names };
    const keys = p.curated ? JSON.parse(p.company_ids || '[]').map(c => resolveCo.root(c)) : [resolveCo(p.company)];
    for (const k of new Set(keys)) add(k, prog);
  }
  const of = key => by.get(key) || [];
  of.resolve = resolveCo;
  return of;
}
// Which of these programs a piece of text names (word sequences, cleaned as norm() does: "LY-3305677" = "LY3305677"),
// hand-checked drugs first, then in the order the text names them (the first drug named is usually the subject).
export function programsNamedIn(text, progs) {
  const t = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const first = new Map();
  for (let n = 4; n >= 1; n--) for (let i = 0; i + n <= t.length; i++) { const g = t.slice(i, i + n).join(''); if (!first.has(g) || first.get(g) > i) first.set(g, i); }
  return progs.map(p => ({ p, at: Math.min(...[...p.names].map(n => first.get(n) ?? Infinity)) })).filter(x => x.at < Infinity)
    .sort((a, b) => b.p.curated - a.p.curated || a.at - b.at).map(x => x.p);
}
