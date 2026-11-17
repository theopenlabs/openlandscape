// Searches match whole words (src/query.js areaMatch, diseaseTrials): short words, spellings and other names for a disease.
// Before, "als" was found inside "Pharmaceuticals" and returned 861 rows. Run: npm run check
import { landscape, trials, search } from '../src/query.js';
import { getDb } from '../src/db.js';
import { HAS_CHECKED_DATA, skip } from './private.js';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const L = area => landscape({ area, phase_min: 1, limit: 100000 }).programs;
const drugs = area => L(area).map(p => p.drug);
const ncts = area => new Set(trials({ area, status: 'all', limit: 500 }).trials.map(t => t.nct));
const same = (a, b) => { const x = drugs(a).sort().join('|'), y = drugs(b).sort().join('|'); ok(x && x === y, `"${a}" and "${b}" find the same ${drugs(a).length} drugs`); };

// ---------- short words ----------
const als = drugs('als');
ok(als.includes('Tofersen') && als.length > 30 && als.length < 100, `"als" finds ALS drugs: ${als.length} rows, Tofersen in`);
ok(!als.some(d => /inclisiran|eculizumab/i.test(d)), '"als" is no longer a company search ("Pharmaceuticals")');
same('als', 'amyotrophic lateral sclerosis');
ok(L('ra').length < 150 && drugs('ra').includes('Upadacitinib'), `"ra" is rheumatoid arthritis: ${L('ra').length} rows`);
ok(L('ms').length < 150 && drugs('ms').includes('Ocrelizumab'), `"ms" is multiple sclerosis: ${L('ms').length} rows`);
ok(L('ad').length < 100, `"ad" (two diseases share it) only where a trial lists AD: ${L('ad').length} rows`);
ok(!drugs('ad').includes('pembrolizumab'), '"ad" is not found inside "advanced"');
ok(!drugs('pd').some(d => /pembrolizumab|ivonescimab/i.test(d)), '"pd" is not PD-1');
const afib = drugs('afib');
ok(!afib.some(d => /elafibranor|pemafibrate/i.test(d)) && afib.length > 5, `"afib" is atrial fibrillation, not elafibranor: ${afib.length} rows`);
ok(!drugs('cf').some(d => /^CF[IT]/i.test(d)) && drugs('cf').includes('ivacaftor'), '"cf" is cystic fibrosis, not drug codes starting CF');
ok(!drugs('flu').some(d => /teriflunomide|alflutinib/i.test(d)), '"flu" is not found inside drug names');
ok(L('pain').length < 105, '"pain" is not found inside "Spain"');

// ---------- spellings and punctuation ----------
for (const [a, b] of [['leukaemia', 'leukemia'], ['haemophilia', 'hemophilia'], ['alzheimers', 'alzheimer'], ["alzheimer's", 'alzheimer'], ['parkinsons', 'parkinson'], ['crohns', 'crohn'], ["crohn's", 'crohn'], ['type ii diabetes', 'type 2 diabetes']]) same(a, b);

// ---------- other names ----------
ok(ncts('depression').has('NCT06941844'), 'depression finds Major Depressive Disorder (NCT06941844)');
ok(ncts('epilepsy').has('NCT06872125'), 'epilepsy finds Dravet syndrome (NCT06872125)');
same('nash', 'mash');
ok(drugs('dravet syndrome').length < drugs('epilepsy').length && drugs('alzheimer').length < drugs('dementia').length, 'a narrow disease does not pull in the broad one');
ok(drugs('hcc').length >= drugs('hepatocellular carcinoma').length && drugs('hcc').length > 120, `"hcc" finds hepatocellular carcinoma: ${drugs('hcc').length} rows`);
ok(!ncts('liver cancer').has('NCT07321847'), 'liver cancer does not pull colon cancer that spread to the liver (NCT07321847)');
same('t2dm', 'type 2 diabetes');
ok(ncts('copd').has('NCT06547333'), 'copd finds the full name (NCT06547333)');
ok(ncts('pancreatic cancer').has('NCT05726864'), 'pancreatic cancer finds pancreatic ductal adenocarcinoma (NCT05726864)');
ok(drugs('aml').length > 100 && drugs('aml').includes('Venetoclax'), `"aml" finds acute myeloid leukemia: ${drugs('aml').length} rows`);
ok(drugs('hiv').includes('Lenacapavir') && drugs('hiv').length > 60, '"hiv" stays a disease search though a junk drug row is called HIV');

