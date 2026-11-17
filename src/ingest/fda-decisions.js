// US decisions from openFDA (api.fda.gov answers our server; www.fda.gov does not, and we do not route around that).
//   node src/ingest/fda-decisions.js [--daily] [--since YYYY-MM-DD]
// 1. Drugs@FDA: approvals of new applications (ORIG) and of new uses (efficacy supplements) for NDAs and BLAs,
//    from the last 120 days of submissions. openFDA updates about weekly; we check daily so we see it the day it lands.
// 2. Complete response letters (FDA's rejection letters, /transparency/crl.json). The letter names no product in a field,
//    so it is matched when the company is one we track and the letter's text names one of its drugs; other letters
//    from tracked companies go to the review queue. We keep the date, application number, company and the letter's
//    own "cannot approve" sentence; never the person it is addressed to or their address.
import { pathToFileURL } from 'node:url';
import { getDb } from '../db.js';
import { companyPrograms, programsNamedIn } from '../match.js';
import { decisionWriter, dueToday, sinceArg, clip } from './decisions.js';

const API = 'https://api.fda.gov';
const UA = 'OpenLandscape/0.1 (+https://openlandscape.app; hello@openlandscape.app)';
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const iso8 = s => String(s || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
const isoUS = s => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
export const fdaUrl = appl => `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${String(appl).replace(/^\D+/, '')}`;
export const crlUrl = file => `https://download.open.fda.gov/crl/${encodeURIComponent(file)}`;

async function get(path, params) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  if (res.status === 404) return { results: [], meta: {} };   // openFDA: no matches
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// One Drugs@FDA application -> its approvals dated on or after `from` (YYYY-MM-DD).
export function approvalsOf(a, from) {
  if (!/^(NDA|BLA)/.test(a.application_number)) return [];
  const brands = [...new Set((a.products || []).map(p => p.brand_name).filter(Boolean))];
  const ings = [...new Set((a.products || []).flatMap(p => (p.active_ingredients || []).map(i => i.name)).filter(Boolean))];
  const label = `${brands.join(', ') || ings.join(', ')}${brands.length && ings.length ? ` (${ings.join(', ').toLowerCase()})` : ''}`;
  return (a.submissions || []).filter(s => s.submission_status === 'AP' && (s.submission_type === 'ORIG' || s.submission_class_code === 'EFFICACY'))
    .map(s => ({ s, date: iso8(s.submission_status_date) })).filter(x => x.date >= from)
    .map(({ s, date }) => ({
      key: `FDA|${a.application_number}|${s.submission_type}${s.submission_number}`, agency: 'FDA', region: 'US', kind: 'approval',
      product: brands.join(', ') || null, inn: ings.join(', ').toLowerCase() || null, holder: a.sponsor_name, decision_date: date, source_url: fdaUrl(a.application_number),
      names: [...brands, ...ings], quote: [s.submission_type, s.submission_class_code_description].filter(Boolean).join(' · '),
      text: `${s.submission_type === 'ORIG' ? 'FDA approval' : 'FDA approval of a new use'}: ${label}`,
    }));
}

export async function loadFdaApprovals({ since = null, days = 120 } = {}) {
  const from = new Date(Date.now() - days * 864e5);
  const w = decisionWriter({ source: 'fda', since });
  const apps = [];
  for (let skip = 0; ; skip += 1000) {
    const body = await get('/drug/drugsfda.json', { search: `submissions.submission_status_date:[${ymd(from)} TO ${ymd(new Date())}]`, limit: '1000', skip: String(skip) });
    apps.push(...body.results);
    if (body.results.length < 1000) break;
  }
  w.transaction(() => { for (const a of apps) for (const d of approvalsOf(a, from.toISOString().slice(0, 10))) w.record(d); });
  return { applications: apps.length, ...w.done() };
}

// The letter's own sentence saying FDA cannot approve the application (OCR text, so whitespace is cleaned).
export function crlSentence(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  return t.match(/We have completed our review of this application[^.]{0,200}\./i)?.[0] || t.match(/[^.]{0,200}cannot approve this application[^.]{0,120}\./i)?.[0]?.trim() || null;
}

export async function loadCrls({ since = null, db = getDb() } = {}) {
  const w = decisionWriter({ source: 'fda_crl', since });
  const of = companyPrograms(db);
  const letters = [];
  for (let skip = 0; ; skip += 1000) {
    const body = await get('/transparency/crl.json', { limit: '1000', skip: String(skip) });
    letters.push(...body.results);
    if (body.results.length < 1000) break;
  }
  const queue = db.prepare(`INSERT OR IGNORE INTO match_candidate (type, left_id, right_id, score, reasons, source_url) VALUES ('decision', ?, ?, ?, ?, ?)`);
  let queued = 0;
  const recent = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  w.transaction(() => {
    for (const l of letters) {
      // Only these fields are read. company_rep and company_address (a person and their address) are never kept.
      const { letter_date, file_name, company_name, application_number, letter_type, text } = l;
      if (!file_name || letter_type !== 'COMPLETE RESPONSE') continue;
      const co = of.resolve(company_name), progs = co ? of(co) : [];
      const named = programsNamedIn(text, progs);
      const appl = (application_number || []).join(', ');
      const d = { key: `FDA-CRL|${file_name}`, agency: 'FDA', region: 'US', kind: 'rejection', product: appl || null, holder: company_name, decision_date: isoUS(letter_date),
        source_url: crlUrl(file_name), quote: clip(crlSentence(text) || 'COMPLETE RESPONSE', 300), names: [],
        program: named[0] ? { program_id: named[0].program_id, drug_id: named[0].drug_id } : null,
        text: `FDA complete response letter${named[0] ? ` for ${named[0].name}` : ''}${appl ? ` (${appl})` : ''}` };
      if (!d.decision_date) continue;
      const r = w.record(d);
      if (r && !named.length && progs.length && d.decision_date >= recent) {   // a recent letter to a company we track that names none of its drugs we know
        queued += queue.run(d.source_url, co, 0.5, JSON.stringify({ kind: 'rejection', region: 'US', company: company_name, application: appl, date: d.decision_date, why: 'company tracked, no tracked drug named in the letter' }), d.source_url).changes;
      }
    }
  });
  return { letters: letters.length, queued, ...w.done() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--daily') && !dueToday('fda', 8)) process.exit(0);
  const since = sinceArg();
  console.log(`--- ${new Date().toISOString()} openFDA approvals ${JSON.stringify(await loadFdaApprovals({ since }))}`);
  console.log(`--- ${new Date().toISOString()} openFDA rejection letters ${JSON.stringify(await loadCrls({ since }))}`);
}
