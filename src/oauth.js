// Sign-in for the MCP connector (OAuth 2.1 with PKCE, as the MCP spec asks). Claude, ChatGPT and other apps register
// themselves (dynamic client registration), send the person here to approve, and get a token tied to that person.
// The SDK's handlers do the protocol checks; this file stores clients, codes and tokens (hashed) and shows the Allow page.
// API keys (/mcp/u/<key>, or "Authorization: Bearer op_...") keep working alongside.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { getDb } from './db.js';
import { dropConnections } from './auth.js';
import { oauthConsentPage } from './pages/connect.js';

const sha = s => createHash('sha256').update(String(s)).digest('hex');
const rand = n => randomBytes(n).toString('base64url');
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 60;

export const BASE = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`;
export const MCP_URL = `${BASE}/mcp`;
export const RESOURCE_METADATA_URL = `${BASE}/.well-known/oauth-protected-resource/mcp`;

// A token is for this server only. Apps send the MCP URL as "resource"; some send the bare site.
const ourResource = r => !r || r.href.replace(/\/$/, '') === MCP_URL || r.href.replace(/\/$/, '') === BASE;

const clientsStore = {
  getClient: id => { const r = getDb().prepare('SELECT info FROM oauth_client WHERE client_id=?').pluck().get(String(id)); return r ? JSON.parse(r) : undefined; },
  registerClient: info => {
    const why = clientTooBig(info);
    if (why) throw new InvalidClientMetadataError(why);
    getDb().prepare('INSERT INTO oauth_client (client_id, info) VALUES (?,?)').run(info.client_id, JSON.stringify(info));
    return info;
  },
};
// Anyone may register an app, without signing in, so a registration stays small: a short name, a few return addresses,
// 4 KB in all. (Without this, one script could fill the disk with huge names.)
function clientTooBig(info) {
  if (String(info.client_name || '').length > 100) return 'client_name: at most 100 characters';
  if ((info.redirect_uris || []).length > 5 || info.redirect_uris.some(u => String(u).length > 500)) return 'redirect_uris: at most 5, each at most 500 characters';
  if (JSON.stringify(info).length > 4096) return 'client metadata: at most 4 KB';
  return '';
}
// Apps registered over a day ago that never got a sign-in started or a token: deleted (hourly, src/server.js).
export function pruneClients() {
  return getDb().prepare(`DELETE FROM oauth_client WHERE created_at < datetime('now','-1 day')
    AND client_id NOT IN (SELECT client_id FROM oauth_token WHERE client_id IS NOT NULL)
    AND client_id NOT IN (SELECT client_id FROM oauth_code WHERE client_id IS NOT NULL)
    AND client_id NOT IN (SELECT client_id FROM oauth_request WHERE client_id IS NOT NULL)`).run().changes;
}

function issue(clientId, userId, resource) {
  const access = 'ola_' + rand(32), refresh = 'olr_' + rand(32);
  const ins = getDb().prepare("INSERT INTO oauth_token (token_hash, kind, client_id, user_id, resource, expires_at) VALUES (?,?,?,?,?,datetime('now', ?))");
  ins.run(sha(access), 'access', clientId, userId, resource || null, `+${ACCESS_SECONDS} seconds`);
  ins.run(sha(refresh), 'refresh', clientId, userId, resource || null, `+${REFRESH_DAYS} days`);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh };
}
// Codes and refresh tokens work once: the row is deleted as it is used.
function take(table, col, value, clientId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${col}=? AND expires_at > datetime('now')`).get(sha(value));
  if (!row || row.client_id !== clientId) throw new InvalidGrantError('Unknown, used or expired grant');
  db.prepare(`DELETE FROM ${table} WHERE ${col}=?`).run(sha(value));
  return row;
}

