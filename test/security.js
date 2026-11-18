// Fixes from the security read of 18 Nov, on a throwaway database: a broken cookie no longer stops the server; the connector
// refuses big batches and more than 5 show() calls a minute; app registrations stay small and unused ones are deleted;
// onboarding's preview shares the 30-a-minute landscape limit; the sign-in page names a Follow's company from the tables;
// the visit counter stops at 300 an hour from one address.
// Follow-ups of 18 Nov: registration back to 1,000 an hour; the Allow page shows the return website and warns when an app
// borrows Claude's or ChatGPT's name; Choose Solo on a paid account makes no second checkout; older Safari (no
// Sec-Fetch-Site) is checked by Origin; % and _ in a typed email domain match only themselves.
import { tempDir } from './tmp.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const PORT = 8000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
const DB_PATH = join(tempDir('ol-security-'), 'test.db');
process.env.DB_PATH = DB_PATH;
const env = { ...process.env, PORT, DB_PATH, PUBLIC_URL: '', DASHBOARD_URL: '', COOKIE_DOMAIN: '', NODE_ENV: 'test', RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MCP_OPEN: '', AI_CARDS: '1' };
const srv = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let log = '', exited = false;
srv.stdout.on('data', d => { log += d; });
srv.on('exit', () => { exited = true; });
await new Promise((ok, fail) => { srv.stdout.on('data', () => /running on/.test(log) && ok()); srv.on('exit', c => fail(new Error('server exited ' + c))); });

const { getDb } = await import('../src/db.js');
const { createApiKey } = await import('../src/auth.js');
const { pruneClients } = await import('../src/oauth.js');
const { signupProblem } = await import('../src/limits.js');
const db = getDb();
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const get = (path, opts = {}) => fetch(BASE + path, { redirect: 'manual', ...opts });
const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', redirect: 'manual', body, headers });
const json = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

