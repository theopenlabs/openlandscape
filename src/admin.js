// Admin dashboard: the product's own dashboard frame,
// organised around what the admin comes to do. Today (what needs you, with the button that finishes it; what broke; is it working),
// People (help one person: give Solo free, emails off, sign out everywhere, delete), then the numbers: Growth, Interest, Money,
// Health. Each page is a function of the database and the request ({ token, query, params }) returning HTML, or null for
// "Not found"; each action takes ({ params, body, by }) and says where to go next. src/server.js checks access (isAdmin).
import { statSync, statfsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promises as dns } from 'node:dns';
import { isIPv4 } from 'node:net';
import { DB_PATH } from './db.js';
import { esc } from '../web/table.js';
import { icon, logo } from '../web/icons.js';
import { BRAND, adminDoc, menuButton } from './pages/shared.js';
import { BOT_AGENT } from './visits.js';
import { country } from './country.js';
import { DRUGS, PAGES } from './limits.js';
import { LABEL as JOB_LABEL } from './jobrun.js';
import { suggest } from './suggest.js';
import { drug } from './query.js';

export const FOUNDING_PLACES = 50;
const PRICE = { solo: 49, solo_year: 490 / 12 };   // monthly revenue per plan, dollars
const DUE_HOURS = 48;                               // an item waiting longer is late (red); custom orders: the 48-hour clock

// ---------- the funnel (/admin/metrics JSON and Usage) ----------
// Accounts made in the last `days`, by why they were made (user.came_from), and how many of each went on to each step.
const CAME = { 'follow:drug': 'Follow on a drug page', 'follow:company': 'Follow on a company page', 'follow:landscape': 'Follow on a landscape',
  'follow:solo': 'Choose Solo in a Follow box', pricing: 'Choose Solo on Pricing', 'shared:landscape': 'A shared landscape', 'shared:search': 'A shared search link',
  'landing:search': 'The landing page search', signin: 'Start free or Sign in', other: 'Another page', '': 'Not recorded (older accounts)' };
export const cameLabel = c => CAME[c ?? ''] || (/^ai:/.test(c) ? `AI app: ${c.slice(3)}` : /^pagelimit:/.test(c) ? `Page limit, ${c.slice(10)} page` : c);
export function funnel(db, days) {
  const has = (sql) => `sum(CASE WHEN EXISTS (${sql}) THEN 1 ELSE 0 END)`;
  return db.prepare(`SELECT coalesce(u.came_from, '') AS came_from, count(*) AS accounts,
      ${has("SELECT 1 FROM usage x WHERE x.user_id=u.id AND x.kind='landscape'")} AS picked_landscape,
      ${has("SELECT 1 FROM usage x WHERE x.user_id=u.id AND x.kind='search'")} AS searched,
      ${has("SELECT 1 FROM oauth_token t WHERE t.user_id=u.id UNION SELECT 1 FROM usage x WHERE x.user_id=u.id AND x.kind='mcp'")} AS connected_ai,
      ${has("SELECT 1 FROM saved_landscape f WHERE f.user_id=u.id AND u.plan != 'free'")} AS followed,
      ${has("SELECT 1 FROM usage x WHERE x.user_id=u.id AND x.kind='checkout'")} AS started_payment,
      ${has("SELECT 1 FROM payment pm WHERE pm.user_id=u.id")} AS paid,
      ${has("SELECT 1 FROM user v WHERE v.id=u.id AND v.last_seen IS NOT NULL AND date(v.last_seen) > date(v.created_at, '+6 days')")} AS came_back
    FROM user u WHERE u.created_at >= datetime('now', ?) GROUP BY coalesce(u.came_from, '') ORDER BY accounts DESC`).all(`-${days} days`)
    .map(r => ({ ...r, label: cameLabel(r.came_from) }));
}

