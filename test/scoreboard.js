// Checks the scoreboard's matching on a small made-up database, and the frozen label files against the audit's counts.
import Database from 'better-sqlite3';
import { key, loadLabels, parseCsv, report, score, WRONG } from '../src/scoreboard.js';
import { needsChecked } from './private.js';
needsChecked('the scoreboard and its frozen label files');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

// Frozen files
const { rows, baselineNames } = loadLabels();
const late = rows.filter(r => r.group === 'late'), early = rows.filter(r => r.group === 'early');
const wrong = list => list.filter(r => WRONG.includes(r.label)).length;
ok(late.length === 2748 && wrong(late) === 752, `Phase 3+ labels: ${wrong(late)} wrong of ${late.length} (audit: 752 of 2,748)`);
ok(early.length === 600 && wrong(early) === 122, `Phase 1-2 labels: ${wrong(early)} wrong of ${early.length} (audit: 122 of 600)`);
ok(new Set(rows.map(r => r.row_id)).size === rows.length, 'every labelled row appears once, across working and holdout files');
const share = rows.filter(r => r.part === 'holdout').length / rows.length;
ok(Math.abs(share - 0.3) < 0.005, `holdout is 30% of labelled rows (${(100 * share).toFixed(1)}%)`);
ok(rows.every(r => baselineNames.has(key(r.drug) + '|' + key(r.company))), 'every labelled row is in the frozen name list');
ok(parseCsv('a,b\n"x, ""y""\nz",2\n')[0].a === 'x, "y"\nz', 'CSV reader handles quotes, commas and line breaks');

// Matching
const db = new Database(':memory:');
db.exec(`CREATE TABLE program (id TEXT, name TEXT, company TEXT, aliases TEXT, status_label TEXT);
  CREATE TABLE trial_program (nct TEXT, program_id TEXT);
  CREATE TABLE trial (nct TEXT, status TEXT, phase REAL);
  CREATE TABLE program_merge (program_id TEXT, member_id TEXT, role TEXT);`);
const addP = (id, name, company, aliases = '[]') => db.prepare('INSERT INTO program VALUES (?,?,?,?,NULL)').run(id, name, company, aliases);
const link = (nct, id, status = 'RECRUITING') => { db.prepare('INSERT INTO trial_program VALUES (?,?)').run(nct, id); db.prepare('INSERT INTO trial VALUES (?,?,3)').run(nct, status); };
const label = (row_id, drug, company, lab, trials, part = 'work') => ({ row_id, drug, company, label: lab, trials, part, group: 'late', top_phase: '3', status_label: '' });
const names = new Set(['alpha|acme', 'keepmab|acme', 'epsilon|acme', 'merged|acme', 'rightone|acme']);   // rows that existed on 8 Nov; Fresh did not

addP('a', 'Alpha', 'Acme'); link('N1', 'a');                                          // same id
addP('b-new', 'Beta', 'Acme'); link('N2', 'b-new');                                   // id changed, same name and company
addP('keep', 'Keepmab', 'Acme', '[{"name":"KP-1"}]'); link('N3', 'keep');   // KP-1 absorbed by alias
addP('g', 'Gamma', 'NewCo'); link('N4', 'g');                                         // owner moved company
addP('fresh', 'Unknown Name', 'Acme'); link('N5', 'fresh');                           // a new row took over the trials
addP('e', 'Epsilon', 'Acme'); link('N7', 'e', 'COMPLETED');                           // no active trial
addP('m', 'Merged', 'Acme'); link('N8', 'm');
db.exec(`INSERT INTO program_merge VALUES ('m','old-m','merged')`);
addP('r1', 'RightOne', 'Acme', '[{"name":"RightTwo"}]'); link('N9', 'r1');            // RightTwo folded into RightOne

const labelled = [
  label('a', 'Alpha', 'Acme', 'comparator', 'N1'),
  label('old-b', 'Beta', 'Acme', 'right', 'N2'),
  label('old-kp', 'KP-1', 'Acme', 'duplicate', 'N3'),
  label('old-g', 'Gamma', 'OldCo', 'owner', 'N4'),
  label('old-h', 'Hidden Row Name', 'Acme', 'right', 'N5', 'holdout'),
  label('old-z', 'Zeta', 'Acme', 'junk', 'N6'),
  label('e', 'Epsilon', 'Acme', 'right', 'N7'),
  label('old-m', 'Merged Member', 'Acme', 'duplicate', 'N8'),
  label('r1', 'RightOne', 'Acme', 'right', 'N9'),
  label('old-r2', 'RightTwo', 'Acme', 'right', 'N9'),
  label('old-g2', 'Gamma', 'OtherCo', 'right', 'N4'),
];
const scored = score(labelled, names, db);
const by = name => scored.results.find(r => r.drug === name && (name !== 'Gamma' || r.company === 'OldCo'));
const secondGamma = scored.results.find(r => r.company === 'OtherCo');
ok(by('Alpha').state === 'same' && by('Alpha').outcome === 'still', 'same id: wrong row still there');
ok(by('Beta').state === 'newId' && by('Beta').outcome === 'still', 'id changed, name and company match: right row kept');
ok(by('KP-1').state === 'absorbed' && by('KP-1').outcome === 'gone', 'duplicate folded into another row by alias: counted removed');
ok(by('Merged Member').outcome === 'gone', 'duplicate recorded in program_merge: counted removed');
ok(by('Gamma').state === 'moved' && by('Gamma').outcome === 'gone', 'owner row now under another company: counted fixed');
ok(secondGamma.outcome === 'unmatched', 'right row now under another company: cannot tell, not dropped');
ok(by('Hidden Row Name').outcome === 'unmatched', 'trials taken over by a new row: cannot tell, not dropped');
ok(by('Zeta').outcome === 'gone', 'no name, id or trial left: counted removed');
ok(by('Epsilon').outcome === 'inactive', 'found but no active trial: kept apart');
ok(by('RightOne').outcome === 'still' && by('RightTwo').outcome === 'gone' && by('RightTwo').mergedRight, 'two right rows merged into one: one counted lost');

const text = report(scored, 'test');
ok(!text.includes('Hidden Row Name'), 'holdout rows are never named in the report');
ok(/Holdout, totals only \(1 rows/.test(text) && text.includes("can't match 1"), 'holdout rows are counted in the totals');
ok(text.includes('RightTwo') && text.includes('Unknown Name') === false, 'working rows lost are listed; holdout candidates are not');
