// Checks how SEC filings are sorted into deals, share sales, offerings and plain reports.
import { classify } from '../src/ingest/edgar.js';
import { filingText } from '../src/query.js';
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
ok(classify('8-K', '1.01,2.03,9.01') === 'deal' && classify('8-K', '3.02') === 'share_sale' && classify('8-K', '5.07') === 'filing', '8-K items: 1.01 deal, 3.02 share sale, others plain');
ok(classify('6-K', '') === 'filing' && classify('424B5', '') === 'offering' && classify('S-1/A', '') === 'offering' && classify('10-Q', '') === null, '6-K plain, 424B/S-1 offering, 10-Q skipped');
ok(filingText({ form: '8-K', items: '1.01,9.01', kind: 'deal' }) === '8-K: material agreement (item 1.01)', 'filing wording names the items');
