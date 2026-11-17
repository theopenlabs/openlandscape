// Checks the matching rules on a throwaway database with made-up records
// shaped like the real ones: China protocol codes with full-width brackets and Roman numerals, WHO UTNs, cross-references.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-match-'), 'test.db');
const { getDb, norm } = await import('../src/db.js');
const M = await import('../src/match.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();

// ---- protocol codes ----
ok(M.normCode('UBT251-（Ⅱ-3）') === M.normCode('ubt251 (II-3)'), 'full-width brackets and Roman numerals clean to the same code');
ok(M.normCode('ＳＣＴＢ１４－Ｃ３０１') === 'SCTB14C301', 'full-width letters and digits become plain ones');
ok(!M.usableCode(M.normCode('CR-001')) && !M.usableCode(M.normCode('PIC1')) && !M.usableCode('ABCDEFG') && M.usableCode('SCTB14C301'), 'short or letter-only codes are not used for merging');
ok(JSON.stringify(M.registryIds('NCT06172478; 2026-525472-26-00; 2019-001234-56; CTR20250935; jRCT2031230001; U1111-1234-5678').map(x => x.registry))
  === JSON.stringify(['ctgov', 'ctis', 'euctr', 'cde', 'jrct']), 'registry numbers recognised; an EU CT number is not read as a EudraCT number');
ok(M.normCompany('Novo Nordisk A/S') === M.normCompany('NOVO NORDISK') && M.normCompany('Hengrui Pharmaceuticals') !== M.normCompany('Hengrui'), 'company names: legal forms dropped, other words kept');

// ---- studies ----
db.exec(`INSERT INTO company (id, name, sponsor_patterns) VALUES ('sct', 'Sinocelltech', '["sinocelltech"]'), ('ubt', 'United Biotech', '["united biotech"]'),
  ('other', 'Other Bio', '["other bio"]'), ('kailera', 'Kailera', '["kailera"]'), ('hengrui', 'Hengrui', '["hengrui"]')`);
const rec = (registry, record_id, o = {}, x = {}) => M.recordRow({ registry, record_id, title: 'A study of a drug in adults with a disease', phase: 3, start_date: '2025-03', last_updated: '2026-01-01', ...o }, x);
M.saveRecords([
  rec('ctgov', 'NCT00000001', { company_id: 'sct', protocol_code: 'SCTB14-C301' }),
  rec('cde', 'CTR20250001', { company_id: 'sct', protocol_code: 'ＳＣＴＢ１４－Ｃ３０１', title: '一项研究', title_lang: 'zh' }),          // 1. protocol code, same company
  rec('ctgov', 'NCT00000002', { company_id: 'ubt', protocol_code: 'UBT251-(II-4)' }),
  rec('cde', 'CTR20250002', { company_id: 'ubt', protocol_code: 'UBT251-（Ⅱ-4）' }),                                                   // 2. Roman numeral variant
  rec('ctgov', 'NCT00000003', { company_id: 'sct', protocol_code: 'CR-001' }),
  rec('cde', 'CTR20250003', { company_id: 'sct', protocol_code: 'CR-001' }),                                                         // 3. short code: no merge
  rec('ctgov', 'NCT00000004', { company_id: 'kailera', protocol_code: 'HRS7535-301' }),
  rec('cde', 'CTR20250004', { company_id: 'hengrui', protocol_code: 'HRS-7535-301' }),                                              // 4. same code, other company: queue
  rec('ctgov', 'NCT00000005', { company_id: 'other' }),
  rec('ctgov', 'NCT00000006', { company_id: 'other' }),
  rec('jrct', 'jRCT2031230001', { company_id: 'other' }, { xrefs: ['NCT00000005', 'NCT00000006'] }),                               // 5. lists two NCTs: one merge, one flagged
  rec('ctgov', 'NCT00000007', { company_id: 'other' }, { xrefs: ['U1111-1111-2222'] }),
  rec('ctis', '2025-520000-11-00', { company_id: 'other' }, { utn: 'U1111-1111-2222' }),                                           // 6. same WHO UTN
  rec('ctgov', 'NCT00000008', { company_id: 'ubt', protocol_code: 'UBT251-301' }),
  rec('cde', 'CTR20250008', { company_id: 'ubt', protocol_code: 'UBT251-301' }),                                                    // 7. blocked by hand
  rec('ctgov', 'NCT00000009', { company_id: 'ubt', title: 'Weekly UBT251 injection in adults with obesity', products: '[{"name":"UBT251"}]' }),
  rec('ctis', '2025-520000-99-00', { company_id: 'ubt', title: 'Weekly UBT251 injection in adults with obesity and diabetes', start_date: '2025-04', products: '[{"substance":"UBT-251"}]' }), // 8. similar only
  rec('ctgov', 'NCT00000010', { company_id: 'sct', protocol_code: 'SCTB14-C302' }),
  rec('ctgov', 'NCT00000011', { company_id: 'sct', protocol_code: 'SCTB14-C302' }),
  rec('cde', 'CTR20250010', { company_id: 'sct', protocol_code: 'SCTB14-C302' }),                                                   // 9. code used twice in one registry
  rec('ctgov', 'NCT00000012', { company_id: 'other', title: 'Unrelated title words here' }),
  rec('cde', 'CTR20250012', { company_id: 'sct', title: 'Something else entirely' }),                                               // 10. hand sameStudy
], db);
db.prepare("INSERT INTO not_same (type, a, b) VALUES ('study', 'CTR20250008', 'NCT00000008')").run();
const r = M.buildStudies({ db, sameStudy: [['NCT00000012', 'CTR20250012', 'https://example.org/hand-check']], today: '2026-11-07' });
const study = id => db.prepare('SELECT study_id FROM trial_record WHERE record_id=?').pluck().get(id);
const link = id => db.prepare('SELECT * FROM study_link WHERE record_id=?').get(id);
const cand = (a, b) => db.prepare("SELECT * FROM match_candidate WHERE type='study' AND ((left_id=? AND right_id=?) OR (left_id=? AND right_id=?))").get(a, b, b, a);
ok(study('CTR20250001') === 'NCT00000001' && link('CTR20250001').rule === 'protocol', 'China record merges with the NCT on cleaned protocol code + same company; study id is the NCT');
ok(JSON.parse(link('CTR20250001').evidence).code === 'SCTB14C301' && link('CTR20250001').decided_by === 'auto' && link('CTR20250001').date === '2026-11-07', 'merge stores rule, matched values and date');
ok(study('CTR20250002') === 'NCT00000002', 'Ⅱ-4 and II-4 merge');
ok(study('CTR20250003') !== 'NCT00000003', 'short code CR-001 does not merge');
ok(study('CTR20250004') !== 'NCT00000004' && cand('NCT00000004', 'CTR20250004'), 'same code, different company: not merged, queued for review');
const j = study('jRCT2031230001');
ok(j && [study('NCT00000005'), study('NCT00000006')].filter(s => s === j).length === 1 && cand('jRCT2031230001', j === 'NCT00000005' ? 'NCT00000006' : 'NCT00000005'),
  'a record listing two NCTs joins one; the other is flagged, never two NCTs in one study');
ok(study('2025-520000-11-00') === 'NCT00000007' && link('2025-520000-11-00').rule === 'utn', 'same WHO UTN merges');
ok(study('CTR20250008') !== 'NCT00000008' && !cand('NCT00000008', 'CTR20250008'), 'hand-checked notSameStudy blocks a protocol-code match and is not queued again');
const sim = cand('NCT00000009', '2025-520000-99-00');
ok(study('2025-520000-99-00') !== 'NCT00000009' && sim && JSON.parse(sim.reasons).rule === 'similar', 'same company, drug, phase, start and similar title: queued with a score, not merged');
ok(study('CTR20250010') === 'CTR20250010' && cand('NCT00000010', 'CTR20250010'), 'a code used by two NCTs of one company is not a study identifier: queued, not merged');
ok(study('CTR20250012') === 'NCT00000012' && link('CTR20250012').decided_by === 'hand', 'hand-checked sameStudy is applied last and wins');
const dup = db.prepare("SELECT s.study_id, l.registry, count(*) n FROM trial_record s JOIN study_link l ON l.record_id=s.record_id GROUP BY 1, 2 HAVING n > 1").all();
ok(!dup.length, 'no study holds two records of one registry');
ok(db.prepare("SELECT title FROM study WHERE id='NCT00000001'").pluck().get() === 'A study of a drug in adults with a disease', 'study title prefers the English ClinicalTrials.gov title');
console.log(`      ${JSON.stringify(r)}`);

// ---- drug names ----
db.exec(`INSERT INTO drug (id, name, companies) VALUES ('orforglipron', 'orforglipron', '["lilly"]'), ('semaglutide', 'semaglutide', '["novo"]');
  INSERT INTO drug_alias (alias_norm, alias, drug_id, source, auto) VALUES ('orforglipron', 'orforglipron', 'orforglipron', 'canonical name', 0), ('ly3502970', 'LY3502970', 'orforglipron', 'seed', 0),
  ('semaglutide', 'semaglutide', 'semaglutide', 'canonical name', 0)`);
ok(M.addAutoAlias(db, { alias: 'Foundayo', drug_id: 'orforglipron', kind: 'brand' }) === 'added', 'a brand paired by the source becomes an automatic alias');
ok(M.addAutoAlias(db, { alias: 'LY3502970', drug_id: 'semaglutide', kind: 'code' }) === 'names another drug', 'an automatic alias never joins two drugs');
db.prepare("INSERT INTO not_same (type, a, b) VALUES ('drug', ?, ?)").run(...[norm('Ozempic'), norm('orforglipron')].sort());
ok(M.addAutoAlias(db, { alias: 'Ozempic', drug_id: 'orforglipron', kind: 'brand' }) === 'blocked by hand', 'hand-checked notSameDrug blocks an automatic alias');

// ---- no contact details ----
const raw = { registry: 'cde', record_id: 'CTR20259999', title: 'Study (contact: zhang.wei@hospital.cn)', contact_name: 'Zhang Wei', contact_phone: '+86 10 1234 5678',
  contact_email: 'zhang.wei@hospital.cn', sites: [{ investigator: 'Dr Li', email: 'li@example.cn' }] };
const row = M.recordRow(raw);
ok(!Object.keys(row).some(k => /contact|phone|email|investigator|sites/.test(k)) && !JSON.stringify(row).includes('@') && !JSON.stringify(row).includes('Zhang Wei'),
  'a registry record keeps no contact names, phones or emails');
const cols = ['trial_record', 'study', 'study_link', 'regulatory_decision', 'match_candidate', 'company_alias'].flatMap(t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => `${t}.${c.name}`));
ok(!cols.some(c => /contact|phone|email|fax|investigator|address|company_rep/i.test(c)), 'no table has a column for contact details');
