// The emails (spec 17): the Monday email (Solo), the welcome email (everyone, once) and the big-news email (Free).
//   npm run digest                          -> the Monday email, to the people DIGEST_TO allows (see below)
//   npm run digest -- --preview             -> print every Monday email, send nothing
//   npm run digest -- --preview --html DIR  -> also save each one as DIR/<email>.html
// DIGEST_TO, for every email here: unset = send nothing (preview only); "all" = everyone; or a comma list of emails.
// Each email is logged per person (digest_log, digest_item, mail_log), so re-running is always safe.
import './env.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import { getDb } from './db.js';
import * as Q from './query.js';
import { sendMail } from './mail.js';
import { isPaid } from './auth.js';
import { heading } from './suggest.js';
import { ridgeStages } from './images.js';
import { unsubscribePage } from './pages/public.js';
import { esc } from '../web/table.js';
import * as M from './mailhtml.js';
import { STARTER } from './pages/start.js';

const { PUBLIC, BRAND } = M;
const DASH = process.env.DASHBOARD_URL || PUBLIC + '/app';
const SOLO_URL = PUBLIC + '/pricing';
// The Free welcome's words on the Solo plan.
const FREE_ONCE = 'You’re on the Free plan, so this email is the only time you’ll see what changed.';
const SOLO_PITCH = 'With the Solo plan, you see every change as it happens, and we send you a summary every Monday. $49 a month, excl. VAT.';
// Who the personal emails are from, and the reply line: "OpenLandscape Team" is the signature.
const TEAM = `${BRAND} Team`;
const REPLY = 'Something missing or wrong? Reply to this email. We read every message.';
const SIGNED = `<p class="e-ink" style="margin:12px 0 0;font-size:15px;line-height:24px;color:#1C1A17">${TEAM}</p>`;
const day = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

// ISO week label, e.g. "2026-W45"
export function weekOf(d = new Date(Q.today())) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

// One secret per person for every unsubscribe link: /unsubscribe (Monday email, in server.js), /unsubscribe/news
// (big news) and /unsubscribe/all (everything but sign-in links, from the welcome email).
function token(user) {
  let t = user.digest_token;
  if (!t) { t = randomBytes(18).toString('base64url'); getDb().prepare('UPDATE user SET digest_token=? WHERE id=?').run(t, user.id); user.digest_token = t; }
  return t;
}
export const unsubscribeUrl = (user, list = '') => `${PUBLIC}/unsubscribe${list ? '/' + list : ''}?t=${token(user)}`;

// What a person follows: landscapes, drugs and companies (saved_landscape; a drug or company has `kind` and its name in
// `query`, and its changes are found by that name, as Home does). `label`: the name on the grey line ("Obesity",
// "Tirzepatide", "Eli Lilly"); `name`: the same in a sentence ("obesity", "tirzepatide", "Eli Lilly").
function sourcesOf(user) {
  return getDb().prepare('SELECT * FROM saved_landscape WHERE user_id=? ORDER BY id').all(user.id).map(f => ({ id: f.id, area: f.query,
    phase_min: f.phase_min || 1, label: f.kind === 'company' ? f.query : heading(f.query), name: f.kind === 'company' ? f.query : M.inSentence(heading(f.query)) }));
}

// The same change in several places (a company's filing in two landscapes, a drug in a landscape and followed itself)
// is one row that names them all. Home uses the same key (src/pages/app.js).
export const changeKey = i => [i.drug, i.decision_date || i.date, i.text, i.url].join('|');
const comingKey = c => [c.drug, c.date, c.what].join('|');
export function mergeBy(list, key) {
  const m = new Map();
  for (const r of list) { const k = key(r.item), had = m.get(k); if (had) { for (const l of r.labels) if (!had.labels.includes(l)) had.labels.push(l); } else m.set(k, { item: r.item, labels: [...r.labels] }); }
  return [...m.values()];
}
const byDateDesc = (a, b) => (b.item.decision_date || b.item.date).localeCompare(a.item.decision_date || a.item.date);
const ahead = d => (d + '-99').slice(0, 10);   // a month-only date sorts at the end of its month

