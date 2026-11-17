// Target-only pass (scripts/target-pass.mjs): answers go into the target and target_trial fields of the seed lines
// and change nothing else; a target whose trial is not the row's becomes "unknown".
import { tempDir } from './tmp.js';
import { join } from 'node:path';
import { needsChecked } from './private.js';
needsChecked('the target pass and its reading packets');
process.env.DB_PATH = join(tempDir('ol-targets-'), 'test.db');
const { getDb } = await import('../src/db.js');
const { storeTargets } = await import('../scripts/target-pass.mjs');
const { targetPacketBuilder } = await import('../scripts/packet-lib.mjs');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const seed = [
  'drug,company,trials,verdict,confidence,duplicate_of,reason,evidence,approval_label,approval_source,read_at,reader,target,target_trial',
  'ACM-001,"Acme, Inc.",NCT00000001:acm001,right,high,,Rule row.,,,,2026-11-09,rule-1,,',
  'ACM-002,Acme,NCT00000002:acm002,stage,medium,,"Approved, ""maybe"".",NCT00000002,,,2026-11-08,reader,,',
  'ACM-003,Acme,NCT00000003:acm003,right,high,,Late row.,NCT00000003,,,2026-11-08,reader,,',
  'ACM-004,Acme,NCT00000004:acm004,right,high,,Already asked.,NCT00000004,,,2026-11-10,reader,HER2,NCT00000004',
  'ACM-005,Acme,NCT00000005:acm005,right,high,,Not asked.,,,,2026-11-09,rule-1,,',
  '',
].join('\n');
const rows = [
  { row_id: 'a1', drug: 'ACM-001', company: 'Acme, Inc.', trials: 'NCT00000001' },
  { row_id: 'a2', drug: 'ACM-002', company: 'Acme', trials: 'NCT00000002 NCT00000009' },
  { row_id: 'a3', drug: 'ACM-003', company: 'Acme', trials: 'NCT00000003' },
  { row_id: 'a4', drug: 'ACM-004', company: 'Acme', trials: 'NCT00000004' },
];
const answers = [
  { row_id: 'a1', target: 'PD-1, PD-L1', target_trial: 'NCT00000001' },
  { row_id: 'a2', target: 'GLP-1 + GIP', target_trial: 'NCT00000009' },
  { row_id: 'a3', target: 'IL-23', target_trial: 'NCT00000077' },
  { row_id: 'a4', target: 'CD19', target_trial: 'NCT00000004' },
  { row_id: 'zz', target: 'CD20', target_trial: 'NCT00000001' },
];
const r = storeTargets(seed, rows, answers);
const before = seed.split('\n'), after = r.text.split('\n');
ok(after.length === before.length && after[0] === before[0], 'same number of lines, header unchanged');
ok(after[1] === 'ACM-001,"Acme, Inc.",NCT00000001:acm001,right,high,,Rule row.,,,,2026-11-09,rule-1,"PD-1, PD-L1",NCT00000001', 'a target with a comma is quoted; the rest of the line is unchanged');
ok(after[2] === before[2].slice(0, -2) + ',GLP-1 + GIP,NCT00000009', 'any of the row\'s trials may carry the target; the quoted reason stays byte for byte');
ok(after[3].endsWith(',unknown,') && after[3].startsWith(before[3].slice(0, -2)), 'a target from a trial that is not the row\'s becomes unknown');
ok(after[4] === before[4], 'a line that already has a target is not changed');
ok(after[5] === before[5], 'a line with no answer is not changed');
ok(r.stored === 3 && r.unknown === 1 && r.moved === 1 && r.notEmpty === 1 && r.missing === 1, `counts (${JSON.stringify({ stored: r.stored, unknown: r.unknown, moved: r.moved, notEmpty: r.notEmpty, missing: r.missing })})`);
const cols = l => l.split(',').length;
ok(after.slice(1, 5).every((l, i) => l.slice(0, 40) === before[i + 1].slice(0, 40)) && cols(after[4]) === cols(before[4]), 'verdict, confidence, reader and read_at untouched');

