// Loads US approvals from openFDA's Drugs@FDA bulk file (no key needed).
// Downloads the file if missing, keeps one row per (application, ingredient, brand) with its original approval date.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDb, meta } from '../db.js';

const DIR = new URL('../../data/raw/openfda/', import.meta.url).pathname;
const FILE = DIR + 'drug-drugsfda-0001-of-0001.json';

if (!existsSync(FILE)) {
  mkdirSync(DIR, { recursive: true });
  execFileSync('curl', ['-sSfo', DIR + 'drugsfda.zip', 'https://download.open.fda.gov/drug/drugsfda/drug-drugsfda-0001-of-0001.json.zip']);
  execFileSync('unzip', ['-o', '-q', DIR + 'drugsfda.zip', '-d', DIR]);
}

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const db = getDb();
// epc: FDA's "established pharmacologic class" from the label (e.g. "Sodium-Glucose Cotransporter 2 Inhibitor"), used to explain the drug.
const ins = db.prepare('INSERT OR IGNORE INTO fda_approval (appl_no, brand, ingredient, sponsor, approval_date, appl_type, epc) VALUES (?,?,?,?,?,?,?)');
let n = 0;
db.transaction(() => {
  db.exec('DELETE FROM fda_approval');
  for (const a of data.results) {
    if (!/^(NDA|BLA)/.test(a.application_number)) continue; // skip generics (ANDA)
    const orig = (a.submissions || []).find(s => s.submission_type === 'ORIG' && s.submission_status === 'AP');
    if (!orig) continue;
    const epc = (a.openfda?.pharm_class_epc || []).map(c => c.replace(/\s*\[EPC\]$/, '')).join('; ') || null;
    const date = orig.submission_status_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    for (const p of a.products || []) {
      for (const ing of p.active_ingredients || []) {
        ins.run(a.application_number, p.brand_name, (ing.name || '').toLowerCase(), a.sponsor_name, date, a.application_number.slice(0, 3), p.active_ingredients.length === 1 ? epc : null);   // a combination's classes belong to the mix
        n++;
      }
    }
  }
})();
meta.set('fda_last_updated', data.meta.last_updated);
console.log(`Loaded ${n} approval rows (openFDA updated ${data.meta.last_updated})`);

// Drug classes from the NDC directory: Drugs@FDA has a class for only about a quarter of approvals (none for
// tofacitinib or atorvastatin); the NDC directory lists one for nearly every marketed single-ingredient product.
const NDC = DIR + 'drug-ndc-0001-of-0001.json';
if (!existsSync(NDC)) {
  execFileSync('curl', ['-sSfo', DIR + 'ndc.zip', 'https://download.open.fda.gov/drug/ndc/drug-ndc-0001-of-0001.json.zip']);
  execFileSync('unzip', ['-o', '-q', DIR + 'ndc.zip', '-d', DIR]);
}
const ndc = JSON.parse(readFileSync(NDC, 'utf8'));
const cls = new Map();
for (const r of ndc.results) {
  if ((r.active_ingredients || []).length !== 1) continue;   // a combination's classes belong to the mix
  const epc = (r.pharm_class || []).filter(c => /\[EPC\]$/.test(c)).map(c => c.replace(/\s*\[EPC\]$/, ''));
  if (epc.length) cls.set(r.active_ingredients[0].name.toLowerCase(), epc.join('; '));
}
const insC = db.prepare('INSERT INTO fda_class (ingredient, epc) VALUES (?,?)');
db.transaction(() => { db.exec('DELETE FROM fda_class'); for (const [i, e] of cls) insC.run(i, e); })();
console.log(`Loaded ${cls.size} drug classes from the NDC directory`);