// Changes since `since` and dates in the next 30 days, merged across sources. `source` stands in for the query module in tests.
function gather(sources, since, { source = Q, days = 30 } = {}) {
  const ch = sources.map(s => ({ s, c: source.changes({ area: s.area, phase_min: s.phase_min, since }) }));
  const changes = mergeBy(ch.flatMap(({ s, c }) => c.items.map(item => ({ item, labels: [s.label] }))), changeKey).sort(byDateDesc);
  const coming = mergeBy(sources.flatMap(s => source.catalysts({ area: s.area, phase_min: Math.max(2, s.phase_min), days_ahead: days, limit: 100 }).catalysts.map(item => ({ item, labels: [s.label] }))), comingKey)
    .sort((a, b) => ahead(a.item.date).localeCompare(ahead(b.item.date)));
  return { changes, coming };
}

// Rows in the email's words. `named`: show where each row comes from (more than one source).
function changeRow({ item: i, labels }, named, year) {
  const w = M.changeWords(i);
  return { date: M.rowDate(i.decision_date || i.date, year), name: M.capFirst(i.drug), what: w.what, url: i.url, grey: [...(named ? [labels.join(', ')] : []), w.src].filter(Boolean) };
}
function comingRow({ item: c, labels }, named, now, year) {
  const w = M.comingWords(c);
  return { date: M.rowDate(c.date, year), soon: c.date.length === 10 && c.date <= day(now, 7), name: M.capFirst(c.drug), what: w.what, url: c.source,
    grey: [...(named ? [labels.join(', ')] : []), w.src].filter(Boolean) };
}
// 5 dates; every FDA and EMA date in the window is always among them.
export function pickComing(coming, n = 5) {
  const reg = coming.filter(r => M.isRegulatorDate(r.item));
  const rest = coming.filter(r => !M.isRegulatorDate(r.item)).slice(0, Math.max(0, n - reg.length));
  return coming.filter(r => reg.includes(r) || rest.includes(r));
}
// Small date corrections (under 30 days) and routine SEC reports are left out, as on Home and landscape pages.
// What the email covers, by name: "for obesity", "for obesity, tirzepatide and Eli Lilly"; more than three: "for your 5 follows".
function scopeWords(sources) {
  const n = sources.map(s => s.name);
  return n.length > 3 ? `for your ${n.length} follows` : `for ${n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n.at(-1) : n[0]}`;
}

