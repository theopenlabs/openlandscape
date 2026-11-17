// Free company logos, no keys: the square icon each company publishes on its own website (the one a phone shows when
// the site is saved to the home screen). For the busiest sponsor names that are not one of our checked companies.
//
// 1. Web address: Wikidata's "official website" for the exact company name (one query for all names); if none, a guess
//    from the name (abivax.com). Either is kept only when the page title holds every word of the name and the page talks
//    about medicines. 2. Icon: apple-touch-icon, else an icon of 120 px or more, else an SVG icon; drawn to a 160 px PNG.
// Results go to web/logos/ and web/logos/logos.json, keyed by the company page id (the sponsor name as registered).
// Look at every new logo before it ships: new ones are marked unchecked and the page skips them. Drop wrong ones with
// { none: 'wrong ...' }, then replace `unchecked` with `checked: <date>` on the rest.
//
//   DB_PATH=... node scripts/logos-site.mjs 201      the 201 busiest unchecked sponsor names
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { getDb } from '../src/db.js';

const DIR = new URL('../web/logos/', import.meta.url).pathname;
const LIST = DIR + 'logos.json';
const N = +process.argv[2] || 201;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; OpenLandscape logo check)' };
const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));

// The busiest industry sponsor names that no checked company counts as its own.
const db = getDb();
const pats = db.prepare('SELECT sponsor_patterns FROM company').pluck().all().flatMap(p => JSON.parse(p || '[]'));
const names = db.prepare("SELECT sponsor, count(*) n FROM trial WHERE sponsor_class='INDUSTRY' GROUP BY sponsor ORDER BY n DESC").all()
  .filter(r => !pats.some(p => r.sponsor.toLowerCase().includes(p.toLowerCase()))).slice(0, N).map(r => r.sponsor)
  .filter(n => !list[n]);

const LEGAL = /\b(co|corp|corporation|inc|incorporated|llc|l\.l\.c|ltd|limited|plc|ag|sa|s\.a|spa|s\.p\.a|srl|s\.r\.l|gmbh|bv|b\.v|nv|n\.v|a\/s|as|kk|k\.k|jsc|kg|kgaa|ab|oy|pty|pte|sas|se)\b\.?/gi;
const clean = n => n.replace(/,? (a|an) [^,]*(company|affiliate)[^,]*$/i, '').replace(/\(.*?\)/g, ' ').replace(LEGAL, ' ').replace(/[,.&]/g, ' ').replace(/\s+/g, ' ').trim();
const KIND = /\b(pharmaceuticals?|pharma|biosciences?|therapeutics|biotherapeutics|biotechnology|biotech|biopharma(ceuticals?)?|biologics|medicines?|healthcare|research|development|r&d|group|holdings?|international|usa|america|global|commercialization|laboratories|labs?)\b/gi;
const core = n => clean(n).replace(KIND, ' ').replace(/\s+/g, ' ').trim();
const words = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

const get = async (u, ms = 12000) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { return await fetch(u, { headers: UA, signal: c.signal, redirect: 'follow' }); } catch { return null; } finally { clearTimeout(t); } };
const wait = ms => new Promise(ok => setTimeout(ok, ms));

// 1a. Wikidata: a company (it has an industry, headquarters, stock listing or staff count) whose label or alias equal to the name as registered, without its legal form, or without "Pharmaceuticals" etc.
async function wikidata(ns) {
  const vals = ns.flatMap(n => [...new Set([n, clean(n), core(n)])].filter(v => v.length > 2).map(v => `(${JSON.stringify(n)} ${JSON.stringify(v)}@en)`)).join(' ');
  const q = `SELECT ?n ?site ?links WHERE { VALUES (?n ?l) { ${vals} } { ?i rdfs:label ?l } UNION { ?i skos:altLabel ?l }
    ?i wdt:P856 ?site ; wikibase:sitelinks ?links . FILTER EXISTS { ?i (wdt:P414|wdt:P452|wdt:P1128|wdt:P159) [] } }`;
  const r = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { ...UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ query: q }) });
  if (!r.ok) throw new Error('Wikidata ' + r.status);
  const best = {};
  for (const b of (await r.json()).results.bindings) {
    const n = b.n.value, links = +b.links.value;
    if (!best[n] || links > best[n].links) best[n] = { site: b.site.value, links };
  }
  return Object.fromEntries(Object.entries(best).map(([n, b]) => [n, b.site]));
}

