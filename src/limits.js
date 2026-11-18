// How much data can leave OpenLandscape (since 15 Nov 2026). The aim is
// not to make copying impossible (a paying customer can always copy what they see) but slow and visible; the Terms are the
// backstop. Three parts:
// 1. Different drugs an account sees, everywhere (website lists, followed pages, drug/company/target pages, CSV, the AI):
//    Solo 6,000 in 30 days and at most 2,000 new a day; Free 500 in 30 days. A drug seen in the last 30 days is free again.
//    Past it, lists show their top 10 (Free: none) and downloads are off. Crossing 1,500 new in a day or 4,000 in 30 days
//    sends us an email the same day.
// 2. Public pages opened signed out: 60 an hour and 200 a day per computer, then "sign in free to continue". Google and Bing,
//    checked by their address, are let through; so are OpenAI's, Perplexity's and Anthropic's crawlers whose address is in
//    their company's published list, up to 2,000 pages an hour each.
// 3. New accounts: 5 a day per computer; "name+tag@" and Gmail's dots count as one address; throwaway domains are refused.
import { isIPv6, BlockList } from 'node:net';
import { reverse, lookup } from 'node:dns/promises';
import { getDb } from './db.js';
import { isPaid, logUsage, usageCount, dayStart } from './auth.js';
import { sendAdminMail } from './mail.js';

