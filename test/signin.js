// Sign-up from the landing page search (specs 14 and 16): the search travels through sign-in, in the email link and in the form;
// the email's 6-digit code signs in once; wrong codes run out; an expired link offers a new one. On a throwaway database.
import { tempDir } from './tmp.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const PORT = 8000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
const DB_PATH = join(tempDir('ol-signin-'), 'test.db');
const env = { ...process.env, PORT, DB_PATH, PUBLIC_URL: '', DASHBOARD_URL: '', COOKIE_DOMAIN: '', NODE_ENV: 'test', RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' };
const srv = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
await new Promise((ok, fail) => { srv.stdout.on('data', () => /running on/.test(log) && ok()); srv.on('exit', c => fail(new Error('server exited ' + c))); });

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const form = o => new URLSearchParams(o);
const get = (path, opts = {}) => fetch(BASE + path, { redirect: 'manual', ...opts });
const post = (path, o) => fetch(BASE + path, { method: 'POST', redirect: 'manual', body: form(o) });
const session = r => r.headers.getSetCookie().some(c => /^op_session=[^;]+/.test(c));
const sent = async () => { await new Promise(r => setTimeout(r, 50)); const m = [...log.matchAll(/Sign-in link for (\S+): (\S+)\s+code (\d{6})/g)].pop(); return { link: m[2], code: m[3] }; };
const results = '/app/search?q=heart%20failure&p=2';
let t0;

try {
  let r = await get('/start?q=heart%20failure');
  ok(r.status === 302 && r.headers.get('location') === `/signin?next=${encodeURIComponent(results + '&s=landing')}`, 'landing search, signed out: to sign-up with the search kept');
  const page = await (await get(r.headers.get('location'))).text();
  ok(page.includes('<h1>See the drugs for heart failure</h1>') && page.includes('Make a free account to see them.') && page.includes('You agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.'), 'sign-up page names the search');
  ok(!/<a class="signin" href="\/signin">/.test(page), 'no "Sign in" in the top bar of the sign-in page');
  t0 = await (await get('/signin')).text();
  ok(t0.includes('<h1>Sign in or sign up</h1>') && t0.includes('Free, no card, no password.'), 'plain sign-in: "Sign in or sign up"');
  ok(page.includes(`name="next" value="${(results + '&s=landing').replace(/&/g, '&amp;')}"`), 'the search rides in the form');

  r = await post('/auth/start', { email: 'ana@example.com', next: results });
  let t = await r.text();
  ok(t.includes('<h1>Check your inbox</h1>') && t.includes('Sent to <b>ana@example.com</b>.'), 'email sent: link and code');
  let { link, code } = await sent();
  ok(link.includes('&next=' + encodeURIComponent(results)), 'the search travels in the email link');

  r = await post('/auth/code', { email: 'ana@example.com', code: code === '000000' ? '111111' : '000000', next: results });
  ok(!session(r) && (await r.text()).includes('Wrong code.'), 'wrong code: no session, one plain line');
  r = await post('/auth/code', { email: 'ana@example.com', code, next: results });
  ok(session(r) && /^\/app\/welcome\?q=/.test(r.headers.get('location')), 'right code signs a new account in and opens onboarding on that search');
  r = await post('/auth/code', { email: 'ana@example.com', code, next: results });
  ok(!session(r), 'a code works once');
  r = await get(link.replace(BASE, ''));
  t = await r.text();
  ok(!session(r) && t.includes('This link no longer works') && t.includes('Your search is still waiting.') && t.includes('ana@example.com'), 'used link: expired page offers a new one to the same address');

  await post('/auth/start', { email: 'bo@example.com' });
  ({ link, code } = await sent());
  for (let i = 0; i < 5; i++) await post('/auth/code', { email: 'bo@example.com', code: String((+code + 1 + i) % 1e6).padStart(6, '0') });
  r = await post('/auth/code', { email: 'bo@example.com', code });
  ok(!session(r), 'five wrong codes end the code');
  // Step 10: opening the link only asks (work mail opens every link to scan it); the page's button signs in.
  r = await get(link.replace(BASE, ''));
  t = await r.text();
  ok(!session(r) && t.includes('<h1>Sign in</h1>') && t.includes('As <b>bo@example.com</b>.') && t.includes('action="/auth/verify"'), 'opening the link asks first: no session yet');
  await get(link.replace(BASE, ''));
  const token = new URL(link).searchParams.get('token');
  r = await post('/auth/verify', { token });
  ok(session(r) && r.headers.get('location') === '/app/welcome', 'the link still works after the code ran out and after being opened twice; a new account with no search starts onboarding');
  r = await post('/auth/verify', { token });
  ok(!session(r) && (await r.text()).includes('This link no longer works'), 'the link works once');
  await post('/auth/start', { email: 'ed@example.com' });
  ({ link, code } = await sent());
  await get(link.replace(BASE, '')); await get(link.replace(BASE, ''));
  r = await post('/auth/code', { email: 'ed@example.com', code });
  ok(session(r), 'a mail scanner opening the link does not use up the code');

  r = await post('/auth/start', { email: 'cy@example.com' }); await post('/auth/start', { email: 'cy@example.com' }); await post('/auth/start', { email: 'cy@example.com' });
  r = await post('/auth/start', { email: 'cy@example.com' });
  ok((await r.text()).includes('Already sent.'), 'too many emails: one plain line');
  ok((await (await post('/auth/start', { email: 'cy@example' })).text()).includes('That email looks wrong.'), 'bad address: one plain line');

  // Follow signed out (screen 4): the sign-in page (and the box over the page) names what is followed.
  r = await get('/follow?q=heart%20failure&p=2');
  ok(r.headers.get('location') === '/signin?next=' + encodeURIComponent('/follow?q=heart%20failure&p=2'), 'Follow signed out without scripts: sign in first');
  t = await (await get(r.headers.get('location'))).text();
  ok(t.includes('<h1>Follow Heart failure</h1>'), 'the sign-in page names the landscape followed');
  // The box's forms come back as the box's next state, and as { go } once signed in.
  const boxPost = (path, o) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'X-Signin-Box': '1' }, body: form(o) });
  const follow = '/follow?q=heart%20failure&p=2';
  t = await (await boxPost('/auth/start', { email: 'di@example.com', next: follow })).text();
  ok(t.startsWith('<button class="x"') && t.includes('<h1 id="signbox-t">Check your inbox</h1>') && !t.includes('<html'), 'box: "Check your inbox" inside the box, no page around it');
  ({ code } = await sent());
  r = await boxPost('/auth/code', { email: 'di@example.com', code, next: follow });
  const di = r.headers.getSetCookie().find(c => c.startsWith('op_session=')).split(';')[0];
  ok(session(r) && (await r.json()).go === follow, 'box: the right code signs in and goes on to the follow');
  // decision 1: a new Free account lands on the list with only the free offer
  r = await get(follow, { headers: { cookie: di } });
  ok(r.headers.get('location') === '/app/search?q=heart%20failure&p=2', 'new Free account: Follow opens the list, no Solo notice');
  r = await get('/follow?q=obesity&p=2', { headers: { cookie: di } });
  ok(/notice=/.test(r.headers.get('location')), 'a ready-made landscape keeps the Solo notice');
  // A Follow link from another site follows nothing on its own: one Follow button that posts back (no CSRF through a link).
  const follows = async () => (await (await get('/api/follow', { headers: { cookie: di } })).json()).followed.length;
  const before = await follows();
  r = await get('/follow?q=asthma&p=2', { headers: { cookie: di, 'sec-fetch-site': 'cross-site' } });
  t = await r.text();
  ok(r.status === 200 && t.includes('<h1>Follow Asthma?</h1>') && t.includes('<form method="post" action="/follow">') && t.includes('name="q" value="asthma"') && await follows() === before, 'Follow from another site: a confirm button, nothing followed yet');
  r = await fetch(BASE + '/follow', { method: 'POST', redirect: 'manual', headers: { cookie: di }, body: form({ q: 'heart failure', p: 2 }) });
  ok(r.headers.get('location') === '/app/search?q=heart%20failure&p=2', 'the confirm button goes on like a Follow press');
  r = await fetch(BASE + '/follow', { method: 'POST', redirect: 'manual', headers: { cookie: di, 'sec-fetch-site': 'cross-site' }, body: form({ q: 'asthma', p: 2 }) });
  ok(r.status === 403, 'a Follow form sent from another site is refused');
  // Choose Solo signed out: sign in, then straight to payment
  r = await get('/billing/solo');
  ok(r.headers.get('location') === '/signin?next=%2Fbilling%2Fsolo', 'Choose Solo signed out: sign in first');
  t = await (await get(r.headers.get('location'))).text();
  ok(t.includes('<h1>Choose Solo</h1>') && t.includes('Payment comes right after.'), 'the sign-in page says payment comes right after');
  t = await (await get('/pricing')).text();
  ok(t.includes('href="/billing/solo"'), 'Pricing signed out: Choose Solo goes through /billing/solo');
  t = await (await get('/app', { headers: { cookie: di } })).text();
  ok(t.includes('id="guide-data"') && t.includes('"Pick your free landscape"') && !t.includes('Get started') && !t.includes('"monday"') && !t.includes('id="hform"'), 'new Free Home: the setup guide (Free steps, no Monday one), no search bar');
  // The setup guide: on the website's pages too while signed in; hidden for good from its own link, back from Settings.
  ok((await (await get('/how-we-check', { headers: { cookie: di } })).text()).includes('id="guide-data"'), 'setup guide on a signed-in website page');
  const guidePost = hidden => fetch(BASE + '/api/guide', { method: 'POST', headers: { cookie: di, 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }) });
  await guidePost(1);
  t = await (await get('/app', { headers: { cookie: di } })).text();
  ok(!t.includes('id="guide-data"') && t.includes('id="showguide"'), 'hidden: no guide, Settings offers to show it');
  await guidePost(0);
  t = await (await get('/app', { headers: { cookie: di } })).text();
  ok(t.includes('id="guide-data"') && !t.includes('id="showguide"'), 'shown again from Settings');
  // The Open step (17 Nov): after Pick, waiting for it; Home tells the phone pill it is Home; opening what they picked ticks it.
  const guideOf = h => { const m = h.match(/<script type="application\/json" id="guide-data">(.*?)<\/script>/); return m && JSON.parse(m[1]); };
  const stepOf = (h, id) => guideOf(h)?.sections.flatMap(x => x.steps).find(x => x.id === id);
  let g = guideOf(t);
  ok(g.home === true && g.sections[0].steps.map(x => x.id).join() === 'pick,open,search' && stepOf(t, 'open').after === 'pick' && !stepOf(t, 'open').done, 'guide: Open your landscape after Pick, not done; Home says it is Home');
  ok(guideOf(await (await get('/how-we-check', { headers: { cookie: di } })).text()).home === false, 'guide: other pages are not Home');
  r = await fetch(BASE + '/app/welcome/keep', { method: 'POST', redirect: 'manual', headers: { cookie: di }, body: form({ q: 'psoriasis', p: 2 }) });
  ok(/^\/app\/welcome\?step=2/.test(r.headers.get('location') || ''), 'guide: picked a free landscape (psoriasis)');
  t = await (await get('/app', { headers: { cookie: di } })).text();
  const openStep = stepOf(t, 'open');
  ok(stepOf(t, 'pick').done && !openStep.done && openStep.title === 'Open Psoriasis' && openStep.act[1], 'guide: after picking, Open Psoriasis is next, with a link to it');
  t = await (await get(openStep.act[1].replace(/&amp;/g, '&'), { headers: { cookie: di } })).text();
  ok(stepOf(t, 'open')?.done && stepOf(t, 'open').fresh, 'guide: opening it ticks Open on that page');
  t = await (await get('/app', { headers: { cookie: di } })).text();
  ok(stepOf(t, 'open').done && !stepOf(t, 'open').fresh, 'guide: Open stays ticked');
  // pages that are not there
  r = await get('/drugs/no-such-drug');
  t = await r.text();
  ok(r.status === 404 && t.includes('<h1>No drug at this address</h1>') && t.includes('Ready-made landscapes'), 'a missing drug: a real 404 page, signed out with the ready-made landscapes');
  r = await get('/drugs/no-such-drug', { headers: { cookie: di } });
  t = await r.text();
  ok(r.status === 404 && t.includes('class="side"') && t.includes('id="hform"'), 'signed in: the 404 page in the sidebar, with the search bar');
  r = await get('/nope');
  ok(r.status === 404 && (await r.text()).includes('<h1>Page not found</h1>'), 'an unknown address: Page not found');
  r = await get('/api/nope');
  ok(r.status === 404 && (await r.text()) === 'Not found', 'API addresses keep the bare answer');

  ok((await get('/docs/read-test')).headers.get('location') === '/how-we-check', 'the raw test report is gone; its address leads to How we check');
  t = await (await get('/how-we-check')).text();
  ok(t.includes('<h1>How we check</h1>') && t.includes('What it does not promise') && !/READ_TEST|\.mjs|\b[a-z]+-\d\.\d\b/i.test(t), 'How we check: plain words, no file or model names');
  t = await (await get('/talk')).text();
  ok(t.includes('<h1>Talk to us</h1>'), 'Talk to us page');
  t = await (await post('/talk', { email: 'ana@example.com', company: 'Northwind', message: '' })).text();
  ok(t.includes('Tell us in a sentence what you need.'), 'Talk to us: nothing written');
  t = await (await post('/talk', { email: 'ana@example.com', company: 'Northwind', message: 'Three landscapes, one invoice.' })).text();
  ok(t.includes('Thanks, we have your message') && t.includes('ana@example.com') && /Talk to us\n/.test(log), 'Talk to us: sent, saved and passed on');

  // Another form of an existing account's address: the usual "sent" screen (the page never says an account exists), and a
  // note, not a code, to that address.
  t = await (await post('/auth/start', { email: 'ana+x@example.com' })).text();
  await new Promise(r => setTimeout(r, 50));
  ok(t.includes('<h1>Check your inbox</h1>') && !t.includes('already have an account') && /Variant note for ana\+x@example\.com/.test(log) && !/Sign-in link for ana\+x@/.test(log), '+tag of an account: same screen as a new address, a note instead of a code');
  // Talk to us and the landscape wish list: capped per internet address.
  let talkFails = 0;
  for (let i = 0; i < 6; i++) if ((await (await post('/talk', { email: `t${i}@example.com`, message: 'Hello' })).text()).includes('Thanks, we have your message') === false) talkFails++;
  ok(talkFails === 2, 'at most 5 Talk to us messages an hour from one internet address');
  const wish = () => fetch(BASE + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'w@example.com', area: 'gout' }) });
  const codes = []; for (let i = 0; i < 21; i++) codes.push((await wish()).status);
  ok(codes.slice(0, 20).every(c => c === 200) && codes[20] === 429, 'at most 20 landscape wishes an hour from one internet address');

  // Safety: no way out to another site after sign-in, no sign-in from another site's form, and a cap on sign-in emails.
  await post('/auth/start', { email: 'esc@example.com', next: '/\\evil.example' });
  ok(!(await sent()).link.includes('next='), 'a next address starting /\\ (read by browsers as another site) is dropped');
  r = await fetch(BASE + '/auth/start', { method: 'POST', redirect: 'manual', body: form({ email: 'csrf@example.com' }), headers: { 'sec-fetch-site': 'cross-site' } });
  ok(r.status === 403, 'a sign-in form sent from another site is refused');
  let capped = 0;
  for (let i = 0; i < 12; i++) if ((await (await post('/auth/start', { email: `cap${i}@example.com` })).text()).includes('Already sent.')) capped++;
  ok(capped >= 2, 'at most 10 sign-in emails an hour from one internet address');
} finally { srv.kill(); }
