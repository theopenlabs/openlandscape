// Connecting an app over MCP: the /connect page, the setup steps shared with the dashboard, and the Allow page.
import { esc } from '../../web/table.js';
import { readFileSync } from 'node:fs';
import { BRAND, layout, footer } from './shared.js';
import { icon } from '../../web/icons.js';
import { LIMITS } from '../auth.js';

// ---------- Connect your AI (public, spec 16 part 5) ----------
// The same setup box as the dashboard's Connect your AI (aiSetupBox); public, so setup, what it can do and one real answer sit on one page.
// Keys for apps that cannot sign in live only in the dashboard.
export const CAN_DO = [
  ['landscape', 'Every drug in a disease, target or company, with stage and next milestone.', 'Map every amylin drug in Phase 2 or later.'],
  ['catalysts', 'Readouts and regulator decisions due in the next weeks.', 'Which oral GLP-1s read out in the next six months?'],
  ['trials', 'Trials by drug, company, phase, country or date, each linked to its registry record.', 'List Phase 3 obesity trials running in China.'],
  ['drug', 'Everything about one drug: names, company, stage, approvals, dates and trials.', 'Tell me everything about mazdutide.'],
  ['changes', 'What changed this week in the landscapes, drugs and companies you follow.', 'What changed in what I follow this week?'],
  ['search', 'Finds a drug or company under any of its names, codes or brand names.', 'What is HRS9531?'],
  ['who_runs_trials', 'Companies and trial sites ranked by how many active trials they run.', 'Who runs the most lung cancer trials in Europe?'],
];
export function connectPage({ user, origin, demo }) {
  return layout({
    title: `Connect your AI | ${BRAND}`, user, active: 'connect', path: '/connect',
    desc: `Add ${BRAND} to Claude, ChatGPT, Cursor or Gemini CLI once, and ask about any drug, trial or company. Every answer links to its source.`,
    body: `<main class="wrap connectpage ds">
<h1>Ask your AI about any drug, trial or company</h1>
<p class="lede">Add ${BRAND} to the AI app you already use, once. Every answer links to its source.</p>
<div class="connect"><div>
  ${aiSetupBox(origin)}
  <p class="muted small fine">Your app asks you to sign in once. Free, no payment card needed.</p>
  <h2 class="h3">What it can do</h2>
  <p class="muted">Your app picks these by itself. Ask in plain words; these are examples.</p>
  <dl class="rows can">${CAN_DO.map(([t, what, ask]) => `<div><dt><code>${t}</code></dt><dd>${what}<span class="d">“${ask}”</span></dd></div>`).join('')}</dl>
</div>
<div><h2 class="h3">A real answer</h2>${demo}</div>
</div></main>
${footer()}
<script>${MCP_SETUP_SCRIPT}</script>`,
  });
}

// The terminal panel shows a real landscape() result, not a made-up one.
export function demoTerminal(L) {
  const rows = L.programs.slice(0, 8);
  const first = rows.filter(p => p.next_catalyst).sort((a, b) => (a.next_catalyst.date || '').localeCompare(b.next_catalyst.date || ''))[0];
  return `<div class="term" aria-label="Example Claude session, real tool output">
  <div class="h"><i></i><i></i><i></i><span style="margin-left:8px">claude · openlandscape · live data</span></div>
  <div><span class="p">›</span> which oral GLP-1 pills are in phase 3 or later, and who reads out first?</div><br>
  <div class="c">● openlandscape.landscape(area: "oral GLP-1", phase_min: 3)</div>
  <table><tr class="c"><td>drug</td><td>company</td><td>phase</td><td>next</td></tr>
  ${rows.map(p => `<tr><td>${esc(p.drug)}</td><td>${esc(p.company.split(' · ')[0])}</td><td>${esc(p.phase.label)}</td><td>${esc(p.next_catalyst?.label || '—')}</td></tr>`).join('')}
  </table><br>
  <div>${esc(L.summary.split('.')[0])}.${first ? ` The first registry date is <b>${esc(first.drug)}</b> (${esc(first.company)}), ${esc(first.next_catalyst.label)}, <span class="p">${esc(first.next_catalyst.nct || '')}</span>.` : ''}</div><br>
  <div class="ok">✓ ${L.stats.programs} drugs · ${L.stats.trials} trials · sources attached</div>
</div>`;
}

