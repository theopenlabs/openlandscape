// The sign-in page, and the same box over a page when someone signed out presses Follow (design pass, screen 4).
import { esc, followChoiceHTML } from '../../web/table.js';
import { icon } from '../../web/icons.js';
import { BRAND, layout } from './shared.js';

// ---------- sign in ----------
// Google's standard "G" mark, unaltered (branding guidelines: developers.google.com/identity/branding-guidelines)
export const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

// The title says why you are here (`why`, from where you go next): a search from the landing page, an AI app asking to
// connect, a Follow press (the name of what is followed), or Choose Solo. The failures sit in red inside the box.
// `next` rides in every form, in the email link and in the Google link. `lastGoogle`: the Google account used last on this
// browser; the button names it and Google skips its account picker.
const MSG = {
  bademail: ['That email looks wrong.', 'Check for a typo.'],
  wrongcode: ['Wrong code.', 'Check it, or send a new one.'],
  toomany: ['Already sent.', 'Check spam, or wait 10 minutes.'],
  sendfail: ['Email not sent.', 'Try again, or use Google.'],
  googlefail: ['Google sign-in failed.', 'Try again, or use email.'],
  // New accounts (src/limits.js signupProblem)
  throwaway: ['Use your work email.', 'Throwaway addresses cannot make an account.'],
  manyaccounts: ['Too many new accounts from here today.', 'Try again tomorrow, or write to us.'],
};
const qs = next => (next ? `?next=${encodeURIComponent(next)}` : '');
export function signinBox({ state = '', email = '', next = '', why = {}, dev = null, error = '', askCode = false, lastGoogle = '', dialog = false, token = '' } = {}) {
  const google = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hidden = `${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}`;
  // "Send again" is a button of a form outside the row, so the row holds three plain inline items on one baseline.
  const againId = dialog ? 'again-box' : 'again';
  const again = `<form method="post" action="/auth/start" id="${againId}" hidden>${hidden}<input type="hidden" name="email" value="${esc(email)}"></form>`;
  const codeForm = `<form method="post" action="/auth/code" class="codeform">${hidden}<input type="hidden" name="email" value="${esc(email)}">
  <label for="code" class="field">Open the link on any device, or type the code</label>
  <input class="input${state === 'wrongcode' ? ' is-error' : ''}" id="code" name="code" required autofocus inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="6 digits"${state === 'wrongcode' ? ' aria-invalid="true"' : ''}>
  <button class="btn primary" type="submit">Continue</button>
</form>`;
  const devBox = dev ? `<p class="devline"><b>Local test mode:</b> code ${esc(dev.code)}, or <a href="${esc(dev.link)}">open the link</a>.</p>` : '';
  const line = ([b, rest]) => `<p class="msg" role="alert"><b>${esc(b)}</b> ${esc(rest)}</p>`;
  const gbtn = lastGoogle ? `${GOOGLE_G}<span class="gname">Continue as <span class="who">${esc(lastGoogle)}</span></span>` : `${GOOGLE_G}Continue with Google`;
  const startForm = `
${google ? `<a class="gbtn" href="/auth/google${qs(next)}">${gbtn}</a>
<div class="or"><span>or</span></div>` : ''}
<form method="post" action="/auth/start" data-sending="Sending…">${hidden}
  <label for="email" class="field">Work email</label>
  <input class="input${state === 'bademail' ? ' is-error' : ''}" id="email" name="email" type="email" required${google || dialog ? '' : ' autofocus'} placeholder="you@company.com" value="${esc(email)}"${state === 'bademail' ? ' aria-invalid="true"' : ''}>
  <button class="btn primary" type="submit">Email me a link and a code</button>
</form>
<p class="fine">You agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>`;
  let title, lede, body;
  if (askCode) {
    title = 'Sign in'; lede = `Reviewer code for ${esc(email)}.`;
    body = `${error ? `<p class="msg" role="alert">${esc(error)}</p>` : ''}<form method="post" action="/auth/code">${hidden}
  <input type="hidden" name="email" value="${esc(email)}">
  <label for="code" class="field">Reviewer code</label>
  <input class="input" id="code" name="code" type="password" required autofocus autocomplete="one-time-code">
  <button class="btn primary" type="submit">Sign in</button>
</form>`;
  } else if (state === 'sent' || state === 'wrongcode') {
    title = 'Check your inbox';
    lede = state === 'sent' ? `Sent to <b>${esc(email)}</b>.` : '';
    body = `${state === 'wrongcode' ? line(MSG.wrongcode) : ''}${devBox}${codeForm}${again}
<p class="after"><button class="linkbtn" type="submit" form="${againId}">Send again</button>${state === 'sent' ? `<span class="dot" aria-hidden="true">·</span><a href="/signin${qs(next)}" data-box-reset>Use another email</a>` : ''}</p>`;
  } else if (state === 'confirm') {
    // The emailed link: one press, so a mail scanner opening the link does not use it up.
    title = 'Sign in'; lede = `As <b>${esc(email)}</b>.`;
    body = `<form method="post" action="/auth/verify">${hidden}<input type="hidden" name="token" value="${esc(token)}">
  <button class="btn primary" type="submit">Continue</button>
</form>`;
  } else if (state === 'expired') {
    title = 'This link no longer works';
    lede = why.q ? 'Your search is still waiting.' : 'Links work once, for 30 minutes.';
    body = email ? `<form method="post" action="/auth/start">${hidden}
  <label for="email" class="field">Work email</label>
  <input class="input" id="email" name="email" type="email" required value="${esc(email)}">
  <button class="btn primary" type="submit">Send a new link</button>
</form>` : startForm;
  } else if (why.follow && /^\/follow\?/.test(next) && !state) {
    // Follow, signed out (screen 5): one rule everywhere, "Follow always means Solo", with Free offered under it.
    // Each button opens the sign-in form in the box: Solo goes on to payment, then follows; Free starts onboarding.
    const go = n => `/signin${qs(n)}`;
    const close = dialog ? `<button class="x" type="button" data-box-close aria-label="Close">${icon('close', 18)}</button><div class="grab" aria-hidden="true"></div>` : '';
    return { title: `Follow ${esc(why.follow)}`, html: close + followChoiceHTML({ name: why.follow, dialog, solo: go(`/billing/solo?follow=${encodeURIComponent(next)}`),
      free: { items: ['One landscape of your own, in full', 'The top 10 of everything else'], btn: 'Sign up free', href: go(why.freeNext || `/app/welcome?from=${encodeURIComponent(next)}`), go: true },
      signin: `<p class="after">Have an account? <a href="${esc(go(next))}" data-box-go>Sign in</a></p>` }) };
  } else {
    title = why.pages && !state ? 'Sign in free to keep reading' : why.q ? `See the drugs for ${esc(why.q)}` : why.app ? `Connect ${esc(why.app)}` : why.follow ? `Follow ${esc(why.follow)}` : why.solo ? 'Choose Solo' : 'Sign in or sign up';
    lede = why.pages && !state ? 'This computer has opened many pages today. A free account keeps you going. No card, no password.' : why.q ? `${why.shared ? 'Shared with you. ' : ''}Make a free account to see them.` : why.app ? 'Sign in, then allow access.'
      : why.follow ? 'Make a free account. No card, no password.' : why.solo ? 'Sign in first. Payment comes right after.' : 'Free, no card, no password.';
    const msg = MSG[state] ? [...MSG[state]] : null;
    if (msg && state === 'sendfail' && !google) msg[1] = 'Try again in a minute.';
    body = `${msg ? line(msg) : ''}${startForm}`;
  }
  const close = dialog ? `<button class="x" type="button" data-box-close aria-label="Close">${icon('close', 18)}</button><div class="grab" aria-hidden="true"></div>` : '';
  return { title, html: `${close}<h1${dialog ? ' id="signbox-t"' : ''}>${title}</h1>
${lede ? `<p class="lede">${lede}</p>` : ''}
${body}` };
}

export function signinPage(opts = {}) {
  const { title, html } = signinBox(opts);
  return layout({
    title: `${title.replace(/<[^>]+>/g, '')} | ${BRAND}`, noindex: !!(opts.state || opts.why?.q || opts.next), active: 'signin',
    body: `<main class="signin auth"><div class="card">
${html}
</div></main>`,
  });
}

// The box over the page for a Follow press signed out (web/ui.js opens it from a link with data-signin). Without scripts the
// link itself goes to /follow, which asks to sign in on the page above.
export const signinDialog = opts => `<dialog class="signbox" id="signbox" aria-labelledby="signbox-t"><div class="signin inbox"><div class="card" data-box>${signinBox({ ...opts, dialog: true }).html}</div></div></dialog>`;
