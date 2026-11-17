// Our own visit counting: no outside analytics. Every page drawn by layout() (src/pages/shared.js)
// tells /v once it has loaded in a browser; most scrapers never run the page, and the ones that say what they are are dropped here.
// Kept per page opened: day, page (no query string: searches can be private), the site that sent them (host only), a campaign name
// (utm_source), phone/tablet/computer, the country (looked up from the address, src/country.js), signed in or not, and a visitor code. The code mixes the address and browser with a salt that
// changes every day and is then forgotten, so it counts people per day but cannot be traced back to anyone. No address is kept.
import { createHash, randomBytes } from 'node:crypto';
import { getDb, meta } from './db.js';
import { country } from './country.js';

export const BOT_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|preview|scan|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|httpclient|libwww/i;
export const device = ua => (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? 'tablet'
  : /mobi|iphone|ipod|android|phone/i.test(ua) ? 'phone' : 'computer');
// The site that sent them, as a bare host ("linkedin.com"); empty for none, our own pages, or anything that is not a web address.
export function refHost(ref, ownHost = '') {
  try {
    const u = new URL(String(ref || ''));
    if (!/^https?:$/.test(u.protocol)) return '';
    const h = u.hostname.toLowerCase().replace(/^www\./, ''), own = String(ownHost).toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
    return !own || (h !== own && !h.endsWith('.' + own) && !own.endsWith('.' + h)) ? h.slice(0, 100) : '';
  } catch { return ''; }
}
const cleanPath = p => (typeof p === 'string' && p.startsWith('/') ? p.split(/[?#]/)[0].slice(0, 200) : '');
// The day's salt: made fresh each day (kept in meta so a restart the same day counts the same people once), the old one overwritten.
function salt(day) {
  const [d, s] = String(meta.get('visit_salt') || '').split(':');
  if (d === day && s) return s;
  const fresh = randomBytes(16).toString('hex');
  meta.set('visit_salt', `${day}:${fresh}`);
  return fresh;
}
// One page opened. body: { p: page, r: referrer, u: utm_source, f: { r, p } (the first visit before signing up, kept in the browser) }.
// Returns false when nothing was recorded (a bot, or no page).
export function recordView(body, { ip = '', ua = '', user = null, host = '', now = new Date() } = {}) {
  const path = cleanPath(body?.p);
  if (!path || !ua || BOT_AGENT.test(ua)) return false;
  const day = now.toISOString().slice(0, 10), db = getDb();
  const visitor = createHash('sha256').update(`${salt(day)}|${ip}|${ua}`).digest('hex').slice(0, 16);
  const utm = String(body?.u || '').replace(/[^\w.-]/g, '').slice(0, 60);
  db.prepare('INSERT INTO page_view (day, path, ref, utm, device, visitor, signed_in, country) VALUES (?,?,?,?,?,?,?,?)')
    .run(day, path, refHost(body?.r, host), utm, device(ua), visitor, user ? 1 : 0, country(ip));
  // How a new account found us: the first visit the browser kept from before signing up, for an account made in the last two days.
  const f = body?.f;
  if (user && f && !user.first_ref && Date.now() - Date.parse(String(user.created_at).replace(' ', 'T') + 'Z') < 2 * 864e5)
    db.prepare('UPDATE user SET first_ref=?, first_page=? WHERE id=? AND first_ref IS NULL').run(refHost(f.r, host) || 'direct', cleanPath(f.p), user.id);
  return true;
}
// Signed-out page counts per computer (src/limits.js) are kept 30 days, then deleted. Called every hour.
export const pruneVisitors = (now = new Date()) =>
  getDb().prepare('DELETE FROM visitor_day WHERE day < ?').run(new Date(now - 30 * 864e5).toISOString().slice(0, 10)).changes;

// The script every page carries (layout()). Signed out, the first visit is kept in the browser (localStorage, "how you found us")
// until the account is made; signed in, it is sent once and removed.
export const visitScript = signedIn => `<script>(function(){try{var s=${signedIn ? 1 : 0},k='ol_first',f=null,r=document.referrer,h=location.host;
try{f=localStorage.getItem(k);if(!s&&!f){var x='';try{if(r&&new URL(r).host!==h)x=r}catch(e){}localStorage.setItem(k,JSON.stringify({r:x,p:location.pathname}))}
if(s&&f)localStorage.removeItem(k);else f=null}catch(e){f=null}
fetch('/v',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({p:location.pathname,r:r,u:new URLSearchParams(location.search).get('utm_source')||'',f:f?JSON.parse(f):null})}).catch(function(){})}catch(e){}})()</script>`;