const db = getDb();
db.prepare("INSERT INTO program (id, name, aliases, company, company_ids, mechanism) VALUES ('p1','ACM-001',?, 'Acme','[]','Secret mechanism')").run(JSON.stringify([{ name: 'acmezumab' }]));
db.prepare("INSERT INTO trial (nct, title, summary, phase, status) VALUES ('NCT00000001','A trial of ACM-001',?,2,'RECRUITING')").run('An anti-PD-1 antibody. ' + 'word '.repeat(150));
db.prepare("INSERT INTO trial_program (nct, program_id, matched_on) VALUES ('NCT00000001','p1','ACM-001')").run();
db.prepare("INSERT INTO intervention (nct, type, name, other_names, description) VALUES ('NCT00000001','DRUG','ACM-001','[]','Binds PD-1'), ('NCT00000001','DRUG','Placebo','[]','Matching placebo')").run();
const pk = targetPacketBuilder(db)('p1');
ok(/^ROW p1\nName: ACM-001\nOther names: acmezumab\nCompany: Acme\n/.test(pk.text) && /Title: A trial of ACM-001/.test(pk.text) && /Intervention \[DRUG\] ACM-001 \| Binds PD-1/.test(pk.text), 'the slim packet has name, other names, company, title and interventions with descriptions');
ok(!/Mechanism|Secret|Matching placebo|POSSIBLE DUPLICATES|OTHER ROWS/.test(pk.text) && /Summary: .{400,510}…\n/.test(pk.text), 'no mechanism, placebo description, duplicates or company rows; summary cut at 500');
ok(pk.trials.join() === 'NCT00000001', 'the packet lists the row\'s trials');

// Grouping (src/targets.js, seed/target-names.csv): one name per target; spellings and real other names merge, nothing else.
const { buildGroups, groupsOf, splitTarget, targetKey } = await import('../src/targets.js');
const { parseCsv } = await import('../src/scoreboard.js');
const { readFileSync } = await import('node:fs');
const sample = ['GPC-3', 'GPC3', 'PD-1', 'PD1', 'c-Met', 'cMET', 'MET', 'Bcl-2', 'BCL2', 'CLDN18.2', 'Claudin 18.2', 'GLP-1 receptor', 'GLP-1R', 'GLP-1',
  'PI3Kα', 'PI3K alpha', 'PI3Kδ', 'TNF-α', 'TNF-alpha', 'TNF', 'IL-2 β/γ', 'IL-2', 'EGFR + c-Met', 'BCMA x CD3', 'unknown', ''];
const G = buildGroups(sample), one = t => groupsOf(G, t).map(g => g.name).join(' + ');
const same = (a, b) => groupsOf(G, a)[0] === groupsOf(G, b)[0];
ok(same('GPC-3', 'GPC3') && same('PD-1', 'PD1') && same('Bcl-2', 'BCL2') && same('c-Met', 'cMET') && same('MET', 'c-Met'), 'case, hyphens, spaces and dots are ignored; c-Met is MET');
ok(same('Claudin 18.2', 'CLDN18.2') && same('GLP-1 receptor', 'GLP-1') && same('GLP-1R', 'GLP-1') && same('PI3Kα', 'PI3K alpha'), 'real other names from the hand list');
ok(!same('PI3Kα', 'PI3Kδ') && !same('TNF-α', 'TNF') && same('TNF-α', 'TNF-alpha') && !same('IL-2 β/γ', 'IL-2'), 'different targets stay apart (PI3Kα/PI3Kδ, TNF-α/TNF, IL-2 β/γ/IL-2)');
ok(one('EGFR + c-Met') === 'EGFR + MET' && one('BCMA x CD3') === 'BCMA + CD3' && one('unknown') === '' && splitTarget('') .length === 0, 'combinations split into their parts; unknown adds nothing');
ok(one('Claudin 18.2') === 'CLDN18.2' && one('GLP-1R') === 'GLP-1', 'the hand list names the group');
const names = parseCsv(readFileSync(new URL('../seed/target-names.csv', import.meta.url), 'utf8'));
const heads = new Set(names.map(n => targetKey(n.target)));
ok(names.every(n => n.target && n.same_as && (!heads.has(targetKey(n.same_as)) || targetKey(n.same_as) === targetKey(n.target))), 'hand list: every line has both names, and no other name is itself a group name (no chains)');
const real = buildGroups(parseCsv(readFileSync(new URL('../seed/row-verdicts.csv', import.meta.url), 'utf8')).map(r => r.target));
ok(new Set(real.byKey.values()).size === real.bySlug.size, `stored targets: every group has its own page address (${real.bySlug.size} groups)`);

