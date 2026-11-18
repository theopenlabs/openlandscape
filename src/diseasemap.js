// The disease map: which registry disease terms sit under which, and which listed condition wordings sit under each term.
// Built from the registry's own standard disease terms (MeSH, table trial_mesh): a term's parents are the terms the
// registry lists with it in nearly every trial. Hand corrections (seed/disease-map.csv) take a child out of a parent where
// the registry's tree is wrong for someone searching: psoriatic arthritis out of psoriasis, pulmonary hypertension out of
// hypertension. A disease search includes its sub-diseases (query.js meshTrials); the "Included" line says which, and how
// many of the trials the registry tags with the disease the search found.
import { readFileSync, existsSync } from 'node:fs';
import { getDb } from './db.js';
import { anyOrder, foldText, loadStamp, landscape, endOf } from './query.js';

const ACTIVE = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION']);

// "Carcinoma, Hepatocellular" -> "Hepatocellular Carcinoma", "Leukemia, Myeloid, Acute" -> "Acute Myeloid Leukemia".
// A trailing number stays last: "Diabetes Mellitus, Insulin-Dependent, 10" -> "Insulin-Dependent Diabetes Mellitus 10".
export const prettyTerm = t => { const p = String(t).split(', '), n = p.length > 1 && /^\d+$/.test(p[p.length - 1]) ? [p.pop()] : []; return [...p.reverse(), ...n].join(' '); };
const slugOf = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const termSlug = t => slugOf(prettyTerm(t));
// Until 17 Nov 2026 the number came first ("10-insulin-dependent-diabetes-mellitus"); those addresses still find the term.
const oldSlug = t => slugOf(String(t).split(', ').reverse().join(' '));

function csvRows(text) {
  const rows = [];
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map(c => c.trim()));
  }
  return rows;
}
function exclusions() {
  const out = new Map();   // parent key -> [{ child key, child name, note }]
  for (const [parent, child, note] of csvRows(readFileSync(new URL('../seed/disease-map.csv', import.meta.url), 'utf8'))) {
    const pk = parent;
    if (!out.has(pk)) out.set(pk, []);
    out.get(pk).push({ key: child, name: child, note });
  }
  return out;
}

// seed/mesh-tree.csv (scripts/mesh-tree.mjs): where each term sits in the MeSH tree. A tree number like C06.552.697.160
// sits under C06.552.697; a supplementary concept (a named syndrome) has none and maps to descriptors instead.
function meshTree() {
  const out = new Map();
  for (const [term, tn, mapped] of csvRows(readFileSync(new URL('../seed/mesh-tree.csv', import.meta.url), 'utf8')))
    out.set(term, { tn: tn ? tn.split(';') : [], mapped: mapped ? mapped.split(';') : [] });
  return out;
}

