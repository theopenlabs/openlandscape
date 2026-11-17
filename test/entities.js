// Drug, company and target pages (src/entityquery.js) on a throwaway database: a search that is exactly one drug or one company
// opens its page, a disease or a type of drug stays a landscape; SEC prospectuses filed days apart fold into one offering.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-entities-'), 'test.db');
process.env.TODAY = '2026-11-06';
const { getDb } = await import('../src/db.js');
const E = await import('../src/entityquery.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
db.prepare("INSERT INTO company (id, name, country, ticker, listed, cik, sponsor_patterns) VALUES ('acme','Acme Bio','US','ACME',1,123,'[\"acme bio\"]')").run();
const drug = (id, name, nct, cond) => {
  db.prepare("INSERT INTO program (id, drug_id, name, aliases, company, company_ids, curated, mechanism) VALUES (?,?,?,?,?,?,1,'GLP-1')").run(id, id, name, JSON.stringify([{ name: id.toUpperCase() + '-1', confirmed: 1 }]), 'Acme Bio', '["acme"]');
  db.prepare("INSERT INTO trial (nct, phase, phase_label, status, title, sponsor, conditions, primary_completion) VALUES (?,3,'Phase 3','RECRUITING','A study','Acme Bio Inc.',?, '2027-06')").run(nct, JSON.stringify([cond]));
  db.prepare('INSERT INTO trial_program (nct, program_id, matched_on) VALUES (?,?,?)').run(nct, id, id);
};
drug('zorbatide', 'zorbatide', 'NCT00000001', 'Obesity');
drug('quellumab', 'quellumab', 'NCT00000002', 'Psoriasis');

ok(E.entityFor('zorbatide') === '/drugs/zorbatide', 'a drug name opens the drug page');
ok(E.entityFor('ZORBATIDE-1') === '/drugs/zorbatide', 'a drug code opens the drug page');
ok(E.entityFor('Acme Bio') === '/companies/acme', 'a company name opens the company page');
ok(E.entityFor('ACME') === '/companies/acme', 'a ticker opens the company page');
ok(E.entityFor('obesity') === null, 'a disease is a landscape search');
ok(E.entityFor('GLP-1') === null, 'a type of drug is a landscape search');
ok(E.entityFor('zorba') === null, 'part of a name is a landscape search');

for (const [acc, date, form, items, kind] of [['a', '2026-10-28', '8-K', '2.02', 'filing'], ['b', '2026-09-25', '424B5', '', 'offering'], ['c', '2026-09-25', '424B5', '', 'offering'], ['d', '2026-09-23', '424B5', '', 'offering'], ['e', '2026-02-01', '424B5', '', 'offering']])
  db.prepare('INSERT INTO filing (accession, company_id, cik, date, form, items, kind, url) VALUES (?,?,?,?,?,?,?,?)').run(acc, 'acme', 123, date, form, items, kind, 'https://www.sec.gov/');
const c = E.companyView('acme');
ok(c.L.programs.length === 2 && c.country_name === 'United States', 'company view: both drugs, headquarters in words');
ok(c.filings.length === 3, 'three filing rows: results, one offering of three prospectuses, a later offering');
ok(c.filings[1].what === 'Offered new securities' && c.filings[1].src === '3 prospectuses (424B5)' && c.filings[1].from === '2026-09-23', 'prospectuses days apart fold into one offering');
ok(c.filings[0].what === 'Reported quarterly results', 'an 8-K item in plain words');
