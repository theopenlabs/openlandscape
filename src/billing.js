// Stripe Checkout for Solo ($49 a month, excl. VAT). Test mode until live keys are set.
// Prices: the Stripe price IDs in STRIPE_PRICE_SOLO / STRIPE_PRICE_SOLO_YEAR when set (the product "OpenLandscape Solo", whose
// monthly price offers yearly on Stripe's checkout page); otherwise made inline. Stripe Tax adds VAT where it applies (Feynman OÜ, Estonia):
// Stripe needs the Estonia registration, origin address and a Terms link set in its dashboard first (step 14 notes).
import Stripe from 'stripe';
import { getDb } from './db.js';
import { sendAdminMail } from './mail.js';

// plan: what the user's account becomes. soon: not sold yet (Pricing shows Team as coming soon).
export const PLANS = {
  solo: { plan: 'solo', price: 'STRIPE_PRICE_SOLO', name: 'OpenLandscape Solo', amount: 4900, interval: 'month', mode: 'subscription', blurb: 'Every list in full, with downloads; follow 5 landscapes, companies or drugs; every change as it happens and the Monday email; 300 AI lookups a day' },
  solo_year: { plan: 'solo_year', price: 'STRIPE_PRICE_SOLO_YEAR', name: 'OpenLandscape Solo, yearly', amount: 49000, interval: 'year', mode: 'subscription', blurb: 'Every list in full, with downloads; follow 5 landscapes, companies or drugs; every change as it happens and the Monday email; 300 AI lookups a day' },
  team: { plan: 'team', name: 'OpenLandscape Team', amount: 14900, interval: 'month', mode: 'subscription', soon: 'Jan 2027', blurb: 'Everything in Solo, per person, for 3 to 10 people' },
};
// Stripe's tax code for software sold as a service to businesses ("SaaS, business use").
const TAX_CODE = 'txcd_10103001';
// No refund after a heavy export (Terms, "Paid plans"): within 14 days of the first
// payment, a CSV download or this many different drugs opened ends the consumer's 14-day refund.
export const HEAVY = { days: 14, drugs: 1000 };

let stripe;
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe;
}
// Tests only: a stand-in for Stripe's client.
export const useStripe = s => { stripe = s; };
// Live: a full secret key (sk_live_) or a restricted one (rk_live_, "full access except sensitive operations").
export const liveMode = () => /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '');
// The Stripe price ID set for a plan, and the plan a price ID belongs to (the yearly offer or the billing portal can switch it).
const priceId = p => (p.price && process.env[p.price]) || null;
const planOfPrice = id => (id && Object.values(PLANS).find(p => priceId(p) === id)?.plan) || null;
const site = origin => (process.env.PUBLIC_URL || origin).replace(/\/$/, '');

