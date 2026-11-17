// The early-row rule (scripts/early-rule.mjs) and the pick step's phases, on a throwaway database: one row that passes
// and one row for each test the rule makes. Also that the rule sheet and reader brief say what the early read relies on.
import { tempDir } from './tmp.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsChecked } from './private.js';
needsChecked('the early-row rule and its reading packets');
process.env.DB_PATH = join(tempDir('ol-earlyrule-'), 'test.db');
const { getDb } = await import('../src/db.js');
const { pickRows } = await import('../src/ingest/verdicts.js');
const { earlyRule } = await import('../scripts/early-rule.mjs');
const { packetBuilder } = await import('../scripts/packet-lib.mjs');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
let n = 0;
// One row with one trial: the row's name is the intervention, in one arm of the given type.
function row(name, { company = 'Acme', phase = 1, status = 'RECRUITING', cls = 'INDUSTRY', arm = 'EXPERIMENTAL', title = 'A study of ' + name, sponsor = company } = {}) {
  const id = `auto:${name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${company.toLowerCase()}`, nct = 'NCT' + String(++n).padStart(8, '0');
  db.prepare("INSERT OR IGNORE INTO program (id, name, aliases, company, company_ids, curated) VALUES (?,?,'[]',?,'[]',0)").run(id, name, company);
  db.prepare('INSERT INTO trial (nct, title, status, phase, sponsor, sponsor_class) VALUES (?,?,?,?,?,?)').run(nct, title, status, phase, sponsor, cls);
  db.prepare("INSERT INTO intervention (nct, type, name, other_names) VALUES (?,'DRUG',?,'[]')").run(nct, name);
  db.prepare('INSERT INTO trial_arm (nct, label, type, interventions) VALUES (?,?,?,?)').run(nct, 'Arm', arm, JSON.stringify(['Drug: ' + name]));
  db.prepare('INSERT INTO trial_program (nct, program_id, matched_on) VALUES (?,?,?)').run(nct, id, name);
  return id;
}
const good = row('ACM-101');
const word = row('Acmelimab', { company: 'Beta' });
const comp = row('BET-202', { company: 'Gamma', arm: 'ACTIVE_COMPARATOR' });
const acad = row('UNI-303', { company: 'Delta', cls: 'OTHER' });
const two = row('EPS-404', { company: 'Epsilon' }); row('EPS-404', { company: 'Epsilon', sponsor: 'Epsilon Partner', status: 'COMPLETED' });
const appr = row('ZET-505', { company: 'Zeta' }); db.prepare("UPDATE program SET status_label='Approved (US)' WHERE id=?").run(appr);
const fda = row('ETA-606', { company: 'Eta' }); db.prepare("INSERT INTO fda_approval (appl_no, brand, ingredient, sponsor, approval_date) VALUES ('1','ETA-606','etamab','Eta','2020-01-01')").run();
const img = row('THE-707', { company: 'Theta', title: 'PET imaging with THE-707' });
const dup = row('IOT-808', { company: 'Iota' }); row('IOT-808 tablets', { company: 'Iota' });
const late = row('KAP-909', { company: 'Kappa', phase: 3 });
const done = row('LAM-010', { company: 'Lambda', status: 'COMPLETED' });

const check = earlyRule(db);
ok(check(good).pass && /^NCT/.test(check(good).evidence), 'a coded drug in an experimental arm of its one industry sponsor passes, with its trial as evidence');
for (const [id, why] of [[word, 'development code'], [comp, 'experimental arms'], [acad, 'industry'], [two, 'one sponsor'], [appr, 'approval status'], [fda, 'FDA approval'], [img, 'imaging'], [dup, 'possible duplicates'], [done, 'no active trial']])
  ok(!check(id).pass && check(id).why.includes(why.split(' ').pop()), `left for a reader: ${id} (${check(id).why})`);
ok(packetBuilder(db)(dup).duplicates === 1 && /POSSIBLE DUPLICATES \(1/.test(packetBuilder(db)(dup).text), 'the rule and the packet count the same duplicate candidates');

// The packet carries the registry's words about the drug (trial summary, intervention description), where its target is stated.
const goodNct = db.prepare('SELECT nct FROM trial_program WHERE program_id=?').pluck().get(good);
db.prepare('UPDATE trial SET summary=? WHERE nct=?').run('A first-in-human study of ACM-101, a PD-1 antibody. ' + 'more words '.repeat(80), goodNct);
db.prepare("UPDATE intervention SET description='ACM-101 is an anti-PD-1 monoclonal antibody' WHERE nct=?").run(goodNct);
db.prepare("INSERT INTO intervention (nct, type, name, other_names, description) VALUES (?,'DRUG','Placebo','[]','Saline infusion')").run(goodNct);
const goodText = packetBuilder(db)(good).text;
ok(/Summary: A first-in-human study of ACM-101, a PD-1 antibody\./.test(goodText) && /Summary: .{400,505} …\n/.test(goodText), 'the packet shows the trial summary, cut short');
ok(/Intervention \[DRUG\] ACM-101 \| ACM-101 is an anti-PD-1 monoclonal antibody/.test(goodText) && !/Saline infusion/.test(goodText), 'the packet shows the intervention description, but not a placebo\'s');

const pick = pickRows({ db, verdicts: [] });
ok(pick.late === 1 && pick.early === 10, `the pick step counts late and early rows apart (${pick.late} late, ${pick.early} early)`);
ok(pick.rows.find(r => r.row_id === good)?.phase === 1 && pick.rows.find(r => r.row_id === late)?.phase === 3, 'each picked row carries its top active phase');
ok(!pick.rows.some(r => r.row_id === done), 'a row with no active trial is not picked');

const rules = readFileSync(new URL('../docs/READ_RULES.md', import.meta.url), 'utf8'), brief = readFileSync(new URL('../docs/READER_BRIEF.md', import.meta.url), 'utf8');
ok(/## Early-stage rows/.test(rules) && /drug-interaction/.test(rules) && /bioequivalence/.test(rules) && /radiolabelled/.test(rules) && /lymphodepletion/.test(rules), 'the rule sheet has the early-stage section');
ok(/at any phase/.test(rules.split('\n').find(l => l.startsWith('| `stage`'))), 'the stage rule covers an approved product at any phase');
ok(/once/.test(brief) && /one go/.test(brief) && /tokens/.test(brief), 'the reader brief says read once, write in one go, report tokens');
ok(brief.includes('row_id,verdict,confidence,duplicate_of,reason,evidence,target,target_trial') && rules.includes('row_id,verdict,confidence,duplicate_of,reason,evidence,target,target_trial'), 'brief and rule sheet give the verdict line with target and target_trial');
ok(/what does this drug act on in the body/.test(brief) && /"unknown"/.test(brief) && /own knowledge/.test(brief), 'the brief asks the target question, allows unknown and forbids guessing');
