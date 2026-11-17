// Name map: the other names and official IDs the public databases give for our
// drug names, so that rows of one company joined by an official ID become one row (src/ingest/onerow.js, 'same official ID').
//   node src/ingest/namemap.js fetch            ask everything not yet asked (first run: about 90 minutes)
//   node src/ingest/namemap.js import <cache>   take the answers from scripts' old cache file instead of asking again
// Run by druglists.js on every load, within its time limit, so only new names are asked.
// Answers are stored in drug_list_lookup next to the GSRS and NCI answers, under these lists:
//   gsrs-names   FDA substance (UNII) -> its names          gsrs-codes   UNII -> its PRIMARY codes ("cid:123", "nci:C1", ...)
//   nci-code     NCI dictionary entry -> its thesaurus code  pubchem      a name -> PubChem compound IDs
//   pubchem-ids  compound -> the official IDs PubChem lists for it (UNII, NCI code, ChEMBL, DrugBank)
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { getDb } from '../db.js';
import { SEEDS } from '../../seed/index.js';
import { listQuery, resolver } from './druglists.js';

const ACTIVE = "'RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION'";
const UA = { 'User-Agent': 'OpenLandscape hello@openlandscape.app', Accept: 'application/json' };
const nrm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A code is also asked without its hyphen or space (PubChem knows "LP108" and "LP 108", not "LP-108").
const spellings = q => /\d/.test(q) && nrm(q).length <= 12 ? [...new Set([q, q.replace(/[-\s]/g, ''), q.replace(/-/g, ' ')])] : [q];
const CODE = { PUBCHEM: 'cid', NCI_THESAURUS: 'nci', CAS: 'cas', INN: 'inn', CHEMBL: 'chembl', 'DRUG BANK': 'drugbank' };

// What is kept of each answer (small: names up to 60 letters, IDs only).
export const keep = {
  'gsrs-names': body => body.map(n => n.name).filter(n => n && n.length <= 60),
  'gsrs-codes': body => [...new Set(body.filter(c => c.type === 'PRIMARY' && c.code && CODE[String(c.codeSystem).toUpperCase()]).map(c => `${CODE[String(c.codeSystem).toUpperCase()]}:${String(c.code).toUpperCase()}`))],
  'nci-code': body => (body.nciConceptId ? ['nci:' + body.nciConceptId] : []),
  pubchem: body => (body.IdentifierList?.CID || []).map(String),
  'pubchem-ids': synonyms => {
    const out = new Set();
    for (const s of synonyms) {
      let m;
      if ((m = s.match(/^UNII-([A-Z0-9]{10})$/)) || ((m = s.match(/^([A-Z0-9]{10})$/)) && /\d/.test(m[1]) && /[A-Z]/.test(m[1]))) out.add('unii:' + m[1]);
      else if ((m = s.match(/^NCI-?(C\d+)$/))) out.add('nci:' + m[1]);
      else if ((m = s.match(/^(CHEMBL\d+)$/))) out.add('chembl:' + m[1]);
      else if ((m = s.match(/^(DB\d{5})$/))) out.add('drugbank:' + m[1]);
    }
    return [...out];
  },
};

// Names whose IDs are wanted: every row with an active trial and every hand-checked seed name.
function names(db) {
  const out = new Set();
  for (const s of SEEDS) for (const [name, , aliases] of s.drugs) for (const a of [name, ...aliases]) if (!a.startsWith('~')) { const q = listQuery(a.replace(/\?$/, '')); if (q) out.add(q); }
  for (const r of db.prepare(`SELECT DISTINCT p.name FROM program p JOIN trial_program tp ON tp.program_id=p.id JOIN trial t ON t.nct=tp.nct WHERE t.status IN (${ACTIVE})`).all()) { const q = listQuery(r.name); if (q) out.add(q); }
  return [...out];
}
const storedHits = db => { const m = new Map(); for (const r of db.prepare('SELECT list, query, hits FROM drug_list_lookup WHERE error IS NULL').all()) m.set(`${r.list}|${r.query}`, JSON.parse(r.hits || '[]')); return m; };

