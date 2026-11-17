// The setup guide (src/pages/guide.js writes its steps into #guide-data). Three looks in the bottom-right corner: the card
// (bar and "Next: …"), the card open (the steps in sections) and the pill (a ring). × turns the card into the pill; the pill
// opens the card again. Which look is kept per browser; on a phone it starts as the pill and never opens by itself.
// On a phone's Home, while picking or opening their landscape is next, the pill says that step in words (17 Nov).
// "Hide the guide for good" is saved on the account (/api/guide); Settings can show it again.
import { icon } from '/static/icons.js';

const data = JSON.parse(document.getElementById('guide-data').textContent);
const steps = data.sections.flatMap(s => s.steps);
const phone = matchMedia('(max-width:560px)').matches, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const KEY = 'ol_guide';
const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
const keep = s => { try { localStorage.setItem(KEY, s); } catch { /* private window: the look is not kept */ } };
let state = phone ? (saved === 'card' ? 'card' : 'pill') : ['card', 'open', 'pill'].includes(saved) ? saved : 'card';
let fresh = new Set(steps.filter(s => s.fresh).map(s => s.id));   // ticked since the last page

const locked = s => s.after && !steps.find(x => x.id === s.after).done;
const next = () => steps.find(s => !s.done && !locked(s));
const ease = 'cubic-bezier(.3,.7,.2,1)';

const root = document.createElement('div');
root.className = 'sg';
root.setAttribute('role', 'complementary');
root.setAttribute('aria-label', 'Setup guide');

function draw() {
  const d = steps.filter(s => s.done).length, n = steps.length, nx = next();
  const openSec = data.sections.findIndex(s => s.steps.includes(nx));
  const C = 2 * Math.PI * 8.4, says = phone && data.home && nx && ['pick', 'open'].includes(nx.id);
  root.className = `sg ${data.finished ? 'card finished' : state}`;
  const stepHTML = s => {
    const lk = locked(s), cls = [s.done ? 'done' : lk ? 'locked' : s === nx ? 'cur' : '', fresh.has(s.id) ? 'justdone' : ''].join(' ');
    const act = s.done || lk || !s.act ? '' : s.q ? `<span class="act"><button class="btn sm primary" type="button" data-copy-q>${icon('copy', 16)}${s.act[0]}</button></span>`
      : `<span class="act"><a class="btn sm primary" href="${s.act[1]}">${s.act[0]}</a></span>`;
    return `<div class="sg-step ${cls}"><span class="o">${s.done ? icon('check', 12) : ''}</span><div class="t"><b>${s.title}</b>
      ${s.done ? `<span class="d">${s.doneSub}</span>` : lk ? `<span class="d">${s.why}</span>` : s.sub ? `<span class="d">${s.sub}</span>` : ''}
      ${!s.done && !lk && s.q ? `<span class="q" id="sg-q">“${s.q}”</span>` : ''}${act}</div></div>`;
  };
  root.innerHTML = `<div class="sg-card">
    <div class="sg-head"><h2>${data.finished ? 'You’re set up' : 'Setup guide'}<span class="n">${d} of ${n}</span></h2>
      ${data.finished ? '' : `<button class="sg-ib" type="button" data-to="${state === 'open' ? 'card' : 'open'}" aria-expanded="${state === 'open'}" aria-label="${state === 'open' ? 'Show less' : 'Show every step'}">${icon(state === 'open' ? 'shrink' : 'expand', 18)}</button>`}
      <button class="sg-ib" type="button" data-to="${data.finished ? 'gone' : 'pill'}" aria-label="Close">${icon('close', 18)}</button></div>
    <div class="sg-bar" role="progressbar" aria-label="Steps done" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${d}"><i style="width:${Math.round(d / n * 100)}%"></i></div>
    ${data.finished ? '<p class="sg-done">Every step is done. The guide goes away when you leave this page.</p>'
      : `<p class="sg-next">Next: <button type="button" class="sg-nx" data-to="open">${nx ? nx.title : ''}</button></p>
    <div class="sg-body">${data.sections.map((sec, i) => {
      const sd = sec.steps.filter(s => s.done).length;
      return `<div class="sg-sec${i === openSec ? ' on' : ''}${sd === sec.steps.length ? ' alldone' : ''}"><button class="sg-sh" type="button" aria-expanded="${i === openSec}"><span>${sec.title}</span><span class="c">${sd} of ${sec.steps.length}</span>${icon('chevron', 16)}</button>
      <div class="sg-steps">${sec.steps.map(stepHTML).join('')}</div></div>`;
    }).join('')}</div>
    <div class="sg-foot"><span>Ticks itself as you go.</span><button type="button" data-to="hide">Hide the guide for good</button></div>`}
  </div>
  <button class="sg-pill${says ? ' says' : ''}" type="button" data-to="card" aria-label="Setup guide, ${d} of ${n} done${says ? `. Next: ${nx.title}` : ''}">${says ? `<span>Next: ${nx.title}</span>` : 'Setup guide'}
    <svg class="sg-ring" viewBox="0 0 22 22" aria-hidden="true"><circle class="bg" cx="11" cy="11" r="8.4"/><circle class="fg" cx="11" cy="11" r="8.4" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - d / n)}"/></svg></button>`;
  if (state === 'open') fresh = new Set();   // the tick draws once, the first time the steps are seen
}

