// Drug rows with no active trial that look approved: whose product are they? No model, only the database.
//   DB_PATH=... node scripts/approved-idle.mjs [out.csv]
// A row "looks approved" when it has an approval status (program.status_label), or its name or another name is an FDA
// ingredient or brand (lowercased, as scripts/packet-lib.mjs matches). Each is sorted into:
//   own      the FDA approval holder is the row's company or its group (owns() and COOWNER in src/owners.js, or the
//            company's sponsor patterns), or the company sells the brand outside the US (PARTNER); the linker's "FDA-approved (any use)" label already passed that test
//   other    every trial is run by a hospital, university or other non-industry sponsor, or the drug is old or
//            widely copied (approved 15+ years ago, or 3+ holders) and none of its holders is the company
//   unclear  an industry sponsor, and a recent drug with one or two holders, none of them the company: a licence partner,
//            a regional rights holder or a trial that uses the drug alongside its own
// and split by whether any trial finished in the last 2 years (as the landscape's "recently finished").
import { writeFileSync } from 'node:fs';
import { getDb } from '../src/db.js';
import { owns, COOWNER, PARTNER } from '../src/owners.js';

// Kept here rather than imported from the reading tools (scripts/packet-lib.mjs), which are not in the open-source copy.
const ACTIVE_SQL = `('RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION')`;
const J = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };

