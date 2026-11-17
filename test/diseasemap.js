// The disease map (src/diseasemap.js): the tree from the registry's standard terms, sub-diseases included in a search,
// branches left out by hand (seed/disease-map.csv), the "Included" line and coverage. Run: npm run check (needs trial_mesh rows).
import { landscape, trials } from '../src/query.js';
import { diseaseMap, subtree, breakdown, placement, prettyTerm, termSlug } from '../src/diseasemap.js';
import { diseasePage, landscapePage } from '../src/pages/landscapes.js';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const M = diseaseMap();
if (!M.nodes.size) { console.log('SKIP  disease map: no MeSH terms in this database (trial_mesh is empty)'); process.exit(0); }

// ---------- tree ----------
ok(M.nodes.get('Carcinoma, Hepatocellular')?.direct.has('Liver Neoplasms'), 'hepatocellular carcinoma sits under liver cancer');
ok(M.nodes.get('Alzheimer Disease')?.parents.has('Dementia'), "Alzheimer's sits under dementia");
ok(subtree('Inflammatory Bowel Diseases').has('Crohn Disease') && subtree('Inflammatory Bowel Diseases').has('Colitis, Ulcerative'), "IBD includes Crohn's and ulcerative colitis");
ok(!subtree('Psoriasis').has('Arthritis, Psoriatic'), 'psoriatic arthritis is left out of psoriasis (seed/disease-map.csv)');
ok(!subtree('Hypertension').has('Hypertension, Pulmonary'), 'pulmonary hypertension is left out of hypertension');
ok(!subtree('Arthritis, Rheumatoid').has("Sjogren's Syndrome"), "Sjogren's is left out of rheumatoid arthritis");
ok(!subtree('Dementia').has('Huntington Disease'), "Huntington's is left out of dementia");
ok(subtree('Arthritis, Psoriatic').has('Arthritis, Psoriatic') && M.nodes.get('Arthritis, Psoriatic').trials.size > 0, 'psoriatic arthritis keeps its own search');
ok(prettyTerm('Leukemia, Myeloid, Acute') === 'Acute Myeloid Leukemia' && termSlug('Carcinoma, Non-Small-Cell Lung') === 'non-small-cell-lung-carcinoma', 'registry names read the right way round');
ok(prettyTerm('Diabetes Mellitus, Insulin-Dependent, 10') === 'Insulin-Dependent Diabetes Mellitus 10' && termSlug('Diabetes Mellitus, Insulin-Dependent, 10') === 'insulin-dependent-diabetes-mellitus-10', 'a trailing number stays last');
{ const t = [...M.nodes.values()].find(n => /, \d+$/.test(n.name));
  ok(!t || breakdown(termSlug(t.name))?.name === prettyTerm(t.name) && !/^\d/.test(prettyTerm(t.name)), `a numbered term has its page, number last: ${t && prettyTerm(t.name)}`);
  const old = t && t.name.split(', ').reverse().join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  ok(!t || breakdown(old)?.slug === termSlug(t.name), `the old number-first address finds the same term (server sends a 301): ${old}`); }
const pl = placement();
ok(pl.solo + pl.lift > 0.75 * pl.total, `most listed wordings are placed from the registry's tags: ${pl.solo + pl.lift} of ${pl.total}`);

// ---------- search ----------
const ncts = area => new Set(trials({ area, status: 'all', limit: 100000 }).trials.map(t => t.nct));
const hcc = ncts('hepatocellular carcinoma'), liver = ncts('liver cancer');
ok([...hcc].filter(n => liver.has(n)).length >= 0.9 * hcc.size, `"liver cancer" includes hepatocellular carcinoma trials: ${[...hcc].filter(n => liver.has(n)).length} of ${hcc.size}`);
ok(liver.size > hcc.size * 0.9, 'a narrow search does not pull in its neighbours: HCC is not bigger than liver cancer');
const psa = ncts('psoriatic arthritis'), pso = ncts('psoriasis');
ok([...psa].filter(n => pso.has(n)).length < 0.3 * psa.size, `"psoriasis" leaves out most psoriatic arthritis trials: ${[...psa].filter(n => pso.has(n)).length} of ${psa.size} in`);
const dem = ncts('dementia'), alz = ncts('alzheimer');
ok([...alz].filter(n => dem.has(n)).length >= 0.9 * alz.size, `"dementia" includes Alzheimer's trials: ${[...alz].filter(n => dem.has(n)).length} of ${alz.size}`);

// ---------- Included line and coverage ----------
const L = landscape({ area: 'liver cancer', phase_min: 1 });
const I = L.included;
ok(I && I.term === 'Liver Neoplasms' && I.children.some(c => c.term === 'Carcinoma, Hepatocellular'), 'liver cancer landscape says it included hepatocellular carcinoma');
ok(I && I.coverage.tagged > 0 && I.coverage.pct >= 70 && I.coverage.pct <= 100, `liver cancer covers ${I?.coverage.found} of ${I?.coverage.tagged} registry-tagged trials (${I?.coverage.pct}%)`);
const P = landscape({ area: 'psoriasis', phase_min: 1 }).included;
ok(P && P.left_out.some(x => x.term === 'Arthritis, Psoriatic'), 'psoriasis landscape says psoriatic arthritis was left out');
ok(landscape({ area: 'semaglutide', phase_min: 1 }).included === null, 'a drug search has no Included line');
const A = landscape({ area: 'alzheimer', phase_min: 1 }).included;
ok(A && A.term === 'Alzheimer Disease', '"alzheimer" finds its term through the trials its words found');

// ---------- pages ----------
const b = breakdown('liver-neoplasms');
ok(b && b.children.some(c => c.term === 'Carcinoma, Hepatocellular') && b.active > 0 && b.drugs > 0, `breakdown page data: ${b?.children.length} sub-diseases, ${b?.active} active trials, ${b?.drugs} drugs`);
ok(breakdown('no-such-disease') === null, 'unknown disease is a 404');
const html = diseasePage(breakdown('dementia'), {});
ok(html.includes('Huntington') && html.includes('Alzheimer') && html.includes('/diseases/'), 'dementia breakdown page renders with included and left-out diseases');
const lp = landscapePage(L, { slug: 'x', title: 'Liver cancer', crumb: 'Oncology', phase_min: 1 });
ok(lp.includes('<dt>Included</dt>') && lp.includes('Hepatocellular'), 'public landscape page shows the Included row');
