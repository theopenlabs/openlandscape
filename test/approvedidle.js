// Approved-looking rows with no active trial (scripts/approved-idle.mjs), on a throwaway database: one row for each group.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-approvedidle-'), 'test.db');
const { getDb } = await import('../src/db.js');
const { approvedIdle } = await import('../scripts/approved-idle.mjs');
const { treats } = await import('../src/query.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
let n = 0;
function row(name, company, { status = 'COMPLETED', cls = 'INDUSTRY', end = '2020-01', label = null } = {}) {
  const id = `auto:${name}|${company}`, nct = 'NCT' + String(++n).padStart(8, '0');
  db.prepare("INSERT INTO program (id, name, aliases, company, company_ids, curated, status_label) VALUES (?,?,'[]',?,'[]',0,?)").run(id, name, company, label);
  db.prepare('INSERT INTO trial (nct, status, sponsor, sponsor_class, primary_completion) VALUES (?,?,?,?,?)').run(nct, status, company, cls, end);
  db.prepare('INSERT INTO trial_program (nct, program_id) VALUES (?,?)').run(nct, id);
}
const fda = db.prepare('INSERT INTO fda_approval (appl_no, brand, ingredient, sponsor, approval_date) VALUES (?,?,?,?,?)');
fda.run('N1', 'Ownbrand', 'ownumab', 'ACME PHARMS', '2022-01-01');
fda.run('N2', 'Oldpill', 'oldamine', 'BIGCO', '1990-01-01');
fda.run('N3', 'Newpill', 'newinib', 'OTHERCO', '2021-01-01');
fda.run('N4', 'Zoladex', 'goserelin', 'TERSERA', '2019-01-01');

row('Ownbrand', 'Acme Pharmaceuticals', { end: '2026-03' });
row('labelled', 'Zeta Bio', { label: 'FDA-approved (any use)' });
row('oldamine', 'Hamad Medical Corporation', { cls: 'OTHER' });
row('oldamine', 'Acme Pharmaceuticals');
row('newinib', 'Licensee Ltd');
row('Zoladex', 'AstraZeneca');
row('plainname', 'Acme Pharmaceuticals');
row('Ownbrand', 'Busy Bio', { status: 'RECRUITING' });

const { idle, rows } = approvedIdle(db, '2026-11-10');
const by = Object.fromEntries(rows.map(r => [`${r.name}|${r.company}`, r]));
ok(idle === 7 && rows.length === 6, `rows with an active trial are left out, and so are rows with no approval (${idle} idle, ${rows.length} look approved)`);
ok(by['Ownbrand|Acme Pharmaceuticals']?.group === 'own', 'the approval holder is the company: own');
ok(by['labelled|Zeta Bio']?.group === 'own', 'the linker\'s "FDA-approved (any use)": own');
ok(by['oldamine|Hamad Medical Corporation']?.group === 'other', 'a hospital\'s trials: someone else\'s drug');
ok(by['oldamine|Acme Pharmaceuticals']?.group === 'other', 'an old drug another company holds: someone else\'s drug');
ok(by['newinib|Licensee Ltd']?.group === 'unclear', 'a recent drug another company holds: unclear');
ok(by['Zoladex|AstraZeneca']?.group === 'own', 'a brand the company sells outside the US (PARTNER): own');
ok(by['Ownbrand|Acme Pharmaceuticals']?.recent === true && by['oldamine|Acme Pharmaceuticals']?.recent === false, 'finished in the last 2 years');
ok(by['Ownbrand|Acme Pharmaceuticals']?.appls === 'N1' && by['oldamine|Acme Pharmaceuticals']?.appls === '', 'own rows carry their approval number, for the label');
const alunbrig = 'ALUNBRIG is indicated for the treatment of adult patients with ALK-positive metastatic non-small cell lung cancer (NSCLC).';
const qsymia = 'QSYMIA is indicated as an adjunct to a reduced-calorie diet and increased physical activity for chronic weight management in adults with obesity.';
const lipitor = 'LIPITOR is indicated to reduce the risk of MI and stroke and as an adjunct to diet to reduce LDL-C.';
ok(treats(alunbrig, 'non-small cell lung cancer') && treats(qsymia, 'obesity'), 'a label that names the disease: joins');
ok(!treats(lipitor, 'obesity') && !treats(null, 'obesity') && !treats(alunbrig, 'small cell lung cancer'), 'a label for another disease, or none: stays out');

// The list: an own approved drug with no active trial shows as approved when its label names the disease, and not otherwise.
const { landscape } = await import('../src/query.js');
db.prepare("UPDATE trial SET conditions = '[\"Obesity\"]', title = 'A study in obesity', phase = 3").run();
db.prepare("INSERT INTO fda_label (appl_no, set_id, indications) VALUES ('N1', 'set-1', ?), ('N2', 'set-2', ?)").run(qsymia, lipitor);
db.prepare("INSERT INTO program_label (program_id, appl_no) VALUES ('auto:Ownbrand|Acme Pharmaceuticals', 'N1'), ('auto:oldamine|Acme Pharmaceuticals', 'N2')").run();
const L = landscape({ area: 'obesity', phase_min: 2 }), shown = new Map(L.programs.map(p => [p.id, p]));
const own = shown.get('auto:Ownbrand|Acme Pharmaceuticals');
ok(own?.phase.label === 'Approved (US)' && own.phase.source.includes('set-1') && !own.in_active_trials, 'label names the disease: in the list as approved, sourced to the label');
ok(!shown.has('auto:oldamine|Acme Pharmaceuticals') && !shown.has('auto:newinib|Licensee Ltd'), 'label for another disease, or no label: not in the list');
ok(shown.has('auto:Ownbrand|Busy Bio'), 'drugs in active trials are listed as before');
