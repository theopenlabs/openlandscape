// Groups automatic drugs by official drug lists. Runs after link.js.
//   node src/ingest/druglists.js           look up names not yet asked (at most DRUGLIST_MINUTES, default 5), then group
//   node src/ingest/druglists.js fetch     look up every name not yet asked, no time limit (first run: about 4 hours)
//   node src/ingest/druglists.js group     group from the stored answers only (right after link.js)
// Lists: the FDA substance registry (GSRS; one entry per substance, keyed by UNII) and the NCI Drug Dictionary.
// Answers are stored in drug_list_lookup, so reloads and the hourly job only ask about new names.
// Rules (a wrong merge is worse than a duplicate; when unsure, rows stay apart):
//  - Only an automatic drug's own registry name is looked up, never the registry's "other names" (those mix in
//    combination partners: GFH375 -> cetuximab). Salt words at the end are stripped ("X mesylate" joins X); names of
//    two drugs ("X and Y", "X/Y") are not looked up.
//  - GSRS: exact matches only. NCI: the entry's name or one of its other names must equal the looked-up name, and a code
//    the NCI files as a biosimilar (or under a drug that has biosimilar codes) is never used: copies are their own drugs.
//    A name with two entries in one list, or different drugs in the two lists (ABL001), is not used.
//  - A hand-checked seed drug is never touched; an entry that is also a seed drug's, lists that disagree within a group,
//    or a "not the same drug" pair leave the rows apart and go to the review queue (match_candidate, type 'drug').
//  - Rows of one company (company families and "a Sanofi company" count as one) merge.
//  - Owner = the company running the most trials of the drug. A close call (second company within a factor 1.5) or a
//    partner pattern (the two companies on each other's trials) is not decided: each company keeps its row, the pair is
//    queued. Four or more companies: a common substance with no single owner, each keeps its row.
//  - Clear owner: another company's row with one trial is comparator use (dropped, as link.js treats seed drugs), unless
//    the owner collaborates on it. Another company's row found by a code, or with two or more trials, stays apart and is
//    queued (codes collide between companies; licensees and bought companies run their own trials). So does a row made
//    from a reader's answer in seed/orphan-trials.csv (the reader saw it tested as the sponsor's own drug).
//  - Reviewed pairs (seed/drug-decisions.js: same, comparator or apart) are decided instead of queued.
// Merged drugs stay "grouped by software" (curated=0). Every merge stores its list link (program.list_url, program_merge).
// After the lists, rows of one company that name the same drug are folded by src/ingest/onerow.js, including rows whose
// names share an official ID in the name map (src/ingest/namemap.js, fetched here too).
import { pathToFileURL } from 'node:url';
import { getDb, norm, meta } from '../db.js';
import { SEEDS } from '../../seed/index.js';
import { companyResolver } from '../match.js';
import { family } from '../owners.js';
import { DRUG_DECISIONS } from '../../seed/drug-decisions.js';
import { oneRowPerDrug } from './onerow.js';
import { readFileSync, existsSync } from 'node:fs';
import { parseCsv } from '../scoreboard.js';
import { fetchNameMap, nameIds } from './namemap.js';

const UA = { 'User-Agent': 'OpenLandscape hello@openlandscape.app' };
const ACTIVE = "'RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION'";
// Salt words at the end of a name: "osimertinib mesylate" -> "osimertinib". ("X hydrochloride coated" is not stripped.)
const SALT = /(?:\s+(?:mesylate|mesilate|dimesylate|hydrochloride|dihydrochloride|hcl|sodium|disodium|potassium|calcium|maleate|tartrate|acetate|citrate|sulfate|sulphate|phosphate|besylate|fumarate|succinate|adipate|tosylate|bromide|chloride|hydrate|dihydrate|monohydrate))+$/i;
// Two drugs in one name: "fexofenadine HCl and pseudoephedrine HCl", "X/Y", "X + Y", "X, Y".
const COMBO = /\s(?:\+|and|&|with|plus)\s|\/|,/i;
const MANY = 4;   // sponsors (companies) testing one substance, from which it counts as having no single owner
const nrm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The string looked up for a registry name, or null (too short, or a combination).
export function listQuery(name) {
  const s = String(name || '').replace(/[®™]/g, '').replace(/\s+/g, ' ').trim().replace(SALT, '');
  if (COMBO.test(s) || nrm(s).length < 3) return null;
  return s.toLowerCase();
}

