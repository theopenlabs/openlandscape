// Checks checkout and the webhook without Stripe (a stand-in client): Solo at $49 before VAT with Stripe Tax, the VAT-number
// field and the Terms checkbox; no discount and nothing else for sale; a completed checkout makes the account Solo and notes
// its card, a second account on the same card emails us once; a subscription Stripe gave up on goes back to Free; and the
// refund check after a heavy export. No real email goes out.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-billing-'), 'test.db');
process.env.PUBLIC_URL = 'https://openlandscape.test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
delete process.env.RESEND_API_KEY;
process.env.CONTACT_EMAIL = 'us@openlandscape.test';
const { getDb } = await import('../src/db.js');
const B = await import('../src/billing.js');
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

let made = null, cards = {}, prices = {}, subStatus = {};
B.useStripe({
  checkout: { sessions: { create: async p => { made = p; return { url: 'https://checkout.stripe.test/x' }; } } },
  billingPortal: { sessions: { create: async p => ({ url: `https://billing.stripe.test/${p.customer}` }) } },
  subscriptions: { retrieve: async id => ({ status: subStatus[id] || 'active', items: { data: [{ price: { id: prices[id] } }] }, default_payment_method: { card: { fingerprint: cards[id] } } }) },
  webhooks: { constructEvent: (body, sig) => { if (sig !== 'good') throw new Error('bad signature'); return JSON.parse(body); } },
});
const db = getDb();
const user = email => { db.prepare("INSERT INTO user (email, plan) VALUES (?, 'free')").run(email); return db.prepare('SELECT * FROM user WHERE email=?').get(email); };
const plan = u => db.prepare('SELECT plan FROM user WHERE id=?').pluck().get(u.id);
const adminMails = []; const log = console.log;
console.log = (...a) => { if (/^\[dev\] /.test(a[0]) && !/Email for/.test(a[0])) adminMails.push(a[0]); else log(...a); };

// Checkout
const a = user('a@co.test');
await B.createCheckout({ plan: 'solo', user: a, origin: 'https://dashboard.openlandscape.test' });
const li = made.line_items[0].price_data;
ok(li.unit_amount === 4900 && li.currency === 'usd' && li.recurring.interval === 'month', 'Solo is $49 a month');
ok(li.tax_behavior === 'exclusive' && made.automatic_tax.enabled, 'VAT is added on top by Stripe Tax');
ok(made.tax_id_collection.enabled && made.billing_address_collection === 'required', 'asks for the billing address and a VAT number');
ok(!made.discounts, 'no discount');
ok(made.consent_collection.terms_of_service === 'required' && /openlandscape\.test\/terms/.test(made.custom_text.terms_of_service_acceptance.message), 'Terms checkbox links the public Terms');
await B.createCheckout({ plan: 'solo_year', user: a, origin: 'x' });
ok(made.line_items[0].price_data.unit_amount === 49000 && made.line_items[0].price_data.recurring.interval === 'year' && made.automatic_tax.enabled && made.metadata.plan === 'solo_year', 'Solo yearly is $490 a year, VAT on top');
for (const p of ['custom', 'team_year', 'team']) ok(await B.createCheckout({ plan: p, user: a, origin: 'x' }).then(() => false, () => true), `${p} cannot be bought`);
ok(await B.createCheckout({ plan: 'solo', user: null, origin: 'x' }).then(() => false, () => true), 'signed out cannot buy');
process.env.STRIPE_PRICE_SOLO = 'price_m'; process.env.STRIPE_PRICE_SOLO_YEAR = 'price_y';
await B.createCheckout({ plan: 'solo', user: a, origin: 'x' });
ok(made.line_items[0].price === 'price_m' && !made.line_items[0].price_data && made.automatic_tax.enabled && made.tax_id_collection.enabled && made.consent_collection.terms_of_service === 'required', 'with Stripe price IDs set: monthly uses its price, still VAT, VAT number and Terms');
await B.createCheckout({ plan: 'solo_year', user: a, origin: 'x' });
ok(made.line_items[0].price === 'price_y', 'with Stripe price IDs set: yearly uses its price');
db.prepare("UPDATE user SET stripe_customer='cus_a' WHERE id=?").run(a.id);
await B.createCheckout({ plan: 'solo', user: { ...a, stripe_customer: 'cus_a' }, origin: 'x' });
ok(made.customer === 'cus_a' && made.customer_update.address === 'auto' && made.customer_update.name === 'auto', 'a returning customer keeps their Stripe customer, address saved for tax');
// An account already on Solo that presses Choose Solo again goes here instead of a second checkout (src/server.js toBilling).
ok(await B.portalUrl({ ...a, stripe_customer: 'cus_a' }, 'x') === 'https://billing.stripe.test/cus_a' && await B.portalUrl(a, 'x') === null, 'billing page for a Stripe customer; none without one (Home instead)');

