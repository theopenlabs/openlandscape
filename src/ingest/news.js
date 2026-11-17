// Hourly news: SEC filings for companies with a CIK (seed/sec.js). Run from deploy/hourly.sh.
//   node src/ingest/news.js
// Press-release wires (PR Newswire, Business Wire) are not used: their terms forbid it. FDA's press-release feed was
// dropped on 6 Nov 2026: it refuses requests from our server (HTTP 403).
import { pathToFileURL } from 'node:url';
import { loadFilings } from './edgar.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await loadFilings({ onProgress: () => {} });
  console.log(`--- ${new Date().toISOString()} news: SEC ${s.added} new from ${s.companies} companies`);
}
