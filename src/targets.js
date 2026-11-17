// One name per target, from the targets readers stored with their verdicts (seed/row-verdicts.csv, `target`).
// Readers wrote targets as the trials write them, so one target has several spellings. Two spellings are one target when
//  - they are the same once case, hyphens, spaces and dots are ignored and Greek letters are spelled out
//    ("GPC-3" = "GPC3", "PD-1" = "PD1", "Bcl-2" = "BCL2", "PI3Kα" = "PI3K alpha"), or
//  - seed/target-names.csv says so (real other names: "Claudin 18.2" = "CLDN18.2", "GLP-1 receptor" = "GLP-1").
// Nothing else is merged: "PI3Kα" is not "PI3Kδ", "TNF-alpha" is not "TNF", "IL-2 β/γ" is not "IL-2".
// A combination ("EGFR + c-Met", "BCMA x CD3") is split into its parts; each part is grouped on its own.
// The name shown for a target is the one in seed/target-names.csv, else its most common spelling.
// Drugs with an FDA drug class that names a target get it too (FDA_CLASS_TARGETS below; src/query.js storedTargets).
import { readFileSync } from 'node:fs';
import { parseCsv } from './scoreboard.js';

const NAMES = new URL('../seed/target-names.csv', import.meta.url);
const GREEK = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'κ': 'kappa', 'ε': 'epsilon' };
export const targetKey = s => String(s || '').toLowerCase().replace(/[αβγδκε]/g, c => GREEK[c]).replace(/[-\s.]+/g, '');
// "PI3Kα" -> "pi3kalpha", "CLDN18.2" -> "cldn18.2", "IL-2 β/γ" -> "il-2-beta-gamma": the target page's address.
export const targetSlug = s => String(s || '').toLowerCase().replace(/[αβγδκε]/g, c => GREEK[c]).replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
export const isUnknown = t => !String(t || '').trim() || /^unknown$/i.test(String(t).trim());
export const splitTarget = t => isUnknown(t) ? [] : String(t).split(/\s+(?:\+|x)\s+/).map(s => s.trim()).filter(Boolean);

// The target an FDA drug class names (seed/fda-class-targets.csv), by class in lower case: "interleukin-23 antagonist" -> "IL-23".
// Only classes that name one target are listed; "Kinase Inhibitor" names none.
export const FDA_CLASS_TARGETS = new Map(parseCsv(readFileSync(new URL('../seed/fda-class-targets.csv', import.meta.url), 'utf8')).map(r => [r.fda_class.toLowerCase(), r.target]));

// Targets an official drug list states (seed/list-targets.csv: the FDA substance registry's TARGET relationships, the NCI
// drug dictionary's definition), for drugs whose trials never name one. One line per drug: its name (or another name of
// the row), company, target and where the list says it. A line's company must be part of the row's company ("Janssen"
// finds "Janssen Research & Development, LLC").
export const LIST_TARGETS = parseCsv(readFileSync(new URL('../seed/list-targets.csv', import.meta.url), 'utf8'));

// The groups, from every stored target spelling: { byKey: key -> group, bySlug: slug -> group }, group = { name, slug, spellings }.
export function buildGroups(targets, names = parseCsv(readFileSync(NAMES, 'utf8'))) {
  const alias = new Map();   // key of an other name -> key of the name it is
  const fixed = new Map();   // key -> the name to show
  for (const n of names) {
    const k = targetKey(n.target);
    fixed.set(k, n.target);
    if (targetKey(n.same_as) !== k) alias.set(targetKey(n.same_as), k);
  }
  const counts = new Map();   // group key -> Map(spelling -> rows)
  for (const t of targets) for (const part of splitTarget(t)) {
    const k = alias.get(targetKey(part)) || targetKey(part);
    if (!counts.has(k)) counts.set(k, new Map());
    counts.get(k).set(part, (counts.get(k).get(part) || 0) + 1);
  }
  const byKey = new Map(), bySlug = new Map();
  for (const [k, sp] of counts) {
    const name = fixed.get(k) || [...sp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const g = { name, slug: targetSlug(name), spellings: [...new Set([name, ...sp.keys(), ...names.filter(n => targetKey(n.target) === k).map(n => n.same_as)])] };
    byKey.set(k, g); bySlug.set(g.slug, g);
  }
  for (const [a, k] of alias) if (byKey.has(k)) byKey.set(a, byKey.get(k));
  return { byKey, bySlug };
}

// The groups of one stored target ("EGFR + cMET" -> the EGFR and MET groups).
export const groupsOf = (groups, t) => [...new Set(splitTarget(t).map(p => groups.byKey.get(targetKey(p))).filter(Boolean))];
