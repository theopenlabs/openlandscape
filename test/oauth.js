// Connector sign-in (src/oauth.js) end to end, the way Claude, ChatGPT and Claude Code do it, on a throwaway database:
// discovery, registration, Allow page, PKCE code exchange, refresh rotation, MCP calls with the token, and the old API keys.
import { tempDir } from './tmp.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const PORT = 8000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
const DB_PATH = join(tempDir('ol-oauth-'), 'test.db');
const REVIEWER = { email: 'reviewer@example.com', code: 'test-code-1234567' };
const env = { ...process.env, PORT, DB_PATH, PUBLIC_URL: '', DASHBOARD_URL: '', COOKIE_DOMAIN: '', NODE_ENV: 'test', REVIEWER_EMAIL: REVIEWER.email, REVIEWER_CODE: REVIEWER.code, MCP_OPEN: '' };
const srv = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => { srv.stdout.on('data', d => /running on/.test(d) && ok()); srv.on('exit', c => fail(new Error('server exited ' + c))); });

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const b64 = b => b.toString('base64url');
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null));
const get = (path, opts = {}) => fetch(BASE + path, { redirect: 'manual', ...opts });
const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', redirect: 'manual', body, headers });
const cookieOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
let rpcId = 0;
const rpc = (method, params, auth, path = '/mcp') => post(path, JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) });

