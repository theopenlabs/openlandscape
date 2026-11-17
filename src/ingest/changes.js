// Compares two registry loads and writes what changed to the `change` table.
//   node src/ingest/changes.js snapshot   -> before the load: copy the key fields of every trial and catalyst
//   node src/ingest/changes.js compare    -> after the load (and link.js): write the differences
// The first run on a fresh database has no snapshot, so it records nothing rather than 40,000 "new trials".
import { getDb, meta } from '../db.js';

const ctgov = nct => `https://clinicaltrials.gov/study/${nct}`;

export function snapshot() {
  getDb().exec(`
    DROP TABLE IF EXISTS trial_snapshot;
    CREATE TABLE trial_snapshot AS SELECT nct, status, phase, phase_label, primary_completion FROM trial;
    DROP TABLE IF EXISTS catalyst_snapshot;
    CREATE TABLE catalyst_snapshot AS SELECT drug_id, date, what, source_url FROM catalyst;`);
}

// release: the registry release date (YYYY-MM-DD) the new load came from.
export function compare({ release }) {
  const db = getDb();
  const has = db.prepare("SELECT count(*) FROM sqlite_master WHERE name='trial_snapshot'").pluck().get();
  if (!has || !db.prepare('SELECT count(*) FROM trial_snapshot').pluck().get()) return { skipped: 'no snapshot' };
  const ins = db.prepare('INSERT INTO change (date, kind, nct, program_id, field, before, after, source_url) VALUES (?,?,?,?,?,?,?,?)');
  const counts = { new_trial: 0, phase: 0, status: 0, date: 0, catalyst: 0 };
  const add = (kind, nct, program, field, before, after, url) => { ins.run(release, kind, nct, program, field, before ?? null, after ?? null, url); counts[kind]++; };
  db.transaction(() => {
    // Same release loaded twice (e.g. a manual re-run): replace, don't duplicate.
    db.prepare('DELETE FROM change WHERE date=? AND kind IN (\'new_trial\',\'phase\',\'status\',\'date\',\'catalyst\')').run(release);
    const rows = db.prepare(`SELECT t.nct, t.status, t.phase, t.phase_label, t.primary_completion,
        s.nct AS old, s.status AS s_status, s.phase AS s_phase, s.phase_label AS s_label, s.primary_completion AS s_pc
      FROM trial t LEFT JOIN trial_snapshot s ON s.nct = t.nct`).all();
    for (const r of rows) {
      if (!r.old) { add('new_trial', r.nct, null, null, null, r.phase_label, ctgov(r.nct)); continue; }
      if ((r.phase || 0) !== (r.s_phase || 0)) add('phase', r.nct, null, 'phase', r.s_label, r.phase_label, ctgov(r.nct));
      if (r.status !== r.s_status) add('status', r.nct, null, 'status', r.s_status, r.status, ctgov(r.nct));
      if ((r.primary_completion || '') !== (r.s_pc || '')) add('date', r.nct, null, 'primary_completion', r.s_pc, r.primary_completion, ctgov(r.nct));
    }
    const fresh = db.prepare(`SELECT c.* FROM catalyst c WHERE NOT EXISTS
      (SELECT 1 FROM catalyst_snapshot s WHERE s.drug_id=c.drug_id AND s.date IS c.date AND s.what IS c.what)`).all();
    for (const c of fresh) add('catalyst', null, c.drug_id, 'catalyst', null, `${c.date}: ${c.what}`, c.source_url);
  })();
  meta.set('last_compare', JSON.stringify({ release, at: new Date().toISOString(), counts }));
  return { release, counts };
}

const cmd = process.argv[2];
if (cmd === 'snapshot') { snapshot(); console.log('Snapshot taken'); }
else if (cmd === 'compare') {
  const release = (process.argv[3] || meta.get('ctgov_release_pending') || new Date().toISOString()).slice(0, 10);
  console.log(JSON.stringify(compare({ release })));
}
