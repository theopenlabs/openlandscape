// The signed-in dashboard pages, all in the sidebar frame:
// - Home (/app): What changed and Coming up of everything followed (landscapes, drugs, companies), plus the MCP connector
//   and Settings panels, switched by the # part of the address (#home, #mcp, #settings). Home loads no landscape's drug list.
// - Search (/app/search?q=…&p=2): web/app.js draws the results and keeps each search in the browser's history.
// - One followed landscape (/app/l/<id>). A checked landscape is its public page instead (/landscapes/obesity).
import { esc, milestonePlain, shortDate, landscapeBody, SOLO_BTN, sourcesRow, exportActs, limitBox } from '../../web/table.js';
import { heading } from '../suggest.js';
import { today } from '../query.js';
import { icon } from '../../web/icons.js';
import { BRAND, prettyDate, layout, pageHead } from './shared.js';
import { sidebar, planName, SEARCH_PATH, APP_HOME, appPath, themeSwitch } from './frame.js';
import { mcpSetupHTML, aiSetupBox, askBox, MCP_SETUP_SCRIPT } from './connect.js';
import { WELCOME_PATH } from './start.js';
import { GOOGLE_G } from './signin.js';
import { LIMITS } from '../auth.js';

// Old addresses (emails, bookmarks): /app#l=12 and /app#search=obesity&p=2 now have pages of their own. Runs before anything
// is drawn, and replaces the old address so Back does not return to it.
const OLD_LINKS = `<script>(function(){var h=location.hash,m;
if((m=h.match(/^#l=(\\d+)/)))location.replace(${JSON.stringify(appPath('/l/'))}+m[1]);
else if((m=h.match(/^#(?:search|map)=([^&]*)&p=(\\d)/)))location.replace(${JSON.stringify(SEARCH_PATH)}+'?q='+m[1]+'&p='+m[2]);
else if(h==='#search'||h==='#map')location.replace(${JSON.stringify(SEARCH_PATH)});})();</script>`;

// "ClinicalTrials.gov release of 6 Nov (stamped 10:00); loaded here 6 Nov 21:15 UTC": the detail behind "Data updated".
const hm = iso => iso ? `${prettyDate(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC` : '';
// Home's "Updated" tooltip: one short line each, nothing left out. ClinicalTrials.gov publishes on weekdays, so over a weekend
// the date stays on Friday's release while the hourly check line shows today.
export function releaseLine(r, nChanges, fda = '', now = '') {
  const when = iso => { const d = iso.slice(0, 10); return `${d === now ? 'today' : prettyDate(d).replace(/ \d{4}$/, '')} ${iso.slice(11, 16)} UTC`; };
  const day = d => prettyDate(d).replace(/ \d{4}$/, '');
  return [
    r.release ? `Trials: ClinicalTrials.gov, ${day(r.release.slice(0, 10))} (${r.release.slice(11, 16)} US time)` : '',
    r.loaded_at ? `Loaded here ${when(r.loaded_at)}` : '',
    fda ? `FDA: openFDA, ${day(fda)}` : '',
    r.checked_at ? `Last checked ${when(r.checked_at)} (every hour)` : '',
    nChanges != null ? `${nChanges} ${nChanges === 1 ? 'change' : 'changes'} in what you follow` : '',
  ].filter(Boolean).join('\n');
}

const cap = q => q[0].toUpperCase() + q.slice(1);
const flink = (u, t) => u ? `<a href="${esc(u)}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>` : t;
const daysFrom = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const stageLine = pm => (pm >= 2 ? `Phase ${pm} and later` : 'Every stage');
const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- one event in plain words ----------
// What happened, as a headline, and where it comes from in grey. The full quote stays one click away at the source.
// `bad`: a setback (rejection, withdrawal, delay, a stopped trial), shown in darker text.
const SEC_DID = { 'material agreement': 'signed a material agreement', 'acquisition or sale of assets': 'bought or sold assets', results: 'reported results', 'new debt': 'took on new debt',
  'unregistered share sale': 'sold shares privately', 'director or officer change': 'changed a director or officer', 'public disclosure': 'made a public disclosure', 'other events': 'reported other events' };
