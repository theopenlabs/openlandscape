// Images drawn on the server (spec 11 part 3, spec 17 parts 4 and 7):
//   - the logo tile on every email (dark tile, light line, so it holds in light and dark mail apps);
//   - the ridge line on the welcome email, redrawn from a landscape's real stage counts (GIF that draws itself once;
//     the first frame is the finished line, for mail apps that show only the first frame);
//   - link previews, 1200 x 630: the logo small at the top, the page title large, one line of fact, the address at the bottom.
//     Landscape pages add the stage bar and its counts, drug pages the stage and the next milestone. Other pages use the
//     landing image.
// Drawn as SVG and turned into pixels by resvg, with the site's own Inter (brand/fonts). Each image is cached until the
// data reloads (Q.loadStamp), so a preview is never older than the data behind it.
import { Router } from 'express';
import { Resvg } from '@resvg/resvg-js';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import * as Q from './query.js';
import { heading } from './suggest.js';
import { shortDate, creditDay } from '../web/table.js';

const FONTS = ['latin', 'latin-ext'].flatMap(s => [400, 600].map(w => new URL(`../brand/fonts/inter-${s}-${w}.ttf`, import.meta.url).pathname));
const INK = '#1C1A17', PAPER = '#FAF9F7', GREY = '#77736D';
const SITE = (process.env.PUBLIC_URL || 'https://openlandscape.app').replace(/^https?:\/\//, '').replace(/\/$/, '');
const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render();
}
export const svgToPng = (svg, width) => render(svg, width).asPng();

// The mark: a circle with the ridge inside (web/favicon.svg), here as a light line on a dark rounded tile.
const MARK = '<circle cx="12" cy="12" r="10"/><path d="M4.5 16.5 L8.5 11.5 L11 14 L15 8 L19.5 15"/>';
export const logoSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 28 28">
<rect width="28" height="28" rx="7" fill="${INK}"/><g transform="translate(4 4) scale(.8333)" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${MARK}</g></svg>`;

// ---------- ridge line ----------
// One peak per stage that has drugs (earliest stage on the left), its height from the stage's count, so the peaks sit over
// the counts the email prints under them (one column per stage). Between the peaks the line dips; the small shoulders on
// each peak are fixed by the landscape's name, so one landscape always draws the same line.
const STAGE_ORDER = [1, 2, 3, 4, 5];
export function ridgeStages(L) {
  const by = Object.fromEntries((L.stats?.by_phase || []).map(p => [p.level, p]));
  return STAGE_ORDER.map(l => by[l]).filter(p => p && p.count > 0 && p.level >= Math.min(L.phase_min || 1, 5)).map(p => ({ name: p.name, count: p.count }));
}
function seeded(s) {
  let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
export function ridgePoints(stages, seed, W = 1200, H = 320) {
  const rnd = seeded(seed), n = stages.length, max = Math.max(1, ...stages.map(s => s.count));
  const top = 24, base = H - 8, hOf = c => (base - top) * (0.22 + 0.78 * Math.sqrt(c / max));   // small stages still show a hill
  const pts = [[0, base - 14]];
  stages.forEach((s, i) => {
    const cx = (i + 0.5) * W / n, w = W / n, h = hOf(s.count);
    const left = cx - w * 0.38, right = cx + w * 0.38;
    pts.push([left, base - h * (0.12 + 0.08 * rnd())]);
    pts.push([cx - w * 0.18, base - h * (0.62 + 0.2 * rnd())]);
    pts.push([cx - w * 0.08, base - h * (0.52 + 0.12 * rnd())]);
    pts.push([cx, base - h]);
    pts.push([cx + w * 0.12, base - h * (0.55 + 0.15 * rnd())]);
    pts.push([cx + w * 0.2, base - h * (0.62 + 0.12 * rnd())]);
    pts.push([right, base - h * (0.1 + 0.08 * rnd())]);
  });
  pts.push([W, base - 4]);
  return pts.map(([a, b]) => [Math.round(a), Math.round(b)]);
}
// `upTo` (0 to 1): how much of the line is drawn, for the frames of the animation.
export function ridgeSvg(stages, seed, upTo = 1, W = 1200, H = 320) {
  const pts = ridgePoints(stages, seed, W, H), d = 'M' + pts.map(p => p.join(' ')).join(' L');
  const clip = Math.round(W * upTo);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${INK}"/><defs><clipPath id="c"><rect width="${clip}" height="${H}"/></clipPath></defs>
<g clip-path="url(#c)"><path d="${d} L${W} ${H} L0 ${H} Z" fill="#2D2B27"/><path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/></g></svg>`;
}
// GIF, played once: the finished line first, then it draws itself from the left and stays.
export function ridgeGif(stages, seed, { W = 1200, H = 320, frames = 18 } = {}) {
  const shots = [1, ...Array.from({ length: frames }, (_, i) => (i + 1) / frames)];
  const pix = shots.map(u => render(ridgeSvg(stages, seed, u, W, H), W).pixels);
  const palette = quantize(pix[0], 16);
  const gif = GIFEncoder();
  shots.forEach((u, i) => gif.writeFrame(applyPalette(pix[i], palette), W, H, { palette, delay: i === 0 ? 900 : i === shots.length - 1 ? 0 : 60, repeat: -1 }));
  gif.finish();
  return Buffer.from(gif.bytes());
}