// ---------- 1. The Monday email (Solo) ----------
// Window: from three days before the last Monday email this person got (or 7 days back for the first), so a change
// loaded late is not lost; and nothing already sent to them (digest_item) is sent again.
export function windowFor(user) {
  const last = getDb().prepare('SELECT max(sent_at) FROM digest_log WHERE user_id=?').pluck().get(user.id);
  return last ? day(String(last).slice(0, 10), -3) : day(Q.today(), -7);
}
export function buildDigest(user, { source } = {}) {
  const db = getDb(), now = Q.today(), year = now.slice(0, 4);
  const S = sourcesOf(user);
  if (!S.length) return null;
  const since = windowFor(user);
  const g = gather(S, since, { source });
  const sent = new Set(db.prepare('SELECT key FROM digest_item WHERE user_id=?').pluck().all(user.id));
  const fresh = g.changes.filter(r => !sent.has(changeKey(r.item)));
  const named = S.length > 1;   // one follow alone needs no name on each row
  const scope = scopeWords(S);
  const top = [...fresh].sort((a, b) => M.rank(b.item) - M.rank(a.item) || byDateDesc(a, b))[0];
  const n = fresh.length, k = g.coming.length;
  const coming = pickComing(g.coming).map(r => comingRow(r, named, now, year));
  const shown = fresh.slice(0, 8).map(r => changeRow(r, named, year));
  let headline, subline, subject;
  if (top) {
    const w = M.changeWords(top.item);
    headline = `${M.capFirst(top.item.drug)} ${w.what}.`;
    subject = `${headline.slice(0, -1)}${n > 1 ? `, and ${M.nOf(n - 1, 'more change', 'more changes')}` : ''}`;
    subline = `${n > 1 ? `${M.nOf(n - 1, 'more change', 'more changes')} this week` : 'No other changes this week'}${k ? `, and ${M.nOf(k, 'date', 'dates')} in the next 30 days` : ''} ${scope}.`;
  } else {
    // A quiet week is still sent: the subject leads with the nearest regulator date.
    const reg = g.coming.find(r => M.isRegulatorDate(r.item));
    headline = 'Nothing new this week.';
    subject = reg ? `Nothing new this week. ${/FDA|PDUFA/.test(reg.item.what) ? 'FDA' : 'EMA'} decision on ${reg.item.drug} ${reg.item.date.length === 10 ? 'due ' + M.rowDate(reg.item.date, year) : 'expected in ' + M.rowDate(reg.item.date, year)}` : 'Nothing new this week';
    subline = k ? `Here is what is coming ${scope}.` : `Nothing is planned in the next 30 days ${scope}.`;
  }
  const unsub = unsubscribeUrl(user);
  const more = n > 8 ? M.small(`<a class="e-mut" href="${esc(DASH)}" style="color:#77736D;text-decoration:underline">And ${n - 8} more</a>`) : '';
  // One follow opens at its own page; more open Home.
  const [openLabel, openUrl] = S.length === 1 ? [`Open ${S[0].name}`, `${DASH}/l/${S[0].id}?q=${encodeURIComponent(S[0].area)}&p=${S[0].phase_min}`] : [`Open ${BRAND}`, DASH];
  const why = 'Every row links to its source. Trial dates are planned dates set by sponsors.';
  const body = M.logoRow(M.dayLine(now)) + M.h1(headline) + M.sub(subline)
    + (shown.length ? M.h2('What changed') + M.rows(shown) + more : '')
    + (coming.length ? M.h2('Coming up') + M.rows(coming) : '')
    + M.button(openLabel, openUrl)
    + M.footer(why, unsub);
  const text = [M.dayLine(now), '', headline, subline, '',
    ...(shown.length ? ['WHAT CHANGED', M.textRows(shown), ...(n > 8 ? [`And ${n - 8} more: ${DASH}`] : []), ''] : []),
    ...(coming.length ? ['COMING UP', M.textRows(coming), ''] : []),
    `${openLabel}: ${openUrl}`, '', ...M.footerText(why, unsub)].join('\n');
  const keys = fresh.map(r => changeKey(r.item));
  return { to: user.email, subject, html: M.page({ subject, preheader: subline, body }), text, unsubscribeUrl: unsub, changes: n, keys, since };
}