const brand = s => { const b = String(s).split(/,| \(/)[0].trim(); return /^[A-Z0-9 -]+$/.test(b) ? b.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ') : b; };
const joinAnd = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
export function eventWords(i) {
  const t = String(i.text || '');
  let m;
  if (i.kind === 'deal' && (m = t.match(/^SEC (\S+?): (.+)$/))) {
    const did = m[2].split(', ').map(x => SEC_DID[x.replace(/ \(item [\d.]+\)$/, '')]).filter(Boolean);
    return { what: /securities offering/.test(m[2]) ? 'Offered securities to investors' : did.length ? cap(joinAnd(did)) : 'Filed a report', src: `SEC ${m[1]}` };
  }
  if ((m = t.match(/^FDA approval of a new use: (.+)$/))) return { what: 'FDA approved a new use', src: brand(m[1]) };
  if ((m = t.match(/^FDA approval: (.+)$/))) return { what: 'Approved by the FDA', src: brand(m[1]) };
  if ((m = t.match(/^European Commission marketing authorisation: (.+)$/))) return { what: 'Approved in the EU', src: `European Commission, ${brand(m[1])}` };
  if ((m = t.match(/^CHMP positive opinion: (.+)$/))) return { what: 'Recommended for approval in the EU', src: `CHMP opinion, ${brand(m[1])}` };
  if ((m = t.match(/^CHMP negative opinion: (.+)$/))) return { what: 'Not recommended for approval in the EU', src: `CHMP opinion, ${brand(m[1])}`, bad: true };
  if ((m = t.match(/^EU marketing authorisation refused: (.+)$/))) return { what: 'Refused approval in the EU', src: brand(m[1]), bad: true };
  if ((m = t.match(/^EU application withdrawn: (.+)$/))) return { what: 'Application withdrawn in the EU', src: brand(m[1]), bad: true };
  if ((m = t.match(/^EMA (?:evaluation|rolling review) started: (.+)$/))) return { what: 'Application filed in the EU', src: `EMA, ${brand(m[1])}` };
  if (/^FDA complete response letter/.test(t)) return { what: 'FDA did not approve it (complete response letter)', src: (t.match(/\((\w+ \d+)\)/) || [])[1] || 'FDA', bad: true };
  if (i.kind === 'delay' && (m = t.match(/^(\w+) review extended.*?, per (.+?) SEC (\S+?):/))) {
    const who = m[2].replace(/\b(PLC|INC\.?|CORP\.?|LTD\.?|CO\.?|AG|SA|NV)$/i, '').trim();
    return { what: `${m[1] === 'US' ? 'FDA' : m[1] === 'EU' ? 'EMA' : m[1]} extended its review${m[1] === 'US' ? ' (new PDUFA date)' : ''}`, src: `${/^[A-Z0-9 &.-]+$/.test(who) ? who.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ').replace(/^Astrazeneca$/, 'AstraZeneca') : who} SEC ${m[3]}${i.date && i.date !== i.decision_date ? `, found ${shortDate(i.date, i.date.slice(0, 4))}` : ''}`, bad: true };
  }
  if (i.kind === 'catalyst') return { what: t.replace(/^New catalyst: /, 'New milestone: '), src: 'press release' };
  if (['new_trial', 'status', 'phase', 'date'].includes(i.kind)) return { what: t, src: i.nct ? `ClinicalTrials.gov ${i.nct}` : 'ClinicalTrials.gov', bad: !!i.stopped };
  return { what: t.replace(/: “[\s\S]*$/, ''), src: i.agency || '', bad: ['rejection', 'withdrawal', 'delay'].includes(i.kind) };
}

// ---------- list rows, one line each: date, drug or company, what happened with its source in grey, and on Home the landscape ----------
// A date change in several trials names the registry and "3 trials" (each move in the tooltip) in place of one trial number.
// Nothing wraps: a long event ends in "…" (its full words are the row's title). `l`: the landscape a row belongs to, named at
// the end of the row on Home when there is more than one.
// `ls`: the landscapes a row belongs to. One event in two landscapes (a company's filing) is one row naming both.
// Two or more: the first, then "+1" (all of them in the title), so the row's end stays one tag wide.
const landLink = ls => (ls?.length ? `<span class="in" title="${esc(ls.map(l => heading(l.query)).join(', '))}"><a class="pill" href="${esc(ls[0].href)}">${esc(heading(ls[0].query))}</a>${ls.length > 1 ? ` <span class="pill">+${ls.length - 1}</span>` : ''}</span>` : '');
const dataL = ls => (ls?.length ? ` data-l="${ls.map(l => l.id).join(' ')}"` : '');
// Rows that say the same thing in several landscapes become one row with all of them.
const mergeRows = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r), had = m.get(k); if (had) had.ls.push(...r.ls); else m.set(k, { ...r, ls: [...r.ls] }); } return [...m.values()]; };
// `cut`: rows dated before it (14 days ago) are "Earlier": web/app.js puts them under that line and leaves them out of the count.
function changeRow(i, ls, year, cut = '') {
  const w = eventWords(i);
  const name = i.company_id ? `<a class="plainlink" href="/companies/${encodeURIComponent(i.company_id)}">${esc(i.drug)}</a>` : esc(i.drug);
  const moves = i.moves && i.moves.length > 1 ? ` · <span class="tip" tabindex="0" data-tip="${esc(i.moves.map(m => `${m.nct}: ${m.from_label || 'none'} to ${m.to_label || 'none'}`).join('; '))}">${i.moves.length} trials</span>` : '';
  return `<li${dataL(ls)}${w.bad ? ' class="bad"' : ''}${i.date < cut ? ' data-old="1"' : ''}><span class="when">${esc(shortDate(i.decision_date || i.date, year))}</span><span class="who"><b>${name}</b></span>
<span class="ev" title="${esc(w.what)}">${flink(i.url, esc(w.what))}<span class="src">${moves ? ' · ClinicalTrials.gov' + moves : w.src ? ` · ${esc(w.src)}` : ''}</span></span>${landLink(ls)}</li>`;
}
function milestoneRow(c, ls, now, year) {
  const soon = c.date.length === 10 && c.date <= daysFrom(now, 7), what = milestonePlain(c.what);
  return `<li${dataL(ls)}><span class="when">${esc(shortDate(c.date, year))}${soon ? '<span class="tag soon">soon</span>' : ''}</span><span class="who"><b>${esc(c.drug)}</b></span>
<span class="ev" title="${esc(what)}">${flink(c.source, esc(what))}<span class="src">${c.kind === 'news' ? ' · press release' : ''}</span></span>${landLink(ls)}</li>`;
}
// A list. With `max` it shows its first rows and web/app.js opens the rest ("All 58 upcoming"); without, it shows them all.
const feed = (id, max, rows, empty) => (rows ? `<ul class="feed${rows.includes('class="in"') ? ' lands' : ''}"${id ? ` id="${id}"` : ''}${max ? ` data-max="${max}"` : ''}>${rows}</ul>` : `<p class="muted nothing">${empty}</p>`);
const moreBtn = (id, all) => `<button class="linkbtn more" type="button" data-more="${id}" data-all="${all}" hidden></button>`;
const NO_CHANGES = 'No changes yet. Each one shows here the day it happens.';
const NO_DATES = 'Nothing dated in the next 60 days';
// A list in a box with its header: icon, title, count, and "All N" on the right. `max` rows first (Home 6, a landscape 3).
const box = (title, ic, id, rows, empty, all, max = 6) => `<section class="box"><div class="boxhead">${icon(ic)}<h2>${title}<span class="count" data-count="${id}"></span></h2>${moreBtn(id, all)}</div>${feed(id, max, rows, empty)}</section>`;

