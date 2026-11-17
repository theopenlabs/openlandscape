// Who owns a marketed drug, as the FDA lists it, against the company named in a trial.
import { COMPANIES, DRUG_RIGHTS, OWN_PRODUCTS } from '../seed/ownership.js';
// Used by the linker (src/ingest/link.js) and the drug pages (src/query.js).
// A name's first real word; a short code counts ("X4 Pharms" is x4, not pharms).
const firstWord = s => (String(s || '').toLowerCase().match(/\b[a-z]\d[a-z0-9]*|[a-z]{3,}/) || [''])[0];
// Company families: the FDA lists the US arm, the trial often the parent ("EMD Serono" is Merck KGaA, "Genentech" is Roche).
const FAMILY = [['emd', 'kgaa', 'serono'], ['genentech', 'roche', 'hoffmann', 'chugai'], ['janssen', 'centocor', 'johnson', 'actelion', 'aragon pharm'], ['allergan', 'abbvie', 'pharmacyclics', 'immunogen'],
  ['wyeth', 'pfizer', 'pf prism', 'upjohn', 'hospira', 'pharmacia', 'seagen', 'array biopharma'], ['schering', 'organon', 'merck sharp', 'msd'], ['genzyme', 'sanofi', 'aventis', 'kadmon'], ['millennium', 'takeda', 'shire', 'baxalta'],
  ['medimmune', 'astrazeneca', 'alexion', 'acerta'], ['novartis', 'sandoz'], ['lilly', 'loxo'], ['boehringer'], ['bristol', 'squibb', 'celgene', 'mirati'], ['gsk', 'glaxo', 'smithkline', 'tesaro'], ['amgen', 'horizon', 'chemocentryx'],
  ['novo nordisk'], ['bayer'], [/(?<![a-z0-9])biogen(?![a-z])/], ['regeneron'], ['gilead', 'kite']];
// Bought and renamed companies, with sources: seed/ownership.js.
// These match at the start of a word: "sobi" is not "Akesobio".
const atWordStart = w => new RegExp('(?<![a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
for (const [words, parent] of COMPANIES) { const f = parent && FAMILY.find(x => x.includes(parent)), r = words.map(atWordStart); if (f) f.push(...r); else FAMILY.push(r); }
// Words match at the start of a word ("shire" is not "Hampshire"); "biogen" only whole ("BioGenCell" is another firm).
const START = new Map();
const wordStart = w => START.get(w) || START.set(w, atWordStart(w)).get(w);
export const family = name => { const n = name.toLowerCase(); return FAMILY.findIndex(f => f.some(w => (typeof w === 'string' ? wordStart(w) : w).test(n))); };
// Brands sold by a partner outside the US, which the FDA list does not show.
export const PARTNER = { eylea: 'bayer', lucentis: 'novartis', zoladex: 'astrazeneca', androgel: 'abbvie', velcade: 'janssen', xarelto: 'bayer', remicade: 'merck', simponi: 'merck', dupixent: 'sanofi', kevzara: 'sanofi', praluent: 'sanofi' };
// Developers and co-owners of an approved drug that the FDA list does not name (it shows one holder): plain ingredient name ->
// sponsor words. Daiichi Sankyo holds Enhertu, AstraZeneca co-develops it; Merus holds Bizengri, Partner Therapeutics runs
// its trials; Rigel holds Veppanu, Pfizer and Arvinas developed it.
export const COOWNER = { trastuzumabderuxtecan: ['astrazeneca'], zenocutuzumab: ['partner therapeutics'], vepdegestrant: ['pfizer', 'arvinas'] };
for (const [drug, [who]] of Object.entries(DRUG_RIGHTS)) COOWNER[drug] = [...(COOWNER[drug] || []), ...who];
// Is this name the sponsor's own fixed product of generic ingredients (seed/ownership.js)? "Amlodipine besylate And Folic Acid" by Ausa.
export const ownProduct = (name, sponsor) => { const o = OWN_PRODUCTS[String(name).toLowerCase().replace(/[^a-z0-9]/g, '')]; return !!o && String(sponsor).toLowerCase().includes(o[0]); };
// Short names trials use for approved drugs, which the FDA list does not carry: name (norm) -> FDA ingredient (norm).
// nab-paclitaxel is Abraxane, paclitaxel in the FDA list.
export const FDA_ABBREV = { tdm1: 'trastuzumabemtansine', tdxd: 'trastuzumabderuxtecan', ds8201: 'trastuzumabderuxtecan', ds8201a: 'trastuzumabderuxtecan',
  nabpaclitaxel: 'paclitaxel', albuminboundpaclitaxel: 'paclitaxel', paclitaxelalbuminbound: 'paclitaxel', nabptx: 'paclitaxel',
  degludec: 'insulindegludec', glargine: 'insulinglargine' };
export const owns = (owner, sponsor) => {
  const s = sponsor.toLowerCase(), o = owner.toLowerCase(), f = family(o);
  return s.includes(firstWord(owner)) || o.includes(firstWord(sponsor)) || (f >= 0 && f === family(s));
};
// Does this trial use the drug only as a control? arms: [{ type, names }], where names are the arm's interventions as the
// registry writes them, without the "Drug: " at the start, in lowercase. True when the trial has an experimental arm and the drug
// is either only in control arms, or in control arms too while another drug is only in the experimental arm: "durvalumab + BCG"
// against BCG makes BCG the background. A drug in both kinds of arm with nothing else tested is the same drug at another dose,
// so it stays. No arms, no experimental arm or a name the arms do not list: nothing to go on, so false.
const CONTROL_ARM = /_COMPARATOR$/;
const PLACEBO_NAME = /plac[e]?bo|plcaebo|plocebo|vehicle|sham/i;
export function usedOnlyAsControl(arms, name) {
  const n = String(name).trim().toLowerCase(), hasIt = a => a.names.includes(n);
  const test = arms.filter(a => a.type === 'EXPERIMENTAL'), control = arms.filter(a => CONTROL_ARM.test(a.type));
  if (!test.length || !control.some(hasIt)) return false;
  if (!test.some(hasIt)) return true;
  const inControl = new Set(control.flatMap(a => a.names));
  return test.some(a => a.names.some(x => !inControl.has(x) && !PLACEBO_NAME.test(x)));
}
