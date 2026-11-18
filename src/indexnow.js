// IndexNow (step 20): tells Bing (which ChatGPT search reads) and Yandex that the site's pages exist or changed, so they need
// not wait to find them. The key is not a secret: it is published at /<key>.txt to prove the site is ours.
// Sent at most once a week, after a start, and only from the live site (PUBLIC_URL on openlandscape.app).
import { meta } from './db.js';

export const INDEXNOW_KEY = 'a8ee9d932bf1057e1fc46d64d16f292f';
const WEEK = 7 * 864e5;

// `paths`: a function giving the sitemap's paths. Returns a line for the log, or '' when nothing was sent.
export async function pingIndexNow(paths, { now = Date.now(), send = fetch } = {}) {
  const site = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/(www\.)?openlandscape\.app$/.test(site)) return '';
  const last = Date.parse(meta.get('indexnow_at') || '') || 0;
  if (now - last < WEEK) return '';
  const urlList = paths().slice(0, 10000).map(p => site + p);
  const r = await send('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(site).host, key: INDEXNOW_KEY, keyLocation: `${site}/${INDEXNOW_KEY}.txt`, urlList }),
  });
  if (r.status !== 200 && r.status !== 202) throw new Error(`IndexNow answered ${r.status}`);
  meta.set('indexnow_at', new Date(now).toISOString());
  return `${urlList.length} pages sent (${r.status})`;
}