// ---------- 2. The welcome email (everyone, once) ----------
// The landscape a person kept: on Free the one they opened in full (usage 'landscape'), on Solo the first they followed.
// `opened`: when (YYYY-MM-DD).
export function keptLandscape(user) {
  const db = getDb();
  const used = db.prepare("SELECT detail, at FROM usage WHERE user_id=? AND kind='landscape' ORDER BY at, id LIMIT 1").get(user.id);
  const saved = db.prepare('SELECT query, phase_min, created_at FROM saved_landscape WHERE user_id=? ORDER BY created_at, id LIMIT 1').get(user.id);
  const pick = used && (!saved || used.at <= saved.created_at) ? { query: used.detail, opened: used.at } : saved ? { query: saved.query, opened: saved.created_at, phase_min: saved.phase_min } : null;
  if (!pick) return null;
  const same = db.prepare('SELECT phase_min FROM saved_landscape WHERE user_id=? AND lower(query)=lower(?)').get(user.id, pick.query);
  return { query: pick.query, phase_min: pick.phase_min || same?.phase_min || 2, opened: String(pick.opened).slice(0, 10) };
}
// Where "Open <landscape>" goes: a followed or kept landscape at its own page (/l/<id>; a checked one goes on to
// /landscapes/<slug>); otherwise through Search.
function openUrlOf(user, kept) {
  const followed = getDb().prepare('SELECT id FROM saved_landscape WHERE user_id=? AND kind IS NULL AND lower(query)=lower(?)').get(user.id, kept.query);
  return followed ? `${DASH}/l/${followed.id}?q=${encodeURIComponent(kept.query)}&p=${kept.phase_min}` : `${DASH}/search?q=${encodeURIComponent(kept.query)}&p=${kept.phase_min}`;
}
export function buildWelcome(user, { source = Q } = {}) {
  const kept = keptLandscape(user);
  if (!kept) return null;
  const now = Q.today(), year = now.slice(0, 4), name = heading(kept.query), lower = M.inSentence(name);
  const L = source.landscape({ area: kept.query, phase_min: kept.phase_min, limit: 1 });
  const nDrugs = L.stats.programs, nCos = L.stats.companies;
  const stages = ridgeStages(L);
  const g = gather([{ area: kept.query, phase_min: kept.phase_min, label: name }], day(now, -14), { source });
  const first = g.changes.map(r => changeRow(r, false, year));   // the last two weeks, in full
  const coming = pickComing(g.coming).map(r => comingRow(r, false, now, year));
  const paid = isPaid(user);
  const subject = `${name}: ${M.nOf(nDrugs, 'drug', 'drugs')}, and what is coming`;
  const line = `${M.nOf(nDrugs, 'drug', 'drugs')} from ${M.nOf(nCos, 'company', 'companies')}, ${kept.phase_min >= 2 ? `Phase ${kept.phase_min} or later` : 'every stage'}. Your list stays up to date.`;
  const ridgeAlt = `The ${lower} landscape: ${stages.map(s => `${s.count} ${/^Phase/.test(s.name) ? 'in ' + s.name : s.name.toLowerCase()}`).join(', ')}`;
  const band = M.welcomeBand({ headline: `Here’s ${lower}, as of today.`, line, stages,
    ridgeUrl: stages.length ? `${PUBLIC}/img/ridge.gif?a=${encodeURIComponent(kept.query)}&p=${kept.phase_min}` : '', ridgeAlt });
  const open = openUrlOf(user, kept);
  const unsub = unsubscribeUrl(user, 'all');
  const reply = REPLY;
  const body = (first.length ? M.h2('Worth knowing first', 8) + M.rows(first) : '')
    + (coming.length ? M.h2('Coming up', first.length ? 44 : 8) + M.rows(coming) : '')
    // Free does not get the changes or the Monday email, so the Solo sentence is left out there.
    + (paid ? M.para('From now on you see every change as it happens, and we write to you on Mondays with what changed and what is coming.', 44) + M.button(`Open ${lower}`, open)
      // Free: the welcome is the only time Free sees the changes, and it says so plainly. The Solo plan is the
      // one button; the landscape is a plain link under it.
      : (first.length ? M.para(`<b style="font-weight:600">${FREE_ONCE}</b>`, 44) + M.para(esc(SOLO_PITCH), 8) : M.para(esc(SOLO_PITCH), 44))
        + M.button('Choose the Solo plan', SOLO_URL, 24)
        + M.para(`<a class="e-ink" href="${esc(open)}" style="color:#1C1A17;text-decoration:underline">Open ${esc(lower)}</a>`, 20))
    + M.para(esc(reply), 44) + SIGNED
    + M.footer('Every row links to its source. Trial dates are planned dates set by sponsors.', unsub);
  const text = [`Here’s ${lower}, as of today.`, line, '', stages.map(s => `${s.name}: ${s.count}`).join('   '), '',
    ...(first.length ? ['WORTH KNOWING FIRST', M.textRows(first), ''] : []),
    ...(coming.length ? ['COMING UP', M.textRows(coming), ''] : []),
    ...(paid ? ['From now on you see every change as it happens, and we write to you on Mondays with what changed and what is coming.', ''] : [...(first.length ? [FREE_ONCE] : []), SOLO_PITCH, `Choose the Solo plan: ${SOLO_URL}`, '']),
    `Open ${lower}: ${open}`, '', reply, TEAM, '', ...M.footerText('Every row links to its source. Trial dates are planned dates set by sponsors.', unsub)].join('\n');
  return { to: user.email, subject, html: M.page({ subject, preheader: line, body, band }), text, unsubscribeUrl: unsub, ref: kept.query };
}

