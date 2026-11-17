// One drug, one row: folds automatic rows of one company that name the same drug. Runs at the end of druglists.js group(),
// after the official-list grouping, so it cannot change which company a drug is grouped under.
// Rules, all within one company (company families and sponsor spellings count as one):
//  - Same name, or the same name plus a form, dose or arm word: "Ruxolitinib Cream", "Blinded X", "X QD", "X Prefilled Pen", salts, FDA suffixes.
//  - One misspelt letter in a long word ("Iptcaopan").
//  - The registry gives one row's name as another name of the other row, seen often enough ("LOU064", also remibrutinib),
//    or once when one of the two is a code ("RTN-001", also SLx-2101).
//  - A trial's own text gives both names as one drug, one of them a code: "Recombinant 14-valent HPV vaccine (SCT1000)".
//  - The public databases give both names one official ID (src/ingest/namemap.js): the same FDA substance, NCI code, or a
//    code the FDA entry lists; or one row's PubChem name is a compound the other row's official entry lists (lacutoclax, LP-108).
//  - The same parts in another order or form ("Baxdrostat and dapagliflozin", "Baxdrostat/dapagliflozin").
//  - "X + Y" or "X and Y" where X and Y each have a row: the trials go on both rows and the combination row goes. "X/Y" stays: usually one product.
// When unsure rows stay apart: a wrong merge is worse than a duplicate. Hand-checked drugs are never touched and reviewed "apart" pairs stay apart.
import { getDb } from '../db.js';
import { DRUG_DECISIONS } from '../../seed/drug-decisions.js';
import { DRUG_RIGHTS, DRUG_OWNER } from '../../seed/ownership.js';

const nrm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SALT = /(?:\s+(?:mesylate|mesilate|dimesylate|hydrochloride|dihydrochloride|hcl|sodium|disodium|potassium|calcium|magnesium|maleate|dimaleate|tartrate|bitartrate|acetate|citrate|sulfate|sulphate|phosphate|besylate|fumarate|succinate|adipate|tosylate|ditosylate|bromide|chloride|hydrate|dihydrate|monohydrate|olamine|decanoate|anhydrous))+$/i;
// FDA four-letter suffix, in lower case: "onasemnogene abeparvovec-xioi", not "ARO-ENaC" or "RAPA-501-Allo".
const FDA_SUFFIX = /(?<=[a-z0-9])-(?!cell|free|like|base|dose|drug|oral)[a-z]{4}$/;
const LEAD = /^(?:genetic:\s*|blinded\s+|unblinded\s+|open[- ]label\s+|double[- ]blind\s+|re-?treatment\s+(?:with\s+)?|test\s+drug\s+|test\s+|investigational\s+|experimental\s+|sub-?cutaneous\s+|intravenous\s+|oral\s+|inhaled\s+|topical\s+)/i;
const TAIL = /[\s_-]+(?:cream|ointment|gel|lotion|foam|spray|suspension|solution|syrup|patch|powder|sachets?|film[- ]coated|enteric|dispersible|chewable|odt|xr|er|sr|ir|pr|la|dr|tos|pre-?filled\s+(?:pen|syringe)|pfs|on-?body\s+injector|obds|auto-?injector|pen|vial|treatment|therapy|single\s+agent|intermediate|alone|monotherapy|product|along|adult|pediatric|paediatric|reference|test|combination|reduced|higher|lower|mid|middle|high|low|qd|bid|tid|qid|q\d+w|qw|s\.?c\.?|i\.?v\.?|md|sd|dp|t\d|vaccines?|drug|investigational\s+vaccine|investigational)$/i;

