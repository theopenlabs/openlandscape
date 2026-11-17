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
