// Plain-English "what is this drug" lines. No generated text: every line here is hand-written and reused
// wherever its drug class appears. A drug gets its line from the first source that applies:
//   1. hand-checked mechanism (drug table, checked against sources by hand)
//   2. FDA's established pharmacologic class from the drug's US label (openFDA)
//   3. the drug's name stem, from WHO's INN stem book (2024): -gliflozin, -siran, -mab ...
// If none applies the drug is "not classified yet" and the drug page shows the sponsor's own words instead.

export const STEM_BOOK = 'https://www.who.int/teams/health-product-and-policy-standards/inn/stembook';

// Hand-written explainers, one per drug class. Keep each to one or two short sentences a non-biologist can read.
const PLAIN = {
  glp1: 'Copies GLP-1, a gut hormone released after meals that lowers appetite and blood sugar. Same family as Ozempic and Wegovy.',
  glp_analogue: 'Copies GLP-1 or GLP-2, gut hormones. GLP-1 copies (like Ozempic) lower appetite and blood sugar; GLP-2 copies help the gut absorb food.',
  glp1_oral: 'A pill that switches on the GLP-1 receptor, the target of Ozempic and Wegovy, to lower appetite and blood sugar.',
  glp1_gip: 'Copies two gut hormones, GLP-1 and GIP, to lower appetite and blood sugar. Same approach as Mounjaro and Zepbound.',
  glp1_glucagon: 'Copies two hormones: GLP-1, which lowers appetite and blood sugar, and glucagon, which makes the body burn more energy.',
  glp1_gip_glucagon: 'Copies three hormones at once: GLP-1 and GIP lower appetite and blood sugar, and glucagon makes the body burn more energy.',
  glp1_gipr_block: 'Copies GLP-1, a gut hormone that lowers appetite and blood sugar, and blocks the receptor for GIP, another gut hormone.',
  glp1_amylin: 'Copies two hormones released after meals, GLP-1 and amylin, which both make people feel full sooner.',
  amylin: 'Copies amylin, a hormone released with insulin after meals that makes people feel full sooner.',
  mc4r: 'Switches on MC4R, a receptor in the brain that controls hunger.',
  muscle: 'Blocks signals (myostatin or activin) that limit muscle growth, so people keep muscle while losing fat.',
  sirna: 'A short strand of RNA that switches off one gene, so the body makes less of one protein.',
  pd1_vegf: 'A cancer drug that hits two targets at once: it releases a brake on the immune system (PD-1 or PD-L1) and starves the tumour of blood vessels (VEGF).',
  pd1_vegf_ctla4: 'A cancer drug that hits three targets: two brakes on the immune system (PD-1 and CTLA-4) and VEGF, which feeds the tumour\'s blood vessels.',
  invivo_cart: 'Reprograms the patient\'s own immune T cells, inside the body, to hunt one kind of cell, such as cancerous B cells. Standard CAR-T does this in a lab.',
  thr_beta: 'Acts like thyroid hormone, mainly in the liver, where it speeds up the burning of fat.',
  nlrp3: 'Blocks NLRP3, a switch inside cells that sets off inflammation.',
  antibody: 'An antibody: a lab-made immune protein built to latch onto one target in the body.',
  multi_antibody: 'An antibody built to latch onto two or more targets at once.',
  antibody_fragment: 'A piece of an antibody, a lab-made immune protein that latches onto one target.',
  kinase: 'Blocks a kinase, an enzyme that passes "grow" or "activate" signals inside cells. Most are cancer drugs.',
  cdk: 'Blocks CDK enzymes that let cells divide, to slow the growth of cancer cells.',
  parp: 'Blocks PARP, an enzyme cancer cells use to repair their DNA, so the damaged cancer cells die.',
  pi3k: 'Blocks PI3K, an enzyme that passes growth signals inside cells. Mostly used against cancer.',
  sglt2: 'Makes the kidneys flush extra sugar and salt into the urine. Started as a diabetes drug; now also used for heart and kidney disease.',
  arb: 'Blocks the effect of angiotensin II, a hormone that narrows blood vessels. Lowers blood pressure.',
  ace: 'Stops the body making angiotensin II, a hormone that narrows blood vessels. Lowers blood pressure.',
  beta_blocker: 'Blocks adrenaline\'s effect on the heart, slowing it down and lowering blood pressure.',
  statin: 'Lowers cholesterol by blocking an enzyme the liver uses to make it.',
  receptor_decoy: 'A decoy protein that soaks up a signal molecule before it can reach the body\'s cells.',
  platinum: 'Platinum-based chemotherapy: damages the DNA of fast-dividing cancer cells.',
  taxane: 'Taxane chemotherapy: stops cancer cells from dividing.',
  anthracycline: 'Anthracycline chemotherapy: damages the DNA of cancer cells.',
  topo1: 'Chemotherapy that blocks topoisomerase I, an enzyme cells need to copy their DNA.',
  anticoagulant: 'A blood thinner: blocks a clotting protein to prevent blood clots.',
  ppi: 'Lowers stomach acid.',
  sgc: 'Boosts a chemical signal (cGMP) that relaxes blood vessels and eases strain on the heart.',
  mra: 'Blocks aldosterone, a hormone that makes the body hold on to salt and water and can scar the heart and kidneys.',
  dpp4: 'Helps the body keep more of its own GLP-1, a gut hormone, to lower blood sugar.',
  endothelin: 'Blocks endothelin, a signal that tightly narrows blood vessels.',
  cell_therapy: 'A cell therapy: living cells given to the patient as the treatment.',
  gene_therapy: 'A gene therapy: delivers a gene into the patient\'s cells so they make a protein they lack.',
  vegf: 'Blocks VEGF, a signal that makes new blood vessels grow. Used against cancer and some eye diseases.',
  btk: 'Blocks BTK, an enzyme B cells (a type of immune cell) need to grow and work. Used against some blood cancers and immune diseases.',
  jak: 'Blocks JAK enzymes that pass on immune signals, to calm an overactive immune system.',
  corticosteroid: 'A steroid that calms inflammation and the immune system.',
  hdac: 'Blocks HDAC enzymes, which changes which genes are switched on in cancer cells.',
  androgen: 'Blocks the male hormone testosterone from acting on cells. Used mainly against prostate cancer.',
  pd1: 'Releases a brake on the immune system (PD-1 or PD-L1) so it attacks cancer cells.',
  ctla4: 'Releases a brake on the immune system (CTLA-4) so it attacks cancer cells.',
  il6: 'Blocks interleukin-6, a signal that drives inflammation.',
  bcl2: 'Blocks BCL-2, a protein that keeps cancer cells alive.',
  complement: 'Blocks part of the complement system, a branch of the immune system that can attack the body\'s own cells.',
  aromatase: 'Stops the body making oestrogen. Used against breast cancer that oestrogen feeds.',
  estrogen: 'Blocks oestrogen from acting on cells. Used against breast cancer that oestrogen feeds.',
  her2: 'Blocks HER2, a growth signal on some breast and stomach cancer cells.',
  cd20: 'An antibody that marks B cells (a type of immune cell) for destruction. Used in blood cancers and autoimmune disease.',
  antisense: 'A short strand of genetic material that blocks one gene\'s message, so the body makes less of one protein.',
};