// Wiring (src/query.js): the stored target joins the row's targets, search finds the row by it, and it has a target page.
db.prepare("INSERT INTO row_verdict (name_key, company_key, drug, company, verdict, target, target_trial, program_id, action) VALUES ('acm001','acme inc','ACM-001','Acme, Inc.','right','PD-1 + Claudin 18.2','NCT00000001','p1','kept')").run();
db.prepare("INSERT INTO program (id, name, aliases, company, company_ids) VALUES ('p2','ACM-009','[]','Acme','[]')").run();
db.prepare("INSERT INTO row_verdict (name_key, company_key, drug, company, verdict, target, program_id, action) VALUES ('acm009','acme','ACM-009','Acme','right','unknown','p2','kept')").run();
const Q = await import('../src/query.js');
ok(JSON.stringify(Q.drug('p1').targets) === JSON.stringify([{ id: 'pd-1', name: 'PD-1' }, { id: 'cldn18.2', name: 'CLDN18.2' }]), 'a drug row lists its stored targets, grouped');
ok(Q.drug('p1').mechanism === 'Secret mechanism' && Q.drug('p2').targets.length === 0, 'the mechanism is unchanged; "unknown" adds no target');
ok(Q.landscape({ area: 'PD-1' }).programs.some(p => p.id === 'p1') && Q.landscape({ area: 'claudin 18.2' }).programs.some(p => p.id === 'p1'), 'search by target finds the row, by any spelling of the group');
ok(Q.target('cldn18.2')?.landscape.programs.some(p => p.id === 'p1') && Q.target('nope') === null, 'a stored target has a page that lists the row');

// FDA drug class (seed/fda-class-targets.csv): a class that names one target gives the drug that target; others give none.
const { FDA_CLASS_TARGETS } = await import('../src/targets.js');
ok(FDA_CLASS_TARGETS.get('interleukin-23 antagonist') === 'IL-23' && !FDA_CLASS_TARGETS.has('kinase inhibitor') && [...FDA_CLASS_TARGETS.values()].every(Boolean), 'class list: IL-23 antagonists are IL-23; "Kinase Inhibitor" names no target');
db.prepare("INSERT INTO fda_class (ingredient, epc) VALUES ('GUSELKUMAB','Interleukin-23 Antagonist'), ('USTEKINUMAB','Interleukin-12 Antagonist; Interleukin-23 Antagonist'), ('IMATINIB MESYLATE','Kinase Inhibitor')").run();
db.prepare("INSERT INTO program (id, name, aliases, company, company_ids) VALUES ('g1','Guselkumab','[]','Janssen','[]'), ('u1','Ustekinumab','[]','Janssen','[]'), ('i1','imatinib','[]','Novartis','[]')").run();
const { meta } = await import('../src/db.js');
meta.set('fda_last_updated', 'test ' + Date.now());
ok(JSON.stringify(Q.drug('g1').targets) === '[{"id":"il-23","name":"IL-23"}]' && Q.drug('u1').targets.map(t => t.name).join() === 'IL-12,IL-23', 'a drug gets the target its FDA class names (both, for a drug in two classes)');
ok(Q.drug('i1').targets.length === 0 && Q.target('il-23')?.name === 'IL-23', 'a class that names no target adds none; the class target has a page');

