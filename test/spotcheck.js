// Checks the five tools against the hand-built obesity ground truth (bakeoff/C_ground_truth.md, 6 Nov 2026).
// Run: npm run check   (set TODAY=2026-11-06 to reproduce the original numbers)
import { landscape, search, trials, catalysts, whoRunsTrials, storedTargets } from '../src/query.js';
import { norm, getDb } from '../src/db.js';
import { HAS_CHECKED_DATA, skip } from './private.js';

// The 94 distinct programs in active Phase 2+ industry obesity trials (97 listed, minus 3 duplicates found later).
const GROUND_TRUTH = ['ABBV-295', 'ACCG-2671', '(S)-pindolol benzoate', 'ALN-2232', 'ALN-4324', 'ALV-100', 'maridebart cafraglutide', 'AT673', 'APH-012', 'ARO-ALK7', 'ARO-INHBE', 'ASC30',
  'elecoglipron', 'lenbelintide', 'AZD9550', 'zovaglutide', 'ZT006', 'BGE-102', 'taldefgrobep alfa', 'NA-931', 'BIO101', 'BI 3034701', 'BMB-101', 'BGM0504', 'BGM1812', 'SYH2069', 'DA-302168S',
  'CSTI-500', 'ERX1000', 'ECC4703', 'NKS-3', 'bimagrumab', 'eloralintide', 'mazdutide', 'LY3457263', 'LY3532226', 'LY3549492', 'LY4086940', 'macupatide', 'orforglipron', 'retatrutide',
  'tirzepatide', 'EMP16', 'HRS-4729', 'HRS9531', 'HRS-7535', 'bofanglutide', 'aleniglipron', 'RAY1225', 'GUB-UCN2', 'IN-B00009', 'ecnoglutide', 'HDM1002', 'HDM1005', 'HDM1702', 'HM15275',
  'pitolisant', 'RO7204239', 'MOTS-c', 'RN3161', 'TE-8105', 'KBP-336', 'LUM-201', 'MKP10241', 'MDR-001', 'KDS2010', 'cagrilintide', 'CagriSema', 'amycretin', 'NNC0519-0130', 'NNC0662-0419',
  'semaglutide', 'UBT251', 'bremelanotide', 'MET-097i', 'PF-08653945', 'garetosmab', 'trevogrumab', 'mibavademab', 'olatorepatide', 'ALN-CIDEB', 'setmelanotide', 'bivamelagon', 'RM-718',
  'S1B-509', 'MWN109', 'SRSD384', 'GL0034', 'THDBH120', 'enobosarm', 'VK2735 (injectable)', 'VK2735 (oral)', 'VCT220', 'WVE-007'];

const L = landscape({ area: 'obesity', phase_min: 2 });
const index = new Map();
for (const p of L.programs) for (const n of [p.drug, ...p.aliases.map(a => a.name)]) index.set(norm(n), p);
// Known, explained differences: NNC0519-0130's only active trial (NCT06717698) is in chronic kidney disease;
// ClinicalTrials.gov's fuzzy "obesity" search matched it on eligibility text, we match on conditions and titles only.
const KNOWN_MISSES = new Set(['NNC0519-0130']);
// Trials end: a drug whose obesity trials have all ended since 6 Nov 2026 drops out of the landscape, as it should.
const ACTIVE = `('RECRUITING','NOT_YET_RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION')`;
const stillInObesity = getDb().prepare(`SELECT count(*) FROM program p JOIN trial_program tp ON tp.program_id = p.id JOIN trial t ON t.nct = tp.nct
  WHERE lower(p.name) = lower(?) AND t.status IN ${ACTIVE} AND lower(t.conditions || ' ' || t.title) LIKE '%obes%'`).pluck();
