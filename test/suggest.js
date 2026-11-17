// Search suggestions (src/suggest.js): ranking, merged duplicates and speed, on the loaded data.
// Run: npm run check
import { suggest, key, drugKey } from '../src/suggest.js';
import { drug } from '../src/query.js';
import { HAS_CHECKED_DATA, skip } from './private.js';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const g = (q, kind) => suggest(q, { per: 50 }).groups.find(x => x.kind === kind)?.items || [];
const first = q => { const r = suggest(q); return r.groups[0] && { kind: r.groups[0].kind, label: r.groups[0].items[0].label }; };

ok(key('GLP-1') === 'glp1' && key('Novo Nordisk A/S') === 'novo nordisk a s', 'names compare without case, hyphens or punctuation');
ok(drugKey('Inclisiran Sodium for') === 'inclisiran' && drugKey('inclisiran sodium') === 'inclisiran', 'salt and form words dropped from drug names');

let t = performance.now(); suggest('a'); console.log(`      table built in ${Math.round(performance.now() - t)} ms`);
const times = [];
for (const q of ['g', 'glp', 'heart', 'novo', 'HRS', 'inclisiran', 'pd-1', 'xyzzy']) { t = performance.now(); suggest(q); times.push(performance.now() - t); }
ok(Math.max(...times) < 50, `each list under 50 ms (slowest ${Math.max(...times).toFixed(1)} ms)`);

// The group with the best first match leads.
const f = q => JSON.stringify(first(q));
ok(first('novo')?.kind === 'company' && first('novo').label === 'Novo Nordisk', `"novo" opens with Novo Nordisk (${f('novo')})`);
ok(first('glp')?.kind === 'type' && first('glp').label === 'GLP-1', `"glp" opens with the type GLP-1 (${f('glp')})`);
ok(first('heart')?.kind === 'disease' && first('heart').label.toLowerCase() === 'heart failure', `"heart" opens with heart failure (${f('heart')})`);
ok(first('HRS')?.kind === 'drug' && /^HRS|ribupatide/i.test(first('HRS').label), `"HRS" opens with Hengrui's drugs (${f('HRS')})`);
ok(first('g')?.kind !== 'disease', '"g" does not open with a disease over hand-checked types, drugs and companies');

// Inside a kind: starts-with before word-start, then hand-checked, then active trials.
const nv = g('novo', 'company');
const lv = nv.map(c => key(c.label).startsWith('novo') ? 3 : 2);
ok(lv.every((l, i) => !i || l <= lv[i - 1]), `"novo" companies: names starting with it come first (${nv.slice(0, 4).map(c => c.label).join(', ')})`);
const hrs = g('HRS', 'drug');
const firstAuto = hrs.findIndex(d => !d.hand), lastHand = hrs.map(d => d.hand).lastIndexOf(true);
ok(firstAuto === -1 || lastHand < firstAuto || !key(hrs[lastHand].label).startsWith('hrs'), `"HRS" drugs: hand-checked before automatic (${hrs.slice(0, 5).map(d => d.label + (d.hand ? ' ✓' : '')).join(', ')})`);
const hf = g('heart', 'disease');
ok(hf.slice(0, 3).every(d => d.active > 0) && hf[0].label.toLowerCase() === 'heart failure', `diseases: the condition most trials list comes first (${hf.slice(0, 3).map(d => d.label + ' ' + d.active).join(', ')})`);

// Duplicates merged.
const inc = g('inclisiran', 'drug').filter(d => drugKey(d.label) === 'inclisiran' || /kjx839/i.test(d.label));
ok(inc.length === 1, `inclisiran shows once (${g('inclisiran', 'drug').map(d => d.label).join(', ')})`);
ok(!g('kjx839', 'drug').some(d => /^kjx839$/i.test(d.label)), 'code KJX839 (registered as "Inclisiran") folds into inclisiran');
const hfLabels = g('heart failure', 'disease').map(d => d.label.toLowerCase());
ok(new Set(hfLabels).size === hfLabels.length, 'disease case variants shown once');
ok(g('hfpef', 'disease').some(d => /preserved ejection fraction/i.test(d.label)), 'typing the acronym HFpEF finds heart failure with preserved ejection fraction');
ok(g('ozempic', 'drug')[0]?.label === 'semaglutide' && g('ozempic', 'drug')[0]?.also === 'Ozempic', 'brand name Ozempic finds semaglutide, shown as "also Ozempic"');
ok(!g('novo', 'company').some(c => /novo nordisk/i.test(c.label) && !c.hand), 'registry spellings of Novo Nordisk fold into the hand-checked company');
ok(!g('glp', 'disease').some(d => key(d.label) === 'glp1'), 'GLP-1 listed as a trial condition shows once, as a type');

