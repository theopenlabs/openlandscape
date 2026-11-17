// Regulator decisions announced in company SEC filings (8-K, 6-K), found with SEC full-text search. Runs hourly.
//   node src/ingest/sec-decisions.js [--since YYYY-MM-DD]    (default: the last 3 days)
// A phrase in a filing is a mention, not an announcement (earnings releases repeat old approvals; risk sections mention
// rejections hypothetically). With SEC_AUTO=1, a hit becomes a feed change automatically only when:
//   - the filing is an 8-K with item 7.01 or 8.01, or a 6-K, and has no item 2.02 (results);
//   - the filer is a company we track, and one of its drugs is named in the same sentence as the phrase.
// The feed quotes that sentence and links the filing. Other hits from companies we track go to the review queue.
// SEC asks for a declared User-Agent and at most 10 requests a second; we pause 150 ms between requests.
import { pathToFileURL } from 'node:url';
import { getDb } from '../db.js';
import { companyPrograms, programsNamedIn } from '../match.js';
import { UA } from './edgar.js';
import { decisionWriter, sinceArg, clip, decode } from './decisions.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Trial period (since 7 Nov 2026): SEC alerts are not published automatically. Every hit, including those that pass the
// rule, goes to the review queue and a person publishes it from /admin/review. Set SEC_AUTO=1 to publish rule-passing
// hits automatically once the queue shows the rule would have been right.
const AUTO = process.env.SEC_AUTO === '1';
const NOT_YET = /\b(if|may|might|could|would|potential|potentially|expects?|expected|anticipates?|anticipated|plans?|seeks?|seeking|intends?|whether|upon)\b/i;
// Announcement wording only: "has approved", "granted approval", "received approval", "announces ... approval".
// Not "approved by the FDA under NDA ..." (a description of an old approval, common in agreements and company boilerplate).
const APPROVED = /\b(has|have) (granted )?approv(ed|al)\b|\bgranted (accelerated |full |traditional |conditional |marketing )?approval\b|\breceive[sd]? (U\.S\. )?(FDA |NMPA )?(marketing )?approval\b|\bannounce[sd]?\b.{0,80}\bapproval\b/i;
// A go-ahead to start a trial ("clearance to proceed", IND) is not a marketing approval.
const TRIAL_GO = /\b(IND|investigational new drug|clearance|to proceed|to (initiate|begin|start|commence)|clinical (trial|study) application)\b/i;
const regionOf = s => (/\b(NMPA|National Medical Products Administration)\b/.test(s) ? 'CN' : /\b(EMA|CHMP|European Commission)\b/.test(s) ? 'EU' : /\b(PMDA|MHLW)\b/.test(s) ? 'JP' : 'US');
// Section 3.8's searches, plus acceptance of an application (filing). Each `sentence` test must hold within one sentence.
export const PHRASES = [
  { q: '"has approved" "Food and Drug Administration"', kind: 'approval', region: () => 'US',
    sentence: s => /\b(FDA|Food and Drug Administration)\b/.test(s) && APPROVED.test(s) && !TRIAL_GO.test(s) && !/complete response/i.test(s) && !NOT_YET.test(s) },
  { q: '"complete response letter"', kind: 'rejection', region: () => 'US',
    sentence: s => /\b(received|issued) an? complete response letter\b/i.test(s) && !NOT_YET.test(s) },
  { q: 'PDUFA extended', kind: 'delay', region: () => 'US',
    sentence: s => /\b(PDUFA|review period|goal date|action date)\b/i.test(s) && /\bextend(ed|s)?\b|\bextension\b/i.test(s) && !/\b(may|might|could|if)\b/i.test(s) },
  { q: '"positive opinion" CHMP', kind: 'opinion', region: () => 'EU',
    sentence: s => /\bpositive opinion\b/i.test(s) && /\b(CHMP|Committee for Medicinal Products)\b/.test(s) && /\b(adopted|issued|received|granted)\b/i.test(s) && !NOT_YET.test(s) },
  { q: 'NMPA approved', kind: 'approval', region: () => 'CN',
    sentence: s => /\b(NMPA|National Medical Products Administration)\b/.test(s) && APPROVED.test(s) && !TRIAL_GO.test(s) && !/\baccept/i.test(s) && !NOT_YET.test(s) },
  { q: '"accepted" "New Drug Application"', kind: 'filing', region: regionOf,
    sentence: s => /\baccept(ed|s)\b/i.test(s) && /\b(New Drug Application|NDA)\b/.test(s) && !NOT_YET.test(s) },
  { q: '"accepted" "Biologics License Application"', kind: 'filing', region: regionOf,
    sentence: s => /\baccept(ed|s)\b/i.test(s) && /\b(Biologics License Application|BLA)\b/.test(s) && !NOT_YET.test(s) },
];
const WORDS = { approval: 'approval', rejection: 'complete response letter', delay: 'review extended (PDUFA date)', opinion: 'CHMP positive opinion', filing: 'application accepted' };

