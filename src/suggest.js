// Search suggestions as you type: diseases, types of drug, drugs and companies whose name starts with what was typed.
// Built once into memory from the database (about 60,000 names) and rebuilt when new data is loaded,
// so one suggestion list is a scan of plain strings, not a database query.
import { getDb, meta } from './db.js';
import { TARGETS } from './query.js';
import { CLASSES } from './explain.js';

const ACTIVE_SQL = "'RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION'";

// Types of drug people search for. Hand-written: `q` is what the search runs, `gloss` the plain words shown beside it.
// The first group comes from hand-checked mechanisms; `cls` types are drug classes (src/explain.js CLASSES) that
// automatic drugs get from their FDA class or name stem, so their search finds automatic drugs too.
const GLOSS = {
  'glp-1': 'the Ozempic and Wegovy family', gip: 'a gut hormone, paired with GLP-1 in Mounjaro', glucagon: 'a hormone that makes the body burn more energy',
  amylin: 'a hormone that makes people feel full', mc4r: 'a hunger switch in the brain', myostatin: 'keeps muscle during weight loss',
};
export const TYPES = [
  ...Object.entries(TARGETS).map(([id, t]) => ({ name: t.name, q: t.match, gloss: GLOSS[id] || null, href: `/targets/${id}` })),
  { name: 'GLP-1 / GIP', q: 'glp-1 gip', gloss: 'the Mounjaro and Zepbound approach' },
  { name: 'GLP-1 / glucagon', q: 'glp-1 glucagon', gloss: null },
  { name: 'Oral GLP-1', q: 'oral glp-1', gloss: 'GLP-1 as a pill' },
  { name: 'PD-1/VEGF', q: 'PD-1/VEGF', gloss: 'cancer drugs that block PD-1 and VEGF at once', area: true },
  { name: 'In vivo CAR-T', q: 'in vivo CAR-T', gloss: 'CAR-T made inside the body', area: true },
  { name: 'CAR-T', q: 'car-t', gloss: 'immune cells reprogrammed to attack one kind of cell' },
  { name: 'siRNA', q: 'sirna', gloss: 'switches off one gene' },
  { name: 'THR-beta', q: 'thr-beta', gloss: 'acts like thyroid hormone in the liver' },
  { name: 'NLRP3', q: 'nlrp3', gloss: 'blocks a switch that sets off inflammation' },
  { name: 'SGLT2 inhibitors', q: 'sglt2 inhibitors', gloss: 'kidneys flush out sugar', cls: true },
  { name: 'Statins', q: 'statins', gloss: 'lower cholesterol', cls: true },
  { name: 'DPP-4 inhibitors', q: 'dpp-4 inhibitors', gloss: 'lower blood sugar', cls: true },
  { name: 'Kinase inhibitors', q: 'kinase inhibitors', gloss: 'block growth signals in cells', cls: true },
  { name: 'PD-1 / PD-L1 blockers', q: 'pd-1 blockers', gloss: 'release a brake on the immune system to fight cancer', cls: true },
  { name: 'PARP inhibitors', q: 'parp inhibitors', gloss: 'stop cancer cells repairing DNA', cls: true },
  { name: 'CDK inhibitors', q: 'cdk inhibitors', gloss: 'stop cancer cells dividing', cls: true },
  { name: 'BTK inhibitors', q: 'btk inhibitors', gloss: 'block an enzyme B cells need; blood cancers and immune diseases', cls: true },
  { name: 'JAK inhibitors', q: 'jak inhibitors', gloss: 'calm an overactive immune system', cls: true },
  { name: 'Anticoagulants (blood thinners)', q: 'anticoagulants', gloss: 'prevent blood clots', cls: true },
  { name: 'sGC stimulators', q: 'sgc stimulators', gloss: 'relax blood vessels', cls: true },
  { name: 'Angiotensin receptor blockers (ARBs)', q: 'angiotensin receptor blockers', gloss: 'lower blood pressure', cls: true },
];
// The heading for a search: a type of drug by its name ("sglt2" -> "SGLT2 inhibitors", "statin" -> "Statins", "glp-1 gip" -> "GLP-1 / GIP"),
// anything else as typed with a capital first letter.
export function heading(q) {
  const k = key(q);
  const t = TYPES.find(t => key(t.q) === k || key(t.name) === k);
  if (t) return t.name;
  const c = Object.values(CLASSES).find(names => names.some(n => key(n) === k || key(n) === k + 's'));   // "statin" too
  if (c) return c[0];
  q = String(q || '').trim();
  return q && q[0].toUpperCase() + q.slice(1);
}
const HAND_DISEASES = ['obesity'];   // hand-checked disease landscapes (query.js AREAS)