// A sponsor name as a company label: no legal suffixes or brackets, and SHOUTING names in title case ("RECORDATI GROUP" -> Recordati).
const LEGAL = /[\s,.]*\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|plc|gmbh|ag|sa|srl|bv|nv|pty|pte|kk|ab|as|spa|lp|group|holdings?)\b\.?$/i;
export function shortName(s) {
  let n = String(s || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(), p;
  do { p = n; n = n.replace(LEGAL, '').replace(/[\s,.]+$/, '').trim(); } while (n !== p && n.length > 2);
  if (n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
  return n || s;
}
// A name without its salt and FDA suffix: "Hetrombopag Olamine" -> hetrombopag. Form words stay.
const plain = name => { let s = name.trim(), p; do { p = s; s = s.replace(SALT, '').replace(FDA_SUFFIX, '').trim(); } while (s !== p && s.length > 2); return s; };
// Also without form, dose and arm words: "Ruxolitinib Cream" -> ruxolitinib.
export function canon(name) {
  let s = name.trim(), p;
  do { p = s; s = plain(s.replace(LEAD, '').replace(TAIL, '')); } while (s !== p && s.length > 2);
  return nrm(s);
}
// The form-free spelling of a group: a row called this needs no form word removed ("vaccine" does not count as one).
const isBase = name => nrm(plain(name).replace(/[\s_-]+vaccines?$/i, '')) === canon(name);

// Damerau distance of at most one: one letter added, dropped, changed or two swapped.
export function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) return true;
  return a.slice(i + (a.length >= b.length ? 1 : 0)) === b.slice(i + (b.length >= a.length ? 1 : 0));
}
const words = s => s.split(/[^A-Za-z0-9]+/).filter(Boolean);
// Same words but one, and that one is a long plain word off by one letter, not the first letter. Not "MenACWY"/"MenABCWY", "Vaccine A"/"Vaccine C", "Cecolin"/"Hecolin".
export function misspelt(a, b) {
  const x = words(a), y = words(b);
  if (x.length !== y.length || !x.length) return false;
  const d = x.map((w, k) => (w.toLowerCase() === y[k].toLowerCase() ? -1 : k)).filter(k => k >= 0);
  if (d.length !== 1) return false;
  const [u, v] = [x[d[0]], y[d[0]]];
  const ok = w => w.length >= 7 && /^[A-Za-z]+$/.test(w) && !/[a-z][A-Z]/.test(w);
  return ok(u) && ok(v) && u[0].toLowerCase() === v[0].toLowerCase() && oneEdit(u.toLowerCase(), v.toLowerCase());
}

// Parts of a combination name. Regimen shape: "X + Y", "X and Y". Any shape adds "X/Y".
const REGIMEN = /\s*\+\s*|\s+and\s+/i;
// Two long words joined by a hyphen count as parts too ("Nivolumab-relatlimab FDC" = "Nivolumab + Relatlimab"); only a row with the same parts can match them.
const ANY = /\s*[+/&;]\s*|\s+(?:and|plus|with)\s+|(?<=[a-z]{6})-(?=[a-z]{6})/i;
const parts = (name, re) => name.replace(/\s+FDC$/i, '').split(re).map(s => s.trim()).filter(Boolean);
// Fixed product shape in the registry: a "+" row is two drugs, so a registry other name proves nothing about either.
const isPlus = name => /\s\+\s/.test(name);

// Does a trial's text give a and b as one drug: "a (b)", "b (a)", "a, also known as b", "a, formerly b"? The brackets
// must hold the other name alone, so a list ("Phesgo (pertuzumab, trastuzumab)") or a dose never counts.
const squeeze = s => String(s || '').toLowerCase().replace(/[®™]/g, '').replace(/[\s_-]+/g, ' ').trim();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LINKED = '(?:,?\\s*(?:also known as|also called|aka|a\\.k\\.a\\.|formerly(?: known as)?|previously(?: known as)?)\\s+)';
const LABEL = '(?:(?:code|formerly|previously|also known as|aka|inn|generic name)[:\\s]+)?';
export function textNamesBoth(text, a, b) {
  const t = squeeze(text), x = squeeze(a), y = squeeze(b);
  if (!x || !y || !t.includes(x) || !t.includes(y)) return false;
  return [[x, y], [y, x]].some(([p, q]) =>
    new RegExp(`(?<![a-z0-9])${reEsc(p)}\\s*\\(\\s*${LABEL}${reEsc(q)}\\s*\\)`).test(t) ||
    new RegExp(`(?<![a-z0-9])${reEsc(p)}${LINKED}${reEsc(q)}(?![a-z0-9])`).test(t));
}
// A name that can be one side of such a pair: a single name, not a combination or a list.
const singleName = name => !/[/,+;&]|\s(?:and|plus|with)\s|\badjuvant/i.test(name) && canon(name).length >= 3;