// 1b. A guessed address: the name's words run together, with and without the kind of company.
function guesses(n) {
  const c = words(clean(n)), k = words(core(n));
  return [...new Set([k.join(''), c.join(''), k[0], k.join('') + 'pharma', k.join('') + 'tx', k.join('') + 'bio', k.join('') + 'therapeutics'].filter(s => s && s.length > 3).map(s => s + '.com'))];
}
const MEDICAL = /pharma|therapeut|clinical|patient|medicine|drug|biotech|disease/i;
// A site counts as the company's when its title holds every word of the name (without legal form or kind of company) and
// the page talks about medicines. Applied to Wikidata's address too: names are shared (Jazz the airline, Zai the skis).
const fits = (n, q) => { const t = words(q.title).join(' '); return !/for sale|parked|domain/i.test(q.title) && !/godaddy|sedo|dan\.com|afternic/i.test(q.url) && words(core(n) || clean(n)).every(w => t.includes(w)) && MEDICAL.test(q.html); };

async function page(url) {
  const r = await get(url); if (!r || !r.ok) return null;
  const html = (await r.text().catch(() => '')).slice(0, 500000);
  const title = `${html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''} ${html.match(/og:site_name["'][^>]*content=["']([^"']+)/i)?.[1] || ''}`;
  return { url: r.url, html, title };
}

// 2. The icon the site names, largest first; drawn to 160 px so every file is a plain PNG we serve ourselves.
const pngSize = b => b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
async function icon(p) {
  const links = [...p.html.matchAll(/<link[^>]+>/gi)].map(m => m[0]).filter(l => /rel=["'][^"']*icon[^"']*["']/i.test(l));
  const size = l => +(l.match(/sizes=["'](\d+)/i)?.[1] || 0);
  const order = [...links.filter(l => /apple-touch-icon/i.test(l)).sort((a, b) => size(b) - size(a)), ...links.filter(l => size(l) >= 120).sort((a, b) => size(b) - size(a)), ...links.filter(l => /\.svg/i.test(l))];
  const hrefs = [...new Set([...order.map(l => l.match(/href=["']([^"']+)/i)?.[1]).filter(Boolean), '/apple-touch-icon.png'])];
  for (const h of hrefs) {
    let u; try { u = new URL(h.replace(/&amp;/g, '&'), p.url).href; } catch { continue; }
    const r = await get(u); if (!r?.ok) continue;
    const ct = r.headers.get('content-type') || '', b = Buffer.from(await r.arrayBuffer());
    if (/svg/.test(ct) || /\.svg(\?|$)/i.test(u)) {
      try { return { from: u, png: new Resvg(b, { fitTo: { mode: 'width', value: 160 } }).render().asPng() }; } catch { continue; }
    }
    const s = pngSize(b);
    if (s && s[0] >= 120 && s[1] >= 120) return { from: u, png: b };   // PNG only: other formats are skipped, not converted
  }
  return null;
}

const fileOf = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + crypto.createHash('sha1').update(n).digest('hex').slice(0, 6) + '.png';

const wd = {};
for (let i = 0; i < names.length; i += 50) { Object.assign(wd, await wikidata(names.slice(i, i + 50))); await wait(2000); }
let found = 0;
for (const n of names) {
  let p = null, how = '';
  if (wd[n]) { const q = await page(wd[n]); if (q && fits(n, q)) { p = q; how = 'Wikidata'; } }
  if (!p) for (const d of guesses(n)) {
    const q = await page('https://' + d); if (!q) continue;
    if (!fits(n, q)) continue;
    p = q; how = 'name'; break;
  }
  if (!p) { console.log('no site  ', n); continue; }
  const ic = await icon(p);
  const site = new URL(p.url).hostname.replace(/^www\./, '');
  if (!ic) { console.log('no icon  ', n, site); list[n] = { domain: site, none: 'no square icon on the site' }; continue; }
  const file = fileOf(n);
  fs.writeFileSync(DIR + file, ic.png);
  list[n] = { domain: site, file, source: 'company website', from: ic.from, site_from: how, fetched: new Date().toISOString().slice(0, 10), unchecked: true };
  found++; console.log('ok       ', n, site, how);
}
fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + '\n');
console.log(`${found} logos of ${names.length} names`);
