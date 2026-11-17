// Orphan trials (scripts/orphan-trials.mjs) on a throwaway database: which trials count as orphans
// and why, the packet, folding answers into the seed, and src/ingest/link.js applying the seed on a reload.
import { tempDir } from './tmp.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { needsChecked } from './private.js';
needsChecked('orphan trials and the reader answers');
const dir = tempDir('ol-orphans-');
process.env.DB_PATH = join(dir, 'test.db');
const { getDb } = await import('../src/db.js');
const { orphanTrials, orphanPacketBuilder, foldAnswers, readOrphanSeed, WHY } = await import('../scripts/orphan-trials.mjs');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
const trial = (nct, intervention, { status = 'RECRUITING', cls = 'INDUSTRY', sponsor = 'Orphanco Ltd', type = 'DRUG', title = 'A study in healthy volunteers' } = {}) => {
  db.prepare('INSERT INTO trial (nct, title, status, phase, sponsor, sponsor_class) VALUES (?,?,?,2,?,?)').run(nct, title, status, sponsor, cls);
  db.prepare("INSERT INTO intervention (nct, type, name, other_names) VALUES (?,?,?,'[]')").run(nct, type, intervention);
  db.prepare("INSERT INTO trial_arm (nct, label, type, interventions) VALUES (?,'Arm','EXPERIMENTAL',?)").run(nct, JSON.stringify([`Drug: ${intervention}`]));
};
trial('NCT90000001', 'Treatment B');                              // the linker finds no drug: an orphan to read
trial('NCT90000002', 'Investigational vaccine');                  // an orphan the reader says has no drug
trial('NCT90000003', 'ORC-101');                                  // the linker makes its own row
trial('NCT90000004', 'Treatment C');                              // the seed names an intervention the trial does not have
trial('NCT90000005', 'Treatment D', { status: 'COMPLETED' });      // not active: not an orphan
trial('NCT90000006', 'Treatment E', { cls: 'OTHER' });             // not industry: not an orphan
trial('NCT90000007', 'Treatment F', { type: 'DEVICE' });           // no drug-type intervention: not an orphan

const seedPath = join(dir, 'orphan-trials.csv');
writeFileSync(seedPath, 'nct,intervention,drug,company,confidence,reason,target,target_trial,read_at,reader\n');
const relink = () => spawnSync(process.execPath, ['src/ingest/link.js'], { env: { ...process.env, ORPHAN_SEED: seedPath }, encoding: 'utf8' });
let r = relink();
ok(r.status === 0, 'the linker runs with an empty orphan seed');
let list = orphanTrials(db, readOrphanSeed(seedPath));
const why = nct => list.find(t => t.nct === nct)?.why;
ok(list.map(t => t.nct).join(' ') === 'NCT90000001 NCT90000002 NCT90000004', `orphans are active industry drug trials with no row (${list.map(t => t.nct).join(' ')})`);
ok(why('NCT90000001') === WHY.none, 'an orphan the linker made no row for is to be read');