// Is "X + Y" one marketed product rather than two drugs given together? Yes when one FDA application holds every part (the FDA list has a row per ingredient,
// or one "a, b, and c" row), or the registry says fixed-dose or co-formulated, or gives it a trademarked name that is neither part's own (REGEN-COV™).
const PRODUCT_WORD = /\bfdc\b|\bfixed[- ]dose\b|\bco-?formulat|\bco-?packag/i;
const INGREDIENTS = /,\s*(?:and\s+)?|\s+and\s+|\//;
const RELEASE = /\s+(?:extended|modified|delayed|sustained|prolonged)[- ]release$/i;
export function productTest(fdaRows) {
  const apps = new Map();
  for (const r of fdaRows) {
    if (!apps.has(r.appl_no)) apps.set(r.appl_no, { parts: new Set(), brands: new Set() });
    const a = apps.get(r.appl_no);
    a.brands.add(nrm(r.brand));
    for (const x of String(r.ingredient).split(INGREDIENTS)) a.parts.add(canon(x));
  }
  const combined = [...apps.values()].filter(a => a.parts.size > 1);
  const singleBrands = new Set([...apps.values()].filter(a => a.parts.size === 1).flatMap(a => [...a.brands]));
  return (parts, registry = []) => {
    const want = parts.map(x => canon(x.replace(RELEASE, '')));
    if (new Set(want).size < 2) return false;
    if (combined.some(a => want.every(w => a.parts.has(w)))) return true;
    if (registry.some(n => PRODUCT_WORD.test(n))) return true;
    return registry.some(n => /[™®]/.test(n) && !/\s\+\s|\band\b/i.test(n) && !singleBrands.has(nrm(n.replace(/[™®]/g, ''))) && !want.some(w => nrm(n).includes(w)));
  };
}

// First-word company keys that say nothing (many unrelated sponsors share them): those rows only join rows of the same sponsor spelling.
const WEAK = new Set(('inc ltd llc bio cell united laboratorios laboratorio laboratoires laboratory institute molecular alpha nova applied oncology immune the pharm stem cancer green blue oxford precision zhuhai university hospital').split(' ').map(w => 'word:' + w));

