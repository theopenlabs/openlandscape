// Gold-set checks on the loaded database, from the hand-checked seeds in seed/.
// 1. Every seed name and alias resolves to its own drug, and only to it.
// 2. Zero merges between different seed drugs, including through automatic aliases (brands from FDA and EMA).
// 3. Hand-checked "not the same drug" pairs never share a drug; hand-checked study pairs hold.
// 4. No study holds two records of one registry unless a person decided so; every merge has its evidence.
// 5. No registry contact details are stored.
import { getDb, norm } from '../src/db.js';
import { SEEDS } from '../seed/index.js';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
const idx = new Map();
for (const a of db.prepare('SELECT alias_norm, drug_id FROM drug_alias').all()) { if (!idx.has(a.alias_norm)) idx.set(a.alias_norm, new Set()); idx.get(a.alias_norm).add(a.drug_id); }

const seedDrugs = SEEDS.flatMap(s => s.drugs.map(([name, , aliases]) => ({ id: name.toLowerCase(), names: [name, ...aliases.map(a => a.replace(/\?$/, '').replace(/^~/, ''))] })));
const wrong = [];
let n = 0;
for (const d of seedDrugs) for (const name of d.names) {
  n++;
  const hit = idx.get(norm(name));
  if (!hit || !hit.has(d.id) || hit.size > 1) wrong.push(`${name} -> ${hit ? [...hit].join('+') : 'nothing'} (expected ${d.id})`);
}
ok(!wrong.length, `all ${n} seed names and aliases of ${seedDrugs.length} drugs resolve to their own drug${wrong.length ? ': ' + wrong.slice(0, 8).join('; ') : ''}`);

const seedIds = new Set(seedDrugs.map(d => d.id));
const merged = [...idx].filter(([, ds]) => [...ds].filter(d => seedIds.has(d)).length > 1);
ok(!merged.length, `no name joins two seed drugs (wrong merges: ${merged.length})${merged.length ? ': ' + merged.slice(0, 5).map(([k, ds]) => `${k}=${[...ds].join('+')}`).join('; ') : ''}`);
const auto = db.prepare('SELECT alias, drug_id, evidence_url FROM drug_alias WHERE auto=1').all();
ok(auto.every(a => a.evidence_url), `every automatic alias (${auto.length}) has a source link`);

const nsd = SEEDS.flatMap(s => s.notSameDrug || []);
ok(nsd.every(([a, b]) => { const x = idx.get(norm(a)), y = idx.get(norm(b)); return !x || !y || ![...x].some(d => y.has(d)); }), `hand-checked "not the same drug" pairs stay apart (${nsd.length})`);
const sst = SEEDS.flatMap(s => s.sameStudy || []), nst = SEEDS.flatMap(s => s.notSameStudy || []);
const studyOf = db.prepare('SELECT study_id FROM trial_record WHERE upper(record_id)=upper(?)').pluck();
ok(sst.every(([a, b]) => !studyOf.get(a) || !studyOf.get(b) || studyOf.get(a) === studyOf.get(b)), `hand-checked same-study pairs are one study (${sst.length})`);
ok(nst.every(([a, b]) => !studyOf.get(a) || studyOf.get(a) !== studyOf.get(b)), `hand-checked not-same-study pairs are apart (${nst.length})`);

const dups = db.prepare(`SELECT l.study_id, l.registry, count(*) n FROM study_link l GROUP BY 1, 2 HAVING n > 1
  AND l.study_id NOT IN (SELECT study_id FROM study_link WHERE decided_by='hand')`).all();
ok(!dups.length, `no study holds two records of one registry (${dups.length} found)`);
const noEvidence = db.prepare("SELECT count(*) FROM study_link WHERE rule != 'own' AND (evidence IS NULL OR rule IS NULL)").pluck().get();
const st = db.prepare("SELECT count(*) n, sum(n_records > 1) m FROM study").get();
ok(noEvidence === 0, `every merge stores its rule and evidence (${st.n} studies, ${st.m || 0} with records from several registries)`);
ok(db.prepare('SELECT count(*) FROM trial_record WHERE study_id IS NULL').pluck().get() === 0, 'every registry record belongs to a study');

