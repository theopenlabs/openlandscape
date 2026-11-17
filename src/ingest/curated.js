// Hand-checked areas: load every ClinicalTrials.gov trial that names a hand-checked drug, even when the main load
// (ctgov.js) leaves it out: sponsor registered as "Other" (e.g. Junshi), "Early Phase 1", or gene-therapy
// interventions (most in vivo CAR-T). Only for seed files with `registrySearch = true`.
// A trial is kept only if the drug's owner is its sponsor or a named collaborator, the same rule link.js applies.
//   node src/ingest/curated.js
import { FIELDS, toRow, loadRows } from './ctgov.js';
import { meta } from '../db.js';
import { SEEDS } from '../../seed/index.js';

const kept = new Map();
let searched = 0;
for (const s of SEEDS.filter(s => s.registrySearch)) {
  const pats = Object.fromEntries(s.companies.map(([id, , , , p]) => [id, p]));
  for (const [name, cos, aliases] of s.drugs) {
    const owners = cos.flatMap(c => pats[c] || []);
    const terms = [name, ...aliases.filter(a => !a.endsWith('?')).map(a => a.replace(/^~/, ''))];
    for (const term of terms) {
      let token = null;
      do {
        const u = new URL('https://clinicaltrials.gov/api/v2/studies');
        u.searchParams.set('query.intr', `"${term}"`);
        u.searchParams.set('fields', FIELDS);
        u.searchParams.set('pageSize', '1000');
        if (token) u.searchParams.set('pageToken', token);
        const res = await fetch(u, { headers: { 'User-Agent': 'OpenLandscape-loader/0.1' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} searching "${term}"`);
        const body = await res.json();
        searched++;
        for (const st of body.studies || []) {
          // Same as the main load: no phase-less studies (long-term follow-up, "Not applicable").
          const phases = (st.protocolSection.designModule?.phases || []).filter(p => p !== 'NA');
          if (!phases.length) continue;
          const sp = st.protocolSection.sponsorCollaboratorsModule || {};
          const who = [sp.leadSponsor?.name, ...(sp.collaborators || []).map(c => c.name)].map(x => String(x || '').toLowerCase());
          if (who.some(w => owners.some(p => w.includes(p)))) kept.set(st.protocolSection.identificationModule.nctId, st);
        }
        token = body.nextPageToken;
      } while (token);
    }
  }
}
loadRows([...kept.values()].map(toRow));
meta.set('curated_trials_loaded_at', new Date().toISOString());
console.log(`Hand-checked drugs: ${searched} registry searches, ${kept.size} owner-run trials loaded`);