export const provider = {
  clientsStore,
  // Keep the request server-side and send the person to the Allow page, which signs them in first if needed.
  async authorize(client, params, res) {
    if (!ourResource(params.resource)) throw new InvalidTargetError('This server only issues tokens for ' + MCP_URL);
    const id = rand(24);
    getDb().prepare("INSERT INTO oauth_request (id_hash, client_id, params, expires_at) VALUES (?,?,?,datetime('now','+30 minutes'))")
      .run(sha(id), client.client_id, JSON.stringify({ ...params, resource: params.resource?.href }));
    res.redirect(302, `/oauth/consent?r=${id}`);
  },
  async challengeForAuthorizationCode(client, code) {
    const row = getDb().prepare("SELECT client_id, challenge FROM oauth_code WHERE code_hash=? AND expires_at > datetime('now')").get(sha(code));
    if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Unknown, used or expired code');
    return row.challenge;
  },
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const row = take('oauth_code', 'code_hash', code, client.client_id);
    if (redirectUri && redirectUri !== row.redirect_uri) throw new InvalidGrantError('redirect_uri does not match');
    if (resource && row.resource && resource.href !== row.resource) throw new InvalidTargetError('resource does not match');
    return issue(client.client_id, row.user_id, row.resource);
  },
  async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
    if (!ourResource(resource)) throw new InvalidTargetError('This server only issues tokens for ' + MCP_URL);
    const row = take('oauth_token', 'token_hash', refreshToken, client.client_id);
    if (row.kind !== 'refresh') throw new InvalidGrantError('Not a refresh token');
    getDb().prepare("DELETE FROM oauth_token WHERE expires_at <= datetime('now')").run();
    return issue(client.client_id, row.user_id, row.resource);
  },
  async verifyAccessToken(token) {
    const row = getDb().prepare("SELECT * FROM oauth_token WHERE token_hash=? AND kind='access' AND expires_at > datetime('now')").get(sha(token));
    if (!row) throw new InvalidTokenError('Invalid or expired token');
    return { token, clientId: row.client_id, scopes: [], expiresAt: Math.floor(Date.parse(row.expires_at.replace(' ', 'T') + 'Z') / 1000), extra: { userId: row.user_id } };
  },
  async revokeToken(client, { token }) {
    getDb().prepare('DELETE FROM oauth_token WHERE token_hash=? AND client_id=?').run(sha(token), client.client_id);
  },
};

// The person behind an OAuth access token, or null.
export function userFromAccessToken(token) {
  if (!token) return null;
  return getDb().prepare("SELECT u.* FROM oauth_token t JOIN user u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='access' AND t.expires_at > datetime('now')").get(sha(token)) || null;
}

// Which app a sign-in token belongs to: 'chatgpt' when the app that signed in sends people back to chatgpt.com (its
// redirect address, or its client id when ChatGPT uses a hosted client document), else ''. Each app registers its own client.
export function appOfToken(token) {
  if (!token) return '';
  const row = getDb().prepare("SELECT t.client_id, c.info FROM oauth_token t LEFT JOIN oauth_client c ON c.client_id=t.client_id WHERE t.token_hash=? AND t.kind='access'").get(sha(token));
  if (!row) return '';
  let uris = [];
  try { uris = JSON.parse(row.info || '{}').redirect_uris || []; } catch { /* no info */ }
  return [row.client_id, ...uris].some(u => { try { return new URL(u).hostname === 'chatgpt.com'; } catch { return false; } }) ? 'chatgpt' : '';
}

