// Server-rendered pages. Public pages arrive complete (no blank screen while scripts load).
import { esc } from '../../web/table.js';
import { icon, logo } from '../../web/icons.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { visitScript } from '../visits.js';

// Speed (phone pass, 15 Nov 2026): the stylesheet and scripts are asked for with their version in the address
// (/static/app.js?v=1a2b3c4d), and src/server.js lets browsers keep a versioned file for a year without asking again. A deploy
// restarts the server, which reads the files anew: a changed file gets a new version, so the new one shows at once.
// The import map sends the scripts' own imports (import … from '/static/table.js') to the same versioned addresses.
const ASSETS = ['style.css', 'ui.js', 'app.js', 'entity.js', 'table.js', 'icons.js', 'guide.js', 'admin.js'];
const VERSION = Object.fromEntries(ASSETS.map(f => [f, createHash('sha1').update(readFileSync(new URL(`../../web/${f}`, import.meta.url))).digest('hex').slice(0, 8)]));
const vurl = f => `/static/${f}?v=${VERSION[f]}`;
const IMPORT_MAP = `<script type="importmap">${JSON.stringify({ imports: Object.fromEntries(ASSETS.filter(f => f.endsWith('.js')).map(f => [`/static/${f}`, vurl(f)])) })}</script>`;
const versioned = html => html.replace(/(src|href)="\/static\/(style\.css|ui\.js|app\.js|entity\.js|table\.js|icons\.js|guide\.js|admin\.js)"/g, (m, a, f) => `${a}="${vurl(f)}"`);

