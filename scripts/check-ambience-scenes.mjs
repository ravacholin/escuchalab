#!/usr/bin/env node
// Are the scenes actually different from one another?
//
// This check exists because nothing measured it. `check:ambience` measures the twelve
// baked *stems* and `check:ambience:runtime` measures the shape of the audio graph —
// so "hay vida, hay profundidad, pero son todos muy iguales" was a defect that every
// green check in the suite was structurally unable to express. Measured when this
// script was written, the catalogue held 22 distinct stem combinations for 42 scenes,
// one of them covering 8 scenes, 26 of 42 scenes firing at exactly 26.00 onsets per
// minute, and 12 scenes pinned to exactly the same bed level.
//
// It renders every scene offline through scripts/ambience/render.mjs — the same
// renderer as `npm run ambience:preview`, so what this measures is what you audition —
// and compares them on the four axes that make a place recognisable:
//
//   spectrum  what the place is made of        (bandProfile, 8 log bands)
//   dynamics  how eventful it is               (loudnessRangeDb)
//   density   how often something happens      (post-clamp onsets/minute)
//   room      how big and how live it is       (wet x rt60, air ceiling)
//
// It cannot tell you a café sounds like a café. It can tell you a café cannot sound
// like a library — which is the failure that actually shipped.
//
//   npm run check:ambience:scenes
//   npm run check:ambience:scenes -- --write-baseline
//   npm run check:ambience:scenes -- --seconds 20

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { loadSceneRenderer, ROOT, SAMPLE_RATE } from './ambience/render.mjs';
import { bandProfile, spectralDistance, loudnessRangeDb } from './ambience/dsp.mjs';

const BASELINE_PATH = path.join(ROOT, 'scripts', 'ambience', 'scene-distance.baseline.json');

const argv = process.argv.slice(2);
const writeBaseline = argv.includes('--write-baseline');
let seconds = 14;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--seconds') seconds = parseFloat(argv[i + 1]);
}

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => notes.push(msg);

// ---------------------------------------------------------------------------
// Thresholds
//
// Calibrated from the first measured run rather than guessed, the same way
// check-ambience.mjs's MIN_DISTANCE was: render everything, look at the distribution,
// put the floor under the honest cases and above the collisions. Raising these is how
// the catalogue is held apart as it grows; lowering one to make a new scene pass is
// how the problem this file exists for comes back.
// ---------------------------------------------------------------------------
const MIN_SCENE_DISTANCE = 6;      // two different places
const MIN_VARIANT_DISTANCE = 2.5;  // two scenes that share a `family` (street/street_rain)
const MAX_BASELINE_REGRESSION = 0.15; // a pair may not drift 15% closer than its baseline

// A doubling of event density counts as much as this many dB of spectral difference.
// Density is a strong place cue and the raw ratio is unbounded, so it goes in as a
// log — a market at 40/min and a library at 6/min are 2.7 doublings apart.
const DENSITY_DB_PER_DOUBLING = 4;

// ---------------------------------------------------------------------------

const { SCENE_RECIPES, SCENE_IDS, renderScene, onsetsPerMinute, eventRateScale } =
  await loadSceneRenderer();

/** Deterministic room descriptor. Measuring T30 out of a mix that also contains a
 *  crowd is unreliable; the recipe already declares the two numbers that matter. */
const RT60_BY_SIZE = { small: 0.45, medium: 0.8, large: 1.5, hall: 2.4, outdoor: 0.22 };

function roomSignature(recipe) {
  const room = recipe.room;
  const rt60 = (RT60_BY_SIZE[room.size] ?? 0.8) * (room.rt60Scale ?? 1);
  const brightness = room.brightnessHz ?? (room.size === 'outdoor' ? 6500 : 5000);
  return [
    // Perceived liveness: how much room you hear, and for how long.
    20 * Math.log10(Math.max(1e-3, room.wet * rt60)),
    // Air ceiling, scaled so a 5000 -> 2500 Hz change weighs about 4 dB.
    (brightness / 1000) * 1.3,
  ];
}

console.log('');
console.log(`Rendering ${SCENE_IDS.length} scenes at ${seconds}s each...`);
const started = Date.now();

