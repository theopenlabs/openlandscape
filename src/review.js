// Review page (/admin/review, inside the admin; src/admin.js draws the frame): regulator news held for a person before it
// reaches the feed. Each item comes with a suggestion and its reason in plain words (suggest below: simple rules, no AI),
// grouped Looks new / Your call / Looks like old news. Publish / Dismiss, a short history with Undo. Admin only.
import { publishReviewed } from './ingest/decisions.js';
import { applyVerdict, DROP } from './ingest/verdicts.js';
import { esc } from '../web/table.js';
import { icon } from '../web/icons.js';

const parse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const canPublish = r => r.type === 'decision' && !!parse(r.reasons).publish?.program?.program_id;
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Open items, split for the page. ready: decisions naming a tracked drug (rule-passing first, then newest filing first).
// other: decisions that cannot be published (no tracked drug named). study: possible same-trial pairs.
// verdict: drug rows a reader doubted (src/ingest/verdicts.js), rows it would change first, then "looks right".
export function openItems(db) {
  const rows = db.prepare("SELECT * FROM match_candidate WHERE status='open' ORDER BY id DESC").all();
  const date = r => parse(r.reasons).date || '';
  const ready = rows.filter(canPublish).sort((a, b) => (b.score >= 0.9) - (a.score >= 0.9) || date(b).localeCompare(date(a)));
  const verdict = rows.filter(r => r.type === 'verdict').sort((a, b) => (parse(b.reasons).verdict !== 'right') - (parse(a.reasons).verdict !== 'right') || b.score - a.score);
  return { ready, other: rows.filter(r => r.type === 'decision' && !canPublish(r)), study: rows.filter(r => r.type === 'study'), verdict };
}
// Rows carrying a high-confidence flag (owner | stage | backbone): shown for information, fixed in the seed files or by an approval source.
export function flaggedRows(db) {
  return db.prepare('SELECT id, name, company, flag FROM program WHERE flag IS NOT NULL ORDER BY flag, name').all();
}

// The last n items a person published or dismissed (and what happened).
export function history(db, n = 30) {
  return db.prepare("SELECT * FROM match_candidate WHERE status IN ('accepted','rejected') ORDER BY coalesce(decided_at, created_at) DESC, id DESC LIMIT ?").all(n);
}

