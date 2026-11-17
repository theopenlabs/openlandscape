// Answer key for grouping by official drug lists (src/ingest/druglists.js): every name and code of every hand-checked
// seed drug is resolved the way an automatic row's name is, and grouped by list entry.
//   right:     the name's entry is shared with no other hand-checked drug
//   not found: no usable entry (in neither list, unsure, a biosimilar code, or not looked up yet)
//   wrong:     the entry also belongs to another hand-checked drug, so the lists would merge two drugs. Any wrong fails.
// Also checks the loaded database: every merge has its list link, and no merged row holds a hand-checked drug's name.
import { getDb, norm } from '../src/db.js';
import { SEEDS } from '../seed/index.js';
import { resolver, listQuery } from '../src/ingest/druglists.js';
import { HAS_CHECKED_DATA, skip } from './private.js';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
const resolve = resolver(db);

const names = [];
for (const s of SEEDS) for (const [name, , aliases] of s.drugs)
  for (const a of [name, ...aliases]) if (!a.startsWith('~') && listQuery(a.replace(/\?$/, ''))) names.push({ drug: name.toLowerCase(), name: a.replace(/\?$/, '') });
const keysOf = n => { const r = resolve(n.name); return [r.gsrs && 'gsrs:' + r.gsrs.id, r.nci && 'nci:' + r.nci.id].filter(Boolean); };
const drugsOf = new Map();
for (const n of names) for (const k of (n.keys = keysOf(n))) { if (!drugsOf.has(k)) drugsOf.set(k, new Set()); drugsOf.get(k).add(n.drug); }

const asked = names.filter(n => resolve(n.name).asked).length;
const wrong = names.filter(n => n.keys.some(k => drugsOf.get(k).size > 1));
const right = names.filter(n => n.keys.length && !wrong.includes(n));
const drugs = new Set(names.map(n => n.drug));
const drugsFound = new Set(right.map(n => n.drug));
console.log(`      answer key: ${names.length} names of ${drugs.size} hand-checked drugs (${asked} looked up): right ${right.length}, not found ${names.length - right.length - wrong.length}, wrong ${wrong.length}; drugs found ${drugsFound.size} of ${drugs.size}`);
ok(!wrong.length, `official lists merge no two hand-checked drugs${wrong.length ? ': ' + wrong.slice(0, 6).map(n => `${n.name} (${n.drug}) -> ${[...new Set(n.keys.flatMap(k => [...drugsOf.get(k)]))].join('+')}`).join('; ') : ''}`);
if (!HAS_CHECKED_DATA) skip('names found for every hand-checked area'); else ok(asked === 0 || right.length >= asked * 0.5, `at least half the looked-up names are found (${right.length} of ${asked})`);

