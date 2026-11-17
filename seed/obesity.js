// Hand-curated layer for the obesity landscape (6 Nov 2026).
// Source of the program list and alias merges: bakeoff/C_ground_truth.md and RESULTS.md (ClinicalTrials.gov pull, 6 Nov 2026).
// '~' before an alias = registry misspelling: used for matching, never shown.
// Rules: an alias merge or mechanism we have not confirmed from a source gets `?` (shown as an orange "unconfirmed" dot).
// Tickers are from the design mockup; companies without a researched listing show "Not yet researched".

// [id, display name, HQ country, ticker or '' (unknown) or 'private', registry sponsor-name patterns (lowercase substrings)]
export const companies = [
  ['abbvie', 'AbbVie', 'US', 'ABBV', ['abbvie']],
  ['aconcagua', 'Aconcagua Bio', '', '', ['aconcagua']],
  ['actimed', 'Actimed Therapeutics', 'GB', '', ['actimed']],
  ['alnylam', 'Alnylam', 'US', 'ALNY', ['alnylam']],
  ['alveus', 'Alveus Therapeutics', '', '', ['alveus']],
  ['amgen', 'Amgen', 'US', 'AMGN', ['amgen']],
  ['antag', 'Antag Therapeutics', 'DK', 'private', ['antag therapeutics']],
  ['aphaia', 'Aphaia Pharma', '', '', ['aphaia']],
  ['arrowhead', 'Arrowhead', 'US', 'ARWR', ['arrowhead']],
  ['ascletis', 'Ascletis', 'CN', '1672.HK', ['ascletis']],
  ['astrazeneca', 'AstraZeneca', 'GB', 'AZN', ['astrazeneca']],
  ['qlbio', 'QL Biopharm', 'CN', 'private', ['ql biopharm']],
  ['bioage', 'BioAge Labs', 'US', 'BIOA', ['bioage']],
  ['biohaven', 'Biohaven', 'US', 'BHVN', ['biohaven']],
  ['biomed', 'Biomed Industries', 'US', '', ['biomed industries']],
  ['biophytis', 'Biophytis', 'FR', '', ['biophytis']],
  ['boehringer', 'Boehringer Ingelheim', 'DE', 'private', ['boehringer']],
  ['brightminds', 'Bright Minds Biosciences', '', 'DRUG', ['bright minds']],
  ['brightgene', 'BrightGene', 'CN', '', ['brightgene']],
  ['cspc', 'CSPC', 'CN', '1093.HK', ['cspc']],
  ['diao', 'Chengdu DIAO', 'CN', 'private', ['diao pharmaceutical']],
  ['consynance', 'ConSynance Therapeutics', '', '', ['consynance']],
  ['erx', 'ERX Pharmaceuticals', '', '', ['erx pharmaceuticals']],
  ['eccogene', 'Eccogene', 'CN', '', ['eccogene']],
  ['ektah', 'EktaH', '', '', ['ektah']],
  ['lilly', 'Eli Lilly', 'US', 'LLY', ['eli lilly']],
  ['empros', 'Empros Pharma', 'SE', '', ['empros']],
  ['hengrui', 'Hengrui', 'CN', '600276.SS', ['hengrui', 'fujian shengdi', 'shandong suncadia']],
  ['kailera', 'Kailera', 'US', 'KLRA', ['kailera']], // Nasdaq KLRA, SEC CIK 2096997 (EDGAR, checked 6 Nov 2026)
  ['ganlee', 'Gan & Lee', 'CN', '603087.SS', ['gan & lee', 'gan and lee']],
  ['carnot', 'Carnot Laboratories', 'MX', '', ['carnot']],
  ['structure', 'Structure Therapeutics', 'US', 'GPCR', ['structure therapeutics', 'gasherbrum']],
  ['raynovent', 'Raynovent', 'CN', '', ['raynovent']],
  ['gubra', 'Gubra', 'DK', 'GUBRA.CO', ['gubra']],
  ['innon', 'HK inno.N', 'KR', '', ['inno.n']],
  ['sciwind', 'Sciwind Biosciences', 'CN', 'private', ['sciwind']],
  ['huadong', 'Huadong Medicine', 'CN', '000963.SZ', ['huadong']],
  ['hanmi', 'Hanmi', 'KR', '128940.KS', ['hanmi']],
  ['harmony', 'Harmony Biosciences', 'US', 'HRMY', ['harmony biosciences']],
  ['roche', 'Roche', 'CH', 'ROG.SW', ['hoffmann-la roche', 'genentech']],
  ['hudson', 'Hudson Biotech', '', '', ['hudson biotech']],
  ['ikaria', 'Ikaria Bioscience', 'AU', '', ['ikaria']],
  ['immunwork', 'Immunwork', 'TW', '', ['immunwork']],
  ['innovent', 'Innovent', 'CN', '1801.HK', ['innovent']],
  ['keybio', 'KeyBioscience', 'CH', '', ['keybioscience']],
  ['lumos', 'Lumos Pharma', 'US', '', ['lumos pharma']],
  ['mankind', 'Mankind Pharma', 'IN', 'MANKIND.NS', ['mankind']],
  ['mindrank', 'MindRank AI', 'CN', 'private', ['mindrank']],
  ['neurobiogen', 'NeuroBiogen', 'KR', '', ['neurobiogen']],
  ['novo', 'Novo Nordisk', 'DK', 'NVO', ['novo nordisk']],
  ['unitedlabs', 'United Laboratories', 'CN', '3933.HK', ['united bio-technology', 'united laboratories']],
  ['palatin', 'Palatin', 'US', 'PTN', ['palatin']],
  ['pfizer', 'Pfizer', 'US', 'PFE', ['pfizer', 'metsera']],
  ['regeneron', 'Regeneron', 'US', 'REGN', ['regeneron']],
  ['rhythm', 'Rhythm', 'US', 'RYTM', ['rhythm pharmaceuticals']],
  ['s1bio', 'S1 Biopharma', '', '', ['s1 biopharma']],
  ['minwei', 'Shanghai Minwei', 'CN', '', ['minwei']],
  ['sirius', 'Sirius Therapeutics', 'CN', '', ['sirius therapeutics']],
  ['sun', 'Sun Pharma', 'IN', 'SUNPHARMA.NS', ['sun pharmaceutical']],
  ['tonghua', 'Tonghua Dongbao', 'CN', '600867.SS', ['tonghua dongbao']],
  ['veru', 'Veru', 'US', 'VERU', ['veru']],
  ['viking', 'Viking', 'US', 'VKTX', ['viking therapeutics']],
  ['vincentage', 'Vincentage Pharma', 'CN', '', ['vincentage']],
  ['wave', 'Wave Life Sciences', 'SG', 'WVE', ['wave life sciences']],
];