// 1. Hand-checked mechanism labels -> class. First match wins, so combinations come before single targets.
const MECH = [
  [/CTLA-4/i, 'pd1_vegf_ctla4'],
  [/PD-?L?1.*VEGF/i, 'pd1_vegf'],
  [/CAR/, 'invivo_cart'],
  [/siRNA/i, 'sirna'],
  [/GIPR antagonist/i, 'glp1_gipr_block'],
  [/amylin.*GLP-1|GLP-1.*amylin/i, 'glp1_amylin'],
  [/(GLP-1.*GIP.*glucagon|GIP.*GLP-1.*glucagon)/i, 'glp1_gip_glucagon'],
  [/GLP-1.*glucagon/i, 'glp1_glucagon'],
  [/GLP-1.*GIP|GIP.*GLP-1/i, 'glp1_gip'],
  [/oral small-molecule GLP-1/i, 'glp1_oral'],
  [/^(long-acting )?GLP-1\b(?!.*(\/|\+))/i, 'glp1'],
  [/amylin/i, 'amylin'],
  [/MC4R/i, 'mc4r'],
  [/myostatin|activin/i, 'muscle'],
  [/THR-beta/i, 'thr_beta'],
  [/NLRP3/i, 'nlrp3'],
];

// 2. FDA established pharmacologic classes -> class. An optional third entry: the drug's name must match it too.
const EPC = [
  [/Sodium-Glucose Cotransporter 2 Inhibitor/i, 'sglt2'],
  [/GLP-1 Receptor Agonist/i, 'glp1'],
  [/Soluble Guanylate Cyclase Stimulator/i, 'sgc'],
  [/Aldosterone Antagonist|Mineralocorticoid Receptor Antagonist/i, 'mra'],
  [/Thyroid Hormone Receptor beta Agonist/i, 'thr_beta'],
  [/Janus Kinase Inhibitor/i, 'jak'],
  [/Cyclin-dependent Kinase|CDK/i, 'cdk'],
  [/Poly\(ADP-Ribose\) Polymerase Inhibitor/i, 'parp'],
  [/Kinase Inhibitor/i, 'kinase'],
  [/Corticosteroid/i, 'corticosteroid'],
  [/Histone Deacetylase Inhibitor/i, 'hdac'],
  [/Androgen Receptor Inhibitor/i, 'androgen'],
  [/Vascular Endothelial Growth Factor/i, 'vegf'],
  [/Programmed Death/i, 'pd1'],
  [/CTLA-4/i, 'ctla4'],
  [/Interleukin-6/i, 'il6'],
  [/BCL-2 Inhibitor/i, 'bcl2'],
  [/Complement Inhibitor/i, 'complement'],
  [/Aromatase Inhibitor/i, 'aromatase'],
  [/Estrogen Receptor Antagonist/i, 'estrogen'],
  [/HER2/i, 'her2'],
  [/CD20-directed/i, 'cd20'],
  [/Antisense Oligonucleotide/i, 'antisense'],
  [/Angiotensin 2 Receptor Blocker/i, 'arb'],
  [/Angiotensin Converting Enzyme Inhibitor/i, 'ace'],
  [/beta-Adrenergic Blocker/i, 'beta_blocker'],
  [/HMG-CoA Reductase Inhibitor/i, 'statin'],
  [/Factor Xa Inhibitor|Direct Thrombin Inhibitor/i, 'anticoagulant'],
  [/Endothelin Receptor Antagonist/i, 'endothelin'],
  [/Dipeptidyl Peptidase 4 Inhibitor/i, 'dpp4'],
  [/Platinum-based Drug/i, 'platinum'],
  [/Microtubule Inhibitor/i, 'taxane', /taxel/i],   // FDA's class also covers non-taxanes (tirbanibulin, eribulin)
  [/Anthracycline/i, 'anthracycline'],
  [/Topoisomerase Inhibitor/i, 'topo1', /tecan/i],   // ... and topoisomerase II drugs (etoposide, anthracyclines)
  [/Proton Pump Inhibitor/i, 'ppi'],
];

