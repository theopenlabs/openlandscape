// Remote MCP server (Streamable HTTP). Seven tools over the same queries the dashboard uses (and whoami).
// Connect with:  https://<host>/mcp  and sign in (OAuth, src/oauth.js): the app opens the browser, the person clicks Allow.
//      or a key: https://<host>/mcp/u/<api-key>, or https://<host>/mcp with header  Authorization: Bearer <api-key>
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as Q from './query.js';
import { creditLine, shortDate, cleanAliases, drugName, companyShort } from '../web/table.js';
import { SEARCH_PATH, appPath } from './pages/frame.js';
import { userFromApiKey, isPaid, LIMITS, usageCount, logUsage, monthStart, dayStart, nextMonthName, PAID_DAILY_LOOKUPS } from './auth.js';
import { getDb } from './db.js';
import { useDrugs, TOP_WHEN_OVER, plain } from './limits.js';
import { userFromAccessToken, appOfToken, RESOURCE_METADATA_URL } from './oauth.js';
import { cardMeta, cardsOn, fitCard, registerCard, meterOf, landscapeView, drugView, trialsView, catalystsView, whoView, searchView } from './cards.js';

const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const link = (label, url) => (url ? `[${cell(label)}](${url})` : cell(label));
// Every answer ends with the source line (branded exports, 15 Nov 2026), and the instructions ask the AI to keep it when it shows
// the data. `area`: the landscape asked about, for its link (setLinkFor: the server knows the ready-made landscapes).
const SITE = (process.env.PUBLIC_URL || 'https://openlandscape.app').replace(/\/$/, '');
let linkFor = area => (area ? `/start?q=${encodeURIComponent(area).replace(/%20/g, '+')}` : '');
export const setLinkFor = f => { linkFor = f; };
// `path`: where the source line links (a drug's page); otherwise the landscape asked about, or the home page.
const footer = (d, area = '', path = linkFor(area)) => `\n\nData: ${d.trials_source}, pulled ${d.trials}; openFDA updated ${d.fda}. Every row links to its source; "news" marks press-report facts, "?" marks unconfirmed aliases or mechanisms.\n${creditLine(SITE + path)}`;

// Other names in an answer: cleaned (web/table.js cleanAliases), at most 4 (search: 8, so the name searched shows). "?" = unconfirmed.
export const aliasText = (drug, aliases, max = 4) => cleanAliases(drug, aliases).slice(0, max).map(a => a.name + (a.confirmed ? '' : '?')).join(', ');
// "Public (AZN) · Not yet researched", not "Public · Not yet researched AZN".
const financeText = f => (f.tickers.length ? f.label.replace('Public', `Public (${f.tickers.join(', ')})`) : f.label);
// The registry's status codes in words: ACTIVE_NOT_RECRUITING is "Active, not recruiting".
const statusText = s => (s === 'ACTIVE_NOT_RECRUITING' ? 'Active, not recruiting' : String(s || '').charAt(0) + String(s || '').slice(1).toLowerCase().replace(/_/g, ' '));

// `extra`: notes about limits, placed before the source line (which stays last).
function landscapeText(L, extra = '') {
  if (!L.programs.length) return (L.summary || `Nothing found for "${L.area}".`) + extra;
  let t = `${L.summary}${includedText(L.included)}\n\n| Drug | Aliases | Company | Mechanism | Phase | Next milestone | Financing | Source |\n|---|---|---|---|---|---|---|---|\n`;
  for (const p of L.programs) {
    const al = aliasText(p.drug, p.aliases);
    const mech = p.mechanism ? p.mechanism + (p.mechanism_confirmed ? '' : '?') : 'not yet classified';
    const ph = link(p.phase.label, p.phase.source) + (p.phase.news ? ' (news)' : '');
    const nc = p.next_catalyst ? `${link(p.next_catalyst.label, p.next_catalyst.url)}: ${cell(p.next_catalyst.what)}${p.next_catalyst.news ? ' (news)' : ''}` : '—';
    const fin = financeText(p.financing);
    t += `| ${cell(p.drug)} | ${cell(al)} | ${cell(p.company)} | ${cell(mech)} | ${ph} | ${nc} | ${cell(fin)} | ${link(p.lead_trial.nct, p.lead_trial.url)} +${p.trials.active - 1 > 0 ? p.trials.active - 1 : 0} |\n`;
  }
  if (L.truncated) t += `\n(List cut at ${L.programs.length} programs; raise "limit" or narrow the area.)`;
  return t + extra + footer(L.data, L.area);
}

