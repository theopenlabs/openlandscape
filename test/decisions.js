// Checks the regulator-decision loaders (EMA file, openFDA, SEC full-text rule) on a throwaway database, offline.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-decisions-'), 'test.db');
const { getDb, meta } = await import('../src/db.js');
const { emaDecisions } = await import('../src/ingest/ema.js');
const { approvalsOf, crlSentence } = await import('../src/ingest/fda-decisions.js');
const S = await import('../src/ingest/sec-decisions.js');
const { decisionWriter } = await import('../src/ingest/decisions.js');
const { companyPrograms } = await import('../src/match.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
db.exec(`INSERT INTO company (id, name, sponsor_patterns) VALUES ('lilly', 'Eli Lilly', '["eli lilly"]'), ('az', 'AstraZeneca', '["astrazeneca"]');
  INSERT INTO drug (id, name, companies) VALUES ('orforglipron', 'orforglipron', '["lilly"]');
  INSERT INTO drug_alias (alias_norm, alias, drug_id, source) VALUES ('orforglipron', 'orforglipron', 'orforglipron', 'canonical name'), ('ly3502970', 'LY3502970', 'orforglipron', 'seed');
  INSERT INTO program (id, drug_id, name, aliases, company, company_ids, curated) VALUES ('orforglipron', 'orforglipron', 'orforglipron', '[{"name":"LY3502970"}]', 'Eli Lilly', '["lilly"]', 1),
    ('auto:camizestrant|az', NULL, 'camizestrant', '[]', 'AstraZeneca', '[]', 0)`);

// ---- EMA ----
const ema = { category: 'Human', name_of_medicine: 'Foundayo', ema_product_number: 'EMEA/H/C/006500', international_non_proprietary_name_common_name: 'Orforglipron',
  marketing_authorisation_developer_applicant_holder: 'Eli Lilly Nederland B.V.', opinion_status: 'Positive', opinion_adopted_date: '15/10/2026', generic: 'No', biosimilar: 'No',
  therapeutic_indication: 'Foundayo is indicated&nbsp;for weight management.', medicine_url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/foundayo',
  marketing_authorisation_date: '', refusal_of_marketing_authorisation_date: '', withdrawal_of_application_date: '', start_of_evaluation_date: '01/02/2026', start_of_rolling_review_date: '' };
const ed = emaDecisions(ema);
ok(ed.map(d => d.kind).join() === 'opinion,filing' && ed[0].decision_date === '2026-10-15' && ed[0].region === 'EU' && ed[0].source_url.endsWith('/foundayo'), 'EMA row: positive opinion and start of evaluation, ISO dates, EPAR link');
ok(emaDecisions({ ...ema, opinion_status: 'Negative' })[0].kind === 'rejection' && emaDecisions({ ...ema, opinion_status: '', marketing_authorisation_date: '20/11/2026', start_of_evaluation_date: '' })[0].kind === 'approval'
  && emaDecisions({ ...ema, opinion_status: '', withdrawal_of_application_date: '13/08/2026', start_of_evaluation_date: '' })[0].kind === 'withdrawal', 'negative opinion = rejection, EC authorisation = approval, withdrawn application = withdrawal');
ok(emaDecisions({ ...ema, generic: 'Yes' })[0].names.length === 0 && emaDecisions({ ...ema, category: 'Veterinary' }).length === 0, 'generics are stored but never matched to a program; veterinary medicines skipped');
ok(ed[0].indication === 'Foundayo is indicated for weight management.', 'indication text is EMA’s own, with HTML entities decoded');

// ---- writer: first run records quietly, later runs announce; same decision from two sources is one row ----
let w = decisionWriter({ source: 'ema' });
w.record(ed[0]); w.done();
ok(db.prepare('SELECT count(*) FROM change').pluck().get() === 0 && db.prepare('SELECT program_id FROM regulatory_decision').pluck().get() === 'orforglipron', 'first run stores the decision, matched to the program, without a feed row');
w = decisionWriter({ source: 'ema' });
w.record({ ...ed[0], key: 'EMA|x|approval', kind: 'approval', decision_date: '2026-12-01', text: 'European Commission marketing authorisation: Foundayo (Orforglipron)' }); w.record(ed[0]); w.done();
const c = db.prepare('SELECT * FROM change').get();
ok(db.prepare('SELECT count(*) FROM change').pluck().get() === 1 && c.kind === 'approval' && c.region === 'EU' && c.decision_date === '2026-12-01' && c.source_url.includes('ema.europa.eu') && c.program_id === 'orforglipron',
  'a new decision becomes one change with kind, region, decision date and source link; a known one is not repeated');
ok(w.record({ ...ed[0], key: 'EMA|y', holder: 'Some Generic Co' }) === null || !db.prepare("SELECT program_id FROM regulatory_decision WHERE key='EMA|y'").pluck().get(), 'another holder of the same INN is not matched to the program');

// ---- openFDA ----
const app = { application_number: 'NDA217806', sponsor_name: 'ELI LILLY AND CO', products: [{ brand_name: 'ZEPBOUND', active_ingredients: [{ name: 'TIRZEPATIDE' }] }],
  submissions: [{ submission_type: 'SUPPL', submission_number: '30', submission_status: 'AP', submission_status_date: '20261020', submission_class_code: 'EFFICACY', submission_class_code_description: 'Efficacy' },
    { submission_type: 'SUPPL', submission_number: '31', submission_status: 'AP', submission_status_date: '20261021', submission_class_code: 'LABELING' },
    { submission_type: 'ORIG', submission_number: '1', submission_status: 'AP', submission_status_date: '20231108' }] };
const ap = approvalsOf(app, '2026-08-01');
ok(ap.length === 1 && ap[0].kind === 'approval' && ap[0].decision_date === '2026-10-20' && ap[0].quote === 'SUPPL · Efficacy' && ap[0].source_url.includes('ApplNo=217806'), 'Drugs@FDA: new uses (efficacy supplements) in the window are approvals; labelling changes and old approvals are not');
ok(approvalsOf({ ...app, application_number: 'ANDA123456' }, '2026-01-01').length === 0, 'generic applications (ANDA) are skipped');
ok(crlSentence('Dear X:\nWe have completed our review of this application and have determined that we cannot\napprove this application in its present form. We have') === 'We have completed our review of this application and have determined that we cannot approve this application in its present form.', 'rejection letter: quotes the letter’s own sentence');

// ---- SEC rule (3.8) ----
const ph = kind => S.PHRASES.find(p => p.kind === kind);
const html = `<html><body><p>AstraZeneca PLC</p><p>Camizestrant PDUFA date extended</p><p>The US Food and Drug Administration (FDA) has informed AstraZeneca that it will extend the
 Prescription Drug User Fee Act (PDUFA) date to review additional data for the NDA for camizestrant in combination with a CDK4/6 inhibitor. The U.S. company said more.</p></body></html>`;
ok(S.sentences(html).includes('Camizestrant PDUFA date extended') && S.sentences(html).some(s => s.startsWith('The US Food') && s.endsWith('CDK4/6 inhibitor.')), 'filings split into sentences; headlines and "U.S." handled; line breaks inside a sentence ignored');
const progs = companyPrograms(db)('az');
const j = S.judge({ html, form: '6-K', items: [], phrase: ph('delay'), progs, filed: '2026-05-27' });
ok(j.auto && j.program.program_id === 'auto:camizestrant|az' && S.sentences(html).includes(j.sentence) && /camizestrant/i.test(j.sentence), '6-K naming the drug in the same sentence as the phrase: published automatically, quoting that sentence as filed');
ok(!S.judge({ html, form: '8-K', items: ['2.02', '7.01'], phrase: ph('delay'), progs, filed: '2026-05-27' }).auto, '8-K with results item 2.02: review queue');
ok(!S.judge({ html, form: '8-K', items: ['5.02'], phrase: ph('delay'), progs, filed: '2026-05-27' }).auto && S.autoForm('8-K', ['8.01', '9.01']) && S.autoForm('8-K', ['7.01']), 'only 8-K items 7.01 or 8.01 qualify');
ok(!S.autoForm('6-K', [], 'Belite Bio Reports Unaudited Second Quarter 2026 Financial Results'), 'a 6-K that is a results report counts as results');
ok(!S.judge({ html: '<p>The FDA has approved camizestrant for breast cancer.</p>', form: '8-K', items: ['8.01'], phrase: ph('approval'), progs: companyPrograms(db)('lilly'), filed: '2026-09-04' }).auto, 'a drug of another company in the sentence does not count');
const cover = '<p>6-K 1 x.htm 6-K</p><p>SECURITIES AND EXCHANGE COMMISSION</p><p>REPORT OF FOREIGN PRIVATE ISSUER</p><p>Pursuant to rule 13a-16 or 15d-16</p><p>of the Securities Exchange Act of 1934</p><p>(Exact name of Registrant as specified in its charter)</p><p>(Address of principal executive offices)</p><p>Indicate by check mark whether the registrant files or will file annual reports under cover of Form 20-F or Form 40-F</p><p>Form 20-F x Form 40-F o</p>';
const op = h => S.openingOf(S.sentences(h));
ok(!S.autoForm('6-K', [], op(cover + '<p>Company announcement No 65 / 2026</p><p>Financial report for the period 1 January 2026 to 30 September 2026</p><p>Third-quarter adjusted operating profit increasing 27%</p>'))
  && !S.autoForm('6-K', [], op('<p>EX-99.1 2 pr.htm EX-99.1 Q1 2026: double-digit sales and business EPS growth</p><p>Paris, April 23, 2026</p>')),
  'results reports are recognised after a cover page (Novo Nordisk) and by "Q1 2026 ... sales / EPS" titles (Sanofi)');
ok(S.autoForm('6-K', [], op(cover + '<p>HUTCHMED Announces NMPA Approval for ORPATHYS for the treatment of Gastric Cancer</p><p>Launch is expected in Q4 2026.</p>')), 'a 6-K press release behind a cover page is still not a results report');
ok((await import('../src/ingest/decisions.js')).decode('Bagsv&aelig;rd, K&Oslash;GE, M&uuml;nchen') === 'Bagsværd, KØGE, München', 'letters like æ and Ø in filings are decoded');
ok(S.recap('In January 2026, the NMPA approved the BLA for X.', '2026-08-13') && !S.recap('On August 28, 2026 the NMPA approved X.', '2026-08-28'), 'a sentence dating its event 45+ days before the filing is a recap, not news');
ok(!ph('approval').sentence('Quantum received approval from the FDA to proceed with its Phase 2 trial of Lucid-21-302.') && !ph('rejection').sentence('We may receive a complete response letter from the FDA.')
  && !ph('approval').sentence('Products approved by the U.S. Food and Drug Administration under NDA No. 213005.') && ph('approval').sentence('The U.S. Food and Drug Administration has approved TRYNGOLZA (olezarsen).'),
  'approval and rejection wording: announcements only, not trial go-aheads, hypotheticals or descriptions');

// ---- review queue: a person publishes a held SEC alert ----
const { publishReviewed } = await import('../src/ingest/decisions.js');
const held = { key: 'SEC|0000901832-26-000001|x.htm|delay', agency: 'SEC', region: 'US', kind: 'delay', product: 'camizestrant', holder: 'AstraZeneca PLC', decision_date: '2026-05-27',
  source_url: 'https://www.sec.gov/Archives/edgar/data/901832/x.htm', quote: 'The FDA will extend the PDUFA date for camizestrant.', program: { program_id: 'auto:camizestrant|az', drug_id: null },
  text: 'US review extended (PDUFA date), per AstraZeneca PLC SEC 6-K: camizestrant' };
const pub = publishReviewed(held, db);
const pc = db.prepare("SELECT * FROM change WHERE field='SEC'").get();
ok(pub.published && pc.kind === 'delay' && pc.quote === held.quote && pc.source_url === held.source_url && pc.decision_date === '2026-05-27', 'publishing from the review page writes the change with its quote and filing link');
ok(!publishReviewed({ ...held, key: 'SEC|other' }, db).published && db.prepare("SELECT count(*) FROM change WHERE field='SEC'").pluck().get() === 1, 'publishing the same news twice adds no second row');
ok(!publishReviewed({ ...held, program: null }, db).published, 'an item that names no tracked drug cannot be published');