// ---------- the two lists ----------
const gsrsUrl = q => 'https://gsrs.ncats.nih.gov/ginas/app/api/v1/substances/search?' + new URLSearchParams({ q: `"${q}"`, top: '3' });
const nciUrl = q => 'https://webapis.cancer.gov/drugdictionary/v1/Drugs/search?' + new URLSearchParams({ query: q, matchType: 'Begins', size: '20' });
// A UNII (10 letters and digits) has an FDA page; a GSRS record without one is linked by its GSRS id.
export const gsrsLink = id => (/^[A-Z0-9]{10}$/.test(id) ? `https://precision.fda.gov/uniisearch/srs/unii/${id}` : `https://gsrs.ncats.nih.gov/ginas/app/beta/substances/${id}`);
export const nciLink = slug => `https://www.cancer.gov/publications/dictionaries/cancer-drug/def/${slug}`;

// Stored answers keep only what grouping needs. GSRS: [{ id: UNII (or uuid), name }]. NCI: the entries whose name or an
// other name equals the query, [{ id, slug, name, via: 'name' | alias type, biosimilar: true if not usable }].
function gsrsHits(body) {
  return (body.exactMatches || []).map(x => ({ id: x.approvalID || x.uuid, name: x._name }));
}
function nciHits(body, q) {
  const out = [];
  for (const x of body.results || []) {
    const aliases = x.aliases || [];
    const via = nrm(x.name) === nrm(q) ? 'name' : aliases.find(a => nrm(a.name) === nrm(q))?.type;
    if (!via) continue;
    const bios = aliases.filter(a => /biosimilar/i.test(a.name));
    // A code filed as "<drug> biosimilar CODE", or any code of a drug that has biosimilar codes (originals and copies mixed).
    const biosimilar = bios.some(a => nrm(a.name).includes(nrm(q))) || (via !== 'name' && bios.length > 0) || /biosimilar/i.test(x.name);
    out.push({ id: String(x.termId), slug: x.prettyUrlName || String(x.termId), name: x.name, via, biosimilar,
      names: aliases.map(a => a.name).filter(n => n.length <= 60) });
  }
  return out;
}

async function ask(list, q) {
  const url = list === 'gsrs' ? gsrsUrl(q) : nciUrl(q);
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (r.status === 404) return { hits: [] };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      return { hits: list === 'gsrs' ? gsrsHits(body) : nciHits(body, q) };
    } catch (e) { err = e; await new Promise(res => setTimeout(res, 3000 * (i + 1))); }
  }
  return { error: String(err?.message || err) };
}

// Names to look up, in order: hand-checked seed names (the answer key), then drugs with active trials (latest phase first),
// then the rest.
export function namesToLookUp(db = getDb()) {
  const seen = new Set(), out = [];
  const add = n => { const q = listQuery(n); if (q && !seen.has(q)) { seen.add(q); out.push(q); } };
  for (const s of SEEDS) for (const [name, , aliases] of s.drugs) for (const a of [name, ...aliases]) if (!a.startsWith('~')) add(a.replace(/\?$/, ''));
  const rows = db.prepare(`SELECT p.name, max(t.status IN (${ACTIVE})) AS act, max(coalesce(t.phase,0)) AS ph FROM program p
    JOIN trial_program tp ON tp.program_id=p.id JOIN trial t ON t.nct=tp.nct WHERE p.curated=0 GROUP BY p.id ORDER BY act DESC, ph DESC, p.name`).all();
  for (const r of rows) add(r.name);
  return out;
}

