// Name map (src/ingest/namemap.js): which names get which official IDs, on a small made-up set of stored answers.
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { nameIds, keep } from '../src/ingest/namemap.js';
import { resolver } from '../src/ingest/druglists.js';

const db = new Database(':memory:');
db.exec('CREATE TABLE drug_list_lookup (list TEXT NOT NULL, query TEXT NOT NULL, hits TEXT, error TEXT, fetched_at TEXT, PRIMARY KEY (list, query))');
const put = (list, query, hits) => db.prepare('INSERT INTO drug_list_lookup (list, query, hits) VALUES (?,?,?)').run(list, query, JSON.stringify(hits));
// Lacutoclax: FDA entry, whose codes list PubChem 153515493. LP-108: NCI entry only; PubChem knows "LP108" as that compound.
put('gsrs', 'lacutoclax', [{ id: 'PMG5245L91', name: 'Lacutoclax' }]);
put('gsrs-codes', 'PMG5245L91', ['cid:153515493', 'nci:C203075', 'inn:12627']);
put('gsrs-names', 'PMG5245L91', ['Lacutoclax', 'lacutoclax [INN]']);
put('nci', 'lp-108', [{ id: '801885', name: 'Bcl-2 inhibitor LP-108', via: 'CodeName', biosimilar: false, names: ['LP-108'] }]);
put('nci-code', '801885', ['nci:C173536']);
put('pubchem', 'lp-108', []);
put('pubchem', 'lp108', ['153515493']);
put('pubchem-ids', '153515493', ['unii:PMG5245L91', 'nci:C203075', 'chembl:CHEMBL5314523']);
// IMVT-1402: not found by search, but listed among the names of the imeroprubart entry.
put('gsrs', 'imeroprubart', [{ id: 'PBD3BZ3HW6', name: 'Imeroprubart' }]);
put('gsrs-names', 'PBD3BZ3HW6', ['IMEROPRUBART', 'IMVT-1402']);
put('gsrs', 'imvt-1402', []); put('nci', 'imvt-1402', []);
// A name PubChem gives two compounds for, and a compound PubChem files under another FDA substance: neither used.
put('pubchem', 'mix-1', ['1', '2']);
put('gsrs', 'drugx', [{ id: 'AAAAAAAAA1', name: 'Drugx' }]);
put('pubchem', 'drugx', ['99']);
put('pubchem-ids', '99', ['unii:BBBBBBBBB2']);

const ids = nameIds(db, resolver(db));
const lac = ids('Lacutoclax'), lp = ids('LP-108');
assert.ok(lac.A.has('unii:PMG5245L91') && lac.A.has('cid:153515493'), 'lacutoclax: its FDA entry and the codes it lists');
assert.ok(lp.A.has('nci:C173536') && !lp.A.has('cid:153515493'), 'LP-108: its NCI code (another code than lacutoclax\'s)');
assert.equal(lp.P, '153515493', 'LP-108: PubChem compound from the spelling without hyphen');
assert.ok(ids('IMVT-1402').A.has('unii:PBD3BZ3HW6'), 'a name the FDA entry lists');
assert.equal(ids('MIX-1').P, null, 'two compounds for one name: not used');
assert.ok(!ids('Drugx').A.has('cid:99') && ids('Drugx').P === null, 'PubChem compound of another FDA substance: not used');
assert.equal(ids('X and Y').A.size, 0, 'two drugs in one name: nothing');

// What is kept of raw answers.
assert.deepEqual(keep['gsrs-codes']([{ codeSystem: 'PUBCHEM', code: '1', type: 'PRIMARY' }, { codeSystem: 'CAS', code: '2-2-2', type: 'SUPERSEDED' }, { codeSystem: 'MESH', code: 'D1', type: 'PRIMARY' }]), ['cid:1']);
assert.deepEqual(keep['pubchem-ids'](['Lacutoclax', 'PMG5245L91', 'NCI-C203075', 'CHEMBL5314523', 'DB21657', 'HY-156620']), ['unii:PMG5245L91', 'nci:C203075', 'chembl:CHEMBL5314523', 'drugbank:DB21657']);
console.log('PASS  name map: official IDs, PubChem names, and what is not used');