let cache = null;
// nodes: term name -> { name, key (search key, query.js anyOrder), trials: Set of ncts tagged with it, active: n,
//   direct: Set of parent names, parents: Set of every ancestor's name, children: Set of direct children's names (hand exclusions removed) }
// byKey: search key -> the term name with most trials among the terms sharing that key (carcinoma, neoplasm and cancer are one search word)
// wordings: lower-cased listed condition -> { label, term: name|null, n, active, how }
export function diseaseMap() {
  const stamp = loadStamp();
  if (cache?.stamp === stamp) return cache;
  const db = getDb();
  const tree = meshTree();
  const status = new Map(db.prepare('SELECT nct, status FROM trial').all().map(t => [t.nct, t.status]));
  const nodes = new Map(), ownTags = new Map();
  const node = k => nodes.get(k) || nodes.set(k, { key: anyOrder(k), name: k, trials: new Set(), active: 0, direct: new Set(), parents: new Set(), children: new Set() }).get(k);
  for (const m of db.prepare('SELECT nct, term, ancestor FROM trial_mesh').all()) {
    const n = node(m.term);   // a broader term the registry lists is a node even when no trial is tagged with it directly
    if (m.ancestor) continue;
    n.trials.add(m.nct); if (ACTIVE.has(status.get(m.nct))) n.active++;
    if (!ownTags.has(m.nct)) ownTags.set(m.nct, new Set());
    ownTags.get(m.nct).add(m.term);
  }
  const byKey = new Map();
  for (const n of nodes.values()) if (!byKey.has(n.key) || nodes.get(byKey.get(n.key)).trials.size < n.trials.size) byKey.set(n.key, n.name);
  // Parents from the tree: the nearest term above each tree number that is one of our nodes; a supplementary concept's
  // parents are the descriptors it maps to.
  const byTn = new Map();
  for (const [k, t] of tree) if (nodes.has(k)) for (const tn of t.tn) byTn.set(tn, k);
  for (const n of nodes.values()) {
    const t = tree.get(n.name); if (!t) continue;
    for (const tn of t.tn) { let up = tn; while (up.includes('.')) { up = up.slice(0, up.lastIndexOf('.')); if (byTn.has(up)) { n.direct.add(byTn.get(up)); break; } } }
    for (const m of t.mapped) if (nodes.has(m) && m !== n.name) n.direct.add(m);
  }
  for (const n of nodes.values()) {
    const seen = new Set(), stack = [...n.direct];
    while (stack.length) { const p = stack.pop(); if (seen.has(p)) continue; seen.add(p); stack.push(...nodes.get(p).direct); }
    seen.delete(n.name); n.parents = seen;
  }
  const excluded = exclusions();
  for (const n of nodes.values()) for (const p of n.direct) if (!excluded.get(p)?.some(e => e.key === n.name)) nodes.get(p).children.add(n.name);
  // Listed condition wordings, placed on a term: trials that list only this wording and share one tag place it best; else
  // among the tags on at least half of its trials, the narrowest (a tag that is a broader term of another candidate is
  // dropped: "NSCLC" goes to the lung carcinoma, not to lung cancer), then the most frequent.
  const wordings = new Map(), listed = new Map();
  for (const t of db.prepare('SELECT nct, status, conditions FROM trial').all()) {
    const conds = [...new Set(JSON.parse(t.conditions || '[]').map(c => c.trim()).filter(Boolean))];
    listed.set(t.nct, conds.map(c => c.toLowerCase()));
    const tags = ownTags.get(t.nct);
    for (const c of conds) {
      const k = c.toLowerCase();
      if (!wordings.has(k)) wordings.set(k, { label: c, n: 0, active: 0, tagged: 0, solo: 0, tags: new Map(), soloTags: new Map(), term: null, how: null });
      const w = wordings.get(k);
      w.n++; if (ACTIVE.has(t.status)) w.active++;
      if (!tags) continue;
      w.tagged++; if (conds.length === 1) w.solo++;
      for (const x of tags) { w.tags.set(x, (w.tags.get(x) || 0) + 1); if (conds.length === 1) w.soloTags.set(x, (w.soloTags.get(x) || 0) + 1); }
    }
  }
  // Wordings the registry's tags cannot place, placed by a model (seed/disease-wordings.csv, from the batch read of 8 Nov 2026):
  // only where a term is given and the wording is still unplaced; "-" marks a wording that is not a disease.
  const modelPlaced = new Map();
  const seedFile = new URL('../seed/disease-wordings.csv', import.meta.url);
  if (existsSync(seedFile)) for (const [wording, term] of csvRows(readFileSync(seedFile, 'utf8'))) if (term && term !== '-' && nodes.has(term)) modelPlaced.set(wording.toLowerCase(), term);
  for (const w of wordings.values()) {
    const solo = [...w.soloTags].sort((a, b) => b[1] - a[1])[0];
    if (solo && solo[1] / w.solo >= 0.6) { w.term = solo[0]; w.how = 'solo'; }
    else {
      const cands = [...w.tags].filter(([, c]) => c / w.tagged >= 0.5);
      const best = cands.filter(([x]) => !cands.some(([y]) => y !== x && nodes.get(y).parents.has(x))).sort((a, b) => b[1] - a[1])[0];
      if (best) { w.term = best[0]; w.how = 'lift'; }
      else if (modelPlaced.has(w.label.toLowerCase())) { w.term = modelPlaced.get(w.label.toLowerCase()); w.how = 'model'; }
      else w.how = w.tagged ? 'mixed' : 'untagged';
    }
    delete w.tags; delete w.soloTags;
  }
  // A search key for a wording ("nash", "crohn disease") finds the term it is placed on; the wording with most trials wins.
  const wordingByKey = new Map();
  for (const w of wordings.values()) { if (!w.term) continue; const k = anyOrder(w.label); const cur = wordingByKey.get(k); if (!cur || cur.n < w.n) wordingByKey.set(k, w); }
  const bySlug = new Map([...nodes.values()].flatMap(n => [[oldSlug(n.name), n.name], [termSlug(n.name), n.name]]));
  return (cache = { stamp, nodes, byKey, ownTags, wordings, wordingByKey, listed, excluded, bySlug, status });
}
// The term and everything under it, minus the hand-excluded branches. Term names.
export function subtree(key) {
  const { nodes, excluded } = diseaseMap();
  if (!nodes.has(key)) return new Set();
  const out = new Set(), drop = new Set();
  const dropAll = k => { if (drop.has(k)) return; drop.add(k); for (const n of nodes.values()) if (n.parents.has(k)) drop.add(n.name); };
  for (const e of excluded.get(key) || []) dropAll(e.key);
  out.add(key);
  for (const n of nodes.values()) if (n.parents.has(key) && !drop.has(n.name)) out.add(n.name);
  // A branch excluded under the term is also excluded when it hangs under one of the term's children.
  for (const k of [...out]) for (const e of excluded.get(k) || []) { dropAll(e.key); }
  for (const d of drop) out.delete(d);
  return out;
}

