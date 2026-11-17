// The signed-in frame: the dashboard's sidebar. The dashboard uses it, and so does every
// drug, company, disease, target and landscape page while signed in (src/pages/shared.js `layout` with `side`).
// Home, MCP connector and Settings are panels of the dashboard's Home page, switched by the # part of the address
// (web/app.js); from any other page those items lead back to it (/app#mcp). Search and each landscape are pages of their own
// (step 2): /app/search?q=…, /app/l/12, and a checked landscape at /landscapes/obesity.
import { esc } from '../../web/table.js';
import { icon } from '../../web/icons.js';
import { heading } from '../suggest.js';
import { BRAND, LOGO, menuButton, themeSwitch } from './shared.js';

// The dashboard's address: / on its own address in production (DASHBOARD_URL), /app locally.
export const APP_HOME = process.env.DASHBOARD_URL ? '/' : '/app';
// A dashboard page's address: /app/l/12 locally, /l/12 on the dashboard's own address.
export const appPath = p => (process.env.DASHBOARD_URL ? '' : '/app') + p;
export const SEARCH_PATH = appPath('/search');
export const searchHref = (q, p = 2) => `${SEARCH_PATH}?q=${encodeURIComponent(q)}&p=${p}`;
const cap = q => q[0].toUpperCase() + q.slice(1);
export const planName = u => (u.plan === 'free' ? 'Free' : cap(u.plan.replace('_year', '')));

// `followed`: rows of saved_landscape (id, query, kind, href). `inApp`: drawn on the dashboard's Home page. `on`: the current item.
// Solo lists everything followed under "Following": landscapes, drugs and companies. Free follows nothing; its one free
// landscape (and one followed under the old Free rule, kept as agreed on 11 Nov) sits under "Your landscape".
// `guide`: the setup guide's data and script (src/pages/guide.js), drawn after the sidebar on every page that has it.
export function sidebar({ user, followed = [], inApp = false, on = '', guide = '' }) {
  const to = h => (inApp ? '' : APP_HOME) + h;
  const group = user.plan === 'free' ? (followed.length ? 'Your free landscape' : 'Your landscape') : 'Following';
  const it = (h, panel, ic, label, attrs = '', end = '') => `<a class="it${on === panel ? ' on' : ''}" href="${h[0] === '#' ? to(h) : h}" data-panel="${panel}"${attrs}>${icon(ic)}<span class="t">${label}</span>${end}</a>`;
  // On a paid plan each followed item shows how many changes it had in the last 14 days (`n`, from src/server.js).
  const count = f => (f.n ? `<span class="n" title="${f.n} ${f.n === 1 ? 'change' : 'changes'} in the last 14 days">${f.n}</span>` : '');
  return `<aside class="side">
  <div class="side-bar"><a class="logo" href="${APP_HOME}">${LOGO}${BRAND}</a>${menuButton('sidebody')}</div>
  <div class="side-body" id="sidebody">
  <div class="side-scroll">
  <nav class="grp" aria-label="Main">
    ${it('#home', 'home', 'home', 'Home')}
    ${it(SEARCH_PATH, 'search', 'search', 'Search')}
  </nav>
  <nav class="grp" id="followgrp" aria-label="${group}"><div class="lbl">${group}</div>
    ${followed.length && user.plan === 'free' ? followed.map(f => `<a class="it gift${on === 'l' + f.id ? ' on' : ''}" href="${f.href || appPath(`/l/${f.id}`)}" data-panel="l${f.id}"${f.kind ? '' : ` data-q="${esc(f.query.toLowerCase())}"`}>${icon('landscape')}<span class="t">${esc(heading(f.query))}</span><span class="freetag" title="Yours to keep">Free</span>${f.unseen ? `<span class="n" title="${f.unseen} ${f.unseen === 1 ? 'change' : 'changes'} since you opened it">${f.unseen}</span>` : ''}</a>`).join('')
    : followed.length ? followed.map(f => it(f.href || appPath(`/l/${f.id}`), `l${f.id}`, 'landscape', esc(heading(f.query)), f.kind ? '' : ` data-q="${esc(f.query.toLowerCase())}"`, count(f))).join('') : `<a class="it ghost" href="${SEARCH_PATH}">${icon('plus')}<span class="t">${user.plan === 'free' ? 'Pick your free landscape' : 'Find something to follow'}</span></a>`}
  </nav>
  <nav class="grp" aria-label="Use with AI"><div class="lbl">Use with AI</div>
    ${it('#mcp', 'mcp', 'plug', 'Connect your AI')}
  </nav>
  </div>
  <div class="side-foot">
  <div class="acct">
    <button class="acct-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="acctmenu">${icon('user')}<span class="acct-who">${esc(user.email)}<span class="acct-plan">${esc(planName(user))}${user.founding && user.plan !== 'free' ? '<span class="pill early">Early customer</span>' : ''}</span></span></button>
    <ul class="acct-menu" id="acctmenu" aria-label="Account">
      <li>${it('#settings', 'settings', 'settings', 'Settings')}</li>
      <li>${it('#settings', 'billing', 'card', 'Plan and billing', '', `<span class="n">${esc(planName(user))}</span>`)}</li>
      <li class="themerow"><div class="it">${icon('contrast')}<span class="t">Theme</span>${themeSwitch()}</div></li>
      <li class="sep"><form method="post" action="/auth/logout"><button class="it" type="submit">${icon('signout')}<span class="t">Sign out</span></button></form></li></ul>
  </div>
  </div>
  </div>
</aside>${guide}`;
}

// Theme: Automatic, Light or Dark (src/pages/shared.js themeSwitch), in the account menu and in Settings.
export { themeSwitch };