// Filing text -> sentences. Block ends (paragraphs, table cells, headings) end a sentence too, so a headline without a
// full stop is not glued to the text after it. Abbreviations ("U.S.", "Inc.") are protected.
export function sentences(html) {
  const t = decode(String(html).replace(/\s+/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/?(p|div|br|tr|td|th|li|ul|ol|h[1-6]|table|title)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\b(U\.S|U\.K|Inc|Co|Corp|Ltd|No|Nos|Dr|Mr|Ms|St|e\.g|i\.e|vs|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./g, m => m.replace(/\./g, '\u2024'));
  return t.split(/\n+/).flatMap(b => b.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z“"(\d])/))
    .map(s => s.replace(/\u2024/g, '.').trim()).filter(s => s.length > 20 && s.length < 1500);
}

// The rule: is this filing type one whose sentences we may publish automatically? 8-K: item 7.01 or 8.01 and no results
// item 2.02. 6-K has no item numbers, so a 6-K whose document opens as a results or periodic report counts as results.
const RESULTS = new RegExp([/financial results|results for the (first|second|third|fourth) quarter|(first|second|third|fourth)[- ]quarter (\d{4} )?results/,
  /quarterly report|interim report|half[- ]year(ly)? report|annual report|financial report for the period/,
  // "Q1 2026: double-digit sales and business EPS growth" (Sanofi), "third-quarter adjusted operating profit" (Novo Nordisk)
  /\b(Q[1-4]|H[12]|9M|first[- ]half|nine[- ]months?)( of)? 20\d{2}\b[^.]{0,80}\b(sales|revenues?|EPS|earnings|operating profit|net (income|loss))\b/,
  /\b(first|second|third|fourth)[- ]quarter (20\d{2} )?(adjusted |reported )?(sales|revenues?|EPS|earnings|operating profit|net (income|loss))\b/].map(r => r.source).join('|'), 'i');
export function autoForm(form, items, opening = '') {
  const it = (items || []).map(String);
  if (it.includes('2.02')) return false;
  if (/^6-K/.test(form)) return !RESULTS.test(opening);
  return /^8-K/.test(form) && (it.includes('7.01') || it.includes('8.01'));
}
// SEC cover-page lines of a 6-K or 8-K ("... files annual reports under cover of Form 20-F" must not count as a results
// report). The opening is the first 8 lines that are not cover lines, so a results title after a cover page (Novo Nordisk)
// is seen, and so is one on an exhibit's first line (Sanofi).
const COVER = /SECURITIES AND EXCHANGE COMMISSION|Pursuant to|Form (20|40)-F|check mark|Rule 12g3|12g-?3|Commission File|Exact name|principal executive|For the month of|Translation of registrant|Date of (Report|earliest)|^[_\s-]*$|Registrant|Securities Exchange Act/i;
export const openingOf = all => all.slice(0, 40).filter(s => !(s.length < 250 && COVER.test(s))).slice(0, 8).join(' ').slice(0, 800);

// A sentence that dates its event more than 45 days before the filing is a recap ("In January 2026, ... was approved").
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function recap(sentence, filed) {
  const f = Date.parse(filed);
  for (const m of sentence.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:(\d{1,2}),?\s+)?(20\d{2})\b/g)) {
    const d = Date.UTC(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +(m[2] || 28));
    if (f - d > 45 * 864e5) return true;
  }
  for (const m of sentence.matchAll(/\b(?:in|during|since)\s+(20\d{2})\b/gi)) if (+m[1] < new Date(f).getUTCFullYear()) return true;
  return false;
}

// One filing document: what to publish or queue. progs: the filer's programs (companyPrograms). filed: YYYY-MM-DD.
export function judge({ html, form, items, phrase, progs, filed }) {
  const all = sentences(html);
  const opening = openingOf(all);
  const hits = all.filter(phrase.sentence);
  const formOk = autoForm(form, items, opening);
  for (const s of hits) {
    const named = programsNamedIn(s, progs);
    if (named.length && formOk && !recap(s, filed)) return { auto: true, sentence: s, program: named[0] };
  }
  const s = hits[0] || null;
  const named = s ? programsNamedIn(s, progs) : [];
  return { auto: false, sentence: s, program: named[0] || null,
    why: !s ? 'phrase not found within one sentence' : !named.length ? 'no tracked drug named in the sentence'
      : !formOk ? 'filing type (needs 8-K item 7.01 or 8.01, or a 6-K that is not a results report; never results item 2.02)' : 'the sentence dates the event more than 45 days before the filing' };
}

async function sec(url) {
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
    await sleep(150);
    if (res.ok) return res;
    if (tries >= 2 || res.status === 403 || res.status === 404) throw new Error(`HTTP ${res.status} ${url}`);
    await sleep(2000 * (tries + 1));
  }
}