// The map's terms for a disease search: the search's own words as a term, the term its wording is placed on, or else
// ("alzheimer", "solid tumor") the tag that most of the trials its words found carry, when that is at least half of them.
export function termsFor(keys, q, wordFound = null) {
  const { nodes, byKey, wordings, wordingByKey, ownTags } = diseaseMap();
  // Of several terms for one search ("nash", "mash", "steatohepatitis" name one disease), the narrowest: a term that is a
  // broader term of another is dropped.
  const narrowest = terms => { const t = [...new Set(terms)]; return t.filter(x => !t.some(y => y !== x && nodes.get(y).parents.has(x))); };
  const found = keys.filter(k => byKey.has(k)).map(k => byKey.get(k));
  if (found.length) return narrowest(found);
  if (q == null) return [];   // letters that stand for two diseases ("AD") name no one term
  // A term reached through a wording, or through the tags on the trials the words found, must agree with those trials
  // both ways: most of the term's active trials are among them, and the term is on most of them. "hfpef" is placed on
  // heart failure by the registry but is not all of heart failure; "parkinsons" is listed once beside insomnia.
  const agrees = term => {
    if (!wordFound) return true;
    const n = nodes.get(term); let both = 0, active = 0;
    for (const nct of n.trials) if (ACTIVE.has(diseaseMap().status.get(nct))) { active++; if (wordFound.has(nct)) both++; }
    return active >= 3 && both >= active / 2;
  };
  // A wording listed by fewer than 3 trials is too thin to name the disease, and one placed only by its company of tags
  // (not by trials listing it alone) must share a word with the term: "Wet AMD" sat beside blindness, "Crohn's" alone means Crohn Disease.
  const names = w => w.n >= 3 && (w.how === 'solo' || foldText(w.label).split(' ').some(x => x.length > 2 && foldText(w.term).split(' ').includes(x)));
  const placed = keys.filter(k => wordingByKey.has(k) && names(wordingByKey.get(k))).map(k => wordingByKey.get(k).term);
  const w = wordings.get(String(q).trim().toLowerCase());
  if (w?.term && names(w)) placed.push(w.term);
  const ok = narrowest(placed).filter(agrees);
  if (ok.length) return ok;
  if (!wordFound) return [];
  const count = new Map(); let tagged = 0;
  for (const nct of wordFound) { const tags = ownTags.get(nct); if (!tags) continue; tagged++; for (const t of tags) count.set(t, (count.get(t) || 0) + 1); }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best && tagged >= 3 && best[1] >= tagged / 2 && agrees(best[0]) ? [best[0]] : [];
}
// A disease search's terms and everything under them, as { key: search key (query.js anyOrder), name } for matching trials' tags and wordings.
export function includedTerms(keys, q, wordFound) {
  const { nodes } = diseaseMap();
  const out = new Map();
  for (const t of termsFor(keys, q, wordFound)) for (const n of subtree(t)) out.set(nodes.get(n).key, n);
  return out;
}