try {
  // ---- discovery ----
  let r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  const www = r.headers.get('www-authenticate') || '';
  ok(r.status === 401 && www.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`), 'no sign-in: 401 pointing at the resource metadata');
  const prm = await (await get('/.well-known/oauth-protected-resource/mcp')).json();
  ok(prm.resource === `${BASE}/mcp` && prm.authorization_servers[0] === BASE, 'resource metadata names /mcp and this site as the authorization server');
  ok((await (await get('/.well-known/oauth-protected-resource')).json()).resource === `${BASE}/mcp`, 'resource metadata also at the root path (fallback probing)');
  const as = await (await get('/.well-known/oauth-authorization-server')).json();
  ok(as.issuer === BASE && as.code_challenge_methods_supported.includes('S256') && as.registration_endpoint === `${BASE}/register`
    && as.token_endpoint_auth_methods_supported.includes('none') && as.authorization_response_iss_parameter_supported, 'authorization server metadata: S256, registration, public clients, iss');

  // ---- registration ----
  const reg = async body => (await post('/register', JSON.stringify(body), { 'Content-Type': 'application/json' })).json();
  const pub = await reg({ client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] });
  const conf = await reg({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_basic' });
  ok(pub.client_id && !pub.client_secret && conf.client_secret && !conf.client_secret_expires_at, 'registration: public client without secret, confidential client with a secret that does not expire');

  // ---- sign in (reviewer code) ----
  const authorize = (client, redirect, extra = {}) => {
    const verifier = b64(randomBytes(32)), state = b64(randomBytes(8));
    const q = form({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state, resource: `${BASE}/mcp`, scope: 'mcp', ...extra });
    return { verifier, state, go: () => get('/authorize?' + q) };
  };
  let a = authorize(pub, 'http://localhost:53123/callback');
  r = await a.go();
  const consent = r.headers.get('location');
  ok(r.status === 302 && /^\/oauth\/consent\?r=/.test(consent), 'authorize (loopback on any port) sends the person to the Allow page');
  r = await get(consent);
  ok(r.status === 302 && r.headers.get('location') === `/signin?next=${encodeURIComponent(consent)}`, 'Allow page asks to sign in first and comes back after');
  r = await get(r.headers.get('location'));
  const nextCookie = cookieOf(r);
  r = await post('/auth/start', form({ email: REVIEWER.email }), { Cookie: nextCookie });
  ok((await r.text()).includes('Reviewer code for'), 'reviewer email asks for the code instead of sending a link');
  r = await post('/auth/code', form({ email: REVIEWER.email, code: 'wrong-code-000000' }), { Cookie: nextCookie });
  ok(r.status === 200 && !cookieOf(r).includes('op_session') && (await r.text()).includes('not right'), 'wrong reviewer code: no session');
  r = await post('/auth/code', form({ email: 'someone@example.com', code: REVIEWER.code }), { Cookie: nextCookie });
  ok(!cookieOf(r).includes('op_session'), 'reviewer code does not work for another email');
  r = await post('/auth/code', form({ email: REVIEWER.email, code: REVIEWER.code }), { Cookie: nextCookie });
  const session = cookieOf(r).split('; ').find(c => c.startsWith('op_session='));
  ok(r.status === 302 && session && r.headers.get('location') === consent, 'right reviewer code signs in and returns to the Allow page');

  // ---- Allow page and code exchange ----
  r = await get(consent, { headers: { Cookie: session } });
  const page = await r.text();
  ok(r.status === 200 && page.includes('<h1>Connect Claude Code</h1>') && page.includes('localhost') && page.includes('an app on this computer'), 'Allow page names the app, the return host and warns for loopback');
  const allow = async (c, yes = '1') => post('/oauth/consent', form({ r: new URL(BASE + c).searchParams.get('r'), allow: yes }), { Cookie: session });
  r = await allow(consent);
  let back = new URL(r.headers.get('location'));
  const code = back.searchParams.get('code');
  ok(back.origin === 'http://localhost:53123' && code && back.searchParams.get('state') === a.state && back.searchParams.get('iss') === BASE, 'Allow returns code, state and iss to the app');
  ok((await allow(consent)).status === 400, 'the same Allow request cannot be used twice');

  const token = body => post('/token', form(body), { 'Content-Type': 'application/x-www-form-urlencoded' }).then(async x => ({ status: x.status, ...(await x.json()) }));
  let t = await token({ grant_type: 'authorization_code', client_id: pub.client_id, code, code_verifier: 'x'.repeat(43), redirect_uri: 'http://localhost:53123/callback', resource: `${BASE}/mcp` });
  ok(t.status === 400 && t.error === 'invalid_grant', 'wrong PKCE verifier is refused');
  t = await token({ grant_type: 'authorization_code', client_id: pub.client_id, code, code_verifier: a.verifier, redirect_uri: 'http://localhost:53123/callback', resource: `${BASE}/mcp` });
  ok(t.status === 200 && t.access_token && t.refresh_token && t.expires_in === 3600, 'code + verifier gives an access and a refresh token');
  const again = await token({ grant_type: 'authorization_code', client_id: pub.client_id, code, code_verifier: a.verifier, redirect_uri: 'http://localhost:53123/callback' });
  ok(again.status === 400 && again.error === 'invalid_grant', 'a code works once');

  // ---- MCP with the token ----
  r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }, t.access_token);
  ok(r.status === 200, 'MCP initialize with the token');
  const tools = (await (await rpc('tools/list', {}, t.access_token)).json()).result.tools;
  ok(['whoami', 'search', 'landscape', 'drug', 'trials', 'catalysts', 'who_runs_trials', 'changes'].every(n => tools.some(x => x.name === n)) && tools.every(x => x.title && x.annotations?.readOnlyHint === true), 'eight tools, each with a title and readOnlyHint (directory requirement)');
  const who = (await (await rpc('tools/call', { name: 'whoami', arguments: {} }, t.access_token)).json()).result.content[0].text;
  ok(who.includes(REVIEWER.email) && who.includes('Plan: Solo') && who.includes('300 lookups a day'), `whoami: ${who}`);
  // AI lookups: Solo has a quiet ceiling of 1000 a day; Free gets 25 a calendar month (rows written straight to the test database).
  {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(DB_PATH), uid = db.prepare('SELECT id FROM user WHERE email=?').pluck().get(REVIEWER.email);
    const add = (n, at) => { const q = db.prepare("INSERT INTO usage (user_id, kind, detail, at) VALUES (?, 'mcp', 'test', ?)"); for (let i = 0; i < n; i++) q.run(uid, at); };
    const call = async () => (await (await rpc('tools/call', { name: 'search', arguments: { query: 'obesity' } }, t.access_token)).json()).result;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19), lastMonth = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10) + ' 12:00:00';
    add(1000, now);
    let res = await call();
    ok(res.isError && /start again tomorrow/.test(res.content[0].text), 'Solo: the 1000th lookup in a day hits the quiet ceiling');
    db.prepare("DELETE FROM usage WHERE user_id=? AND kind='mcp'").run(uid);
    db.prepare("UPDATE user SET plan='free' WHERE id=?").run(uid);
    add(25, lastMonth);
    const whoFree = (await (await rpc('tools/call', { name: 'whoami', arguments: {} }, t.access_token)).json()).result.content[0].text;
    ok(whoFree.includes('Plan: Free') && whoFree.includes('25 of 25 free lookups left this month'), `Free: last month's lookups do not count: ${whoFree}`);
    add(25, now);
    res = await call();
    ok(res.isError && /this month's 25 free lookups/.test(res.content[0].text) && /come back on 1 /.test(res.content[0].text), `Free: the 26th lookup this month is refused: ${res.content[0].text}`);
    db.prepare("UPDATE user SET plan='solo' WHERE id=?").run(uid);
    db.prepare("DELETE FROM usage WHERE user_id=? AND kind='mcp'").run(uid);
    db.close();
  }
  r = await rpc('tools/list', {}, 'ola_not-a-real-token');
  ok(r.status === 401 && (r.headers.get('www-authenticate') || '').includes('error="invalid_token"'), 'bad token: 401 invalid_token');

  // ---- refresh rotation ----
  const t2 = await token({ grant_type: 'refresh_token', client_id: pub.client_id, refresh_token: t.refresh_token, resource: `${BASE}/mcp` });
  ok(t2.status === 200 && t2.refresh_token !== t.refresh_token, 'refresh gives a new pair');
  const t3 = await token({ grant_type: 'refresh_token', client_id: pub.client_id, refresh_token: t.refresh_token });
  ok(t3.status === 400 && t3.error === 'invalid_grant', 'an old refresh token is refused with invalid_grant');
  ok((await rpc('tools/list', {}, t2.access_token)).status === 200, 'the new access token works');
  const t4 = await token({ grant_type: 'refresh_token', client_id: conf.client_id, client_secret: conf.client_secret, refresh_token: t2.refresh_token });
  ok(t4.status === 400, "another app cannot use this app's refresh token");

  // ---- confidential client (Claude web), HTTP Basic at the token endpoint; Cancel; wrong resource ----
  a = authorize(conf, 'https://claude.ai/api/mcp/auth_callback');
  let c2 = (await a.go()).headers.get('location');
  back = new URL((await allow(c2)).headers.get('location'));
  r = await post('/token', form({ grant_type: 'authorization_code', code: back.searchParams.get('code'), code_verifier: a.verifier, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }),
    { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${conf.client_id}:${conf.client_secret}`).toString('base64') });
  ok(r.status === 200 && (await r.json()).access_token, 'confidential client signs in with HTTP Basic');
  r = await rpc('tools/list', {}, t2.access_token);
  ok(r.status === 401, 'one AI app at a time: Claude signing in ends Claude Code\'s access');
  a = authorize(conf, 'https://claude.ai/api/mcp/auth_callback');
  c2 = (await a.go()).headers.get('location');
  back = new URL((await allow(c2, '0')).headers.get('location'));
  ok(back.searchParams.get('error') === 'access_denied' && !back.searchParams.get('code'), 'Cancel returns access_denied');
  r = await authorize(conf, 'https://claude.ai/api/mcp/auth_callback', { resource: 'https://evil.example/mcp' }).go();
  ok(new URL(r.headers.get('location')).searchParams.get('error') === 'invalid_target', 'a token for another server is refused');
  r = await authorize(conf, 'https://evil.example/callback').go();
  ok(r.status === 400, 'unregistered redirect is refused');

  // ---- API keys still work; whoami is free ----
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);
  const uid = db.prepare('SELECT id FROM user WHERE email=?').pluck().get(REVIEWER.email);
  ok(db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='mcp'").pluck().get(uid) === 0, 'whoami does not count as a call');
  db.prepare('INSERT INTO user (email) VALUES (?)').run('keyuser@example.com');
  const kid = db.prepare('SELECT id FROM user WHERE email=?').pluck().get('keyuser@example.com');
  const key = 'op_test_' + b64(randomBytes(24));
  db.prepare('INSERT INTO api_key (user_id, key_hash, prefix) VALUES (?,?,?)').run(kid, createHash('sha256').update(key).digest('hex'), key.slice(0, 12));
  ok((await rpc('tools/list', {}, null, `/mcp/u/${key}`)).status === 200, 'key in the URL still works');
  ok((await rpc('tools/list', {}, key)).status === 200, 'key as Bearer header still works');
  r = await rpc('tools/list', {}, null, '/mcp/u/op_test_wrong');
  ok(r.status === 401 && !r.headers.get('www-authenticate'), 'wrong key in URL: 401 without a sign-in prompt');

  // ---- pages ----
  // (/connect itself needs landscape data for its demo, which this empty database has not got.)
  const { aiSetupBox } = await import('../src/pages/connect.js');
  const box = aiSetupBox(BASE);
  ok(box.includes('Copy setup prompt') && box.includes(`${BASE}/mcp</code>`) && box.includes(`claude mcp add --transport http --scope user openlandscape ${BASE}/mcp`), 'setup box (app and /connect): setup prompt, keyless URL, Claude Code steps in the prompt');
  const md = await (await get('/setup.md')).text();
  ok(md.includes(`${BASE}/mcp`) && !md.includes('openlandscape.app') && md.includes('whoami'), '/setup.md is pointed at this site');
  ok((await get('/skill/SKILL.md')).status === 200, 'skill file still served');
} finally { srv.kill(); }
