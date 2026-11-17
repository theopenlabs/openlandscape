// Public pages: the landing page, pricing, How we check, Talk to us and the unsubscribe pages (specs 14, 16, 20, 22).
import { esc, rowsHTML, phaseBar, milestonePlain, shortDate } from '../../web/table.js';
import { liveMode } from '../billing.js';
import { BRAND, LOGO, prettyDate, layout, footer, pageHead } from './shared.js';
import { eventWords } from './app.js';
import { icon } from '../../web/icons.js';

const ext = (u, t) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : t);
const AGENTS = [['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['cursor', 'Cursor'], ['gemini', 'Gemini CLI']];
const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const SEARCH_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

// The search field that leads to sign-up, then to the person's results (spec 14). There is no search without an account.
const searchForm = (id, placeholder) => `<form class="bigsearch" action="/start" method="get" role="search">
  <label class="sr" for="${id}">A disease, drug, target or company</label>${SEARCH_ICON}
  <input class="input" id="${id}" name="q" required maxlength="120" placeholder="${esc(placeholder)}" autocomplete="off">
  <button class="btn primary" type="submit">See the drugs</button>
</form>`;

// A window frame with a small copy of the signed-in sidebar, around real rows.
const SIDE = `<div class="mside" aria-hidden="true"><span class="logo">${LOGO}${BRAND}</span><span>Home</span><span>Search</span><i>Your landscapes</i><span class="on">Obesity</span><span>Non-small cell lung cancer</span><i>Use with AI</i><span>MCP connector</span></div>`;
const frame = (body, label) => `<figure class="frame" aria-label="${esc(label)}"><div class="frame-h"><i></i><i></i><i></i><span>openlandscape.app</span></div><div class="frame-in">${SIDE}<div class="frame-b">${body}</div></div></figure>`;

function feedRows(changes, coming, year) {
  const ch = changes.map(i => { const w = eventWords(i); return `<li><span class="when">${esc(shortDate(i.decision_date || i.date, year))}</span><span class="who"><b>${esc(i.drug)}</b></span><span class="ev" title="${esc(w.what)}">${ext(i.url, esc(w.what))}<span class="src">${w.src ? ` · ${esc(w.src)}` : ''}</span></span></li>`; }).join('');
  const cu = coming.map(c => `<li><span class="when">${esc(shortDate(c.date, year))}${c.soon || c.date <= c.soonBy ? '<span class="tag soon">soon</span>' : ''}</span><span class="who"><b>${esc(c.drug)}</b></span><span class="ev">${ext(c.source, esc(milestonePlain(c.what)))}</span></li>`).join('');
  return (ch ? `<h3>Latest changes</h3><ul class="feed">${ch}</ul>` : '') + (cu ? `<h3>Coming up</h3><ul class="feed">${cu}</ul>` : '');
}

// ---------- landing page (spec 16 part 1, spec 14) ----------
// Everything in the frames is live data; nothing is a screenshot.
export function landingPage(L, { user, changes = [], coming = [], showcase = [], demo = '' }) {
  const s = L.stats, upd = prettyDate(L.data.trials), year = (L.data.trials || '').slice(0, 4);
  const soonBy = new Date(Date.parse(L.data.trials || '2026-01-01') + 7 * 864e5).toISOString().slice(0, 10);
  // One row per stage, so the sample reads as a pipeline and not as five approved drugs: the first checked drug of each
  // stage from Approved down to Phase 2, then the next checked Phase 3 drug. Falls back to the top rows.
  const pickStage = lv => L.programs.find(p => p.curated && p.phase.level === lv && !picked.includes(p));
  const picked = [];
  for (const lv of [5, 4, 3, 3, 2]) { const p = pickStage(lv); if (p) picked.push(p); }
  const top = picked.length === 5 ? L.programs.filter(p => picked.includes(p)) : L.programs.slice(0, 5);
  const asks = ['Map every amylin drug in Phase 2 or later.', 'Which oral GLP-1s read out in the next six months?', 'What is HRS9531?'];
  const short = x => x.short;
  return layout({
    title: `${BRAND}: every drug in development, with a source for every fact`, user, path: '/',
    desc: `Who is developing what, how far each drug has got and what happens next, for any disease. A source for every fact. Free, no payment card needed.`,
    body: `<main class="home">
<section class="hero wrap">
  <h1>See every drug in development</h1>
  <p class="sub">The competitor landscape you build by hand in a spreadsheet, already built, checked against its sources and kept up to date.</p>
  ${searchForm('q1', 'heart failure')}
</section>

<section class="wrap shot">
  ${frame(`<h2 class="fh">Obesity</h2><p class="muted small">${s.checked} of ${s.programs} checked · data updated ${upd}</p>
    <div class="phasebar">${phaseBar(s)}</div>
    <div class="tablebox"><table class="land">${rowsHTML(top, { details: false })}</table></div>`, 'The obesity landscape, live')}
  <p class="openlink"><a href="/landscapes/obesity">Open all ${s.programs} obesity drugs. Free, <span class="nowrap">no sign-up&nbsp;→</span></a><span class="sep" aria-hidden="true">·</span><a href="/how-we-check">How we check</a></p>
</section>

<section class="band" id="better"><div class="wrap">
  <h2 class="big">Better than what you use now</h2>
  <p class="sub">Every row comes from public registries and regulators, and links to its source. Drugs not yet checked are marked.</p>
  <div class="cards vs">
    <div class="card"><span class="ic">${icon('table')}</span><h3>A spreadsheet built by hand</h3><p class="muted">Days to build, stale a month later.</p><div class="us"><b>Updated every day</b></div></div>
    <div class="card"><span class="ic">${icon('database')}</span><h3>A database priced for big pharma</h3><p class="muted">Tens of thousands a year and a sales call.</p><div class="us"><b>A fraction of the price</b></div></div>
    <div class="card"><span class="ic">${icon('chat')}</span><h3>Asking an AI chat</h3><p class="muted">Found 44% of obesity drugs in <a href="/docs/bakeoff-obesity">our test</a>.</p><div class="us"><b>All ${s.programs}, with sources</b></div></div>
  </div>
</div></section>

<section class="band alt" id="follow"><div class="wrap">
  <h2 class="big">Every change, as it happens</h2>
  <p class="sub">Follow your areas and see new trials, stage changes, FDA and EMA decisions and SEC filings the day they happen. On Monday, one email with what changed and what is coming.</p>
  ${frame(`<div class="mfeed">${feedRows(changes, coming.map(c => ({ ...c, soonBy })), year)}</div>`, 'What changed in obesity, and what is coming')}
  <div class="cta">${user ? '<a class="btn primary" href="/app">Open the app</a>' : '<a class="btn primary" href="/signin">Start free</a>'}</div>
</div></section>

<section class="band" id="agents"><div class="wrap split">
  <div>
    <h2 class="big">Your AI, with checked data</h2>
    <p class="sub">Ask Claude or ChatGPT about any drug, company or trial. The answers come from our checked list, each with its source.</p>
    <ul class="qs">${asks.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
    <div class="cta"><a class="btn primary" href="/connect">Connect your AI</a></div>
    <p class="agents">${AGENTS.map(([k, n]) => `<span><img src="/static/icons/${k}.svg" width="16" height="16" alt="">${n}</span>`).join('')}<span class="muted">or any MCP app</span><span class="free">Free includes 25 questions a month.</span></p>
  </div>
  ${demo}
</div></section>

<section class="band" id="start"><div class="wrap">
  <h2 class="big">What do you work on?</h2>
  <p class="sub">Search any disease, drug, target or company. Or start with one of these.</p>
  ${searchForm('q2', 'A disease, drug, target or company')}
  <div class="lcards">${showcase.map(x => { const st = x.L.stats, n = st.next; return `<a class="lcard" href="/landscapes/${x.slug}"><span class="ic">${icon('landscape')}</span><b>${esc(short(x))}</b><span class="muted small">${nOf(st.programs, 'drug', 'drugs')} · ${nOf(st.trials, 'active trial', 'active trials')}</span><span class="phasebar mini"><span class="bar">${st.by_phase.filter(b => b.count).map(b => `<i class="f${b.level}" style="flex:${b.count}"></i>`).join('')}</span></span>${n ? `<span class="muted small nx">Next: ${esc(shortDate(n.date, year))}, ${esc(n.drug)}</span>` : ''}</a>`; }).join('')}</div>
  <p class="alllink"><a href="/landscapes">All landscapes →</a></p>
</div></section>

<section class="band alt closer" id="price"><div class="wrap">
  <h2 class="big">${user ? 'Your landscapes are waiting' : 'Start free today'}</h2>
  <p class="sub">One landscape in full, for good. No payment card, no time limit.</p>
  <div class="cta">${user ? '<a class="btn primary" href="/app">Open the app</a>' : '<a class="btn primary" href="/signin">Start free</a>'}<a class="btn" href="/pricing">Compare plans</a></div>
  <p class="fine">Solo is $49 a month, excl. VAT, when you need every list.</p>
</div></section>
</main>
${footer()}
`,
  });
}

// ---------- pricing (spec 16 part 4, spec 20 part 1, build plan section 1) ----------
// Each plan's ridge line has one summit per landscape: 1, 5, 30 for a team of three; Company sits under a full range.
const ridge = (d, cls = '') => `<svg class="ridge-l${cls}" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
const R_FREE = 'M0 46 L84 42 L122 5 L160 40 L240 46';
const R_SOLO = 'M0 46 L24 16 L48 40.4 L72 26.3 L96 41.3 L120 17.2 L144 40.1 L168 10.1 L192 40.9 L216 19.9 L240 46';
const R_TEAM = 'M0 46 L4 31.2 L8 40.9 L12 28.3 L16 32.8 L20 28.2 L24 34.8 L28 27.9 L32 32.7 L36 27.6 L40 34.3 L44 23.6 L48 30.3 L52 18.6 L56 23.2 L60 10.4 L64 16.9 L68 8.2 L72 16.6 L76 9.4 L80 13.7 L84 11 L88 18.5 L92 15.4 L96 23.1 L100 16.6 L104 22.8 L108 17.9 L112 24.1 L116 18.1 L120 26 L124 19.3 L128 23.8 L132 20.8 L136 29.1 L140 23.9 L144 30.5 L148 26.9 L152 32 L156 30.4 L160 36.3 L164 27 L168 32.2 L172 27.6 L176 32.2 L180 26.4 L184 32 L188 25.1 L192 34 L196 29.3 L200 35.5 L204 33.6 L208 39.4 L212 34.5 L216 41.8 L220 36.9 L224 41.6 L228 33.3 L232 41.5 L236 31.7 L240 46';
const R_RANGE = 'M0 46 L10 36.1 L20 42 L30 24.5 L40 36.5 L50 21.7 L60 33.7 L70 12.2 L80 27.2 L90 12.3 L100 24.3 L110 6.3 L120 18.3 L130 10.3 L140 25.3 L150 8.3 L160 20.3 L170 16.2 L180 28.2 L190 17.7 L200 32.7 L210 28.5 L220 40.5 L230 32.1 L240 46';

export function pricingPage({ user, cancelled, error, flash, feed = { news: [], next: null }, today = '' } = {}) {
  const year = today.slice(0, 4);
  const soon = d => d && today && d.length === 10 && d <= new Date(Date.parse(today) + 7 * 864e5).toISOString().slice(0, 10);
  const freeCta = !user ? '<a class="btn cta" href="/signin">Start free</a>' : user.plan === 'free' ? '<span class="btn cta" aria-disabled="true">Your plan</span>' : '<a class="btn cta" href="/app">Open the app</a>';
  // Choose Solo opens Stripe's payment page; signed out it signs in first, then goes straight there (/billing/solo).
  // The Monthly / Yearly switch swaps the prices and what Choose Solo buys.
  const soloCta = !user ? '<a class="btn cta" href="/billing/solo" data-year="/billing/solo?plan=year">Choose Solo</a>'
    : String(user.plan).startsWith('solo') ? '<span class="btn cta" aria-disabled="true">Your plan</span>'
      : '<form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="solo" data-year="solo_year"><button class="btn cta" type="submit">Choose Solo</button></form>';
  // price and note: [monthly, yearly]; the yearly ones show while the switch is on Yearly.
  const two = ([m, y]) => (y ? `<span data-bill="month">${m}</span><span data-bill="year" hidden>${y}</span>` : m);
  const plan = (cls, r, name, price, note, items, cta) => `<div class="pplan${cls}">${ridge(r)}<h2>${name}</h2><div class="pprice">${two(price)}</div><p class="pnote">${two(note)}</p><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>${cta}</div>`;
  const ev = i => `<li><time>${esc(shortDate(i.decision_date || i.date, year))}</time><div><b>${esc(i.drug)}</b> ${esc(eventWords(i).what.replace(/^Approved by the FDA$/, 'approved by the FDA').replace(/^FDA approved a new use$/, 'approved by the FDA for a new use').replace(/^(Recommended|Approved) /, m => m.toLowerCase()))}<span>${esc(i.in)} · ${esc(i.agency)}</span></div></li>`;
  const nx = c => `<li><time>${esc(shortDate(c.date, year))}</time><div><b>${esc(c.drug)}</b> ${esc(milestonePlain(c.what))}${soon(c.date) ? ' <span class="tag soon">soon</span>' : ''}<span>${esc(c.in)} · ${c.kind === 'news' ? 'press release' : 'ClinicalTrials.gov'}</span></div></li>`;
  const faq = [
    ['What happens when I reach my limit?', 'Everything keeps working. On Free, AI questions come back on the 1st of each month. On Solo, a sixth follow takes the place of one you choose to unfollow; Team will follow 10 each. All prices are in US dollars, before VAT. Where VAT applies, it is added at checkout.'],
    ['What do I get before paying?', 'No payment card needed, and no time limit. Search anything and see the top 10 of each list, keep one landscape in full for good, see a count of what changed in it, and ask your AI about it. The ready-made landscapes are free to read without an account.'],
    ['Where does the data come from?', 'ClinicalTrials.gov, the EU trials register, FDA, EMA and SEC filings, and company press releases where a registry has not caught up. Every row links to its source.'],
    ['What does checked mean?', 'Every landscape says how many of its drugs were checked against their sources. Drugs not yet checked are marked. <a href="/how-we-check">How we check</a>'],
    ['When is Team ready?', 'Soon. Join the waitlist to be among the first teams in.'],
    ['Can I cancel?', 'Cancel any time from Settings.'],
    ['Is it open source?', 'The code is. The checked data is what the subscription pays for.'],
  ];
  const team = user
    ? `<div class="waitlist" data-email="${esc(user.email)}"><button class="btn cta" type="button" data-join>Join the waitlist</button></div>`
    : `<form class="waitlist" novalidate><button class="btn cta" type="button" data-open>Join the waitlist</button></form>`;
  return layout({
    title: `Pricing | ${BRAND}`, user, active: 'pricing', path: '/pricing',
    desc: 'Free to start: no payment card needed, no time limit. Solo $49 a month, excl. VAT: every list in full, follow 5 of any landscape, company or drug, every change as it happens.',
    body: `<main class="wrap pricing">
${!liveMode() ? `<div class="flash"><b>Test mode.</b> Payments use Stripe's test mode while we set up. Use card 4242 4242 4242 4242, any future date, any CVC. No real money moves.</div>` : ''}
${cancelled ? '<div class="flash">Checkout cancelled. Nothing was charged.</div>' : ''}
${error ? `<div class="flash error">${esc(error)}</div>` : ''}${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${(() => { const n = feed.news.length + (feed.next ? 1 : 0); return `<div class="ptop${n >= 2 ? '' : ' solo1'}"><div><h1>Every move in your field, as it happens.</h1><p class="sub">Every drug in your areas, checked against its source. Free to start, no payment card needed.</p></div>
${n >= 2 ? `<ol class="pfeed">${feed.news.map(ev).join('')}${feed.next ? nx(feed.next) : ''}</ol>` : ''}</div>`; })()}
<div class="bswitch" role="radiogroup" aria-label="How often to pay"><button type="button" role="radio" aria-checked="true" data-bill-to="month">Monthly</button><button type="button" role="radio" aria-checked="false" data-bill-to="year">Yearly (2 months free)</button></div>
<div class="pplans">
${plan('', R_FREE, 'Free', ['$0'], ['No payment card needed, no time limit'], ['Search anything, top 10 of each list', 'One landscape in full, for good', 'A count of what changed in it', 'Ask your AI about it, 25 questions a month'], freeCta)}
${plan(' solo', R_SOLO, 'Solo', ['$49<small>a month</small>', '$490<small>a year</small>'], ['For one person · excl. VAT', 'For one person · $40.83 a month · excl. VAT'], ['Every list in full, with downloads', 'Follow 5: any landscape, company or drug', 'Every change, as it happens', 'The Monday email', 'Ask your AI, 300 questions a day'], soloCta)}
${plan('', R_TEAM, 'Team<span class="soonlbl">coming soon</span>', ['$149<small>per person</small>', '$1,490<small>per person</small>'], ['A month, for 3 to 10 people · excl. VAT', 'A year, for 3 to 10 people · excl. VAT'], ['Follow 10 per person', 'One shared list for the whole team', 'Everyone sees the same changes', 'The Monday email for each person', 'Everything in Solo, for each person', 'One invoice, people added any time'], team)}
</div>
<div class="pco"><div class="pco-row">${ridge(R_RANGE, ' range')}<div><h2>Bigger than a team?</h2><p>More than 10 people, landscapes built for you, or terms and invoicing that fit your company.</p></div><a class="btn" href="/talk">Talk to us</a></div></div>
<div class="pqs"><h2>Questions</h2><div class="faq">${faq.map(([q, a], i) => `<details${i ? '' : ' open'}><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}</div></div>
</main>${footer()}
<script>
// Monthly / Yearly: swaps every price and note, and what Choose Solo buys.
document.querySelectorAll('[data-bill-to]').forEach(b => b.addEventListener('click', () => {
  const year = b.dataset.billTo === 'year';
  document.querySelectorAll('[data-bill-to]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
  document.querySelectorAll('[data-bill]').forEach(s => { s.hidden = (s.dataset.bill === 'year') !== year; });
  document.querySelectorAll('[data-year]').forEach(e => {
    e.dataset.month ||= e.getAttribute(e.tagName === 'A' ? 'href' : 'value');
    e.setAttribute(e.tagName === 'A' ? 'href' : 'value', year ? e.dataset.year : e.dataset.month);
  });
}));
// Join the Team waitlist, in place (spec 20 part 1). Signed in: one press. Signed out: the button becomes one field and "Join".
const okMail = v => /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v);
const box = document.querySelector('.waitlist');
async function join(email, btn, field) {
  btn.disabled = true; btn.textContent = 'Joining…';
  box.querySelector('.fielderr')?.remove();
  let ok = false;
  try { ok = (await fetch('/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, area: 'Team plan', page: 'team-waitlist' }) })).ok; } catch (_) {}
  if (ok) { box.outerHTML = '<p class="done"><b>You are on the list.</b> We will email ' + email.replace(/[<>&"]/g, '') + ' when Team opens.</p>'; return; }
  btn.disabled = false; btn.textContent = field ? 'Join' : 'Join the waitlist';
  btn.insertAdjacentHTML('beforebegin', '<p class="fielderr" role="alert">That did not work. Try again in a minute.</p>');
}
box?.querySelector('[data-join]')?.addEventListener('click', e => join(box.dataset.email, e.currentTarget));
box?.querySelector('[data-open]')?.addEventListener('click', () => {
  box.innerHTML = '<label class="sr" for="wl">Work email</label><input class="input" id="wl" name="email" type="email" placeholder="you@company.com" autocomplete="email"><button class="btn primary cta" type="submit">Join</button>';
  box.querySelector('input').focus();
});
box?.addEventListener('submit', e => {
  e.preventDefault();
  const f = box.querySelector('input'), b = box.querySelector('button');
  box.querySelector('.fielderr')?.remove();
  if (!okMail(f.value.trim())) { f.setAttribute('aria-invalid', 'true'); f.insertAdjacentHTML('afterend', '<p class="fielderr" role="alert">That email address does not look right. Check the part after the @.</p>'); f.focus(); return; }
  f.removeAttribute('aria-invalid'); join(f.value.trim(), b, f);
});
</script>`,
  });
}

// ---------- How we check ----------
// The read's facts in one place, from the full read on the 8 Nov 2026 copy of the database.
// When the weekly re-read runs, "Last read" becomes "Checked every week" with the latest date (spec 22).
const READ = { date: '2026-11-08', drugs: '2,248', removed: 126, merged: 118 };
export function howWeCheckPage({ user, side = '' } = {}) {
  const rows = list => `<dl class="rows">${list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const box = (ic, title, body) => `<section class="box"><div class="boxhead">${icon(ic)}<h2>${title}</h2></div>${body}</section>`;
  return layout({
    title: `How we check | ${BRAND}`, user, side, path: '/how-we-check',
    desc: 'What "checked" means on every landscape, when the drugs were last read, and where the check stops.',
    body: `<main class="wrap hwc ds">
${pageHead('How we check', 'What “checked” means on every landscape, when the drugs were last read, and where the check stops.')}
<div class="stats">
  <div class="stat"><div class="k">Last read</div><div class="v">${prettyDate(READ.date)}</div><div class="s">Every drug with an active Phase 3 trial or later</div></div>
  <div class="stat"><div class="k">Drugs read</div><div class="v">${READ.drugs}</div><div class="s">${READ.removed} rows removed, ${READ.merged} duplicates merged</div></div>
  <div class="stat"><div class="k">Right when sure</div><div class="v">98 in 100</div><div class="s">Our test on 300 drugs with settled answers</div></div>
</div>
${box('check', 'What checked means', rows([
    ['Checked', `<p>One of two things happened.</p><p><b>A person checked it.</b> We went through the drug's names, its owner, how it works and its stage, each against a source.</p><p><b>Software read it.</b> An AI model read the drug against its own trials in the registry, following a written rule sheet, and found the row right: a real drug, under the right company, at the right stage.</p>`],
    ['Not checked yet', `<p>The drug was grouped automatically from the names companies use in the trial registry. Companies write one drug many ways, so the row could include a trial of another drug, or miss one of its own.</p><p>So far the software has read only drugs with an active Phase 3 trial or later. An earlier drug is unchecked because nobody has looked yet.</p>`],
  ]))}
${box('calendar', 'The last read', rows([
    ['Last read', `<p><b>${prettyDate(READ.date)}.</b> The software read ${READ.drugs} drugs: every one with an active Phase 3 trial or later. It removed ${READ.removed} rows that were not a company's own drug and merged ${READ.merged} duplicates.</p>`],
    ['How sure', `<p>Before the read we tested the software on 300 drugs whose answers were already settled. Where it said it was sure, it matched 98 times in 100. It was sure about three drugs in four. Where it was not sure and wanted to change a row, a person decides.</p><p class="src">Our own test, ${prettyDate(READ.date)}: 216 of 220.</p>`],
  ]))}
${box('info', 'What it does not promise', `<ul class="plainrows">
<li>A checked drug can still be wrong. Where the software was sure, about 2 in 100 by our test.</li>
<li>About one in six drugs the software found right came with a doubt noted. They count as checked.</li>
<li>A software check covers whether the drug is real, whose it is and its stage. It does not cover every other name, how it works or its next date.</li>
<li>A drug that gained a trial after the read still counts as checked.</li>
<li>Checked says nothing about drugs missing from the list. The “Covers” line on each landscape measures that.</li>
</ul>`)}
</main>${side ? '' : footer()}`,
  });
}

// ---------- Our test: AI chat or OpenLandscape ----------
// The obesity test in the How we check look.
// Same URL the landing page and the obesity landscape link to.
export function bakeoffPage({ user, side = '' } = {}) {
  const rows = list => `<dl class="rows">${list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const box = (ic, title, body) => `<section class="box"><div class="boxhead">${icon(ic)}<h2>${title}</h2></div>${body}</section>`;
  return layout({
    title: `AI chat or OpenLandscape: obesity drugs | ${BRAND}`, user, side, path: '/docs/bakeoff-obesity',
    desc: 'We asked Claude for every obesity drug in Phase 2 or later. With web search it found 44% of the 94 drugs in active trials.',
    body: `<main class="wrap hwc ds">
<div class="crumbs"><a href="/how-we-check">How we check</a> / Our test</div>
${pageHead('AI chat or OpenLandscape: obesity drugs', 'We asked Claude for every obesity drug in Phase 2 or later, then counted what it found against the trial registry. Run on 6 November 2026.')}
<div class="stats">
  <div class="stat"><div class="k">Claude with web search</div><div class="v">44%</div><div class="s">41 of 94 drugs found</div></div>
  <div class="stat"><div class="k">Claude from memory</div><div class="v">30%</div><div class="s">28 of 94 drugs found</div></div>
  <div class="stat"><div class="k">The answer key</div><div class="v">94 drugs</div><div class="s">In active Phase 2 and 3 obesity trials</div></div>
</div>
${box('check', 'The test', rows([
    ['The question', '<p>“Every obesity drug in Phase 2 or later, with its company, stage and next milestone.”</p>'],
    ['Who answered', '<p><b>Claude from memory.</b> No internet, answered before we looked at any data.</p><p><b>Claude with web search.</b> It ran 12 searches and read 4 drug-pipeline websites.</p>'],
    ['The answer key', '<p>Every drug in an active, company-run Phase 2 or 3 obesity trial on ClinicalTrials.gov that day: 231 trials. We merged the names one drug goes by into one row, which left 94 drugs.</p>'],
  ]))}
${box('info', 'What the AI missed', rows([
    ['China and Asia', '<p>At least 18 drugs, such as zovaglutide (QL Bio), HRS-4729 (Hengrui), HM15275 (Hanmi) and GL0034 (Sun Pharma).</p>'],
    ['Small biotechs', '<p>At least 15 drugs, such as AT673 (Antag), KBP-336 (KeyBioscience) and GUB-UCN2 (Gubra).</p>'],
    ['Big pharma, early on', '<p>Newer programmes such as Lilly’s LY3457263, Novo Nordisk’s NNC0519-0130 and Roche’s RO7204239.</p>'],
    ['What it did find', '<p>Of its 66 rows, 13 came from memory and Claude itself marked them unconfirmed. About 28 had a next date; most others said “not found”.</p>'],
  ]))}
${box('search', 'Why it misses', rows([
    ['One drug, many names', '<p>Mazdutide shows up as LY3305677 at Eli Lilly and IBI362 at Innovent. Bofanglutide has three names and two sponsors. A search finds one name and stops.</p>'],
    ['Not on the web yet', '<p>Most of the missed drugs are early, or from smaller companies and companies in China. Little is written about them outside the trial registry, so a web search does not reach them.</p>'],
  ]))}
${box('info', 'Where the test stops', `<ul class="plainrows">
<li>One disease, one run each, on 6 November 2026. AI tools change; a run today may score differently.</li>
<li>We tested Claude. ChatGPT was not tested.</li>
<li>We built the answer key by hand from the registry. Four name merges were judgement calls.</li>
</ul>`)}
<p style="margin:24px 0 8px"><a class="btn primary" href="/landscapes/obesity">See all obesity drugs</a></p>
</main>${side ? '' : footer()}`,
  });
}

// ---------- Talk to us (spec 20 part 2), in the sign-in box ----------
// Who comes here: a buyer with a question or a team, someone who found a wrong row, someone who needs a landscape.
// `form`: what was typed, kept when something fails; `bad`: the field that needs fixing; `sent`: the address we will reply to;
// `back`: the page they came from (checked in server.js), for the button after sending.
const HELLO = 'hello@openlandscape.app';
export function talkPage({ user, form = {}, bad = '', failed = false, sent = '', back = '' } = {}) {
  const email = form.email ?? user?.email ?? '';
  return layout({
    title: `Talk to us | ${BRAND}`, user,
    desc: 'A question, a wrong row, a landscape you need, or a plan for more than 10 people.',
    body: `<main class="signin auth talk"><div class="card">${sent ? `<span class="okmark">${icon('check', 20)}</span>
<h1>Thanks, we have your message</h1>
<p class="lede">We will reply to <b>${esc(sent)}</b>.</p>
<a class="btn wide" href="${esc(back || '/')}">${back ? 'Go back' : `Go to ${BRAND}`}</a>` : `
<h1>Talk to us</h1>
<p class="lede">A question, a wrong row, a landscape you need, or a plan for more than 10 people. We read every message.</p>
${failed ? '<p class="msg" role="alert"><b>We could not send your message.</b> Try again in a minute.</p>' : ''}
<form method="post" action="/talk" data-sending="Sending…" novalidate>
  ${back ? `<input type="hidden" name="back" value="${esc(back)}">` : ''}
  <label for="t-email" class="field">Work email</label>
  <input class="input" id="t-email" name="email" type="email" required maxlength="200" placeholder="you@company.com" value="${esc(email)}"${bad === 'email' ? ' aria-invalid="true"' : ''}>
  ${bad === 'email' ? '<p class="fielderr" role="alert">That email address does not look right. Check the part after the @.</p>' : ''}
  <label for="t-company" class="field">Company <span class="opt">(optional)</span></label>
  <input class="input" id="t-company" name="company" maxlength="200" value="${esc(form.company || '')}">
  <label for="t-msg" class="field">What do you need?</label>
  <textarea class="input" id="t-msg" name="message" rows="4" maxlength="5000" placeholder="For example: the stage of a drug is wrong, or we are a team of 15."${bad === 'message' ? ' aria-invalid="true"' : ''}>${esc(form.message || '')}</textarea>
  ${bad === 'message' ? '<p class="fielderr" role="alert">Tell us in a sentence what you need.</p>' : ''}
  <button class="btn primary" type="submit">Send</button>
</form>
<p class="fine">Or email <a href="mailto:${HELLO}">${HELLO}</a></p>`}
</div></main>${footer()}`,
  });
}

// ---------- Unsubscribe (step 9): the Monday email, big-news emails, or everything ----------
// Opening the link only asks; the button does it. Work mail often opens every link in an email to check it, and that used to
// take people off the list without them knowing. Mail apps' own one-click button posts straight to the same address.
// After it is done, one button turns it back on. `state`: 'ask', 'done', 'back' (turned on again) or 'bad'.
export const UNSUB = {
  '': { ask: 'Stop the Monday email?', what: 'The Monday email sums up the week in what you follow.', btn: 'Stop the Monday email',
    done: 'You will not get the Monday email any more', more: 'What you follow stays on your Home, and every change still shows there the day it happens.',
    undo: 'Turn the Monday email back on', back: 'The Monday email is back on', backMore: 'The next one comes on Monday.' },
  news: { ask: 'Stop big-news emails?', what: 'A big-news email comes when a regulator decides on a drug in your landscape.', btn: 'Stop big-news emails',
    done: 'You will not get big-news emails any more', more: 'Your landscape stays in your account, and its list stays up to date.',
    undo: 'Turn big-news emails back on', back: 'Big-news emails are back on', backMore: 'The next one comes when a regulator decides on a drug in your landscape.' },
  all: { ask: 'Stop all emails from us?', what: 'That is the Monday email and big-news emails.', btn: 'Stop all emails',
    done: 'You will not get emails from us any more', more: 'Only sign-in links, when you ask for one. Your landscapes stay in your account.',
    undo: 'Turn emails back on', back: 'Emails from us are back on', backMore: 'Your landscapes stay in your account.' },
};
export function unsubscribePage({ state, list = '', token = '', user }) {
  const L = UNSUB[list], action = `/unsubscribe${list ? '/' + list : ''}?t=${encodeURIComponent(token)}`;
  const button = (label, undo, cls) => `<form class="inline" method="post" action="${esc(action)}"><input type="hidden" name="page" value="1">${undo ? '<input type="hidden" name="undo" value="1">' : ''}<button class="${cls === 'linkbtn' ? cls : 'btn ' + cls}" type="submit">${label}</button></form>`;
  const [h, p, foot] = {
    ask: [L.ask, `${L.what} Sign-in links still come when you ask for one.`, button(L.btn, false, 'primary')],
    done: [L.done, L.more, `<div class="after">Changed your mind? ${button(L.undo, true, 'linkbtn')}</div>`],
    back: [L.back, L.backMore, ''],
    bad: ['That unsubscribe link did not work', 'It may be from an older email. Reply to any of our emails and we will take you off the list by hand.', `<a class="btn wide" href="/talk">Write to us</a>`],
  }[state];
  return layout({ title: `Unsubscribe | ${BRAND}`, user, noindex: true, body: `<main class="signin auth unsub"><div class="card">
${state === 'done' || state === 'back' ? `<span class="okmark">${icon('check', 20)}</span>` : ''}<h1>${h}</h1>
<p class="lede">${p}</p>
${foot}
</div></main>${footer()}` });
}