const tables = ['trial_record', 'study', 'study_link', 'regulatory_decision', 'match_candidate', 'company_alias'];
const cols = tables.flatMap(t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => ({ t, c: c.name, type: c.type })));
ok(!cols.some(x => /contact|phone|email|fax|investigator|address|company_rep/i.test(x.c)), 'no world-data table has a column for contact details');
const emails = tables.flatMap(t => {
  const text = cols.filter(x => x.t === t && /TEXT/i.test(x.type)).map(x => x.c);
  return text.length ? db.prepare(`SELECT ${text.join(' || char(10) || ')} AS v FROM ${t} WHERE ${text.map(c => `coalesce(${c},'') GLOB '*[A-Za-z0-9]@[A-Za-z0-9]*.[a-z]*'`).join(' OR ')}`).all().map(r => `${t}: ${String(r.v).slice(0, 80)}`) : [];
});
ok(!emails.length, `no email addresses stored in world-data tables${emails.length ? ': ' + emails.slice(0, 3).join(' | ') : ''}`);

// ---- EU CTIS ----
// A merge is wrong if independent evidence disagrees with it: a record in the study lists a different, loaded record of the
// other registry as itself (the NCT lists another EU CT number, or the EU record lists another NCT). Must be 0.
// CTIS_GOLD: pairs checked by reading both registry pages (same sponsor code, drug, phase, countries); asserted when both are loaded.
// Checked 7 Nov 2026 from both records (sponsor code, title, phase, drug); most are cases where a registry lists a wrong
// or related number, so they test the hard part.
const CTIS_GOLD = {
  same: [
    ['2023-507904-30-00', 'NCT04236414', 'AstraZeneca olaparib D0816C00025; NCT04784715 (T-DXd) lists this EU number by mistake'],
    ['2023-503224-66-00', 'NCT05712200', 'abelacimab ANT-010 Phase 3 (LILAC); its extension NCT07739888 lists this EU number'],
    ['2023-506839-15-00', 'NCT04626518', 'MK-3475-03B; the EU record lists the 03A NCT by mistake; same UTN and EudraCT'],
    ['2024-519605-36-00', 'NCT06961006', 'V940-012; the NCT lists the UTN and EU number of V940-002 by mistake'],
    ['2022-503114-23-00', 'NCT05563220', 'elacestrant umbrella study STML-ELA-0222; the EU record lists ELA-0121\'s NCT'],
    ['2023-506657-38-00', 'NCT04003636', 'KEYNOTE-966 (MK-3475-966); the EU record also lists the China extension'],
    ['2024-510696-38-00', 'NCT05079919', 'olezarsen ISIS 678354-CS5; the EU record also lists the extension CS15'],
    ['2024-512978-99-00', 'NCT04710576', 'axatilimab SNDX-6352-0504, moved from the old EU register'],
    ['2023-506881-30-00', 'NCT06153238', 'Sandoz pembrolizumab biosimilar CGME751A12101, sponsored in the EU by Hexal (8 Nov 2026)'],
    ['2025-522818-23-00', 'NCT07218146', 'ZL-1310-003, Zai Lab US in the EU and Zai Lab Shanghai in the US'],
  ],
  different: [
    ['2023-507904-30-00', 'NCT04784715', 'olaparib vs trastuzumab deruxtecan'],
    ['2023-503224-66-00', 'NCT07739888', 'abelacimab Phase 3 vs its open-label extension'],
    ['2023-506839-15-00', 'NCT04626479', 'substudy 03B vs 03A'],
    ['2023-504923-20-00', 'NCT06961006', 'V940-002 vs V940-012'],
    ['2022-503114-23-00', 'NCT05386108', 'elacestrant umbrella study vs ELA-0121'],
    ['2024-510696-38-00', 'NCT05681351', 'olezarsen CS5 vs its extension CS15'],
    ['2026-525474-20-00', 'NCT07270731', 'two Novo Nordisk trials'],
    ['2023-503185-23-00', 'NCT04912115', 'same code KET-001: ketotifen eye drops vs ketamine for dyskinesia'],
    ['2024-511936-28-00', 'NCT04638439', 'same code A20-101: OT-A201 in cancer vs ropeginterferon in hepatitis'],
    ['2023-504434-22-00', 'NCT05184712', 'same code AK112-301: EU HARMONi vs the China-only trial'],
  ],
};
const ctisN = db.prepare("SELECT count(*) FROM trial_record WHERE registry='ctis'").pluck().get();
if (ctisN) {
  const badUrl = db.prepare("SELECT count(*) FROM trial_record WHERE registry='ctis' AND url != 'https://euclinicaltrials.eu/search-for-clinical-trials/?lang=en&EUCT=' || record_id").pluck().get();
  ok(badUrl === 0, `every CTIS record links its own CTIS page (${ctisN} records)`);
  const recs = db.prepare("SELECT registry, record_id, study_id, xrefs FROM trial_record WHERE registry IN ('ctgov', 'ctis') AND study_id IN (SELECT study_id FROM trial_record WHERE registry='ctis') AND study_id IN (SELECT study_id FROM trial_record WHERE registry='ctgov')").all();
  const loaded = new Set(db.prepare("SELECT record_id FROM trial_record WHERE registry IN ('ctgov', 'ctis')").pluck().all());
  const byStudy = new Map();
  for (const r of recs) { if (!byStudy.has(r.study_id)) byStudy.set(r.study_id, []); byStudy.get(r.study_id).push(r); }
  // A record may list a related trial too (an NCT for the China extension, a sister substudy by mistake): that is only a
  // contradiction when neither record of the merged pair lists the other.
  const contradictions = [], disagreements = [];
  const handNot = new Set(db.prepare("SELECT a || '|' || b FROM not_same WHERE type='study'").pluck().all());
  for (const [sid, list] of byStudy) for (const r of list) {
    const other = r.registry === 'ctgov' ? 'ctis' : 'ctgov';
    const partners = list.filter(x => x.registry === other);
    if (!partners.length) continue;
    const listed = JSON.parse(r.xrefs || '[]').filter(id => loaded.has(id) && (other === 'ctis' ? /^20\d\d-5/.test(id) : /^NCT/.test(id)));
    // A number hand-checked as "not the same study" (seed notSameStudy) is a known wrong cross-reference.
    const elsewhere = listed.filter(id => !partners.some(p => p.record_id === id) && !handNot.has([r.record_id, id].map(s => s.toUpperCase()).sort().join('|')));
    if (!elsewhere.length) continue;
    // Not evidence against the merge: one record of the pair lists the other, or every number listed elsewhere belongs to a
    // study that already has its own record from this registry (one registry never holds two records of one trial).
    const taken = id => db.prepare('SELECT 1 FROM trial_record WHERE registry=? AND study_id=(SELECT study_id FROM trial_record WHERE record_id=?)').get(r.registry, id);
    const linked = partners.some(p => listed.includes(p.record_id) || JSON.parse(p.xrefs || '[]').includes(r.record_id)) || elsewhere.every(taken);
    (linked ? disagreements : contradictions).push(`${sid}: ${r.record_id} lists ${elsewhere.join(', ')}`);
  }
  ok(!contradictions.length, `no EU-US merge contradicts the records' own cross-references (${contradictions.length}; ${disagreements.length} records also list a related trial or a sponsor's wrong number)${contradictions.length ? ': ' + contradictions.slice(0, 5).join('; ') : ''}`);
  if (process.env.SHOW) console.log(disagreements.join('\n'));
  const sameStudy = (a, b) => studyOf.get(a) && studyOf.get(a) === studyOf.get(b);
  const both = ([a, b]) => studyOf.get(a) && studyOf.get(b);
  const g1 = CTIS_GOLD.same.filter(both), g2 = CTIS_GOLD.different.filter(both);
  ok(g1.every(([a, b]) => sameStudy(a, b)), `hand-checked EU-US pairs that are one trial are merged (${g1.filter(([a, b]) => sameStudy(a, b)).length}/${g1.length})${g1.filter(p => !sameStudy(p[0], p[1])).map(p => ' missed ' + p.slice(0, 2).join('=')).join(';')}`);
  ok(g2.every(([a, b]) => !sameStudy(a, b)), `hand-checked EU-US pairs that are different trials stay apart (${g2.length})`);
  const byRule = db.prepare(`SELECT l.rule, count(*) n FROM study_link l JOIN study s ON s.id = l.study_id
    WHERE l.registry='ctis' AND s.id LIKE 'NCT%' GROUP BY 1 ORDER BY n DESC`).all();
  console.log(`      CTIS records joined to an NCT: ${byRule.reduce((s, r) => s + r.n, 0)} of ${ctisN} (${byRule.map(r => `${r.rule} ${r.n}`).join(', ')})`);
}
