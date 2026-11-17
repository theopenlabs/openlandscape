// Checks the email rules on a throwaway database (spec 17): who gets each email, the Monday window (a change is never in two
// Mondays), one event once, drug and company follows, the welcome once, big news at most once a week and never naming the drug,
// a plain-text version and an unsubscribe on every email.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-digest-'), 'test.db');
process.env.PUBLIC_URL = 'https://openlandscape.test';
delete process.env.RESEND_API_KEY; delete process.env.TODAY;
const { getDb } = await import('../src/db.js');
const D = await import('../src/digest.js');
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const log = console.log; const quiet = async f => { console.log = () => {}; try { return await f(); } finally { console.log = log; } };
const at = async (day, f) => { process.env.TODAY = day; try { return await f(); } finally { delete process.env.TODAY; } };

// A stand-in for the query module: changes and dates per area, as Q.changes and Q.catalysts return them.
const ev = (area, date, drug, kind, text, more = {}) => ({ area, date, drug, kind, text, url: `https://src.test/${drug}/${date}`, reviewed: true, label: date, ...more });
let EVENTS = [], COMING = [];
const source = {
  changes: ({ area, since }) => ({ items: EVENTS.filter(e => e.area === area && e.date >= since && e.date <= (process.env.TODAY || '9999')).map(({ area: _a, ...e }) => e), small_date_moves: [], other_filings: [] }),
  catalysts: ({ area }) => ({ catalysts: COMING.filter(c => c.area === area) }),
  landscape: ({ area, phase_min }) => ({ area, phase_min, stats: { programs: 52, companies: 32, by_phase: [{ level: 5, name: 'Approved', count: 2 }, { level: 3, name: 'Phase 3', count: 17 }, { level: 2, name: 'Phase 2', count: 33 }] } }),
};

const db = getDb();
const user = (email, plan = 'free') => { db.prepare('INSERT INTO user (email, plan) VALUES (?,?)').run(email, plan); return db.prepare('SELECT * FROM user WHERE email=?').get(email); };
const follow = (u, q, created = '2026-10-01 09:00:00') => db.prepare('INSERT INTO saved_landscape (user_id, query, phase_min, created_at) VALUES (?,?,2,?)').run(u.id, q, created);
const a = user('a@x.test', 'solo'), b = user('b@x.test', 'solo'), c = user('c@x.test', 'solo'), f = user('f@x.test'), g = user('g@x.test');
follow(a, 'obesity'); follow(a, 'heart failure'); follow(b, 'obesity'); follow(g, 'obesity');

ok(D.weekOf(new Date('2026-11-09')) === '2026-W46' && D.weekOf(new Date('2026-11-06')) === '2026-W45', 'ISO week labels');

// ---- who gets the Monday email ----
EVENTS = [ev('obesity', '2026-11-01', 'orforglipron', 'opinion', 'CHMP positive opinion: Foundayo (Orforglipron)', { region: 'EU', agency: 'EMA' })];
delete process.env.DIGEST_TO;
ok((await quiet(() => at('2026-11-02', () => D.runDigest({ source })))).sent === 0, 'DIGEST_TO unset: nobody is emailed');
process.env.DIGEST_TO = 'a@x.test,g@x.test';
ok((await quiet(() => at('2026-11-02', () => D.runDigest({ source })))).sent === 1, 'DIGEST_TO list: only those addresses, and Free (g, with a landscape) gets no Monday email');
ok((await quiet(() => at('2026-11-02', () => D.runDigest({ source })))).sent === 0, 'second run in the same week sends nothing');
process.env.DIGEST_TO = 'all';
ok((await quiet(() => at('2026-11-02', () => D.runDigest({ source })))).sent === 1, 'all: b (Solo) gets it; c follows nothing and has no watchlist, so gets none');
db.prepare('UPDATE user SET digest_off=1 WHERE id=?').run(b.id); db.prepare('DELETE FROM digest_log WHERE user_id=?').run(b.id);
ok((await quiet(() => at('2026-11-02', () => D.runDigest({ source })))).sent === 0, 'unsubscribed Solo user is skipped');