// The return websites the real Claude and ChatGPT use (Claude: claude.ai/api/mcp/auth_callback, also claude.com;
// ChatGPT: chatgpt.com/connector_platform_oauth_redirect, also the older chat.openai.com). The first is shown in the warning.
const MAKERS = [
  { key: 'claude', name: 'Claude', hosts: ['claude.ai', 'claude.com'] },
  { key: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
];

const AUTH_METHODS = ['client_secret_post', 'client_secret_basic', 'none'];
const metadata = {
  issuer: BASE,
  authorization_endpoint: `${BASE}/authorize`,
  token_endpoint: `${BASE}/token`,
  registration_endpoint: `${BASE}/register`,
  revocation_endpoint: `${BASE}/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: AUTH_METHODS,
  revocation_endpoint_auth_methods_supported: AUTH_METHODS,
  scopes_supported: ['mcp'],
  authorization_response_iss_parameter_supported: true,
  service_documentation: `${BASE}/connect`,
};
const resourceMetadata = {
  resource: MCP_URL, authorization_servers: [BASE], scopes_supported: ['mcp'], bearer_methods_supported: ['header'],
  resource_name: process.env.BRAND || 'OpenLandscape', resource_documentation: `${BASE}/connect`,
};

// The SDK reads client_id/client_secret from the form body only; also accept HTTP Basic (RFC 6749 section 2.3.1).
function basicAuth(req, res, next) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (m && req.body && !req.body.client_id) {
    const [id, secret = ''] = Buffer.from(m[1], 'base64').toString().split(':');
    req.body.client_id = decodeURIComponent(id.replace(/\+/g, ' '));
    req.body.client_secret = decodeURIComponent(secret.replace(/\+/g, ' '));
  }
  next();
}

// Mount at the site root. currentUser(req) reads the dashboard session cookie.
export function oauthRouter({ currentUser }) {
  const r = express.Router();
  r.use('/.well-known/oauth-authorization-server', metadataHandler(metadata));
  r.use('/.well-known/oauth-protected-resource/mcp', metadataHandler(resourceMetadata));
  r.use('/.well-known/oauth-protected-resource', metadataHandler(resourceMetadata));
  r.use('/authorize', authorizationHandler({ provider }));
  // Every Claude and ChatGPT user registers and swaps tokens from the same few addresses, so the per-IP limits are generous
  // (registration 1,000 an hour; what stops the disk filling is clientTooBig, each row at most 4 KB, and pruneClients,
  // which deletes apps unused after a day).
  r.use('/register', clientRegistrationHandler({ clientsStore, clientSecretExpirySeconds: 0, rateLimit: { max: 1000 } }));
  r.use('/token', basicAuth, tokenHandler({ provider, rateLimit: { max: 2000 } }));
  r.use('/revoke', basicAuth, revocationHandler({ provider, rateLimit: { max: 2000 } }));

  const pending = id => {
    const row = id && getDb().prepare("SELECT * FROM oauth_request WHERE id_hash=? AND expires_at > datetime('now')").get(sha(id));
    if (!row) return null;
    return { ...row, params: JSON.parse(row.params), client: clientsStore.getClient(row.client_id) };
  };
  const back = (p, q) => {
    const u = new URL(p.params.redirectUri);
    for (const [k, v] of Object.entries({ ...q, state: p.params.state, iss: BASE })) if (v) u.searchParams.set(k, v);
    return u.href;
  };
  const view = p => {
    const host = new URL(p.params.redirectUri).hostname, client = p.client?.client_name || 'An app';
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    // An app named like Claude or ChatGPT that does not send you back to that maker's own website is flagged on the page.
    const maker = !loopback && MAKERS.find(m => client.toLowerCase().includes(m.name.toLowerCase()) && !m.hosts.includes(host));
    // The real maker's own website shows the maker's logo instead of the globe.
    const real = MAKERS.find(m => m.hosts.includes(host));
    return { client, host, loopback, logo: real?.key || '', impostor: maker ? { name: maker.name, home: maker.hosts[0] } : null };
  };
  r.get('/oauth/consent', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = String(req.query.r || '');
    const p = pending(id);
    if (!p) return res.status(400).send(oauthConsentPage({ expired: true }));
    const user = currentUser(req);
    if (!user) return res.redirect(`/signin?next=${encodeURIComponent('/oauth/consent?r=' + id)}`);
    res.send(oauthConsentPage({ user, id, ...view(p) }));
  });
  r.post('/oauth/consent', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const p = pending(String(req.body.r || ''));
    if (!p) return res.status(400).send(oauthConsentPage({ expired: true }));
    const user = currentUser(req);
    if (!user) return res.redirect(`/signin?next=${encodeURIComponent('/oauth/consent?r=' + req.body.r)}`);
    const db = getDb();
    db.prepare('DELETE FROM oauth_request WHERE id_hash=?').run(p.id_hash);
    if (req.body.allow !== '1') return res.redirect(302, back(p, { error: 'access_denied', error_description: 'The person declined.' }));
    dropConnections(user.id);   // one AI app at a time: this one replaces any other app or key
    const code = rand(32);
    db.prepare("INSERT INTO oauth_code (code_hash, client_id, user_id, challenge, redirect_uri, resource, expires_at) VALUES (?,?,?,?,?,?,datetime('now','+10 minutes'))")
      .run(sha(code), p.client_id, user.id, p.params.codeChallenge, p.params.redirectUri, p.params.resource || null);
    db.prepare("DELETE FROM oauth_request WHERE expires_at <= datetime('now')").run();
    db.prepare("DELETE FROM oauth_code WHERE expires_at <= datetime('now')").run();
    res.redirect(302, back(p, { code }));
  });
  return r;
}
