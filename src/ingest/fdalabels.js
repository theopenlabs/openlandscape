// What each approved drug is for: the "Indications and usage" section of its FDA label, from openFDA (no key needed).
// Fetched only for the company's own approved drugs that have no active trial (scripts/approved-idle.mjs), one request per
// application, and only for applications not fetched yet. An application with no label is stored with no text, so it is not
// asked again. openFDA allows 240 requests a minute and 1,000 a day without a key. Also rewrites program_label: which of
// those approvals belong to which drug row, so a disease list can show the row when the label names its disease (src/query.js).
// Never fails the load it ends (npm run load, deploy/hourly.sh): when openFDA cannot be reached it says so, keeps what is
// stored and asks again next time.
//   node src/ingest/fdalabels.js
import { getDb } from '../db.js';
import { approvedIdle } from '../../scripts/approved-idle.mjs';

const db = getDb(), today = new Date().toISOString().slice(0, 10);
const have = new Set(db.prepare('SELECT appl_no FROM fda_label').pluck().all());
const own = approvedIdle(db, today).rows.filter(r => r.appls);
const insP = db.prepare('INSERT OR IGNORE INTO program_label (program_id, appl_no) VALUES (?,?)');
db.transaction(() => { db.exec('DELETE FROM program_label'); for (const r of own) for (const a of r.appls.split(' ')) insP.run(r.id, a); })();
const want = [...new Set(own.flatMap(r => r.appls.split(' ')))].filter(a => !have.has(a));
const ins = db.prepare('INSERT OR REPLACE INTO fda_label (appl_no, set_id, indications, effective_time, fetched_at) VALUES (?,?,?,?,?)');
let found = 0, failed = 0;
for (const appl of want) {
  let res;
  try { res = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.application_number:"${appl}"&limit=1`, { signal: AbortSignal.timeout(30000) }); }
  catch (e) { failed++; console.error(`openFDA not reachable (${e.cause?.code || e.name}): kept the labels already stored`); break; }
  if (res.status === 404) { ins.run(appl, null, null, null, today); continue; }
  if (!res.ok) { failed++; console.error(`${appl}: HTTP ${res.status}`); if (res.status === 429) break; continue; }
  const r = (await res.json()).results?.[0];
  ins.run(appl, r?.set_id || null, (r?.indications_and_usage || []).join(' ') || null, r?.effective_time || null, today);
  if (r?.indications_and_usage) found++;
  await new Promise(ok => setTimeout(ok, 300));
}
console.log(`FDA labels: asked ${want.length}, ${found} with indications, ${failed} failed. Stored: ${have.size + want.length - failed}. Rows with a label to check: ${own.length}.`);
