// Checks the compare step on a throwaway database: load, snapshot, change a few trials, load again, compare.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-changes-'), 'test.db');
const { getDb } = await import('../src/db.js');
const { loadRows } = await import('../src/ingest/ctgov.js');
const { snapshot, compare } = await import('../src/ingest/changes.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const row = (nct, o = {}) => ({ trial: { nct, title: 't', status: 'RECRUITING', phase: 2, phase_label: 'Phase 2', start_date: null, primary_completion: '2027-01',
  completion: null, enrollment: 1, sponsor: 's', sponsor_class: 'INDUSTRY', collaborators: '[]', conditions: '[]', keywords: '[]', countries: '[]', n_sites: 0, last_update: null, ...o },
  interventions: [], sites: [] });

ok(compare({ release: '2026-11-05' }).skipped, 'first load without a snapshot records nothing');
loadRows([row('NCT1'), row('NCT2'), row('NCT3')]);
snapshot();
loadRows([row('NCT1', { status: 'TERMINATED' }), row('NCT2', { phase: 3, phase_label: 'Phase 3', primary_completion: '2027-06-30' }), row('NCT3'), row('NCT4')]);
const r = compare({ release: '2026-11-06' });
ok(r.counts.status === 1 && r.counts.phase === 1 && r.counts.date === 1 && r.counts.new_trial === 1, `counts ${JSON.stringify(r.counts)}`);
const st = getDb().prepare("SELECT * FROM change WHERE kind='status'").get();
ok(st.nct === 'NCT1' && st.before === 'RECRUITING' && st.after === 'TERMINATED' && st.source_url.endsWith('NCT1'), 'status change has before, after and source link');
compare({ release: '2026-11-06' });
ok(getDb().prepare("SELECT count(*) FROM change WHERE date='2026-11-06'").pluck().get() === 4, 're-running the same release does not duplicate rows');

// The words for a drug's moved completion dates: one way says which way; mixed keeps both counts (feed and email).
{
  const { movesText } = await import('../src/query.js');
  const { changeWords } = await import('../src/mailhtml.js');
  const mv = (...d) => d.map(days => ({ days }));
  ok(movesText(mv(40, 90, 200)) === '3 trial completion dates moved later', `all later: ${movesText(mv(40, 90, 200))}`);
  ok(movesText(mv(-40, -90, -200)) === '3 trial completion dates moved earlier', `all earlier: ${movesText(mv(-40, -90, -200))}`);
  const mixed = movesText(mv(40, 90, -60));
  ok(mixed === '3 trial completion dates moved (2 later, 1 earlier)', `mixed: ${mixed}`);
  const w = t => changeWords({ kind: 'date', drug: 'X', text: t, date: '2026-11-06' }).what;
  ok(w(mixed) === '3 trial completion dates moved, 2 later and 1 earlier' && w(movesText(mv(-40, -90))) === '2 trial completion dates moved earlier', `email: "${w(mixed)}" / "${w(movesText(mv(-40, -90)))}"`);
}