const scenes = [];
for (const id of SCENE_IDS) {
  const recipe = SCENE_RECIPES[id];
  const { channels, missing } = renderScene(id, { seconds, seed: 'check' });
  if (missing.length > 0) {
    fail(`scene "${id}" could not render: missing ${[...new Set(missing)].join(', ')}`);
  }
  // Mono sum: the comparison is about texture, not imaging, and a stereo stem whose
  // left channel happens to be quieter should not read as a different place.
  const mono = new Float32Array(channels[0].length);
  for (let i = 0; i < mono.length; i++) mono[i] = (channels[0][i] + channels[1][i]) * 0.5;

  // Analytic density, not the count this particular render happened to draw: Poisson
  // variance over 14 seconds is large enough to swamp a real difference between two
  // scenes, and the budget is what the engine actually enforces.
  const density = onsetsPerMinute(recipe, 0.6) / eventRateScale(recipe, 0.6);

  scenes.push({
    id,
    label: recipe.label,
    family: recipe.family ?? id,
    profile: bandProfile(mono, SAMPLE_RATE),
    lra: loudnessRangeDb(mono, SAMPLE_RATE),
    density,
    room: roomSignature(recipe),
  });
}
const renderSeconds = (Date.now() - started) / 1000;
console.log(`Rendered in ${renderSeconds.toFixed(1)}s.`);
console.log('');

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------
function axes(a, b) {
  const spec = spectralDistance(a.profile, b.profile);
  const lra = Math.abs(a.lra - b.lra);
  const dens = DENSITY_DB_PER_DOUBLING *
    Math.abs(Math.log2(Math.max(a.density, 0.5) / Math.max(b.density, 0.5)));
  const room = Math.hypot(a.room[0] - b.room[0], a.room[1] - b.room[1]);
  return { spec, lra, dens, room };
}

const pairs = [];
for (let i = 0; i < scenes.length; i++) {
  for (let j = i + 1; j < scenes.length; j++) {
    const a = scenes[i];
    const b = scenes[j];
    const ax = axes(a, b);
    const dist = Math.hypot(ax.spec, ax.lra, ax.dens, ax.room);
    pairs.push({
      key: `${a.id}|${b.id}`,
      a: a.id, b: b.id, dist, ax,
      sameFamily: a.family === b.family,
    });
  }
}
pairs.sort((p, q) => p.dist - q.dist);

// ---------------------------------------------------------------------------
// Report — printed whether or not anything fails. The table is the deliverable:
// it answers "son todos muy iguales" with a number per pair.
// ---------------------------------------------------------------------------
const SHOW = 18;
console.log(`Closest ${SHOW} scene pairs (distance = spectrum + dynamics + density + room):`);
console.log('');
console.log(
  `  ${'scene A'.padEnd(18)}${'scene B'.padEnd(18)}${'dist'.padStart(6)}   ` +
  `${'spec'.padStart(6)}${'dyn'.padStart(7)}${'dens'.padStart(7)}${'room'.padStart(7)}`,
);
for (const p of pairs.slice(0, SHOW)) {
  const flag = p.sameFamily ? ' (variant)' : '';
  console.log(
    `  ${p.a.padEnd(18)}${p.b.padEnd(18)}${p.dist.toFixed(1).padStart(6)}   ` +
    `${p.ax.spec.toFixed(1).padStart(6)}${p.ax.lra.toFixed(1).padStart(7)}` +
    `${p.ax.dens.toFixed(1).padStart(7)}${p.ax.room.toFixed(1).padStart(7)}${flag}`,
  );
}
console.log('');

