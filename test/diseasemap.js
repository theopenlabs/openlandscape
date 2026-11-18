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

// ---------- step 18: a disease page's drugs ----------
const { diseaseDrugs, diseaseSummary, plainName, DISEASE_TOP, DISEASE_CAP } = await import('../src/diseasemap.js');
const { startDiseaseTop, diseaseTop } = await import('../src/diseasetop.js');
const { getDb } = await import('../src/db.js');
const { useDrugs, drugsUsed } = await import('../src/limits.js');
const { dataDates } = await import('../src/query.js');
const rowsOf = h => (h.match(/<tr [^>]*data-f=/g) || []).length;
const counts = [...M.nodes.values()].map(n => termSlug(n.name));
// Pages by size, from the live data: the first with more than 10 drugs and up to 500, one with over 500, one with 1 to 10, one with none.
const pick = (test, from = ['psoriasis', 'breast-neoplasms', 'neoplasms', 'charcot-marie-tooth-disease', 'thyroid-nodule']) => from.find(s => { const L = diseaseDrugs(s); return L && test(L.stats.programs); });
const mid = pick(n => n > DISEASE_TOP && n <= DISEASE_CAP), huge = pick(n => n > DISEASE_CAP), tiny = pick(n => n > 0 && n <= DISEASE_TOP), none = pick(n => n === 0);
ok(mid && huge && tiny && none, `pages of each size: ${mid}, ${huge}, ${tiny}, ${none}`);
{
  const L = diseaseDrugs(mid), lv = L.programs.map(p => p.phase.level);
  const firstApproved = lv.findIndex(l => l >= 5);
  ok(firstApproved === -1 || lv.slice(firstApproved).every(l => l >= 5), `${mid}: drugs still in development come before approved and marketed ones`);
  const dev = L.programs.filter(p => p.phase.level < 5);
  ok(dev.every((p, i) => !i || dev[i - 1].phase.level >= p.phase.level), `${mid}: in development, the furthest stage first`);
  const p3 = dev.filter(p => p.phase.level === dev[0].phase.level && p.next_catalyst).map(p => String(p.next_catalyst.date).padEnd(10, '-31'));   // "2027-12" is the end of December
  ok(p3.length > 1 && p3.every((d, i) => !i || p3[i - 1].localeCompare(d) <= 0), `${mid}: within a stage, the soonest next date first`);
  ok(!L.late || (L.programs.find(p => p.id === L.late.id)?.phase.level >= 3 && L.programs.find(p => p.id === L.late.id)?.phase.level < 5), `${mid}: the next Phase 3 result is a Phase 3 or filed drug: ${L.late?.drug}`);
  const b = breakdown(mid), html = diseasePage(b, { updated: dataDates().trials, list: diseaseSummary(L) });
  ok(rowsOf(html) === DISEASE_TOP, `${mid} signed out: the top ${DISEASE_TOP} rows (${rowsOf(html)})`);
  ok(html.includes(`See all ${L.stats.programs} drugs`) && html.includes(`href="/signin?next=${encodeURIComponent(`/diseases/${mid}`)}"`), `${mid} signed out: "See all ${L.stats.programs} drugs", and sign-in comes back to the page`);
  ok(!html.includes('Search ' + b.name + '<') && !html.includes('Open in Search'), `${mid} signed out: no Search button`);
  ok(html.includes(`<span class="count">${L.stats.programs}</span>`) && html.includes(`<div class="v">${L.stats.programs}</div>`) && html.includes('class="stats four"'), `${mid}: the Drugs number is the list's own count, in four number boxes`);
  const shown = plainName(b.name) || b.name, top3 = L.programs.slice(0, 3).map(p => p.drug);
  ok(html.includes(`<title>${shown} drugs: pipeline and trials | OpenLandscape</title>`), `${mid}: the title is "${shown} drugs: pipeline and trials"`);
  ok(top3.every(n => html.includes(`content="${L.stats.programs} drugs in ${b.active} active ${shown} trials, in development first: `) && html.match(/<meta name="description" content="([^"]*)"/)[1].includes(n.replace(/&/g, '&amp;'))), `${mid}: the description has the count and the first 3 drugs: ${top3.join(', ')}`);
  ok(L.programs.slice(0, DISEASE_TOP).every(p => html.includes(`href="/drugs/${encodeURIComponent(p.id)}"`)), `${mid}: each drug name links to its drug page`);
  ok(/<dt>Summary<\/dt><dd>\d+ drugs are in active/.test(html) && html.includes(`drugs in active ${shown} trials · Updated`), `${mid}: the grey line and the Summary sentence`);
  ok(html.includes('data-order="dev"'), `${mid}: the list's last line says drugs in development come first`);
  // Signed in: the whole list, "Open in Search", the drugs counted toward the account (in a savepoint, nothing kept).
  const user = { id: -1, email: 'x', plan: 'free' };
  const signed = diseasePage(b, { user, updated: dataDates().trials, list: L });
  ok(rowsOf(signed) === L.stats.programs && !signed.includes('class="offer"') && signed.includes('Open in Search') && signed.includes('Filters, follow and download'), `${mid} signed in: all ${L.stats.programs} rows and "Open in Search"`);
  const db = getDb();
  db.exec('SAVEPOINT t18');
  try {
    db.prepare("INSERT INTO user (id, email, plan) VALUES (-1, 'step18@x.test', 'free')").run();
    ok(useDrugs({ id: -1, plan: 'free' }, L.programs.map(p => p.id)).ok && drugsUsed(-1).month === L.stats.programs, `${mid} signed in: the ${L.stats.programs} drugs count toward the account's different drugs`);
  } finally { db.exec('ROLLBACK TO t18; RELEASE t18'); }
  const over = diseasePage(b, { user, updated: dataDates().trials, list: { ...L, programs: L.programs.slice(0, 20) }, meter: '<div class="meterbox">METER</div>' });
  ok(rowsOf(over) === Math.min(20, L.stats.programs) && over.includes('METER') && !over.includes('capnote'), `${mid} past the allowance: the top 20 and the meter`);
}
{
  const L = diseaseDrugs(huge), html = diseasePage(breakdown(huge), { list: diseaseSummary(L) });
  ok(L.programs.length === DISEASE_CAP && html.includes(`See the top 500 of ${L.stats.programs.toLocaleString('en-US')} drugs`) && html.includes('Sign in free to see them.'), `${huge}: over 500 says "See the top 500 of ${L.stats.programs}"`);
  const signed = diseasePage(breakdown(huge), { user: { id: 1 }, list: L });
  ok(rowsOf(signed) === DISEASE_CAP && signed.includes('Open a sub-disease below for the rest'), `${huge} signed in: the list stops at 500 and says where the rest are`);
}
{
  const L = diseaseDrugs(tiny), html = diseasePage(breakdown(tiny), { list: diseaseSummary(L) });
  ok(rowsOf(html) === L.stats.programs && !html.includes('class="offer"'), `${tiny}: all ${L.stats.programs} drugs shown, no sign-in box`);
}
{
  const html = diseasePage(breakdown(none), { list: diseaseSummary(diseaseDrugs(none)) });
  ok(!html.includes('id="d"') && html.includes('<div class="stats">') && html.includes('No drugs are in active'), `${none}: no Drugs box, today's three number boxes`);
}
{
  const plain = counts.filter(s => plainName(breakdown(s)?.name || '')).length;
  ok(plainName('Breast Neoplasms') === 'Breast Cancer' && plainName('Psoriasis') === null && plain >= 20 && plain <= 60, `plain names where trials use them: Breast Cancer, and ${plain} pages in all`);
  const html = diseasePage(breakdown('breast-neoplasms'), { list: diseaseSummary(diseaseDrugs('breast-neoplasms')) });
  ok(html.includes('<h1>Breast Cancer <span class="regterm">Breast Neoplasms</span></h1>') && html.includes('Registry term: Breast Neoplasms.') && html.includes('<title>Breast Cancer drugs'), 'Breast Cancer · Breast Neoplasms: heading, title and description');
}
{
  const before = diseasePage(breakdown(mid), {});
  ok(rowsOf(before) === 0 && before.includes(`Search ${breakdown(mid).name}`), 'before the helper reaches a disease, the page is as it was (no list)');
}
// The helper: a worker thread works out the top 10 and counts, the same as on request.
{
  const s = await startDiseaseTop({ slugs: [mid, tiny, none], pace: 0 });
  const want = diseaseSummary(diseaseDrugs(mid)), got = diseaseTop(mid);
  ok(s.count === 3 && !s.errors && got && got.stats.programs === want.stats.programs && got.programs.map(p => p.id).join() === want.programs.map(p => p.id).join() && diseaseTop(none)?.stats.programs === 0,
    `the helper keeps each disease's top ${DISEASE_TOP} and counts (3 in ${s.ms} ms)`);
  ok(!diseaseTop(huge), 'a disease the helper has not reached has nothing kept');
}
