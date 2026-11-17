// Onboarding (screen 5): short screens after a plain sign-up, in the sign-in box's look (480px box, centred).
// 1. "What do you want to track?": a search, and four examples. Both open the in-between screen below, never the app's search.
// 1b. The in-between screen: the name, how many drugs, the top 5, "Make this my free landscape" (→ step 2) and
//     "← Pick something else" (→ step 1). A ready-made landscape or an empty search says so instead.
// 2. "Connect your AI assistant": optional. The same three steps as the Connect your AI page; the one black button is "Go to Home".
import { esc, drugName } from '../../web/table.js';
import { icon } from '../../web/icons.js';
import { heading } from '../suggest.js';
import { BRAND, layout, LOGO } from './shared.js';
import { APP_HOME } from './frame.js';
import { aiSteps, askRowHTML, setupPromptPre, appIcon, APPS, MCP_SETUP_SCRIPT } from './connect.js';

// The onboarding's own address. Not "/start": that is the landing page's search.
export const WELCOME_PATH = '/app/welcome';
// Examples: diseases and targets only (a drug or company opens its own page, and a ready-made landscape is free in full anyway,
// so neither can become the free landscape).
export const STARTER = [['Heart failure', 'Disease'], ["Alzheimer's disease", 'Disease'], ['Psoriasis', 'Disease'], ['KRAS', 'Target']];
export const pickTo = (q, p = 2) => `${WELCOME_PATH}?q=${encodeURIComponent(q)}${+p && +p !== 2 ? `&p=${+p}` : ''}`;
// The plans in two lines, the same everywhere (screen 5, decision 9).
export const FREE_LINE = 'Free: one landscape of your own, in full.';
export const SOLO_LINE = 'Solo: follow up to 5, and see every change as it happens.';
// Get started's tick: a small filled ink circle with a tick.
export const TICK = `<span class="okdot" aria-hidden="true">${icon('check', 12)}</span>`;
const STAGE = ['', 'Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'];
const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "Phase 2 and later", or "every stage" from Phase 1.
const fromStage = p => (+p > 1 ? `${STAGE[p]} and later` : 'every stage');