// [display name, companies, aliases ('?' suffix = merge unconfirmed), mechanism ('?' suffix = unconfirmed, '' = not yet classified), tags]
export const drugs = [
  ['ABBV-295', ['abbvie'], [], '', ''],
  ['ACCG-2671', ['aconcagua'], [], '', ''],
  ['(S)-pindolol benzoate', ['actimed'], [], '', 'other'],
  ['ALN-2232', ['alnylam'], [], 'siRNA, target not disclosed?', 'other sirna'],
  ['ALN-4324', ['alnylam'], [], 'siRNA, target not disclosed?', 'other sirna'],
  ['ALV-100', ['alveus'], [], '', ''],
  ['maridebart cafraglutide', ['amgen'], ['MariTide', 'AMG 133'], 'GLP-1 agonist + GIPR antagonist antibody', 'glp'],
  ['AT673', ['antag'], [], 'GIP receptor antagonist', 'other'],
  ['APH-012', ['aphaia'], ['APHD-012', 'APHP-012', 'APHD-002', 'APHP-002'], '', 'other'],
  ['ARO-ALK7', ['arrowhead'], [], 'ALK7 siRNA', 'other sirna'],
  ['ARO-INHBE', ['arrowhead'], [], 'INHBE siRNA', 'other sirna'],
  ['ASC30', ['ascletis'], [], 'Oral small-molecule GLP-1', 'glp oral'],
  ['elecoglipron', ['astrazeneca'], ['AZD5004', 'ECC5004'], 'Oral small-molecule GLP-1', 'glp oral'],
  ['lenbelintide', ['astrazeneca'], ['AZD6234?'], 'Amylin', 'amylin'],
  ['AZD9550', ['astrazeneca'], [], 'GLP-1 / glucagon?', 'glp'],
  ['zovaglutide', ['qlbio'], [], 'GLP-1?', 'glp'],
  ['ZT006', ['qlbio'], [], '', ''],
  ['BGE-102', ['bioage'], [], 'NLRP3 inhibitor?', 'other oral'],
  ['taldefgrobep alfa', ['biohaven'], [], 'Anti-myostatin adnectin', 'other'],
  ['NA-931', ['biomed'], [], 'Multi-receptor agonist incl. GLP-1?', 'glp oral'],
  ['BIO101', ['biophytis'], ['20-hydroxyecdysone?'], 'MAS receptor activator?', 'other oral'],
  ['BI 3034701', ['boehringer'], [], '', ''],
  ['BMB-101', ['brightminds'], [], '5-HT2C agonist?', 'other'],
  ['BGM0504', ['brightgene'], [], 'GLP-1 / GIP?', 'glp'],
  ['BGM1812', ['brightgene'], [], '', ''],
  ['SYH2069', ['cspc'], [], '', ''],
  ['DA-302168S', ['diao'], [], 'Oral small-molecule GLP-1?', 'glp oral'],
  ['CSTI-500', ['consynance'], [], '', ''],
  ['ERX1000', ['erx'], [], '', ''],
  ['ECC4703', ['eccogene'], [], 'THR-beta agonist?', 'other oral'],
  ['NKS-3', ['ektah'], ['modified linoleic acid'], 'Fat-taste receptor agonist (CD36 / GPR120)', 'other'],
  ['bimagrumab', ['lilly'], ['BYM338'], 'Activin type II receptor antibody', 'other'],
  ['eloralintide', ['lilly'], ['LY3841136'], 'Amylin', 'amylin'],
  ['mazdutide', ['lilly', 'innovent'], ['LY3305677', 'IBI362'], 'GLP-1 / glucagon', 'glp'],
  ['LY3457263', ['lilly'], [], '', ''],
  ['LY3549492', ['lilly'], [], '', ''],
  ['LY4086940', ['lilly'], [], '', ''],
  // LY3532226 is macupatide: Lilly's trial title NCT07765511 "Macupatide (LY3532226)"; FDA GSRS UNII YWF427CA5D lists both.
  ['macupatide', ['lilly'], ['LY3532226'], '', '', 'https://precision.fda.gov/uniisearch/srs/unii/YWF427CA5D'],
  ['orforglipron', ['lilly'], ['LY3502970', 'Foundayo'], 'Oral small-molecule GLP-1', 'glp oral'],
  ['retatrutide', ['lilly'], ['LY3437943'], 'GIP / GLP-1 / glucagon', 'glp'],
  ['tirzepatide', ['lilly'], ['LY3298176', 'Zepbound', 'Mounjaro'], 'GIP / GLP-1', 'glp'],
  ['EMP16', ['empros'], ['EMP16-02'], 'Orlistat + acarbose, fixed dose', 'other oral'],
  ['HRS-4729', ['hengrui'], [], '', ''],
  ['ribupatide', ['hengrui', 'kailera'], ['HRS9531?', 'KAI-9531?'], 'GLP-1 / GIP', 'glp'],
  ['HRS-7535', ['hengrui', 'kailera'], ['KAI-7535'], 'Oral small-molecule GLP-1', 'glp oral'],
  ['bofanglutide', ['ganlee', 'carnot'], ['GZR18', 'bofanglutida'], 'GLP-1, every two weeks', 'glp'],
  ['aleniglipron', ['structure'], ['GSBR-1290'], 'Oral small-molecule GLP-1', 'glp oral'],
  ['RAY1225', ['raynovent'], [], 'GLP-1 / GIP?', 'glp'],
  ['GUB-UCN2', ['gubra'], [], 'Urocortin-2 (CRF2 agonist)', 'other'],
  ['IN-B00009', ['innon'], [], '', ''],
  ['ecnoglutide', ['sciwind'], ['XW003'], 'GLP-1, cAMP-biased', 'glp'],
  ['HDM1002', ['huadong'], [], 'Oral small-molecule GLP-1?', 'glp oral'],
  ['HDM1005', ['huadong'], [], 'GLP-1 / GIP?', 'glp'],
  ['HDM1702', ['huadong'], [], '', ''],
  ['HM15275', ['hanmi'], [], 'GLP-1 / GIP / glucagon?', 'glp'],
  ['pitolisant', ['harmony'], ['Wakix'], 'Histamine H3 receptor antagonist / inverse agonist', 'other oral'],
  ['RO7204239', ['roche'], ['GYM329'], 'Anti-myostatin antibody?', 'other'],
  ['MOTS-c', ['hudson'], [], 'Mitochondrial-derived peptide', 'other'],
  ['RN3161', ['ikaria'], [], '', ''],
  ['TE-8105', ['immunwork'], [], '', ''],
  ['KBP-336', ['keybio'], [], 'Dual amylin / calcitonin receptor agonist?', 'amylin'],
  ['LUM-201', ['lumos'], ['ibutamoren'], 'Oral growth hormone secretagogue', 'other oral'],
  ['MKP10241', ['mankind'], [], '', ''],
  ['MDR-001', ['mindrank'], [], 'Oral small-molecule GLP-1', 'glp oral'],
  ['KDS2010', ['neurobiogen'], [], 'MAO-B inhibitor?', 'other oral'],
  ['cagrilintide', ['novo'], ['NNC0174-0833'], 'Amylin', 'amylin'],   // code: EU trial 2022-502678-18-00
  ['CagriSema', ['novo'], ['cagrilintide + semaglutide', 'CagriSema (Cagrilintide B and Semaglutide I)'], 'Amylin + GLP-1', 'glp amylin'],
  ['amycretin', ['novo'], ['NNC0487-0111?', 'zenagamtide'], 'GLP-1 / amylin, one molecule', 'glp amylin'],
  ['NNC0519-0130', ['novo'], [], '', ''],
  ['NNC0662-0419', ['novo'], [], '', ''],
  ['semaglutide', ['novo'], ['Wegovy', 'Ozempic', 'Rybelsus', '~Semagludtide'], 'GLP-1', 'glp'],
  ['UBT251', ['unitedlabs', 'novo'], [], 'GLP-1 / GIP / glucagon?', 'glp'],
  ['bremelanotide', ['palatin'], ['Vyleesi'], 'MC4R agonist', 'other'],
  ['berobenatide', ['pfizer'], ['MET-097i?', 'MET097?', 'PF-08653944'], 'Long-acting GLP-1', 'glp'],
  ['PF-08653945', ['pfizer'], [], '', ''],
  ['garetosmab', ['regeneron'], [], 'Activin A antibody', 'other'],
  ['trevogrumab', ['regeneron'], ['REGN1033'], 'Myostatin antibody', 'other'],
  ['mibavademab', ['regeneron'], [], 'Leptin receptor agonist antibody', 'other'],
  ['olatorepatide', ['regeneron', 'hansoh'], ['HS-20094'], 'Incretin peptide?', 'glp'],   // Hansoh's HS-20094, licensed to Regeneron; code: NCT07431086, EU trial 2025-524860-39-00
  ['ALN-CIDEB', ['regeneron', 'alnylam'], [], 'CIDEB siRNA', 'other sirna'],
  ['setmelanotide', ['rhythm'], ['Imcivree'], 'MC4R agonist', 'other'],
  ['bivamelagon', ['rhythm'], [], 'Oral MC4R agonist', 'other oral'],
  ['RM-718', ['rhythm'], [], 'MC4R agonist', 'other'],
  ['S1B-509', ['s1bio'], [], '', ''],
  ['MWN109', ['minwei'], [], '', ''],
  ['SRSD384', ['sirius'], [], 'siRNA?', 'other sirna'],
  ['GL0034', ['sun'], [], 'Long-acting GLP-1?', 'glp'],
  ['THDBH120', ['tonghua'], [], 'GLP-1 / GIP?', 'glp'],
  ['enobosarm', ['veru'], ['GTx-024'], 'SARM, muscle preservation', 'other oral'],
  ['VK2735', ['viking'], ['VK2735 oral'], 'GLP-1 / GIP', 'glp oral'],
  ['VCT220', ['vincentage'], [], 'Oral small-molecule GLP-1?', 'glp oral'],
  ['WVE-007', ['wave'], [], 'INHBE siRNA', 'other sirna'],
];

