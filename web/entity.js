// Drug, company and target pages (src/pages/entities.js): the Follow button (its Free notice and its Following menu), the
// drug table, the trials filter, lists that show their first six rows, and the sponsor names at the foot.
import { wireLandscape, wireTable, openFollowBox, openSwapBox } from '/static/table.js';

const $ = id => document.getElementById(id);

// ---------- Follow ----------
// Free: what Solo would give, about what is on the screen. Solo: Following opens a menu with Unfollow.
document.querySelectorAll('[data-solo]').forEach(b => b.addEventListener('click', () => openFollowBox({ name: b.dataset.name, follow: b.dataset.follow })));
// A Follow press that did not go through (?notice=1): the box that says why, once (screen 6).
const why = document.querySelector('[data-notice]');
if (why) {
  history.replaceState(null, '', location.pathname);
  (why.dataset.notice === 'full' ? openSwapBox : openFollowBox)({ name: why.dataset.name, follow: why.dataset.follow });
}
const menu = document.querySelector('.fol .menu');
if (menu) {
  const btn = menu.querySelector('button'), box = $(btn.getAttribute('aria-controls'));
  const open = on => { box.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on)); };
  btn.addEventListener('click', () => open(btn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('mousedown', e => { if (!menu.contains(e.target)) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
  box.querySelector('[data-unfollow]').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    await fetch('/api/follow/' + e.currentTarget.dataset.unfollow, { method: 'DELETE' });
    location.replace(location.pathname);   // the page and its sidebar, without the follow
  });
}

// ---------- drug tables: the target page's landscape, a company's drugs ----------
for (const b of document.querySelectorAll('.landbody')) {
  if (b.querySelector('.listtools')) wireLandscape(b.id);
  else wireTable($(b.id + '-t'), { total: +b.dataset.total });
}

// ---------- a drug's trials: All, Active, In the EU ----------
const tf = $('trf'), tt = $('trt');
tf?.addEventListener('click', e => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  tf.querySelectorAll('button[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  tt.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = b.dataset.f !== 'all' && !tr.dataset.f.split(' ').includes(b.dataset.f); });
});
// On a phone the trials show their first six, then "All N trials".
$('tra')?.addEventListener('click', e => { tt.closest('.tablebox').classList.add('all'); e.target.hidden = true; });

// ---------- lists that show their first six rows, then "All N" ----------
document.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => { b.previousElementSibling.classList.add('all'); b.remove(); }));
// "See all 8" sponsor names
document.querySelectorAll('[data-sponsors]').forEach(b => b.addEventListener('click', () => { b.nextElementSibling.hidden = false; b.remove(); }));   // the registry names