// ---------- different diseases that share letters ----------
ok(!ncts('influenza').has('NCT06465420'), 'influenza does not pull Haemophilus influenzae (NCT06465420)');
ok(!ncts('hypertension').has('NCT02562235'), 'hypertension does not pull pulmonary hypertension (NCT02562235)');
ok(!ncts('cystic fibrosis').has('NCT06637254') && !ncts('cystic fibrosis').has('NCT07616375'), 'cystic fibrosis does not pull non-CF bronchiectasis');
ok(!drugs('multiple myeloma').some(d => /atogepant/i.test(d)), 'multiple myeloma does not pull menstrual migraine, also written MM');

// ---------- drug, company and mechanism searches keep working ----------
ok(drugs('semaglutide').some(d => /^semaglutide$/i.test(d)) && drugs('semaglutide').length <= 5, `a drug's name is a drug search, without the drugs compared with it (${drugs('semaglutide').length} rows)`);
ok(drugs('IBI362').includes('mazdutide') && drugs('LY3305677').includes('mazdutide'), 'drug codes find mazdutide');
if (!HAS_CHECKED_DATA) skip('company searches with company aliases'); else ok(L('Hengrui').length > 100 && L('Eli Lilly').length > 50 && L('GSK').length > 50, 'company searches still find their drugs');
ok(!drugs('novo').some(d => /denovoskin/i.test(d)), '"novo" is not found inside "denovoSkin"');
ok(drugs('oral GLP-1').includes('orforglipron'), 'oral GLP-1 still finds orforglipron');
ok(drugs('gip').includes('maridebart cafraglutide') && drugs('glp-1').includes('tirzepatide'), 'mechanism searches still work; "gip" finds "GIPR antagonist"');
ok(drugs('car-t').some(d => /cilta-cel/i.test(d)) && !drugs('car-t').includes('CARTISTEM'), '"car-t" finds CAR-T drugs, not CARTISTEM');
const s = search({ query: 'als' });
ok(!s.companies.some(c => /pharmaceuticals/i.test(c.name)), 'search("als") lists no company just because of "Pharmaceuticals"');

// ---------- filters in the trials tool ----------
const count = args => trials({ ...args, status: 'all', limit: 1 }).count;
ok(count({ sponsor: 'als' }) < 10, `sponsor filter "als" is not "Pharmaceuticals" (${count({ sponsor: 'als' })} trials)`);
ok(count({ sponsor: 'Lilly' }) > 100 && count({ drug: 'semaglutide' }) > 50 && count({ drug: 'IBI362' }) > 0, 'sponsor and drug filters still find real names and codes');
ok(count({ drug: 'afib' }) === 0, 'drug filter "afib" is not elafibranor');

// ---------- the registry's standard disease terms (MeSH): needs data from `node src/ingest/ctgov.js mesh` ----------
if (!getDb().prepare('SELECT 1 FROM trial_mesh LIMIT 1').get()) console.log('SKIP  MeSH tests: this database has no MeSH terms');
else {
  ok(drugs('ibd').length > 60 && ncts('ibd').has('NCT07677514'), `"ibd" finds Crohn's disease and ulcerative colitis: ${drugs('ibd').length} rows`);
  ok(ncts('liver cancer').has('NCT06371157'), 'liver cancer finds hepatocellular carcinoma (NCT06371157)');
  ok(drugs('motor neuron disease').length > 30 && ncts('motor neuron disease').has('NCT07174492'), 'motor neuron disease finds ALS (NCT07174492)');
  ok(ncts('dementia').has('NCT07214727'), "dementia finds Alzheimer's (NCT07214727)");
  // Machine tags and broad parent terms that are wrong
  ok(!ncts("alzheimer's disease").has('NCT06563895'), "Alzheimer's does not pull amyloidosis tagged Alzheimer's (NCT06563895)");
  ok(!ncts('epilepsy').has('NCT04106219'), 'epilepsy does not pull a neuroblastoma trial tagged epilepsy (NCT04106219)');
  ok(!ncts('atrial fibrillation').has('NCT06369298'), 'atrial fibrillation does not pull a heart failure trial tagged with it (NCT06369298)');
  ok(!ncts('rheumatoid arthritis').has('NCT07823790'), "rheumatoid arthritis does not pull Sjogren's (NCT07823790), filed under it by MeSH");
  ok(!ncts('pain').has('NCT07048808'), 'pain does not pull angina (NCT07048808), filed under it by MeSH');
}

// ---------- hand-checked searches keep the drug lists that were reviewed ----------
ok(drugs('nsclc').length === drugs('non-small cell lung cancer').length && drugs('obesity').includes('tirzepatide'), 'hand-checked searches unchanged in kind (counts: test/goldset.js)');