// ---------- link previews, 1200 x 630 ----------
const STAGE_TONES = { 5: INK, 4: '#46433F', 3: '#77736D', 2: '#A8A5A0', 1: '#CFCCC7' };
function fit(text, size, maxW) {   // shrink a long title to fit one or two lines; a rough width per letter is enough here
  const per = size * 0.56, chars = Math.floor(maxW / per);
  if (text.length <= chars) return { lines: [text], size };
  const words = text.split(' '), lines = [''];
  for (const w of words) { const l = lines[lines.length - 1]; if ((l + ' ' + w).trim().length > chars && l) lines.push(w); else lines[lines.length - 1] = (l + ' ' + w).trim(); }
  if (lines.length <= 2) return { lines, size };
  return size > 48 ? fit(text, size - 8, maxW) : { lines: [lines[0], lines.slice(1).join(' ').slice(0, chars - 1) + '…'], size };
}
export function previewSvg({ title, fact = '', path = '', stages = null, fields = null }) {
  const W = 1200, H = 630, L = 80;
  const t = fit(title, 76, W - 2 * L), lh = Math.round(t.size * 1.12);
  let y = 230;
  const titleSvg = t.lines.map((l, i) => `<text x="${L}" y="${y + i * lh}" font-size="${t.size}" font-weight="600" fill="${INK}" letter-spacing="-1.5">${x(l)}</text>`).join('');
  y += (t.lines.length - 1) * lh + 62;
  const factSvg = fact ? `<text x="${L}" y="${y}" font-size="32" fill="${GREY}">${x(fact)}</text>` : '';
  let extra = '';
  if (stages?.length) {   // the stage bar: latest stage on the left, as on the landscape page, with each count under it
    const total = stages.reduce((s, p) => s + p.count, 0), bw = W - 2 * L, by = 430;
    let bx = L;
    const segs = [...stages].sort((a, b) => b.level - a.level).map(p => { const w = Math.max(6, Math.round(bw * p.count / total)); const s = { ...p, x: bx, w }; bx += w; return s; });
    segs[segs.length - 1].w += L + bw - bx;
    let kx = L;   // the key: "Approved 7   Filed 3   Phase 3 27", each placed after the last (about 0.56 of the size per letter)
    extra = segs.map(s => `<rect x="${s.x}" y="${by}" width="${s.w}" height="22" fill="${STAGE_TONES[s.level] || GREY}"/>`).join('')
      + segs.map(s => { const t = `<text x="${kx}" y="${by + 64}" font-size="26" fill="${GREY}">${x(s.name)} <tspan font-weight="600" fill="${INK}">${s.count}</tspan></text>`; kx += Math.round((s.name.length + String(s.count).length + 1) * 26 * 0.56) + 44; return t; }).join('');
  } else if (fields?.length) {
    extra = fields.map((f, i) => `<text x="${L + i * 420}" y="430" font-size="24" fill="${GREY}">${x(f[0])}</text><text x="${L + i * 420}" y="472" font-size="34" font-weight="600" fill="${INK}">${x(f[1])}</text>`).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<g transform="translate(${L} 64) scale(1.75)" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${MARK}</g>
<text x="${L + 56}" y="97" font-size="30" font-weight="600" fill="${INK}">OpenLandscape</text>
${titleSvg}${factSvg}${extra}
<text x="${L}" y="${H - 56}" font-size="26" fill="${GREY}">${x(SITE + path)}</text></svg>`;
}

// What each kind of page puts on its preview.
const stageCounts = L => (L.stats?.by_phase || []).filter(p => p.count > 0).map(p => ({ level: p.level, name: p.name, count: p.count }));
export const landingPreview = () => previewSvg({ title: 'See every drug in development, with a source for every fact' });
export function landscapePreview(L, { title, slug }) {
  const n = L.stats.programs, stage = L.phase_min >= 2 ? `, Phase ${L.phase_min} or later` : '';
  return previewSvg({ title: title || heading(L.area), fact: `${n} ${n === 1 ? 'drug' : 'drugs'} in active trials${stage}`, path: `/landscapes/${slug}`, stages: stageCounts(L) });
}
export function drugPreview(d) {
  const now = Q.today(), next = (d.catalysts || []).find(c => (c.date + '-99').slice(0, 10) >= now);
  const stage = String(d.stage?.label || '').replace(/^Approved \((.+)\)$/, 'Approved in $1');
  return previewSvg({ title: d.name, fact: (d.companies || []).map(c => c.name).join(' · ') || d.company || '', path: `/drugs/${encodeURIComponent(d.id)}`,
    fields: [['Stage', stage || 'Not known'], ['Next milestone', next ? shortDate(next.date) : 'None planned']].filter(Boolean) });
}

// ---------- pictures for slides, 1920 x 1080 ----------
// The overview: logo and name at the top, the landscape's own ridge line drawn from its stage counts with each count under
// its peak, and the source line at the foot. The table: the first rows the person sees (their filters), with the stage dots.
// Light (the default: most decks are white) or dark. `day`: the day it was made ("15 Nov 2026"), on the slide and its source line.
const THEMES = {
  light: { bg: PAPER, ink: INK, mut: GREY, line: '#E6E3DE', fill: '#F1EFEB', off: '#D9D6D0' },
  dark: { bg: '#141311', ink: '#F2F0EC', mut: '#9B968E', line: '#2C2A26', fill: '#1E1C19', off: '#3A3732' },
};
const SW = 1920, SH = 1080, SL = 96, SR = SW - 96;
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const mark = (x0, y0, size, col) => `<g transform="translate(${x0} ${y0}) scale(${size / 24})" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${MARK}</g>`;
// The ridge line in a box: points from ridgePoints (1200 x 260), scaled here so the stroke keeps its width.
function ridgePath(stages, seed, x0, y0, w, h) {
  const pts = ridgePoints(stages, seed, 1200, 260).map(([a, b]) => [x0 + a * w / 1200, y0 + b * h / 260]);
  return 'M' + pts.map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join(' L');
}
function slideFrame(t, { url, day, kicker = 'Drug landscape' }, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" font-family="Inter">
<rect width="${SW}" height="${SH}" fill="${t.bg}"/>
${mark(SL, 72, 40, t.ink)}<text x="${SL + 54}" y="104" font-size="32" font-weight="600" fill="${t.ink}" letter-spacing="-0.4">OpenLandscape</text>
<text x="${SR}" y="101" font-size="22" fill="${t.mut}" text-anchor="end">${x(url)}</text>
<text x="${SL}" y="196" font-size="20" font-weight="600" fill="${t.mut}" letter-spacing="2">${x(`${kicker} · ${day}`.toUpperCase())}</text>
${inner}
<line x1="${SL}" y1="978" x2="${SR}" y2="978" stroke="${t.line}"/>
${mark(SL, 1000, 22, t.mut)}<text x="${SL + 34}" y="1018" font-size="19" fill="${t.mut}">Source: <tspan font-weight="600" fill="${t.ink}">OpenLandscape</tspan>, ${x(url)}, ${x(day)}. Every fact links to its source.</text></svg>`;
}
// `L`: a landscape (src/query.js). `title`: its name. `url`: where it lives, without https:// ("openlandscape.app/landscapes/obesity").
export function overviewSlideSvg(L, { title, url, day, theme = 'light' }) {
  const t = THEMES[theme] || THEMES.light, st = L.stats, stages = ridgeStages(L);
  const tf = fit(title, 92, SR - SL), lh = Math.round(tf.size * 1.08);
  const titleSvg = tf.lines.map((l, i) => `<text x="${SL}" y="${290 + i * lh}" font-size="${tf.size}" font-weight="600" fill="${t.ink}" letter-spacing="-2.5">${x(l)}</text>`).join('');
  const subY = 290 + (tf.lines.length - 1) * lh + 62, pm = L.phase_min || 1;
  const sub = [`${st.programs} ${st.programs === 1 ? 'drug' : 'drugs'} in active trials${pm >= 2 ? `, Phase ${pm} or later` : ''}`, st.companies ? `${st.companies} ${st.companies === 1 ? 'company' : 'companies'}` : '', st.china ? `${st.china} China-based` : ''].filter(Boolean).join(' · ');
  let body = `${titleSvg}<text x="${SL}" y="${subY}" font-size="30" fill="${t.mut}">${x(sub)}</text>`;
  if (stages.length) {
    const top = subY + 70, h = 770 - top, w = SR - SL, d = ridgePath(stages, String(L.area).toLowerCase(), SL, top, w, h);
    body += `<path d="${d} L${SR} ${top + h} L${SL} ${top + h} Z" fill="${t.fill}"/><path d="${d}" fill="none" stroke="${t.ink}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    body += stages.map((s, i) => { const cx = SL + (i + 0.5) * w / stages.length; return `<text x="${cx}" y="842" font-size="56" font-weight="600" fill="${t.ink}" text-anchor="middle" letter-spacing="-1.5">${s.count}</text><text x="${cx}" y="884" font-size="22" font-weight="600" fill="${t.mut}" text-anchor="middle" letter-spacing="1.8">${x(s.name.toUpperCase())}</text>`; }).join('');
  }
  return slideFrame(t, { url, day }, body);
}
// `rows`: the programs to show, in order (at most 8). `sub`: the grey line under the title.
const STAGE_ROW = l => String(l).replace(/^Marketed.*/, 'On the market').replace(/^FDA-approved.*/, 'Approved (US)');
export function tableSlideSvg(L, rows, { title, url, day, sub, theme = 'light' }) {
  const t = THEMES[theme] || THEMES.light, stages = ridgeStages(L);
  const tf = fit(title, 64, 1200), lh = Math.round(tf.size * 1.08);
  let y = 268;
  let body = tf.lines.map((l, i) => `<text x="${SL}" y="${y + i * lh}" font-size="${tf.size}" font-weight="600" fill="${t.ink}" letter-spacing="-1.5">${x(l)}</text>`).join('');
  y += (tf.lines.length - 1) * lh + 48;
  body += `<text x="${SL}" y="${y}" font-size="26" fill="${t.mut}">${x(sub)}</text>`;
  if (stages.length) body += `<path d="${ridgePath(stages, String(L.area).toLowerCase(), 1404, 186, 420, 72)}" fill="none" stroke="${t.ink}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const C = [SL + 16, 565, 952, 1260, 1637], heads = ['Drug', 'How it works', 'Company', 'Stage', 'Next date'];
  const hy = y + 72;
  body += heads.map((h, i) => `<text x="${C[i]}" y="${hy}" font-size="16" font-weight="600" fill="${t.mut}" letter-spacing="1.3">${h.toUpperCase()}</text>`).join('') + `<line x1="${SL}" y1="${hy + 22}" x2="${SR}" y2="${hy + 22}" stroke="${t.line}"/>`;
  rows.slice(0, 8).forEach((p, i) => {
    const ry = hy + 22 + (i + 1) * 65, by = ry - 24, lv = Math.min(5, p.phase.level || 0);
    const dots = Array.from({ length: 5 }, (_, k) => `<circle cx="${C[3] + 6 + k * 17}" cy="${by - 8}" r="6" fill="${k < lv ? t.ink : t.off}"/>`).join('');
    const co = String(p.company || '').split(' · ')[0].replace(/,?\s+(Inc\.?|LLC|Ltd\.?|GmbH|AG|Co\., Ltd\.?)$/i, '');
    const next = p.next_catalyst?.date ? shortDate(p.next_catalyst.date) : '—';
    body += `<text x="${C[0]}" y="${by}" font-size="25" font-weight="600" fill="${t.ink}">${x(cut(p.drug[0].toUpperCase() + p.drug.slice(1), 28))}</text>`
      + `<text x="${C[1]}" y="${by}" font-size="25" fill="${t.mut}">${x(cut(p.mechanism || p.explain?.term || '—', 26))}</text>`
      + `<text x="${C[2]}" y="${by}" font-size="25" fill="${t.ink}">${x(cut(co, 20))}</text>`
      + `${dots}<text x="${C[3] + 98}" y="${by}" font-size="25" fill="${t.ink}">${x(cut(STAGE_ROW(p.phase.label), 18))}</text>`
      + `<text x="${C[4]}" y="${by}" font-size="25" fill="${t.ink}">${x(next)}</text>`
      + `<line x1="${SL}" y1="${ry}" x2="${SR}" y2="${ry}" stroke="${t.line}"/>`;
  });
  return slideFrame(t, { url, day }, body);
}
export const slidePng = svg => svgToPng(svg, SW);
// A ready-made landscape's name on its slide: "Obesity drug landscape" reads "Obesity" (the slide says "Drug landscape" above it).
export const slideTitle = t => String(t).replace(/( drug)? landscape$/i, '');
export const SITE_HOST = SITE;

// ---------- routes ----------
// /img/mail-logo.png, /img/ridge.gif?a=<area>&p=<phase>, /img/og/site.png, /img/og/landscapes/<slug>.png, /img/og/drugs/<id>.png.
// `landscapes`: the public landscape pages by slug ({ area, title, phase_min }), as server.js lists them.
export function imageRouter({ landscapes = {} } = {}) {
  const r = Router(), cache = new Map();
  let drawn = { since: Date.now(), n: 0 };
  const newRidgeAllowed = () => {
    if (Date.now() - drawn.since > 60_000) drawn = { since: Date.now(), n: 0 };
    return ++drawn.n <= 60;
  };
  const once = (key, make) => {
    const k = Q.loadStamp() + '|' + key, hit = cache.get(k);
    if (hit) return hit;
    const v = make(); cache.set(k, v);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return v;
  };
  const send = (res, type, buf) => res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }).send(buf);
  r.get('/img/mail-logo.png', (req, res) => send(res, 'image/png', once('logo', () => svgToPng(logoSvg(), 112))));
  r.get('/img/ridge.gif', (req, res) => {
    const area = String(req.query.a || '').trim().slice(0, 120), p = Math.min(5, Math.max(1, +req.query.p || 2));
    if (!area) return res.status(404).send('Not found');
    // Any words can be drawn (each weekly email draws its own landscape), but a new picture costs a landscape search:
    // at most 60 new ones a minute in all, so a loop of made-up words cannot tie up the server. Pictures drawn before still show.
    const key = `ridge:${area.toLowerCase()}|${p}`;
    if (!cache.has(Q.loadStamp() + '|' + key) && !newRidgeAllowed()) return res.status(429).send('Busy, try again in a minute');
    const buf = once(key, () => { const st = ridgeStages(Q.landscape({ area, phase_min: p, limit: 1 })); return st.length ? ridgeGif(st, area.toLowerCase()) : null; });
    return buf ? send(res, 'image/gif', buf) : res.status(404).send('Not found');
  });
  r.get('/img/og/site.png', (req, res) => send(res, 'image/png', once('og:site', () => svgToPng(landingPreview(), 1200))));
  r.get('/img/og/landscapes/:slug.png', (req, res) => {
    const p = landscapes[req.params.slug];
    if (!p) return res.status(404).send('Not found');
    send(res, 'image/png', once('og:l:' + req.params.slug, () => svgToPng(landscapePreview(Q.landscape({ area: p.area, phase_min: p.phase_min || 2, limit: 1 }), { title: p.title, slug: req.params.slug }), 1200)));
  });
  // The picture for slides of a ready-made landscape: free for everyone (it carries our name), drawn once per stage, theme and
  // day. ?p= the stage (as on its page), ?theme=dark. Pictures of anything else are paid (/api/slide.png in server.js).
  r.get('/landscapes/:slug/slide.png', (req, res) => {
    const p = landscapes[req.params.slug];
    if (!p) return res.status(404).send('Not found');
    const pm = [1, 2, 3].includes(+req.query.p) ? +req.query.p : p.phase_min || 2, theme = req.query.theme === 'dark' ? 'dark' : 'light', day = creditDay();
    const buf = once(`slide:${req.params.slug}|${pm}|${theme}|${day}`, () => slidePng(overviewSlideSvg(Q.landscape({ area: p.area, phase_min: pm, limit: 1 }),
      { title: slideTitle(p.title), url: `${SITE}/landscapes/${req.params.slug}`, day, theme })));
    send(res, 'image/png', buf);
  });
  r.get('/img/og/drugs/:id.png', (req, res) => {
    const buf = once('og:d:' + req.params.id, () => { const d = Q.drug(req.params.id); return d ? svgToPng(drugPreview(d), 1200) : null; });
    return buf ? send(res, 'image/png', buf) : res.status(404).send('Not found');
  });
  return r;
}