// What a disease search included, for the "Included" line: the sub-diseases found (with active trial counts), the
// branches left out by hand, and coverage against the registry's own tags.
export function included(keys, q, foundNcts) {
  const map = diseaseMap();
  const terms = termsFor(keys, q, foundNcts);
  if (!terms.length || !foundNcts) return null;
  const { nodes, excluded, status, wordings, listed } = map;
  const isActive = n => ACTIVE.has(status.get(n));
  const incl = new Set(terms.flatMap(t => [...subtree(t)]));
  // Trials the registry tags with the disease. The tags are made by machine and a few are plainly wrong (cancer trials
  // tagged with a Lewy body gene): a tagged trial counts only when a listed condition is placed under the disease, or is not placed at all.
  const agrees = nct => (listed.get(nct) || []).some(c => { const w = wordings.get(c); return !w?.term || incl.has(w.term); });
  const tagged = new Set();
  for (const k of incl) for (const n of nodes.get(k).trials) if (isActive(n) && agrees(n)) tagged.add(n);
  const found = new Set([...foundNcts].filter(isActive));
  const both = [...tagged].filter(n => found.has(n)).length;
  const children = [];
  for (const t of terms) for (const c of nodes.get(t).children) {
    const sub = subtree(c); let active = 0;
    for (const k of sub) for (const n of nodes.get(k).trials) if (found.has(n)) active++;
    if (active) children.push({ term: nodes.get(c).name, name: prettyTerm(nodes.get(c).name), slug: termSlug(nodes.get(c).name), active });
  }
  children.sort((a, b) => b.active - a.active);
  const leftOut = terms.flatMap(t => (excluded.get(t) || []).filter(e => nodes.has(e.key)).map(e => ({ term: e.name, name: prettyTerm(e.name), slug: termSlug(e.name), note: e.note })));
  const main = nodes.get(terms[0]);
  return {
    term: main.name, name: prettyTerm(main.name), slug: termSlug(main.name), terms: terms.map(t => nodes.get(t).name),
    children, left_out: leftOut,
    coverage: { tagged: tagged.size, found: both, pct: tagged.size ? Math.round(100 * both / tagged.size) : null, extra: found.size - both },
  };
}

// The breakdown page: a term, its parents, its sub-diseases with trial and drug counts, the wordings placed on it.
export function breakdown(slug) {
  const { nodes, bySlug, wordings, excluded, status } = diseaseMap();
  const key = bySlug.get(slug); if (!key) return null;
  const n = nodes.get(key), db = getDb();
  const progs = ncts => ncts.length ? db.prepare(`SELECT count(DISTINCT program_id) FROM trial_program WHERE nct IN (SELECT value FROM json_each(?))`).pluck().get(JSON.stringify(ncts)) : 0;
  const activeIn = keys => { const s = new Set(); for (const k of keys) for (const x of nodes.get(k).trials) if (ACTIVE.has(status.get(x))) s.add(x); return [...s]; };
  const row = k => { const a = activeIn(subtree(k)); return { term: nodes.get(k).name, name: prettyTerm(nodes.get(k).name), slug: termSlug(nodes.get(k).name), active: a.length, drugs: progs(a), children: nodes.get(k).children.size }; };
  const all = activeIn(subtree(key));
  const ws = [...wordings.values()].filter(w => w.term === key && w.active).sort((a, b) => b.active - a.active);
  return {
    term: n.name, name: prettyTerm(n.name), slug: termSlug(n.name), active: all.length, drugs: progs(all),
    parents: [...n.direct].map(p => ({ term: nodes.get(p).name, name: prettyTerm(nodes.get(p).name), slug: termSlug(nodes.get(p).name) })),
    children: [...n.children].map(row).sort((a, b) => b.active - a.active),
    left_out: (excluded.get(key) || []).filter(e => nodes.has(e.key)).map(e => ({ ...row(e.key), note: e.note })),
    wordings: ws.map(w => ({ label: w.label, active: w.active, how: w.how })),
  };
}

// Numbers for the docs and the check: wordings placed and not.
export function placement() {
  const { wordings } = diseaseMap();
  const c = { solo: 0, lift: 0, model: 0, mixed: 0, untagged: 0, total: wordings.size };
  for (const w of wordings.values()) c[w.how]++;
  return c;
}

