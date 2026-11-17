// EU trials from CTIS, the EU Clinical Trials Information System.
//   node src/ingest/ctis.js            records changed since the last run (sorted by last update), then regroups studies
//   node src/ingest/ctis.js --daily    the same, once a day from 08:00 UTC (deploy/hourly.sh)
//   node src/ingest/ctis.js --full     every record whose "last updated" date differs from ours (first load: about 2 hours)
// Uses the public portal's own JSON calls (undocumented, so they can change): POST /search lists trials, GET /retrieve/{EU CT number}
// gives one full record. One request at a time with a pause between, and an honest User-Agent.
// Keeps extracted fields only, through match.js recordRow(): no contact people, phones, emails or site staff.
// Terms: EMA's legal notice allows reuse with EMA credited; every record links its CTIS page.
// On failure it stops with a clear message; records already stored stay as they were.
import { pathToFileURL } from 'node:url';
import { getDb, meta } from '../db.js';
import { recordRow, saveRecords, companyResolver } from '../match.js';

const API = 'https://euclinicaltrials.eu/ctis-public-api';
const UA = 'OpenLandscape/0.1 (+https://openlandscape.app; hello@openlandscape.app)';
const PAUSE_MS = 400;
const PAGE = 200;            // the portal's search returns at most 10,000 results per query, so the full list is read per status
export const ctisUrl = n => `https://euclinicaltrials.eu/search-for-clinical-trials/?lang=en&EUCT=${n}`;
const iso = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(path, body) {
  for (let attempt = 0; ; attempt++) {
    await sleep(PAUSE_MS);
    let res, why;
    try {
      res = await fetch(API + path, body ? { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
        : { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.ok) return await res.json();
      why = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) throw new Error(`CTIS ${path}: ${why}`);
    } catch (e) { if (e.message.startsWith('CTIS ')) throw e; why = e.message; }
    if (attempt >= 3) throw new Error(`CTIS ${path}: ${why} after ${attempt + 1} tries`);
    await sleep((+res?.headers.get('retry-after') || [5, 30, 90][attempt]) * 1000);
  }
}
async function search(page, criteria = {}) {
  const j = await call('/search', { pagination: { page, size: PAGE }, sort: { property: 'lastUpdated', direction: 'DESC' }, searchCriteria: criteria });
  if (!Array.isArray(j?.data) || !j.pagination) throw new Error(`CTIS search answer changed shape (keys: ${Object.keys(j || {}).join(', ')})`);
  return j;
}

// ---------- one record ----------
const PHASE = { I: 1, II: 2, III: 3, IV: 4 };
// "Therapeutic confirmatory  (Phase III)" -> 3, "Phase 3"; "Phase I and Phase II (Integrated)- Other" -> 2, "Phase 1/2"
export function ctisPhase(label) {
  const ps = [...new Set([...String(label || '').matchAll(/phase\s*(IV|III|II|I)\b/gi)].map(m => PHASE[m[1].toUpperCase()]))].sort();
  return ps.length ? { phase: Math.max(...ps), phase_label: 'Phase ' + ps.join('/') } : { phase: null, phase_label: label || null };
}
const ROLE = { 1: 'test', 2: 'comparator', 3: 'placebo', 4: 'auxiliary' };
const clean = s => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t && !/^n\/?a$/i.test(t) ? t : null; };
// A substance name or code worth keeping: short, one to three words, not a description.
const nameLike = s => !!s && s.length <= 40 && !/[,;:()]/.test(s) && s.split(' ').length <= 3;
// Test and comparator products: product name, active substance, EU substance code (SUB…) and the substance's other names
// from the EU substance dictionary (codes such as NNC0487-0111, other names such as Amycretin). Placebos are left out.
export function ctisProducts(partI) {
  const out = new Map();
  for (const p of partI?.products || []) {
    const role = ROLE[p.mpRoleInTrial] || 'other';
    if (role === 'placebo' || role === 'auxiliary') continue;
    const info = p.productDictionaryInfo || {};
    const subs = info.productSubstances || [];
    const sub = clean(info.euSubstNumber) || clean(subs[0]?.substanceEvCode);
    const prod = {
      role, name: clean(p.productName || info.prodName), substance: clean(info.activeSubstanceName) || clean(subs[0]?.actSubstName), sub: sub && /^SUB\w+$/i.test(sub) ? sub.toUpperCase() : null,
      other: [...new Set([clean(info.sponsorSubstanceCode), ...subs.flatMap(s => (s.synonyms || []).map(clean))].filter(nameLike))],
      org: clean(subs[0]?.nameOrg),
    };
    const k = `${role}|${prod.sub || prod.substance || prod.name}`;
    if (!out.has(k)) out.set(k, prod);
  }
  return [...out.values()];
}
// full = /retrieve answer, listing = the trial's row from /search (phase label, last updated).
export function ctisRecord(full, listing = {}, resolveCo = () => null) {
  const app = full?.authorizedApplication;
  const partI = app?.authorizedPartI;
  if (!full?.ctNumber || !partI) return null;
  const ids = partI.trialDetails?.clinicalTrialIdentifiers || {};
  const sec = ids.secondaryIdentifyingNumbers || {};
  const sponsor = (partI.sponsors || []).find(s => s.primary) || partI.sponsors?.[0];
  const sponsorName = clean(sponsor?.organisation?.name);
  const dur = partI.trialDetails?.trialInformation?.trialDuration || {};
  // Other registries' numbers: the NCT number, other registries, and the EudraCT number of a trial moved over from the old register.
  const xrefs = [sec.nctNumber?.number, JSON.stringify(sec.additionalRegistries || []), app.eudraCt?.eudraCtCode].filter(Boolean);
  return recordRow({
    registry: 'ctis', record_id: full.ctNumber, url: ctisUrl(full.ctNumber),
    title: clean(ids.fullTitle) || clean(listing.ctTitle), title_lang: 'en',
    sponsor_raw: sponsorName, company_id: resolveCo(sponsorName),
    ...ctisPhase(listing.trialPhase),
    status: clean(full.ctStatus),
    start_date: full.startDateEU || dur.estimatedRecruitmentStartDate || null,
    conditions: JSON.stringify((partI.medicalConditions || []).map(c => clean(c.medicalCondition)).filter(Boolean)),
    protocol_code: clean(ids.shortTitle),
    countries: JSON.stringify([...new Set((app.memberStatesConcerned || []).map(m => clean(m.mscName)).filter(Boolean))]),
    last_updated: iso(listing.lastUpdated) || String(full.publishDate || '').slice(0, 10) || null,
    products: JSON.stringify(ctisProducts(partI)),
  }, { xrefs, utn: sec.whoUniversalTrialNumber?.number || null });
}

