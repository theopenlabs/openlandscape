// Checks the upgrade email on a throwaway database: it goes once to someone who had the Free welcome and then pays for
// Solo, never to someone who paid first, never twice (not on a second payment, not when the payment page and Stripe's
// webhook both record the same checkout), and never after "unsubscribe from everything". No real email goes out.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-upgrade-'), 'test.db');
process.env.PUBLIC_URL = 'https://openlandscape.test';
process.env.DIGEST_TO = 'all';
delete process.env.RESEND_API_KEY;
const { getDb } = await import('../src/db.js');
const D = await import('../src/digest.js');
const B = await import('../src/billing.js');
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

// Count the emails "sent" (without RESEND_API_KEY, sendMail prints them instead).
const log = console.log; let sent = [];
const capture = async f => { sent = []; console.log = (...a) => { if (/^\[dev\] Email for/.test(a[0])) sent.push(a[0]); }; try { return await f(); } finally { console.log = log; } };

const db = getDb();
const user = email => { db.prepare("INSERT INTO user (email, plan) VALUES (?, 'free')").run(email); return db.prepare('SELECT * FROM user WHERE email=?').get(email); };
const welcomed = u => db.prepare("INSERT INTO mail_log (user_id, kind, day, ref) VALUES (?, 'welcome', '2026-11-01', 'obesity')").run(u.id);
let n = 0;
const checkout = u => B.recordCheckout({ id: `cs_${++n}`, payment_status: 'paid', status: 'complete', metadata: { plan: 'solo', user_id: String(u.id) },
  customer_details: { email: u.email }, amount_total: 4900, currency: 'usd', customer: `cus_${u.id}`, livemode: false });
// What server.js does after each recorded checkout.
const pay = (u, times = 1) => { const r = checkout(u); return Promise.all(Array.from({ length: times }, () => D.sendUpgrade(r.uid))); };
const upgrades = u => db.prepare("SELECT count(*) FROM mail_log WHERE user_id=? AND kind='upgrade'").pluck().get(u.id);

// Free with the welcome, then pays: one email, even with the payment page and the webhook both firing.
const f = user('free@x.test'); welcomed(f);
await capture(() => pay(f, 2));
ok(sent.length === 1 && /free@x\.test: You’re on Solo now/.test(sent[0]) && upgrades(f) === 1, 'Free to Solo: one upgrade email, though the page and the webhook both record the payment');
await capture(() => pay(f));
ok(sent.length === 0 && upgrades(f) === 1, 'a second payment sends nothing');

// Paid straight away: no Free welcome yet, so no upgrade email (the welcome comes later in its Solo version).
const d = user('direct@x.test');
await capture(() => pay(d));
ok(sent.length === 0 && upgrades(d) === 0, 'paid first, no welcome yet: no upgrade email');
// Even after their (Solo) welcome, coming back after cancelling is not an upgrade from Free.
welcomed(d); db.prepare("UPDATE user SET plan='free' WHERE id=?").run(d.id);
await capture(() => pay(d));
ok(sent.length === 0 && upgrades(d) === 0, 'paid first, cancelled, paid again: no upgrade email');

// Unsubscribed from everything: nothing.
const u = user('off@x.test'); welcomed(u); db.prepare('UPDATE user SET digest_off=1, news_off=1 WHERE id=?').run(u.id);
await capture(() => pay(u));
ok(sent.length === 0, 'unsubscribed from everything: no upgrade email');

// DIGEST_TO unset (testing): nothing, like every other email.
delete process.env.DIGEST_TO;
const t = user('test@x.test'); welcomed(t);
await capture(() => pay(t));
ok(sent.length === 0, 'DIGEST_TO unset: no upgrade email');

// The approved words, signed by the Team, with an unsubscribe link.
const e = D.buildUpgrade(db.prepare('SELECT * FROM user WHERE id=?').get(f.id));
ok(e.subject === 'You’re on Solo now' && e.text.includes('Thank you for choosing Solo, and for joining this early.')
  && e.text.includes('- follow up to 5 landscapes, companies or drugs') && e.text.includes('- see every change the day it happens')
  && e.text.includes('- get an email every Monday with what changed and what is coming')
  && e.text.includes('Something missing or wrong? Reply to this email. We read every message.')
  && e.text.includes('OpenLandscape Team') && /\/unsubscribe\/all\?t=/.test(e.text) && e.html.includes('OpenLandscape Team'), 'the approved words, signed OpenLandscape Team, in text and HTML');
