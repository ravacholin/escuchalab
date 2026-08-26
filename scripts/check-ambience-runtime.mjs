#!/usr/bin/env node
// Runtime checks for the ambience engine. No API key, no network, no browser.
//
// check:ambience asserts things about tables and baked WAVs. It cannot tell you whether
// the engine, when actually run, builds the graph those tables describe — and that blind
// spot is where the worst bug in the old system lived: a stem loader whose guard always
// failed, so no scene ever had a bed and a learner heard only disembodied clicks. So:
// instantiate the real engine against a fake AudioContext and assert on the graph it
// produces, across all scenes.

import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { FakeAudioContext, installBrowserGlobals, flushMicrotasks } from './ambience/fakeWebAudio.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function bundle() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-ambience-runtime-'));
  const entry = path.join(dir, 'entry.ts');
  const outfile = path.join(dir, 'bundle.mjs');
  const enginePath = path.join(ROOT, 'services', 'ambienceEngine').replace(/\\/g, '/');
  const presetsPath = path.join(ROOT, 'services', 'ambiencePresets').replace(/\\/g, '/');
  writeFileSync(entry, `
    export { AmbienceEngine } from '${enginePath}';
    export { SCENE_RECIPES, SCENE_IDS, resolveAmbienceScene } from '${presetsPath}';
  `);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

const { AmbienceEngine, SCENE_RECIPES, SCENE_IDS } = await bundle();

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const ok = (m) => notes.push(m);

// Reachability from a node to the destination, following recorded connections.
function reaches(node, destination) {
  const seen = new Set();
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n === destination) return true;
    if (!n || seen.has(n)) continue;
    seen.add(n);
    for (const out of n.outputs ?? []) stack.push(out);
  }
  return false;
}

const bedSourcesOf = (ctx) => ctx.startedSources.filter((s) => s.buffer?.fromDecode && s.loop);

// ---------------------------------------------------------------------------
// 1. Every scene starts a source per bed playhead, and every bed reaches the output.
//    (The engine runs two detuned playheads per bed layer for width.)
// ---------------------------------------------------------------------------
let scenesChecked = 0;
for (const id of SCENE_IDS) {
  const restore = installBrowserGlobals();
  try {
    const ctx = new FakeAudioContext();
    const scene = { id, recipe: SCENE_RECIPES[id], source: 'label' };
    const engine = new AmbienceEngine(ctx, ctx.destination, scene, 'seed', { volume: 0.6, intensity: 0.6 });
    await flushMicrotasks();
    const layers = SCENE_RECIPES[id].beds.length;
    const beds = bedSourcesOf(ctx);
    if (beds.length !== layers * 2) {
      fail(`${id}: ${beds.length} bed playheads started, expected ${layers * 2} (${layers} layers × 2)`);
    }
    const unreached = beds.filter((s) => !reaches(s, ctx.destination));
    if (unreached.length) fail(`${id}: ${unreached.length} bed source(s) do not reach the destination`);
    engine.stop();
    scenesChecked += 1;
  } finally { restore(); }
}
if (!failures.length) ok(`all ${scenesChecked} scenes start every bed playhead and route it to the output`);

// ---------------------------------------------------------------------------
// 2. Loading does not depend on start(); stop() before the load resolves cancels it.
// ---------------------------------------------------------------------------
{
  const restore = installBrowserGlobals();
  try {
    const ctx = new FakeAudioContext();
    const scene = { id: 'cafe', recipe: SCENE_RECIPES.cafe, source: 'label' };
    // Construct only — never call start().
    new AmbienceEngine(ctx, ctx.destination, scene, 'seed', { volume: 0.6, intensity: 0.6 });
    await flushMicrotasks();
    if (bedSourcesOf(ctx).length === 0) fail('beds do not load without start() being called');
    else ok('beds load from the constructor, independent of start()');
  } finally { restore(); }

  const restore2 = installBrowserGlobals();
  try {
    const ctx = new FakeAudioContext();
    const scene = { id: 'cafe', recipe: SCENE_RECIPES.cafe, source: 'label' };
    const engine = new AmbienceEngine(ctx, ctx.destination, scene, 'seed', { volume: 0.6, intensity: 0.6 });
    engine.stop(); // dispose before the async load can resolve
    await flushMicrotasks();
    if (bedSourcesOf(ctx).length > 0) fail('stop() before load resolves still started bed sources');
    else ok('stop() before the load resolves cancels it (no orphaned sources)');
  } finally { restore2(); }
}

// ---------------------------------------------------------------------------
// 3. The event scheduler keeps firing, and intensity actually moves the rate.
// ---------------------------------------------------------------------------
function countEvents(id, intensity, seconds) {
  const restore = installBrowserGlobals();
  try {
    const ctx = new FakeAudioContext();
    const scene = { id, recipe: SCENE_RECIPES[id], source: 'label' };
    const engine = new AmbienceEngine(ctx, ctx.destination, scene, 'seed', { volume: 0.6, intensity });
    // let beds load first
    return flushMicrotasks().then(() => {
      const bedCount = bedSourcesOf(ctx).length;
      engine.start(0.6);
      restore.pump(ctx, seconds);
      const total = ctx.startedSources.length;
      engine.stop();
      return total - bedCount;
    }).finally(() => restore());
  } catch (e) { restore(); throw e; }
}

const eventful = SCENE_IDS.filter((id) => (SCENE_RECIPES[id].events ?? []).length > 0);
{
  // pick a representative eventful scene
  const id = 'office';
  const low = await countEvents(id, 0.2, 90);
  const high = await countEvents(id, 0.95, 90);
  if (low === 0) fail(`${id}: no events fired over 90s at low intensity`);
  if (high <= low) fail(`${id}: intensity did not raise the event rate (${low} → ${high})`);
  else ok(`${id}: events scale with intensity (${low} @0.2 → ${high} @0.95 over 90s)`);
}
ok(`${eventful.length} of ${SCENE_IDS.length} scenes carry a subtle event layer; the rest rest on the recording alone`);

// ---------------------------------------------------------------------------
console.log(`\ncheck:ambience:runtime — ${SCENE_IDS.length} scenes against a fake AudioContext\n`);
for (const n of notes) console.log(`  ✓ ${n}`);
if (failures.length) {
  console.log(`\n  ${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n  all runtime checks passed.\n');
