// Drug, company and target pages (specs 15, 23 part 5, 24). Each has the one Follow button:
// a drug or a company is followed on its own, a target as a landscape. Data: src/query.js and src/entityquery.js. Script: web/entity.js.
import { esc, rowsHTML, explainHTML, landscapeBody, shortDate, milestonePlain, stagePlain, meter, drugName, sourcesRow, cleanAliases } from '../../web/table.js';
import { icon } from '../../web/icons.js';
import { BRAND, prettyDate, layout, footer, pageHead } from './shared.js';
import { nextOf } from '../entityquery.js';
import { eventWords } from './app.js';
import { today } from '../query.js';
import { signinDialog } from './signin.js';
import { searchHref } from './frame.js';
import fs from 'node:fs';

const extl = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : t;
const STATUS_PLAIN = { RECRUITING: 'Recruiting', NOT_YET_RECRUITING: 'Not yet recruiting', ACTIVE_NOT_RECRUITING: 'Active, not recruiting', ENROLLING_BY_INVITATION: 'Enrolling by invitation',
  COMPLETED: 'Completed', TERMINATED: 'Terminated', SUSPENDED: 'Suspended', WITHDRAWN: 'Withdrawn', UNKNOWN: 'Unknown' };
// Not checked by a person yet: the list's small grey words, with what that means on hover (landscape pass, 12 Nov).
const uncheckedTag = tip => ` <span class="word uc" tabindex="0" data-tip="${esc(tip)}">not checked</span>`;
export const drugHref = id => `/drugs/${encodeURIComponent(id)}`;
export const companyHref = id => `/companies/${encodeURIComponent(id)}`;
const targetLinks = ts => ts.map(t => `<a href="/targets/${t.id}">${esc(t.name)}</a>`).join(' · ');
const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cut = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t);
const year = d => (d || '').slice(0, 4);
// "23–25 Sep" for filings over a few days; "13 Nov" otherwise.
const span = (from, to, yr) => (from === to ? shortDate(to, yr) : `${from.slice(0, 7) === to.slice(0, 7) ? +from.slice(8, 10) : shortDate(from, yr)}–${shortDate(to, yr)}`);
// "soon": within 30 days of the data date, as on a landscape row. A month-only date counts from its last day.
const soon = (date, today) => { const e = date.length === 7 ? date + '-31' : date; return date.length >= 7 && e <= new Date(Date.parse(today) + 30 * 864e5).toISOString().slice(0, 10); };
const script = '<script type="module" src="/static/entity.js"></script>';

