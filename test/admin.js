// Step 1 of the admin dashboard, on a throwaway database: our own visit counting (no address kept, bots
// dropped, how a new account found us), the bot watch on signed-out pages and its 30 days, the hourly job's failure emails, and
// emails that did not send.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-admin-'), 'test.db');
delete process.env.RESEND_API_KEY;
process.env.CONTACT_EMAIL = 'us@openlandscape.test';
const { getDb } = await import('../src/db.js');
const V = await import('../src/visits.js');
const L = await import('../src/limits.js');
const J = await import('../src/jobrun.js');
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const log = console.log, mails = [];
console.log = (...a) => { if (/^\[dev\] /.test(a[0])) mails.push(a[0]); else log(...a); };

const db = getDb();
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const at = { ip: '203.0.113.7', ua: CHROME, host: 'openlandscape.app', now: new Date('2026-11-17T10:00:00Z') };
const views = () => db.prepare('SELECT * FROM page_view ORDER BY id').all();

// ---- visits ----
ok(V.recordView({ p: '/drugs/semaglutide?q=secret#x', r: 'https://www.linkedin.com/feed/', u: 'newsletter<1>' }, at), 'a page loaded in a browser is counted');
let v = views()[0];
ok(v.path === '/drugs/semaglutide' && v.ref === 'linkedin.com' && v.utm === 'newsletter1' && v.device === 'computer' && v.signed_in === 0 && v.day === '2026-11-17', 'page without what was searched, the sending site, campaign, computer, signed out');
ok(!JSON.stringify(views()).includes('203.0.113.7'), 'the address is not kept');
V.recordView({ p: '/companies/novo', r: 'https://openlandscape.app/drugs/x' }, at);
V.recordView({ p: '/', r: 'https://dashboard.openlandscape.app/app' }, at);
ok(views()[1].ref === '' && views()[2].ref === '', 'our own pages, and the dashboard, are not a sending site');
ok(new Set(views().map(x => x.visitor)).size === 1, 'the same person the same day has one visitor code');
V.recordView({ p: '/' }, { ...at, now: new Date('2026-11-18T10:00:00Z') });
ok(views()[3].visitor !== views()[0].visitor, 'the next day, a new code: it cannot be followed across days');
V.recordView({ p: '/' }, { ...at, ua: IPHONE });
ok(views().at(-1).device === 'phone', 'an iPhone is a phone');
const before = views().length;
for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'GPTBot/1.1', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120', ''])
  V.recordView({ p: '/' }, { ...at, ua });
ok(views().length === before, 'bots, scripts, headless browsers and no browser name are not counted');
ok(!V.recordView({ p: 'https://evil.test/' }, at) && !V.recordView({}, at) && views().length === before, 'no page, or not one of ours: nothing');
ok(V.refHost('javascript:alert(1)') === '' && V.refHost('android-app://com.slack') === '' && V.refHost('https://news.ycombinator.com/item') === 'news.ycombinator.com', 'only web addresses count as a sending site');

