#!/usr/bin/env node
// Checks for the ambient sound system (real-recording rebuild). No API key, no network,
// no browser.
//
//   STRUCTURAL — every scenario label in data/scenarios.ts resolves to a curated scene;
//   every bed a recipe names exists on disk and no bundled bed is orphaned; the
//   non-dialogue formats each spread across several scenes; no single bed monopolises
//   the catalogue; every EventKind a recipe uses has a synth shape in the engine.
//
//   ACOUSTIC — every bed is decoded and measured: a sane duration, normalised level,
//   no clipping, a seamless loop point, and enough spectral spread between the real
//   beds that the catalogue is not one texture wearing many labels (the original
//   complaint). It cannot tell you a café sounds like a café — `npm run ambience:preview`
//   is for that.

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  decodeWav, rms, peak, loopDiscontinuity, loudnessRangeDb, bandProfile, spectralDistance,
} from './ambience/dsp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AMBIENCE_DIR = path.join(ROOT, 'public', 'ambience');

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => notes.push(msg);

// ---------------------------------------------------------------------------
// Bundle the TypeScript under test. data/scenarios.ts pulls in React and lucide-react
// only for its `icon` fields, so those are stubbed.
// ---------------------------------------------------------------------------
const stubUiDeps = {
  name: 'stub-ui-deps',
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|lucide-react)$/ }, (args) => ({ path: args.path, namespace: 'stub-ui' }));
    b.onLoad({ filter: /.*/, namespace: 'stub-ui' }, () => ({
      contents: 'module.exports = new Proxy(function(){}, { get: () => function Stub(){} });',
      loader: 'js',
    }));
  },
};

