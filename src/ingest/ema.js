// EU decisions from EMA's medicines file, rebuilt every morning (about 06:00 UTC). Human medicines only.
//   node src/ingest/ema.js [--daily] [--since YYYY-MM-DD]
// Each date in the file is one decision: CHMP opinion (positive -> opinion, negative -> rejection), European Commission
// marketing authorisation (approval), refusal (rejection), application withdrawn (withdrawal), start of evaluation or
// rolling review (filing). A decision we have not stored before is new since yesterday's file.
// Terms: EMA's legal notice allows commercial reuse with attribution; every row links the medicine's EMA page.
import { pathToFileURL } from 'node:url';
import { decisionWriter, dueToday, sinceArg, clip, decode } from './decisions.js';

export const URL_EMA = 'https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json';
const UA = 'OpenLandscape/0.1 (+https://openlandscape.app; hello@openlandscape.app)';
const iso = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// One medicine row -> its decisions (pure, so tests can feed it rows).
export function emaDecisions(m) {
  if (m.category !== 'Human') return [];
  const name = decode(m.name_of_medicine).trim(), inn = decode(m.international_non_proprietary_name_common_name || m.active_substance).trim();
  const own = m.generic !== 'Yes' && m.biosimilar !== 'Yes';   // generics and biosimilars are other companies' copies: stored, never matched
  const base = { agency: 'EMA', region: 'EU', product: name, inn, holder: m.marketing_authorisation_developer_applicant_holder || null,
    indication: clip(decode(m.therapeutic_indication), 600) || null, source_url: m.medicine_url, names: own ? [name.replace(/\s*\(previously.*$/i, ''), inn] : [] };
  const id = m.ema_product_number || name;
  const label = `${name}${inn && inn.toLowerCase() !== name.toLowerCase() ? ` (${inn})` : ''}`;
  const out = [];
  const add = (kind, date, what) => { if (date) out.push({ ...base, key: `EMA|${id}|${kind}|${what}|${date}`, kind, decision_date: date, text: `${what}: ${label}` }); };
  const op = iso(m.opinion_adopted_date);
  if (m.opinion_status === 'Positive') add('opinion', op, 'CHMP positive opinion');
  if (m.opinion_status === 'Negative') add('rejection', op, 'CHMP negative opinion');
  add('approval', iso(m.marketing_authorisation_date), 'European Commission marketing authorisation');
  add('rejection', iso(m.refusal_of_marketing_authorisation_date), 'EU marketing authorisation refused');
  add('withdrawal', iso(m.withdrawal_of_application_date), 'EU application withdrawn');
  add('filing', iso(m.start_of_evaluation_date), 'EMA evaluation started');
  add('filing', iso(m.start_of_rolling_review_date), 'EMA rolling review started');
  return out;
}

export async function loadEma({ since = null } = {}) {
  const res = await fetch(URL_EMA, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`EMA file: HTTP ${res.status}`);
  const body = await res.json();
  const w = decisionWriter({ source: 'ema', since });
  w.transaction(() => { for (const m of body.data) for (const d of emaDecisions(m)) w.record(d); });
  return { file: body.meta?.timestamp, medicines: body.data.length, ...w.done() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--daily') && !dueToday('ema', 7)) process.exit(0);
  console.log(`--- ${new Date().toISOString()} EMA ${JSON.stringify(await loadEma({ since: sinceArg() }))}`);
}
