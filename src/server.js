// One small web server: public pages, dashboard, JSON API, Stripe and the MCP endpoint.
import './env.js';
import express from 'express';
import { readFileSync } from 'node:fs';
import { getDb } from './db.js';
import * as Q from './query.js';
import * as A from './auth.js';
import * as B from './billing.js';
import { sendLoginEmail, sendTalkMessage, sendVariantNote } from './mail.js';
import { handleMcp, setLinkFor } from './mcp.js';
import { oauthRouter } from './oauth.js';
import { timingSafeEqual, createHash } from 'node:crypto';
import { breakdown, diseaseMap } from './diseasemap.js';
import { termSlug } from './diseasemap.js';
import { BRAND, layout } from './pages/shared.js';
import { landingPage, pricingPage, howWeCheckPage, bakeoffPage, talkPage } from './pages/public.js';
import { landscapePage, diseasePage, landscapesIndexPage } from './pages/landscapes.js';
import { signinPage, signinBox } from './pages/signin.js';
import { notFoundPage } from './pages/notfound.js';
import { startPage, WELCOME_PATH, pickTo } from './pages/start.js';
import { connectPage, demoTerminal, setupPrompt } from './pages/connect.js';
import { appPage } from './pages/app.js';
import { guideTag } from './pages/guide.js';
import { sidebar, appPath, searchHref, planName } from './pages/frame.js';
import { drugPage, companyPage, targetPage, drugHref, companyHref } from './pages/entities.js';
import * as E from './entityquery.js';
import { toCSV, drugName, creditLine, creditDay, creditPath, esc, limitBox } from '../web/table.js';
import * as G from './google.js';
import { privacyPage, termsPage } from './legal.js';
import { runMail, mailRouter, sendUpgrade, sendHello } from './digest.js';
import { runWatch } from './watch.js';
import * as V from './visits.js';
import { alertJobs } from './jobrun.js';
import * as LIM from './limits.js';
import { imageRouter, overviewSlideSvg, tableSlideSvg, slidePng, slideTitle } from './images.js';
import { loadFilings } from './ingest/edgar.js';
import * as R from './review.js';
import * as ADM from './admin.js';
import { country } from './country.js';
import { suggest, heading, didYouMean } from './suggest.js';

const PORT = +(process.env.PORT || 8080);
const PROD = process.env.NODE_ENV === 'production';
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
getDb();

