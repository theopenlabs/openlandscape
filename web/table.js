// Landscape table renderer. Used by the server (public pages, rendered before they reach the browser)
// and by the dashboard in the browser, so both look identical. Styles: section 5 of web/style.css.
import { icon } from './icons.js';
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A drug's other names, cleaned for reading (15 Nov 2026), on its page, in CSVs and in AI answers. Some registry entries hold
// several names in one ("TUKYSA, ONT-380, ARRY-380"): each counts on its own. Left out: repeats (any case, without ® and ™),
// the drug's own name, the drug's name with more words ("NSAI + goserelin+ ribociclib", "Semaglutide Implant"), and the
// registry's leftovers ("Experimental product", "Endocrine treatment arm:", names in brackets, very long ones).
const JUNK_ALIAS = /[:;()[\]]|^(experimental|investigational|study) (product|drug|arm)|placebo|treatment arm/i;
export function cleanAliases(drug, aliases) {
  const own = String(drug || '').toLowerCase(), seen = new Set([own]), out = [];
  for (const a of (aliases || []).flatMap(a => String(a.name).replace(/[®™]/g, '').split(',').map(name => ({ ...a, name: name.trim() })))) {
    const k = a.name.toLowerCase();
    if (!k || seen.has(k) || k.length > 40 || JUNK_ALIAS.test(a.name) || (k.includes(own) && own.length > 3)) continue;
    seen.add(k); out.push(a);
  }
  return out;
}
export const HOW_WE_CHECK = '/how-we-check';

export function meter(n) {
  let h = '<div class="meter" aria-hidden="true">';
  for (let i = 1; i <= 5; i++) h += `<i class="${i <= n ? 'f' + i : ''}"></i>`;
  return h + '</div>';
}
// Not yet confirmed: said in words, with what exactly in a tooltip.
const unc = what => ` <span class="word tip" tabindex="0" data-tip="${esc(what)}">unconfirmed</span>`;
const pressTip = ' · <span class="tip" tabindex="0" data-tip="From a press release, not the registry">press release</span>';
// A row nobody has checked yet (stats.checked counts the others), said in small grey words; what that means is in the tooltip.
const UNCHECKED = '<span class="word uc" tabindex="0" data-tip="Not checked yet: grouped from the names companies use in ClinicalTrials.gov">not checked</span>';
const ext = (url, label, cls = '') => `<a href="${esc(url)}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}>${label}</a>`;

