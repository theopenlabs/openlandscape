// What the drug, company and target pages need beyond src/query.js: a company's drugs as landscape rows, a drug's trials with
// their number in each registry, the one plain line per target, and whether a search is one drug or one company.
// Kept apart from src/query.js, which the data work edits (build plan, section 3).
import { getDb, norm } from './db.js';
import * as Q from './query.js';
import { suggest, key } from './suggest.js';

const ACTIVE = ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION'];
const endOf = d => (!d ? '' : d.length === 7 ? d + '-31' : d.length === 4 ? d + '-12-31' : d);
const json = (s, d = []) => { try { return JSON.parse(s || '') ?? d; } catch { return d; } };

// "United States" for "US": headquarters in words.
const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = c => { try { return c && /^[A-Z]{2}$/.test(c) ? REGION.of(c) : c || ''; } catch { return c || ''; } };

// ---------- company ----------
// The company page: src/query.js's company() plus its drugs as landscape rows (stage, next milestone, opened row), the drugs
// with no active trial, every sponsor name it is counted under, and its SEC filings folded for the feed.
// The rows come from a landscape search for the company's name, kept to the company's own drugs.
export function companyView(id) {
  const c = Q.company(id);
  if (!c) return null;
  const db = getDb();
  const mine = new Set(c.programs.map(p => p.id));
  const L = Q.landscape({ area: c.name, phase_min: 1, limit: 5000 });
  const programs = L.programs.filter(p => mine.has(p.id));
  // Every drug the company has, active or not; the ones with no active trial fold into one line under the table.
  const all = c.curated ? db.prepare('SELECT id, name, curated FROM program WHERE company_ids LIKE ?').all(`%"${c.id}"%`)
    : db.prepare('SELECT DISTINCT p.id, p.name, p.curated FROM program p JOIN trial_program tp ON tp.program_id=p.id JOIN trial t ON t.nct=tp.nct WHERE t.sponsor=? AND p.curated=0').all(id);
  const shown = new Set(programs.map(p => p.id));
  const idle = all.filter(p => !shown.has(p.id)).sort((a, b) => b.curated - a.curated || a.name.localeCompare(b.name));
  const stats = statsOf(programs);
  const sponsors = c.curated ? (() => {
    const pats = json(db.prepare('SELECT sponsor_patterns FROM company WHERE id=?').pluck().get(c.id));
    return pats.length ? db.prepare(`SELECT sponsor, count(*) AS n FROM trial WHERE ${pats.map(() => 'lower(sponsor) LIKE ?').join(' OR ')} GROUP BY sponsor ORDER BY n DESC`).all(...pats.map(x => `%${x}%`)).map(r => r.sponsor) : [];
  })() : [id];
  return {
    ...c, country_name: countryName(c.country), sponsor_names: sponsors,
    L: { ...L, area: c.name, programs, stats, truncated: false, included: null },
    idle, drugs_total: programs.length + idle.length,
    filings: c.cik ? foldFilings(db.prepare('SELECT * FROM filing WHERE company_id=? ORDER BY date DESC, accession').all(c.id)) : [],
  };
}
// The counts a landscape's filter row and header use, for a set of rows.
function statsOf(programs) {
  const NAMES = { 1: 'Phase 1', 2: 'Phase 2', 3: 'Phase 3', 4: 'Filed', 5: 'Approved' };
  const next = programs.filter(p => p.next_catalyst).sort((a, b) => endOf(a.next_catalyst.date).localeCompare(endOf(b.next_catalyst.date)))[0];
  return {
    programs: programs.length, trials: new Set(programs.flatMap(p => p.in_active_trials ? p.trials.ncts : [])).size,
    china: programs.filter(p => p.china === 1).length, by_phase: [5, 4, 3, 2, 1].map(l => ({ level: l, name: NAMES[l], count: programs.filter(p => p.phase.level === l).length })),
    next: next ? { drug: next.drug, soon: next.soon, ...next.next_catalyst } : null,
    unreviewed: programs.filter(p => !p.curated).length, checked: programs.filter(p => p.checked).length,
  };
}
// SEC filings as feed rows: what the company did in plain words, the form in grey. Prospectuses filed within a few days of
// each other are one offering: "23–25 Sep Offered new securities · 4 prospectuses (424B5)".
const ITEM_DID = { '1.01': 'signed a material agreement', '2.01': 'bought or sold assets', '2.02': 'reported quarterly results', '2.03': 'took on new debt',
  '3.02': 'sold shares privately', '5.02': 'changed a director or officer', '7.01': 'made a public disclosure', '8.01': 'reported other events' };
