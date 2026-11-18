// The admin dashboard, on a throwaway database with a few rows of each kind: the pages (Today, People,
// one person, Growth, Interest, Money, Health) and the actions (done, give Solo free, emails off, sign out everywhere,
// delete). Only an admin (signed-in email in ADMIN_EMAILS, or a script with the token in an Authorization header) sees or uses them; anyone else gets "Not found"; never indexed.
// Also the country lookup (src/country.js) and that a counted page keeps the country but not the address.
import { tempDir } from './tmp.js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const PORT = 8000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH = join(tempDir('ol-adminpages-'), 'test.db');
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const { getDb } = await import('../src/db.js');
const { country } = await import('../src/country.js');
const V = await import('../src/visits.js');
const ADM = await import('../src/admin.js');

// ---- country ----
ok(country('8.8.8.8') === 'US' && country('::ffff:81.2.69.142') === 'GB' && country('2a00:1450:4001:81b::200e') === 'DE', 'addresses give their country (IPv4, mapped IPv4, IPv6)');
ok(country('10.0.0.1') === '' && country('::1') === '' && country('nonsense') === '', 'private or bad addresses: no country');
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const db = getDb();
V.recordView({ p: '/pricing', r: 'https://www.linkedin.com/' }, { ip: '81.2.69.142', ua: CHROME, host: 'openlandscape.app' });
V.recordView({ p: '/', v: 'li-dm' }, { ip: '81.2.69.143', ua: CHROME, host: 'openlandscape.app' });
const v = db.prepare('SELECT * FROM page_view').get();
ok(v.country === 'GB' && !JSON.stringify(v).includes('81.2.69.142'), 'a counted page keeps the country, not the address');

// ---- a little of everything ----
const run = (sql, ...a) => db.prepare(sql).run(...a);
run("INSERT INTO user (email, plan, founding, came_from, first_ref, first_page, last_seen, stripe_customer) VALUES ('admin@x.test','free',0,'signin','direct','/',datetime('now'),NULL)");
const payer = run("INSERT INTO user (email, plan, founding, came_from, first_ref, first_page, last_seen, stripe_customer, digest_off) VALUES ('payer@x.test','solo',1,'follow:drug','google.com','/drugs/tirzepatide',datetime('now'),'cus_T1',1)").lastInsertRowid;
run("INSERT INTO payment (user_id, email, plan, amount, currency, stripe_session, livemode) VALUES (?, 'payer@x.test', 'solo', 4900, 'usd', 'cs_1', 1)", payer);
run("INSERT INTO payment (email, plan, amount, currency, stripe_session, livemode, created_at) VALUES ('order@x.test', 'custom_landscape', 150000, 'usd', 'cs_2', 1, datetime('now','-50 hours'))");
run("INSERT INTO usage (user_id, kind, detail) VALUES (?, 'search', 'obesity'), (?, 'search_none', 'zzqx'), (?, 'landscape', 'NASH'), (?, 'drugs_stopped', '12 new'), (?, 'mcp', 'search_drugs {}')", payer, payer, payer, payer, payer);
run("INSERT INTO saved_landscape (user_id, query) VALUES (?, 'obesity')", payer);
run("INSERT INTO mail_log (user_id, kind, day) VALUES (?, 'welcome', date('now'))", payer);
run("INSERT INTO digest_log (user_id, week, changes, sent_at) VALUES (?, '2026-W46', 4, date('now'))", payer);
run("INSERT INTO area_request (email, area, page, message, company, created_at) VALUES ('ask@x.test', 'Talk to us', 'talk', 'Do you cover <b>China</b>?', 'Acme', datetime('now','-3 days'))");
run("INSERT INTO area_request (email, area, role, page) VALUES ('req@x.test', 'Myasthenia gravis', 'CI', 'landscape'), ('wait@x.test', 'Team', 'BD', 'team-waitlist')");
run("INSERT INTO billing_event (kind, email, customer, amount, currency, detail, stripe_id) VALUES ('payment_failed', 'payer@x.test', 'cus_T1', 4900, 'usd', 'A payment failed.', 'evt_1')");
run("INSERT INTO visitor_day (day, ip, pages, stopped, agent) VALUES (date('now'), '127.0.0.1', 200, 30, 'Scrapy/2.11')");
run("INSERT INTO job_run (name, started_at, finished_at, ok, code, mailed) VALUES ('ema', datetime('now'), datetime('now'), 0, 1, 1), ('fetch', datetime('now'), datetime('now'), 1, 0, 1)");
run("INSERT INTO match_candidate (type, left_id, right_id, score) VALUES ('study', 'a', 'b', 0.8)");
run("INSERT INTO meta (k, v) VALUES ('trials_loaded_at', '2026-11-10T14:06:43Z')");
run("INSERT INTO mail_fail (user_id, email, kind, subject, error) VALUES (?, 'payer@x.test', 'welcome', 'Welcome', 'Email failed: 422 mailbox full')", payer);
run("INSERT INTO user (email, plan, first_ref, first_page) VALUES ('tagged@x.test', 'free', 'via:li-dm', '/')");
const leftId = run("INSERT INTO user (email, plan, came_from, first_ref) VALUES ('left@x.test', 'free', 'pricing', 'google.com')").lastInsertRowid;
run("INSERT INTO usage (user_id, kind, detail) VALUES (?, 'checkout', '/pricing'), (?, 'landscape', 'obesity')", leftId, leftId);
const nearId = run("INSERT INTO user (email, plan) VALUES ('near@x.test', 'free')").lastInsertRowid;
run("INSERT INTO usage (user_id, kind, detail) VALUES (?, 'drugs_stopped', '3 new'), (?, 'checkout', '/pricing')", nearId, nearId);
const session = 'admin-session-secret';
run("INSERT INTO session (token_hash, user_id, expires_at) VALUES (?, 1, datetime('now','+1 day'))", createHash('sha256').update(session).digest('hex'));