const OLD_YEARS = 15, MANY_HOLDERS = 3;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const atWordStart = p => new RegExp('(?<![a-z0-9])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const ownsHolder = (h, company, groups, groupOf) => owns(h.sponsor, company) || (COOWNER[h.key] || []).some(w => company.toLowerCase().includes(w))
  || groups.some(g => groupOf(h.sponsor) === g);
// One row's group. holders: [{ sponsor, approval_date }]; trials: [{ sponsor_class, status, end }].
export function sortRow({ status_label, names = [], company, groups, holders, trials, today, groupOf }) {
  if (status_label === 'FDA-approved (any use)') return 'own';
  if (names.some(n => PARTNER[norm(n)] && company.toLowerCase().includes(PARTNER[norm(n)]))) return 'own';
  if (trials.length && trials.every(t => t.sponsor_class !== 'INDUSTRY')) return 'other';
  if (holders.some(h => ownsHolder(h, company, groups, groupOf))) return 'own';
  if (!holders.length) return 'unclear';
  const first = holders.map(h => h.approval_date || '9999').sort()[0];
  const old = Number(today.slice(0, 4)) - Number(first.slice(0, 4)) >= OLD_YEARS;
  return old || new Set(holders.map(h => norm(h.sponsor))).size >= MANY_HOLDERS ? 'other' : 'unclear';
}
export const finishedRecently = (trials, today) => {
  const cutoff = new Date(Date.parse(today) - 730 * 864e5).toISOString().slice(0, 10);
  return trials.some(t => ['COMPLETED', 'TERMINATED', 'SUSPENDED'].includes(t.status) && t.end && (t.end.length === 7 ? t.end + '-31' : t.end) >= cutoff);
};

export function approvedIdle(db, today) {
  const companies = db.prepare('SELECT id, parent_id, sponsor_patterns FROM company').all();
  const parentOf = new Map(companies.map(c => [c.id, c.parent_id]));
  const root = id => { let n = 0; while (parentOf.get(id) && n++ < 5) id = parentOf.get(id); return id; };
  const pats = companies.flatMap(c => J(c.sponsor_patterns).map(p => [atWordStart(p.toLowerCase()), root(c.id)]));
  const groupCache = new Map();
  const groupOf = s => { const k = String(s).toLowerCase(); if (!groupCache.has(k)) groupCache.set(k, pats.find(([r]) => r.test(k))?.[1] || null); return groupCache.get(k); };

  const fda = new Map();
  for (const r of db.prepare('SELECT appl_no, brand, ingredient, sponsor, approval_date FROM fda_approval').all())
    for (const k of new Set([r.ingredient, r.brand].filter(Boolean).map(s => s.toLowerCase()))) { if (!fda.has(k)) fda.set(k, []); fda.get(k).push({ ...r, key: norm(r.ingredient) }); }
  const byNumber = new Map();
  for (const hs of fda.values()) for (const h of hs) { const k = h.appl_no.replace(/\D/g, ''); if (!byNumber.has(k)) byNumber.set(k, []); byNumber.get(k).push(h); }
  const trialsOf = db.prepare('SELECT t.nct, t.status, t.sponsor, t.sponsor_class, t.phase, coalesce(t.primary_completion, t.completion) AS end FROM trial_program tp JOIN trial t ON t.nct = tp.nct WHERE tp.program_id = ?');
  const idle = db.prepare(`SELECT * FROM program WHERE id NOT IN (SELECT tp.program_id FROM trial_program tp JOIN trial t ON t.nct = tp.nct WHERE t.status IN ${ACTIVE_SQL})`).all();
  const out = [];
  for (const p of idle) {
    const names = [...new Set([p.name, ...J(p.aliases).map(a => a.name)].filter(Boolean).map(s => s.toLowerCase()))];
    const holders = [...new Map(names.flatMap(n => fda.get(n) || []).map(h => [h.sponsor + '|' + h.ingredient, h])).values()];
    if (!p.status_label && !holders.length) continue;
    const trials = trialsOf.all(p.id);
    const groups = [...new Set(J(p.company_ids).map(root).concat(groupOf(p.company) || []))];
    const group = sortRow({ status_label: p.status_label, names, company: p.company || '', groups, holders, trials, today, groupOf });
    // The row's own approvals, for its label: the linker's (its source link holds the number), else the holders that are the company.
    const linked = /ApplNo=(\d+)/.exec(p.status_source || '')?.[1];
    const appls = group !== 'own' ? [] : linked ? [...new Set(holders.concat(byNumber.get(linked) || []).filter(h => h.appl_no.replace(/\D/g, '') === linked).map(h => h.appl_no))]
      : [...new Set(holders.filter(h => ownsHolder(h, p.company || '', groups, groupOf)).map(h => h.appl_no))];
    out.push({ id: p.id, name: p.name, company: p.company, group, appls: appls.join(' '), recent: finishedRecently(trials, today), label: p.status_label || '',
      holders: [...new Set(holders.map(h => h.sponsor))].slice(0, 4).join('; '), trials: trials.length,
      industry: trials.filter(t => t.sponsor_class === 'INDUSTRY').length, top_phase: Math.max(0, ...trials.map(t => t.phase || 0)) });
  }
  return { idle: idle.length, rows: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = getDb(), today = process.env.TODAY || new Date().toISOString().slice(0, 10);
  const { idle, rows } = approvedIdle(db, today);
  const count = f => rows.filter(f).length;
  console.log(`No active trial: ${idle}. Look approved: ${rows.length} (${count(r => r.label)} with a status label).`);
  for (const g of ['own', 'other', 'unclear']) console.log(`${g}: ${count(r => r.group === g)} (finished in last 2 years: ${count(r => r.group === g && r.recent)})`);
  // Own approved drugs with a trial in each showcase list (PUBLIC in src/server.js), and those whose FDA label names its disease.
  const Q = await import('../src/query.js'), label = db.prepare('SELECT indications FROM fda_label WHERE appl_no = ?').pluck();
  const inTrials = db.prepare('SELECT DISTINCT program_id FROM trial_program WHERE nct IN (SELECT value FROM json_each(?))').pluck();
  for (const area of ['obesity', 'PD-1/VEGF', 'in vivo CAR-T', 'non-small cell lung cancer']) {
    const ids = new Set(inTrials.all(JSON.stringify([...Q.areaTrials(area)])));
    const own = rows.filter(r => r.group === 'own' && ids.has(r.id));
    const yes = own.filter(r => r.appls.split(' ').some(a => Q.treats(label.get(a), area)));
    console.log(`${area}: ${own.length} own approved drugs with a trial here; label names the disease: ${yes.length}${yes.length ? ' (' + yes.map(r => r.name).join(', ') + ')' : ''}; not: ${own.filter(r => !yes.includes(r)).map(r => r.name).join(', ')}`);
  }
  if (process.argv[2]) {
    const cols = Object.keys(rows[0]), q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    writeFileSync(process.argv[2], [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n') + '\n');
  }
}
