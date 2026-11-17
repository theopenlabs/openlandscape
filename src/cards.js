// Cards inside Claude and ChatGPT (MCP Apps).
// One page (the "card") draws one card per answer: the lookups return data only, and the AI's last call, show() (src/mcp.js),
// draws the main result with the other parts as rows. Each tool keeps its text answer for the AI and adds `structuredContent`:
// the same facts, already in the website's words (web/table.js), for the card to draw. The card itself is web/card.js and
// web/card.css on top of the website's stylesheet, so it looks like the website.
// Both apps read the MCP Apps standard: a tool's `_meta.ui.resourceUri` names a `ui://` page of type text/html;profile=mcp-app.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stagePlain, milestonePlain, drugName, companyShort, creditLine, explainHTML, cleanAliases, shortDate } from '../web/table.js';
import { icon, logo } from '../web/icons.js';

export const CARD_URI = 'ui://openlandscape/card-v1.html';
export const CARD_MIME = 'text/html;profile=mcp-app';
// On every tool: the standard key, the older flat key (some hosts still read it) and ChatGPT's alias. Same page for all.
export const cardMeta = { ui: { resourceUri: CARD_URI }, 'ui/resourceUri': CARD_URI, 'openai/outputTemplate': CARD_URI };
// Cards are on for everyone, in Claude and ChatGPT (since 16 Nov 2026, after trying them on a Solo and a Free account
// in both apps). Off switch: AI_CARDS=0 on the server, and every tool answers exactly as before cards (text only, no card data).
// People who connected Claude before the cards see them only after they disconnect and reconnect (Claude keeps a connector's
// abilities from when it was connected).
export const cardsOn = () => String(process.env.AI_CARDS ?? '').trim() !== '0';

