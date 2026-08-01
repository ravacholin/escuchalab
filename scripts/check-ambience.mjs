#!/usr/bin/env node
// Checks for the ambient sound system. No API key, no network, no browser.
//
// Two families of assertion:
//
//   STRUCTURAL — every scenario in data/scenarios.ts resolves to a curated scene, no
//   scene monopolises the catalogue, every stem a recipe names exists on disk, no
//   baked stem is orphaned, and every EventKind a recipe references has a synth in
//   the runtime registry.
//
//   ACOUSTIC — the measurements that diagnosed the original problem, turned into
//   thresholds. The old beds put 62-77% of their energy below 250 Hz and had a
//   short-term loudness range of 2.2-3.7 dB, which is statistically indistinguishable
//   from stationary filtered noise; that is why every scenario sounded like rain.
//   Asserting on those numbers means "the scenes are distinguishable" is a property
//   the test suite enforces rather than a claim in a commit message.

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  decodeWav, lowEnergyRatio, loudnessRangeDb, bandProfile, spectralDistance,
  octaveConcentration, loopDiscontinuity,
} from './ambience/dsp.mjs';
import { STEMS, STEM_IDS } from './ambience/stems.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AMBIENCE_DIR = path.join(ROOT, 'public', 'ambience');

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => notes.push(msg);

// ---------------------------------------------------------------------------
// Bundle the TypeScript under test.
//
// data/scenarios.ts pulls in React and lucide-react purely for its `icon` fields, so
// those are stubbed with a proxy rather than bundled — we only care about the labels.
// ---------------------------------------------------------------------------
const stubUiDeps = {
  name: 'stub-ui-deps',
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|lucide-react)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-ui',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub-ui' }, () => ({
      contents: 'module.exports = new Proxy(function(){}, { get: () => function Stub(){} });',
      loader: 'js',
    }));
  },
};