// Each returns a short message for the page.
export function publishItem(db, id, by) {
  const r = db.prepare("SELECT * FROM match_candidate WHERE id=? AND status='open'").get(id);
  if (!r) return 'Already handled.';
  if (!canPublish(r)) return 'This item names no drug we track, so it cannot be published.';
  return db.transaction(() => {
    const out = publishReviewed(parse(r.reasons).publish, db);
    const note = out.published ? null : out.why;
    db.prepare("UPDATE match_candidate SET status='accepted', decided_by=?, decided_at=?, change_id=?, decided_note=? WHERE id=?").run(by, now(), out.change_id || null, note, r.id);
    return out.published ? 'Published: it is in the feed and on the drug page now.' : `Nothing added: ${note}.`;
  })();
}
export function dismissItem(db, id, by) {
  const r = db.prepare("SELECT type FROM match_candidate WHERE id=? AND status='open'").get(id);
  const n = db.prepare("UPDATE match_candidate SET status='rejected', decided_by=?, decided_at=?, decided_note=NULL WHERE id=? AND status='open'").run(by, now(), id).changes;
  return n ? (r?.type === 'verdict' ? 'Kept. The row stays as it is and will not be asked about again.' : 'Dismissed. Nothing was published.') : 'Already handled.';
}
// A person agrees with a reader's doubt: the verdict is applied now (drop, merge or flag) and again on every reload.
export function applyItem(db, id, by) {
  const r = db.prepare("SELECT * FROM match_candidate WHERE id=? AND status='open' AND type='verdict'").get(id);
  if (!r) return 'Already handled.';
  const o = parse(r.reasons), p = db.prepare('SELECT id, name, company, aliases, curated FROM program WHERE id=?').get(r.left_id);
  if (!p) return 'That row is no longer in the database; nothing to do.';
  if (p.curated) return 'This is a hand-checked row: change it in the seed files, not here.';
  return db.transaction(() => {
    p.trials = new Set(db.prepare('SELECT nct FROM trial_program WHERE program_id=?').pluck().all(p.id));
    const out = applyVerdict(db, { ...o, name_key: r.right_id.split('|')[0], company_key: r.right_id.split('|')[1] }, p);
    const note = out.action + (out.note ? ': ' + out.note : '');
    db.prepare("UPDATE match_candidate SET status='accepted', decided_by=?, decided_at=?, decided_note=? WHERE id=?").run(by, now(), note, r.id);
    db.prepare('UPDATE row_verdict SET program_id=?, action=?, acted_at=? WHERE name_key=? AND company_key=?').run(p.id, note, now(), r.right_id.split('|')[0], r.right_id.split('|')[1]);
    return out.action === 'dropped' ? 'Removed: the row is gone from the landscapes.' : out.action === 'merged' ? `Merged ${out.note}.` : out.action === 'approved' ? `Marked ${out.note}; the row shows the approval now.` : out.action === 'flagged' ? 'Flagged. The row stays until the seed files or an approval source fix it.' : out.action === 'kept' ? 'Noted as right; nothing changed.' : `Nothing changed: ${out.note}.`;
  })();
}
// Undo a publish (removes the feed row it added) or a dismiss; the item goes back to the open list.
export function undoItem(db, id) {
  const r = db.prepare("SELECT * FROM match_candidate WHERE id=? AND status IN ('accepted','rejected')").get(id);
  if (!r) return 'Nothing to undo.';
  return db.transaction(() => {
    if (r.change_id) db.prepare('DELETE FROM change WHERE id=?').run(r.change_id);
    db.prepare("UPDATE match_candidate SET status='open', decided_by=NULL, decided_at=NULL, change_id=NULL, decided_note=NULL WHERE id=?").run(r.id);
    if (r.type === 'verdict' && r.status === 'accepted') return 'Undone: it is back in the list. A removed or merged row comes back at the next data reload (within a day).';
    return r.change_id ? 'Undone: removed from the feed and the drug page. It is back in the list.' : 'Undone: it is back in the list.';
  })();
}