// Free's What changed (screen 6), the same on Home and on the landscape's page: what kind of change each was and when, never
// which drug or company; then why Solo. `max` rows, then "and N more". Nothing new: one grey line, no button.
const KIND_WORDS = { approval: 'approved a drug', rejection: 'turned down a drug', delay: 'delayed a decision', opinion: 'gave an opinion on a drug', regulatory_filing: 'accepted a filing for approval', withdrawal: 'saw an application withdrawn' };
const months = d => { const a = Math.abs(d); return a < 60 ? `${Math.round(a / 7)} weeks` : `${Math.round(a / 30.4)} months`; };
export function kindLine(i) {
  const t = String(i.text || '');
  if (i.kind === 'new_trial') return t.replace(/^New (.*?) ?trial registered$/, (_, ph) => `A new ${ph ? ph + ' ' : ''}trial was registered`) || 'A new trial was registered';
  if (i.kind === 'phase') return t.replace(/^Trial phase changed/, 'A trial’s phase changed');
  if (i.kind === 'status') return t.replace(/^Trial /, 'A trial ');
  if (i.kind === 'date') {
    if (i.moves?.length > 1) return t;
    const d = i.moves?.[0]?.days;
    return d == null ? 'A trial’s completion date changed' : `A trial’s completion date moved ${months(d)} ${d > 0 ? 'later' : 'earlier'}`;
  }
  if (KIND_WORDS[i.kind]) return `${i.agency && i.agency !== 'SEC' ? `The ${i.agency}` : 'A regulator'} ${KIND_WORDS[i.kind]}`;
  if (i.kind === 'catalyst') return 'A new date was announced';
  if (i.kind === 'news') return 'A company announced news';
  return 'A company filed with the SEC';
}
export function freeChangedBox(f, { max = 6 } = {}) {
  const now = today(), year = now.slice(0, 4), since = f.opened === now ? 'Since today' : `Since ${esc(shortDate(f.opened, year))}`;
  const head = `<div class="boxhead">${icon('pulse')}<h2>What changed${f.unseen ? `<span class="count">${f.unseen}</span>` : ''}</h2><span class="more">${since}</span></div>`;
  if (!f.unseen) return `<section class="box fcbox">${head}<p class="muted nothing">No changes in ${esc(heading(f.query))} ${f.opened === now ? 'yet' : `since ${esc(shortDate(f.opened, year))}`}. When something changes, you see what kind of change here.</p></section>`;
  const rows = (f.seen || []).slice(0, max).map(i => `<li><span class="when">${esc(shortDate(i.date, year))}</span><span>${esc(kindLine(i))}</span></li>`);
  const rest = f.unseen - rows.length;
  if (rest > 0) rows.push(`<li class="rest"><span class="when"></span><span>and ${rest} more</span></li>`);
  return `<section class="box fcbox">${head}<ul class="feed">${rows.join('')}</ul>
<div class="upsell"><p><b>Solo shows which drug it was</b>, and each change the day it happens.</p><div class="acts">${SOLO_BTN.replace('btn sm', 'btn primary')}</div></div></section>`;
}