// ---- the server ----
const env = { ...process.env, PORT, DB_PATH, PUBLIC_URL: '', DASHBOARD_URL: '', COOKIE_DOMAIN: '', NODE_ENV: 'test', RESEND_API_KEY: '', DIGEST_TO: '',
  ADMIN_TOKEN: 't0k-0123456789-0123456789-0123456789', ADMIN_EMAILS: 'someone@else.test, Admin@x.test' };
const srv = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
await new Promise((res, fail) => { srv.stdout.on('data', () => /running on/.test(log) && res()); srv.on('exit', c => fail(new Error('server exited ' + c))); });
const get = (path, opts = {}) => fetch(BASE + path, { redirect: 'manual', ...opts });
const asAdmin = path => get(path, { headers: { cookie: `op_session=${session}` } });

try {
  const pages = {
    '/admin': ['Today', 'Needs you', 'Founding places', 'Data update failing: EMA decisions', 'Data update failing</p>', 'Do you cover &lt;b&gt;China&lt;/b&gt;?', 'Myasthenia gravis', 'wait@x.test',
      'h late', 'Delivered', 'Payment failed', 'name="how" value="ignore"', 'Test account<small>', 'Last 14 days', 'mailto:ask@x.test', 'dashboard.stripe.com/customers/cus_T1', '1 email did not send since yesterday', 'Welcome to payer@x.test', 'See Health',
      'Left at checkout', 'left@x.test</a> pressed Choose Solo today and did not pay.', 'Joined today through Google. Used Obesity.', 'Near the allowance', 'near@x.test</a> reached the 500 free drugs', 'Also opened checkout today', 'mailto:left@x.test?subject=Solo'],
    '/admin/people': ['payer@x.test', 'Solo, early customer', 'from google.com', 'from link tagged li-dm', 'payment failed', 'Find by email'],
    '/admin/money': ['$49', 'Founding places', 'Payment failed', 'dashboard.stripe.com/customers/cus_T1'],
    '/admin/growth': ['Visited', 'Signed up', 'Used it', 'Came back', 'Checkout', 'Paid', 'visits brought', 'New people this week', 'payer@x.test', 'Drug: Tirzepatide',
      'Visits each day', 'Where they came from', 'LinkedIn', 'Link tagged li-dm', 'tagged@x.test', 'Where they landed', 'Pricing', 'United Kingdom', 'Phone or computer', 'Emails and what came of them', 'Monday email', 'Gone quiet', 'data-s="'],
    '/admin/interest': ['Searched and found nothing', 'zzqx', 'not sorted yet', 'Most active people', 'payer@x.test', 'Landscapes opened', 'NASH', 'Drugs looked at',
      'Searches that found something', 'obesity', 'What AI apps asked', '<details class="bd">'],
    '/admin/health': ['things need a look', 'EMA decisions failing', 'Failed (exit code 1)', '1 email did not send', 'mailbox full', 'Welcome', 'Monday email',
      'ClinicalTrials.gov loaded', 'Database', 'Bots and scrapers', 'Scrapy/2.11', 'class="hdot bad"', '<details class="box fold" open id="steps">'],
  };
  for (const [path, words] of Object.entries(pages)) {
    const r = await asAdmin(path), t = await r.text(), missing = words.filter(w => !t.includes(w));
    ok(r.status === 200 && t.includes('<meta name="robots" content="noindex,nofollow">') && r.headers.get('x-robots-tag') === 'noindex' && !missing.length,
      `${path}: opens for the admin account, not indexed${missing.length ? ` (missing: ${missing.join(' | ')})` : ''}`);
    ok(t.includes('class="app"') && t.includes('aside class="side"') && t.includes('class="menubtn"') && t.includes('panel on ds adm') && !t.includes("fetch('/v'"), `${path}: in the dashboard frame with the phone menu, not counted as a visit`);
  }
  const acct = await (await asAdmin(`/admin/people/${payer}`)).text();
  ok(['Joined', 'follows obesity', 'paid $49 in all', 'paid in Stripe', 'Searched', 'Stopped by the drug allowance', 'Welcome', 'Turn all off', 'Delete'].every(w => acct.includes(w)), 'one person: the sentence, the account, what they did');
  ok((await asAdmin('/admin/people/99999')).status === 404, 'a person who does not exist: Not found');
  const found = await (await asAdmin('/admin/people?q=payer')).text();
  ok(found.includes('payer@x.test') && !found.includes('admin@x.test</a>'), 'people: find by email');
  ok((await get('/admin/money?token=t0k-0123456789-0123456789-0123456789')).status === 404, 'the right token in the address (?token=) no longer opens admin');
  ok(!(await (await get('/admin/money', { headers: { authorization: 'Bearer t0k-0123456789-0123456789-0123456789' } })).text()).includes('token='), 'opened with the header: no token written into links');
  for (const [from, to] of [['/admin/accounts?q=x', '/admin/people?q=x'], [`/admin/accounts/${payer}`, `/admin/people/${payer}`], ['/admin/inbox', '/admin'], ['/admin/system', '/admin/health'], ['/admin/emails', '/admin/health'], ['/admin/visitors?days=7', '/admin/growth?days=7'], ['/admin/usage', '/admin/interest']]) {
    const r = await asAdmin(from);
    ok(r.status === 301 && r.headers.get('location') === to, `${from} moved to ${to}`);
  }

  for (const path of [...Object.keys(pages), `/admin/people/${payer}`, `/admin/people/${payer}/delete`, '/admin/accounts']) {
    const r = await get(path);
    ok(r.status === 404 && (await r.text()) === 'Not found', `${path}: signed out, Not found`);
  }
  const other = run("INSERT INTO user (email) VALUES ('nobody@x.test')").lastInsertRowid;
  run("INSERT INTO session (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now','+1 day'))", createHash('sha256').update('other-session').digest('hex'), other);
  ok((await get('/admin', { headers: { cookie: 'op_session=other-session' } })).status === 404, 'signed in, but not an admin: Not found');
  ok((await get('/admin?token=wrong')).status === 404, 'a wrong token: Not found');
  ok((await get('/admin/metrics', { headers: { authorization: 'Bearer t0k-0123456789-0123456789-0123456789' } })).status === 200, 'the token in an Authorization header works');
  ok((await get('/admin', { headers: { authorization: 'Bearer wrong' } })).status === 404, 'a wrong token in the header: Not found');

  // ---- the actions ----
  const post = (path, form, cookie = `op_session=${session}`, extra = {}) => get(path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams(form).toString() });
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  ok((await post(`/admin/people/${other}/emails-off`, {}, 'op_session=other-session')).status === 404 && !row('SELECT digest_off FROM user WHERE id=?', other).digest_off, 'an action by someone not an admin: Not found, nothing changes');
  ok((await post(`/admin/people/${other}/emails-off`, {}, `op_session=${session}`, { 'sec-fetch-site': 'cross-site' })).status === 404, 'an action sent from another site: refused');
  const talk = row("SELECT id FROM area_request WHERE page='talk'").id;
  let r = await post(`/admin/done/request/${talk}`, { note: 'Answered: yes, China from January' });
  ok(r.status === 303 && r.headers.get('location') === '/admin?ok=done' && row('SELECT done_note FROM area_request WHERE id=?', talk).done_note === 'Answered: yes, China from January' && row('SELECT done_at FROM area_request WHERE id=?', talk).done_at, 'Done on a Talk to us message: marked, with its note');
  const order = row("SELECT id FROM payment WHERE plan LIKE 'custom%'").id;
  await post(`/admin/done/order/${order}`, {});
  ok(row('SELECT delivered_at FROM payment WHERE id=?', order).delivered_at, 'Delivered on a custom order: marked');
  const bill = row('SELECT id FROM billing_event').id;
  await post(`/admin/done/billing/${bill}`, { note: 'Card updated' });
  const t = await (await asAdmin('/admin?done=1')).text();
  ok(!t.includes('Do you cover') && !t.includes('h late') && t.includes('Done lately') && t.includes('Answered: yes, China from January') && t.includes('Card updated'), 'done items leave Needs you and show under Done lately with their notes');
  ok((await post('/admin/done/nonsense/1', {})).status === 404, 'done on something unknown: Not found');
  ok((await (await asAdmin('/admin')).text()).split('near@x.test</a>').length === 2, 'someone near the allowance who also left checkout: one row, not two');
  await post(`/admin/done/checkout/${leftId}`, { note: 'Wrote about Solo' });
  await post(`/admin/done/allowance/${nearId}`, {});
  const t2 = await (await asAdmin('/admin?done=1')).text();
  ok(!t2.includes('left@x.test</a> pressed') && !t2.includes('near@x.test</a> reached') && t2.includes('Left at checkout: ') && t2.includes('Wrote about Solo'), 'Done on Left at checkout and Near the allowance: gone from Needs you, under Done lately');
  run("INSERT INTO usage (user_id, kind, detail, at) VALUES (?, 'checkout', '/pricing', datetime('now','+1 minute'))", leftId);
  ok((await (await asAdmin('/admin')).text()).includes('left@x.test</a> pressed Choose Solo 2 times'), 'pressing Choose Solo again after Done: back on Needs you');
  ok((await post('/admin/done/checkout/99999', {})).status === 404, 'done on someone who does not exist: Not found');

  // ---- Ignore (every row's menu), one row per person, test accounts, Review ----
  const req = row("SELECT id FROM area_request WHERE page='landscape'").id;
  r = await post(`/admin/done/request/${req}`, { how: 'ignore' });
  const t3 = await (await asAdmin('/admin?done=1')).text();
  ok(r.headers.get('location') === '/admin?ok=ignored' && !t3.includes('"Myasthenia gravis"') && row('SELECT done_note FROM area_request WHERE id=?', req).done_note === 'Ignored' && t3.includes('Ignored'), 'Ignore: gone from Needs you, shown as Ignored under Done lately');
  run("INSERT INTO area_request (email, area, role, page) VALUES ('left@x.test', 'Team', 'BD', 'team-waitlist')");
  const t4 = await (await asAdmin('/admin')).text();
  ok(t4.split('left@x.test</a>').length === 2 && t4.includes('Also on the Team waitlist'), 'someone who left checkout and is on the Team waitlist: one row that says both');
  await post(`/admin/done/checkout/${leftId}`, { also: String(row("SELECT id FROM area_request WHERE email='left@x.test'").id) });
  ok(row("SELECT done_at FROM area_request WHERE email='left@x.test'").done_at, 'Done on that row handles the waitlist request too');
  run("INSERT INTO usage (user_id, kind, detail, at) VALUES (?, 'checkout', '/pricing', datetime('now','+2 minutes'))", leftId);
  ok((await asAdmin('/admin').then(x => x.text())).includes('left@x.test</a> pressed'), 'back after pressing Choose Solo again');
  r = await post(`/admin/people/${leftId}/test`, { test: '1' });
  const t5 = await (await asAdmin('/admin')).text();
  ok(r.headers.get('location') === '/admin?ok=test' && row('SELECT test FROM user WHERE id=?', leftId).test === 1 && !t5.includes('left@x.test</a> pressed') && t5.includes('1 test account left out'), 'Test account: gone from Today, named in one grey line');
  const p5 = await (await asAdmin(`/admin/people/${leftId}`)).text();
  ok(p5.includes('Not a test account') && p5.includes('left out of Today and every number'), 'their page says so, with the way back');
  r = await post(`/admin/people/${leftId}/test`, { test: '0', back: 'person' });
  ok(r.headers.get('location') === `/admin/people/${leftId}?ok=untest` && row('SELECT test FROM user WHERE id=?', leftId).test === 0, 'Not a test account: back, from their page');
  ok(!t5.includes('>Review<') || !t5.includes('same-trial'), 'Today does not count same-trial pairs (they never change what customers see)');
  const rv = await (await asAdmin('/admin/review')).text();
  ok(rv.includes('class="side"') && rv.includes('aria-current="page"') && rv.includes('Possibly the same trial') && rv.includes('Twice a week'), 'Review is a page of the admin, with the sidebar, how often, and the same-trial pairs under Not urgent');
  r = await post('/admin/done/review/0', { how: 'ignore' });
  ok(r.headers.get('location') === '/admin?ok=ignored', 'Ignore on the Review row');

  r = await post(`/admin/people/${other}/solo`, { until: '2099-01-01' });
  ok(r.headers.get('location') === `/admin/people/${other}?err=baddate` && row('SELECT plan FROM user WHERE id=?', other).plan === 'free', 'Solo free: a day more than two years away is refused');
  const until = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await post(`/admin/people/${other}/solo`, { until });
  let u = row('SELECT plan, solo_until FROM user WHERE id=?', other);
  ok(u.plan === 'solo' && u.solo_until === until, 'Solo free until a day: Solo now, with its end day');
  ok((await (await asAdmin(`/admin/people/${other}`)).text()).includes('Back to Free now') && !(await (await asAdmin('/admin/money')).text()).includes('1 more on test'), 'shown on the person; not counted as paying');
  ok((await post(`/admin/people/${payer}/solo`, { until })).headers.get('location') === `/admin/people/${payer}?err=paying` && row('SELECT solo_until FROM user WHERE id=?', payer).solo_until === null, 'someone who pays in Stripe: not changed here');
  await post(`/admin/people/${other}/emails-off`, {});
  u = row('SELECT digest_off, news_off FROM user WHERE id=?', other);
  ok(u.digest_off === 1 && u.news_off === 1, 'Turn all off: Monday email and big news off');
  await post(`/admin/people/${other}/signout`, {});
  ok(row('SELECT count(*) AS c FROM session WHERE user_id=?', other).c === 0 && row('SELECT count(*) AS c FROM session WHERE user_id=1').c === 1, 'Sign out everywhere: their sessions are gone, the admin stays signed in');

  // ---- delete: asks twice, removes every table with their account number or email, keeps one line ----
  const gone = run("INSERT INTO user (email, plan) VALUES ('gone@x.test', 'free')").lastInsertRowid;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
  const cols = tb => db.prepare(`PRAGMA table_info(${tb})`).all().map(c => c.name);
  const withUser = tables.filter(tb => cols(tb).includes('user_id')), withEmail = tables.filter(tb => cols(tb).includes('email') && tb !== 'user');
  const missingTables = [...withUser.filter(tb => !ADM.USER_TABLES.includes(tb) && !ADM.KEPT.includes(tb)), ...withEmail.filter(tb => !ADM.EMAIL_TABLES.includes(tb))];
  ok(!missingTables.length && withUser.length >= 12, `every table with a user_id or email column is deleted from${missingTables.length ? ` (not covered: ${missingTables.join(', ')})` : ''}`);
  // one row in each, for them and for someone else, with only the columns that matter filled in
  for (const tb of new Set([...withUser.filter(tb => !ADM.KEPT.includes(tb)), ...withEmail])) {
    const c = cols(tb), notNull = db.prepare(`PRAGMA table_info(${tb})`).all().filter(x => (x.notnull && x.dflt_value == null && !x.pk) || (x.pk && x.name !== 'id')).map(x => x.name);
    for (const [id, email] of [[gone, 'GONE@x.test'], [payer, 'payer@x.test']]) {
      const vals = Object.fromEntries([...new Set([...notNull, ...(c.includes('user_id') ? ['user_id'] : []), ...(c.includes('email') ? ['email'] : [])])].map(k => [k, k === 'user_id' ? id : k === 'email' ? email : `${tb}-${k}-${id}-${Math.random()}`]));
      db.prepare(`INSERT INTO ${tb} (${Object.keys(vals)}) VALUES (${Object.keys(vals).map(() => '?')})`).run(...Object.values(vals));
    }
  }
  const page = await (await asAdmin(`/admin/people/${gone}/delete`)).text();
  ok(page.includes('Type their email') && page.includes('Delete for good'), 'Delete asks first, on a page of its own');
  ok((await post(`/admin/people/${gone}/delete`, { email: 'someone@x.test' })).headers.get('location') === `/admin/people/${gone}/delete?err=wrongemail` && row('SELECT 1 AS x FROM user WHERE id=?', gone), 'the wrong email: nothing deleted');
  ok((await (await asAdmin(`/admin/people/${payer}/delete`)).text()).includes('They pay for Solo') && (await post(`/admin/people/${payer}/delete`, { email: 'payer@x.test' })).headers.get('location').includes('err=paying') && row('SELECT 1 AS x FROM user WHERE id=?', payer), 'someone who pays: cancel in Stripe first, nothing deleted');
  r = await post(`/admin/people/${gone}/delete`, { email: ' Gone@X.test ' });
  ok(r.headers.get('location') === '/admin/people?ok=deleted', 'their email typed: deleted');
  const left = [...withUser.filter(tb => !ADM.KEPT.includes(tb)).filter(tb => db.prepare(`SELECT count(*) FROM ${tb} WHERE user_id=?`).pluck().get(gone)),
    ...withEmail.filter(tb => db.prepare(`SELECT count(*) FROM ${tb} WHERE lower(email)='gone@x.test'`).pluck().get())];
  ok(!left.length && !row('SELECT 1 AS x FROM user WHERE id=?', gone), `nothing of theirs is left${left.length ? ` (still in: ${left.join(', ')})` : ''}`);
  ok(withUser.filter(tb => !ADM.KEPT.includes(tb)).every(tb => db.prepare(`SELECT count(*) FROM ${tb} WHERE user_id=?`).pluck().get(payer)), "someone else's rows stay");
  const rec = db.prepare('SELECT * FROM deleted_account').all();
  ok(rec.length === 1 && rec[0].user_id === gone && rec[0].by === 'admin@x.test' && !JSON.stringify(rec).includes('gone@'), 'one line says an account was deleted, by whom, without their email');

  // ---- Solo given free ends by itself ----
  run("UPDATE user SET solo_until=date('now','-1 day') WHERE id=?", other);
  ok(ADM.endGifts(db) === 1 && row('SELECT plan, solo_until FROM user WHERE id=?', other).plan === 'free', 'the day after its date, Solo given free goes back to Free (hourly timer)');
  ok(ADM.endGifts(db) === 0, 'and only once');

  const m = await (await get('/admin/metrics', { headers: { authorization: 'Bearer t0k-0123456789-0123456789-0123456789' } })).json();
  ok(Array.isArray(m.funnel) && m.funnel.some(f => f.label === 'Follow on a drug page' && f.paid === 1) && m.signups >= 2, '/admin/metrics JSON still has the funnel');
  r = await get('/admin/metrics?view=table&days=7', { headers: { authorization: 'Bearer t0k-0123456789-0123456789-0123456789' } });
  ok(r.status === 302 && r.headers.get('location') === '/admin/growth', 'the old funnel table now opens Growth');
  const g = await (await asAdmin('/admin/growth')).text();
  ok(!g.includes('>admin@x.test</a>'), 'Growth leaves out the admins\' own accounts');
  ok(g.includes('href="/admin/growth?days=30"') && (await (await asAdmin('/admin/growth?days=30')).text()).includes('New people this month'), 'Growth: this week or this month');
  ok((await (await asAdmin('/admin')).text()).includes('<a href="/admin/growth">'), 'Today: New people and Used it link to Growth');
  ok((await get('/admin/review', { headers: { authorization: 'Bearer t0k-0123456789-0123456789-0123456789' } })).status === 200 && (await get('/admin/refund?email=payer@x.test', { headers: { authorization: 'Bearer t0k-0123456789-0123456789-0123456789' } })).status === 200, 'review and refund pages still work');
  ok((await (await get('/privacy')).text()).includes('the country (worked out from your internet address, which is then dropped)'), 'the privacy policy says the country is kept, the address is not');
} finally { srv.kill(); }

// A weak ADMIN_TOKEN (the .env.example placeholder, or short) never opens the admin pages.
for (const weak of ['change-me-to-a-long-random-string', 'short-token']) {
  const port = PORT + 1, s2 = spawn(process.execPath, ['src/server.js'], { env: { ...env, PORT: port, ADMIN_TOKEN: weak }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    let out = '';
    await new Promise((res, fail) => { s2.stdout.on('data', d => { out += d; if (/running on/.test(out)) res(); }); s2.on('exit', c => fail(new Error('server exited ' + c))); });
    ok((await fetch(`http://localhost:${port}/admin`, { redirect: 'manual', headers: { authorization: `Bearer ${weak}` } })).status === 404, `ADMIN_TOKEN "${weak}" is refused`);
  } finally { s2.kill(); }
}
