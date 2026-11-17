// "Continue with Google": our own button on the sign-in page and box, a plain OAuth 2.0 authorization-code flow.
// No library on our side.
// Off unless GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
import { randomBytes } from 'node:crypto';

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const newState = () => randomBytes(24).toString('base64url');

// `hint`: the Google account last used on this browser ("Continue as …"). Google then goes straight to that account;
// without it, Google asks which account to use.
export function authUrl(redirectUri, state, hint = '') {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, ...(hint ? { login_hint: hint } : { prompt: 'select_account' }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Swaps the one-time code for tokens and returns the verified email address.
// The ID token comes straight from Google over HTTPS in exchange for our secret,
// so its claims can be read without checking the signature (OpenID Connect 3.1.3.7).
export async function emailFromCode(code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const { id_token } = await res.json();
  return emailFromClaims(decode(id_token).claims);
}

const decode = token => {
  const [, c] = String(token).split('.');
  return { claims: JSON.parse(Buffer.from(c || '', 'base64url').toString('utf8')) };
};

function emailFromClaims(claims) {
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Google token is for another app');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new Error('Google token has the wrong issuer');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('Google token expired');
  if (claims.email_verified !== true || !claims.email) throw new Error('Google account email is not verified');
  return String(claims.email).toLowerCase().trim();
}