// ---------- 3. The big-news email (Free) ----------
// Only for an FDA or EMA decision on a drug in the free person's one landscape; at most one a week per person; it names
// the regulator and the landscape, never the drug or the decision. Its own unsubscribe (news_off).
const DECIDED = new Set(['approval', 'rejection', 'opinion']);
const regulatorOf = i => (i.region === 'US' ? 'FDA' : i.region === 'EU' ? 'EMA' : null);
export function newsDue(user, { source = Q } = {}) {
  if (isPaid(user) || user.news_off) return null;
  const kept = keptLandscape(user);
  if (!kept) return null;
  const db = getDb(), now = Q.today();
  const last = db.prepare("SELECT day, ref FROM mail_log WHERE user_id=? AND kind='news' ORDER BY day DESC, id DESC LIMIT 1").get(user.id);
  if (last && last.day > day(now, -7)) return null;   // one a week: the next can go 7 days after the last
  const told = new Set(db.prepare("SELECT ref FROM mail_log WHERE user_id=? AND kind='news'").pluck().all(user.id).flatMap(r => { try { return JSON.parse(r).keys || []; } catch { return []; } }));
  const since = [day(now, -7), kept.opened, last?.day].filter(Boolean).sort().pop();
  const found = source.changes({ area: kept.query, phase_min: kept.phase_min, since }).items
    .filter(i => DECIDED.has(i.kind) && regulatorOf(i) && !told.has(changeKey(i)));
  if (!found.length) return null;
  return { kept, decisions: found, regulator: regulatorOf(found[0]) };
}
export function buildNews(user, due) {
  const now = Q.today(), name = heading(due.kept.query), lower = M.inSentence(name), reg = due.regulator;
  const subject = `An ${reg} decision in ${lower}`;
  const headline = `The ${reg} decided on ${/^[aeiou]/i.test(lower) ? 'an' : 'a'} ${lower} drug.`;
  const sub = 'It happened this week, in the landscape you keep.';
  const para = `Your list is already up to date. Follow ${lower} to see which drug, what was decided, and every change after it.`;
  const unsub = unsubscribeUrl(user, 'news');
  const foot = 'We send this at most once a week, and only when a regulator decides on a drug in your landscape.';
  // Under the button, as on the cut list: the price's VAT note, and their own landscape, which is already up to date.
  const open = openUrlOf(user, due.kept);
  const under = M.small(`Excl. VAT. Or <a class="e-ink" href="${esc(open)}" style="color:#1C1A17;text-decoration:underline">open ${esc(lower)}</a>, your free landscape.`);
  const body = M.logoRow(M.dayLine(now)) + M.h1(headline) + M.sub(sub) + M.para(esc(para)) + M.button('Choose Solo, $49 a month', SOLO_URL, 20) + under + M.footer(foot, unsub);
  const text = [M.dayLine(now), '', headline, sub, '', para, '', `Choose Solo, $49 a month, excl. VAT: ${SOLO_URL}`, `Or open ${lower}, your free landscape: ${open}`, '', ...M.footerText(foot, unsub)].join('\n');
  return { to: user.email, subject, html: M.page({ subject, preheader: sub, body }), text, unsubscribeUrl: unsub,
    ref: JSON.stringify({ landscape: due.kept.query, keys: due.decisions.map(changeKey) }) };
}

// ---------- 4. The upgrade email (Free to Solo, once) ----------
// For someone who already had the Free welcome and then pays for Solo. Someone who pays first gets the Solo welcome instead.
const SOLO_GIVES = ['follow up to 5 landscapes, companies or drugs', 'see every change the day it happens',
  'get an email every Monday with what changed and what is coming'];
