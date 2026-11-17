// Where each registry disease term sits in the MeSH tree, from the US National Library of Medicine's MeSH query service.
// Writes seed/mesh-tree.csv: term, tree numbers (";"-joined), descriptors a supplementary concept maps to (";"-joined).
// Run after a data load adds new terms: DB_PATH=... node scripts/mesh-tree.mjs   (about 140 requests, a few minutes)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getDb } from '../src/db.js';

const OUT = new URL('../seed/mesh-tree.csv', import.meta.url);
const have = new Map();
if (existsSync(OUT)) for (const line of readFileSync(OUT, 'utf8').split('\n').slice(1)) { const m = line.match(/^"((?:[^"]|"")*)",([^,]*),(.*)$/); if (m) have.set(m[1].replace(/""/g, '"'), line); }
const terms = getDb().prepare('SELECT DISTINCT term FROM trial_mesh ORDER BY term').pluck().all();
const todo = terms.filter(t => !have.has(t));
console.log(`${terms.length} terms, ${have.size} known, ${todo.length} to look up`);
const q = s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;
async function ask(query) {
  const u = new URL('https://id.nlm.nih.gov/mesh/sparql');
  u.search = new URLSearchParams({ query, format: 'JSON', inference: 'true', year: 'current', limit: '1000' });
  let res, tries = 0;
  while (true) { res = await fetch(u, { headers: { 'User-Agent': 'OpenLandscape-loader/0.1' } }); if (res.ok) break; if (++tries > 4) throw new Error(`HTTP ${res.status}`); await new Promise(r => setTimeout(r, 3000 * tries)); }
  const rows = (await res.json()).results.bindings;
  if (rows.length >= 1000) throw new Error('answer cut at 1000 rows: use a smaller batch');
  return rows;
}
const PRE = 'PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ';
const STEP = 40;
for (let i = 0; i < todo.length; i += STEP) {
  const batch = todo.slice(i, i + STEP), list = batch.map(q).join(', ');
  // Descriptors have tree numbers; supplementary concepts (rare diseases, named syndromes) map to descriptors instead.
  const tn = await ask(`${PRE}SELECT DISTINCT ?label ?tn WHERE { ?d a meshv:TopicalDescriptor ; rdfs:label ?label ; meshv:treeNumber ?t . ?t rdfs:label ?tn . FILTER(?label IN (${list})) }`);
  const mp = await ask(`${PRE}SELECT DISTINCT ?label ?mapped WHERE { ?d a meshv:SCR_Disease ; rdfs:label ?label ; meshv:preferredMappedTo ?m . ?m rdfs:label ?mapped . FILTER(?label IN (${list})) }`);
  const found = new Map(batch.map(t => [t, { tn: new Set(), mapped: new Set() }]));
  for (const r of tn) found.get(r.label.value)?.tn.add(r.tn.value);
  for (const r of mp) found.get(r.label.value)?.mapped.add(r.mapped.value);
  for (const [t, f] of found) have.set(t, `"${t.replace(/"/g, '""')}",${[...f.tn].sort().join(';')},${[...f.mapped].sort().join(';')}`);
  process.stdout.write(`${Math.min(i + STEP, todo.length)}/${todo.length}\r`);
}
const lines = [...have.values()].sort();
writeFileSync(OUT, 'term,tree_numbers,mapped_to\n' + lines.join('\n') + '\n');
const noTn = lines.filter(l => /",,$/.test(l)).length, scr = lines.filter(l => /",,.+$/.test(l)).length;
console.log(`\nwritten ${lines.length} terms: ${lines.length - noTn - scr} with tree numbers, ${scr} supplementary concepts mapped to a descriptor, ${noTn} not found`);