export function oneRowPerDrug({ db = getDb(), coKey, resolve, ids, today = new Date().toISOString().slice(0, 10) }) {
  const stats = { same_drug_rows_merged: 0, combination_rows_folded: 0 };
  const progs = db.prepare('SELECT * FROM program WHERE curated=0').all();
  const byId = new Map(progs.map(p => [p.id, p]));
  const trials = new Map(progs.map(p => [p.id, []]));
  for (const t of db.prepare('SELECT tp.program_id, tp.nct, tp.matched_on, t.sponsor FROM trial_program tp JOIN trial t ON t.nct=tp.nct').all())
    trials.get(t.program_id)?.push(t);
  const companyOf = p => {
    const sponsor = trials.get(p.id)[0]?.sponsor || p.company, k = coKey(sponsor);
    return WEAK.has(k) ? 'sponsor:' + nrm(sponsor) : k;
  };
  const byCo = new Map();
  for (const p of progs) { const k = companyOf(p); if (!byCo.has(k)) byCo.set(k, []); byCo.get(k).push(p); }
  // A class name, not one product: on no official list and a row name at three or more companies ("Influenza vaccine",
  // "Pneumococcal conjugate vaccine"). A one-mention link to such a name proves nothing.
  const companiesOf = new Map();
  for (const [k, list] of byCo) for (const p of list) { const c = canon(p.name); if (!companiesOf.has(c)) companiesOf.set(c, new Set()); companiesOf.get(c).add(k); }
  const className = p => { const r = resolve(p.name); return !r.gsrs && !r.nci && companiesOf.get(canon(p.name)).size >= 3; };
  const weakOk = (a, b) => singleName(a.name) && singleName(b.name) && !className(a) && !className(b) && /\d/.test(a.name + b.name);

  // Pairs already reviewed as different drugs.
  const apart = new Set(DRUG_DECISIONS.filter(d => d[2] === 'apart').flatMap(d => [`${d[0]}|${d[1]}`, `${d[1]}|${d[0]}`]));
  const notSame = new Set(db.prepare("SELECT a || '|' || b FROM not_same WHERE type='drug'").pluck().all());
  const blocked = (a, b) => apart.has(`${a.id}|${b.id}`) || notSame.has([nrm(a.name), nrm(b.name)].sort().join('|'));
  // Both on an official list, as different entries: not the same drug.
  const listsDiffer = (a, b) => {
    const x = resolve(a.name), y = resolve(b.name);
    return !!((x.gsrs && y.gsrs && x.gsrs.id !== y.gsrs.id) || (x.nci && y.nci && x.nci.id !== y.nci.id));
  };

  // Application number -> its ingredients; ingredients sold alone in some application.
  const appIngredients = new Map();
  for (const r of db.prepare('SELECT appl_no, ingredient FROM fda_approval').all()) { const k = r.appl_no.replace(/\D/g, ''); if (!appIngredients.has(k)) appIngredients.set(k, new Set()); appIngredients.get(k).add(canon(r.ingredient)); }
  const soldAlone = new Set([...appIngredients.values()].filter(x => x.size === 1).flatMap(x => [...x]));
  const approvedOnlyCombined = p => parts(p.name, ANY).length === 1 && (appIngredients.get(p.status_source?.match(/ApplNo=(\d+)/)?.[1])?.size || 0) > 1 && !soldAlone.has(canon(p.name));

  const up = new Map(progs.map(p => [p.id, p.id]));
  const find = k => { while (up.get(k) !== k) { up.set(k, up.get(up.get(k))); k = up.get(k); } return k; };
  const how = new Map();   // row id -> rules that joined it
  const join = (a, b, rule) => { if (a !== b) { const [x, y] = [find(a.id), find(b.id)]; if (x !== y) { up.set(x, y); for (const p of [a, b]) { if (!how.has(p.id)) how.set(p.id, new Set()); how.get(p.id).add(rule); } } } };

  const others = new Map();
  for (const r of db.prepare("SELECT nct, name, other_names FROM intervention WHERE type IN ('DRUG','BIOLOGICAL','COMBINATION_PRODUCT','GENETIC')").all())
    others.set(r.nct + '|' + r.name, JSON.parse(r.other_names || '[]'));
  // A trial's title, summary, arm labels and intervention descriptions, as one text.
  const texts = new Map();
  const tTrial = db.prepare('SELECT title, summary FROM trial WHERE nct=?'), tArms = db.prepare('SELECT label, interventions FROM trial_arm WHERE nct=?'), tIv = db.prepare('SELECT name, description FROM intervention WHERE nct=?');
  const textOf = nct => {
    if (!texts.has(nct)) { const t = tTrial.get(nct) || {}; texts.set(nct, [t.title, t.summary, ...tArms.all(nct).flatMap(r => [r.label, r.interventions]), ...tIv.all(nct).flatMap(r => [r.name, r.description])].filter(Boolean).map(squeeze).join('\n')); }
    return texts.get(nct);
  };

  for (const list of byCo.values()) {
    if (list.length < 2) continue;
    // Same name, or same name plus form words.
    const by = (f, rule) => {
      const m = new Map();
      for (const p of list) { const k = f(p); if (k && k.length >= 3) { if (!m.has(k)) m.set(k, []); m.get(k).push(p); } }
      for (const g of m.values()) for (let i = 1; i < g.length; i++) join(g[i], g[0], rule);
    };
    by(p => canon(p.name), 'same name or form');
    by(p => { const q = parts(p.name, ANY); return q.length > 1 ? q.map(canon).sort().join('|') : null; }, 'same parts');
    // Misspellings.
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      if (misspelt(list[i].name, list[j].name) && !listsDiffer(list[i], list[j])) join(list[i], list[j], 'one letter');
    // One official ID (the name map). Not when the lists name two different entries or two FDA substances.
    if (ids) {
      const differ = (a, b) => { const x = ids(a.name).uniis, y = ids(b.name).uniis; return listsDiffer(a, b) || (x.size && y.size && ![...x].some(u => y.has(u))); };
      const byOfficial = new Map();
      for (const p of list) for (const t of ids(p.name).A) { if (!byOfficial.has(t)) byOfficial.set(t, []); byOfficial.get(t).push(p); }
      for (const g of byOfficial.values()) for (let i = 1; i < g.length; i++) if (!differ(g[0], g[i])) join(g[i], g[0], 'same official ID');
      for (const p of list) { const c = ids(p.name).P, o = c && (byOfficial.get('cid:' + c) || []).find(x => x !== p && !differ(p, x)); if (o) join(p, o, 'PubChem name of an official compound'); }
    }
    // The registry's other names.
    const name2rows = new Map();
    for (const p of list) { const k = nrm(p.name); if (k.length >= 3) { if (!name2rows.has(k)) name2rows.set(k, []); name2rows.get(k).push(p); } }
    const seen = new Map();   // row id -> other row id -> trials
    for (const p of list) for (const t of trials.get(p.id)) for (const o of others.get(t.nct + '|' + t.matched_on) || []) {
      for (const b of name2rows.get(nrm(String(o).replace(/\([^)]*\)/g, ' ').replace(/[®™]/g, ''))) || []) {
        if (b === p) continue;
        if (!seen.has(p.id)) seen.set(p.id, new Map());
        const m = seen.get(p.id); if (!m.has(b.id)) m.set(b.id, new Set()); m.get(b.id).add(t.nct);
      }
    }
    const pairs = new Set([...seen].flatMap(([a, m]) => [...m.keys()].map(b => [a, b].sort().join('~'))));
    for (const pair of pairs) {
      const [a, b] = pair.split('~').map(id => byId.get(id));
      if (isPlus(a.name) || isPlus(b.name) || listsDiffer(a, b)) continue;
      const nts = id => new Set(trials.get(id).map(t => t.nct));
      if ([...nts(a.id)].some(t => nts(b.id).has(t))) continue;   // both named in one trial: two drugs
      const ab = seen.get(a.id)?.get(b.id)?.size || 0, ba = seen.get(b.id)?.get(a.id)?.size || 0;
      const two = ab && ba;
      const small = trials.get(a.id).length <= trials.get(b.id).length ? a : b, big = small === a ? b : a;
      const codeToName = /\d/.test(small.name) && !/\d/.test(big.name);
      // Once is enough when one row is a code and the other row has no other name pointing elsewhere (checked below).
      if (!((two && ab + ba >= 2) || ab + ba >= 3 || (ab + ba >= 1 && weakOk(a, b)))) continue;
      // The row with fewer trials must point at this one other row: "Vytorin" lists ezetimibe and simvastatin, so proves neither.
      if ([...(seen.get(small.id)?.keys() || [])].some(id => id !== big.id && find(id) !== find(big.id))) continue;
      join(a, b, 'registry other name');
    }
    // A trial's own text gives both names as one drug ("Lacutoclax (LP-108)"), one of them a code. Not when both rows are in one trial.
    const single = list.filter(p => singleName(p.name));
    for (let i = 0; i < single.length; i++) for (let j = i + 1; j < single.length; j++) {
      const a = single[i], b = single[j];
      if (canon(a.name) === canon(b.name) || !weakOk(a, b) || listsDiffer(a, b) || find(a.id) === find(b.id)) continue;
      const nts = new Set(trials.get(a.id).map(t => t.nct));
      if (trials.get(b.id).some(t => nts.has(t.nct))) continue;
      const xa = squeeze(a.name), xb = squeeze(b.name), says = t => { const s = textOf(t.nct); return s.includes(xa) && s.includes(xb) && textNamesBoth(s, a.name, b.name); };
      if ([a, b].some(p => trials.get(p.id).some(says))) join(a, b, 'registry text names both');
    }
  }

  // A drug partners share (seed/ownership.js) is one row, whichever partner runs the trial.
  for (const [drug, [who]] of Object.entries(DRUG_RIGHTS)) {
    const rows = progs.filter(p => canon(p.name) === drug && who.some(w => trials.get(p.id).some(t => (t.sponsor || '').toLowerCase().includes(w))));
    for (let i = 1; i < rows.length; i++) join(rows[i], rows[0], 'partners share this drug');
  }

  // A component with a reviewed "apart" pair is left alone.
  const comps = new Map();
  for (const p of progs) { const r = find(p.id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(p); }
  const groups = [...comps.values()].filter(g => g.length > 1 && !g.some((a, i) => g.slice(i + 1).some(b => blocked(a, b))));

  const insM = db.prepare('INSERT OR REPLACE INTO program_merge (program_id, member_id, name, sponsor, trials, role, evidence, date) VALUES (?,?,?,?,?,?,?,?)');
  const moveTP = db.prepare('INSERT OR IGNORE INTO trial_program (nct, program_id, matched_on) SELECT nct, ?, matched_on FROM trial_program WHERE program_id=?');
  const delTP = db.prepare('DELETE FROM trial_program WHERE program_id=?');
  const delP = db.prepare('DELETE FROM program WHERE id=?');
  const setP = db.prepare('UPDATE program SET name=?, aliases=?, status_label=?, status_level=?, status_source=?, list_url=? WHERE id=?');
  const setCo = db.prepare('UPDATE program SET company=?, company_ids=? WHERE id=?');
  const count = id => new Set(trials.get(id).map(t => t.nct)).size;
  const sponsorOf = id => trials.get(id)[0]?.sponsor || byId.get(id).company;
  const repoint = (from, to) => {
    for (const sql of ['UPDATE regulatory_decision SET program_id=? WHERE program_id=?', 'UPDATE change SET program_id=? WHERE program_id=?']) db.prepare(sql).run(to, from);
    db.prepare("UPDATE match_candidate SET reasons=replace(reasons, ?, ?) WHERE type='decision' AND status='open' AND instr(reasons, ?)").run(`"${from}"`, `"${to}"`, `"${from}"`);
    // Rows merged earlier by the official lists follow.
    db.prepare('UPDATE OR IGNORE program_merge SET program_id=? WHERE program_id=?').run(to, from);
    db.prepare('DELETE FROM program_merge WHERE program_id=?').run(from);
  };

  db.transaction(() => {
    for (const g of groups) {
      const keep = g.slice().sort((a, b) => count(b.id) - count(a.id) || a.id.localeCompare(b.id))[0];
      // Display name: a form-free name, then a word before a code, then the busiest.
      // A fixed product's "X/Y" name comes before "X + Y", which would read as two drugs; a name an official list knows beats a misspelling.
      const listed = p => { const r = resolve(p.name); return !!(r.gsrs || r.nci); };
      const best = g.slice().sort((a, b) => isBase(b.name) - isBase(a.name) || b.name.includes('/') - a.name.includes('/') || listed(b) - listed(a) || /\d/.test(a.name) - /\d/.test(b.name) || count(b.id) - count(a.id) || a.id.localeCompare(b.id))[0];
      const al = new Map();
      for (const p of g) {
        if (nrm(p.name) !== nrm(best.name)) al.set(nrm(p.name), { name: p.name, confirmed: 1, registry: 1 });
      }
      for (const p of g) for (const a of JSON.parse(p.aliases || '[]')) if (nrm(a.name) !== nrm(best.name) && !al.has(nrm(a.name))) al.set(nrm(a.name), a);
      // A member's approval carries over unless it is only the approval of a combination: "Xanomeline" is sold only with trospium (Cobenfy).
      const st = g.find(p => p.status_level === 5 && !approvedOnlyCombined(p)) || { status_label: null, status_level: null, status_source: null };
      // Partners' rows: both companies are shown.
      const shared = how.get(keep.id)?.has('partners share this drug');
      if (shared) { setCo.run([...new Set(g.map(p => p.company))].join(' · '), JSON.stringify([...new Set(g.flatMap(p => JSON.parse(p.company_ids || '[]')))]), keep.id); }
      setP.run(best.name, JSON.stringify([...al.values()].slice(0, 20)), st.status_label, st.status_level, st.status_source, keep.list_url || g.find(p => p.list_url)?.list_url || null, keep.id);
      const evidence = JSON.stringify([{ list: 'rule', name: 'same drug under one company', rules: [...new Set(g.flatMap(p => [...(how.get(p.id) || [])]))] }]);
      insM.run(keep.id, keep.id, keep.name, sponsorOf(keep.id), count(keep.id), 'kept', evidence, today);
      for (const p of g) {
        if (p.id === keep.id) continue;
        insM.run(keep.id, p.id, p.name, sponsorOf(p.id), count(p.id), 'merged', evidence, today);
        moveTP.run(keep.id, p.id); delTP.run(p.id); delP.run(p.id);
        repoint(p.id, keep.id);
        stats.same_drug_rows_merged++;
      }
    }

    // A partners' drug that is already one row (seed/ownership.js) shows every partner whose trials it carries, not only the
    // first sponsor link.js saw: Enhertu's row carries Daiichi Sankyo and AstraZeneca trials and should name both.
    const companies = db.prepare('SELECT id, name, sponsor_patterns FROM company').all().map(c => ({ ...c, pats: JSON.parse(c.sponsor_patterns || '[]') }));
    const sponsorsOf = db.prepare('SELECT DISTINCT t.sponsor FROM trial_program tp JOIN trial t ON t.nct = tp.nct WHERE tp.program_id = ?').pluck();
    for (const [drug, [who]] of Object.entries(DRUG_RIGHTS)) {
      for (const p of db.prepare('SELECT id, name, company, company_ids FROM program WHERE curated = 0').all().filter(p => canon(p.name) === drug)) {
        const sponsors = sponsorsOf.all(p.id).map(s => s || '');
        const present = who.filter(w => sponsors.some(s => s.toLowerCase().includes(w)));
        if (present.length < 2) continue;
        const names = present.map(w => companies.find(c => c.pats.some(x => x.includes(w)) || c.name.toLowerCase().includes(w)) || { name: shortName(sponsors.filter(s => s.toLowerCase().includes(w)).sort((a, b) => a.length - b.length)[0]) });
        const shown = (p.company || '').toLowerCase();
        if (names.every(n => shown.includes(n.name.toLowerCase()))) continue;
        setCo.run(names.map(n => n.name).join(' · '), JSON.stringify([...new Set([...JSON.parse(p.company_ids || '[]'), ...names.map(n => n.id).filter(Boolean)])]), p.id);
        stats.partner_rows_relabelled = (stats.partner_rows_relabelled || 0) + 1;
      }
    }

    // "X + Y" where X and Y each have a row: the trials go on both, the combination row goes.
    const left = db.prepare('SELECT * FROM program').all();
    const isCombinedProduct = productTest(db.prepare('SELECT appl_no, brand, ingredient FROM fda_approval').all());
    const registryNames = db.prepare('SELECT nct, matched_on FROM trial_program WHERE program_id=?');
    const rowsOf = new Map();
    for (const p of left) {
      if (p.curated) continue;
      const k = companyOf({ ...p, id: p.id });
      if (!rowsOf.has(k)) rowsOf.set(k, new Map());
      rowsOf.get(k).set(canon(p.name), p);
    }
    for (const p of left) {
      if (p.curated) continue;
      const list = parts(p.name, REGIMEN);
      if (list.length < 2 || isCombinedProduct(list, [p.name, ...JSON.parse(p.aliases || '[]').map(a => a.name), ...registryNames.all(p.id).flatMap(r => [r.matched_on, ...(others.get(r.nct + '|' + r.matched_on) || [])])])) continue;   // one product, keeps its row
      const mine = rowsOf.get(companyOf(p));
      const hits = list.map(x => mine.get(canon(x)));
      if (hits.some(h => !h || h.id === p.id)) continue;
      const evidence = JSON.stringify([{ list: 'rule', name: 'combination of two drugs that each have a row', parts: hits.map(h => h.name) }]);
      [...new Set(hits)].forEach((h, k) => {
        moveTP.run(h.id, p.id);
        insM.run(h.id, p.id, p.name, sponsorOf(p.id), count(p.id), k ? 'combination part' : 'merged', evidence, today);
      });
      delTP.run(p.id); delP.run(p.id);
      repoint(p.id, hits[0].id);
      stats.combination_rows_folded++;
    }
  })();
  stats.rows_with_new_company = showActiveCompany({ db, coKey });
  stats.rows_with_seed_owner = showSeedOwner({ db });
  return stats;
}