// ---- how a new account found us ----
db.prepare("INSERT INTO user (email, created_at) VALUES ('new@x.test', datetime('now')), ('old@x.test', datetime('now','-10 days'))").run();
const [fresh, old] = db.prepare('SELECT * FROM user ORDER BY id').all();
V.recordView({ p: '/app', f: { r: 'https://www.google.com/', p: '/drugs/tirzepatide' } }, { ...at, user: fresh });
let u = db.prepare('SELECT * FROM user WHERE id=?').get(fresh.id);
ok(u.first_ref === 'google.com' && u.first_page === '/drugs/tirzepatide' && views().at(-1).signed_in === 1, 'a new account keeps the site and page that brought it');
V.recordView({ p: '/app', f: { r: 'https://x.com/', p: '/' } }, { ...at, user: u });
ok(db.prepare('SELECT first_ref FROM user WHERE id=?').pluck().get(fresh.id) === 'google.com', 'and keeps the first one');
V.recordView({ p: '/app', f: { r: '', p: '/' } }, { ...at, user: old });
ok(db.prepare('SELECT first_ref FROM user WHERE id=?').pluck().get(old.id) === null, 'an account older than two days is not given one');
db.prepare("INSERT INTO user (email, created_at) VALUES ('direct@x.test', datetime('now'))").run();
V.recordView({ p: '/app', f: { r: '', p: '/pricing' } }, { ...at, user: db.prepare("SELECT * FROM user WHERE email='direct@x.test'").get() });
ok(db.prepare("SELECT first_ref FROM user WHERE email='direct@x.test'").pluck().get() === 'direct', 'typed in or a bookmark: direct');
// ---- link tags (?via=li-dm) ----
ok(V.viaTag('LI-DM') === 'li-dm' && V.viaTag('<script>x</script>') === 'scriptxscript' && V.viaTag('a'.repeat(80)).length === 30 && V.viaTag(null) === '', 'a link tag is short, lowercase, letters, digits and dashes');
V.recordView({ p: '/', v: 'Reddit<1>' }, at);
ok(views().at(-1).via === 'reddit1' && views().at(-1).path === '/', 'a page opened with ?via= keeps the tag');
V.recordView({ p: '/drugs/x' }, at);
ok(views().at(-1).via === '', 'without one: empty');
db.prepare("INSERT INTO user (email, created_at) VALUES ('tagged@x.test', datetime('now'))").run();
V.recordView({ p: '/app', f: { r: 'https://www.linkedin.com/', p: '/', v: 'li-dm' } }, { ...at, user: db.prepare("SELECT * FROM user WHERE email='tagged@x.test'").get() });
ok(db.prepare("SELECT first_ref FROM user WHERE email='tagged@x.test'").pluck().get() === 'via:li-dm', 'a new account that came by a tagged link keeps the tag, over the sending site');
ok(/get\('via'\)/.test(V.visitScript(false)) && /v:v/.test(V.visitScript(false)), 'the script sends the tag and keeps it with the first visit');
ok(/localStorage/.test(V.visitScript(false)) && /var s=1/.test(V.visitScript(true)) && /fetch\('\/v'/.test(V.visitScript(true)), 'every page carries the script; it knows whether the person is signed in');

// ---- bot watch on signed-out pages ----
L.countPage('198.51.100.9', new Date(), 'Scrapy/2.11 (+https://scrapy.org)');
ok(db.prepare("SELECT agent FROM visitor_day WHERE ip='198.51.100.9'").pluck().get() === 'Scrapy/2.11 (+https://scrapy.org)', 'a signed-out page keeps the program name');
db.prepare("INSERT INTO visitor_day (day, ip, pages) VALUES ('2026-01-01', '192.0.2.1', 5), ('2026-11-01', '192.0.2.2', 5)").run();
const gone = V.pruneVisitors(new Date('2026-11-17T12:00:00Z'));
ok(gone === 1 && db.prepare("SELECT count(*) FROM visitor_day WHERE ip='192.0.2.2'").pluck().get() === 1, 'signed-out counts older than 30 days are deleted');

// ---- hourly job ----
J.record('ema', 0); J.record('news', 0);
ok((await J.alertJobs()).length === 0 && mails.length === 0, 'steps that work: no email');
J.record('ema', 1);
let s = await J.alertJobs();
ok(s.join() === 'failed:ema' && /Data update failed: EMA decisions/.test(mails.at(-1)), 'a step that starts failing: one email');
J.record('ema', 1); J.record('ema', 2);
ok((await J.alertJobs()).length === 0, 'still failing: no more emails');
J.record('ema', 0);
s = await J.alertJobs();
ok(s.join() === 'again:ema' && /works again: EMA decisions/.test(mails.at(-1)), 'working again: one email');
J.record('ctis', 1);
ok((await J.alertJobs()).join() === 'failed:ctis', 'a step that fails the first time it ever runs: an email');
ok(db.prepare('SELECT count(*) FROM job_run WHERE mailed IS NULL').pluck().get() === 0, 'every run looked at once');

// ---- emails that do not send are kept (src/mail.js), for Today's notice and Emails ----
const M = await import('../src/mail.js');
const realFetch = globalThis.fetch;
process.env.RESEND_API_KEY = 'test-key';
globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'mailbox full' });
let threw = await M.sendMail({ to: 'new@x.test', subject: 'Your free landscape', html: '', text: '', unsubscribeUrl: 'u', kind: 'welcome' }).then(() => false, () => true);
let f = db.prepare('SELECT * FROM mail_fail ORDER BY id DESC').get();
ok(threw && f.email === 'new@x.test' && f.kind === 'welcome' && f.user_id === fresh.id && /422 mailbox full/.test(f.error), 'an email Resend refuses: kept with who, which email and why, and the error still goes up');
globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.resend.com'); };
threw = await M.sendLoginEmail('someone@x.test', 'https://x/auth/verify?token=secret', '123456').then(() => false, () => true);
f = db.prepare('SELECT * FROM mail_fail ORDER BY id DESC').get();
ok(threw && f.kind === 'signin' && f.subject === 'Sign-in email' && f.user_id === null && !JSON.stringify(f).includes('123456') && !JSON.stringify(f).includes('secret'), 'Resend out of reach: kept too; a sign-in email keeps neither its code nor its link');
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
const before2 = db.prepare('SELECT count(*) FROM mail_fail').pluck().get();
await M.sendMail({ to: 'new@x.test', subject: 'Hi', html: '', text: '', unsubscribeUrl: 'u', kind: 'news' });
ok(db.prepare('SELECT count(*) FROM mail_fail').pluck().get() === before2, 'an email that sends: nothing kept');
globalThis.fetch = realFetch;
delete process.env.RESEND_API_KEY;

console.log = log;
