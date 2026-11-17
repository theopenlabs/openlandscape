// Country of an internet address, from the free DB-IP Lite country list bundled in seed/dbip-country-lite.csv.gz
// (IP Geolocation by DB-IP, https://db-ip.com, licensed CC BY 4.0; refresh it monthly from https://db-ip.com/db/download/ip-to-country-lite).
// Used when a page view is counted (src/visits.js): only the two-letter country is kept, never the address.
// Loaded on first use (about a second), then each lookup is a binary search.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isIPv4, isIPv6 } from 'node:net';

const FILE = new URL('../seed/dbip-country-lite.csv.gz', import.meta.url);
let t;
const v4num = a => a.split('.').reduce((n, x) => n * 256 + +x, 0);
// The first 64 bits of an IPv6 address, as a BigInt (the rest never changes the country).
function v6top(a) {
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [], tl = a.includes('::') && tail ? tail.split(':') : [];
  const all = [...h, ...Array(Math.max(0, 8 - h.length - tl.length)).fill('0'), ...tl];
  return all.slice(0, 4).reduce((n, g) => (n << 16n) + BigInt(parseInt(g, 16) || 0), 0n);
}
function load() {
  const lines = gunzipSync(readFileSync(FILE)).toString('latin1').split('\n');
  const codes = [], idx = new Map(), v4 = [], v4c = [], v6 = [], v6c = [];
  const code = c => { if (!idx.has(c)) { idx.set(c, codes.length); codes.push(c); } return idx.get(c); };
  for (const l of lines) {
    const [a, , c] = l.split(',');
    if (!c) continue;
    if (a.includes(':')) { v6.push(v6top(a)); v6c.push(code(c.trim())); } else { v4.push(v4num(a)); v4c.push(code(c.trim())); }
  }
  return { codes, v4: Float64Array.from(v4), v4c: Uint16Array.from(v4c), v6: BigUint64Array.from(v6), v6c: Uint16Array.from(v6c) };
}
const find = (starts, x) => { let lo = 0, hi = starts.length - 1, at = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= x) { at = m; lo = m + 1; } else hi = m - 1; } return at; };
// 'DE', 'US'…; '' when unknown (private addresses, or the list says ZZ).
export function country(ip) {
  ip = String(ip || '').replace(/^::ffff:(?=\d+\.)/, '');
  try {
    t ||= load();
    let i, c;
    if (isIPv4(ip)) { i = find(t.v4, v4num(ip)); c = i >= 0 && t.codes[t.v4c[i]]; }
    else if (isIPv6(ip)) { i = find(t.v6, v6top(ip)); c = i >= 0 && t.codes[t.v6c[i]]; }
    return c && c !== 'ZZ' ? c : '';
  } catch { return ''; }
}
