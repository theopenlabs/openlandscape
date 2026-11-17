// Email magic-link sign-in, sessions and API keys. Secrets are stored only as SHA-256 hashes.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { getDb } from './db.js';

const sha = s => createHash('sha256').update(s).digest('hex');
const rand = n => randomBytes(n).toString('base64url');

// One email carries a link and a 6-digit code; either signs in once, for 30 minutes. Five wrong codes end the code (the link still works).
export function createLogin(email) {
  const token = rand(24), code = String(randomInt(0, 1e6)).padStart(6, '0');
  email = email.toLowerCase().trim();
  getDb().prepare("INSERT INTO login_token (token_hash, email, expires_at, used, code_hash, tries) VALUES (?,?,datetime('now','+30 minutes'),0,?,0)").run(sha(token), email, sha(`${email}:${code}`));
  return { token, code };
}
export const createLoginToken = email => createLogin(email).token;

// Returns a session token, or null if the link is unknown, used or expired.
export function redeemLoginToken(token) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM login_token WHERE token_hash=? AND used=0 AND expires_at > datetime('now')").get(sha(String(token)));
  if (!row) return null;
  db.prepare('UPDATE login_token SET used=1 WHERE token_hash=?').run(row.token_hash);
  return signInEmail(row.email);
}
// The address of a sign-in link that still works, without using it ('' if it does not): opening the link only asks.
export const liveLoginEmail = token => getDb().prepare("SELECT email FROM login_token WHERE token_hash=? AND used=0 AND expires_at > datetime('now')").pluck().get(sha(String(token || ''))) || '';
// The address a sign-in link was sent to, even when it is used or expired (to offer a new one).
export const loginTokenEmail = token => getDb().prepare('SELECT email FROM login_token WHERE token_hash=?').pluck().get(sha(String(token || ''))) || '';
// The 6-digit code from the same email. Returns { session, user } or null.
export function redeemLoginCode(email, code) {
  const db = getDb();
  email = String(email).toLowerCase().trim();
  const live = "email=? AND used=0 AND expires_at > datetime('now') AND code_hash IS NOT NULL";
  const row = db.prepare(`SELECT * FROM login_token WHERE ${live} AND code_hash=?`).get(email, sha(`${email}:${String(code).replace(/\D/g, '')}`));
  if (!row) {
    db.prepare(`UPDATE login_token SET tries=tries+1 WHERE ${live}`).run(email);
    db.prepare(`UPDATE login_token SET code_hash=NULL WHERE ${live} AND tries >= 5`).run(email);
    return null;
  }
  db.prepare('UPDATE login_token SET used=1 WHERE token_hash=?').run(row.token_hash);
  return signInEmail(email);
}

// Finds or creates the user with this (already verified) email and starts a session. `isNew`: the account was made just now.
// `via`: how they signed in this time ('email' link or code, or 'google'), shown in Settings.
export function signInEmail(email, via = 'email') {
  const db = getDb();
  email = email.toLowerCase().trim();
  const isNew = db.prepare('INSERT OR IGNORE INTO user (email) VALUES (?)').run(email).changes === 1;
  db.prepare('UPDATE user SET signin_via=? WHERE email=?').run(via, email);
  const user = db.prepare('SELECT * FROM user WHERE email=?').get(email);
  const session = rand(32);
  db.prepare("INSERT INTO session VALUES (?,?,datetime('now','+60 days'))").run(sha(session), user.id);
  return { session, user, isNew };
}