// What changed and Coming up of one followed landscape, side by side above its drugs (landscape pass, 12 Nov): three rows
// each, "All N" opens the rest in place. On Free, What changed says how many changes there were since it was opened.
// Used by a followed landscape's page in the app and by a followed ready-made landscape's public page.
export function followBoxes(f, { paid }) {
  const now = today(), year = now.slice(0, 4);
  const changed = paid
    ? `<div id="chbox-${f.id}">${box('What changed', 'pulse', `ch-${f.id}`, f.changes.items.map(i => changeRow(i, null, year, daysFrom(now, -14))).join(''), NO_CHANGES, 'changes', 3)}</div>`
    : freeChangedBox(f, { max: 3 });
  const coming = box('Coming up', 'calendar', `up-${f.id}`, f.catalysts.map(c => milestoneRow(c, null, now, year)).join(''), NO_DATES, 'upcoming', 3);
  return `<div class="duo">${changed}${coming}</div>`;
}

// The plan in words. Prices are the ones on the pricing page (build plan, section 1).
const planPrice = u => (u.plan === 'free' ? '' : u.plan.startsWith('solo') ? (u.plan.endsWith('_year') ? ', $490 a year, excl. VAT' : ', $49 a month, excl. VAT') : u.plan.endsWith('_year') ? ', paid yearly' : '');

// Before the first search: examples you can press, as the same round buttons the filters use. Each starts with a capital.
const STARTER = ['heart failure', "Alzheimer's disease", 'GLP-1', 'PD-1', 'Novo Nordisk', 'retatrutide'];
const tryHTML = () => `<div class="starter try"><span class="muted small">Try</span>${STARTER.map(q => `<button class="chip" type="button" data-q="${esc(q)}" data-p="2">${esc(cap(q))}</button>`).join('')}</div>`;
// The ready-made landscapes: one box, one line each: what it is, how big, what is next.
const showRows = (list, year, go) => `<div class="showbox">${list.map(x => `<a href="/landscapes/${esc(x.slug)}"><b>${esc(x.plain || x.title)}</b><span>${nOf(x.stats.programs, 'drug', 'drugs')}, ${x.phase_min >= 2 ? `Phase ${x.phase_min} and later` : 'every stage'}</span><span>${x.stats.next ? `Next: ${esc(shortDate(x.stats.next.date, year))} · ${esc(x.stats.next.drug)}` : ''}</span><span class="go">${go}</span></a>`).join('')}</div>`;
// On Home and Search: the rows in a box with its header, like What changed and Coming up. On a paid plan: "Open one to follow it".
export const showcaseBox = (list, year, paid = false) => `<section class="box starter" id="ready"><div class="boxhead">${icon('landscape')}<h2>Ready-made landscapes</h2><span class="more">${paid ? 'Open one to follow it' : 'Free to read in full'}</span></div>${showRows(list, year, icon('chevron', 16))}</section>`;

// The search bar. The earliest stage is our dropdown (web/ui.js builds it from the select). On a phone only the Search page offers it,
// inside the bar under its short name (data-short: "Phase 2+"). Also on a page not found (src/pages/notfound.js).
export const searchForm = (id, placeholder = 'Search a disease, drug, target or company') => `<form class="search${id === 'hform' ? ' nostage' : ''}" id="${id}" role="search" action="${SEARCH_PATH}" method="get" data-search>
      <div class="search-field">${icon('search')}
      <label class="sr" for="${id}-q">Disease, target, drug or company</label>
      <input id="${id}-q" name="q" placeholder="${placeholder}" autocomplete="off" maxlength="120"></div>
      <span class="dd-sep" aria-hidden="true"></span>
      <select name="p" data-dd="quiet" aria-label="Earliest stage"><option value="1" data-short="Any stage" data-d="Every drug in an active trial, including early safety trials">Any stage</option><option value="2" data-short="Phase 2+" data-d="Leaves out drugs only in early safety trials" selected>Phase 2 and later</option><option value="3" data-short="Phase 3+" data-d="Only drugs in large late-stage trials, filed or approved">Phase 3 and later</option></select>
      <button class="btn primary" type="submit">Search</button>
    </form>`;