async function bundle(entryContents) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-ambience-'));
  const outfile = path.join(dir, 'bundle.mjs');
  // Fed through stdin with resolveDir rather than written to a real file: an entry
  // file at the repo root survives a crash between write and cleanup, and tsc then
  // tries to compile the leftover.
  await build({
    stdin: { contents: entryContents, resolveDir: ROOT, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    plugins: [stubUiDeps],
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const mod = await bundle(`
  export { SCENARIO_DATABASE } from './data/scenarios';
  export {
    SCENE_RECIPES, SCENE_IDS, STEM_IDS, MODEL_SELECTABLE_SCENES, STEM_LEVELS_DBFS,
    resolveAmbienceScene, isSceneId, bedLevel,
  } from './services/ambiencePresets';
  export { EVENT_SYNTHS, EVENT_CLUSTER_SIZE } from './services/ambienceEngine';
  export { TextType } from './types';
`);

const {
  SCENARIO_DATABASE, SCENE_RECIPES, SCENE_IDS, MODEL_SELECTABLE_SCENES, STEM_LEVELS_DBFS,
  resolveAmbienceScene, isSceneId, EVENT_SYNTHS, EVENT_CLUSTER_SIZE, TextType,
} = mod;

// ---------------------------------------------------------------------------
// 0. The runtime's copy of the stem levels must match what was actually baked.
//
// The engine scales events against the scene's bed level, computed from these
// numbers. If they drift from stems.mjs, every event in the affected scenes lands at
// the wrong level — silently, and only in the browser.
// ---------------------------------------------------------------------------
const levelMismatches = [];
for (const id of STEM_IDS) {
  const declared = STEM_LEVELS_DBFS[id];
  const baked = STEMS[id]?.targetRms;
  if (declared === undefined) {
    levelMismatches.push(`${id}: missing from STEM_LEVELS_DBFS`);
  } else if (baked !== declared) {
    levelMismatches.push(`${id}: baked at ${baked} dBFS, STEM_LEVELS_DBFS says ${declared}`);
  }
}
if (levelMismatches.length > 0) {
  fail(`stem level table is out of step with the baker:\n${levelMismatches.map((m) => `      - ${m}`).join('\n')}`);
} else {
  ok(`stem levels in ambiencePresets.ts match all ${STEM_IDS.length} baked targets`);
}

// ---------------------------------------------------------------------------
// 1. Coverage: every scenario label resolves to a curated scene
// ---------------------------------------------------------------------------
const scenarios = [];
for (const [textType, levels] of Object.entries(SCENARIO_DATABASE)) {
  for (const contexts of Object.values(levels)) {
    for (const context of contexts) {
      for (const action of context.actions ?? [{ label: '' }]) {
        scenarios.push({ textType, label: context.label, action: action.label });
      }
    }
  }
}

const distinctLabels = new Map();
for (const s of scenarios) {
  const key = `${s.textType}|${s.label}`;
  if (!distinctLabels.has(key)) distinctLabels.set(key, s);
}

const bySource = {};
const sceneUsage = new Map();
const usageByTextType = new Map();
const uncurated = [];

for (const s of distinctLabels.values()) {
  const resolved = resolveAmbienceScene({
    scenarioLabel: s.label,
    scenarioActionLabel: s.action,
    textType: s.textType,
  });
  bySource[resolved.source] = (bySource[resolved.source] ?? 0) + 1;
  sceneUsage.set(resolved.id, (sceneUsage.get(resolved.id) ?? 0) + 1);

  if (!usageByTextType.has(s.textType)) usageByTextType.set(s.textType, new Map());
  const perType = usageByTextType.get(s.textType);
  perType.set(resolved.id, (perType.get(resolved.id) ?? 0) + 1);

  // 'keyword' and 'default' mean the label fell through the curated tables — the
  // exact failure mode of the old system, where 108 of 148 labels did so.
  if (resolved.source === 'keyword' || resolved.source === 'default') {
    uncurated.push(`${s.textType} / ${s.label}`);
  }
}

if (uncurated.length > 0) {
  fail(
    `${uncurated.length} scenario label(s) fall through to the generic fallback instead of a curated scene:\n` +
    uncurated.slice(0, 12).map((l) => `      - ${l}`).join('\n') +
    (uncurated.length > 12 ? `\n      ... and ${uncurated.length - 12} more` : ''),
  );
} else {
  ok(`all ${distinctLabels.size} scenario labels resolve to a curated scene ` +
     `(${Object.entries(bySource).map(([k, v]) => `${k}:${v}`).join(', ')})`);
}

// ---------------------------------------------------------------------------
// 2. Distribution: no single scene may monopolise a format
//
// The old taxonomy put 30 of the 40 dialogue scenarios (75%) on one bed, which is
// the single biggest reason everything sounded the same regardless of context.
//
// The bound is applied PER TEXT TYPE, and only the dialogue catalogue is held to the
// strict share. That asymmetry is deliberate rather than a loosened threshold: the
// dialogue labels name 40 different physical places, so concentration there is a
// genuine defect. The other three formats are recordings — a radio bulletin about
// traffic is heard from a studio, not from a road — so most of their labels
// legitimately share one ambience, and pretending otherwise would contradict the
// audio the learner is listening to. What we require of them instead is that they do
// not all collapse onto the SAME studio.
// ---------------------------------------------------------------------------
const MAX_SHARE_PLACE_BASED = 0.15;
const MAX_SHARE_OVERALL = 0.3;
const PLACE_BASED_TEXT_TYPE = TextType.Dialogue;

for (const [textType, perType] of usageByTextType) {
  const total = [...perType.values()].reduce((a, b) => a + b, 0);
  const [topScene, topCount] = [...perType.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = topCount / total;

  if (textType === PLACE_BASED_TEXT_TYPE) {
    if (share > MAX_SHARE_PLACE_BASED) {
      fail(
        `scene "${topScene}" covers ${topCount}/${total} of the place-based dialogue ` +
        `scenarios (${(share * 100).toFixed(1)}%, max ${(MAX_SHARE_PLACE_BASED * 100).toFixed(0)}%) — ` +
        `too many distinct places share one ambience`,
      );
    } else {
      ok(`dialogue scenarios spread over ${perType.size} scenes, ` +
         `largest "${topScene}" at ${(share * 100).toFixed(1)}%`);
    }
  } else {
    // Deliberately no intra-format minimum here. A podcast interview really is one
    // recording setup, and forcing variation would mean inventing distinctions the
    // catalogue does not support — e.g. pretending an episode about living abroad
    // was recorded abroad. The invariants that matter for these formats are the
    // global share bound and the distinct-default check below.
    ok(`"${textType}" uses ${perType.size} scene(s), largest "${topScene}" at ${(share * 100).toFixed(0)}%`);
  }
}

const [globalTopScene, globalTopCount] = [...sceneUsage.entries()].sort((a, b) => b[1] - a[1])[0];
const globalShare = globalTopCount / distinctLabels.size;
if (globalShare > MAX_SHARE_OVERALL) {
  fail(
    `scene "${globalTopScene}" covers ${globalTopCount}/${distinctLabels.size} of the whole catalogue ` +
    `(${(globalShare * 100).toFixed(1)}%, max ${(MAX_SHARE_OVERALL * 100).toFixed(0)}%)`,
  );
} else {
  ok(`largest scene overall "${globalTopScene}" covers ${(globalShare * 100).toFixed(1)}% of the catalogue`);
}

// Across the whole catalogue, the narrative formats must not share a studio with
// each other either — that is what would make a podcast and a monologue identical.
const narrativeDefaults = new Set();
for (const [textType, perType] of usageByTextType) {
  if (textType === PLACE_BASED_TEXT_TYPE) continue;
  narrativeDefaults.add([...perType.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
const narrativeFormats = usageByTextType.size - 1;
if (narrativeDefaults.size < narrativeFormats) {
  fail(
    `the ${narrativeFormats} non-dialogue formats share only ${narrativeDefaults.size} default scene(s) ` +
    `(${[...narrativeDefaults].join(', ')}) — each format should sound like its own kind of recording`,
  );
} else {
  ok(`each non-dialogue format has its own default scene (${[...narrativeDefaults].join(', ')})`);
}
ok(`${sceneUsage.size} distinct scenes in use across the catalogue`);

// ---------------------------------------------------------------------------
// 3. Recipes are well-formed and their references resolve
// ---------------------------------------------------------------------------
const bakedStems = new Set(STEM_IDS);
const referencedStems = new Set();
const missingFiles = [];

for (const [sceneId, recipe] of Object.entries(SCENE_RECIPES)) {
  if (!recipe.label) fail(`scene "${sceneId}" has no label for the UI`);

  if (!Array.isArray(recipe.stems) || recipe.stems.length === 0) {
    fail(`scene "${sceneId}" has no stems`);
  }
  // A scene needs either layered texture or texture plus life. One quiet stem and
  // nothing happening is exactly the empty "ROOM" ambience we removed.
  if (recipe.stems.length < 2 && (recipe.events?.length ?? 0) === 0) {
    fail(`scene "${sceneId}" has a single stem and no events — nothing distinguishes it`);
  }

  for (const layer of recipe.stems) {
    referencedStems.add(layer.stem);
    if (!bakedStems.has(layer.stem)) {
      fail(`scene "${sceneId}" references unknown stem "${layer.stem}"`);
    }
    const file = path.join(AMBIENCE_DIR, `${layer.stem}.wav`);
    if (!existsSync(file) && !missingFiles.includes(layer.stem)) {
      missingFiles.push(layer.stem);
      fail(`stem "${layer.stem}" is referenced by scene "${sceneId}" but public/ambience/${layer.stem}.wav does not exist`);
    }
    if (!(layer.gain > 0)) fail(`scene "${sceneId}" layer "${layer.stem}" has a non-positive gain`);
  }

  for (const spec of recipe.events ?? []) {
    // This is the invariant that replaces the old dead-tag problem: 23 of the 38
    // AmbienceTags were assigned to scenarios and had no generator at all, so a café
    // carried a `kitchen` tag and never produced a single plate.
    if (typeof EVENT_SYNTHS[spec.kind] !== 'function') {
      fail(`scene "${sceneId}" schedules event "${spec.kind}" but no synth is registered for it`);
    }
    // Same principle: a kind missing from the cluster table weighs nothing against
    // the density budget, so an office could schedule 200 keystrokes a minute while
    // nominally counting as a handful of events.
    if (!(EVENT_CLUSTER_SIZE[spec.kind] >= 1)) {
      fail(`scene "${sceneId}" schedules event "${spec.kind}" but it has no EVENT_CLUSTER_SIZE entry`);
    }
    if (!(spec.everyS > 0)) fail(`scene "${sceneId}" event "${spec.kind}" has a non-positive interval`);
    if (!(spec.gain > 0)) fail(`scene "${sceneId}" event "${spec.kind}" has a non-positive gain`);
  }

  if (!['small', 'medium', 'large', 'hall', 'outdoor'].includes(recipe.room?.size)) {
    fail(`scene "${sceneId}" has an invalid room size "${recipe.room?.size}"`);
  }
  // A street with a reverb tail is one of the reasons every scene used to sound
  // like an interior.
  if (recipe.room.size === 'outdoor' && recipe.room.wet > 0.1) {
    fail(`scene "${sceneId}" is outdoor but sends ${recipe.room.wet} to reverb — outdoors has no tail`);
  }
}

const orphans = [...bakedStems].filter((s) => !referencedStems.has(s));
if (orphans.length > 0) {
  fail(`stem(s) baked but never used by any scene: ${orphans.join(', ')} — ${orphans.length * 0.9} MB of dead weight`);
} else {
  ok(`all ${bakedStems.size} baked stems are used by at least one scene`);
}

// Every synth in the registry should be reachable, or it is dead code.
const usedKinds = new Set();
for (const recipe of Object.values(SCENE_RECIPES)) {
  for (const spec of recipe.events ?? []) usedKinds.add(spec.kind);
}
const unusedKinds = Object.keys(EVENT_SYNTHS).filter((k) => !usedKinds.has(k));
if (unusedKinds.length > 0) {
  fail(`event synth(s) registered but never scheduled by any scene: ${unusedKinds.join(', ')}`);
} else {
  ok(`all ${Object.keys(EVENT_SYNTHS).length} event synths are scheduled by at least one scene`);
}

const missingCluster = Object.keys(EVENT_SYNTHS).filter((k) => !(EVENT_CLUSTER_SIZE[k] >= 1));
if (missingCluster.length > 0) {
  fail(`event kind(s) with no EVENT_CLUSTER_SIZE entry: ${missingCluster.join(', ')}`);
} else {
  ok(`all ${Object.keys(EVENT_SYNTHS).length} event kinds carry a density weight`);
}

// ---------------------------------------------------------------------------
// 4. Model-selectable scenes must all be real
// ---------------------------------------------------------------------------
const badModelScenes = MODEL_SELECTABLE_SCENES.filter((id) => !isSceneId(id));
if (badModelScenes.length > 0) {
  fail(`MODEL_SELECTABLE_SCENES contains unknown ids: ${badModelScenes.join(', ')}`);
} else {
  ok(`${MODEL_SELECTABLE_SCENES.length} scenes offered to the generation model, all valid`);
}
// A hallucinated id must never reach the engine.
const hallucinated = resolveAmbienceScene({ sceneHint: 'a_place_that_does_not_exist', textType: TextType.Dialogue });
if (!isSceneId(hallucinated.id)) {
  fail('an invalid model scene hint produced an invalid scene');
} else if (hallucinated.source === 'model') {
  fail('an invalid model scene hint was accepted as if the model had chosen it');
} else {
  ok('invalid model scene hints are ignored and fall back cleanly');
}

// ---------------------------------------------------------------------------
// 5. Acoustics: the stems must not be stationary rumble
// ---------------------------------------------------------------------------
const measurements = new Map();

for (const id of STEM_IDS) {
  const file = path.join(AMBIENCE_DIR, `${id}.wav`);
  if (!existsSync(file)) {
    fail(`stem "${id}" is declared in stems.mjs but public/ambience/${id}.wav is missing — run npm run ambience:build`);
    continue;
  }
  const { channels, sampleRate, numChannels } = decodeWav(readFileSync(file));
  const spec = STEMS[id];

  if (sampleRate !== spec.sampleRate) {
    fail(`stem "${id}" is ${sampleRate} Hz on disk but declared ${spec.sampleRate} Hz — regenerate it`);
  }
  if (numChannels !== spec.channels) {
    fail(`stem "${id}" has ${numChannels} channel(s) on disk but declares ${spec.channels}`);
  }

  const mono = channels[0];
  const low = lowEnergyRatio(mono, sampleRate);
  const lra = loudnessRangeDb(mono, sampleRate);
  const concentration = octaveConcentration(mono, sampleRate);
  measurements.set(id, { low, lra, concentration, profile: bandProfile(mono, sampleRate) });

  // Spectral concentration: how much of the total sits in the single fullest octave.
  //
  // This is the check that was missing while the crowd stems sounded like a boxy hum.
  // They passed the low-energy and loudness-range bounds comfortably and still had
  // 53-77% of their entire spectrum inside 250-500 Hz alone, because frication was
  // being routed through the vowel formant bank and gutted. Nothing real is that
  // narrow: running speech puts about 30% in its fullest octave, traffic less. A
  // single number cannot say "this sounds like a cafe", but it can say "this cannot
  // possibly sound like anything", which is what a one-octave spectrum means.
  const maxOctave = spec.expect.maxOctaveShare ?? 0.5;
  if (concentration.share > maxOctave) {
    fail(
      `stem "${id}": ${(concentration.share * 100).toFixed(0)}% of energy in one octave ` +
      `(${concentration.lo.toFixed(0)}-${concentration.hi.toFixed(0)} Hz, max ${(maxOctave * 100).toFixed(0)}%) ` +
      `— too narrow to read as a real texture`,
    );
  }

  // Too much sub-250 Hz means the audible detail is buried under rumble. The five
  // old beds measured 0.62-0.77 here.
  if (low > spec.expect.maxLowRatio) {
    fail(
      `stem "${id}": ${(low * 100).toFixed(1)}% of energy below 250 Hz ` +
      `(max ${(spec.expect.maxLowRatio * 100).toFixed(0)}%) — rumble is masking the detail`,
    );
  }
  // Every stem is played on loop for the length of a lesson, so a step at the splice
  // is a click every 14-24 seconds. makeSeamlessLoop crossfades to prevent it; this
  // asserts the crossfade is actually doing its job, per channel.
  for (let ch = 0; ch < channels.length; ch++) {
    const disc = loopDiscontinuity(channels[ch]);
    if (disc > 8) {
      fail(
        `stem "${id}" channel ${ch}: loop point steps ${disc.toFixed(1)}x the typical ` +
        `sample delta — audible click once per loop`,
      );
    }
  }

  // Too little loudness variation means nothing is happening. The old beds measured
  // 2.2-3.7 dB; real field recordings span 15-25 dB.
  if (lra < spec.expect.minLoudnessRange) {
    fail(
      `stem "${id}": short-term loudness range ${lra.toFixed(1)} dB ` +
      `(min ${spec.expect.minLoudnessRange}) — too stationary, this will read as noise`,
    );
  }
}

if (measurements.size === STEM_IDS.length) {
  const worstLow = [...measurements.entries()].sort((a, b) => b[1].low - a[1].low)[0];
  const worstLra = [...measurements.entries()].sort((a, b) => a[1].lra - b[1].lra)[0];
  const worstConc = [...measurements.entries()].sort((a, b) => b[1].concentration.share - a[1].concentration.share)[0];
  ok(`all ${STEM_IDS.length} stems within acoustic targets ` +
     `(most low-heavy: ${worstLow[0]} ${(worstLow[1].low * 100).toFixed(0)}%; ` +
     `flattest: ${worstLra[0]} ${worstLra[1].lra.toFixed(1)} dB; ` +
     `narrowest: ${worstConc[0]} ${(worstConc[1].concentration.share * 100).toFixed(0)}% in one octave)`);
}

// ---------------------------------------------------------------------------
// 6. The character stems must be distinguishable from each other
//
// `cafe.wav` and `city.wav` used to have near-identical octave-band curves. Stems
// whose job is to identify a place have to be far apart in the spectrum; the quiet
// support stems (room tone, HVAC, studio) are all meant to be featureless air and
// are legitimately similar, so they are excluded.
// ---------------------------------------------------------------------------
const CHARACTER_STEMS = [
  'babble_close', 'babble_hall', 'babble_open', 'traffic_near',
  'kitchen', 'rain', 'wind_leaves', 'transit_hum',
  'office_life', 'pa_concourse', 'home_life', 'workshop_tools', 'crowd_far', 'sports_hall',
];
const MIN_DISTANCE = 6;

/**
 * Distance combines spectrum with temporal structure.
 *
 * Band energy alone is not enough. A close crowd and a reverberant concourse are
 * made of the same thing — voices — so their octave-band curves sit about 5 dB
 * apart, yet nobody would confuse them: one is a set of resolvable conversations
 * (18.8 dB loudness range) and the other is a smeared wash (6.5 dB). Folding the
 * loudness range in as an extra axis captures "how eventful", which is exactly the
 * dimension the old beds all collapsed onto and the reason they were
 * indistinguishable from each other.
 */
const stemDistance = (a, b) =>
  Math.sqrt(spectralDistance(a.profile, b.profile) ** 2 + (a.lra - b.lra) ** 2);

let closestPair = null;
for (let i = 0; i < CHARACTER_STEMS.length; i++) {
  for (let j = i + 1; j < CHARACTER_STEMS.length; j++) {
    const a = measurements.get(CHARACTER_STEMS[i]);
    const b = measurements.get(CHARACTER_STEMS[j]);
    if (!a || !b) continue;
    const dist = stemDistance(a, b);
    if (!closestPair || dist < closestPair.dist) {
      closestPair = { dist, a: CHARACTER_STEMS[i], b: CHARACTER_STEMS[j] };
    }
  }
}

if (closestPair && closestPair.dist < MIN_DISTANCE) {
  fail(
    `stems "${closestPair.a}" and "${closestPair.b}" are only ${closestPair.dist.toFixed(1)} apart in ` +
    `spectrum+dynamics (min ${MIN_DISTANCE}) — they will not be told apart`,
  );
} else if (closestPair) {
  ok(`closest character stems (${closestPair.a} / ${closestPair.b}) are ${closestPair.dist.toFixed(1)} apart`);
}

// ---------------------------------------------------------------------------
// 7. Asset budget
// ---------------------------------------------------------------------------
const MAX_TOTAL_MB = 14;
let totalBytes = 0;
const strays = [];
for (const file of readdirSync(AMBIENCE_DIR)) {
  if (!file.endsWith('.wav')) continue;
  const id = file.replace(/\.wav$/, '');
  if (!bakedStems.has(id)) strays.push(file);
  totalBytes += readFileSync(path.join(AMBIENCE_DIR, file)).length;
}
const totalMb = totalBytes / (1024 * 1024);
if (strays.length > 0) {
  fail(`public/ambience contains file(s) no stem declares: ${strays.join(', ')} — delete them or add a recipe`);
}
if (totalMb > MAX_TOTAL_MB) {
  fail(`public/ambience is ${totalMb.toFixed(2)} MB, over the ${MAX_TOTAL_MB} MB budget every user downloads`);
} else {
  ok(`public/ambience is ${totalMb.toFixed(2)} MB across ${bakedStems.size} stems (budget ${MAX_TOTAL_MB} MB)`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('');
for (const note of notes) console.log(`  ok   ${note}`);
if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log('');
  console.error(`check:ambience — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('');
console.log(`check:ambience — ${notes.length} checks passed`);