// ---------- suggestions ----------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const monthOf = w => MONTHS.findIndex(m => m.startsWith(w.toLowerCase().replace('.', '').slice(0, 3)));
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
// The dates a sentence mentions, with the words that said them: "November 15, 2026", "In June 2023", "In October", "in 2023".
// A month counts from its middle, a year from July. A month without a year is the filing's year, or the year before when that month is still to come.
export function datesIn(text, filed) {
  const f = new Date(String(filed).slice(0, 10) + 'T00:00:00Z'), out = [];
  if (!text || isNaN(f)) return out;
  for (const m of text.matchAll(new RegExp(`\\b${MON}\\s+(\\d{1,2}),?\\s+((?:19|20)\\d\\d)\\b`, 'gi'))) out.push({ words: m[0], at: utc(+m[3], monthOf(m[1]), +m[2]), exact: true });
  for (const m of text.matchAll(new RegExp(`\\b(?:in|during|since|by|of)\\s+(?:early\\s+|late\\s+|mid-?)?${MON}(?:\\s+((?:19|20)\\d\\d))?\\b(?!\\s+\\d)`, 'gi'))) {
    const mo = monthOf(m[1]); let y = m[2] ? +m[2] : f.getUTCFullYear();
    if (!m[2] && mo > f.getUTCMonth()) y--;
    out.push({ words: m[0].replace(/^(in|during|since|by|of)\s+/i, s => s[0].toUpperCase() + s.slice(1)), at: utc(y, mo, 15) });   // a month: its middle
  }
  for (const m of text.matchAll(/\b(?:in|during|since)\s+((?:19|20)\d\d)\b/gi)) out.push({ words: m[0], at: utc(+m[1], 6, 1) });   // a year: its middle
  return out;
}
const RECAP = /\b(as previously (?:communicated|announced|disclosed|reported)|previously (?:announced|disclosed|reported)|as (?:announced|disclosed|reported) (?:on|in|earlier))\b/i;
const daysBetween = (a, b) => Math.round((a - b) / 864e5);
const dayWords = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = n => n <= 1 ? (n === 1 ? 'one day' : 'the same day') : n < 21 ? `${n} days` : n < 70 ? `${Math.round(n / 7)} weeks` : n < 600 ? `${Math.round(n / 30)} months` : `${Math.round(n / 365)} years`;
const KIND_WORDS = { approval: 'approval', rejection: 'rejection', delay: 'review extension', opinion: 'EU opinion', filing: 'accepted application', withdrawal: 'withdrawal' };
// { s: 'publish' | 'check' | 'dismiss', why (HTML, already escaped), dates (the words to highlight) }.
export function suggest(db, r) {
  const o = parse(r.reasons), p = o.publish || {}, text = o.sentence || '';
  const filed = new Date(String(o.date).slice(0, 10) + 'T00:00:00Z');
  const past = datesIn(text, o.date).filter(d => d.at <= new Date(+filed + 864e5));
  const latest = past.sort((a, b) => b.at - a.at)[0];
  const dates = past.map(d => d.words);
  const recap = text.match(RECAP);
  if (recap) return { s: 'dismiss', why: `A recap: "<b>${esc(recap[0][0].toUpperCase() + recap[0].slice(1))}</b>".`, dates: [...dates, recap[0]] };
  // The same check Publish makes (src/ingest/decisions.js publishReviewed): this news about this drug is already in the feed.
  const twin = p.program?.program_id && db.prepare(`SELECT date FROM change WHERE program_id=? AND kind=? AND region=? AND abs(julianday(decision_date) - julianday(?)) <= ? ORDER BY date LIMIT 1`)
    .pluck().get(p.program.program_id, p.kind, p.region, p.decision_date, p.kind === 'filing' ? 180 : 45);
  if (twin) return { s: 'dismiss', why: `Already in the feed: the ${KIND_WORDS[o.kind] || 'news'} since ${esc(dayWords(new Date(twin + 'T00:00:00Z')))}. Publish would add nothing.`, dates };
  if (latest && !isNaN(filed)) {
    const age = daysBetween(filed, latest.at), when = latest.exact ? dayWords(latest.at) : latest.words.replace(/^(In|During|Since|By|Of)\s+/, '');
    if (age > 45) return { s: 'dismiss', why: `Old news: the sentence is about <b>${esc(latest.words.replace(/^(In|During|Since|By|Of)\s+/, ''))}</b>, ${span(age)} before the filing.`, dates };
    if (age > 14) return { s: 'check', why: `Real news, but from <b>${esc(when)}</b>, ${latest.exact ? '' : 'about '}${span(age)} before this filing, and not in the feed yet. Publish if you want it on the drug page; the feed shows it as new today.`, dates };
    return { s: 'publish', why: `New: dated <b>${esc(when)}</b>, ${latest.exact ? '' : 'about '}${span(age)} before this filing, and not in the feed yet.`, dates };
  }
  if (/meets the automatic rule/.test(o.why || '')) return { s: 'publish', why: 'New: a news filing that names the drug in the same sentence, and it is not in the feed yet.', dates };
  if (/(^|,)2\.02(,|$)/.test(o.items || '') || /^10-[QK]/.test(o.form || '')) return { s: 'check', why: 'No date in the sentence, and it sits in a quarterly results report, which often repeats older news. Open the drug page: if it already shows this, Dismiss.', dates };
  return { s: 'check', why: 'No date in the sentence. Open the filing to see when it happened.', dates };
}
// Ready items with their suggestion, sentences of one filing about the same news as one item (`also`: the other ids).
function decide(db) {
  const { ready } = openItems(db), seen = new Map(), out = [];
  for (const r of ready) {
    const o = parse(r.reasons), key = `${o.publish?.program?.program_id}|${o.kind}|${o.date}|${o.company}`;
    if (seen.has(key)) { seen.get(key).also.push(r.id); continue; }
    const item = { r, o, ...suggest(db, r), also: [] };
    seen.set(key, item); out.push(item);
  }
  const order = { publish: 0, check: 1, dismiss: 2 };
  return out.sort((a, b) => order[a.s] - order[b.s] || String(b.o.date).localeCompare(String(a.o.date)));
}
// For Today's Review row: how many items, by suggestion, and the newest open id (Ignore hides the row until a newer one).
export function reviewSummary(db) {
  const items = decide(db), { verdict } = openItems(db);
  const c = s => items.filter(i => i.s === s).length, rows = verdict.filter(r => parse(r.reasons).verdict !== 'right').length;
  return { news: items.length, publish: c('publish'), check: c('check'), dismiss: c('dismiss'), rows, total: items.length + rows,
    newest: db.prepare("SELECT coalesce(max(id),0) FROM match_candidate WHERE status='open' AND type IN ('decision','verdict')").pluck().get() };
}

