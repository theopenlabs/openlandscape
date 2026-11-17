// Privacy policy and terms: plain English, written from what the code actually does (checked 15 Nov 2026: tables in
// src/db.js, cookies in src/server.js, emails in src/digest.js). Agreed 15 Nov 2026.
// Change these pages when the code changes what we keep, set or send.
// Step 9 (design pass): How we check's look. Title, the short version as the grey line, then one box with a row per
// section, and a link to the other page at the foot of the box. The words are unchanged; step 16 has the lawyer pass.
import { layout, footer, BRAND, pageHead } from './pages/shared.js';
import { icon } from '../web/icons.js';

const CONTACT = 'hello@openlandscape.app';
const mail = `<a href="mailto:${CONTACT}">${CONTACT}</a>`;
const UPDATED = '17 Nov 2026';
// Facts about the company. A gap left empty shows as a marked gap on the page.
export const WHO = { name: 'Feynman OÜ', code: '16935626', address: 'Sepapaja tn 6, 15551 Tallinn, Estonia', hosting: 'Helsinki, Finland' };
const gap = (v, what) => v || `<mark>[${what}]</mark>`;
const SOURCES = 'ClinicalTrials.gov, the EU trials register, FDA (through openFDA), EMA, SEC filings and company press releases';
const page = ({ user, title, intro, rows, other }) => layout({
  title: `${title} | ${BRAND}`, user, desc: intro,
  body: `<main class="wrap hwc ds legal">
${pageHead(title, intro, `<span>Last updated ${UPDATED}</span>`)}
<section class="box"><dl class="rows">${rows.map(([k, v]) => `<div><dt><h2>${k}</h2></dt><dd>${v}</dd></div>`).join('')}</dl>
<a class="boxmore" href="${other[0]}">${other[1]}${icon('arrow', 14)}</a></section>
</main>${footer()}`,
});
const whoWeAre = `<p>${BRAND} is run by ${WHO.name} (registry code ${gap(WHO.code, 'registry code')}), ${WHO.address}. Write to us at ${mail}.</p>`;

export const privacyPage = ({ user } = {}) => page({
  user, title: 'Privacy', other: ['/terms', 'Read the Terms'],
  intro: `We keep as little about you as we can. Here is all of it, in plain English.`,
  rows: [
    ['Who we are', `${whoWeAre}<p>${WHO.name} decides what happens with your data (in the law's words, the controller).</p>`],
    ['What we store', `<ul>
  <li><b>Your email address</b>, when you sign in. That is your account.</li>
  <li><b>What you follow and search for</b>, so your Home can show it, and to see which landscapes people need.</li>
  <li><b>How you found us</b>: what you were doing when you made your account (for example following a drug, opening a shared landscape or connecting an AI app), and whether you pressed Choose Solo. We use it to see which ways in work.</li>
  <li><b>What your AI app asks us</b>: when you connect Claude, ChatGPT or another app, it asks us on your behalf. We keep which of our tools it used and what it searched for, to count the Free plan's 25 questions a month. What you type in the AI app stays with that app, under its own privacy policy.</li>
  <li><b>Messages you send us</b>: Talk to us keeps your email, company and message, and sends a copy to our inbox. "Which should we check next?" and the Team waitlist keep your email, what you asked for and the page you were on.</li>
  <li><b>The emails we send you</b>: which ones and when, so none goes out twice.</li>
  <li><b>Your plan and payments</b>: which plan you are on and the amount paid. Card details go to Stripe and never reach us.</li>
  <li><b>API keys</b>: we store only a fingerprint of each key, not the key itself.</li>
  <li><b>Pages opened</b>: we count visits ourselves, with no outside analytics. For each page we keep the day, the page (not what you searched for), the site that sent you, the country (worked out from your internet address, which is then dropped), whether you use a phone or a computer, and whether you were signed in. People are told apart by a code that changes every day and cannot be traced back to you. We do not keep your address for this.</li>
  <li><b>Signed out</b>: your computer's internet address, the name your browser gives, and how many pages it opened that day, to keep the limit on pages for people who are not signed in. Deleted after 30 days.</li>
</ul>`],
    ['Emails', `<p>Sign-in links, when you ask for one. On Solo, the Monday email with the week's changes in what you follow. On Free, an email when a regulator decides on a drug in your landscape. A welcome email when you make your account, an email with your landscape when you keep it, and a thank-you when you move to Solo.</p><p>Every email but sign-in links has an unsubscribe link. The same page can turn it back on.</p>`],
    ['Signing in with Google', `<p>If you choose to continue with Google, Google tells us your email address, your name and your profile picture. We keep only the email address. We do not get your Google password or access to anything else in your Google account.</p>`],
    ['Cookies', `<p>No advertising or tracking cookies, and no outside analytics. We set only these:</p><ul>
  <li><b>Signed in</b>: keeps you signed in for up to 60 days.</li>
  <li><b>Continue as</b>: after a Google sign-in, your email, so the sign-in page can offer "Continue as" next time. It stays for up to 400 days, also after you sign out.</li>
  <li><b>Light or dark</b>: the look you chose in Settings.</li>
  <li><b>Notes you closed</b>: so they do not come back.</li>
  <li><b>During sign-in</b>: where to take you next, and a check for Google sign-in. Gone within an hour.</li>
  <li><b>How you found us</b>: before you make an account, your browser keeps the site that sent you and the first page you opened (in its own storage, not a cookie). It is sent to us once, when you make your account, and then removed.</li>
</ul>`],
    ['Who else handles your data', `<ul>
  <li><b>Hetzner</b> hosts our server and its backups in ${WHO.hosting}.</li>
  <li><b>Resend</b> sends our emails.</li>
  <li><b>Stripe</b> handles payments.</li>
  <li><b>Google</b> handles "Continue with Google" if you use it.</li>
  <li><b>Cloudflare</b> passes on email sent to ${CONTACT} to our inbox.</li>
</ul>
<p>Resend, Stripe, Google and Cloudflare are US companies. They handle your data under the EU's standard contract terms for data sent outside the EU. We do not sell your data or share it with anyone else.</p>`],
    ['Why we use it', `<ul>
  <li><b>To give you what you signed up for</b>: your account, what you follow, your emails, your plan.</li>
  <li><b>To keep it fair and make it better</b>: counting Free's questions, seeing which landscapes people need, counting visits, and keeping the limit on pages for people who are not signed in. The law calls this our legitimate interest.</li>
  <li><b>Because the law says so</b>: payment records, for tax.</li>
</ul>`],
    ['How long we keep it', `<p>For as long as you have an account. When you ask us to delete it, we do so within 30 days, and the copies in our backups are gone a week later. Payment records stay for 7 years, because Estonian accounting law says so.</p>`],
    ['Your rights', `<p>You can ask us to show you what we hold about you, correct it, delete it, give you a copy to take elsewhere, or stop using it for something you object to. Email ${mail} and we will answer within a month. You can stop our emails from the link in any of them.</p><p>If you think we got it wrong, you can complain to the Estonian Data Protection Inspectorate at <a href="https://www.aki.ee/en" target="_blank" rel="noopener">aki.ee</a>, or to the one where you live.</p>`],
    ['The drug data', `<p>The landscapes come from public sources: ${SOURCES}. They contain no personal data about you.</p>`],
    ['Contact', `<p>Questions about privacy: ${mail}.</p>`],
  ],
});

