// Public landscape pages: one landscape, the list of ready-made ones, and the disease breakdown.
import { esc, landscapeBody, shortDate, milestonePlain, sourcesRow, drugName, exportActs } from '../../web/table.js';
import { BRAND, prettyDate, layout, footer, pageHead } from './shared.js';
import { followBoxes } from './app.js';
import { icon } from '../../web/icons.js';
import { searchHref, SEARCH_PATH } from './frame.js';
import { signinDialog } from './signin.js';
import { heading } from '../suggest.js';

// ---------- disease breakdown page ----------
// A disease on the map: what sits under it, with trial and drug counts, what is left out of its search on purpose, and the
// registry wordings placed on it. Counts are of active trials the registry tags with the term (not the landscape search).
// Step 7 of the design pass (15 Nov): the landscape pages' top (title, grey line, one small button under it), three summary
// boxes, then each section in a box with its header; the registry term and the source in an About box at the bottom.
export function diseasePage(d, { user, side = '', updated = '' } = {}) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const row = (c, note) => `<tr><td><a class="plainlink" href="/diseases/${esc(c.slug)}"><b>${esc(c.name)}</b></a>${note ? `<div class="sub">${esc(note)}</div>` : c.children ? `<div class="sub">${n(c.children, 'sub-disease', 'sub-diseases')}</div>` : ''}</td><td class="num">${c.drugs}</td><td class="num">${c.active}</td></tr>`;
  const table = (head, rows) => `<table class="land nums dtable"><thead><tr><th>${head}</th><th class="num">Drugs</th><th class="num"><span class="nophone">Active trials</span><span class="onphone">Trials</span></th></tr></thead><tbody>${rows}</tbody></table>`;
  const live = d.children.filter(c => c.active), quiet = d.children.filter(c => !c.active);
  const out = [...d.left_out].sort((a, b) => b.active - a.active);
  const word = w => `<span class="w">${w.how === 'model' ? `<span class="tip" tabindex="0" data-tip="The registry gave this wording no tag. Software read it and placed it here.">${esc(w.label)}</span>` : esc(w.label)} <span class="muted">${w.active}</span></span>`;
  const box = (ic, title, count, body, cls = '') => `<section class="box${cls ? ' ' + cls : ''}"><div class="boxhead">${icon(ic)}<h2>${title}${count !== '' ? `<span class="count">${count}</span>` : ''}</h2></div>${body}</section>`;
  const search = `<a class="btn sm" href="${esc(searchHref(d.name, 2))}">${icon('search', 16)}Search ${esc(d.name)}</a><span>Every drug in its active trials, Phase 2 and later</span>`;
  return layout({
    title: `${d.name}: sub-diseases and trial counts | ${BRAND}`, user, side, active: 'land', path: `/diseases/${d.slug}`,
    desc: `What a ${d.name} search on ${BRAND} includes: ${d.children.length} sub-diseases, ${d.active} active trials, ${d.drugs} drugs.`,
    body: `<main class="wrap breakdown ds">
<div class="crumbs"><a href="/landscapes">Landscapes</a>${d.parents.map(p => ` / <a href="/diseases/${esc(p.slug)}">${esc(p.name)}</a>`).join('')}</div>
${pageHead(esc(d.name), `What a search for ${esc(d.name)} includes, by the registry’s disease terms`, search)}
<div class="stats">
  <div class="stat"><div class="k">Active trials</div><div class="v">${d.active.toLocaleString('en-US')}</div><div class="s">Tagged ${esc(d.name)} or a disease under it</div></div>
  <div class="stat"><div class="k">Drugs</div><div class="v">${d.drugs.toLocaleString('en-US')}</div><div class="s">In those trials, any stage</div></div>
  <div class="stat"><div class="k">Sub-diseases</div><div class="v">${d.children.length}</div><div class="s">${d.children.length ? 'Included in the search' : 'None on the map'}${d.left_out.length ? ` · ${d.left_out.length} left out` : ''}</div></div>
</div>
${d.children.length ? box('check', 'Included', d.children.length, `${live.length ? table('Sub-disease', live.map(c => row(c)).join('')) : ''}
${quiet.length ? `<p class="boxfoot">${live.length ? `${quiet.length} more` : `${n(quiet.length, 'sub-disease', 'sub-diseases')}`} with no active trials: ${quiet.map(c => `<a href="/diseases/${esc(c.slug)}">${esc(c.name)}</a>`).join(', ')}</p>` : ''}`, 'tablebox') : ''}
${out.length ? box('close', 'Left out', out.length, `<p class="boxnote">The registry files these under ${esc(d.name)}, but someone searching it means something else. Each has its own search.</p>
${table('Disease', out.map(c => row(c, c.note)).join(''))}`, 'tablebox') : ''}
${d.wordings.length ? box('chat', 'How trials write it', d.wordings.length, `<p class="boxnote">The conditions trials list that we place on ${esc(d.name)} itself, with their active trials</p>
<p class="wordings">${d.wordings.slice(0, 8).map(word).join('')}${d.wordings.length > 8 ? `<span class="rest" hidden>${d.wordings.slice(8).map(word).join('')}</span><button class="linkbtn" type="button" onclick="this.previousElementSibling.hidden=false;this.remove()">and ${d.wordings.length - 8} more</button>` : ''}</p>`) : ''}
${box('info', 'About', '', `<dl class="rows about">${[
    ['Registry term', esc(d.term)],
    ['Counts', 'Active trials the registry tags with the term or a term under it, at any stage. A search also reads trial titles and drug names, so its counts differ.'],
    sourcesRow([['ClinicalTrials.gov', updated ? prettyDate(updated) : '']]),
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)}
</main>${side ? '' : footer()}`,
  });
}

// ---------- public landscape page ----------
// The landscape pass (12 Nov), the same top as Search: the title, one grey line, Follow under it. Someone who follows it gets
// What changed and Coming up side by side above the drugs. The stage choice, Copy table and Download sit in the Drugs box's header.
// Signed out, the page ends with "Ask your AI" and "Which should we check next?"; signed in, those go.
// Follow: signed out it opens the sign-in box over the page (src/pages/signin.js; without scripts, /follow asks to sign in);
// on Free it explains Solo; on Solo it follows, then shows Following.
const followHref = (area, pm) => `/follow?q=${encodeURIComponent(area)}&p=${pm}`;
const FOLLOW_GIVES = '<span>Every change as it happens, and a Monday email</span>';
function followAction({ user, paid, following, area, phase_min, title }) {
  if (user && !paid) return `<button class="btn sm" type="button" data-solo data-follow="${esc(followHref(area, phase_min))}" data-name="${esc(title)}">${icon('plus', 16)}Follow</button>${FOLLOW_GIVES}`;
  if (following) return `<div class="menu"><button class="btn sm" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="fm-${following.id}">${icon('check', 16)}Following${icon('chevron', 16)}</button>
  <div class="menu-box" id="fm-${following.id}"><p class="mh">You get every change as it happens, and the Monday email.</p>
    <button class="mi" type="button" data-unfollow="${following.id}"><span>Unfollow</span><span class="d">Stops the changes and the email for this landscape</span></button></div></div>`;
  return `<a class="btn sm" href="${esc(followHref(area, phase_min))}" data-signin>${icon('plus', 16)}Follow</a>${FOLLOW_GIVES}`;
}
// The stage choice: the dashboard search's words. Picking one opens the page at it (/landscapes/obesity?p=1).
const STAGE_OPTS = [[1, 'Any stage', 'Every drug in an active trial, including early safety trials'], [2, 'Phase 2 and later', 'Leaves out drugs only in early safety trials'], [3, 'Phase 3 and later', 'Only drugs in large late-stage trials, filed or approved']];
const stagePick = (slug, pm, own) => `<form class="stagepick" action="/landscapes/${slug}" method="get"><select name="p" data-dd="quiet" aria-label="Earliest stage" onchange="this.value==='${own}'?location.assign(this.form.action):this.form.submit()">${STAGE_OPTS.map(([v, t, d]) => `<option value="${v}" data-d="${d}"${v === pm ? ' selected' : ''}>${t}</option>`).join('')}</select></form>`;
// `parts`: for someone following it, its changes and dates (src/server.js homeParts). `signin`: signed out, what the sign-in box
// over the page needs ({ lastGoogle }).
export function landscapePage(L, { user, paid = false, following = null, parts = null, slug, title, crumb, flash, phase_min = 2, own_phase = phase_min, chips = [], ask = '', bakeoff = false, side = '', signin = null } = {}) {
  const s = L.stats;
  const phShort = phase_min >= 2 ? `Phase ${phase_min}+` : 'any phase';
  const desc = `${s.programs} ${s.programs === 1 ? 'drug' : 'drugs'} in ${s.trials} active ${s.trials === 1 ? 'trial' : 'trials'} · ${phase_min >= 2 ? `Phase ${phase_min} and later` : 'Every stage'} · updated ${prettyDate(L.data.trials)}`;
  const acts = exportActs({ paid, slug, phase: phase_min, site: process.env.PUBLIC_URL || '' });
  const more = [
    sourcesRow([['ClinicalTrials.gov', prettyDate(L.data.trials)], ['openFDA', prettyDate(L.data.fda)], ['Company press releases']]),
    ...(bakeoff ? [['Tested', `In <a href="/docs/bakeoff-obesity">our test on 6 Nov 2026</a>, Claude with web search found 44% of the drugs in active trials.`]] : []),
  ];
  return layout({
    // Another stage than the page's own is the same page filtered: its title says so, and search engines keep the plain one.
    title: `${title}${phase_min === own_phase ? '' : `, ${STAGE_OPTS[phase_min - 1][1].replace('Any', 'any')}`} | ${BRAND}`, user, side, active: 'land', noindex: phase_min !== own_phase, path: `/landscapes/${slug}`, image: `/img/og/landscapes/${slug}.png`,
    desc: `${s.programs} ${L.area} drugs in active trials (${phShort}), each linked to its source. Updated ${prettyDate(L.data.trials)}.`,
    body: `<main class="wrap ds">
${flash ? `<div class="flash">${flash}</div>` : ''}
<div class="crumbs"><a href="/landscapes">Landscapes</a> / ${esc(crumb)}</div>
${pageHead(esc(title), desc, followAction({ user, paid, following, area: L.area, phase_min, title }))}
${parts ? followBoxes(parts, { paid }) : ''}
${landscapeBody(L, 'l', { chips, more, head: `<span class="headacts">${stagePick(slug, phase_min, own_phase)}${acts}</span>` })}
${user ? '' : `<div class="askclaude">
  <div><b>Ask your AI about this landscape.</b> <span class="muted">Connect it once, then ask in plain English.</span>${ask ? `<br><code>${esc(ask)}</code>` : ''}</div>
  <a class="btn" href="/connect">Connect your AI</a>
</div>
${requestForm()}`}
</main>
${signin ? signinDialog({ ...signin, next: followHref(L.area, phase_min), why: { follow: heading(L.area) } }) : ''}
${side ? '' : footer()}
<script type="module">
import { wireLandscape } from '/static/table.js';
wireLandscape('l');
</script>${side ? '<script type="module" src="/static/app.js"></script>' : ''}${user ? '' : REQUEST_SCRIPT}`,
  });
}

// "Which should we check next?": one line, two fields (spec 16 part 3). Saved like the waitlist (/api/request).
const REQUEST_SCRIPT = `<script>
document.getElementById('reqform').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, msg = document.getElementById('thanks');
  if (!f.reportValidity()) return;
  const b = f.querySelector('button[type="submit"]'); b.disabled = true; b.textContent = 'Sending…';
  let ok = false;
  try { ok = (await fetch('/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area: f.area.value, email: f.email.value, page: location.pathname }) })).ok; } catch (_) {}
  b.disabled = false; b.textContent = 'Send';
  msg.textContent = ok ? 'Thanks. We will email you when it is ready.' : 'That did not work. Try again in a minute.';
  if (ok) f.reset();
});
</script>`;
export function requestForm() {
  return `<section class="nextform" id="request">
  <h2>Which should we check next?</h2>
  <form class="oneline" id="reqform">
    <label class="sr" for="r-area">A disease, target or modality</label><input class="input" id="r-area" name="area" required maxlength="200" placeholder="A disease, target or modality">
    <label class="sr" for="r-email">Work email</label><input class="input" id="r-email" name="email" type="email" required maxlength="200" placeholder="you@company.com">
    <button class="btn" type="submit">Send</button>
  </form>
  <p class="muted small"><span class="thanks" id="thanks" role="status"></span>Need a landscape built for you? <a href="/talk">Talk to us</a>.</p>
</section>`;
}

// ---------- the ready-made landscapes (spec 16 part 3) ----------
// Search above the table; each row says how much was checked; the milestone reads date, then what happens.
const plain = x => x.short;
const stageWords = pm => (pm >= 2 ? `Phase ${pm} and later` : 'Any phase');
const checkedWords = st => (st.checked === st.programs ? `all ${st.programs} checked` : `${st.checked} of ${st.programs} checked`);
export function landscapesIndexPage(list, { user, paid = false, side = '' } = {}) {
  const row = x => {
    const st = x.L.stats, n = st.next;
    const sub = [x.slug === 'pd1-vegf' ? x.plain : '', stageWords(x.phase_min || 2), checkedWords(st)].filter(Boolean).join(' · ');
    const what = n ? `${drugName(n.drug)} · ${milestonePlain(n.what)}${n.news ? ' · press release' : ''}` : '';
    return `<tr data-href="/landscapes/${x.slug}"><td><a class="plainlink" href="/landscapes/${x.slug}"><b>${esc(plain(x))}</b></a><div class="sub" title="${esc(sub)}">${esc(sub)}</div><span class="ph">${st.programs} drugs · ${st.trials} trials${n ? ` · next ${esc(shortDate(n.date, (x.L.data?.trials || '').slice(0, 4)))}${n.soon ? '<span class="tag soon">soon</span>' : ''}` : ''}</span></td><td class="num">${st.programs}</td><td class="num">${st.trials}</td>
<td>${n ? `<span class="nd">${esc(shortDate(n.date))}</span>${n.soon ? '<span class="tag soon">soon</span>' : ''}<div class="sub" title="${esc(what)}">${esc(what)}</div>` : '<span class="muted">—</span>'}</td><td class="go">${icon('chevron', 16)}</td></tr>`;
  };
  return layout({
    title: `Drug pipeline landscapes | ${BRAND}`, user, side, active: 'land', path: '/landscapes',
    desc: `Ready-made drug pipeline landscapes: ${list.map(x => plain(x)).join(', ')}. Free to read; every row links to its source.`,
    body: `<main class="wrap lindex ds">
${pageHead('Landscapes', 'Landscapes we put together and keep up to date. Every drug links to its source.')}
${user ? '' : `<form class="bigsearch" action="/start" method="get" role="search">
  <label class="sr" for="lq">A disease, drug, target or company</label><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
  <input class="input" id="lq" name="q" required maxlength="120" placeholder="Not here? Search anything, top 10 free" autocomplete="off">
  <button class="btn primary" type="submit">See the drugs</button>
</form>`}
<div class="tablebox"><div class="boxhead">${icon('landscape')}<h2>Ready-made landscapes<span class="count">${list.length}</span></h2><span class="more">${paid ? 'Open one to follow it' : 'Free to read in full'}</span></div>
<table class="land lindex-t"><thead><tr><th>Landscape</th><th class="num">Drugs</th><th class="num">Active trials</th><th>Next date</th><th class="go"><span class="sr">Open</span></th></tr></thead>
<tbody>${list.map(row).join('')}</tbody></table>
${user ? `<a class="boxfoot boxlink" href="${SEARCH_PATH}">${icon('search', 16)}Not here? Search any disease, target, drug or company</a>` : ''}</div>
${user ? '' : requestForm()}
</main>${side ? '' : footer()}${user ? '' : REQUEST_SCRIPT}
<script>document.querySelectorAll('.lindex-t tr[data-href]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('a')) location.href = r.dataset.href; }));</script>`,
  });
}