// 3. WHO INN stems, each checked in "Use of stems in the selection of INN", 2024 edition. Ordered longest first.
// -mab is the previous antibody scheme; -tug, -bart, -mig, -ment are the current one.
// Left out on purpose: -drostat and -camten (not in the 2024 stem book), -tide and -stat (too broad).
export const STEMS = [
  ['gliflozin', 'sglt2', 'sodium-glucose co-transporter inhibitors'],
  ['vastatin', 'statin', 'HMG-CoA reductase inhibitors'],
  ['rafenib', 'kinase', 'Raf kinase inhibitors'],
  ['glutide', 'glp_analogue', 'GLP analogues'],   // GLP-1 and GLP-2 drugs alike, so not called GLP-1
  ['gliptin', 'dpp4', 'DPP-IV inhibitors'],
  ['ciclib', 'cdk', 'cyclin-dependent kinase inhibitors'],
  ['ciguat', 'sgc', 'guanylate cyclase activators and stimulators'],
  ['renone', 'mra', 'mineralocorticoid receptor antagonists'],
  ['gatran', 'anticoagulant', 'thrombin inhibitors'],
  ['xaban', 'anticoagulant', 'factor Xa inhibitors'],
  ['sartan', 'arb', 'angiotensin II receptor antagonists'],
  ['platin', 'platinum', 'platinum derivatives'],
  ['taxel', 'taxane', 'taxane derivatives'],
  ['rubicin', 'anthracycline', 'daunorubicin derivatives'],
  ['tecan', 'topo1', 'topoisomerase I inhibitors'],
  // -citinib is not in the 2024 stem book text checked above; DrugCentral gives tofacitinib's stem as "Janus kinase
  // inhibitors", and every -citinib drug in the data (7 Nov 2026) is a JAK or TYK2 (JAK family) inhibitor.
  ['citinib', 'jak', 'Janus kinase inhibitors'],
  // -brutinib: every -brutinib drug in the data (7 Nov 2026) is a BTK inhibitor (ibrutinib, zanubrutinib, remibrutinib ...).
  ['brutinib', 'btk', "Bruton's tyrosine kinase inhibitors"],
  ['tinib', 'kinase', 'tyrosine kinase inhibitors'],
  ['parib', 'parp', 'PARP inhibitors'],
  ['lisib', 'pi3k', 'PI3K inhibitors'],
  ['siran', 'sirna', 'small interfering RNA'],
  ['entan', 'endothelin', 'endothelin receptor antagonists'],
  ['prazole', 'ppi', 'antiulcer, benzimidazole derivatives'],
  ['olol', 'beta_blocker', 'beta-adrenoreceptor antagonists'],
  ['pril', 'ace', 'ACE inhibitors'],
  ['cept', 'receptor_decoy', 'receptor molecules, native or modified'],
  ['mab', 'antibody', 'monoclonal antibodies'],
  ['tug', 'antibody', 'unmodified immunoglobulins'],
  ['bart', 'antibody', 'artificial immunoglobulins'],
  ['mig', 'multi_antibody', 'multi-specific immunoglobulins'],
  ['gene', 'gene_therapy', 'gene therapy substances'],
  ['cel', 'cell_therapy', 'cell therapies'],
];

