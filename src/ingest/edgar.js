// SEC filings for companies with a CIK (seed/sec.js), from SEC's free submissions API. Headline facts only: form, items, date, link.
// We keep 8-Ks (item 1.01 = material agreement, i.e. a deal; 3.02 = share sale; other items = "filing"), 6-Ks (foreign
// companies; no item codes, so shown as "filing"), and offerings (S-1, F-1, 424B prospectuses).
// SEC asks for a User-Agent with contact details and at most 10 requests a second.
import { getDb } from '../db.js';

export const UA = 'OpenLandscape hello@openlandscape.app';
const SINCE = '2024-01-01';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function classify(form, items) {
  const it = String(items || '').split(',');
  if (/^8-K/.test(form)) return it.includes('1.01') ? 'deal' : it.includes('3.02') ? 'share_sale' : 'filing';
  if (/^6-K/.test(form)) return 'filing';
  if (/^(S-1|F-1|424B)/.test(form)) return 'offering';
  return null;
}

// companyIds: only these (null = all with a CIK). onProgress(line) gets one line per company.
export async function loadFilings({ companyIds = null, onProgress = () => {} } = {}) {
  const db = getDb();
  let cos = db.prepare('SELECT id, name, cik FROM company WHERE cik IS NOT NULL').all();
  if (companyIds) cos = cos.filter(c => companyIds.includes(c.id));
  const ins = db.prepare('INSERT OR IGNORE INTO filing (accession, company_id, cik, date, form, items, kind, url, description) VALUES (?,?,?,?,?,?,?,?,?)');
  let added = 0;
  for (const c of cos) {
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${String(c.cik).padStart(10, '0')}.json`, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()).filings.recent;
      let n = 0;
      db.transaction(() => {
        for (let i = 0; i < r.form.length; i++) {
          if (r.filingDate[i] < SINCE) continue;
          const kind = classify(r.form[i], r.items[i]);
          if (!kind) continue;
          const acc = r.accessionNumber[i];
          const url = `https://www.sec.gov/Archives/edgar/data/${c.cik}/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}`;
          n += ins.run(acc, c.id, c.cik, r.filingDate[i], r.form[i], r.items[i] || null, kind, url, r.primaryDocDescription[i] || null).changes;
        }
      })();
      added += n;
      onProgress(`SEC filings for ${c.name}: ${n} new`);
    } catch (e) { onProgress(`SEC filings for ${c.name}: could not check (${e.message})`); }
    await sleep(150);
  }
  return { companies: cos.length, added };
}