const fmt = n => n.toLocaleString('en-US');
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// ---------- 1. different drugs an account sees ----------
export const DRUGS = { paid: { month: 6000, day: 2000 }, free: { month: 500, day: 500 } };
export const ALERT = { day: 1500, month: 4000 };   // an email to us (CONTACT_EMAIL) the day an account crosses either
export const TOP_WHEN_OVER = 10;                   // rows a paid list still shows past the allowance (Free: none)
export const allowanceOf = user => (isPaid(user) ? DRUGS.paid : DRUGS.free);
// "Month" is the last 30 days, today included; "day" is today (UTC). Counted from the day each drug was first seen.
export function drugsUsed(userId) {
  const db = getDb();
  return {
    month: db.prepare('SELECT count(*) FROM drug_seen WHERE user_id=? AND first_day >= ?').pluck().get(userId, daysAgo(29)),
    day: db.prepare('SELECT count(*) FROM drug_seen WHERE user_id=? AND first_day = ?').pluck().get(userId, dayStart()),
  };
}
// What past the allowance means, said calmly (no "UTC", no bare links, not red): `bold` the fact, `rest`
// what still works, `act` the one way on ('talk': Write to us; 'solo': Choose Solo), `when` when it opens again.
// The website draws it as a meter: `label`, `used` of `of`, a bar, and past the allowance one
// sentence `say` with the button. Past it the bar is full: what is left is too little for what was asked (web/table.js limitBox). The AI and CSV get `bold` and `rest` as plain text (`plain`).
function overNote(user, used, add, cap) {
  const after = "Anything you've already opened works as usual.";
  if (!isPaid(user)) return { kind: 'over', when: 'free', act: 'solo', label: 'Free drugs this month', used: cap.month, of: cap.month,
    say: 'Solo shows every list in full.', bold: `You've seen ${fmt(cap.month)} drugs this month on Free.`, rest: `${after} Solo shows every list in full.` };
  if (used.month + add <= cap.month) return { kind: 'over', when: 'tomorrow', act: 'talk', label: 'New drugs today', used: cap.day, of: cap.day,
    say: `New lists show their top ${TOP_WHEN_OVER} until tomorrow.`, bold: `${fmt(cap.day)} new drugs today.`, rest: `New lists show their top ${TOP_WHEN_OVER} and downloads pause until tomorrow. ${after}` };
  return { kind: 'over', when: 'later', act: 'talk', label: 'Drugs this month', used: cap.month, of: cap.month,
    say: `New lists show their top ${TOP_WHEN_OVER}. Room frees up each day.`, bold: `${fmt(cap.month)} drugs this month.`, rest: `New lists show their top ${TOP_WHEN_OVER} and downloads pause; room frees up each day. ${after}` };
}
function warnNote(user, now, cap) {
  const free = isPaid(user) ? '' : 'Free ';
  if (now.month >= 0.8 * cap.month) return { kind: 'warn', label: `${free}${free ? 'drugs' : 'Drugs'} this month`, used: now.month, of: cap.month, say: '', bold: `${fmt(now.month)} of ${fmt(cap.month)} drugs used this month.`, rest: '' };
  if (isPaid(user) && now.day >= 0.8 * cap.day) return { kind: 'warn', label: 'New drugs today', used: now.day, of: cap.day, say: '', bold: `${fmt(now.day)} of ${fmt(cap.day)} new drugs used today.`, rest: '' };
  return null;
}
const site = () => (process.env.PUBLIC_URL || 'https://openlandscape.app').replace(/\/$/, '');
export const plain = n => (!n ? '' : `${n.bold}${n.rest ? ' ' + n.rest : ''}${n.act === 'talk' ? ` Need more? Write to us: ${site()}/talk` : n.act === 'solo' ? ` Solo: ${site()}/pricing` : ''}`);
function alertUs(user, before, now) {
  const crossed = (before.day < ALERT.day && now.day >= ALERT.day) || (before.month < ALERT.month && now.month >= ALERT.month);
  if (!crossed || usageCount(user.id, 'drugs_alert', dayStart())) return;
  logUsage(user.id, 'drugs_alert', `${now.day} today, ${now.month} in 30 days`);
  sendAdminMail({
    subject: `${user.email} has seen ${fmt(now.day)} new drugs today`,
    text: [`${user.email} (${user.plan}) has seen ${fmt(now.day)} new drugs today and ${fmt(now.month)} different drugs in the last 30 days.`,
      `The most is ${fmt(allowanceOf(user).day)} new a day and ${fmt(allowanceOf(user).month)} in 30 days.`, '',
      'A real user rarely gets here. If it looks like copying, the Terms let us close the account. What they opened is in the usage table.'].join('\n'),
  }).catch(e => console.error('drugs alert', e.message));
}
// Before showing `ids` (program ids) to `user`: { ok, note, msg, warn }. ok: show them (they are now counted), `note` a warning
// near the allowance or null; not ok: past the allowance, nothing is counted, `note` says why. `msg`/`warn`: the same as plain
// text. Drugs seen in the last 30 days cost nothing. No user (open AI mode): ok.
export function useDrugs(user, ids) {
  if (!user) return { ok: true, note: null, warn: '' };
  ids = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!ids.length) return { ok: true, note: null, warn: '' };
  const db = getDb(), since = daysAgo(29), today = dayStart(), cap = allowanceOf(user);
  const seen = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    db.prepare(`SELECT program_id FROM drug_seen WHERE user_id=? AND first_day >= ? AND program_id IN (${part.map(() => '?').join(',')})`).pluck().all(user.id, since, ...part).forEach(id => seen.add(id));
  }
  const add = ids.filter(id => !seen.has(id));
  const used = drugsUsed(user.id);
  if (add.length && (used.month + add.length > cap.month || used.day + add.length > cap.day)) {
    if (!usageCount(user.id, 'drugs_stopped', today)) logUsage(user.id, 'drugs_stopped', `${add.length} new`);
    const note = overNote(user, used, add.length, cap);
    return { ok: false, note, msg: plain(note) };
  }
  if (add.length) {
    const put = db.prepare('INSERT INTO drug_seen (user_id, program_id, first_day) VALUES (?,?,?) ON CONFLICT(user_id, program_id) DO UPDATE SET first_day=excluded.first_day');
    db.transaction(() => add.forEach(id => put.run(user.id, id, today)))();
  }
  const now = { month: used.month + add.length, day: used.day + add.length };
  alertUs(user, used, now);
  const note = warnNote(user, now, cap);
  return { ok: true, note, warn: plain(note) };
}

// ---------- 2. public pages, signed out ----------
export const PAGES = { hour: 60, day: 200 };
// One computer: an IPv4 address, or the /64 block of an IPv6 address (one home or office gets a whole block).
export function ipKey(ip) {
  ip = String(ip || '').replace(/^::ffff:(?=\d+\.)/, '');
  if (!isIPv6(ip)) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = ip.includes('::') && tail ? tail.split(':') : [];
  const all = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return all.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}
