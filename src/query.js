// The five questions the product answers. Used by the dashboard API and the MCP tools alike,
// so a person and an agent always see the same numbers with the same sources.
import { getDb, meta, norm } from './db.js';
import { explain, classOf, CLASSES } from './explain.js';
import { owns } from './owners.js';
import { buildGroups, groupsOf, FDA_CLASS_TARGETS, LIST_TARGETS } from './targets.js';
import { included as mapIncluded, includedTerms, diseaseMap, subtree } from './diseasemap.js';

const ACTIVE = ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION'];
const ACTIVE_SQL = ACTIVE.map(s => `'${s}'`).join(',');
const PHASE_NAMES = { 1: 'Phase 1', 2: 'Phase 2', 3: 'Phase 3', 4: 'Filed', 5: 'Approved' };
// Named areas: a disease name expands to the words registries use for it.
export const AREAS = {
  // Prader-Willi syndrome is a genetic obesity; ClinicalTrials.gov's own "obesity" search includes it too.
  obesity: ['obesity', 'obese', 'overweight', 'weight management', 'chronic weight', 'prader-willi', 'hyperphagia'],
};
// Other names for a disease that its registry wording cannot bridge on its own. Hand-written, so kept short: abbreviations
// and their full names come from the registry itself (see textIndex).
const DISEASE_GROUPS = [
  ['nash', 'mash', 'nonalcoholic steatohepatitis', 'metabolic dysfunction associated steatohepatitis'],
  ['flu', 'influenza'],
  ['afib', 'atrial fibrillation'],
  // Viruses: written "HIV-1", "HPV-16", so not caught by the rule that "pd" must not find "PD-1".
  ['hiv', 'human immunodeficiency virus'], ['hbv', 'hepatitis b'], ['hcv', 'hepatitis c'], ['hpv', 'human papillomavirus'],
  ['rsv', 'respiratory syncytial virus'], ['cmv', 'cytomegalovirus'], ['ebv', 'epstein barr virus'],
  ['type 2 diabetes', 'type 2 diabetes mellitus', 't2dm', 't2d'],
].map(g => g.map(t => foldText(t)));
// A broad disease also finds its kinds, one way only: "epilepsy" finds Dravet syndrome, "Dravet syndrome" does not find all epilepsy.
const KINDS_OF = Object.fromEntries(Object.entries({
  depression: ['major depressive disorder', 'depressive disorder', 'depressive episode'],
  epilepsy: ['epileptic', 'dravet syndrome', 'lennox gastaut syndrome', 'developmental and epileptic encephalopathy'],
  dementia: ['alzheimer'],
}).map(([k, v]) => [foldText(k), v.map(t => foldText(t))]));
// A disease search includes the registry's sub-diseases of its term (src/diseasemap.js), minus the branches taken out
// by hand in seed/disease-map.csv: Sjogren's under rheumatoid arthritis, pulmonary hypertension under hypertension.
// Conditions the registry tags with a disease they are not: amyloidosis is machine-tagged Alzheimer's, and acute B-cell
// leukaemia is tagged Burkitt lymphoma (a MeSH entry term). Keyed by the tag's search key (anyOrder).
const WRONG_TAG = { 'alzheimer disease': /amyloid/, 'burkitt lymphoma': /lymphoblastic/ };
// Different diseases that happen to contain the searched word.
const NOT_THIS_DISEASE = { hypertension: / (?:pulmonary arterial|pulmonary|portal|ocular|intracranial) hypertension | hypertension (?:pulmonary|portal|ocular|intracranial) /g };
// Searches whose drug lists were checked by hand keep the matching they were reviewed against (same as AREAS).
const NSCLC_NAMES = ['nsclc', 'non-small cell lung', 'non small cell lung', 'non-small-cell lung'];
export const HAND_CHECKED = {
  nsclc: NSCLC_NAMES, 'non-small cell lung': NSCLC_NAMES, 'non small cell lung': NSCLC_NAMES, 'non-small-cell lung': NSCLC_NAMES,
  'non-small cell lung cancer': [...NSCLC_NAMES, 'non-small cell lung cancer'], 'non small cell lung cancer': [...NSCLC_NAMES, 'non small cell lung cancer'],
  'lung cancer': ['lung cancer'],
};

// A Phase 4 trial normally means the drug is marketed for that disease. These trials list diseases the drug is not
// approved for, so outside the approved diseases (FDA label) they do not count towards the stage.
const PHASE4_ONLY_FOR = {
  tucatinib: /breast|colorectal/,   // NCT07768358, continuation study listing seven cancers
  acalabrutinib: /leuk|lymphom|cll/, // NCT06651970, leukaemia patients who also have heart failure
};

export const ctgovUrl = nct => `https://clinicaltrials.gov/study/${nct}`;
export const today = () => (process.env.TODAY || new Date().toISOString().slice(0, 10));
// "2026-12" is treated as the end of that month, so month-only dates in the current month still count as upcoming.
export const endOf = d => (!d ? null : d.length === 7 ? d + '-31' : d.length === 4 ? d + '-12-31' : d);
const pretty = d => {
  if (!d) return '';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, day] = d.split('-');
  return day ? `${+day} ${M[+m - 1]} ${y}` : m ? `${M[+m - 1]} ${y}` : y;
};
const like = s => `%${String(s).toLowerCase().replace(/[%_]/g, '')}%`;

export function dataDates() {
  return {
    trials: (meta.get('ctgov_fetched_at') || meta.get('trials_loaded_at') || '').slice(0, 10),
    trials_source: meta.get('trials_source') || 'ClinicalTrials.gov',
    fda: meta.get('fda_last_updated') || '',
  };
}