// `view`: 'home', 'search' or 'landscape' (then `landscape` is the one followed landscape, with its drugs and changes).
// On Home each followed landscape arrives with only what Home shows: its changes (paid) or a count of them (Free), and its dates.
// `welcome`: the plan's name, right after paying (/app?paid=solo). `kept`: Free has just kept this landscape (?kept=1).
export function appPage({ view = 'home', landscape = null, user, paid, followed, release, data, flash, notice = '', showcase = [], origin = '', keys = [], connected = null, followLimit = 5, welcome = '', kept = false, ai = null, lookups = null, guide = '', gone = false }) {
  const now = today(), year = now.slice(0, 4);
  const updated = hm(release.loaded_at) || prettyDate(data.trials);
  const updatedDay = prettyDate((release.loaded_at || data.trials || '').slice(0, 10));
  const many = followed.length > 1;   // name the landscape after each event only when there is more than one
  const mine = followed[0];           // on Free: the one landscape that is theirs
  const onHome = view === 'home';
  // The line under Home's title: what this page is.
  const things = nOf(followed.length, 'thing', 'things');
  const homeDesc = !followed.length ? (paid ? `Search any disease, drug, target or company. Follow up to ${followLimit} landscapes, companies or drugs to see every change as it happens.` : 'Search any disease, drug, target or company. One landscape opens in full, free, and stays yours.')
    : paid ? `What changed in the ${followed.length === 1 ? 'one thing' : things} you follow, and the dates coming up.` : 'Your free landscape and the dates coming up in it.';


  // ---- Home ----
  // The same change or date in two landscapes (a company or drug both hold) is one row that names both.
  const all = paid && onHome ? mergeRows(followed.flatMap(f => f.changes.items.map(i => ({ i, ls: many ? [f] : [] }))), ({ i }) => [i.drug, i.decision_date || i.date, i.text, i.url].join('|'))
    .sort((a, b) => (b.i.decision_date || b.i.date).localeCompare(a.i.decision_date || a.i.date)) : [];
  const coming = !onHome ? [] : mergeRows(followed.flatMap(f => f.catalysts.map(c => ({ c, ls: many ? [f] : [] }))), ({ c }) => c.drug + c.date + c.what)
    .sort((a, b) => (a.c.date + '-99').slice(0, 10).localeCompare((b.c.date + '-99').slice(0, 10)));
  // One box under the other, both the full width: What changed, then Coming up. Six rows each; "All N" in the box's header.
  const comingUp = box('Coming up', 'calendar', 'home-up', coming.map(({ c, ls }) => milestoneRow(c, ls, now, year)).join(''), NO_DATES, 'upcoming');
  // Three numbers at the top: changes in the last 14 days (the sidebar's counts added up), dates in the next 30 days, the next date.
  const dayOf = c => (c.date + '-28').slice(0, 10);   // a month-only date counts as late in its month
  const cut14 = daysFrom(now, -14), in30 = coming.filter(({ c }) => dayOf(c) <= daysFrom(now, 30)), in7 = coming.filter(({ c }) => c.date.length === 10 && c.date <= daysFrom(now, 7));
  // Changes in the last 14 days, each once even when two landscapes hold it: the What changed count under it shows the same.
  const recentN = all.filter(({ i }) => i.date >= cut14).length;
  const dataTip = releaseLine(release, followed.length && paid && onHome ? recentN : null, data.fda, now);
  const setbacks = all.filter(({ i }) => i.date >= cut14 && eventWords(i).bad).length;
  const next = coming[0]?.c;
  const stat = (k, v, sub) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  // The three numbers go while all three are zero; they come back with the first change or date (screen 4).
  const quiet = !recentN && !in30.length && !next;
  const stats = quiet ? '' : `<div class="stats">${stat('Changes, last 14 days', recentN, setbacks ? nOf(setbacks, 'setback', 'setbacks') : 'No setbacks')}
    ${stat('Dates, next 30 days', in30.length, in7.length ? `${in7.length} in the next 7 days` : 'None in the next 7 days')}
    ${stat('Next date', next ? esc(shortDate(next.date, year)) : 'None', next ? `${esc(next.drug)} · ${esc(milestonePlain(next.what))}` : NO_DATES)}</div>`;
  const freeChanged = f => freeChangedBox(f);
  // Nothing yet in what they follow: one line on what will happen, and the next step (screen 4).
  const noChanges = `No changes yet in ${many ? 'what you follow' : followed[0] ? esc(heading(followed[0].query)) : ''}. Each one shows here the day it happens, and in Monday’s email.`;
  const noDates = followed.length < followLimit ? `${NO_DATES}.<br><a class="nextlink" href="${SEARCH_PATH}">${icon('plus', 16)}Follow something else (${followed.length} of ${followLimit} used)</a>` : NO_DATES;
  const home = !onHome ? '' : !followed.length ? `
    ${showcaseBox(showcase, year, paid)}`
    : paid ? `
    ${stats}
    ${many ? `<div class="toolbar" id="homefilter"><button class="chip" aria-pressed="true" data-l="all">All</button>${followed.map(f => `<button class="chip" aria-pressed="false" data-l="${f.id}">${esc(heading(f.query))}</button>`).join('')}</div>` : ''}
    <div id="homefeed">${box('What changed', 'pulse', 'home-ch', all.map(({ i, ls }) => changeRow(i, ls, year, cut14)).join(''), noChanges, 'changes')}
      ${box('Coming up', 'calendar', 'home-up', coming.map(({ c, ls }) => milestoneRow(c, ls, now, year)).join(''), noDates, 'upcoming')}</div>`
    : `
    <div id="homefeed">${freeChanged(mine)}
      ${comingUp}</div>`;
  // Right after paying (screen 5, decision 7): a short welcome, fading in. No name: it is about Solo.
  const first = followed[0];
  const fact = (ic, b, sub) => `<li>${icon(ic, 18)}<b>${b}</b><span>${sub}</span></li>`;
  const welcomeBox = !welcome || !onHome ? '' : `<section class="box welcome note" aria-label="Welcome to ${esc(welcome)}">
    <p class="kicker">${esc(welcome)}${user.founding ? ' · Early customer' : ''}</p>
    <h2>Welcome to ${esc(welcome)}.</h2>
    <p class="lead">Thank you for joining us this early. ${first ? `You follow ${esc(heading(first.query))}${followed.length > 1 ? ` and ${followed.length - 1} more` : ''}. Here is what you have now:` : 'Here is what you have now:'}</p>
    <ul class="facts">
      ${fact('landscape', `Follow up to ${followLimit}`, 'Landscapes, companies or drugs')}
      ${fact('pulse', 'Every change', 'The day it happens')}
      ${fact('calendar', 'A Monday email', 'The week in one read')}
    </ul>
    <p class="ps">Something missing or wrong? <a href="/talk">Write to us</a>. We read every message.</p>
  </section>`;

  // ---- one landscape (landscape pass, 12 Nov): the title, one grey line, Following under it; What changed and Coming up side by
  // side; the drugs in their box with Copy table and Download in its header; About this list at the bottom. No tabs.
  const landscapePanel = f => {
    const L = f.L, title = esc(heading(f.query));
    const s = L.stats, none = !L.programs.length;
    const menu = paid ? `<div class="menu"><button class="btn sm" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="fm-${f.id}">${icon('check', 16)}Following${icon('chevron', 16)}</button>
          <div class="menu-box" id="fm-${f.id}"><p class="mh">You get every change as it happens, and the Monday email.</p>
            <button class="mi" type="button" data-check="${f.id}"><span>Check SEC filings now</span><span class="d">They are checked every hour on their own</span></button>
            <hr><button class="mi" type="button" data-unfollow="${f.id}"><span>Unfollow</span><span class="d">Stops the changes and the email for ${title}</span></button></div></div>` : '';
    return `<section class="panel ds" id="p-l${f.id}" data-landscape="${esc(f.query)}" data-phase="${f.phase_min}">
      ${pageHead(title, `${none ? 'No drugs in active trials' : `${f.limit?.kind === 'over' ? `Top ${L.programs.length} of ` : ''}${nOf(s.programs, 'drug', 'drugs')} in ${nOf(s.trials, 'active trial', 'active trials')}`} · ${stageLine(f.phase_min)} · updated ${updatedDay}`, menu)}
      ${kept ? `<p class="okline">${icon('check', 16)}<span><b>${title} is your free landscape.</b> Every drug, company and date, kept up to date.</span></p>` : ''}
      <p class="checkline" id="log-${f.id}" role="status" hidden></p>
      ${limitBox(f.limit)}
      ${followBoxes(f, { paid })}
      ${L.programs.length ? landscapeBody(L, `t${f.id}`, { head: exportActs({ paid, area: f.query, phase: f.phase_min, site: process.env.PUBLIC_URL || '' }), more: [sourcesRow([['ClinicalTrials.gov', prettyDate(data.trials)], ['openFDA', prettyDate(data.fda)], ['Company press releases']])] })
        : `<section class="box"><div class="boxhead">${icon('pill')}<h2>Drugs<span class="count">0</span></h2></div><p class="muted nothing">No drug is in an active ${f.phase_min >= 2 ? `Phase ${f.phase_min} or later ` : ''}trial for ${title} right now. When one is registered, it shows here and in What changed.</p></section>`}
    </section>`;
  };

  // ---- Settings (screen 6): boxes like Home. Profile is one row: the email, how they signed in, Sign out. Plan: what the plan
  // has, with the follows (Solo) or the free landscape and lookups (Free); Billing is a row there. Free sees Solo once, at its foot.
  const row = (k, v, d = '', act = '') => `<div><dt>${k}</dt><dd>${v}${d ? `<span class="d">${d}</span>` : ''}</dd><span class="ra">${act}</span></div>`;
  const via = user.signin_via === 'google' ? `<span class="via">${GOOGLE_G}With Google</span>` : user.signin_via === 'email' ? 'With a link sent to this email' : '';
  const max = LIMITS.free.mcp_calls, left = Math.max(0, max - (lookups || 0));
  const backOn = (() => { const d = new Date(`${now.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return shortDate(d.toISOString().slice(0, 10), year); })();
  const connect = connected?.app ? `<b>${esc(connected.app)}</b>` : connected?.key ? 'Connected with a key' : 'Not connected';
  const settings = `<section class="panel ds" id="p-settings">
    ${pageHead('Settings', 'Your account, your plan and how you pay.')}
    <section class="box"><div class="boxhead">${icon('user')}<h2>Profile</h2></div><dl class="rows">
      ${row('Signed in as', esc(user.email), via, '<form method="post" action="/auth/logout"><button class="btn sm" type="submit">Sign out</button></form>')}
      ${row('Theme', '<span id="themeword">Automatic</span>', '', themeSwitch())}
      ${user.guide_hidden === 1 ? row('Setup guide', 'Hidden', 'The steps to get going, in the corner of every page', '<button class="btn sm" type="button" id="showguide">Show it</button>') : ''}</dl></section>
    <section class="box"><div class="boxhead">${icon('card')}<h2>Plan</h2>${paid && user.founding ? '<span class="pill">Early customer</span>' : `<span class="pill">${esc(planName(user))}</span>`}</div><dl class="rows">
      ${paid ? row('Plan', `<b>${esc(planName(user))}</b>${planPrice(user)}`, 'Every landscape in full, every change the day it happens, a Monday email')
        : row('Plan', '<b>Free</b>', 'No card, no time limit')}
      ${paid ? `<div><dt>Following</dt><dd>${followed.length} of ${followLimit}${followed.length ? `<span class="fl">${followed.map(f => `<a class="pill" href="${esc(f.href)}">${esc(heading(f.query))}</a>`).join('')}</span>` : ''}</dd><span class="ra">${followed.length < followLimit ? `<a class="btn sm" href="${SEARCH_PATH}">Follow more</a>` : ''}</span></div>`
        : row('Your landscape', mine ? `<a href="${esc(mine.href)}">${esc(heading(mine.query))}</a>` : 'None yet', mine ? 'Yours for good. It cannot be swapped.' : 'Pick a disease or a target: its list opens in full, free, for good.', mine ? '' : `<a class="btn sm" href="${WELCOME_PATH}">Pick it</a>`)}
      ${row('AI lookups', paid ? '300 a day' : `<span class="lk"><span class="meterbar" role="img" aria-label="${left} of ${max} left"><i style="width:${Math.round(left / max * 100)}%"></i></span>${left} of ${max} left</span>`, paid ? '' : `This month. Back to ${max} on ${backOn}.`)}
      ${row('AI assistant', connect, '', `<a class="btn sm" href="#mcp">${connected?.app || connected?.key ? 'Manage' : 'Connect'}</a>`)}
      ${paid && user.stripe_customer ? row('Billing', 'Card, invoices or cancel', '', `<a class="btn sm" href="/billing/portal">Open billing${icon('external', 14)}</a>`) : ''}</dl>
      ${paid ? '' : `<div class="upsell"><h3>Solo, $49 a month, excl. VAT</h3><ul>${['Every landscape in full, not the top 10', 'Follow up to 5, see every change', 'A Monday email, 300 AI lookups a day'].map(t => `<li>${icon('check', 16)}<span>${t}</span></li>`).join('')}</ul>
        <div class="acts">${SOLO_BTN.replace('btn sm', 'btn primary')}<a href="/pricing">Compare plans</a></div></div>`}</section>
  </section>`;

  // ---- Connect your AI (screen 5): the screen-1 look, no tabs. The connector box says whether an app is connected; the
  // example questions; keys for apps without sign-in folded at the bottom.
  const keyRows = keys.length ? keys.map(k => `<div><code>${esc(k.prefix)}…</code><span class="muted small">created ${esc(k.created_at.slice(0, 10))}</span><span class="muted small">${k.revoked ? 'revoked' : k.last_used ? 'last used ' + esc(k.last_used.slice(0, 10)) : 'never used'}</span>${k.revoked ? '' : `<button class="btn sm" data-revoke="${k.id}" type="button">Revoke</button>`}</div>`).join('') : '<div class="muted">No keys yet.</div>';
  const mcp = `<section class="panel ds" id="p-mcp">
    ${pageHead('Connect your AI', 'Ask about any drug, trial or company from the AI app you already use. Every answer links to its source.')}
    ${aiSetupBox(origin, { ai: connected?.app || ai, lookups: paid ? null : lookups, ask: mine && !mine.kind ? `Which ${heading(mine.query)} drugs read out in the next six months, and who makes them?` : undefined })}
    ${askBox()}
    <details class="box keys" id="manual"><summary class="boxhead">${icon('settings')}<h2>Keys for apps without sign-in</h2><span class="more"><span class="nophone">For scripts and apps that cannot sign in</span>${icon('chevron', 16)}</span></summary>
    <div class="keys-body">
    <div class="step"><span class="n">1</span><div><b>Create a key</b><p class="muted small">The connector URL contains your key: keep it private. We show it once and store only a fingerprint. The steps below fill in your URL.</p>
      <div id="newkey"></div><button class="btn primary" id="mkkey" type="button">Create a key</button></div></div>
    <div class="step"><span class="n">2</span><div><b>Add it to your app</b>${mcpSetupHTML(`${origin}/mcp/u/YOUR_KEY`)}</div></div>
    <h3>Your keys</h3>
    <div class="keylist" id="keys">${keyRows}</div>
    </div></details>
  </section>`;

  // A Follow press on a public page that did not go through (src/server.js /follow): the search opens with the box that says why.
  const noticeKind = notice ? (paid ? 'full' : 'solo') : '';
  const views = {
    home: `<section class="panel on" id="p-home">
    <div class="homehead"><div><h1>Home</h1><p class="desc">${esc(homeDesc)}</p></div>
    <p class="upd tip" tabindex="0" data-tip="${esc(dataTip)}"${release.loaded_at ? ` data-at="${esc(release.loaded_at)}"` : ''}>Updated ${esc(updatedDay.replace(/ \d{4}$/, ''))}</p></div>
    ${welcomeBox}${home}
  </section>
  ${mcp}
  ${settings}`,
    search: `<section class="panel on" id="p-search">
    <div class="starter"><h1>Search</h1><p class="desc">${gone ? 'That landscape is in someone else’s account. Ask them for its name, or search it here.' : 'Every drug in active trials for a disease, a target, a drug or a company.'}</p></div>
    ${searchForm('dform', 'Search a disease, drug, target or company')}
    ${tryHTML()}
    ${paid && followed.length ? '' : showcaseBox(showcase, year, paid)}
    <div id="result" data-updated="${esc(updatedDay)}"></div>
  </section>`,
    landscape: landscape ? landscapePanel(landscape).replace('class="panel ds"', 'class="panel ds on"') : '',
  };
  const titles = { home: 'Dashboard', search: 'Search', landscape: landscape ? heading(landscape.query) : '' };
  return layout({
    title: `${titles[view]} | ${BRAND}`, user,
    body: `<div class="app" data-view="${view}" data-plan="${paid ? 'paid' : 'free'}" data-mine="${!paid && mine ? mine.id : ''}" data-follows="${followed.length}" data-limit="${followLimit}" data-connected="${esc(connected?.app || '')}" data-home="${APP_HOME}" data-search-path="${SEARCH_PATH}" data-site="${esc(process.env.PUBLIC_URL || '')}"${noticeKind ? ` data-notice="${noticeKind}"` : ''}>
${onHome ? OLD_LINKS : ''}${sidebar({ user, followed, inApp: onHome, on: view === 'landscape' ? 'l' + landscape?.id : view, guide })}
<div class="main">
  ${flash ? `<div class="flash">${flash}</div>` : ''}
  ${views[view]}
</div>
</div>
${onHome ? `<script>${MCP_SETUP_SCRIPT}</script>` : ''}
<script type="module" src="/static/app.js"></script>`,
  });
}
