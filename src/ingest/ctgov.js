// Loads trials from ClinicalTrials.gov's official API (v2). No account or key needed.
//   node src/ingest/ctgov.js fetch   -> downloads pages to data/raw/ctgov/ (resumable)
//   node src/ingest/ctgov.js load    -> loads the pages into the database
//   node src/ingest/ctgov.js arms    -> downloads only the trial arms into the database (about a minute), for a database loaded without them
// Scope: industry-sponsored interventional drug/biologic trials, Phase 1-4, updated since 2021. Combination products count too:
// some drug trials register their drug only that way (survodutide, enicepatide, GFH375); link.js keeps devices out.
// AACT (the nightly Postgres copy of the same registry) is the alternative source: see aact.js.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, meta } from '../db.js';

const RAW = new URL('../../data/raw/ctgov/', import.meta.url).pathname;
const SINCE = process.env.CTGOV_SINCE || '2021-01-01';
const QUERY = `AREA[LeadSponsorClass]INDUSTRY AND AREA[StudyType]INTERVENTIONAL AND (AREA[InterventionType]DRUG OR AREA[InterventionType]BIOLOGICAL OR AREA[InterventionType]COMBINATION_PRODUCT) AND (AREA[Phase]PHASE1 OR AREA[Phase]PHASE2 OR AREA[Phase]PHASE3 OR AREA[Phase]PHASE4) AND AREA[LastUpdatePostDate]RANGE[${SINCE},MAX]`;
export const FIELDS = 'NCTId,BriefTitle,OverallStatus,Phase,StartDate,PrimaryCompletionDate,CompletionDate,Condition,Keyword,InterventionType,InterventionName,InterventionOtherName,InterventionDescription,BriefSummary,LeadSponsorName,LeadSponsorClass,CollaboratorName,LocationCountry,LocationFacility,LocationCity,EnrollmentCount,LastUpdatePostDate,OrgStudyId,SecondaryId,SecondaryIdType,SecondaryIdDomain,ArmGroupLabel,ArmGroupType,ArmGroupInterventionName,ConditionMeshTerm,ConditionAncestorTerm';

async function fetchAll() {
  mkdirSync(RAW, { recursive: true });
  let token = null, page = 0;
  // resume: find the last saved page and its token
  const done = readdirSync(RAW).filter(f => f.startsWith('page-')).sort();
  if (done.length) {
    const last = JSON.parse(readFileSync(join(RAW, done.at(-1)), 'utf8'));
    page = done.length; token = last.nextPageToken;
    if (!token) { console.log(`Already complete: ${done.length} pages`); return; }
  }
  do {
    const u = new URL('https://clinicaltrials.gov/api/v2/studies');
    u.searchParams.set('query.term', QUERY);
    u.searchParams.set('fields', FIELDS);
    u.searchParams.set('pageSize', '1000');
    if (page === 0) u.searchParams.set('countTotal', 'true');
    if (token) u.searchParams.set('pageToken', token);
    let res, tries = 0;
    while (true) {
      res = await fetch(u, { headers: { 'User-Agent': 'OpenLandscape-loader/0.1' } });
      if (res.ok) break;
      if (++tries > 5) throw new Error(`HTTP ${res.status} on page ${page}`);
      await new Promise(r => setTimeout(r, 2000 * tries));
    }
    const body = await res.json();
    writeFileSync(join(RAW, `page-${String(page).padStart(4, '0')}.json`), JSON.stringify(body));
    if (body.totalCount) console.log(`Total studies: ${body.totalCount}`);
    console.log(`page ${page}: ${body.studies.length} studies`);
    token = body.nextPageToken; page++;
  } while (token);
  meta.set('ctgov_fetched_at', new Date().toISOString());
}

const PHASE = { EARLY_PHASE1: 1, PHASE1: 1, PHASE2: 2, PHASE3: 3, PHASE4: 4 };
const LABEL = { EARLY_PHASE1: 'Early Phase 1', PHASE1: 'Phase 1', PHASE2: 'Phase 2', PHASE3: 'Phase 3', PHASE4: 'Phase 4' };

