// The admin pages' small interactions (src/admin.js). Growth: a step of the strip shows only the new people who reached it;
// a row of "Where they came from" opens to show who came from there. Without scripts every row shows and nothing opens.
const steps = document.querySelectorAll('.path .ps.pick');
const bar = document.querySelector('.adm .filter');
if (steps.length && bar) {
  const rows = document.querySelectorAll('table.ppl tr[data-s]'), none = document.querySelector('.adm .nothing.none');
  const pick = el => {
    const on = el && el.getAttribute('aria-pressed') !== 'true', i = el ? +el.dataset.step : 0;
    let shown = 0;
    steps.forEach(s => s.setAttribute('aria-pressed', String(on && s === el)));
    rows.forEach(r => { const ok = !on || i === 1 || r.dataset.s[i - 2] === '1'; r.hidden = !ok; if (ok) shown++; });
    bar.hidden = !on;
    if (none) none.hidden = shown > 0;
    if (on) { bar.querySelector('[data-fname]').textContent = el.querySelector('.k').textContent; document.getElementById('new').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
  steps.forEach(s => {
    s.addEventListener('click', () => pick(s));
    s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(s); } });
  });
  bar.querySelector('[data-fclear]').addEventListener('click', e => { e.preventDefault(); const on = document.querySelector('.path .ps[aria-pressed="true"]'); if (on) pick(on); });
}
document.querySelectorAll('.adm tr.drow').forEach(r => {
  r.tabIndex = 0; r.setAttribute('role', 'button'); r.setAttribute('aria-expanded', 'false');
  const toggle = () => { const d = r.nextElementSibling, open = d.hidden; d.hidden = !open; r.classList.toggle('open', open); r.setAttribute('aria-expanded', String(open)); };
  r.addEventListener('click', e => { if (!e.target.closest('a')) toggle(); });
  r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
});
// Today's "⋯" menus: Add a note opens the row's note field; a click elsewhere or Escape closes an open menu.
document.addEventListener('click', e => {
  const add = e.target.closest('[data-note]');
  if (add) { const f = add.closest('form'), i = f.querySelector('.nnote'); i.hidden = false; add.closest('details').open = false; i.focus(); return; }
  document.querySelectorAll('.adm details.pm[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.adm details.pm[open]').forEach(d => { d.open = false; }); });
// Review: J and K move between items, P and D press Publish and Dismiss on the one you are on (the buttons say which).
const cards = [...document.querySelectorAll('.adm .rv[tabindex]')];
if (cards.length) document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,textarea,select')) return;
  const i = cards.indexOf(document.activeElement.closest?.('.rv'));
  const go = c => { if (c) { c.focus(); c.scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
  if (e.key === 'j') go(cards[i + 1] || cards[0]);
  else if (e.key === 'k') go(cards[Math.max(0, i - 1)]);
  else if ((e.key === 'p' || e.key === 'd') && i >= 0) { const b = cards[i].querySelector(`[data-key="${e.key}"]`); if (b) { cards[i].classList.add('done'); b.click(); } }
});