const joinAnd = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
const cap = s => s[0].toUpperCase() + s.slice(1);
function foldFilings(rows) {
  const out = [];
  for (const f of rows) {
    const form = f.form.replace(/\/A$/, '');
    if (f.kind === 'offering') {
      const last = out[out.length - 1];
      if (last?.offering && last.form === form && (Date.parse(last.from) - Date.parse(f.date)) <= 7 * 864e5) { last.from = f.date; last.n++; continue; }
      out.push({ offering: true, date: f.date, from: f.date, form, n: 1, url: f.url });
      continue;
    }
    const did = String(f.items || '').split(',').map(i => ITEM_DID[i.trim()]).filter(Boolean);
    out.push({ date: f.date, from: f.date, form, url: f.url, what: did.length ? cap(joinAnd(did)) : 'Filed a report' });
  }
  for (const r of out) if (r.offering) { r.what = 'Offered new securities'; r.src = `${r.n} ${r.n === 1 ? 'prospectus' : 'prospectuses'} (${r.form})`; } else r.src = `SEC ${r.form}`;
  return out;
}

// ---------- drug trials ----------
// One row per trial, with its number in each registry: the ClinicalTrials.gov number, then the EU (CTIS) number of the same
// trial with its countries. Trials only in the EU register join when they test this drug by name (the test product's name or
// substance, salt words dropped); src/query.js does not join them to a drug.
const SALT = /\b(hemicalcium|calcium|sodium|potassium|hydrochloride|mesylate|acetate|citrate|sulfate|phosphate|tartrate|maleate|fumarate|succinate)\b/g;
export function drugTrials(d) {
  const db = getDb();
  const ncts = d.trials.map(t => t.nct);
  const eu = new Map();
  if (ncts.length) for (const r of db.prepare("SELECT sl.study_id AS nct, tr.record_id AS id, tr.url, tr.countries FROM study_link sl JOIN trial_record tr ON tr.registry=sl.registry AND tr.record_id=sl.record_id WHERE sl.registry='ctis' AND sl.study_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(ncts)))
    eu.set(r.nct, [...(eu.get(r.nct) || []), { id: r.id, url: r.url, countries: json(r.countries) }]);
  const rows = d.trials.map(t => ({ ...t, eu: eu.get(t.nct) || [] }));
  // EU-only trials: a CTIS record that no ClinicalTrials.gov trial shares, testing this drug.
  const names = new Set([d.name, ...d.aliases.map(a => a.name)].map(n => norm(String(n).toLowerCase().replace(SALT, ''))).filter(n => n.length >= 5));
  if (names.size) {
    const like = [...names].map(() => 'lower(products) LIKE ?').join(' OR ');
    for (const r of db.prepare(`SELECT * FROM trial_record WHERE registry='ctis' AND study_id=record_id AND (${like})`).all(...[...names].map(n => `%${n.slice(0, 12)}%`))) {
      const tests = json(r.products).filter(p => p.role === 'test').some(p => [p.name, p.substance, ...(p.other || [])].some(x => names.has(norm(String(x || '').toLowerCase().replace(SALT, '')))));
      if (!tests) continue;
      rows.push({ nct: null, url: null, title: r.title, status: r.status, active: ACTIVE.includes(r.status) || /^(Authorised|Ongoing)/i.test(r.status || ''), phase: r.phase_label || (r.phase ? `Phase ${r.phase}` : ''),
        primary_completion: r.primary_completion, primary_completion_label: r.primary_completion ? prettyDay(r.primary_completion) : '', eu: [{ id: r.record_id, url: r.url, countries: json(r.countries) }], euOnly: true });
    }
  }
  return rows;
}
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const prettyDay = d => (d.length >= 10 ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : d.length === 7 ? `${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : d);

// The drug's EU decision for its stage: a marketing authorisation, or else a positive CHMP opinion (as on a landscape row).
export const euStage = id => getDb().prepare("SELECT kind, source_url AS url FROM regulatory_decision WHERE region='EU' AND kind IN ('approval','opinion') AND program_id=? ORDER BY kind DESC, decision_date").get(id) || null;

// ---------- targets ----------
// One plain line under a target's name, for a reader who came from a drug page, and where it was checked (shown as a link
// under the line). Spec 15 part 4 gave GLP-1's; the others were written on 10 Nov and checked against the source named.
const W = n => `https://en.wikipedia.org/wiki/${n}`;
export const TARGET_LINES = {
  'glp-1': { text: 'A gut hormone released after meals. Drugs that copy it or switch on its receptor lower appetite and blood sugar.', src: ['Wikipedia: Glucagon-like peptide-1', W('Glucagon-like_peptide-1')] },
  gip: { text: 'A gut hormone released when you eat that helps the body make insulin. Drugs pair it with GLP-1 to lower weight and blood sugar further.', src: ['Wikipedia: Gastric inhibitory polypeptide', W('Gastric_inhibitory_polypeptide')] },
  glucagon: { text: 'A hormone that raises blood sugar and makes the body burn more energy. Drugs add it to GLP-1 for more weight loss.', src: ['Wikipedia: Glucagon', W('Glucagon')] },
  amylin: { text: 'A hormone released with insulin after meals. It slows the stomach and makes people feel full, so drugs that copy it lower appetite.', src: ['Wikipedia: Amylin', W('Amylin')] },
  mc4r: { text: 'A switch in the brain that tells you you are full. When it works poorly, hunger does not switch off; drugs that turn it on aim to reduce hunger.', src: ['NORD: Obesity due to MC4R deficiency', 'https://rarediseases.org/rare-diseases/obesity-due-to-melanocortin-4-receptor-deficiency/'] },
  myostatin: { text: 'A protein that holds back muscle growth. Drugs that block it aim to keep muscle while people lose weight.', src: ['MedlinePlus: MSTN gene', 'https://medlineplus.gov/genetics/gene/mstn/'] },
  inhbe: { text: 'A gene active in the liver. People born with a weaker copy carry less fat around the waist, so drugs that silence it aim to cut belly fat.', src: ['Nature Communications, 2022', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9399235/'] },
  cideb: { text: 'A gene that helps the liver store fat. People born with a broken copy are less likely to get liver disease, so drugs that silence it aim to treat fatty liver disease.', src: ['New England Journal of Medicine, 2022', 'https://pubmed.ncbi.nlm.nih.gov/35939579/'] },
};

// ---------- a search that is one drug or one company ----------
// Its page, when what was typed is exactly the name (or a code or other name) of one drug or one company, and not the name of a
// disease or a type of drug. Anything else is a landscape search.
export function entityFor(query) {
  const q = key(query);
  if (!q) return null;
  const hits = [];
  for (const g of suggest(query, { per: 25 }).groups) for (const it of g.items) {
    // A disease or a type of drug that is, or starts with, what was typed ("PD-1" and PD-1 blockers) makes it a landscape search.
    if ((g.kind === 'disease' || g.kind === 'type') && (key(it.label) + ' ').startsWith(q + ' ')) return null;
    const exact = key(it.label) === q || (it.also && key(it.also) === q) || (g.kind === 'company' && it.detail && key(it.detail.split(' · ').pop()) === q);
    if (!exact) continue;
    if (g.kind === 'disease' || g.kind === 'type') return null;
    hits.push(it.href);
  }
  return new Set(hits).size === 1 ? hits[0] : null;
}

// A drug's next milestone, the way a landscape row picks it: a dated event, or the soonest trial of Phase 2 or later, else any.
export const nextOf = d => d.catalysts.find(c => c.news || !/(^|, )(Early )?Phase 1$/.test(c.what)) || d.catalysts[0] || null;