// ---------- listing ----------
// Every trial's number and "last updated" date. The search stops at 10,000 results, so it is read one status at a time.
async function listAll() {
  const total = (await search(1)).pagination.totalRecords;
  const rows = new Map();
  for (let status = 1; status <= 15; status++) {
    for (let page = 1; ; page++) {
      const j = await search(page, { status: [status] });
      if (page === 1 && j.pagination.totalRecords >= 10000) throw new Error(`CTIS status ${status} has ${j.pagination.totalRecords} trials, over the search limit of 10,000: split the listing further`);
      for (const t of j.data) rows.set(t.ctNumber, t);
      if (!j.pagination.nextPage) break;
    }
  }
  if (rows.size < total) console.log(`CTIS: listed ${rows.size} of ${total} trials (some statuses outside 1-15?)`);
  return [...rows.values()];
}
// Trials updated since a date: newest first, stop after a page where every trial is older. (The portal's sort by last update
// is only roughly in order, so we read a few days further back than needed.)
async function listSince(since) {
  const rows = [];
  for (let page = 1; page <= 49; page++) {
    const j = await search(page);
    rows.push(...j.data);
    if (!j.pagination.nextPage || j.data.every(t => (iso(t.lastUpdated) || '') < since)) return rows.filter(t => (iso(t.lastUpdated) || '') >= since);
  }
  return null;   // more changes than one search can list: read the full list instead
}

export async function loadCtis({ full = false, db = getDb(), log = console.log } = {}) {
  db.pragma('busy_timeout = 30000');
  const lastRun = meta.get('ctis_listed_through');
  const since = lastRun ? new Date(Date.parse(lastRun) - 3 * 864e5).toISOString().slice(0, 10) : null;
  let listing = !full && since ? await listSince(since) : null;
  const mode = listing ? `changes since ${since}` : 'full list';
  if (!listing) listing = await listAll();
  const have = new Map(db.prepare("SELECT record_id, last_updated FROM trial_record WHERE registry='ctis'").all().map(r => [r.record_id, r.last_updated]));
  const todo = listing.filter(t => have.get(t.ctNumber) !== iso(t.lastUpdated));
  log(`CTIS ${mode}: ${listing.length} listed, ${todo.length} new or changed`);
  const resolveCo = companyResolver(db);
  let saved = 0, missing = 0, batch = [];
  const flush = () => { if (batch.length) { saveRecords(batch, db); saved += batch.length; batch = []; } };
  for (const [i, t] of todo.entries()) {
    const row = ctisRecord(await call(`/retrieve/${encodeURIComponent(t.ctNumber)}`), t, resolveCo);
    if (row) batch.push(row); else missing++;
    if (batch.length >= 50) { flush(); log(`  ${i + 1}/${todo.length}`); }
  }
  flush();
  const newest = listing.map(t => iso(t.lastUpdated)).filter(Boolean).sort().pop();
  if (newest && (!lastRun || newest > lastRun)) meta.set('ctis_listed_through', newest);
  meta.set('ctis_checked', new Date().toISOString());
  return { mode, listed: listing.length, saved, not_public: missing, total: db.prepare("SELECT count(*) FROM trial_record WHERE registry='ctis'").pluck().get() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const due = (meta.get('ctis_checked') || '').slice(0, 10) !== new Date().toISOString().slice(0, 10) && new Date().getUTCHours() >= 8;
  if (process.argv.includes('--daily') && !due) process.exit(0);
  try {
    const r = await loadCtis({ full: process.argv.includes('--full') });
    console.log(`--- ${new Date().toISOString()} CTIS ${JSON.stringify(r)}`);
    if (r.saved) {
      const { run } = await import('./studies.js');
      console.log(`--- studies ${JSON.stringify(run())}`);
    }
  } catch (e) {
    console.error(`CTIS update failed: ${e.message}. The EU trials from the last good run (${meta.get('ctis_checked') || 'never'}) are kept; it tries again next hour.`);
    process.exit(1);
  }
}
