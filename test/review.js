// Checks the review page (src/review.js) on a throwaway database: what is shown, Publish, Dismiss, Undo, and the history.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-review-'), 'test.db');
const { getDb } = await import('../src/db.js');
const R = await import('../src/review.js');

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const db = getDb();
ok(db.prepare('PRAGMA table_info(company)').all().some(c => c.name === 'cik') && db.prepare('PRAGMA table_info(company)').all().some(c => c.name === 'parent_id'), 'a fresh database has both company.cik and company.parent_id');
db.exec(`INSERT INTO company (id, name) VALUES ('az', 'AstraZeneca');
  INSERT INTO program (id, drug_id, name, aliases, company, company_ids, curated) VALUES ('auto:camizestrant|az', NULL, 'camizestrant', '[]', 'AstraZeneca', '[]', 0)`);
const item = (url, { score = 0.6, date = '2026-05-27', drug = 'camizestrant', kind = 'delay', why = 'filing type (needs 8-K item 7.01 or 8.01)' } = {}) => {
  const publish = drug ? { key: `SEC|${url}|${kind}`, agency: 'SEC', region: 'US', kind, product: drug, holder: 'AstraZeneca PLC', decision_date: date, source_url: url,
    quote: `The FDA will extend the PDUFA date for ${drug}.`, program: { program_id: 'auto:camizestrant|az', drug_id: null }, text: `US review extended (PDUFA date), per AstraZeneca PLC SEC 6-K: ${drug}` } : null;
  return db.prepare("INSERT INTO match_candidate (type, left_id, right_id, score, reasons, source_url) VALUES ('decision', ?, ?, ?, ?, ?)").run(url, `az|${kind}|${url}`, score,
    JSON.stringify({ kind, region: 'US', company: 'AstraZeneca PLC', form: '6-K', date, drug, sentence: publish?.quote || 'Some sentence.', why, publish }), url).lastInsertRowid;
};
const older = item('https://www.sec.gov/a.htm', { date: '2026-05-01' });
const rule = item('https://www.sec.gov/b.htm', { score: 0.9, date: '2026-04-02', why: 'meets the automatic rule; held for review while SEC_AUTO is off', kind: 'approval' });
const newer = item('https://www.sec.gov/c.htm', { date: '2026-06-10', kind: 'filing' });
const none = item('https://www.sec.gov/d.htm', { drug: null, score: 0.3, why: 'no tracked drug named in the sentence' });
db.prepare("INSERT INTO match_candidate (type, left_id, right_id, score, reasons) VALUES ('study', 'NCT00000001', 'NCT00000002', 0.5, ?)").run(JSON.stringify({ rule: 'similar', phase: 3, start_days_apart: 4, title_similarity: 0.8 }));

// ---- what is shown ----
let o = R.openItems(db);
ok(o.ready.map(r => r.id).join() === [rule, newer, older].join(), 'ready to publish: items meeting the automatic rule first, then newest filing first');
ok(o.other.map(r => r.id).join() === String(none) && o.study.length === 1, 'an item naming no tracked drug is kept apart; same-trial pairs have their own section');
let html = R.reviewPage(db, { token: 't', by: 'bot' });
ok(html.includes('camizestrant') && html.includes('The FDA will extend the PDUFA date') && html.includes('Open the SEC 6-K') && html.includes('United States') && html.includes('Review extended'),
  'card shows drug, the filing’s own sentence, filing link, region and kind in words');
const text = html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
ok(!/program_id|[{}]|auto:camizestrant|SEC\|https|\bscore\b/.test(text) && !text.includes(`#${rule}`), 'no raw JSON or internal ids in the visible text');
ok(!html.includes('d.htm') && html.includes('Show all') && R.reviewPage(db, { token: 't', all: true }).includes('d.htm'), 'items that cannot be published are hidden behind “Show all”');
ok(html.includes('<meta name="referrer" content="no-referrer">'), 'the page never sends its address (with the token) to the sites it links to');
ok(html.includes('Publish</b> puts the item in the public feed') && html.includes('Monday'), 'page says what Publish does');

// ---- publish, dismiss, undo ----
let msg = R.publishItem(db, rule, 'bot');
const ch = db.prepare("SELECT * FROM change WHERE field='SEC'").all();
ok(/^Published/.test(msg) && ch.length === 1 && ch[0].kind === 'approval' && ch[0].source_url === 'https://www.sec.gov/b.htm' && ch[0].quote.includes('PDUFA'), 'Publish writes one feed row with the quote and filing link');
const done = db.prepare('SELECT * FROM match_candidate WHERE id=?').get(rule);
ok(done.status === 'accepted' && done.decided_by === 'bot' && done.change_id === ch[0].id && done.decided_at, 'the item records who published it, when, and the feed row it added');
ok(R.publishItem(db, rule, 'bot') === 'Already handled.' && db.prepare("SELECT count(*) FROM change").pluck().get() === 1, 'pressing Publish twice adds nothing');
const twin = item('https://www.sec.gov/e.htm', { kind: 'approval', date: '2026-04-05' });
ok(/^Nothing added: already in the feed/.test(R.publishItem(db, twin, 'team')) && db.prepare("SELECT count(*) FROM change").pluck().get() === 1, 'the same news already in the feed: nothing added, and the page says so');
ok(/^Dismissed/.test(R.dismissItem(db, newer, 'team')) && db.prepare('SELECT status, decided_by FROM match_candidate WHERE id=?').get(newer).decided_by === 'team' && db.prepare("SELECT count(*) FROM change").pluck().get() === 1, 'Dismiss publishes nothing and records who dismissed');
html = R.reviewPage(db, { token: 't' });
ok(/Published<\/span> camizestrant/.test(html) && /Dismissed<\/span> camizestrant/.test(html) && html.includes('by Bot') && html.includes('by Team'), 'history lists what was published and dismissed, and by whom');
ok(/^Undone: removed from the feed/.test(R.undoItem(db, rule)) && db.prepare("SELECT count(*) FROM change").pluck().get() === 0
  && db.prepare('SELECT status, change_id FROM match_candidate WHERE id=?').get(rule).status === 'open', 'Undo of a publish removes the feed row and puts the item back in the list');
ok(/^Undone/.test(R.undoItem(db, newer)) && R.openItems(db).ready.some(r => r.id === newer), 'Undo of a dismiss puts the item back');
ok(/cannot be published/.test(R.publishItem(db, none, 'team')) && db.prepare("SELECT count(*) FROM change").pluck().get() === 0, 'an item naming no tracked drug cannot be published');
db.exec("DELETE FROM match_candidate");
ok(R.reviewPage(db, { token: 't' }).includes('Nothing to review.'), 'empty queue: a clear empty state');