// ---------- small helpers ----------
const n = x => Number(x || 0).toLocaleString('en-US');
const plural = (c, one, many = one + 's') => `${n(c)} ${c === 1 ? one : many}`;
const day = s => (s ? String(s).slice(0, 10) : '');
const when = s => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
const money = (cents, cur = 'usd') => (String(cur).toLowerCase() === 'usd' ? '$' : '') + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + (String(cur).toLowerCase() === 'usd' ? '' : ' ' + String(cur).toUpperCase());
const toDate = s => new Date(String(s).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(String(s)) || String(s).length <= 10 ? '' : 'Z'));
const hoursSince = s => (Date.now() - toDate(s).getTime()) / 36e5;
const ago = s => { if (!s) return ''; const h = hoursSince(s); return h < 1 ? 'just now' : h < 48 ? `${Math.floor(h)} h ago` : `${Math.floor(h / 24)} days ago`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dShort = s => { if (!s) return ''; const d = toDate(day(s)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };              // 17 Nov
const dDay = s => { if (!s) return ''; const d = toDate(day(s)); return `${WD[d.getUTCDay()]} ${dShort(s)}`; };                        // Tue 17 Nov
const dTime = s => (s ? `${dShort(s)} ${String(s).slice(11, 16)}` : '');                                                              // 17 Nov 14:02
const stripeUrl = (path, live) => `https://dashboard.stripe.com/${live ? '' : 'test/'}${path}`;
const KIND = { landscape: 'Opened a landscape', search: 'Searched', search_none: 'Search found nothing', mcp: 'AI app asked', csv: 'Downloaded a CSV',
  checkout: 'Pressed Choose Solo', drugs_stopped: 'Stopped by the drug allowance', drugs_alert: 'Near the drug allowance', follow: 'Followed', slide: 'Made a slide' };
const MAIL = { welcome: 'Welcome', hello: 'Hello (at sign-up)', news: 'Big news (Free)', upgrade: 'Thank you for Solo', monday: 'Monday email',
  signin: 'Sign-in email', talk: 'Talk to us (to us)', admin: 'Note to us', other: 'Other' };
const TROUBLE = { payment_failed: 'Payment failed', cancel_planned: 'Cancelled', ended: 'Solo ended' };
const clientName = info => { try { return JSON.parse(info || '{}').client_name || 'An app'; } catch { return 'An app'; } };
const red = s => `<span class="bad">${s}</span>`;
const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);
const addDays = (s, k) => isoDay(new Date(Date.parse(s + 'T00:00:00Z') + k * 864e5));
const dayWords = s => { const d = day(s), t = isoDay(); return d === t ? 'today' : d === addDays(t, -1) ? 'yesterday' : `on ${dDay(s)}`; };   // today, yesterday, on Tue 17 Nov


// A link inside the admin area, keeping ?token= when the page was opened with one.
export const link = (token, path, params = {}) => {
  const p = new URLSearchParams(Object.entries({ ...params, ...(token ? { token } : {}) }).filter(([, v]) => v !== '' && v != null));
  return `/admin${path}${[...p].length ? '?' + p : ''}`;
};
// The product's parts: a box with its header, labelled rows, a feed, a stat.
const box = (title, ic, inner, { count, more = '', id = '', cls = '' } = {}) => `<section class="box${cls ? ' ' + cls : ''}"${id ? ` id="${id}"` : ''}><div class="boxhead">${ic ? icon(ic) : ''}<h2>${title}${count != null ? `<span class="count">${n(count)}</span>` : ''}</h2>${more}</div>${inner}</section>`;
const nothing = s => `<p class="nothing">${s}</p>`;
const rows = (items, empty = 'Nothing here.') => (items.length ? `<dl class="rows">${items.map(r => `<div><dt${r.late ? ' class="late"' : ''}>${r.dt}</dt><dd>${r.dd}${r.d ? `<span class="d">${r.d}</span>` : ''}</dd>${r.acts ? r.acts : ''}</div>`).join('')}</dl>` : nothing(empty));
const feed = (items, empty = 'Nothing yet.') => (items.length ? `<ul class="feed">${items.map(([w, who, ev]) => `<li><span class="when">${w}</span><span class="who"><b>${who}</b></span><span class="ev">${ev}</span></li>`).join('')}</ul>` : nothing(empty));
const stat = (k, v, s = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const head = (title, desc = '', intro = '') => `<div class="phead"><h1>${title}</h1>${intro ? `<p class="intro">${intro}</p>` : ''}${desc ? `<p class="desc">${desc}</p>` : ''}</div>`;
// A table inside a box: cells are HTML already escaped; numbers are right-aligned.
function table(headRow, body, empty = 'Nothing yet.') {
  if (!body.length) return nothing(empty);
  const label = i => String(headRow[i] ?? '').replace(/<[^>]+>/g, '').replace(/"/g, '');
  const cell = (c, i) => `<td${typeof c === 'number' ? ' class="n"' : ''}${label(i) ? ` data-l="${label(i)}"` : ''}>${typeof c === 'number' ? n(c) : c ?? ''}</td>`;
  const numeric = i => body.some(r => typeof r[i] === 'number');
  return `<div class="tw"><table><tr>${headRow.map((h, i) => `<th${numeric(i) ? ' class="n"' : ''}>${h}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table></div>`;
}
// A plain bar beside a number: [label, count, note] rows, longest = full width.
function bars(list, empty = 'Nothing yet.') {
  if (!list.length) return nothing(empty);
  const max = Math.max(1, ...list.map(r => r[1]));
  return `<div class="bars">${list.map(([label, v, note]) => `<div class="b"><span class="l" title="${esc(label)}">${esc(label)}</span><span class="t"><i style="width:${Math.max(1, Math.round((100 * v) / max))}%"></i></span><span class="v">${n(v)}${note ? ` <small>${esc(note)}</small>` : ''}</span></div>`).join('')}</div>`;
}
const note = s => `<p class="note">${s}</p>`;
// A one-button form that does one thing (POST, admin only; src/server.js).
const act = (token, path, label, { cls = '', fields = '' } = {}) => `<form class="ra" method="post" action="${link(token, path)}">${fields}<button class="btn sm${cls ? ' ' + cls : ''}" type="submit">${label}</button></form>`;

// What an action says afterwards (?ok= or ?err= in the address it goes back to).
const SAID = {
  done: 'Marked done.', delivered: 'Marked delivered.', solo: 'Solo given. It goes back to Free by itself after the date.', soloend: 'Back on Free.',
  emailsoff: 'All their emails are off.', signout: 'Signed out on every browser.', deleted: 'Account deleted. Only a line that an account was deleted stays.',
  baddate: 'Pick a day after today, within two years.', paying: 'They pay for Solo in Stripe. Change or cancel it there.', wrongemail: 'That is not their email, so nothing was deleted.',
};
const flash = query => (SAID[query.ok] ? `<div class="flash">${SAID[query.ok]}</div>` : SAID[query.err] ? `<div class="flash error">${SAID[query.err]}</div>` : '');

// ---------- the frame ----------
const NAV = [['', 'Today', 'home'], ['/people', 'People', 'user']];
const NUMBERS = [['/growth', 'Growth', 'pulse'], ['/interest', 'Interest', 'search'], ['/money', 'Money', 'card'], ['/health', 'Health', 'database']];
function sidebar(db, here, token) {
  const counts = { '': needs(db, token).length, '/money': dollars(mrr(payers(db).filter(p => p.live === 1))),
    '/growth': (c => (c ? `${n(c)} new` : ''))(cohort(db, '-7 days', '+1 day').length),
    '/interest': (c => (c ? n(c) : ''))(db.prepare("SELECT count(DISTINCT lower(detail)) FROM usage WHERE kind='search_none' AND at >= datetime('now','-7 days')").pluck().get()),
    '/health': healthChecks(db).some(c => c.state === 'bad') ? dotHtml('bad', 'Something needs a look') : dotHtml('ok', 'Everything is working') };
  const it = ([p, label, ic]) => `<a class="it${p === here ? ' on' : ''}" href="${link(token, p)}"${p === here ? ' aria-current="page"' : ''}>${icon(ic)}<span class="t">${label}</span>${counts[p] ? `<span class="n">${counts[p]}</span>` : ''}</a>`;
  return `<aside class="side">
  <div class="side-bar"><a class="logo" href="${link(token, '')}">${logo()}Admin</a>${menuButton('sidebody')}</div>
  <div class="side-body" id="sidebody"><div class="side-scroll">
  <nav class="grp" aria-label="Admin">${NAV.map(it).join('')}</nav>
  <nav class="grp" aria-label="Numbers"><div class="lbl">Numbers</div>${NUMBERS.map(it).join('')}</nav>
  </div>
  <div class="side-foot"><a class="it" href="/app">${icon('arrow')}<span class="t">Back to ${BRAND}</span></a></div></div>
</aside>`;
}
function shell(db, title, here, body, token) {
  return adminDoc({ title: `${title} | Admin | ${BRAND}`, side: sidebar(db, here, token), body: `<section class="panel on ds adm">${body}</section>` });
}

// ---------- shared counts ----------
// Paying accounts now (Solo given free by hand is not paying): plan and whether their latest payment was real (Stripe live) or a test.
function payers(db) {
  return db.prepare(`SELECT u.id, u.email, u.plan, u.founding, u.stripe_customer,
      (SELECT livemode FROM payment p WHERE p.user_id=u.id ORDER BY id DESC LIMIT 1) AS live FROM user u WHERE u.plan != 'free' AND u.solo_until IS NULL ORDER BY u.id`).all();
}
const mrr = list => list.reduce((a, r) => a + (PRICE[r.plan] || 0), 0);
const dollars = x => '$' + Math.round(x).toLocaleString('en-US');
// Computers (signed out) stopped by the page limit in the last `days`.
const stoppedComputers = (db, days) => db.prepare(`SELECT ip, count(*) AS days, sum(pages) AS pages, sum(stopped) AS stopped, max(day) AS last,
    (SELECT agent FROM visitor_day v2 WHERE v2.ip=v.ip AND agent IS NOT NULL ORDER BY day DESC LIMIT 1) AS agent
  FROM visitor_day v WHERE day >= date('now', ?) GROUP BY ip HAVING sum(stopped) > 0 ORDER BY stopped DESC LIMIT 50`).all(`-${days} days`);
// The last run of each hourly step.
const lastRuns = db => db.prepare('SELECT j.* FROM job_run j JOIN (SELECT name, max(id) AS id FROM job_run GROUP BY name) m ON m.id=j.id ORDER BY j.name').all();
const userIdOf = (db, email) => db.prepare('SELECT id FROM user WHERE lower(email)=lower(?)').pluck().get(String(email || ''));
const who = (db, token, email) => { const id = userIdOf(db, email); return id ? `<a href="${link(token, '/people/' + id)}">${esc(email)}</a>` : esc(email || 'someone'); };

// One line about a person, for Today and Growth: "Joined today through Google. Used Obesity, 3 searches."
function personLine(db, u) {
  const lands = db.prepare("SELECT detail FROM usage WHERE user_id=? AND kind='landscape' GROUP BY lower(detail) ORDER BY max(at) DESC LIMIT 3").pluck().all(u.id);
  const searches = db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='search'").pluck().get(u.id);
  const ai = db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='mcp'").pluck().get(u.id);
  const used = [lands.length ? `Used ${lands.map(l => l.replace(/^./, c => c.toUpperCase())).join(', ')}` : '', searches ? plural(searches, 'search', 'searches') : '', ai ? plural(ai, 'AI question') : ''].filter(Boolean);
  const how = /^ai:/.test(u.came_from || '') ? ` inside ${u.came_from.slice(3)}` : u.first_ref && u.first_ref !== 'direct' ? ` through ${sourceName(u.first_ref)}` : u.first_ref === 'direct' ? ' by typing the address' : '';
  return `Joined ${dayWords(u.created_at)}${how}. ${used.length ? used.join(', ').replace(/^./, c => c.toUpperCase()) : 'Nothing used yet'}.`;
}
// A site's host in words: google.com → Google.
const SOURCE_NAMES = { 'google.com': 'Google', 'bing.com': 'Bing', 'duckduckgo.com': 'DuckDuckGo', 'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn', 'news.ycombinator.com': 'Hacker News',
  'x.com': 'X', 't.co': 'X', 'twitter.com': 'X', 'reddit.com': 'Reddit', 'chatgpt.com': 'ChatGPT', 'claude.ai': 'Claude', 'perplexity.ai': 'Perplexity', 'facebook.com': 'Facebook' };
const sourceName = h => SOURCE_NAMES[String(h || '').replace(/^(www|m|l)\./, '').replace(/^google\.[a-z.]+$/, 'google.com')] || h;
// Everything waiting on the admin, oldest-late first: custom orders, Talk to us, payment trouble, landscape requests, Team waitlist, review.
// Each with the button that finishes it.
function needs(db, token) {
  const out = [];
  const lateBy = s => hoursSince(s) > DUE_HOURS;
  const age = s => { const h = hoursSince(s); return h < 48 ? `${Math.max(0, Math.floor(h))} h` : `${Math.floor(h / 24)} days`; };
  const done = (kind, id, label = 'Done', before = '') => `<form class="ra" method="post" action="${link(token, `/done/${kind}/${id}`)}">${before}<input class="input" name="note" placeholder="Note" aria-label="Note" maxlength="300"><button class="btn sm primary" type="submit">${label}</button></form>`;
  for (const o of db.prepare("SELECT * FROM payment WHERE plan LIKE 'custom%' AND delivered_at IS NULL ORDER BY id").all()) {
    const left = DUE_HOURS - hoursSince(o.created_at);
    out.push({ late: left < 0, dt: left < 0 ? `Order, ${Math.floor(-left)} h late` : `Order, ${Math.floor(left)} h left`,
      dd: `${who(db, token, o.email)}, ${esc(money(o.amount, o.currency))}${o.livemode ? '' : ' (test)'}`, d: `${esc(o.plan.replace(/_/g, ' '))}. Paid ${esc(dDay(o.created_at))} ${esc(String(o.created_at).slice(11, 16))}.`,
      acts: done('order', o.id, 'Delivered') });
  }
  // People likely to pay: pressed Choose Solo in the last 14 days and did not pay; or a Free account near or at the drug allowance.
  // Each with Write and Done; Done hides them until it happens again.
  const write = (email, subject) => `<a class="btn sm" href="mailto:${esc(email)}?subject=${encodeURIComponent(subject)}">Write</a>`;
  const nearRows = [];   // someone near the allowance who also left checkout gets one row, the allowance one (it says both)
  const near = Math.round(0.8 * DRUGS.free.month);
  for (const u of db.prepare(`SELECT u.*, (SELECT count(*) FROM drug_seen s WHERE s.user_id=u.id AND s.first_day >= date('now','-29 days')) AS seen,
        (SELECT max(at) FROM usage x WHERE x.user_id=u.id AND x.kind='drugs_stopped' AND x.at >= datetime('now','-29 days')) AS stopped
      FROM user u WHERE u.plan='free' AND u.solo_until IS NULL`).all().filter(u => u.seen >= near || u.stopped)) {
    const since = db.prepare('SELECT max(done_at) FROM follow_up WHERE user_id=? AND kind=?').pluck().get(u.id, 'allowance');
    if (since && hoursSince(since) < 30 * 24 && !(u.stopped && u.stopped > since)) continue;   // done: back only when stopped again, or after 30 days
    const checkout = db.prepare("SELECT max(at) FROM usage WHERE user_id=? AND kind='checkout'").pluck().get(u.id);
    nearRows.push({ id: u.id, dt: 'Near the allowance', dd: `${who(db, token, u.email)} ${u.stopped ? `reached the ${n(DRUGS.free.month)} free drugs this month and was stopped ${esc(dayWords(u.stopped))}` : `has seen ${n(u.seen)} of ${n(DRUGS.free.month)} free drugs this month`}.`,
      d: esc(`${personLine(db, u)}${checkout ? ` Also opened checkout ${dayWords(checkout)}.` : ''}`), acts: done('allowance', u.id, 'Done', write(u.email, `Solo on ${BRAND}`)) });
  }
  for (const u of db.prepare(`SELECT * FROM (SELECT u.*, count(*) AS presses, max(x.at) AS last FROM usage x JOIN user u ON u.id=x.user_id
      WHERE x.kind='checkout' AND x.at >= datetime('now','-14 days') AND (u.plan='free' OR u.solo_until IS NOT NULL) GROUP BY u.id) c
      WHERE NOT EXISTS (SELECT 1 FROM payment p WHERE (p.user_id=c.id OR lower(p.email)=lower(c.email)) AND p.created_at >= c.last)
        AND NOT EXISTS (SELECT 1 FROM follow_up f WHERE f.user_id=c.id AND f.kind='checkout' AND f.done_at >= c.last) ORDER BY last DESC`).all().filter(u => !nearRows.some(r => r.id === u.id)))
    out.push({ dt: 'Left at checkout', dd: `${who(db, token, u.email)} pressed Choose Solo ${u.presses > 1 ? `${n(u.presses)} times, last ` : ''}${esc(dayWords(u.last))} and did not pay.`,
      d: esc(personLine(db, u)), acts: done('checkout', u.id, 'Done', write(u.email, `Solo on ${BRAND}`)) });
  out.push(...nearRows);
  const reqs = db.prepare('SELECT * FROM area_request WHERE done_at IS NULL ORDER BY id').all();
  for (const r of reqs.filter(r => r.page === 'talk'))
    out.push({ late: lateBy(r.created_at), dt: `Talk to us${lateBy(r.created_at) ? ', ' + age(r.created_at) : ''}`, dd: `${who(db, token, r.email)}${r.company ? ', ' + esc(r.company) : ''}`,
      d: `"${esc(String(r.message || r.area || '').slice(0, 300))}" ${esc(ago(r.created_at))}.`,
      acts: done('request', r.id, 'Done', `<a class="btn sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(`Re: your message to ${BRAND}`)}">Reply</a>`) });
  for (const b of db.prepare('SELECT * FROM billing_event WHERE done_at IS NULL ORDER BY id').all())
    out.push({ late: lateBy(b.at), dt: TROUBLE[b.kind] || esc(b.kind), dd: `${who(db, token, b.email)}${b.amount ? ', ' + esc(money(b.amount, b.currency)) : ''}`, d: `${esc(b.detail || '')} ${esc(ago(b.at))}.`,
      acts: done('billing', b.id, 'Done', b.customer ? `<a class="btn sm" href="${stripeUrl('customers/' + encodeURIComponent(b.customer), true)}">Stripe</a>` : '') });
  for (const r of reqs.filter(r => r.page !== 'talk' && r.page !== 'team-waitlist'))
    out.push({ late: lateBy(r.created_at), dt: `Landscape request${lateBy(r.created_at) ? ', ' + age(r.created_at) : ''}`, dd: `${who(db, token, r.email)}${r.role ? ', ' + esc(r.role) : ''}`,
      d: `"${esc(r.area || '')}" ${esc(ago(r.created_at))}.`, acts: done('request', r.id, 'Done', `<a class="btn sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(`Your ${r.area || 'landscape'} landscape`)}">Reply</a>`) });
  for (const r of reqs.filter(r => r.page === 'team-waitlist'))
    out.push({ dt: 'Team waitlist', dd: `${who(db, token, r.email)}${r.role ? ', ' + esc(r.role) : ''}`, d: `Asked for ${esc(r.area || 'Team')} ${esc(ago(r.created_at))}.`, acts: done('request', r.id) });
  const review = Object.fromEntries(db.prepare("SELECT type, count(*) AS c FROM match_candidate WHERE status='open' GROUP BY type").all().map(r => [r.type, r.c]));
  const parts = [review.decision && plural(review.decision, 'regulator news item'), review.study && plural(review.study, 'possible same-trial pair'),
    review.verdict && plural(review.verdict, 'doubted drug row'), review.drug && plural(review.drug, 'possible same-drug pair')].filter(Boolean);
  if (parts.length) out.push({ dt: 'To check', dd: parts.join(', '), d: 'Each one is published or dismissed on the review page.',
    acts: `<span class="ra"><a class="btn sm" href="/admin/review${token ? '?token=' + encodeURIComponent(token) : ''}">Open review</a></span>` });
  return out;
}

// ---------- Today ----------
const SOURCES = [['trials_loaded_at', 'ClinicalTrials.gov loaded'], ['ctgov_release', 'ClinicalTrials.gov release'], ['ctgov_checked_at', 'ClinicalTrials.gov checked'],
  ['fda_last_updated', 'FDA approvals'], ['ctis_checked', 'EU trials (CTIS) checked'], ['decisions_checked_ema', 'EMA decisions checked'], ['decisions_checked_fda', 'FDA decisions checked'],
  ['decisions_checked_fda_crl', 'FDA rejection letters checked'], ['decisions_checked_sec', 'SEC decisions checked'], ['drug_lists_fetched_at', 'Drug lists fetched'],
  ['drug_lists_grouped_at', 'Drugs grouped by lists'], ['verdicts_applied_at', 'Read verdicts applied'], ['studies_built_at', 'Studies built'], ['linked_at', 'Drugs linked']];
// The "Updated" pill, like Home's: when the newest check of a source ran; pointing at it lists each source. Red when a step is failing.
function updatedPill(db, failing) {
  const meta = Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map(r => [r.k, r.v]));
  const known = SOURCES.filter(([k]) => meta[k]);
  const checks = known.filter(([k]) => /checked|_at$/.test(k)).map(([k]) => meta[k]).filter(v => !isNaN(toDate(v)));
  const newest = checks.sort((a, b) => toDate(b) - toDate(a))[0];
  const tip = known.map(([k, l]) => `${l}: ${when(meta[k])}`).join('\n') || 'No source checks recorded yet.';
  const words = failing.length ? 'Data update failing' : newest ? `Data updated ${ago(newest)}` : 'No data update recorded';
  return `<p class="upd tip${failing.length ? ' bad' : ''}" tabindex="0" data-tip="${esc(tip)}">${esc(words)}</p>`;
}
function today(db, { token, query }) {
  const one = (sql, ...a) => db.prepare(sql).pluck().get(...a) || 0;
  const pay = payers(db), real = pay.filter(p => p.live === 1), test = pay.filter(p => p.live !== 1);
  const failing = lastRuns(db).filter(r => !r.ok);
  const fails = db.prepare("SELECT * FROM mail_fail WHERE at >= datetime('now','-2 days') ORDER BY id DESC").all();
  const items = needs(db, token);
  const notices = [
    ...failing.map(r => `<div class="flash error"><b>Data update failing: ${esc(JOB_LABEL[r.name] || r.name)}.</b> Since ${esc(dTime(r.finished_at))} UTC (exit code ${r.code}). It tries again every hour. <a href="${link(token, '/health')}#steps">See Health</a></div>`),
    fails.length ? `<div class="flash error"><b>${plural(fails.length, 'email')} did not send since yesterday.</b> ${fails.slice(0, 3).map(f => `${esc(MAIL[f.kind] || f.kind)} to ${esc(f.email || '?')}`).join(', ')}${fails.length > 3 ? ', and more' : ''}. <a href="${link(token, '/health')}#mail">See them</a></div>` : '',
  ].join('');
  // Done lately: the last 30 days of items marked done, with their notes.
  const doneList = query.done ? db.prepare(`SELECT done_at AS at, CASE page WHEN 'talk' THEN 'Talk to us' WHEN 'team-waitlist' THEN 'Team waitlist' ELSE 'Landscape request' END AS what, email, done_note AS note FROM area_request WHERE done_at >= datetime('now','-30 days')
      UNION ALL SELECT done_at, kind, email, done_note FROM billing_event WHERE done_at >= datetime('now','-30 days')
      UNION ALL SELECT delivered_at, 'Order delivered', email, done_note FROM payment WHERE delivered_at >= datetime('now','-30 days')
      UNION ALL SELECT f.done_at, CASE f.kind WHEN 'checkout' THEN 'Left at checkout' ELSE 'Near the allowance' END, u.email, f.note FROM follow_up f JOIN user u ON u.id=f.user_id WHERE f.done_at >= datetime('now','-30 days') ORDER BY 1 DESC`).all() : [];
  const doneBox = query.done ? box('Done lately', 'check', feed(doneList.map(d => [esc(dShort(d.at)), `${esc(TROUBLE[d.what] || d.what)}: ${who(db, token, d.email)}`, esc(d.note || '')]), 'Nothing marked done in the last 30 days.'), { id: 'done', more: `<a class="more" href="${link(token, '')}">Hide</a>` }) : '';

  // One line per day, the last 14 days.
  const since = "date('now','-13 days')";
  const group = (sql) => db.prepare(sql).all().reduce((a, r) => ((a[r.d] ||= []).push(r), a), {});
  const users = group(`SELECT date(created_at) AS d, came_from FROM user WHERE created_at >= ${since}`);
  const visits = Object.fromEntries(db.prepare(`SELECT day AS d, count(DISTINCT visitor) AS c FROM page_view WHERE day >= ${since} GROUP BY day`).all().map(r => [r.d, r.c]));
  const pays = group(`SELECT date(created_at) AS d, plan, amount, currency, livemode FROM payment WHERE created_at >= ${since}`);
  const trouble = group(`SELECT date(at) AS d, kind FROM billing_event WHERE at >= ${since}`);
  const stopped = Object.fromEntries(db.prepare(`SELECT day AS d, count(*) AS c FROM visitor_day WHERE day >= ${since} AND stopped > 0 GROUP BY day`).all().map(r => [r.d, r.c]));
  const jobs = group(`SELECT DISTINCT date(finished_at) AS d, name FROM job_run WHERE ok=0 AND finished_at >= ${since}`);
  const mailF = Object.fromEntries(db.prepare(`SELECT date(at) AS d, count(*) AS c FROM mail_fail WHERE at >= ${since} GROUP BY 1`).all().map(r => [r.d, r.c]));
  const t = db.prepare("SELECT date('now')").pluck().get();
  const lines = Array.from({ length: 14 }, (_, i) => addDays(t, -i)).map(d => {
    const u = users[d] || [], ai = Object.entries(u.filter(x => /^ai:/.test(x.came_from || '')).reduce((a, x) => ({ ...a, [x.came_from.slice(3)]: (a[x.came_from.slice(3)] || 0) + 1 }), {}));
    const p = pays[d] || [], realP = p.filter(x => x.livemode), testP = p.filter(x => !x.livemode), custom = realP.filter(x => /^custom/.test(x.plan));
    const tr = trouble[d] || [];
    const ev = [...ai.map(([app, c]) => `${n(c)} through ${esc(app)}`), plural(visits[d] || 0, 'visitor'),
      realP.length ? `${plural(realP.length - custom.length, 'payment')}${realP.length - custom.length ? ', ' + esc(money(realP.filter(x => !/^custom/.test(x.plan)).reduce((a, x) => a + x.amount, 0))) : ''}` : 'no payments',
      ...(custom.length ? [`${plural(custom.length, 'custom order')}, ${esc(money(custom.reduce((a, x) => a + x.amount, 0)))}`] : []),
      ...(testP.length ? [`${plural(testP.length, 'test payment')}`] : []),
      ...Object.entries(tr.reduce((a, x) => ({ ...a, [x.kind]: (a[x.kind] || 0) + 1 }), {})).map(([k, c]) => `${n(c)} ${(TROUBLE[k] || k).toLowerCase()}`),
      ...(stopped[d] ? [`${plural(stopped[d], 'computer')} stopped by the page limit`] : []),
      ...(jobs[d] ? [red(`data update failed (${esc(jobs[d].map(j => JOB_LABEL[j.name] || j.name).join(', '))})`)] : []),
      ...(mailF[d] ? [red(`${plural(mailF[d], 'email')} did not send`)] : [])].filter(s => s !== '0 payments');
    return [d === t ? 'Today' : esc(dDay(d)), u.length ? plural(u.length, 'new person', 'new people') : 'No new people', ev.join(' · ')];
  });

  const body = `<div class="homehead"><div><h1>Today</h1><p class="desc">What needs you, what broke, and how it is going. ${esc(dDay(t))}.</p></div>${updatedPill(db, failing)}</div>
${flash(query)}${notices}
${box('Needs you', 'check', rows(items, 'Nothing needs you. All done.'), { count: items.length, more: `<a class="more" href="${link(token, '', { done: 1 })}#done">Done lately</a>` })}
${doneBox}
<div class="stats">
${stat('New people, 7 days', `<a href="${link(token, '/growth')}">${n(one("SELECT count(*) FROM user WHERE created_at >= datetime('now','-7 days')"))}</a>`, `${n(one("SELECT count(*) FROM user WHERE created_at >= date('now')"))} today, ${n(one('SELECT count(*) FROM user'))} in all`)}
${stat('Used it, 7 days', `<a href="${link(token, '/growth')}">${n(one("SELECT count(*) FROM user WHERE last_seen >= datetime('now','-7 days')"))}</a>`, `of ${plural(one('SELECT count(*) FROM user'), 'account')}`)}
${stat('Paying', `<a href="${link(token, '/money')}">${n(real.length)}</a>`, `${dollars(mrr(real))} a month${test.length ? `, ${n(test.length)} more on test` : ''}`)}
${stat('Founding places', `<a href="${link(token, '/money')}">${n(one('SELECT count(*) FROM user WHERE founding=1'))}</a>`, `of ${FOUNDING_PLACES} used`)}
</div>
${box('Last 14 days', 'calendar', feed(lines))}`;
  return shell(db, 'Today', '', body, token);
}

// ---------- People ----------
const planWords = u => (u.solo_until ? `Solo free until ${dShort(u.solo_until)}` : u.plan === 'free' ? 'Free' : u.plan === 'solo_year' ? 'Solo yearly' : u.plan[0].toUpperCase() + u.plan.slice(1)) + (u.founding && u.plan !== 'free' ? ', early customer' : '');
const howFound = u => (/^ai:/.test(u.came_from || '') ? `through ${u.came_from.slice(3)}` : u.first_ref && u.first_ref !== 'direct' ? `from ${u.first_ref}` : u.came_from ? cameLabel(u.came_from).replace(/^./, c => c.toLowerCase()) : '');
const PEOPLE_SQL = `SELECT u.*, (SELECT count(*) FROM usage x WHERE x.user_id=u.id AND x.kind='search') AS searches,
    (SELECT count(*) FROM saved_landscape s WHERE s.user_id=u.id) AS follows,
    (SELECT kind FROM billing_event b WHERE lower(b.email)=lower(u.email) AND b.done_at IS NULL ORDER BY id DESC LIMIT 1) AS trouble,
    (SELECT count(*) FROM mail_fail f WHERE f.user_id=u.id) AS mailfails FROM user u`;
function people(db, { token, query }) {
  const q = String(query.q || '').trim().slice(0, 100);
  const list = db.prepare(`${PEOPLE_SQL} WHERE u.email LIKE ? ORDER BY u.created_at DESC, u.id DESC LIMIT 500`).all(`%${q.replace(/[%_]/g, '')}%`);
  const all = db.prepare('SELECT count(*) FROM user').pluck().get(), t = isoDay();
  const seen = u => (day(u.last_seen) === t ? 'seen today' : u.last_seen && day(u.last_seen) > day(u.created_at) ? `seen ${ago(u.last_seen)}` : hoursSince(u.created_at) > 24 ? 'never came back' : '');
  const line = u => [esc(dShort(u.created_at)), `<a href="${link(token, '/people/' + u.id)}">${esc(u.email)}</a>`, [esc(planWords(u)), esc(howFound(u)), esc(seen(u)),
    u.searches ? `searched ${plural(u.searches, 'time')}` : '', u.follows ? `follows ${n(u.follows)}` : '',
    u.trouble ? red(esc((TROUBLE[u.trouble] || u.trouble).toLowerCase())) : '', u.mailfails ? red(`${plural(u.mailfails, 'email')} did not send`) : ''].filter(Boolean).join(' · ')];
  const body = `${head('People', `${plural(all, 'account')}, newest first. Open one to see what they did or to change their account.`)}
${flash(query)}
<form class="search" method="get" action="/admin/people">${token ? `<input type="hidden" name="token" value="${esc(token)}">` : ''}<input class="input" name="q" value="${esc(q)}" placeholder="Find by email" aria-label="Find by email"><button class="btn" type="submit">Find</button></form>
${box(q ? `Matching "${esc(q)}"` : 'Everyone', 'user', feed(list.map(line), q ? 'No account matches.' : 'No accounts yet.'), { count: list.length })}`;
  return shell(db, 'People', '/people', body, token);
}

function person(db, { token, params, query }) {
  const u = db.prepare(`${PEOPLE_SQL} WHERE u.id=?`).get(+params.id);
  if (!u) return null;
  const cap = u.plan && u.plan !== 'free' ? DRUGS.paid : DRUGS.free;
  const seen30 = db.prepare("SELECT count(*) FROM drug_seen WHERE user_id=? AND first_day >= date('now','-29 days')").pluck().get(u.id);
  const apps = db.prepare("SELECT c.info, min(t.created_at) AS since FROM oauth_token t LEFT JOIN oauth_client c ON c.client_id=t.client_id WHERE t.user_id=? GROUP BY t.client_id").all(u.id);
  const follows = db.prepare('SELECT query FROM saved_landscape WHERE user_id=? ORDER BY id').pluck().all(u.id);
  const pays = db.prepare('SELECT * FROM payment WHERE user_id=? OR lower(email)=lower(?) ORDER BY id DESC').all(u.id, u.email);
  const sessions = db.prepare("SELECT count(*) FROM session WHERE user_id=? AND (expires_at IS NULL OR expires_at > datetime('now'))").pluck().get(u.id);
  const live = pays.some(p => p.livemode), paid = pays.filter(p => p.livemode).reduce((a, p) => a + p.amount, 0);
  const paysStripe = u.plan !== 'free' && !u.solo_until;

  // One sentence: when and how they came, what they did, whether they paid, the allowance.
  const did = [u.searches ? `searched ${plural(u.searches, 'time')}` : 'has not searched', follows.length ? `follows ${esc(follows.slice(0, 3).join(', '))}${follows.length > 3 ? ` and ${n(follows.length - 3)} more` : ''}` : '',
    paid ? `paid ${esc(money(paid))} in all` : pays.length ? 'paid only in test' : 'has not paid'].filter(Boolean);
  const intro = `Joined ${esc(dDay(u.created_at))}${howFound(u) ? ' ' + esc(howFound(u)) : ''}. ${did.join(', ').replace(/^./, c => c.toUpperCase())}. ${n(seen30)} of ${n(cap.month)} drugs this month.${u.last_seen ? ` Last seen ${esc(ago(u.last_seen))}.` : ''}`;

  const until = addDays(isoDay(), 30);
  const dateField = v => `<input class="input" type="date" name="until" value="${esc(v)}" min="${addDays(isoDay(), 1)}" aria-label="Solo free until" style="width:150px">`;
  const planRow = paysStripe
    ? { dt: 'Plan', dd: `<b>${esc(planWords(u))}</b>, paid in Stripe`, d: 'Plan changes, refunds and cancelling are done in Stripe.',
      acts: u.stripe_customer ? `<span class="ra"><a class="btn sm" href="${stripeUrl('customers/' + encodeURIComponent(u.stripe_customer), live)}">Stripe</a></span>` : '' }
    : u.solo_until
      ? { dt: 'Plan', dd: `<b>Solo, free</b> until ${esc(dDay(u.solo_until))}`, d: 'Given by hand. It goes back to Free by itself the day after.',
        acts: `<span class="ra">${act(token, `/people/${u.id}/solo`, 'Change date', { fields: dateField(u.solo_until) })}${act(token, `/people/${u.id}/solo`, 'Back to Free now', { fields: '<input type="hidden" name="end" value="1">' })}</span>` }
      : { dt: 'Plan', dd: '<b>Free</b>', d: 'Give Solo for free until a date; it goes back to Free by itself. Paid plans change in Stripe.',
        acts: act(token, `/people/${u.id}/solo`, 'Give Solo free', { fields: dateField(until) }) };
  const mails = `Monday email ${u.digest_off ? 'off' : 'on'}, big news ${u.news_off ? 'off' : 'on'}`;
  const account = [planRow,
    { dt: 'Emails', dd: esc(mails), d: u.mailfails ? red(`${plural(u.mailfails, 'email')} to them did not send`) : '', acts: u.digest_off && u.news_off ? '' : act(token, `/people/${u.id}/emails-off`, 'Turn all off') },
    { dt: 'Signed in', dd: `${sessions ? `${plural(sessions, 'browser')}` : 'Not signed in anywhere'}${apps.length ? `, ${esc(apps.map(a => clientName(a.info)).join(', '))} connected since ${esc(dShort(apps[0].since))}` : ''}`,
      d: apps.length ? 'Signing out does not cut off a connected AI app.' : '', acts: sessions ? act(token, `/people/${u.id}/signout`, 'Sign out everywhere') : '' }];
  const timeline = db.prepare(`SELECT at, kind, detail FROM usage WHERE user_id=?
    UNION ALL SELECT created_at, 'follow', CASE WHEN kind IS NULL THEN query ELSE kind || ': ' || query END FROM saved_landscape WHERE user_id=?
    UNION ALL SELECT created_at, 'paid', plan || ' ' || amount || ' ' || coalesce(currency,'') || CASE WHEN livemode THEN '' ELSE ' (test)' END FROM payment WHERE user_id=? OR lower(email)=lower(?)
    UNION ALL SELECT at, 'billing:' || kind, detail FROM billing_event WHERE lower(email)=lower(?)
    UNION ALL SELECT created_at, 'ai', client_id FROM oauth_token WHERE user_id=? AND kind='access'
    UNION ALL SELECT sent_at, 'mail', kind FROM mail_log WHERE user_id=?
    UNION ALL SELECT sent_at, 'mail', 'monday' FROM digest_log WHERE user_id=?
    UNION ALL SELECT at, 'mailfail', kind || ': ' || coalesce(error,'') FROM mail_fail WHERE user_id=?
    ORDER BY 1 DESC LIMIT 300`).all(u.id, u.id, u.id, u.email, u.email, u.id, u.id, u.id, u.id);
  const label = k => KIND[k] || { paid: 'Paid', ai: 'Connected an AI app', follow: 'Followed', mail: 'Got an email', mailfail: red('Email did not send') }[k] || (/^billing:/.test(k) ? TROUBLE[k.slice(8)] || k : k);
  const detail = r => (r.kind === 'paid' ? (() => { const [p, a, c, ...t] = String(r.detail).split(' '); return `${p} ${money(a, c)} ${t.join(' ')}`; })() : r.kind === 'mail' ? MAIL[r.detail] || r.detail : r.detail || '');
  const body = `<p class="crumbs"><a href="${link(token, '/people')}">People</a></p>
${head(esc(u.email), '', intro)}
${flash(query)}
${box('Account', '', rows(account))}
${box('Delete', '', rows([{ dt: 'Delete', dd: 'Everything about them is removed; only a line that an account was deleted stays. Asks twice. Cannot be undone.',
    acts: `<span class="ra"><a class="btn sm danger" href="${link(token, `/people/${u.id}/delete`)}">Delete</a></span>` }]))}
${box('What they did', 'pulse', feed(timeline.map(r => [esc(dTime(r.at)), label(r.kind), esc(String(detail(r)).slice(0, 200))]), 'Nothing recorded.'), { count: timeline.length })}`;
  return shell(db, u.email, '/people', body, token);
}

// ---------- Delete an account and its data ----------
// Every table that holds a person's account number or email. A test (test/admin-pages.js) checks that every table with a
// user_id or email column is listed here or in KEPT, so a new table cannot be missed.
export const USER_TABLES = ['session', 'api_key', 'oauth_code', 'oauth_token', 'usage', 'drug_seen', 'saved_landscape', 'payment', 'digest_log', 'digest_item', 'mail_log', 'mail_fail', 'follow_up'];
export const EMAIL_TABLES = ['login_token', 'area_request', 'payment', 'billing_event', 'mail_fail'];
export const KEPT = ['deleted_account'];   // the one line that says an account was deleted (no email)
export function deleteAccount(db, id, by = '') {
  const u = db.prepare('SELECT * FROM user WHERE id=?').get(id);
  if (!u) return false;
  db.transaction(() => {
    for (const t of USER_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id);
    for (const t of EMAIL_TABLES) db.prepare(`DELETE FROM ${t} WHERE lower(email)=lower(?)`).run(u.email);
    db.prepare('DELETE FROM user WHERE id=?').run(id);
    db.prepare('INSERT INTO deleted_account (user_id, by) VALUES (?, ?)').run(id, by);
  })();
  return true;
}
function deletePage(db, { token, params, query }) {
  const u = db.prepare('SELECT * FROM user WHERE id=?').get(+params.id);
  if (!u) return null;
  const count = (t, col, v) => db.prepare(`SELECT count(*) FROM ${t} WHERE ${col === 'email' ? 'lower(email)=lower(?)' : 'user_id=?'}`).pluck().get(v);
  const what = [['usage', 'thing they did', 'things they did'], ['saved_landscape', 'follow'], ['mail_log', 'email sent', 'emails sent'], ['payment', 'payment (our copy; Stripe keeps its own)', 'payments (our copy; Stripe keeps its own)'], ['session', 'signed-in browser']]
    .map(([t, one, many]) => [count(t, 'user_id', u.id) + (t === 'payment' ? db.prepare('SELECT count(*) FROM payment WHERE user_id IS NOT ? AND lower(email)=lower(?)').pluck().get(u.id, u.email) : 0), one, many])
    .concat([[count('area_request', 'email', u.email), 'message or request they sent us', 'messages and requests they sent us']]).filter(([c]) => c).map(([c, one, many]) => plural(c, one, many));
  const paying = u.plan !== 'free' && !u.solo_until;
  const body = `<p class="crumbs"><a href="${link(token, '/people')}">People</a> / <a href="${link(token, '/people/' + u.id)}">${esc(u.email)}</a></p>
${head(`Delete ${esc(u.email)}?`, '', `The account and everything about them goes: ${what.length ? what.join(', ') : 'the account itself'}, and the rest that has their email. Only a line saying an account was deleted stays. This cannot be undone.`)}
${flash(query)}
${paying ? `<div class="flash error"><b>They pay for Solo.</b> Cancel the subscription in Stripe first, so they are not charged again; then delete here.</div>`
    : box('Asks twice', '', `<form class="boxbody delform" method="post" action="${link(token, `/people/${u.id}/delete`)}"><p>Type their email to delete the account.</p>
<div class="delrow"><input class="input" name="email" autocomplete="off" placeholder="Their email" aria-label="Their email" required><button class="btn danger" type="submit">Delete for good</button><a class="btn" href="${link(token, '/people/' + u.id)}">Cancel</a></div></form>`)}`;
  return shell(db, `Delete ${u.email}`, '/people', body, token);
}

// ---------- the actions (POST; src/server.js checks isAdmin) ----------
// Each returns [path, params] of where to go next, with ok= or err= for the line it shows.
const back = (id, k, v) => [`/people/${id}`, { [k]: v }];
export const ACTIONS = {
  '/admin/done/:kind/:id': (db, { params, body }) => {
    const noteText = String(body.note || '').trim().slice(0, 300) || null, id = +params.id;
    if (params.kind === 'checkout' || params.kind === 'allowance') {
      if (!db.prepare('SELECT 1 FROM user WHERE id=?').get(id)) return null;
      db.prepare('INSERT INTO follow_up (user_id, kind, note) VALUES (?,?,?)').run(id, params.kind, noteText);
      return ['', { ok: 'done' }];
    }
    const sql = { request: "UPDATE area_request SET done_at=datetime('now'), done_note=? WHERE id=? AND done_at IS NULL",
      billing: "UPDATE billing_event SET done_at=datetime('now'), done_note=? WHERE id=? AND done_at IS NULL",
      order: "UPDATE payment SET delivered_at=datetime('now'), done_note=? WHERE id=? AND delivered_at IS NULL" }[params.kind];
    if (!sql) return null;
    db.prepare(sql).run(noteText, id);
    return ['', { ok: params.kind === 'order' ? 'delivered' : 'done' }];
  },
  '/admin/people/:id/solo': (db, { params, body }) => {
    const u = db.prepare('SELECT * FROM user WHERE id=?').get(+params.id);
    if (!u) return null;
    if (u.plan !== 'free' && !u.solo_until) return back(u.id, 'err', 'paying');
    if (body.end) { db.prepare("UPDATE user SET plan='free', solo_until=NULL WHERE id=?").run(u.id); return back(u.id, 'ok', 'soloend'); }
    const d = String(body.until || '');
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || d <= isoDay() || d > addDays(isoDay(), 731)) return back(u.id, 'err', 'baddate');
    db.prepare("UPDATE user SET plan='solo', solo_until=? WHERE id=?").run(d, u.id);
    return back(u.id, 'ok', 'solo');
  },
  '/admin/people/:id/emails-off': (db, { params }) => (db.prepare('UPDATE user SET digest_off=1, news_off=1 WHERE id=?').run(+params.id).changes ? back(+params.id, 'ok', 'emailsoff') : null),
  '/admin/people/:id/signout': (db, { params }) => {
    if (!db.prepare('SELECT 1 FROM user WHERE id=?').get(+params.id)) return null;
    db.prepare('DELETE FROM session WHERE user_id=?').run(+params.id);
    return back(+params.id, 'ok', 'signout');
  },
  '/admin/people/:id/delete': (db, { params, body, by }) => {
    const u = db.prepare('SELECT * FROM user WHERE id=?').get(+params.id);
    if (!u) return null;
    if (u.plan !== 'free' && !u.solo_until) return [`/people/${u.id}/delete`, { err: 'paying' }];
    if (String(body.email || '').trim().toLowerCase() !== u.email.toLowerCase()) return [`/people/${u.id}/delete`, { err: 'wrongemail' }];
    deleteAccount(db, u.id, by);
    return ['/people', { ok: 'deleted' }];
  },
};
// Solo given free by hand goes back to Free the day after its date. Called by the hourly timer (src/server.js).
export const endGifts = db => db.prepare("UPDATE user SET plan='free', solo_until=NULL WHERE solo_until IS NOT NULL AND solo_until < date('now')").run().changes;

// ---------- Money ----------
const troubleTable = (db, list, token, empty) => table(['When', 'What', 'Who', 'Amount', 'Detail', 'Stripe'], list.map(r => [esc(when(r.at)), esc(TROUBLE[r.kind] || r.kind), who(db, token, r.email),
  r.amount ? esc(money(r.amount, r.currency)) : '', esc(r.detail || '') + (r.done_at ? `<br><small>Done ${esc(day(r.done_at))}${r.done_note ? ': ' + esc(r.done_note) : ''}</small>` : ''),
  r.customer ? `<a href="${stripeUrl('customers/' + encodeURIComponent(r.customer), true)}">Open</a>` : '']), empty);
function moneyPage(db, { token }) {
  const pay = payers(db), real = pay.filter(p => p.live === 1);
  const payments = db.prepare('SELECT p.*, u.stripe_customer FROM payment p LEFT JOIN user u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200').all();
  const months = db.prepare("SELECT substr(created_at,1,7) AS m, livemode, sum(amount) AS cents, count(*) AS c FROM payment GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 48").all();
  const realMonths = months.filter(m => m.livemode).map(m => [m.m, Math.round(m.cents / 100), plural(m.c, 'payment')]);
  const testCents = months.filter(m => !m.livemode).reduce((a, m) => a + m.cents, 0);
  const founding = db.prepare('SELECT count(*) FROM user WHERE founding=1').pluck().get();
  const gifted = db.prepare('SELECT count(*) FROM user WHERE solo_until IS NOT NULL').pluck().get();
  const trouble = db.prepare('SELECT * FROM billing_event ORDER BY id DESC LIMIT 100').all();
  const byPlan = Object.entries(real.reduce((a, p) => ({ ...a, [p.plan]: (a[p.plan] || 0) + 1 }), {}));
  const body = `${head('Money', 'Real payments apart from test ones. Refunds are done in Stripe.')}
<div class="stats">
${stat('Monthly revenue now', dollars(mrr(real)), byPlan.map(([p, c]) => `${c} on ${p}`).join(', ') || 'nobody paying')}
${stat('Paying accounts', n(real.length), [pay.length - real.length ? `${pay.length - real.length} more on test` : '', gifted ? `${n(gifted)} on Solo free` : ''].filter(Boolean).join(', '))}
${stat('Founding places', n(founding), `of ${FOUNDING_PLACES} used`)}
${stat('Taken in all', esc(money(months.filter(m => m.livemode).reduce((a, m) => a + m.cents, 0))), testCents ? `${esc(money(testCents))} in test` : 'real payments')}
</div>
${box('Taken each month (real, dollars)', 'card', bars(realMonths, 'No real payments yet.'))}
${box('Cancellations and failed renewals', 'info', troubleTable(db, trouble, token, 'None so far.'))}
${box('Payments', 'card', table(['When', 'Email', 'Plan', 'Amount', 'Real or test', 'Stripe'], payments.map(p => [esc(when(p.created_at)), p.user_id ? `<a href="${link(token, '/people/' + p.user_id)}">${esc(p.email)}</a>` : esc(p.email),
    esc(p.plan) + (p.delivered_at ? `<br><small>Delivered ${esc(day(p.delivered_at))}${p.done_note ? ': ' + esc(p.done_note) : ''}</small>` : ''), esc(money(p.amount, p.currency)), p.livemode ? 'Real' : 'Test',
    p.stripe_customer ? `<a href="${stripeUrl('customers/' + encodeURIComponent(p.stripe_customer), p.livemode)}">Customer</a>` : `<a href="${stripeUrl('payments', p.livemode)}">Payments</a>`]), 'No payments yet.'))}`;
  return shell(db, 'Money', '/money', body, token);
}

// ---------- reverse DNS and country names (Health, Growth) ----------
const owners = new Map();   // address -> { name, at }: reverse DNS answers, kept a day
async function owner(ip) {
  if (!isIPv4(ip)) return '';
  const c = owners.get(ip);
  if (c && Date.now() - c.at < 864e5) return c.name;
  const name = await Promise.race([dns.reverse(ip).then(a => a[0] || '', () => ''), new Promise(r => setTimeout(() => r(''), 1500))]);
  if (owners.size > 5000) owners.clear();
  owners.set(ip, { name, at: Date.now() });
  return name;
}
const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = c => { try { return c ? COUNTRY.of(c) : ''; } catch { return c; } };
// ---------- Growth: is it working, and where do people stop? (replaces Visitors and the funnel on Usage) ----------
// Visits are visitor-days of page_view (the code changes daily, so someone who comes on two days counts twice). People are the
// accounts made in the period, without the admins' own (ADMIN_EMAILS). Each is followed through five steps.
const adminSet = () => new Set(String(process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
const notAdmin = u => !adminSet().has(String(u.email).toLowerCase());
const REAL_AI = "(x.kind='mcp' AND x.detail NOT LIKE 'whoami%' AND x.detail NOT LIKE 'show %')";
const PERSON_SQL = `SELECT u.*,
    (SELECT count(*) FROM usage x WHERE x.user_id=u.id AND (x.kind IN ('landscape','search','csv','follow') OR ${REAL_AI})) AS acts,
    EXISTS (SELECT 1 FROM usage x WHERE x.user_id=u.id AND (x.kind='landscape' OR ${REAL_AI})) AS opened,
    (date(u.last_seen) > date(u.created_at) OR EXISTS (SELECT 1 FROM usage x WHERE x.user_id=u.id AND date(x.at) > date(u.created_at))) AS back,
    EXISTS (SELECT 1 FROM usage x WHERE x.user_id=u.id AND x.kind='checkout') AS checkout,
    EXISTS (SELECT 1 FROM payment p WHERE p.user_id=u.id AND p.livemode=1 AND p.plan NOT LIKE 'custom%') AS paid,
    (SELECT count(*) FROM usage x WHERE x.user_id=u.id AND ${REAL_AI}) AS ai
  FROM user u`;
// The steps one account reached: [used it, came back, checkout, paid]. Used it: opened a landscape (or asked an AI app) and did one more thing.
const stepsOf = u => [u.opened && u.acts >= 2 ? 1 : 0, u.back ? 1 : 0, u.checkout ? 1 : 0, u.paid ? 1 : 0];
const cohort = (db, from, to) => db.prepare(`${PERSON_SQL} WHERE u.created_at >= datetime('now', ?) AND u.created_at < datetime('now', ?) ORDER BY u.created_at DESC`).all(from, to).filter(notAdmin);
const visitCount = (db, fromDay, toDay) => db.prepare("SELECT count(*) FROM (SELECT DISTINCT day, visitor FROM page_view WHERE day >= date('now', ?) AND day < date('now', ?))").pluck().get(fromDay, toDay);
// Where someone came from, in words: an AI app, a site, typing the address.
const aiApp = u => (/^ai:/.test(u.came_from || '') ? u.came_from.slice(3) : '');
const sourceOf = u => (aiApp(u) ? `${aiApp(u)} (AI app)` : !u.first_ref ? 'Not recorded' : u.first_ref === 'direct' ? 'Typed the address or a bookmark' : sourceName(u.first_ref));
// Kinds of page, for the first page someone saw.
const KINDS = [[/^\/$/, 'Home page', 'Home page'], [/^\/diseases\//, 'Disease pages', 'Disease'], [/^\/landscapes\/./, 'Landscape pages', 'Landscape'], [/^\/companies\//, 'Company pages', 'Company'],
  [/^\/drugs\//, 'Drug pages', 'Drug'], [/^\/targets\//, 'Target pages', 'Target'], [/^\/pricing/, 'Pricing', 'Pricing'], [/./, 'Other pages', '']];
const kindOf = p => KINDS.find(([re]) => re.test(p || '')) || KINDS[KINDS.length - 1];
function pageName(db, p) {
  const [, kind, id] = String(p || '').split('/'), raw = decodeURIComponent(id || '');
  const look = kind === 'drugs' ? db.prepare('SELECT name FROM program WHERE id=?').pluck().get(raw) : kind === 'companies' ? db.prepare('SELECT name FROM company WHERE id=?').pluck().get(raw) : '';
  const words = { search: 'Search', connect: 'Connect your AI', app: 'The app', landscapes: 'All landscapes', talk: 'Talk to us', signin: 'Sign in' };
  return look || (raw ? raw.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()) : words[kind] || p);
}
function firstPage(db, u) {
  if (aiApp(u)) return `Joined inside ${aiApp(u)}`;
  if (!u.first_page) return '';
  const one = kindOf(u.first_page)[2];
  return one && !['Home page', 'Pricing'].includes(one) ? `${one}: ${pageName(db, u.first_page)}` : one || 'Another page';
}
// Where someone is now, in words.
function whereNow(db, u) {
  const [used, , checkout, paid] = stepsOf(u);
  if (paid) return 'Pays for Solo';
  if (checkout) return used ? 'Left at checkout' : 'Opened checkout before using it';
  const lands = db.prepare("SELECT detail FROM usage WHERE user_id=? AND kind='landscape' GROUP BY lower(detail) ORDER BY max(at) DESC LIMIT 2").pluck().all(u.id).map(l => l.replace(/^./, c => c.toUpperCase()));
  const searches = db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='search'").pluck().get(u.id);
  if (u.ai) return `${plural(u.ai, 'AI question')}${u.back ? '' : ', then quiet'}`;
  if (lands.length && !searches) return `Opened ${lands.join(', ')}${used ? '' : ', nothing else'}`;
  if (lands.length || searches) return [lands.length ? `Used ${lands.join(', ')}` : '', searches ? plural(searches, 'search', 'searches') : ''].filter(Boolean).join(', ');
  return 'Made an account, did nothing';
}
const dot = on => `<i class="sdot${on ? ' on' : ''}" title="${on ? 'Yes' : 'Not yet'}"></i>`;
const shortDay = s => (day(s) === isoDay() ? 'Today' : `${WD[toDate(day(s)).getUTCDay()]} ${toDate(day(s)).getUTCDate()}`);   // Mon 16
// Who each email goes to, short (Growth).
const MAIL_TO = { hello: 'right after sign-up', welcome: 'once per account', news: 'to Free accounts', monday: 'to Solo accounts', upgrade: 'after paying for Solo' };
const STEP_TIPS = ['Visits from real browsers. Someone who comes on two days counts twice.', 'New accounts, any way in: the website or an AI app.',
  'Opened a landscape (or asked an AI app) and then did one more thing: a search, another landscape, a download or a question from their AI app.',
  'Seen again on a later day than the day they joined.', 'Pressed Choose Solo and reached the Stripe page.', 'Paid for Solo. Solo given free by hand is not counted.'];

async function growth(db, { token, query }) {
  const days = +query.days === 30 ? 30 : 7, word = days === 7 ? 'week' : 'month';
  const t = isoDay(), from = addDays(t, -(days - 1));
  const people = cohort(db, `-${days} days`, '+1 day'), before = cohort(db, `-${2 * days} days`, `-${days} days`);
  const count = list => [0, 1, 2, 3].map(i => list.filter(u => stepsOf(u)[i]).length);
  const vals = [visitCount(db, `-${days - 1} days`, '+1 day'), people.length, ...count(people)];
  const prev = [visitCount(db, `-${2 * days - 1} days`, `-${days - 1} days`), before.length, ...count(before)];
  const drops = vals.map((v, i) => (i ? Math.max(0, vals[i - 1] - v) : -1));
  const worst = drops.indexOf(Math.max(...drops));
  const names = ['Visited', 'Signed up', 'Used it', 'Came back', 'Checkout', 'Paid'];
  const strip = `<section class="box path" aria-label="This ${word}, step by step">${names.map((k, i) => `<div class="ps${i === worst && drops[i] > 0 ? ' worst' : ''}${i ? ' pick' : ''}"${i ? ` data-step="${i}" role="button" tabindex="0" aria-pressed="false"` : ''}>
  <div class="k" title="${STEP_TIPS[i]}">${k}</div><div class="v">${n(vals[i])}</div><div class="s">${prev[i] === vals[i] ? `same as last ${word}` : `${n(prev[i])} last ${word}`}</div>
  <div class="went">${!i ? 'where it starts' : i === worst && drops[i] > 0 ? `<b>${n(drops[i])} of ${n(vals[i - 1])} left</b>` : `${n(Math.min(vals[i], vals[i - 1]))} of ${n(vals[i - 1])} went on`}</div></div>`).join('')}</section>`;
  const left = people.filter(u => { const s = stepsOf(u); return s[2] && !s[3]; });
  const web = people.filter(u => !aiApp(u)).length;
  const reading = `<div class="reading">${icon('info')}<p><b>${plural(vals[0], 'visit')} brought ${plural(vals[1], 'new account')}${prev[1] !== vals[1] ? `, ${vals[1] > prev[1] ? 'up' : 'down'} from ${n(prev[1])} the ${word} before` : `, as many as the ${word} before`}.</b>
${vals[0] ? `${n(Math.max(0, vals[0] - web))} of ${n(vals[0])} visits ended without an account.` : ''} ${vals[1] ? `${n(vals[2])} of the ${n(vals[1])} really used it.` : ''}
${left.length ? `<a href="#new">${n(left.length)} opened checkout and did not pay</a>: ${left.length === 1 ? 'they are' : 'they are'} on Today to write to.` : ''}</p></div>`;

  // New people, one line each
  const SHOW = 50;
  const ppl = `<div class="tw"><table class="ppl"><tr><th>Who</th><th>How they found us</th><th>Joined</th><th>Used it</th><th>Came back</th><th>Checkout</th><th>Paid</th><th>Where they are</th><th>Last seen</th></tr>${people.slice(0, SHOW).map(u => {
    const s = stepsOf(u), hot = s[2] && !s[3], words = esc(whereNow(db, u));
    return `<tr${hot ? ' class="hot"' : ''} data-s="${s.join('')}"><td><a class="who" href="${link(token, '/people/' + u.id)}">${esc(u.email)}</a></td><td>${esc(sourceOf(u))}${firstPage(db, u) ? `<br><small>${esc(firstPage(db, u))}</small>` : ''}</td>
<td class="nw">${esc(shortDay(u.created_at))}</td>${s.map(x => `<td>${dot(x)}</td>`).join('')}<td>${hot ? `<b>${words}</b>` : words}</td><td class="muted nw">${u.last_seen ? esc(agoM(u.last_seen)) : 'never'}</td></tr>`;
  }).join('')}</table></div>`;
  const newBox = box(`New people this ${word}`, 'user', people.length ? `<p class="boxnote filter" hidden>Showing the people who reached <b data-fname></b>. <a href="#" data-fclear>Show all ${n(Math.min(people.length, SHOW))}</a></p>${ppl}<p class="nothing none" hidden>Nobody yet.</p>
<p class="boxnote under dots">Each dot is a step from the strip above: ${dot(1)} done, ${dot(0)} not yet. A bold line is someone worth writing to today.${people.length > SHOW ? ` The ${n(SHOW)} newest of ${n(people.length)}.` : ''}</p>` : nothing(`Nobody signed up this ${word}.`), { count: people.length, id: 'new', more: `<a class="more" href="${link(token, '/people')}">Everyone</a>` });

  // Visits each day, last 14 days, with new accounts
  const dv = Object.fromEntries(db.prepare("SELECT day, count(DISTINCT visitor) AS c FROM page_view WHERE day >= date('now','-13 days') GROUP BY day").all().map(r => [r.day, r.c]));
  const da = cohort(db, '-14 days', '+1 day').reduce((a, u) => ((a[day(u.created_at)] = (a[day(u.created_at)] || 0) + 1), a), {});
  const span = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const dmax = Math.max(1, ...span.map(d => dv[d] || 0)), sum = list => list.reduce((a, d) => a + (dv[d] || 0), 0);
  const chart = `<div class="dayswrap"><div class="days14" role="img" aria-label="Visits and new accounts per day, last 14 days">
<span class="wk last">The week before · ${plural(sum(span.slice(0, 7)), 'visit')}</span><span class="wk">This week · ${plural(sum(span.slice(7)), 'visit')}</span>
${span.map((d, i) => { const v = dv[d] || 0, a = da[d] || 0; return `<div class="dc${i >= 7 ? ' this' : ''}${i === 7 ? ' first' : ''}" title="${esc(dDay(d))}: ${plural(v, 'visit')}, ${plural(a, 'new account')}">
<span class="dbar"><span class="dv">${n(v)}</span><i style="height:${v ? Math.max(4, Math.round((100 * v) / dmax)) : 0}%"></i></span><span class="da">${a ? `<i class="acc">${n(a)}</i>` : ''}</span><span class="dlab">${d === t ? 'Today' : toDate(d).getUTCDate()}</span></div>`; }).join('')}
</div></div><div class="legend"><span><i class="lg"></i>Visits</span><span><i class="acc">1</i>New accounts that day</span></div>`;

  // Where they came from: visits by the site that sent them (the first outside site of each visit), and the new accounts by theirs
  const visitSrc = db.prepare(`SELECT coalesce((SELECT ref FROM page_view p2 WHERE p2.day=v.day AND p2.visitor=v.visitor AND p2.ref != '' AND p2.ref NOT LIKE 'accounts.google.%' ORDER BY p2.id LIMIT 1), '') AS ref, count(*) AS c
    FROM (SELECT DISTINCT day, visitor FROM page_view WHERE day >= ?) v GROUP BY 1`).all(from);
  const src = {};
  const row = k => (src[k] ||= { k, visits: 0, hosts: {}, people: [] });
  for (const r of visitSrc) { const k = r.ref ? sourceName(r.ref) : 'Typed the address or a bookmark'; row(k).visits += r.c; if (r.ref) row(k).hosts[r.ref] = (row(k).hosts[r.ref] || 0) + r.c; }
  for (const u of people) row(sourceOf(u)).people.push(u);
  const srcRows = Object.values(src).sort((a, b) => b.people.length - a.people.length || b.visits - a.visits);
  let keep = srcRows.filter((r, i) => r.people.length || i < 5 || /^Typed/.test(r.k)), rest = srcRows.filter(r => !keep.includes(r));
  if (rest.length === 1) { keep = srcRows; rest = []; }   // one other site is shown as itself
  const restVisits = rest.reduce((a, r) => a + r.visits, 0);
  const isAi = r => / \(AI app\)$/.test(r.k);
  const drill = list => `<ul class="drl">${list.map(u => `<li><a class="who" href="${link(token, '/people/' + u.id)}">${esc(u.email)}</a><span class="dp">${esc(firstPage(db, u) || '')}</span><span class="dw">${esc(whereNow(db, u))} · last seen ${u.last_seen ? esc(agoM(u.last_seen)) : 'never'}</span></li>`).join('')}</ul>`;
  const srcLine = (label, r, visits, detail) => `<tr class="drow"><td>${label}${icon('chevron', 16, 'bchev')}</td><td class="n" data-l="Visits">${visits}</td><td class="n" data-l="Made an account">${n(r.people.length)}</td><td class="n" data-l="Used it">${n(r.people.filter(u => stepsOf(u)[0]).length)}</td><td class="n" data-l="Paying">${n(r.people.filter(u => stepsOf(u)[3]).length)}</td></tr><tr class="dtl" hidden><td colspan="5">${detail}</td></tr>`;
  const sourceTable = `<div class="tw"><table><tr><th>Source</th><th class="n">Visits</th><th class="n">Made an account</th><th class="n">Used it</th><th class="n">Paying</th></tr>${keep.map(r => srcLine(esc(r.k), r,
    isAi(r) ? '<span class="muted" title="People who join inside an AI app never visit the website first">does not apply</span>' : n(r.visits),
    r.people.length ? drill(r.people) : `<p class="drnone">Nobody signed up from here${Object.keys(r.hosts).length > 1 ? `. Visits: ${esc(Object.entries(r.hosts).sort((a, b) => b[1] - a[1]).map(([h, c]) => `${h} ${c}`).join(', '))}` : ''}.</p>`)).join('')}
${rest.length ? srcLine(`${plural(rest.length, 'other site')} <span class="muted">(${esc(rest.slice(0, 4).map(r => r.k).join(', '))}${rest.length > 4 ? ', …' : ''})</span>`, { people: [] }, n(restVisits),
    `<p class="drnone">Nobody signed up from these. Visits: ${esc(rest.map(r => `${r.k} ${r.visits}`).join(', '))}.</p>`) : ''}
<tr class="tot"><td>All</td><td class="n" data-l="Visits">${n(vals[0])}</td><td class="n" data-l="Made an account">${n(vals[1])}</td><td class="n" data-l="Used it">${n(vals[2])}</td><td class="n" data-l="Paying">${n(vals[5])}</td></tr></table></div>`;

  // Where they landed: the first page of each visit, by kind
  const firsts = db.prepare('SELECT (SELECT path FROM page_view p2 WHERE p2.day=v.day AND p2.visitor=v.visitor ORDER BY p2.id LIMIT 1) AS path FROM (SELECT DISTINCT day, visitor FROM page_view WHERE day >= ?) v').pluck().all(from);
  const land = {};
  for (const p of firsts) { const k = kindOf(p)[1], r = (land[k] ||= { visits: 0, accounts: 0, pages: {} }); r.visits++; if (!['Home page', 'Pricing'].includes(k)) r.pages[p] = (r.pages[p] || 0) + 1; }
  for (const u of people.filter(u => u.first_page && !aiApp(u))) (land[kindOf(u.first_page)[1]] ||= { visits: 0, accounts: 0, pages: {} }).accounts++;
  const landRows = Object.entries(land).sort((a, b) => b[1].visits - a[1].visits);
  const landTable = table(['The first page they saw', 'Visits', 'Made an account', 'Which ones'], landRows.map(([k, r]) => { const top = Object.entries(r.pages).sort((a, b) => b[1] - a[1]);
    return [esc(k), r.visits, r.accounts, top.length ? `<span class="muted">${top.length > 3 ? `${n(top.length)} different. ` : ''}${esc(top.slice(0, 3).map(([p, c]) => `${pageName(db, p)} ${c}`).join(', '))}</span>` : '']; }), `No visits this ${word}.`);
  const topLand = landRows[0];
  const landNote = topLand ? `${esc(topLand[0])} ${/s$/.test(topLand[0]) ? 'bring' : 'brings'} the most visits${topLand[1].visits ? `, and ${topLand[1].accounts ? `${n(topLand[1].accounts)} in ${n(topLand[1].visits)}` : 'none of them'} made an account` : ''}.` : '';

  // Where visitors are, and phone or computer
  const cv = db.prepare("SELECT coalesce(nullif(country,''),'') AS c, count(DISTINCT day || visitor) AS v FROM page_view WHERE day >= ? GROUP BY 1 ORDER BY v DESC").all(from);
  const cs = people.reduce((a, u) => { const c = u.signup_ip ? country(String(u.signup_ip).replace(/\/\d+$/, '')) : ''; a[c] = (a[c] || 0) + 1; return a; }, {});
  const cmap = {};
  for (const r of cv) (cmap[r.c] ||= { v: 0, s: 0 }).v += r.v;
  for (const [c, k] of Object.entries(cs)) (cmap[c] ||= { v: 0, s: 0 }).s += k;
  const named = Object.entries(cmap).filter(([c]) => c).sort((a, b) => b[1].v - a[1].v || b[1].s - a[1].s), topC = named.slice(0, 5), otherC = named.slice(5);
  const cRows = [...topC.map(([c, r]) => [esc(countryName(c)), r.v, r.s]),
    ...(otherC.length ? [[`${plural(otherC.length, 'other country', 'other countries')} <span class="muted">(${esc(otherC.map(([c]) => countryName(c)).join(', '))})</span>`, otherC.reduce((a, [, r]) => a + r.v, 0), otherC.reduce((a, [, r]) => a + r.s, 0)]] : []),
    ...(cmap[''] ? [['Not known', cmap[''].v, cmap[''].s]] : [])];
  const bestC = Object.entries(cs).filter(([c]) => c).sort((a, b) => b[1] - a[1])[0];
  const devices = db.prepare("SELECT device AS d, count(DISTINCT day || visitor) AS v FROM page_view WHERE day >= ? GROUP BY 1 ORDER BY v DESC").all(from);
  const phone = devices.find(r => r.d === 'phone')?.v || 0, allDev = devices.reduce((a, r) => a + r.v, 0);

  // Emails and what came of them: last 14 days, by day and kind; came back = used it within 2 days of getting it
  const sent = db.prepare(`SELECT m.user_id, m.kind, m.sent_at, u.email FROM (SELECT user_id, kind, sent_at FROM mail_log WHERE sent_at >= date('now','-13 days')
      UNION ALL SELECT user_id, 'monday', sent_at FROM digest_log WHERE sent_at >= date('now','-13 days')) m JOIN user u ON u.id=m.user_id WHERE m.kind NOT IN ('talk','admin') ORDER BY m.sent_at DESC`).all();
  // Came back: used it from an hour after the email (not the visit that was going on) to 2 days after.
  const cameBack = db.prepare(`SELECT 1 FROM usage x WHERE x.user_id=? AND x.at > datetime(?, '+1 hour') AND x.at <= datetime(?, '+2 days') AND x.kind NOT IN ('drugs_alert','drugs_stopped')
      UNION SELECT 1 FROM user u WHERE u.id=? AND u.last_seen > datetime(?, '+1 hour') AND u.last_seen <= datetime(?, '+2 days') LIMIT 1`).pluck();
  const groups = {};
  for (const m of sent) ((groups[day(m.sent_at)] ||= {})[m.kind] ||= []).push(m);
  const emailRows = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).flatMap(([d, kinds]) => Object.entries(kinds).map(([k, list], i) => {
    const back = list.filter(m => cameBack.get(m.user_id, m.sent_at, m.sent_at, m.user_id, m.sent_at, m.sent_at));
    const early = hoursSince(list[list.length - 1].sent_at) < 48;
    const result = back.length ? `${n(back.length)} of ${n(list.length)}: ${back.slice(0, 3).map(m => `<a class="who" href="${link(token, '/people/' + m.user_id)}">${esc(m.email)}</a>`).join(', ')}${back.length > 3 ? ', …' : ''}`
      : early ? '<span class="muted">too early to tell</span>' : `0 of ${n(list.length)}`;
    return `<tr${i ? '' : ' class="grp"'}><td>${i ? '' : `<span class="nw">${esc(shortDay(d))}</span>`}</td><td>${esc(MAIL[k] || k)} <small>${esc(MAIL_TO[k] || '')}</small></td><td class="nw" data-l="Sent to">${plural(list.length, 'person', 'people')}</td><td data-l="Came back within 2 days">${result}</td></tr>`;
  }));
  const off = db.prepare('SELECT sum(coalesce(digest_off,0)) AS monday, sum(coalesce(news_off,0)) AS news, count(*) AS all_ FROM user').get();
  const emailBox = emailRows.length ? `<div class="tw"><table class="emails"><tr><th>Day</th><th>Email</th><th>Sent to</th><th>Came back within 2 days</th></tr>${emailRows.join('')}</table></div>` : nothing('No emails sent in the last 14 days.');

  // Gone quiet: used it, then not seen for 14 days or more (up to 90)
  const quiet = db.prepare(`${PERSON_SQL} WHERE u.last_seen < datetime('now','-14 days') AND u.last_seen >= datetime('now','-90 days') ORDER BY u.last_seen DESC LIMIT 30`).all().filter(u => notAdmin(u) && stepsOf(u)[0]);
  const quietRows = quiet.map(u => `<div><dt><a class="who" href="${link(token, '/people/' + u.id)}">${esc(u.email)}</a></dt><dd>${esc(personLine(db, u))} Last seen ${esc(dShort(u.last_seen))} (${esc(ago(u.last_seen))}).</dd><span class="ra"><a class="btn sm" href="mailto:${esc(u.email)}?subject=${encodeURIComponent(BRAND)}">Write</a></span></div>`);

  const span2 = `${dShort(from)} to ${dShort(t)}`;
  const body = `${head('Growth', `Is it working, and where do people stop? This ${word} (${esc(span2)}) next to the ${word} before.`)}
<nav class="days" aria-label="Time"><a href="${link(token, '/growth')}"${days === 7 ? ' aria-current="page"' : ''}>This week</a><a href="${link(token, '/growth', { days: 30 })}"${days === 30 ? ' aria-current="page"' : ''}>This month</a></nav>
${strip}
${reading}
${newBox}
${box('Visits each day', 'calendar', chart, { more: '<span class="more">Last 14 days</span>' })}
${box('Where they came from', 'arrowUpRight', `${sourceTable}<p class="boxnote under">Press a row to see who came from there. Left out: accounts.google.com and our own pages. Those are people signing in, not finding us.</p>`)}
${box('Where they landed', 'landscape', `${landTable}${landNote ? `<p class="boxnote under">${landNote}</p>` : ''}`)}
<div class="duo">
${box('Where visitors are', 'landscape', `${table(['Country', 'Visits', 'Signed up'], cRows, `No visits this ${word}.`)}<p class="boxnote under">${bestC ? `Most sign-ups: ${esc(countryName(bestC[0]))} (${n(bestC[1])} of ${n(people.length)}).` : 'No sign-up with a known country yet.'} Sign-ups are placed by the address they signed up from.</p>`)}
${box('Phone or computer', 'monitor', `${table(['Device', 'Visits'], devices.map(r => [esc((r.d || 'not known').replace(/^./, c => c.toUpperCase())), r.v]), `No visits this ${word}.`)}<p class="boxnote under">${allDev ? `<b>${n(phone)} of ${n(allDev)} visits from phones.</b> ` : ''}Which device people sign up on is not recorded yet.</p>`)}
</div>
${box('Emails and what came of them', 'chat', `${emailBox}<p class="boxnote under">${off.monday || off.news ? `Turned off: Monday email ${n(off.monday)}, big news ${n(off.news)}, of ${plural(off.all_, 'account')}.` : `Nobody has turned emails off (of ${plural(off.all_, 'account')}).`} Came back: used ${BRAND} again between an hour and 2 days after getting it.</p>`, { more: '<span class="more">Last 14 days</span>' })}
${box('Gone quiet', 'user', `<p class="boxnote">Had used it, then not seen for 14 days or more. People to write to.</p>${quietRows.length ? `<dl class="rows quiet">${quietRows.join('')}</dl>` : nothing('Nobody has gone quiet.')}`, { count: quiet.length })}`;
  return shell(db, 'Growth', '/growth', body, token);
}

// ---------- Interest: what do people come looking for, and what are we missing? (replaces Usage) ----------
// Signed-in people only (usage rows), without the admins' own accounts. Every bar row opens to show who.
const AI_ASKED = { landscape: 'Looked at a landscape', search: 'Searched', drug: 'Looked up a drug', changes: 'Asked what changed', catalysts: 'Asked for dates coming up',
  who_runs_trials: 'Asked who runs trials', trials: 'Looked up trials' };
const aiArgs = d => { try { return JSON.parse(String(d).slice(String(d).indexOf(' ') + 1) || '{}'); } catch { return {}; } };
const cap1 = s => String(s || '').replace(/^./, c => c.toUpperCase());
// A bar list whose rows open: [label, value, note, people: [{ id, email, plan words, what }]].
function drillBars(token, list, empty) {
  if (!list.length) return nothing(empty);
  const max = Math.max(1, ...list.map(r => r[1]));
  return `<div class="bars drills">${list.map(([label, v, noteText, people]) => `<details class="bd"><summary class="b"><span class="l" title="${esc(label)}">${esc(label)}</span><span class="t"><i style="width:${Math.max(1, Math.round((100 * v) / max))}%"></i></span><span class="v">${n(v)}${noteText ? ` <small>${esc(noteText)}</small>` : ''}${icon('chevron', 16, 'bchev')}</span></summary>
<ul class="drl">${people.length ? people.map(p => `<li><a class="who" href="${link(token, '/people/' + p.id)}">${esc(p.email)}</a><span class="dp">${esc(p.plan)}</span><span class="dw">${esc(p.what)}</span></li>`).join('') : '<li><span class="dw">No names: these were page visits, which are counted without saying who.</span></li>'}</ul></details>`).join('')}</div>`;
}
const timesLast = (c, last) => `${c === 1 ? 'once' : `${n(c)} times`}, last ${shortDay(last).replace('Today', 'today')}`;
function interest(db, { token, query }) {
  const days = +query.days === 30 ? 30 : 7, word = days === 7 ? 'week' : 'month', since = `-${days} days`;
  const admins = adminSet();
  const rows = db.prepare(`SELECT x.kind, x.detail, x.at, u.id, u.email, u.plan, u.solo_until, u.founding FROM usage x JOIN user u ON u.id=x.user_id
    WHERE x.at >= datetime('now', ?) ORDER BY x.at`).all(since).filter(r => !admins.has(String(r.email).toLowerCase()));
  const plan = r => planWords(r);
  // rows of one kind grouped by a key: { key: { label, count, people: { id: { email, plan, c, last } } } }
  const group = (list, keyOf, labelOf = keyOf) => {
    const g = {};
    for (const r of list) {
      const k = keyOf(r); if (!k) continue;
      const e = (g[k] ||= { label: labelOf(r), count: 0, people: {} }); e.count++;
      const p = (e.people[r.id] ||= { id: r.id, email: r.email, plan: plan(r), c: 0, last: r.at }); p.c++; p.last = r.at;
    }
    return Object.values(g).map(e => ({ ...e, who: Object.values(e.people) })).sort((a, b) => b.who.length - a.who.length || b.count - a.count);
  };
  const ppl = (n1) => (n1 === 1 ? 'person' : 'people');

  // Searched and found nothing: the to-do list for the data
  const misses = group(rows.filter(r => r.kind === 'search_none'), r => String(r.detail || '').trim().toLowerCase(), r => String(r.detail || '').trim()).slice(0, 30);
  const nearest = q => { try { return suggest(q, { per: 2 }).groups.slice(0, 2).flatMap(g => g.items.slice(0, 1).map(i => `${i.label} (${g.kind})`)); } catch { return []; } };
  const missTable = misses.length ? `<div class="tw"><table class="cards nonet"><tr><th>They typed</th><th>Kind</th><th>Why nothing came up</th><th>Who</th><th class="n">Times</th></tr>${misses.map(m => { const near = nearest(m.label);
    return `<tr><td><b class="nw">${esc(m.label)}</b></td><td><span class="pill nw" title="Sorting each miss into a name we lack, a search problem or a drug we do not have needs the name-matching work">not sorted yet</span></td>
<td>${near.length ? `Search now suggests ${esc(near.join(', '))}.` : 'Nothing close in our names.'}</td><td>${m.who.map(p => `<a class="who" href="${link(token, '/people/' + p.id)}">${esc(p.email)}</a>`).join(', ')}</td><td class="n">${n(m.count)}</td></tr>`; }).join('')}</table></div>` : nothing(`No search came up empty this ${word}.`);

  // Most active people
  const byPerson = {};
  for (const r of rows) (byPerson[r.id] ||= { ...r, acts: [] }).acts.push(r);
  const active = Object.values(byPerson).map(p => {
    const k = kind => p.acts.filter(a => a.kind === kind);
    const ai = k('mcp').filter(a => !/^(whoami|show)\b/.test(a.detail || '')), lands = [...new Set([...k('landscape').map(a => cap1(a.detail)), ...ai.filter(a => /^landscape /.test(a.detail)).map(a => cap1(aiArgs(a.detail).area || aiArgs(a.detail).query))].filter(Boolean))];
    const parts = [ai.length ? plural(ai.length, 'AI question') : '', k('search').length ? plural(k('search').length, 'search', 'searches') : '',
      lands.length ? `${plural(lands.length, 'landscape')}: ${lands.slice(0, 3).join(', ')}${lands.length > 3 ? ', …' : ''}` : '', k('csv').length ? `downloaded ${plural(k('csv').length, 'CSV')}` : '',
      k('follow').length ? `followed ${plural(k('follow').length, 'thing')}` : '', k('checkout').length ? 'opened checkout' : ''].filter(Boolean);
    return { p, score: ai.length + k('search').length + k('landscape').length + k('csv').length * 3 + k('follow').length * 2, parts };
  }).filter(a => a.parts.length).sort((a, b) => b.score - a.score).slice(0, 10);
  const activeTable = active.length ? `<div class="tw"><table class="cards"><tr><th>Who</th><th>What they did this ${word}</th><th>Plan</th></tr>${active.map(({ p, parts }) => `<tr><td><a class="who" href="${link(token, '/people/' + p.id)}">${esc(p.email)}</a></td><td>${esc(cap1(parts.join(', ')))}</td><td><span class="muted nw">${esc(planWords(p))}</span></td></tr>`).join('')}</table></div>` : nothing(`Nobody signed in did anything this ${word}.`);

  // Landscapes opened (on the website, or through an AI app)
  const landRows = rows.filter(r => r.kind === 'landscape' || (r.kind === 'mcp' && /^landscape /.test(r.detail || '')));
  const lands = group(landRows, r => String(r.kind === 'landscape' ? r.detail : aiArgs(r.detail).area || aiArgs(r.detail).query || '').trim().toLowerCase(), r => cap1(String(r.kind === 'landscape' ? r.detail : aiArgs(r.detail).area || aiArgs(r.detail).query || '').trim())).slice(0, 15);
  // Drugs looked at on purpose: a drug page opened by someone signed in (counted without names), or an AI app looking one up
  const drugName = {}, nameOf = q => (drugName[q] ??= (() => { try { const d = drug(q); return d ? `${d.name}${d.company ? ' · ' + d.company : ''}` : q; } catch { return q; } })());
  const aiDrugs = group(rows.filter(r => r.kind === 'mcp' && /^drug /.test(r.detail || '')), r => nameOf(String(aiArgs(r.detail).name || '').trim()), r => nameOf(String(aiArgs(r.detail).name || '').trim()));
  const pageDrugs = db.prepare("SELECT path, count(DISTINCT day || visitor) AS c FROM page_view WHERE signed_in=1 AND path LIKE '/drugs/%' AND day >= date('now', ?) GROUP BY path").all(`-${days - 1} days`);
  const drugs = {};
  for (const d of aiDrugs) drugs[d.label] = { label: d.label, ai: d.count, pages: 0, who: d.who };
  for (const p of pageDrugs) { const l = nameOf(decodeURIComponent(p.path.slice(7))); (drugs[l] ||= { label: l, ai: 0, pages: 0, who: [] }).pages += p.c; }
  const drugList = Object.values(drugs).sort((a, b) => b.ai + b.pages - (a.ai + a.pages)).slice(0, 15);
  // Searches that found something
  const searches = group(rows.filter(r => r.kind === 'search'), r => String(r.detail || '').trim().toLowerCase(), r => String(r.detail || '').trim()).slice(0, 15);
  // What AI apps asked, in words
  const asked = group(rows.filter(r => r.kind === 'mcp'), r => AI_ASKED[String(r.detail || '').split(' ')[0]] || '', r => AI_ASKED[String(r.detail || '').split(' ')[0]]);
  const apps = Object.entries(db.prepare('SELECT c.info, count(DISTINCT t.user_id) AS people FROM oauth_token t LEFT JOIN oauth_client c ON c.client_id=t.client_id GROUP BY t.client_id').all()
    .reduce((a, r) => { const k = clientName(r.info); a[k] = (a[k] || 0) + r.people; return a; }, {})).sort((a, b) => b[1] - a[1]);
  const whoLines = (list, what) => list.who.map(p => ({ id: p.id, email: p.email, plan: p.plan, what: what(p) }));

  const body = `${head('Interest', `What people come looking for, and what we do not have yet. Signed-in people, this ${word}.`)}
<nav class="days" aria-label="Time"><a href="${link(token, '/interest')}"${days === 7 ? ' aria-current="page"' : ''}>This week</a><a href="${link(token, '/interest', { days: 30 })}"${days === 30 ? ' aria-current="page"' : ''}>This month</a></nav>
${box('Searched and found nothing', 'search', `<p class="boxnote">The to-do list for the data. Sorting each miss into a name we lack, a search problem or a drug we do not have is not built yet; the nearest names search suggests today are shown instead.</p>${missTable}`, { count: misses.length })}
${box('Most active people', 'user', activeTable, { more: `<span class="more">This ${word}</span>` })}
<div class="duo">
${box('Landscapes opened', 'landscape', drillBars(token, lands.map(l => [l.label, l.who.length, ppl(l.who.length), whoLines(l, p => `opened ${timesLast(p.c, p.last)}`)]), `No landscape opened this ${word}.`))}
${box('Drugs looked at', 'pill', drillBars(token, drugList.map(d => [d.label, d.ai + d.pages, [d.pages ? plural(d.pages, 'page') : '', d.ai ? `${n(d.ai)} AI` : ''].filter(Boolean).join(', '), d.who.map(p => ({ id: p.id, email: p.email, plan: p.plan, what: `asked about it in an AI app, ${timesLast(p.c, p.last)}` }))]), `No drug looked at this ${word}.`) + '<p class="boxnote under">Drug pages count visits by signed-in people, without names. An AI app looking a drug up is counted by person.</p>', { cls: 'vwide' })}
</div>
<div class="duo">
${box('Searches that found something', 'search', drillBars(token, searches.map(s => [s.label, s.who.length, ppl(s.who.length), whoLines(s, p => `searched it ${timesLast(p.c, p.last)}`)]), `No searches this ${word}.`))}
${box('What AI apps asked', 'plug', `<p class="boxnote">Connected: ${apps.length ? esc(apps.map(([k, c]) => `${k} ${plural(c, 'person', 'people')}`).join(', ')) : 'no AI app yet'}.</p>${drillBars(token, asked.map(a => [a.label, a.count, a.count === 1 ? 'time' : 'times', whoLines(a, p => timesLast(p.c, p.last))]), `No AI questions this ${word}.`)}`)}
</div>`;
  return shell(db, 'Interest', '/interest', body, token);
}

// ---------- Health: is anything broken? (replaces Emails and System) ----------
const size = b => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB');
const at = s => `${dayWords(s)} at ${String(s).slice(11, 16)}`;                                                                    // today at 03:10
// What each email is, in words (Health, Growth).
const MAIL_WHAT = { hello: 'a short note a few minutes after someone signs up', welcome: 'sent once to each account, after their first landscape',
  monday: 'what changed in the landscapes they follow (Solo)', news: 'a major change, to Free accounts', upgrade: 'after someone pays for Solo',
  talk: 'a Talk to us message, to us', admin: 'a note to us' };
// Each source the hourly job checks: the meta key of its last check, its words, the step that updates it, and how old it may get.
const CURRENT = [['ctgov_checked_at', 'ClinicalTrials.gov', 'fetch', 3], ['decisions_checked_fda', 'FDA decisions', 'fda', 3], ['decisions_checked_fda_crl', 'FDA rejection letters', 'fda', 3],
  ['decisions_checked_ema', 'EMA decisions', 'ema', 3], ['decisions_checked_sec', 'SEC decisions', 'sec', 3], ['ctis_checked', 'EU trials (CTIS)', 'ctis', 30]];
const agoM = s => { if (!s) return ''; const m = Math.floor(hoursSince(s) * 60); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : ago(s); };
const STEP_ORDER = ['fetch', 'load', 'compare', 'fda', 'ema', 'sec', 'news', 'ctis'];
const stepOrder = list => [...list].sort((a, b) => ((STEP_ORDER.indexOf(a.name) + 99) % 99) - ((STEP_ORDER.indexOf(b.name) + 99) % 99));
const ageWords = s => { const h = hoursSince(s); return h < 1 ? 'under an hour' : h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`; };
// The disk, the database and the backups next to it (deploy/hourly.sh keeps 7, one a weekday).
function diskInfo() {
  let dbSize = 0, disk = null, backups = [];
  try { dbSize = statSync(DB_PATH).size + (() => { try { return statSync(DB_PATH + '-wal').size; } catch { return 0; } })(); } catch { /* no file */ }
  try { const s = statfsSync(dirname(DB_PATH)); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* not supported */ }
  try { backups = readdirSync(dirname(DB_PATH)).filter(f => /^backup-.*\.db$/.test(f)).map(f => { const s = statSync(join(dirname(DB_PATH), f)); return [f, s.size, s.mtime.toISOString().slice(0, 19).replace('T', ' ')]; }).sort((a, b) => b[2].localeCompare(a[2])); } catch { /* none */ }
  return { dbSize, disk, backups };
}
// One row per thing that can break: { key, k, state: ok | bad | neutral, status, detail, fix }. Also used for the sidebar dot.
function healthChecks(db) {
  const meta = Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map(r => [r.k, r.v]));
  const runs = stepOrder(lastRuns(db)), failing = runs.filter(r => !r.ok), label = r => JOB_LABEL[r.name] || r.name;
  const week = db.prepare("SELECT count(*) AS runs, coalesce(sum(ok=0),0) AS failed FROM job_run WHERE started_at >= datetime('now','-7 days')").get();
  const since = db.prepare('SELECT min(finished_at) FROM job_run WHERE name=? AND ok=0 AND id > coalesce((SELECT max(id) FROM job_run WHERE name=? AND ok=1), 0)').pluck();
  const newestRun = runs.map(r => r.finished_at).sort().pop();
  const out = [];
  out.push(!runs.length ? { key: 'job', k: 'Data update', state: 'neutral', status: 'No runs recorded', detail: 'The hourly job records each step once it runs on the server.', fix: '#steps' }
    : failing.length ? { key: 'job', k: 'Data update', state: 'bad', status: failing.length === 1 ? `${label(failing[0])} failing` : `${failing.length} steps failing`,
      detail: failing.length === 1 ? `Failing since ${dTime(since.get(failing[0].name, failing[0].name))} UTC (exit code ${failing[0].code}). It tries again every hour, and you got an email. ${runs.length > 1 ? `The other ${plural(runs.length - 1, 'step')} work.` : ''}`
        : `${failing.map(label).join(', ')}. Each tries again every hour, and you got an email for each.`, fix: '#steps' }
      : { key: 'job', k: 'Data update', state: 'ok', status: 'Working',
        detail: `${week.failed ? `All ${plural(runs.length, 'step')} work now; ${plural(week.failed, 'run')} failed earlier this week.` : `All ${plural(runs.length, 'step')} worked every time this week.`} Last run ${agoM(newestRun)}.`, fix: '#steps' });
  // Current: each source checked within its time, and its step not failing (a failing step turns this red too).
  const failingNames = new Set(failing.map(r => r.name));
  const known = CURRENT.filter(([k]) => meta[k]);
  const old = known.filter(([k, , step, hours]) => failingNames.has(step) || hoursSince(meta[k]) > hours);
  const decisions = known.filter(([k]) => /^decisions/.test(k)).map(([k]) => meta[k]).sort();
  out.push(!known.length ? { key: 'current', k: 'Data is current', state: 'neutral', status: 'Not recorded', detail: 'No source check recorded yet.', fix: '#sources' }
    : old.length ? { key: 'current', k: 'Data is current', state: 'bad', status: old.length === 1 ? `${old[0][1]} ${ageWords(meta[old[0][0]])} old` : `${plural(old.length, 'source')} out of date`,
      detail: `${old.map(([k, l, step]) => `${l}: last checked ${agoM(meta[k])}${failingNames.has(step) ? ', its step is failing' : ''}`).join('. ')}.${old.length < known.length ? ' Everything else is current.' : ''}`, fix: '#sources' }
      : { key: 'current', k: 'Data is current', state: 'ok', status: 'Up to date',
        detail: `ClinicalTrials.gov ${meta.trials_loaded_at ? `loaded ${agoM(meta.trials_loaded_at)}` : `checked ${agoM(meta.ctgov_checked_at)}`}.${decisions.length ? ` FDA, EMA and SEC checked ${hoursSince(decisions[0]) < 1 ? 'within the hour' : agoM(decisions[0])}.` : ''}`, fix: '#sources' });
  const sent = db.prepare("SELECT (SELECT count(*) FROM mail_log WHERE sent_at >= datetime('now','-7 days')) + (SELECT count(*) FROM digest_log WHERE sent_at >= date('now','-6 days'))").pluck().get();
  const fails = db.prepare("SELECT * FROM mail_fail WHERE at >= datetime('now','-7 days') ORDER BY id DESC").all();
  const f0 = fails[0];
  out.push(fails.length ? { key: 'mail', k: 'Emails', state: 'bad', status: fails.length === 1 ? '1 email did not send' : `${n(fails.length)} emails did not send`,
    detail: `${MAIL[f0.kind] || f0.kind} to ${f0.email || 'someone'}, ${at(f0.at)}. The email service said: "${String(f0.error || '').replace(/^Email failed: /, '').slice(0, 120)}".${fails.length > 1 ? ` And ${plural(fails.length - 1, 'more')}.` : ''}`, fix: '#mail' }
    : { key: 'mail', k: 'Emails', state: 'ok', status: sent ? 'Sending' : 'Nothing sent', detail: `${plural(sent, 'email')} sent this week, none failed. Bounces are not tracked yet.`, fix: '#mail' });
  const { dbSize, disk, backups } = diskInfo();
  out.push(!disk ? { key: 'disk', k: 'Disk', state: 'neutral', status: 'Not known', detail: 'This computer does not say how much room is left.', fix: '#disk' }
    : disk.free < 2e9 ? { key: 'disk', k: 'Disk', state: 'bad', status: 'Almost full', detail: `${size(disk.free)} free of ${size(disk.total)}. The database is ${size(dbSize)}. Under 2 GB, updates and backups can fail.`, fix: '#disk' }
      : { key: 'disk', k: 'Disk', state: 'ok', status: 'Plenty of room', detail: `${size(disk.free)} free of ${size(disk.total)}. The database is ${size(dbSize)}.`, fix: '#disk' });
  const newest = backups[0]?.[2];
  out.push(!newest ? { key: 'backups', k: 'Backups', state: 'bad', status: 'None found', detail: 'No backup next to the database. The hourly job makes one a day.', fix: '#disk' }
    : hoursSince(newest) > 36 ? { key: 'backups', k: 'Backups', state: 'bad', status: `Newest ${ageWords(newest)} old`, detail: `Newest ${at(newest)}. The hourly job should make one a day.`, fix: '#disk' }
      : { key: 'backups', k: 'Backups', state: 'ok', status: 'Up to date', detail: `Newest ${at(newest)}. ${n(backups.length)} kept.`, fix: '#disk' });
  const bots = db.prepare("SELECT count(DISTINCT ip) FROM visitor_day WHERE day >= date('now','-6 days') AND stopped > 0").pluck().get();
  out.push({ key: 'bots', k: 'Bots and scrapers', state: 'neutral', status: bots ? `${plural(bots, 'computer')} stopped` : 'None stopped',
    detail: bots ? 'Stopped by the page limit this week. Nothing to do.' : 'No computer hit the page limit this week.', fix: '#bots' });
  return out;
}
const dotHtml = (state, title = '') => `<i class="hdot ${state}"${title ? ` title="${title}" role="img" aria-label="${title}"` : ''}></i>`;
const fold = (title, ic, summary, inner, { open = false, id = '' } = {}) => `<details class="box fold"${open ? ' open' : ''}${id ? ` id="${id}"` : ''}><summary class="boxhead">${ic ? icon(ic) : ''}<h2>${title}</h2><span class="fsum">${summary}</span>${icon('chevron', 16, 'fchev')}</summary>${inner}</details>`;
async function health(db, { token }) {
  const checks = healthChecks(db), bad = checks.filter(c => c.state === 'bad'), by = Object.fromEntries(checks.map(c => [c.key, c]));
  const newestRun = db.prepare('SELECT max(finished_at) FROM job_run').pluck().get();
  const verdict = `<div class="verdict ${bad.length ? 'bad' : 'ok'}">${dotHtml(bad.length ? 'bad' : 'ok')}<div><b>${bad.length ? `${bad.length === 1 ? '1 thing needs' : `${bad.length} things need`} a look` : 'Everything is working'}</b>
<span>${bad.length ? esc(bad.map(c => `${c.k}: ${/^[A-Z][a-z]/.test(c.status) ? c.status[0].toLowerCase() + c.status.slice(1) : c.status}`).join('. ')) + '.' : `${newestRun ? `Data update last ran ${esc(agoM(newestRun))}. ` : ''}When a data update step breaks you also get an email.`}</span></div></div>`;
  const list = `<ul class="checks">${checks.map(c => `<li class="${c.state}">${dotHtml(c.state)}<span class="ck">${esc(c.k)}</span><span class="cs">${esc(c.status)}</span><span class="cd">${esc(c.detail)}</span><a class="cm" href="${c.fix}">Details</a></li>`).join('')}</ul>`;

  // Details, folded: each opens when its check is red.
  const runs = stepOrder(lastRuns(db));
  const rateBy = Object.fromEntries(db.prepare("SELECT name, count(*) AS runs, coalesce(sum(ok=0),0) AS failed FROM job_run WHERE started_at >= datetime('now','-7 days') GROUP BY name").all().map(r => [r.name, r]));
  const steps = `<div class="tw"><table><tr><th>Step</th><th>Last run</th><th>Result</th><th class="n">Runs this week</th><th class="n">Failed</th></tr>${runs.map(r => { const x = rateBy[r.name] || {};
    return `<tr${r.ok ? '' : ' class="badrow"'}><td>${esc(JOB_LABEL[r.name] || r.name)}</td><td data-l="Last run">${esc(agoM(r.finished_at))}</td><td data-l="Result">${r.ok ? 'Worked' : red(`<b>Failed (exit code ${r.code})</b>`)}</td><td class="n" data-l="Runs this week">${n(x.runs)}</td><td class="n" data-l="Failed">${n(x.failed)}</td></tr>`; }).join('')}</table></div>`;
  const mailKinds = db.prepare(`SELECT kind, count(*) AS c FROM (SELECT kind FROM mail_log WHERE sent_at >= datetime('now','-7 days') UNION ALL SELECT 'monday' FROM digest_log WHERE sent_at >= date('now','-6 days')) GROUP BY kind ORDER BY c DESC`).all();
  const fails = db.prepare("SELECT * FROM mail_fail WHERE at >= datetime('now','-7 days') ORDER BY id DESC LIMIT 50").all();
  const mailBox = `${fails.length ? `<p class="boxnote"><b class="bad">Did not send:</b></p>${table(['When', 'To', 'Email', 'What went wrong'], fails.map(f => [esc(at(f.at)), f.user_id ? `<a href="${link(token, '/people/' + f.user_id)}">${esc(f.email)}</a>` : esc(f.email || ''), esc(MAIL[f.kind] || f.kind), `<small>${esc(f.error || '')}</small>`]))}` : ''}
${table(['Email', 'What it is', 'Sent'], mailKinds.map(r => [esc(MAIL[r.kind] || r.kind), `<span class="muted">${esc(MAIL_WHAT[r.kind] || '')}</span>`, r.c]), 'No emails sent this week.')}<p class="boxnote under">Sign-in emails are not counted when they send, only when they fail.</p>`;
  const meta = Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map(r => [r.k, r.v]));
  const srcRows = SOURCES.filter(([k]) => meta[k] && !isNaN(toDate(meta[k])));
  const newestSrc = srcRows.map(([k]) => meta[k]).sort((a, b) => toDate(b) - toDate(a))[0];
  const oldKeys = new Set(CURRENT.filter(([k, , step, hours]) => meta[k] && (runs.some(r => !r.ok && r.name === step) || hoursSince(meta[k]) > hours)).map(([k]) => k));
  const changes = db.prepare("SELECT date, count(*) AS c, sum(kind='new_trial') AS new_trials, sum(kind IN ('phase','status','date')) AS moved, sum(kind IN ('approval','rejection','delay','opinion','filing','withdrawal')) AS decisions FROM change WHERE date IS NOT NULL GROUP BY date ORDER BY date DESC LIMIT 12").all();
  const stopped = stoppedComputers(db, 7), own = await Promise.all(stopped.map(s => owner(s.ip)));
  const { dbSize, disk, backups } = diskInfo();
  const body = `${head('Health', 'Is anything broken? The data update runs by itself every hour.')}
${verdict}
${box('Checks', 'check', list)}
<h3 class="sub">Details</h3>
${fold('Data update, step by step', 'pulse', by.job.state === 'bad' ? red(esc(by.job.status)) : runs.length ? `All ${plural(runs.length, 'step')} worked` : 'No runs recorded', runs.length ? steps : nothing('No runs recorded yet (the hourly job records them once deployed).'), { open: by.job.state === 'bad', id: 'steps' })}
${fold('Emails this week', 'chat', fails.length ? `${red(esc(by.mail.status))} · ${plural(mailKinds.reduce((a, r) => a + r.c, 0), 'sent', 'sent')}` : `${n(mailKinds.reduce((a, r) => a + r.c, 0))} sent, none failed`, mailBox, { open: !!fails.length, id: 'mail' })}
${fold('Where the data comes from', 'database', newestSrc ? `Newest: ${esc(agoM(newestSrc))}` : 'Not recorded', table(['Source', 'Last updated'], srcRows.map(([k, l]) => [esc(l), `${oldKeys.has(k) ? red(esc(agoM(meta[k]))) : esc(agoM(meta[k]))} <small>${esc(when(meta[k]))}</small>`]), 'No load dates recorded.'), { open: by.current.state === 'bad', id: 'sources' })}
${fold('What each update changed', 'table', changes[0] ? `Last: ${plural(changes[0].c, 'change')} on ${esc(dShort(changes[0].date))}` : 'None recorded', table(['Release', 'All', 'New trials', 'Phase, status or date', 'Regulator decisions'], changes.map(c => [esc(dShort(c.date)), c.c, c.new_trials, c.moved, c.decisions]), 'No changes recorded.'))}
${fold('Bots and scrapers', 'eye', stopped.length ? `${plural(stopped.length, 'computer')} stopped this week` : 'None stopped this week', `<p class="boxnote">Signed out, more than ${PAGES.hour} pages in an hour or ${PAGES.day} in a day. Owner: the address's reverse DNS name.</p>`
    + table(['Computer', 'Owner', 'Country', 'Pages', 'Last'], stopped.map((s, i) => [`${esc(s.ip)}${s.agent ? `<br><small>${esc(s.agent)}${BOT_AGENT.test(s.agent) ? ' (bot)' : ''}</small>` : ''}`, esc(own[i] || (isIPv4(s.ip) ? 'not named' : 'IPv6 range, not named')), esc(countryName(country(s.ip.replace(/\/\d+$/, '')))), s.pages, esc(dDay(s.last))]), 'No computer stopped this week.'), { id: 'bots' })}