// The "Included" line of a disease search: which sub-diseases the search covered, what was left out, and how many of the
// trials the registry itself tags with the disease it found.
function includedText(I) {
  if (!I) return '';
  const parts = [];
  if (I.children.length) parts.push(`Included: ${I.children.slice(0, 6).map(c => `${c.name} (${c.active} active trials)`).join(', ')}${I.children.length > 6 ? ` and ${I.children.length - 6} more` : ''}.`);
  if (I.left_out.length) parts.push(`Left out: ${I.left_out.map(x => x.name).join(', ')}.`);
  if (I.coverage.pct != null) parts.push(`Covers ${I.coverage.found} of ${I.coverage.tagged} active trials the registry tags as ${I.name} (${I.coverage.pct}%)${I.coverage.extra ? `, plus ${I.coverage.extra} it does not tag` : ''}.`);
  return parts.length ? '\n' + parts.join(' ') : '';
}
function json(obj) { return '```json\n' + JSON.stringify(obj, null, 1) + '\n```'; }

// With cards on, the lookups draw nothing and show() draws one card for the whole answer.
const SHOW_HOW = ' When your answer is done, call show() once with the main result and the other parts you looked up (the same tool and arguments): it draws one card for the whole answer, under your text. The lookups themselves draw nothing. Write your answer in text as usual.';
// ChatGPT only (16 Nov 2026): its rules turn down apps that show prices or push upgrades. It may say a feature needs another
// plan and link to the plans page, so "Solo ($49 a month, excl. VAT) shows all 167: …/pricing" reads "The Solo plan shows all 167. Plans: …/pricing".
export const noPrice = s => String(s).replace(/Solo \(\$\d+ a month[^)]*\) /g, 'The Solo plan ').replace(/ Solo: (\S+\/pricing)/g, ' Plans: $1')
  .replace(/(The Solo plan [^:.]*): (\S+\/pricing)/g, '$1. Plans: $2');