const merged = db.prepare("SELECT p.id, p.name, p.list_url FROM program p WHERE p.id IN (SELECT program_id FROM program_merge WHERE evidence NOT LIKE '%\"list\":\"rule\"%' AND evidence NOT LIKE '%\"list\":\"read\"%')").all();
ok(merged.every(p => p.list_url), `every list-merged row has its list link (${merged.length} rows)`);
const seedNames = new Set(names.map(n => norm(n.name)));
// Read merges (a reader's duplicate verdict, e.g. ZT002 folded into hand-checked zovaglutide) are not list merges.
const members = db.prepare(`SELECT program_id, name FROM program_merge WHERE evidence IS NULL OR evidence NOT LIKE '%"list":"read"%'`).all().filter(m => seedNames.has(norm(m.name)));
ok(!members.length, `no list-merged row holds a hand-checked drug's name${members.length ? ': ' + members.slice(0, 5).map(m => m.name).join(', ') : ''}`);
ok(!db.prepare('SELECT count(*) FROM program WHERE curated=1 AND list_url IS NOT NULL').pluck().get(), 'hand-checked drugs are never changed by list grouping');
if (!HAS_CHECKED_DATA) skip('reader-named orphan trials');
else {
// A trial a reader named the sponsor's own drug for (seed/orphan-trials.csv) is never dropped as another company's
// comparator use (Gedeon Richter's cariprazine, Ipsen's tovorafenib): its row stays apart and is queued, unless a
// person decided it is comparator use (seed/drug-decisions.js, e.g. AGO Research running a study of AbbVie's drug).
const { orphanTrials, WHY, readOrphanSeed } = await import('../scripts/orphan-trials.mjs');
const { key } = await import('../src/scoreboard.js');
const { DRUG_DECISIONS } = await import('../seed/drug-decisions.js');
const decidedComparator = DRUG_DECISIONS.filter(d => d[2] === 'comparator').map(d => d[3].split('|'));   // [auto:name, sponsor key]
const isDecided = r => decidedComparator.some(([n, co]) => n === `auto:${norm(r.drug)}` && key(r.company).startsWith(co));
const readerNamedNcts = new Set(readOrphanSeed().filter(r => r.drug !== 'no drug' && !isDecided(r)).map(r => r.nct));
const droppedNamed = orphanTrials(db).filter(t => t.why === WHY.lists && readerNamedNcts.has(t.nct));
ok(!droppedNamed.length, `no reader-named trial is removed as another company's drug${droppedNamed.length ? ': ' + droppedNamed.slice(0, 5).map(t => `${t.nct} (${t.sponsor})`).join(', ') : ''}`);
}

// Company grouping: names that are one company share a key; unrelated firms that only share a generic word do not.
{
  const { companyKey } = await import('../src/ingest/druglists.js');
  const { companyResolver } = await import('../src/match.js');
  const k = companyKey(companyResolver(db));
  const same = [['Jiangsu Hansoh Pharmaceutical Co., Ltd.', 'Hansoh BioMedical R&D'], ['R-Pharm', 'R-Pharm Overseas, Inc.'],
    ['T-MAXIMUM Pharmaceutical Inc', 'Suzhou Maximum Bio-tech Co., Ltd.'], ['3D Medicines (Beijing) Co., Ltd.', '3D Medicines (Sichuan) Co., Ltd.'],
    ['Otsuka Pharmaceutical Co., Ltd.', 'Otsuka Beijing Research Institute'], ['Servier Bio-Innovation LLC', 'Institut de Recherches Internationales Servier (I.R.I.S.)'],
    ['Biogen', 'Biogen Idec']];
  const apart = [['Q Therapeutics, Inc.', 'C4 Therapeutics, Inc.'], ['Bio-Path Holdings, Inc.', 'R-Bio'], ['Shanghai Fosun Pharmaceutical Industrial Development Co. Ltd.', 'Sun Pharma'],
    ['Zhejiang Hisun Pharmaceutical Co. Ltd.', 'Sun Pharma'], ['BioGenCell Ltd.', 'Biogen'], ['First Affiliated Hospital of Zhejiang University', 'First Affiliated Hospital of Sun Yat-sen University'],
    ['CG Oncology, Inc.', 'General Oncology, Inc.'], ['Precision BioSciences, Inc.', 'Precision Biologics, Inc'], ['University Hospitals Coventry and Warwickshire NHS Trust', 'Takeda'],
    ['REMD Biotherapeutics, Inc.', 'EMD Serono'], ['Pocket Naloxone Corp', 'Eli Lilly']];
  // Servier's two names are joined by a hand-checked company link (seed/companies.js), not in the open-source copy.
  if (!HAS_CHECKED_DATA) same.splice(same.findIndex(([a]) => a.startsWith('Servier')), 1);
  const badSame = same.filter(([a, b]) => k(a) !== k(b)), badApart = apart.filter(([a, b]) => k(a) === k(b));
  ok(!badSame.length, `one company's spellings share a company key${badSame.length ? ': ' + badSame.map(p => p.join(' / ')).join('; ') : ''}`);
  ok(!badApart.length, `unrelated firms sharing a generic word or a substring stay apart${badApart.length ? ': ' + badApart.map(p => p.join(' / ')).join('; ') : ''}`);
}