const ended = g => !stillInObesity.get(g);
const found = [], missing = [];
for (const g of GROUND_TRUTH) {
  const key = norm(g.replace(/\s*\((injectable|oral)\)/, ''));
  (index.has(key) ? found : missing).push(g);
}
const gtKeys = new Set(GROUND_TRUTH.map(g => norm(g.replace(/\s*\((injectable|oral)\)/, ''))));
const extra = L.programs.filter(p => ![p.drug, ...p.aliases.map(a => a.name)].some(n => gtKeys.has(norm(n))));

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
console.log(`\nlandscape("obesity", phase_min=2): ${L.summary}`);
console.log(`Ground truth: ${GROUND_TRUTH.length} programs (VK2735 counted twice there; merged into one row here).`);
const endedMisses = missing.filter(m => !KNOWN_MISSES.has(m) && ended(m));
ok(missing.every(m => KNOWN_MISSES.has(m) || endedMisses.includes(m)), `recall ${found.length}/${GROUND_TRUTH.length}${missing.length ? '; missing: ' + missing.join(', ') + ' (explained: NNC0519-0130\'s only active trial is in kidney disease' + (endedMisses.length ? '; trials ended since 6 Nov: ' + endedMisses.join(', ') : '') + ')' : ''}`);
console.log(`      extra programs not in ground truth (${extra.length}): ${extra.map(p => `${p.drug} [${p.company}, ${p.phase.label}${p.curated ? '' : ', unreviewed'}]`).join('; ') || 'none'}`);

// Alias merges from the ground truth
const one = (alias, expect) => { const p = index.get(norm(alias)); ok(p && p.drug === expect, `alias ${alias} -> ${p ? p.drug : 'nothing'} (expected ${expect})`); };
one('LY3305677', 'mazdutide'); one('IBI362', 'mazdutide'); one('XW003', 'ecnoglutide'); one('GZR18', 'bofanglutide');
one('bofanglutida', 'bofanglutide'); one('KAI-7535', 'HRS-7535'); one('AZD5004', 'elecoglipron'); one('zenagamtide', 'amycretin');
one('PF-08653944', 'berobenatide'); one('LY3841136', 'eloralintide');
const maz = L.programs.find(p => p.drug === 'mazdutide');
ok(maz && maz.company.includes('Innovent') && maz.company.includes('Lilly'), `mazdutide merges Lilly and Innovent trials (${maz?.trials.active} active trials)`);
const ale = L.programs.find(p => p.drug === 'aleniglipron');
ok(ale && ale.company === 'Structure Therapeutics', 'aleniglipron sponsored by "Gasherbrum Bio" is credited to Structure Therapeutics');

// Every program has a source for its phase and its next catalyst
ok(L.programs.every(p => p.phase.source && p.lead_trial.url), 'every program has a phase source and a lead trial link');
ok(L.programs.every(p => !p.next_catalyst || p.next_catalyst.url), 'every next catalyst has a source link');

// search
const s = search({ query: 'IBI362' });
ok(s.drugs[0]?.name === 'mazdutide', `search("IBI362") -> ${s.drugs[0]?.name}`);
const s2 = search({ query: 'Hengrui' });
ok(s2.drugs.some(d => d.name === 'ribupatide') || s2.companies.length > 0, `search("Hengrui") -> ${s2.companies.slice(0, 3).map(c => c.name).join('; ')}`);

// trials
const t = trials({ area: 'obesity', phase: 2, sponsor: 'Lilly', status: 'active', limit: 5 });
ok(t.count > 30, `trials(obesity, phase>=2, sponsor Lilly, active): ${t.count} trials`);
const t2 = trials({ drug: 'mazdutide', status: 'active' });
ok(t2.trials.some(x => x.sponsor.includes('Innovent')) && t2.trials.some(x => x.sponsor.includes('Lilly')), `trials(drug=mazdutide) spans Lilly and Innovent: ${t2.count} active trials`);

// catalysts
const c = catalysts({ days_ahead: 60, area: 'obesity' });
ok(c.catalysts.length > 0 && c.catalysts.every(x => x.source), `catalysts(60 days, obesity): ${c.count}; first: ${c.catalysts.slice(0, 3).map(x => `${x.label} ${x.drug}`).join('; ')}`);