export function buildUpgrade(user) {
  const subject = 'You’re on Solo now', thanks = 'Thank you for choosing Solo, and for joining this early.', from = 'From today you can:';
  const unsub = unsubscribeUrl(user, 'all');
  const body = M.logoRow(M.dayLine(Q.today())) + M.h1(subject) + M.para(esc(thanks)) + M.para(esc(from), 20)
    + M.para(SOLO_GIVES.map(g => '•&nbsp; ' + esc(g)).join('<br>'), 8) + M.button(`Open ${BRAND}`, DASH)
    + M.para(esc(REPLY), 32) + SIGNED + M.footer('', unsub);
  const text = [subject, '', thanks, '', from, ...SOLO_GIVES.map(g => `- ${g}`), '', `Open ${BRAND}: ${DASH}`, '', REPLY, '', TEAM, '', ...M.footerText('', unsub)].join('\n');
  return { to: user.email, subject, html: M.page({ subject, preheader: thanks, body }), text, unsubscribeUrl: unsub };
}
// Called after each Solo checkout is recorded (the payment page and Stripe's webhook both call it). Sends only when the
// Free welcome went out before, this is their first Solo payment (not a come-back after cancelling) and they have not
// unsubscribed from everything. The log row goes in before sending, so the two callers cannot both send.
export async function sendUpgrade(userId) {
  const db = getDb(), u = db.prepare('SELECT * FROM user WHERE id=?').get(userId);
  if (!u || !isPaid(u) || (u.digest_off && u.news_off) || !mayEmail(u)) return false;
  const logged = kind => db.prepare('SELECT 1 FROM mail_log WHERE user_id=? AND kind=?').get(u.id, kind);
  if (!logged('welcome') || logged('upgrade')) return false;
  if (db.prepare("SELECT count(*) FROM payment WHERE (user_id=? OR email=lower(?)) AND plan LIKE 'solo%'").pluck().get(u.id, u.email) > 1) return false;
  db.prepare("INSERT INTO mail_log (user_id, kind, day) VALUES (?, 'upgrade', ?)").run(u.id, Q.today());
  try { await sendMail({ ...buildUpgrade(u), kind: 'upgrade' }); }
  catch (e) { db.prepare("DELETE FROM mail_log WHERE user_id=? AND kind='upgrade'").run(u.id); throw e; }
  return true;
}

