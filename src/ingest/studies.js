// Builds the study layer above registry records. Runs after link.js.
//   node src/ingest/studies.js
// 1. Hand-checked seed lists: company parents and aliases, "not the same" pairs.
// 2. One trial_record per ClinicalTrials.gov trial (other registries add their own records in their loaders).
// 3. Automatic drug aliases, only from pairings a source makes itself: Drugs@FDA brand + ingredient, EMA medicine + INN,
//    CTIS product + EU substance code + the substance's other names.
// 4. Groups records into studies (match.js) and applies hand-checked sameStudy pairs last.
// The NCT-keyed `trial` table stays as it is, so pages, MCP tools and changes.js work unchanged.
import { pathToFileURL } from 'node:url';
import { getDb, meta, norm } from '../db.js';
import { SEEDS } from '../../seed/index.js';
import * as companies from '../../seed/companies.js';
import * as studyDecisions from '../../seed/study-decisions.js';
import { recordRow, saveRecords, companyResolver, buildStudies, applySeedOverrides, addAutoAlias, stripSalt } from '../match.js';

const fdaUrl = appl => `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appl.replace(/^\D+/, '')}`;

export function ctgovRecords(db = getDb()) {
  const co = companyResolver(db);
  const drugs = new Map();
  for (const i of db.prepare("SELECT nct, name, other_names FROM intervention WHERE type IN ('DRUG', 'BIOLOGICAL', 'COMBINATION_PRODUCT')").all()) {
    if (!drugs.has(i.nct)) drugs.set(i.nct, []);
    drugs.get(i.nct).push({ role: 'intervention', name: i.name, other: JSON.parse(i.other_names || '[]') });
  }
  const rows = db.prepare('SELECT nct, title, sponsor, phase, phase_label, status, start_date, primary_completion, conditions, countries, last_update, org_study_id, secondary_ids FROM trial').all()
    .map(t => recordRow({
      registry: 'ctgov', record_id: t.nct, url: `https://clinicaltrials.gov/study/${t.nct}`, title: t.title, title_lang: 'en', sponsor_raw: t.sponsor,
      company_id: co(t.sponsor), phase: t.phase, phase_label: t.phase_label, status: t.status, start_date: t.start_date, primary_completion: t.primary_completion,
      conditions: t.conditions, protocol_code: t.org_study_id, countries: t.countries, last_updated: t.last_update, products: JSON.stringify(drugs.get(t.nct) || []),
    }, { xrefs: JSON.parse(t.secondary_ids || '[]').map(x => x.id) }));
  saveRecords(rows, db);
  return rows.length;
}