export const termsPage = ({ user } = {}) => page({
  user, title: 'Terms', other: ['/privacy', 'Read the Privacy policy'],
  intro: `The short version: use ${BRAND} for your research, check important facts at the source, and be fair with the free plan.`,
  rows: [
    ['Who we are', whoWeAre],
    ['Who it is for', `<p>${BRAND} is made for work. You must be 18 or older to use it. If you sign up for a company, you confirm you may accept these terms for it.</p>`],
    ['The data', `<p>Landscapes are built from ${SOURCES}. Every fact links to its source, and anything we have not confirmed is marked. We work to keep it right, but it can be incomplete or out of date. Check the source before you rely on a fact. Nothing here is medical, legal or investment advice. We provide ${BRAND} as it is, with no promises beyond these terms.</p>`],
    ['Using what you find', `<p>Use it in your own work, including slides and reports for your clients. Name ${BRAND} as the source, with a link where you can. Do not copy the data in bulk, resell it, build a rival database from it, or use it to train AI models.</p>`],
    ['Your account', `<p>One account per person. Keep your API keys private: anyone with a key can use your account. If a key leaks, revoke it on your dashboard.</p>`],
    ['Fair use', `<p>The free plan has the limits shown on the <a href="/pricing">pricing page</a>. Do not try to get around them, overload the service, or resell access. We may suspend accounts that do.</p>`],
    ['Paid plans', `<p>A Solo plan is for one named person. Payments go through Stripe. Prices do not include VAT; where VAT applies, it is added at checkout. Solo renews every month until you cancel. Cancel any time in Settings, under Billing; you keep Solo until the end of the time you paid for. We do not refund part months or part years. If something went wrong, write to us and we will sort it out.</p><p>If you buy Solo as a consumer (for yourself, not for work), you can cancel within 14 days of your first payment and get it back in full, unless you have already downloaded a list or opened 1,000 or more different drugs. Solo starts as soon as you pay, so checkout asks you to agree to this.</p><p>If we raise a price, we email you at least 30 days before it applies to you.</p>`],
    ['What we are responsible for', `<p>We are not responsible for decisions you make with the data, or for lost profits, lost business or other indirect loss. Our total responsibility to you is what you paid us in the 12 months before the claim, or €50 if you paid nothing.</p><p>This does not limit what the law does not let us limit, such as harm we cause on purpose or through gross negligence, or your rights as a consumer.</p>`],
    ['Ending', `<p>You can stop using ${BRAND} and ask us to delete your account at any time. We can suspend or close an account that breaks these terms. If we ever close ${BRAND}, we will email you at least 30 days before, and refund any paid time you could not use.</p>`],
    ['Open source', `<p>The server code is open source under the AGPL, and the client and Claude skill under the MIT licence. Those licences cover the code. These terms cover this hosted service.</p>`],
    ['Changes', `<p>We may update these terms as the product grows. If a change matters, we will email account holders before it applies.</p>`],
    ['Which law', `<p>These terms fall under Estonian law, and disputes go to Harju County Court in Tallinn. If you are a consumer, you keep the rights the law of your own country gives you, and can go to court there.</p>`],
    ['Contact', `<p>${mail}</p>`],
  ],
});