// `then`: a /follow?… address to follow right after paying (Choose Solo from a Follow press).
export async function createCheckout({ plan, user, origin, then = '' }) {
  const s = stripeClient();
  if (!s) throw new Error('Payments are not configured yet (STRIPE_SECRET_KEY missing).');
  const p = PLANS[plan];
  if (!p) throw new Error('Unknown plan');
  if (p.soon) throw new Error(`${p.name} opens in ${p.soon}. Join the waiting list on the pricing page.`);
  if (!user) throw new Error('Sign in first');
  const session = await s.checkout.sessions.create({
    mode: p.mode,
    line_items: [priceId(p) ? { quantity: 1, price: priceId(p) } : { quantity: 1, price_data: { currency: 'usd', unit_amount: p.amount, tax_behavior: 'exclusive', recurring: { interval: p.interval },
      product_data: { name: p.name, description: p.blurb, tax_code: TAX_CODE } } }],
    // VAT: Stripe works it out from the billing address; a business's VAT number makes it a reverse charge (no VAT added).
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    ...(user.stripe_customer ? { customer: user.stripe_customer, customer_update: { address: 'auto', name: 'auto' } } : { customer_email: user.email }),
    // Solo starts at once, so the buyer agrees that the 14-day refund ends after a heavy export.
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: `I agree to the [Terms](${site(origin)}/terms). Solo starts now, so the 14-day refund ends once I download a list or open ${HEAVY.drugs.toLocaleString('en-US')} different drugs.` } },
    metadata: { plan, user_id: String(user.id) },
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}${then ? `&follow=${encodeURIComponent(then)}` : ''}`,
    cancel_url: `${origin}/pricing?cancelled=1`,
  });
  return session.url;
}

// Records a completed checkout once (called from the webhook and from the success page; whichever comes first).
// Only money that has arrived counts: a bank payment still clearing is 'unpaid' though the checkout is 'complete'.
// The plan changes only the first time: reopening an old success link (after a refund or cancel) changes nothing.
export function recordCheckout(cs) {
  if (cs.payment_status !== 'paid' && cs.payment_status !== 'no_payment_required') return null;
  const db = getDb();
  const plan = cs.metadata?.plan;
  const email = (cs.customer_details?.email || cs.customer_email || '').toLowerCase();
  const fresh = db.prepare('INSERT OR IGNORE INTO payment (user_id,email,plan,amount,currency,stripe_session,livemode) VALUES (?,?,?,?,?,?,?)')
    .run(cs.metadata?.user_id ? +cs.metadata.user_id : null, email, plan, cs.amount_total, cs.currency, cs.id, cs.livemode ? 1 : 0).changes === 1;
  let uid = null;
  if (fresh && PLANS[plan]?.mode === 'subscription') {
    uid = cs.metadata?.user_id ? +cs.metadata.user_id : db.prepare('SELECT id FROM user WHERE email=?').pluck().get(email);
    if (uid) db.prepare('UPDATE user SET plan=?, stripe_customer=?, solo_until=NULL WHERE id=?').run(PLANS[plan].plan, cs.customer, uid);   // paying ends a free Solo given by hand
  }
  return { plan: PLANS[plan]?.plan || plan, email, uid };
}

// One card paying for a second account: Stripe gives each card number the same
// fingerprint, so a second account with it sends us the same-day email the drug limits send. Apple Pay and Google Pay pay
// with a stand-in number, so they are not caught. Returns the other accounts' emails (empty when none, or already noted).
export function noteCard(uid, fingerprint) {
  if (!uid || !fingerprint) return [];
  const db = getDb(), me = db.prepare('SELECT email, card_fp FROM user WHERE id=?').get(uid);
  if (!me || me.card_fp === fingerprint) return [];
  db.prepare('UPDATE user SET card_fp=? WHERE id=?').run(fingerprint, uid);
  const others = db.prepare('SELECT email, plan FROM user WHERE card_fp=? AND id<>? ORDER BY id').all(fingerprint, uid);
  if (others.length) sendAdminMail({
    subject: `${me.email} paid with the same card as ${others[0].email}`,
    text: [`${me.email} just paid for Solo with a card that already paid for ${others.map(o => `${o.email} (now ${o.plan})`).join(', ')}.`, '',
      'It can be innocent (a colleague paying with the company card). It can also be one person opening a second account to get past the limits. What each opened is in the usage table; the Terms allow one account per person.'].join('\n'),
  }).catch(e => console.error('card alert', e.message));
  return others.map(o => o.email);
}
// Sets the plan from the subscription's price, when it is one of ours (a buyer who took the yearly offer on Stripe's page).
// Only for a live subscription: an ended one never brings Solo back.
const LIVE = new Set(['active', 'trialing']);
export function planFromSub(where, arg, sub) {
  const plan = LIVE.has(sub?.status) ? planOfPrice(sub?.items?.data?.[0]?.price?.id) : null;
  if (plan) getDb().prepare(`UPDATE user SET plan=?, solo_until=NULL WHERE ${where}=?`).run(plan, arg);
  return plan;
}
// After a recorded checkout (webhook or success page): the plan actually bought, and its card. Never throws.
export async function afterPaid(cs, record) {
  try {
    const id = typeof cs.subscription === 'string' ? cs.subscription : cs.subscription?.id;
    if (!record?.uid || !id) return;
    const sub = await stripeClient().subscriptions.retrieve(id, { expand: ['default_payment_method'] });
    planFromSub('id', record.uid, sub);
    noteCard(record.uid, sub.default_payment_method?.card?.fingerprint || null);
  } catch (e) { console.error('card check', e.message); }
}

// A subscription Stripe has given up on (all payment retries failed, or cancelled) puts the account back on Free.
const ENDED = new Set(['canceled', 'unpaid', 'incomplete_expired']);
// onCheckout(record, session): called with what recordCheckout returned (server.js sends the upgrade email from it).
export async function handleWebhook(rawBody, signature, onCheckout = () => {}) {
  const s = stripeClient();
  if (!s) throw new Error('Payments are not configured');
  const event = s.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  const o = event.data.object;
  // A bank payment that clears later arrives as async_payment_succeeded; until then the checkout is 'unpaid' (no Solo).
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') { const r = recordCheckout(o); onCheckout(r, o); await afterPaid(o, r); }
  if (event.type === 'customer.subscription.deleted' || (event.type === 'customer.subscription.updated' && ENDED.has(o.status))) {
    getDb().prepare("UPDATE user SET plan='free' WHERE stripe_customer=?").run(o.customer);
    noteTrouble(event, 'ended', o, `Solo ended for {email} (${o.status || 'cancelled'}). The account is back on Free.`);
  } else if (event.type === 'customer.subscription.updated' && o.status === 'active') {
    planFromSub('stripe_customer', o.customer, o);
    const was = event.data.previous_attributes || {};
    if ((o.cancel_at_period_end || o.cancel_at) && (('cancel_at_period_end' in was && !was.cancel_at_period_end) || ('cancel_at' in was && !was.cancel_at)))
      noteTrouble(event, 'cancel_planned', o, `{email} cancelled Solo. They keep it until ${day(o.cancel_at || o.current_period_end || o.items?.data?.[0]?.current_period_end)}, then the account goes back to Free.`);
  }
  if (event.type === 'invoice.payment_failed')
    noteTrouble(event, 'payment_failed', o, `A payment of ${money(o.amount_due, o.currency)} from {email} failed (try ${o.attempt_count || 1}). ${o.next_payment_attempt ? `Stripe tries again on ${day(o.next_payment_attempt)}.` : 'Stripe will not try again.'} If every try fails, the account goes back to Free by itself.`);
  return event.type;
}
// Payment trouble: kept in billing_event for the dashboard's inbox, and one email to us. Stripe sends an
// event again if we were slow to answer: the event id keeps it to one row and one email. `say`: the email, with {email} filled in.
const day = t => (t ? new Date(t * 1000).toISOString().slice(0, 10) : 'the end of the time they paid for');
const money = (n, cur) => `${((n || 0) / 100).toFixed(2)} ${String(cur || 'usd').toUpperCase()}`;
const TROUBLE = { payment_failed: 'Payment failed', cancel_planned: 'Solo cancelled', ended: 'Solo ended' };
function noteTrouble(event, kind, o, say) {
  const db = getDb(), email = db.prepare('SELECT email FROM user WHERE stripe_customer=?').pluck().get(o.customer) || o.customer_email || o.customer || 'someone';
  const text = say.replace('{email}', email);
  // A subscription can end twice over (status unpaid, then deleted): one row and one email.
  if (kind === 'ended' && db.prepare("SELECT 1 FROM billing_event WHERE kind='ended' AND customer=? AND at > datetime('now','-2 days')").get(o.customer)) return;
  const added = db.prepare('INSERT OR IGNORE INTO billing_event (kind, email, customer, amount, currency, detail, stripe_id) VALUES (?,?,?,?,?,?,?)')
    .run(kind, email, o.customer || null, o.amount_due ?? null, o.currency || null, text, event.id || null).changes;
  if (added) sendAdminMail({ subject: `${TROUBLE[kind]}: ${email}`, text: `${text}\n\nIt is in Stripe under this customer, and kept for the admin dashboard (billing_event).` })
    .catch(e => console.error('billing alert', e.message));
}

// For a refund request (/admin/refund): did this person export heavily within 14 days of their first payment?
export function refundCheck(email) {
  const db = getDb();
  email = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id, email, plan FROM user WHERE lower(email)=?').get(email);
  const paid = db.prepare('SELECT min(created_at) FROM payment WHERE lower(email)=? AND livemode=?').pluck().get(email, liveMode() ? 1 : 0);
  if (!user || !paid) return { email, found: !!user, paid: null, verdict: user ? 'No payment found for this email.' : 'No account with this email.' };
  const since = paid.replace(' ', 'T') + 'Z', day = paid.slice(0, 10);
  const days = Math.floor((Date.now() - Date.parse(since)) / 864e5);
  const csv = db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='csv' AND at >= ?").pluck().get(user.id, paid);
  const drugs = db.prepare('SELECT count(*) FROM drug_seen WHERE user_id=? AND first_day >= ?').pluck().get(user.id, day);
  const heavy = csv > 0 || drugs >= HEAVY.drugs;
  const verdict = days >= HEAVY.days ? `No 14-day refund: the first payment was ${days} days ago. Part months are not refunded.`
    : heavy ? `No 14-day refund: heavy export (${csv ? `${csv} CSV download${csv === 1 ? '' : 's'}` : `${drugs.toLocaleString('en-US')} different drugs`}).`
    : 'Full refund: a consumer within 14 days, no heavy export. Refund it in Stripe (Payments, the payment, Refund) and cancel the subscription.';
  return { email: user.email, plan: user.plan, paid, days, csv, drugs, heavy, verdict };
}

export async function portalUrl(user, origin) {
  const s = stripeClient();
  if (!s || !user?.stripe_customer) return null;
  return (await s.billingPortal.sessions.create({ customer: user.stripe_customer, return_url: `${origin}/app` })).url;
}