try {
  // 1. A cookie that is not valid %-encoding, on pages that used to stop the server.
  const bad = { Cookie: 'x=%E0%A4' };
  await get('/billing/portal', { headers: bad }).catch(() => null);
  await post('/auth/start', new URLSearchParams({ email: 'z@example.com' }), bad).catch(() => null);
  await new Promise(r => setTimeout(r, 200));
  const page = await get('/signin').catch(() => null);
  ok(!exited && page?.status === 200, 'a broken cookie does not stop the server');

  // 2. Connector: batches and show().
  db.prepare("INSERT INTO user (email, plan) VALUES ('ai@example.com', 'free')").run();
  const key = createApiKey(db.prepare("SELECT id FROM user WHERE email='ai@example.com'").pluck().get());
  let id = 0;
  const msg = (method, params) => ({ jsonrpc: '2.0', id: ++id, method, params });
  let r = await post(`/mcp/u/${key}`, JSON.stringify(Array.from({ length: 6 }, () => msg('tools/list', {}))), json);
  ok(r.status === 400, 'a batch of 6 messages is refused');
  const show = () => post(`/mcp/u/${key}`, JSON.stringify(msg('tools/call', { name: 'show', arguments: { main: { tool: 'landscape', args: { area: 'obesity' } } } })), json).then(x => x.json());
  const said = [];
  for (let i = 0; i < 6; i++) said.push((await show()).result?.content?.[0]?.text || '');
  ok(said.slice(0, 5).every(t => /Nothing shown/.test(t)) && /Too many show\(\) calls/.test(said[5]), 'the sixth show() in a minute is refused');

  // 3. App registration stays small; unused apps go after a day.
  const reg = body => post('/register', JSON.stringify(body), { 'Content-Type': 'application/json' });
  r = await reg({ redirect_uris: ['https://app.example/cb'], client_name: 'x'.repeat(5000) });
  ok(r.status === 400 && (await r.json()).error === 'invalid_client_metadata', 'a 5,000-character app name is refused');
  r = await reg({ redirect_uris: Array.from({ length: 6 }, (_, i) => `https://app.example/cb${i}`), client_name: 'Six' });
  ok(r.status === 400, 'six return addresses are refused');
  r = await reg({ redirect_uris: ['https://app.example/cb'], client_name: 'Claude' });
  const fresh = (await r.json()).client_id;
  ok(r.status === 201 && !!fresh, 'a normal registration still works');
  db.prepare("INSERT INTO oauth_client (client_id, info, created_at) VALUES ('old-unused', '{}', datetime('now','-2 days')), ('old-used', '{}', datetime('now','-2 days'))").run();
  db.prepare("INSERT INTO oauth_token (token_hash, kind, client_id, user_id, expires_at) VALUES ('h', 'refresh', 'old-used', 1, datetime('now','+1 day'))").run();
  pruneClients();
  const left = db.prepare('SELECT client_id FROM oauth_client').pluck().all();
  ok(!left.includes('old-unused') && left.includes('old-used') && left.includes(fresh), 'pruning deletes only apps over a day old with no sign-in');

  // 4. Onboarding's preview: a signed-in account, 31 new searches in a minute.
  await post('/auth/start', new URLSearchParams({ email: 'pre@example.com' }));
  await new Promise(r => setTimeout(r, 50));
  const code = [...log.matchAll(/Sign-in link for pre@example\.com: \S+\s+code (\d{6})/g)].pop()?.[1];
  r = await post('/auth/code', new URLSearchParams({ email: 'pre@example.com', code }));
  const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => /^op_session=./.test(c)).join('; ');
  ok(!!cookie, 'signed in for the preview check');
  const codes = [];
  for (let i = 0; i < 31; i++) codes.push((await get(`/app/welcome?q=word${i}`, { headers: { Cookie: cookie } })).status);
  ok(codes.slice(0, 30).every(c => c === 200) && codes[30] === 429, 'the 31st new preview in a minute is refused');
  ok((await get('/app/welcome?q=word0', { headers: { Cookie: cookie } })).status === 200, 'a preview already built still opens');

  // 5. The sign-in page names a Follow's company and drug from the tables.
  db.prepare("INSERT INTO company (id, name) VALUES ('acme', 'Acme Bio')").run();
  let t = await (await get(`/signin?next=${encodeURIComponent('/follow?kind=company&id=acme')}`)).text();
  ok(t.includes('Acme Bio'), 'sign-in page for a company Follow names the company');

  // 6. The visit counter: 300 an hour from one address.
  const ua = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh) Safari/605' };
  for (let i = 0; i < 305; i++) await post('/v', JSON.stringify({ p: '/' }), ua);
  ok(db.prepare('SELECT count(*) FROM page_view').pluck().get() === 300, 'the visit counter stops at 300 an hour from one address');

  // 7. The Allow page: the return website large under the heading; a warning when an app borrows Claude's or ChatGPT's name.
  const b64 = b => b.toString('base64url');
  const consentPage = async (name, cb) => {
    const c = await (await reg({ redirect_uris: [cb], client_name: name, token_endpoint_auth_method: 'none' })).json();
    const verifier = b64(randomBytes(32));
    const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: cb, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 's', resource: `${BASE}/mcp`, scope: 'mcp' });
    const to = (await get('/authorize?' + q)).headers.get('location');
    return (await get(to, { headers: { Cookie: cookie } })).text();
  };
  const warned = p => p.includes('class="cswarn"');
  const primary = p => (p.match(/class="btn primary" type="submit" name="allow" value="(\d)">([^<]+)</) || []).slice(1).join(' ');
  t = await consentPage('Claude', 'https://claude.ai/api/mcp/auth_callback');
  ok(t.includes('<h1>Connect Claude</h1>') && /class="cshost">.*claude\.ai</.test(t) && !warned(t) && primary(t) === '1 Allow' && /class="cshost"><img src="\/static\/icons\/claude\.svg"/.test(t), 'real Claude: Claude logo and claude.ai under the heading, no warning, Allow is the main button');
  t = await consentPage('Claude', 'https://claude.com/api/mcp/auth_callback');
  ok(!warned(t), 'real Claude from claude.com: no warning');
  t = await consentPage('Claude Connector', 'https://claude-connect.net/cb');
  ok(t.includes('Connect an app that calls itself “Claude Connector”') && /class="cshost">.*claude-connect\.net</.test(t) && warned(t)
    && t.includes("This isn't Claude's website. Claude connects from <b class=\"mono\">claude.ai</b>. Cancel unless you know this app.")
    && primary(t) === '0 Cancel' && t.includes('>Allow anyway<') && !/class="cshost"><img/.test(t), 'fake Claude: globe not the logo, warning, Cancel is the main button, "Allow anyway"');
  t = await consentPage('chatgpt', 'https://chatgpt-tools.example/cb');
  ok(warned(t) && t.includes('ChatGPT connects from <b class="mono">chatgpt.com</b>'), 'fake ChatGPT (any capitals): warning names chatgpt.com');
  t = await consentPage('ChatGPT', 'https://chatgpt.com/connector_platform_oauth_redirect');
  ok(!warned(t) && primary(t) === '1 Allow', 'real ChatGPT: no warning');
  t = await consentPage('Claude Code', 'http://localhost:53123/callback');
  ok(!warned(t) && t.includes('an app on this computer') && primary(t) === '1 Allow', 'Claude Code on this computer: no warning, the loopback sentence stays');
  t = await consentPage('Cursor', 'https://cursor.example/cb');
  ok(!warned(t) && /class="cshost">.*cursor\.example</.test(t) && primary(t) === '1 Allow', 'an honest name: the website large, no warning');

  // 8. Registration: 1,000 an hour from one address (over 300 here, the old limit).
  const regs = [];
  for (let i = 0; i < 300; i++) regs.push((await reg({ redirect_uris: ['https://app.example/cb'], client_name: `App ${i}` })).status);
  ok(regs.every(c => c === 201), 'more than 300 registrations an hour from one address still work');

  // 9. Choose Solo on an account that already pays: no second checkout. (No Stripe key here, so no billing page: Home.)
  const pre = db.prepare("SELECT id FROM user WHERE email='pre@example.com'").pluck().get();
  r = await post('/billing/checkout', new URLSearchParams({ plan: 'solo' }), { Cookie: cookie });
  ok(r.status === 400, 'Free: Choose Solo goes on to checkout (refused here: payments not configured)');
  db.prepare("UPDATE user SET plan='solo', stripe_customer='cus_test' WHERE id=?").run(pre);
  r = await post('/billing/checkout', new URLSearchParams({ plan: 'solo' }), { Cookie: cookie });
  ok(r.status === 303 && r.headers.get('location') === '/app', 'Solo: Choose Solo goes to billing or Home, no new checkout');
  r = await get('/billing/solo', { headers: { Cookie: cookie } });
  ok(r.status === 303 && r.headers.get('location') === '/app', 'Solo: the Choose Solo link goes to billing or Home, no new checkout');
  db.prepare("UPDATE user SET plan='free', stripe_customer=NULL WHERE id=?").run(pre);

  // 10. Cross-site posts when the browser sends no Sec-Fetch-Site (older Safari): the Origin header decides.
  const out = h => post('/auth/logout', '', h).then(x => x.status);
  ok(await out({ Origin: 'https://evil.example' }) === 403, 'no Sec-Fetch-Site, another site in Origin: refused');
  ok(await out({ Origin: BASE }) === 302, 'no Sec-Fetch-Site, our own Origin: allowed');
  ok(await out({}) === 302, 'neither header: allowed, as before');
  ok(await out({ 'Sec-Fetch-Site': 'cross-site' }) === 403, 'Sec-Fetch-Site cross-site: refused, as before');
  ok((await post('/follow', new URLSearchParams({ q: 'obesity', p: '1' }), { Cookie: cookie, Origin: 'https://evil.example' })).status === 403, 'Follow from another site without Sec-Fetch-Site: refused');

  // 11. A typed email domain with % or _ matches only itself (a@%.% used to read every account).
  let seen = -1;
  const prep = db.prepare.bind(db);
  db.prepare = sql => { const st = prep(sql); if (!/LIKE/.test(sql)) return st; const pl = st.pluck.bind(st); st.pluck = (...a) => { const p = pl(...a); const all = p.all.bind(p); p.all = (...x) => { const rows = all(...x); seen = rows.length; return rows; }; return p; }; return st; };
  signupProblem('a@%.%', '');
  ok(seen === 0, 'a@%.% matches no account');
  signupProblem('someone@example.com', '');
  ok(seen > 0, 'a normal domain still finds the accounts on it');
  db.prepare = prep;
} finally {
  srv.kill();
}