// Google and Bing: the user agent says so and the address checks out both ways (reverse, then forward DNS), as they advise.
const BOT_UA = /googlebot|google-inspectiontool|googleother|adsbot-google|bingbot|msnbot|bingpreview/i;
const BOT_HOST = /\.(googlebot\.com|google\.com|search\.msn\.com)$/i;
const botSeen = new Map();   // ip -> { ok, at }
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
export async function isSearchBot(ua, ip) {
  if (!BOT_UA.test(ua || '')) return false;
  ip = String(ip || '').replace(/^::ffff:(?=\d+\.)/, '');
  const c = botSeen.get(ip);
  if (c && Date.now() - c.at < 864e5) return c.ok;
  let ok = false;
  try {
    for (const name of await within(reverse(ip), 2000)) {
      if (!BOT_HOST.test(name)) continue;
      if ((await within(lookup(name, { all: true }), 2000)).some(a => a.address === ip)) { ok = true; break; }
    }
  } catch { ok = false; }
  if (botSeen.size > 10000) botSeen.clear();
  botSeen.set(ip, { ok, at: Date.now() });
  return ok;
}
// AI crawlers (18 Nov 2026: verified ones only). OpenAI's, Perplexity's and Anthropic's crawlers pass the page limit
// when their address is in the list their company publishes; each crawler (by name) at most AI_PAGES_AN_HOUR, then the
// normal limit applies. A name we cannot check against a list keeps the normal limit. Lists are fetched when first needed
// and again after a day; if a fetch fails the last list is kept (none yet: not verified).
export const AI_PAGES_AN_HOUR = 2000;
const AI_BOTS = [
  { ua: /\b(GPTBot|OAI-SearchBot|ChatGPT-User)\b/i, lists: ['https://openai.com/gptbot.json', 'https://openai.com/searchbot.json', 'https://openai.com/chatgpt-user.json'] },
  { ua: /\b(PerplexityBot|Perplexity-User)\b/i, lists: ['https://www.perplexity.com/perplexitybot.json', 'https://www.perplexity.com/perplexity-user.json'] },
  { ua: /\b(ClaudeBot|Claude-User|Claude-SearchBot)\b/i, lists: ['https://claude.com/crawling/bots.json'] },
];
const aiLists = new Map();   // list address -> { at, block: BlockList, loading }
// A published list ({ prefixes: [{ ipv4Prefix } | { ipv6Prefix }] }) as a BlockList.
export function aiList(url, json, at = Date.now()) {
  const block = new BlockList();
  for (const p of json?.prefixes || []) {
    const [cidr, type] = p.ipv4Prefix ? [p.ipv4Prefix, 'ipv4'] : p.ipv6Prefix ? [p.ipv6Prefix, 'ipv6'] : [];
    if (!cidr) continue;
    const [addr, bits] = cidr.split('/');
    try { block.addSubnet(addr, +bits, type); } catch { /* a malformed line is skipped */ }
  }
  aiLists.set(url, { at, block });
  return block;
}
async function listFor(url) {
  let c = aiLists.get(url);
  if (!c || (Date.now() - c.at >= 864e5 && !c.loading)) {
    const loading = within(fetch(url, { headers: { 'user-agent': 'OpenLandscape crawler check' } }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))), 5000)
      .then(j => aiList(url, j))
      .catch(e => { console.error('crawler list', url, e.message); const old = aiLists.get(url); old.at = Date.now() - 864e5 + 3600e3; old.loading = null; return old.block; });
    c = { at: c?.at || 0, block: c?.block || null, loading };
    aiLists.set(url, c);
  }
  return c.block || c.loading;   // a stale list answers at once while the new one loads
}
const aiHourly = new Map();   // crawler name -> { hr, n }
// True when `ua` names an AI crawler, `ip` is in its company's list, and the crawler is under AI_PAGES_AN_HOUR (the page is counted).
export async function isAiCrawler(ua, ip, now = new Date()) {
  const bot = AI_BOTS.find(b => b.ua.test(ua || '')); if (!bot) return false;
  ip = String(ip || '').replace(/^::ffff:(?=\d+\.)/, '');
  const type = isIPv6(ip) ? 'ipv6' : 'ipv4';
  const blocks = await Promise.all(bot.lists.map(listFor));
  if (!blocks.some(b => b?.check(ip, type))) return false;
  const name = (ua.match(bot.ua)[1] || '').toLowerCase(), hr = now.toISOString().slice(0, 13);
  let h = aiHourly.get(name);
  if (!h || h.hr !== hr) { h = { hr, n: 0 }; aiHourly.set(name, h); }
  if (h.n >= AI_PAGES_AN_HOUR) return false;
  h.n++;
  return true;
}
const hourly = new Map();   // computer -> { hr, n }: the hour's count in memory, the day's in visitor_day
// One public page opened signed out from `ip`: true if it may open (and is counted), false past the limit. `agent`: the program
// name the computer gave, kept for the bot watch (visitor_day.agent; rows are deleted after 30 days, src/visits.js).
export function countPage(ip, now = new Date(), agent = '') {
  const key = ipKey(ip), hr = now.toISOString().slice(0, 13), day = now.toISOString().slice(0, 10), db = getDb();
  let h = hourly.get(key);
  if (!h || h.hr !== hr) {
    if (hourly.size > 50000) for (const [k, v] of hourly) if (v.hr !== hr) hourly.delete(k);
    h = { hr, n: 0 }; hourly.set(key, h);
  }
  const today = db.prepare('SELECT pages FROM visitor_day WHERE day=? AND ip=?').pluck().get(day, key) || 0;
  if (h.n >= PAGES.hour || today >= PAGES.day) {
    db.prepare('INSERT INTO visitor_day (day, ip, stopped, agent) VALUES (?,?,1,?) ON CONFLICT(day, ip) DO UPDATE SET stopped=stopped+1, agent=excluded.agent').run(day, key, String(agent || '').slice(0, 200));
    return false;
  }
  h.n++;
  db.prepare('INSERT INTO visitor_day (day, ip, pages, agent) VALUES (?,?,1,?) ON CONFLICT(day, ip) DO UPDATE SET pages=pages+1, agent=excluded.agent').run(day, key, String(agent || '').slice(0, 200));
  return true;
}