// Status beyond the registry (filed / approved outside the US). US approvals come from openFDA automatically.
// [drug, label, level (4 filed, 5 approved), source URL]  -- all news-based, so shown with a "news" tag.
export const statuses = [
  ['mazdutide', 'Approved (China)', 5, 'https://www.biospace.com/press-releases/innovent-announces-mazdutide-first-dual-gcg-glp-1-receptor-agonist-received-approval-from-chinas-nmpa-for-chronic-weight-management'],
  ['ecnoglutide', 'Approved (China)', 5, 'https://www.biospace.com/press-releases/sciwind-biosciences-announces-ecnoglutide-injection-approved-by-chinas-national-medical-products-administration-nmpa-for-chronic-weight-management'],
  ['CagriSema', 'Filed (US)', 4, 'https://www.pharmexec.com/view/novo-nordisk-submits-nda-fda-cagrisema'],
  ['ribupatide', 'Filed (China)', 4, 'https://www.clinicaltrialvanguard.com/news/hengrui-kailera-phase-3-obesity-trial-data-revealed-in-china/'],
  ['HRS-7535', 'Filed (China)', 4, 'https://www.itiger.com/news/1125110251'],
];

// News catalysts (not in the registry). [drug, ISO date or month, what, source URL, confirmed by company?]
export const catalysts = [
  ['CagriSema', '2026-12', 'US FDA decision expected in Q4 2026 (company guidance, exact date not public)', 'https://www.pharmexec.com/view/novo-nordisk-submits-nda-fda-cagrisema', 0],
];

