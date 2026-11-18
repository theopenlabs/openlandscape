// Every disease page's top 10 and counts, worked out in advance (step 18, 18 Nov 2026). Google opens all 1,628 disease pages
// and is not held to the page limit, and the biggest list takes seconds to build, so signed-out pages never build one: they
// read what this helper keeps. After each server start a worker thread (so pages keep answering) goes through every disease
// at an easy pace, pausing as long as each one took, and sends the results back as it goes. In all it is about 200 s of
// work; the weekday data reload restarts the server, so the lists follow new trials. Until a disease is done its page shows
// as before, without the list.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const kept = new Map();   // slug -> diseaseSummary (src/diseasemap.js)
const state = { started: 0, done: 0, ms: 0, cpu: 0, count: 0, errors: 0 };
export const diseaseTop = slug => kept.get(slug) || null;
export const diseaseTopState = () => ({ ...state, kept: kept.size });

// Starts the helper. `slugs`: only these (tests); `pace`: pause after each disease, as a share of the time it took.
// Resolves when every disease is done.
export function startDiseaseTop({ slugs = null, pace = 1 } = {}) {
  state.started = Date.now(); state.done = 0;
  return new Promise(resolve => {
    const w = new Worker(new URL(import.meta.url), { workerData: { diseasetop: true, slugs, pace } });
    w.unref();
    w.on('message', m => {
      if (m.items) for (const [slug, s] of m.items) kept.set(slug, s);
      if (m.end) { Object.assign(state, m.end, { done: Date.now() }); resolve(diseaseTopState()); }
    });
    w.on('error', e => { console.error('disease lists', e.stack || e.message); state.errors++; resolve(diseaseTopState()); });
  });
}

if (!isMainThread && workerData?.diseasetop) {
  const { diseaseMap, diseaseDrugs, diseaseSummary, subtree, termSlug } = await import('./diseasemap.js');
  const { nodes } = diseaseMap();
  // The biggest diseases first: the most visited, and the ones a visitor would wait longest for.
  const size = new Map([...nodes.values()].map(n => [n.name, [...subtree(n.name)].reduce((a, k) => a + nodes.get(k).active, 0)]));
  const slugs = workerData.slugs || [...nodes.values()].sort((a, b) => size.get(b.name) - size.get(a.name)).map(n => termSlug(n.name));
  const t0 = Date.now(), cpu0 = process.cpuUsage();
  let batch = [], errors = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const slug of slugs) {
    const t = Date.now();
    try { const L = diseaseDrugs(slug); if (L) batch.push([slug, diseaseSummary(L)]); } catch (e) { errors++; console.error('disease list', slug, e.message); }
    if (batch.length >= 25) { parentPort.postMessage({ items: batch }); batch = []; }
    await wait(Math.max(2, (Date.now() - t) * workerData.pace));
  }
  const c = process.cpuUsage(cpu0);
  parentPort.postMessage({ items: batch, end: { ms: Date.now() - t0, cpu: Math.round((c.user + c.system) / 1000), count: slugs.length, errors } });
}