// Brand names from Drugs@FDA for hand-checked drugs: single-ingredient products whose sponsor is one of the drug's companies.
// Drugs@FDA abbreviates sponsors ("NOVO", "ELI LILLY AND CO"), so the sponsor's first word must be a word of a company name.
export function fdaBrandAliases(db = getDb()) {
  const byName = new Map(db.prepare("SELECT alias_norm, drug_id FROM drug_alias WHERE coalesce(auto,0)=0").all().map(a => [a.alias_norm, a.drug_id]));
  const words = s => String(s || '').toLowerCase().match(/[a-z]{3,}/g) || [];
  const coWords = new Map(db.prepare('SELECT id, name, sponsor_patterns FROM company').all().map(c => [c.id, new Set([...words(c.name), ...words(c.sponsor_patterns)])]));
  const owners = new Map(db.prepare('SELECT id, companies FROM drug').all().map(d => [d.id, JSON.parse(d.companies)]));
  const single = db.prepare('SELECT appl_no, brand, max(ingredient) AS ingredient, max(sponsor) AS sponsor FROM fda_approval GROUP BY appl_no, brand HAVING count(*)=1').all();
  let added = 0;
  for (const r of single) {
    const d = byName.get(norm(stripSalt(r.ingredient)));
    const first = words(r.sponsor)[0];
    if (!d || !r.brand || !first || !(owners.get(d) || []).some(c => coWords.get(c)?.has(first))) continue;
    const brand = r.brand.replace(/\s*\(.*?\)/g, '').replace(/\s+(kwikpen|pen|autoinjector|flextouch|prefilled.*)$/i, '').trim();
    if (addAutoAlias(db, { alias: brand, drug_id: d, kind: 'brand', evidence_url: fdaUrl(r.appl_no) }) === 'added') added++;
  }
  return added;
}
// EU medicine names stored by the EMA loader (regulatory_decision), for hand-checked drugs.
export function emaBrandAliases(db = getDb()) {
  let added = 0;
  for (const r of db.prepare("SELECT DISTINCT product, drug_id, source_url FROM regulatory_decision WHERE agency='EMA' AND drug_id IS NOT NULL AND product IS NOT NULL").all())
    if (addAutoAlias(db, { alias: r.product.replace(/\s*\(previously.*$/i, ''), drug_id: r.drug_id, kind: 'brand', evidence_url: r.source_url }) === 'added') added++;
  return added;
}

// EU substance codes and substance names from CTIS products, for hand-checked drugs. CTIS pairs them itself: one product lists
// its active substance, EU substance code (SUB…) and the substance's other names from the EU substance dictionary.
// A product counts only if exactly one hand-checked drug owns one of its names, and the trial's sponsor or the substance's
// registrant is one of that drug's companies (codes are only unique within a company). The trial's CTIS page is the evidence.
export function ctisSubstanceAliases(db = getDb()) {
  const co = companyResolver(db);
  const byName = new Map();
  for (const a of db.prepare('SELECT alias_norm, drug_id FROM drug_alias WHERE coalesce(auto,0)=0').all()) { if (!byName.has(a.alias_norm)) byName.set(a.alias_norm, new Set()); byName.get(a.alias_norm).add(a.drug_id); }
  const owners = new Map(db.prepare('SELECT id, companies FROM drug').all().map(d => [d.id, new Set(JSON.parse(d.companies || '[]').map(c => co.root(c)))]));
  let added = 0;
  const done = new Set();
  for (const r of db.prepare("SELECT url, sponsor_raw, products FROM trial_record WHERE registry='ctis' AND products IS NOT NULL AND products != '[]' ORDER BY record_id").all()) {
    for (const p of JSON.parse(r.products)) {
      // Names, not descriptions (some substances are registered as a chemical description); product name only if one word
      // ("LY3502970", not "Semaglutide 1 mg").
      const names = [...new Set([p.substance, ...(p.other || []), /^\S+$/.test(p.name || '') ? p.name : null])]
        .filter(n => n && n.length <= 40 && !/[,;:()[\]]/.test(n) && n.split(' ').length <= 3 && !/^anti[- ]/i.test(n));   // not "Anti-PD-I mAb"
      const key = p.sub || names.join('|');
      if (done.has(key)) continue;
      const ds = new Set(names.flatMap(n => [...(byName.get(norm(n)) || []), ...(byName.get(norm(stripSalt(n))) || [])]));
      if (ds.size !== 1) continue;
      const d = [...ds][0];
      if (![co(r.sponsor_raw), co(p.org)].some(c => c && owners.get(d)?.has(c))) continue;
      done.add(key);
      for (const [alias, kind] of [[p.sub, 'eu_substance'], ...names.map(n => [n, /^[a-z][a-z -]*$/i.test(n) ? 'name' : 'code'])])
        if (alias && addAutoAlias(db, { alias, drug_id: d, kind, evidence_url: r.url }) === 'added') added++;
    }
  }
  return added;
}

// Other registries' records keep the sponsor name as registered; their company is looked up again on every run,
// so a company added to the seeds (or a new subsidiary link) applies to records loaded earlier.
function refreshCompanies(db) {
  const co = companyResolver(db);
  const set = db.prepare('UPDATE trial_record SET company_id=? WHERE registry=? AND record_id=?');
  db.transaction(() => { for (const r of db.prepare("SELECT registry, record_id, sponsor_raw FROM trial_record WHERE registry != 'ctgov'").all()) set.run(co(r.sponsor_raw), r.registry, r.record_id); })();
}

export function run(db = getDb()) {
  applySeedOverrides(db, [...SEEDS, companies, studyDecisions]);
  const records = ctgovRecords(db);
  refreshCompanies(db);
  const brands = fdaBrandAliases(db) + emaBrandAliases(db);
  const ctis = ctisSubstanceAliases(db);
  const s = buildStudies({ db, sameStudy: [...SEEDS, companies, studyDecisions].flatMap(x => x.sameStudy || []) });
  meta.set('studies_built_at', new Date().toISOString());
  return { records, brand_aliases: brands, ctis_substance_aliases: ctis, ...s };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(run()));
