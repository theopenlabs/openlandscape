// Dashboard pages (src/pages/app.js), each arriving complete from the server; `data-view` on .app says which:
// - home: Home, MCP connector and Settings, switched by the hash (#home, #mcp, #settings).
// - search: /app/search?q=<q>&p=<phase>. Each search is a step in the browser's history, so Back returns to the one before.
// - landscape: one followed landscape, /app/l/<id>.
// Also loaded on a checked landscape's public page while signed in (no data-view), for its Follow button.
import { esc, landscapeBody, wireLandscape, limitNotice, limitBox, openFollowBox, openSwapBox, SOLO_BTN, exportActs } from '/static/table.js';
import { icon } from '/static/icons.js';
import { showSkeleton } from '/static/ui.js';

const $ = id => document.getElementById(id);
const APP = document.querySelector('.app').dataset;
const VIEW = APP.view || '';
const paid = APP.plan === 'paid';
// Home's "Updated …": in the reader's own time, as today, yesterday or the day and month.
document.querySelectorAll('.upd[data-at]').forEach(p => {
  const at = new Date(p.dataset.at.replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(p.dataset.at) ? '' : 'Z'));
  if (isNaN(at)) return;
  const day = d => d.toDateString(), now = new Date(), y = new Date(now - 864e5);
  const when = day(at) === day(now) ? 'today' : day(at) === day(y) ? 'yesterday' : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  p.textContent = `Updated ${when}`;   // the exact time is in its tooltip
});
const cap = q => q[0].toUpperCase() + q.slice(1);
// The landscapes they follow, by search words: the sidebar lists each with where it opens (drugs and companies have no data-q).
const mineByQuery = new Map([...document.querySelectorAll('#followgrp a[data-q]')].map(a => [a.dataset.q, a.getAttribute('href')]));
const send = (url, method, body) => fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });

// A free landscape just kept (?kept=1) says so once: a reload shows the plain page.
if (VIEW === 'landscape' && /[?&]kept=1/.test(location.search)) history.replaceState(null, '', location.pathname + location.search.replace(/[?&]kept=1/, '').replace(/^&/, '?'));
// Home right after onboarding (?started=1): a reload shows the plain Home.
if (/[?&]started=1/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);

// ---------- pages ----------
function show(p) {
  document.querySelectorAll('.panel').forEach(x => x.classList.toggle('on', x.id === 'p-' + p));
  document.querySelectorAll('.side [data-panel]').forEach(a => a.classList.toggle('on', a.dataset.panel === p));
  window.scrollTo(0, 0);
}
// Search: the address holds the search (?q=&p=, &finished=1); a new one is pushed, Back and Forward redraw the one there.
const SEARCH_PATH = APP.searchPath;
const searchUrl = (q, p, finished) => `${SEARCH_PATH}?q=${encodeURIComponent(q)}&p=${p}${finished ? '&finished=1' : ''}`;
function runSearch(q, p) {
  q = q.trim(); if (!q) return;
  if (VIEW !== 'search') { showSkeleton(searchUrl(q, p)); location.href = searchUrl(q, p); return; }
  history.pushState(null, '', searchUrl(q, p));
  search(q, p);
}
function route() {
  if (VIEW === 'search') {
    const u = new URLSearchParams(location.search), q = (u.get('q') || '').trim();
    if (!q) return searchStart();
    return search(q, +u.get('p') || 2, { finished: u.get('finished') === '1' });
  }
  if (VIEW !== 'home') return;
  const hsh = location.hash;
  if (hsh === '#mcp' || hsh === '#keys') { if (hsh === '#keys') $('manual').open = true; return show('mcp'); }
  if (hsh === '#settings') return show('settings');
  show('home');
}
window.addEventListener(VIEW === 'search' ? 'popstate' : 'hashchange', route);
document.querySelectorAll('[data-panel]').forEach(a => a.addEventListener('click', () => { if (a.getAttribute('href') === location.hash) route(); }));
document.querySelectorAll('.panel .landbody').forEach(b => wireLandscape(b.id));