${fold('Disk and backups', 'database', `${disk ? `${esc(size(disk.free))} free` : 'Disk not known'} · ${backups[0] ? `newest backup ${esc(at(backups[0][2]))}` : red('no backups')}`, table(['What', 'Now'], [['Database', esc(size(dbSize))], ['Disk free', disk ? `${esc(size(disk.free))} of ${esc(size(disk.total))}` : 'Not known'], ...backups.map(([f, sz, t]) => [esc(f), `${esc(size(sz))}, made ${esc(at(t))}`])]), { open: by.disk.state === 'bad' || by.backups.state === 'bad', id: 'disk' })}
${note('Countries: <a href="https://db-ip.com">IP Geolocation by DB-IP</a> (CC BY 4.0). Page errors on the website are not recorded yet.')}`;
  return shell(db, 'Health', '/health', body, token);
}

// The pages, by route. Each returns HTML, or null for "Not found". Visitors is async (reverse DNS).
export const PAGES_BY_ROUTE = {
  '/admin': today, '/admin/people': people, '/admin/people/:id': person, '/admin/people/:id/delete': deletePage, '/admin/money': moneyPage,
  '/admin/growth': growth, '/admin/interest': interest, '/admin/health': health,
};
// Old addresses from step 2.
export const MOVED = { '/admin/accounts': '/admin/people', '/admin/accounts/:id': '/admin/people/:id', '/admin/inbox': '/admin', '/admin/system': '/admin/health', '/admin/emails': '/admin/health', '/admin/visitors': '/admin/growth', '/admin/usage': '/admin/interest' };
