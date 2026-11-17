import * as M from './mailhtml.js';
import { esc } from '../web/table.js';
import { getDb } from './db.js';

// Every email goes out through Resend here. One that does not send (Resend says no, or cannot be reached) is kept in mail_fail
// with what went wrong (`label`: the subject, or words in its place when the subject holds a sign-in code), for the admin dashboard (Today's red notice, Emails), and the error is thrown on as before.
async function resend(body, kind, label = body.subject) {
  const to = Array.isArray(body.to) ? body.to[0] : body.to;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
  } catch (e) {
    try {
      const db = getDb(), uid = db.prepare('SELECT id FROM user WHERE lower(email)=lower(?)').pluck().get(String(to || ''));
      db.prepare('INSERT INTO mail_fail (user_id, email, kind, subject, error) VALUES (?,?,?,?,?)').run(uid ?? null, to, kind, label, String(e.message).slice(0, 300));
    } catch (e2) { console.error('mail_fail', e2.message); }
    throw e;
  }
}

// The sign-in email, in the look of the other emails (step 10): the code large, the link as a button. No unsubscribe:
// it only goes to someone who asked for it. The plain-text version says the same.
export function loginEmail(link, code = '') {
  const subject = code ? `Your ${M.BRAND} code is ${code}` : `Your ${M.BRAND} sign-in link`;
  const fine = 'The link and the code work once, for 30 minutes. If you did not ask for them, ignore this email.';
  const text = `${code ? `Your code: ${code}\n\nOr open this link on any device:\n\n` : `Click to sign in to ${M.BRAND}:\n\n`}${link}\n\n${fine}`;
  const big = code ? `<p class="e-ink" style="margin:28px 0 0;font-size:32px;line-height:40px;font-weight:600;letter-spacing:6px;color:#1C1A17">${esc(code)}</p>` : '';
  const body = M.logoRow('') + M.h1(code ? 'Your sign-in code' : `Sign in to ${M.BRAND}`)
    + M.sub(code ? 'Type it where you asked for it.' : 'Open this link on any device.') + big
    + (code ? M.para('Or sign in with the link, on any device:', 32) + M.button(`Sign in to ${M.BRAND}`, link, 12) : M.button(`Sign in to ${M.BRAND}`, link, 28))
    + `<p class="e-mut" style="margin:40px 0 0;font-size:12px;line-height:18px;color:#77736D">${esc(fine)}</p>`;
  return { subject, text, html: M.page({ subject, preheader: code ? `Your code: ${code}` : 'Your sign-in link', body }) };
}

// Sends the sign-in email through Resend (free up to 3,000 emails a month).
// Without RESEND_API_KEY (local development), the link is printed in the server log instead.
export async function sendLoginEmail(email, link, code = '') {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[dev] Sign-in link for ${email}: ${link}${code ? `  code ${code}` : ''}`);
    return { dev: true };
  }
  await resend({
    from: process.env.MAIL_FROM || 'OpenLandscape <signin@openlandscape.app>',
    to: [email],
    ...loginEmail(link, code),
  }, 'signin', 'Sign-in email');
  return { dev: false };
}

// Sign-up from another form of an existing account's address (src/limits.js 'variant'): no code, just where to sign in.
export async function sendVariantNote(email) {
  const text = 'This address is another form of an address that already has an OpenLandscape account, so it cannot make a new one.\n\nSign in with your usual address.';
  if (!process.env.RESEND_API_KEY) { console.log(`[dev] Variant note for ${email}`); return { dev: true }; }
  await resend({ from: process.env.MAIL_FROM || 'OpenLandscape <signin@openlandscape.app>', to: [email], subject: 'Sign in with your usual address', text }, 'signin');
  return { dev: false };
}

// A "Talk to us" message, to the address in CONTACT_EMAIL. Without RESEND_API_KEY (or that address) it is printed instead.
export async function sendTalkMessage({ email, company, message }) {
  const to = process.env.CONTACT_EMAIL;
  const text = `From: ${email}\nCompany: ${company || '-'}\n\n${message}`;
  if (!process.env.RESEND_API_KEY || !to) { console.log(`[dev] Talk to us\n${text}`); return { dev: true }; }
  await resend({ from: process.env.MAIL_FROM || 'OpenLandscape <signin@openlandscape.app>', to: [to], reply_to: email, subject: `Talk to us: ${company || email}`, text }, 'talk');
  return { dev: false };
}

// A note to us (CONTACT_EMAIL), such as the weekly watch email (src/watch.js). Printed instead without RESEND_API_KEY.
export async function sendAdminMail({ subject, text }) {
  const to = process.env.CONTACT_EMAIL;
  if (!process.env.RESEND_API_KEY || !to) { console.log(`[dev] ${subject}\n${text}`); return { dev: true }; }
  await resend({ from: process.env.MAIL_FROM || 'OpenLandscape <signin@openlandscape.app>', to: [to], subject, text }, 'admin');
  return { dev: false };
}

// Every email but the sign-in link: the Monday email, the welcome and big news (src/digest.js). Without RESEND_API_KEY it is
// printed instead of sent. List-Unsubscribe lets mail apps show their own one-click unsubscribe button; replies go to
// CONTACT_EMAIL (the welcome email asks people to reply).
export async function sendMail({ to, subject, html, text, unsubscribeUrl, kind }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[dev] Email for ${to}: ${subject}\n${text}`);
    return { dev: true };
  }
  await resend({
    from: process.env.DIGEST_FROM || 'OpenLandscape <updates@openlandscape.app>',
    reply_to: process.env.CONTACT_EMAIL || undefined,
    to: [to], subject, html, text,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }, kind || 'other');
  return { dev: false };
}
