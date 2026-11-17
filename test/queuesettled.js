// The review queue settled on 11 Nov 2026: the decisions live in the
// seed files, so they survive every reload. Checks that no settled verdict line would be queued again, and that the
// drug-pair decisions are well formed.
import { readSeed } from '../src/ingest/verdicts.js';
import { DRUG_DECISIONS } from '../seed/drug-decisions.js';
import { needsChecked } from './private.js';
needsChecked('the settled review queue');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const settled = r => r === 'lush' || r.endsWith('-web-check');   // settled by a person or by the web check

const lines = readSeed().filter(v => settled(v.reader));
ok(lines.length > 0, `${lines.length} verdict lines settled by the web check or by a person`);
ok(lines.every(v => v.confidence === 'high'), 'every settled verdict line is high confidence, so it is acted on, not queued');
ok(lines.filter(v => v.verdict === 'duplicate').every(v => v.duplicate_of), 'every settled duplicate names the row to keep');
ok(lines.filter(v => v.approval_label).every(v => v.verdict === 'stage' && /^https?:\/\//.test(v.approval_source)), 'every settled approval has a source link');

const ids = new Set();
let bad = 0, twice = 0;
for (const d of DRUG_DECISIONS) {
  if (!['same', 'apart', 'comparator'].includes(d[2]) || (d[2] === 'comparator' && !d.slice(0, 2).includes(d[3]))) bad++;
  const k = [d[0], d[1]].sort().join('|');
  if (ids.has(k)) twice++; ids.add(k);
}
ok(bad === 0, 'every drug-pair decision is same, apart or comparator (comparator names one side to drop)');
ok(twice === 0, 'no drug pair is decided twice');
