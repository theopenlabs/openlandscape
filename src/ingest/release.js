// ClinicalTrials.gov publishes one data release each weekday and stamps it at /api/v2/version ("dataTimestamp").
//   node src/ingest/release.js check  -> exit 0 if there is a release we have not loaded yet (saved as pending), else exit 3
//   node src/ingest/release.js done   -> mark the pending release as loaded
// deploy/hourly.sh runs "check" every hour and loads the data only when it says so.
import { meta } from '../db.js';

const cmd = process.argv[2];
if (cmd === 'check') {
  const res = await fetch('https://clinicaltrials.gov/api/v2/version', { headers: { 'User-Agent': 'OpenLandscape-loader/0.1' } });
  if (!res.ok) { console.error(`version check failed: HTTP ${res.status}`); process.exit(3); }
  const { dataTimestamp } = await res.json();
  meta.set('ctgov_checked_at', new Date().toISOString());
  if (!dataTimestamp || dataTimestamp === meta.get('ctgov_release')) process.exit(3);
  meta.set('ctgov_release_pending', dataTimestamp);
  console.log(`New ClinicalTrials.gov release: ${dataTimestamp}`);
} else if (cmd === 'done') {
  const pending = meta.get('ctgov_release_pending');
  if (pending) meta.set('ctgov_release', pending);
  meta.set('ctgov_release_loaded_at', new Date().toISOString());
  console.log(`Loaded release ${pending}`);
}