// Webhook
const hook = (type, object) => B.handleWebhook(JSON.stringify({ type, data: { object } }), 'good');
const done = (u, sub) => hook('checkout.session.completed', { id: `cs_${u.id}`, status: 'complete', payment_status: 'paid', metadata: { plan: 'solo', user_id: String(u.id) },
  customer_details: { email: u.email }, amount_total: 4900, currency: 'usd', customer: `cus_${u.id}`, subscription: sub, livemode: false });
ok(await B.handleWebhook('{}', 'bad').then(() => false, () => true), 'an unsigned webhook is refused');
cards.sub_a = 'fp_1'; await done(a, 'sub_a');
ok(plan(a) === 'solo', 'a completed checkout makes the account Solo');
const y = user('y@co.test'); cards.sub_y = 'fp_y';
await hook('checkout.session.completed', { id: 'cs_y', status: 'complete', payment_status: 'paid', metadata: { plan: 'solo_year', user_id: String(y.id) }, customer_details: { email: y.email }, amount_total: 49000, currency: 'usd', customer: 'cus_y', subscription: 'sub_y', livemode: false });
ok(plan(y) === 'solo_year', 'a yearly checkout makes the account Solo, yearly');
ok(adminMails.length === 0, 'first card: no email');
const u = user('u@co.test'); cards.sub_u = 'fp_u'; prices.sub_u = 'price_y'; await done(u, 'sub_u');
ok(plan(u) === 'solo_year', 'bought monthly but took the yearly offer on Stripe\'s page: Solo, yearly');
prices.sub_u = 'price_m'; await hook('customer.subscription.updated', { id: 'sub_u', customer: `cus_${u.id}`, status: 'active', items: { data: [{ price: { id: 'price_m' } }] } });
ok(plan(u) === 'solo', 'switched to monthly in the billing portal: Solo, monthly');
const b = user('b@other.test'); cards.sub_b = 'fp_1'; await done(b, 'sub_b');
ok(adminMails.length === 1 && /b@other\.test paid with the same card as a@co\.test/.test(adminMails[0]), 'same card, second account: one email to us');
await done(b, 'sub_b');
ok(adminMails.length === 1, 'the success page and the webhook both firing: still one email');
const c = user('c@co.test'); cards.sub_c = 'fp_2'; await done(c, 'sub_c');
ok(adminMails.length === 1, 'a different card: no email');

await hook('customer.subscription.updated', { customer: `cus_${c.id}`, status: 'past_due' });
ok(plan(c) === 'solo', 'a failed payment being retried keeps Solo');
await hook('customer.subscription.updated', { customer: `cus_${c.id}`, status: 'unpaid' });
ok(plan(c) === 'free', 'all retries failed: back to Free');
await hook('customer.subscription.deleted', { customer: `cus_${b.id}`, status: 'canceled' });
ok(plan(b) === 'free', 'cancelled at the end of the period: back to Free');
subStatus.sub_b = 'canceled'; await done(b, 'sub_b');
ok(plan(b) === 'free', 'reopening an old success link after cancelling (or a refund) does not bring Solo back');
ok(B.planFromSub('id', b.id, { status: 'canceled', items: { data: [{ price: { id: 'price_m' } }] } }) === null && plan(b) === 'free', 'an ended subscription never sets the plan');
const k = user('k@co.test');
await hook('checkout.session.completed', { id: 'cs_k', status: 'complete', payment_status: 'unpaid', metadata: { plan: 'solo', user_id: String(k.id) }, customer_details: { email: k.email }, amount_total: 4900, currency: 'usd', customer: 'cus_k', subscription: 'sub_k', livemode: false });
ok(plan(k) === 'free', 'a bank payment still clearing (unpaid): no Solo yet');
await hook('checkout.session.async_payment_succeeded', { id: 'cs_k', status: 'complete', payment_status: 'paid', metadata: { plan: 'solo', user_id: String(k.id) }, customer_details: { email: k.email }, amount_total: 4900, currency: 'usd', customer: 'cus_k', subscription: 'sub_k', livemode: false });
ok(plan(k) === 'solo', 'the bank payment arrives later: Solo then');
// Security read 18 Nov: late or misdirected payments.
await B.createCheckout({ plan: 'solo', user: k, origin: 'x' });
ok(made.metadata.user_email === k.email && made.metadata.user_id === String(k.id), 'a checkout names the account by number and email');
const r0 = user('r@co.test'); db.prepare('DELETE FROM user WHERE id=?').run(r0.id);
db.prepare("INSERT INTO user (id, email, plan) VALUES (?, 'new@co.test', 'free')").run(r0.id);
await hook('checkout.session.async_payment_succeeded', { id: 'cs_r', status: 'complete', payment_status: 'paid', metadata: { plan: 'solo', user_id: String(r0.id), user_email: 'r@co.test' }, customer_details: { email: 'r@co.test' }, amount_total: 4900, currency: 'usd', customer: 'cus_r', subscription: 'sub_r', livemode: false });
const newcomer = db.prepare('SELECT plan, stripe_customer FROM user WHERE id=?').get(r0.id);
ok(newcomer.plan === 'free' && !newcomer.stripe_customer, 'a deleted account\'s late payment does not go to the next account given its number');
const l = user('l@co.test'); subStatus.sub_l = 'canceled'; await done(l, 'sub_l');
ok(plan(l) === 'free', 'a late checkout message for a subscription cancelled since: no Solo');
prices.sub_l = 'price_m'; await hook('customer.subscription.updated', { id: 'sub_l', customer: `cus_${l.id}`, status: 'active', items: { data: [{ price: { id: 'price_m' } }] } });
ok(plan(l) === 'free', 'a late "active" message after a cancel: still Free (the subscription is asked as it is now)');

