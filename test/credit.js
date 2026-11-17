// The source line and safe cells on what leaves the product (branded exports, step 1, 15 Nov 2026): CSV ends with the source
// line, a cell a spreadsheet would run as a formula stays text, and the slides draw with the name, link and counts.
import { safeCell, toCSV, creditLine, creditPath } from '../web/table.js';
import { overviewSlideSvg, tableSlideSvg, slideTitle } from '../src/images.js';
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

ok(safeCell('=HYPERLINK("http://x","y")') === `'=HYPERLINK("http://x","y")` && safeCell('-endoxifen') === "'-endoxifen" && safeCell('+1') === "'+1" && safeCell('@a') === "'@a", 'formula-like cells start with an apostrophe');
ok(safeCell('tirzepatide') === 'tirzepatide' && safeCell('GLP-1') === 'GLP-1', 'ordinary cells are unchanged');

const prog = { drug: '=cmd', aliases: [], company: 'Eli Lilly', mechanism: 'GLP-1', mechanism_confirmed: true, phase: { label: 'Phase 3', source: 'https://x', news: false, level: 3 },
  next_catalyst: { date: '2027-02', what: 'Primary completion, Phase 3', url: 'https://y' }, financing: { label: 'Public', tickers: [] }, lead_trial: { url: 'https://z' }, trials: { ncts: ['NCT1'] }, curated: true, id: 'a' };
const csv = toCSV([prog], { credit: creditLine('https://openlandscape.app/landscapes/obesity') });
ok(csv.includes(`"'=cmd"`), 'a CSV cell starting with = is written as text');
ok(/\n\n"Source: OpenLandscape, openlandscape\.app\/landscapes\/obesity, \d{1,2} [A-Z][a-z]{2} \d{4}"\n$/.test(csv), 'the CSV ends with an empty line and the source line');
ok(creditPath({ slug: 'obesity' }) === '/landscapes/obesity' && creditPath({ area: 'heart failure' }) === '/start?q=heart+failure', 'a ready-made landscape links to its page, a search to its search');
ok(slideTitle('Obesity drug landscape') === 'Obesity' && slideTitle('In vivo CAR-T landscape') === 'In vivo CAR-T', 'slide titles drop "drug landscape"');

const L = { area: 'obesity', phase_min: 2, stats: { programs: 103, companies: 72, china: 25, by_phase: [{ level: 5, name: 'Approved', count: 10 }, { level: 3, name: 'Phase 3', count: 31 }, { level: 2, name: 'Phase 2', count: 59 }] } };
const svg = overviewSlideSvg(L, { title: 'Obesity', url: 'openlandscape.app/landscapes/obesity', day: '15 Nov 2026' });
ok(svg.includes('>OpenLandscape</text>') && svg.includes('openlandscape.app/landscapes/obesity, 15 Nov 2026') && ['>59<', '>31<', '>10<'].every(s => svg.includes(s)), 'the overview slide has the name, the source line and each stage count');
const tsvg = tableSlideSvg(L, [prog], { title: 'Obesity <x>', url: 'openlandscape.app', day: '15 Nov 2026', sub: '1 of 103 drugs', theme: 'dark' });
ok(tsvg.includes('Obesity &lt;x&gt;') && tsvg.includes('>=cmd<') && tsvg.includes('#141311'), 'the table slide escapes text and draws dark');