export function toRow(s) {
  const p = s.protocolSection, id = p.identificationModule, st = p.statusModule || {}, sp = p.sponsorCollaboratorsModule || {};
  const phases = p.designModule?.phases || [];
  const locs = p.contactsLocationsModule?.locations || [];
  return {
    trial: {
      nct: id.nctId, title: id.briefTitle, status: st.overallStatus,
      phase: Math.max(0, ...phases.map(x => PHASE[x] || 0)),
      phase_label: phases.map(x => LABEL[x] || x).join('/').replace('Phase 1/Phase 2', 'Phase 1/2').replace('Phase 2/Phase 3', 'Phase 2/3'),
      start_date: st.startDateStruct?.date, primary_completion: st.primaryCompletionDateStruct?.date,
      completion: st.completionDateStruct?.date, enrollment: p.designModule?.enrollmentInfo?.count ?? null,
      sponsor: sp.leadSponsor?.name, sponsor_class: sp.leadSponsor?.class,
      collaborators: JSON.stringify((sp.collaborators || []).map(c => c.name)),
      conditions: JSON.stringify(p.conditionsModule?.conditions || []),
      keywords: JSON.stringify(p.conditionsModule?.keywords || []),
      countries: JSON.stringify([...new Set(locs.map(l => l.country).filter(Boolean))]),
      n_sites: locs.length, last_update: st.lastUpdatePostDateStruct?.date,
      summary: p.descriptionModule?.briefSummary || null,   // the sponsor's own summary, quoted on drug pages
      org_study_id: id.orgStudyIdInfo?.id || null,           // the sponsor's protocol code, used to match other registries
      secondary_ids: JSON.stringify((id.secondaryIdInfos || []).map(x => ({ id: x.id, type: x.type || null, domain: x.domain || null }))),
    },
    interventions: (p.armsInterventionsModule?.interventions || []).map(i => ({ type: i.type, name: i.name, other_names: JSON.stringify(i.otherNames || []), description: i.description || null })),
    sites: locs.map(l => ({ facility: l.facility, city: l.city, country: l.country })),
    arms: p.armsInterventionsModule?.armGroups || [],
    mesh: s.derivedSection?.conditionBrowseModule,
  };
}

// Raw pages downloaded before arms were requested have none: those trials keep the arms they already have.
function armSaver(db) {
  const del = db.prepare('DELETE FROM trial_arm WHERE nct=?'), ins = db.prepare('INSERT INTO trial_arm (nct,label,type,interventions) VALUES (?,?,?,?)');
  return (nct, arms) => {
    if (!arms?.length) return;
    del.run(nct);
    for (const a of arms) ins.run(nct, a.label ?? null, a.type ?? null, JSON.stringify(a.interventionNames || []));
  };
}

// Raw pages downloaded before MeSH terms were requested have none: those trials keep the terms they already have.
function meshSaver(db) {
  const del = db.prepare('DELETE FROM trial_mesh WHERE nct=?'), ins = db.prepare('INSERT OR IGNORE INTO trial_mesh (nct,term,ancestor) VALUES (?,?,?)');
  return (nct, mesh) => {
    if (!mesh) return;
    del.run(nct);
    for (const m of mesh.meshes || []) ins.run(nct, m.term, 0);
    for (const m of mesh.ancestors || []) ins.run(nct, m.term, 1);
  };
}

// Only the MeSH terms, for every trial in the database (about 110 small requests), or for the trials given.
async function fetchMesh(only = null) {
  const db = getDb(), saveMesh = meshSaver(db);
  const ncts = only || db.prepare('SELECT nct FROM trial').pluck().all();
  let n = 0;
  for (let i = 0; i < ncts.length; i += 400) {
    const u = new URL('https://clinicaltrials.gov/api/v2/studies');
    u.searchParams.set('filter.ids', ncts.slice(i, i + 400).join(','));
    u.searchParams.set('fields', 'NCTId,ConditionMeshTerm,ConditionAncestorTerm');
    u.searchParams.set('pageSize', '1000');
    let res, tries = 0;
    while (true) {
      res = await fetch(u, { headers: { 'User-Agent': 'OpenLandscape-loader/0.1' } });
      if (res.ok) break;
      if (++tries > 5) throw new Error(`HTTP ${res.status}`);
      await new Promise(r => setTimeout(r, 2000 * tries));
    }
    const body = await res.json();
    db.transaction(() => { for (const s of body.studies) saveMesh(s.protocolSection.identificationModule.nctId, s.derivedSection?.conditionBrowseModule); })();
    n += body.studies.length;
  }
  meta.set('mesh_fetched_at', new Date().toISOString());
  console.log(`MeSH terms read for ${n} of ${ncts.length} trials`);
}

