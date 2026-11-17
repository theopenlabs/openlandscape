// EU CTIS records (src/ingest/ctis.js) and how they match, on a throwaway database.
// The record below has the shape of a real /retrieve answer (2026-525472-26-00, trimmed), with made-up contact details
// that must not be stored.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-ctis-'), 'test.db');
const { getDb } = await import('../src/db.js');
const M = await import('../src/match.js');
const { ctisRecord, ctisPhase, ctisUrl } = await import('../src/ingest/ctis.js');
const { ctisSubstanceAliases } = await import('../src/ingest/studies.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();

const product = (role, name, substance, sub, synonyms = [], org = 'NOVO NORDISK A/S') => ({ mpRoleInTrial: role, productName: name,
  productDictionaryInfo: { prodName: name, activeSubstanceName: substance, euSubstNumber: sub, productSubstances: [{ actSubstName: substance, substanceEvCode: sub, nameOrg: org, synonyms }] } });
const full = (ct, o = {}) => ({
  ctNumber: ct, ctStatus: 'Authorised', startDateEU: o.start || '2026-10-27', publishDate: '2026-11-07T02:37:18',
  authorizedApplication: {
    eudraCt: o.eudract ? { isTransitioned: true, eudraCtCode: o.eudract } : { isTransitioned: false },
    memberStatesConcerned: [{ mscName: 'Germany' }, { mscName: 'Spain' }],
    authorizedPartI: {
      trialDetails: {
        clinicalTrialIdentifiers: { fullTitle: o.title || 'Efficacy and safety of zenagamtide s.c. once weekly compared to semaglutide in type 2 diabetes', shortTitle: o.code ?? 'NN9489-8035',
          secondaryIdentifyingNumbers: { whoUniversalTrialNumber: o.utn ? { number: o.utn } : undefined, nctNumber: o.nct ? { number: o.nct } : undefined, additionalRegistries: o.other || [] } },
        trialInformation: { trialDuration: { estimatedRecruitmentStartDate: '2026-11-10' } },
      },
      medicalConditions: [{ medicalCondition: 'Type 2 diabetes' }],
      sponsors: [{ primary: true, organisation: { name: o.sponsor || 'Novo Nordisk A/S' },
        publicContacts: [{ functionalName: 'Clinical Transparency', email: 'transparency@novonordisk.example', phone: '+45 0000 0000' }],
        scientificContacts: [{ name: 'Jane Doe', email: 'jane.doe@example.com' }] }],
      products: o.products || [
        product(2, 'semaglutide', 'SEMAGLUTIDE', 'SUB32188', ['NNC0113-0217']),
        product(1, 'NNC0487-0111 B 10142', 'ZENAGAMTIDE', 'SUB284107', ['Polypeptide consisting of a glucagon-like peptide-1 receptor agonist and an amylin receptor agonist, long description', 'NNC0487-0111', 'Amycretin']),
        product(3, 'Placebo (semaglutide)', 'N/A', 'N/A'),
      ],
    },
    authorizedPartsII: [{ trialSites: [{ personInfo: { firstName: 'Max', lastName: 'Mustermann', email: 'max@clinic.example', telephone: '+49 30 000' } }] }],
  },
});
const listing = { trialPhase: 'Therapeutic confirmatory  (Phase III)', lastUpdated: '06/11/2026' };

// ---- one record ----
const r = ctisRecord(full('2026-525472-26-00', { utn: 'U1111-1335-3379', nct: 'NCT07000001', other: [{ registryName: 'ISRCTN', number: 'ISRCTN12345678' }], eudract: '2020-005107-40' }), listing, M.companyResolver(db));
ok(r.registry === 'ctis' && r.url === ctisUrl('2026-525472-26-00') && r.url === 'https://euclinicaltrials.eu/search-for-clinical-trials/?lang=en&EUCT=2026-525472-26-00', 'each record links its own CTIS page');
ok(r.phase === 3 && r.phase_label === 'Phase 3' && r.last_updated === '2026-11-06' && r.start_date === '2026-10-27' && r.protocol_code === 'NN9489-8035', 'phase, dates and sponsor protocol code');
ok(r.utn === 'U1111-1335-3379' && JSON.stringify(JSON.parse(r.xrefs).sort()) === JSON.stringify(['2020-005107-40', 'NCT07000001']), 'WHO number, NCT number and the old EudraCT number are kept as cross-references');
const prods = JSON.parse(r.products);
ok(prods.length === 2 && prods.find(p => p.role === 'test').sub === 'SUB284107' && prods.find(p => p.role === 'test').other.join() === 'NNC0487-0111,Amycretin',
  'test and comparator products keep the EU substance code and short other names; placebo and descriptions are left out');
const text = JSON.stringify(r);
ok(!/@|Jane Doe|Mustermann|\+45|\+49|transparency/i.test(text), 'no contact people, emails or phones from the record are stored');
ok(ctisPhase('Phase I and Phase II (Integrated)- Other').phase_label === 'Phase 1/2' && ctisPhase('Phase II and Phase III (Integrated)').phase === 3
  && ctisPhase('Human Pharmacology (Phase I)- First administration to humans').phase === 1 && ctisPhase('Phase III and phase IV (Integrated)').phase_label === 'Phase 3/4', 'CTIS phase wording maps to phases');
ok(ctisRecord({ }, listing) === null && ctisRecord({ ctNumber: '2024-500000-00-00' }, listing) === null, 'a record the portal does not publish is skipped');

// ---- matching ----
db.exec(`INSERT INTO company (id, name, sponsor_patterns) VALUES ('novo', 'Novo Nordisk', '["novo nordisk"]'), ('lilly', 'Eli Lilly', '["lilly"]');
  INSERT INTO drug (id, name, companies) VALUES ('amycretin', 'amycretin', '["novo"]'), ('semaglutide', 'semaglutide', '["novo"]'), ('orforglipron', 'orforglipron', '["lilly"]');
  INSERT INTO drug_alias (alias_norm, alias, drug_id, source, auto) VALUES ('amycretin', 'amycretin', 'amycretin', 'canonical name', 0), ('nnc04870111', 'NNC0487-0111', 'amycretin', 'seed', 0),
    ('semaglutide', 'semaglutide', 'semaglutide', 'canonical name', 0), ('orforglipron', 'orforglipron', 'orforglipron', 'canonical name', 0)`);
const co = M.companyResolver(db);
const ct = (id, o = {}, x = {}) => M.recordRow({ registry: 'ctgov', record_id: id, title: 'A study of zenagamtide compared to semaglutide in type 2 diabetes', company_id: co('Novo Nordisk A/S'), sponsor_raw: 'Novo Nordisk A/S', phase: 3, start_date: '2026-11', last_updated: '2026-11-01',
  products: JSON.stringify([{ role: 'intervention', name: 'Zenagamtide', other: ['NNC0487-0111'] }, { role: 'intervention', name: 'Semaglutide', other: [] }]), ...o }, x);
const eu = (id, o = {}) => ctisRecord(full(id, o), listing, co);
M.saveRecords([
  eu('2026-525472-26-00', { utn: 'U1111-1335-3379' }), ct('NCT07000001', { protocol_code: 'NN9489-8035' }, { xrefs: ['U1111-1335-3379'] }),         // 1. UTN (and code)
  eu('2026-500001-11-00', { code: 'NN9489-9001' }), ct('NCT07000002', { protocol_code: 'NN9489-9001' }),                                          // 2. protocol code + company
  eu('2024-512978-99-00', { code: 'X', eudract: '2020-005107-40' }), ct('NCT07000003', {}, { xrefs: ['2020-005107-40'] }),                         // 3. both list one EudraCT number
  eu('2024-500004-44-00', { code: 'Y', eudract: '2020-000004-44' }), ct('NCT07000004', {}, { xrefs: ['2020-000004-44'] }), ct('NCT07000005', {}, { xrefs: ['2020-000004-44'] }), // 4. two NCTs list it
  eu('2025-500006-66-00', { code: 'Z1', start: '2025-03-01', title: 'Weekly orforglipron tablets in adults with obesity', sponsor: 'Eli Lilly & Co.', products: [product(1, 'LY3502970', 'ORFORGLIPRON', 'SUB999999', [], 'ELI LILLY AND COMPANY')] }),
  ct('NCT07000006', { title: 'Weekly orforglipron tablets in adults with obesity and diabetes', start_date: '2025-03', company_id: co('Eli Lilly and Company'), sponsor_raw: 'Eli Lilly and Company',
    products: JSON.stringify([{ role: 'intervention', name: 'Orforglipron', other: ['LY3502970'] }]) }),                                           // 5. similar, same drug: queued
  eu('2025-500007-77-00', { code: 'Z2', start: '2025-03-01', title: 'Weekly retatrutide injections in adults with obesity', sponsor: 'Eli Lilly & Co.', products: [product(1, 'LY3437943', 'RETATRUTIDE', 'SUB888888', [], 'ELI LILLY AND COMPANY')] }),
  ct('NCT07000007', { title: 'Weekly orforglipron injections in adults with obesity', start_date: '2025-03', company_id: co('Eli Lilly and Company'), sponsor_raw: 'Eli Lilly and Company',
    products: JSON.stringify([{ role: 'intervention', name: 'Orforglipron', other: [] }]) }),                                                      // 6. similar, different drug: not queued
  eu('2025-500009-99-00', { code: 'Z3', start: '2025-03-01', title: 'Weekly orforglipron tablets in adults with obesity', sponsor: 'Eli Lilly & Co.', products: [] }), // 8. Phase 1 details held back
  eu('2025-500010-10-00', { code: 'NN9487-0001', products: [product(1, 'NNC0487-0111 B 10150', 'POLYPEPTIDE CONSISTING OF A GLUCAGON-LIKE PEPTIDE-1 RECEPTOR AGONIST AND AN AMYLIN RECEPTOR AGONIST', 'SUB284108', ['Amycretin'])] }), // 9. substance registered as a description
  eu('2024-500011-11-00', { code: 'W1' }), ct('NCT07000011', {}, { xrefs: ['2024-500011-11'] }),                                                    // 10. EU number without its last part
  eu('2024-500012-12-00', { code: 'W2' }), ct('NCT07000012', {}, { xrefs: ['2024-500012-12-01'] }),                                                 // 11. EU number with another last part
  eu('2024-500013-13-00', { code: 'W3' }), eu('2024-500013-13-01', { code: 'W4' }), ct('NCT07000013', {}, { xrefs: ['2024-500013-13'] }),            // 12. two EU records fit
  eu('2025-500008-88-00', { code: 'IIT-2025-01', sponsor: 'Charite - Universitaetsmedizin Berlin', products: [product(1, 'Semaglutide 1 mg', 'SEMAGLUTIDE', 'SUB777777', ['SEMA-X1'], 'GENERICO SA')] }), // 7. other company's product
], db);
const added = ctisSubstanceAliases(db);
const res = M.buildStudies({ db, today: '2026-11-07' });
const study = id => db.prepare('SELECT study_id FROM trial_record WHERE record_id=?').pluck().get(id);
const link = id => db.prepare('SELECT * FROM study_link WHERE record_id=?').get(id);
const cand = (a, b) => db.prepare("SELECT * FROM match_candidate WHERE type='study' AND ((left_id=? AND right_id=?) OR (left_id=? AND right_id=?))").get(a, b, b, a);
ok(study('2026-525472-26-00') === 'NCT07000001' && link('2026-525472-26-00').rule === 'utn', 'CTIS record joins the NCT with the same WHO number');
ok(study('2026-500001-11-00') === 'NCT07000002' && link('2026-500001-11-00').rule === 'protocol', 'CTIS record joins the NCT with the same sponsor protocol code and company');
ok(study('2024-512978-99-00') === 'NCT07000003' && JSON.parse(link('2024-512978-99-00').evidence).value === '2020-005107-40', 'CTIS trial moved from the old register joins the NCT listing its EudraCT number');
ok(study('2024-500004-44-00') === '2024-500004-44-00' && cand('NCT07000004', '2024-500004-44-00'), 'a EudraCT number listed by two NCTs merges nothing: queued');
ok(study('2024-500011-11-00') === 'NCT07000011' && JSON.parse(link('2024-500011-11-00').evidence).matched === '2024-500011-11-00', 'an EU number written without its last part finds the EU record');
ok(study('2024-500012-12-00') === 'NCT07000012', 'an EU number written with another last part finds the EU record');
ok(study('2024-500013-13-00') !== 'NCT07000013' && study('2024-500013-13-01') !== 'NCT07000013', 'an EU number that fits two EU records merges nothing');
const c5 = cand('NCT07000006', '2025-500006-66-00');
ok(study('2025-500006-66-00') !== 'NCT07000006' && c5 && JSON.parse(c5.reasons).drug === 'orforglipron', 'similar trial with the same drug: queued with the drug named, not merged');
ok(!cand('NCT07000007', '2025-500007-77-00'), 'similar title but different drugs: not queued');
ok(!cand('NCT07000006', '2025-500009-99-00'), 'a record that names no drug is not queued by the similar rule');
console.log(`      ${JSON.stringify(res)}`);

// ---- drug aliases from CTIS products ----
const alias = a => db.prepare('SELECT drug_id, auto, kind, evidence_url FROM drug_alias WHERE alias_norm=?').get(a);
ok(alias('sub284107')?.drug_id === 'amycretin' && alias('sub284107').kind === 'eu_substance' && alias('sub284107').evidence_url.startsWith(ctisUrl('')),
  'EU substance code becomes an automatic alias of the hand-checked drug, with the CTIS page as evidence');
ok(alias('sub32188')?.drug_id === 'semaglutide' && alias('nnc01130217')?.drug_id === 'semaglutide', 'comparator substance codes go to their own drug');
ok(alias('sub999999')?.drug_id === 'orforglipron' && alias('ly3502970')?.drug_id === 'orforglipron', "the owner's own trial pairs its code LY3502970 and substance code with orforglipron");
ok(!db.prepare("SELECT 1 FROM drug_alias WHERE auto=1 AND length(alias) > 40").get(), 'chemical descriptions never become aliases');
ok(!alias('sub777777') && !alias('semax1'), "no alias from a product of a company that does not own the drug (hospital trial, another firm's substance entry)");
ok(added >= 3 && db.prepare('SELECT count(*) FROM drug_alias WHERE auto=1 AND evidence_url IS NULL').pluck().get() === 0, `every CTIS alias has a source link (${added} added)`);