// Dosage-form and salt words dropped before reading a name's stem ("Vericiguat suspension" -> "vericiguat").
const FORM = /\b(injection|tablets?|capsules?|oral|suspension|solution|sodium|potassium|calcium|hydrochloride|hcl|mesylate|maleate|tartrate|acetate|citrate|sulfate|phosphate|besylate|fumarate|succinate|for|subcutaneous|intravenous|iv|sc|mg)\b/gi;

// Names that end like a stem but are not of that class: brand names (Aricept, CellCept, Sprycel, Pentacel), devices
// (Surgicel, VeraCept, LevoCept, INTERCEPT), the -piprazole antipsychotics (not -prazole acid blockers), and drospirenone,
// a contraceptive hormone listed under -renone.
const NOT_STEM = ['aricept', 'cellcept', 'intercept', 'levocept', 'veracept', 'pentacel', 'sprycel', 'surgicel', 'meticel', 'piprazole', 'drospirenone'];

// The single word a name's stem is read from, or null when the name is a code, a combination or more than one word.
// A one-word INN plus an optional second INN word (ADCs and pegylated forms, e.g. "maridebart cafraglutide") is allowed:
// the stem is read from the first word, which names the main substance.
function innWord(name) {
  const words = String(name || '').replace(FORM, ' ').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!words.length || words.length > 2 || /\d/.test(name)) return null;
  if (/\b(and|plus|with|or)\b/i.test(name) || /[+/]/.test(name)) return null;
  return words[0].length >= 7 ? words[0] : null;
}
// Drugs whose class neither FDA nor the name stem gives, named by hand: JAK inhibitors not sold in the US whose names
// end in plain -tinib, and ibrutinib, the first BTK inhibitor, too short a name for the -brutinib stem rule.
const NAMED = { filgotinib: 'jak', jaktinib: 'jak', ibrutinib: 'btk' };
const namedOf = name => NAMED[String(name || '').toLowerCase().replace(FORM, ' ').trim().split(/\s+/)[0]] || null;
const epcHit = (epc, name) => EPC.find(([re, , nameRe]) => re.test(epc) && (!nameRe || nameRe.test(name || '')));
export function stemOf(name) {
  const w = innWord(name);
  if (!w) return null;
  if (NOT_STEM.some(x => w.endsWith(x))) return null;
  // At least 2 letters before the stem: lovastatin, losartan and amrubicin count; checked on every name in the data, 7 Nov 2026.
  const s = STEMS.find(([stem]) => w.endsWith(stem) && w.length >= stem.length + 2);
  return s ? { stem: s[0], cls: s[1], meaning: s[2] } : null;
}

