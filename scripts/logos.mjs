// Company logos for the company page header (specs 15 part 3 and 19 part 3), fetched once from Logo.dev and kept in
// web/logos/ so a page never loads anything from another site. Logo.dev allows keeping the files on our own server on
// every plan; the free plan asks for a visible "Logos provided by Logo.dev" link, shown on each company page that has a logo.
//
// web/logos/logos.json is the list: one entry per company id with its web address (filled in by hand) and, once fetched,
// where the file came from. Companies with no address or no logo at Logo.dev get no file and their page shows nothing.
//
//   LOGODEV_KEY=sk_... node scripts/logos.mjs          fetch the companies that have an address and no file yet
//   LOGODEV_KEY=sk_... node scripts/logos.mjs lilly    fetch (again) the named companies
import fs from 'node:fs';

const DIR = new URL('../web/logos/', import.meta.url).pathname;
const LIST = DIR + 'logos.json';
const KEY = process.env.LOGODEV_KEY;
if (!KEY) { console.error('Set LOGODEV_KEY to the Logo.dev secret key (sk_...).'); process.exit(1); }

const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const only = process.argv.slice(2);
const todo = Object.keys(list).filter(id => list[id].domain && (only.length ? only.includes(id) : !list[id].file && !list[id].none));

const wait = ms => new Promise(ok => setTimeout(ok, ms));
for (const id of todo) {
  const e = list[id];
  let r;
  // 100 lookups a minute on the free plan: one every 0.7 s, and a minute's pause if we still hit the limit.
  for (;;) {
    r = await fetch(`https://api.logo.dev/v2/brands/logo?domain=${encodeURIComponent(e.domain)}`, { headers: { Authorization: `Bearer ${KEY}` } });
    await wait(700);
    if (r.status !== 429) break;
    await wait(60_000);
  }
  const d = r.ok ? (await r.json()).data : null;
  // 202 "not_indexed": Logo.dev starts looking for the brand; run the script again later. 404: no brand at this address.
  if (!d || d.status !== 'ready' || !d.url) { console.log(id, e.domain, 'no logo', r.status, d?.status || ''); list[id] = r.status === 404 ? { domain: e.domain, none: 'not found' } : { domain: e.domain }; continue; }
  // 160 px square PNG: sharp at 40 px on a 4x screen, transparency kept where the company's file has it.
  const img = await fetch(`${d.url}?format=png&size=160`);
  const buf = Buffer.from(await img.arrayBuffer());
  if (!img.ok || !(img.headers.get('content-type') || '').startsWith('image/png')) { console.log(id, e.domain, 'download failed', img.status); continue; }
  fs.writeFileSync(DIR + id + '.png', buf);
  list[id] = { domain: e.domain, file: id + '.png', source: 'Logo.dev', brand_id: d.brand_id, etag: d.etag, fetched: new Date().toISOString().slice(0, 10) };
  console.log(id, e.domain, 'ok');
}
fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + '\n');