const here = p => fileURLToPath(new URL(p, import.meta.url));
// The official MCP Apps helper for the page (pinned in package.json). It is one ES module ending in `export{…}`; inlined into
// the page, its App class is handed to our script instead (no outside scripts: both apps block them unless declared).
function appBundle() {
  const src = readFileSync(createRequire(import.meta.url).resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8');
  const m = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  const app = m && m[1].split(',').map(s => s.trim().split(/\s+as\s+/)).find(([, as]) => as === 'App');
  if (!app) throw new Error('ext-apps bundle: App export not found');
  return src.slice(0, m.index) + `;globalThis.McpApp=${app[0]};`;
}
// The website's phone rules ask how wide the window is; a card is narrow on a laptop too, so they would turn a chat card into
// the phone page. The card has its own rules for narrow cards (web/card.css), so the website's are left out.
export function withoutNarrowScreens(css) {
  let out = '', i = 0;
  const re = /@media[^{]*max-width[^{]*\{/g;
  for (let m; (m = re.exec(css));) {
    let depth = 1, j = m.index + m[0].length;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out += css.slice(i, m.index); i = j; re.lastIndex = j;
  }
  return out + css.slice(i);
}
const pages = {};
// The card page: the website's stylesheet (without its font files: the apps do not load outside fonts) + the card's own.
// ChatGPT's copy has no logo on the Open button (its rules: "Do not include your logo"; ChatGPT shows it above the card).
export function cardHtml({ chatgpt = false } = {}) {
  const key = chatgpt ? 'chatgpt' : 'claude';
  if (pages[key]) return pages[key];
  const css = withoutNarrowScreens(readFileSync(here('../web/style.css'), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '')) + readFileSync(here('../web/card.css'), 'utf8');
  const icons = Object.fromEntries(['pill', 'calendar', 'pulse', 'info', 'search', 'user', 'chevron', 'arrow'].map(n => [n, icon(n, 20)]));
  icons.logo = logo(20); icons.logo16 = chatgpt ? '' : logo(16);
  icons.expand = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>';
  pages[key] = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="ds card-page"><div id="root"></div>
<script type="module">${appBundle()}
{ // our script in its own block: the helper's short names stay its own
const McpApp = globalThis.McpApp, ICONS = ${JSON.stringify(icons)};
${readFileSync(here('../web/card.js'), 'utf8')}
}</script></body></html>`;
  return pages[key];
}
// ChatGPT only (16 Nov 2026): its review needs the card's own address (ui.domain; Claude refuses ChatGPT's format, so Claude
// gets none, as before) and the website on its list of links that open without a warning (redirect_domains).
export const SITE_ORIGIN = String(process.env.PUBLIC_URL || 'https://openlandscape.app').replace(/^(https?:\/\/[^/]+).*$/, '$1');
export function registerCard(server, { chatgpt = false } = {}) {
  // Everything is inside the page and data comes only through tool calls, so nothing outside is allowed.
  const ui = { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false };
  const meta = chatgpt ? { ui: { ...ui, domain: SITE_ORIGIN }, 'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: [SITE_ORIGIN] } } : { ui };
  server.registerResource('OpenLandscape card', CARD_URI, { mimeType: CARD_MIME, description: 'Draws OpenLandscape answers: landscapes, drugs, trials, dates, sponsors and changes.' },
    async () => ({ contents: [{ uri: CARD_URI, mimeType: CARD_MIME, text: cardHtml({ chatgpt }), _meta: meta }] }));
}

// ---------- what each tool hands the card ----------
// Stage as the website says it: "Filed" with "in China" when outside the US; level 1–5 for the five dots.
export function stageOf(label) {
  const [full, where] = stagePlain(label || '');
  const level = Math.min(5, Number(String(label).match(/Phase (\d)/)?.[1]) || (/^(Approved|Marketed|FDA|On the market)/.test(label) ? 5 : /^Filed/.test(label) ? 4 : 0));
  return { stage: full.replace(' for approval', ''), where: /^in /.test(where) && where !== 'in the US' ? where : '', level };
}
const unesc = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// "How it works" as the website's table says it (explainHTML's short form).
const howOf = (e, mech, curated) => unesc(explainHTML(e || { term: mech, source: curated ? 'hand' : null }).short);
const next = (nc, soon) => (nc ? { label: nc.label, url: nc.url || '', what: milestonePlain(nc.what), soon: !!soon, news: !!nc.news } : null);
const cos = s => String(s || '').split(' · ').filter(Boolean);
const statusText = s => (s === 'ACTIVE_NOT_RECRUITING' ? 'Active, not recruiting' : String(s || '').charAt(0) + String(s || '').slice(1).toLowerCase().replace(/_/g, ' '));
// "soon" as on the website: the date (a month counts as its last day) is within 30 days.
const soonDate = d => !!d && (String(d).length === 7 ? d + '-31' : String(d)) <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) && String(d) >= new Date().toISOString().slice(0, 7);
// A limit as the website's meter (web/table.js limitBox): label, used of, one sentence, at most one button ('talk' = Write to us).
// Never a plan or a price: ChatGPT turns down apps that show upgrades in cards.
export const meterOf = (n, say) => (n ? { label: n.label, used: n.used, of: n.of, say: say ?? (n.act === 'solo' ? "Anything you've already opened works as usual." : n.say ?? ''), act: n.act === 'talk' ? 'talk' : '' } : null);

// A card carries at most 100 rows: Claude leaves a card empty when an answer passes ~150,000 characters, and the text the AI
// gets has every row anyway. Past 100 the card says so and links the website.
const CARD_ROWS = 100;
export function landscapeView(L, { site, link, cut, limit, total }) {
  return {
    view: 'landscape', area: L.area, phase_min: L.phase_min, title: L.area.charAt(0).toUpperCase() + L.area.slice(1),
    total: total ?? L.stats.programs, trials: L.stats.trials, companies: L.stats.companies,
    by_phase: (L.stats.by_phase || []).filter(b => b.count).map(b => ({ name: b.name, count: b.count })),
    next: L.stats.next ? { drug: drugName(L.stats.next.drug), ...next(L.stats.next, L.stats.next.soon) } : null,
    rows: L.programs.slice(0, CARD_ROWS).map(p => {
      const c = cos(p.company);
      return { name: drugName(p.drug), id: p.id, company: companyShort(c[0] || ''), more: Math.max(0, c.length - 1),
        how: howOf(p.explain, p.mechanism, p.curated), ...stageOf(p.phase.label), stage_url: p.phase.source || '', news: !!p.phase.news,
        next: next(p.next_catalyst, p.soon) };
    }),
    cut: cut || null, limit: limit || null, link: site + link, source: creditLine(site + link),
  };
}
export function drugView(D, { site }) {
  const s = stageOf(D.stage.label), act = D.trials.filter(x => x.active), path = `/drugs/${encodeURIComponent(D.id)}`;
  return {
    view: 'drug', title: drugName(D.name), id: D.id, aliases: cleanAliases(D.name, D.aliases).slice(0, 6).map(a => a.name),
    companies: D.companies.length ? D.companies.map(c => c.name) : cos(D.company).map(companyShort),
    how: howOf(D.explain, D.mechanism, D.curated), plain: D.explain?.plain || '', targets: D.targets.map(t => t.name),
    ...s, stage_url: D.stage.url || '', news: !!D.stage.news,
    next: D.catalysts[0] ? next(D.catalysts[0], soonDate(D.catalysts[0].date)) : null,
    coming: D.catalysts.map(c => ({ label: c.label, what: milestonePlain(c.what), url: c.url || '', news: !!c.news, src: c.news ? 'press release' : 'ClinicalTrials.gov' })),
    tested_for: D.tested_for.slice(0, 8).map(x => ({ name: x.name, trials: x.trials })), tested_more: Math.max(0, D.tested_for.length - 8),
    active: act.length, total: D.trials.length,
    trials: act.slice(0, 25).map(x => ({ nct: x.nct, url: x.url, phase: x.phase, status: statusText(x.status), completes: x.primary_completion_label || '', title: x.title })),
    link: site + path, source: creditLine(site + path),
  };
}
export function trialsView(r, { site, link, title }) {
  return { view: 'trials', title, count: r.count,
    rows: r.trials.slice(0, CARD_ROWS).map(x => ({ nct: x.nct, url: x.url, phase: x.phase, status: statusText(x.status), sponsor: companyShort(x.sponsor), drugs: x.drugs.map(drugName), completes: shortIso(x.primary_completion), title: x.title })),
    link: site + link, source: creditLine(site + link) };
}
export function catalystsView(r, { site, link, area, days }) {
  return { view: 'catalysts', title: area ? area.charAt(0).toUpperCase() + area.slice(1) : 'Every area', area: area || '', days, count: r.count,
    rows: r.catalysts.map(c => ({ label: shortDate(c.date, new Date().getFullYear()) || c.label, drug: drugName(c.drug), sponsor: companyShort(c.sponsor || ''), what: milestonePlain(c.what), url: c.source || '', news: c.kind === 'news', soon: soonDate(c.date) })),
    link: site + link, source: creditLine(site + link) };
}
export function whoView(r, { site, link, area, phase, country }) {
  return { view: 'who', title: area.charAt(0).toUpperCase() + area.slice(1), area, phase: phase || null, country: country || '', active: r.active_trials,
    sponsors: r.sponsors.map(s => ({ name: companyShort(s.sponsor), active: s.active_trials, sites: s.sites })),
    sites: r.sites.map(s => ({ name: s.facility, city: s.city, country: s.country, active: s.active_trials })),
    link: site + link, source: creditLine(site + link) };
}
export function searchView(r, query, { site }) {
  return { view: 'search', query, title: `“${query}”`,
    drugs: r.drugs.map(d => ({ name: drugName(d.name), company: cos(d.company).map(companyShort).join(' · '), how: d.mechanism || '', trials: d.trials })),
    companies: r.companies.map(c => ({ name: c.name, trials: c.trials, active: c.active })),
    conditions: r.conditions.map(c => ({ name: c.name, trials: c.trials })),
    link: site, source: creditLine(site) };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-08-01" → "1 Aug 2026", "2027-09" → "Sep 2027"
export function shortIso(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  return m ? `${m[3] ? Number(m[3]) + ' ' : ''}${MON[Number(m[2]) - 1]} ${m[1]}` : '';
}

// One card holds several parts, and Claude leaves a card empty past ~150,000 characters. Past `budget`, the biggest part's
// list is halved until it fits (its full screen then says how many there are; the website has all of them). Changes parts.
export function fitCard(main, parts, budget = 100000) {
  const size = v => JSON.stringify(v).length;
  for (let i = 0; size(main) + parts.reduce((s, p) => s + size(p), 0) > budget && i < 50; i++) {
    const lists = parts.map(p => ['rows', 'sites', 'sponsors', 'trials'].map(k => p[k]).find(l => Array.isArray(l) && l.length > 5)).filter(Boolean);
    if (!lists.length) break;
    const big = lists.sort((x, y) => size(y) - size(x))[0];
    big.length = Math.ceil(big.length / 2);
  }
  return parts;
}