// "GLP-1" -> "glp1", "Novo Nordisk A/S" -> "novo nordisk a s": lower case, hyphens and dots dropped, other punctuation a space.
export const key = s => String(s || '').toLowerCase().replace(/[-.'’®™]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Salt and dosage-form words: "Inclisiran Sodium for" and "inclisiran" are one drug in the list.
const FORM = /\b(sodium|potassium|calcium|hydrochloride|hcl|mesylate|maleate|tartrate|acetate|citrate|sulfate|phosphate|besylate|fumarate|succinate|bromide|chloride|dihydrate|monohydrate|injection|tablets?|capsules?|oral solution|solution|suspension|for|formulation)\b.*$/;
const raw = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const drugKey = name => key(String(name).toLowerCase().replace(FORM, ''));

let IDX = null;
function stamp() { return [meta.get('trials_loaded_at'), meta.get('ctgov_release_loaded_at'), meta.get('curated_loaded_at')].join('|'); }

function build() {
  const db = getDb();
  const entries = [];
  const add = (e, names) => { e.keys = [...new Set(names.map(key).filter(Boolean))]; e.raw = [...new Set(names.map(raw).filter(Boolean))]; entries.push(e); };

  // Diseases: listed trial conditions, case variants and a trailing "(ACRONYM)" merged; the acronym is searchable too.
  const conds = new Map();
  for (const r of db.prepare(`SELECT value AS c, t.status IN (${ACTIVE_SQL}) AS act FROM trial t, json_each(t.conditions)`).all()) {
    const full = r.c.trim(); if (!full || /^healthy/i.test(full)) continue;
    const m = full.match(/^(.*?)\s*\(([^()]{2,15})\)\s*$/);
    const base = (m ? m[1] : full).trim(), k = key(base);
    if (!k) continue;
    if (!conds.has(k)) conds.set(k, { kind: 'disease', label: base, names: [base], variants: new Map(), active: 0, total: 0 });
    const c = conds.get(k);
    c.variants.set(base, (c.variants.get(base) || 0) + 1);
    if (m && !c.names.includes(m[2])) c.names.push(m[2]);
    c.total++; if (r.act) c.active++;
  }
  const typeKeys = new Set(TYPES.flatMap(t => [key(t.name), key(t.q)]));
  // A drug listed as a condition ("Inclisiran Formulation", "Ivonescimab", "AK112") is not a disease: a hand-checked drug name,
  // an FDA-approved ingredient, or one word with a standard drug-name ending. "Alcohol" stays: it is also a disease word.
  const drugNames = new Set([...db.prepare('SELECT alias FROM drug_alias').pluck().all(), ...db.prepare('SELECT ingredient FROM fda_approval').pluck().all()].map(drugKey));
  drugNames.delete('alcohol');
  const isDrug = label => { const k = drugKey(label); return (k.length >= 4 && drugNames.has(k)) || /^[a-z]{7,}(mab|nib|tide|cept|parib|ciclib|lisib|glutide|gliflozin|siran)$/.test(k); };
  for (const c of conds.values()) {
    if (!c.active || typeKeys.has(key(c.label)) || isDrug(c.label)) continue;   // a type of drug listed as a condition ("GLP-1") shows once, as a type
    c.label = [...c.variants].sort((a, b) => b[1] - a[1] || (a[0] === a[0].toLowerCase()) - (b[0] === b[0].toLowerCase()))[0][0];
    c.hand = HAND_DISEASES.includes(key(c.label));
    c.q = c.label;
    delete c.variants;
    add(c, c.names);
  }

  // Types of drug.
  for (const t of TYPES) add({ kind: 'type', label: t.name, q: t.q, gloss: t.gloss, hand: !t.cls, active: 0 }, [t.name, t.q]);

  // Drugs: one entry per name once salt and form words are dropped; the hand-checked or most active program is the one linked.
  const progs = db.prepare(`SELECT p.id, p.name, p.aliases, p.company, p.curated, p.status_label, p.status_level,
      count(t.nct) AS active, max(t.phase) AS phase
    FROM program p LEFT JOIN trial_program tp ON tp.program_id = p.id LEFT JOIN trial t ON t.nct = tp.nct AND t.status IN (${ACTIVE_SQL})
    GROUP BY p.id`).all();
  const drugs = new Map();
  for (const p of progs) {
    const k = drugKey(p.name) || key(p.name);
    const cur = drugs.get(k);
    const better = !cur || p.curated - cur.p.curated || p.active - cur.p.active;
    if (!cur) drugs.set(k, { p, aliases: [], active: 0, n: 0 });
    const d = drugs.get(k);
    if (cur && better > 0) d.p = p;
    d.active += p.active; d.n++;
    for (const a of JSON.parse(p.aliases || '[]')) d.aliases.push(a.name);
  }
  // A code whose other name is another drug's name is that drug ("KJX839", also called Inclisiran).
  for (const [k, d] of [...drugs]) {
    if (d.p.curated) continue;
    const into = d.aliases.map(drugKey).find(a => a !== k && drugs.has(a));
    if (!into) continue;
    const t = drugs.get(into);
    t.active += d.active; t.aliases.push(d.p.name, ...d.aliases);
    if (!t.p.curated && d.p.active > t.p.active) t.p = d.p;
    drugs.delete(k);
  }
  for (const { p, aliases, active } of drugs.values()) {
    if (!active && !p.curated) continue;   // automatic drugs with no active trials: their search would come back empty
    const ph = p.phase || 0;
    const stage = p.status_level && p.status_level >= (ph === 4 ? 5 : ph) ? p.status_label
      : ph === 4 ? 'Marketed' : ph ? `Phase ${ph}` : 'no active trials';
    add({ kind: 'drug', label: p.name, href: `/drugs/${encodeURIComponent(p.id)}`, company: p.company, stage, hand: !!p.curated, active, aliases }, [p.name, ...aliases]);
  }

  // Companies: hand-checked companies (their registry sponsor names fold into them), then other registry sponsors.
  const sponsors = db.prepare(`SELECT sponsor, count(*) AS total, sum(status IN (${ACTIVE_SQL})) AS active FROM trial WHERE sponsor IS NOT NULL GROUP BY sponsor`).all();
  const folded = new Set();
  for (const c of db.prepare('SELECT * FROM company').all()) {
    const pats = JSON.parse(c.sponsor_patterns || '[]');
    let active = 0;
    for (const s of sponsors) if (pats.some(x => s.sponsor.toLowerCase().includes(x))) { active += s.active; folded.add(s.sponsor); }
    add({ kind: 'company', label: c.name, href: `/companies/${encodeURIComponent(c.id)}`, hand: true, active, detail: [c.country, c.ticker].filter(Boolean).join(' · ') }, [c.name, c.ticker || '']);
  }
  const spons = new Map();
  for (const s of sponsors) {
    if (folded.has(s.sponsor)) continue;
    const k = key(s.sponsor);
    if (!spons.has(k) || s.total > spons.get(k).total) spons.set(k, { ...s, active: (spons.get(k)?.active || 0) + s.active });
    else spons.get(k).active += s.active;
  }
  for (const s of spons.values()) if (s.active) add({ kind: 'company', label: s.sponsor, href: `/companies/${encodeURIComponent(s.sponsor)}`, hand: false, active: s.active }, [s.sponsor]);

  // Active trials' conditions, lower case, for the "in N active trials" count of the diseases shown.
  const activeConds = db.prepare(`SELECT lower(conditions) FROM trial WHERE status IN (${ACTIVE_SQL})`).pluck().all();
  return { entries, activeConds };
}
function index() {
  const s = stamp();
  if (!IDX || IDX.stamp !== s) IDX = { ...build(), stamp: s };
  return IDX;
}

// How well a name matches: 3 = starts with it, 2 = a word in it starts with it, 1 = contains it (3+ letters), 0 = no match.
function level(k, q) {
  if (k.startsWith(q)) return 3;
  if (k.includes(' ' + q)) return 2;
  // "glp" in "semaglutide glp1": also match the start of a word with its hyphen dropped, e.g. "hrs7535".
  return q.length >= 3 && k.includes(q) ? 1 : 0;
}

const GROUPS = ['disease', 'type', 'drug', 'company'];
export function suggest(query, { per = 4 } = {}) {
  const q = key(query);
  if (!q) return { query, groups: [] };
  // Typed with punctuation ("car-t", "pd-1"): names that match it as typed rank above names that match only once the
  // punctuation is dropped, so "car-t" finds CAR-T before cartilage.
  const rq = /[^a-z0-9\s]/i.test(query) ? raw(query) : null;
  const { entries, activeConds } = index();
  const hits = { disease: [], type: [], drug: [], company: [] };
  for (const e of entries) {
    let best = 0, via = null;
    for (const k of e.keys) { const l = level(k, q); if (l > best) { best = l; via = k; } if (l === 3) break; }
    if (best && rq) { const r = Math.max(...e.raw.map(k => level(k, rq))); if (r) best = r + 3; }
    if (best) hits[e.kind].push({ e, l: best, via });
  }
  const groups = [];
  for (const kind of GROUPS) {
    const order = (a, b) => b.l - a.l || b.e.hand - a.e.hand || b.n - a.n || a.e.label.length - b.e.label.length;
    for (const h of hits[kind]) h.n = h.e.active;
    let list = hits[kind].sort(order);
    list = list.slice(0, per);
    // Diseases rank by how many active trials list that exact condition: "Heart Failure" before a bare "Heart".
    // The count shown is wider, every active trial whose conditions contain the phrase, because that is what the search finds.
    if (kind === 'disease') for (const h of list) { const lk = h.e.label.toLowerCase(); h.n = activeConds.reduce((n, c) => n + c.includes(lk), 0); }
    if (!list.length) continue;
    groups.push({ kind, rank: [list[0].l, +list[0].e.hand, list[0].e.active, -GROUPS.indexOf(kind)], items: list.map(({ e, via, n }) => {
      const it = { label: e.label, hand: e.hand };
      if (e.kind === 'disease') { it.q = e.q; it.active = n; }
      if (e.kind === 'type') { it.q = e.q; it.gloss = e.gloss; }
      if (e.kind === 'drug') {
        it.href = e.href; it.company = e.company; it.stage = e.stage; it.active = e.active;
        const alias = e.aliases.find(a => key(a) === via || raw(a).includes(rq)); if (alias && key(alias) !== key(e.label)) it.also = alias;
      }
      if (e.kind === 'company') { it.href = e.href; it.detail = e.detail; it.active = e.active; }
      return it;
    }) });
  }
  // The group with the better first match comes first: it starts with what was typed, then it is hand-checked, then it has
  // more active trials; ties keep the order diseases, types, drugs, companies. "novo" opens with Novo Nordisk,
  // "HRS" with Hengrui's drugs, "inclis" with the drug inclisiran rather than a condition named after it.
  groups.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2] || b.rank[3] - a.rank[3]);
  for (const g of groups) delete g.rank;
  return { query, groups };
}

// "Did you mean heart failure?": the disease with active trials whose name is one or two letters away from what was typed
// (one letter for a short name). Used when a search finds nothing.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1]));
    prev = cur;
  }
  return prev[b.length];
}
export function didYouMean(query) {
  const q = key(query);
  if (q.length < 4) return null;
  const max = q.length < 8 ? 1 : 2;
  let best = null;
  for (const e of index().entries) {
    if (e.kind !== 'disease' || !e.active) continue;
    for (const k of e.keys) {
      const d = k === q ? max + 1 : distance(q, k, max);
      if (d <= max && (!best || d < best.d || (d === best.d && e.active > best.e.active))) best = { d, e };
    }
  }
  return best ? best.e.q : null;
}