// ---------- area matching ----------
// Two kinds of query:
//  - a drug, code, mechanism, company or tag ("amylin", "oral GLP-1", "Hengrui", "IBI362"): the programs whose own
//    name, aliases, mechanism, company or tags contain every word, with all their trials;
//  - otherwise a disease ("obesity", "NASH"): trials whose listed conditions or title mention it, and the programs in them.
//    Sponsors' keyword tags are matched only for hand-checked diseases (AREAS), whose drug list is reviewed by hand.
//    In open searches they bring in wrong trials: a child cholesterol trial of inclisiran is tagged "Heart Failure".
// Matching is by whole words, so "als" is not found inside "Pharmaceuticals" (see hasWords and diseaseTrials).
// Returns { ncts: Set, programs: Set|null } (programs null = every program in those trials).
// Which trials (and, for a drug search, which drugs) an area means. Working it out reads every trial's words, so the answer
// is kept until new data is loaded: landscape(), changes() and catalysts() all ask, for every page that shows the area.
// Read only: callers must not change the sets.
const matchMemo = new Map();
function areaMatch(area) {
  const k = `${loadStamp()}|${meta.get('fda_last_updated')}|${String(area || '').trim().toLowerCase()}`;
  if (matchMemo.has(k)) return matchMemo.get(k);
  const m = matchArea(area);
  matchMemo.set(k, m);
  if (matchMemo.size > 500) matchMemo.delete(matchMemo.keys().next().value);
  return m;
}
function matchArea(area) {
  const db = getDb();
  const q = String(area || '').trim().toLowerCase();
  const words = wordKey(q).split(' ').filter(Boolean);
  if (!q || !words.length) return { ncts: new Set(), programs: null };
  if (!AREAS[q]) {
    const { programs, sponsors } = wordIndex();
    const exactWords = hyphened(q);
    const found = programs.filter(p => hasWords(p.hay, words, exactWords) || words.every(w => hasWord(p.hay, w, exactWords) || (w.length >= 3 && !exactWords.has(w) && p.mechanism.includes(` ${w}`))));   // "gip" finds "GIPR antagonist"
    const rows = found.length ? db.prepare('SELECT nct, program_id AS id FROM trial_program WHERE program_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(found.map(p => p.id))) : [];
    const sponsorNames = sponsors.filter(s => hasWords(s.hay, words, exactWords)).map(s => s.name);
    const sponsorRows = sponsorNames.length ? db.prepare('SELECT t.nct, tp.program_id AS id FROM trial t JOIN trial_program tp ON tp.nct=t.nct JOIN program p ON p.id=tp.program_id WHERE t.sponsor IN (SELECT value FROM json_each(?)) AND p.curated=0').all(JSON.stringify(sponsorNames)) : [];
    const typeRows = classRows(q.split(/\s+/).filter(Boolean));
    const all = [...rows, ...sponsorRows, ...typeRows];
    // A disease name can also appear inside a drug's registry name ("... therapy for heart failure"): when the
    // disease search finds more trials than the drug search, treat the query as a disease. A query that names a type of
    // drug ("statins") is always a drug search, and so is a drug's exact name. A name that trials list as their disease
    // is a disease search, whatever drugs or companies share it (a junk drug row called "HIV").
    const drugNcts = new Set(all.map(r => r.nct));
    const exact = found.length <= 20 && found.some(p => p.names.includes(words.join(' ')));   // not a kind of treatment many drugs share ("CAR-T")
    if (drugNcts.size && (typeRows.length || (listedAsCondition(q) < 5 && (exact || drugNcts.size >= namedTrials(q).size)))) return { ncts: drugNcts, programs: new Set(all.map(r => r.id)) };
  }
  return { ncts: AREAS[q] ? likeTrials(AREAS[q], ['conditions', 'title', 'keywords']) : namedTrials(q), programs: null };
}
// Type searches for drugs without a hand-checked mechanism: the drugs whose class (src/explain.js: FDA class, else name
// stem) has a name or search words in which every word of the query starts a word. "sglt2" finds every -gliflozin drug,
// "statin" every statin. A combination ("Baxdrostat/dapagliflozin") is in the class of each of its parts.
// Each drug's classes are worked out once and kept until new data is loaded.
let byClass = null;
function classRows(words) {
  const stamp = ['trials_loaded_at', 'ctgov_release_loaded_at', 'curated_loaded_at', 'fda_last_updated'].map(k => meta.get(k)).join('|');
  if (byClass?.stamp !== stamp) {
    epcMap = null;
    byClass = { stamp, ids: new Map() };
    for (const p of getDb().prepare('SELECT id, name, mechanism, curated FROM program').all()) {
      if (p.curated && p.mechanism) continue;   // hand-checked mechanisms are matched as written
      const parts = p.name.split(/\s*[/+]\s*|\s+(?:and|plus|with)\s+/i);
      for (const c of new Set(parts.map(n => classOf({ name: n, epc: epcOf(n) })).filter(Boolean)))
        (byClass.ids.get(c) || byClass.ids.set(c, []).get(c)).push(p.id);
    }
  }
  const ids = Object.entries(CLASSES).filter(([, names]) => {
    const have = names.join(' ').toLowerCase().split(/[\s()]+/);
    return words.every(w => have.some(h => h === w || h === w + 's' || (w.length >= 4 && h.startsWith(w))));   // "pd" is not "pd-1"
  }).flatMap(([c]) => byClass.ids.get(c) || []);
  if (!ids.length) return [];
  return getDb().prepare('SELECT nct, program_id AS id FROM trial_program WHERE program_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids));
}
function likeTrials(terms, cols) {
  const condSql = terms.map(() => `(${cols.map(c => `lower(${c}) LIKE ?`).join(' OR ')})`).join(' OR ');
  return new Set(getDb().prepare(`SELECT nct FROM trial WHERE ${condSql}`).pluck().all(...terms.flatMap(t => cols.map(() => like(t)))));
}

const namedTrials = q => (HAND_CHECKED[q] ? likeTrials(HAND_CHECKED[q], ['conditions', 'title']) : diseaseTrials(q));

// ---------- matching by words ----------
// Disease wording, reduced so that spellings compare equal: "Alzheimer's" = "Alzheimers" = "alzheimer", "leukaemia" =
// "leukemia", "non-small cell" = "non small cell", "tumours" = "tumor", and carcinoma, neoplasm and tumor all = "cancer".
export function foldText(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&amp;/g, '&').replace(/&#0*39;/g, "'")
    .replace(/(\w)['’‘`´]s\b/g, '$1').replace(/['’‘`´]/g, '')
    .replace(/haem/g, 'hem').replace(/aemi/g, 'emi').replace(/oedema/g, 'edema').replace(/oesoph/g, 'esoph')
    .replace(/tumour/g, 'tumor').replace(/paed/g, 'ped').replace(/coeliac/g, 'celiac').replace(/rrhoea/g, 'rrhea').replace(/sulph/g, 'sulf')
    .replace(/\bnon[\s-]+(?=[a-z])/g, 'non')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\btype ii\b/g, 'type 2').replace(/\btype i\b/g, 'type 1')
    .replace(/\b([a-z]{3,}[^\Wsiu\d])s\b/g, '$1')
    .replace(/\b(?:(?:adeno)?carcinoma|neoplasm|malignancy|malignancie|tumor(?! necrosis| lysis))\b/g, 'cancer')
    .trim();
}
// Drug, company and mechanism wording: "GLP-1" = "glp1" and "HRS-1893" = "hrs1893" are one word, so "pd" is not "PD-1"
// and "als" is not the code ALS-8176; "anti-PD-1" is "anti" and "pd1".
const wordKey = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\banti-/g, 'anti ').replace(/([a-z0-9])-(?=\d|[a-z0-9]{1,2}\b)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
// Every word must be a whole word in `hay`; from 4 letters a word may also be the start of one ("tirz", "semaglu"),
// unless it was typed with a hyphen: "car-t" is the word "cart" and must not find CARTISTEM.
const hyphened = q => new Set(q.split(/\s+/).filter(x => x.includes('-')).map(wordKey));
const hasWord = (hay, w, exact) => hay.includes(` ${w} `) || (w.length >= 4 && !exact?.has(w) && hay.includes(` ${w}`));
const hasWords = (hay, words, exact) => words.every(w => hasWord(hay, w, exact)) || (words.length === 2 && hay.includes(` ${words.join('')} `));   // "car t" = "CAR-T"
const padded = s => ` ${s} `;

export const loadStamp = () => ['trials_loaded_at', 'ctgov_release_loaded_at', 'curated_loaded_at', 'mesh_fetched_at'].map(k => meta.get(k)).join('|');
// Drugs and sponsors by their words, kept until new data is loaded.
let wordsCache = null;
function wordIndex() {
  const stamp = loadStamp() + '|' + meta.get('verdicts_applied_at');
  if (wordsCache?.stamp === stamp) return wordsCache;
  const db = getDb();
  const aliasNames = a => JSON.parse(a || '[]').map(x => x.name);
  // A row's stored target counts as its words too, in every spelling of its group ("Claudin 18.2" finds a CLDN18.2 row).
  const { byRow } = storedTargets();
  const programs = db.prepare('SELECT id, name, aliases, company, mechanism, tags FROM program').all().map(p => ({
    id: p.id, names: [p.name, ...aliasNames(p.aliases)].map(wordKey), mechanism: padded(wordKey(p.mechanism)),
    hay: padded(wordKey([p.name, ...aliasNames(p.aliases), p.company, p.mechanism, p.tags, ...(byRow.get(p.id) || []).flatMap(g => g.spellings)].filter(Boolean).join(' '))),
  }));
  const sponsors = db.prepare('SELECT DISTINCT sponsor FROM trial WHERE sponsor IS NOT NULL').pluck().all().map(name => ({ name, hay: padded(wordKey(name)) }));
  return (wordsCache = { stamp, programs, sponsors });
}

const isSubsequence = (a, s) => { let i = 0; for (const ch of s) if (ch === a[i]) i++; return i === a.length; };
// Trials by the words of their title and listed conditions, and what the registry itself tells us about disease names:
//  - abbreviations, from conditions written "Amyotrophic Lateral Sclerosis (ALS)". One that stands for two diseases
//    (AD: atopic dermatitis, Alzheimer's) is kept as ambiguous and matches only where a trial writes those letters;
//  - names written with 's ("Crohn's disease"), so "Crohn disease" also finds "Crohn's" in any other wording.
export const anyOrder = t => foldText(t).split(' ').sort().join(' ');
let textCache = null;
export function textIndex() {
  const stamp = loadStamp();
  if (textCache?.stamp === stamp) return textCache;
  const counts = new Map(), eponyms = new Set(), own = new Map(), parents = new Map(), entryTrials = new Map();
  for (const m of getDb().prepare('SELECT nct, term, ancestor FROM trial_mesh').all()) {
    const into = m.ancestor ? parents : own;
    if (!into.has(m.nct)) into.set(m.nct, new Set());
    into.get(m.nct).add(anyOrder(m.term));
  }
  const trials = getDb().prepare('SELECT nct, title, conditions FROM trial').all().map(t => {
    const conds = JSON.parse(t.conditions || '[]');
    for (const c of conds) {
      const m = c.trim().match(/^(.*?)\s*\(([A-Za-z0-9-]{2,8})\)\s*$/);
      if (m) { const a = m[2].toLowerCase().replace(/-/g, ''), f = foldText(m[1]); if (!counts.has(a)) counts.set(a, new Map()); counts.get(a).set(f, (counts.get(a).get(f) || 0) + 1); }
      for (const e of c.toLowerCase().replace(/&#0*39;/g, "'").matchAll(/\b([a-z]{5,})['’]s disease\b/g)) eponyms.add(foldText(e[1]));
    }
    const entries = [...new Set(conds.map(foldText))];
    for (const e of entries) entryTrials.set(e, (entryTrials.get(e) || 0) + 1);
    return { nct: t.nct, entries: entries.map(padded), text: padded([foldText(t.title), ...entries].join(' | ')), listed: conds.join(' | '), titled: [t.title, ...conds].join(' | '), own: own.get(t.nct), parents: parents.get(t.nct), plain: entries };
  });
  const abbrs = new Map(), fullToAbbr = new Map();
  for (const [a, fulls] of counts) {
    const kept = [...fulls].filter(([f, n]) => n >= 2 && f[0] === a[0] && f.split(' ').length <= a.length + 1 && isSubsequence(a, f.replace(/ /g, '')));
    const total = kept.reduce((sum, [, n]) => sum + n, 0);
    if (total < 3) continue;
    const byFirst = new Map();
    for (const [f, n] of kept) byFirst.set(f.split(' ')[0], (byFirst.get(f.split(' ')[0]) || 0) + n);
    const [top, n] = [...byFirst].sort((x, y) => y[1] - x[1])[0];
    const ambiguous = n / total < 0.9;
    abbrs.set(a, { abbr: a, ambiguous, fulls: ambiguous ? [] : kept.map(([f]) => f).filter(f => f.split(' ')[0] === top) });
    for (const f of abbrs.get(a).fulls) fullToAbbr.set(f, a);
  }
  return (textCache = { stamp, trials, abbrs, fullToAbbr, eponyms, entryTrials });
}

// A short abbreviation counts only as a word of its own, in capitals or as a name: "ALS", not "als" inside another word
// or "PD-1". Two letters must be a listed condition ("PK/PD" in a title is not Parkinson's).
const abbrPattern = a => new RegExp(`(?<![A-Za-z0-9-])(?:${a.toUpperCase()}|${a[0].toUpperCase()}${a.slice(1)})(?![A-Za-z0-9]|-[A-Za-z]?\\d)`);
const STOP_WORDS = new Set(['of', 'the', 'in', 'and', 'with', 'for']);

function diseaseQuery(q) {
  const { abbrs, fullToAbbr, eponyms } = textIndex();
  const fq = foldText(q);
  const group = DISEASE_GROUPS.find(g => g.includes(fq));
  const terms = new Set([...(group || [fq]), ...(KINDS_OF[fq] || [])]), entryOnly = new Set(), letters = new Set();
  for (const t of [...terms]) {
    const a = abbrs.get(t) || abbrs.get(fullToAbbr.get(t));
    if (a) {
      for (const f of a.fulls) terms.add(f);
      if (a.abbr === t && a.abbr.length <= 3 && !group) letters.add(a.abbr);
      else if (!a.ambiguous && a.abbr.length > 3) terms.add(a.abbr);   // "MM" is also menstrual migraine: a full name never brings in two letters
    }
    const eponym = t.match(/^(\w+) disease$/)?.[1];
    if (eponym && eponyms.has(eponym)) entryOnly.add(eponym);
  }
  // Letters too short to be a word stand only as abbreviations, unless a group names them ("flu").
  if (/^[a-z0-9]{1,3}$/.test(fq) && !group) letters.add(fq);
  if (!group) for (const a of letters) terms.delete(a);
  return {
    terms: [...terms].map(t => ({ meshKey: anyOrder(t), phrase: padded(t), words: t.split(' ').filter(w => !STOP_WORDS.has(w)).map(padded) })),
    entryOnly: [...entryOnly].map(padded), letters: [...letters].map(a => ({ re: abbrPattern(a), titles: a.length >= 3 })), except: NOT_THIS_DISEASE[fq],
  };
}

// Trials the registry tags with a disease (MeSH) or one of its sub-diseases on the disease map, counted only when the
// trial's listed condition usually carries that tag, or names an included sub-disease in its own words ("unresectable
// hepatocellular carcinoma" for liver cancer). The tags are made by machine: one neuroblastoma trial is tagged epilepsy,
// and a tag on one trial alone proves nothing.
function meshTrials(terms, sub) {
  const { trials, entryTrials } = textIndex();
  const keys = new Set([...terms.map(x => x.meshKey), ...sub.keys()]);
  const subWords = [...sub.values()].map(n => foldText(n).split(' ').filter(w => !STOP_WORDS.has(w)).map(padded));
  const tagged = trials.filter(t => t.own && [...t.own].some(k => keys.has(k)));
  const hits = new Map();
  for (const t of tagged) for (const e of t.plain) hits.set(e, (hits.get(e) || 0) + 1);
  const usual = e => (hits.get(e) >= 3 && hits.get(e) / entryTrials.get(e) >= 0.6) || subWords.some(ws => ws.every(w => padded(e).includes(w)));
  const wrongTag = e => [...keys].some(k => WRONG_TAG[k]?.test(e));
  return tagged.filter(t => t.plain.some(usual) && !t.plain.some(wrongTag)).map(t => t.nct);
}
function listedAsCondition(q) {
  const entry = padded(foldText(q));
  return textIndex().trials.filter(t => t.entries.includes(entry)).length;
}
// A trial is about a disease when its title or one listed condition has the words in order, or one short listed condition
// has them all in any order ("Diabetes Mellitus, Type 2", "Leukemia, Myeloid, Acute"; not "Colon Cancer Liver Metastases"
// for "liver cancer"). Then the disease map adds its sub-diseases (src/diseasemap.js): trials the registry tags with one,
// and trials whose listed condition names one in its own words ("Advanced Hepatocellular Carcinoma" for liver cancer, untagged).
function diseaseTrials(q) {
  const { terms, entryOnly, letters, except } = diseaseQuery(q);
  const { trials } = textIndex();
  const out = new Set();
  const shortEntry = (entries, words) => entries.some(e => e.trim().split(' ').length <= words.length + 3 && !/ metasta(?:se|sis) /.test(e) && words.every(w => e.includes(w)));
  for (const t of trials) {
    const text = except ? t.text.replace(except, ' ') : t.text;
    if (terms.some(x => text.includes(x.phrase))
      || terms.some(x => x.words.length > 1 && shortEntry(t.entries, x.words))
      || entryOnly.some(w => t.entries.some(e => e.includes(w)))
      || letters.some(l => l.re.test(l.titles ? t.titled : t.listed))) out.add(t.nct);
  }
  // Letters that stand for two diseases (AD) name no one term on the map.
  const sub = includedTerms(terms.map(x => x.meshKey), letters.length ? null : q, letters.length ? null : out);
  const own = new Set(terms.map(x => x.meshKey));   // the searched disease itself was matched above, with its exceptions
  const subWords = [...sub].filter(([k]) => !own.has(k)).map(([, n]) => foldText(n).split(' ').filter(w => !STOP_WORDS.has(w)).map(padded)).filter(ws => ws.length);
  if (subWords.length) for (const t of trials) if (!out.has(t.nct) && subWords.some(ws => shortEntry(except ? t.entries.map(e => e.replace(except, ' ')) : t.entries, ws))) out.add(t.nct);
  for (const nct of meshTrials(terms, sub)) out.add(nct);
  return out;
}
export const areaTrials = area => areaMatch(area).ncts;

function companyInfo(ids) {
  const db = getDb();
  const rows = ids.map(id => db.prepare('SELECT * FROM company WHERE id=?').get(id)).filter(Boolean);
  if (!rows.length) return { label: 'Not yet researched', tickers: [] };
  const parts = rows.map(c => (c.listed === 1 ? 'Public' : c.listed === 0 ? 'Private' : 'Not yet researched'));
  return { label: [...new Set(parts)].join(' · '), tickers: rows.filter(c => c.listed === 1).map(c => c.ticker) };
}

// Does an FDA label's "Indications and usage" name this list's disease? The named area's words (AREAS, HAND_CHECKED), else the
// search itself, with its other names (DISEASE_GROUPS), as whole words in the search's own spelling (foldText: "leukaemia" is
// leukemia, "non-small" one word, so "small cell lung cancer" is not found in "non-small cell lung cancer"). Nothing about
// obesity in Lipitor's label.
export function treats(indications, area) {
  const q = String(area).trim().toLowerCase(), text = ` ${foldText(indications)} `;
  const terms = (AREAS[q] || HAND_CHECKED[q] || [q]).map(t => foldText(t)).filter(Boolean);
  for (const g of DISEASE_GROUPS) if (terms.some(t => g.includes(t))) terms.push(...g);
  return terms.some(t => text.includes(` ${t} `));
}

// ---------- landscape ----------
// changes() and catalysts() need the area's drugs. Home asks both for every followed landscape, so the list is kept for
// ten minutes (until the next data load) instead of being rebuilt for each. Read only: callers must not change it.
const areaMemo = new Map();
function areaDrugList(area, phase_min) {
  const k = `${loadStamp()}|${String(area).trim().toLowerCase()}|${phase_min}`, hit = areaMemo.get(k);
  if (hit && Date.now() - hit.t < 600_000) return hit.L;
  const L = landscape({ area, phase_min });
  areaMemo.set(k, { L, t: Date.now() });
  if (areaMemo.size > 200) areaMemo.delete(areaMemo.keys().next().value);
  return L;
}
// `ncts`: a ready set of trials (a disease page's tagged trials, src/diseasemap.js diseaseDrugs) instead of matching `area`'s words.
export function landscape({ area, phase_min = 1, include_finished = false, limit = 500, ncts: given = null } = {}) {
  const db = getDb();
  const { ncts, programs: onlyProgs } = given ? { ncts: given, programs: null } : areaMatch(area);
  if (!ncts.size) return { area, programs: [], summary: summarize(area, [], phase_min, 0), stats: { programs: 0, trials: 0, checked: 0, read_at: null }, included: null, data: dataDates() };
  // What a disease search included (sub-diseases, branches left out, coverage of the registry's own tags), for the "Included" line.
  const dq = onlyProgs || given ? null : diseaseQuery(area);
  const included = onlyProgs || given ? null : mapIncluded(dq.terms.map(x => x.meshKey), dq.letters.length ? null : area, dq.letters.length ? null : ncts);
  // A drug's approval or filing (e.g. "FDA-approved (any use)") sets its stage only when the search is about the drug
  // itself (drug, mechanism or company search) or a hand-checked disease. In any other disease search the stage is the
  // furthest phase of the drug's trials for that disease, and the approval is shown as a note.
  const useStatus = !!onlyProgs || !!AREAS[String(area).trim().toLowerCase()];
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _area (nct TEXT PRIMARY KEY)');
  db.exec('DELETE FROM _area');
  const ins = db.prepare('INSERT OR IGNORE INTO _area VALUES (?)');
  db.transaction(() => { for (const n of ncts) ins.run(n); })();

  const rows = db.prepare(`
    SELECT p.*, t.nct, t.status, t.phase, t.phase_label, t.primary_completion, t.completion, t.last_update, t.title, t.sponsor, t.conditions
    FROM _area a JOIN trial_program tp ON tp.nct = a.nct JOIN program p ON p.id = tp.program_id JOIN trial t ON t.nct = a.nct`).all();
  const now = today();
  const cutoff = new Date(Date.parse(now) - 730 * 864e5).toISOString().slice(0, 10); // "recently finished" = last 2 years
  const byProg = new Map();
  for (const r of rows) {
    if (onlyProgs && !onlyProgs.has(r.id)) continue;
    if (!byProg.has(r.id)) byProg.set(r.id, { p: r, trials: [] });
    byProg.get(r.id).trials.push(r);
  }
  const catalystRows = db.prepare('SELECT * FROM catalyst WHERE drug_id=?');
  // Checked rows: hand-checked (program.curated), or read against their trials with a settled verdict (kept, approved or
  // flagged in row_verdict). A row queued for a person, or never read, is not checked.
  const readRows = new Map(db.prepare("SELECT program_id, read_at, reader FROM row_verdict WHERE program_id IS NOT NULL AND (action LIKE 'kept%' OR action LIKE 'approved%' OR action LIKE 'flagged%')").all().map(v => [v.program_id, v]));
  // The company's own approved drugs with no active trial, by their FDA label (src/ingest/fdalabels.js): shown as approved
  // when the label names this list's disease. Not in a drug, company or mechanism search.
  const labelOf = db.prepare('SELECT l.set_id, l.indications FROM program_label pl JOIN fda_label l ON l.appl_no = pl.appl_no WHERE pl.program_id = ? AND l.indications IS NOT NULL');
  const approvedFor = id => onlyProgs ? null : labelOf.all(id).find(l => treats(l.indications, area)) || null;
  const excluded = new Set(db.prepare('SELECT name_norm FROM area_exclusion WHERE area=?').pluck().all(String(area).trim().toLowerCase()));
  // EU decisions per drug (src/ingest/ema.js): a marketing authorisation, or else a positive CHMP opinion. Same rule as a US
  // approval: it counts for the stage only when the search is about the drug itself or a hand-checked disease.
  const euBy = new Map();
  if (useStatus) for (const d of db.prepare("SELECT program_id, kind, source_url FROM regulatory_decision WHERE region='EU' AND kind IN ('approval','opinion') AND program_id IS NOT NULL ORDER BY kind DESC, decision_date").all())
    euBy.set(d.program_id, { kind: d.kind, url: d.source_url });
  // EU (CTIS) numbers of the same trials, by NCT number.
  const euTrials = new Map();
  for (const r of db.prepare("SELECT sl.study_id AS nct, sl.record_id AS id, tr.url FROM study_link sl JOIN _area a ON a.nct = sl.study_id JOIN trial_record tr ON tr.registry = sl.registry AND tr.record_id = sl.record_id WHERE sl.registry='ctis'").all())
    euTrials.set(r.nct, [...(euTrials.get(r.nct) || []), r]);
  // Listed conditions that are the landscape's own disease in other words ("Overweight or Obesity" in obesity), marked `own`:
  // the wording holds every word of the search, of a term the search stands for or of the term right above it, or the
  // trials that list it alone carry that term.
  const dm = included ? diseaseMap() : null;
  const ownNames = dm && [area, ...included.terms.flatMap(t => [t, ...(dm.nodes.get(t)?.direct || [])])].map(n => foldText(n).split(' ').filter(w => w && !STOP_WORDS.has(w)));
  const markOwn = c => {
    if (!dm) return c;
    const words = new Set(foldText(c.name).split(' ')), w = dm.wordings.get(c.name.toLowerCase());
    return ownNames.some(n => n.every(x => words.has(x))) || (w?.how === 'solo' && included.terms.includes(w.term)) ? { ...c, own: true } : c;
  };
  const out = [];
  const activeTrialSet = new Set();
  for (const { p, trials } of byProg.values()) {
    if (excluded.has(norm(p.name))) continue;
    const active = trials.filter(t => ACTIVE.includes(t.status));
    const recent = trials.filter(t => !ACTIVE.includes(t.status) && endOf(t.primary_completion || t.completion || '') >= cutoff && ['COMPLETED', 'TERMINATED', 'SUSPENDED'].includes(t.status));
    const fdaLabel = active.length ? null : approvedFor(p.id);
    if (!active.length && !fdaLabel && !(include_finished && recent.length)) continue;
    const scope = active.length ? active : recent.length ? recent : trials;
    const onlyFor = PHASE4_ONLY_FOR[norm(p.name)];
    const counted = onlyFor && !onlyFor.test(String(area).toLowerCase()) ? scope.filter(t => t.phase !== 4) : scope;
    if (!counted.length) continue;
    const regPhase = Math.max(...counted.map(t => t.phase || 0));
    const regLevel = regPhase === 4 ? 5 : regPhase;   // a Phase 4 trial means the drug is marketed somewhere
    const status = useStatus ? p.status_level || 0 : 0;
    const eu = euBy.get(p.id) || null;
    const euOnly = eu?.kind === 'approval' && status < 5;   // approved in the EU, and not (as far as we know) anywhere else
    const level = euOnly || fdaLabel ? 5 : Math.max(regLevel, status);
    if (level < phase_min) continue;
    const top = scope.filter(t => (t.phase || 0) === regPhase);
    let label = fdaLabel ? 'Approved (US)' : euOnly ? 'Approved (EU)' : status && status >= regLevel ? p.status_label
      : regPhase === 4 ? 'Marketed (Phase 4 trial)'
      : top.some(t => t.phase_label === PHASE_NAMES[regPhase]) ? PHASE_NAMES[regPhase]
      : [...new Set(top.map(t => t.phase_label))].sort((a, b) => b.length - a.length)[0] || PHASE_NAMES[regPhase];
    const phaseSource = fdaLabel ? { url: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${fdaLabel.set_id}`, news: false } : euOnly ? { url: eu.url, news: false } : status && status >= regLevel ? { url: p.status_source, news: !!p.status_news } : { url: ctgovUrl(top[0].nct), news: false };
    // next catalyst: soonest future primary completion of an active trial, or a sourced news catalyst
    // prefer Phase 2+ trials for the next catalyst; fall back to any active trial
    const future = active.filter(t => endOf(t.primary_completion) >= now);
    const upcoming = (future.some(t => t.phase >= 2) ? future.filter(t => t.phase >= 2) : future).sort((a, b) => endOf(a.primary_completion).localeCompare(endOf(b.primary_completion)));
    let next = upcoming[0] ? { date: upcoming[0].primary_completion, label: pretty(upcoming[0].primary_completion), what: `Primary completion, ${upcoming[0].phase_label}`, nct: upcoming[0].nct, url: ctgovUrl(upcoming[0].nct), news: false } : null;
    if (p.drug_id) for (const c of catalystRows.all(p.drug_id)) {
      if (endOf(c.date) >= now && (!next || endOf(c.date) < endOf(next.date)))
        next = { date: c.date, label: pretty(c.date), what: c.what, url: c.source_url, news: true, confirmed: !!c.confirmed };
    }
    const lead = upcoming[0] || top.sort((a, b) => (b.last_update || '').localeCompare(a.last_update || ''))[0];
    active.forEach(t => activeTrialSet.add(t.nct));
    const fin = companyInfo(JSON.parse(p.company_ids || '[]'));
    out.push({
      id: p.id, drug: p.name, aliases: JSON.parse(p.aliases || '[]'), company: p.company, company_ids: JSON.parse(p.company_ids || '[]'),
      mechanism: p.mechanism, mechanism_confirmed: !!p.mechanism_confirmed, tags: p.tags, curated: !!p.curated, china: p.china,
      checked: p.curated ? { by: 'hand', read_at: null, reader: null } : readRows.has(p.id) ? { by: 'read', read_at: readRows.get(p.id).read_at, reader: readRows.get(p.id).reader } : null,
      phase: { level, label, source: phaseSource.url, news: phaseSource.news, other_use: p.status_label && (p.status_level == null || !status) ? { label: p.status_label, url: p.status_source } : null, eu: euOnly ? null : eu },
      next_catalyst: next, soon: !!next && endOf(next.date) <= new Date(Date.parse(now) + 30 * 864e5).toISOString().slice(0, 10),
      financing: fin, lead_trial: { nct: lead.nct, url: ctgovUrl(lead.nct) },
      explain: explainProgram(p), tested_for: testedFor(scope).map(markOwn),
      trials: { active: active.length, total: trials.length, ncts: scope.map(t => t.nct), eu: scope.flatMap(t => euTrials.get(t.nct) || []) },
      in_active_trials: active.length > 0,
    });
  }
  out.sort((a, b) => b.phase.level - a.phase.level || (endOf(a.next_catalyst?.date) || '9999').localeCompare(endOf(b.next_catalyst?.date) || '9999') || a.drug.localeCompare(b.drug));
  const shown = out.slice(0, limit);
  const nextUp = out.filter(p => p.next_catalyst).sort((a, b) => endOf(a.next_catalyst.date).localeCompare(endOf(b.next_catalyst.date)))[0];
  const activeInScope = new Set(out.filter(p => p.in_active_trials).flatMap(p => p.trials.ncts));
  const byLevel = [5, 4, 3, 2, 1].map(l => ({ level: l, name: PHASE_NAMES[l], count: out.filter(p => p.phase.level === l).length }));
  return {
    area, phase_min,
    summary: summarize(area, out, phase_min, activeInScope.size),
    stats: {
      programs: out.length, active_programs: out.filter(p => p.in_active_trials).length,
      trials: activeInScope.size, china: out.filter(p => p.china === 1).length,
      companies: new Set(out.map(p => p.company)).size, by_phase: byLevel,
      next: nextUp ? { drug: nextUp.drug, soon: nextUp.soon, ...nextUp.next_catalyst } : null,
      unreviewed: out.filter(p => !p.curated).length,
      checked: out.filter(p => p.checked).length,
      read_at: out.map(p => p.checked?.read_at || '').sort().pop() || null,   // latest read among the checked rows
    },
    programs: shown, truncated: out.length > shown.length, included, data: dataDates(),
  };
}

function summarize(area, progs, phase_min, nTrials) {
  if (!progs.length) return `No drugs in active trials match "${area}". Try a drug code, a company or a mechanism.`;
  const ph = phase_min >= 5 ? 'approval' : phase_min === 4 ? 'filing or approval' : phase_min >= 2 ? `Phase ${phase_min} or later` : 'any phase';
  const late = progs.filter(p => p.phase.level >= 3).length;
  const china = progs.filter(p => p.china === 1).length;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  let s = `${n(progs.length, 'drug', 'drugs')} in ${ph}, across ${n(nTrials, 'active trial', 'active trials')}.`;
  if (late < progs.length) s += ` ${late} ${late === 1 ? 'is' : 'are'} in Phase 3 or later.`;   // not "104 … 104 are in Phase 3" when all are
  if (china) s += ` ${china} ${china === 1 ? 'comes' : 'come'} from China-based sponsors.`;
  return s;
}

// ---------- search ----------
export function search({ query, limit = 10 } = {}) {
  const db = getDb();
  const q = String(query || '').trim();
  if (!q) return { query, drugs: [], companies: [], conditions: [] };
  const lq = like(q), words = wordKey(q).split(' ').filter(Boolean);
  const drugs = db.prepare(`SELECT p.id, p.name, p.company, p.mechanism, p.curated, p.aliases, count(tp.nct) AS trials
    FROM program p LEFT JOIN trial_program tp ON tp.program_id=p.id
    WHERE lower(p.name) LIKE ? OR lower(p.aliases) LIKE ? GROUP BY p.id ORDER BY p.curated DESC, trials DESC`).all(lq, lq)
    .filter(r => hasWords(padded(wordKey(`${r.name} ${JSON.parse(r.aliases || '[]').map(a => a.name).join(' ')}`)), words)).slice(0, limit)
    .map(r => ({ id: r.id, name: r.name, company: r.company, mechanism: r.mechanism, aliases: JSON.parse(r.aliases || '[]').map(a => a.name), reviewed: !!r.curated, trials: r.trials }));
  const companies = db.prepare(`SELECT sponsor AS name, count(*) AS trials, sum(status IN (${ACTIVE_SQL})) AS active FROM trial WHERE lower(sponsor) LIKE ? GROUP BY sponsor ORDER BY trials DESC`).all(lq).filter(r => hasWords(padded(wordKey(r.name)), words)).slice(0, limit);
  const conditions = db.prepare(`SELECT value AS name, count(*) AS trials FROM trial, json_each(trial.conditions) WHERE lower(value) LIKE ? GROUP BY lower(value) ORDER BY trials DESC`).all(lq).filter(r => hasWords(padded(wordKey(r.name)), words)).slice(0, limit);
  return { query: q, drugs, companies, conditions, data: dataDates() };
}

// ---------- trials ----------
export function trials({ area, drug, sponsor, phase, country, status = 'active', start_after, completion_before, limit = 50 } = {}) {
  const db = getDb();
  const where = [], args = [];
  if (area) { const s = [...areaTrials(area)]; if (!s.length) return { trials: [], count: 0, data: dataDates() }; where.push(`t.nct IN (SELECT value FROM json_each(?))`); args.push(JSON.stringify(s)); }
  if (drug) {
    const words = wordKey(drug).split(' ').filter(Boolean), exact = hyphened(String(drug));
    const ids = wordIndex().programs.filter(p => p.id === drug || (words.length && hasWords(padded(p.names.join(' ')), words, exact))).map(p => p.id);
    where.push('t.nct IN (SELECT nct FROM trial_program WHERE program_id IN (SELECT value FROM json_each(?)))'); args.push(JSON.stringify(ids));
  }
  if (sponsor) {
    const words = wordKey(sponsor).split(' ').filter(Boolean), exact = hyphened(String(sponsor));
    where.push('t.sponsor IN (SELECT value FROM json_each(?))'); args.push(JSON.stringify(words.length ? wordIndex().sponsors.filter(s => hasWords(s.hay, words, exact)).map(s => s.name) : []));
  }
  if (phase) { where.push('t.phase >= ?'); args.push(+phase); }
  if (country) { where.push('lower(t.countries) LIKE ?'); args.push(like(country)); }
  if (status === 'active') where.push(`t.status IN (${ACTIVE_SQL})`);
  else if (status && status !== 'all') { where.push('t.status = ?'); args.push(String(status).toUpperCase()); }
  if (start_after) { where.push('t.start_date >= ?'); args.push(start_after); }
  if (completion_before) { where.push('t.primary_completion <= ?'); args.push(completion_before); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const count = db.prepare(`SELECT count(*) FROM trial t ${w}`).pluck().get(...args);
  const rows = db.prepare(`SELECT t.* FROM trial t ${w} ORDER BY t.phase DESC, t.primary_completion ASC LIMIT ?`).all(...args, Math.min(+limit || 50, 500));
  const progs = db.prepare('SELECT p.name FROM trial_program tp JOIN program p ON p.id=tp.program_id WHERE tp.nct=?').pluck();
  return {
    count, data: dataDates(),
    trials: rows.map(t => ({
      nct: t.nct, url: ctgovUrl(t.nct), title: t.title, status: t.status, phase: t.phase_label, sponsor: t.sponsor,
      drugs: progs.all(t.nct), conditions: JSON.parse(t.conditions), countries: JSON.parse(t.countries), sites: t.n_sites,
      enrollment: t.enrollment, start: t.start_date, primary_completion: t.primary_completion,
    })),
  };
}

// ---------- catalysts ----------
export function catalysts({ days_ahead = 90, area, phase_min = 2, limit = 100 } = {}) {
  const db = getDb();
  const now = today();
  const until = new Date(Date.parse(now) + days_ahead * 864e5).toISOString().slice(0, 10);
  const areaSet = area ? [...areaTrials(area)] : null;
  const rows = db.prepare(`SELECT t.nct, t.primary_completion, t.phase_label, t.phase, t.sponsor, t.title, group_concat(p.name, ' + ') AS drugs, max(p.curated) AS reviewed
    FROM trial t JOIN trial_program tp ON tp.nct=t.nct JOIN program p ON p.id=tp.program_id
    WHERE t.status IN (${ACTIVE_SQL}) AND t.phase >= ? AND t.primary_completion IS NOT NULL
    ${areaSet ? 'AND t.nct IN (SELECT value FROM json_each(?))' : ''}
    GROUP BY t.nct`).all(...[phase_min, ...(areaSet ? [JSON.stringify(areaSet)] : [])]);
  const reg = rows.filter(r => endOf(r.primary_completion) >= now && r.primary_completion <= until)
    .map(r => ({ date: r.primary_completion, label: pretty(r.primary_completion), drug: r.drugs, sponsor: r.sponsor, what: `Primary completion, ${r.phase_label}`, title: r.title, source: ctgovUrl(r.nct), nct: r.nct, kind: 'registry', reviewed: !!r.reviewed }));
  const areaDrugs = area ? new Set(areaDrugList(area, 1).programs.map(p => p.id)) : null;
  const news = db.prepare('SELECT c.*, d.name FROM catalyst c JOIN drug d ON d.id=c.drug_id').all()
    .filter(c => endOf(c.date) >= now && c.date <= until && (!areaDrugs || areaDrugs.has(c.drug_id)))
    .map(c => ({ date: c.date, label: pretty(c.date), drug: c.name, what: c.what, source: c.source_url, kind: 'news', confirmed: !!c.confirmed, reviewed: true }));
  const all = [...news, ...reg].sort((a, b) => endOf(a.date).localeCompare(endOf(b.date)));
  return { days_ahead, area: area || null, count: all.length, catalysts: all.slice(0, limit), truncated: all.length > limit, data: dataDates(),
    note: 'Registry dates are planned primary completion dates set by sponsors; results usually follow weeks to months later. News items come from press reports and are marked as such.' };
}

// ---------- who runs trials ----------
// Sponsors that hide their hospitals register placeholders ("Research Site", "Novartis Investigative Site", "Local Institution"):
// not real sites, so they are left out of the site ranking.
const HIDDEN_SITE = /investigat\w* site|research site|study site|clinical (trial |research )?site|local institution|for additional information/i;
export function whoRunsTrials({ area, phase, country, limit = 20 } = {}) {
  const db = getDb();
  const s = area ? [...areaTrials(area)] : null;
  if (area && !s.length) return { sponsors: [], sites: [], trials: 0, data: dataDates() };
  const where = [`t.status IN (${ACTIVE_SQL})`], args = [];
  if (s) { where.push('t.nct IN (SELECT value FROM json_each(?))'); args.push(JSON.stringify(s)); }
  if (phase) { where.push('t.phase >= ?'); args.push(+phase); }
  const w = 'WHERE ' + where.join(' AND ');
  const siteW = country ? ' AND lower(si.country) = lower(?)' : '';
  const trialCount = db.prepare(`SELECT count(*) FROM trial t ${w}${country ? ' AND lower(t.countries) LIKE ?' : ''}`).pluck().get(...args, ...(country ? [like(country)] : []));
  const sponsors = db.prepare(`SELECT t.sponsor, count(*) AS trials, sum(t.n_sites) AS sites, group_concat(t.nct) AS ncts FROM trial t ${w}${country ? ' AND lower(t.countries) LIKE ?' : ''} GROUP BY t.sponsor ORDER BY trials DESC LIMIT ?`)
    .all(...args, ...(country ? [like(country)] : []), limit)
    .map(r => ({ sponsor: r.sponsor, active_trials: r.trials, sites: r.sites, example_trials: r.ncts.split(',').slice(0, 3).map(n => ({ nct: n, url: ctgovUrl(n) })) }));
  const sites = db.prepare(`SELECT si.facility, si.city, si.country, count(DISTINCT si.nct) AS trials, group_concat(DISTINCT si.nct) AS ncts
    FROM site si JOIN trial t ON t.nct = si.nct ${w}${siteW} AND si.facility IS NOT NULL
    GROUP BY lower(si.facility), lower(si.city) ORDER BY trials DESC LIMIT ?`)
    .all(...args, ...(country ? [country] : []), limit * 4)
    .filter(r => !HIDDEN_SITE.test(r.facility)).slice(0, limit)
    .map(r => ({ facility: r.facility, city: r.city, country: r.country, active_trials: r.trials, example_trials: r.ncts.split(',').slice(0, 3).map(n => ({ nct: n, url: ctgovUrl(n) })) }));
  return { area: area || null, phase: phase || null, country: country || null, active_trials: trialCount, sponsors, sites, data: dataDates(),
    note: 'Ranked by number of active industry-sponsored trials. Site names are as registered; the same hospital can appear under different spellings. Sites a sponsor does not name ("Research Site") are left out.' };
}

// ---------- changes (the watchlist feed) ----------
// What changed in an area since a date, from the `change` table (one row per field per registry release).
// Date moves are grouped per drug; moves under 30 days (often a month-only date made exact) are folded into one count.
const STATUS_WORDS = {
  RECRUITING: 'started recruiting', ACTIVE_NOT_RECRUITING: 'stopped recruiting (still running)', COMPLETED: 'completed',
  TERMINATED: 'stopped early (terminated)', SUSPENDED: 'paused (suspended)', WITHDRAWN: 'withdrawn before enrolling',
  NOT_YET_RECRUITING: 'not yet recruiting', ENROLLING_BY_INVITATION: 'enrolling by invitation',
};
const dayOf = d => Date.parse(!d ? '' : d.length === 7 ? d + '-15' : d.length === 4 ? d + '-07-01' : d);
export function changes({ area, phase_min = 1, since, limit = 200 } = {}) {
  const db = getDb();
  since = since || new Date(Date.parse(today()) - 14 * 864e5).toISOString().slice(0, 10);
  const { ncts, programs: onlyProgs } = areaMatch(area);
  const rows = ncts.size ? db.prepare(`SELECT c.*, t.title, t.sponsor, t.phase, t.phase_label FROM change c JOIN trial t ON t.nct = c.nct
    WHERE c.date >= ? AND c.nct IN (SELECT value FROM json_each(?)) AND coalesce(t.phase,0) >= ? ORDER BY c.date DESC, c.id`).all(since, JSON.stringify([...ncts]), phase_min) : [];
  const progs = db.prepare('SELECT p.id, p.name, p.curated FROM trial_program tp JOIN program p ON p.id=tp.program_id WHERE tp.nct=?');
  const drugsOf = nct => progs.all(nct).filter(p => !onlyProgs || onlyProgs.has(p.id));
  const items = [], dateGroups = new Map(), small = [];
  for (const r of rows) {
    const drugs = drugsOf(r.nct);
    const drug = drugs.map(d => d.name).join(' + ') || r.sponsor;
    const base = { date: r.date, label: pretty(r.date), nct: r.nct, url: r.source_url, drug, reviewed: drugs.some(d => d.curated), sponsor: r.sponsor, trial: r.title };
    if (r.kind === 'new_trial') items.push({ ...base, kind: 'new_trial', text: `New ${r.after || ''} trial registered`.replace('  ', ' ') });
    else if (r.kind === 'phase') items.push({ ...base, kind: 'phase', text: `Trial phase changed from ${r.before || 'none'} to ${r.after || 'none'}` });
    else if (r.kind === 'status') items.push({ ...base, kind: 'status', stopped: ['TERMINATED', 'SUSPENDED', 'WITHDRAWN'].includes(r.after), text: `Trial ${STATUS_WORDS[r.after] || String(r.after).toLowerCase()}` });
    else if (r.kind === 'date') {
      const days = Math.round((dayOf(r.after) - dayOf(r.before)) / 864e5);
      const move = { ...base, from: r.before, to: r.after, from_label: pretty(r.before), to_label: pretty(r.after), days: Number.isFinite(days) ? days : null };
      if (move.days != null && Math.abs(move.days) < 30) { small.push(move); continue; }
      const k = r.date + '|' + drug;
      if (!dateGroups.has(k)) dateGroups.set(k, { ...base, kind: 'date', moves: [] });
      dateGroups.get(k).moves.push(move);
    }
  }
  for (const g of dateGroups.values()) { g.text = movesText(g.moves); items.push(g); }
  // New hand-checked catalysts for drugs in this area
  const L = areaDrugList(area, phase_min);
  const areaDrugs = new Set(L.programs.map(p => p.id));
  items.push(...areaNews(L, since));
  for (const c of db.prepare("SELECT c.*, d.name FROM change c JOIN drug d ON d.id=c.program_id WHERE c.kind='catalyst' AND c.date >= ?").all(since))
    if (areaDrugs.has(c.program_id)) items.push({ date: c.date, label: pretty(c.date), kind: 'catalyst', drug: c.name, reviewed: true, url: c.source_url, text: `New catalyst: ${c.after}` });
  // Regulator decisions (src/ingest/decisions.js). Labelled with the decision date; `quote` is the source's own words.
  for (const c of db.prepare(`SELECT c.*, p.name, p.curated FROM change c JOIN program p ON p.id=c.program_id WHERE c.kind IN (${DECISION_SQL}) AND c.date >= ?`).all(since))
    if (areaDrugs.has(c.program_id)) items.push(decisionItem(c));
  items.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind) || a.drug.localeCompare(b.drug));
  // Routine SEC reports (one entry per company) are listed apart, folded like small date moves.
  const other = items.filter(i => i.kind === 'filing'), main = items.filter(i => i.kind !== 'filing');
  // Small date moves (under 30 days) are not shown anywhere and not counted; kept in the answer for tests.
  return { area, since, count: main.length, items: main.slice(0, limit), small_date_moves: small, other_filings: other, data: dataDates() };
}

// Regulator decisions in the feed. A decision "filing" (application accepted) is shown as kind `regulatory_filing`,
// apart from `filing` (routine SEC reports, folded in the feed).
export const DECISION_KINDS = ['approval', 'rejection', 'delay', 'opinion', 'filing', 'withdrawal'];
const DECISION_SQL = DECISION_KINDS.map(k => `'${k}'`).join(',');
function decisionItem(c) {
  return { date: c.date, label: pretty(c.decision_date || c.date), kind: c.kind === 'filing' ? 'regulatory_filing' : c.kind, region: c.region, agency: c.field,
    drug: c.name, reviewed: !!c.curated, url: c.source_url, decision_date: c.decision_date, quote: c.quote || null,
    text: c.field === 'SEC' && c.quote ? `${c.after}: “${c.quote}”` : c.after };
}

// SEC filings of the area's companies.
const ITEMS = { '1.01': 'material agreement', '2.01': 'acquisition or sale of assets', '2.02': 'results', '2.03': 'new debt', '3.02': 'unregistered share sale',
  '5.02': 'director or officer change', '7.01': 'public disclosure', '8.01': 'other events' };
export function filingText(f) {
  if (f.kind === 'offering') return `${f.form}: securities offering (prospectus)`;
  const named = String(f.items || '').split(',').filter(i => ITEMS[i]).map(i => `${ITEMS[i]} (item ${i})`);
  return `${f.form}${named.length ? ': ' + named.join(', ') : ''}`;
}
function areaNews(L, since) {
  const db = getDb();
  const cos = [...new Set(L.programs.flatMap(p => p.company_ids || []))];
  const out = [];
  if (cos.length) {
    const names = Object.fromEntries(db.prepare(`SELECT id, name FROM company WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(cos)).map(c => [c.id, c.name]));
    // Feed: deals and offerings one by one. Other 8-Ks and 6-Ks are mostly routine (share buybacks, votes, insider trades)
    // and carry no usable title, so they become one line per company linking to its page. Same-day duplicates merge.
    const seen = new Set(), reports = new Map();
    for (const f of db.prepare(`SELECT * FROM filing WHERE date >= ? AND company_id IN (SELECT value FROM json_each(?)) ORDER BY date DESC`).all(since, JSON.stringify(cos))) {
      if (f.kind === 'filing') {
        if (!reports.has(f.company_id)) reports.set(f.company_id, { date: f.date, label: pretty(f.date), kind: 'filing', drug: names[f.company_id] || f.company_id, company_id: f.company_id, reviewed: true, url: `/companies/${encodeURIComponent(f.company_id)}`, n: 0, forms: new Set() });
        const r = reports.get(f.company_id); r.n++; r.forms.add(f.form.replace(/\/A$/, ''));
        continue;
      }
      const key = `${f.company_id}|${f.date}|${filingText(f)}`;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ date: f.date, label: pretty(f.date), kind: 'deal', drug: names[f.company_id] || f.company_id, company_id: f.company_id, reviewed: true, url: f.url, text: `SEC ${filingText(f)}` });
    }
    for (const r of reports.values()) { r.text = `${r.n} SEC ${r.n === 1 ? 'report' : 'reports'} (${[...r.forms].join(', ')}), latest ${r.label}`; delete r.forms; out.push(r); }
  }
  return out;
}

export function filings(companyId, { deals_only = false, limit = 50 } = {}) {
  return getDb().prepare(`SELECT * FROM filing WHERE company_id=? ${deals_only ? "AND kind IN ('deal','share_sale','offering')" : ''} ORDER BY date DESC LIMIT ?`).all(companyId, limit)
    .map(f => ({ ...f, label: pretty(f.date), text: filingText(f) }));
}

// The registry release behind the data, for the "released at / loaded at" line.
export function releaseInfo() {
  let last = null; try { last = JSON.parse(meta.get('last_compare') || 'null'); } catch {}
  return { release: meta.get('ctgov_release') || null, loaded_at: meta.get('ctgov_release_loaded_at') || meta.get('trials_loaded_at') || null, checked_at: meta.get('ctgov_checked_at') || null, last };
}

// ---------- drug, company and target pages ----------
// Targets with a page. Hand-written for the hand-checked areas (obesity so far); `match` is searched the way landscape() searches.
export const TARGETS = {
  'glp-1': { name: 'GLP-1', match: 'glp-1' }, gip: { name: 'GIP', match: 'gip' }, glucagon: { name: 'Glucagon', match: 'glucagon' },
  amylin: { name: 'Amylin', match: 'amylin' }, mc4r: { name: 'MC4R', match: 'mc4r' }, myostatin: { name: 'Myostatin', match: 'myostatin' },
  inhbe: { name: 'INHBE', match: 'inhbe' }, cideb: { name: 'CIDEB', match: 'cideb' },
};
export const targetsIn = mech => Object.entries(TARGETS).filter(([, t]) => new RegExp(`(^|[^a-z])${t.match.replace('-', '\\-')}([^a-z]|$)`, 'i').test(mech || '')).map(([id, t]) => ({ id, name: t.name }));
// The targets readers stored with their verdicts (row_verdict.target, src/ingest/verdicts.js), targets an official drug list
// states (seed/list-targets.csv), and the target an FDA drug
// class names (seed/fda-class-targets.csv: "Interleukin-23 Antagonist" -> IL-23; a class that names no one target, such as
// "Kinase Inhibitor", gives none), grouped by src/targets.js: { groups, byRow: program id -> its groups }. "unknown" adds
// nothing. Kept until data is loaded or verdicts are applied again.
let storedCache = null;
export function storedTargets() {
  const stamp = loadStamp() + '|' + meta.get('verdicts_applied_at') + '|' + meta.get('fda_last_updated');
  if (storedCache?.stamp === stamp) return storedCache;
  let rows = [];
  try { rows = getDb().prepare('SELECT v.program_id, v.target FROM row_verdict v JOIN program p ON p.id = v.program_id WHERE v.target IS NOT NULL').all(); } catch { /* table older than the target column */ }
  epcMap = null;
  const ck = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const listed = new Map();   // drug name -> its lines (one per company)
  for (const l of LIST_TARGETS) (listed.get(norm(l.drug)) || listed.set(norm(l.drug), []).get(norm(l.drug))).push(l);
  for (const p of getDb().prepare('SELECT id, name, aliases, company FROM program').all()) {
    for (const c of String(epcOf(p.name) || '').split(/;\s*/)) { const t = FDA_CLASS_TARGETS.get(c.trim().toLowerCase()); if (t) rows.push({ program_id: p.id, target: t }); }
    const l = [p.name, ...JSON.parse(p.aliases || '[]').map(a => a.name)].flatMap(n => listed.get(norm(n)) || []).find(l => ck(p.company).includes(ck(l.company)));
    if (l) rows.push({ program_id: p.id, target: l.target });
  }
  const groups = buildGroups(rows.map(r => r.target)), byRow = new Map();
  for (const r of rows) for (const g of groupsOf(groups, r.target)) (byRow.get(r.program_id) || byRow.set(r.program_id, new Set()).get(r.program_id)).add(g);
  for (const [id, set] of byRow) byRow.set(id, [...set]);
  return (storedCache = { stamp, groups, byRow });
}
// A drug row's targets: the hand-checked ones its mechanism names, then its stored targets.
export function targetsOf(p) {
  const out = targetsIn(p.mechanism);
  for (const g of storedTargets().byRow.get(p.id) || []) if (!out.some(t => t.id === g.slug)) out.push({ id: g.slug, name: g.name });
  return out;
}

// ---------- plain-English context (src/explain.js) ----------
// FDA drug class by ingredient, salt words dropped as link.js does ("empagliflozin" -> "Sodium-Glucose Cotransporter 2 Inhibitor").
const SALTS = /\s+(calcium|sodium|potassium|hydrochloride|hcl|mesylate|maleate|tartrate|acetate|citrate|sulfate|phosphate|besylate|fumarate|succinate|bromide|chloride|dihydrate|monohydrate)\b.*/g;
let epcMap = null;
function epcOf(name) {
  if (!epcMap) {
    epcMap = new Map();
    // Drugs@FDA's class first; the NDC directory's for drugs Drugs@FDA has none for.
    try { for (const r of getDb().prepare('SELECT ingredient, epc FROM fda_class').all()) epcMap.set(norm(r.ingredient.replace(SALTS, '')), r.epc); } catch { /* table added by a newer loader */ }
    try { for (const r of getDb().prepare('SELECT ingredient, epc FROM fda_approval WHERE epc IS NOT NULL').all()) epcMap.set(norm(r.ingredient.replace(SALTS, '')), r.epc); } catch { /* column added by a newer loader */ }
  }
  const base = String(name || '').toLowerCase().replace(/\b(suspension|tablets?|capsules?|injection|solution|oral)\b/g, ' ').replace(SALTS, '');
  return epcMap.get(norm(base)) || null;
}
function explainProgram(p) {
  const fdaUrl = p.status_source && /accessdata\.fda\.gov/.test(p.status_source) ? p.status_source : null;
  return explain({ name: p.name, mechanism: p.mechanism, curated: !!p.curated, epc: p.curated && p.mechanism ? null : epcOf(p.name), fdaUrl });
}
// The diseases a drug's trials list (not "Healthy volunteers"), most often first (case-insensitive), as registered.
function testedFor(trials) {
  const n = new Map();
  for (const t of trials) for (const c of JSON.parse(t.conditions || '[]')) {
    const k = c.trim().toLowerCase(); if (!k || /^healthy\b/.test(k)) continue;   // healthy volunteers are not a disease tested
    if (!n.has(k)) n.set(k, { name: c.trim(), trials: 0 });
    n.get(k).trials++;
  }
  return [...n.values()].sort((a, b) => b.trials - a.trials);
}
// How the sponsor describes giving the drug: its intervention description (60+ characters) in the first of these trials
// that has one (trials in order, most advanced first), else the brief summary of the first trial. Quoted, with its trial.
function sponsorWords(p, ncts) {
  if (!ncts.length) return null;
  const db = getDb();
  const names = [p.name, ...JSON.parse(p.aliases || '[]').map(a => a.name)].map(norm).filter(x => x.length >= 3);
  let best = null;
  try {
    for (const i of db.prepare('SELECT nct, name, description FROM intervention WHERE nct IN (SELECT value FROM json_each(?)) AND description IS NOT NULL').all(JSON.stringify(ncts))) {
      const n = norm(i.name);
      if (!names.some(a => n.includes(a) || a.includes(n))) continue;
      const d = i.description.trim(), rank = ncts.indexOf(i.nct);
      if (d.length >= 60 && (!best || rank < best.rank || (rank === best.rank && d.length > best.text.length))) best = { text: d, nct: i.nct, kind: 'intervention', rank };
    }
    if (!best) {
      const s = db.prepare('SELECT summary FROM trial WHERE nct=?').pluck().get(ncts[0]);
      if (s) best = { text: s.trim(), nct: ncts[0], kind: 'summary' };
    }
  } catch { return null; }   // database loaded before these columns existed
  if (best) delete best.rank;
  return best && { ...best, url: ctgovUrl(best.nct) };
}

const trialOut = t => ({ nct: t.nct, url: ctgovUrl(t.nct), title: t.title, status: t.status, active: ACTIVE.includes(t.status), phase: t.phase_label, sponsor: t.sponsor,
  start: t.start_date, primary_completion: t.primary_completion, primary_completion_label: pretty(t.primary_completion), countries: JSON.parse(t.countries || '[]'), conditions: JSON.parse(t.conditions || '[]'), sites: t.n_sites });

// Copy trials (biosimilar, equivalence, PK comparison) that name another company's marketed drug (comparator table, link.js):
// on the copy's page, what it copies; other companies' drugs given in its trials; on the original's page (its owner's drug, by name or generic name), the copies tested against it.
const titleCase = s => String(s || '').replace(/[A-Za-z]+/g, w => w.length <= 3 && !/^(INC|LLC|LTD|AND|CO|THE)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase());
function comparisons(db, p, rows) {
  let copyOf = [], copies = [], givenWith = [];
  try {
    const ncts = JSON.stringify(rows.map(t => t.nct));
    const seen = [new Map(), new Map()];   // [given with, copy of]
    for (const c of db.prepare('SELECT * FROM comparator WHERE nct IN (SELECT value FROM json_each(?))').all(ncts)) {
      const m = seen[c.copy], k = c.name_norm; if (!m.has(k)) m.set(k, { name: titleCase(c.name), owner: c.owner ? titleCase(c.owner) : null, trials: [] });
      m.get(k).trials.push(c.nct);
    }
    copyOf = [...seen[1].values()];
    givenWith = [...seen[0].values()].sort((a, b) => b.trials.length - a.trials.length);
    const names = [...new Set([p.name, ...JSON.parse(p.aliases || '[]').map(a => a.name)].map(norm).filter(n => n.length >= 4))];
    const found = db.prepare(`SELECT c.nct, c.owner, t.sponsor, t.status, t.phase_label, tp.program_id, pr.name FROM comparator c JOIN trial t ON t.nct=c.nct
      JOIN trial_program tp ON tp.nct=c.nct JOIN program pr ON pr.id=tp.program_id
      WHERE c.copy=1 AND (c.name_norm IN (SELECT value FROM json_each(?)) OR c.ingredient_norm IN (SELECT value FROM json_each(?)))`).all(JSON.stringify(names), JSON.stringify(names));
    const byProg = new Map();
    for (const r of found) {
      if (!r.owner || !owns(r.owner, p.company || '') || r.program_id === p.id) continue;   // only on the owner's own page
      if (!byProg.has(r.program_id)) byProg.set(r.program_id, { id: r.program_id, name: r.name, sponsor: r.sponsor, trials: [], active: false });
      const c = byProg.get(r.program_id); c.trials.push(r.nct); c.active ||= ACTIVE.includes(r.status);
    }
    copies = [...byProg.values()].sort((a, b) => b.active - a.active || a.sponsor.localeCompare(b.sponsor));
  } catch { /* database linked before the comparator table existed */ }
  return { copy_of: copyOf, copies, given_with: givenWith };
}

export function drug(id) {
  const db = getDb();
  let p = db.prepare('SELECT * FROM program WHERE id=?').get(id);
  if (!p) { const d = db.prepare('SELECT drug_id FROM drug_alias WHERE alias_norm=?').pluck().get(norm(id)); if (d) p = db.prepare('SELECT * FROM program WHERE id=?').get(d); }
  // A row merged into another by an official drug list (src/ingest/druglists.js): its old id opens the merged drug.
  if (!p) p = db.prepare("SELECT p.* FROM program_merge m JOIN program p ON p.id=m.program_id WHERE m.member_id=? AND m.role='merged'").get(id);
  if (!p) return null;
  const rows = db.prepare('SELECT t.* FROM trial_program tp JOIN trial t ON t.nct=tp.nct WHERE tp.program_id=?').all(p.id).map(trialOut)
    .sort((a, b) => b.active - a.active || (b.phase || '').localeCompare(a.phase || '') || (endOf(a.primary_completion) || '9').localeCompare(endOf(b.primary_completion) || '9'));
  const now = today();
  const upcoming = rows.filter(t => t.active && endOf(t.primary_completion) >= now)
    .map(t => ({ date: t.primary_completion, label: pretty(t.primary_completion), what: `Primary completion, ${t.phase}`, url: t.url, news: false }));
  const news = p.drug_id ? db.prepare('SELECT * FROM catalyst WHERE drug_id=?').all(p.drug_id).filter(c => endOf(c.date) >= now)
    .map(c => ({ date: c.date, label: pretty(c.date), what: c.what, url: c.source_url, news: true, confirmed: !!c.confirmed })) : [];
  const ncts = rows.map(t => t.nct);
  const recentSince = new Date(Date.parse(now) - 90 * 864e5).toISOString().slice(0, 10);
  const recent = (ncts.length ? db.prepare(`SELECT * FROM change WHERE nct IN (SELECT value FROM json_each(?)) AND date >= ? ORDER BY date DESC LIMIT 30`)
    .all(JSON.stringify(ncts), recentSince) : [])
    .concat(db.prepare(`SELECT * FROM change WHERE program_id=? AND kind IN (${DECISION_SQL}) AND date >= ? ORDER BY date DESC LIMIT 20`).all(p.id, recentSince))
    .sort((a, b) => b.date.localeCompare(a.date));
  const companyIds = JSON.parse(p.company_ids || '[]');
  const active = rows.filter(t => t.active);
  const regPhase = Math.max(0, ...active.map(t => +(String(t.phase).match(/(\d)(?!.*\d)/)?.[1] || 0)));
  return {
    id: p.id, name: p.name, curated: !!p.curated, aliases: JSON.parse(p.aliases || '[]'), mechanism: p.mechanism, mechanism_confirmed: !!p.mechanism_confirmed,
    targets: targetsOf(p), tags: p.tags, china: p.china, explain: explainProgram(p),
    company: p.company, companies: companyIds.map(c => db.prepare('SELECT id, name, country, ticker, listed FROM company WHERE id=?').get(c)).filter(Boolean),
    stage: p.status_level && p.status_level >= regPhase ? { label: p.status_label, url: p.status_source, news: !!p.status_news }
      : { label: regPhase ? (regPhase === 4 ? 'Marketed (Phase 4 trial)' : `Phase ${regPhase}`) : 'No active trials', url: active[0]?.url || null, news: false },
    other_use: p.status_level == null && p.status_label ? { label: p.status_label, url: p.status_source } : null,
    catalysts: [...news, ...upcoming].sort((a, b) => endOf(a.date).localeCompare(endOf(b.date))).slice(0, 12),
    trials: rows, active_trials: active.length,
    tested_for: testedFor((active.length ? active : rows).map(t => ({ conditions: JSON.stringify(t.conditions) }))),
    sponsor_words: sponsorWords(p, (active.length ? active : rows).map(t => t.nct)),
    summary: (() => { const t = active[0] || rows[0]; if (!t) return null; try { const s = db.prepare('SELECT summary FROM trial WHERE nct=?').pluck().get(t.nct); return s ? { text: s.trim(), nct: t.nct, url: t.url, phase: t.phase } : null; } catch { return null; } })(),
    changes: recent.map(c => c.nct ? { date: c.date, label: pretty(c.date), kind: c.kind, nct: c.nct, url: c.source_url, before: c.before, after: c.after }
      : { ...decisionItem({ ...c, name: p.name, curated: p.curated }), nct: null }),
    ...comparisons(db, p, rows),
    fda: p.curated ? db.prepare('SELECT * FROM fda_approval WHERE lower(ingredient) = ? ORDER BY approval_date DESC LIMIT 10').all(String(p.name).toLowerCase()) : [],
    data: dataDates(),
  };
}

// A hand-checked company (by seed id), or a plain registry sponsor (by exact sponsor name).
export function company(id) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM company WHERE id=?').get(id);
  let progs, trialRows;
  if (c) {
    progs = db.prepare('SELECT * FROM program WHERE company_ids LIKE ?').all(`%"${c.id}"%`);
    const pats = JSON.parse(c.sponsor_patterns || '[]');
    trialRows = pats.length ? db.prepare(`SELECT * FROM trial WHERE ${pats.map(() => 'lower(sponsor) LIKE ?').join(' OR ')}`).all(...pats.map(like)) : [];
  } else {
    trialRows = db.prepare('SELECT * FROM trial WHERE sponsor=?').all(id);
    if (!trialRows.length) return null;
    progs = db.prepare('SELECT DISTINCT p.* FROM program p JOIN trial_program tp ON tp.program_id=p.id JOIN trial t ON t.nct=tp.nct WHERE t.sponsor=? AND p.curated=0').all(id);
  }
  const activeBy = db.prepare(`SELECT count(*) FROM trial_program tp JOIN trial t ON t.nct=tp.nct WHERE tp.program_id=? AND t.status IN (${ACTIVE_SQL})`).pluck();
  const programs = progs.map(p => ({ id: p.id, name: p.name, curated: !!p.curated, mechanism: p.mechanism, targets: targetsOf(p), status: p.status_label, active_trials: activeBy.get(p.id) }))
    .filter(p => p.active_trials || p.curated).sort((a, b) => b.curated - a.curated || b.active_trials - a.active_trials || a.name.localeCompare(b.name));
  return {
    id, curated: !!c, name: c ? c.name : id, country: c?.country || null, ticker: c?.ticker || null, listed: c ? c.listed : null,
    cik: c?.cik || null, deal_filings: c?.cik ? filings(c.id, { deals_only: true, limit: 25 }) : [], recent_filings: c?.cik ? filings(c.id, { limit: 15 }) : [],
    sponsor_names: [...new Set(trialRows.map(t => t.sponsor))].slice(0, 12),
    programs: programs.slice(0, 200), programs_total: programs.length,
    trials: { total: trialRows.length, active: trialRows.filter(t => ACTIVE.includes(t.status)).length },
    data: dataDates(),
  };
}

// A target page: a hand-checked target, or a stored target (by its group's address, "cldn18.2"), as a search for its name.
export function target(id) {
  const t = TARGETS[String(id).toLowerCase()];
  if (t) return { id, name: t.name, landscape: landscape({ area: t.match, phase_min: 1 }) };
  const g = storedTargets().groups.bySlug.get(String(id).toLowerCase());
  if (!g) return null;
  return { id: g.slug, name: g.name, landscape: landscape({ area: g.name, phase_min: 1 }) };
}
// One drug's completion dates that moved on one day, in words. All one way: "3 trial completion dates moved later";
// mixed: "3 trial completion dates moved (2 later, 1 earlier)", which the email and feed say as "2 later and 1 earlier".
export function movesText(moves) {
  const later = moves.filter(m => m.days == null || m.days > 0).length;
  return moves.length === 1 ? `Primary completion moved from ${moves[0].from_label || 'none'} to ${moves[0].to_label || 'none'}`
    : later === moves.length || !later ? `${moves.length} trial completion dates moved ${later ? 'later' : 'earlier'}`
    : `${moves.length} trial completion dates moved (${later} later, ${moves.length - later} earlier)`;
}
