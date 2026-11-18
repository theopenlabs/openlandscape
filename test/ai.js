// For AI tools (step 20): llms.txt, the JSON-LD tag (escaped, left off noindex pages) and the weekly IndexNow ping.
import { tempDir } from './tmp.js';
import { join } from 'node:path';
process.env.DB_PATH = join(tempDir('ol-ai-'), 'test.db');
const { llmsTxt, aiPage, aboutPage } = await import('../src/pages/ai.js');
const { diseasesIndexPage, landscapesIndexPage } = await import('../src/pages/landscapes.js');
const { layout } = await import('../src/pages/shared.js');
const { pingIndexNow, INDEXNOW_KEY } = await import('../src/indexnow.js');
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };

const t = llmsTxt();
ok(t.startsWith('# OpenLandscape\n\n> '), 'llms.txt starts with the name and a summary line');
ok(/## Using it from an AI app/.test(t) && /\/mcp/.test(t), 'llms.txt names the connector');

ok(/## Instructions for AI assistants\n\n1\. Describe/.test(t) && /## Questions people ask/.test(t) && /Last updated: /.test(t), 'llms.txt has the instructions, the questions and a date');
const ai = aiPage();
ok(ai.includes('"FAQPage"') && ai.includes('<ol class="aiorder">'), '/ai has the questions as data and the numbered instructions');

// Links between pages: the A to Z links every disease; /landscapes links the counted ones and the A to Z.
const az = diseasesIndexPage([{ name: 'Asthma', slug: 'asthma', drugs: 3 }, { name: '17q21 thing', slug: 'x17', drugs: null }]);
ok(az.includes('href="/diseases/asthma"') && az.includes('id="az-A"') && az.includes('id="az-n"'), 'A to Z links each disease under its letter');
const li = landscapesIndexPage([], { browse: { total: 2, top: [{ name: 'Asthma', slug: 'asthma', drugs: 3 }] } });
ok(li.includes('Browse by disease') && li.includes('href="/diseases/asthma"') && li.includes('href="/diseases"'), '/landscapes links diseases and the A to Z');

// A landscape with search wording (src/server.js PUBLIC seo) uses it on its own stage; other stages keep the plain title.
const { landscapePage } = await import('../src/pages/landscapes.js');
const fakeL = { area: 'obesity', stats: { programs: 96, trials: 300, companies: 50, by_phase: [] }, data: { trials: '2026-11-06' }, programs: [], phases: {}, companies: [] };
const seo = { title: 'Obesity drug pipeline: GLP-1 and other drugs in trials', desc: (n, d) => `${n} obesity drugs in Phase 2+ trials. Updated ${d}.` };
const lp = landscapePage(fakeL, { slug: 'obesity', title: 'Obesity drug landscape', crumb: 'Metabolic', seo });
ok(lp.includes('<title>Obesity drug pipeline: GLP-1 and other drugs in trials</title>') && lp.includes('<meta name="description" content="96 obesity drugs in Phase 2+ trials. Updated 6 Nov 2026.">'), 'a landscape with search wording uses it for its title and description');
ok(lp.includes('<link rel="canonical" href="https://openlandscape.app/landscapes/obesity">') || lp.includes('/landscapes/obesity">'), 'its canonical address is the plain one');
const lp3 = landscapePage(fakeL, { slug: 'obesity', title: 'Obesity drug landscape', crumb: 'Metabolic', seo, phase_min: 3, own_phase: 2 });
ok(!lp3.includes('Obesity drug pipeline: GLP-1') && lp3.includes('Obesity drug landscape, '), 'another stage keeps the plain title');

// The /connect example: the drugs listed add up to the count under them.
const { demoTerminal } = await import('../src/pages/connect.js');
const progs = n => Array.from({ length: n }, (_, i) => ({ drug: `drug${i}`, company: 'Co', phase: { label: 'Phase 3' }, next_catalyst: { label: `${i + 1} Jan 2027`, date: `2027-01-${String(30 - i).padStart(2, '0')}`, nct: 'NCT0' + i } }));
const term = n => demoTerminal({ programs: progs(n), summary: `${n} drugs in Phase 3 or later.`, stats: { programs: n, trials: 50 } });
const t9 = term(9), t12 = term(12), rowsIn = h => (h.match(/<tr><td>/g) || []).length;
ok(rowsIn(t9) === 9 && !t9.includes('more</td>') && t9.includes('✓ 9 drugs'), 'the /connect example lists all 9 drugs when it says 9');
ok(rowsIn(t12) === 8 && t12.includes('and 4 more</td>') && t12.includes('<b>drug11</b>'), 'with more than 10: the first 8, "and 4 more", and the first date found among all of them');

const { wordingSlug } = await import('../src/diseasemap.js');
ok(wordingSlug('nothing like this') === null, 'a condition no disease page has stays unlinked');

const ab = aboutPage();
ok(ab.includes('Who we are') && ab.includes('Feynman OÜ') && !ab.includes('"Person"') && !ab.includes('class="box'), '/about speaks as the company, laid out in bands, no boxes');

const page = layout({ title: 'x', body: '', path: '/x', ld: [{ '@type': 'Thing', name: '</script><b>' }] });
ok(page.includes('application/ld+json') && !page.includes('</script><b>'), 'JSON-LD is in the page and cannot close its tag');
ok(!layout({ title: 'x', body: '', noindex: true, ld: [{ '@type': 'Thing' }] }).includes('ld+json'), 'no JSON-LD on noindex pages');

const sent = [];
const send = async (url, o) => { sent.push(JSON.parse(o.body)); return { status: 200 }; };
process.env.PUBLIC_URL = 'http://localhost:3000';
ok(await pingIndexNow(() => ['/'], { send }) === '' && !sent.length, 'no ping off the live site');
process.env.PUBLIC_URL = 'https://openlandscape.app';
ok(/2 pages sent/.test(await pingIndexNow(() => ['/', '/pricing'], { send })), 'pings the live site');
ok(sent[0]?.key === INDEXNOW_KEY && sent[0].urlList[1] === 'https://openlandscape.app/pricing', 'sends the key and full addresses');
ok(await pingIndexNow(() => ['/'], { send }) === '' && sent.length === 1, 'not again within a week');
ok(/sent/.test(await pingIndexNow(() => ['/'], { send, now: Date.now() + 8 * 864e5 })), 'again after a week');

console.log(bad ? `ai: ${bad} failed` : 'ai: all passed');
process.exit(bad ? 1 : 0);
