// Small behaviours every page shares: the phone menu, the account menu, our dropdown, tooltips, and "Sending…" on forms.
// Loaded by the page shell (src/pages/shared.js) on every page. Styles are in section 4 of style.css.
import { icon } from '/static/icons.js';

// ---------- "Menu" on phones, and the account menu in the sidebar ----------
// A button with aria-controls opens and closes the element it names (class "open").
function wireToggle(btn, { label } = {}) {
  const box = document.getElementById(btn.getAttribute('aria-controls'));
  if (!box) return;
  const word = btn.querySelector('span');
  const set = on => {
    box.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on));
    if (label && word) word.textContent = on ? 'Close' : 'Menu';
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  box.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { set(false); btn.focus(); } });
  document.addEventListener('mousedown', e => { if (!label && !box.contains(e.target) && !btn.contains(e.target)) set(false); });
}
document.querySelectorAll('.menubtn').forEach(b => wireToggle(b, { label: true }));
document.querySelectorAll('.acct-btn').forEach(b => wireToggle(b));

// ---------- Theme: Automatic, Light or Dark (the account menu and Settings, src/pages/frame.js themeSwitch) ----------
// Pressing one changes the page at once and asks the server to keep it in the ol_theme cookie (it reaches the website's
// pages too; src/pages/shared.js reads it before drawing). Automatic removes the cookie.
const THEME_WORDS = { '': 'Automatic', light: 'Light', dark: 'Dark' };
function paintTheme() {
  const t = document.documentElement.dataset.theme || '';
  document.querySelectorAll('[data-theme-pick]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themePick === t)));
  const w = document.getElementById('themeword'); if (w) w.textContent = THEME_WORDS[t];
}
paintTheme();
document.addEventListener('click', e => {
  const b = e.target.closest('[data-theme-pick]'); if (!b) return;
  const v = b.dataset.themePick;
  if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  paintTheme();
  fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: v }) });
});

// ---------- our dropdown, built from <select data-dd="quiet|field"> ----------
// The select stays in the form (hidden) and carries the value, so forms and scripts read it as before.
// An option's data-d is the short line under it. Keys: arrows, Home, End, Enter, Esc. To change the value from a script,
// set select.value and dispatch a "change" event.
let ddN = 0;
function wireDropdown(sel) {
  const id = `dd-${++ddN}`, name = sel.getAttribute('aria-label') || '';
  const dd = document.createElement('div'); dd.className = `dd ${sel.dataset.dd || 'field'}`;
  sel.before(dd);
  const opts = [...sel.options];
  dd.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}"${name ? ` aria-label="${name}"` : ''}><span class="dd-val"></span>${icon('chevron', 16)}</button>