// FDA-approved, but for a different disease: keep the registry phase for obesity, link the approval as context.
// garetosmab: approved Aug 2026 for fibrodysplasia ossificans progressiva (Pasatru), in Phase 2 for obesity.
export const approvedForOtherUse = ['pitolisant', 'bremelanotide', 'garetosmab'];

// Tested in people with obesity but not obesity drugs (or approved comparators/background drugs). Hidden from the obesity landscape.
// Same judgement as bakeoff/C_ground_truth.md; reviewed by hand 6 Nov 2026.
export const areaExclusions = {
  obesity: [
    ['mirikizumab', 'IL-23 antibody for psoriasis/IBD, tested in people with obesity'],
    ['clazakizumab', 'IL-6 antibody, cardiovascular/kidney study population with obesity'],
    ['alirocumab', 'PCSK9 cholesterol drug'],
    ['tradipitant', 'NK1 antagonist for nausea/gastroparesis'],
    ['liraglutide', 'Older approved GLP-1, used as comparator'],
    ['rosuvastatin', 'Statin, drug-interaction study'],
    ['insulin glargine u-100', 'Background insulin'],
    ['coartem baby', 'Antimalarial'],
    ['alli', 'Approved orlistat used as comparator'],
  ],
};

// Hand-checked matching decisions. Applied last by src/ingest/studies.js; nothing automatic undoes them.
// sameStudy: [record id, record id, source URL]   e.g. ['NCT06000000', 'CTR20250935', 'https://...']
// notSameStudy: [record id, record id, reason]    notSameDrug: [name or code, name or code, reason]
// companyParents: [child company id or subsidiary name, parent company id, source URL]
export const sameStudy = [];
export const notSameStudy = [];
export const notSameDrug = [];
export const companyParents = [];