// Payment trouble (billing_event, one email each to us)
const trouble = kind => db.prepare('SELECT * FROM billing_event WHERE kind=? ORDER BY id').all(kind);
ok(trouble('ended').length === 2 && adminMails.some(m => /Solo ended: c@co\.test/.test(m)) && adminMails.some(m => /Solo ended: b@other\.test/.test(m)), 'a subscription ending is kept and emailed');
let n = adminMails.length;
await hook('customer.subscription.deleted', { customer: `cus_${c.id}`, status: 'canceled' });
ok(trouble('ended').length === 2 && adminMails.length === n, 'unpaid, then deleted: still one email');
const ev = (id, type, object, previous_attributes) => B.handleWebhook(JSON.stringify({ id, type, data: { object, previous_attributes } }), 'good');
const due = Math.floor(Date.UTC(2026, 11, 3) / 1000);
await ev('evt_f1', 'invoice.payment_failed', { customer: `cus_${a.id}`, amount_due: 4900, currency: 'usd', attempt_count: 1, next_payment_attempt: due });
await ev('evt_f1', 'invoice.payment_failed', { customer: `cus_${a.id}`, amount_due: 4900, currency: 'usd', attempt_count: 1, next_payment_attempt: due });
ok(trouble('payment_failed').length === 1 && adminMails.length === n + 1 && /Payment failed: a@co\.test/.test(adminMails.at(-1)), 'a failed payment: one row and one email, even when Stripe sends it twice');
ok(/49\.00 USD/.test(trouble('payment_failed')[0].detail) && /tries again on 2026-12-03/.test(trouble('payment_failed')[0].detail), 'it says the amount and when Stripe tries again');
await ev('evt_c1', 'customer.subscription.updated', { customer: 'cus_y', status: 'active', cancel_at_period_end: true, current_period_end: due, items: { data: [{ price: { id: 'price_y' } }] } }, { cancel_at_period_end: false });
ok(trouble('cancel_planned').length === 1 && /keep it until 2026-12-03/.test(trouble('cancel_planned')[0].detail) && /Solo cancelled: y@co\.test/.test(adminMails.at(-1)), 'cancelled in the portal: kept, emailed, with the day Solo ends');
await ev('evt_c2', 'customer.subscription.updated', { customer: 'cus_y', status: 'active', cancel_at_period_end: true, items: { data: [{ price: { id: 'price_y' } }] } }, { metadata: {} });
ok(trouble('cancel_planned').length === 1, 'another change to a cancelled subscription: no second email');

// Refund check
ok(/Full refund/.test(B.refundCheck('a@co.test').verdict), 'paid today, nothing exported: full refund');
db.prepare("INSERT INTO usage (user_id, kind, detail) VALUES (?, 'csv', '120')").run(a.id);
ok(/heavy export \(1 CSV download\)/.test(B.refundCheck('A@co.test').verdict), 'after a CSV: no refund');
const put = db.prepare("INSERT INTO drug_seen (user_id, program_id, first_day) VALUES (?, ?, date('now'))");
for (let i = 0; i < B.HEAVY.drugs; i++) put.run(c.id, `p${i}`);
ok(/heavy export \(1,000 different drugs\)/.test(B.refundCheck('c@co.test').verdict), 'after 1,000 different drugs: no refund');
db.prepare("UPDATE payment SET created_at=datetime('now','-20 days') WHERE user_id=?").run(b.id);
ok(/20 days ago/.test(B.refundCheck('b@other.test').verdict), 'after 14 days: no refund');
ok(/No account/.test(B.refundCheck('nobody@x.test').verdict), 'unknown email');
for (const [k, live] of [['sk_live_x', true], ['rk_live_x', true], ['sk_test_x', false], ['rk_test_x', false], ['', false]]) {
  process.env.STRIPE_SECRET_KEY = k; ok(B.liveMode() === live, `key ${k || '(none)'}: ${live ? 'live' : 'test'}`);
}
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
console.log = log;