// who runs trials
const w = whoRunsTrials({ area: 'obesity', phase: 2 });
ok(w.sponsors[0]?.sponsor.includes('Lilly'), `who_runs_trials(obesity, phase 2+): top sponsors ${w.sponsors.slice(0, 3).map(x => `${x.sponsor} (${x.active_trials})`).join(', ')}`);
const wc = whoRunsTrials({ area: 'obesity', phase: 2, country: 'China' });
ok(wc.sites.length > 0 && wc.sites.every(x => x.country === 'China'), `who_runs_trials(obesity, phase 2+, China): top site ${wc.sites[0]?.facility} (${wc.sites[0]?.active_trials} trials)`);

// A row may also be found by the target readers stored for it (src/targets.js): it shows, marked as not hand-checked.
const storedAs = (p, ...names) => names.every(n => (storedTargets().byRow.get(p.id) || []).some(g => g.name === n));
if (!HAS_CHECKED_DATA) skip('PD-1/VEGF and in vivo CAR-T areas');
else {
// ---------- hand-checked areas added 6 Nov 2026 (seed/pd1-vegf.js, seed/invivo-cart.js) ----------
const progIndex = L2 => { const m = new Map(); for (const p of L2.programs) for (const n of [p.drug, ...p.aliases.map(a => a.name)]) m.set(norm(n), p); return m; };

// PD-(L)1 x VEGF: the 16 programs found by hand (registry + company sources), all Phase 1 or later.
const PV = landscape({ area: 'PD-1/VEGF', phase_min: 1 });
const pvIdx = progIndex(PV);
const PV_TRUTH = ['ivonescimab', 'pumitamig', 'PF-08634404', 'MK-2010', 'RC148', 'JS207', 'SCTB14', 'HB0025', 'HLX37', 'B1962', 'AXN-2510', 'AI-081', 'CR-001', 'OTP-01', 'CS2009', 'GB268'];
console.log(`\nlandscape("PD-1/VEGF", phase_min=1): ${PV.summary}`);
const pvMissing = PV_TRUTH.filter(d => !pvIdx.has(norm(d)));
ok(!pvMissing.length, `PD-1/VEGF recall ${PV_TRUTH.length - pvMissing.length}/${PV_TRUTH.length}${pvMissing.length ? '; missing: ' + pvMissing.join(', ') : ''}`);
ok(PV.programs.every(p => p.curated || storedAs(p, 'PD-1', 'VEGF')), `PD-1/VEGF: no unreviewed rows other than ones whose trials say PD-1 + VEGF (${PV.programs.filter(p => !p.curated).map(p => p.drug).join(', ') || 'none'})`);
for (const [a, d] of [['AK112', 'ivonescimab'], ['SMT112', 'ivonescimab'], ['BNT327', 'pumitamig'], ['PM8002', 'pumitamig'], ['BMS-986545', 'pumitamig'], ['SSGJ-707', 'PF-08634404'], ['LM-299', 'MK-2010'], ['IMM2510', 'AXN-2510']]) {
  const p = pvIdx.get(norm(a)); ok(p && p.drug === d, `alias ${a} -> ${p ? p.drug : 'nothing'} (expected ${d})`);
}
const ivo = PV.programs.find(p => p.drug === 'ivonescimab');
ok(ivo && ivo.company.includes('Akeso') && ivo.company.includes('Summit') && ivo.phase.label === 'Approved (China)', `ivonescimab: ${ivo?.company}, ${ivo?.phase.label}`);
ok(ivo?.next_catalyst?.date === '2026-11-14' && ivo.next_catalyst.url, `ivonescimab next catalyst: ${ivo?.next_catalyst?.label} ${ivo?.next_catalyst?.what}`);
ok(PV.programs.find(p => p.drug === 'JS207')?.trials.active > 0, 'JS207 has active trials (Junshi registers as sponsor type "Other"; loaded by curated.js)');
ok(!PV.programs.some(p => /hs-?20117|bispecific antibody$|vegf antibody$/i.test(p.drug)), 'HS-20117 (EGFR x MET) and unnamed partner antibodies are not in the area');
ok(PV.programs.every(p => p.phase.source && p.lead_trial.url && (!p.next_catalyst || p.next_catalyst.url)), 'PD-1/VEGF: every row has a phase source, lead trial and catalyst link');

// In vivo CAR-T: the 15 programs with a company-linked, phased registry trial on 6 Nov 2026.
const IV = landscape({ area: 'in vivo CAR-T', phase_min: 1 });
const ivIdx = progIndex(IV);
const IV_TRUTH = ['KLN-1010', 'CPTX2309', 'UB-VV111', 'INT2104', 'ESO-T01', 'VV169', 'BMS-986553', 'HN2301', 'RXIM002', 'CRT-402', 'PIC1', 'PICX', 'PID23', 'SL1CC', 'Arnovie101'];
console.log(`\nlandscape("in vivo CAR-T", phase_min=1): ${IV.summary}`);
const ivMissing = IV_TRUTH.filter(d => !ivIdx.has(norm(d)));
ok(!ivMissing.length, `in vivo CAR-T recall ${IV_TRUTH.length - ivMissing.length}/${IV_TRUTH.length}${ivMissing.length ? '; missing: ' + ivMissing.join(', ') : ''}`);
ok(IV.programs.every(p => p.curated), `in vivo CAR-T: no unreviewed rows (${IV.programs.filter(p => !p.curated).map(p => p.drug).join(', ') || 'none'})`);
const eso = IV.programs.find(p => p.drug === 'ESO-T01');
ok(eso && eso.phase.label === 'Early Phase 1' && eso.company.includes('AstraZeneca'), `ESO-T01 linked through the hospital-run study with Pregene as collaborator: ${eso?.phase.label}, ${eso?.company}`);
ok(!IV.programs.some(p => /vnx-?101|mt-?30[234]/i.test(p.drug)), 'VNX-101 (T-cell engager) and MT-30x (myeloid CAR) are not in the area');
ok(IV.programs.every(p => p.phase.source && p.lead_trial.url), 'in vivo CAR-T: every row has a phase source and lead trial link');
}