// ---- the window: no change in two Mondays, and a change loaded late is not lost ----
// Monday 2 Nov went to a, with the 1 Nov change in it. The 2 Nov change below was loaded only after that email was sent.
EVENTS.push(ev('obesity', '2026-11-02', 'retatrutide', 'new_trial', 'New PHASE3 trial registered'), ev('obesity', '2026-11-05', 'cagrisema', 'approval', 'FDA approval: CAGRISEMA (cagrisema)', { region: 'US', agency: 'FDA' }));
const m2 = await at('2026-11-09', () => D.buildDigest(db.prepare('SELECT * FROM user WHERE id=?').get(a.id), { source }));
ok(!m2.text.includes('Orforglipron'), 'Monday 9 Nov: the 1 Nov change, inside the window again but sent on 2 Nov, is not sent again');
ok(m2.text.includes('Retatrutide') && m2.text.includes('Cagrisema'), 'Monday 9 Nov: the 2 Nov change loaded after the last email, and the 5 Nov one, are both in');
ok(m2.subject.startsWith('Cagrisema approved by the FDA'), `subject names the biggest news (${m2.subject})`);
// Edge of the old window: a change dated on the Monday itself is in that Monday's email and never in the next.
process.env.DIGEST_TO = 'a@x.test';
await quiet(() => at('2026-11-09', () => D.runDigest({ source })));
EVENTS.push(ev('obesity', '2026-11-16', 'survodutide', 'approval', 'FDA approval: SURVO (survodutide)', { region: 'US', agency: 'FDA' }));
const m3 = await at('2026-11-16', () => D.buildDigest(db.prepare('SELECT * FROM user WHERE id=?').get(a.id), { source }));
ok(!/Retatrutide|Cagrisema|Orforglipron/.test(m3.text) && m3.text.includes('Survodutide'), 'Monday 16 Nov: only the new change; nothing from 2 or 9 Nov repeats');
ok(db.prepare('SELECT count(*) FROM digest_item WHERE user_id=?').pluck().get(a.id) === 3, 'each sent row is remembered once (3 rows over two emails)');

// ---- one event once: in two landscapes and a followed drug, one row naming all three ----
const both = ev('obesity', '2026-11-20', 'tirzepatide', 'approval', 'FDA approval of a new use: ZEPBOUND (tirzepatide)', { region: 'US', agency: 'FDA' });
EVENTS.push(both, { ...both, area: 'heart failure' }, { ...both, area: 'tirzepatide' });
COMING = [{ area: 'obesity', date: '2026-11-26', drug: 'orforglipron', what: 'US FDA decision (PDUFA date) on the NDA for obesity', source: 'https://src.test/pdufa', kind: 'news', reviewed: true },
  { area: 'heart failure', date: '2026-11-26', drug: 'orforglipron', what: 'US FDA decision (PDUFA date) on the NDA for obesity', source: 'https://src.test/pdufa', kind: 'news', reviewed: true },
  ...[24, 25, 27, 28, 29, 30].map(d => ({ area: 'obesity', date: `2026-11-${d}`, drug: `drug${d}`, what: 'Primary completion, Phase 2', source: 'https://src.test/' + d, kind: 'registry', reviewed: d !== 24 }))];
const followDrug = (u, name) => db.prepare("INSERT INTO saved_landscape (user_id, query, phase_min, kind, ref, created_at) VALUES (?,?,1,'drug',?,'2026-10-01 09:00:00')").run(u.id, name, name);
followDrug(a, 'tirzepatide');
const m4 = await at('2026-11-23', () => D.buildDigest(db.prepare('SELECT * FROM user WHERE id=?').get(a.id), { source }));
ok((m4.text.match(/Tirzepatide approved/g) || []).length === 1, 'one event in two landscapes and a followed drug is one row');
ok(m4.text.includes('Obesity, Heart failure, Tirzepatide · Zepbound'), 'its grey line names both landscapes and the drug');
ok(m4.text.includes('for obesity, heart failure and tirzepatide.'), 'sub-line names what is followed: "for obesity, heart failure and tirzepatide"');
ok(m4.text.includes('Open OpenLandscape: ') && !/landscapes/.test(m4.text), 'more than one follow: "Open OpenLandscape", and no "your landscapes" anywhere');
ok((m4.text.match(/Orforglipron FDA decision on obesity/g) || []).length === 1, 'one date in two landscapes is one Coming up row');
const up = m4.text.split('COMING UP')[1].split('Open OpenLandscape')[0];
ok((up.match(/^\d+ Nov/gm) || []).length === 5 && up.includes('FDA decision'), 'Coming up: 5 dates, the FDA date always among them');
ok(m4.text.includes('Drug24 Phase 2 trial completes\n        Obesity\n') && !m4.text.includes('Unverified'), 'an unchecked row has no "Unverified" tag (step 10)');
followDrug(c, 'tirzepatide');
const wo = await at('2026-11-23', () => D.buildDigest(c, { source }));
ok(wo && wo.text.includes('for tirzepatide.') && wo.text.includes('Open tirzepatide: https://'), 'a Solo account following only a drug gets the email, named, and its button opens the drug');
ok(m4.text.includes('Feynman OÜ, Sepapaja tn 6') && m4.html.includes('Feynman OÜ<br>Sepapaja tn 6'), 'the sender and postal address in the footer');