const origin = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
// Public site and dashboard can live on two addresses (openlandscape.app and dashboard.openlandscape.app).
// Without DASHBOARD_URL (local), everything stays on one address and the dashboard is at /app.
const DASH = process.env.DASHBOARD_URL || '';
const DASH_HOST = DASH && new URL(DASH).hostname;
const dashOrigin = req => DASH || origin(req);
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(c => c[0]));
const COOKIE = 'op_session';
// Shared by both addresses so the public site knows you are signed in, e.g. Domain=openlandscape.app
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ? `; Domain=${process.env.COOKIE_DOMAIN}` : '';
// Asked by the address check and again by the page: looked up once per request.
const currentUser = req => (req._user !== undefined ? req._user : (req._user = A.userFromSession(cookies(req)[COOKIE])));
const setSession = (res, token) => res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}${COOKIE_DOMAIN}${PROD ? '; Secure' : ''}`);
const okEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const needUser = (req, res, next) => { const u = currentUser(req); if (!u) return res.status(401).json({ error: 'Sign in first.' }); req.user = u; next(); };

// After a Solo checkout is recorded (payment page or webhook): the upgrade email, if it is due. Never holds up the page.
const afterCheckout = r => { if (r?.uid) sendUpgrade(r.uid).catch(e => console.error('upgrade email', e.message)); };
// Stripe webhook needs the raw body, so it is registered before the JSON parser
app.post('/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try { const t = await B.handleWebhook(req.body, req.headers['stripe-signature'], afterCheckout); res.json({ received: t }); }
  catch (e) { console.error('webhook', e.message); res.status(400).send(e.message); }
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
// A page loaded in a browser (src/visits.js): counted, nothing sent back.
app.post('/v', (req, res) => {
  try { V.recordView(req.body, { ip: req.ip, ua: req.get('user-agent') || '', user: currentUser(req), host: req.get('host') || '' }); }
  catch (e) { console.error('visit', e.message); }
  res.status(204).end();
});
// Send each page to its own address. Only GET/HEAD are redirected; MCP, billing and static files work on both.
const DASH_ONLY = /^\/(app(\/|$)|start(\/|$)|signin|auth\/|follow(\/|$)|api\/(landscape|suggest|follow|changes|areas|keys|connection))/;
const BOTH = /^\/(static|mcp|billing|admin|authorize|oauth\/|\.well-known\/|robots\.txt$|sitemap\.xml$)/;
// Data pages (drug, company, disease, target, landscape) live on both: signed in on the dashboard's address, inside its
// sidebar; signed out on the website's. 302, not 301: the answer depends on the visitor, so browsers must not keep it.
const DATA_PAGE = /^\/(drugs|companies|targets|diseases|landscapes)(\/|$)/;
if (DASH) app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || BOTH.test(req.path)) return next();
  const onDash = req.hostname === DASH_HOST;
  if (DATA_PAGE.test(req.path)) {
    const signedIn = !!currentUser(req);
    if (signedIn && !onDash) return res.redirect(302, DASH + req.originalUrl);
    if (!signedIn && onDash) return res.redirect(302, process.env.PUBLIC_URL + req.originalUrl);
    return next();
  }
  if (onDash && req.path === '/') { req.url = '/app' + req.url.slice(1); return next(); }
  // The dashboard's own pages on its address: /l/12, /search and /welcome are /app/l/12, /app/search and /app/welcome.
  if (onDash && /^\/(l\/[^/]+|search|welcome)\/?$/.test(req.path)) { req.url = '/app' + req.url; return next(); }
  if (onDash && !DASH_ONLY.test(req.path)) return res.redirect(301, process.env.PUBLIC_URL + req.originalUrl);
  if (!onDash && DASH_ONLY.test(req.path)) return res.redirect(302, DASH + (req.originalUrl.replace(/^\/app\/?/, '/')));
  next();
});
// Pages ask for the stylesheet and scripts with their version in the address (?v=, src/pages/shared.js): those are kept for a
// year without asking again, since a deploy changes the version. Asked for without a version, they are checked with the server
// on every load (a quick "not changed" reply), so nothing ever runs old. Fonts keep a year too: a changed font gets a new file
// name. Images keep an hour. On a local copy nothing is kept.
app.use('/static', express.static(new URL('../web/', import.meta.url).pathname, {
  maxAge: PROD ? '1h' : 0,
  setHeaders: (res, path) => {
    if (PROD && (res.req.query.v || /\/fonts\/.*\.woff2$/.test(path))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.(css|js)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
// Browsers and phones also ask for the tab and home-screen icons at the root.
for (const f of ['favicon.ico', 'apple-touch-icon.png']) app.get('/' + f, (req, res) => res.sendFile(new URL('../web/' + f, import.meta.url).pathname));

// ---------- MCP ----------
// Sign-in for the connector: discovery documents, /authorize, /token, /register, /revoke and the Allow page.
app.use(oauthRouter({ currentUser }));
app.post('/mcp/u/:key', handleMcp);
app.post('/mcp', handleMcp);
app.all(['/mcp', '/mcp/u/:key'], (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST (stateless Streamable HTTP).' }, id: null }));

// ---------- public pages ----------
// Landscapes, drug and company pages, changes and dates are kept and rebuilt every 10 minutes (the hourly jobs add SEC filings
// and regulator news; a new trials release restarts the server). An older copy is still served at once, and rebuilt just
// after the reply, so no visitor waits for the rebuild.
const cache = new Map();
const stale = new Set();
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 600_000) return hit.v;
  if (hit) {
    if (!stale.has(key)) { stale.add(key); setImmediate(() => { stale.delete(key); try { keep(key, fn()); } catch (e) { console.error('refresh', key, e.message); } }); }
    return hit.v;
  }
  return keep(key, fn());
}
function keep(key, v) {
  cache.delete(key); cache.set(key, { v, t: Date.now() });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);   // drug/company pages: keep memory bounded
  return v;
}
const PUBLIC = {
  // chips: filters on the table (by drug tags); ask: example question for Claude; bakeoff: we tested this area against Claude with web search.
  // plain: the landscape's name for people outside the field (search page chips).
  obesity: { area: 'obesity', title: 'Obesity drug landscape', plain: 'Obesity drugs', short: 'Obesity', crumb: 'Metabolic', bakeoff: true,
    chips: [['glp', 'GLP-1 based'], ['amylin', 'Amylin'], ['oral', 'Oral'], ['other', 'Other mechanisms']],
    ask: 'Which oral GLP-1s read out in the next six months?' },
  'pd1-vegf': { area: 'PD-1/VEGF', title: 'PD-(L)1 x VEGF bispecifics landscape', plain: 'Cancer drugs that block PD-1 and VEGF at once', short: 'PD-1/VEGF', crumb: 'Oncology',
    ask: 'Which PD-1/VEGF bispecifics are in Phase 3, and which trial reads out first?' },
  // Almost every in vivo CAR-T program is in Phase 1, so this page starts at Phase 1.
  'invivo-cart': { area: 'in vivo CAR-T', title: 'In vivo CAR-T landscape', plain: 'CAR-T made inside the body', short: 'CAR-T made inside the body', crumb: 'Cell therapy', phase_min: 1,
    ask: 'Which companies run in vivo CAR-T trials, and in which countries?' },
  // The fourth showcase (spec 16): Phase 3 and later, since lung cancer has hundreds of earlier drugs.
  nsclc: { area: 'non-small cell lung cancer', title: 'Non-small cell lung cancer drug landscape', plain: 'Non-small cell lung cancer', short: 'Non-small cell lung cancer', crumb: 'Oncology', phase_min: 3,
    ask: 'Which Phase 3 lung cancer trials read out in the next six months?' },
};

// Images drawn on the server (logo for emails, welcome ridge, link previews) and the unsubscribe links of the newer emails.
app.use(imageRouter({ landscapes: PUBLIC }));
// The AI answers' source line links a ready-made landscape to its page, anything else to its search.
setLinkFor(area => { const k = String(area || '').trim().toLowerCase(), s = Object.keys(PUBLIC).find(x => PUBLIC[x].area.toLowerCase() === k); return s ? creditPath({ slug: s }) : area ? creditPath({ area }) : ''; });
app.use(mailRouter());

const demo = () => cached('demo', () => demoTerminal(Q.landscape({ area: 'oral GLP-1', phase_min: 3 })));
// A checked landscape at its own stage (p.phase_min, else Phase 2), or at another one: /landscapes/obesity?p=1.
const stageOf = (p, q) => ([1, 2, 3].includes(+q) ? +q : p.phase_min || 2);
const showL = (p, pm = p.phase_min || 2) => cached('L:' + p.area + (pm === (p.phase_min || 2) ? '' : '|' + pm), () => Q.landscape({ area: p.area, phase_min: pm }));
const showcaseList = () => Object.entries(PUBLIC).map(([slug, p]) => ({ slug, ...p, L: showL(p) }));
const daysAgo = n => new Date(Date.parse(Q.today()) - n * 864e5).toISOString().slice(0, 10);
// Where the landing search and "See the drugs" lead: the person's results on Home (signed in), or sign-up first.
const resultsPath = q => searchHref(q, 2);
// The public address on source lines ("https://openlandscape.app"); locally the address the page was asked on.
const siteUrl = req => origin(req).replace(/\/$/, '');
const csvName = base => `${String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-openlandscape-${new Date().toISOString().slice(0, 10)}.csv`;
// A CSV has at most this many drugs (the most advanced first): only "all cancer" is bigger.
const CSV_ROWS = 2000;
// A CSV's drugs count toward the account's different drugs (src/limits.js); past the allowance downloads pause, and the page
// shows why (web/table.js limitBox). Returns the rows to send, or null when the answer has been sent.
function csvRows(user, res, programs) {
  const rows = programs.slice(0, CSV_ROWS), u = LIM.useDrugs(user, rows.map(p => p.id));
  if (u.ok) { A.logUsage(user.id, 'csv', rows.length); return rows; }   // a CSV ends the 14-day refund (src/billing.js refundCheck)
  res.status(429).json({ error: u.msg, limit: u.note });
  return null;
}
// A CSV cut at CSV_ROWS says so in its last lines, above the source line.
const cutLine = (shown, total) => (total > shown ? `First ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} drugs, furthest along first.` : '');
// What a list shows past the allowance (src/limits.js): a paid account the top 10, Free none.
const overRows = (user, programs) => programs.slice(0, A.isPaid(user) ? LIM.TOP_WHEN_OVER : 0);
// Public pages opened signed out (drug, company, target, disease and ready-made landscape pages): 60 an hour and 200 a day
// per computer, then the sign-in page, which brings them back here. Google and Bing, checked by their address, pass.
const PUBLIC_PAGE = /^\/(drugs|companies|targets|diseases)\/[^/]+$|^\/landscapes\/[^/.]+$/;
app.use(async (req, res, next) => {
  if (req.method !== 'GET' || !PUBLIC_PAGE.test(req.path) || currentUser(req)) return next();
  if (await LIM.isSearchBot(req.get('user-agent'), req.ip)) return next();
  if (LIM.countPage(req.ip, new Date(), req.get('user-agent'))) return next();
  res.redirect(302, `/signin?limit=1&next=${encodeURIComponent(req.originalUrl)}`);
});
app.get('/', (req, res) => {
  const L = showL(PUBLIC.obesity);
  const changes = cached('X:obesity', () => Q.changes({ area: 'obesity', phase_min: 2, since: daysAgo(180) }).items.slice(0, 3));
  const coming = cached('K:obesity', () => Q.catalysts({ area: 'obesity', phase_min: 2, days_ahead: 60, limit: 3 }).catalysts);
  res.send(landingPage(L, { user: currentUser(req), changes, coming, showcase: showcaseList(), demo: demo() }));
});
// The landing page search. There is no search without an account: signed out, it goes to sign-up with the search kept.
app.get('/start', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) return res.redirect('/');
  if (currentUser(req)) return res.redirect(resultsPath(q));
  res.redirect(`/signin?next=${encodeURIComponent(resultsPath(q) + '&s=landing')}`);
});
app.get('/landscapes', (req, res) => {
  const user = currentUser(req);
  res.send(landscapesIndexPage(showcaseList(), { user, paid: !!user && A.isPaid(user), side: sideFor(user) }));
});
// Downloads are part of Solo (15 Nov 2026: this file was open to anyone before, though its button was Solo only). Signed out it
// asks to sign in; on Free it shows Pricing.
app.get('/landscapes/:slug.csv', (req, res) => {
  const p = PUBLIC[req.params.slug]; if (!p) return res.status(404).send('Not found');
  const user = currentUser(req);
  if (!user) return res.redirect(302, `/signin?next=${encodeURIComponent(`/landscapes/${req.params.slug}`)}`);
  if (!A.isPaid(user)) return res.redirect(302, '/pricing');
  const rows = csvRows(user, res, showL(p).programs);
  if (!rows) return;
  res.type('text/csv').attachment(csvName(req.params.slug)).send(toCSV(rows, { note: cutLine(rows.length, showL(p).stats.programs), credit: creditLine(siteUrl(req) + creditPath({ slug: req.params.slug })) }));
});
app.get('/landscapes/:slug', (req, res) => {
  const p = PUBLIC[req.params.slug]; if (!p) return notFound(req, res, 'landscape');
  // One address per stage: ?p= the page's own stage (or a stage we do not offer) is the plain address.
  if ('p' in req.query && stageOf(p, req.query.p) === (p.phase_min || 2)) return res.redirect(301, req.path);
  const pm = stageOf(p, req.query.p), L = showL(p, pm);
  const user = currentUser(req);
  // Signed in, this is also the page a followed checked landscape opens at (its sidebar item is marked).
  const following = user ? followedAreas(user.id).find(f => !f.kind && f.query.trim().toLowerCase() === p.area.toLowerCase()) : null;
  const paid = !!user && A.isPaid(user);
  res.send(landscapePage(L, { user, paid, following, parts: following ? homeParts(following, paid) : null, side: sideFor(user, following ? 'l' + following.id : ''), slug: req.params.slug, ...p, phase_min: pm, own_phase: p.phase_min || 2, signin: boxFor(req, user) }));
});
// The drug list of a company or target page. Signed out: the top 20 and "sign in to see all" (15 Nov 2026: these pages were
// full lists for anyone). Signed in: the full list, counted toward the account's different drugs; past the allowance the
// top 20, and the meter above the list says why. Returns null for the full list, else { rows, after, top } (after: the box under
// the rows, signed out; top: the meter above the list, signed in).
const PAGE_TOP = 20;
function listCut(user, programs, next) {
  if (user) {
    const u = LIM.useDrugs(user, programs.map(p => p.id));
    if (u.ok) return null;
    const then = { tomorrow: 'The rest open tomorrow.', later: 'The rest open as room frees up.', free: 'Solo shows every list in full.' }[u.note.when];
    return { rows: programs.slice(0, PAGE_TOP), top: limitBox({ ...u.note, say: `Showing the top ${PAGE_TOP} of ${programs.length}. ${then}` }) };
  }
  if (programs.length <= PAGE_TOP) return null;
  return { rows: programs.slice(0, PAGE_TOP), after: `<div class="offer"><h3>See all ${programs.length} drugs</h3><p>Sign in free to see the whole list. No card, no password.</p><a class="btn primary" href="/signin?next=${encodeURIComponent(next)}">Sign in free</a></div>` };
}
app.get('/drugs/:id', (req, res) => {
  const d = cached('D:' + req.params.id, () => Q.drug(req.params.id));
  if (!d) return notFound(req, res, 'drug');
  // The hand-checked landscapes this drug is in, for the crumbs
  const inLandscapes = Object.entries(PUBLIC).filter(([, p]) => cached('L:' + p.area, () => Q.landscape({ area: p.area, phase_min: p.phase_min || 2 })).programs.some(x => x.id === d.id))
    .map(([slug, p]) => ({ slug, title: p.title.replace(/( drug)? landscape$/, '') }));
  const user = currentUser(req), paid = !!user && A.isPaid(user), following = followOf(user, 'drug', d.id);
  // Signed in, the drug counts toward the account's different drugs (src/limits.js); signed out, the page limit applies.
  const u = user ? LIM.useDrugs(user, [d.id]) : { ok: true };
  if (!u.ok) {
    const title = { tomorrow: 'This drug opens tomorrow', later: 'This drug opens as room frees up', free: 'This drug is past your free drugs' }[u.note.when];
    return res.status(429).send(notFoundPage({ kind: 'limit', user, title, box: limitBox({ ...u.note, say: "Anything you've already opened works as usual." }), side: sideFor(user), showcase: [] }));
  }
  res.send(drugPage(d, { user, paid, following, notice: entityNotice(req, user), trials: cached('DT:' + d.id, () => E.drugTrials(d)), euStage: E.euStage(d.id), inLandscapes, side: sideFor(user, following ? 'l' + following.id : ''), signin: boxFor(req, user) }));
});
app.get('/diseases/:slug', (req, res) => {
  const d = cached('DM:' + req.params.slug, () => breakdown(req.params.slug));
  if (!d) return notFound(req, res, 'disease');
  if (d.slug !== req.params.slug) return res.redirect(301, `/diseases/${d.slug}`);   // an old address (number first)
  const user = currentUser(req);
  res.send(diseasePage(d, { user, side: sideFor(user), updated: Q.dataDates().trials }));
});
app.get('/companies/:id', (req, res) => {
  const c = cached('CV:' + req.params.id, () => E.companyView(req.params.id));
  if (!c) return notFound(req, res, 'company');
  const user = currentUser(req), paid = !!user && A.isPaid(user), following = followOf(user, 'company', c.id);
  const cut = listCut(user, c.L.programs, req.originalUrl);
  res.send(companyPage(cut ? { ...c, L: { ...c.L, programs: cut.rows } } : c, { user, paid, following, notice: entityNotice(req, user), side: sideFor(user, following ? 'l' + following.id : ''), signin: boxFor(req, user), after: cut?.after || '', top: cut?.top || '' }));
});
app.get('/targets/:id', (req, res) => {
  let t = cached('T:' + req.params.id, () => Q.target(req.params.id));
  if (!t) return notFound(req, res, 'target');
  const user = currentUser(req);
  const following = user ? getDb().prepare('SELECT id FROM saved_landscape WHERE user_id=? AND kind IS NULL AND lower(query)=lower(?)').pluck().get(user.id, t.landscape.area) : null;
  const cut = listCut(user, t.landscape.programs, req.originalUrl);
  if (cut) t = { ...t, landscape: { ...t.landscape, programs: cut.rows } };
  res.send(targetPage(t, { after: cut?.after || '', top: cut?.top || '', user, paid: !!user && A.isPaid(user), following: following && { id: following, href: landHref({ id: following, query: t.landscape.area }) }, line: E.TARGET_LINES[String(t.id).toLowerCase()] || null, side: sideFor(user, following ? 'l' + following : ''), signin: boxFor(req, user) }));
});
app.get('/connect', (req, res) => {
  res.send(connectPage({ user: currentUser(req), origin: origin(req), demo: demo() }));
});
// Three real events beside the pricing headline: the two newest regulator decisions in the showcase landscapes, then the next date.
function pricingFeed() {
  return cached('pricingfeed', () => {
    const named = Object.values(PUBLIC).map(p => ({ p, name: p.short }));
    const done = named.flatMap(({ p, name }) => Q.changes({ area: p.area, phase_min: p.phase_min || 2, since: daysAgo(365) }).items
      .filter(i => ['approval', 'opinion'].includes(i.kind)).map(i => ({ ...i, in: name, agency: i.kind === 'opinion' || /^European/.test(i.text) ? 'EMA' : 'FDA' })));
    const seen = new Set(), news = done.sort((a, b) => b.date.localeCompare(a.date)).filter(i => !seen.has(i.drug) && seen.add(i.drug)).slice(0, 2);
    const next = named.flatMap(({ p, name }) => Q.catalysts({ area: p.area, phase_min: p.phase_min || 2, days_ahead: 30, limit: 3 }).catalysts.map(c => ({ ...c, in: name })))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return { news, next };
  });
}
app.get('/pricing', (req, res) => res.send(pricingPage({ user: currentUser(req), cancelled: req.query.cancelled, feed: pricingFeed(), today: Q.today() })));
// ChatGPT directory submission: OpenAI checks we own the domain by reading this token (set OPENAI_APPS_CHALLENGE on the server).
// For Google (step 12): robots.txt keeps it out of the app, sign-in and data calls and names the sitemap; the dashboard's own
// address is closed to it (signed out, its pages send people to the website anyway). The sitemap lists the pages Google may
// show: the website's own, the ready-made landscapes, every checked drug and company, and each disease page with active trials.
app.get('/robots.txt', (req, res) => {
  if (DASH && req.hostname === DASH_HOST) return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  res.type('text/plain').send(['User-agent: *', ...['/app', '/signin', '/auth/', '/api/', '/billing/', '/oauth/', '/authorize', '/follow', '/start', '/admin', '/mcp', '/unsubscribe'].map(p => `Disallow: ${p}`),
    '', `Sitemap: ${siteBase(req)}/sitemap.xml`, ''].join('\n'));
});
const siteBase = req => (process.env.PUBLIC_URL || origin(req)).replace(/\/$/, '');
app.get('/sitemap.xml', (req, res) => {
  const base = siteBase(req);
  const paths = cached('sitemap', () => {
    const db = getDb(), { nodes } = diseaseMap();
    return ['/', '/landscapes', '/pricing', '/connect', '/how-we-check', '/docs/bakeoff-obesity', ...Object.keys(PUBLIC).map(s => `/landscapes/${s}`),
      ...db.prepare('SELECT id FROM program WHERE curated=1 ORDER BY id').pluck().all().map(drugHref),
      ...db.prepare('SELECT id FROM company ORDER BY id').pluck().all().map(companyHref),
      ...[...nodes.values()].filter(n => n.active > 0).map(n => `/diseases/${termSlug(n.name)}`).sort()];
  });
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(p => `<url><loc>${esc(base + p)}</loc></url>`).join('\n')}\n</urlset>\n`);
});
// OpenAI's domain check for the ChatGPT app (16 Nov 2026). The token is public by design (OpenAI reads it here), so it lives in the code.
const OPENAI_CHALLENGE = process.env.OPENAI_APPS_CHALLENGE || 'T7k2KF-u05LGmxLv6OPM4Hdwf38RYg-B2_DLpQSWbFc';
app.get('/.well-known/openai-apps-challenge', (req, res) => res.type('text/plain').send(OPENAI_CHALLENGE.trim()));
app.get('/skill/SKILL.md', (req, res) => res.type('text/markdown').send(readFileSync(new URL('../client/skills/openlandscape/SKILL.md', import.meta.url), 'utf8')));
// The setup prompt that "Copy setup prompt" copies, for agents that would rather fetch it.
app.get('/setup.md', (req, res) => res.type('text/markdown').send(setupPrompt(origin(req))));
app.get('/privacy', (req, res) => res.send(privacyPage({ user: currentUser(req) })));
app.get('/terms', (req, res) => res.send(termsPage({ user: currentUser(req) })));
app.get('/docs/bakeoff-obesity', (req, res) => { const user = currentUser(req); res.send(bakeoffPage({ user, side: sideFor(user) })); });
// What "checked" means (spec 22), in place of the raw test report.
app.get('/how-we-check', (req, res) => { const user = currentUser(req); res.send(howWeCheckPage({ user, side: sideFor(user) })); });
app.get('/docs/read-test', (req, res) => res.redirect(301, '/how-we-check'));
// Talk to us (spec 20): one message, saved like the waitlist and emailed on. The same limit on repeated sends as sign-in.
// `back`: the page they came from, on our own addresses only, for the button after sending.
const backFrom = (req, v) => {
  try { const u = new URL(String(v || ''), origin(req)); return [origin(req), DASH, process.env.PUBLIC_URL].filter(Boolean).map(o => new URL(o).origin).includes(u.origin) && !/^\/talk\b/.test(u.pathname) ? u.href.slice(0, 300) : ''; } catch { return ''; }
};
// At most 5 messages an hour from one internet address and 50 in all (each is emailed to us); the landscape wish list 20 and
// 300. Kept in memory like the sign-in email cap below.
const talkAllowed = hourCap(5, 50), requestAllowed = hourCap(20, 300);
app.get('/talk', (req, res) => res.send(talkPage({ user: currentUser(req), back: backFrom(req, req.get('referer')) })));
app.post('/talk', async (req, res) => {
  const user = currentUser(req);
  const email = String(req.body.email || '').trim().slice(0, 200), company = String(req.body.company || '').trim().slice(0, 200), message = String(req.body.message || '').trim().slice(0, 5000);
  const form = { email, company, message }, back = backFrom(req, req.body.back);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.send(talkPage({ user, form, back, bad: 'email' }));
  if (!message) return res.send(talkPage({ user, form, back, bad: 'message' }));
  const db = getDb();
  const recent = db.prepare("SELECT count(*) FROM area_request WHERE email=? AND page='talk' AND created_at > datetime('now','-10 minutes')").pluck().get(email);
  if (recent >= 3 || !talkAllowed(req.ip)) return res.send(talkPage({ user, form, back, failed: true }));
  try {
    db.prepare("INSERT INTO area_request (email, area, role, page, referrer, message, company) VALUES (?,?,?,?,?,?,?)")
      .run(email, 'Talk to us', '', 'talk', String(req.get('referer') || '').slice(0, 300), message, company);
    await sendTalkMessage(form);
  } catch (e) { console.error('talk', e.message); return res.send(talkPage({ user, form, back, failed: true })); }
  res.send(talkPage({ user, back, sent: email }));
});