// Looks up every name not yet answered (errors are asked again), 8 GSRS and 4 NCI requests at a time.
export async function fetchLists({ db = getDb(), minutes = Infinity, log = console.log } = {}) {
  const have = db.prepare('SELECT 1 FROM drug_list_lookup WHERE list=? AND query=? AND error IS NULL');
  const save = db.prepare(`INSERT INTO drug_list_lookup (list, query, hits, error, fetched_at) VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(list, query) DO UPDATE SET hits=excluded.hits, error=excluded.error, fetched_at=excluded.fetched_at`);
  const names = namesToLookUp(db);
  const stopAt = Date.now() + minutes * 60_000;
  const counts = { names: names.length, asked: 0, errors: 0 };
  const run = async (list, width) => {
    const todo = names.filter(q => !have.get(list, q));
    counts[list + '_todo'] = todo.length;
    let i = 0;
    await Promise.all(Array.from({ length: width }, async () => {
      while (i < todo.length && Date.now() < stopAt) {
        const q = todo[i++];
        const r = await ask(list, q);
        save.run(list, q, r.hits ? JSON.stringify(r.hits) : null, r.error || null);
        counts.asked++; if (r.error) counts.errors++;
        if (counts.asked % 500 === 0) log(`  ${counts.asked} answers (${counts.errors} errors)`);
      }
    }));
  };
  await Promise.all([run('gsrs', 8), run('nci', 4)]);
  meta.set('drug_lists_fetched_at', new Date().toISOString());
  return counts;
}

// ---------- resolving a name ----------
// name -> { gsrs: {id, name} | null, nci: {id, slug, name} | null, asked: bool }. An answer with two different entries
// is unsure and not used.
export function resolver(db = getDb()) {
  const rows = new Map();
  for (const r of db.prepare('SELECT list, query, hits FROM drug_list_lookup WHERE error IS NULL').all()) rows.set(`${r.list}|${r.query}`, JSON.parse(r.hits || '[]'));
  return name => {
    const q = listQuery(name);
    if (!q) return { gsrs: null, nci: null, asked: false };
    const g = rows.get(`gsrs|${q}`), n = rows.get(`nci|${q}`);
    const gs = [...new Map((g || []).map(h => [h.id, h])).values()];
    const ns = [...new Map((n || []).filter(h => !h.biosimilar).map(h => [h.id, h])).values()];
    const out = { gsrs: gs.length === 1 ? gs[0] : null, nci: ns.length === 1 && !(n || []).some(h => h.biosimilar) ? ns[0] : null, asked: !!(g || n) };
    // Both lists know the name: they must name the same drug ("ABL001" is asciminib in GSRS, CTX-009 in NCI: neither is used).
    if (out.gsrs && out.nci) {
      const gn = nrm(out.gsrs.name), nn = [out.nci.name, ...(out.nci.names || [])].map(nrm);
      if (!nn.some(x => x === gn || (gn.length >= 6 && x.includes(gn)))) return { gsrs: null, nci: null, asked: true, disagree: true };
    }
    return out;
  };
}

// ---------- grouping ----------
// Two sponsor names are one company when the resolver says so, or (for companies not in the seeds) when their first
// distinctive word is the same: "Jiangsu Hansoh Pharmaceutical Co., Ltd." and "Hansoh BioMedical R&D" -> "hansoh".
const PLACE = new Set(('xian jiangsu shanghai beijing zhejiang guangzhou guangdong shenzhen sichuan suzhou hangzhou chengdu nanjing shandong tianjin wuhan hubei hunan anhui fujian xiamen jiangxi hebei henan shanxi shaanxi yunnan chongqing qilu taizhou lianyungang changchun harbin dalian ' +
  'china chinese hong kong taiwan korea korean japan american national international global ' +
  'pharmaceutical pharmaceuticals pharma pharmaceutics medicine medicines medical biotech biotechnology biopharma biopharmaceutical biopharmaceuticals biologics biological biosciences bioscience therapeutics ' +
  'group holdings holding company limited technology technologies science sciences research development innovation innovative health healthcare laboratories laboratory life new ' +
  'inc incorporated corp corporation co llc ltd plc gmbh srl spa sa ag the').split(' '));
