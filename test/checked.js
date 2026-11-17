// The "checked" count of a landscape (src/query.js) on a throwaway database: a hand-checked row and a row read with a
// settled verdict are checked; a row queued for a person and a row never read are not.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-checked-'), 'test.db');
const { getDb } = await import('../src/db.js');
const Q = await import('../src/query.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
const row = (id, name, curated = 0) => db.prepare("INSERT INTO program (id, drug_id, name, aliases, company, company_ids, curated) VALUES (?,?,?,?,?,?,?)").run(id, curated ? id : null, name, '[]', 'Acme', '[]', curated);
const trial = (nct, id) => {
  db.prepare("INSERT INTO trial (nct, phase, phase_label, status, title, sponsor, conditions, primary_completion) VALUES (?,3,'Phase 3','RECRUITING','A study in checkitis','Acme',?, '2027-06')").run(nct, JSON.stringify(['Checkitis']));
  db.prepare('INSERT INTO trial_program (nct, program_id, matched_on) VALUES (?,?,?)').run(nct, id, id);
};
const verdict = (id, action, read_at) => db.prepare('INSERT INTO row_verdict (name_key, company_key, program_id, action, read_at, reader) VALUES (?,?,?,?,?,?)').run(id, 'acme', id, action, read_at, 'test');
row('handdrug', 'Handdrug', 1); trial('NCT00000001', 'handdrug');
row('auto:keptdrug|acme', 'Keptdrug'); trial('NCT00000002', 'auto:keptdrug|acme'); verdict('auto:keptdrug|acme', 'kept', '2026-11-08');
row('auto:approveddrug|acme', 'Approveddrug'); trial('NCT00000003', 'auto:approveddrug|acme'); verdict('auto:approveddrug|acme', 'approved: Approved (US)', '2026-11-07');
row('auto:queueddrug|acme', 'Queueddrug'); trial('NCT00000004', 'auto:queueddrug|acme'); verdict('auto:queueddrug|acme', 'queued: medium confidence', '2026-11-09');
row('auto:unreaddrug|acme', 'Unreaddrug'); trial('NCT00000005', 'auto:unreaddrug|acme');

const L = Q.landscape({ area: 'checkitis' });
const by = name => L.programs.find(p => p.drug === name);
ok(L.programs.length === 5, `landscape has the 5 rows (${L.programs.length})`);
ok(by('Handdrug')?.checked?.by === 'hand', 'hand-checked row: checked by hand');
ok(by('Keptdrug')?.checked?.by === 'read' && by('Keptdrug').checked.read_at === '2026-11-08' && by('Keptdrug').checked.reader === 'test', 'kept row: checked by a read, with its date and reader');
ok(by('Approveddrug')?.checked?.by === 'read', 'approved row: checked by a read');
ok(by('Queueddrug')?.checked === null, 'queued row: not checked');
ok(by('Unreaddrug')?.checked === null, 'unread row: not checked');
ok(L.stats.checked === 3, `stats.checked is 3 (${L.stats.checked})`);
ok(L.stats.read_at === '2026-11-08', `stats.read_at is the latest read among checked rows, not the queued one (${L.stats.read_at})`);
const E = Q.landscape({ area: 'zzzznothing' });
ok(E.stats.checked === 0, 'empty landscape: 0 checked');