// ---------- sending ----------
function allowList() {
  const allow = (process.env.DIGEST_TO || '').trim().toLowerCase();
  return { allow, list: allow && allow !== 'all' ? new Set(allow.split(',').map(s => s.trim())) : null };
}
const mayEmail = (u, preview) => { const { allow, list } = allowList(); return !preview && !!allow && (!list || list.has(u.email.toLowerCase())); };
function saveHtml(dir, name, d) { if (!dir) return; mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${name}.html`), d.html); writeFileSync(join(dir, `${name}.txt`), `Subject: ${d.subject}\n\n${d.text}`); }

// The Monday email: Solo only, to everyone who follows something and has not unsubscribed.
export async function runDigest({ preview = false, html = null, source } = {}) {
  const db = getDb(), week = weekOf();
  const users = db.prepare('SELECT * FROM user WHERE coalesce(digest_off,0)=0 ORDER BY id').all().filter(isPaid);
  const out = { week, sent: 0, skipped: 0, previewed: 0 };
  for (const u of users) {
    const may = mayEmail(u, preview);
    if (may && db.prepare('SELECT 1 FROM digest_log WHERE user_id=? AND week=?').get(u.id, week)) { out.skipped++; continue; }
    const d = buildDigest(u, { source });
    if (!d) continue;
    if (!may) { if (preview) { console.log(`--- ${d.to}: ${d.subject}\n${d.text}\n`); saveHtml(html, `monday-${u.email}`, d); out.previewed++; } else out.skipped++; continue; }
    await sendMail({ ...d, kind: 'monday' });
    db.transaction(() => {
      db.prepare('INSERT INTO digest_log (user_id, week, changes, sent_at) VALUES (?,?,?,?)').run(u.id, week, d.changes, Q.today());
      const ins = db.prepare('INSERT OR IGNORE INTO digest_item (user_id, key, week) VALUES (?,?,?)');
      for (const k of d.keys) ins.run(u.id, k, week);
    })();
    out.sent++;
  }
  return out;
}

// ---------- 2b. Hello: everyone, once, the moment they make an account ----------
// Before it, someone who never picked a landscape (an AI app's sign-up, "Skip for now") got no email at all. It says what the
// free account includes and offers onboarding's four examples with their real counts; the landscape email above follows
// when they keep one. Signed like the big-news email: no signature.
export function buildHello(user, { source = Q } = {}) {
  const now = Q.today();
  const ex = STARTER.map(([q, kind]) => ({ q, kind, n: source.landscape({ area: q, phase_min: 2, limit: 1 }).stats.programs, url: `${DASH}/welcome?q=${encodeURIComponent(q)}` }));
  const subject = `Welcome to ${BRAND}`;
  const sub = 'Your free account includes one landscape of your own, in full. Pick a disease or a target, and you get every drug in active trials for it: who makes it, how far along it is and its next date. Free, for good.';
  const ready = `${PUBLIC}/landscapes/obesity`, pick = `${DASH}/welcome`;
  const list = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:12px 0 0">${ex.map((e, i) =>
    `<tr><td class="e-line" style="padding:12px 0;border-top:1px solid #E6E3DE${i === ex.length - 1 ? ';border-bottom:1px solid #E6E3DE' : ''}"><a class="e-ink" href="${esc(e.url)}" style="color:#1C1A17;text-decoration:none;font-size:15px;line-height:22px"><b style="font-weight:600">${esc(e.q)}</b></a><br><span class="e-mut" style="font-size:13px;line-height:20px;color:#77736D">${e.kind} · ${M.nOf(e.n, 'drug', 'drugs')} in Phase 2 or later</span></td></tr>`).join('')}</table>`;
  const unsub = unsubscribeUrl(user, 'all');
  const body = M.logoRow(M.dayLine(now)) + M.h1(`Welcome to ${BRAND}.`) + M.sub(sub)
    + M.h2('Or start with one of these', 36) + list
    + M.button('Pick your free landscape', pick, 32)
    + M.small(`The ready-made landscapes, like <a class="e-ink" href="${esc(ready)}" style="color:#1C1A17;text-decoration:underline">obesity</a>, are free to read already.`)
    + M.footer('', unsub);
  const text = [M.dayLine(now), '', `Welcome to ${BRAND}.`, sub, '', 'OR START WITH ONE OF THESE',
    ...ex.map(e => `${e.q}  ${e.kind} · ${M.nOf(e.n, 'drug', 'drugs')} in Phase 2 or later\n        ${e.url}`), '',
    `Pick your free landscape: ${pick}`, `The ready-made landscapes, like obesity, are free to read already: ${ready}`, '', ...M.footerText('', unsub)].join('\n');
  return { to: user.email, subject, html: M.page({ subject, preheader: sub, body }), text, unsubscribeUrl: unsub, ref: '' };
}
// Send it once. The log row goes in first, so the sign-up and the hourly timer never both send it; a failed send removes it.
export async function sendHello(user, { source } = {}) {
  if (!mayEmail(user)) return false;
  const db = getDb();
  if (db.prepare("SELECT 1 FROM mail_log WHERE user_id=? AND kind='hello'").get(user.id)) return false;
  const id = db.prepare("INSERT INTO mail_log (user_id, kind, day) VALUES (?, 'hello', ?)").run(user.id, Q.today()).lastInsertRowid;
  try { await sendMail({ ...buildHello(user, { source }), kind: 'hello' }); return true; }
  catch (e) { db.prepare('DELETE FROM mail_log WHERE id=?').run(id); throw e; }
}
// The timer's catch-up: accounts made in the last 2 days (so turning this on never mails old accounts), at least 10 minutes old.
export async function runHello({ source } = {}) {
  const out = { sent: 0 };
  const users = getDb().prepare("SELECT * FROM user u WHERE created_at >= datetime('now','-2 days') AND created_at <= datetime('now','-10 minutes') AND coalesce(digest_off,0)=0 AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.user_id=u.id AND m.kind='hello') ORDER BY id").all();
  for (const u of users) if (await sendHello(u, { source }).catch(e => (console.error('hello', e.message), false))) out.sent++;
  return out;
}