export const BRAND = process.env.BRAND || 'OpenLandscape';
export const REPO = process.env.REPO_URL || '';
const CONTACT = process.env.CONTACT_EMAIL || '';
export const LOGO = logo();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const prettyDate = d => (d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');

// The first time a public page shows inside the dashboard's frame (right after signing up from it), one line says where things
// went. A cookie keeps it from coming back (screen 5, decision 8).
const FRAME_HINT = `<div class="framehint" id="framehint" role="status" hidden><span>You're signed in. Your landscapes, search and AI assistant are <span class="nophone">on the left</span><span class="onphone">in the menu</span>.</span><button class="x" type="button" aria-label="Close" onclick="this.parentNode.remove()">${icon('close', 16)}</button></div>
<script>if(!/(^|; )ol_framed=/.test(document.cookie)){const h=document.getElementById('framehint');h.hidden=false;document.cookie='ol_framed=1; path=/; max-age=31536000; samesite=lax';setTimeout(()=>{h.classList.add('out');setTimeout(()=>h.remove(),400)},8000)}</script>`;
// `side`: the signed-in sidebar (src/pages/frame.js). With it, the page sits in the dashboard's frame in place of the top bar.
// Light or dark by hand (Settings, Appearance): the ol_theme cookie, read before the page is drawn so it never flashes the other
// colours. No cookie: the device decides (web/style.css, prefers-color-scheme).
// `path`: the page's own address on the website (its canonical address); `image`: its link preview (src/images.js), else the
// landing page's. Pages Google may list carry the tags Slack, LinkedIn, X, Teams and iMessage read for a preview (step 12).
const SITE_URL = () => (process.env.PUBLIC_URL || 'https://openlandscape.app').replace(/\/$/, '');
const shareTags = ({ title, desc, path, image }) => {
  const t = esc(title.replace(/ \| [^|]+$/, '')), img = `${SITE_URL()}${image || '/img/og/site.png'}`;
  return `${path ? `<link rel="canonical" href="${esc(SITE_URL() + path)}"><meta property="og:url" content="${esc(SITE_URL() + path)}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND}"><meta property="og:title" content="${t}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`;
};
export function layout({ title, body, user, desc = '', active = '', noindex = false, side = '', bare = false, path = '', image = '' }) {
  return versioned(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${noindex ? '<meta name="robots" content="noindex">' : shareTags({ title, desc, path, image })}
<meta name="theme-color" content="#FAF9F7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#171614" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="icon" href="/static/favicon.ico" sizes="32x32"><link rel="apple-touch-icon" href="/static/apple-touch-icon.png"><link rel="manifest" href="/static/site.webmanifest">
<script>(function(){var m=document.cookie.match(/(?:^|; )ol_theme=(light|dark)/);if(m)document.documentElement.dataset.theme=m[1]})()</script>
<!-- Phones get the stylesheet first and the font after it (font-display: optional), so the font never holds up the first screen. -->
<link rel="preload" href="/static/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin media="(min-width:561px)">
${IMPORT_MAP}<link rel="modulepreload" href="/static/icons.js"><link rel="stylesheet" href="/static/style.css"></head><body>
${side ? `<div class="app framed">${side}<div class="main">${FRAME_HINT}${body}</div></div>` : `${body.includes('class="app"') || bare ? '' : nav(user, active)}
${body}`}
<script type="module" src="/static/ui.js"></script>${visitScript(!!user)}
</body></html>`);
}

// The admin pages (src/admin.js): the dashboard's frame and stylesheet with their own sidebar. Never indexed, and no visit
// counting (they are not the product's pages).
export const adminDoc = ({ title, side, body }) => versioned(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<script>(function(){var m=document.cookie.match(/(?:^|; )ol_theme=(light|dark)/);if(m)document.documentElement.dataset.theme=m[1]})()</script>
${IMPORT_MAP}<link rel="stylesheet" href="/static/style.css"></head><body>
<div class="app">${side}<div class="main">${body}</div></div>
<script type="module" src="/static/ui.js"></script><script type="module" src="/static/admin.js"></script>
</body></html>`);

// The top of a page (design pass: Home, Search, then the landscape pass of 12 Nov): the title, one grey line saying what the
// page is, and under it on the left the one button (Follow) with what it gives. `logo`: a company's logo before the title;
// `intro`: a sentence on what the thing is, between the title and the grey line (a target page).
export const pageHead = (title, desc = '', fol = '', logo = '', intro = '') => `<div class="phead">${logo ? `<div class="named">${logo}<h1>${title}</h1></div>` : `<h1>${title}</h1>`}${intro ? `<p class="intro">${intro}</p>` : ''}${desc ? `<p class="desc">${desc}</p>` : ''}${fol ? `<div class="fol">${fol}</div>` : ''}</div>`;

// The "Menu" / "Close" button of the phone bar. web/ui.js opens and closes the sheet it controls.
export const menuButton = sheet => `<button class="menubtn" type="button" aria-expanded="false" aria-controls="${sheet}">${icon('menu', 20, 'i-open')}${icon('close', 20, 'i-close')}<span>Menu</span></button>`;

// The logo goes to the website's home page. With a separate dashboard address, "/" there is the app (or sign-in when
// signed out), so the link names the website's address.
const siteHome = () => (process.env.DASHBOARD_URL && process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : '') + '/';

// Public top bar. Below 820 wide the links move into the sheet behind "Menu". On the sign-in page (`active` 'signin') "Sign in" is left out.
function nav(user, active) {
  const links = [['/landscapes', 'Landscapes', 'land'], ['/connect', 'Connect your AI', 'connect'], ['/pricing', 'Pricing', 'pricing']];
  const a = ([href, label, key]) => `<a href="${href}"${active === key ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  return `<header class="nav"><div class="wrap">
<a class="logo" href="${esc(siteHome())}">${LOGO}${BRAND}</a>
<nav class="links" aria-label="Main">${links.map(a).join('')}</nav>
<div class="right">${REPO ? `<a class="gh" href="${esc(REPO)}" aria-label="GitHub">${GH}</a>` : `<span class="gh" tabindex="0" role="img" aria-label="GitHub" data-tip="Open source. The GitHub link comes at launch">${GH}</span>`}${user ? `<i class="div" aria-hidden="true"></i><a class="btn sm" href="/app">Home</a>` : active === 'signin' ? '' : `<i class="div" aria-hidden="true"></i><a class="signin" href="/signin">Sign in${icon('arrowUpRight', 16)}</a>`}</div>
${menuButton('navsheet')}
</div>
<div class="sheet" id="navsheet"><nav class="grp" aria-label="Main">${links.map(a).join('')}${REPO ? `<a href="${esc(REPO)}">GitHub</a>` : ''}</nav>
${user ? `<div class="grp"><a href="/app">Home</a></div>` : active === 'signin' ? '' : `<div class="grp"><a href="/signin">Sign in</a></div>`}</div>
</header>`;
}

// The showcase landscapes, for the footer. Same slugs and order as PUBLIC in src/server.js.
export const SHOWCASE_LINKS = [['obesity', 'Obesity'], ['pd1-vegf', 'PD-1/VEGF'], ['invivo-cart', 'CAR-T made inside the body'], ['nsclc', 'Non-small cell lung cancer']];
// Theme: Automatic (the device decides), Light or Dark, as three small icons, like most products do.
// In the account menu, in Settings and in the website footer; web/ui.js wires every one and keeps them in step. Kept on this browser (ol_theme cookie).
export const themeSwitch = () => `<div class="themesw" role="radiogroup" aria-label="Theme">${[['', 'monitor', 'Automatic: follows your device'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']]
  .map(([v, ic, t]) => `<button type="button" role="radio" aria-checked="false" data-theme-pick="${v}" aria-label="${t}" title="${t}">${icon(ic, 16)}</button>`).join('')}</div>`;

// Footer in columns (spec 16 part 2): the sources in words (no regulator logos), then Product, Landscapes and Company.
export function footer(extra = '') {
  const col = (h, links) => `<nav class="fcol" aria-label="${h}"><h2>${h}</h2>${links.map(([href, t]) => `<a href="${esc(href)}">${t}</a>`).join('')}</nav>`;
  return `<footer class="site"><div class="wrap">
<div class="fbrand"><a class="logo" href="${esc(siteHome())}">${LOGO}${BRAND}</a><p>Data from ClinicalTrials.gov, the EU trials register, FDA, EMA and SEC filings.</p></div>
${col('Product', [['/landscapes', 'Landscapes'], ['/connect', 'Connect your AI'], ['/pricing', 'Pricing'], ['/how-we-check', 'How we check']])}
${col('Landscapes', SHOWCASE_LINKS.map(([s, t]) => ['/landscapes/' + s, t]))}
${col('Company', [...(REPO ? [[REPO, 'GitHub']] : []), ...(CONTACT ? [[`mailto:${CONTACT}?subject=Wrong%20row`, 'Report a wrong row']] : []), ['/talk', 'Talk to us'], ['/privacy', 'Privacy'], ['/terms', 'Terms']])}
<div class="fbar"><p class="fcopy">© ${new Date().getFullYear()} ${BRAND}<span class="dot" aria-hidden="true">·</span>${REPO ? `<a class="fgh" href="${esc(REPO)}">${GH}Open source on GitHub</a>` : `<span class="fgh">${GH}Open source</span>`}</p>${themeSwitch()}</div>
${extra}</div></footer>`;
}
export const GH = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