// ---------- 3. new accounts ----------
export const NEW_ACCOUNTS_A_DAY = 5;
// Common throwaway-address services; more can be added here as they show up.
const THROWAWAY = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com', 'grr.la',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempmailo.com', 'tempr.email',
  'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'yopmail.fr', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc',
  'mailnesia.com', 'trashmail.com', 'trashmail.de', 'mintemail.com', 'fakeinbox.com', 'spamgourmet.com', 'mohmal.com', 'emailondeck.com',
  'mailcatch.com', 'moakt.com', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'burnermail.io', 'inboxkitten.com', 'mail.tm', 'mail.gw',
  'dropmail.me', 'emailfake.com', 'fakemail.net', 'mytemp.email', 'spam4.me', 'anonaddy.me', 'discard.email', 'mailpoof.com',
  'linshiyouxiang.net', 'byom.de', 'trbvm.com', 'cs.email', 'luxusmail.org', 'mailsac.com', 'harakirimail.com', 'tempinbox.com']);
// The address an inbox really is: without "+tag", and for Gmail without dots (and googlemail.com is gmail.com).
export function emailKey(email) {
  let [local = '', dom = ''] = String(email).toLowerCase().trim().split('@');
  local = local.split('+')[0];
  if (dom === 'googlemail.com') dom = 'gmail.com';
  if (dom === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${dom}`;
}
// Why `email` may not become a new account from `ip` ('' when it may, or when the account exists already):
// 'throwaway', 'variant' (another form of an existing account's address) or 'manyaccounts' (5 new today from this computer).
export function signupProblem(email, ip) {
  const db = getDb();
  email = String(email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || db.prepare('SELECT 1 FROM user WHERE email=?').get(email)) return '';
  const dom = email.split('@')[1] || '';
  if (THROWAWAY.has(dom)) return 'throwaway';
  // The domain is typed by the visitor: % and _ in it are matched as themselves, so a@%.% cannot match every account.
  const key = emailKey(email), doms = dom === 'gmail.com' || dom === 'googlemail.com' ? ['gmail.com', 'googlemail.com'] : [dom];
  if (doms.some(d => db.prepare("SELECT email FROM user WHERE email LIKE ? ESCAPE '\\'").pluck().all(`%@${d.replace(/[\\%_]/g, '\\$&')}`).some(e => emailKey(e) === key))) return 'variant';
  if (ip && db.prepare("SELECT count(*) FROM user WHERE signup_ip=? AND created_at >= datetime('now','-1 day')").pluck().get(ipKey(ip)) >= NEW_ACCOUNTS_A_DAY) return 'manyaccounts';
  return '';
}
export const markSignup = (userId, ip) => getDb().prepare('UPDATE user SET signup_ip=? WHERE id=? AND signup_ip IS NULL').run(ipKey(ip), userId);