export async function loadSecDecisions({ since = null, db = getDb() } = {}) {
  const start = since || new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const w = decisionWriter({ source: 'sec', since });
  const of = companyPrograms(db);
  const byCik = new Map(db.prepare('SELECT id, cik FROM company WHERE cik IS NOT NULL').all().map(c => [+c.cik, c.id]));
  const seen = db.prepare("SELECT 1 FROM regulatory_decision WHERE key=? UNION ALL SELECT 1 FROM match_candidate WHERE type='decision' AND left_id=? AND right_id=?");
  const queue = db.prepare("INSERT OR IGNORE INTO match_candidate (type, left_id, right_id, score, reasons, source_url) VALUES ('decision', ?, ?, ?, ?, ?)");
  const out = { hits: 0, tracked: 0, fetched: 0, auto: 0, queued: 0, errors: [] };
  for (const phrase of PHRASES) {
    for (let from = 0; ; from += 100) {
      const u = new URL('https://efts.sec.gov/LATEST/search-index');
      for (const [k, v] of Object.entries({ q: phrase.q, forms: '8-K,6-K', dateRange: 'custom', startdt: start, enddt: end, from: String(from) })) u.searchParams.set(k, v);
      let body;
      try { body = await (await sec(u)).json(); } catch (e) { out.errors.push(e.message); break; }
      const hits = body.hits?.hits || [];
      for (const h of hits) {
        out.hits++;
        const src = h._source, [adsh, file] = h._id.split(':');
        if (!/^(8-K|6-K|EX-99)/.test(src.file_type || '')) continue;   // the filing itself or its press-release exhibits, not agreements
        const cik = +src.ciks?.[0];
        const filer = String(src.display_names?.[0] || '').replace(/\s*\(.*$/, '').trim();
        const co = byCik.get(cik) ? of.resolve.root(byCik.get(cik)) : of.resolve(filer);
        const progs = co ? of(co) : [];
        if (!progs.length) continue;                       // not a company we track
        out.tracked++;
        const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${file}`;
        const key = `SEC|${adsh}|${file}|${phrase.kind}`;
        if (seen.get(key, url, `${co}|${phrase.kind}`)) continue;
        let html;
        try { html = await (await sec(url)).text(); out.fetched++; } catch (e) { out.errors.push(e.message); continue; }
        const j = judge({ html, form: src.form, items: src.items, phrase, progs, filed: src.file_date });
        const region = phrase.region(j.sentence || '');
        const d = j.program ? { key, agency: 'SEC', region, kind: phrase.kind, product: j.program.name, holder: filer, decision_date: src.file_date, source_url: url,
          quote: clip(j.sentence, 500), program: { program_id: j.program.program_id, drug_id: j.program.drug_id },
          text: `${region} ${WORDS[phrase.kind]}, per ${filer} SEC ${src.form}: ${j.program.name}` } : null;
        if (j.auto && AUTO) { w.record(d); out.auto++; continue; }
        // Held for a person: everything that fails the rule, and (while SEC_AUTO is off) everything that passes it.
        // `publish` carries the change exactly as it would be written, so the review page can publish it unchanged.
        out.queued += queue.run(url, `${co}|${phrase.kind}`, j.auto ? 0.9 : j.program ? 0.6 : 0.3, JSON.stringify({ kind: phrase.kind, region, company: filer, form: src.form,
          items: (src.items || []).join(','), date: src.file_date, drug: j.program?.name || null, sentence: j.sentence ? clip(j.sentence, 500) : null,
          why: j.auto ? 'meets the automatic rule; held for review while SEC_AUTO is off' : j.why, publish: d }), url).changes;
      }
      if (hits.length < 100) break;
    }
  }
  return { from: start, to: end, ...out, ...w.done() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(`--- ${new Date().toISOString()} SEC decisions ${JSON.stringify(await loadSecDecisions({ since: sinceArg() }))}`);