// ---------- open disease search (not hand-checked): heart failure, 6 Nov 2026 ----------
// Stage comes from the drug's trials in this search, not from an approval for another use; sponsors' keyword tags don't match.
const HF = landscape({ area: 'heart failure', phase_min: 2 });
console.log(`\nlandscape("heart failure", phase_min=2): ${HF.summary}`);
ok(!HF.programs.some(p => /resmetirom/i.test(p.drug)), 'resmetirom (approved for MASH, Phase 1 in heart failure) is not in heart failure Phase 2+');
ok(!HF.programs.some(p => /inclisiran/i.test(p.drug)), 'inclisiran (child cholesterol trial only tagged "Heart Failure") is not in heart failure');
// Other names for the same disease: NCT06119581 (olomorasib) says only "non-small cell lung cancer", never "NSCLC".
const N1 = landscape({ area: 'nsclc', limit: 5000 }), N2 = landscape({ area: 'Non-small cell lung cancer', limit: 5000 });
ok(N1.programs.some(p => p.trials.ncts.includes('NCT06119581')), '"nsclc" finds trials that write the full name (olomorasib, NCT06119581)');
ok(N1.programs.length === N2.programs.length, `"nsclc" and "non-small cell lung cancer" give the same rows (${N1.programs.length}, ${N2.programs.length})`);
const tuc = N1.programs.find(p => p.drug.toLowerCase() === 'tucatinib');
ok(tuc && tuc.phase.level < 4, `tucatinib is not "marketed" for lung cancer because of a continuation study (${tuc?.phase.label})`);
ok(N1.programs.some(p => p.trials.ncts.includes('NCT06875310')), 'adagrasib: a Phase 3 run by Mirati (now Bristol) is linked (NCT06875310)');
const empa = HF.programs.find(p => /^empagliflozin$/i.test(p.drug));
ok(empa && empa.phase.label === 'Phase 3' && empa.phase.other_use?.label === 'FDA-approved (any use)', `empagliflozin: stage ${empa?.phase.label}, approval shown as a note (${empa?.phase.other_use?.label})`);