export function userFromSession(session) {
  if (!session) return null;
  const db = getDb();
  const u = db.prepare("SELECT u.* FROM session s JOIN user u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > datetime('now')").get(sha(session));
  if (u && !(Date.now() - Date.parse(String(u.last_seen).replace(' ', 'T') + 'Z') < 600_000)) markSeen(db, u.id);
  return u || null;
}
// "Last seen" (for the returning-users count) is written at most every 10 minutes, and never makes a page wait: while a data
// job holds the database's write lock, a normal write waits 5 seconds (the whole server waits with it) and then fails the
// page with "database is locked". Then it is simply skipped.
function markSeen(db, id) {
  const wait = db.pragma('busy_timeout', { simple: true });
  db.pragma('busy_timeout = 0');
  try { db.prepare("UPDATE user SET last_seen=datetime('now') WHERE id=?").run(id); } catch { /* busy: try next time */ }
  finally { db.pragma(`busy_timeout = ${wait}`); }
}

export function endSession(session) {
  if (session) getDb().prepare('DELETE FROM session WHERE token_hash=?').run(sha(session));
}

// One AI connection per account (build plan, 8 Nov 2026; kept 15 Nov): a new app signing in, or a new key, ends every other
// connection (sign-in tokens and keys). Disconnect in the app ends them all too.
export function dropConnections(userId) {
  const db = getDb();
  db.prepare('DELETE FROM oauth_token WHERE user_id=?').run(userId);
  db.prepare('UPDATE api_key SET revoked=1 WHERE user_id=? AND revoked=0').run(userId);
}

export function createApiKey(userId) {
  dropConnections(userId);
  const key = 'op_' + (/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '') ? 'live' : 'test') + '_' + rand(24);
  getDb().prepare('INSERT INTO api_key (user_id, key_hash, prefix) VALUES (?,?,?)').run(userId, sha(key), key.slice(0, 12));
  return key;
}

export function listApiKeys(userId) {
  return getDb().prepare('SELECT id, prefix, created_at, revoked, (SELECT max(at) FROM usage WHERE user_id=api_key.user_id AND kind=\'mcp\') AS last_used FROM api_key WHERE user_id=? ORDER BY id DESC').all(userId);
}

export function revokeApiKey(userId, id) {
  getDb().prepare('UPDATE api_key SET revoked=1 WHERE user_id=? AND id=?').run(userId, id);
}

export function userFromApiKey(key) {
  if (!key) return null;
  return getDb().prepare('SELECT u.* FROM api_key k JOIN user u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked=0').get(sha(String(key))) || null;
}

// ---------- plans and limits (Free as agreed on 8 Nov) ----------
// plan 'free' = signed up, not subscribed: 1 landscape in full (re-opening the same area is free) and 25 AI lookups a month,
// with no time limit. Following is part of Solo: 5 follows of anything (a landscape, a company or a drug).
export const LIMITS = {
  free: { landscapes: 1, mcp_calls: 25, follows: 0 },   // mcp_calls: AI lookups a calendar month (UTC), back on the 1st
  solo: { follows: 5 },
  team: { follows: 25 },
};
export const isPaid = u => u && u.plan && u.plan !== 'free';
// Yearly plans ('solo_year') follow as many as monthly ones.
export const followLimit = u => (LIMITS[String(u?.plan || '').replace(/_year$/, '')] || LIMITS.free).follows;

export function usageCount(userId, kind, since) {
  return getDb().prepare('SELECT count(*) FROM usage WHERE user_id=? AND kind=? AND at >= ?').pluck().get(userId, kind, since);
}
export const monthStart = () => new Date().toISOString().slice(0, 7) + '-01';
// Paid plans get 300 AI lookups a day (UTC), said on Pricing and Settings; far above a person chatting (was
// 1,000 until 15 Nov 2026). How much data the answers carry is limited by the drugs an account sees (src/limits.js).
export const PAID_DAILY_LOOKUPS = 300;
export const dayStart = () => new Date().toISOString().slice(0, 10);
// The first day of next month, as "1 December": when Free's lookups come back.
export const nextMonthName = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return `1 ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`; };
export function logUsage(userId, kind, detail) {
  getDb().prepare('INSERT INTO usage (user_id, kind, detail) VALUES (?,?,?)').run(userId, kind, String(detail).slice(0, 200));
}