// ---------- Follow ----------
// A small button under the title's grey line, with what following gives beside it (landscape pass, 12 Nov). Signed out it
// opens the sign-in box over the page (src/pages/signin.js; without scripts, /follow asks to sign in), then follows. On Free it explains Solo, in words about what is on the screen. On Solo
// it follows; once followed it reads Following, with Unfollow under it.
// `following`: the saved_landscape row. `kind`: 'drug' | 'company', or null for a target (a landscape, followed by its words).
const followGo = ({ kind = null, id = '', q = '' }) => (kind ? `/follow?kind=${kind}&id=${encodeURIComponent(id)}` : `/follow?q=${encodeURIComponent(q)}&p=1`);
// Signed out: the sign-in box for this Follow press. `signin`: { lastGoogle } from src/server.js, null when signed in.
// "Sign up free" in it: a target's landscape can be kept, so it opens onboarding's in-between screen for it (step 12); a drug
// or company opens onboarding with a way back here (src/pages/signin.js).
const followBox = (signin, f) => (signin ? signinDialog({ ...signin, next: followGo(f), why: { follow: drugName(f.name), freeNext: f.kind ? '' : `${searchHref(f.q, 1)}&s=follow` } }) : '');
function followBtn({ kind = null, id = '', q = '', name, user, paid, following }) {
  const go = esc(followGo({ kind, id, q }));
  const gives = `<span>${kind === 'company' ? 'Every new trial, moved date and filing' : 'Every change as it happens'}, and a Monday email</span>`;
  if (following && (paid || !kind)) return paid ? `<div class="menu"><button class="btn sm" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="fm-${following.id}">${icon('check', 16)}Following${icon('chevron', 16)}</button>
  <div class="menu-box" id="fm-${following.id}"><p class="mh">You get every change as it happens, and the Monday email.</p>
    <button class="mi" type="button" data-unfollow="${following.id}"><span>Unfollow</span><span class="d">Stops the changes and the email for ${esc(name)}</span></button></div></div>`
    : `<a class="btn sm" href="${esc(following.href)}">${icon('check', 16)}Your landscape</a>`;
  if (user && !paid) return `<button class="btn sm" type="button" data-solo data-follow="${go}" data-name="${esc(drugName(name))}">${icon('plus', 16)}Follow</button>${gives}`;
  return `<a class="btn sm" href="${go}" data-signin>${icon('plus', 16)}Follow</a>${gives}`;
}
// A Follow press that did not go through (src/server.js `entityNotice`): web/entity.js opens the box that says why (screen 6).
// On Solo the follows are used up (the box swaps one out); on Free it is the Follow box with Solo and Free side by side.
const noticeHTML = (n, name, kind, id) => (!n ? '' : `<span hidden data-notice="${n.full ? 'full' : 'solo'}" data-name="${esc(drugName(name))}" data-follow="${esc(followGo({ kind, id }))}"></span>`);
// Four summary boxes, as on Home: a label, the fact, a grey line under it.
const stats = facts => `<div class="stats four">${facts.map(([l, v, sub]) => `<div class="stat"><div class="k">${l}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div></div>`).join('')}</div>`;
// A section in a box with its header: icon, title, grey count, and what sits at its right end.
const section = (ic, title, n, body, right = '', cls = '') => `<section class="box${cls ? ' ' + cls : ''}"><div class="boxhead">${icon(ic)}<h2>${title}${n !== '' && n != null ? `<span class="count">${n}</span>` : ''}</h2>${right ? `<span class="more">${right}</span>` : ''}</div>${body}</section>`;
const slot = notice => `<div class="slot" id="followslot">${notice}</div>`;
// Company logos (15 part 3, 19 part 3): fetched once (scripts/logos.mjs from Logo.dev, scripts/logos-site.mjs from the
// company's own website) and served from our own site. Shown once looked at by eye; no file means no logo. In dark mode
// the logo sits on a small white tile (web/style.css).
const LOGOS = JSON.parse(fs.readFileSync(new URL('../../web/logos/logos.json', import.meta.url), 'utf8'));
const logoOf = c => (LOGOS[c.id]?.file && !LOGOS[c.id].unchecked ? LOGOS[c.id] : null);

// One line a row (23 part 1): date, what happened or what is due, its source in grey.
const feedRow = (when, what, url, src = '', cls = '') => `<li${cls ? ` class="${cls}"` : ''}><span class="when">${when}</span><span class="ev" title="${esc(what.replace(/<[^>]+>/g, ''))}">${extl(url, what)}${src ? `<span class="src"> · ${src}</span>` : ''}</span></li>`;
const feed = (rows, max, label) => rows.length ? `<ul class="feed efeed"${max && rows.length > max ? ` data-max="${max}"` : ''}>${rows.join('')}</ul>${max && rows.length > max ? `<button class="linkbtn more boxmore" type="button" data-more>All ${rows.length} ${label}</button>` : ''}` : '';

