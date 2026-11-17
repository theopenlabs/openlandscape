// Builds "programs" (one drug, one owner) from raw registry interventions.
// 1. Loads the hand-curated seed (companies, drugs, aliases, statuses, news catalysts).
// 2. Matches every trial intervention against the alias table, so LY3305677, IBI362 and mazdutide land on one program.
// 3. Drops placebo, and drops comparator use (a curated drug in a trial run by someone who does not own it).
// 4. Anything not curated becomes an "auto" program keyed on (cleaned name, sponsor), shown as "not reviewed".
//    Registry names that describe an arm are cut to the drug: "Drug: X", "X in combination with Y", "Vaccine MRT5424" -> MRT5424;
//    standard care, diluents and drug classes are dropped like placebo (autoName).
// 5. An "auto" program whose every trial uses the drug only as a control (the registry's arm labels, usedOnlyAsControl) is not made.
import { getDb, norm, meta } from '../db.js';
import { SEEDS } from '../../seed/index.js';
import { cik } from '../../seed/sec.js';
import { owns, PARTNER, COOWNER, FDA_ABBREV, usedOnlyAsControl, ownProduct } from '../owners.js';
import { readFileSync, existsSync } from 'node:fs';
import { parseCsv } from '../scoreboard.js';

const db = getDb();

const unq = s => s.replace(/\?$/, '');
const sure = s => !s.endsWith('?');

// ---------- 1. seed ----------
db.transaction(() => {
  db.exec('DELETE FROM area_exclusion; DELETE FROM catalyst; DELETE FROM drug_alias; DELETE FROM drug; DELETE FROM company;');
  const insC = db.prepare('INSERT OR REPLACE INTO company (id, name, country, ticker, listed, sponsor_patterns, cik) VALUES (?,?,?,?,?,?,?)');
  const insD = db.prepare('INSERT OR REPLACE INTO drug (id,name,companies,mechanism,mechanism_confirmed,tags,curated,status_override,status_level,status_source,status_news) VALUES (?,?,?,?,?,?,1,NULL,NULL,NULL,0)');
  const insA = db.prepare("INSERT OR IGNORE INTO drug_alias (alias_norm, alias, drug_id, confirmed, source, kind, lang, auto) VALUES (?,?,?,?,?,?,'en',0)");
  const aliasKind = a => (/\d/.test(a) ? 'code' : 'name');
  const updS = db.prepare('UPDATE drug SET status_override=?, status_level=?, status_source=?, status_news=1 WHERE id=?');
  const insK = db.prepare('INSERT INTO catalyst (drug_id,date,what,source_url,news,confirmed) VALUES (?,?,?,?,1,?)');
  // A company can appear in several seed files (e.g. Pfizer): first full row wins, sponsor patterns are merged.
  const cos = new Map();
  // SEC company number: the seed tuple's 6th field, else seed/sec.js.
  for (const s of SEEDS) for (const [id, name, country, ticker, pats, secCik] of s.companies) {
    const c = cos.get(id);
    if (!c) cos.set(id, { name, country, ticker, pats: [...pats], cik: +secCik || cik[id] || null });
    else { c.pats = [...new Set([...c.pats, ...pats])]; c.country ||= country; c.ticker ||= ticker; c.cik ||= +secCik || null; }
  }
  for (const [id, c] of cos)
    insC.run(id, c.name, c.country, c.ticker, c.ticker && c.ticker !== 'private' ? 1 : (c.ticker === 'private' ? 0 : null), JSON.stringify(c.pats), c.cik);
  for (const s of SEEDS) {
    for (const [name, cos, aliases, mech, tags, source] of s.drugs) {
      const id = name.toLowerCase();
      insD.run(id, name, JSON.stringify(cos), unq(mech) || null, mech && sure(mech) ? 1 : 0, tags);
      insA.run(norm(name), name, id, 1, 'canonical name', 'canonical');
      for (const a of aliases) insA.run(norm(unq(a).replace(/^~/, '')), unq(a), id, sure(a) ? 1 : 0, a.startsWith('~') ? 'misspelling' : (source || 'bakeoff/C_ground_truth.md'), aliasKind(unq(a)));
    }
    for (const [d, label, level, url] of s.statuses) updS.run(label, level, url, d.toLowerCase());
    for (const [d, date, what, url, conf] of s.catalysts) insK.run(d.toLowerCase(), date, what, url, conf);
    for (const [area, list] of Object.entries(s.areaExclusions || {}))
      for (const [name, reason] of list) db.prepare('INSERT OR REPLACE INTO area_exclusion VALUES (?,?,?)').run(area, norm(name), reason);
  }
})();