// A drug whose owner runs none of its trials (DRUG_OWNER in seed/ownership.js): the row shows the label written there.
export function showSeedOwner({ db = getDb() } = {}) {
  const set = db.prepare('UPDATE program SET company=? WHERE id=?');
  let n = 0;
  for (const p of db.prepare('SELECT id, name, company FROM program WHERE curated=0').all()) {
    const o = DRUG_OWNER[canon(p.name)];
    if (o && p.company !== o[0]) { set.run(o[0], p.id); n++; }
  }
  return n;
}

// Contract research firms run trials for others; universities and hospitals test other companies' drugs.
const NOT_AN_OWNER = /\b(?:ppd|iqvia|parexel|syneos|icon plc|covance|labcorp|fortrea|medpace|contract research|research associates|universit\w*|hospital\w*|institut\w*|college|clinic|cent(?:er|re)|foundation|group$)\b/i;
const ACTIVE_STATUS = "'RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION'";
// Every active trial of a row is run by one other company: the drug has moved or been licensed ("Olutasidenib", shown under Forma, run by Rigel).
// That company is shown first; the old one stays, because a partner's row must not lose its owner.
export function showActiveCompany({ db = getDb(), coKey }) {
  const active = new Map();
  for (const t of db.prepare(`SELECT tp.program_id, t.sponsor FROM trial_program tp JOIN trial t ON t.nct=tp.nct WHERE t.status IN (${ACTIVE_STATUS})`).all()) {
    if (!active.has(t.program_id)) active.set(t.program_id, []);
    active.get(t.program_id).push(t.sponsor || '');
  }
  const set = db.prepare('UPDATE program SET company=? WHERE id=?');
  let n = 0;
  db.transaction(() => {
    for (const p of db.prepare("SELECT id, company FROM program WHERE curated=0 AND company NOT LIKE '%·%'").all()) {
      const sponsors = active.get(p.id);
      if (!sponsors) continue;
      const keys = new Set(sponsors.map(coKey));
      if (keys.size !== 1 || keys.has(coKey(p.company))) continue;
      const now = sponsors[0], first = (p.company.toLowerCase().match(/[a-z0-9]{3,}/) || [''])[0];
      if (NOT_AN_OWNER.test(now) || WEAK.has(coKey(now)) || now.toLowerCase().includes(first)) continue;
      set.run(`${now} · ${p.company}`, p.id);
      n++;
    }
  })();
  return n;
}