// ---------- plain-English context (src/explain.js) ----------
const { stemOf } = await import('../src/explain.js');
const { drug } = await import('../src/query.js');
ok(HF.programs.every(p => p.tested_for.length && p.explain), 'heart failure: every row says what it is tested for and carries an explanation (or none)');
ok(empa?.explain.source === 'fda' && /kidneys/.test(empa.explain.plain), `empagliflozin explained from its FDA class: ${empa?.explain.term}`);
const mari = HF.programs.find(p => p.drug === 'maridebart cafraglutide');
ok(mari?.explain.source === 'hand' && /GLP-1/.test(mari.explain.plain), 'maridebart cafraglutide explained from its hand-checked mechanism');
ok(stemOf('Finerenone')?.stem === 'renone' && stemOf('Ziltivekimab')?.stem === 'mab' && stemOf('Vericiguat suspension')?.stem === 'ciguat', 'name stems: finerenone -renone, ziltivekimab -mab, vericiguat suspension -ciguat');
ok(!stemOf('Baxdrostat and dapagliflozin') && !stemOf('HRS-1893') && !stemOf('Supplement'), 'no stem for combinations, codes or ordinary words');
const crd = drug('auto:crd4730|cardurionpharmaceuticalsinc');
ok(!crd || (crd.summary?.url && crd.tested_for.length), `drug page: sponsor's summary quoted with its trial link (${crd?.summary?.nct || 'drug not in this load'})`);