async function bundle(entryContents) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-ambience-'));
  const outfile = path.join(dir, 'bundle.mjs');
  await build({
    stdin: { contents: entryContents, resolveDir: ROOT, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'neutral', outfile,
    plugins: [stubUiDeps], logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const mod = await bundle(`
  export { SCENARIO_DATABASE } from './data/scenarios';
  export {
    SCENE_RECIPES, SCENE_IDS, BED_IDS, EVENT_KINDS, REFERENCED_BEDS,
    MODEL_SELECTABLE_SCENES, resolveAmbienceScene, isSceneId,
  } from './services/ambiencePresets';
  export { EVENT_SHAPES } from './services/ambienceEngine';
  export { TextType } from './types';
`);

const {
  SCENARIO_DATABASE, SCENE_RECIPES, SCENE_IDS, BED_IDS, EVENT_KINDS, REFERENCED_BEDS,
  resolveAmbienceScene, isSceneId, EVENT_SHAPES, TextType,
} = mod;

const SYNTH_BEDS = new Set(['studio_air', 'room_air']);

// ---------------------------------------------------------------------------
// 1. Coverage: every scenario label resolves to a curated scene (not the fallback).
// ---------------------------------------------------------------------------
const scenarios = [];
for (const [textType, levels] of Object.entries(SCENARIO_DATABASE)) {
  for (const contexts of Object.values(levels)) {
    for (const ctx of contexts) scenarios.push({ label: ctx.label, textType });
  }
}
const uncovered = [];
const seenLabels = new Set();
for (const { label, textType } of scenarios) {
  if (seenLabels.has(`${textType}|${label}`)) continue;
  seenLabels.add(`${textType}|${label}`);
  const res = resolveAmbienceScene({ scenarioLabel: label, textType });
  if (res.source === 'default') uncovered.push(`${textType} / ${label}`);
}
if (uncovered.length) {
  fail(`${uncovered.length} scenario label(s) fall through to the default scene:\n${uncovered.map((u) => `      - ${u}`).join('\n')}`);
} else {
  ok(`all ${seenLabels.size} scenario label/format pairs resolve to a curated scene`);
}

// ---------------------------------------------------------------------------
// 2. Bed integrity: every referenced bed exists on disk; no bundled bed is orphaned;
//    no bed id lacks a file.
// ---------------------------------------------------------------------------
const wavFiles = readdirSync(AMBIENCE_DIR).filter((f) => f.endsWith('.wav')).map((f) => f.replace(/\.wav$/, ''));
const wavSet = new Set(wavFiles);
const missing = BED_IDS.filter((b) => !wavSet.has(b));
if (missing.length) fail(`bed id(s) with no public/ambience/*.wav: ${missing.join(', ')}`);
else ok(`all ${BED_IDS.length} bed ids have a bundled .wav`);

const strayFiles = wavFiles.filter((f) => !BED_IDS.includes(f));
if (strayFiles.length) fail(`.wav files in public/ambience not declared as beds: ${strayFiles.join(', ')}`);
else ok('no orphaned .wav files in public/ambience');

const unreferenced = BED_IDS.filter((b) => !REFERENCED_BEDS.has(b));
if (unreferenced.length) fail(`bed(s) bundled but referenced by no recipe (dead weight): ${unreferenced.join(', ')}`);
else ok(`every bed is referenced by at least one recipe`);

// ---------------------------------------------------------------------------
// 3. Event synths: every EventKind a recipe uses has a shape; every declared kind too.
// ---------------------------------------------------------------------------
const usedKinds = new Set();
for (const id of SCENE_IDS) for (const e of SCENE_RECIPES[id].events ?? []) usedKinds.add(e.kind);
const kindsNoShape = [...usedKinds].filter((k) => !EVENT_SHAPES[k]);
if (kindsNoShape.length) fail(`EventKind(s) used with no synth shape: ${kindsNoShape.join(', ')}`);
else ok(`all ${usedKinds.size} used event kinds have a synth shape`);
const declaredNoShape = EVENT_KINDS.filter((k) => !EVENT_SHAPES[k]);
if (declaredNoShape.length) fail(`declared EventKind(s) with no shape: ${declaredNoShape.join(', ')}`);

// ---------------------------------------------------------------------------
// 4. No monopoly: no single bed backs too much of the catalogue, and each non-dialogue
//    format spreads across several scenes.
// ---------------------------------------------------------------------------
const primaryBedCount = {};
for (const id of SCENE_IDS) {
  const primary = SCENE_RECIPES[id].beds[0].bed;
  primaryBedCount[primary] = (primaryBedCount[primary] ?? 0) + 1;
}
const topBed = Object.entries(primaryBedCount).sort((a, b) => b[1] - a[1])[0];
const topShare = topBed[1] / SCENE_IDS.length;
if (topShare > 0.34) fail(`bed "${topBed[0]}" is the primary bed of ${(topShare * 100).toFixed(0)}% of scenes (max 34%)`);
else ok(`most-used bed "${topBed[0]}" backs ${(topShare * 100).toFixed(0)}% of scenes (≤34%)`);

// per-format spread
const FORMAT_MAPS = {
  [TextType.RadioNews]: [],
  [TextType.PodcastInterview]: [],
  [TextType.Monologue]: [],
};
for (const { label, textType } of scenarios) {
  if (textType === TextType.Dialogue) continue;
  const res = resolveAmbienceScene({ scenarioLabel: label, textType });
  if (FORMAT_MAPS[textType]) FORMAT_MAPS[textType].push(res.id);
}
for (const [textType, ids] of Object.entries(FORMAT_MAPS)) {
  if (!ids.length) continue;
  const distinct = new Set(ids);
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  const top = Math.max(...Object.values(counts)) / ids.length;
  if (distinct.size < 5) fail(`${textType} spreads across only ${distinct.size} scenes (min 5)`);
  else if (top > 0.5) fail(`${textType} lands ${(top * 100).toFixed(0)}% on one scene (max 50%)`);
  else ok(`${textType}: ${distinct.size} distinct scenes, top ${(top * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------------------
// 5. Acoustic floor: decode and measure every bed.
// ---------------------------------------------------------------------------
const bedProfiles = {};
for (const bed of BED_IDS) {
  const file = path.join(AMBIENCE_DIR, `${bed}.wav`);
  if (!existsSync(file)) continue;
  const { channels, sampleRate } = decodeWav(readFileSync(file));
  const mono = channels[0];
  const r = 20 * Math.log10(rms(mono) || 1e-9);
  const pk = peak(mono);
  const disc = loopDiscontinuity(mono);
  const dur = mono.length / sampleRate;
  const synth = SYNTH_BEDS.has(bed);

  if (dur < 10 || dur > 26) fail(`${bed}: loop is ${dur.toFixed(1)}s (want 10-26s)`);
  if (pk >= 0.98) fail(`${bed}: peaks at ${pk.toFixed(3)} — clipping`);
  if (r < -50) fail(`${bed}: RMS ${r.toFixed(1)} dBFS — effectively silent`);
  if (!synth && (r < -28 || r > -20)) fail(`${bed}: RMS ${r.toFixed(1)} dBFS, real beds should be ~ -24`);
  if (synth && r > -28) fail(`${bed}: synth air RMS ${r.toFixed(1)} dBFS — should be quiet (< -28)`);
  // The overlap-add loop reproduces adjacent source samples at the wrap, so the seam
  // step is a normal sample step (~0.3-2.4 on real audio). A hard cut lands on two
  // unrelated samples and spikes this to 5-60×, which is what the threshold catches.
  if (disc > 3.5) fail(`${bed}: loop seam discontinuity ${disc.toFixed(2)} (want < 3.5 — a hard cut scores 5-60)`);

  bedProfiles[bed] = bandProfile(mono, sampleRate);
}

// ---------------------------------------------------------------------------
// 6. Distinguishability: the real beds must not collapse into one texture. Assert the
//    median bed's nearest neighbour is above a spectral floor, and print the closest.
// ---------------------------------------------------------------------------
const realBeds = BED_IDS.filter((b) => !SYNTH_BEDS.has(b) && bedProfiles[b]);
const nearest = [];
for (const a of realBeds) {
  let best = Infinity, who = null;
  for (const b of realBeds) {
    if (a === b) continue;
    const d = spectralDistance(bedProfiles[a], bedProfiles[b]);
    if (d < best) { best = d; who = b; }
  }
  nearest.push({ bed: a, d: best, who });
}
nearest.sort((x, y) => x.d - y.d);
const medianNN = nearest[Math.floor(nearest.length / 2)].d;
const FLOOR = 0.05;
if (nearest[0].d < FLOOR) {
  fail(`beds "${nearest[0].bed}" and "${nearest[0].who}" are near-identical spectrally (${nearest[0].d.toFixed(3)} < ${FLOOR})`);
} else {
  ok(`closest bed pair ${nearest[0].bed}~${nearest[0].who} at ${nearest[0].d.toFixed(3)}; median NN ${medianNN.toFixed(3)}`);
}
notes.push(`  closest pairs: ${nearest.slice(0, 4).map((n) => `${n.bed}~${n.who}(${n.d.toFixed(2)})`).join(', ')}`);

// ---------------------------------------------------------------------------
console.log(`\ncheck:ambience — ${scenarios.length} scenario slots, ${SCENE_IDS.length} scenes, ${BED_IDS.length} beds\n`);
for (const n of notes) console.log(`  ✓ ${n}`);
if (failures.length) {
  console.log(`\n  ${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\n  all ambience checks passed.\n');