// The explanation for one drug.
//   mechanism: hand-checked mechanism label (null for automatic drugs)
//   curated: hand-checked drug
//   epc: FDA established pharmacologic class(es), "; "-joined, or null
//   fdaUrl: Drugs@FDA page for the source link
// Returns { plain, term, source: 'hand' | 'named' | 'fda' | 'stem' | null, url }.
//   plain: hand-written sentence or null; term: the expert term it explains (mechanism, FDA class, or "-stem: meaning").
export function explain({ name, mechanism, curated, epc, fdaUrl }) {
  if (curated && mechanism) {
    const hit = MECH.find(([re]) => re.test(mechanism));
    return { plain: hit ? PLAIN[hit[1]] : null, term: mechanism, source: 'hand', url: null };
  }
  const named = namedOf(name);
  if (named) return { plain: PLAIN[named], term: CLASSES[named][0].replace(/s$/, ''), source: 'named', url: null };
  const hit = epc && epcHit(epc, name);
  if (hit) return { plain: PLAIN[hit[1]], term: epc, source: 'fda', url: fdaUrl || null };
  const s = stemOf(name);
  if (s) return { plain: PLAIN[s.cls] || null, term: `-${s.stem}: ${s.meaning}`, source: 'stem', url: STEM_BOOK };
  if (epc) return { plain: null, term: epc, source: 'fda', url: fdaUrl || null };   // an FDA class with no plain line yet
  if (mechanism) return { plain: null, term: mechanism, source: null, url: null };
  return { plain: null, term: null, source: null, url: null };
}