// ---------- drug page ----------
// Header (name, owners and codes, the Follow button), the plain sentence, four facts, what it is, what is coming and what
// changed, then every trial once with its number in each registry (15 part 5).
export function drugPage(d, { user, paid = false, following = null, notice = null, trials = d.trials, euStage = null, inLandscapes = [], side = '', signin = null } = {}) {
  const ex = explainHTML(d.explain, { mechConfirmed: d.mechanism_confirmed });
  const owners = d.companies.length ? d.companies.map(c => `<a href="${companyHref(c.id)}">${esc(c.name)}</a>`).join(' · ') : d.company ? `<a href="${companyHref(d.company)}">${esc(d.company)}</a>` : '';
  const names = cleanAliases(d.name, d.aliases);   // without repeats or the registry's leftovers (web/table.js)
  const codes = names.filter(a => a.confirmed && /\d/.test(a.name)).slice(0, 2).map(a => `<span class="mono">${esc(a.name)}</span>`);
  const nx = nextOf(d), yr = year(d.data.trials);
  const [stage, where] = stagePlain(d.stage.label);
  const active = trials.filter(t => t.active).length, inEU = trials.filter(t => t.eu.length).length;
  // What this is: one aligned list, label left (08b part 3).
  const quote = (w, n) => `“${esc(cut(w.text, n))}”<span class="d">In the company’s words, ${extl(w.url, `${esc(w.nct)} on ClinicalTrials.gov`)}</span>`;
  const given = d.sponsor_words?.kind === 'intervention' ? d.sponsor_words : null;
  const what = [
    ['How it works', ex.plain ? `${ex.plain}<span class="d">${ex.term}</span>` : ex.term],
    given && ['How it’s given', quote(given, 400)],
    d.tested_for.length && ['Tested for', `${d.tested_for.slice(0, 8).map(c => `${esc(c.name)}${c.trials > 1 ? ` <span class="muted">(${c.trials} trials)</span>` : ''}`).join(', ')}${d.tested_for.length > 8 ? ` <span class="muted">and ${d.tested_for.length - 8} more</span>` : ''}`],
    d.summary && [`Main trial${d.summary.phase ? `<span class="d">${esc(d.summary.phase)}</span>` : ''}`, quote(d.summary, 600)],
    names.length && ['Other names', names.map(a => esc(a.name) + (a.confirmed ? '' : ' (unconfirmed)')).join(' · ')],
    d.other_use && ['Also', extl(d.other_use.url, esc(d.other_use.label))],
    d.copy_of?.length && ['Copy of', `${d.copy_of.map(c => `${esc(c.name)}${c.owner ? ` <span class="muted">(${esc(c.owner)})</span>` : ''}`).join(', ')}<span class="d">Tested side by side with the original in ${d.copy_of.flatMap(c => c.trials).slice(0, 3).map(n => extl(`https://clinicaltrials.gov/study/${n}`, esc(n))).join(', ')}</span>`],
    d.given_with?.length && ['Given with', `${d.given_with.slice(0, 8).map(c => `${esc(c.name)}${c.owner ? ` <span class="muted">(${esc(c.owner)})</span>` : ''}`).join(', ')}<span class="d">Other companies’ drugs in its trials</span>`],
  ].filter(Boolean);
  // Changes in plain words: a trial's change says what moved; a regulator's decision reads as on Home (eventWords).
  const CH = { new_trial: 'New trial', status: 'Status changed', phase: 'Phase changed', date: 'Completion date moved', catalyst: 'New milestone' };
  const plain = v => esc(STATUS_PLAIN[v] || v || 'none');
  const coming = d.catalysts.map(c => feedRow(esc(shortDate(c.date, yr)), esc(milestonePlain(c.what)), c.url, c.news ? 'press release' : 'ClinicalTrials.gov'));
  const changes = d.changes.map(c => {
    if (c.nct) return feedRow(esc(shortDate(c.date, yr)), `${CH[c.kind] || 'Trial changed'}${c.before || c.after ? `: ${plain(c.before)} to ${plain(c.after)}` : ''}`, c.url, `ClinicalTrials.gov ${esc(c.nct)}`);
    const w = eventWords(c);
    return feedRow(esc(shortDate(c.decision_date || c.date, yr)), esc(w.what), c.url, esc(w.src), w.bad ? 'bad' : '');
  });
  // Where it is approved or filed, each region linked to its source: "in the US and EU", "in the US · recommended in the EU".
  const eu = !euStage ? '' : euStage.kind === 'approval' ? (/^Approved/.test(d.stage.label) && where ? ` and ${extl(euStage.url, 'EU')}` : `${where ? ' · ' : ''}${extl(euStage.url, 'approved in the EU')}`)
    : `${where ? ' · ' : ''}${extl(euStage.url, 'recommended in the EU')}`;
  const place = `${esc(/^in /.test(where) ? where : '')}${eu}`.replace(/^ · /, '');
  const stageSub = [place, d.stage.news ? 'press release' : ''].filter(Boolean).join(' · ');
  // Trials: one row each; the trial cell holds one line per registry (NCT, then the EU number marked "EU", its countries on hover).
  const euLine = e => `<div>${extl(e.url, `<span class="mono">${esc(e.id)}</span>`)} <span class="word tip" tabindex="0" data-tip="${esc(e.countries.length ? `EU Clinical Trials register. Runs in ${e.countries.join(', ')}` : 'EU Clinical Trials register')}">EU</span></div>`;
  const shown = trials.slice(0, 300);
  const trialRows = shown.map(t => `<tr data-f="${[t.active ? 'active' : '', t.eu.length ? 'eu' : ''].join(' ').trim()}">
<td class="tn">${t.nct ? `<div>${extl(t.url, `<span class="mono">${esc(t.nct)}</span>`)}</div>` : ''}${t.eu.map(euLine).join('')}</td>
<td class="tp">${esc(t.phase || '—')}<span class="sub">${esc(STATUS_PLAIN[t.status] || t.status || '')}</span></td>
<td class="tc">${esc(t.primary_completion_label || 'not given')}</td>
<td class="tw" title="${esc(t.title || '')}">${esc(t.title || '')}</td></tr>`).join('');
  return layout({
    title: `${drugName(d.name)}: trials, stage and next milestones | ${BRAND}`, user, side, noindex: !d.curated, path: `/drugs/${encodeURIComponent(d.id)}`,
    image: `/img/og/drugs/${encodeURIComponent(d.id)}.png`,
    desc: `${drugName(d.name)}${d.company ? ` (${d.company})` : ''}: ${d.stage.label}, ${d.active_trials} active trials, next milestones and every source.`,
    body: `<main class="wrap ent ds">
${inLandscapes.length ? `<div class="crumbs">In: ${inLandscapes.map(l => `<a href="/landscapes/${l.slug}">${esc(l.title)}</a>`).join(', ')}</div>` : ''}
${pageHead(`${esc(drugName(d.name))}${d.curated ? '' : uncheckedTag('Grouped automatically from the names sponsors use in ClinicalTrials.gov and not checked yet, so names, owner and how it works may be incomplete.')}`, [owners, ...codes].filter(Boolean).join(' · '), followBtn({ kind: 'drug', id: d.id, name: d.name, user, paid, following }))}
${slot(noticeHTML(notice, d.name, 'drug', d.id))}
${stats([
    ['Stage', `${meter(Math.min(5, d.stage.label.match(/Phase (\d)/)?.[1] || (/^(Approved|Marketed|FDA)/.test(d.stage.label) ? 5 : /^Filed/.test(d.stage.label) ? 4 : 0)))}${extl(d.stage.url, esc(stage))}`, stageSub],
    ['Next date', nx ? `${extl(nx.url, esc(shortDate(nx.date)))}${soon(nx.date, today()) ? '<span class="tag soon">soon</span>' : ''}` : 'None yet', nx ? esc(milestonePlain(nx.what)) + (nx.news ? ' · press release' : '') : ''],
    ['Trials', `${active} active`, `${trials.length} in total${inEU ? ` · ${inEU} in the EU` : ''}`],
    ['Targets', d.targets.length ? targetLinks(d.targets) : '—', d.targets.length ? '' : 'None known yet'],
  ])}
${section('info', 'What this is', '', `<dl class="rows">${what.map(([k, v]) => `<div${/^(How it’s given|Main trial)/.test(k) ? ' class="deskonly"' : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)}
${d.copies?.length ? section('pill', 'Copies tested against it', d.copies.length, `<p class="boxnote">Other companies’ versions, mostly cheaper copies for when the patent ends</p>
<ul class="feed efeed">${d.copies.map(c => `<li><span class="who"><a class="plainlink" href="${drugHref(c.id)}"><b>${esc(c.name)}</b></a></span><span class="ev">${esc(c.sponsor)}<span class="src"> · ${c.trials.map(n => extl(`https://clinicaltrials.gov/study/${n}`, esc(n))).join(', ')}${c.active ? '' : ' · finished'}</span></span></li>`).join('')}</ul>`) : ''}
<div class="duo">${section('calendar', 'Coming up', coming.length, feed(coming, 6, 'dates') || '<p class="muted nothing">No dates coming up.</p>')}
${section('pulse', 'Changes', changes.length, feed(changes, 6, 'changes') || '<p class="muted nothing">No changes yet. We started recording changes on 6 Nov 2026.</p>', 'Last 90 days')}</div>
${d.fda.length ? section('check', 'FDA approvals', d.fda.length, `<ul class="feed efeed">${d.fda.map(f => feedRow(esc(prettyDate(f.approval_date)), `<b>${esc(f.brand)}</b> ${esc(f.sponsor)}`, `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${String(f.appl_no).replace(/\D/g, '')}`, `Application ${esc(f.appl_no)}`)).join('')}</ul>`) : ''}
${section('pill', 'Trials', trials.length, `<div class="listtools" id="trf"><div class="segs" role="group" aria-label="Trials"><button type="button" aria-pressed="true" data-f="all">All<b>${trials.length}</b></button><button type="button" aria-pressed="false" data-f="active">Active<b>${active}</b></button>${inEU ? `<button type="button" aria-pressed="false" data-f="eu">In the EU<b>${inEU}</b></button>` : ''}</div></div>
<table class="trials" id="trt"><thead><tr><th>Trial</th><th>Phase</th><th>Completes</th><th>What it tests</th></tr></thead><tbody>${trialRows}</tbody></table>
<div class="boxfoot">${trials.length > shown.length ? `The first ${shown.length} of ${trials.length} trials are listed here. ` : ''}A trial in both registries shows both numbers.</div>`, '', 'tablebox')}
${shown.length > 6 ? `<button class="linkbtn allrows" type="button" id="tra">All ${trials.length} trials</button>` : ''}
${section('info', 'About', '', `<dl class="rows about">${[sourcesRow([['ClinicalTrials.gov', prettyDate(d.data.trials)], ['EU trials register (CTIS)', prettyDate(d.data.trials)], ['openFDA', prettyDate(d.data.fda)]])].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)}
</main>${followBox(signin, { kind: 'drug', id: d.id, name: d.name })}${side ? '' : footer()}${script}`,
  });
}

// ---------- company page ----------
// Header (name, listing and home country, the Follow button), four facts, the drugs in the landscape rows (with the filter
// row from 10 drugs), the drugs with no active trial on one line, SEC filings as feed rows, and the sponsor names at the foot.
// `after`: a box under the drugs when the list is cut (server.js listCut: signed out, or past the account's allowance).
// `top`: the meter above the drugs when the account is past its allowance (server.js listCut).
export function companyPage(c, { user, paid = false, following = null, notice = null, side = '', signin = null, after = '', top: meter = '' } = {}) {
  const L = c.L, s = L.stats, yr = year(c.data.trials), progs = L.programs;
  const listing = c.listed === 1 ? `Public${c.ticker ? ` <span class="mono">${esc(c.ticker)}</span>` : ''}` : c.listed === 0 ? 'Private' : '';
  const sub = [listing, esc(c.country_name || '')].filter(Boolean).join(' · ');
  // Furthest along: the one drug at the top stage, or how many are at each of the top two.
  const top = s.by_phase.filter(b => b.count);
  const furthest = !progs.length ? ['None in active trials', ''] : top[0].count === 1
    ? [`<a class="plainlink" href="${drugHref(progs[0].id)}">${esc(progs[0].drug)}</a>`, '']
    : [`${top[0].count} ${top[0].name === 'Approved' ? 'approved' : top[0].name === 'Filed' ? 'filed' : `in ${top[0].name}`}`, top[1] ? `${top[1].count} ${top[1].name === 'Filed' ? 'filed' : `in ${top[1].name}`}` : ''];
  // One drug at the top: its stage, and where when that is not the US ("Approved in China").
  if (progs.length && top[0].count === 1) { const [st, wh] = stagePlain(progs[0].phase.label); furthest[1] = esc(`${st.replace(' for approval', '')}${/^in /.test(wh) && wh !== 'in the US' ? ' ' + wh : ''}`); }
  const nx = s.next;
  const many = progs.length >= 10;
  const drugsHead = `<div class="boxhead tablehead">${icon('pill')}<h2>Drugs<span class="count">${progs.length}</span></h2></div>`;
  const table = !progs.length ? section('pill', 'Drugs', 0, '<p class="muted nothing">No drugs in active trials.</p>') : many
    ? landscapeBody(L, 'c', { rows: false, own: c.name, head: '', after })
    : `<div class="landbody" id="c" data-total="${progs.length}" data-rows="${progs.length}"><div class="tablebox">${drugsHead}<table class="land" id="c-t">${rowsHTML(progs, { own: c.name })}</table>${after}</div></div>`;
  // Under the drugs and the filings: what else is known, as labelled rows on hairlines (the same rows a landscape uses),
  // not loose grey lines. Names of drugs with no active trial only for a short list or for checked drugs: Lilly's 100 are
  // mostly registry names ("Citrate buffer"), so that row is a count.
  const named = c.idle.length <= 5 ? c.idle : c.idle.filter(p => p.curated).slice(0, 8);
  const fil = c.filings.map(f => feedRow(esc(span(f.from, f.date, yr)), esc(f.what), f.url, esc(f.src)));
  const secLink = c.cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}` : '';
  const names = c.sponsor_names;
  const logo = logoOf(c);
  const about = [
    c.idle.length && ['No active trial', `${named.map(p => `<a href="${drugHref(p.id)}">${esc(p.name)}</a>`).join(', ')}${named.length < c.idle.length ? `${named.length ? ' and ' : ''}${nOf(c.idle.length - named.length, 'other drug', 'other drugs')}` : ''}`],
    !c.cik && ['SEC filings', c.listed === 0 ? `None: ${esc(c.name)} is private` : 'None: it does not file with the US SEC'],
    names.length > 1 && ['Registry names', `${names.length} names in ClinicalTrials.gov <button class="linkbtn" type="button" data-sponsors>Show</button><span class="d" hidden>${names.map(esc).join('<br>')}</span>`],
    sourcesRow([['ClinicalTrials.gov', prettyDate(c.data.trials)], ...(c.cik ? [['SEC filings']] : [])], `Industry-sponsored drug trials since 2021${logo?.source === 'Logo.dev' ? ' · <a class="credit" href="https://logo.dev">Logos provided by Logo.dev</a>' : ''}`),
  ].filter(Boolean);
  return layout({
    title: `${c.name}: drug pipeline and trials | ${BRAND}`, user, side, noindex: !c.curated, path: `/companies/${encodeURIComponent(c.id)}`,
    desc: `${c.name}: ${c.drugs_total} drugs, ${c.trials.active} active industry trials, each linked to its source.`,
    body: `<main class="wrap ent ds">
<div class="crumbs"><a href="/landscapes">Landscapes</a> / Companies</div>
${pageHead(`${esc(c.name)}${c.curated ? '' : uncheckedTag('A sponsor name as written in ClinicalTrials.gov. We have not researched this company yet.')}`, sub, followBtn({ kind: 'company', id: c.id, name: c.name, user, paid, following }),
    logo ? `<img class="clogo" src="/static/logos/${esc(logo.file)}" width="40" height="40" alt="">` : '')}
${slot(noticeHTML(notice, c.name, 'company', c.id))}
${stats([
    ['Furthest along', ...furthest],
    ['Next date', nx ? `${extl(nx.url, esc(shortDate(nx.date)))}${nx.soon ? '<span class="tag soon">soon</span>' : ''}` : 'None yet', nx ? `${esc(nx.drug)}, ${esc(milestonePlain(nx.what))}` : ''],
    ['Drugs', `${s.programs}`, `in active trials${c.drugs_total > s.programs ? ` · ${c.drugs_total} in all` : s.checked < s.programs ? ` · ${s.checked} checked` : ''}`],
    ['Trials', `${c.trials.active} active`, `${c.trials.total} since 2021`],
  ])}
${meter}${table}
${c.cik ? section('pulse', 'SEC filings', c.filings.length || '', feed(fil, 6, 'filings') || '<p class="muted nothing">No filings loaded yet.</p>', `${c.filings.length ? `Since ${esc(prettyDate(c.filings[c.filings.length - 1].from).replace(/^\d+ /, ''))} · ` : ''}${extl(secLink, 'All on SEC.gov')}`) : ''}
${section('info', 'About', '', `<dl class="rows about">${about.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)}
</main>${followBox(signin, { kind: 'company', id: c.id, name: c.name })}${side ? '' : footer()}${script}`,
  });
}

// ---------- target page ----------
// A target is a landscape: the title with "Follow landscape", one plain line on what the target is, the facts line, the next
// milestone, then the same filter row and table as every landscape (15 part 4, 23 part 4).
export function targetPage(t, { user, paid = false, following = null, line = null, side = '', signin = null, after = '', top = '' } = {}) {
  const L = t.landscape, s = L.stats;
  const desc = `${nOf(s.programs, 'drug acts', 'drugs act')} on ${esc(t.name)}, in ${nOf(s.trials, 'active trial', 'active trials')} · Any stage · updated ${prettyDate(L.data.trials)}`;
  return layout({
    title: `${t.name} drugs: pipeline by stage | ${BRAND}`, user, side, active: 'land',
    desc: `${s.programs} drugs acting on ${t.name}, by stage, with next milestones and sources.`,
    body: `<main class="wrap ent ds">
<div class="crumbs"><a href="/landscapes">Landscapes</a> / Targets</div>
${pageHead(esc(t.name), desc, followBtn({ q: L.area, name: t.name, user, paid, following }), '', line ? esc(line.text) : '')}
${user ? slot('') : ''}
${top}${s.programs ? landscapeBody(L, 't', { matches: false, head: '', after, more: [['Matches', 'The mechanism of checked drugs, and drug names, so a drug not checked yet may be missing.'], ...(line ? [['Description', `From ${extl(line.src[1], esc(line.src[0]))}`]] : []), sourcesRow([['ClinicalTrials.gov', prettyDate(L.data.trials)], ['openFDA', prettyDate(L.data.fda)]])] }) : '<p class="muted nothing">No drugs in active trials act on it.</p>'}
</main>${followBox(signin, { q: L.area, name: t.name })}${side ? '' : footer()}${script}`,
  });
}
