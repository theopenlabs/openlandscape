// One drug, one row (src/ingest/onerow.js): which names count as the same drug.
import assert from 'node:assert';
import { canon, misspelt, oneEdit, productTest, shortName, showSeedOwner, textNamesBoth } from '../src/ingest/onerow.js';
import { family, owns, COOWNER, ownProduct } from '../src/owners.js';
import { COMPANIES, DRUG_RIGHTS, DRUG_OWNER, OWN_PRODUCTS } from '../seed/ownership.js';
import { HAS_CHECKED_DATA, skip } from './private.js';

const same = (a, b) => assert.equal(canon(a), canon(b), `${a} = ${b}`);
const differ = (a, b) => assert.notEqual(canon(a), canon(b), `${a} != ${b}`);

// Form, dose and arm words, salts and FDA suffixes.
same('Ruxolitinib Cream', 'ruxolitinib');
same('Blinded Envudeucitinib', 'Envudeucitinib');
same('Open-Label rusfertide', 'Rusfertide');
same('Risankizumab On-Body Injector', 'Risankizumab');
same('ianalumab s.c. q12w', 'ianalumab');
same('Hetrombopag Olamine', 'Hetrombopag');
same('Onasemnogene Abeparvovec-xioi', 'onasemnogene abeparvovec');
same('VYD2311-MD', 'VYD2311');
same('Test drug CB03-154', 'CB03-154');
same('PCV21 vaccine', 'PCV21');
// Different products with similar names stay apart.
differ('ARO-ENaC', 'ARO-RAGE');
differ('RAPA-501-Allo', 'RAPA-501');
differ('DTaP-IPV-Hib-HepB vaccine', 'DTaP-IPV/Hib');
differ('T-614', 'T-773');

assert(oneEdit('iptacopan', 'iptcaopan'));
assert(oneEdit('rituximab', 'rituxumab'));
assert(!oneEdit('prednisone', 'prednisolone'));

assert(misspelt('Iptacopan', 'Iptcaopan'));
assert(misspelt('Varicella Vaccine', 'Vaicella Vaccine'));
assert(!misspelt('MenACWY vaccine', 'MenABCWY vaccine'), 'a different vaccine');
assert(!misspelt('Cecolin', 'Hecolin'), 'first letter differs: two products');
assert(!misspelt('Vaccine A', 'Vaccine C'), 'a letter is a label');
assert(!misspelt('TVAX-008', 'TVAV-008'), 'codes are not spelling');

// A trial's text giving two names as one drug.
assert(textNamesBoth('A Phase III study of Recombinant 14-Valent Human Papillomavirus Vaccine (SCT1000) in women', 'SCT1000', 'Recombinant 14-Valent Human Papillomavirus Vaccine'));
assert(textNamesBoth('Lacutoclax (LP-108) in CLL', 'LP-108', 'Lacutoclax'));
assert(textNamesBoth('del-desiran, formerly AOC 1001, in DM1', 'Del-desiran', 'AOC 1001'));
assert(textNamesBoth('isuzinaxib (code: APX-115)', 'APX-115', 'Isuzinaxib'));
assert(!textNamesBoth('Phesgo (pertuzumab, trastuzumab and hyaluronidase)', 'Phesgo', 'Trastuzumab'), 'a list in brackets');
assert(!textNamesBoth('SHR-A1811 (5.4 mg/kg) versus trastuzumab', 'SHR-A1811', 'Trastuzumab'), 'a dose in brackets');
assert(!textNamesBoth('LP-1080 (lacutoclax)', 'LP-108', 'Lacutoclax'), 'a longer code');
assert(!textNamesBoth('Drug X with LP-108 and lacutoclax', 'LP-108', 'Lacutoclax'), 'both named, not linked');

if (!HAS_CHECKED_DATA) skip('the ownership table');
else {
// The ownership table.
assert.equal(family('Immunomedics, Inc.'), family('Gilead Sciences'));
assert.equal(family('Swedish Orphan Biovitrum'), family('SOBI'));
assert.equal(family('Akesobio Australia Pty'), -1, 'a table word matches at the start of a word only');
assert(owns('X4 PHARMS', 'X4 Pharmaceuticals'), 'a short code is a first word');
assert(owns('RENGENERON PHARMACEUTICALS, INC.', 'Regeneron Pharmaceuticals'), 'FDA typo');
assert(owns('BEIGENE', 'BeOne Medicines'), 'renamed company');
assert(COOWNER.dupilumab.includes('sanofi'));
assert(COMPANIES.every(c => c[3]) && Object.values(DRUG_RIGHTS).every(d => d[1]), 'every line has a source');
}