const INSTITUTION = /\b(hospital|universit|college|ministry|nhs\b|school of)/i;
const GENERIC = new Set(('bio cell cells united first second third general south north east west central city state public people federal ' +
  'children cancer clinical oncology immune molecular applied advanced disease data pharm traditional european canadian province provincial ' +
  'laboratorio laboratorios laboratoire universidad universidade fundacion fundacao alpha gamma nova blue joint institute institut instituto precision boston zhuhai oxford swiss stem translational premier immuno orion').split(' '));
// "Genzyme, a Sanofi Company", "Peloton Therapeutics, Inc., a subsidiary of Merck": the parent's name.
const PARENT = /\b(?:an?\s+([^,()]+?)\s+(?:company|group company|affiliate)\b|subsidiary of\s+([^,()]+))/i;
export function companyKey(resolveCo) {
  return function key(sponsor) {
    const m = String(sponsor || '').match(PARENT);
    if (m && (m[1] || m[2]).trim().length >= 3) sponsor = (m[1] || m[2]).trim();
    // "Merck & Co." and "Merck Sharp & Dohme" are one company (not Merck KGaA, which is EMD Serono).
    if (/\bmerck\b/i.test(sponsor) && !/kgaa|serono|\bemd\b|darmstadt/i.test(sponsor)) sponsor = 'merck sharp';
    const f = family(String(sponsor || ''));
    if (f >= 0) return 'family:' + f;
    const id = resolveCo(sponsor);
    if (id && !id.startsWith('name:')) return id;
    // Only the name's first real word (after places and legal words) joins names, and only when it is distinctive.
    // "Q Therapeutics, Inc." and "C4 Therapeutics, Inc." are not one company "inc"; "First Affiliated Hospital of ..."
    // are many hospitals; "CG Oncology" is not "General Oncology". Those keep their own name. A short first part before
    // a hyphen is dropped, or joined when what follows is generic; a two-letter code with a digit counts ("3D Medicines", "C4 Therapeutics").
    if (INSTITUTION.test(sponsor)) return id;
    const low = String(sponsor || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const first = t => t.split(/[^a-z0-9]+/).find(x => x && !PLACE.has(x));
    let w = first(low.replace(/\b[a-z0-9]{1,2}-(?=[a-z])/g, ''));                      // "T-MAXIMUM" is Maximum
    if (GENERIC.has(w)) w = first(low.replace(/\b([a-z0-9]{1,2})-(?=[a-z])/g, '$1'));  // "R-Pharm" is rpharm, not pharm
    return w && !GENERIC.has(w) && (w.length >= 3 && !/^\d+$/.test(w) || /^(?=.*\d)(?=.*[a-z])[a-z0-9]{2}$/.test(w)) ? 'word:' + w : id;
  };
}

export function group({ db = getDb() } = {}) {
  const resolve = resolver(db);
  const coKey = companyKey(companyResolver(db));
  const today = new Date().toISOString().slice(0, 10);

  // Seed entries: every list entry any name of a hand-checked drug resolves to.
  const seedOf = new Map();
  for (const s of SEEDS) for (const [name, , aliases] of s.drugs) for (const a of [name, ...aliases]) {
    if (a.startsWith('~')) continue;
    const r = resolve(a.replace(/\?$/, ''));
    for (const k of [r.gsrs && 'gsrs:' + r.gsrs.id, r.nci && 'nci:' + r.nci.id].filter(Boolean)) {
      if (!seedOf.has(k)) seedOf.set(k, new Set());
      seedOf.get(k).add(name.toLowerCase());
    }
  }
  const notSame = new Set(db.prepare("SELECT a || '|' || b FROM not_same WHERE type='drug'").pluck().all());

  const progs = db.prepare('SELECT * FROM program WHERE curated=0').all();
  const trialsOf = new Map();
  for (const r of db.prepare(`SELECT tp.program_id, tp.nct, t.sponsor, t.collaborators, t.status IN (${ACTIVE}) AS act, coalesce(t.phase,0) AS phase FROM trial_program tp
    JOIN program p ON p.id=tp.program_id AND p.curated=0 JOIN trial t ON t.nct=tp.nct`).all()) {
    if (!trialsOf.has(r.program_id)) trialsOf.set(r.program_id, []);
    trialsOf.get(r.program_id).push(r);
  }
  // Trials a reader named the sponsor's drug for (seed/orphan-trials.csv): the reader saw it in the experimental arm,
  // so a row made from one is that company's product (often a licensee's), never comparator use.
  const orphanSeed = process.env.ORPHAN_SEED || new URL('../../seed/orphan-trials.csv', import.meta.url);   // ORPHAN_SEED: tests only
  const readerNamed = new Set((existsSync(orphanSeed) ? parseCsv(readFileSync(orphanSeed, 'utf8')) : []).filter(r => r.drug !== 'no drug').map(r => r.nct));
  const namedByReader = id => (trialsOf.get(id) || []).some(t => readerNamed.has(t.nct));
  // Each program -> its entries; union-find over shared entries.
  const entries = new Map(), byEntry = new Map();
  const stats = { programs: progs.length, active: 0, phase3: 0, asked: 0, found: 0, found_active: 0, found_phase3: 0, found_gsrs: 0, found_nci: 0 };
  for (const p of progs) {
    const r = resolve(p.name), ts = trialsOf.get(p.id) || [];
    const act = ts.some(t => t.act), p3 = ts.some(t => t.phase >= 3);
    stats.active += act; stats.phase3 += p3; stats.asked += r.asked;
    const e = [r.gsrs && { key: 'gsrs:' + r.gsrs.id, list: 'gsrs', ...r.gsrs }, r.nci && { key: 'nci:' + r.nci.id, list: 'nci', ...r.nci }].filter(Boolean);
    if (!e.length) continue;
    entries.set(p.id, e);
    stats.found++; stats.found_active += act; stats.found_phase3 += p3;
    if (r.gsrs) stats.found_gsrs++; if (r.nci) stats.found_nci++;
    for (const x of e) { if (!byEntry.has(x.key)) byEntry.set(x.key, []); byEntry.get(x.key).push(p.id); }
  }
  const up = new Map([...entries.keys()].map(id => [id, id]));
  const find = k => { while (up.get(k) !== k) { up.set(k, up.get(up.get(k))); k = up.get(k); } return k; };
  for (const ids of byEntry.values()) for (let i = 1; i < ids.length; i++) up.set(find(ids[i]), find(ids[0]));
  const comps = new Map();
  for (const id of entries.keys()) { const r = find(id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(id); }

  const byId = new Map(progs.map(p => [p.id, p]));
  const candidates = [], merges = [], drops = [];
  const queue = (left, right, score, reasons) => candidates.push([left, right, score, JSON.stringify(reasons), reasons.evidence]);
  const nTrials = ids => new Set(ids.flatMap(id => (trialsOf.get(id) || []).map(t => t.nct))).size;
  Object.assign(stats, { groups: 0, merged_rows: 0, seed_entry: 0, disagree: 0, not_same: 0, close_calls: 0, partners: 0, one_trial_each: 0, many_sponsors: 0, other_company_apart: 0, comparator_rows_dropped: 0, comparator_trials_dropped: 0 });

  for (const ids of comps.values()) {
    if (ids.length < 2 && !entries.get(ids[0]).some(e => seedOf.has(e.key))) continue;
    const ents = [...new Map(ids.flatMap(id => entries.get(id)).map(e => [e.key, e])).values()];
    const evidence = ents.map(e => ({ list: e.list, id: e.id, name: e.name, url: e.list === 'gsrs' ? gsrsLink(e.id) : nciLink(e.slug) }));
    const names = ids.map(id => byId.get(id).name);
    // A hand-checked drug's entry: never merged into it or around it.
    const seeds = [...new Set(ents.flatMap(e => [...(seedOf.get(e.key) || [])]))];
    if (seeds.length) {
      stats.seed_entry += ids.length;
      for (const id of ids) queue(id, seeds.join(' | '), 0.6, { rule: 'list entry of a hand-checked drug', name: byId.get(id).name, seed: seeds, evidence });
      continue;
    }
    // The lists disagree: two GSRS entries or two NCI entries in one group (chained through the other list).
    if (ents.filter(e => e.list === 'gsrs').length > 1 || ents.filter(e => e.list === 'nci').length > 1) {
      stats.disagree += ids.length;
      queue(ids[0], ids.slice(1).join(' | '), 0.5, { rule: 'lists disagree', names, evidence });
      continue;
    }
    const nsd = names.flatMap((a, i) => names.slice(i + 1).map(b => [norm(a), norm(b)].sort().join('|'))).find(k => notSame.has(k));
    if (nsd) { stats.not_same += ids.length; queue(ids[0], ids.slice(1).join(' | '), 0.4, { rule: 'hand-checked: not the same drug', pair: nsd, names, evidence }); continue; }

    // Companies by trials run (sponsor), across the whole group.
    // (link.js keys each automatic row on one sponsor, so a row belongs to the company of its first trial.)
    const byCo = new Map();
    for (const id of ids) {
      const k = coKey((trialsOf.get(id) || [])[0]?.sponsor || byId.get(id).company);
      if (!byCo.has(k)) byCo.set(k, { progs: new Set(), ncts: new Set() });
      byCo.get(k).progs.add(id); for (const t of trialsOf.get(id) || []) byCo.get(k).ncts.add(t.nct);
    }
    const ranked = [...byCo].sort((a, b) => b[1].ncts.size - a[1].ncts.size || a[0].localeCompare(b[0]));
    const [top, second] = ranked;
    const T = top[1].ncts.size, S = second ? second[1].ncts.size : 0;
    const collabs = id => (trialsOf.get(id) || []).map(t => ({ sp: coKey(t.sponsor), co: JSON.parse(t.collaborators || '[]').map(coKey) }));
    const partner = second && ids.some(id => collabs(id).some(x => (x.sp === top[0] && x.co.includes(second[0])) || (x.sp === second[0] && x.co.includes(top[0]))));
    const close = second && S * 1.5 >= T;
    stats.groups++;
    const mergeInto = (members, evidenceList, extra) => {
      const keep = members.slice().sort((a, b) => nTrials([b]) - nTrials([a]) || a.localeCompare(b))[0];
      if (members.length > 1 || extra.length) merges.push({ keep, members, extra, evidence: evidenceList });
      return keep;
    };
    // A substance many unrelated sponsors test (a vitamin, an old generic, a natural product) has no single owner:
    // each sponsor keeps its own row, nothing is queued.
    if (ranked.length >= MANY) {
      stats.many_sponsors++;
      for (const [, v] of ranked) mergeInto([...v.progs], evidence, []);
      continue;
    }
    if (second && (close || partner)) {
      // Not decided: each company keeps its own (merged) row; the top two are queued.
      const keeps = ranked.map(([, v]) => mergeInto([...v.progs], evidence, []));
      if (T === 1) { stats.one_trial_each++; continue; }   // a few one-off trials: nothing worth a person's time
      if (partner) stats.partners++; else stats.close_calls++;
      queue(keeps[0], keeps[1], partner ? 0.7 : 0.6, { rule: partner ? 'owner: partner pattern' : 'owner: close call', names, companies: ranked.slice(0, 4).map(([k, v]) => ({ company: k, trials: v.ncts.size })), evidence });
      continue;
    }
    // Clear owner: the owner's rows merge. Another company's row with one trial is comparator use (dropped, unless the
    // owner collaborates on that trial). Kept apart and queued instead: another company's row found by a code (codes
    // collide between companies, BDB001 is Eikon's and Staidson's; a licensee often keeps the code), and a company
    // running two or more trials of the drug (often a licensee or a company the owner bought, e.g. Arena and Pfizer).
    const ownerProgs = [...top[1].progs];
    const coOf = id => ranked.find(([, v]) => v.progs.has(id));
    const coded = ids.filter(id => !ownerProgs.includes(id) && (/\d/.test(byId.get(id).name) || coOf(id)[1].ncts.size >= 2 || namedByReader(id)));
    const others = ids.filter(id => !ownerProgs.includes(id) && !coded.includes(id));
    if (coded.length) stats.other_company_apart += coded.length;
    const extra = [];
    for (const id of others) for (const t of trialsOf.get(id) || [])
      if (coKey(t.sponsor) !== top[0] && JSON.parse(t.collaborators || '[]').map(coKey).includes(top[0])) extra.push([t.nct, id]);
    const keep = mergeInto(ownerProgs, evidence, extra);
    if (!merges.some(m => m.keep === keep)) merges.push({ keep, members: ownerProgs, extra, evidence });
    for (const id of others) drops.push([id, keep, evidence]);
    for (const id of coded) queue(id, keep, 0.5, { rule: /\d/.test(byId.get(id).name) ? 'code of another company' : coOf(id)[1].ncts.size >= 2 ? 'another company runs trials too' : 'named by a reader as its own drug',
      name: byId.get(id).name, company: coOf(id)[0], trials: coOf(id)[1].ncts.size, owner: top[0], owner_trials: T, names, evidence });
  }

  // Reviewed pairs (seed/drug-decisions.js) are decided here instead of queued.
  const decided = new Map(DRUG_DECISIONS.flatMap(d => [[`${d[0]}|${d[1]}`, d], [`${d[1]}|${d[0]}`, d]]));
  const recOf = id => merges.find(m => m.members.includes(id));
  const open = [];
  Object.assign(stats, { reviewed_same: 0, reviewed_comparator: 0, reviewed_apart: 0 });
  for (const c of candidates) {
    const d = decided.get(`${c[0]}|${c[1]}`);
    if (!d || !byId.has(c[0]) || (d[2] !== 'apart' && !byId.has(c[1]))) { open.push(c); continue; }
    if (d[2] === 'apart') { stats.reviewed_apart++; continue; }
    if (d[2] === 'comparator') {
      // The dropped company's rows (one, or its merged rows) leave; the other side keeps the drug.
      const rec = recOf(d[3]);
      if (rec) merges.splice(merges.indexOf(rec), 1);
      const to = d[3] === c[0] ? c[1] : c[0];
      if (!recOf(to)) merges.push({ keep: to, members: [to], extra: [], evidence: c[4] });   // so it gets its list link
      for (const id of rec ? rec.members : [d[3]]) drops.push([id, to, c[4]]);
      stats.reviewed_comparator++;
      continue;
    }
    // same: the two sides (each a row or a company's merged rows) become one drug, kept on the busiest row.
    const [a, b] = [c[0], c[1]].map(id => recOf(id) || { members: [id], extra: [], evidence: c[4] });
    if (a === b) continue;
    for (const r of [a, b]) if (merges.includes(r)) merges.splice(merges.indexOf(r), 1);
    const members = [...a.members, ...b.members];
    const keep = members.slice().sort((x, y) => nTrials([y]) - nTrials([x]) || x.localeCompare(y))[0];
    merges.push({ keep, members, extra: [...a.extra, ...b.extra], evidence: b.evidence });
    stats.reviewed_same++;
  }

  // ---------- write ----------
  db.transaction(() => {
    db.exec("DELETE FROM program_merge; DELETE FROM match_candidate WHERE type='drug' AND status='open';");
    const reviewed = new Set(db.prepare("SELECT left_id || '|' || right_id FROM match_candidate WHERE type='drug'").pluck().all());
    const insM = db.prepare('INSERT OR REPLACE INTO program_merge (program_id, member_id, name, sponsor, trials, role, evidence, date) VALUES (?,?,?,?,?,?,?,?)');
    const moveTP = db.prepare('INSERT OR IGNORE INTO trial_program (nct, program_id, matched_on) SELECT nct, ?, matched_on FROM trial_program WHERE program_id=?');
    const moveOne = db.prepare('INSERT OR IGNORE INTO trial_program (nct, program_id, matched_on) SELECT nct, ?, matched_on FROM trial_program WHERE program_id=? AND nct=?');
    const delTP = db.prepare('DELETE FROM trial_program WHERE program_id=?');
    const delP = db.prepare('DELETE FROM program WHERE id=?');
    const setP = db.prepare('UPDATE program SET name=?, aliases=?, status_label=?, status_level=?, status_source=?, list_url=? WHERE id=?');
    const sponsorOf = id => (trialsOf.get(id) || [])[0]?.sponsor || byId.get(id).company;
    for (const m of merges) {
      const keep = byId.get(m.keep), members = m.members.map(id => byId.get(id));
      // Display name: a member name that is the list's own name (usually the generic name), else the busiest row's.
      const listNames = new Set(m.evidence.map(e => nrm(e.name)));
      const name = members.map(p => p.name).find(n => listNames.has(nrm(listQuery(n) || n))) || keep.name;
      const al = new Map();
      for (const p of [...members, ...m.extra.map(([, id]) => byId.get(id))]) {
        if (nrm(p.name) !== nrm(name)) al.set(nrm(p.name), { name: p.name, confirmed: 1, list: 1 });
        for (const a of JSON.parse(p.aliases || '[]')) if (nrm(a.name) !== nrm(name) && !al.has(nrm(a.name))) al.set(nrm(a.name), a);
      }
      const st = members.find(p => p.status_level === 5) || keep;
      const ev = m.evidence[0];
      setP.run(name, JSON.stringify([...al.values()].slice(0, 10)), st.status_label, st.status_level, st.status_source, ev.url, keep.id);
      for (const p of members) {
        insM.run(keep.id, p.id, p.name, sponsorOf(p.id), nTrials([p.id]), p.id === keep.id ? 'kept' : 'merged', JSON.stringify(m.evidence), today);
        if (p.id === keep.id) continue;
        moveTP.run(keep.id, p.id); delTP.run(p.id); delP.run(p.id);
        // Regulator decisions, feed rows and held news that named the merged row now name the drug it joined.
        for (const sql of ['UPDATE regulatory_decision SET program_id=? WHERE program_id=?', 'UPDATE change SET program_id=? WHERE program_id=?']) db.prepare(sql).run(keep.id, p.id);
        db.prepare("UPDATE match_candidate SET reasons=replace(reasons, ?, ?) WHERE type='decision' AND status='open' AND instr(reasons, ?)").run(`"${p.id}"`, `"${keep.id}"`, `"${p.id}"`);
        stats.merged_rows++;
      }
      for (const [nct, id] of m.extra) { moveOne.run(keep.id, id, nct); insM.run(keep.id, id, byId.get(id).name, sponsorOf(id), 1, 'owner collaborates', JSON.stringify(m.evidence), today); }
    }
    for (const [id, to, evidence] of drops) {
      const keep = recOf(to)?.keep || to;   // the row it pointed at may have merged into another since
      // Every trial of this row that the owner collaborates on has been copied above; the rest are comparator use.
      insM.run(keep, id, byId.get(id).name, sponsorOf(id), nTrials([id]), 'other sponsor: comparator use', JSON.stringify(evidence), today);
      stats.comparator_rows_dropped++; stats.comparator_trials_dropped += nTrials([id]);
      delTP.run(id); delP.run(id);
    }
    const insC = db.prepare("INSERT OR IGNORE INTO match_candidate (type, left_id, right_id, score, reasons) VALUES ('drug',?,?,?,?)");
    stats.queued = 0;
    for (const c of open) if (!reviewed.has(`${c[0]}|${c[1]}`)) { insC.run(...c.slice(0, 4)); stats.queued++; }
  })();
  // Rows of one company that name the same drug (src/ingest/onerow.js). Last, so it cannot change the grouping above.
  Object.assign(stats, oneRowPerDrug({ db, coKey, resolve, ids: nameIds(db, resolve) }));
  meta.set('drug_lists_grouped_at', new Date().toISOString());
  return stats;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2] || 'load';
  if (cmd === 'fetch' || cmd === 'load') {
    const minutes = cmd === 'fetch' ? Infinity : +(process.env.DRUGLIST_MINUTES ?? 5);
    console.log(JSON.stringify(await fetchLists({ minutes })));
    console.log(JSON.stringify(await fetchNameMap({ minutes })));
  }
  if (cmd === 'group' || cmd === 'load') console.log(JSON.stringify(group()));
}