// Which scenes keep turning up in the close list — the cluster, not just the pair.
const closeCount = new Map();
for (const p of pairs.slice(0, 40)) {
  closeCount.set(p.a, (closeCount.get(p.a) ?? 0) + 1);
  closeCount.set(p.b, (closeCount.get(p.b) ?? 0) + 1);
}
const crowded = [...closeCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
if (crowded.length > 0) {
  console.log('Scenes appearing most often among the 40 closest pairs:');
  console.log(`  ${crowded.map(([id, n]) => `${id} (${n})`).join(', ')}`);
  console.log('');
}

console.log('Per-scene summary:');
console.log(
  `  ${'scene'.padEnd(18)}${'LRA'.padStart(6)}${'onsets/min'.padStart(12)}` +
  `${'wet*rt60'.padStart(10)}${'air kHz'.padStart(9)}`,
);
for (const s of [...scenes].sort((a, b) => a.density - b.density)) {
  console.log(
    `  ${s.id.padEnd(18)}${s.lra.toFixed(1).padStart(6)}${s.density.toFixed(1).padStart(12)}` +
    `${s.room[0].toFixed(1).padStart(10)}${(s.room[1] / 1.3).toFixed(1).padStart(9)}`,
  );
}
console.log('');

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
const different = pairs.filter((p) => !p.sameFamily);
const variants = pairs.filter((p) => p.sameFamily);

const tooClose = different.filter((p) => p.dist < MIN_SCENE_DISTANCE);
if (tooClose.length > 0) {
  for (const p of tooClose.slice(0, 10)) {
    fail(
      `scenes "${p.a}" and "${p.b}" are only ${p.dist.toFixed(1)} apart ` +
      `(min ${MIN_SCENE_DISTANCE}) — a learner will not hear them as different places ` +
      `[spec ${p.ax.spec.toFixed(1)} | dyn ${p.ax.lra.toFixed(1)} | ` +
      `dens ${p.ax.dens.toFixed(1)} | room ${p.ax.room.toFixed(1)}]`,
    );
  }
  if (tooClose.length > 10) fail(`...and ${tooClose.length - 10} more pairs below the floor`);
} else {
  ok(`closest distinct scenes (${different[0].a} / ${different[0].b}) are ${different[0].dist.toFixed(1)} apart`);
}

for (const p of variants.filter((v) => v.dist < MIN_VARIANT_DISTANCE)) {
  fail(
    `scenes "${p.a}" and "${p.b}" share a family but are only ${p.dist.toFixed(1)} apart ` +
    `(min ${MIN_VARIANT_DISTANCE}) — the variant is not audible`,
  );
}

// The floor alone is satisfiable by nudging two scenes apart. The median says the
// catalogue as a whole is spread out, which is the property that was actually lost.
const medianClosest = (() => {
  const perScene = scenes.map((s) => {
    let best = Infinity;
    for (const p of different) {
      if (p.a === s.id || p.b === s.id) best = Math.min(best, p.dist);
    }
    return best;
  }).sort((a, b) => a - b);
  return perScene[Math.floor(perScene.length / 2)];
})();
const MIN_MEDIAN_NEAREST = MIN_SCENE_DISTANCE * 1.6;
if (medianClosest < MIN_MEDIAN_NEAREST) {
  fail(
    `the median scene's nearest neighbour is only ${medianClosest.toFixed(1)} away ` +
    `(min ${MIN_MEDIAN_NEAREST.toFixed(1)}) — the catalogue is clustered, not merely tight in one spot`,
  );
} else {
  ok(`median scene's nearest neighbour is ${medianClosest.toFixed(1)} away`);
}

// ---------------------------------------------------------------------------
// Baseline: catch slow convergence that still clears the floor.
// ---------------------------------------------------------------------------
const current = Object.fromEntries(pairs.map((p) => [p.key, Number(p.dist.toFixed(3))]));

if (writeBaseline) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ seconds, pairs: current }, null, 0)}\n`);
  console.log(`Baseline written to ${path.relative(ROOT, BASELINE_PATH)} (${pairs.length} pairs).`);
  console.log('');
} else if (existsSync(BASELINE_PATH)) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (baseline.seconds !== seconds) {
    ok(`baseline rendered at ${baseline.seconds}s, this run at ${seconds}s — regression check skipped`);
  } else {
    const drift = [];
    for (const [key, was] of Object.entries(baseline.pairs)) {
      const now = current[key];
      if (now === undefined) continue; // scene renamed or removed; the structural checks cover that
      drift.push({ key, was, now, delta: (now - was) / Math.max(was, 0.1) });
    }
    drift.sort((x, y) => x.delta - y.delta);
    const regressed = drift.filter((d) => d.delta < -MAX_BASELINE_REGRESSION);
    for (const d of regressed.slice(0, 6)) {
      fail(
        `pair ${d.key.replace('|', ' / ')} drew ${(-d.delta * 100).toFixed(0)}% closer than baseline ` +
        `(${d.was.toFixed(1)} -> ${d.now.toFixed(1)}) — scenes are converging`,
      );
    }
    if (regressed.length > 6) fail(`...and ${regressed.length - 6} more pairs converging`);
    if (regressed.length === 0) {
      ok(`no pair drew more than ${(MAX_BASELINE_REGRESSION * 100).toFixed(0)}% closer than baseline`);
      const improved = drift.slice(-3).reverse();
      if (improved.length > 0 && improved[0].delta > 0.05) {
        console.log('Most improved pairs vs baseline:');
        for (const d of improved) {
          console.log(`  ${d.key.replace('|', ' / ').padEnd(40)} ${d.was.toFixed(1)} -> ${d.now.toFixed(1)}`);
        }
        console.log('');
      }
    }
  }
} else {
  ok('no baseline committed yet — run with --write-baseline once the catalogue is where you want it');
}

// ---------------------------------------------------------------------------
for (const n of notes) console.log(`  ok  ${n}`);
if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log('');
  console.log(`${failures.length} failure(s).`);
  process.exit(1);
}
console.log('');
console.log(`Scene distance OK (${SCENE_IDS.length} scenes, ${pairs.length} pairs, ${renderSeconds.toFixed(1)}s).`);
console.log('');