// ---- quiet week ----
const q = await at('2026-11-30', () => D.buildDigest(db.prepare('SELECT * FROM user WHERE id=?').get(b.id), { source }));
ok(q.subject.startsWith('Nothing new this week'), `quiet week is still built, subject "${q.subject}"`);

// ---- the welcome: once, for a landscape opened in the last 2 days ----
db.prepare("INSERT INTO usage (user_id, kind, detail, at) VALUES (?, 'landscape', 'heart failure', '2026-11-20 10:00:00')").run(f.id);
const w = await at('2026-11-21', () => D.buildWelcome(f, { source }));
ok(w.subject === 'Heart failure: 52 drugs, and what is coming' && w.html.includes('Here’s heart failure, as of today.') && !w.html.includes('Welcome.'), 'welcome: subject and headline');
ok(w.html.includes('/img/ridge.gif?a=heart%20failure&amp;p=2') && w.html.includes('>33</div>'), 'welcome: ridge image and the count under each peak');
ok(!w.text.includes('we write to you on Mondays'), 'welcome on Free does not promise the Monday email');
ok(w.html.includes('this email is the only time you’ll see what changed') && w.html.includes('>Choose the Solo plan</a>') && w.text.includes('Choose the Solo plan: https://openlandscape.test/pricing'), 'welcome on Free says plainly it is the only time, with the Solo plan as its button');
// ---- hello: everyone, once, at sign-up (step 12) ----
const h = await at('2026-11-21', () => D.buildHello(f, { source }));
ok(h.subject === 'Welcome to OpenLandscape' && h.html.includes('Welcome to OpenLandscape.') && h.html.includes('>Pick your free landscape</a>'), 'hello: subject, headline and button');
ok(['Heart%20failure', 'KRAS'].every(q => h.html.includes(`/welcome?q=${q}`)) && /Heart failure  Disease · \d+ drugs? in Phase 2 or later/.test(h.text), 'hello: the four examples link to onboarding, with their counts');
ok(h.html.includes('/unsubscribe/all?t=') && !h.html.includes('We send this once'), 'hello: unsubscribe from everything, no line about when it is sent');
delete process.env.DIGEST_TO;
ok((await quiet(() => D.sendHello(f, { source }))) === false, 'hello: DIGEST_TO unset, nobody is emailed');
process.env.DIGEST_TO = 'f@x.test';
ok((await quiet(() => D.sendHello(f, { source }))) === true && (await quiet(() => D.sendHello(f, { source }))) === false, 'hello: sent once, never again');
ok(db.prepare("SELECT count(*) FROM mail_log WHERE user_id=? AND kind='hello'").pluck().get(f.id) === 1, 'hello: logged once');
ok((await quiet(() => at('2026-11-21', () => D.runWelcome({ source })))).sent === 1, 'welcome sent once when the landscape is opened');
ok((await quiet(() => at('2026-11-21', () => D.runWelcome({ source })))).sent === 0, '...and never again');
process.env.DIGEST_TO = 'a@x.test';
ok((await quiet(() => at('2026-11-21', () => D.runWelcome({ source })))).sent === 0, 'no welcome for a landscape opened weeks ago (a, followed 1 Oct)');

// ---- big news on Free: FDA or EMA decisions only, at most one a week, never the drug ----
process.env.DIGEST_TO = 'all';
EVENTS = [ev('heart failure', '2026-11-26', 'finerenone', 'approval', 'FDA approval of a new use: KERENDIA (finerenone)', { region: 'US', agency: 'FDA' }),
  ev('heart failure', '2026-11-27', 'acme-1', 'new_trial', 'New PHASE3 trial registered'),
  ev('heart failure', '2026-11-28', 'vericiguat', 'opinion', 'CHMP positive opinion: Verquvo (vericiguat)', { region: 'EU', agency: 'EMA' })];
