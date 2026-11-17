// The cards inside Claude and ChatGPT (src/cards.js, web/card.js): one card per answer (the lookups draw nothing, show()
// draws the main result and the other parts, only from lookups of the last hour), the card page is complete and
// self-contained, answers carry what the card draws, and no card shows a plan or a price (ChatGPT turns those down).
// Runs on a copy of the local database (accounts get written), so the shared copy is never touched.
import { tempDir } from './tmp.js';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const SHARED = new URL('../data/openpipeline.db', import.meta.url).pathname, MAIN = new URL('../../../../data/openpipeline.db', import.meta.url).pathname;
const src = [process.env.DB_PATH, SHARED, MAIN].find(p => p && existsSync(p));
const log = console.log, ok = (cond, msg) => { log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
if (!src) { log('SKIP  no local database (npm run data)'); process.exit(0); }
process.env.DB_PATH = join(tempDir('ol-cards-'), 'test.db');
copyFileSync(src, process.env.DB_PATH);
delete process.env.RESEND_API_KEY;
delete process.env.AI_CARDS;   // the cards' switch (src/cards.js cardsOn): on unless AI_CARDS=0; checked off at the end

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { buildServer } = await import('../src/mcp.js');
const { cardHtml, withoutNarrowScreens, CARD_URI, CARD_MIME, stageOf, fitCard } = await import('../src/cards.js');
const { getDb } = await import('../src/db.js');
const db = getDb();
db.prepare("INSERT INTO user (email, plan) VALUES ('cards-solo@x.test','solo'), ('cards-free@x.test','free')").run();
const user = e => db.prepare('SELECT * FROM user WHERE email=?').get(e);
async function client(email) {
  const s = buildServer(user(email)), [a, b] = InMemoryTransport.createLinkedPair(), c = new Client({ name: 'test', version: '1' });
  await s.connect(a); await c.connect(b); return c;
}
const solo = await client('cards-solo@x.test'), free = await client('cards-free@x.test');
const noPlans = (sc, what) => ok(!/\$|pricing|Choose Solo|Solo \(|a month/.test(JSON.stringify(sc)), `${what}: the card shows no plan or price`);

// ---- only whoami and show name the card; the card page ----
const tools = (await solo.listTools()).tools, drawn = t => t._meta?.ui?.resourceUri === CARD_URI && t._meta['openai/outputTemplate'] === CARD_URI;
ok(tools.length === 9 && tools.filter(drawn).map(t => t.name).sort().join() === 'show,whoami', 'whoami and show name the card (standard key and ChatGPT alias)');
ok(tools.filter(t => !['show', 'whoami'].includes(t.name)).every(t => !t._meta?.ui && !t._meta?.['openai/outputTemplate']), 'the 7 lookups draw no card of their own');
const res = (await solo.readResource({ uri: CARD_URI })).contents[0];
ok(res.mimeType === CARD_MIME && res._meta?.ui?.csp, 'the card page is served as an MCP App, with no outside domains');
const html = cardHtml();
ok(html.includes('globalThis.McpApp=') && html.includes('const McpApp = globalThis.McpApp') && !/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html), 'the card page carries its helper and script inside it, nothing loaded from outside');
ok(!/@font-face/.test(html), 'no font files (the apps do not load outside fonts)');
const cardJs = (await import('node:fs')).readFileSync(new URL('../web/card.js', import.meta.url), 'utf8');
ok(cardJs.split("requestDisplayMode({ mode: 'fullscreen' })").length === 2 && /async function goBig\(\) \{\n  try \{ const r = await app\.requestDisplayMode\(\{ mode: 'fullscreen' \}\)/.test(cardJs), 'taps stay in the chat: only the "open bigger" icon asks for the bigger view');
ok(/act === 'part'\) \{ const k = 'p:'/.test(cardJs) && /act === 'drug' && mode === 'inline'\) \{ const k = 'd:'/.test(cardJs) && !/act === 'part'\) openPage/.test(cardJs) && !/data-act="full"/.test(cardJs), 'in the chat a tap opens a peek in place and "See all" unfolds there: no page or "back" inside the card');
ok(/const asOf = v =>/.test(cardJs) && !/esc\(v\.source\)|\|\| v\.source/.test(cardJs), 'the card\'s last line is only the date of the data, not the source address');
ok(!/<span class="count">/.test(cardJs.slice(cardJs.indexOf('const SHORT = {'), cardJs.indexOf('const FULL = {')).replace(/welcome\(v\)[\s\S]*?\n  \},/, '')), 'in the chat no bare number in a card\'s head: the top line says what it counts');
ok(!/@media[^{]*max-width/.test(withoutNarrowScreens('a{b:c}@media (max-width:560px){x{y:z}.q{r:s}}d{e:f}')) && withoutNarrowScreens('a{b:c}@media (max-width:560px){x{y:z}}d{e:f}') === 'a{b:c}d{e:f}', "the website's phone rules are left out of the card");
ok(stageOf('Filed (US)').stage === 'Filed' && stageOf('Filed (US)').where === '' && stageOf('Approved (China)').where === 'in China' && stageOf('Approved (China)').level === 5 && stageOf('Phase 3').level === 3, 'stages in the website\'s words, with five dots');

// ---- answers carry the card ----
const who = await free.callTool({ name: 'whoami', arguments: {} });
ok(who.structuredContent?.view === 'welcome' && who.structuredContent.asks.length === 3 && who.structuredContent.lookups.of === 25, 'whoami: the welcome card with three questions and the lookups');
const L = await solo.callTool({ name: 'landscape', arguments: { area: 'amylin', phase_min: 2 } });
const v = L.structuredContent;
ok(v?.view === 'landscape' && v.rows.length === v.total && v.rows.every(r => r.name && r.level >= 1 && r.stage) && /^Source: OpenLandscape/.test(v.source), 'landscape: every row with its stage, and the source line');
ok(L.content[0].text.includes('| Drug |'), 'landscape: the AI still gets its table');
const F = await free.callTool({ name: 'landscape', arguments: { area: 'lung cancer', phase_min: 3 } });
ok(F.structuredContent.rows.length === 10 && F.structuredContent.cut?.of > 10 && F.structuredContent.lookups, 'Free: the top 10, the meter and the lookups left');
noPlans(F.structuredContent, 'Free landscape');
ok(/Solo \(\$49 a month, excl\. VAT\)/.test(F.content[0].text), 'Free: the AI text still names Solo');
const D = await solo.callTool({ name: 'drug', arguments: { name: 'mazdutide' } });
ok(D.structuredContent?.view === 'drug' && D.structuredContent.title === 'Mazdutide' && D.structuredContent.trials.length > 0 && D.structuredContent.link.endsWith('/drugs/mazdutide'), 'drug: the drug card with its trials and page');
const S = await solo.callTool({ name: 'search', arguments: { query: 'mazdutide' } });
ok(!/\(id: /.test(S.content[0].text) && S.structuredContent.view === 'search', 'search: no internal ids in the answer');
for (const [name, args, view] of [['trials', { drug: 'mazdutide' }, 'trials'], ['catalysts', { days_ahead: 180, area: 'obesity' }, 'catalysts'], ['who_runs_trials', { area: 'lung cancer', phase: 3 }, 'who'], ['changes', {}, 'note']]) {
  const r = await solo.callTool({ name, arguments: args });
  ok(r.structuredContent?.view === view, `${name}: the ${view} card`);
}
const C = await free.callTool({ name: 'changes', arguments: {} });
ok(C.structuredContent.view === 'changes' && C.structuredContent.free, 'changes on Free: the count card');
noPlans(C.structuredContent, 'Free changes');

// ---- one card per answer: show() ----
const usedNow = () => db.prepare("SELECT count(*) FROM usage WHERE user_id=? AND kind='mcp'").pluck().get(user('cards-solo@x.test').id);
for (const [name, args] of [['catalysts', { area: 'obesity', days_ahead: 180 }], ['who_runs_trials', { area: 'amylin', phase: 2 }], ['changes', { days: 7 }]]) await solo.callTool({ name, arguments: args });
const before = usedNow();
const big = await solo.callTool({ name: 'show', arguments: { main: { tool: 'landscape', args: { area: 'Amylin ', phase_min: 2 } }, also: [{ tool: 'drug', args: { name: 'mazdutide' } }, { tool: 'catalysts', args: { area: 'obesity', days_ahead: 180 } }, { tool: 'who_runs_trials', args: { area: 'amylin' } }, { tool: 'changes', args: {} }] } });
const bv = big.structuredContent;
ok(bv?.view === 'show' && bv.main.view === 'landscape' && bv.main.rows.length === bv.main.total && bv.parts.map(p => p.view).join() === 'drug,catalysts,who,note', 'the big question: one card, the landscape open and four parts as rows');
ok(usedNow() === before && /^Shown as one card with 4 more parts\.$/.test(big.content[0].text), 'show uses no lookup and tells the AI it is shown');
ok(JSON.stringify(bv).length < 150000, 'the whole card stays under what Claude can draw');
const five = await solo.callTool({ name: 'show', arguments: { main: { tool: 'landscape', args: { area: 'amylin', phase_min: 2 } }, also: Array(5).fill({ tool: 'drug', args: { name: 'mazdutide' } }) } }).catch(e => ({ isError: true, content: [{ text: e.message }] }));
ok(five.isError && !five.structuredContent, 'show takes at most 4 other parts');
const one = await solo.callTool({ name: 'show', arguments: { main: { tool: 'drug', args: { name: 'Mazdutide' } } } });
ok(one.structuredContent?.main.view === 'drug' && one.structuredContent.parts.length === 0, '"Tell me about mazdutide": one card, nothing under it');
const never = await solo.callTool({ name: 'show', arguments: { main: { tool: 'landscape', args: { area: 'obesity' } }, also: [{ tool: 'drug', args: { name: 'tirzepatide' } }] } });
ok(!never.structuredContent && /not looked up in the last hour/.test(never.content[0].text), 'show draws nothing that was not looked up');
const partly = await solo.callTool({ name: 'show', arguments: { main: { tool: 'drug', args: { name: 'mazdutide' } }, also: [{ tool: 'drug', args: { name: 'tirzepatide' } }] } });
ok(partly.structuredContent?.parts.length === 0 && /1 left out/.test(partly.content[0].text), 'a part that was not looked up is left out');
db.prepare("UPDATE usage SET at=datetime('now','-2 hours') WHERE user_id=? AND detail LIKE 'drug %'").run(user('cards-solo@x.test').id);
ok(!(await solo.callTool({ name: 'show', arguments: { main: { tool: 'drug', args: { name: 'mazdutide' } } } })).structuredContent, 'a lookup older than an hour is not drawn');
const huge = { view: 'catalysts', rows: Array.from({ length: 2000 }, (_, i) => ({ label: `${i} Dec`, drug: 'Drug ' + i, what: 'Phase 3 trial completes '.repeat(4) })) }, small = { view: 'drug', title: 'Small', trials: [1, 2, 3] };
fitCard(bv.main, [huge, small]);
ok(JSON.stringify([bv.main, huge, small]).length <= 100000 && huge.rows.length < 2000 && huge.rows.length > 5 && small.trials.length === 3, 'a card too big for the apps: the biggest list is cut until it fits, the rest untouched');
const fv = (await free.callTool({ name: 'show', arguments: { main: { tool: 'landscape', args: { area: 'lung cancer', phase_min: 3 } } } })).structuredContent;
ok(fv?.main.rows.length === 10 && fv.main.cut && fv.lookups, 'Free: show draws the same top 10 and meter as the lookup');
noPlans(fv, 'Free one card');

// ---- limits inside a card ----
db.prepare("INSERT INTO usage (user_id, kind, detail) SELECT id, 'mcp', 'x' FROM user, (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) WHERE email='cards-free@x.test'").run();
for (let i = 0; i < 4; i++) db.prepare("INSERT INTO usage (user_id, kind, detail) SELECT id, 'mcp', 'x' FROM user, (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) WHERE email='cards-free@x.test'").run();
const out = await free.callTool({ name: 'landscape', arguments: { area: 'obesity' } });
ok(out.isError && out.structuredContent?.view === 'limit' && out.structuredContent.meter.used >= 25 && out.structuredContent.meter.of === 25, 'Free past 25 lookups: the meter, as on the website');
noPlans(out.structuredContent, 'Free out of lookups');

// ---- ChatGPT only (16 Nov 2026): no price in the text, no logo on Open, the card address; Claude gets what it got before ----
async function gptClient(email) {
  const s = buildServer(user(email), { chatgpt: true }), [a, b] = InMemoryTransport.createLinkedPair(), c = new Client({ name: 'test', version: '1' });
  await s.connect(a); await c.connect(b); return c;
}
const gptFree = await gptClient('cards-free@x.test'), gptSolo = await gptClient('cards-solo@x.test');
const claudeOut = out.content[0].text, gptOut = (await gptFree.callTool({ name: 'landscape', arguments: { area: 'obesity' } })).content[0].text;
ok(/Solo \(\$49 a month, excl\. VAT\) gives 300 lookups a day: \S+\/pricing/.test(claudeOut), 'Claude: the limit text is as before, with the price');
ok(!/\$|a month/.test(gptOut) && /The Solo plan gives 300 lookups a day\. Plans: \S+\/pricing/.test(gptOut), 'ChatGPT: the same text names the plan and the plans page, no price');
const { noPrice } = await import('../src/mcp.js');
ok(noPrice('The Free plan shows the top 10 here, as on the website. Solo ($49 a month) shows all 167: https://openlandscape.app/pricing') === 'The Free plan shows the top 10 here, as on the website. The Solo plan shows all 167. Plans: https://openlandscape.app/pricing'
  && noPrice('3 changes. Solo ($49 a month) follows 5 and shows every change: https://openlandscape.app/pricing') === '3 changes. The Solo plan follows 5 and shows every change. Plans: https://openlandscape.app/pricing'
  && noPrice("Mazdutide's trials open tomorrow. Solo: https://openlandscape.app/pricing") === "Mazdutide's trials open tomorrow. Plans: https://openlandscape.app/pricing", 'ChatGPT: every price line in the AI text loses its price');
const claudeRes = (await solo.readResource({ uri: CARD_URI })).contents[0], gptRes = (await gptSolo.readResource({ uri: CARD_URI })).contents[0];
ok(!('domain' in claudeRes._meta.ui) && !claudeRes._meta['openai/widgetCSP'] && claudeRes.text === cardHtml(), 'Claude: the card page and its settings are as before (no card address)');
ok(gptRes._meta.ui.domain === 'https://openlandscape.app' && gptRes._meta['openai/widgetCSP'].redirect_domains.join() === 'https://openlandscape.app', 'ChatGPT: the card has its own address and opens the website without a warning');
const logoJson = s => JSON.parse(s.match(/ICONS = (\{.*?\});\n/)[1]).logo16;
ok(/<svg/.test(logoJson(cardHtml())) && logoJson(gptRes.text) === '' && gptRes.text.replace(/ICONS = .*\n/, '') === cardHtml().replace(/ICONS = .*\n/, ''), 'ChatGPT: no logo on the Open button, everything else the same; Claude keeps it');
const { appOfToken } = await import('../src/oauth.js');
const { createHash } = await import('node:crypto'), h = s => createHash('sha256').update(s).digest('hex');
db.prepare("INSERT INTO oauth_client (client_id, info) VALUES ('c-gpt', ?), ('c-claude', ?)").run(JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] }), JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }));
db.prepare("INSERT INTO oauth_token (token_hash, kind, client_id, user_id, expires_at) VALUES (?,'access','c-gpt',1,'2099-01-01'), (?,'access','c-claude',1,'2099-01-01'), (?,'access','https://chatgpt.com/oauth/client.json',1,'2099-01-01')").run(h('t-gpt'), h('t-claude'), h('t-cimd'));
ok(appOfToken('t-gpt') === 'chatgpt' && appOfToken('t-cimd') === 'chatgpt' && appOfToken('t-claude') === '' && appOfToken('nope') === '' && appOfToken('') === '', 'the server knows ChatGPT by the app that signed in (registered or hosted client); Claude and others are not ChatGPT');

// ---- on for everyone (16 Nov 2026), and the off switch: AI_CARDS=0 answers as before cards ----
ok((await (await client('cards-free@x.test')).listTools()).tools.some(t => t.name === 'show') && (await (await gptClient('cards-solo@x.test')).listTools()).tools.some(t => t.name === 'show'), 'cards are on for every account, in Claude and ChatGPT, with nothing set on the server');
process.env.AI_CARDS = '0';
const off = await client('cards-solo@x.test');
const offTools = (await off.listTools()).tools, offL = await off.callTool({ name: 'landscape', arguments: { area: 'amylin', phase_min: 2 } });
ok(offTools.length === 8 && offTools.every(t => !t._meta?.ui) && !offTools.some(t => t.name === 'show'), 'switched off: no show tool, no tool names the card');
ok(!offL.structuredContent && offL.content[0].text.includes('| Drug |') && !(await off.callTool({ name: 'whoami', arguments: {} })).structuredContent, 'switched off: text answers only, as before');
ok(await off.listResources().then(r => r.resources.length === 0, e => e.code === -32601), 'switched off: no card page offered');
delete process.env.AI_CARDS;