const pk = orphanPacketBuilder(db)('NCT90000001').text;
ok(/^TRIAL NCT90000001/.test(pk) && /Sponsor: Orphanco Ltd \(INDUSTRY\)/.test(pk) && /\[DRUG\] Treatment B/.test(pk) && /\[EXPERIMENTAL\] Arm: Drug: Treatment B/.test(pk), 'the packet shows the trial, its sponsor, interventions and arms');
ok(/DRUG ROWS FROM THIS SPONSOR'S OTHER TRIALS \(1[;)][\s\S]*ORC-101/.test(pk), "the packet lists the sponsor's existing rows");

const answers = [
  'NCT90000001,Treatment B,ORC-202,Orphanco Ltd,high,The experimental arm tests ORC-202.,KRAS G12C,NCT90000001',
  'NCT90000002,,no drug,,medium,"Only a description, no product of the sponsor named.",,',
  'NCT90000003,ORC-101,ORC-999,Orphanco Ltd,high,Already linked by the linker.,unknown,',
  'NCT90000004,Treatment Z,ORC-303,Orphanco Ltd,low,Wrong intervention name.,unknown,',
].join('\n') + '\n';
let f = foldAnswers(answers, seedPath, '2026-11-10', 'test');
ok(f.lines === 4 && f.trials === 4 && f.replaced === 0, 'answers are folded into the seed with read date and reader');
f = foldAnswers('NCT90000004,Treatment C,ORC-303,Orphanco Ltd,medium,Second read.,unknown,\n', seedPath, '2026-11-11', 'test2');
const seed = readOrphanSeed(seedPath);
ok(f.replaced === 1 && seed.length === 4 && seed.find(s => s.nct === 'NCT90000004').reader === 'test2', 'a new answer for a trial replaces its old lines');

r = relink();
const stats = JSON.parse(r.stdout.match(/Orphan trials named by a reader: (\{.*\})/)[1]);
ok(stats.linked === 2 && stats.already_linked === 1 && stats.no_drug === 1 && stats.no_intervention === 0, `the linker applies the seed (${JSON.stringify(stats)})`);
const rowOf = nct => db.prepare('SELECT p.id, p.name, p.company FROM trial_program tp JOIN program p ON p.id = tp.program_id WHERE tp.nct = ?').all(nct);
ok(rowOf('NCT90000001').length === 1 && rowOf('NCT90000001')[0].name === 'ORC-202' && rowOf('NCT90000001')[0].company === 'Orphanco Ltd', 'the named drug gets a row of the sponsor, linked to the trial');
ok(db.prepare("SELECT matched_on FROM trial_program WHERE nct='NCT90000001'").pluck().get() === 'Treatment B', 'the link goes through the named intervention');
ok(rowOf('NCT90000003').map(p => p.name).join() === 'ORC-101', "a trial the linker links by itself keeps the linker's row");
ok(rowOf('NCT90000002').length === 0, '"no drug" changes nothing');
list = orphanTrials(db, readOrphanSeed(seedPath));
ok(list.map(t => `${t.nct} ${t.why}`).join(' | ') === `NCT90000002 ${WHY.nodrug}`, `after the reload only the "no drug" trial is an orphan, and it is not read again (${list.map(t => t.nct).join(' ')})`);
r = relink();
ok(rowOf('NCT90000001').map(p => p.name).join() === 'ORC-202', 'a second reload gives the same row');

// The reader's answer wins over a row the linker made only from the comparison arm (that row goes as control-only use
// afterwards, so the trial would end with no row), and a reader may name the drug the registry lists only as "Placebo".
trial('NCT90000008', 'Treatment G');
db.prepare("INSERT INTO intervention (nct, type, name, other_names) VALUES ('NCT90000008','DRUG','Brandocil','[]')").run();
db.prepare("INSERT INTO trial_arm (nct, label, type, interventions) VALUES ('NCT90000008','Control','ACTIVE_COMPARATOR','[\"Drug: Brandocil\"]')").run();
trial('NCT90000009', 'Placebo', { title: 'Study of 707 in adults with lupus' });
r = relink();
ok(rowOf('NCT90000008').length === 0 && rowOf('NCT90000009').length === 0, 'without a reader, the comparison-arm row goes and the placebo-only trial gets no row');
foldAnswers('NCT90000008,Treatment G,ORC-505,Orphanco Ltd,high,The experimental arm tests ORC-505; Brandocil is the comparison.,unknown,\n' +
  'NCT90000009,Placebo,707,Orphanco Ltd,high,"The experimental arms test 707, named in the title; the registry lists it only as Placebo.",unknown,\n', seedPath, '2026-11-11', 'test3');
r = relink();
const stats2 = JSON.parse(r.stdout.match(/Orphan trials named by a reader: (\{.*\})/)[1]);
ok(rowOf('NCT90000008').map(p => p.name).join() === 'ORC-505' && stats2.already_linked === 1, `a link only to a comparison-arm row does not stop the reader's answer (${JSON.stringify(stats2)})`);
ok(rowOf('NCT90000009').map(p => p.name).join() === '707' && db.prepare("SELECT matched_on FROM trial_program WHERE nct='NCT90000009'").pluck().get() === 'Placebo', 'a drug listed only as "Placebo" gets the reader\'s row');

const doc = readFileSync(new URL('../docs/ORPHAN_READ.md', import.meta.url), 'utf8');
ok(/acts on in the body/.test(doc) && /Never from the drug's name alone/.test(doc) && /no drug/.test(doc) && /once/.test(doc) && /one go/.test(doc) && /tokens/.test(doc), 'the orphan brief asks for the drug or "no drug", the target from the trial only, one read and the token count');
ok(readFileSync(new URL('../seed/orphan-trials.csv', import.meta.url), 'utf8').startsWith('nct,intervention,drug,company,confidence,reason,target,target_trial,read_at,reader'), 'the real seed has the expected columns');