// `pick`: the in-between screen's search ({ q, p, L, ready } with L the landscape, ready = a ready-made landscape's address).
// `ai`: the connected app's name (an AI assistant connected before or during step 2).
// `from`: the page they signed up on, from a Follow press ({ href, name, raw, hint }; step 12). Every step says "← Back to it",
// "Skip for now" goes back there, and `hint` (a drug's own target) is the first example.
export function startPage({ user, step = 1, pick = null, landscape = null, origin = '', ai = null, from = null }) {
  const home = `${APP_HOME}?started=1`;
  const fq = from ? `from=${encodeURIComponent(from.raw)}` : '';
  const w = u => (fq ? `${u}${u.includes('?') ? '&' : '?'}${fq}` : u);
  const fromLine = from ? `<p class="obfrom"><a href="${esc(from.href)}">← Back to ${esc(from.name)}</a></p>` : '';
  const fromInput = fq ? `<input type="hidden" name="from" value="${esc(from.raw)}">` : '';
  const starter = from?.hint && !STARTER.some(([q]) => q.toLowerCase() === from.hint.toLowerCase()) ? [[from.hint, `Target · ${from.name}’s`], ...STARTER.filter(x => x[1] !== 'Target')] : STARTER;
  const name = landscape ? esc(heading(landscape.query)) : '';
  const ask = landscape && !landscape.kind ? `Which ${heading(landscape.query)} drugs read out in the next six months, and who makes them?` : 'Map every amylin drug in Phase 2 or later, with next milestones.';
  const back = `<p class="obback"><a href="${w(WELCOME_PATH)}">← Pick something else</a></p>`;
  const plans = `<div class="obplans"><p>${TICK}<span>${FREE_LINE}</span></p><p class="muted">${SOLO_LINE}</p></div>`;
  let body;
  if (step === 1 && pick) {
    const { L, ready } = pick, title = esc(heading(pick.q)), s = L.stats;
    // What a landscape is, shown on the first one they see.
    const how = `<div class="obhow"><p>What's a landscape?</p><ul>
    <li>${icon('landscape', 16)}<span>Every drug in active trials for ${title}</span></li>
    <li>${icon('calendar', 16)}<span>Who makes it, its stage and next date</span></li>
    <li>${icon('pulse', 16)}<span>Each change shows on your Home</span></li></ul></div>`;
    const rows = L.programs.slice(0, 5).map(p => `<div><b>${esc(drugName(p.drug))}</b><span>${esc(p.company || '')}</span><span class="st">${STAGE[p.phase?.level] || ''}</span></div>`).join('');
    body = `
  <p class="obstep">Step 1 of 2</p>
  <h1>${title}</h1>
  ${ready ? `<p class="lede">${nOf(s.programs, 'drug', 'drugs')} in ${nOf(s.trials, 'active trial', 'active trials')}, ${fromStage(pick.p)}.</p>
  <div class="obdrugs">${rows}${s.programs > 5 ? `<p class="obmore">and ${s.programs - 5} more</p>` : ''}</div>
  ${how}
  <p class="obfree">Good news: ${title} is already free for everyone, in full. You don't need to use your free landscape on it.</p>
  <div class="obacts"><a class="btn primary" href="${esc(ready)}">Open ${title}</a></div>
  <p class="obback"><a href="${w(WELCOME_PATH)}">Pick a different one to keep as your own</a></p>`
    : !L.programs.length ? `<p class="lede">No drugs in active trials found for ${title}. Try another spelling, or a broader disease.</p>
  <div class="obacts"><a class="btn primary" href="${w(WELCOME_PATH)}">Pick something else</a></div>`
    : `<p class="lede">${nOf(s.programs, 'drug', 'drugs')} in ${nOf(s.trials, 'active trial', 'active trials')}, ${fromStage(pick.p)}.</p>
  <div class="obdrugs">${rows}${s.programs > 5 ? `<p class="obmore">and ${s.programs - 5} more</p>` : ''}</div>
  
  ${how}
  <form method="post" action="${WELCOME_PATH}/keep" class="obkeep"><input type="hidden" name="q" value="${esc(pick.q)}"><input type="hidden" name="p" value="${pick.p}">${fromInput}
    <button class="btn primary" type="submit">Make this my free landscape</button></form>
  ${plans}
  ${back}`}`;
  } else if (step === 1) {
    body = `
  <p class="obstep">Step 1 of 2</p>
  <h1>What do you want to track?</h1>
  <p class="lede">Pick a disease or a target, and you get its landscape: every drug in active trials for it, who makes each one, how far along it is and its next date.</p>
  <form class="obsearch" action="${WELCOME_PATH}" method="get" role="search">
    <label class="sr" for="obq">Disease or target</label>
    <div class="obfield">${icon('search')}<input id="obq" name="q" placeholder="For example heart failure" autocomplete="off" maxlength="120" required autofocus></div>${fromInput}
    <button class="btn primary" type="submit">Show me the drugs</button>
  </form>
  <p class="oblbl">Or start with one of these</p>
  <div class="obtry">${starter.map(([q, kind]) => `<a href="${w(pickTo(q))}"><b>${esc(q)}</b><span>${kind}</span>${icon('chevron', 16)}</a>`).join('')}</div>
  ${plans}
  <p class="obback"><a href="${from ? esc(from.href) : APP_HOME}">Skip for now</a></p>`;
  } else {
    const apps = `<div class="appchips obapps">${APPS.map(([k, n]) => `<span>${appIcon(k)}${n}</span>`).join('')}<span class="muted">any other</span></div>`;
    const go = `<a class="btn primary obgo" href="${home}">Go to Home</a>`;
    body = `
  <p class="obstep">Step 2 of 2</p>
  <h1>Connect your AI assistant</h1>
  ${ai ? `<p class="lede obon">${TICK}<span><b>${esc(ai)}</b> is connected. Ask it about ${name || 'any landscape'}; every answer links to its source.</span></p>
  <p class="oblbl">Try asking</p>${askRowHTML(ask)}
  ${go}
  <p class="obnote">Manage it any time from <b>Connect your AI</b>.</p>`
  : `<p class="lede">Optional. Ask about ${name || 'any landscape'} from the AI assistant you already use. Every answer links to its source.</p>
  ${apps}
  ${setupPromptPre(origin)}
  <div class="obsteps">${aiSteps(askRowHTML(ask), { compact: true, outline: true })}</div>
  ${go}
  <p class="obnote">You can do it later from <b>Connect your AI</b>.</p>`}`;
  }
  // Step 2 watches for the AI assistant's sign-in (it happens in another tab) and shows the connected view when it lands.
  const watch = step === 2 && !ai ? `
(()=>{const t=setInterval(async()=>{if(document.hidden)return;try{const r=await(await fetch('/api/connection')).json();if(r.app){clearInterval(t);location.reload()}}catch{}},4000)})();` : '';
  return layout({
    title: `Get started | ${BRAND}`, user, noindex: true, bare: true,
    body: `<header class="obhead"><a class="logo" href="${APP_HOME}">${LOGO}${BRAND}</a></header>
<main class="onboard"><div class="card">${fromLine}${body}</div></main>
<script>${MCP_SETUP_SCRIPT}${watch}</script>`,
  });
}
