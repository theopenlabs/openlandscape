// Read verdicts (src/ingest/verdicts.js) on a throwaway database: finding a row by name or by trial, what each verdict
// does, what is queued, a person's decision, and the review page's Apply.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-verdicts-'), 'test.db');
const { getDb } = await import('../src/db.js');
const { applyVerdicts, pickRows, readIdentity } = await import('../src/ingest/verdicts.js');
const R = await import('../src/review.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
const row = (id, name, company, curated = 0) => db.prepare("INSERT INTO program (id, drug_id, name, aliases, company, company_ids, curated) VALUES (?,?,?,?,?,?,?)").run(id, curated ? id : null, name, '[]', company, '[]', curated);
const link = (nct, id, on) => db.prepare('INSERT INTO trial_program (nct, program_id, matched_on) VALUES (?,?,?)').run(nct, id, on);
const trial = (nct, phase, status = 'RECRUITING') => db.prepare('INSERT INTO trial (nct, phase, status) VALUES (?,?,?)').run(nct, phase, status);
for (const n of ['NCT00000001', 'NCT00000002', 'NCT00000003', 'NCT00000004', 'NCT00000005', 'NCT00000006']) trial(n, 3);
row('auto:placebo2tabs|acme', 'Placebo 2 tabs', 'Acme'); link('NCT00000001', 'auto:placebo2tabs|acme', 'Placebo 2 tabs');
row('auto:acm001|acme', 'ACM-001', 'Acme'); link('NCT00000002', 'auto:acm001|acme', 'ACM-001');
db.prepare("UPDATE program SET list_url='https://gsrs.example/ACM001', status_label='Approved (US)', status_level=5, status_source='https://fda.example/1' WHERE id='auto:acm001|acme'").run();
row('auto:acmelimab|acme', 'Acmelimab', 'Acme'); link('NCT00000003', 'auto:acmelimab|acme', 'Acmelimab');
row('auto:oldbrand|acme', 'Oldbrand', 'Acme'); link('NCT00000004', 'auto:oldbrand|acme', 'Oldbrand');
row('auto:keytruda|acme', 'Keytruda', 'Acme'); link('NCT00000005', 'auto:keytruda|acme', 'Keytruda');
row('acmedrug', 'Acmedrug', 'Acme', 1); link('NCT00000006', 'acmedrug', 'Acmedrug');
row('auto:renamed|acme', 'Renamed Drug', 'Acme'); link('NCT00000002', 'auto:renamed|acme', 'Old Name');
row('auto:backbonex|acme', 'Backbonex', 'Acme'); link('NCT00000006', 'auto:backbonex|acme', 'Backbonex');

const v = (drug, company, verdict, confidence, extra = {}) => ({ drug, company, trials: '', verdict, confidence, duplicate_of: '', reason: 'because', evidence: 'NCT00000001', read_at: '2026-11-08', reader: 'test', ...extra, name_key: undefined, company_key: undefined });
const { key } = await import('../src/scoreboard.js');
const K = x => ({ ...x, name_key: key(x.drug), company_key: key(x.company) });
const verdicts = [
  v('Placebo 2 tabs', 'Acme', 'junk', 'high'),
  v('ACM-001', 'Acme', 'duplicate', 'high', { duplicate_of: 'Acmelimab' }),
  v('Keytruda', 'Acme', 'comparator', 'medium'),
  v('Acmelimab', 'Acme', 'right', 'medium', { target: 'PD-1', target_trial: 'NCT00000003' }),
  v('Backbonex', 'Acme', 'backbone', 'high'),
  v('Oldbrand', 'Acme', 'stage', 'high', { trials: 'NCT00000004:oldbrand', approval_label: 'Approved (China)', approval_source: 'https://nmpa.example/1' }),
  v('Acmedrug', 'Acme', 'right', 'high'),
  v('Gone Drug', 'Acme', 'junk', 'high'),
  v('Old Name', 'Acme', 'junk', 'high', { trials: 'NCT00000002:oldname' }),   // renamed since it was read: found through its trial
].map(K);

const s1 = applyVerdicts({ db, verdicts, today: '2026-11-09' });
ok(s1.dropped === 3, `junk and backbone rows dropped, one found by trial after a rename (${s1.dropped})`);
ok(!db.prepare("SELECT 1 FROM program WHERE id IN ('auto:placebo2tabs|acme','auto:renamed|acme')").get(), 'dropped rows and their links are gone');
ok(s1.merged === 1 && !db.prepare("SELECT 1 FROM program WHERE id='auto:acm001|acme'").get(), 'ACM-001 folded into Acmelimab');
ok(db.prepare("SELECT count(*) FROM trial_program WHERE program_id='auto:acmelimab|acme'").pluck().get() === 2, 'the folded row\'s trial moved to the kept row');
ok(db.prepare("SELECT role FROM program_merge WHERE program_id='auto:acmelimab|acme' AND member_id='auto:acm001|acme'").pluck().get() === 'merged', 'merge recorded in program_merge');
ok(JSON.parse(db.prepare("SELECT aliases FROM program WHERE id='auto:acmelimab|acme'").pluck().get()).some(a => a.name === 'ACM-001'), 'folded name kept as an other name');
const kept = db.prepare("SELECT list_url, status_level FROM program WHERE id='auto:acmelimab|acme'").get();
ok(kept.list_url === 'https://gsrs.example/ACM001' && kept.status_level === 5, 'the folded row\'s list link and approval carry over to the kept row');
ok(s1.approved === 1 && db.prepare("SELECT status_label||' '||status_level||' '||coalesce(flag,'-') FROM program WHERE id='auto:oldbrand|acme'").pluck().get() === 'Approved (China) 5 -', 'a stage verdict with a confirmed approval sets the row\'s status instead of a flag');
ok(s1.kept === 2, 'right verdicts are kept at any confidence, hand-checked or not');
ok(s1.absent === 1, 'a verdict whose row no longer exists is recorded as absent');
const tv = db.prepare("SELECT target, target_trial FROM row_verdict WHERE drug='Acmelimab'").get();
ok(tv.target === 'PD-1' && tv.target_trial === 'NCT00000003' && !db.prepare("SELECT mechanism FROM program WHERE id='auto:acmelimab|acme'").pluck().get(), 'a verdict\'s target and its trial are stored with it; the row\'s mechanism is not changed');
ok(db.prepare("SELECT target FROM row_verdict WHERE drug='Keytruda'").pluck().get() === null, 'a verdict with no target stores none');
ok(s1.queued === 1 && db.prepare("SELECT count(*) FROM match_candidate WHERE type='verdict' AND status='open'").pluck().get() === 1, 'the medium verdict is queued, the row stays');
ok(db.prepare("SELECT 1 FROM program WHERE id='auto:keytruda|acme'").get(), 'queued row untouched');

// Re-running on the same database changes nothing more and queues nothing twice.
const s2 = applyVerdicts({ db, verdicts, today: "2026-11-09" });
ok(s2.absorbed === 1, 'a folded row\'s verdict is marked absorbed and the kept row is left alone');
ok(s2.queued === 1 && db.prepare("SELECT count(*) FROM match_candidate WHERE type='verdict'").pluck().get() === 1, 'second pass queues the same item once');

// The review page shows it and Apply removes the row; a reload then applies the person's decision again.
const html = R.reviewBody(db);
ok(html.includes('Drug rows a reader doubted<span class="count">1</span>') && html.includes('Remove the row') && !html.includes('Flagged rows'), 'review page lists the doubt; nothing is flagged');
const id = db.prepare("SELECT id FROM match_candidate WHERE type='verdict'").pluck().get();
ok(/Removed/.test(R.applyItem(db, id, 'team')) && !db.prepare("SELECT 1 FROM program WHERE id='auto:keytruda|acme'").get(), 'Apply removes the row');
row('auto:keytruda|acme', 'Keytruda', 'Acme'); link('NCT00000005', 'auto:keytruda|acme', 'Keytruda');   // link.js rebuilds it
const s3 = applyVerdicts({ db, verdicts, today: '2026-11-10' });
ok(s3.dropped === 1 && !db.prepare("SELECT 1 FROM program WHERE id='auto:keytruda|acme'").get(), 'an accepted verdict is applied again on the next reload');
// Keep the row: a dismissed verdict is left alone from then on.
row('auto:keytruda|acme', 'Keytruda', 'Acme'); link('NCT00000005', 'auto:keytruda|acme', 'Keytruda');
db.prepare("UPDATE match_candidate SET status='rejected' WHERE id=?").run(id);
const s4 = applyVerdicts({ db, verdicts, today: '2026-11-11' });
ok(s4.rejected === 1 && db.prepare("SELECT 1 FROM program WHERE id='auto:keytruda|acme'").get(), 'a rejected verdict leaves the row alone');

// Picking rows to re-read: unread rows and rows with new trials.
row('auto:newdrug|acme', 'Newdrug', 'Acme'); link('NCT00000001', 'auto:newdrug|acme', 'Newdrug');
link('NCT00000004', 'auto:acmelimab|acme', 'Acmelimab');
const pick = pickRows({ db, verdicts });
ok(pick.rows.some(r => r.row_id === 'auto:newdrug|acme' && r.why === 'no verdict'), 'an unread row is picked');
ok(!pick.rows.some(r => r.row_id === 'auto:oldbrand|acme'), 'a read row with no new trials is not picked');

// A duplicate whose target name exists under two other companies: the company in brackets says which row.
row('auto:twin|beta', 'Twin', 'Beta'); row('auto:twin|gamma', 'Twin', 'Gamma'); row('auto:longtwin|acme', 'Long name of Twin', 'Acme'); link('NCT00000003', 'auto:longtwin|acme', 'Long name of Twin');
const s5 = applyVerdicts({ db, verdicts: [v('Long name of Twin', 'Acme', 'duplicate', 'high', { duplicate_of: 'Twin [Gamma]' })].map(K), today: '2026-11-12' });
ok(s5.merged === 1 && db.prepare("SELECT 1 FROM trial_program WHERE program_id='auto:twin|gamma' AND nct='NCT00000003'").get(), 'a duplicate naming "Twin [Gamma]" folds into the Gamma row, not the Beta one');

// Web answers (seed/drug-identity.csv): sure ones apply, the rest wait for a person.
const idFile = join(tempDir('ol-identity-'), 'id.csv');
(await import('node:fs')).writeFileSync(idFile, [
  'kind,drug,company,same_as,approval,source_url,source_kind,quote,how,date',
  'same,RTN-001,Retension,SLx-2101,,https://example.org/a,,"RTN 001 (formerly known as SLX 2101)",search + software,2026-11-12',
  'same,ZX-1,Acme,Zedmab,,https://example.org/b,,"ZX-1 (zedmab)",search + model,2026-11-12',
  'approved,Benmelstobart,CTTQ,,Approved in China,https://www1.hkexnews.hk/x.pdf,exchange,"approved by the NMPA",search + software,2026-11-12',
  'approved,Foomab,Acme,,Approved in Japan,https://news.example/c,news,"Foomab approved in Japan",search + model; quote checked,2026-11-12',
].join('\n'));
const ids = readIdentity(idFile);
ok(ids.length === 4 && ids[0].verdict === 'duplicate' && ids[0].duplicate_of === 'SLx-2101 [Retension]' && ids[0].confidence === 'high', 'a twin settled by software applies, folding into the same company\'s row');
ok(ids[1].confidence === 'medium', 'a twin a model named without a checked quote waits for a person');
ok(ids[2].verdict === 'stage' && ids[2].approval_label === 'Approved in China' && ids[2].confidence === 'medium', 'an approval from an exchange filing waits for a person');
ok(ids[3].confidence === 'medium', 'an approval found only in the news waits for a person');
const checkedFile = idFile.replace(/id\.csv$/, 'checked.csv');
(await import('node:fs')).writeFileSync(checkedFile, 'kind,drug,company,same_as,approval,source_url,source_kind,quote,how,date\napproved,Foomab,Acme,,Approved in Japan,https://news.example/c,news,"Foomab approved in Japan","search + model, quote checked, person checked",2026-11-12\n');
ok(readIdentity(checkedFile)[0].confidence === 'high', 'an approval a person checked applies by itself');

// A duplicate whose other row was already folded into it (its name is now an other name of this row) is done, not queued.
const s9 = applyVerdicts({ db, verdicts: [K(v('Acmelimab', 'Acme', 'duplicate', 'high', { duplicate_of: 'ACM-001 [Acme]' }))], today: '2026-11-12' });
ok(s9.kept === 1 && s9.queued === 0 && db.prepare("SELECT 1 FROM program WHERE id='auto:acmelimab|acme'").get(), 'a duplicate already folded into this row is left alone, not queued');