// What a pick does, and what is left out.
ok(g('novo', 'company')[0]?.href === '/companies/novonordisk' || /^\/companies\//.test(g('novo', 'company')[0]?.href), 'companies link to their page');
ok(/^\/drugs\//.test(g('HRS', 'drug')[0]?.href) && g('heart', 'disease')[0]?.q && g('glp', 'type')[0]?.q, 'drugs link to their page; diseases and types carry a search');
ok(['g', 'heart', 'novo', 'HRS'].every(q => g(q, 'drug').every(d => d.hand || d.active > 0)), 'automatic drugs with no active trials are left out');
ok(!g('novo', 'disease').length, 'conditions with no active trials ("de Novo ...") are left out');
ok(g('sglt', 'type')[0]?.label === 'SGLT2 inhibitors' && g('sglt', 'type')[0]?.q === 'sglt2 inhibitors', 'SGLT2 inhibitors run the class search, not the -gliflozin name search');
const { heading } = await import('../src/suggest.js');
ok(heading('sglt2') === 'SGLT2 inhibitors' && heading('glp-1 gip') === 'GLP-1 / GIP' && heading('statin') === 'Statins' && heading('heart failure') === 'Heart failure', `type searches are headed by the type's name (${['sglt2', 'glp-1 gip', 'statin', 'heart failure'].map(heading).join(', ')})`);
ok(suggest('').groups.length === 0 && suggest('xyzzyq').groups.length === 0, 'empty or unmatched input gives no list');
ok(first('car-t')?.kind === 'type' && /CAR-T/.test(first('car-t').label), `"car-t" opens with CAR-T, not cartilage (${f('car-t')})`);
ok(first('inclis')?.kind === 'drug', `"inclis" opens with the drug, not a condition named after it (${f('inclis')})`);

// Registry names that describe instead of naming a drug (src/ingest/link.js autoName).
ok(!g('am', 'drug').some(d => d.label === 'AMG'), 'Amgen codes stay apart ("AMG 404"), not one drug called "AMG"');
ok(!g('gu', 'drug').some(d => /guideline/i.test(d.label)) && !g('st', 'drug').some(d => /^standard of care/i.test(d.label)), 'standard care is not a drug');
ok(!g('neratinib', 'drug').some(d => /in combination with/i.test(d.label)), 'a combination is listed under its own drug ("Neratinib ... in combination with capecitabine")');
ok(!g('inclis', 'disease').some(d => /inclisiran/i.test(d.label)) && !g('ivon', 'disease').length, 'drug names listed as trial conditions are not suggested as diseases');
ok(!g('sta', 'drug').some(d => /gonal/i.test(d.label)) && !g('keytruda', 'drug').some(d => d.label.toLowerCase() === 'keytruda' && !/merck/i.test(d.company)), 'another company\'s drug bought for comparison ("United States -Gonal-f", Keytruda) is not listed as the trial sponsor\'s drug');
if (!HAS_CHECKED_DATA) skip('licensee and own-product rows'); else ok(drug('auto:motixafortide|guangzhougloriabiosciencescoltd') && drug('auto:amlodipinebesylateandfolicacid|shenzhenausapharmedcoltd'), 'a licensee\'s drug named with its background ("Motixafortide+G-CSF") and a sponsor\'s own tablet of two generics each have a row');
const km04 = drug('auto:km04|xentriainc'), prolia = drug('auto:prolia|amgen');
ok(km04?.copy_of[0]?.name === 'Gonal-F' && prolia?.copies.some(c => /CT-P41/.test(c.name)), `copies connect to the original: KM04 is a copy of ${km04?.copy_of[0]?.name}; Prolia lists ${prolia?.copies.length} copies tested against it`);
