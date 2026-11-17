// The data limits (src/limits.js) and the weekly watch email (src/watch.js), on a throwaway database.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-limits-'), 'test.db');
delete process.env.RESEND_API_KEY;
const { getDb } = await import('../src/db.js');
const L = await import('../src/limits.js');
const W = await import('../src/watch.js');
const log = console.log, sent = [];
const ok = (cond, msg) => { log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

const quiet = async f => { console.log = (...a) => sent.push(a.join(' ')); try { return await f(); } finally { console.log = log; } };
const ids = (from, n) => Array.from({ length: n }, (_, i) => `d${from + i}`);
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const db = getDb();
db.prepare("INSERT INTO user (email, plan) VALUES ('solo@x.test','solo'), ('free@x.test','free'), ('other@x.test','solo')").run();
const [solo, free, other] = db.prepare('SELECT * FROM user ORDER BY id').all();

// ---- different drugs a day and in 30 days ----
await quiet(async () => {
  ok(L.useDrugs(solo, ids(0, 1400)).ok, 'Solo: 1,400 new drugs open');
  ok(L.drugsUsed(solo.id).day === 1400, 'and are counted');
  ok(L.useDrugs(solo, ids(0, 1400)).ok && L.drugsUsed(solo.id).day === 1400, 'the same drugs again cost nothing');
  const w = L.useDrugs(solo, ids(1400, 200));
  ok(w.ok && /1,600 of 2,000 new drugs used today/.test(w.warn) && w.note.kind === 'warn' && w.note.used === 1600 && w.note.of === 2000, 'a warning at 80% of the day');
  ok(L.drugsUsed(solo.id).day === 1600 && db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='drugs_alert'").pluck().get(solo.id) === 1, 'crossing 1,500 in a day alerts us once');
  const over = L.useDrugs(solo, ids(1600, 500));
  ok(!over.ok && /2,000 new drugs today\./.test(over.msg) && over.note.label === 'New drugs today' && over.note.act === 'talk' && !/UTC/.test(over.msg) && L.drugsUsed(solo.id).day === 1600, 'a list that would pass 2,000 new today is stopped, and nothing of it counted');
  ok(L.useDrugs(solo, ids(1600, 400)).ok, 'exactly 2,000 opens');
  ok(!L.useDrugs(solo, ['one more']).ok, 'then nothing new that day');
  ok(L.useDrugs(solo, ids(5, 50)).ok, 'drugs already seen still open past the allowance');
  ok(L.useDrugs(other, ids(0, 100)).ok, 'another account has its own allowance');
});
// The month: earlier days filled by hand, then today's drugs on top.
db.prepare('DELETE FROM drug_seen WHERE user_id=?').run(solo.id);
const put = db.prepare('INSERT INTO drug_seen VALUES (?,?,?)');
db.transaction(() => { for (let i = 0; i < 2000; i++) { put.run(solo.id, `m${i}`, day(3)); put.run(solo.id, `n${i}`, day(10)); put.run(solo.id, `o${i}`, day(40)); } })();
await quiet(async () => {
  ok(L.drugsUsed(solo.id).month === 4000, 'the month counts the last 30 days only');
  ok(L.useDrugs(solo, ids(0, 1900)).ok, '4,000 in the month plus 1,900 today opens');
  const over = L.useDrugs(solo, ids(5000, 200));
  ok(!over.ok && /6,000 drugs this month\./.test(over.msg) && over.note.when === 'later', 'past 6,000 in 30 days is stopped, and says so');
  ok(L.useDrugs(solo, ['o7']).ok && L.drugsUsed(solo.id).month === 5901, 'a drug last seen 40 days ago counts as new again');
});
// ---- Free: 500 in 30 days ----
await quiet(async () => {
  ok(L.useDrugs(free, ids(0, 450)).ok, 'Free: 450 open');
  const over = L.useDrugs(free, ids(450, 60));
  ok(!over.ok && /500 drugs this month on Free/.test(over.msg) && over.note.act === 'solo', 'Free past 500 is stopped, and offered Solo');
  ok(L.useDrugs(null, ids(0, 9999)).ok, 'no account (open AI mode): nothing counted');
});

// ---- public pages signed out ----
ok(L.ipKey('2001:db8:abcd:12:1:2:3:4') === '2001:db8:abcd:12::/64' && L.ipKey('2001:db8::1') === '2001:db8:0:0::/64', 'IPv6 counts by its /64 block');
ok(L.ipKey('::ffff:10.1.2.3') === '10.1.2.3' && L.ipKey('10.1.2.3') === '10.1.2.3', 'IPv4 as it is');
const t0 = new Date('2026-11-16T09:10:00Z');
let n = 0; while (L.countPage('10.0.0.1', t0) && n < 1000) n++;
ok(n === L.PAGES.hour, `${L.PAGES.hour} pages an hour from one computer`);
let m = 0; for (let h = 10; h < 20; h++) for (let i = 0; i < 60; i++) if (L.countPage('10.0.0.1', new Date(`2026-11-16T${h}:05:00Z`))) m++;
ok(n + m === L.PAGES.day, `${L.PAGES.day} a day`);
ok(L.countPage('10.0.0.1', new Date('2026-11-17T00:05:00Z')), 'and again the next day');
ok(L.countPage('2001:db8:abcd:12::9', t0) && !(() => { for (let i = 0; i < 59; i++) L.countPage(`2001:db8:abcd:12::${i + 10}`, t0); return L.countPage('2001:db8:abcd:12:ffff::1', t0); })(), 'addresses in one IPv6 block share the limit');
ok(!(await L.isSearchBot('Mozilla/5.0 (compatible; Googlebot/2.1)', '10.0.0.1')), 'a script calling itself Googlebot is not let through');
ok(!(await L.isSearchBot('Mozilla/5.0 Chrome', '66.249.66.1')), 'a browser is not a search bot');

// ---- new accounts ----
ok(L.emailKey('Jane.Doe+ol@gmail.com') === 'janedoe@gmail.com' && L.emailKey('jane.doe+x@acme.com') === 'jane.doe@acme.com' && L.emailKey('j.d@googlemail.com') === 'jd@gmail.com', 'the inbox behind an address');
db.prepare("INSERT INTO user (email, plan) VALUES ('jane.doe@gmail.com','free'), ('sam@acme.com','free')").run();
ok(L.signupProblem('janedoe+2@gmail.com', '1.1.1.1') === 'variant' && L.signupProblem('j.a.n.e.doe@googlemail.com', '1.1.1.1') === 'variant', 'Gmail dots and +tags of an account are refused');
ok(L.signupProblem('sam+work@acme.com', '1.1.1.1') === 'variant' && L.signupProblem('s.am@acme.com', '1.1.1.1') === '', '+tags elsewhere too; dots elsewhere are other people');
ok(L.signupProblem('x@mailinator.com', '1.1.1.1') === 'throwaway', 'throwaway domains are refused');
ok(L.signupProblem('jane.doe@gmail.com', '1.1.1.1') === '', 'an existing account always signs in');
const add = db.prepare("INSERT INTO user (email, signup_ip) VALUES (?, ?)");
for (let i = 0; i < 5; i++) add.run(`new${i}@corp.test`, '2.2.2.2');
ok(L.signupProblem('sixth@corp.test', '2.2.2.2') === 'manyaccounts' && L.signupProblem('sixth@corp.test', '3.3.3.3') === '', 'a sixth new account from one computer in a day is refused');
ok(L.signupProblem('', '2.2.2.2') === '', 'no address, no answer (an expired link)');

// ---- the weekly watch ----
const since = day(7);
const busy = W.busyAccounts(since);
ok(busy.length === 1 && busy[0].email === 'solo@x.test' && busy.every(r => r.most >= W.BUSY_DAY), 'the watch names the accounts with a busy day');
const pg = W.pageWeek('2026-11-10');
ok(pg.stopped.some(s => s.ip === '10.0.0.1') && pg.pages > 0, 'and the computers stopped on public pages');
ok(/solo@x\.test \(solo\): 2,000 on their busiest day, stopped on 1 day/.test(W.watchText(busy, pg, since)), 'and says how busy');
const monday = new Date(); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)); monday.setUTCHours(13);
const first = await quiet(() => W.runWatch(monday)), again = await quiet(() => W.runWatch(monday));
ok(first.sent && !again.sent, 'the watch email goes once a week, on Monday afternoon');
ok(!(await W.runWatch(new Date(monday - 864e5))).sent, 'and not on other days');
