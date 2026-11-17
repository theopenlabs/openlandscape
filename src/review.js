// Review page (/admin/review): regulator news held for a person before it reaches the feed.
// Plain cards, the source's own sentence, Publish / Dismiss, a short history with Undo. Admin only (ADMIN_TOKEN).
import { publishReviewed } from './ingest/decisions.js';
import { applyVerdict, DROP } from './ingest/verdicts.js';
import { esc } from '../web/table.js';

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

// ---------- page ----------
const KIND = { approval: 'Approval', rejection: 'Rejection (complete response letter)', delay: 'Review extended (new decision date)',
  opinion: 'Positive opinion from the EU medicines committee', filing: 'Application accepted for review', withdrawal: 'Application withdrawn' };
const REGION = { US: 'United States', EU: 'European Union', CN: 'China', JP: 'Japan', AU: 'Australia' };
// Why an item was held, in plain words (the loader's reasons are written for developers).
function heldWhy(why = '') {
  if (/meets the automatic rule/.test(why)) return 'Meets the automatic rule (a news-type filing that names the drug in the same sentence). Held only because of the trial month.';
  if (/filing type/.test(why)) return 'Held: the filing is a results report or another kind of filing that the automatic rule does not trust.';
  if (/45 days/.test(why)) return 'Held: the sentence seems to describe something older (dated more than 45 days before the filing).';
  if (/no tracked drug/.test(why)) return 'No drug we track is named in the sentence.';
  if (/not found within one sentence/.test(why)) return 'The search words appear, but not together in one sentence.';
  return why ? `Held: ${why}.` : '';
}
const day = s => { const d = new Date(String(s || '').slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const who = s => s ? s[0].toUpperCase() + s.slice(1) : 'someone';

function headline(o) {
  const kind = KIND[o.kind] || o.kind || 'News';
  const where = REGION[o.region] ? ` · ${REGION[o.region]}` : '';
  return `<div class="kind">${esc(kind)}${esc(where)}</div><h3>${esc(o.drug || o.application || 'No tracked drug named')}</h3><div class="co">${esc(o.company || '')}</div>`;
}
function sourceLine(r, o) {
  const what = o.form ? `SEC ${o.form}` : o.application ? 'FDA letter' : 'source';
  return `<p class="m">${o.date ? `Filed ${esc(day(o.date))} · ` : ''}<a href="${esc(r.source_url || r.left_id)}" target="_blank" rel="noopener">Open the ${esc(what)} ↗</a></p>`;
}

function decisionCard(r, q, buttons) {
  const o = parse(r.reasons);
  const p = o.publish;
  return `<article class="card${r.score >= 0.9 ? ' rule' : ''}">${headline(o)}
${o.sentence ? `<blockquote>${esc(o.sentence)}</blockquote>` : '<p class="m">No single sentence found to quote.</p>'}
${sourceLine(r, o)}
<p class="why">${esc(heldWhy(o.why))}</p>
${p ? `<p class="m">Feed line if published: <i>${esc(p.text)}</i>${p.program?.program_id ? ` · <a href="/drugs/${encodeURIComponent(p.program.program_id)}" target="_blank">drug page</a>` : ''}</p>` : ''}
${buttons ? `<form method="post" action="/admin/review/${r.id}?${q}">${p ? '<button class="pub" name="do" value="publish">Publish</button>' : ''}<button name="do" value="dismiss">Dismiss</button></form>` : ''}</article>`;
}
const recLink = id => /^NCT\d{8}$/.test(id) ? `<a href="https://clinicaltrials.gov/study/${esc(id)}" target="_blank">${esc(id)}</a>` : esc(id);
function studyCard(r, q) {
  const o = parse(r.reasons);
  const why = o.rule === 'similar' ? `Similar titles (${Math.round((o.title_similarity || 0) * 100)}% alike), same phase, starts ${o.start_days_apart} days apart.`
    : o.blocked ? `Same ${{ utn: 'WHO trial number', xref: 'cross-reference', protocol: 'protocol code' }[o.rule] || o.rule}, but not joined automatically: ${o.blocked}.` : o.note ? `Same protocol code ${o.value}: ${o.note}.` : o.value ? `Same protocol code ${o.value}${o.companies ? ` (sponsors: ${o.companies.join(' / ')})` : ''}.` : '';
  return `<article class="card"><div class="kind">Possibly the same trial</div><h3>${recLink(r.left_id)} and ${recLink(r.right_id)}</h3>
<p class="why">${esc(why)}</p><p class="m">To join them, add the pair to <code>sameStudy</code> in the seed files; to keep them apart, <code>notSameStudy</code>. Dismiss only hides it here.</p>
<form method="post" action="/admin/review/${r.id}?${q}"><button name="do" value="dismiss">Dismiss</button></form></article>`;
}
// Plain words for a reader's verdict and for the button that applies it.
const SAYS = { comparator: "Another company's drug, used only as a comparison", standard: 'Standard care or a generic, not a pipeline drug', junk: 'Not a drug name',
  duplicate: 'The same drug as another row of this company', owner: 'A real drug, but the company is wrong or incomplete', stage: 'An approved product shown as Phase 3',
  backbone: "The company's own drug, but only a backbone in these trials", rollover: 'Reaches Phase 3 only through a rollover or extension study', right: 'Looks right, with one doubt', unsure: 'Could not tell' };
const DOES = o => DROP.has(o.verdict) ? 'Remove the row' : o.verdict === 'duplicate' ? `Merge into ${o.duplicate_of}` : o.verdict === 'stage' && o.approval_label ? `Mark ${o.approval_label}` : ['owner', 'stage'].includes(o.verdict) ? 'Flag the row' : 'Note as right';
function verdictCard(r, q) {
  const o = parse(r.reasons);
  const ev = String(o.evidence || '').split(/\s+/).filter(Boolean).map(recLink).join(' ');
  return `<article class="card"><div class="kind">Row to check · ${esc(o.confidence)} confidence</div><h3><a href="/drugs/${encodeURIComponent(r.left_id)}" target="_blank">${esc(o.drug)}</a></h3><div class="co">${esc(o.company || '')}</div>
<p><b>${esc(SAYS[o.verdict] || o.verdict)}${o.verdict === 'duplicate' && o.duplicate_of ? `: ${esc(o.duplicate_of)}` : ''}.</b> ${esc(o.reason || '')}</p>
<p class="m">${ev ? `Trials: ${ev} · ` : ''}Why here: ${esc(o.why || '')}. Read ${esc(day(o.read_at))}.</p>
<form method="post" action="/admin/review/${r.id}?${q}"><button class="pub" name="do" value="apply">${esc(DOES(o))}</button><button name="do" value="dismiss">Keep the row</button></form></article>`;
}
function historyRow(r, q) {
  const o = parse(r.reasons);
  const what = r.type === 'study' ? `Same trial? ${r.left_id} / ${r.right_id}` : r.type === 'verdict' ? `${o.drug} · ${o.company} · ${SAYS[o.verdict] || o.verdict}` : `${o.drug || o.application || 'no drug'} · ${KIND[o.kind] || o.kind || ''} · ${o.company || ''}`;
  const verb = r.type === 'verdict' ? (r.status === 'accepted' ? `Applied (${r.decided_note || ''})` : 'Kept the row') : r.status === 'accepted' ? (r.change_id ? 'Published' : `Publish pressed, nothing added${r.decided_note ? ` (${r.decided_note})` : ''}`) : 'Dismissed';
  return `<li><span class="${r.status === 'accepted' ? 'ok' : 'm'}">${esc(verb)}</span> ${esc(what)}<br><span class="m">${esc(day(r.decided_at || r.created_at))}${r.decided_at ? ` ${esc(r.decided_at.slice(11, 16))} UTC` : ''} by ${esc(who(r.decided_by))}</span>
<form method="post" action="/admin/review/${r.id}?${q}" class="inline"><button name="do" value="undo">Undo</button></form></li>`;
}

export function reviewPage(db, { token, by, all = false, done = '' }) {
  const q = [token && `token=${encodeURIComponent(token)}`, by && `by=${encodeURIComponent(by)}`].filter(Boolean).join('&');
  const { ready, other, study, verdict } = openItems(db);
  const rule = ready.filter(r => r.score >= 0.9).length;
  const hist = history(db), flagged = flaggedRows(db);
  const doubts = verdict.filter(r => parse(r.reasons).verdict !== 'right'), fine = verdict.length - doubts.length;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>Review: regulator news</title>
<style>
body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0 auto;padding:16px;max-width:720px;color:#1C1A17;background:#FAF9F7}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}h3{font-size:18px;margin:2px 0}.m{color:#6B6760;font-size:14px}
.card{background:#fff;border:1px solid #E5E2DC;border-radius:10px;padding:14px 16px;margin:12px 0}.card.rule{border-left:4px solid #2F7A4D}
.kind{font-size:13px;font-weight:600;color:#6B6760;text-transform:uppercase;letter-spacing:.03em}.co{color:#3d3a35}
blockquote{margin:10px 0;padding:8px 12px;border-left:3px solid #C9C4BB;background:#F4F2EE;font-size:15px}
.why{font-size:14px;margin:6px 0}.card.rule .why{color:#2F7A4D}
button{font:inherit;font-size:15px;padding:9px 18px;border-radius:8px;border:1px solid #C9C4BB;background:#fff;cursor:pointer;margin:4px 8px 0 0;min-height:42px}
button.pub{background:#1C1A17;color:#fff;border-color:#1C1A17}.inline{display:inline}.inline button{padding:2px 10px;min-height:0;font-size:13px;margin:0 0 0 6px}
.box{background:#fff;border:1px solid #E5E2DC;border-radius:10px;padding:10px 14px;font-size:14px}.done{background:#E8F3EC;border-color:#BBD9C5}
ul.h{list-style:none;padding:0;font-size:14px}ul.h li{padding:8px 0;border-bottom:1px solid #E5E2DC}.ok{color:#2F7A4D;font-weight:600}
details{margin-top:24px}summary{cursor:pointer;font-weight:600}a{color:#1F5FA8}
</style>
<h1>Regulator news to review</h1>
<p class="m">Found in company filings to the SEC. Nothing here is public until someone presses Publish.</p>
${done ? `<p class="box done">${esc(done)}</p>` : ''}
<p class="box"><b>Publish</b> puts the item in the public feed today, on the drug's page, and in next Monday's email for anyone following a landscape with that drug. <b>Dismiss</b> hides it; nothing is published. Both can be undone under "Recently handled" (an email already sent cannot be recalled).</p>
<h2>Ready to publish (${ready.length})</h2>
${ready.length ? `<p class="m">${rule ? `The first ${rule} meet${rule === 1 ? 's' : ''} the automatic rule (green edge).` : 'None of these meet the automatic rule.'} Check that the quote is news about this drug, not a recap or a plan.</p>${ready.map(r => decisionCard(r, q, true)).join('')}`
    : '<p class="box">Nothing to review. New items appear here when a company we track mentions an approval, rejection, delay, opinion or accepted application in an SEC filing (checked every hour).</p>'}
${study.length ? `<h2>Possibly the same trial (${study.length})</h2><p class="m">Two registry records that may describe one trial. These never change the feed.</p>${study.slice(0, all ? 500 : 5).map(r => studyCard(r, q)).join('')}${!all && study.length > 5 ? `<p class="m">${study.length - 5} more under "show all".</p>` : ''}` : ''}
${all ? `<h2>Cannot be published (${other.length})</h2><p class="m">These name no drug we track in the quoted sentence, so they are kept only for checking the search. Hidden by default.</p>${other.map(r => decisionCard(r, q, true)).join('') || '<p class="m">None.</p>'}
<p><a href="?${q}">Hide these</a></p>` : other.length ? `<p class="m">${other.length} other mentions name no drug we track and cannot be published. <a href="?${q}&all=1">Show all</a></p>` : ''}
${verdict.length ? `<h2>Drug rows a reader doubted (${doubts.length})</h2><p class="m">A model read every Phase 3+ row against its trials. Rows it was sure about were fixed automatically; these it was not sure about. The dark button does what the reader suggests; <b>Keep the row</b> leaves it and stops asking. Both can be undone below.</p>${doubts.slice(0, all ? 1000 : 10).map(r => verdictCard(r, q)).join('')}${!all && doubts.length > 10 ? `<p><a href="?${q}&all=1">Show all ${doubts.length}</a></p>` : ''}${fine ? all ? `<h2>Looks right, with one doubt (${fine})</h2>${verdict.filter(r => parse(r.reasons).verdict === 'right').map(r => verdictCard(r, q)).join('')}` : `<p class="m">${fine} more rows look right but the reader noted a doubt. <a href="?${q}&all=1">Show all</a></p>` : ''}` : ''}
${flagged.length ? `<h2>Flagged rows (${flagged.length})</h2><p class="m">The reader was sure these need a change the software cannot make: <b>stage</b> means an approved product shown as Phase 3 (needs an approval source), <b>owner</b> a wrong or incomplete company.</p><ul class="h">${flagged.map(f => `<li><span class="kind">${esc(f.flag)}</span> <a href="/drugs/${encodeURIComponent(f.id)}" target="_blank">${esc(f.name)}</a> <span class="m">${esc(f.company)}</span></li>`).join('')}</ul>` : ''}
<h2>Recently handled</h2>
${hist.length ? `<ul class="h">${hist.map(r => historyRow(r, q)).join('')}</ul>` : '<p class="m">Nothing published or dismissed yet.</p>'}`;
}