// Official-list targets (seed/list-targets.csv): matched by the row's name or other name and its company.
const { LIST_TARGETS } = await import('../src/targets.js');
ok(LIST_TARGETS.every(l => l.drug && l.company && l.target && /^https:\/\//.test(l.source_url) && l.evidence), 'list targets: every line has drug, company, target, source link and the words the list uses');
db.prepare("INSERT INTO program (id, name, aliases, company, company_ids) VALUES ('ic1','JNJ-77242113',?,'Janssen Research & Development, LLC','[]'), ('ic2','Icotrokinra','[]','Other Pharma','[]')").run(JSON.stringify([{ name: 'Icotrokinra' }]));
meta.set('fda_last_updated', 'test2 ' + Date.now());
ok(Q.drug('ic1').targets.map(t => t.name).join() === 'IL-23' && Q.drug('ic2').targets.length === 0, 'a list target reaches the row by another name and company; IL-23R is grouped with IL-23; another company\'s row gets none');

// Several companies' rows with one drug name: each list line reaches only its own company's row.
LIST_TARGETS.push({ drug: 'ACM-777', company: 'Acme Bio', target: 'DLL3 + CD3' }, { drug: 'ACM-777', company: 'Beta Pharma', target: 'PD-L1' });
db.prepare("INSERT INTO program (id, name, aliases, company, company_ids) VALUES ('s1','ACM-777','[]','Acme Bio Inc.','[]'), ('s2','ACM-777','[]','Beta Pharma Co','[]'), ('s3','ACM-777','[]','Gamma','[]')").run();
meta.set('fda_last_updated', 'test3 ' + Date.now());
ok(Q.drug('s1').targets.map(t => t.name).join() === 'DLL3,CD3' && Q.drug('s2').targets.map(t => t.name).join() === 'PD-L1' && Q.drug('s3').targets.length === 0, 'two list lines with one drug name each reach their own company\'s row');

// Storing official-list answers (scripts/list-targets.mjs): only targets whose evidence is the list's own words become lines.
const { gsrsTargets, storeLines, packetText } = await import('../scripts/list-targets.mjs');
ok(gsrsTargets({ relationships: [{ type: 'TARGET->INHIBITOR', relatedSubstance: { name: 'INTERLEUKIN-23 RECEPTOR' } }, { type: 'ACTIVE MOIETY', relatedSubstance: { name: 'X' } }] }).join() === 'TARGET->INHIBITOR: INTERLEUKIN-23 RECEPTOR' && gsrsTargets(null).length === 0, 'GSRS: only TARGET relationships are kept');
const lrows = [
  { row_id: 'r1', drug: 'AMG 757', company: 'Amgen', gsrs: { id: '74X82ST8Q1', name: 'Tarlatamab' }, nci: { id: '792376', slug: 'tarlatamab', name: 'tarlatamab' } },
  { row_id: 'r2', drug: 'ABC-1', company: 'Acme, Inc.', gsrs: null, nci: { id: '1', slug: 'abc-1', name: 'ABC-1' } },
  { row_id: 'r3', drug: 'Icotrokinra', company: 'Janssen', gsrs: { id: 'MUW8FP7HNZ', name: 'Icotrokinra' }, nci: null },
];
const ldet = new Map([
  ['gsrs|74X82ST8Q1', { targets: ['TARGET->ACTIVATOR: .DELTA.-LIKE PROTEIN 3', 'TARGET->ACTIVATOR: T-CELL SURFACE GLYCOPROTEIN CD3 EPSILON CHAIN'] }],
  ['nci|792376', { definition: 'A BiTE antibody directed against the tumor-associated antigen (TAA) delta-like protein 3 (DLL3) and CD3.' }],
  ['nci|1', { definition: 'A small molecule inhibitor of the kinase FOO, with potential antineoplastic activity.' }],
  ['gsrs|MUW8FP7HNZ', { targets: ['TARGET->INHIBITOR: INTERLEUKIN-23 RECEPTOR'] }],
]);
ok(/^ROW r1\nName: AMG 757\nGSRS \(Tarlatamab\): TARGET->ACTIVATOR: \.DELTA\.-LIKE PROTEIN 3; .*\nNCI \(tarlatamab\): A BiTE/.test(packetText(lrows[0], ldet)) && packetText({ row_id: 'x', drug: 'X', gsrs: null, nci: null }, ldet) === null, 'reader packet: both entries, or none when a list says nothing');
const lseed = 'drug,company,target,source,source_url,evidence\nIcotrokinra,Janssen,IL-23R,FDA substance registry (GSRS),https://gsrs.ncats.nih.gov/ginas/app/beta/substances/MUW8FP7HNZ,TARGET->INHIBITOR: INTERLEUKIN-23 RECEPTOR\n';
const ls = storeLines(lseed, lrows, ldet, [
  { row_id: 'r1', target: 'DLL3 + CD3', source: 'gsrs', evidence: 'TARGET->ACTIVATOR: .delta.-like protein 3' },
  { row_id: 'r2', target: 'FOO', source: 'nci', evidence: 'inhibitor of the kinase BAR' },
  { row_id: 'r3', target: 'IL-23R', source: 'gsrs', evidence: 'TARGET->INHIBITOR: INTERLEUKIN-23 RECEPTOR' },
  { row_id: 'zz', target: 'CD20', source: 'nci', evidence: 'x' },
]);
const lout = ls.text.split('\n');
ok(lout[0] + '\n' + lout[1] + '\n' === lseed && lout[2] === 'AMG 757,Amgen,DLL3 + CD3,FDA substance registry (GSRS),https://gsrs.ncats.nih.gov/ginas/app/beta/substances/74X82ST8Q1,TARGET->ACTIVATOR: .delta.-like protein 3' && lout.length === 4, 'a quoted target is added with source and link; existing lines stay');
ok(ls.added === 1 && ls.notQuoted === 1 && ls.have === 1 && ls.missing === 1, `words not in the list, a drug already listed and unknown rows add nothing (${JSON.stringify({ added: ls.added, notQuoted: ls.notQuoted, have: ls.have, missing: ls.missing })})`);