// ---------- a disease page's drugs (step 18, 18 Nov 2026) ----------
// The drugs in the active trials tagged with the disease or one under it, at any stage: the same trials the page counts, so
// the list and its number agree (a Search for the name reads titles and drug names, and differs on about 60 pages). Drugs
// still in development come first (Filed, Phase 3 … Phase 1), approved and marketed ones after; within a stage the soonest
// next date first. Signed out a page shows the top DISEASE_TOP; signed in the whole list, cut at DISEASE_CAP.
export const DISEASE_TOP = 10, DISEASE_CAP = 500;
export function diseaseDrugs(slug) {
  const { nodes, bySlug, status } = diseaseMap();
  const term = bySlug.get(slug); if (!term) return null;
  const ncts = new Set();
  for (const k of subtree(term)) for (const n of nodes.get(k).trials) if (ACTIVE.has(status.get(n))) ncts.add(n);
  const L = ncts.size ? landscape({ area: prettyTerm(term), phase_min: 0, limit: 1e6, ncts })
    : { area: prettyTerm(term), programs: [], stats: { programs: 0, trials: 0, by_phase: [], china: 0 } };
  const ordered = [...L.programs.filter(p => p.phase.level < 5), ...L.programs.filter(p => p.phase.level >= 5)];
  // The next result that matters: the soonest date of a drug in Phase 3 or filed (old drugs' Phase 4 trials and early trials skipped).
  const late = ordered.filter(p => p.phase.level >= 3 && p.phase.level < 5 && p.next_catalyst)
    .sort((x, y) => endOf(x.next_catalyst.date).localeCompare(endOf(y.next_catalyst.date)))[0];
  const { programs: _, summary: __, ...rest } = L;
  return { ...rest, programs: ordered.slice(0, DISEASE_CAP), late: late ? { id: late.id, drug: late.drug, when: late.next_catalyst.label || late.next_catalyst.date } : null };
}
// What a signed-out page needs, kept in memory for every disease (src/diseasetop.js): the counts, the next result and the top rows.
export const diseaseSummary = L => ({ area: L.area, stats: L.stats, late: L.late, programs: L.programs.slice(0, DISEASE_TOP) });

// The name people search for, when the registry's term is not it: "Breast Neoplasms" -> "Breast Cancer", "Type 2 Diabetes
// Mellitus" -> "Type 2 Diabetes", "Non-Small-Cell Lung Carcinoma" -> "Non-small Cell Lung Cancer". Used only when trials
// themselves write it that way (a listed condition with at least 3 active trials): 36 pages on 17 Nov data. null: the name is fine.
const foldW = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let plainMemo = null;
export function plainName(name) {
  const m = diseaseMap();
  if (plainMemo?.stamp !== m.stamp) {
    const byFold = new Map();
    for (const w of m.wordings.values()) { const k = foldW(w.label), c = byFold.get(k); if (!c || c.active < w.active) byFold.set(k, w); }
    plainMemo = { stamp: m.stamp, byFold };
  }
  for (const [re, to] of [[/\bNeoplasms?\b/, 'Cancer'], [/\bDiabetes Mellitus\b/, 'Diabetes'], [/\bLung Carcinoma\b/, 'Lung Cancer']]) {
    if (!re.test(name)) continue;
    const c = name.replace(re, to), w = plainMemo.byFold.get(foldW(c));
    if (w && w.active >= 3) return c.replace(/\b(\w)(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase()).replace(/\bAnd\b/g, 'and');
  }
  return null;
}

// ---------- links between pages (step 20, 18 Nov 2026) ----------
// The disease page a trial's listed condition ("Breast Cancer") is placed on, for drug pages' "Tested for". null: none.
// A wording placed from other conditions' tags in one or two trials can land wrong ("Chronic Low Back Pain" listed in a
// retatrutide trial sits under Obesity), so those stay unlinked: only a wording trials list on its own, or one in 3+ trials.
export function wordingSlug(label) {
  const w = diseaseMap().wordings.get(String(label).trim().toLowerCase());
  return w?.term && (w.how === 'solo' || w.n >= 3) ? termSlug(w.term) : null;
}
// Every disease page the sitemap lists, by name, for the /diseases index. `direct`: active trials tagged with the term
// itself, so the broad headings ("Neoplasms by Site") that only gather others do not rank first.
export function diseaseIndex() {
  const { nodes } = diseaseMap(), seen = new Set(), out = [];
  for (const n of nodes.values()) {
    if (!(n.active > 0)) continue;
    const slug = termSlug(n.name); if (seen.has(slug)) continue; seen.add(slug);
    out.push({ name: plainName(n.name) || prettyTerm(n.name), slug, term: n.name, direct: n.active });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