// Only the arms, for a database loaded without them: same trials as fetch, 44 small pages.
async function fetchArms() {
  const db = getDb(), saveArms = armSaver(db);
  let token = null, n = 0;
  do {
    const u = new URL('https://clinicaltrials.gov/api/v2/studies');
    u.searchParams.set('query.term', QUERY);
    u.searchParams.set('fields', 'NCTId,ArmGroupLabel,ArmGroupType,ArmGroupInterventionName');
    u.searchParams.set('pageSize', '1000');
    if (token) u.searchParams.set('pageToken', token);
    let res, tries = 0;
    while (true) {
      res = await fetch(u, { headers: { 'User-Agent': 'OpenLandscape-loader/0.1' } });
      if (res.ok) break;
      if (++tries > 5) throw new Error(`HTTP ${res.status}`);
      await new Promise(r => setTimeout(r, 2000 * tries));
    }
    const body = await res.json();
    db.transaction(() => { for (const s of body.studies) saveArms(s.protocolSection.identificationModule.nctId, s.protocolSection.armsInterventionsModule?.armGroups); })();
    n += body.studies.length; token = body.nextPageToken;
  } while (token);
  console.log(`Arms saved for ${n} trials`);
}

export function loadRows(rows) {
  const db = getDb();
  const insT = db.prepare(`INSERT OR REPLACE INTO trial (nct,title,status,phase,phase_label,start_date,primary_completion,completion,enrollment,sponsor,sponsor_class,collaborators,conditions,keywords,countries,n_sites,last_update,summary,org_study_id,secondary_ids)
    VALUES (@nct,@title,@status,@phase,@phase_label,@start_date,@primary_completion,@completion,@enrollment,@sponsor,@sponsor_class,@collaborators,@conditions,@keywords,@countries,@n_sites,@last_update,@summary,@org_study_id,@secondary_ids)`);
  const delI = db.prepare('DELETE FROM intervention WHERE nct=?'), delS = db.prepare('DELETE FROM site WHERE nct=?');
  const insI = db.prepare('INSERT INTO intervention (nct,type,name,other_names,description) VALUES (?,?,?,?,?)'), insS = db.prepare('INSERT INTO site VALUES (?,?,?,?)');
  const saveArms = armSaver(db), saveMesh = meshSaver(db);
  db.transaction(() => {
    for (const r of rows) {
      insT.run({ summary: null, org_study_id: null, secondary_ids: '[]', ...r.trial }); delI.run(r.trial.nct); delS.run(r.trial.nct);
      for (const i of r.interventions) insI.run(r.trial.nct, i.type, i.name, i.other_names, i.description ?? null);
      for (const s of r.sites) insS.run(r.trial.nct, s.facility, s.city, s.country);
      saveArms(r.trial.nct, r.arms);
      saveMesh(r.trial.nct, r.mesh);
    }
  })();
}

function loadAll() {
  if (!existsSync(RAW)) throw new Error('Run "fetch" first');
  let n = 0;
  for (const f of readdirSync(RAW).filter(f => f.startsWith('page-')).sort()) {
    const body = JSON.parse(readFileSync(join(RAW, f), 'utf8'));
    loadRows(body.studies.map(toRow)); n += body.studies.length;
  }
  meta.set('trials_loaded_at', new Date().toISOString());
  meta.set('trials_source', 'ClinicalTrials.gov API v2');
  console.log(`Loaded ${n} trials`);
}

const cmd = process.argv[2];
// A database restored without its tags (the disease map and disease search need them): when most trials have none,
// fetch them. About a sixth of trials have none by nature (healthy volunteers, no disease listed), so a full load is left alone.
async function fetchMissingMesh() {
  const db = getDb();
  const missing = db.prepare('SELECT nct FROM trial WHERE nct NOT IN (SELECT nct FROM trial_mesh)').pluck().all();
  if (missing.length > db.prepare('SELECT count(*) FROM trial').pluck().get() / 2) { console.log(`${missing.length} trials have no MeSH terms; fetching`); await fetchMesh(missing); }
}
if (cmd === 'fetch') await fetchAll();
else if (cmd === 'load') { loadAll(); await fetchMissingMesh(); }
else if (cmd === 'arms') await fetchArms();
else if (cmd === 'mesh') await fetchMesh();