// Each class's name, as a type search finds it and shows it as a heading, then other words it is searched by.
// A type search ("sglt2", "statins", "kinase inhibitors") finds automatic drugs whose class name or words contain every
// word of the query. Hand-written, so a disease name never matches a class by accident.
export const CLASSES = {
  glp1: ['GLP-1 receptor agonists', 'glp1'],
  glp_analogue: ['GLP analogues', 'glutides', 'glp-2'],   // not "GLP-1": a GLP-1 search must not find GLP-2 drugs
  sglt2: ['SGLT2 inhibitors', 'sglt-2', 'gliflozins'],
  statin: ['Statins', 'hmg-coa reductase inhibitors'],
  kinase: ['Kinase inhibitors', 'tyrosine kinase inhibitors', 'tkis'],
  cdk: ['CDK inhibitors', 'cyclin-dependent kinase inhibitors', 'cdk4/6'],
  jak: ['JAK inhibitors', 'janus kinase inhibitors'],
  btk: ['BTK inhibitors', "bruton's tyrosine kinase inhibitors", 'kinase inhibitors'],
  pi3k: ['PI3K inhibitors', 'kinase inhibitors'],
  parp: ['PARP inhibitors'],
  dpp4: ['DPP-4 inhibitors', 'dpp4', 'gliptins'],
  sgc: ['sGC stimulators', 'soluble guanylate cyclase'],
  mra: ['Mineralocorticoid receptor antagonists (MRAs)', 'aldosterone antagonists'],
  thr_beta: ['THR-beta agonists'],
  anticoagulant: ['Anticoagulants (blood thinners)', 'factor xa inhibitors', 'thrombin inhibitors'],
  arb: ['Angiotensin receptor blockers (ARBs)', 'sartans'],
  ace: ['ACE inhibitors'],
  beta_blocker: ['Beta blockers', 'beta-blockers'],
  endothelin: ['Endothelin receptor antagonists'],
  ppi: ['Proton pump inhibitors (PPIs)'],
  platinum: ['Platinum chemotherapy'],
  taxane: ['Taxanes', 'taxane chemotherapy'],
  anthracycline: ['Anthracyclines', 'anthracycline chemotherapy'],
  topo1: ['Topoisomerase I inhibitors'],
  hdac: ['HDAC inhibitors'],
  bcl2: ['BCL-2 inhibitors', 'bcl2'],
  pd1: ['PD-1 / PD-L1 blockers', 'pd1', 'pd-l1', 'checkpoint inhibitors', 'antibodies'],   // all antibodies, so an antibody search finds them too
  ctla4: ['CTLA-4 blockers', 'checkpoint inhibitors', 'antibodies'],
  vegf: ['VEGF blockers'],
  her2: ['HER2 blockers', 'antibodies'],
  cd20: ['CD20 antibodies'],
  il6: ['IL-6 blockers', 'interleukin-6', 'antibodies'],
  complement: ['Complement inhibitors'],
  aromatase: ['Aromatase inhibitors'],
  estrogen: ['Oestrogen receptor blockers', 'estrogen receptor'],
  androgen: ['Androgen receptor blockers', 'antiandrogens'],
  corticosteroid: ['Corticosteroids', 'steroids'],
  antibody: ['Antibodies', 'monoclonal antibodies'],
  multi_antibody: ['Multi-specific antibodies', 'bispecific antibodies', 'antibodies'],
  receptor_decoy: ['Receptor decoys'],
  sirna: ['siRNA drugs'],
  antisense: ['Antisense drugs', 'antisense oligonucleotides'],
  gene_therapy: ['Gene therapies'],
  cell_therapy: ['Cell therapies'],
};
// The class of a drug that has no hand-checked mechanism: from its FDA class when that has a plain line, else its name stem,
// in the same order explain() uses, so a search finds the drugs whose page shows that class.
export function classOf({ name, epc }) {
  if (namedOf(name)) return namedOf(name);
  const stem = stemOf(name)?.cls || null;
  const c = epc ? epcHit(epc, name)?.[1] || null : null;
  if (!c) return stem;   // no FDA class, or one with no plain line: the name stem, as explain() does
  // FDA calls many drugs just "Kinase Inhibitor"; the name stem can say which kind (palbociclib: CDK inhibitor).
  return c === 'kinase' && stem && stem !== 'kinase' ? stem : c;
}

// Self-check: every class referenced has a sentence...
for (const [, c] of [...MECH, ...EPC, ...STEMS.map(([s, c]) => [s, c])]) if (!PLAIN[c]) throw new Error(`explain.js: no plain line for class "${c}"`);
// ... and every class an automatic drug can get has a name.
for (const [, c] of [...EPC, ...STEMS.map(([s, c]) => [s, c])]) if (!CLASSES[c]) throw new Error(`explain.js: no name for class "${c}"`);