app.post('/api/request', (req, res) => {
  const { email = '', area = '', role = '', page = '' } = req.body || {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !area.trim()) return res.status(400).json({ error: 'Email and landscape are required.' });
  if (!requestAllowed(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again in an hour.' });
  getDb().prepare('INSERT INTO area_request (email, area, role, page, referrer) VALUES (?,?,?,?,?)')
    .run(email.trim().slice(0, 200), area.trim().slice(0, 200), String(role).slice(0, 40), String(page).slice(0, 100), String(req.get('referer') || '').slice(0, 300));
  res.json({ ok: true });
});

// Unsubscribe pages, all three lists: mailRouter in src/digest.js.

// ---------- sign in ----------
// One page for signing in and signing up (spec 16 part 6). Its title says why you are here, from where you are going next:
// a search from the landing page, or an AI app asking to connect. That address travels in the email link and in the form,
// so an email opened on a phone still lands on the search. A short-lived cookie carries it for Google.
// The same box opens over a page for a Follow press signed out (src/pages/signin.js signinDialog): its forms are sent by
// web/ui.js with the X-Signin-Box header, and get back the box's next state, or { go } once signed in.
// After a Google sign-in a long-lived cookie keeps that email (kept on sign-out): the button then reads "Continue as …".
const NEXT = 'op_next';
const GLAST = 'op_glast';
// Only a path on this site: not //host, not /\host (browsers read a backslash as a slash), no control characters.
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !/[\\\x00-\x1f]/.test(n) ? n.slice(0, 300) : '');
const sha = s => createHash('sha256').update(s).digest('hex');
function signinWhy(next) {
  const m = next.match(/^\/(?:app\/)?search\?q=([^&]*)/) || next.match(/^\/(?:app)?#search=([^&]*)/) || next.match(/^\/(?:app\/)?l\/\d+\?q=([^&]*)/);
  if (m) { try { return { q: decodeURIComponent(m[1].replace(/\+/g, ' ')), shared: /^\/(?:app\/)?l\//.test(next) }; } catch { return {}; } }
  if (/^\/billing\/solo(\?|$)/.test(next)) return { solo: true };
  if (/^\/follow\?/.test(next)) {
    const name = followName(Object.fromEntries(new URLSearchParams(next.slice(8))));
    // "Sign up free" in the box: a landscape Free can keep opens onboarding's in-between screen for it; anything else
    // onboarding, with a way back to this page (step 12).
    const a = followArgs(Object.fromEntries(new URLSearchParams(next.slice(8))));
    return name ? { follow: name, freeNext: freeCanKeep(next) ? `${searchHref(String(a.query).trim(), +a.phase_min || 2)}&s=follow` : `${WELCOME_PATH}?from=${encodeURIComponent(next)}` } : {};
  }
  const r = next.match(/^\/oauth\/consent\?r=([\w-]+)/);
  if (r) {
    const info = getDb().prepare("SELECT c.info FROM oauth_request q JOIN oauth_client c ON c.client_id=q.client_id WHERE q.id_hash=? AND q.expires_at > datetime('now')").pluck().get(sha(r[1]));
    try { if (info) return { app: JSON.parse(info).client_name || 'your app' }; } catch { return { app: 'your app' }; }
  }
  return {};
}
// A /follow address Free could keep as its free landscape: a landscape that is not ready-made (those are free to read already).
const freeCanKeep = n => { const a = followArgs(Object.fromEntries(new URLSearchParams(String(n).slice(8)))); return !a.kind && !!String(a.query || '').trim() && !isHandChecked(a.query); };
// What a Follow press is for, by name: the landscape's heading, or the drug's or company's name.
function followName(o) {
  const a = followArgs(o);
  if (!a.kind) return String(a.query || '').trim() ? heading(String(a.query).trim()) : '';
  const e = a.kind === 'drug' ? cached('D:' + a.ref, () => Q.drug(a.ref)) : cached('CV:' + a.ref, () => E.companyView(a.ref));
  return e ? drugName(e.name) : '';
}
const lastGoogle = req => { const e = cookies(req)[GLAST] || ''; return okEmail(e) ? e : ''; };
const inBox = req => req.get('X-Signin-Box') === '1';
function sendSignin(req, res, opts = {}) {
  const next = safeNext(opts.next ?? req.body?.next ?? req.query?.next ?? '');
  // ?limit=1: sent here by the limit on public pages signed out (src/limits.js); the title says so.
  const o = { ...opts, next, why: { ...signinWhy(next), pages: req.query?.limit === '1' }, lastGoogle: lastGoogle(req) };
  if (inBox(req)) return res.send(signinBox({ ...o, dialog: true }).html);
  res.send(signinPage(o));
}
const home = () => (DASH ? '/' : '/app');
// A new account with no other reason to be here (no `next`, or just Home) starts onboarding (screen 5). One that came from a
// search (the landing page's, or a shared search link) opens onboarding's in-between screen for that search, and keeping it
// goes on to step 2. Every other reason (Follow, Choose Solo, an AI app asking to connect, a page) goes where it was going.
const firstStop = (n, isNew) => {
  if (!isNew) return n;
  // Someone new from a Follow press Free cannot follow (a drug, a company, a ready-made landscape): onboarding, with a way back
  // to the page. A landscape of one's own goes on to /follow, which opens its list with the free offer (screen 4).
  if (/^\/follow\?/.test(n || '') && !freeCanKeep(n)) return `${WELCOME_PATH}?from=${encodeURIComponent(n)}`;
  if (!n || n === home() || n === '/') return WELCOME_PATH;
  // A search address, or a shared landscape's (/l/12?q=…): onboarding's in-between screen at the stage in the address.
  const m = n.match(/^\/(?:app\/)?(?:search|l\/\d+)\?q=([^&]*)(?:.*[?&]p=(\d))?/);
  if (m) { try { return pickTo(decodeURIComponent(m[1].replace(/\+/g, ' ')), +m[2] || 2); } catch { return WELCOME_PATH; } }
  return n;
};
// Why a new account was made, from where it was going (step 12): kept on the account for /admin/metrics' funnel.
function cameFrom(n) {
  n = safeNext(n);
  const w = n.match(/^\/(?:app\/)?welcome\?from=([^&]+)/);   // "Sign up free" in a Follow box: onboarding, with the Follow press
  if (w) { try { n = decodeURIComponent(w[1]); } catch { /* keep n */ } }
  if (/^\/follow\?/.test(n)) { const k = new URLSearchParams(n.slice(8)).get('kind'); return `follow:${k === 'drug' || k === 'company' ? k : 'landscape'}`; }
  if (/^\/billing\/solo\?follow=/.test(n)) return 'follow:solo';
  if (/^\/billing\/solo/.test(n)) return 'pricing';
  if (/^\/oauth\/consent/.test(n)) return `ai:${signinWhy(n).app || 'app'}`;
  if (/^\/(?:app\/)?l\/\d+/.test(n)) return 'shared:landscape';
  if (/^\/(?:app\/)?search\?.*[?&]s=landing/.test(n)) return 'landing:search';
  if (/^\/(?:app\/)?search\?.*[?&]s=follow/.test(n)) return 'follow:landscape';
  if (/^\/(?:app\/)?search\?/.test(n)) return 'shared:search';
  const m = n.match(/^\/(drugs|companies|targets|diseases|landscapes)\//);
  if (m) return `pagelimit:${m[1]}`;
  return n && n !== home() && n !== '/' ? 'other' : 'signin';
}
// A new account: where from, why (cameFrom), and the welcome email at once (src/digest.js sendHello; the hourly timer retries).
const noteSignup = (user, req, next) => {
  LIM.markSignup(user.id, req.ip);
  getDb().prepare('UPDATE user SET came_from=? WHERE id=? AND came_from IS NULL').run(cameFrom(next), user.id);
  sendHello(user).catch(e => console.error('hello', e.message));
};
const afterSignin = (req, res, next = '', isNew = false) => {
  const n = firstStop(safeNext(next) || safeNext(cookies(req)[NEXT]), isNew);
  res.append('Set-Cookie', `${NEXT}=; Path=/; Max-Age=0`);
  if (inBox(req)) return res.json({ go: n || home() });
  res.redirect(n || home());
};
app.get('/signin', (req, res) => {
  const n = safeNext(req.query.next);
  if (n) res.setHeader('Set-Cookie', `${NEXT}=${encodeURIComponent(n)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${PROD ? '; Secure' : ''}`);
  sendSignin(req, res, { next: n });
});
// Sign-in emails: besides 3 per address in 10 minutes, at most 10 an hour from one internet address and 300 an hour in all,
// so nobody can flood an inbox or use up the email service. Kept in memory (one server; a restart starts again).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MAIL_PER_IP = 10, MAIL_ALL = 300;
const mailAllowed = hourCap(MAIL_PER_IP, MAIL_ALL);
// A counter per internet address and in all, started again every hour: true while both are under their limit (and counts it).
function hourCap(perIp, all) {
  let w = { since: Date.now(), all: 0, ip: new Map() };
  return ip => {
    if (Date.now() - w.since > 3600_000) w = { since: Date.now(), all: 0, ip: new Map() };
    const n = w.ip.get(ip) || 0;
    if (n >= perIp || w.all >= all) return false;
    w.ip.set(ip, n + 1); w.all++;
    return true;
  };
}
// Sign-in forms only from our own pages: another site cannot sign a visitor in to its account (login CSRF).
app.post('/auth/*', (req, res, next) => (req.get('sec-fetch-site') === 'cross-site' ? res.status(403).send('Forbidden') : next()));
app.post('/auth/start', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), next = safeNext(req.body.next);
  if (!okEmail(email)) return sendSignin(req, res, { state: 'bademail', email });
  if (REVIEWER && email === REVIEWER.email) return sendSignin(req, res, { email, askCode: true });
  // A new account: no throwaway address, no second form of an existing one, at most 5 a day from one computer (src/limits.js).
  const no = LIM.signupProblem(email, req.ip);
  // Another form of an existing account's address (+tag, Gmail dots): the usual "sent" screen, so the page never says that
  // an account exists; the note goes to that address, which reaches the account owner's own inbox.
  if (no === 'variant') {
    if (mailAllowed(req.ip)) await sendVariantNote(email).catch(e => console.error('variant', e.message));
    return sendSignin(req, res, { state: 'sent', email });
  }
  if (no) return sendSignin(req, res, { state: no, email });
  const recent = getDb().prepare("SELECT count(*) FROM login_token WHERE email=? AND expires_at > datetime('now','+20 minutes')").pluck().get(email);
  if (recent >= 3 || !mailAllowed(req.ip)) return sendSignin(req, res, { state: 'toomany', email });
  const { token, code } = A.createLogin(email);
  const link = `${dashOrigin(req)}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  try {
    const r = await sendLoginEmail(email, link, code);
    // No email service, not production, and opened on this computer: the link shows on the page (local testing only).
    sendSignin(req, res, { state: 'sent', email, dev: r.dev && !PROD && LOCAL_HOSTS.has(req.hostname) ? { link, code } : null });
  } catch (e) { console.error(e); sendSignin(req, res, { state: 'sendfail', email }); }
});
// Directory reviewers (Claude, ChatGPT) cannot open our sign-in emails, so one account signs in with a fixed code instead.
// Set REVIEWER_EMAIL and REVIEWER_CODE on the server; remove them to turn this off. The account gets the Solo plan.
const REVIEWER = process.env.REVIEWER_EMAIL && process.env.REVIEWER_CODE?.length >= 12
  ? { email: process.env.REVIEWER_EMAIL.trim().toLowerCase(), code: Buffer.from(process.env.REVIEWER_CODE) } : null;
let codeTries = { n: 0, since: Date.now() };
// The 6-digit code from the sign-in email, or the reviewer's fixed code.
app.post('/auth/code', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), next = safeNext(req.body.next);
  if (REVIEWER && email === REVIEWER.email) {
    if (Date.now() - codeTries.since > 3600_000) codeTries = { n: 0, since: Date.now() };
    if (++codeTries.n > 20) return sendSignin(req, res, { email, askCode: true, error: 'Too many tries. Wait an hour and try again.' });
    const code = Buffer.from(String(req.body.code || ''));
    if (code.length !== REVIEWER.code.length || !timingSafeEqual(code, REVIEWER.code)) return sendSignin(req, res, { email, askCode: true, error: 'That code is not right.' });
    const r = A.signInEmail(email);
    getDb().prepare("UPDATE user SET plan='solo' WHERE id=? AND plan='free'").run(r.user.id);
    setSession(res, r.session);
    return afterSignin(req, res, next);
  }
  const no = okEmail(email) && LIM.signupProblem(email, req.ip);
  if (no) return sendSignin(req, res, { state: no, email });
  const r = okEmail(email) && A.redeemLoginCode(email, req.body.code || '');
  if (!r) return sendSignin(req, res, { state: 'wrongcode', email });
  if (r.isNew) noteSignup(r.user, req, next || cookies(req)[NEXT]);
  setSession(res, r.session);
  afterSignin(req, res, next, r.isNew);
});
// The emailed link. Opening it only asks, and the page's button signs in (step 10): work mail opens every link to scan it,
// which used up the link, and the code with it, before the person saw the email.
app.get('/auth/verify', (req, res) => {
  const email = A.liveLoginEmail(req.query.token);
  if (!email) return sendSignin(req, res, { state: 'expired', email: A.loginTokenEmail(req.query.token) });
  sendSignin(req, res, { state: 'confirm', email, token: String(req.query.token), next: req.query.next });
});
app.post('/auth/verify', (req, res) => {
  const no = LIM.signupProblem(A.liveLoginEmail(req.body.token) || '', req.ip);
  if (no) return sendSignin(req, res, { state: no, email: A.loginTokenEmail(req.body.token) });
  const r = A.redeemLoginToken(req.body.token);
  if (!r) return sendSignin(req, res, { state: 'expired', email: A.loginTokenEmail(req.body.token) });
  if (r.isNew) noteSignup(r.user, req, req.body.next || cookies(req)[NEXT]);
  setSession(res, r.session);
  afterSignin(req, res, req.body.next, r.isNew);
});
// Continue with Google. The random state in a short-lived cookie proves the callback answers our own request.
const GSTATE = 'op_gstate';
const googleRedirect = req => `${dashOrigin(req)}/auth/google/callback`;
const googleNext = req => safeNext(cookies(req)[NEXT]);
// `next`: where to go after (the box over a page sends it here; the sign-in page has already kept it in a cookie).
app.get('/auth/google', (req, res) => {
  const n = safeNext(req.query.next);
  if (!G.googleEnabled()) return res.redirect(`/signin${n ? `?next=${encodeURIComponent(n)}` : ''}`);
  const state = G.newState();
  res.append('Set-Cookie', `${GSTATE}=${state}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${PROD ? '; Secure' : ''}`);
  if (n) res.append('Set-Cookie', `${NEXT}=${encodeURIComponent(n)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${PROD ? '; Secure' : ''}`);
  res.redirect(G.authUrl(googleRedirect(req), state, lastGoogle(req)));
});
app.get('/auth/google/callback', async (req, res) => {
  const expected = cookies(req)[GSTATE];
  res.append('Set-Cookie', `${GSTATE}=; Path=/auth/google; Max-Age=0`);
  if (!G.googleEnabled()) return res.redirect('/signin');
  if (req.query.error || !expected || req.query.state !== expected || !req.query.code) return sendSignin(req, res, { state: 'googlefail', next: googleNext(req) });
  try {
    const email = await G.emailFromCode(req.query.code, googleRedirect(req));
    const no = LIM.signupProblem(email, req.ip);
    if (no) return sendSignin(req, res, { state: no, email, next: googleNext(req) });
    const r = A.signInEmail(email, 'google');
    if (r.isNew) noteSignup(r.user, req, googleNext(req));
    setSession(res, r.session);
    res.append('Set-Cookie', `${GLAST}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}${COOKIE_DOMAIN}${PROD ? '; Secure' : ''}`);
    afterSignin(req, res, '', r.isNew);
  } catch (e) { console.error('google', e.message); sendSignin(req, res, { state: 'googlefail', next: googleNext(req) }); }
});
// Settings, Appearance: 'light' or 'dark' by hand, or '' for Automatic. A cookie, so it also reaches the website's pages.
app.post('/api/theme', (req, res) => {
  const t = ['light', 'dark'].includes(req.body?.theme) ? req.body.theme : '';
  res.append('Set-Cookie', `ol_theme=${t}; Path=/; SameSite=Lax; Max-Age=${t ? 400 * 86400 : 0}${COOKIE_DOMAIN}${PROD ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/auth/logout', (req, res) => { A.endSession(cookies(req)[COOKIE]); res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0${COOKIE_DOMAIN}`); res.redirect(DASH ? process.env.PUBLIC_URL + '/' : '/'); });

// ---------- dashboard ----------
// Three kinds of page in the sidebar frame (src/pages/app.js): Home, Search, and one followed landscape.
const ago = n => new Date(Date.parse(Q.today()) - n * 864e5).toISOString().slice(0, 10);
// What Home shows of one followed landscape: what is coming up, and on a paid plan every change of the last six months (the last
// 14 days apart, for the folded routine reports); on Free only a count of changes since the day it was opened. No drug list.
function homeParts(f, paid) {
  const k = `${f.query}|${f.phase_min}`, at = { area: f.query, phase_min: f.phase_min };
  // A landscape's dates from Phase 2; a followed drug's or company's at every stage (it may have only Phase 1 trials).
  const base = { ...f, catalysts: cached(`AC:${k}`, () => Q.catalysts({ area: f.query, phase_min: f.kind ? 1 : Math.max(2, f.phase_min), days_ahead: 60, limit: 40 }).catalysts) };
  // Free: what kind of change each was, without the drug (screen 6), and how many.
  if (!paid) { const opened = String(f.created_at || Q.today()).slice(0, 10), ch = cached(`AU:${k}|${opened}`, () => Q.changes({ ...at, since: opened })); return { ...base, opened, unseen: ch.count, seen: ch.items }; }
  const recent = recentOf(f);
  return { ...base, changes: cached(`AX:${k}`, () => Q.changes({ ...at, since: ago(180) })), recent, n: recent.count };
}
// The last 14 days of one followed item (the folded routine reports, and the count beside it in the sidebar).
const recentOf = f => cached(`AR:${f.query}|${f.phase_min}`, () => Q.changes({ area: f.query, phase_min: f.phase_min }));
const showcaseRows = () => Object.entries(PUBLIC).map(([slug, p]) => ({ slug, area: p.area, phase_min: p.phase_min || 2, title: p.title.replace(/( drug)? landscape$/, ''), plain: p.plain,
  stats: cached('L:' + p.area, () => Q.landscape({ area: p.area, phase_min: p.phase_min || 2 })).stats }));
function dashPage(req, res, view, extra = {}) {
  const user = req.user, paid = A.isPaid(user);
  const followed = (extra.followed || followedAreas(user.id)).map(f => (paid && f.n == null ? { ...f, n: recentOf(f).count } : f));
  const notice = String(req.query.notice || '').slice(0, 400);
  res.send(appPage({ view, user, paid, followed, release: Q.releaseInfo(), data: Q.dataDates(), notice, origin: origin(req),
    followLimit: A.followLimit(paid ? user : { plan: 'solo' }), ai: connectedApp(user.id), lookups: paid ? null : A.usageCount(user.id, 'mcp', A.monthStart()),
    guide: guideFor(req, user, followed, { on: view === 'landscape' && extra.landscape ? 'l' + extra.landscape.id : '', home: view === 'home' }), ...extra, followed }));
}
// Whether they searched something other than what they keep or follow (the setup guide's second step).
const searchedOwn = (userId, followed) => {
  const mine = new Set(followed.map(f => f.query.toLowerCase()));
  return getDb().prepare("SELECT lower(detail) FROM usage WHERE user_id=? AND kind='search'").pluck().all(userId).some(d => !mine.has(d));
};
// The setup guide (src/pages/guide.js): which steps are done, worked out from the account at each page load. A step once done
// stays done (user.guide_done). When the last one ticks, "You're set up" shows on that page, then it is gone for good
// (guide_hidden 2). An account whose steps were all done before the guide existed never sees it. Someone who hid Home's old
// Get started box (ol_start cookie) starts with the guide hidden; Settings can show it again.
// `on`: the sidebar's mark for this page ("l" + id when it is one of theirs), so opening it ticks the Open step on that page.
// `home`: on Home, a phone shows the next step in words on the pill while picking or opening is next (web/guide.js).
function guideFor(req, user, followed, { on = '', home = false } = {}) {
  if (user.guide_hidden) return '';
  const db = getDb(), set = (done, hidden) => db.prepare('UPDATE user SET guide_done=?, guide_hidden=? WHERE id=?').run(done, hidden, user.id);
  if (user.guide_done == null && req && cookies(req).ol_start === 'hidden') { set('', 1); return ''; }
  const paid = A.isPaid(user), ai = connectedApp(user.id);
  const asked = !!db.prepare("SELECT 1 FROM usage WHERE user_id=? AND kind='mcp' LIMIT 1").get(user.id);
  // The Monday email step is Solo's, ticked from the start; it is left out for someone who turned the email off.
  const opened = !!on && followed.some(f => 'l' + f.id === on);
  const now = { pick: followed.length > 0, open: opened, search: searchedOwn(user.id, followed), connect: !!ai || asked, ask: asked, ...(paid && !user.digest_off ? { monday: true } : {}) };
  const ids = Object.keys(now), before = user.guide_done == null ? null : new Set(user.guide_done.split(',').filter(Boolean));
  // The Open step came after the rest (17 Nov): an account first worked out with every other step done counts it done too,
  // so someone set up before the guide existed still never sees it.
  if (!before && ids.every(k => k === 'open' || now[k])) now.open = true;
  const done = new Set([...(before || []), ...ids.filter(k => now[k])]);
  const fresh = before ? ids.filter(k => done.has(k) && !before.has(k)) : [];
  const finished = ids.every(k => done.has(k)), list = [...done].join(',');
  if (finished) set(list, 2); else if (list !== (user.guide_done ?? null)) set(list, 0);
  if (finished && !fresh.length) return '';
  return guideTag({ paid, ids, done: [...done], fresh, finished, ai, home }, { first: followed[0], today: Q.today() });
}
// Hide the setup guide for good (its own link), or show it again (Settings).
app.post('/api/guide', needUser, (req, res) => {
  getDb().prepare('UPDATE user SET guide_hidden=? WHERE id=?').run(req.body?.hidden ? 1 : 0, req.user.id);
  res.json({ ok: true });
});
// Signed out, a dashboard page asks you to sign in, then comes back to it.
const needPage = (req, res, next) => { req.user = currentUser(req); if (!req.user) return res.redirect(302, `/signin?next=${encodeURIComponent(req.originalUrl)}`); next(); };
app.get('/app', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.redirect('/signin');
  req.user = user;
  const paid = A.isPaid(user);
  const followed = followedAreas(user.id).map(f => homeParts(f, paid));
  // Right after paying (/billing/success): the "You are on Solo" box, with the plan's name.
  const welcome = req.query.paid && paid ? planName(user) : '';
  const keys = A.listApiKeys(user.id);
  dashPage(req, res, 'home', { followed, welcome, keys, showcase: followed.length ? [] : showcaseRows(),
    connected: { app: connectedApp(user.id), key: keys.some(k => !k.revoked) } });
});
// Onboarding (screen 5): step 1 asks what to track; with ?q= it shows the in-between screen for that search; step 2 (after
// keeping a landscape, ?l=<id>) connects the AI assistant.
app.get(WELCOME_PATH, needPage, (req, res) => {
  const step = req.query.step === '2' ? 2 : 1;
  const q = String(req.query.q || '').trim().slice(0, 120), p = Math.min(5, Math.max(1, +req.query.p || 2));
  const readySlug = q && Object.keys(PUBLIC).find(k => PUBLIC[k].area.toLowerCase() === q.toLowerCase());
  const pick = step === 1 && q ? { q, p, ready: readySlug ? `/landscapes/${readySlug}` : '', L: cached(`P:${q.toLowerCase()}|${p}`, () => Q.landscape({ area: q, phase_min: p, limit: 5 })) } : null;
  const landscape = step === 2 ? followedAreas(req.user.id).find(x => String(x.id) === String(req.query.l)) || followedAreas(req.user.id)[0] || null : null;
  res.send(startPage({ user: req.user, step, pick, landscape, origin: origin(req), ai: step === 2 ? connectedApp(req.user.id) : null, from: fromPage(req.query.from) }));
});
// Onboarding's way back (step 12): `from` is the /follow address of the Follow press they signed up from. Its page, its name,
// and for a drug its first target as the first example (unless that is a ready-made landscape, free already).
function fromPage(raw) {
  raw = safeNext(raw);
  if (!/^\/follow\?/.test(raw)) return null;
  const a = followArgs(Object.fromEntries(new URLSearchParams(raw.slice(8)))), name = followName(Object.fromEntries(new URLSearchParams(raw.slice(8))));
  if (!name) return null;
  if (a.kind === 'drug') {
    const d = cached('D:' + a.ref, () => Q.drug(a.ref)), t = d?.targets?.[0]?.name;
    return { raw, name, href: drugHref(a.ref), hint: t && !isHandChecked(t) ? t : '' };
  }
  if (a.kind === 'company') return { raw, name, href: companyHref(a.ref) };
  const slug = slugOf(a.query);
  return { raw, name, href: slug ? `/landscapes/${slug}` : searchHref(a.query, +a.phase_min || 2) };
}
// "Make this my free landscape" on the in-between screen: keep it, then step 2. If it cannot be kept, its search says why.
app.post(`${WELCOME_PATH}/keep`, needPage, (req, res) => {
  const q = String(req.body.q || '').trim().slice(0, 120), p = +req.body.p || 2;
  const r = follow(req.user, { query: q, phase_min: p, keep: true });
  if (r.error) return res.redirect(r.status === 400 ? WELCOME_PATH : `${searchHref(q, p)}&notice=${encodeURIComponent(r.error)}`);
  const from = fromPage(req.body.from);
  res.redirect(`${WELCOME_PATH}?step=2&l=${r.id}${from ? `&from=${encodeURIComponent(from.raw)}` : ''}`);
});
app.get('/app/search', needPage, (req, res) => {
  const followed = followedAreas(req.user.id);
  dashPage(req, res, 'search', { followed, gone: req.query.gone === '1', showcase: A.isPaid(req.user) && followed.length ? [] : showcaseRows() });
});
// One followed landscape: its drugs, changes, dates and what the list covers. A checked one opens its public page instead.
app.get('/app/l/:id', needPage, (req, res) => {
  const followed = followedAreas(req.user.id), f = followed.find(x => String(x.id) === req.params.id);
  // Someone else's landscape (a shared address): its search, by the name in the address only; nothing is read from the other
  // account, so trying other numbers shows nothing. An old address without the name says so on Search (?gone=1).
  if (!f) {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q) return res.redirect(302, searchHref(q, Math.min(5, Math.max(1, +req.query.p || 2))));
    return res.redirect(302, `${appPath('/search')}?gone=1`);
  }
  if (f.kind || slugOf(f.query)) return res.redirect(302, f.href);
  const paid = A.isPaid(req.user), k = `${f.query}|${f.phase_min}`;
  const landscape = { ...homeParts(f, paid), L: cached(`AL:${k}`, () => Q.landscape({ area: f.query, phase_min: f.phase_min, limit: 300 })) };
  // Its drugs count toward the account's different drugs (src/limits.js), like any list.
  const u = LIM.useDrugs(req.user, landscape.L.programs.map(p => p.id));
  if (!u.ok) Object.assign(landscape, { L: { ...landscape.L, programs: overRows(req.user, landscape.L.programs) }, limit: u.note });
  else if (u.note) landscape.limit = u.note;
  // ?kept=1: Free has just made this their free landscape (web/app.js), and the page says so once.
  dashPage(req, res, 'landscape', { followed, landscape, kept: !paid && req.query.kept === '1' });
});
// The AI app connected by sign-in, for Settings; Disconnect ends its access. One app at a time: a new one replaces it (A.dropConnections).
function connectedApp(userId) {
  const info = getDb().prepare("SELECT c.info FROM oauth_token t JOIN oauth_client c ON c.client_id = t.client_id WHERE t.user_id=? AND t.expires_at > datetime('now') ORDER BY t.created_at DESC LIMIT 1").pluck().get(userId);
  try { return info ? JSON.parse(info).client_name || 'An app' : null; } catch { return 'An app'; }
}
// Onboarding's step 2 asks every few seconds whether the AI assistant has signed in yet (it does so in another tab).
app.get('/api/connection', needUser, (req, res) => res.json({ app: connectedApp(req.user.id) }));
app.delete('/api/connection', needUser, (req, res) => { A.dropConnections(req.user.id); res.json({ ok: true }); });

// Follows live in saved_landscape (everything saved before is now followed): landscapes, and single drugs and companies (kind, ref).
// `href`: where each opens. A drug or company is its own page; a checked landscape (PUBLIC) its public page; any other
// landscape its dashboard page, /app/l/12.
const APP_HOME = DASH ? '/' : '/app';
const lPath = f => appPath(`/l/${f.id}?q=${encodeURIComponent(f.query)}&p=${+f.phase_min || 1}`);
const slugOf = q => Object.keys(PUBLIC).find(s => PUBLIC[s].area.toLowerCase() === String(q).trim().toLowerCase());
// A checked one followed at another stage opens at that stage: /landscapes/obesity?p=1.
const landHref = f => {
  if (f.kind === 'drug') return drugHref(f.ref);
  if (f.kind === 'company') return companyHref(f.ref);
  const slug = slugOf(f.query);
  // A landscape of one's own carries its name, so a copied address still says what it is to whoever opens it (step 12).
  if (!slug) return lPath(f);
  const pm = stageOf(PUBLIC[slug], f.phase_min);
  return `/landscapes/${slug}${pm === (PUBLIC[slug].phase_min || 2) ? '' : `?p=${pm}`}`;
};
const followedAreas = userId => getDb().prepare('SELECT * FROM saved_landscape WHERE user_id=? ORDER BY id').all(userId).map(f => ({ ...f, href: landHref(f) }));
// Signed in, data pages show the dashboard's sidebar (src/pages/frame.js); signed out, the website's top bar.
const sideFor = (user, on = '') => {
  if (!user) return '';
  const followed = followedAreas(user.id).map(f => (A.isPaid(user) ? { ...f, n: recentOf(f).count } : f));
  return sidebar({ user, followed, on, guide: guideFor(null, user, followed, { on }) });
};
// Signed out, a page with Follow carries the sign-in box (src/pages/signin.js signinDialog): what it needs from the request.
const boxFor = (req, user) => (user ? null : { lastGoogle: lastGoogle(req) });
// The follow of one drug or company, if this person has it.
const followOf = (user, kind, ref) => (user ? getDb().prepare('SELECT * FROM saved_landscape WHERE user_id=? AND kind=? AND ref=?').get(user.id, kind, ref) || null : null);
// A Follow press from a drug or company page that did not go through comes back with ?notice=1: the page says why.
const entityNotice = (req, user) => (!user || !req.query.notice ? null : A.isPaid(user)
  ? { full: true, count: getDb().prepare('SELECT count(*) FROM saved_landscape WHERE user_id=?').pluck().get(user.id), plan: planName(user) } : { solo: true });

// The Free plan includes LIMITS.free.landscapes full landscape. Searching is free and shows a preview (the top PREVIEW drugs);
// opening the full list or following uses it (CSV is Solo only since 15 Nov). Re-opening the same one is free, and hand-checked landscapes never count.
const PREVIEW = 10;
const handCheckedAreas = new Set(Object.values(PUBLIC).map(p => p.area.toLowerCase()));
const isHandChecked = area => handCheckedAreas.has(String(area).trim().toLowerCase());
function landscapeAllowed(user, area, { use = true } = {}) {
  if (A.isPaid(user) || isHandChecked(area)) return { ok: true, full: true };
  const db = getDb();
  const key = String(area).trim().toLowerCase();
  const already = db.prepare("SELECT 1 FROM usage WHERE user_id=? AND kind='landscape' AND lower(detail)=?").get(user.id, key);
  if (already) return { ok: true, full: true };
  const used = db.prepare("SELECT count(DISTINCT lower(detail)) FROM usage WHERE user_id=? AND kind='landscape'").pluck().get(user.id);
  const left = Math.max(0, A.LIMITS.free.landscapes - used);
  if (!use) return { ok: true, full: false, left };
  if (!left) return { ok: false, left };
  A.logUsage(user.id, 'landscape', key);
  return { ok: true, full: true, left: left - 1 };
}
const LANDSCAPE_LIMIT_MSG = `The Free plan includes ${A.LIMITS.free.landscapes} full landscape, and you have used it. You can still search and see the top ${PREVIEW} drugs of any landscape, and the hand-checked landscapes are always free. Solo ($49 a month, excl. VAT) opens every landscape in full.`;
const SOLO_MSG = 'Following is part of Solo ($49 a month, excl. VAT): every change as it happens, and a Monday email.';
// Suggestions as you type in the dashboard search box (src/suggest.js).
app.get('/api/suggest', needUser, (req, res) => res.json(suggest(String(req.query.q || '').slice(0, 60))));
// Landscapes are the heaviest question (a broad word takes seconds): at most 30 a minute for one account.
const landscapeRuns = new Map();
const landscapeBusy = user => {
  const now = Date.now(), recent = (landscapeRuns.get(user.id) || []).filter(t => now - t < 60_000);
  if (recent.length >= 30) return true;
  recent.push(now); landscapeRuns.set(user.id, recent);
  if (landscapeRuns.size > 5000) landscapeRuns.delete(landscapeRuns.keys().next().value);
  return false;
};
app.get('/api/landscape', needUser, (req, res) => {
  const area = String(req.query.area || '').trim().slice(0, 120);
  if (area && landscapeBusy(req.user)) return res.status(429).json({ error: 'That is a lot of searches in a minute. Please wait a moment.' });
  // The setup guide's "Search something of your own" ticks on a search other than what they keep or follow: noted once per search.
  if (area && !getDb().prepare("SELECT 1 FROM usage WHERE user_id=? AND kind='search' AND lower(detail)=lower(?)").get(req.user.id, area)) A.logUsage(req.user.id, 'search', area);
  if (!area) return res.status(400).json({ error: 'Type what you are looking for.' });
  // One drug or one company is not a landscape: its page opens instead (spec 24).
  const open = E.entityFor(area);
  if (open) return res.json({ open });
  const gate = landscapeAllowed(req.user, area, { use: req.query.full === '1' });
  if (!gate.ok) return res.status(402).json({ error: LANDSCAPE_LIMIT_MSG, upgrade: true });
  const L = { ...Q.landscape({ area, phase_min: +req.query.phase_min || 1, include_finished: req.query.finished === '1', limit: 300 }), heading: heading(area) };
  if (!L.programs.length) L.did_you_mean = didYouMean(area);   // nothing found: a disease one or two letters away, if there is one
  if (!L.programs.length) A.logUsage(req.user.id, 'search_none', area);   // what people want that we do not cover (admin dashboard)
  // The drugs shown count toward the account's different drugs (src/limits.js); past the allowance, the top 10 (Free: none).
  // The ready-made landscapes are free to read for everyone, so they never count.
  const rows = gate.full ? L.programs : L.programs.slice(0, PREVIEW), u = isHandChecked(area) ? { ok: true } : LIM.useDrugs(req.user, rows.map(p => p.id));
  if (!u.ok) { const top = overRows(req.user, rows); return res.json({ ...L, programs: top, truncated: false, preview: { shown: top.length, left: 0 }, limit: u.note }); }
  const limit = u.note || undefined;
  if (!gate.full) return res.json({ ...L, programs: rows, truncated: false, preview: { shown: rows.length, left: gate.left }, limit });
  res.json({ ...L, limit });
});
app.get('/api/landscape.csv', needUser, (req, res) => {
  const area = String(req.query.area || '').trim().slice(0, 120);
  if (!A.isPaid(req.user)) return res.status(402).send('Downloads are part of Solo ($49 a month, excl. VAT).');
  const L = Q.landscape({ area, phase_min: +req.query.phase_min || 1, limit: CSV_ROWS }), rows = csvRows(req.user, res, L.programs);
  if (!rows) return;
  res.type('text/csv').attachment(csvName(area)).send(toCSV(rows, { note: cutLine(rows.length, L.stats.programs), credit: creditLine(siteUrl(req) + creditPath({ area })) }));
});
// A picture for slides of any landscape (paid): ?kind=overview|table, a ready-made one by ?slug= (and ?p=) or any search by
// ?area= and ?phase_min=; ?ids= the drugs the table shows, in the order the reader sees them (at most 8); ?theme=dark.
// The ready-made overview is free at /landscapes/:slug/slide.png (src/images.js).
app.get('/api/slide.png', needUser, (req, res) => {
  if (!A.isPaid(req.user)) return res.status(402).send('Pictures for slides of your own searches are part of Solo ($49 a month, excl. VAT).');
  const p = PUBLIC[req.query.slug];
  const area = p ? p.area : String(req.query.area || '').trim().slice(0, 120);
  if (!area) return res.status(400).send('Which landscape?');
  const pm = p ? stageOf(p, req.query.p) : Math.min(5, Math.max(1, +req.query.phase_min || 1));
  A.logUsage(req.user.id, 'slide', `${req.query.kind === 'table' ? 'table' : 'overview'} ${area}`);   // noted, never counted
  const L = p ? showL(p, pm) : Q.landscape({ area, phase_min: pm, limit: 300 });
  const o = { title: p ? slideTitle(p.title) : heading(area), url: (siteUrl(req) + creditPath(p ? { slug: req.query.slug } : { area })).replace(/^https?:\/\//, ''), day: creditDay(), theme: req.query.theme === 'dark' ? 'dark' : 'light' };
  let svg;
  if (req.query.kind === 'table') {
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 8), by = new Map(L.programs.map(x => [String(x.id), x]));
    const rows = ids.length ? ids.map(id => by.get(id)).filter(Boolean) : L.programs.slice(0, 8);
    const n = L.stats.programs, all = !ids.length || (rows.length === Math.min(8, n) && rows.every((r, i) => r === L.programs[i]));
    svg = tableSlideSvg(L, rows, { ...o, sub: all ? `The most advanced ${rows.length} of ${n} drugs, by stage, then next date` : `${rows.length} of ${n} drugs, as picked in the list` });
  } else svg = overviewSlideSvg(L, o);
  res.set('Cache-Control', 'private, max-age=600').type('image/png').send(slidePng(svg));
});
// Follow a landscape, or one drug or company (`kind` 'drug' | 'company' and its id `ref`). Returns { id, href } or
// { status, error, upgrade }. Solo follows 5 of anything; Free follows nothing. `keep`: Free's "Open in full, free", which
// keeps their one free landscape in the sidebar (src/pages/frame.js "Your landscape"), uses no follow and gets no changes.
function follow(user, { query, phase_min, kind, ref, keep = false }) {
  const db = getDb();
  if (kind) {
    const e = kind === 'drug' ? cached('D:' + ref, () => Q.drug(ref)) : kind === 'company' ? cached('CV:' + ref, () => E.companyView(ref)) : null;
    if (!e) return { status: 400, error: 'Nothing to follow.' };
    ref = e.id; query = e.name; phase_min = 1;
  }
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return { status: 400, error: 'Nothing to follow.' };
  phase_min = +phase_min || 1;
  const have = kind ? db.prepare('SELECT id FROM saved_landscape WHERE user_id=? AND kind=? AND ref=?').get(user.id, kind, ref)
    : db.prepare('SELECT id FROM saved_landscape WHERE user_id=? AND kind IS NULL AND lower(query)=lower(?)').get(user.id, q);
  const count = db.prepare('SELECT count(*) FROM saved_landscape WHERE user_id=?').pluck().get(user.id);
  const done = id => ({ id, href: landHref({ id, query: q, phase_min, kind, ref }) });
  if (!A.isPaid(user)) {
    if (have) return done(have.id);
    if (!keep || kind || isHandChecked(q)) return { status: 402, error: SOLO_MSG, upgrade: true };
    if (!landscapeAllowed(user, q).ok) return { status: 402, error: LANDSCAPE_LIMIT_MSG, upgrade: true };
  } else if (!have && count >= A.followLimit(user)) return { status: 402, error: `You follow ${count}, the most on ${planName(user)}.`, full: true };
  A.logUsage(user.id, 'follow', q);
  if (have) { db.prepare('UPDATE saved_landscape SET phase_min=? WHERE id=?').run(phase_min, have.id); return done(have.id); }
  return done(+db.prepare('INSERT INTO saved_landscape (user_id, query, phase_min, kind, ref) VALUES (?,?,?,?,?)').run(user.id, q, phase_min, kind || null, kind ? ref : null).lastInsertRowid);
}
const followArgs = b => ({ query: b.query ?? b.q, phase_min: b.phase_min ?? b.p, kind: ['drug', 'company'].includes(b.kind) ? b.kind : null, ref: String(b.ref ?? b.id ?? '').slice(0, 200) });
app.post('/api/follow', needUser, (req, res) => {
  const r = follow(req.user, { ...followArgs(req.body), keep: req.body.keep === true });
  if (r.error) return res.status(r.status).json({ error: r.error, upgrade: r.upgrade, full: r.full });
  res.json({ ok: true, id: r.id, href: r.href });
});
// "Follow" buttons on public pages: sign in first if needed, then follow and open what was followed. A landscape that
// did not go through opens its search with the reason; a drug or company its own page, which says why (?notice=1).
// A link from another site (Sec-Fetch-Site: cross-site) does not follow on its own: it shows one Follow button that posts
// back here, so another site cannot fill a signed-in account's follows. Our own pages and the sign-in link go straight on.
function followGo(req, res, src) {
  const a = followArgs(src), back = a.kind ? `/follow?kind=${a.kind}&id=${encodeURIComponent(a.ref)}` : `/follow?q=${encodeURIComponent(String(a.query || '').trim().slice(0, 120))}&p=${+a.phase_min || 1}`;
  const user = currentUser(req);
  if (!user) return res.redirect(`/signin?next=${encodeURIComponent(back)}`);
  if (req.method === 'GET' && req.get('sec-fetch-site') === 'cross-site') {
    const name = followName(src) || 'this';
    const fields = a.kind ? { kind: a.kind, id: a.ref } : { q: String(a.query || '').trim().slice(0, 120), p: +a.phase_min || 1 };
    return res.send(layout({ title: `Follow ${name} | ${BRAND}`, user, noindex: true, body: `<main class="wrap nf">\n<h1>Follow ${esc(name)}?</h1>\n<form method="post" action="/follow">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}<button class="btn primary" type="submit">Follow</button></form>\n</main>` }));
  }
  const r = follow(user, a);
  if (r.status === 400) return res.redirect(APP_HOME);
  // A new Free account whose free landscape is still unused, on a landscape that is not ready-made: its list, with only the free
  // offer in it (screen 4, decision 1). The "Following is part of Solo" notice is for everything else Free cannot follow.
  const q = String(a.query || '').trim();
  if (r.error && !a.kind && !A.isPaid(user) && !isHandChecked(q) && landscapeAllowed(user, q, { use: false }).left) return res.redirect(searchHref(q, +a.phase_min || 1));
  if (r.error) return res.redirect(a.kind ? `${landHref(a)}?notice=1` : `${searchHref(q, +a.phase_min || 1)}&notice=${encodeURIComponent(r.error)}`);
  res.redirect(r.href);
}
app.get('/follow', (req, res) => followGo(req, res, req.query));
app.post('/follow', (req, res) => (req.get('sec-fetch-site') === 'cross-site' ? res.status(403).send('Forbidden') : followGo(req, res, req.body)));
app.delete('/api/follow/:id', needUser, (req, res) => { getDb().prepare('DELETE FROM saved_landscape WHERE id=? AND user_id=?').run(+req.params.id, req.user.id); res.json({ ok: true }); });
// `name`: as the sidebar says it; `n`: changes in the last 14 days (paid), for the Follow box when every follow is used.
app.get('/api/follow', needUser, (req, res) => res.json({ followed: followedAreas(req.user.id).map(f => ({ ...f, name: heading(f.query), n: A.isPaid(req.user) ? recentOf(f).count : undefined })) }));
// What changed in one area (or every followed area) since a date. Default: the last 14 days.
app.get('/api/changes', needUser, (req, res) => {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since || '') ? req.query.since : undefined;
  // Only what the account follows (15 Nov 2026: any ?area= was open to everyone, and counted nowhere).
  const areas = followedAreas(req.user.id);
  res.json({ release: Q.releaseInfo(), areas: areas.map(a => Q.changes({ area: a.query, phase_min: a.phase_min, since })) });
});
// "Check now" on a followed area: the source that changes during the day (SEC filings of the area's
// companies), with each step streamed to the page. ClinicalTrials.gov is not included: it publishes once each weekday.
const lastCheck = new Map();
let secCheckRunning = false;
app.post('/api/areas/:id/check', needUser, async (req, res) => {
  const f = getDb().prepare('SELECT * FROM saved_landscape WHERE id=? AND user_id=?').get(+req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: 'You do not follow this landscape.' });
  const wait = 300_000 - (Date.now() - (lastCheck.get(f.id) || 0));
  if (wait > 0) return res.status(429).json({ error: `Checked a moment ago. You can check again in ${Math.ceil(wait / 60000)} min.` });
  // One check at a time on the whole server: two at once would pass the SEC's 10 requests a second, and it blocks our address.
  if (secCheckRunning) return res.status(429).json({ error: 'Another check is running. Try again in a minute.' });
  secCheckRunning = true;
  lastCheck.set(f.id, Date.now());
  try {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  const line = l => res.write(l + '\n');
  const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const L = Q.landscape({ area: f.query, phase_min: f.phase_min });
  const ids = [...new Set(L.programs.flatMap(p => p.company_ids || []))];
  const covered = getDb().prepare('SELECT id FROM company WHERE cik IS NOT NULL AND id IN (SELECT value FROM json_each(?))').pluck().all(JSON.stringify(ids));
  line(`Checking "${f.query}": ${L.stats.programs} drugs, ${ids.length} hand-checked companies, ${covered.length} of them file with the SEC.`);
  const sec = covered.length ? await loadFilings({ companyIds: covered, onProgress: line }) : (line('No companies in this landscape file with the SEC.'), { added: 0 });
  const fresh = getDb().prepare("SELECT count(*) FROM filing WHERE found_at >= ? AND company_id IN (SELECT value FROM json_each(?)) AND kind IN ('deal','share_sale','offering')").pluck().get(started, JSON.stringify(covered));
  line(`Done. ${sec.added} new SEC ${sec.added === 1 ? 'filing' : 'filings'} (${fresh} deal or financing). ClinicalTrials.gov is loaded each weekday when it publishes.`);
  for (const key of cache.keys()) if (/^A[XRU]:/.test(key) && key.slice(3).startsWith(`${f.query}|${f.phase_min}`)) cache.delete(key);   // the dashboard shows the new filings at once
  } finally { secCheckRunning = false; }
  res.end();
});
app.get('/api/keys', needUser, (req, res) => res.json({ keys: A.listApiKeys(req.user.id) }));
app.post('/api/keys', needUser, (req, res) => res.json({ key: A.createApiKey(req.user.id) }));
app.delete('/api/keys/:id', needUser, (req, res) => { A.revokeApiKey(req.user.id, +req.params.id); res.json({ ok: true }); });

// ---------- billing ----------
app.post('/billing/checkout', async (req, res) => {
  const user = currentUser(req);
  if (user) checkoutPressed(user, req);
  try { res.redirect(303, await B.createCheckout({ plan: req.body.plan, user, origin: origin(req) })); }
  catch (e) {
    console.error('checkout', e.message);
    const safe = /Sign in first|not configured|Unknown plan|opens in/.test(e.message) ? e.message : 'Checkout is not available right now. Please try again later or email us.';
    res.status(400).send(pricingPage({ user, error: safe, feed: pricingFeed(), today: Q.today() }));
  }
});
// Choose Solo from a link (Pricing, or a Follow press signed out): sign in first, then straight to Stripe's payment page.
// `?plan=year`: yearly ($490), picked with Pricing's Monthly / Yearly switch.
// `?follow=/follow?…`: what was being followed; it is followed right after paying (/billing/success).
// Every Choose Solo press is noted (usage 'checkout', with where it was pressed), so /admin/metrics can count payments started.
const checkoutPressed = (user, req, then = '') => {
  const ref = String(req.get('referer') || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 120);
  A.logUsage(user.id, 'checkout', then ? `follow ${then}` : /^\/(auth|signin)/.test(ref) ? 'right after sign-in' : ref || 'direct');
};
const followThen = v => (/^\/follow\?/.test(safeNext(v)) ? safeNext(v) : '');
app.get('/billing/solo', async (req, res) => {
  const user = currentUser(req), then = followThen(req.query.follow);
  if (!user) return res.redirect(`/signin?next=${encodeURIComponent(req.originalUrl)}`);
  if (A.isPaid(user)) return res.redirect(then || home());
  checkoutPressed(user, req, then);
  try { res.redirect(303, await B.createCheckout({ plan: req.query.plan === 'year' ? 'solo_year' : 'solo', user, origin: origin(req), then })); }
  catch (e) {
    console.error('checkout', e.message);
    const safe = /not configured/.test(e.message) ? e.message : 'Checkout is not available right now. Please try again later or email us.';
    res.status(400).send(pricingPage({ user, error: safe, feed: pricingFeed(), today: Q.today() }));
  }
});
app.get('/billing/success', async (req, res) => {
  try {
    const cs = await B.stripeClient().checkout.sessions.retrieve(String(req.query.session_id));
    const r = B.recordCheckout(cs);
    afterCheckout(r);
    B.afterPaid(cs, r);
    if (!r) throw new Error('checkout not complete');
    // Paid from a Follow press: follow it now, then Home's welcome note says so.
    const then = followThen(req.query.follow), user = currentUser(req);
    if (then && user && A.isPaid(user)) follow(user, followArgs(Object.fromEntries(new URLSearchParams(then.slice(8)))));
    res.redirect(`/app?paid=${encodeURIComponent(r.plan || '')}`);
  } catch (e) {
    console.error('billing success', e.message);
    res.send(pricingPage({ user: currentUser(req), feed: pricingFeed(), today: Q.today(), flash: 'We could not confirm your payment on this page. If you paid, Solo shows on Home within a minute. If not, email us.' }));
  }
});
app.get('/billing/portal', async (req, res) => {
  const url = await B.portalUrl(currentUser(req), origin(req)).catch(() => null);
  res.redirect(url || '/pricing');
});

// A refund request: /admin/refund?email=… says whether the 14-day refund still applies (src/billing.js refundCheck).
// Admin pages: signed in with an email in ADMIN_EMAILS (comma list), or a script sending "Authorization: Bearer <ADMIN_TOKEN>".
// link, which scripts and sessions still use. Anyone else gets "Not found".
const adminEmails = () => new Set(String(process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
// Never in the address (?token=): addresses end up in browser history and page links. A short token or the
// .env.example placeholder never works.
const digest = s => createHash('sha256').update(String(s)).digest();
const adminToken = () => { const t = process.env.ADMIN_TOKEN || ''; return t.length >= 32 && !/change-me/i.test(t) ? t : ''; };
const tokenOk = req => {
  const t = adminToken(), given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!(t && given) && timingSafeEqual(digest(given), digest(t));
};
const isAdmin = req => tokenOk(req) || adminEmails().has(String(currentUser(req)?.email || '').toLowerCase());
// The pages (src/admin.js): Today, People and one person, then Growth, Usage, Money, Health.
for (const [path, page] of Object.entries(ADM.PAGES_BY_ROUTE))
  app.get(path, async (req, res) => {
    if (!isAdmin(req)) return res.status(404).send('Not found');
    const html = await page(getDb(), { token: '', query: req.query, params: req.params });
    res.set('X-Robots-Tag', 'noindex');
    return html ? res.send(html) : res.status(404).send('Not found');
  });
// Step 2's addresses (Inbox, Accounts) go to where their content is now.
for (const [from, to] of Object.entries(ADM.MOVED))
  app.get(from, (req, res) => {
    if (!isAdmin(req)) return res.status(404).send('Not found');
    const q = new URLSearchParams(req.query).toString();
    res.redirect(301, to.replace(':id', encodeURIComponent(req.params.id || '')) + (q ? '?' + q : ''));
  });
// The actions (done, give Solo free, emails off, sign out everywhere, delete): POST, admin only, never from another site.
for (const [path, act] of Object.entries(ADM.ACTIONS))
  app.post(path, (req, res) => {
    if (!isAdmin(req) || req.get('sec-fetch-site') === 'cross-site') return res.status(404).send('Not found');
    const next = act(getDb(), { params: req.params, body: req.body || {}, by: currentUser(req)?.email || 'token' });
    if (!next) return res.status(404).send('Not found');
    cache.clear();   // a plan or an account changed: cached pages are drawn again
    res.redirect(303, ADM.link('', next[0], next[1]));
  });
app.get('/admin/refund', (req, res) => {
  if (!isAdmin(req)) return res.status(404).send('Not found');
  const r = B.refundCheck(req.query.email);
  res.type('text/plain').send(r.paid ? [r.email + ` (${r.plan})`, `First payment: ${r.paid} UTC, ${r.days} days ago`,
    `Since then: ${r.csv} CSV downloads, ${r.drugs.toLocaleString('en-US')} different drugs opened`, '', r.verdict, '',
    'The 14-day refund is for consumers. A business (paid with a VAT number, or for work) has none: part months are not refunded.'].join('\n') : r.verdict);
});

// ---------- experiment metrics (for the tracking sheet) ----------
app.get('/admin/metrics', (req, res) => {
  if (!isAdmin(req)) return res.status(404).send('Not found');
  const db = getDb(), days = Math.min(3650, Math.max(1, +req.query.days || 30));
  const out = {
    requests: db.prepare('SELECT * FROM area_request ORDER BY id DESC').all(),
    signups: db.prepare('SELECT count(*) FROM user').pluck().get(),
    returning_users: db.prepare("SELECT count(*) FROM user WHERE last_seen IS NOT NULL AND date(last_seen) > date(created_at, '+6 days')").pluck().get(),
    payments: db.prepare('SELECT email, plan, amount, currency, livemode, created_at FROM payment ORDER BY id DESC').all(),
    mcp_keys_used_2plus_days: db.prepare("SELECT count(*) FROM (SELECT user_id FROM usage WHERE kind='mcp' GROUP BY user_id HAVING count(DISTINCT date(at)) >= 2)").pluck().get(),
    free_cap_hits: db.prepare("SELECT count(*) FROM (SELECT u.user_id FROM usage u JOIN user ON user.id=u.user_id WHERE user.plan='free' AND u.kind='landscape' GROUP BY u.user_id HAVING count(DISTINCT lower(u.detail)) >= 1)").pluck().get(),
    team_waitlist: db.prepare("SELECT count(*) FROM area_request WHERE page='team-waitlist'").pluck().get(),
    funnel: ADM.funnel(db, days), funnel_days: days,
  };
  if (req.query.view !== 'table') return res.json(out);
  res.redirect('/admin/growth');   // the funnel is the step strip on Growth now
});
// Review page (src/review.js): regulator news held for a person before it reaches the
// feed, possible same-trial pairs, and a history with Undo. Admin only. `by` (e.g. &by=bot) records who acted; default team.
const reviewer = req => /^[a-z]{1,20}$/.test(req.query.by || '') ? req.query.by : 'team';
app.get('/admin/review', (req, res) => {
  if (!isAdmin(req)) return res.status(404).send('Not found');
  res.send(R.reviewPage(getDb(), { token: '', by: req.query.by && reviewer(req), all: req.query.all === '1', done: req.query.done }));
});
app.post('/admin/review/:id', (req, res) => {
  if (!isAdmin(req) || req.get('sec-fetch-site') === 'cross-site') return res.status(404).send('Not found');
  const db = getDb(), id = +req.params.id, by = reviewer(req);
  const done = req.body.do === 'publish' ? R.publishItem(db, id, by) : req.body.do === 'apply' ? R.applyItem(db, id, by) : req.body.do === 'dismiss' ? R.dismissItem(db, id, by) : req.body.do === 'undo' ? R.undoItem(db, id) : 'Unknown action.';
  if (req.body.do !== 'dismiss') cache.clear();   // drug pages are cached for 10 minutes
  res.redirect(`/admin/review?${req.query.by ? `by=${encodeURIComponent(by)}&` : ''}done=${encodeURIComponent(done)}`);
});

// ---------- pages that are not there ----------
// One real 404 page (src/pages/notfound.js) in the frame you are in: the sidebar signed in on the dashboard's address, else the
// top bar. The admin pages, images, CSV files, API and other data calls keep the bare "Not found".
function notFound(req, res, kind = 'page') {
  const user = currentUser(req), framed = !!user && (!DASH || req.hostname === DASH_HOST);
  res.status(404).send(notFoundPage({ kind, user, side: framed ? sideFor(user) : '', showcase: framed ? [] : showcaseRows() }));
}
app.use((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method) || /^\/(api|admin|static|img|mcp|billing|oauth|auth|unsubscribe|\.well-known)(\/|$)/.test(req.path) || /\.\w{2,5}$/.test(req.path))
    return res.status(404).type('text/plain').send('Not found');
  notFound(req, res);
});

// Emails (src/digest.js): every hour the welcome and big-news emails go to whoever is due, and on Mondays from 12:00 UTC
// the Monday email. The hourly tick is safe to repeat: each email is logged per person.
// Who receives them is set by DIGEST_TO (unset = nobody; a list of emails; or "all").
setInterval(() => {
  if (process.env.DIGEST_TO)
    runMail().then(r => (r.hello.sent || r.welcome.sent || r.news.sent || r.monday?.sent) && console.log('mail', JSON.stringify(r))).catch(e => console.error('mail', e.message));
  // The weekly watch email to us (src/watch.js), whoever else gets email.
  runWatch().then(r => r.sent && console.log('watch', JSON.stringify(r))).catch(e => console.error('watch', e.message));
  try { V.pruneVisitors(); } catch (e) { console.error('prune visitors', e.message); }   // signed-out counts: 30 days
  alertJobs().then(s => s.length && console.log('job alerts', s.join(' '))).catch(e => console.error('job alerts', e.message));   // hourly job failures
  try { const k = ADM.endGifts(getDb()); if (k) console.log('solo gifts ended', k); } catch (e) { console.error('end gifts', e.message); }   // Solo given free: back to Free after its day
}, 3600_000).unref();

app.listen(PORT, () => {
  // Build now, a step at a time, what the first visitors would otherwise wait for: the suggestion table, the checked
  // landscapes and which trials each followed landscape, drug and company covers (the slow part of Home), and the country list
  // (src/country.js, about half a second) so the first visit after a restart does not wait for it.
  const steps = [() => suggest('a'), () => Q.textIndex(), () => country('8.8.8.8'), ...Object.values(PUBLIC).map(p => () => showL(p)),
    ...getDb().prepare('SELECT DISTINCT query FROM saved_landscape').pluck().all().map(q => () => Q.areaTrials(q))];
  const next = () => { const f = steps.shift(); if (!f) return; try { f(); } catch (e) { console.error('warm', e.message); } setImmediate(next); };
  setImmediate(next);
  console.log(`${BRAND} running on http://localhost:${PORT}  (Stripe: ${process.env.STRIPE_SECRET_KEY ? (B.liveMode() ? 'LIVE' : 'test mode') : 'not configured'}, email: ${process.env.RESEND_API_KEY ? 'Resend' : 'printed to log'})`);
});