// A pattern matches at the start of a word: "sun pharmaceutical" is Sun Pharma, not Fosun, Hisun or Consun Pharmaceutical.
const companies = db.prepare('SELECT * FROM company').all().map(c => ({ ...c, pats: JSON.parse(c.sponsor_patterns).map(p => new RegExp('(?<![a-z0-9])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) }));
const companyById = Object.fromEntries(companies.map(c => [c.id, c]));
function companyOf(sponsor) {
  const s = (sponsor || '').toLowerCase();
  return companies.find(c => c.pats.some(p => p.test(s)))?.id || null;
}
const aliasIdx = new Map();
for (const a of db.prepare('SELECT alias_norm, drug_id FROM drug_alias').all()) {
  if (!aliasIdx.has(a.alias_norm)) aliasIdx.set(a.alias_norm, new Set());
  aliasIdx.get(a.alias_norm).add(a.drug_id);
}
const OTHER_USE = new Set(SEEDS.flatMap(s => s.approvedForOtherUse || []).map(x => x.toLowerCase()));
const drugs = Object.fromEntries(db.prepare('SELECT * FROM drug').all().map(d => [d.id, { ...d, companies: JSON.parse(d.companies) }]));

// ---------- helpers ----------
const PLACEBO = /plac[e]?bo|\bplaceb\b|plcaebo|plocebo|vehicle|sham|\bblank\b|^\s*ptm\s|\bsimula(?:tion|nt|ted)\b/i;
const DRUG_OR_PLACEBO = /(\bor|\/)\s*(plac|plcaebo|plocebo)/i;
function isPlacebo(name) {
  return PLACEBO.test(name) && !DRUG_OR_PLACEBO.test(name);
}
// "HRS-7535;Placebo", "AZD9291 80 mg/40 mg + placebo", "UBT251 2.0 mg and UBT251 Injection Placebo" -> the drug part.
// A placebo part is cut only when it is bare placebo or the placebo of the first part's own drug. Left whole (so dropped as placebo):
// a name that starts with placebo ("HS-20094 Placebo Injection", "DRV/COBI FDC Matching Placebo"), and the placebo of another drug
// ("Ultibro + CHF 5993 matched placebo": Ultibro is the comparator there). "/" is not a split: "CD07805/47 placebo" is one product.
const NAME_PART = /(\s*[;；+，]\s*|\s*,(?!\d)\s*|\s+(?:in combination with|and|or|plus|with)\s+)/i;
const PLACEBO_WORDS = /\b(?:matching|matched|corresponding|identical|oral|placebos?|vehicle|sham|tablets?|capsules?|injections?|pills?|group|to|match|for|of|the)\b|(?<![\w.-])[\d.]+\s*(?:mg|µg|ug|ml|%)?|[()（）]/gi;
function dropPlacebo(name) {
  const parts = String(name).split(NAME_PART);
  if (parts.length < 3 || PLACEBO.test(parts[0])) return name;
  const own = new Set(tokens(parts[0]));
  const cut = p => PLACEBO.test(p) && tokens(p.replace(PLACEBO_WORDS, ' ')).every(w => own.has(w));
  if (parts.some((p, k) => k % 2 === 0 && PLACEBO.test(p) && !cut(p))) return name;
  return parts.filter((p, k) => !cut(k % 2 ? parts[k + 1] ?? '' : p)).join('').trim();
}
// Double-dummy names: "Befotertinib + Icotinib placebo" -> "Befotertinib" (the placebo of another drug is cut), or null.
// Used only when the kept drug is the sponsor's own (ownName below): in "Chidamide + XNW5004 placebo" chidamide is
// Chipscreen's drug, given by Evopoint as the comparator.
function dummyCut(name) {
  const parts = String(name).split(NAME_PART);
  if (parts.length < 3 || PLACEBO.test(parts[0])) return null;
  const keep = parts.filter((p, k) => k % 2 === 0 && p.trim() && !PLACEBO.test(p));
  return keep.length ? keep.join(' + ') : null;
}
function tokens(s) {
  return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function curatedMatches(name) {
  const hits = new Set();
  const whole = aliasIdx.get(norm(name));
  if (whole) whole.forEach(d => hits.add(d));
  const t = tokens(name);
  for (let n = 4; n >= 1; n--)
    for (let i = 0; i + n <= t.length; i++) {
      const m = aliasIdx.get(t.slice(i, i + n).join(''));
      if (m) m.forEach(d => hits.add(d));
    }
  return [...hits];
}
// "GL0034 Dose Level 3" -> "GL0034"; "Part A: RM-718 or placebo" -> "RM-718"; "HDM1002 200mg, oral, once daily" -> "HDM1002"
// "Full dose Pantoprazole" -> "Pantoprazole"; "Raloxifene - Study" -> "Raloxifene"; "Qishen Yiqi Dripping Pills 2 bags" -> "Qishen Yiqi
// Dripping Pills"; "Silevertinib monotherapy", "Tinengotinib at the optimal ..." -> the drug.
function cleanName(name) {
  let s = String(name)
    .replace(/^part\s+\w+\s*:\s*/i, '')
    .replace(/^\s*(?:full|half|low|high|standard|reduced|starting|maximum|max|target|single|multiple|loading|maintenance|fixed)[- ](?:dose|dosage)s?\s+(?:of\s+)?(?=\S)/i, '')
    .replace(/\b(or|and|\/)\s*plac\w*.*$/i, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/(?<=\S)\s+[-–]\s+.*$/, '')
    .replace(/[,;、，].*$/, '')
    .replace(/\b\d+(\.\d+)?\s*(mg|µg|ug|mcg|g|ml|iu|units?|mg\/kg|%|bags?|sachets?|packs?|pills?|vials?|puffs?|drops?)\b.*$/i, '')
    .replace(/\bU-?(?:40|100|200|300|500)\b/g, ' ')
    .replace(/\b(dose level|dosing|dose|cohort|arm|group|regimen|level|part)\b.*$/i, '')
    .replace(/(?<=\S)\s+(?:escalation|expansion|monotherapy|continuous|alternating|combined|formulation|(?:and )?co-?formulated|rde|rp2d|pill|at the)\b.*$/i, '')
    .replace(/\b(injection|injectable|tablets?|capsules?|oral|subcutaneous|subcutaneously|intravenous|intravenously|injected|infused|infusion|solution|high|low|medium|mad|sad|sc|iv|po|q[1-4]?w|once|weekly|daily)\b(?!-\d)/gi, ' ')
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!/^[A-Z]{2,6}\s+\d{3,}$/.test(s)) s = s.replace(/\s+\d+$/, '');   // "Vaccine 2" -> "Vaccine", but "AMG 404" stays
  s = s.replace(/[-:]+$/, '').trim();
  return s;
}

// Registry names that describe an arm instead of naming a drug.
// "Drug: OC-001", "Sequence 3 - Treatment C: X", "Experimental: X" -> the name after the label.
const ARM_LABEL = /^\s*(?:(?:drug|biological|biologic|test|reference|experimental|active comparators?|comparators?|treatment|sequence|period|cohort|arm|part|stage|step|phase|group|dose|regimen|substudy|chemotherapy|chemo|concurrent|combination product|sad|mad|intervention\s*\d*)\b[^:：]{0,40}?(?:\s*[:：]\s*|\s+[-–]{1,2}\s+)(?=\S)|(?:vaccination|treatment|therapy|combination|combination therapy)\s+(?:with|of)\s+|combination\s+(?=\S+\s*\+))/i;
const LEAD_DOSE = /^\s*[\d.,]+\s*(?:mg|µg|μg|ug|mcg|g|ml|iu|units?|%)\s+/i;
// Standard care, not a drug: dropped like placebo.
const STANDARD_CARE = /\b(?:standard[- ]of[- ]care|standard (?:care|therapy|treatment)|(?:best )?supportive care|usual care|guideline[- ]directed|(?:investigator|physician)'?s?'? choice|treatment of choice|(?:optimi[sz]ed )?background (?:therapy|treatment)|rescue (?:medication|therapy)|or equivalent)\b|^soc\b|\bsoc$/i;
// "RT-114 is the RaniPill ..." / "X for the treatment of ..." / "X administered over 30 minutes" -> the part before.
const TAIL = /\s+(?:for|as|is|are|via|through|under|administered|will|during|following|in (?:patients|subjects|participants|healthy|adults|children|pediatric))\b.*$/i;
// "X in combination with Y", "X plus Y", "X + Y", "X with Y" -> parts.
const COMBO = /\s+(?:in combination with|in combo with|combined with|co-?administered with|coformulated with|given with|together with|with or without|followed by|on top of|add(?:ed)? on to|added to|in addition to|plus|with|and\/or)\s+|\s+\+\s*|(?<=\w)\+(?=\S)/i;
const REGIMEN = /^(?:modified\s+)?(?:m?folfox\d*|folfiri|m?folfirinox|capox|xelox|flot(?:\s+chemotherapy)?|hyper-?cvad|mgnp|chop|r-?chop|fp|gp|gnp|tp|ap|tc|pc|tch|tchp|tcbhp|thp|ctx|ac|ec|(?:platinum[- ]based |doublet |single[- ]agent )?chemo(?:therapy)?)$/i;
// A development code: MRT5424, SW1115C3, RT-114, AZR-MD-001, "AMG 404" at the start. Not targets like CD19, CD123, HER2, IL-6.
const CODE = /(?<![\w-])(?!CD\d)[A-Z][A-Za-z]{1,5}(?:-[A-Za-z]{1,6})*-?\d{3,}[A-Za-z0-9-]*|(?<![\w-])[A-Z]{2,6}-?\d{2}[A-Z]\d*\b/;
const DRUG_CLASS = /^(?:TKIS?|NRTIS?|NNRTIS?|PPIS?|ICIS?|CART|ADCS?|MABS?|SSRIS?|ARBS?|ACEI|DMARDS?|NSAIDS?|EGFR|GDMT|SOC|BSC|TPC|IC)$/;
const DILUENT = /^(?:sterile\s+)?(?:[\d.]+\s*%\s*)?(?:glucose|dextrose|saline|normal saline|sodium chloride|water for injection|sterile water)\b(?:\s+or\s+(?:[\d.]+\s*%\s*)?(?:glucose|dextrose|saline|sodium chloride))?(?:\s+administration)?\s*$/i;
// A name made only of these words is a kind of treatment, not a drug: "Endocrine therapy", "Taxane-based chemotherapy", "CDK4/6i",
// "Basal insulin analogues", "CYP cocktail", "Anti-diarrheal agent", "Pre-study basal insulin", "Platinum doublet".
const CLASS_WORDS = new Set(('therapy therapies chemotherapy chemotherapies chemo drug drugs agent agents medication medications medicine medicines treatment ' +
  'standard adjuvant neoadjuvant endocrine hormone hormonal inhibitor inhibitors antagonist antagonists agonist agonists analogue analogues analog analogs ' +
  'receptor receptors insulin basal bolus platinum doublet taxane based monotherapy combination regimen steroid steroids corticosteroid corticosteroids ' +
  'containing mouthwash mouth rinse cocktail probe ddi transporter cyp enzyme enzymes metabolizing contraceptive contraceptives combined anti diarrheal ' +
  'antidiarrheal antiemetic antihyperglycemic antidiabetic glucose lowering other of triple dual lymphodepleting radiation radiotherapy sbrt surgery rescue ' +
  'aromatase estrogen luteinizing releasing lhrh gnrh pre prestudy study sequential concurrent cdk cdk4 6i i hydroxytryptamine subtype serotonin neurokinin ' +
  'optional investigator choice physician or and the a an in to with without single multiple mutiple ascending enter brief description subcutaneous ' +
  'injection abdomen oral intravenous cabg lvad pci auc ctx folfox folfiri mfolfirinox mfolfox6 gnp gp tp ap tc tcbhp thp tchp ' +
  'pd l1 vegf monoclonal antibody antibodies bispecific test exploratory group ' +
  // kinds of background treatment, read in the 8 Nov audit
  'topical calcineurin androgen deprivation signaling signalling btk ras jak checkpoint immune h1 h2 histamine antihistamine antihistamines antidepressant antidepressants ' +
  'antioxidants alone anticoagulation anticoagulant anticoagulants background concomitant antibiotic antibiotics immunomodulatory prophylactic lymphodepletion cancer therapies ' +
  'best available physician choiced arv 3rd arpi glucocorticoid glucocorticoids pd1 pdl1 dmard dmards csdmard csdmards biologic biologics ' +
  // study steps and arm words: "Blood draw", "Active Surveillance", "Experimental", and words left when a dose phrase is cut ("Lower dose X" -> "Lower")
  'blood draw sample samples collection surveillance active passive baseline effectiveness evaluation post screening phase day trial intervention interventions subsequent development plan plans dosage ' +
  'experimental investigational vaccine vaccines candidate intramuscular intravaginal granular powder gel unit cell cells short new regular lower higher extremely multivalent').split(' '));
// A development code is a drug even when its letters are a class word ("THP-00101", "CTX-8371").
// Standard drugs count too: "Dexamethasone mouthwash" (supportive care in a Dato-DXd trial).
const isClassName = s => { const w = tokens(String(s).replace(/\([^)]*\)/g, ' ')); return w.length > 0 && !CODE.test(s) && w.every(x => CLASS_WORDS.has(x) || GENERIC.has(x) || /^\d+$/.test(x)); };
// An arm's letter or number, not a drug: "Treatment B", "Prophylaxis B", "Sequence B R-T-R-T", "DL2".
const ARM_NAME = /^(?:(?:treatment|regimen|arm|group|cohort|period|prophylaxis|formulation|product|drug)\s+[A-Z0-9]{1,2}|sequence\s+\S.*|DL\d+|CAR[- ]?T(?:[- ]cells?)?)$/i;
const LEAD_CODE = /^(?:[A-Z]{2,6} \d{3,}|Lu [A-Z]{2}\d{3,})\b/;
const words = s => s.trim().split(/\s+/).length;
// Salt words (as in druglists.js): "sorafenib tosylate" and "eribulin mesylate" are sorafenib and eribulin.
const SALT = /\s+(calcium|sodium|disodium|potassium|hydrochloride|dihydrochloride|hcl|mesylate|mesilate|dimesylate|tosylate|ditosylate|maleate|dimaleate|tartrate|acetate|citrate|sulfate|sulphate|phosphate|besylate|fumarate|succinate|adipate|bromide|chloride|hydrate|dihydrate|monohydrate)\b.*/gi;

// "Quadrivalent Influenza mRNA Vaccine MRT5424" -> "MRT5424"; a name without a code stays as it is.
const codeOf = name => (words(name) >= 2 && (name.match(LEAD_CODE)?.[0] || name.match(CODE)?.[0])) || name;

// A code or a one-word drug name with a standard drug-name ending (relatlimab, apatinib), not "allergen" or "Alum".
const INN_ENDING = /(?:mab|cept|nib|lisib|ciclib|parib|tide|gliflozin|gliptin|vir|sartan|zomib|tecan|degib|platin|taxel|rubicin|siran|rsen|leucel|tocel|cabtagene|stat)$/i;
const isDrugName = p => { const c = cleanName(p); return CODE.test(c) || (/^[A-Za-z-]{6,}$/.test(c) && INN_ENDING.test(c)); };

const DOSED_PART = String.raw`[A-Za-z][A-Za-z -]*?\s*[\d.]+\s*(?:mg|mcg|µg|μg|ug|g|%)`;
const FIXED_TRIPLE = new RegExp(String.raw`^\s*${DOSED_PART}\s*/\s*${DOSED_PART}(?:\s*/\s*${DOSED_PART})+\s*$`, 'i');

// One intervention name -> { name } for an automatic drug, or { drop: reason } when it names no drug of this sponsor.
function autoName(raw, otherNames, sponsor) {
  // ClinicalTrials.gov's form hint left in the name: "Enter a brief, descriptive name for the intervention. Use a ... SYS6043".
  let s = String(raw).replace(/^enter a brief, descriptive name for the intervention\.?(?:\s*use a non-proprietary \(generic\) name, if available\.?)?\s*/i, '')
    .replace(/\[\s*14C\s*\][-\s]*(?:labell?ed\s*)?/gi, '').replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ' ');
  for (let k = 0; k < 2; k++) s = s.replace(ARM_LABEL, '');
  // The sponsor's own tablet of two generic drugs (seed/ownership.js): one product, not two background drugs.
  if (ownProduct(s, sponsor)) return { name: s.replace(/\s+/g, ' ').trim(), own: true };
  // Three or more parts, each with its own dose: one fixed product ("Fluticasone 250mcg/Formoterol 12mcg/Glycopyrronium 25mcg"), not its first drug. Two parts stay as before: those are often an older pair given as the comparison.
  if (FIXED_TRIPLE.test(s)) return { name: s.split('/').map(cleanName).join('/') };
  if (STANDARD_CARE.test(s) && !COMBO.test(s) && !CODE.test(s)) return { drop: 'standard care' };
  if (DILUENT.test(cleanName(s))) return { drop: 'diluent' };
  if (isClassName(s)) return { drop: 'drug class' };
  s = s.replace(TAIL, '');
  const parts = s.split(COMBO).map(p => p.replace(LEAD_DOSE, '').replace(/\s+fixed[- ]dose\b.*$/i, '').trim()).filter(Boolean);
  const background = p => {
    const c = cleanName(p), k = norm(c);
    if (CODE.test(p) && !CODE.test(c)) return false;   // "High dose BCD-250": the code is the name
    if (!k || k.length < 3 || GENERIC.has(k) || STANDARD_CARE.test(p) || REGIMEN.test(c) || isPlacebo(p)) return true;
    const fk = fdaApproval(k) ? k : fdaKey(c), fda = fdaApproval(fk);
    return !!fda && !ownsApproved(fda, fk, sponsor);
  };
  // A part that lists only standard drugs or kinds of treatment: "Carboplatin/paclitaxel", "Gemcitabine and nab-paclitaxel",
  // "Fulvestrant or an aromatase inhibitor". ("Melphalan/HDS" is Delcath's own kit: HDS is not standard.)
  const standard = p => { const l = p.split(/\s*[/;；]\s*|\s+(?:and|or)\s+/).filter(Boolean); return background(p) || isClassName(p) || isClassName(cleanName(p)) || (l.length > 1 && l.every(x => background(x) || isClassName(x))); };
  if (parts.every(standard)) return { drop: 'only standard drugs' };
  const own = parts.length > 1 ? parts.filter(p => !standard(p)) : parts;
  if (!own.length) return { drop: parts.length > 1 ? 'only standard drugs' : 'no name left' };
  // Every part is a drug of the sponsor's own ("Nivolumab + Relatlimab" by BMS): one combined product, kept as one line.
  if (parts.length > 1 && own.length === parts.length && parts.every(isDrugName)) return { name: parts.map(p => codeOf(cleanName(p))).join(' + ') };
  const lead = own[0];
  let name = cleanName(lead);
  if (norm(name).length < 3 && CODE.test(lead)) name = lead.match(CODE)[0];
  // A description with a code in it ("Quadrivalent Influenza mRNA Vaccine MRT5424") -> the code.
  if (words(name) >= 2) {
    const code = codeOf(name);
    if (code !== name) name = code;
    else if (words(name) >= 4) {
      // Or a short registry alias: "Human beta common receptor antagonist monoclonal antibody" (CSL311) -> CSL311.
      const alias = otherNames.map(cleanName).find(o => o && o.length <= 25 && !isArmWords(o) && !isClassName(o) && (CODE.test(o) ? words(o) <= 2 : words(o) === 1 && /^[A-Za-z][a-z]{5,}$/i.test(o)) && !GENERIC.has(norm(o)));
      if (alias) name = alias.match(CODE)?.[0] || alias;
    }
  }
  // A bare abbreviation: a drug class is not a drug ("TKI"); otherwise its one-word registry name ("IVA" -> ivacaftor).
  if (/^[A-Z]{2,5}$/.test(name)) {
    if (DRUG_CLASS.test(name)) return { drop: 'drug class' };
    const inn = otherNames.map(o => o.trim()).find(o => /^[A-Za-z]{6,}$/.test(o) && !GENERIC.has(norm(o)));
    if (inn) name = inn;
  }
  // What is left after cutting is only a kind of treatment or an arm's letter: "Lower dose atropine" -> "Lower".
  if (isClassName(name) || ARM_NAME.test(name)) return { drop: 'not a drug' };
  return { name };
}

// Words of a name that says which arm it is, not which drug: "experimental vaccine", "Treatment B", "Intravaginal gel", "Lower" (cut from "Lower dose X").
const ARM_WORDS = new Set(('experimental investigational candidate test study active vaccine vaccines drug drugs product products treatment treatments formulation formulations ' +
  'topical intramuscular intravaginal vaginal granular powder gel unit cell cells short new regular low lower high higher multivalent phase period sequence arm arms group groups trial ' +
  'dose doses dosage in of car t cart i ii iii iv adult pediatric fasted fed reference inhalation inhaled nasal medium stage').split(' '));
// At least one real arm word: "N" (cut from "N,N-Dimethyltryptamine") and "7" (from "7+3") are not arm names.
const isArmWords = s => { const w = tokens(s); return w.some(x => x.length > 1 && ARM_WORDS.has(x)) && w.every(x => ARM_WORDS.has(x) || /^[a-z]$|^\d+$/.test(x)); };
const isArmName = s => isArmWords(s) || ARM_NAME.test(s);
// Words before the drug in a long description: "Lower dose atropine ...", "Granular powder in unit dose foil-lined sachet Mexiletine", "topical formulation of tacrolimus".
const LEAD_WORDS = new Set('low lower medium high higher short long dose dosage regimen of in with unit granular powder foil lined sachet topical formulation experimental investigational active'.split(' '));
const PARENS = /[(（\[]([^)）\]]+)[)）\]]/g;
const noDoses = s => String(s).replace(PARENS, ' ').replace(/\s*[\d.,]+\s*(?:mg|µg|μg|ug|mcg|g|ml|iu|units?|%)(?![a-z])/gi, ' ').replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
const FORM_TAIL = /\s+(?:ointment|cream|gel|capsules?|tablets?|injection|solution)$/i;
const notAName = n => !n || isPlacebo(n) || isArmName(n) || isClassName(n) || STANDARD_CARE.test(n) || DILUENT.test(n) || GENERIC.has(norm(n));
const wordOrCode = n => CODE.test(n) || LEAD_CODE.test(n) || /^[A-Z][A-Za-z]*-[A-Z0-9]+$/.test(n);
// A name written inside a description: a code, or up to six words with one real word in them.
const namesDrug = n => !notAName(n) && (wordOrCode(n) || (words(n) <= 6 && tokens(n).some(w => w.length >= 5 && !ARM_WORDS.has(w) && !CLASS_WORDS.has(w))));
// A registry other name must be plainly a name: a code, one word, a named vaccine, or a named CAR-T.
const namesProduct = n => !notAName(n) && (wordOrCode(n) || /^[A-Za-z][A-Za-z-]{4,}$/.test(n) || (/\bvaccine$/i.test(n) && words(n) >= 3) || /^\S+ CAR-?T(?: cells?)?$/i.test(n));
// The real drug behind an arm's name, from the registry's full name, then its other names. { name, inDescription }, or null.
function realName(raw, otherNames) {
  const plain = String(raw).replace(PARENS, ' ').trim();
  const leadCut = t => { const w = t.split(/\s+/); let k = 0; while (k < w.length && tokens(w[k]).every(x => LEAD_WORDS.has(x) || /^\d+$/.test(x))) k++; return w.slice(k).join(' '); };
  const shown = n => { n = leadCut(n).replace(/\s+(?:extended|modified|delayed|sustained|prolonged)[- ]release\b.*$/i, '').replace(FORM_TAIL, ''); return words(n) >= 2 ? codeOf(n) : n; };
  // Written in brackets or after a label: "Treatment B(AD-236B)", "Candidate vaccine, SCB-1019T".
  for (const c of [...[...String(raw).matchAll(PARENS)].map(m => m[1].split(/[,;]/)[0]), ...plain.split(/[,;:：]|\s[-–]\s/).slice(1)]) {
    const n = shown(noDoses(c));
    if (namesDrug(n)) return { name: n };
  }
  // After the arm words: "Lower dose atropine sulfate eye drops". The sponsor describes its own product here, so another company's older approval of the substance does not make it a comparison.
  const rest = leadCut(noDoses(plain));
  if (rest !== noDoses(plain) && namesDrug(rest)) return { name: rest, inDescription: true };
  for (const o of otherNames.flatMap(x => String(x).split(/[,;]/))) {
    const n = shown(noDoses(o));
    if (namesProduct(n)) return { name: n };
  }
  return null;
}
// From a title: "... of a Lyophilized Herpes Zoster Virus mRNA Vaccine in ..." -> that vaccine's name; "of the Efficacy and Safety" is not one.
const TITLE_STOP = /^(?:of|an?|the|for|with|and|to|in|on|trial|study|versus|vs)$/i;
function vaccineInTitle(title) {
  const w = String(title).replace(PARENS, ' ').replace(/\S+'s\s/g, '').split(/\s+/);
  const end = w.findIndex(x => /^vaccine$/i.test(x));
  if (end < 1) return null;
  let start = end;
  while (start > 0 && !TITLE_STOP.test(w[start - 1]) && end - start < 8) start--;
  return start > 0 && TITLE_STOP.test(w[start - 1]) && start < end ? w.slice(start, end + 1).join(' ') : null;
}
// From a title: up to three development codes ("... of AD-236A and AD-236B").
// A Merck protocol number names the drug's code plus the study: "MK-8342B-063" -> MK-8342B.
const codesInTitle = title => [...new Set([...String(title).matchAll(new RegExp(CODE.source, 'g'))].map(m => m[0].replace(/^(MK-\d{4}[A-Z]?)-\d{3}$/, '$1')))];

const GENERIC = new Set(['standardofcare', 'soc', 'bestsupportivecare', 'saline', 'normalsaline', 'water', 'drug', 'investigationalproduct', 'studydrug', 'control', 'comparator', 'activecomparator', 'metformin', 'insulin', 'chemotherapy', 'dexamethasone', 'prednisone', 'prednisolone', 'paracetamol', 'acetaminophen', 'midazolam', 'rescuemedication', 'background therapy', 'leucovorin', 'folinicacid', 'calciumfolinate']);

// openFDA: ingredient -> sponsors (first word), to tell an owner's trial from a comparator use
const fdaRows = db.prepare("SELECT brand, ingredient, sponsor, appl_no, approval_date FROM fda_approval").all();
const fdaByIng = new Map();
// Biologics carry a prefix and a four-letter suffix in the FDA list: "fam-trastuzumab deruxtecan-nxki", "ado-trastuzumab
// emtansine", "toripalimab-tpzi", "insulin glargine recombinant". Keyed on the plain name without salt, as trials write it
// (trials sometimes copy the FDA name too).
// Short names ("T-DM1", "nab-paclitaxel") are looked up as the FDA's name (owners.js).
function fdaKey(name) {
  const k = norm(String(name).replace(/^(?:fam|ado)-/i, '').replace(/-[a-z]{4}\b/gi, '').replace(/\s+recombinant\b/gi, '').replace(SALT, ''));
  return FDA_ABBREV[k] || k;
}
// The first holder of the drug's approval, or a developer the FDA list does not name (owners.js), runs the trial.
const ownsApproved = (fda, key, sponsor) => owns(fda.sponsor, sponsor) || (COOWNER[key] || []).some(w => sponsor.toLowerCase().includes(w));
for (const r of fdaRows) {
  // Biologics carry a prefix and a four-letter suffix in the FDA list: "fam-trastuzumab deruxtecan-nxki", "ado-trastuzumab
  // emtansine", "toripalimab-tpzi", "insulin glargine recombinant": keyed on the plain name, as trials write it.
  const base = fdaKey(r.ingredient);
  if (!fdaByIng.has(base)) fdaByIng.set(base, []);
  fdaByIng.get(base).push(r);
}
const firstWord = s => (String(s || '').toLowerCase().match(/[a-z]{3,}/) || [''])[0];
function fdaApproval(key) {
  const rows = fdaByIng.get(key);
  if (!rows) return null;
  return rows.slice().sort((a, b) => a.approval_date.localeCompare(b.approval_date))[0];
}
const fdaUrl = appl => `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appl.replace(/^\D+/, '')}`;

// Brand names (not the generic name) -> who markets them: "Gonal-f" -> EMD Serono, "Prolia" -> Amgen.
const brandIdx = new Map();
for (const r of fdaRows) {
  const b = norm(String(r.brand || '').replace(/[®™]/g, ''));
  if (b.length < 4 || b === norm(r.ingredient) || fdaByIng.has(b) || firstWord(r.brand) === firstWord(r.ingredient)) continue;   // a generic sold under its own name
  if (!brandIdx.has(b)) brandIdx.set(b, { brand: r.brand, ingredient: r.ingredient, owners: new Set() });
  brandIdx.get(b).owners.add(r.sponsor);
}
// "United States (US)-Gonal-f", "EU-sourced Keytruda", "US-licensed Stelara": a reference product bought in one region.
const REGION = /^\s*(?:unite[ds]? states|european union|us|eu|uk|cn|china|japan|korea)\b[\s-]*(?:(?:sourced|source|licen[cs]ed|license|approved|authori[sz]ed|marketed|reference)\b[\s-]*)?/i;
// Another company's marketed drug named in this trial, or null. Checked by brand ("Gonal-f", "KEYTRUDA® 200 mg"),
// and any name with a region label, which is how comparison trials name the original they buy.
function originalOf(raw, sponsor) {
  let s = String(raw).replace(/[®™]/g, '').replace(/\([^)]*\)/g, ' ').trim();
  const region = REGION.test(s) && s.replace(REGION, '').trim().length >= 3;
  if (region) s = s.replace(REGION, '');
  const c = cleanName(s), first = c.split(/[\s/]+/)[0];
  const hit = brandIdx.get(norm(c)) || (first.length >= 5 && !fdaByIng.has(norm(first)) ? brandIdx.get(norm(first)) : null);
  if (hit && PARTNER[norm(hit.brand)] && sponsor.toLowerCase().includes(PARTNER[norm(hit.brand)])) return null;
  if (hit) return [...hit.owners].some(o => owns(o, sponsor)) ? null : { name: hit.brand, ingredient: hit.ingredient, owner: [...hit.owners][0] };
  if (!region) return null;
  const fda = fdaApproval(norm(c)) || fdaApproval(norm(c.replace(SALT, '')));
  if (fda && owns(fda.sponsor, sponsor)) return null;
  return { name: first.length >= 4 && c.split(/\s+/).length > 3 ? first : c, ingredient: fda?.ingredient || null, owner: fda?.sponsor || null };
}
// A trial testing a copy against the original, not giving the two together: the sponsor's own drug is registered under the
// original's generic name as another name ("HD204", also "bevacizumab", against Avastin), the title says "biosimilar" or "equivalence",
// or it names the original in a comparison ("HLX14 Versus Prolia", "MW031 and Prolia"; not "Lovenox With Aspirin").
const isCopyTrial = (title, orig, others) => {
  const t = String(title || '');
  if (/combination|combined|\bplus\b|with or without|monotherapy|add-on|in addition to/i.test(t)) return false;
  const generic = orig.ingredient ? orig.ingredient.toLowerCase().match(/[a-z]{4,}/)?.[0] : null;
  if (generic && others.some(i => !i.name.toLowerCase().includes(generic) && JSON.parse(i.other_names || '[]').some(n => String(n).toLowerCase().includes(generic)))) return true;
  if (/biosimilar|similarity|\bequivalen|comparability/i.test(t)) return true;
  const names = [orig.name, orig.ingredient].filter(Boolean).map(n => n.toLowerCase().split(/[\s/]+/)[0]).filter(n => n.length >= 4);
  return names.some(n => t.toLowerCase().includes(n)) && /compar|versus|\bvs\b|\band\b|bioavailab|bioequival|pharmacokinetic/i.test(t);
};

// ---------- 2. link ----------
const trials = db.prepare('SELECT nct, sponsor, collaborators, title FROM trial').all();
const intsByNct = new Map();
for (const i of db.prepare("SELECT * FROM intervention WHERE type IN ('DRUG','BIOLOGICAL','COMBINATION_PRODUCT','GENETIC')").all()) {
  if (!intsByNct.has(i.nct)) intsByNct.set(i.nct, []);
  intsByNct.get(i.nct).push(i);
}

const armsByNct = new Map();
for (const a of db.prepare('SELECT nct, type, interventions FROM trial_arm').all()) {
  if (!armsByNct.has(a.nct)) armsByNct.set(a.nct, []);
  armsByNct.get(a.nct).push({ type: a.type, names: JSON.parse(a.interventions).map(n => n.replace(/^(?:drug|biological|combination product|genetic|device|procedure|radiation|behavioral|dietary supplement|diagnostic test|other):\s*/i, '').trim().toLowerCase()) });
}

const onlyCombo = new Set([...intsByNct].filter(([, list]) => list.every(i => i.type === 'COMBINATION_PRODUCT' || i.type === 'GENETIC')).map(([nct]) => nct));
// Who names a drug in their trials: cleaned name -> sponsor -> trials. A double-dummy drug is kept only for the sponsor
// that names it in the most trials.
const sponsorKeyOf = t => companyOf(t.sponsor) || norm(t.sponsor).slice(0, 40);
const namedBy = new Map();
for (const t of trials) for (const i of intsByNct.get(t.nct) || []) {
  const n = i.name && (isPlacebo(dropPlacebo(i.name)) ? dummyCut(i.name) : dropPlacebo(i.name));
  for (const p of n ? n.split(' + ') : []) {
    const k = norm(cleanName(p));
    if (!namedBy.has(k)) namedBy.set(k, new Map());
    const m = namedBy.get(k); if (!m.has(sponsorKeyOf(t))) m.set(sponsorKeyOf(t), new Set()); m.get(sponsorKeyOf(t)).add(t.nct);
  }
}
const ownName = (name, sk) => name.split(' + ').every(p => { const m = namedBy.get(norm(cleanName(p))); const mine = m?.get(sk)?.size || 0; return !!m && [...m.values()].every(v => v.size <= mine); });
const programs = new Map();   // id -> program row
const links = [];             // [nct, program_id, matched_on]
const armNamed = [];          // interventions named only for their arm, no drug name found: [trial, intervention, trial companies]
// inDescription: the name was cut out of the sponsor's own description of its product (see realName). fromTitle: the title says this is what the trial tests.
function addAutoRow(t, i, clean, { inDescription = false, fromTitle = false } = {}) {
  const sponsorKey = sponsorKeyOf(t), key = norm(clean);
  if (!key || key.length < 3 || GENERIC.has(key)) return;
  const fk = fdaApproval(key) ? key : fdaKey(clean), fda = fdaApproval(fk), own = fda && ownsApproved(fda, fk, t.sponsor || '');
  // An approved drug used by a non-owner. Owner by company family too: the FDA lists Genentech, the trial Hoffmann-La Roche.
  if (fda && !own && !inDescription) return;
  const pid = `auto:${key}|${sponsorKey}`;
  if (!programs.has(pid)) programs.set(pid, { id: pid, curated: 0, name: clean, sponsor: t.sponsor, companyId: companyOf(t.sponsor), key, aliases: new Set(), fda: own ? fda : null });
  const p = programs.get(pid);
  for (const o of JSON.parse(i.other_names || '[]')) if (norm(o) !== key && o.length < 40) p.aliases.add(o.trim());
  p.tested ||= fromTitle || !usedOnlyAsControl(armsByNct.get(t.nct) || [], i.name);
  links.push([t.nct, pid, i.name]);
}
// A name found behind an arm's label: a hand-checked drug if it is one, else an automatic row.
function addRealName(t, i, name, trialCos, opts) {
  const hits = aliasIdx.get(norm(name));
  if (!hits) return addAutoRow(t, i, name, opts);
  for (const d of hits) {
    if (!drugs[d].companies.some(c => trialCos.has(c))) continue;
    if (!programs.has(d)) programs.set(d, { id: d, drug_id: d, curated: 1 });
    links.push([t.nct, d, i.name]);
  }
}
const comparators = [];       // another company's drug named in a trial (comparator table)
let comparatorSkips = 0;

for (const t of trials) {
  const trialCos = new Set([companyOf(t.sponsor), ...JSON.parse(t.collaborators || '[]').map(companyOf)].filter(Boolean));
  const sponsorKey = sponsorKeyOf(t);
  for (const i of intsByNct.get(t.nct) || []) {
    let name = i.name && dropPlacebo(i.name);
    if (name && isPlacebo(name)) {
      const d = dummyCut(i.name), first = d?.split(' + ')[0];
      if (d && ownName(d, sponsorKey)) name = d;
      else if (first && ownName(first, sponsorKey)) name = first;   // "Prusogliptin, Dapagliflozin (low dose) placebo, plus metformin XR": the sponsor's own drug comes first.
    }
    if (!name || isPlacebo(name)) continue;
    let hits = curatedMatches(name);
    if (!hits.length) for (const o of JSON.parse(i.other_names || '[]')) hits.push(...curatedMatches(o));
    hits = [...new Set(hits)];
    if (hits.length) {
      for (const d of hits) {
        const owned = drugs[d].companies.some(c => trialCos.has(c));
        if (!owned) { comparatorSkips++; continue; }
        if (!programs.has(d)) programs.set(d, { id: d, drug_id: d, curated: 1 });
        links.push([t.nct, d, i.name]);
      }
      continue;
    }
    const orig = originalOf(name, t.sponsor || '');
    if (orig) { comparators.push([t.nct, orig.name, norm(orig.name), orig.ingredient ? norm(orig.ingredient.replace(SALT, '')) : null, orig.owner, isCopyTrial(t.title, orig, (intsByNct.get(t.nct) || []).filter(x => x !== i && !originalOf(x.name, t.sponsor || ''))) ? 1 : 0, i.name]); continue; }
    const otherNames = JSON.parse(i.other_names || '[]');
    const auto = autoName(name, otherNames, t.sponsor || '');
    if (auto.drop) {
      // Only an arm's name: find the drug behind it, or try the trial's title afterwards.
      if (isArmName(cleanName(name))) {
        const real = realName(name, otherNames);
        if (real) addRealName(t, i, real.name, trialCos, real);
        else armNamed.push([t, i, trialCos]);
      }
      continue;
    }
    const clean = auto.name;
    // A trial that lists no drug or biological, only combination products, is often a device trial ("Neurotronic Catheter",
    // "Formulation A"): its products are kept only under a drug code or drug name.
    if (onlyCombo.has(t.nct) && !clean.split(' + ').every(isDrugName)) continue;
    addAutoRow(t, i, clean, { inDescription: !!auto.own });
  }
  // Every drug the trial lists is a placebo ("JP-1366 simulation tablets"): only the title can say what is tested.
  const listed = intsByNct.get(t.nct) || [];
  if (listed.length && listed.every(i => isPlacebo(dropPlacebo(i.name)))) armNamed.push([t, listed[0], trialCos]);
}

// Trials that still have no row and only an arm's name to go on ("Experimental", "Treatment B"; "Blood draw" is not one): the title may name the drug.
const linked = new Set(links.map(l => l[0]));
const seenArmTrial = new Set();
for (const [t, i, trialCos] of armNamed) {
  if (linked.has(t.nct) || seenArmTrial.has(t.nct)) continue;
  seenArmTrial.add(t.nct);
  // The sponsor's own drugs named in the title, by their row names.
  const own = tokens(t.title).map(w => programs.get(`auto:${w}|${sponsorKeyOf(t)}`)).filter(Boolean);
  const curatedHits = curatedMatches(t.title).filter(d => drugs[d].companies.some(c => trialCos.has(c)));
  if (own.length || curatedHits.length) {
    for (const p of own) links.push([t.nct, p.id, i.name]);
    for (const d of curatedHits) { if (!programs.has(d)) programs.set(d, { id: d, drug_id: d, curated: 1 }); links.push([t.nct, d, i.name]); }
    continue;
  }
  const v = /vaccine/i.test(i.name) ? vaccineInTitle(t.title) : null, codes = codesInTitle(t.title);
  if (v) addRealName(t, i, v, trialCos, { fromTitle: true });
  else if (codes.length && codes.length <= 3) for (const c of codes) addRealName(t, i, c, trialCos, { fromTitle: true });
}
// Orphan trials a reader has named the drug for (seed/orphan-trials.csv): a trial the steps above
// linked to nothing gets the named drug, through the named intervention, as a hand-checked drug of that company if it is
// one, else as the company's automatic row (made if missing). "no drug" lines change nothing. Trials linked above to a row
// that stays are left alone, so a better linker wins over the seed; a link only to a row about to go as control-only use
// ("Omnic Ocas" beside the reader's tamsulosin) does not count. The named intervention may be a placebo: a registry that
// lists the drug only as "Placebo" (TST002 in NCT07806331) links through it, as the all-placebo rule above does.
const orphanStats = { named: 0, linked: 0, already_linked: 0, no_trial: 0, no_intervention: 0, no_drug: 0 };
const testedByOtherName = p => [...p.aliases].some(o => programs.get(`auto:${norm(cleanName(o))}|${p.id.split('|').at(-1)}`)?.tested);
const stays = p => p.curated || p.tested || testedByOtherName(p);
{
  const linkedNow = new Set(links.filter(l => stays(programs.get(l[1]))).map(l => l[0])), byNct = new Map(trials.map(t => [t.nct, t]));
  const seed = process.env.ORPHAN_SEED || new URL('../../seed/orphan-trials.csv', import.meta.url);   // ORPHAN_SEED: tests only
  for (const r of existsSync(seed) ? parseCsv(readFileSync(seed, 'utf8')) : []) {
    if (r.drug === 'no drug') { orphanStats.no_drug++; continue; }
    orphanStats.named++;
    const t = byNct.get(r.nct);
    if (!t) { orphanStats.no_trial++; continue; }
    if (linkedNow.has(t.nct)) { orphanStats.already_linked++; continue; }
    const i = (intsByNct.get(t.nct) || []).find(x => x.name === r.intervention) || (intsByNct.get(t.nct) || []).find(x => norm(x.name) === norm(r.intervention));
    if (!i) { orphanStats.no_intervention++; continue; }
    const co = companyOf(r.company), sk = co || norm(r.company).slice(0, 40), k = norm(r.drug);
    const cur = [...(aliasIdx.get(k) || [])].filter(d => drugs[d].companies.includes(co));
    if (cur.length) for (const d of cur) { if (!programs.has(d)) programs.set(d, { id: d, drug_id: d, curated: 1 }); links.push([t.nct, d, i.name]); }
    else {
      const pid = `auto:${k}|${sk}`;
      if (!programs.has(pid)) {
        const fk = fdaApproval(k) ? k : fdaKey(r.drug), fda = fdaApproval(fk);
        programs.set(pid, { id: pid, curated: 0, name: r.drug, sponsor: r.company, companyId: co, key: k, aliases: new Set(), fda: fda && ownsApproved(fda, fk, r.company) ? fda : null });
      }
      const p = programs.get(pid);
      if (norm(i.name) !== k && i.name.length < 40) p.aliases.add(i.name.trim());
      p.tested = true;
      links.push([t.nct, pid, i.name]);
    }
    orphanStats.linked++;
  }
}
// Every trial uses this drug only as a control: it is the company's comparison, not its drug in development. Hand-checked drugs are never dropped here.
// Kept when the registry gives it another name the same company does test ("BCD-100", also called prolgolimab).
const controlRows = new Set([...programs].filter(([, p]) => !stays(p)).map(([id]) => id));
for (const id of controlRows) programs.delete(id);
for (let k = links.length - 1; k >= 0; k--) if (controlRows.has(links[k][1])) links.splice(k, 1);

// ---------- 3. write programs ----------
db.transaction(() => {
  db.exec('DELETE FROM trial_program; DELETE FROM program;');
  const insP = db.prepare(`INSERT INTO program (id,drug_id,name,aliases,company,company_ids,mechanism,mechanism_confirmed,tags,curated,china,status_label,status_level,status_source,status_news)
    VALUES (@id,@drug_id,@name,@aliases,@company,@company_ids,@mechanism,@mechanism_confirmed,@tags,@curated,@china,@status_label,@status_level,@status_source,@status_news)`);
  const aliasRows = db.prepare("SELECT alias, confirmed FROM drug_alias WHERE drug_id=? AND source!=? AND source!='misspelling'");
  for (const p of programs.values()) {
    if (p.curated) {
      const d = drugs[p.id];
      const fda = d.companies.length ? (fdaApproval(norm(d.name)) || aliasRows.all(d.id, 'canonical name').map(a => fdaApproval(norm(a.alias))).find(Boolean)) : null;
      let status = { status_label: null, status_level: null, status_source: null, status_news: 0 };
      if (fda) status = { status_label: 'Approved (US)', status_level: 5, status_source: fdaUrl(fda.appl_no), status_news: 0 };
      if (d.status_override && (!fda || d.status_level > 5)) status = { status_label: d.status_override, status_level: d.status_level, status_source: d.status_source, status_news: 1 };
      if (d.status_override && fda && d.status_level === 5) status.status_label = 'Approved (US)';
      if (fda && OTHER_USE.has(d.id)) status = { status_label: 'US-approved for another use', status_level: null, status_source: fdaUrl(fda.appl_no), status_news: 0 };
      insP.run({
        id: p.id, drug_id: d.id, name: d.name,
        aliases: JSON.stringify(aliasRows.all(d.id, 'canonical name').map(a => ({ name: a.alias, confirmed: a.confirmed }))),
        company: d.companies.map(c => companyById[c]?.name || c).join(' · '), company_ids: JSON.stringify(d.companies),
        mechanism: d.mechanism, mechanism_confirmed: d.mechanism_confirmed, tags: d.tags, curated: 1,
        china: d.companies.some(c => companyById[c]?.country === 'CN') ? 1 : 0, ...status,
      });
    } else {
      const co = p.companyId ? companyById[p.companyId] : null;
      insP.run({
        id: p.id, drug_id: null, name: p.name, aliases: JSON.stringify([...p.aliases].slice(0, 6).map(n => ({ name: n, confirmed: 1, registry: 1 }))),
        company: co ? co.name : p.sponsor, company_ids: JSON.stringify(co ? [co.id] : []), mechanism: null, mechanism_confirmed: 0, tags: '', curated: 0,
        china: co ? (co.country === 'CN' ? 1 : 0) : null,
        status_label: p.fda ? 'FDA-approved (any use)' : null, status_level: p.fda ? 5 : null, status_source: p.fda ? fdaUrl(p.fda.appl_no) : null, status_news: 0,
      });
    }
  }
  const insL = db.prepare('INSERT OR IGNORE INTO trial_program (nct, program_id, matched_on) VALUES (?,?,?)');
  for (const l of links) insL.run(...l);
  db.exec('DELETE FROM comparator;');
  const insC = db.prepare('INSERT OR IGNORE INTO comparator VALUES (?,?,?,?,?,?,?)');
  for (const c of comparators) insC.run(...c);
})();
meta.set('linked_at', new Date().toISOString());
const curated = [...programs.values()].filter(p => p.curated).length;
console.log(`Programs: ${programs.size} (${curated} curated, ${programs.size - curated} auto). Trial links: ${links.length}. Comparator uses skipped: ${comparatorSkips}. Other companies' drugs kept as comparisons: ${comparators.length} (${comparators.filter(c => c[5]).length} in copy trials). Rows not made because every trial uses the drug only as a control: ${controlRows.size}. Orphan trials named by a reader: ${JSON.stringify(orphanStats)}.`);