// `chatgpt`: the caller signed in through ChatGPT (handleMcp). Claude and every other app get what they got before.
export function buildServer(user, { chatgpt = false } = {}) {
  // title, logo and website: what Claude, ChatGPT and other apps show for the connector (MCP serverInfo).
  const server = new McpServer({ name: 'openlandscape', title: 'OpenLandscape', version: '0.1.0', websiteUrl: SITE,
    icons: [{ src: `${SITE}/static/logo-512.png`, mimeType: 'image/png', sizes: ['512x512'] }] }, {
    instructions: 'Drug pipeline and clinical-trial data from ClinicalTrials.gov and openFDA, with drug aliases merged (e.g. mazdutide = LY3305677 = IBI362). Start with landscape() for an area, search() to resolve a name, drug() for everything about one drug, trials() for trial detail, catalysts() for upcoming dates, who_runs_trials() for sponsors and sites, changes() for what changed in what the user follows. Always pass the source links through to the user. Each result ends with a line that starts "Source: OpenLandscape": when you show this data, end your answer with that line, as it is.' + (cardsOn() ? SHOW_HOW : ''),
  });
  const text = s => ({ content: [{ type: 'text', text: chatgpt ? noPrice(s) : s }] });
  // Cards (src/cards.js) only when switched on; `CARD` goes on whoami and show, the two tools that draw a card.
  const cards = cardsOn(), CARD = cards ? { _meta: cardMeta } : {};
  if (cards) registerCard(server, { chatgpt });
  // One drug asked for (trials by drug, drug) past the drug allowance: said about that drug, not about lists (15 Nov 2026).
  // "That's 2,000 new drugs today. Orforglipron's trials open tomorrow. …" Thrown; the guard returns it as a refusal.
  const refusal = (name, note, what) => {
    const n = String(name).charAt(0).toUpperCase() + String(name).slice(1), whose = what === 'trials' ? `${n}'s trials` : n;
    const opens = note.when === 'tomorrow' ? `${whose} ${what === 'trials' ? 'open' : 'opens'} tomorrow.` : note.when === 'later' ? `${whose} ${what === 'trials' ? 'open' : 'opens'} as room frees up, each day.` : `${whose} ${what === 'trials' ? 'stay' : 'stays'} closed on Free.`;
    const e = new Error(plain({ ...note, bold: (isPaid(user) ? "That's " : '') + note.bold, rest: `${opens} Anything you've already opened works as usual.${note.act === 'solo' ? ' Solo shows every list in full.' : ''}` }));
    e.refused = true;
    e.card = { view: 'limit', title: opens, meter: meterOf(note, "Anything you've already opened works as usual.") };
    return e;
  };
  // Every tool only reads (the directories ask for these hints).
  const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  // A tool answers with text (for the AI) or { text, card } (card: what the card draws, src/cards.js). Free answers also tell
  // the card how many lookups are left this month.
  const answer = (t, card, isError) => {
    const r = { ...text(t), ...(isError ? { isError: true } : {}) };
    if (card && cards) {
      if (user && !isPaid(user) && card.view !== 'limit') card.lookups = { left: Math.max(0, LIMITS.free.mcp_calls - usageCount(user.id, 'mcp', monthStart())), of: LIMITS.free.mcp_calls };
      r.structuredContent = card;
    }
    return r;
  };
  // Each lookup's work, by tool name, so show() can draw what was looked up without looking it up again.
  const run = {};
  const guard = (name, fn) => (run[name] = fn, async args => {
    if (user && !isPaid(user)) {
      const used = usageCount(user.id, 'mcp', monthStart());
      if (used >= LIMITS.free.mcp_calls) return answer(`You've used this month's ${LIMITS.free.mcp_calls} free lookups on the Free plan. They come back on ${nextMonthName()}. Solo ($49 a month, excl. VAT) gives 300 lookups a day: ${SITE}/pricing`,
        { view: 'limit', title: "This month's free lookups are used", meter: { label: 'Free lookups this month', used, of: LIMITS.free.mcp_calls, say: `They come back on ${nextMonthName()}.`, act: '' } }, true);
    } else if (user && usageCount(user.id, 'mcp', dayStart()) >= PAID_DAILY_LOOKUPS) {
      // Solo gives 300 lookups a day (said on Pricing); this stop names the number.
      return answer(`That's ${PAID_DAILY_LOOKUPS} lookups today, the most for one day. They start again tomorrow. Need more? Write to us: ${SITE}/talk`,
        { view: 'limit', title: 'Lookups start again tomorrow', meter: { label: 'Lookups today', used: PAID_DAILY_LOOKUPS, of: PAID_DAILY_LOOKUPS, say: 'They start again tomorrow.', act: 'talk' } }, true);
    }
    if (user) logUsage(user.id, 'mcp', `${name} ${JSON.stringify(args)}`);
    try {
      const out = await fn(args);
      return typeof out === 'string' ? answer(out, { view: 'note', text: out.replace(/\s*https?:\/\/\S+$/, '') }) : answer(out.text, out.card);
    } catch (e) { return answer(e.refused ? e.message : `Error: ${e.message}`, e.card, true); }
  });

  // Free: setup prompts call this to check the connection without using a trial call.
  server.registerTool('whoami', {
    title: 'Who am I', annotations: READ, ...CARD,
    description: 'Check the connection: which account is signed in, its plan, and how many free lookups are left. Does not use a lookup.',
    inputSchema: {},
  }, async () => {
    if (!user) return text('Connected without an account (open mode).');
    const paid = isPaid(user), leftN = Math.max(0, LIMITS.free.mcp_calls - usageCount(user.id, 'mcp', monthStart()));
    const left = paid ? `${PAID_DAILY_LOOKUPS} lookups a day` : `${leftN} of ${LIMITS.free.mcp_calls} free lookups left this month`;
    const plan = paid ? user.plan[0].toUpperCase() + user.plan.slice(1).replace('_year', ' (yearly)') : 'Free';
    // The welcome card: plan, lookups, what they follow or their free landscape, and three questions to tap.
    const db = getDb();
    const follows = paid ? db.prepare('SELECT query FROM saved_landscape WHERE user_id=? ORDER BY id').pluck().all(user.id) : [];
    const mine = paid ? '' : db.prepare("SELECT detail FROM usage WHERE user_id=? AND kind='landscape' ORDER BY at LIMIT 1").pluck().get(user.id) || '';
    const one = follows[0] || mine;
    const asks = paid && follows.length ? ['What changed in what I follow this week?', `What reads out in ${follows[0]} in the next six months?`, `Map every drug in ${follows[0]}`]
      : ['Map every amylin drug in Phase 2 or later', 'Tell me everything about mazdutide', 'Which obesity drugs read out in the next six months?'];
    if (!cards) return text(`Connected to OpenLandscape as ${user.email}. Plan: ${plan}, ${left}.`);
    return { ...text(`Connected to OpenLandscape as ${user.email}. Plan: ${plan}, ${left}.`),
      structuredContent: { view: 'welcome', email: user.email, plan, paid, lookups: paid ? null : { left: leftN, of: LIMITS.free.mcp_calls },
        follows, free_landscape: mine ? mine.charAt(0).toUpperCase() + mine.slice(1) : '', one, asks, link: SITE + (paid ? appPath('') : SEARCH_PATH) } };
  });

  server.registerTool('search', {
    title: 'Search', annotations: READ, description: 'Find a drug, company or disease under any of its names (codes, INNs, brand names, misspellings). Returns the drugs\' main names, sponsor names and matching conditions with trial counts.',
    inputSchema: { query: z.string().describe('A drug name or code, company, or disease, e.g. "IBI362", "Hengrui", "obesity"') },
  }, guard('search', ({ query }) => {
    const r = Q.search({ query }), c = user ? counted(r.drugs) : { rows: r.drugs, note: '', limit: null };
    r.drugs = c.rows;
    let t = `Search "${query}"\n\nDrugs / programs:\n`;
    t += r.drugs.length ? r.drugs.map(d => `- ${d.name} · ${d.company}${d.mechanism ? ' · ' + d.mechanism : ''}${d.aliases.length ? ' · also: ' + aliasText(d.name, d.aliases.map(name => ({ name, confirmed: 1 })), 8) : ''} · ${d.trials} trials`).join('\n') : '- none';
    t += '\n\nSponsors:\n' + (r.companies.length ? r.companies.map(c => `- ${c.name}: ${c.trials} trials (${c.active} active)`).join('\n') : '- none');
    t += '\n\nConditions:\n' + (r.conditions.length ? r.conditions.map(x => `- ${x.name}: ${x.trials} trials`).join('\n') : '- none');
    return { text: t + c.note + footer(r.data), card: { ...searchView(r, query, { site: SITE }), limit: c.limit } };
  }));

  // Free sees a list in full only where the website shows it in full: the ready-made landscapes and the one they made their
  // free landscape (on the website; asking the AI never uses it up). Elsewhere the top 10, as on the website.
  const freeFull = area => linkFor(area).startsWith('/landscapes/')
    || !!getDb().prepare("SELECT 1 FROM usage WHERE user_id=? AND kind='landscape' AND lower(detail)=?").get(user.id, String(area).trim().toLowerCase());
  // The drugs an answer shows count toward the account's different drugs (src/limits.js); past the allowance a paid account
  // gets the top 10 and Free none, with why. Returns { rows, note }.
  const counted = programs => {
    const u = useDrugs(user, programs.map(p => p.id));
    if (u.ok) return { rows: programs, note: u.warn ? `\n\n${u.warn}` : '', limit: meterOf(u.note) };
    return { rows: programs.slice(0, isPaid(user) ? TOP_WHEN_OVER : 0), note: `\n\n${u.msg}`, limit: meterOf(u.note) };
  };

  server.registerTool('landscape', {
    title: 'Landscape', annotations: READ, description: 'Every drug program in an area (disease, mechanism, target, modality or company) as a compact table: drug, aliases, company, mechanism, phase, next milestone, financing, source. Sorted by most advanced, then soonest milestone. Only programs with an active trial unless include_finished is true.',
    inputSchema: {
      area: z.string().describe('e.g. "obesity", "amylin", "oral GLP-1", "siRNA", "Hengrui"'),
      phase_min: z.number().int().min(1).max(5).optional().describe('1 = Phase 1 ... 4 = filed, 5 = approved. Default 1.'),
      include_finished: z.boolean().optional().describe('Also include programs whose trials in this area finished in the last two years.'),
      limit: z.number().int().min(1).max(300).optional().describe('How many drugs, most advanced first. Default 100; ask for more only when the user needs the whole list.'),
    },
  }, guard('landscape', ({ area, phase_min = 1, include_finished = false, limit = 100 }) => {
    const L = Q.landscape({ area, phase_min, include_finished, limit });
    if (!user) return { text: landscapeText(L), card: landscapeView(L, { site: SITE, link: linkFor(area) }) };
    const preview = !isPaid(user) && !freeFull(area), ready = linkFor(area).startsWith('/landscapes/');
    // The ready-made landscapes are free to read for everyone, so they never count.
    const c = ready ? { rows: L.programs, note: '' } : counted(preview ? L.programs.slice(0, 10) : L.programs);
    const cut = preview && c.rows.length && L.stats.programs > c.rows.length ? `\n\nThe Free plan shows the top 10 here, as on the website. Solo ($49 a month, excl. VAT) shows all ${L.stats.programs}: ${(process.env.PUBLIC_URL || 'https://openlandscape.app').replace(/\/$/, '')}/pricing` : '';
    const shown = { ...L, programs: c.rows, truncated: L.truncated && !preview && c.rows.length === L.programs.length };
    // Free's cut as the website's meter, without plan or price (the AI's text still names Solo).
    const cutMeter = cut ? { label: `Showing the top ${c.rows.length}`, used: c.rows.length, of: L.stats.programs, say: `Free shows the top ${TOP_WHEN_OVER} of each list.`, act: '' } : null;
    return { text: landscapeText(shown, cut + c.note), card: landscapeView(shown, { site: SITE, link: linkFor(area), cut: cutMeter, limit: c.limit }) };
  }));

  server.registerTool('trials', {
    title: 'Trials', annotations: READ, description: 'Trials filtered by area, drug, sponsor, minimum phase, country, status and dates. Each row links to ClinicalTrials.gov.',
    inputSchema: {
      area: z.string().optional(), drug: z.string().optional().describe('Any name or code; aliases are merged'),
      sponsor: z.string().optional(), phase: z.number().int().min(1).max(4).optional().describe('Minimum phase'),
      country: z.string().optional(), status: z.string().optional().describe('"active" (default), "all", or a registry status such as COMPLETED'),
      start_after: z.string().optional().describe('YYYY-MM-DD'), completion_before: z.string().optional().describe('YYYY-MM-DD, primary completion'),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, guard('trials', args => {
    // Asking by drug name returns the trials under all its names (our merged names): that drug counts (src/limits.js).
    if (user && args.drug) {
      const d = Q.search({ query: args.drug, limit: 1 }).drugs[0], u = d ? useDrugs(user, [d.id]) : { ok: true };
      if (!u.ok) throw refusal(d.name, u.note, 'trials');
    }
    const r = Q.trials({ limit: 50, ...args });
    let t = `${r.count} trials match${r.count > r.trials.length ? ` (showing ${r.trials.length})` : ''}.\n\n| Trial | Phase | Status | Sponsor | Drugs | Primary completion | Countries | Title |\n|---|---|---|---|---|---|---|---|\n`;
    for (const x of r.trials) t += `| ${link(x.nct, x.url)} | ${x.phase} | ${statusText(x.status)} | ${cell(x.sponsor)} | ${cell(x.drugs.join(', '))} | ${x.primary_completion || ''} | ${cell(x.countries.slice(0, 5).join(', '))}${x.countries.length > 5 ? ' +' + (x.countries.length - 5) : ''} | ${cell(x.title)} |\n`;
    const what = args.drug ? drugName(args.drug) : args.sponsor ? companyShort(args.sponsor) : args.area ? args.area.charAt(0).toUpperCase() + args.area.slice(1) : 'Trials';
    return { text: t + footer(r.data, args.area || ''), card: trialsView(r, { site: SITE, link: linkFor(args.area || ''), title: what }) };
  }));

  server.registerTool('catalysts', {
    title: 'Catalysts', annotations: READ, description: 'Upcoming readouts and decisions in the next N days: planned primary completion dates from the registry, plus sourced news items (FDA decisions, filings). Optionally limited to an area.',
    inputSchema: {
      days_ahead: z.number().int().min(1).max(730).describe('How far ahead to look, in days'),
      area: z.string().optional(), phase_min: z.number().int().min(1).max(4).optional().describe('Default 2'),
    },
  }, guard('catalysts', ({ days_ahead, area, phase_min = 2 }) => {
    const r = Q.catalysts({ days_ahead, area, phase_min });
    let t = `${r.count} milestones in the next ${days_ahead} days${area ? ` for "${area}"` : ''}${r.truncated ? ` (showing ${r.catalysts.length})` : ''}.\n\n| Date | Drug | Sponsor | What | Source |\n|---|---|---|---|---|\n`;
    for (const c of r.catalysts) t += `| ${c.label} | ${cell(c.drug)} | ${cell(c.sponsor || '')} | ${cell(c.what)}${c.kind === 'news' ? ' (news' + (c.confirmed ? '' : ', unconfirmed') + ')' : ''} | ${link(c.nct || 'article', c.source)} |\n`;
    return { text: t + '\n' + r.note + footer(r.data, area || ''), card: catalystsView(r, { site: SITE, link: linkFor(area || ''), area, days: days_ahead }) };
  }));

  server.registerTool('who_runs_trials', {
    title: 'Who runs trials', annotations: READ, description: 'Sponsors and trial sites ranked by number of active industry trials in an area, optionally by minimum phase and country.',
    inputSchema: { area: z.string(), phase: z.number().int().min(1).max(4).optional(), country: z.string().optional() },
  }, guard('who_runs_trials', ({ area, phase, country }) => {
    const r = Q.whoRunsTrials({ area, phase, country });
    let t = `${r.active_trials} active trials${area ? ` in "${area}"` : ''}${phase ? `, Phase ${phase}+` : ''}${country ? `, in ${country}` : ''}.\n\nTop sponsors:\n| Sponsor | Active trials | Sites worldwide | Examples |\n|---|---|---|---|\n`;
    for (const s of r.sponsors) t += `| ${cell(s.sponsor)} | ${s.active_trials} | ${s.sites} | ${s.example_trials.map(e => link(e.nct, e.url)).join(', ')} |\n`;
    t += `\nTop sites:\n| Site | City | Country | Active trials | Examples |\n|---|---|---|---|---|\n`;
    for (const s of r.sites) t += `| ${cell(s.facility)} | ${cell(s.city)} | ${cell(s.country)} | ${s.active_trials} | ${s.example_trials.map(e => link(e.nct, e.url)).join(', ')} |\n`;
    return { text: t + '\n' + r.note + footer(r.data, area), card: whoView(r, { site: SITE, link: linkFor(area), area, phase, country }) };
  }));

  // ---- One drug, as its page shows it (added 15 Nov 2026). Counts that drug, like its page signed in.
  server.registerTool('drug', {
    title: 'Drug', annotations: READ, description: 'Everything about one drug: its other names, company, how it works, targets, stage, FDA approvals, what it is tested for, upcoming dates, recent changes and its active trials.',
    inputSchema: { name: z.string().describe('Any name, code or brand, e.g. "tirzepatide", "LY3298176", "Zepbound"') },
  }, guard('drug', ({ name }) => {
    const hit = Q.search({ query: name, limit: 1 }).drugs[0], D = hit && Q.drug(hit.id);
    if (!D) return { text: `No drug found for "${name}". Try another name or code, or search().`, card: { view: 'note', title: 'No drug found', text: `Nothing matches “${name}”. Try another name or code.` } };
    if (user) { const u = useDrugs(user, [D.id]); if (!u.ok) throw refusal(D.name, u.note, 'drug'); }
    const co = D.companies.length ? D.companies.map(c => c.name + (c.listed === 1 && c.ticker ? ` (public, ${c.ticker})` : c.listed === 0 ? ' (private)' : '')).join(' · ') : cell(D.company);
    const mech = D.mechanism ? D.mechanism + (D.mechanism_confirmed ? '' : '?') : 'not yet classified';
    const names = aliasText(D.name, D.aliases, 8);
    let t = `${D.name}${names ? ` (also: ${names})` : ''}\n\nCompany: ${co}\nHow it works: ${mech}${D.explain?.plain ? `. ${D.explain.plain}` : ''}\n`;
    if (D.targets.length) t += `Targets: ${D.targets.map(x => x.name).join(', ')}\n`;
    t += `Stage: ${link(D.stage.label, D.stage.url)}${D.stage.news ? ' (news)' : ''}\n`;
    if (D.other_use) t += `Also: ${link(D.other_use.label, D.other_use.url)}\n`;
    const fda = [...new Map(D.fda.map(f => [f.appl_no + f.brand.split(' ')[0], f])).values()].slice(0, 5);
    if (fda.length) t += `FDA approvals: ${fda.map(f => `${f.brand} (${f.appl_no}, ${shortDate(f.approval_date)})`).join('; ')}\n`;
    if (D.tested_for.length) t += `Tested for: ${D.tested_for.slice(0, 8).map(x => `${x.name} (${x.trials})`).join(', ')}\n`;
    if (D.catalysts.length) {
      t += `\nComing up:\n| Date | What | Source |\n|---|---|---|\n`;
      for (const c of D.catalysts) t += `| ${c.label} | ${cell(c.what)}${c.news ? ' (news' + (c.confirmed === false ? ', unconfirmed' : '') + ')' : ''} | ${link(c.news ? 'article' : (c.url || '').split('/').pop(), c.url)} |\n`;
    }
    if (D.changes.length) {
      t += `\nChanged in the last 90 days:\n`;
      for (const c of D.changes.slice(0, 10)) t += `- ${c.label}: ${c.text ? cell(c.text) : `${c.kind} ${c.before ? `from ${c.before} ` : ''}to ${c.after}`} (${link(c.nct || 'source', c.url)})\n`;
    }
    const act = D.trials.filter(x => x.active);
    t += `\n${act.length} active ${act.length === 1 ? 'trial' : 'trials'} of ${D.trials.length}${act.length > 25 ? ' (showing 25)' : ''}. For all of them: trials(drug: "${D.name}", status: "all").\n`;
    if (act.length) {
      t += `| Trial | Phase | Status | Primary completion | Countries | Title |\n|---|---|---|---|---|---|\n`;
      for (const x of act.slice(0, 25)) t += `| ${link(x.nct, x.url)} | ${x.phase} | ${statusText(x.status)} | ${x.primary_completion_label || ''} | ${cell(x.countries.slice(0, 4).join(', '))}${x.countries.length > 4 ? ' +' + (x.countries.length - 4) : ''} | ${cell(x.title)} |\n`;
    }
    return { text: t + footer(D.data, '', `/drugs/${encodeURIComponent(D.id)}`), card: drugView(D, { site: SITE }) };
  }));

  // ---- What changed in what the account follows (added 15 Nov 2026). Like the website: Solo sees every change in its
  // follows; Free sees how many changed in its free landscape, not which. Only follows, as /api/changes (data limits, 15 Nov).
  server.registerTool('changes', {
    title: 'Changes', annotations: READ, description: 'What changed recently in the landscapes, drugs and companies the user follows on OpenLandscape: new trials, stage and status changes, moved dates, regulator decisions, new catalysts. Leave out "area" for everything they follow.',
    inputSchema: {
      area: z.string().optional().describe('One thing they follow, e.g. "obesity" or "tirzepatide". Leave out for all of them.'),
      days: z.number().int().min(1).max(90).optional().describe('How far back, in days. Default 14.'),
    },
  }, guard('changes', ({ area, days = 14 }) => {
    if (!user) return 'Changes are for what an account follows; this connection has no account.';
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    if (!isPaid(user)) {
      const mine = getDb().prepare("SELECT detail FROM usage WHERE user_id=? AND kind='landscape' ORDER BY at LIMIT 1").pluck().get(user.id);
      const n = mine ? Q.changes({ area: mine, since }).count : 0;
      const said = mine ? `${n} ${n === 1 ? 'change' : 'changes'} in ${mine}, your free landscape, in the last ${days} days. On Free you see how many, not which.`
        : 'Changes are for the landscapes, drugs and companies you follow.';
      return { text: said + ` Solo ($49 a month, excl. VAT) follows 5 and shows every change: ${SITE}/pricing`,
        card: { view: 'changes', days, groups: [], free: { count: n, area: mine || '' }, text: said, link: SITE + (mine ? linkFor(mine) : SEARCH_PATH) } };
    }
    const follows = getDb().prepare('SELECT * FROM saved_landscape WHERE user_id=? ORDER BY id').all(user.id);
    if (!follows.length) return { card: { view: 'note', title: 'Nothing followed yet', text: 'Follow a landscape, drug or company on OpenLandscape and its changes show here.', link: SITE + SEARCH_PATH }, text: `You don't follow anything yet. Follow a landscape, drug or company on OpenLandscape (Solo follows 5) and its changes show here: ${SITE}${SEARCH_PATH}` };
    const pick = area ? follows.filter(f => f.query.toLowerCase() === String(area).trim().toLowerCase()) : follows;
    if (!pick.length) return `You don't follow "${area}". Changes show for what you follow: ${follows.map(f => f.query).join(', ')}. Follow it on its page first (Solo follows 5).`;
    let t = '', data = null;
    const groups = [];
    for (const f of pick) {
      const C = Q.changes({ area: f.query, phase_min: f.phase_min, since });
      data = C.data;
      groups.push({ title: drugName(f.query), count: C.count, link: SITE + linkFor(f.query), rows: C.items.slice(0, 40).map(i => ({ label: shortDate(i.date, new Date().getFullYear()), drug: drugName(i.drug), text: i.text, url: i.url || '' })) });
      const rows = C.items.slice(0, 40);
      t += `${t ? '\n\n' : ''}${f.query}: ${C.count} ${C.count === 1 ? 'change' : 'changes'} since ${shortDate(since)}${C.items.length > rows.length ? ` (showing ${rows.length})` : ''}.\n`;
      if (rows.length) {
        t += `| Date | Drug | What changed | Source |\n|---|---|---|---|\n`;
        for (const i of rows) t += `| ${i.label} | ${cell(i.drug)} | ${cell(i.text)} | ${link(i.nct || 'source', i.url)} |\n`;
      }
    }
    const path = pick.length === 1 ? linkFor(pick[0].query) : appPath('');
    return { text: t + footer(data || Q.dataDates(), pick.length === 1 ? pick[0].query : '', path),
      card: { view: 'changes', days, groups, free: null, link: SITE + path, source: creditLine(SITE + path) } };
  }));

  // ---- One card per answer (ChatGPT's "decoupled" pattern): the lookups above return data only; the AI
  // calls show() once at the end with the main result and the other parts. Not a lookup (it counts nothing), but it draws
  // only what this account looked up in the last hour, as that lookup ran, so it cannot reach data around the limits.
  if (cards) {
    const KINDS = ['landscape', 'drug', 'trials', 'catalysts', 'who_runs_trials', 'changes', 'search'];
    const part = z.object({ tool: z.enum(KINDS).describe('The lookup tool you called'), args: z.record(z.string(), z.any()).optional().describe('The arguments you called it with') });
    // What names a lookup: the same tool, about the same thing (case and spacing aside). Other settings come from the lookup.
    const KEY = { landscape: ['area'], drug: ['name'], trials: ['drug', 'area', 'sponsor'], catalysts: ['area'], who_runs_trials: ['area'], changes: ['area'], search: ['query'] };
    const same = (tool, a = {}, b = {}) => KEY[tool].every(k => String(a[k] ?? '').trim().toLowerCase() === String(b[k] ?? '').trim().toLowerCase());
    const lookedUp = (tool, args) => {
      if (!user) return args || {};   // open mode (no account): no limits to keep
      const rows = getDb().prepare("SELECT detail FROM usage WHERE user_id=? AND kind='mcp' AND detail LIKE ? AND at >= datetime('now','-1 hour') ORDER BY id DESC").pluck().all(user.id, tool + ' %');
      for (const d of rows) { try { const a = JSON.parse(d.slice(tool.length + 1)); if (same(tool, a, args)) return a; } catch { /* cut short in the log */ } }
      return null;
    };
    const viewOf = async ({ tool, args }) => {
      const a = lookedUp(tool, args);
      if (!a) return null;
      try { const out = await run[tool](a); return typeof out === 'string' ? { view: 'note', text: out.replace(/\s*https?:\/\/\S+$/, '') } : out.card; } catch { return null; }
    };
    server.registerTool('show', {
      title: 'Show', annotations: READ, ...CARD,
      description: 'Draw one card for your whole answer, after the lookups: the main result open, the other parts as rows the user can open. Pass the same tool and arguments you used, e.g. main {tool:"landscape", args:{area:"amylin", phase_min:2}}, also [{tool:"drug", args:{name:"mazdutide"}}, {tool:"catalysts", args:{area:"obesity", days_ahead:180}}]. At most 4 other parts. Call it once per answer, last. Only draws what you looked up in the last hour; does not use a lookup.',
      inputSchema: { main: part, also: z.array(part).max(4).optional().describe('The other parts of the answer, at most 4, most useful first') },
    }, async ({ main, also = [] }) => {
      const m = await viewOf(main);
      if (!m) return text(`Nothing shown: ${main.tool} was not looked up in the last hour with these arguments. Look it up first, then call show().`);
      const parts = (await Promise.all(also.map(viewOf))).filter(Boolean);
      fitCard(m, parts);
      const missed = also.length - parts.length;
      return answer(`Shown as one card${parts.length ? ` with ${parts.length} more ${parts.length === 1 ? 'part' : 'parts'}` : ''}.${missed ? ` ${missed} left out: not looked up in the last hour.` : ''}`,
        { view: 'show', title: m.title, main: m, parts });
    });
  }

  return server;
}

// Express handler. Stateless: a fresh server per request, which keeps hosting simple.
export async function handleMcp(req, res) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const user = req.params.key ? userFromApiKey(req.params.key) : bearer.startsWith('op_') ? userFromApiKey(bearer) : userFromAccessToken(bearer);
  if (!user && process.env.MCP_OPEN !== '1') {
    // The 401 with resource_metadata is what starts sign-in in Claude, ChatGPT and other apps.
    if (!req.params.key) res.set('WWW-Authenticate', `Bearer ${bearer ? 'error="invalid_token", ' : ''}resource_metadata="${RESOURCE_METADATA_URL}"`);
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: req.params.key ? 'Invalid API key. Create a new one on the dashboard: /app#mcp' : 'Sign in required: connect to this server from your app and approve in the browser, or use an API key from /app#mcp.' }, id: null });
    return;
  }
  const server = buildServer(user, { chatgpt: !!bearer && appOfToken(bearer) === 'chatgpt' });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