// Card ⇄ pill: a plain box (the card's background, border and shadow) shrinks from the card's size to the pill's, or grows
// back; both sit in the bottom-right corner, so only the size changes. The words fade in once it is there.
function morph(to) {
  const a = root.querySelector(state === 'pill' ? '.sg-pill' : '.sg-card').getBoundingClientRect();
  state = to; draw();
  const el = root.querySelector(to === 'pill' ? '.sg-pill' : '.sg-card'), b = el.getBoundingClientRect();
  if (reduce) return;
  const ghost = document.createElement('div');
  ghost.className = 'sg-ghost';
  el.style.opacity = 0;
  root.append(ghost);
  const r = [to === 'pill' ? '12px' : '999px', to === 'pill' ? '999px' : '12px'];
  ghost.animate([{ width: `${a.width}px`, height: `${a.height}px`, borderRadius: r[0] }, { width: `${b.width}px`, height: `${b.height}px`, borderRadius: r[1] }], { duration: 320, easing: ease });
  // Cleaned up on a timer, not on the animation's end: a page in a background tab may never finish it.
  setTimeout(() => { ghost.remove(); el.style.opacity = ''; el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }); }, 320);
}
// Card ⇄ open: the card grows upwards to hold the steps.
function grow(to) {
  const a = root.querySelector('.sg-card').getBoundingClientRect();
  state = to; draw();
  if (reduce) return;
  const c = root.querySelector('.sg-card'), b = c.getBoundingClientRect();
  c.animate([{ width: `${a.width}px`, height: `${a.height}px` }, { width: `${b.width}px`, height: `${b.height}px` }], { duration: 260, easing: ease });
}
const go = to => {
  if (to === state) return;
  if (to === 'pill' || state === 'pill') morph(to); else grow(to);
  keep(to);
};
const leave = () => {
  if (reduce) return root.remove();
  root.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 200, fill: 'forwards' });
  setTimeout(() => root.remove(), 200);
};

root.addEventListener('click', async e => {
  const sec = e.target.closest('.sg-sh');
  if (sec) { const on = sec.parentElement.classList.toggle('on'); sec.setAttribute('aria-expanded', on); return; }
  const cp = e.target.closest('[data-copy-q]');
  if (cp) {
    const was = cp.innerHTML;
    try { await navigator.clipboard.writeText(document.getElementById('sg-q').textContent.replace(/^“|”$/g, '')); cp.textContent = 'Copied'; } catch { cp.textContent = 'Select and copy'; }
    setTimeout(() => (cp.innerHTML = was), 1600);
    return;
  }
  const t = e.target.closest('[data-to]');
  if (!t) return;
  const to = t.dataset.to;
  if (to === 'gone') return leave();
  if (to === 'hide') { fetch('/api/guide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"hidden":1}' }); return leave(); }
  go(to);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state === 'open') go('card'); });

// On Connect your AI, the connect step ticks while you watch: the page asks every few seconds whether the AI app signed in.
const connect = steps.find(s => s.id === 'connect');
if (connect && !connect.done) {
  const t = setInterval(async () => {
    if (document.hidden || location.hash !== '#mcp') return;
    try {
      const r = await (await fetch('/api/connection')).json();
      if (!r.app) return;
      clearInterval(t);
      Object.assign(connect, { done: true, doneSub: `${r.app.replace(/[<&]/g, '')} is connected` });
      fresh = new Set(['connect']);
      draw();
    } catch { /* offline: try again next time */ }
  }, 4000);
}

// The first visit's "You're signed in" note sits at the bottom too: the guide waits until it has gone.
const show = () => { document.body.append(root); draw(); if (!reduce) root.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: ease }); };
const hint = document.getElementById('framehint');
if (hint && !hint.hidden) new MutationObserver((_, o) => { if (!hint.isConnected) { o.disconnect(); show(); } }).observe(hint.parentNode, { childList: true });
else show();