// Welcome: once per person, for a landscape opened in the last 2 days (so turning this on never mails old accounts).
export async function runWelcome({ preview = false, html = null, source } = {}) {
  const db = getDb(), out = { sent: 0, previewed: 0 };
  const users = db.prepare("SELECT * FROM user u WHERE NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.user_id=u.id AND m.kind='welcome') ORDER BY id").all();
  for (const u of users) {
    const kept = keptLandscape(u);
    if (!kept || kept.opened < day(Q.today(), -2) || !mayEmail(u, preview) && !preview) continue;
    const d = buildWelcome(u, { source });
    if (!d) continue;
    if (preview) { console.log(`--- ${d.to}: ${d.subject}\n${d.text}\n`); saveHtml(html, `welcome-${u.email}`, d); out.previewed++; continue; }
    await sendMail({ ...d, kind: 'welcome' });
    db.prepare("INSERT INTO mail_log (user_id, kind, day, ref) VALUES (?, 'welcome', ?, ?)").run(u.id, Q.today(), d.ref);
    out.sent++;
  }
  return out;
}

// Big news: Free only, at most one a week per person.
export async function runNews({ preview = false, html = null, source } = {}) {
  const db = getDb(), out = { sent: 0, previewed: 0 };
  for (const u of db.prepare("SELECT * FROM user WHERE coalesce(news_off,0)=0 ORDER BY id").all()) {
    if (!preview && !mayEmail(u, preview)) continue;
    const due = newsDue(u, { source });
    if (!due) continue;
    const d = buildNews(u, due);
    if (preview) { console.log(`--- ${d.to}: ${d.subject}\n${d.text}\n`); saveHtml(html, `news-${u.email}`, d); out.previewed++; continue; }
    await sendMail({ ...d, kind: 'news' });
    db.prepare("INSERT INTO mail_log (user_id, kind, day, ref) VALUES (?, 'news', ?, ?)").run(u.id, Q.today(), d.ref);
    out.sent++;
  }
  return out;
}

// The hourly timer in server.js: welcome and big news whenever they are due; the Monday email on Mondays from 12:00 UTC.
// Hello goes out at sign-up (src/server.js); the timer only catches one that did not send.
export async function runMail(now = new Date()) {
  const out = { hello: await runHello(), welcome: await runWelcome(), news: await runNews() };
  if (now.getUTCDay() === 1 && now.getUTCHours() >= 12) out.monday = await runDigest();
  return out;
}

// ---------- unsubscribe: the Monday email (/unsubscribe), big news (/unsubscribe/news), or everything (/unsubscribe/all) ----------
// The page asks first and its button does it (src/pages/public.js unsubscribePage); mail apps' one-click button posts with
// no page field and gets "ok". After it is done, the page's second button (undo) turns the same emails back on.
const LISTS = { '': 'digest_off', news: 'news_off', all: 'digest_off, news_off' };
export function mailRouter() {
  const r = Router();
  const known = t => !!t && !!getDb().prepare('SELECT 1 FROM user WHERE digest_token=?').get(String(t));
  const set = (list, t, v) => !!t && getDb().prepare(`UPDATE user SET ${LISTS[list].split(', ').map(c => `${c}=${v}`).join(', ')} WHERE digest_token=?`).run(String(t)).changes > 0;
  for (const list of Object.keys(LISTS)) {
    const path = `/unsubscribe${list ? '/' + list : ''}`;
    r.get(path, (req, res) => res.send(unsubscribePage({ list, token: String(req.query.t || ''), state: known(req.query.t) ? 'ask' : 'bad' })));
    r.post(path, (req, res) => {
      const undo = req.body?.undo === '1', ok = set(list, req.query.t, undo ? 0 : 1);
      if (req.body?.page !== '1') return res.send('ok');   // mail apps' one-click button
      res.send(unsubscribePage({ list, token: String(req.query.t || ''), state: !ok ? 'bad' : undo ? 'back' : 'done' }));
    });
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv, i = a.indexOf('--html'), html = i > 0 ? a[i + 1] : null;
  console.log(JSON.stringify(await runDigest({ preview: a.includes('--preview'), html })));
}