// ---------- page ----------
const KIND = { approval: 'Approval', rejection: 'Rejection (complete response letter)', delay: 'Review extended (new decision date)',
  opinion: 'Positive opinion from the EU medicines committee', filing: 'Application accepted for review', withdrawal: 'Application withdrawn' };
const REGION = { US: 'United States', EU: 'European Union', CN: 'China', JP: 'Japan', AU: 'Australia' };
const AGENCY = { US: 'FDA', EU: 'EU', CN: "China's regulator", JP: "Japan's regulator", AU: "Australia's regulator" };
const MEANS = {
  approval: 'The regulator approved it: it can now be sold for this use there.',
  rejection: 'A rejection (complete response letter) means the FDA said "not yet". The company can fix the problems and apply again.',
  delay: 'The regulator gave itself more time. The decision now comes later; it is not a no.',
  filing: 'The regulator agreed to review the application. A decision usually follows in 6 to 10 months.',
  opinion: 'The EU medicines committee recommends approval. The European Commission almost always follows within about 2 months.',
  withdrawal: 'The company withdrew its application, so no decision will come.',
};
const day = s => { const d = new Date(String(s || '').slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const who = s => s ? s[0].toUpperCase() + s.slice(1) : 'someone';
const ext = ' target="_blank" rel="noopener"';
// The headline as a sentence: "FDA rejected ivonescimab".
function headline(o) {
  const d = `<b>${esc(o.drug || o.application || 'no tracked drug')}</b>`, ag = AGENCY[o.region] || 'Regulator';
  return { approval: `${ag} approved ${d}`, rejection: `${ag} rejected ${d}`, delay: `${ag} decision on ${d} delayed`, opinion: `EU committee backs ${d}`,
    filing: `${ag} accepted the application for ${d}`, withdrawal: `Application for ${d} withdrawn` }[o.kind] || `News about ${d}`;
}
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The sentence with the drug's name and the dates marked.
function quote(text, marks) {
  const words = [...new Set(marks.filter(w => w && w.length > 2))].sort((a, b) => b.length - a.length);
  if (!words.length) return esc(text);
  const re = new RegExp(words.map(w => reEsc(w)).join('|'), 'gi');
  let out = '', last = 0;
  for (const m of text.matchAll(re)) { out += esc(text.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`; last = m.index + m[0].length; }
  return out + esc(text.slice(last));
}
function sourceLink(r, o) {
  const what = o.form ? `SEC ${o.form}` : o.application ? 'FDA letter' : 'source';
  return `<a href="${esc(r.source_url || r.left_id)}"${ext}>Open the ${esc(what)} ↗</a>`;
}
const LABEL = { publish: ['Looks new', 'ok'], check: ['Your call', 'mid'], dismiss: ['Looks like old news', 'old'] };
function card(it, act) {
  const { r, o, s } = it, p = o.publish, [label, cls] = LABEL[s];
  const ids = it.also.length ? `<input type="hidden" name="also" value="${it.also.join(',')}">` : '';
  const pub = `<button class="btn sm${s === 'publish' ? ' primary' : ''}" name="do" value="publish" data-key="p">Publish</button>`;
  const dis = `<button class="btn sm${s === 'dismiss' ? ' primary' : ''}" name="do" value="dismiss" data-key="d">Dismiss</button>`;
  return `<article class="rv ${cls}" tabindex="0">
<div class="rv-sug"><span class="tag ${cls}">${label}</span><span>${it.why}</span></div>
<h3>${headline(o)}</h3><div class="rv-co">${esc(o.company || '')} · ${esc(KIND[o.kind] || o.kind || 'News')}${REGION[o.region] ? ` · ${esc(REGION[o.region])}` : ''}${o.date ? ` · filed ${esc(day(o.date))}` : ''} · ${sourceLink(r, o)}${p?.program?.program_id ? ` · <a href="/drugs/${encodeURIComponent(p.program.program_id)}"${ext}>drug page ↗</a>` : ''}</div>
${o.sentence ? `<blockquote>${quote(o.sentence, [o.drug, ...it.dates])}</blockquote>` : '<p class="rv-x">No single sentence found to quote.</p>'}
${it.also.length ? `<p class="rv-x">${it.also.length === 1 ? 'Another sentence' : `${it.also.length} more sentences`} in this filing say the same thing. Publish adds it once.</p>` : ''}
<details class="rv-more"><summary>What this means, and what Publish does</summary><p>${esc(MEANS[o.kind] || '')}</p>${p ? `<p><b>Publish</b> puts the item in the public feed today, on the drug's page, and in next Monday's email for anyone following a landscape with that drug: <i>${esc(p.text)}</i>. <b>Dismiss</b> hides it; nothing is published. Both can be undone under "Recently handled".</p>` : ''}</details>
<form class="rv-act" method="post" action="${act(r.id)}">${ids}${s === 'dismiss' ? dis + pub : pub + dis}<span class="keys">P or D</span></form>
</article>`;
}
const recLink = id => /^NCT\d{8}$/.test(id) ? `<a href="https://clinicaltrials.gov/study/${esc(id)}"${ext}>${esc(id)}</a>` : esc(id);
function studyCard(r, act) {
  const o = parse(r.reasons);
  const why = o.rule === 'similar' ? `Similar titles (${Math.round((o.title_similarity || 0) * 100)}% alike), same phase, starts ${o.start_days_apart} days apart.`
    : o.blocked ? `Same ${{ utn: 'WHO trial number', xref: 'cross-reference', protocol: 'protocol code' }[o.rule] || o.rule}, but not joined automatically: ${o.blocked}.` : o.note ? `Same protocol code ${o.value}: ${o.note}.` : o.value ? `Same protocol code ${o.value}${o.companies ? ` (sponsors: ${o.companies.join(' / ')})` : ''}.` : '';
  return `<article class="rv old"><h3>${recLink(r.left_id)} and ${recLink(r.right_id)}</h3>
<p class="rv-x">${esc(why)} To join them, add the pair to <code>sameStudy</code> in the seed files; to keep them apart, <code>notSameStudy</code>. Dismiss only hides it here.</p>
<form class="rv-act" method="post" action="${act(r.id)}"><button class="btn sm" name="do" value="dismiss">Dismiss</button></form></article>`;
}
// Plain words for a reader's verdict and for the button that applies it.
const SAYS = { comparator: "Another company's drug, used only as a comparison", standard: 'Standard care or a generic, not a pipeline drug', junk: 'Not a drug name',
  duplicate: 'The same drug as another row of this company', owner: 'A real drug, but the company is wrong or incomplete', stage: 'An approved product shown as Phase 3',
  backbone: "The company's own drug, but only a backbone in these trials", rollover: 'Reaches Phase 3 only through a rollover or extension study', right: 'Looks right, with one doubt', unsure: 'Could not tell' };
const DOES = o => DROP.has(o.verdict) ? 'Remove the row' : o.verdict === 'duplicate' ? `Merge into ${o.duplicate_of}` : o.verdict === 'stage' && o.approval_label ? `Mark ${o.approval_label}` : ['owner', 'stage'].includes(o.verdict) ? 'Flag the row' : 'Note as right';
function verdictCard(r, act) {
  const o = parse(r.reasons);
  const ev = String(o.evidence || '').split(/\s+/).filter(Boolean).map(recLink).join(' ');
  return `<article class="rv mid" tabindex="0"><div class="rv-sug"><span class="tag mid">${esc(o.confidence)} confidence</span><span><b>${esc(SAYS[o.verdict] || o.verdict)}${o.verdict === 'duplicate' && o.duplicate_of ? `: ${esc(o.duplicate_of)}` : ''}.</b> ${esc(o.reason || '')}</span></div>
<h3><a href="/drugs/${encodeURIComponent(r.left_id)}"${ext}>${esc(o.drug)} ↗</a></h3><div class="rv-co">${esc(o.company || '')}</div>
<p class="rv-x">${ev ? `Trials: ${ev} · ` : ''}Why here: ${esc(o.why || '')}. Read ${esc(day(o.read_at))}.</p>
<form class="rv-act" method="post" action="${act(r.id)}"><button class="btn sm primary" name="do" value="apply" data-key="p">${esc(DOES(o))}</button><button class="btn sm" name="do" value="dismiss" data-key="d">Keep the row</button></form></article>`;
}
function historyRow(r, act) {
  const o = parse(r.reasons);
  const what = r.type === 'study' ? `Same trial? ${r.left_id} / ${r.right_id}` : r.type === 'verdict' ? `${o.drug} · ${o.company} · ${SAYS[o.verdict] || o.verdict}` : `${o.drug || o.application || 'no drug'} · ${KIND[o.kind] || o.kind || ''} · ${o.company || ''}`;
  const verb = r.type === 'verdict' ? (r.status === 'accepted' ? `Applied (${r.decided_note || ''})` : 'Kept the row') : r.status === 'accepted' ? (r.change_id ? 'Published' : `Publish pressed, nothing added${r.decided_note ? ` (${r.decided_note})` : ''}`) : 'Dismissed';
  return `<li><span class="${r.status === 'accepted' ? 'okw' : 'muted'}">${esc(verb)}</span> ${esc(what)}<span class="hw">${esc(day(r.decided_at || r.created_at))}${r.decided_at ? ` ${esc(r.decided_at.slice(11, 16))} UTC` : ''} by ${esc(who(r.decided_by))}</span>
<form method="post" action="${act(r.id)}"><button class="btn sm" name="do" value="undo">Undo</button></form></li>`;
}
const fold = (title, summary, inner, open = false) => `<details class="box fold"${open ? ' open' : ''}><summary class="boxhead"><h2>${title}</h2><span class="fsum">${summary}</span>${icon('chevron', 16, 'fchev')}</summary><div class="boxbody">${inner}</div></details>`;

// The page's content; src/admin.js puts it in the admin frame. `by` (e.g. bot) records who acted; `all` shows what is hidden.
export function reviewBody(db, { by = '', all = false, done = '' } = {}) {
  const q = by ? `?by=${encodeURIComponent(by)}` : '';
  const act = id => `/admin/review/${id}${q}`;
  const items = decide(db), { other, study, verdict } = openItems(db);
  const hist = history(db), flagged = flaggedRows(db);
  const doubts = verdict.filter(r => parse(r.reasons).verdict !== 'right'), fine = verdict.filter(r => parse(r.reasons).verdict === 'right');
  const of = s => items.filter(i => i.s === s);
  const group = (s, title, sub) => {
    const list = of(s); if (!list.length) return '';
    const bulk = s === 'dismiss' && list.length > 1 ? `<form method="post" action="/admin/review/0${q}"><input type="hidden" name="ids" value="${list.flatMap(i => [i.r.id, ...i.also]).join(',')}"><button class="btn sm" name="do" value="dismiss">Dismiss these ${list.length}</button></form>` : '';
    return `<div class="rv-grp"><div class="rv-gh"><h2>${title}<span class="count">${list.length}</span></h2>${bulk}</div><p class="rv-gs">${sub}</p>${list.map(i => card(i, act)).join('')}</div>`;
  };
  return `<div class="phead"><h1>Review</h1><p class="desc">News from company filings to the SEC, waiting for you before it goes public. Nothing here is public until you press Publish.</p></div>
${done ? `<div class="flash">${esc(done)}</div>` : ''}
<div class="rv-how"><div><b>Twice a week, about 10 minutes.</b> Monday morning, before the weekly email goes out, and Thursday. If you skip a week nothing breaks: items wait here, and nothing goes public without you. The dark button is what we suggest; keys P and D press Publish and Dismiss on the item you are on, J and K move down and up.</div></div>
${items.length || doubts.length ? `<div class="rv-sum"><span><b>${items.length + doubts.length}</b> to decide</span>${of('publish').length ? `<span class="ok">${of('publish').length} look new</span>` : ''}${of('check').length ? `<span class="mid">${of('check').length} your call</span>` : ''}${of('dismiss').length ? `<span class="old">${of('dismiss').length} look like old news</span>` : ''}${doubts.length ? `<span class="mid">${doubts.length} drug ${doubts.length === 1 ? 'row' : 'rows'} to check</span>` : ''}</div>`
    : '<p class="box boxbody rv-empty">Nothing to review. New items appear here when a company we track mentions an approval, rejection, delay, opinion or accepted application in an SEC filing (checked every hour).</p>'}
${group('publish', 'Looks new', 'The news happened just before the filing and is about this drug. Publish unless something looks off.')}
${group('check', 'Your call', 'We cannot tell from the sentence alone. Each says what to check.')}
${group('dismiss', 'Looks like old news', 'Each repeats something older, or is already in the feed.')}
${doubts.length ? `<div class="rv-grp"><div class="rv-gh"><h2>Drug rows a reader doubted<span class="count">${doubts.length}</span></h2></div><p class="rv-gs">A model read every Phase 3+ row against its trials. Rows it was sure about were fixed automatically; these it was not sure about. The dark button does what the reader suggests; <b>Keep the row</b> leaves it and stops asking.</p>${doubts.slice(0, all ? 1000 : 10).map(r => verdictCard(r, act)).join('')}${!all && doubts.length > 10 ? `<p class="rv-x"><a href="?all=1">Show all ${doubts.length}</a></p>` : ''}</div>` : ''}
<h3 class="sub">Not urgent</h3>
${study.length ? fold('Possibly the same trial', `${study.length} · once a month is enough`, `<p class="rv-x">Two registry records that may describe one trial. These never change what customers see.</p>${study.slice(0, all ? 500 : 20).map(r => studyCard(r, act)).join('')}${!all && study.length > 20 ? `<p class="rv-x"><a href="?all=1">Show all ${study.length}</a></p>` : ''}`) : ''}
${fine.length ? fold('Rows that look right, with one doubt', `${fine.length}`, fine.map(r => verdictCard(r, act)).join('')) : ''}
${flagged.length ? fold('Flagged rows', `${flagged.length} · fixed in the seed files`, `<p class="rv-x">The reader was sure these need a change the software cannot make: <b>stage</b> means an approved product shown as Phase 3 (needs an approval source), <b>owner</b> a wrong or incomplete company.</p><ul class="rv-h">${flagged.map(f => `<li><span class="muted">${esc(f.flag)}</span> <a href="/drugs/${encodeURIComponent(f.id)}"${ext}>${esc(f.name)} ↗</a> <span class="muted">${esc(f.company)}</span></li>`).join('')}</ul>`) : ''}
${fold('Recently handled', hist.length ? 'Undo any of them' : 'Nothing yet', hist.length ? `<ul class="rv-h">${hist.map(r => historyRow(r, act)).join('')}</ul>` : '<p class="rv-x">Nothing published or dismissed yet.</p>', !!done)}
${all ? fold('Cannot be published', `${other.length}`, `<p class="rv-x">These name no drug we track in the quoted sentence, so they are kept only for checking the search.</p>${other.map(r => { const o = parse(r.reasons); return `<article class="rv old"><h3>${esc(o.company || '')}</h3><div class="rv-co">${esc(KIND[o.kind] || o.kind || '')} · filed ${esc(day(o.date))} · ${sourceLink(r, o)}</div><form class="rv-act" method="post" action="${act(r.id)}"><button class="btn sm" name="do" value="dismiss">Dismiss</button></form></article>`; }).join('') || '<p class="rv-x">None.</p>'}<p class="rv-x"><a href="?">Hide these</a></p>`, true)
    : other.length ? `<p class="rv-foot">${other.length} more filings name no drug we track, so they cannot be published. Nothing to do. <a href="?all=1">Show all</a></p>` : ''}`;
}