const sentNews = D.buildNews(f, await at('2026-11-26', () => D.newsDue(f, { source })));
ok(!/finerenone|kerendia|approv/i.test(sentNews.html + sentNews.text) && sentNews.subject === 'An FDA decision in heart failure', 'big news names the FDA and the landscape, never the drug or the decision');
ok((await quiet(() => at('2026-11-26', () => D.runNews({ source })))).sent === 1, 'big news: sent for an FDA decision in the free landscape (Solo users get none)');
ok((await quiet(() => at('2026-11-28', () => D.runNews({ source })))).sent === 0, 'a second decision two days later waits: at most one a week');
ok((await quiet(() => at('2026-12-02', () => D.runNews({ source })))).sent === 0, '...still waiting six days after');
const n3 = await quiet(() => at('2026-12-03', () => D.runNews({ source })));
ok(n3.sent === 1, 'seven days after the last, the waiting EMA decision goes');
ok((await quiet(() => at('2026-12-10', () => D.runNews({ source })))).sent === 0, 'nothing new a week later: nothing sent, and nothing told twice');
EVENTS = [ev('heart failure', '2026-12-11', 'acme-2', 'withdrawal', 'EU application withdrawn: X', { region: 'EU' }), ev('heart failure', '2026-12-11', 'acme-3', 'delay', 'US review extended', { region: 'US' })];
ok((await quiet(() => at('2026-12-12', () => D.runNews({ source })))).sent === 0, 'withdrawals and review delays are not regulator decisions: no big news');

// ---- every email: plain text, and one-click unsubscribe ----
for (const [name, e, list] of [['Monday', m4, '/unsubscribe?t='], ['welcome', w, '/unsubscribe/all?t='], ['big news', sentNews, '/unsubscribe/news?t=']])
  ok(e.text.length > 100 && e.html.includes(e.unsubscribeUrl) && e.text.includes(e.unsubscribeUrl) && e.unsubscribeUrl.includes(list), `${name}: plain-text version, and its own unsubscribe link in both`);
const express = (await import('express')).default;
const app = express(); app.use(express.urlencoded({ extended: false })); app.use(D.mailRouter());
const srv = app.listen(0); const port = srv.address().port;
const t = db.prepare('SELECT digest_token FROM user WHERE id=?').pluck().get(f.id);
await fetch(`http://localhost:${port}/unsubscribe/news?t=${t}`, { method: 'POST' });
ok(db.prepare('SELECT news_off, digest_off FROM user WHERE id=?').get(f.id).news_off === 1, 'one-click unsubscribe from big news (POST) turns it off, and only it');
ok((await (await fetch(`http://localhost:${port}/unsubscribe/news?t=nope`)).text()).includes('did not work'), 'an unknown unsubscribe link says so');
await fetch(`http://localhost:${port}/unsubscribe/all?t=${db.prepare('SELECT digest_token FROM user WHERE id=?').pluck().get(a.id)}`, { method: 'POST' });
ok(db.prepare('SELECT news_off, digest_off FROM user WHERE id=?').get(a.id).digest_off === 1, 'unsubscribe from the welcome stops every email');
// Step 9: opening the link only asks (work mail opens every link to check it); the page's button does it, and can undo it.
const ta = db.prepare('SELECT digest_token FROM user WHERE id=?').pluck().get(a.id);
db.prepare('UPDATE user SET digest_off=0 WHERE id=?').run(a.id);
const asked = await (await fetch(`http://localhost:${port}/unsubscribe?t=${ta}`)).text();
ok(asked.includes('Stop the Monday email?') && db.prepare('SELECT digest_off FROM user WHERE id=?').pluck().get(a.id) === 0, 'opening the Monday unsubscribe link asks and changes nothing');
const form = body => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
const done = await (await fetch(`http://localhost:${port}/unsubscribe?t=${ta}`, form('page=1'))).text();
ok(done.includes('Monday email any more') && done.includes('back on') && db.prepare('SELECT digest_off FROM user WHERE id=?').pluck().get(a.id) === 1, 'the page button stops it and offers the way back');
const back = await (await fetch(`http://localhost:${port}/unsubscribe?t=${ta}`, form('page=1&undo=1'))).text();
ok(back.includes('back on') && db.prepare('SELECT digest_off FROM user WHERE id=?').pluck().get(a.id) === 0, 'turning it back on works');
srv.close();