<ul class="dd-menu" role="listbox" id="${id}" tabindex="-1"${name ? ` aria-label="${name}"` : ''} hidden>${opts.map((o, i) => `<li role="option" id="${id}-${i}" aria-selected="false"><span class="dd-t"></span>${o.dataset.d ? '<span class="dd-d"></span>' : ''}${icon('check', 16)}</li>`).join('')}</ul>`;
  dd.append(sel);
  const btn = dd.querySelector('.dd-btn'), menu = dd.querySelector('.dd-menu'), val = dd.querySelector('.dd-val'), items = [...menu.children];
  items.forEach((li, i) => { li.querySelector('.dd-t').textContent = opts[i].textContent; if (opts[i].dataset.d) li.querySelector('.dd-d').textContent = opts[i].dataset.d; });
  let at = -1;
  // An option's data-short is what the closed choice says where room is short (the phone's search bar: "Phase 2+").
  const sync = () => { const o = opts[sel.selectedIndex]; val.textContent = o?.textContent || ''; if (o?.dataset.short) val.innerHTML = `<span class="dd-long">${val.innerHTML}</span><span class="dd-short">${o.dataset.short}</span>`; items.forEach((li, i) => li.setAttribute('aria-selected', String(i === sel.selectedIndex))); };
  const mark = i => { at = i; items.forEach((li, k) => li.classList.toggle('on', k === i)); if (i >= 0) menu.setAttribute('aria-activedescendant', items[i].id); else menu.removeAttribute('aria-activedescendant'); };
  const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); mark(Math.max(0, sel.selectedIndex)); menu.focus(); };
  const close = focus => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); mark(-1); if (focus) btn.focus(); };
  const pick = i => { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); close(true); };
  sel.addEventListener('change', sync);
  btn.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
  items.forEach((li, i) => { li.addEventListener('mousemove', () => { if (at !== i) mark(i); }); li.addEventListener('click', () => pick(i)); });
  menu.addEventListener('keydown', e => {
    const n = items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); mark((at + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark((at - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); mark(0); }
    else if (e.key === 'End') { e.preventDefault(); mark(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (at >= 0) pick(at); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('mousedown', e => { if (!menu.hidden && !dd.contains(e.target)) close(false); });
  sel.form?.addEventListener('reset', () => setTimeout(sync));
  sync();
}
document.querySelectorAll('select[data-dd]').forEach(wireDropdown);

// ---------- tooltips: anything with data-tip ----------
// Shows after the pointer rests about half a second, or at once on keyboard focus or a tap. Opens above, or below when there
// is no room, and never off screen. Goes on pointer leave, scroll, Esc or a tap elsewhere. It cannot block a click.
const tipbox = document.createElement('div');
tipbox.id = 'tipbox'; tipbox.setAttribute('role', 'tooltip'); document.body.append(tipbox);
let tipFor = null, tipTimer, tipAt = 0;
function placeTip(el) {
  tipbox.textContent = el.dataset.tip;
  const edge = innerWidth <= 560 ? 24 : 8, r = el.getBoundingClientRect();
  tipbox.style.maxWidth = `${Math.min(el.dataset.tip.includes('\n') ? 360 : 280, innerWidth - 2 * edge)}px`;   // a list of lines gets more room
  const w = tipbox.offsetWidth, h = tipbox.offsetHeight;
  const left = Math.max(edge, Math.min(r.left, innerWidth - w - edge));
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8);
  tipbox.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
}
function showTip(el, wait) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { tipFor = el; tipAt = Date.now(); placeTip(el); tipbox.classList.add('on'); el.setAttribute('aria-describedby', 'tipbox'); }, wait);
}
function hideTip() {
  clearTimeout(tipTimer);
  tipbox.classList.remove('on');
  tipFor?.removeAttribute('aria-describedby'); tipFor = null;
}
const tipOf = e => e.target.closest?.('[data-tip]');
document.addEventListener('mouseover', e => { const el = tipOf(e); if (el && el !== tipFor) showTip(el, 500); });
document.addEventListener('mouseout', e => { const el = tipOf(e); if (el && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('focusin', e => { const el = tipOf(e); if (el && el.matches(':focus-visible')) showTip(el, 0); });
document.addEventListener('focusout', e => { if (tipOf(e)) hideTip(); });
document.addEventListener('click', e => { const el = tipOf(e); if (!el) return hideTip(); if (tipFor === el) hideTip(); else showTip(el, 0); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
// A scroll hides it, except the browser's own scroll that brings a newly focused word into view.
addEventListener('scroll', () => { if (Date.now() - tipAt > 250) hideTip(); }, { passive: true, capture: true });
addEventListener('resize', hideTip);

// ---------- what a word means: an ⓘ button ([data-card]) opens the card right after it (web/table.js, a column's name) ----------
// The card is placed on screen like a tooltip but stays open until a press elsewhere, Esc or a scroll, so its links work.
let cardOpen = null;
function closeCard() { if (!cardOpen) return; cardOpen.hidden = true; cardOpen.previousElementSibling?.setAttribute('aria-expanded', 'false'); cardOpen = null; }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-card]');
  if (!b) { if (cardOpen && !cardOpen.contains(e.target)) closeCard(); return; }
  e.stopPropagation();
  const c = b.nextElementSibling, again = cardOpen === c;
  closeCard(); if (again) return;
  c.hidden = false; b.setAttribute('aria-expanded', 'true'); cardOpen = c;
  const edge = 12, r = b.getBoundingClientRect(), w = Math.min(320, innerWidth - 2 * edge);
  c.style.width = `${w}px`;
  const h = c.offsetHeight, left = Math.max(edge, Math.min(r.left - 12, innerWidth - w - edge));
  const top = r.bottom + 8 + h <= innerHeight - 8 ? r.bottom + 8 : Math.max(8, r.top - h - 8);
  c.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && cardOpen) { const b = cardOpen.previousElementSibling; closeCard(); b?.focus(); } });
addEventListener('scroll', e => { if (cardOpen && !cardOpen.contains(e.target)) closeCard(); }, { passive: true, capture: true });
addEventListener('resize', closeCard);

// ---------- "Sending…": a form with data-sending shows those words on its button and cannot be sent twice ----------
// For forms the browser submits. A form sent by a script calls sending(form, true) and sending(form, false) itself.
export function sending(form, on) {
  const b = form.querySelector('button[type="submit"],button:not([type])');
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = form.dataset.sending || 'Sending…'; b.disabled = true; }
  else if (b.dataset.label) { b.textContent = b.dataset.label; b.disabled = false; }
}
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.matches?.('form[data-sending]') && !f.dataset.script) setTimeout(() => { if (!e.defaultPrevented) sending(f, true); });
});
// Coming back with the browser's Back button must not leave the button stuck.
addEventListener('pageshow', () => document.querySelectorAll('form[data-sending]').forEach(f => sending(f, false)));

// ---------- Skeletons while the next page loads ----------
// A click on a link to another page of the site shows, after a moment, grey blocks in the shape of that page (Home, a
// list of drugs, a drug) in place of the content; the sidebar or top bar stays. The browser keeps the old page on screen
// until the new one arrives, so this is all that changes. Back to a page the browser kept restores it. Styles: style.css 4b.
// Step 7 (15 Nov): the shapes of the design pass, as Search's loading has them: the page's title and grey line, its summary
// boxes, and its boxes with a header and rows; the first box's header says Loading with a small spinner.
const bar = w => `<span class="sk-b" style="width:${w}"></span>`;
const head = (crumb, button) => `${crumb ? `<div class="sk-crumb">${bar('120px')}</div>` : ''}<div class="sk-title">${bar('min(360px,60%)')}</div><div class="sk-sub">${bar('min(440px,75%)')}</div>${button ? `<div class="sk-btn">${bar('92px')}</div>` : ''}`;
const stats = n => `<div class="sk-stats" style="--n:${n}">${Array.from({ length: n }, () => `<div>${bar('45%')}${bar('60%')}${bar('75%')}</div>`).join('')}</div>`;
const W = ['72%', '58%', '80%', '64%', '50%'];
const box = (n, cols, loading = false) => `<div class="sk-box"><div class="sk-bh"><span class="sk-i"></span>${bar('120px')}${loading ? '<span class="loadstep"><span class="spin" aria-hidden="true"></span>Loading</span>' : ''}</div>${Array.from({ length: n }, (_, i) => `<div class="sk-r" style="--c:${cols}">${Array.from({ length: cols }, (_, j) => bar(W[(i + j) % W.length])).join('')}</div>`).join('')}</div>`;
// Home: its own head with the Updated tag; on a paid plan with something followed the three
// numbers, and with two or more the round buttons to pick one; then What changed and Coming up, six rows each in Home's columns
// (date, drug, change, and which landscape when there are two or more). Free: What changed is the date and what kind of change,
// then "and N more" and the Solo note under it. Read from the sidebar, which stays on screen.
function homeSkeleton() {
  const follows = [...document.querySelectorAll('#followgrp a.it')], paid = !!follows.length && document.querySelector('#followgrp .lbl')?.textContent === 'Following';
  const free = !!follows.length && !paid, many = paid && follows.length > 1, cols = many ? 4 : free ? 2 : 3;
  const note = `<div class="sk-r feed rest" style="--c:2"><span></span>${bar('64px')}</div><div class="sk-note">${bar('min(400px,60%)')}${bar('45%')}<span class="sk-nbtn"></span></div>`;
  const feed = (loading, c = 3) => `<div class="sk-box"><div class="sk-bh"><span class="sk-i"></span>${bar('120px')}${loading ? '<span class="loadstep"><span class="spin" aria-hidden="true"></span>Loading</span>' : ''}</div>${Array.from({ length: 6 }, (_, i) => `<div class="sk-r feed" style="--c:${c}">${bar('48px')}${Array.from({ length: c - 1 }, (_, j) => bar(W[(i + j) % W.length])).join('')}</div>`).join('')}${loading && free ? note : ''}</div>`;
  return `<div class="sk-hh"><div class="sk-title">${bar('120px')}</div><span class="sk-upd">${bar('100%')}</span></div><div class="sk-sub">${bar('min(440px,75%)')}${bar('50%')}</div>
    ${paid ? stats(3) : ''}${many ? `<div class="sk-chips">${['36px', ...follows.map(() => '64px')].map(w => `<span>${bar(w)}</span>`).join('')}</div>` : ''}${feed(true, cols)}${feed(false, many ? 4 : 3)}`;
}
const SKELETON = {
  home: homeSkeleton,
  list: () => `${head(true, true)}${box(9, 5, true)}`,
  index: () => `${head(false, false)}${box(4, 5, true)}`,
  drug: () => `${head(true, true)}${stats(4)}${box(5, 2, true)}`,
  page: () => `${head(false, false)}${box(5, 2, true)}`,
};
function kindOf(url) {
  const p = url.pathname;
  if (p === '/app' || p === '/app/' || (p === '/' && document.querySelector('.side'))) return 'home';   // / is Home on the dashboard's address
  if (/^\/drugs\//.test(p)) return 'drug';
  if (p === '/landscapes') return 'index';
  if (/^\/(landscapes|companies|targets|diseases)\/|^\/(app\/)?(l\/|search)/.test(p)) return 'list';
  return 'page';
}
let skelTimer;
export function showSkeleton(href) {
  let url; try { url = new URL(href, location.href); } catch { return; }
  if (url.origin !== location.origin || /^\/(static|auth|billing|api|mcp|follow|signin)\b|\.(csv|md|txt)$/.test(url.pathname)) return;
  if (url.pathname === location.pathname && url.search === location.search) return;   // same page: a # panel or a reload
  const box = document.querySelector('.app .main') || document.querySelector('body > header.nav');
  if (!box) return;
  clearTimeout(skelTimer);
  skelTimer = setTimeout(() => {
    const kind = kindOf(url), el = document.createElement('div');
    el.className = `skel${kind === 'home' ? ' home' : ' wrap'}`; el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Loading');
    el.innerHTML = SKELETON[kind]();
    document.querySelectorAll('.skel').forEach(s => s.remove());
    if (box.matches('.main')) { box.classList.add('skel-on'); box.append(el); } else { document.body.classList.add('skel-on'); box.after(el); }
    // The sidebar marks where you are going.
    document.querySelectorAll('.side .it.on').forEach(a => a.classList.remove('on'));
    document.querySelectorAll('.side a.it').forEach(a => { if (a.pathname + a.search === url.pathname + url.search && (!a.hash || a.hash === '#home')) a.classList.add('on'); });
    scrollTo(0, 0);
  }, 90);   // a page that arrives sooner shows no flash of grey
}
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
  setTimeout(() => { if (!e.defaultPrevented) showSkeleton(a.href); });   // after the page's own handlers, which may keep the click
});
addEventListener('pageshow', e => {
  if (!e.persisted) return;
  clearTimeout(skelTimer);
  document.querySelectorAll('.skel').forEach(s => s.remove());
  document.querySelectorAll('.skel-on').forEach(b => b.classList.remove('skel-on'));
});

// ---------- The sign-in box over a page (src/pages/signin.js signinDialog; design pass, screen 4) ----------
// Signed out, Follow (a link with data-signin) opens the box in place of the sign-in page; on a phone it is a sheet from the
// bottom (style.css). Its forms are sent from here with X-Signin-Box: the answer is the box's next state ("Check your inbox",
// a wrong code), or { go } once signed in: /follow?…, which follows and comes back to the page. Google leaves for Google's
// own screen and comes back the same way. Without this script the link goes to /follow, which asks to sign in on a page.
const signbox = document.getElementById('signbox');
if (signbox?.showModal) {
  const card = signbox.querySelector('[data-box]'), first = card.innerHTML;
  const focus = () => (card.querySelector('[autofocus]') || card.querySelector('input:not([type="hidden"])'))?.focus();
  const reset = () => { card.innerHTML = first; focus(); };
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[data-signin]');
    if (a) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); card.innerHTML = first; signbox.showModal(); focus(); return;
    }
    if (!signbox.open) return;
    if (e.target === signbox || e.target.closest('[data-box-close]')) { signbox.close(); return; }
    if (e.target.closest('[data-box-reset]')) { e.preventDefault(); reset(); }
    // Follow's choice (Choose Solo, Sign up free, Sign in): the sign-in form for that choice, in the same box.
    const g = e.target.closest('a[data-box-go]');
    if (g) { e.preventDefault(); fetch(g.href, { headers: { 'X-Signin-Box': '1' } }).then(r => r.text()).then(t => { card.innerHTML = t; focus(); }).catch(() => location.assign(g.href)); }
  });
  card.addEventListener('submit', async e => {
    const f = e.target;
    e.preventDefault(); sending(f, true);
    let r;
    try { r = await fetch(f.action, { method: 'POST', headers: { 'X-Signin-Box': '1', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(f)) }); }
    catch { sending(f, false); f.submit(); return; }   // offline for a moment: the plain page says what happened
    if ((r.headers.get('content-type') || '').includes('json')) { const { go } = await r.json(); location.assign(go); return; }
    card.innerHTML = await r.text(); focus();
  });
}