// ---------- type searches find automatic drugs by their class (src/explain.js CLASSES), 7 Nov 2026 ----------
// Before: "glp-1" found 31 drugs, none automatic; "sglt2" 5 (3 of them GLP-1 drugs from a trial title); "statins" 2, neither a statin.
// 8 Nov 2026: sglt2 13 -> 9 and statins 5 -> 4: other companies' drugs in Phase 4 comparisons left (JW's empagliflozin
// combinations are Boehringer's, Boryung's dapagliflozin combinations AstraZeneca's, EMS's rosuvastatin AstraZeneca's).
const G = landscape({ area: 'glp-1', phase_min: 2 });
const auto = L2 => L2.programs.filter(p => !p.curated);
console.log(`\nlandscape("glp-1", phase_min=2): ${G.programs.length} drugs, ${auto(G).length} automatic: ${auto(G).map(p => p.drug).join(', ')}`);
ok(G.programs.filter(p => p.curated).length >= 31 && ['liraglutide', 'dulaglutide'].every(d => auto(G).some(p => norm(p.drug) === d)), 'glp-1: hand-checked GLP-1 drugs plus automatic liraglutide and dulaglutide');
const S2 = landscape({ area: 'sglt2', phase_min: 2 });
console.log(`landscape("sglt2", phase_min=2): ${S2.programs.length} drugs: ${S2.programs.map(p => p.drug).join(', ')}`);
// 8 Nov 2026, cleanup step 4: 9 -> 8, "Baxdrostat and dapagliflozin" is now one row with "Baxdrostat/dapagliflozin".
ok(S2.programs.length >= 8 && S2.programs.every(p => /gliflozin/i.test(p.drug) || storedAs(p, 'SGLT2')), `sglt2: ${S2.programs.length} drugs, every one an SGLT2 inhibitor (by name or stored target) or a combination with one`);
ok(['empagliflozin', 'dapagliflozin', 'sotagliflozin'].every(d => S2.programs.some(p => norm(p.drug) === d)) && S2.programs.some(p => /\//.test(p.drug)), 'sglt2: empagliflozin, dapagliflozin, sotagliflozin and combinations');
// "SGLT2 inhibitors" is the drug class only; "sglt2" also finds rows by stored target (DA5221-T1, whose trial says "SGLT-2 inhibitor").
const S2I = landscape({ area: 'SGLT2 inhibitors', phase_min: 2 }).programs.map(p => p.id);
ok(S2I.length >= 8 && S2I.every(id => S2.programs.some(p => p.id === id)) && S2.programs.every(p => S2I.includes(p.id) || storedAs(p, 'SGLT2')), '"SGLT2 inhibitors" finds the same drugs as "sglt2", apart from rows found by stored target');
const ST = landscape({ area: 'statins', phase_min: 2 });
console.log(`landscape("statins", phase_min=2): ${ST.programs.length} drugs: ${ST.programs.map(p => p.drug).join(', ')}`);
// 8 Nov 2026: statins 4 -> 3: Hyundai Pharm's Candesartan/Rosuvastatin/Ezetimibe is only in the control arms of its own trial (usedOnlyAsControl).
// 8 Nov 2026, later: 3 -> 2: AstraZeneca's rosuvastatin (Crestor) is only a background statin, comparator or DDI probe in its active trials (read verdict backbone, seed/row-verdicts.csv).
ok(ST.programs.length >= 2 && ST.programs.every(p => /vastatin/i.test(p.drug)), `statins: ${ST.programs.length} drugs, every one a statin or a combination with one`);
const st1 = landscape({ area: 'statin', phase_min: 2 });
ok(ST.programs.every(p => st1.programs.some(x => x.id === p.id)), `"statin" finds every drug "statins" finds (${st1.programs.length} drugs; also names containing "statin", e.g. somatostatin drugs)`);

// Labels checked drug by drug for every class, 7 Nov 2026: names that end like a stem but are another kind of thing.
const { classOf } = await import('../src/explain.js');
ok(!auto(G).some(p => /apraglutide|glepaglutide|elsiglutide|teduglutide/i.test(p.drug)), 'glp-1: GLP-2 drugs (apraglutide, glepaglutide) are not listed as GLP-1');
ok(classOf({ name: 'apraglutide' }) === 'glp_analogue' && classOf({ name: 'brexpiprazole' }) === null && classOf({ name: 'Aricept' }) === null && classOf({ name: 'Sprycel' }) === null && classOf({ name: 'drospirenone' }) === null,
  'not classed by name ending: GLP-2 drugs as GLP-1, brexpiprazole as an acid blocker, brands Aricept and Sprycel, drospirenone');
ok(classOf({ name: 'tirbanibulin', epc: 'Microtubule Inhibitor' }) === null && classOf({ name: 'docetaxel', epc: 'Microtubule Inhibitor' }) === 'taxane', "FDA's broad microtubule class counts as a taxane only for -taxel drugs");
ok(classOf({ name: 'palbociclib', epc: 'Kinase Inhibitor' }) === 'cdk', 'palbociclib (FDA: kinase inhibitor) is found as a CDK inhibitor');
ok(['tofacitinib', 'baricitinib', 'abrocitinib', 'ritlecitinib'].every(n => classOf({ name: n }) === 'jak') && classOf({ name: 'imatinib' }) === 'kinase', '-citinib drugs are JAK inhibitors; other -tinib drugs stay kinase inhibitors');
const J = landscape({ area: 'jak inhibitors', phase_min: 2 });
console.log(`landscape("jak inhibitors", phase_min=2): ${J.programs.length} drugs: ${J.programs.map(p => p.drug).join(', ')}`);
ok(classOf({ name: 'filgotinib' }) === 'jak' && classOf({ name: 'tofacitinib', epc: 'Janus Kinase Inhibitor' }) === 'jak' && classOf({ name: 'zanubrutinib', epc: 'Kinase Inhibitor' }) === 'btk', 'filgotinib (named by hand) and tofacitinib are JAK inhibitors; zanubrutinib is a BTK inhibitor');
const BT = landscape({ area: 'btk inhibitors', phase_min: 2 });
console.log(`landscape("btk inhibitors", phase_min=2): ${BT.programs.length} drugs: ${BT.programs.map(p => p.drug).join(', ')}`);
ok(BT.programs.some(p => /^ibrutinib$/i.test(p.drug)) && BT.programs.every(p => /brutinib/i.test(p.drug)), 'btk inhibitors: ibrutinib included; every drug is a -brutinib drug or a combination with one');
ok(landscape({ area: 'kinase inhibitors', phase_min: 2 }).programs.some(p => /brutinib/i.test(p.drug)), 'kinase inhibitors still include BTK inhibitors');
ok(['lovastatin', 'losartan', 'amrubicin'].every(n => classOf({ name: n })) && classOf({ name: 'ibrutinib' }) === 'btk', 'short names: lovastatin, losartan, amrubicin get their class; ibrutinib is named by hand');