// A combination that is one marketed product keeps its row.
const isProduct = productTest([
  { appl_no: 'BLA1', brand: 'OPDUALAG', ingredient: 'nivolumab' }, { appl_no: 'BLA1', brand: 'OPDUALAG', ingredient: 'relatlimab-rmbw' },
  { appl_no: 'BLA2', brand: 'PHESGO', ingredient: 'pertuzumab, trastuzumab, and hyaluronidase-zzxf' },
  { appl_no: 'NDA3', brand: 'INVOKAMET XR', ingredient: 'canagliflozin' }, { appl_no: 'NDA3', brand: 'INVOKAMET XR', ingredient: 'metformin hydrochloride' },
  { appl_no: 'BLA4', brand: 'OPDIVO', ingredient: 'nivolumab' }, { appl_no: 'NDA5', brand: 'LUMAKRAS', ingredient: 'sotorasib' },
]);
assert(isProduct(['Nivolumab', 'Relatlimab']), 'Opdualag: one application holds both');
assert(isProduct(['Pertuzumab', 'Trastuzumab']), 'Phesgo: one "a, b, and c" row');
assert(isProduct(['Canagliflozin', 'Metformin Extended Release']), 'Invokamet XR');
assert(isProduct(['casirivimab', 'imdevimab'], ['casirivimab+imdevimab', 'REGN-COV2', 'REGEN-COV™']), 'a trademark that is neither part');
assert(isProduct(['HRS-1', 'HRS-2'], ['HRS-1 and HRS-2 fixed dose combination']), 'the registry says fixed dose');
assert(!isProduct(['HRS-6209', 'HRS-8080'], ['HRS-6209 + HRS-8080']), 'two codes given together');
assert(!isProduct(['avutometinib', 'sotorasib'], ['avutometinib and sotorasib', 'LUMAKRAS™']), 'a part\'s own brand proves nothing');
assert(!isProduct(['Nivolumab', 'Nivolumab']), 'one drug twice');

console.log('onerow: ok');

// Partner labels from sponsor names.
assert.equal(shortName('RECORDATI GROUP'), 'Recordati');
assert.equal(shortName('Teva Branded Pharmaceutical Products R&D LLC'), 'Teva Branded Pharmaceutical Products R&D');
assert.equal(shortName('Alphamab (Australia) Co Pty Ltd.'), 'Alphamab');
assert.equal(shortName('Inhibrx Biosciences, Inc'), 'Inhibrx Biosciences');
assert.equal(shortName('Erasca, Inc.'), 'Erasca');

if (!HAS_CHECKED_DATA) skip('owners named in the seed, licensees and own products');
else {
// An owner that sponsors none of the drug's trials is named in the seed: the row shows that label, other rows are left alone.
assert([...Object.values(DRUG_OWNER), ...Object.values(OWN_PRODUCTS)].every(d => d[0] && /^https?:/.test(d[1])), 'every owner line has a source');
const shown = [], fakeDb = { prepare: sql => (/^UPDATE/.test(sql) ? { run: (company, id) => shown.push([id, company]) } : { all: () => [{ id: 'v', name: 'Vepdegestrant', company: 'Pfizer' }, { id: 'k', name: 'Klenzit-C', company: 'Glenmark Pharmaceuticals' }, { id: 'o', name: 'Otherdrug', company: 'Pfizer' }] }) };
assert.equal(showSeedOwner({ db: fakeDb }), 1);
assert.deepEqual(shown, [['v', 'Rigel Pharmaceuticals · Pfizer · Arvinas']]);
// A licensee counts as an owner of the approved drug, so "Motixafortide+G-CSF" by Gloria is named for motixafortide.
assert(COOWNER.motixafortide.includes('gloria'));
// A sponsor's own tablet of two generic drugs is one product, for that sponsor only.
assert(ownProduct('Amlodipine besylate And Folic Acid', 'Shenzhen Ausa Pharmed Co.,Ltd'));
assert(!ownProduct('Amlodipine besylate And Folic Acid', 'Pfizer') && !ownProduct('Amlodipine besylate', 'Shenzhen Ausa Pharmed Co.,Ltd'));
}