// Asks what is not yet answered, politely (one request per 260 ms per site), until `minutes` run out.
export async function fetchNameMap({ db = getDb(), minutes = Infinity, log = console.log } = {}) {
  const stopAt = Date.now() + minutes * 60_000;
  const save = db.prepare(`INSERT INTO drug_list_lookup (list, query, hits, error, fetched_at) VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(list, query) DO UPDATE SET hits=excluded.hits, error=excluded.error, fetched_at=excluded.fetched_at`);
  let have = storedHits(db);
  const last = {}, counts = { asked: 0, errors: 0 };
  const ask = async (site, url) => {
    for (let i = 0; i < 4; i++) {
      while (Date.now() - (last[site] || 0) < 260) await sleep(260 - (Date.now() - (last[site] || 0)));
      last[site] = Date.now();
      try {
        const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
        if (r.status === 404 || (site === 'pubchem' && r.status === 400)) return { none: true };
        if (r.status === 503 || r.status === 429) { await sleep(5000 * (i + 1)); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return { body: await r.json() };
      } catch (e) { if (i === 3) return { error: String(e.message || e) }; await sleep(3000 * (i + 1)); }
    }
    return { error: 'busy' };
  };
  const answer = async (list, query, site, url) => {
    if (have.has(`${list}|${query}`)) return have.get(`${list}|${query}`);
    const r = await ask(site, url);
    counts.asked++; if (r.error) counts.errors++;
    const hits = r.error ? null : r.none ? [] : keep[list](r.body);
    save.run(list, query, hits && JSON.stringify(hits), r.error || null);
    if (hits) have.set(`${list}|${query}`, hits);
    return hits;
  };
  const each = async (items, width, fn) => { let i = 0; await Promise.all(Array.from({ length: width }, async () => { while (i < items.length && Date.now() < stopAt) await fn(items[i++]); })); };

  const qs = names(db);
  const uniis = new Set(), terms = new Set();
  for (const q of qs) {
    for (const h of have.get('gsrs|' + q) || []) uniis.add(h.id);
    for (const h of have.get('nci|' + q) || []) if (!h.biosimilar) terms.add(h.id);
  }
  const gsrs = id => `https://gsrs.ncats.nih.gov/ginas/app/api/v1/substances(${id})`;
  await Promise.all([
    each([...terms], 3, id => answer('nci-code', id, 'nci', `https://webapis.cancer.gov/drugdictionary/v1/Drugs/${id}`)),
    each([...uniis], 4, async id => { await answer('gsrs-names', id, 'gsrs', gsrs(id) + '/names'); await answer('gsrs-codes', id, 'gsrs', gsrs(id) + '/codes'); }),
    each(qs, 6, async q => { for (const s of spellings(q)) if ((await answer('pubchem', s, 'pubchem', `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(s)}/cids/JSON`))?.length) break; }),
  ]);
  // Synonyms of every compound reached, 50 to a request.
  const cids = new Set();
  for (const q of qs) for (const s of spellings(q)) for (const c of have.get('pubchem|' + s) || []) cids.add(c);
  for (const id of uniis) for (const t of have.get('gsrs-codes|' + id) || []) if (t.startsWith('cid:')) cids.add(t.slice(4));
  const todo = [...cids].filter(c => !have.has('pubchem-ids|' + c));
  for (let i = 0; i < todo.length && Date.now() < stopAt; i += 50) {
    const b = todo.slice(i, i + 50);
    const r = await ask('pubchem', `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${b.join(',')}/synonyms/JSON`);
    counts.asked++;
    if (r.error) { counts.errors++; continue; }
    const got = new Map((r.body?.InformationList?.Information || []).map(x => [String(x.CID), x.Synonym || []]));
    for (const c of b) save.run('pubchem-ids', c, JSON.stringify(keep['pubchem-ids'](got.get(c) || [])), null);
  }
  log?.(`name map: ${counts.asked} asked (${counts.errors} errors)`);
  return counts;
}

// name -> { A: official IDs, P: a PubChem compound known only from PubChem's names, uniis: the name's FDA substances }.
// Uses the GSRS and NCI answers only as druglists.js does (exact, one entry, both lists agree), then follows their codes.
export function nameIds(db = getDb(), resolve = resolver(db)) {
  const have = storedHits(db);
  const entryOfName = new Map();
  const addName = (n, e) => { const k = nrm(n); if (k.length < 4) return; if (!entryOfName.has(k)) entryOfName.set(k, new Set()); entryOfName.get(k).add(e); };
  for (const [k, v] of have) {
    if (k.startsWith('gsrs-names|')) for (const n of v) addName(n, 'gsrs:' + k.slice(11));
    if (k.startsWith('nci|')) for (const h of v) if (!h.biosimilar) for (const n of [h.name, ...(h.names || [])]) if (!/biosimilar/i.test(n)) addName(n, 'nci:' + h.id);
  }
  const idsOfEntry = e => e.startsWith('gsrs:') ? ['unii:' + e.slice(5), ...(have.get('gsrs-codes|' + e.slice(5)) || [])] : ['ncidict:' + e.slice(4), ...(have.get('nci-code|' + e.slice(4)) || [])];
  const memo = new Map();
  return name => {
    const q = listQuery(name);
    if (!q) return { A: new Set(), P: null, uniis: new Set() };
    if (memo.has(q)) return memo.get(q);
    const A = new Set(), uniis = new Set(), r = resolve(name);
    if (r.gsrs) { idsOfEntry('gsrs:' + r.gsrs.id).forEach(x => A.add(x)); uniis.add(r.gsrs.id); }
    if (r.nci) idsOfEntry('nci:' + r.nci.id).forEach(x => A.add(x));
    if (!r.gsrs && !r.nci && !r.disagree) {
      // A name the FDA or NCI entry lists, letters and digits only ("LP108" = "LP-108"); one entry only.
      const es = entryOfName.get(nrm(q));
      if (es?.size === 1) { const e = [...es][0]; idsOfEntry(e).forEach(x => A.add(x)); if (e.startsWith('gsrs:')) uniis.add(e.slice(5)); }
    }
    let P = null;
    for (const s of spellings(q)) {
      const cs = have.get('pubchem|' + s);
      if (!cs?.length) continue;
      if (cs.length > 1) break;   // two compounds for one name (mixtures, salts): not used
      const ids = have.get('pubchem-ids|' + cs[0]) || [], u = ids.filter(x => x.startsWith('unii:')).map(x => x.slice(5));
      if (uniis.size && u.length && !u.some(x => uniis.has(x))) break;   // PubChem's compound is another FDA substance
      if (A.has('cid:' + cs[0]) || ids.some(x => A.has(x))) A.add('cid:' + cs[0]); else P = cs[0];
      break;
    }
    const out = { A, P, uniis };
    memo.set(q, out);
    return out;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'fetch') await fetchNameMap();
  else if (cmd === 'import' && file) {
    // The cache file of the first test (12 Nov 2026): raw answers keyed "gsrs-names:<UNII>", "pc-name:<name>", "pc-syn:<cid>", ...
    const db = getDb(), src = new Database(file, { readonly: true });
    const save = db.prepare(`INSERT OR REPLACE INTO drug_list_lookup (list, query, hits, error, fetched_at) VALUES (?,?,?,NULL,?)`);
    const LIST = { 'gsrs-names': 'gsrs-names', 'gsrs-codes': 'gsrs-codes', nci: 'nci-code', 'pc-name': 'pubchem', 'pc-syn': 'pubchem-ids' };
    let n = 0;
    db.transaction(() => {
      for (const r of src.prepare("SELECT key, status, body, at FROM ask WHERE status IN (200, 404) AND key NOT LIKE 'pc-syn-batch:%'").all()) {
        const i = r.key.indexOf(':'), list = LIST[r.key.slice(0, i)];
        if (!list) continue;
        save.run(list, r.key.slice(i + 1), JSON.stringify(r.status === 200 ? keep[list](JSON.parse(r.body)) : []), r.at); n++;
      }
    })();
    console.log(`imported ${n} answers`);
  } else console.log('usage: node src/ingest/namemap.js fetch | import <cache.db>');
}