// ---------- limits: one notice where you acted, the key fact in bold, one way past it ----------
const NOTICE = {
  first: () => limitNotice('Your first landscape is free.', 'Choose Solo to open more.', SOLO_BTN),
};
// Solo with every follow used: the box that swaps one out (screen 6). `current`: the search on screen.
const followAddr = () => `/follow?q=${encodeURIComponent(current.q)}&p=${current.phase}`;
const swapBox = () => openSwapBox({ name: current.name, follow: followAddr() });
const say = (slot, html) => { slot.innerHTML = html; slot.querySelector('[data-close]')?.addEventListener('click', () => { slot.innerHTML = ''; }); slot.scrollIntoView({ block: 'nearest' }); };
document.querySelectorAll('[data-solo]').forEach(b => b.addEventListener('click', () => openFollowBox({ name: b.dataset.name, follow: b.dataset.follow })));

// ---------- search ----------
let current = null;
const STEPS = ['Matching conditions, trial titles and drug names…', 'Grouping the trials by drug…', 'Sorting by stage, then next milestone…'];
// While a search runs: the real title, a grey line, then the list's box with grey rows where the drugs will be, and the step it is on.
const SKROW = `<div class="skrow">${[78, 64, 52, 70, 58].map(w => `<span class="sk-b" style="width:${w}%"></span>`).join('')}</div>`;
const loadingHTML = q => `<div class="skel searchskel" role="status"><div class="titleline"><div><h1>${esc(cap(q))}</h1><span class="sk-b skdesc"></span></div></div>
<div class="tablebox"><div class="boxhead"><span class="loadstep"><span class="spin" aria-hidden="true"></span><span id="loadstep">${STEPS[0]}</span></span></div>${SKROW.repeat(6)}</div></div>`;
const starters = on => document.querySelectorAll('#p-search .starter').forEach(x => { x.hidden = !on; });
function searchStart() { starters(true); $('result').innerHTML = ''; $('dform').q.value = ''; current = null; }
const stageLine = pm => (pm >= 2 ? `Phase ${pm} and later` : 'Every stage');
async function search(q, phase, { finished = false } = {}) {
  q = q.trim(); if (!q) return;
  starters(false);
  const form = $('dform'), btn = form.querySelector('button[type="submit"]'), out = $('result');
  form.q.value = q; form.p.value = String(phase); form.p.dispatchEvent(new Event('change'));
  btn.textContent = 'Searching…'; btn.disabled = true;
  out.innerHTML = loadingHTML(q);
  let step = 0;
  const timer = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : setInterval(() => { const el = $('loadstep'); if (el && step < STEPS.length - 1) el.textContent = STEPS[++step]; }, 450);
  let r, L;
  try { r = await fetch(`/api/landscape?area=${encodeURIComponent(q)}&phase_min=${phase}${finished ? '&finished=1' : ''}`); L = await r.json(); }
  catch { r = { ok: false }; L = { error: 'The search did not go through. Check your connection and try again.' }; }
  clearInterval(timer); btn.textContent = 'Search'; btn.disabled = false;
  if (form.q.value.trim() !== q) return;   // a newer search is on its way
  // One drug or one company: its page. This step of history becomes the empty search, so Back does not open it again.
  if (r.ok && L.open) { history.replaceState(null, '', SEARCH_PATH); showSkeleton(L.open); location.href = L.open; return; }
  if (!r.ok) { out.innerHTML = `<div class="flash error">${esc(L.error || 'The search did not work. Please try again.')}</div>`; return; }
  current = { q, phase, name: L.heading || cap(q) };
  history.replaceState(null, '', searchUrl(q, phase, finished));
  const title = esc(L.heading || cap(q)), n = L.stats.programs;
  // Past the account's allowance of different drugs (src/limits.js): Free sees none of a new list, only why.
  const over = L.limit?.kind === 'over', lim = limitBox(L.limit);
  if (over && !L.programs.length) { out.innerHTML = `<div class="titleline"><div><h1>${title}</h1><p class="desc">${n} ${n === 1 ? 'drug' : 'drugs'} · ${stageLine(phase)}</p></div></div>${lim}`; return; }
  if (!L.programs.length) return nothingFound(q, phase, title, L, finished);
  const pv = L.preview, mine = mineByQuery.get(q.toLowerCase());
  // Under the title, on the left: Solo's Follow and what it gives. Free's offer is made once, inside the list where its rows run
  // out (`after`). Copy table and Download sit in the list's own header.
  const acts = exportActs({ paid, area: q, phase, site: APP.site || '' });
  const followBtn = finished ? '' : paid
    ? (mine ? `<a class="btn sm" href="${esc(mine)}">${icon('check', 16)}Following</a>` : `<button class="btn sm" type="button" id="follow">${icon('plus', 16)}Follow</button>`)
    : pv ? '' : mine ? `<a class="btn sm" href="${esc(mine)}">${icon('check', 16)}Your landscape</a>` : `<button class="btn sm" type="button" id="solofollow">${icon('plus', 16)}Follow</button>`;
  const fol = followBtn ? `<div class="fol">${followBtn}${/id="(solo)?follow"/.test(followBtn) ? '<span>Every change as it happens, and a Monday email</span>' : ''}</div>` : '';
  const cut = pv && n > pv.shown;
  const after = pv && !over ? offerHTML(title, n, pv) : '';
  // One grey line under the title: how many drugs (the top 10 of them, for Free) and trials, the stage, the date.
  const t = L.stats.trials;
  out.innerHTML = `<div class="titleline"><div><h1>${title}</h1><p class="desc">${cut ? `Top ${pv.shown} of ` : ''}${n} ${n === 1 ? 'drug' : 'drugs'} in ${t} ${finished ? '' : 'active '}${t === 1 ? 'trial' : 'trials'}${finished ? ', counting trials that finished in the last two years' : ''} · ${stageLine(phase)} · updated ${esc(out.dataset.updated)}</p>${fol}</div></div>
    <div class="slot" id="limit">${lim}</div>
    ${landscapeBody(L, 'd', { after, head: acts })}`;
  wireLandscape('d');
  if ($('follow')) $('follow').onclick = () => follow();
  if ($('solofollow')) $('solofollow').onclick = () => openFollowBox({ name: L.heading || cap(q), follow: `/follow?q=${encodeURIComponent(q)}&p=${phase}` });
  if ($('openfull')) $('openfull').onclick = () => follow($('offerslot'));
  // Sent here by a Follow press on a public page that did not go through (?notice=): the box that says why, once.
  if (APP.notice) { const k = APP.notice; delete APP.notice; if (k === 'full') swapBox(); else openFollowBox({ name: current.name, follow: followAddr() }); }
}
// Free's one offer, where the list is cut: what they get, that it is theirs to keep, that there is only one. Once the free
// landscape is taken, a cut list says which one is theirs and offers Solo instead.
function offerHTML(title, n, pv) {
  const cut = n > pv.shown;
  if (pv.left) return `<div class="offer"><h3>${cut ? `See all ${n} drugs: make ${title} your free landscape` : `Keep ${title} as your free landscape`}</h3>
<ul><li>Every drug, company and date in this list, kept up to date</li><li>It stays yours. Your free account has one, and it cannot be swapped later.</li></ul>
<button class="btn primary" type="button" id="openfull">Make this my free landscape</button><div class="slot" id="offerslot"></div></div>`;
  if (!cut) return '';
  // Their free landscape is taken (screen 6): the same shape as the offer above, Solo's two ticks, and a quiet way back to theirs.
  const g = document.querySelector('#followgrp .it.gift'), theirs = g?.querySelector('.t')?.textContent;
  const tick = t => `<li>${icon('check', 16)}<span>${t}</span></li>`;
  return `<div class="offer"><h3>See all ${n} drugs: choose Solo</h3><ul class="t">${tick('Every landscape in full, not the top 10')}${tick('Follow up to 5, see every change')}</ul>
<div class="acts">${SOLO_BTN.replace('btn sm', 'btn primary')}${theirs ? `<a href="${esc(g.getAttribute('href'))}">Or open <b>${esc(theirs)}</b>, your free landscape</a>` : ''}</div></div>`;
}
// Nothing found (screen 4): the same top as a result, then one box whose rows are the next steps, each saying what it finds:
// Did you mean, Include finished trials (with the names), Search every stage (only when Phase 1 finds something). With no
// next step, the Try examples.
const STARTER = ['Heart failure', 'GLP-1', 'PD-1', 'Novo Nordisk', 'Retatrutide'];
const nextRow = (attrs, what, sub) => `<button class="nextrow" type="button" ${attrs}><span><b>${what}</b><span class="s">${sub}</span></span>${icon('chevron', 16)}</button>`;
async function nothingFound(q, phase, title, L, finished) {
  const out = $('result');
  const rows = L.did_you_mean ? [nextRow(`data-q="${esc(L.did_you_mean.toLowerCase())}" data-p="${phase}"`, `Did you mean ${esc(L.did_you_mean.toLowerCase())}?`, 'Search it instead')] : [];
  const draw = (more, done) => {
    const all = [...rows, ...more];
    $('nextsteps').innerHTML = all.length ? all.join('') : done ? `<div class="boxbody"><p>Try a disease, a drug name or code, a target or a company.</p><div class="trychips">${STARTER.map(x => `<button class="chip" type="button" data-q="${esc(x.toLowerCase())}" data-p="2">${esc(x)}</button>`).join('')}</div></div>`
      : '<p class="muted nothing">Looking for other ways in…</p>';
  };
  out.innerHTML = `<div class="titleline"><div><h1>${title}</h1><p class="desc">No drugs in ${finished ? '' : 'active '}trials${finished ? ', counting trials that finished in the last two years' : ''} · ${stageLine(phase)} · updated ${esc(out.dataset.updated)}</p></div></div>
    <section class="box nothingbox"><div class="boxhead">${icon('search')}<h2>Nothing found</h2></div><div id="nextsteps"></div></section>`;
  draw([], !!L.did_you_mean);
  if (L.did_you_mean) return;
  const look = extra => fetch(`/api/landscape?area=${encodeURIComponent(q)}&${extra}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [F, E] = await Promise.all([finished ? null : look(`phase_min=${phase}&finished=1`), phase > 1 ? look('phase_min=1') : null]);
  if (current?.q !== q || current?.phase !== phase || !$('nextsteps')) return;
  const more = [];
  if (F?.programs.length) {
    const k = F.stats.programs, names = F.programs.slice(0, 3).map(p => esc(p.drug)).join(', ');
    more.push(nextRow('data-finished', 'Include finished trials', `${k} ${k === 1 ? 'drug' : 'drugs'}: ${names}${k > 3 ? ` and ${k - 3} more` : ''}`));
  }
  if (E?.programs.length) { const k = E.stats.programs; more.push(nextRow(`data-q="${esc(q)}" data-p="1"`, 'Search every stage', `${k} ${k === 1 ? 'drug' : 'drugs'} in Phase 1`)); }
  draw(more, true);
  $('nextsteps').querySelector('[data-finished]')?.addEventListener('click', () => { history.pushState(null, '', searchUrl(q, phase, true)); search(q, phase, { finished: true }); });
}
// Follow (Solo), or "Make this my free landscape" (Free's one free landscape, `keep`): both keep the landscape and open its page.
async function follow(slot = $('limit')) {
  const r = await send('/api/follow', 'POST', { query: current.q, phase_min: current.phase, keep: !paid });
  const e = await r.json().catch(() => ({}));
  if (r.status === 402) return paid ? swapBox() : say(slot, NOTICE.first());
  if (!r.ok) return say(slot, `<div class="flash error">${esc(e.error || 'That did not work. Please try again.')}</div>`);
  const to = paid ? e.href : `${e.href}${e.href.includes('?') ? '&' : '?'}kept=1`;   // Free: the page says it is now theirs
  showSkeleton(to); location.href = to;
}
document.querySelectorAll('[data-search]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); runSearch(f.q.value, +f.p.value); }));
// Examples, showcase landscapes and "Did you mean": a click runs that search.
document.addEventListener('click', e => { const b = e.target.closest('.main button[data-q]'); if (b) runSearch(b.dataset.q, +b.dataset.p || 2); });

// ---------- suggestions as you type (ARIA combobox; /api/suggest, src/suggest.js) ----------
// Diseases and types of drug run the search; drugs and companies open their page. Enter with nothing picked searches as typed.
const KINDS = { disease: 'Diseases', type: 'Types of drug', drug: 'Drugs and codes', company: 'Companies' };
const phone = matchMedia('(max-width: 560px)');
const trialsWord = n => `${n} ${n === 1 ? 'trial' : 'trials'}`;
function wireSuggest(f, n) {
  const input = f.q, box = document.createElement('div'), memo = new Map();
  box.className = 'sugg'; box.id = `sugg-${n}`; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', 'Suggestions'); box.hidden = true;
  f.append(box);
  Object.entries({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': box.id }).forEach(([k, v]) => input.setAttribute(k, v));
  let items = [], at = -1, timer, ctl, sent = false;   // sent: a search is running, so late suggestions stay away
  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); at = -1; };
  const mark = (s, q) => { const i = s.toLowerCase().indexOf(q.toLowerCase()); return i < 0 || !q ? esc(s) : `${esc(s.slice(0, i))}<b>${esc(s.slice(i, i + q.length))}</b>${esc(s.slice(i + q.length))}`; };
  function render(r) {
    if (sent || r.query !== input.value.trim() || document.activeElement !== input) return;
    items = []; at = -1;
    const per = phone.matches ? 3 : 4;
    box.innerHTML = r.groups.map(g => `<div class="sugg-h" role="presentation">${KINDS[g.kind]}</div>` + g.items.slice(0, per).map(it => {
      const k = items.push({ ...it, kind: g.kind }) - 1;
      const det = g.kind === 'type' ? it.gloss : g.kind === 'drug' ? [it.also && 'also ' + it.also, it.company, it.stage].filter(Boolean).join(' · ') : g.kind === 'company' ? it.detail : '';
      return `<div class="sugg-o" role="option" id="${box.id}-${k}" data-k="${k}" aria-selected="false"><span class="sugg-n">${mark(it.label, r.query)}${it.hand ? '<span class="sugg-ok" aria-label="checked"> ✓</span>' : ''}</span>`
        + `<span class="sugg-d">${esc(det || '')}</span>${g.kind === 'type' ? '' : `<span class="sugg-c">${trialsWord(it.active)}</span>`}</div>`;
    }).join('')).join('');
    if (!items.length) return close();
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function move(k) {
    at = k;
    box.querySelectorAll('.sugg-o').forEach(o => { const on = +o.dataset.k === k; o.setAttribute('aria-selected', on); if (on) o.scrollIntoView({ block: 'nearest' }); });
    if (k < 0) input.removeAttribute('aria-activedescendant'); else input.setAttribute('aria-activedescendant', `${box.id}-${k}`);
  }
  function pick(k) {
    const it = items[k]; close();
    if (it.href) { showSkeleton(it.href); location.href = it.href; return; }
    input.value = it.q; runSearch(it.q, +f.p.value);
  }
  input.addEventListener('input', () => {
    clearTimeout(timer); sent = false;
    const q = input.value.trim();
    if (!q) { close(); return; }
    if (memo.has(q)) { render(memo.get(q)); return; }
    timer = setTimeout(async () => {
      ctl?.abort(); ctl = new AbortController();
      try { const r = await (await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctl.signal })).json(); memo.set(q, r); render(r); } catch { /* aborted or offline: no list */ }
    }, 60);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!box.hidden) { e.preventDefault(); close(); } return; }
    if (box.hidden || !items.length) { if (e.key === 'ArrowDown' && input.value.trim()) input.dispatchEvent(new Event('input')); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(at + 1 >= items.length ? 0 : at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(at <= 0 ? items.length - 1 : at - 1); }
    else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); pick(at); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  box.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the box while clicking a suggestion
  box.addEventListener('click', e => { const o = e.target.closest('.sugg-o'); if (o) pick(+o.dataset.k); });
  box.addEventListener('mousemove', e => { const o = e.target.closest('.sugg-o'); if (o && +o.dataset.k !== at) move(+o.dataset.k); });
  f.addEventListener('submit', () => { sent = true; clearTimeout(timer); close(); });
}
document.querySelectorAll('[data-search]').forEach(wireSuggest);

// ---------- lists that show their first rows, then "All 58 upcoming"; the count beside the heading follows the filter ----------
// What changed: the count is the last 14 days, as in the sidebar and Home's numbers. Older rows (data-old)
// follow under an "Earlier" line and are not counted; the button then says "Show all", so only one number is on screen.
function trim(ul) {
  const all = ul.classList.contains('all'), max = +ul.dataset.max;
  ul.classList.add('ready');   // from here the script decides which rows show (web/style.css hides the extra rows until then)
  ul.querySelector(':scope>li.earlier')?.remove();
  let n = 0, recent = 0, hasOld = false;
  for (const li of [...ul.children]) {
    if (li.dataset.off) { li.hidden = true; continue; }
    if (li.dataset.old && !hasOld) { hasOld = true; const e = document.createElement('li'); e.className = 'earlier'; e.textContent = 'Earlier'; li.before(e); e.hidden = !all && n >= max; }
    li.hidden = !all && n >= max; n++;
    if (!li.dataset.old) recent++;
  }
  document.querySelectorAll(`[data-more="${ul.id}"]`).forEach(b => { b.hidden = n <= max; b.textContent = all ? 'Show fewer' : hasOld ? 'Show all' : `All ${n} ${b.dataset.all}`; });
  document.querySelectorAll(`[data-count="${ul.id}"]`).forEach(c => { c.textContent = hasOld ? recent || '' : n; });
}
const trimAll = () => document.querySelectorAll('ul.feed[data-max]').forEach(trim);
document.addEventListener('click', e => { const b = e.target.closest('[data-more]'); if (!b) return; const ul = $(b.dataset.more); ul.classList.toggle('all'); trim(ul); });
trimAll();
// Home: one chip per landscape filters both lists.
$('homefilter')?.addEventListener('click', e => {
  const b = e.target.closest('[data-l]'); if (!b) return;
  $('homefilter').querySelectorAll('[data-l]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('homefeed').querySelectorAll('li[data-l]').forEach(li => { if (b.dataset.l !== 'all' && !li.dataset.l.split(' ').includes(b.dataset.l)) li.dataset.off = '1'; else delete li.dataset.off; });
  $('homefeed').querySelectorAll('ul.feed').forEach(trim);
});

// ---------- the Following menu: check SEC filings now, unfollow ----------
const closeMenus = except => document.querySelectorAll('.menu > button[aria-expanded="true"]').forEach(b => { if (b !== except) { b.setAttribute('aria-expanded', 'false'); $(b.getAttribute('aria-controls')).classList.remove('open'); } });
document.addEventListener('click', e => {
  const b = e.target.closest('.menu > button');
  closeMenus(b);
  if (!b) return;
  const on = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', String(on)); $(b.getAttribute('aria-controls')).classList.toggle('open', on);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
// One line while it runs; new filings appear in What changed without a reload. A failure says so on the same line.
document.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', async () => {
  const id = b.dataset.check, log = $('log-' + id);
  const line = n => `Checking SEC filings from the ${n ? n + ' ' : ''}companies here that file with it. New ones appear in What changed.`;
  log.hidden = false; log.classList.add('busy'); log.textContent = line(); b.disabled = true;
  let text = '';
  try {
    const r = await fetch(`/api/areas/${id}/check`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not check now.');
    const rd = r.body.getReader(), dec = new TextDecoder();
    for (let x = await rd.read(); !x.done; x = await rd.read()) { text += dec.decode(x.value, { stream: true }); const m = text.match(/(\d+) of them file with the SEC/); if (m) log.textContent = line(m[1]); }
    const done = text.match(/Done\. (\d+) new SEC filings? \((\d+)/);
    if (!done) throw new Error('The check stopped before it finished. Try again in a few minutes.');
    if (+done[1]) {
      const doc = new DOMParser().parseFromString(await (await fetch(location.pathname)).text(), 'text/html');
      const fresh = doc.getElementById('chbox-' + id), old = $('chbox-' + id);
      if (fresh && old) { old.innerHTML = fresh.innerHTML; trimAll(); }
    }
    log.textContent = +done[1] ? `${done[1]} new SEC ${+done[1] === 1 ? 'filing' : 'filings'}, ${done[2]} of them a deal or financing. ${+done[2] ? 'They are in What changed.' : 'Routine reports are folded in What changed.'}` : 'No new SEC filings since the last check.';
  } catch (err) { log.textContent = err.message; }
  log.classList.remove('busy'); b.disabled = false;
}));
document.querySelectorAll('[data-unfollow]').forEach(b => b.addEventListener('click', async () => {
  b.disabled = true; await fetch('/api/follow/' + b.dataset.unfollow, { method: 'DELETE' });
  if (VIEW) location.href = APP.home; else location.reload();   // a dashboard landscape page is gone; a checked page stays
}));

// ---------- Connect your AI (on Home): keys. One AI app at a time: a new key replaces a connected app (src/auth.js). ----------
if ($('p-mcp')) {
async function loadKeys() {
  const { keys } = await (await fetch('/api/keys')).json();
  $('keys').innerHTML = keys.length ? keys.map(k => `<div><code>${esc(k.prefix)}…</code><span class="muted small">created ${esc(k.created_at.slice(0, 10))}</span><span class="muted small">${k.revoked ? 'revoked' : k.last_used ? 'last used ' + esc(k.last_used.slice(0, 10)) : 'never used'}</span>${k.revoked ? '' : `<button class="btn sm" data-revoke="${k.id}" type="button">Revoke</button>`}</div>`).join('') : '<div class="muted">No keys yet.</div>';
}
$('keys').addEventListener('click', async e => { const b = e.target.closest('[data-revoke]'); if (!b) return; b.disabled = true; await fetch('/api/keys/' + b.dataset.revoke, { method: 'DELETE' }); loadKeys(); });
$('mkkey').onclick = async () => {
  const { key } = await (await fetch('/api/keys', { method: 'POST' })).json();
  document.querySelectorAll('#manual .mcpurl').forEach(c => { c.textContent = c.textContent.replace(/YOUR_KEY|op_\w+_[\w-]+/, key); });
  $('newkey').innerHTML = `<div class="flash"><b>Key created.</b> It is filled into the steps below. Copy what you need now: it will not be shown again.${APP.connected ? ` It replaces ${esc(APP.connected)}.` : ''}</div>`;
  loadKeys();
};
}

// ---------- Settings ----------
// The setup guide, hidden by hand: Show it brings it back (web/guide.js).
$('showguide')?.addEventListener('click', async () => { await send('/api/guide', 'POST', { hidden: 0 }); location.reload(); });

route();