// Names in a row (landscape pass, 12 Nov): a drug starts with a capital (nothing is ever made lower case: codes and brands
// keep theirs); a company drops only its legal ending ("Alpha Cognition, Inc" reads "Alpha Cognition"). The full name stays
// in the cell's title and on the company's page.
export const drugName = n => { const t = String(n ?? ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const LEGAL = /(?:,?\s+Co\.?\s*,?\s*Ltd\.?|,?\s+(?:Inc\.?|LLC|L\.L\.C\.|Ltd\.?|GmbH|AG)|,\s+Co\.)$/i;
export const companyShort = n => { let t = String(n ?? '').trim(), u; while ((u = t.replace(LEGAL, '').trim()) !== t && u) t = u; return t; };
// The opened row's "How it works": the first part of the plain line ("A short strand of RNA that switches off one gene").
const plainShort = t => String(t || '').split(/[,:;.](?:\s|$)/)[0].trim();

// Plain-English wording, so people outside the field can read a row.
const STAGE = [
  [/^Approved \((.+)\)$/, m => ['Approved', `in ${/^(US|EU)$/.test(m[1]) ? 'the ' + m[1] : m[1]}`]],
  [/^Filed \((.+)\)$/, m => ['Filed for approval', `in ${/^(US|EU)$/.test(m[1]) ? 'the ' + m[1] : m[1]}`]],
  [/^Marketed/, () => ['On the market', 'with a Phase 4 study']],
  [/^FDA-approved/, () => ['Approved', 'in the US']],   // approved by the FDA for some use (openFDA), which use is not in the data
  [/^Phase 3$|^Phase 2\/3$/, m => [m[0], 'large late-stage trials']],
  [/^Phase 2$/, m => [m[0], 'mid-stage trials']],
  [/^Phase 1\/2/, m => [m[0], 'early safety and mid-stage trials']],
  [/^Phase 1/, m => [m[0], 'early safety trials']],
];
export function stagePlain(label) {
  for (const [re, f] of STAGE) { const m = String(label).match(re); if (m) return f(m); }
  return [label, ''];
}
// What the drug is: the plain line (if we have one), then the expert term with where it comes from.
// On a drug page the source shows as a chip; in a table row it is said in the mechanism's tooltip (`tip`).
const SRC = { fda: 'FDA class', stem: 'WHO name stem', named: 'Named by hand' };
const HOW = { fda: "the FDA's class for this drug", stem: 'the stem of its WHO name', named: 'named by hand' };
export function explainHTML(e, { mechConfirmed = true } = {}) {
  if (!e || !e.term) return { plain: '', term: '<span class="none">How it works isn\'t classified yet</span>', name: '', short: '', tip: '', unconfirmed: '' };
  const src = SRC[e.source] ? (e.url ? ext(e.url, SRC[e.source], 'srcchip') : `<span class="srcchip">${SRC[e.source]}</span>`) : '';
  const name = esc(e.term.replace(/ \/ /g, ' + '));
  const unconfirmed = e.source === 'hand' && !mechConfirmed ? unc('Mechanism not yet confirmed') : '';
  // In a table row: the meaning without the stem ("-tinib: tyrosine kinase inhibitors" reads "Tyrosine kinase inhibitor"),
  // and an FDA class in sentence case ("Kinase Inhibitor" reads "Kinase inhibitor"). The full term is in the opened row.
  const short = e.source === 'stem' ? e.term.replace(/^-\w+: /, '').replace(/ies$/, 'y').replace(/(or|ist|ue|ive|in)s$/, '$1')
    : e.source === 'fda' ? e.term.split(' ').map((w, i) => (i && /^[A-Z][a-z]+(-[A-Za-z0-9]+)*$/.test(w) ? w.toLowerCase() : w)).join(' ') : e.term;
  return {
    plain: e.plain ? esc(e.plain) : '',
    term: `${name}${unconfirmed}${src ? ' ' + src : ''}`,
    name, unconfirmed, short: esc(short[0].toUpperCase() + short.slice(1)).replace(/ \/ /g, ' + '),
    tip: [e.plain || '', HOW[e.source] ? `How we know: ${HOW[e.source]}.` : ''].filter(Boolean).join(' '),
  };
}
// The other diseases its trials list, as registered. Left out: the landscape's own disease and its other wordings (marked
// `own` by src/query.js from the disease map, or holding the landscape's name). The spellings of type 2 diabetes count as one.
const T2D = /^(diabetes mellitus,? type 2|type 2 diabetes( mellitus)?|t2dm?)$/i;
export function alsoTestedFor(list, area = '') {
  const own = String(area).trim().toLowerCase(), seen = new Set([own]), out = [];
  for (const c of list || []) {
    const name = T2D.test(c.name.trim()) ? 'Type 2 diabetes' : c.name.trim(), k = name.toLowerCase();
    if (c.own || seen.has(k) || (own.length > 3 && k.includes(own))) continue;
    seen.add(k); out.push(name);
  }
  return out;
}
// Short definitions of the terms the tables use. Hand-written; phases follow FDA's description of clinical research,
// primary completion follows ClinicalTrials.gov's glossary.
export const TERMS = {
  phase1: ['Phase 1', 'The first tests in people, usually 20 to 100. Checks safety and the right dose.'],
  phase2: ['Phase 2', 'Up to several hundred people with the disease. Checks whether the drug works, and its side effects.'],
  phase3: ['Phase 3', 'Hundreds to a few thousand people. The large trials a regulator looks at before approving a drug.'],
  filed: ['Filed', 'The company has asked a regulator, such as the FDA, to approve the drug.'],
  approved: ['Approved / on the market', 'A regulator has approved the drug. A "Phase 4" trial studies a drug that is already sold.'],
  primary: ['Primary completion', 'The date a trial collects the data for its main question. Results usually follow weeks to months later.'],
  milestone: ['Next date', 'The next date we know of: a trial\'s primary completion, or a dated event from a press release.'],
  matched: ['What a search matches', 'Conditions, trial titles, drug names and codes, other names, how it works and company.'],
};
const TERM_SOURCES = [['FDA: the drug development process', 'https://www.fda.gov/patients/drug-development-process/step-3-clinical-research'], ['ClinicalTrials.gov glossary', 'https://clinicaltrials.gov/study-basics/glossary']];
// What a column's words mean, next to the column's name: an ⓘ that opens a small card (web/ui.js, [data-card]).
// "Not checked", "unconfirmed" and "press release" explain themselves where they appear (their tooltips).
const card = (label, keys, sources = false) => `<button class="termi" type="button" data-card aria-expanded="false" aria-label="What ${label} means">${icon('info', 14)}</button><div class="termcard" role="dialog" aria-label="${label}" hidden><dl>${keys.map(k => `<dt>${esc(TERMS[k][0])}</dt><dd>${esc(TERMS[k][1])}</dd>`).join('')}</dl>${sources ? `<p>Sources: ${TERM_SOURCES.map(([t, u]) => ext(u, esc(t))).join(', ')}</p>` : ''}</div>`;
const STAGE_CARD = card('Stage', ['phase1', 'phase2', 'phase3', 'filed', 'approved'], true);
const DATE_CARD = card('Next date', ['milestone', 'primary']);
const stageTerm = label => TERMS[/^Phase 1|Early Phase 1/.test(label) ? 'phase1' : /^Phase 2$/.test(label) ? 'phase2' : /^Phase (3|2\/3)/.test(label) ? 'phase3' : /^Filed/.test(label) ? 'filed' : /^(Approved|Marketed|FDA-approved)/.test(label) ? 'approved' : ''];
export const milestonePlain = what => String(what || '').replace(/^Primary completion, (.+)$/, '$1 trial completes');
const finPlain = f => {
  const parts = f.label.split(' · ').filter(x => x !== 'Not yet researched');
  if (!parts.length) return '';
  const kind = parts.includes('Public') ? 'Public' : 'Private';
  return kind + (f.tickers.length ? ` <span class="t">${esc(f.tickers.join(' · '))}</span>` : '');
};

// Rows of a landscape table, one line per drug: Drug, How it works, Company, Stage, Next milestone. Nothing in a row breaks
// onto a second line: what does not fit ends in "…" and is in full in the opened row (or the cell's title).
// `details` adds the row that opens under a drug (press the row or its arrow); `area` is the landscape's own disease,
// left out of "Also tested for". On phones the same rows show as a two-line list (section 5 of style.css).
// `own`: on a company's own page, the company's name; its column is then "Partner" and names only the others.
// The opened row (landscape pass, 12 Nov): three short lines in the table's own columns (how it works, the next date, the
// first two other diseases) and "Open drug page"; names, trials and where it is approved are on the drug's page.
export function rowsHTML(programs, { details = true, area = '', own = '' } = {}) {
  let h = `<thead class="dh"><tr><th>Drug</th><th>How it works</th><th>${own ? 'Partner' : 'Company'}</th><th>Stage${STAGE_CARD}</th><th>Next date${DATE_CARD}</th><th${details ? '' : ' class="tr"'}>${details ? '<span class="sr">Details</span>' : 'Trials'}</th></tr></thead><tbody>`;
  programs.forEach((p, i) => {
    const ex = explainHTML(p.explain || { term: p.mechanism, source: p.curated ? 'hand' : null }, { mechConfirmed: p.mechanism_confirmed });
    const nc = p.next_catalyst;
    const [stageFull, where] = stagePlain(p.phase.label), stage = stageFull.replace(' for approval', '');   // the row says "Filed"; the opened row says it in full
    const fin = own ? '' : finPlain(p.financing);   // on the company's own page its listing is in the header
    const n = p.trials.ncts.length;
    const filters = [p.tags || '', p.china === 1 ? 'china' : '', p.curated ? '' : 'unreviewed', p.checked ? '' : 'unchecked'].join(' ').trim();
    const hay = [p.drug, ...p.aliases.map(a => a.name), p.company, p.mechanism || '', p.explain?.term || '', ...(p.tested_for || []).map(c => c.name)].join(' ').toLowerCase();
    const partners = own ? String(p.company || '').split(' · ').filter(n => n && n !== own).map(companyShort).join(' · ') : '';
    const cos = String(p.company || '').split(' · ').filter(Boolean);
    const coRow = !own && cos.length > 1 ? `${esc(companyShort(cos[0]))} <span class="plus">+${cos.length - 1}</span>` : null;   // in the row: the first company, then "+1"
    const co1 = esc(companyShort(p.company));
    const company = own ? esc(partners) : p.company_ids && p.company_ids.length === 1 ? `<a class="plainlink" href="/companies/${encodeURIComponent(p.company_ids[0])}">${co1}</a>` : !p.curated && p.company ? `<a class="plainlink" href="/companies/${encodeURIComponent(p.company)}">${co1}</a>` : co1;
    const mech = ex.name ? `${ex.tip ? `<span class="tip" tabindex="0" data-tip="${esc(ex.tip)}">${ex.short}</span>` : ex.short}${ex.unconfirmed}` : '<span class="none">—</span>';
    const term = stageTerm(p.phase.label);
    // An approval or filing outside the US says where, in the row. Every region, each linked to its source, is in the opened row.
    const abroad = /^in /.test(where) && where !== 'in the US' ? `<span class="wh"> ${esc(where)}</span>` : '';
    const what = nc ? milestonePlain(nc.what) : 'No date in the registry';
    const last = details
      ? `<button class="rowbtn" type="button" data-toggle="${i}" aria-expanded="false" aria-label="Details for ${esc(p.drug)}">${icon('chevron', 16)}</button>`
      : ext(p.lead_trial.url, n > 1 ? `${n} trials` : '1 trial');
    h += `<tr data-f="${esc(filters)}" data-q="${esc(hay)}" data-i="${i}" data-lv="${p.phase.level}">
<td><div class="drug" title="${esc(p.drug)}"><a class="plainlink" href="/drugs/${encodeURIComponent(p.id)}">${esc(drugName(p.drug))}</a>${p.checked ? '' : UNCHECKED}</div></td>
<td><div class="mech">${mech}</div></td>
<td><div class="co" title="${esc(p.company)}">${coRow || company}<span class="fin">${fin ? ` · ${fin}` : ''}</span></div></td>
<td class="ph">${meter(p.phase.level)}<span class="st"${term ? ` data-tip="${esc(term[1])}"` : ''}>${ext(p.phase.source, esc(stage))}${abroad}</span></td>
<td class="cat" title="${esc(what)}"><span class="d">${nc ? `${ext(nc.url, esc(nc.label))}${p.soon ? '<span class="tag soon">soon</span>' : ''}` : '—'}</span><span class="sub">${nc ? esc(what).replace(/ trial completes$/, ' trial<span class="full"> completes</span>') : ''}</span></td>
<td class="end">${last}</td></tr>`;
    if (details) {
      const also = alsoTestedFor(p.tested_for, area);
      const how = ex.plain ? plainShort(ex.plain) : ex.name && ex.name.toLowerCase() !== ex.short.toLowerCase() ? ex.name : '';
      const facts = [
        how && ['How it works', how],
        nc && ['Next date', `${ext(nc.url, esc(nc.label))} <span class="g">· ${esc(what)}</span>${nc.news ? pressTip : ''}`],
        also.length && ['Also tested for', `${esc(also.slice(0, 2).join(', '))}${also.length > 2 ? ` <span class="g">and ${also.length - 2} more</span>` : ''}`],
      ].filter(Boolean);
      h += facts.map(([k, v]) => `<tr class="detail" data-detail="${i}" hidden><td>${k}</td><td colspan="5">${v}</td></tr>`).join('')
        + `<tr class="detail last" data-detail="${i}" hidden><td></td><td colspan="5"><a class="godrug" href="/drugs/${encodeURIComponent(p.id)}">Open drug page${icon('arrow', 14)}</a></td></tr>`;
    }
  });
  return h + '</tbody>';
}

// The stage bar above a table: one stacked bar, and the row meter as its key, so the key and the rows read the same way.
// A stage with no drugs drops out. (A landscape shows the same counts as its stage buttons instead: landscapeBody.)
export function phaseBar(stats) {
  const levels = stats.by_phase.filter(b => b.count);
  return `<div class="bar" aria-hidden="true">${levels.map(b => `<i class="f${b.level}" style="flex:${b.count}"></i>`).join('')}</div>`
    + `<div class="legend">${levels.map(b => `<span class="sk">${meter(b.level)}<span>${esc(b.name)}</span><b>${b.count}</b></span>`).join('')}</div>`;
}

// A cell a spreadsheet would read as a formula ("=…", "+…", "-…", "@…"): names come from the trial registry, where anyone can
// write anything, so such a cell starts with an apostrophe and stays plain text.
export const safeCell = v => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
// CSV with a source column for every fact. `credit`: the source line, after the rows and one empty line.
// `note`: a line above the source line, as when the file is cut ("First 2,000 of 3,159 drugs, …").
export function toCSV(programs, { credit = '', note = '' } = {}) {
  const q = v => `"${safeCell(v).replace(/"/g, '""')}"`;
  const head = ['drug', 'aliases', 'unconfirmed_aliases', 'company', 'mechanism', 'mechanism_confirmed', 'phase', 'phase_source', 'phase_from_news', 'next_catalyst_date', 'next_catalyst', 'next_catalyst_source', 'catalyst_from_news', 'financing', 'tickers', 'lead_trial', 'active_trials', 'reviewed_by_hand'];
  const rows = programs.map(p => [p.drug, cleanAliases(p.drug, p.aliases).filter(a => a.confirmed).map(a => a.name).join('; '), cleanAliases(p.drug, p.aliases).filter(a => !a.confirmed).map(a => a.name).join('; '), p.company, p.mechanism || '', p.mechanism ? (p.mechanism_confirmed ? 'yes' : 'no') : '',
    p.phase.label, p.phase.source, p.phase.news ? 'yes' : 'no', p.next_catalyst?.date || '', p.next_catalyst?.what || '', p.next_catalyst?.url || '', p.next_catalyst?.news ? 'yes' : 'no',
    p.financing.label, p.financing.tickers.join('; '), p.lead_trial.url, p.trials.ncts.join(' '), p.curated ? 'yes' : 'no']);
  return [head, ...rows].map(r => r.map(q).join(',')).join('\n') + '\n' + (note ? `\n${q(note)}\n` : '') + (credit ? `${note ? '' : '\n'}${q(credit)}\n` : '');
}

// ---------- the parts of a landscape, shared by the public page, a search result and a followed landscape ----------
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
// "13 Nov", "Nov" for a month-only date; the year only when it is not this year (`year` = the year of the data).
// The source line on everything that leaves the product: copied tables, CSV, slides, AI answers.
// "Source: OpenLandscape, openlandscape.app/landscapes/obesity, 15 Nov 2026". `url` without https://; the day it was made.
export const creditDay = (d = new Date()) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
export const creditLine = url => `Source: OpenLandscape, ${String(url).replace(/^https?:\/\//, '')}, ${creditDay()}`;
export function shortDate(d, year) {
  if (!d) return '';
  const y = d.slice(0, 4), m = MON[+d.slice(5, 7) - 1], day = d.length >= 10 ? `${+d.slice(8, 10)} ` : '';
  return d.length === 4 ? y : `${day}${m}${year && y === String(year) ? '' : ` ${y}`}`;
}
// Where the data comes from, as one labelled row in a page's About box (12 Nov: no loose grey source line under a page):
// the sources on one line, each linked, with the day it was last updated in grey; `note` follows in grey.
const SOURCE_URL = { 'ClinicalTrials.gov': 'https://clinicaltrials.gov', openFDA: 'https://open.fda.gov', 'EU trials register (CTIS)': 'https://euclinicaltrials.eu', 'SEC filings': 'https://www.sec.gov/edgar/search/' };
export const sourcesRow = (list, note = '') => ['Sources', `<span class="srcs">${list.map(([name, upd]) => `<span>${SOURCE_URL[name] ? ext(SOURCE_URL[name], esc(name)) : esc(name)}${upd ? ` <span class="d">updated ${esc(upd)}</span>` : ''}</span>`).join('<span class="sep"> · </span>')}${note ? ` <span class="d">${note}</span>` : ''}</span>`];
// What the list covers and how much of it was checked: labelled rows, each shown only when its fact exists. `more`: rows the
// page adds at the end, such as its sources.
export function dataRows(I, st, { matches = false, more = [] } = {}) {
  const rows = [];
  if (I?.children.length) rows.push(['Included', `${I.children.slice(0, 5).map(c => `<a href="/diseases/${esc(c.slug)}">${esc(c.name)}</a>`).join(', ')}${I.children.length > 5 ? ` and ${I.children.length - 5} more` : ''} · <a href="/diseases/${esc(I.slug)}">Breakdown</a>`]);
  if (I?.left_out.length) rows.push(['Left out', I.left_out.map(x => `<a class="tip" href="/diseases/${esc(x.slug)}"${x.note ? ` data-tip="${esc(x.note)}"` : ''}>${esc(x.name)}</a>`).join(', ')]);
  if (I && I.coverage.pct != null) rows.push(['Covers', `${I.coverage.found} of ${I.coverage.tagged} active trials the registry tags as ${esc(I.name)} (${I.coverage.pct}%)${I.children.length ? '' : ` · <a href="/diseases/${esc(I.slug)}">Breakdown</a>`}`]);
  if (matches) rows.push(['Matches', esc(TERMS.matched[1])]);
  const rest = st?.programs - st?.checked;
  if (st?.programs) rows.push(['Checked', `${st.checked} of ${plural(st.programs, 'drug', 'drugs')}.${rest ? ` ${rest === st.programs ? (rest === 1 ? 'It is' : 'All are') : `The other ${rest} ${rest === 1 ? 'is' : 'are'}`} marked “not checked” in the list.` : ''} <a href="${HOW_WE_CHECK}">How we check</a>`]);
  rows.push(...more);
  return rows.length ? `<dl class="rows">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : '';
}
// The list in one box: its header row (when `head` is given), the controls that narrow it, the table, the notice where the rows
// run out, then the foot and "About this list". The controls (screen 2 second pass, 11 Nov): the stages as one joined control
// (on a phone a drop-down), the landscape's own extra filters (`chips`), a China-based tick box, and "Find in this list".
// `k` prefixes the ids; wire it with wireLandscape(k). `chips`: extra [filter, label] chips; `after`: what sits where the rows
// run out, inside the box (Free's offer); `rows`: false leaves out the Included / Covers / Checked rows (the dashboard shows them
// in their own tab); `matches`: false leaves out the Matches row (a target page matches differently and says so in `more`).
// `more`: labelled rows added at the end of About this list, such as the sources (sourcesRow).
// `head`: what sits at the right of the list's header row ("Drugs 430"), such as Copy table and Download (exportActs); without it the list has no header.
// Whether a drug was checked is said in its row ("not checked") and in About this list, not in a filter. The box's last line
// says how many drugs show and how they are sorted.
// `order`: 'dev' when drugs still in development come first (a disease page's list); the last line says so.
export function landscapeBody(L, k, { chips = [], after = '', more = [], rows = true, matches = true, own = '', head = null, order = '' } = {}) {
  const s = L.stats, n = L.programs.length;
  const stages = s.by_phase.filter(b => b.count).length > 1 ? s.by_phase.filter(b => b.count) : [];
  const seg = (attr, label, count, on = false) => `<button type="button" aria-pressed="${on}" ${attr}>${esc(label)}<b>${count}</b></button>`;
  const tools = `<div class="listtools" id="${k}-f">
<div class="segs" role="group" aria-label="Stage">${seg('data-lv=""', 'All', s.programs, true)}${stages.map(b => seg(`data-lv="${b.level}"`, b.name, b.count)).join('')}</div>
${stages.length ? `<label class="stagesel"><span class="sr">Stage</span><select id="${k}-s"><option value="">All stages</option>${stages.map(b => `<option value="${b.level}">${esc(b.name)} · ${b.count}</option>`).join('')}</select></label>` : ''}
${chips.map(([f, label]) => `<button class="chip" type="button" aria-pressed="false" data-f="${f}">${esc(label)}</button>`).join('')}${s.china ? `<button class="tick" type="button" aria-pressed="false" data-cn>China-based <b>${s.china}</b></button>` : ''}
<label class="sr" for="${k}-q">Find in this list</label><input class="input find" id="${k}-q" type="search" placeholder="Find a drug or company in this list" autocomplete="off"></div>`;
  return `<div class="landbody" id="${k}" data-total="${s.programs}" data-rows="${n}"${order ? ` data-order="${order}"` : ''}>
<div class="tablebox">${head === null ? '' : `<div class="boxhead tablehead">${icon('pill')}<h2>Drugs<span class="count">${s.programs}</span></h2>${head}</div>`}${tools}<table class="land" id="${k}-t">${rowsHTML(L.programs, { area: L.area, own })}</table>
<p class="nomatch" id="${k}-n" hidden>No drugs match “<span></span>”. <button class="linkbtn" type="button">Clear filter</button></p>
${n > 6 ? `<button class="linkbtn allrows" type="button" id="${k}-a">Show ${n - 6} more</button>` : ''}${after}<div class="boxfoot" id="${k}-c"></div></div>
${rows ? about(dataRows(L.included, s, { matches, more })) : ''}
</div>`;
}
// ---------- Copy table and Download, at the right of the list's header (branded exports, step 1, 15 Nov 2026) ----------
// Copy table: everyone who sees the list. Download: the picture for slides of a ready-made landscape for everyone; the rest
// (any other picture, the table picture, CSV) on paid plans. `slug`: a ready-made landscape; else `area` and `phase`.
// `site`: the public address ("https://openlandscape.app"); empty locally, then the browser's own address is used.
export const creditPath = ({ slug, area }) => (slug ? `/landscapes/${slug}` : `/start?q=${encodeURIComponent(area).replace(/%20/g, '+')}`);
export function exportActs({ paid, slug = '', area = '', phase = 2, site = '' }) {
  const q = slug ? `slug=${encodeURIComponent(slug)}&p=${phase}` : `area=${encodeURIComponent(area)}&phase_min=${phase}`;
  const overview = slug ? `/landscapes/${encodeURIComponent(slug)}/slide.png?p=${phase}` : paid ? `/api/slide.png?kind=overview&${q}` : '';
  const items = [
    overview && ['overview', overview, 'Picture for slides', 'The whole landscape, ready for a deck'],
    paid && ['table', `/api/slide.png?kind=table&${q}`, 'Table for slides', 'The first 8 drugs you see, as a picture'],
    paid && ['csv', slug ? `/landscapes/${encodeURIComponent(slug)}.csv` : `/api/landscape.csv?${q}`, 'CSV', 'Every drug, with a source for each fact'],
  ].filter(Boolean);
  const base = (slug || area).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'landscape';
  const dl = items.length ? `<div class="dl export"><button class="more" type="button" aria-expanded="false" data-dl>${icon('download', 16)}Download${icon('chevron', 14)}</button>
<div class="menu-box dlbox">${overview ? `<div class="dlprev"><img alt="The picture for slides" width="400" height="225" data-src="${esc(overview)}"></div>
<div class="dltheme" role="group" aria-label="Look"><button type="button" aria-pressed="true" data-theme="light">Light</button><button type="button" aria-pressed="false" data-theme="dark">Dark</button></div>` : ''}
${items.map(([k, href, t, d]) => `<a class="mi" href="${esc(href)}" data-k="${k}" download><span>${t}</span><span class="d">${d}</span></a>`).join('')}</div></div>` : '';
  return `<span class="xacts" data-base="${esc(base)}" data-credit="${esc(site.replace(/\/$/, '') + creditPath({ slug, area }))}"><button class="more export" type="button" data-copytable>${icon('copy', 16)}<span>Copy table</span></button>${dl}</span>`;
}
const today = () => new Date().toISOString().slice(0, 10);
// The rows the reader sees (after the filters), as cells: drug, how it works, company, stage, next date.
const shownRows = table => [...table.querySelectorAll('tbody tr[data-f]:not([hidden])')].map(tr => {
  const td = tr.children, t = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const mech = td[1]?.cloneNode(true); mech?.querySelectorAll('.word').forEach(w => { w.textContent = ` (${w.textContent.trim()})`; });   // "GLP-1 + GIP (unconfirmed)"
  const next = [t(td[4]?.querySelector('.d')).replace(/soon$/, '').trim(), t(td[4]?.querySelector('.sub'))].filter(x => x && x !== '—').join(', ');
  return { id: decodeURIComponent((tr.querySelector('.drug a')?.getAttribute('href') || '').replace('/drugs/', '')),
    cells: [t(tr.querySelector('.drug a')), t(mech).replace(/^—$/, ''), td[2]?.querySelector('.co')?.title || t(td[2]), t(td[3]?.querySelector('.st')), next || '—'] };
});
const HEADS = ['Drug', 'How it works', 'Company', 'Stage', 'Next date'];
// What goes on the clipboard: a real table (pastes as one into slides, sheets and email) and tab-separated text, each with the
// source line under it. Every cell is plain text (safeCell) so a spreadsheet never runs one.
function clip(rows, credit, url) {
  const h = s => esc(safeCell(s));
  const html = `<table><thead><tr>${HEADS.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>${esc(credit).replace('OpenLandscape', `<a href="${esc(url)}">OpenLandscape</a>`)}</p>`;
  const text = [HEADS, ...rows].map(r => r.map(safeCell).join('\t')).join('\n') + `\n\n${credit}`;
  return { html, text };
}
function wireExport(box, table) {
  const acts = box.querySelector('.xacts');
  if (!acts) return;
  const url = (acts.dataset.credit.startsWith('/') ? location.origin : 'https://') + acts.dataset.credit.replace(/^https?:\/\//, '');
  const credit = () => creditLine(acts.dataset.credit.startsWith('/') ? location.host + acts.dataset.credit : acts.dataset.credit);
  // Copy table: the rows you see, with the source line. The button says what happened for a moment.
  const cb = acts.querySelector('[data-copytable]'), word = cb.querySelector('span');
  cb.addEventListener('click', async () => {
    const rows = shownRows(table).map(r => r.cells), { html, text } = clip(rows, credit(), url);
    try {
      if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      else await navigator.clipboard.writeText(text);
      word.textContent = `Copied ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}, with the source`;
    } catch { word.textContent = 'Copy did not work'; }
    setTimeout(() => { word.textContent = 'Copy table'; }, 2200);
  });
  // Rows copied by hand (two or more): the same source line at the end. A word or a name copies as it is.
  table.addEventListener('copy', e => {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0), n = [...table.querySelectorAll('tbody tr[data-f]')].filter(tr => range.intersectsNode(tr)).length;
    if (n < 2) return;
    const div = document.createElement('div'); div.append(range.cloneContents());
    e.clipboardData.setData('text/plain', `${sel.toString().trim()}\n\n${credit()}`);
    e.clipboardData.setData('text/html', `${div.innerHTML}<p>${esc(credit())}</p>`);
    e.preventDefault();
  });
  // Download: a menu with the picture's preview (loaded when it first opens) and Light or Dark for the pictures.
  const btn = acts.querySelector('[data-dl]');
  if (!btn) return;
  const menu = btn.nextElementSibling, img = menu.querySelector('img');
  let theme = 'light';
  const withTheme = href => href.replace(/&theme=dark/, '') + (theme === 'dark' ? '&theme=dark' : '');
  const open = on => { menu.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on)); if (on && img) img.src = withTheme(img.dataset.src); };
  btn.addEventListener('click', () => open(btn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('mousedown', e => { if (!acts.contains(e.target)) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { open(false); btn.focus(); } });
  menu.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
    theme = b.dataset.theme;
    menu.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (img) img.src = withTheme(img.dataset.src);
  }));
  menu.querySelectorAll('a.mi').forEach(a => a.addEventListener('click', e => {
    const k = a.dataset.k, base = acts.dataset.base, href = a.getAttribute('href').replace(/&(theme=dark|ids=[^&]*)/g, '');
    // CSV: fetched first, so past the account's allowance of drugs (src/limits.js) its reason shows here, not as a broken file.
    if (k === 'csv') {
      e.preventDefault(); open(false);
      fetch(href).then(async r => {
        if (!r.ok) {
          // The page may already say why (a list past the allowance): point to that box instead of adding a second one.
          const j = await r.json().catch(() => ({})), shown = document.querySelector('.meterbox[data-kind="over"]');
          if (j.limit && shown) return shown.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (j.limit) document.querySelector('.meterbox[data-kind="warn"]')?.remove();   // the reason takes the warning's place
          acts.closest('.tablebox')?.insertAdjacentHTML('beforebegin', j.limit ? limitBox(j.limit) : `<div class="flash error">${esc(j.error || 'The download did not work. Please try again.')}</div>`);
          return;
        }
        const url = URL.createObjectURL(await r.blob()), x = document.createElement('a');
        x.href = url; x.download = `${base}-openlandscape-${today()}.csv`; document.body.append(x); x.click(); x.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }).catch(() => {});
      return;
    }
    const ids = k === 'table' ? `&ids=${encodeURIComponent(shownRows(table).slice(0, 8).map(r => r.id).join(','))}` : '';
    a.href = withTheme(href + ids); a.download = `${base}${k === 'table' ? '-table' : ''}-openlandscape-${today()}.png`;
    setTimeout(() => open(false), 0);
  }));
}
// "About this list": what the list covers and how much was checked, and its sources, in one box.
const about = rows => `<section class="aboutbox"><div class="boxhead">${icon('info')}<h2>About this list</h2></div>${rows}</section>`;
export function wireLandscape(k) {
  const $ = id => document.getElementById(id), box = $(k);
  if (!box) return;
  wireTable($(k + '-t'), { chips: $(k + '-f'), input: $(k + '-q'), select: $(k + '-s'), count: $(k + '-c'), none: $(k + '-n'), total: +box.dataset.total, rows: +box.dataset.rows, dev: box.dataset.order === 'dev' });
  // On a phone the list shows six drugs, then "Show N more". Any filter shows every match.
  const all = () => { box.classList.add('all'); if ($(k + '-a')) $(k + '-a').hidden = true; };
  ['click', 'input', 'change'].forEach(ev => $(k + '-f')?.addEventListener(ev, e => { if (e.target.closest('button, input, select')) all(); }));
  $(k + '-a')?.addEventListener('click', all);
  wireExport(box, $(k + '-t'));
}

// A limit, said where the reader acted: the key fact in bold, one way past it, on one line. `acts`: the buttons.
export const limitNotice = (bold, rest, acts) => `<div class="flash limit"><p><b>${bold}</b> ${rest}</p>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
// The allowance of drugs (src/limits.js) as a meter: what is counted and "5,079 of 6,000", a thin
// bar, and past the allowance one sentence with its button. Near it, the bar alone. `n`: { kind, label, used, of, say, act }.
const num = n => Number(n).toLocaleString('en-US');
export const limitBox = n => {
  if (!n) return '';
  const pct = Math.min(100, Math.round((n.used / n.of) * 1000) / 10), btn = n.act === 'talk' ? '<a class="btn sm" href="/talk">Write to us</a>' : n.act === 'solo' ? SOLO_BTN.replace('btn sm', 'btn sm primary') : '';
  return `<div class="meterbox" data-kind="${esc(n.kind)}" role="status"><div class="mrow"><span>${esc(n.label)}</span><b>${num(n.used)} of ${num(n.of)}</b></div>
<div class="mbar"><i style="width:${pct}%"></i></div>${n.say ? `<div class="msay"><p>${esc(n.say)}</p>${btn}</div>` : ''}</div>`;
};
// The Follow box (screen 5): "Follow always means Solo". Solo is the main choice, with what it gives; Free sits under it, plainly.
// The same box signed out (src/pages/signin.js, in the sign-in box) and signed in on Free (openFollowBox below).
// `solo`: where Choose Solo goes. `free`: { text, btn, href, go } (go: the link opens the sign-in form in the same box).
export const followChoiceHTML = ({ name, solo, free, signin = '', dialog = true }) => {
  const ticks = l => `<ul>${l.map(t => `<li>${icon('check', 16)}<span>${t}</span></li>`).join('')}</ul>`;
  return `<div class="fchoice"><h1${dialog ? ' id="signbox-t"' : ''}>Follow ${esc(name)}</h1>
<p class="lede">Following is part of Solo: you see every change to ${esc(name)} the day it happens.</p>
<div class="fplans">
<div class="fplan fsolo"><p class="nm">Solo</p><p class="pr"><b>$49</b><span>a month, excl. VAT</span></p>
  ${ticks(['Follow up to 5 landscapes, companies or drugs', 'Every change, the day it happens', 'A Monday email with the week’s changes'])}
  <a class="btn primary" href="${esc(solo)}"${signin ? ' data-box-go' : ''}>Choose Solo</a></div>
<div class="fplan ffree"><p class="nm">Free</p><p class="pr"><b>$0</b><span>no card</span></p>
  ${ticks(free.items)}
  <a class="btn" href="${esc(free.href)}"${free.go ? ' data-box-go' : ''}>${free.btn}</a></div>
</div>
${signin}</div>`;
};
// A box over the page, in the sign-in box's look (a sheet from the bottom on a phone). Reused for each press.
function showBox(html) {
  let d = document.getElementById('followbox');
  if (!d) {
    d = document.createElement('dialog'); d.className = 'signbox'; d.id = 'followbox'; d.setAttribute('aria-labelledby', 'signbox-t');
    document.body.append(d);
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-box-close]')) d.close(); });
  }
  d.innerHTML = `<div class="signin inbox"><div class="card"><button class="x" type="button" data-box-close aria-label="Close">${icon('close', 18)}</button><div class="grab" aria-hidden="true"></div>
${html}</div></div>`;
  d.showModal();
  // Focus the card, not the close button: a box opened by the page itself (after a redirect) shows no focus ring.
  const card = d.querySelector('.card'); card.tabIndex = -1; card.focus({ preventScroll: true });
  return d;
}
// Signed in on Free, a Follow press opens the same box over the page. Their free landscape, if any, is read from the sidebar.
export function openFollowBox({ name, follow }) {
  const g = document.querySelector('#followgrp .it.gift'), mine = g?.querySelector('.t')?.textContent;
  const free = mine ? { items: [`${esc(mine)}, your free landscape, in full`, 'The top 10 of everything else'], btn: `Open ${esc(mine)}`, href: g.getAttribute('href') }
    : { items: ['One landscape of your own, in full', 'The top 10 of everything else'], btn: 'Pick your free landscape', href: '/app/welcome' };
  showBox(followChoiceHTML({ name, solo: `/billing/solo?follow=${encodeURIComponent(follow)}`, free }));
}
// Solo with every follow used (screen 6): the same box lists them, each with Unfollow. Pressing one unfollows it and follows
// `name` in its place (`follow`: the /follow address, which follows and opens it). Team is mentioned once, in grey.
export async function openSwapBox({ name, follow }) {
  const r = await fetch('/api/follow').then(x => x.json()).catch(() => ({ followed: [] }));
  const n = k => (k ? `${k} ${k === 1 ? 'change' : 'changes'} in 14 days` : 'No changes in 14 days');
  const d = showBox(`<div class="fchoice"><h1 id="signbox-t">Follow ${esc(name)}</h1>
<p class="lede">You follow ${r.followed.length}, the most on Solo. Unfollow one to make room: ${esc(name)} is followed in its place.</p>
<ul class="swap">${r.followed.map(f => `<li>${icon(f.kind === 'drug' ? 'pill' : 'landscape', 18)}<span class="nm2"><b>${esc(f.name)}</b><span>${n(f.n)}</span></span><button class="btn sm" type="button" data-swap="${f.id}">Unfollow</button></li>`).join('')}</ul>
<p class="team">Need more than 5? Team follows 10 each and is coming soon. <a href="/pricing">Join the waitlist</a></p></div>`);
  d.querySelectorAll('[data-swap]').forEach(b => b.addEventListener('click', async () => {
    d.querySelectorAll('[data-swap]').forEach(x => { x.disabled = true; });
    b.textContent = 'Unfollowing…';
    await fetch('/api/follow/' + b.dataset.swap, { method: 'DELETE' });
    location.href = follow;
  }));
}
// Every Choose Solo opens Stripe's payment page at once (screen 4, decision 6); Pricing stays in the top bar for comparing.
export const SOLO_BTN = '<form class="solo" method="post" action="/billing/checkout" data-sending="Opening payment…"><input type="hidden" name="plan" value="solo"><button class="btn sm" type="submit">Choose Solo, $49 a month excl. VAT</button></form>';

// Client-side: the list's controls + row details, for any table rendered with rowsHTML.
// The stage (data-lv, one at a time, "All" clears it), the landscape's own filters (data-f, one at a
// time), China-based (data-cn, on or off) and the find field all combine. `select`: the phone's stage drop-down.
// `total`: drugs in the landscape; `rows`: how many of them are in the table (fewer for the top 10).
export function wireTable(table, { chips, input, select, count, none, total, rows = total, dev = false }) {
  const sorted = dev ? 'still in development first, then by stage and next date' : 'sorted by stage, then next date';
  let f = 'all', lv = '', cn = false;
  const paint = () => {
    chips?.querySelectorAll('[aria-pressed]').forEach(x => x.setAttribute('aria-pressed', x.dataset.lv !== undefined ? x.dataset.lv === lv : x.dataset.cn !== undefined ? cn : x.dataset.f === f));
    if (select) select.value = lv;
  };
  const apply = () => {
    const q = (input?.value || '').trim().toLowerCase();
    let n = 0;
    table.querySelectorAll('tbody tr[data-f]').forEach(tr => {
      const fs = tr.dataset.f.split(' ');
      const show = (f === 'all' || fs.includes(f)) && (!cn || fs.includes('china')) && (!lv || tr.dataset.lv === lv) && (!q || tr.dataset.q.includes(q));
      tr.hidden = !show; if (show) n++;
      if (!show) { table.querySelectorAll(`tr[data-detail="${tr.dataset.i}"]`).forEach(d => { d.hidden = true; }); tr.querySelector('[data-toggle]')?.setAttribute('aria-expanded', 'false'); }
    });
    paint();
    if (count) count.textContent = `${n === total ? `${total} ${total === 1 ? 'drug' : 'drugs'}` : `${n === rows && rows < total ? `Top ${n}` : n} of ${total} drugs`}, ${sorted}`;
    if (none) {
      none.hidden = n > 0; table.hidden = n === 0;
      const on = [...(chips?.querySelectorAll('[aria-pressed="true"]') || [])].filter(x => x.dataset.lv !== '').map(x => x.firstChild.textContent.trim());
      none.querySelector('span').textContent = q || on.join(', ');
    }
  };
  chips?.addEventListener('click', e => {
    const b = e.target.closest('button[aria-pressed]'); if (!b) return;
    if (b.dataset.lv !== undefined) lv = b.dataset.lv;
    else if (b.dataset.cn !== undefined) cn = !cn;
    else f = f === b.dataset.f ? 'all' : b.dataset.f;
    apply();
  });
  select?.addEventListener('change', () => { lv = select.value; apply(); });
  input?.addEventListener('input', apply);
  none?.querySelector('button').addEventListener('click', () => { if (input) input.value = ''; f = 'all'; lv = ''; cn = false; apply(); });
  table.addEventListener('click', e => {
    // A press anywhere on a row opens it, except on a link or a tooltip word.
    const tr = e.target.closest('tr[data-i]'); if (!tr || (e.target.closest('a, .tip, .word') && !e.target.closest('[data-toggle]'))) return;
    const b = tr.querySelector('[data-toggle]'); if (!b || getSelection().toString()) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    table.querySelectorAll(`tr[data-detail="${b.dataset.toggle}"]`).forEach(d => { d.hidden = !open; });
    b.setAttribute('aria-expanded', String(open));
  });
  apply();
}