// MCP setup, shared by the public /connect page and the dashboard. URLs carry class "mcpurl" so the dashboard
// can put a newly created key into every step.
const MCP_APPS = [
  ['claude', 'Claude', url => `<p>In the Claude app or on claude.ai: <b>Settings → Connectors → Add custom connector</b>. Name it ${BRAND}, paste the URL, click Add.</p>${copyRow('u-claude', url)}`],
  ['chatgpt', 'ChatGPT', url => `<p>On chatgpt.com (paid plans): <b>Settings → Apps &amp; Connectors → Advanced</b>, turn on <b>Developer mode</b>. Then <b>Create</b>: name it ${BRAND}, paste the URL as the MCP server URL, choose <b>No authentication</b>, and confirm you trust it. In a chat, pick ${BRAND} from the <b>+</b> menu. On Business and Enterprise workspaces an admin may need to allow custom connectors first.</p>${copyRow('u-chatgpt', url)}`],
  ['cursor', 'Cursor', url => `<p><b>Cursor Settings → MCP → Add new MCP server</b>, or add this to <code class="mono small">~/.cursor/mcp.json</code>:</p>${copyRow('u-cursor', `{ "mcpServers": { "openlandscape": { "url": "${url}" } } }`)}`],
  ['code', 'Claude Code', url => `<p>In your terminal:</p>${copyRow('u-code', `claude mcp add --transport http openlandscape ${url}`)}`],
  ['gemini', 'Gemini CLI', url => `<p>Add this to <code class="mono small">~/.gemini/settings.json</code>, restart Gemini CLI and type <code class="mono small">/mcp</code> to check it is connected:</p>${copyRow('u-gemini', `{ "mcpServers": { "openlandscape": { "httpUrl": "${url}" } } }`)}`],
];
function copyRow(id, text) {
  return `<div class="copyrow"><code id="${id}" class="mcpurl">${esc(text)}</code><button class="btn sm" type="button" data-copy="${id}">Copy</button></div>`;
}
export function mcpSetupHTML(url) {
  return `<div class="tabs" role="tablist" id="ctabs">${MCP_APPS.map(([k, n], i) => `<button role="tab" aria-selected="${i === 0}" data-t="${k}">${n}</button>`).join('')}</div>
${MCP_APPS.map(([k, , body], i) => `<div id="t-${k}"${i ? ' hidden' : ''}>${body(url)}</div>`).join('')}
<p class="muted small">Any other app that supports remote MCP servers (Streamable HTTP) works with the same URL.</p>`;
}
// The setup prompt: the setup-openlandscape skill without its header, pointed at this site.
const SETUP_SKILL = readFileSync(new URL('../../client/skills/setup-openlandscape/SKILL.md', import.meta.url), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
export const setupPrompt = origin => `Set up OpenLandscape in this app for me. Follow these instructions:\n\n${SETUP_SKILL.replaceAll('https://openlandscape.app', origin)}`;

// Once OpenLandscape is listed in Claude's and ChatGPT's directories (set these two on the server), the setup box links there too.
const LISTINGS = [['claude', 'Claude', process.env.CLAUDE_CONNECTOR_URL], ['chatgpt', 'ChatGPT', process.env.CHATGPT_APP_URL]].filter(l => l[2]);
const listingsHTML = () => LISTINGS.length ? `<p class="aifoot">Or add it from the app's directory: ${LISTINGS.map(([k, n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${appIcon(k)} ${n} ↗</a>`).join(' · ')}</p>` : '';
// The OpenAI mark is drawn in near-black; inline it in the text colour so it shows in dark mode too.
const CHATGPT_ICON = readFileSync(new URL('../../web/icons/chatgpt.svg', import.meta.url), 'utf8').replace(/<title>.*?<\/title>/, '')
  .replace('fill="#1C1A17"', 'fill="currentColor" aria-hidden="true"').replace('height="24"', 'height="16"').replace('width="24"', 'width="16"');
export const appIcon = k => k === 'chatgpt' ? CHATGPT_ICON : `<img src="/static/icons/${k}.svg" width="16" height="16" alt="">`;
const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`;
// ---------- Connect your AI in the dashboard (screen 5) ----------
// Dead simple: one setup prompt for every app (Claude, ChatGPT, Cursor, Claude Code, Gemini CLI, any MCP app). In a chat app the
// prompt gives the two clicks to make; in a coding app it adds itself. Three numbered steps, then the server URL for doing it by hand.
// `ai`: the connected app's name (then the box says so and offers Disconnect). `lookups`: Free's used lookups (null on Solo).
// `ask`: the first question to try, about their own landscape when they have one.
// The three steps, also on the second onboarding screen (src/pages/start.js).
export const APPS = [['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['cursor', 'Cursor'], ['claude', 'Claude Code'], ['gemini', 'Gemini CLI']];
const step = (n, title, body) => `<li><span class="n">${n}</span><b>${title}</b><div class="sb">${body}</div></li>`;
export const askRowHTML = ask => `<div class="askrow"><span id="first-ask">${esc(ask)}</span><button class="btn sm" type="button" data-copy="first-ask">${COPY_ICON}Copy</button></div>`;
// `compact` (onboarding's narrower box): the apps named in the grey line, not chips.
// `outline`: the copy button is not the page's main button (onboarding's step 2, where "Go to Home" is).
export const aiSteps = (askRow, { compact = false, outline = false } = {}) => `<ol class="aisteps">
    ${step(1, 'Copy the setup prompt', `<button class="btn${outline ? '' : ' primary'}" type="button" data-copy="setup-prompt">${COPY_ICON}Copy setup prompt</button>`)}
    ${step(2, 'Paste it into your AI assistant', compact
      ? `<p class="applist">It sets itself up, or tells you the two clicks to make. Works in ${APPS.map(([, n]) => n).join(', ')} and any other.</p>`
      : `<p>It sets itself up, or tells you the two clicks to make. Works with:</p><div class="appchips">${APPS.map(([k, n]) => `<span>${appIcon(k)}${n}</span>`).join('')}<span class="muted">any other</span></div>`)}
    ${step(3, 'Sign in, click Allow, then ask', askRow)}
  </ol>`;
export const setupPromptPre = origin => `<pre id="setup-prompt" hidden>${esc(setupPrompt(origin))}</pre>`;
export function aiSetupBox(origin, { ai = null, lookups = null, ask = 'Map every amylin drug in Phase 2 or later, with next milestones.' } = {}) {
  const url = `${origin}/mcp`, max = LIMITS.free.mcp_calls;
  const askRow = askRowHTML(ask);
  const known = ai && APPS.find(([, n]) => ai.toLowerCase().includes(n.toLowerCase()));
  const used = lookups == null ? null : Math.min(max, lookups);
  // Two labelled rows at the bottom: the server URL (for adding it by hand) and, on Free, a meter of the free lookups.
  const foot = `<dl class="aifacts">
    <div><dt>Server URL<span>For adding it by hand</span></dt><dd><code id="u-mcp">${esc(url)}</code><button class="btn sm" type="button" data-copy="u-mcp">${COPY_ICON}Copy</button></dd></div>
    ${used == null ? '' : `<div><dt>Free lookups this month<span>A question uses one to five</span></dt><dd><span class="meterbar" role="img" aria-label="${max - used} of ${max} left"><i style="width:${Math.round((max - used) / max * 100)}%"></i></span><b>${max - used} of ${max} left</b><span class="muted small nophone">Solo: 300 a day</span></dd></div>`}
  </dl>`;
  return `<section class="box aibox"><div class="boxhead">${icon('plug')}<h2>Your AI assistant</h2></div>
  <pre id="setup-prompt" hidden>${esc(setupPrompt(origin))}</pre>
  ${ai ? `<div class="aion"><span class="aiapp">${known ? appIcon(known[0]) : icon('plug', 16)}<b>${esc(ai)}</b><span class="muted">is connected</span></span><button class="btn sm" type="button" id="disconnect">Disconnect</button></div>
  <div class="aitry"><b>Try asking</b>${askRow}</div>
  <p class="aifoot">Using another assistant? <button class="linkbtn" type="button" data-copy="setup-prompt">Copy the setup prompt</button> and paste it there. It replaces ${esc(ai)}.</p>`
  : aiSteps(askRow) + listingsHTML()}
  ${foot}
</section>`;
}
// Example questions first, what each kind of question gets in grey. The tool names stay out: the app picks them.
export const askBox = () => `<section class="box asks"><div class="boxhead">${icon('chat')}<h2>What you can ask</h2></div>
  ${CAN_DO.map(([, what, ask]) => `<div class="ask"><b>“${ask}”</b><span>${what}</span></div>`).join('')}</section>`;

// The page an app sends you to when it asks to use your account ("Allow" or "Cancel"), in the sign-in layout (spec 16 part 6).
export function oauthConsentPage({ user, id, client, host, loopback, expired } = {}) {
  return layout({
    title: `Connect an app | ${BRAND}`, noindex: true, user,
    body: `<main class="signin">${expired ? `<h1>This connection request has expired</h1>
<p class="lede">Start again from your app: remove and add ${BRAND}, or connect it again.</p>` : `
<h1>Connect ${esc(client)}</h1>
<p class="lede">${esc(client)} wants to use ${BRAND} as <b>${esc(user.email)}</b>: search drugs, trials and companies, and read landscapes and milestones. It cannot change anything in your account.</p>
<section class="box tryq"><div class="boxhead"><h2>Back in ${esc(client)}, try asking</h2></div>
<ul class="feed efeed"><li><span class="ev">Map every amylin drug in Phase 2 or later</span></li><li><span class="ev">Tell me everything about mazdutide</span></li><li><span class="ev">Which obesity drugs read out in the next six months?</span></li></ul></section>
<p class="muted small">After you click Allow you go back to <b class="mono">${esc(host)}</b>.${loopback ? ' That is an app on this computer, such as Claude Code or another terminal app. Only allow it if you just started connecting from there.' : ''}</p>
<form method="post" action="/oauth/consent" class="pair">
  <input type="hidden" name="r" value="${esc(id)}">
  <button class="btn primary" type="submit" name="allow" value="1">Allow</button>
  <button class="btn" type="submit" name="allow" value="0">Cancel</button>
</form>
<p class="muted small fine">Not ${esc(user.email)}? <a href="/signin?next=${esc(encodeURIComponent('/oauth/consent?r=' + id))}">Use another account</a></p>`}
</main>`,
  });
}

export const MCP_SETUP_SCRIPT = `document.getElementById('ctabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;document.querySelectorAll('#ctabs [data-t]').forEach(x=>{x.setAttribute('aria-selected',x===b);document.getElementById('t-'+x.dataset.t).hidden=x!==b})});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;const was=b.dataset.was||(b.dataset.was=b.innerHTML);try{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent='Copied'}catch(_){b.textContent='Select and copy'}setTimeout(()=>b.innerHTML=was,1600)});
if(location.hash==='#keys'&&document.getElementById('manual'))document.getElementById('manual').open=true;
document.getElementById('disconnect')?.addEventListener('click',async e=>{e.target.disabled=true;await fetch('/api/connection',{method:'DELETE'});location.reload()});`;
