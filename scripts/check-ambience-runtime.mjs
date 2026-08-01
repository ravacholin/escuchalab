#!/usr/bin/env node
// Runtime checks for the ambience engine. No API key, no network, no browser.
//
// check:ambience asserts things about tables and about baked WAVs. It cannot tell you
// whether the engine, when actually run, builds the graph those tables describe — and
// that blind spot is exactly where the worst bug in this system lived: the stem loader
// compared a generation counter captured in the constructor against one the caller's
// synchronous start() had already incremented, so the comparison ALWAYS failed, every
// stem was dropped, and no scene ever had a bed. Every check:ambience assertion passed
// while a learner heard nothing but disembodied clicks.
//
// So: instantiate the real engine against a fake AudioContext and assert on the graph
// it produces.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { FakeAudioContext, installBrowserGlobals, flushMicrotasks } from './ambience/fakeWebAudio.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => notes.push(msg);

// ---------------------------------------------------------------------------
// Bundle the engine. Entry lives in a temp dir with an absolute import so a crash
// can't strand a stray .ts at the repo root for tsc to pick up.
// ---------------------------------------------------------------------------
async function bundle() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-ambience-runtime-'));
  const entry = path.join(dir, 'entry.ts');
  const outfile = path.join(dir, 'bundle.mjs');
  const { writeFileSync } = await import('node:fs');
  const enginePath = path.join(ROOT, 'services', 'ambienceEngine').replace(/\\/g, '/');
  const presetsPath = path.join(ROOT, 'services', 'ambiencePresets').replace(/\\/g, '/');
  writeFileSync(entry, `
    export {
      AmbienceEngine, STEM_MAKEUP, EVENT_OVER_BED, BED_FLOOR, MAX_BED_BOOST,
      MAX_EVENT_ONSETS_PER_MIN, ABSOLUTE_MAX_ONSETS_PER_MIN, onsetsPerMinute,
      eventRateScale, sceneOnsetBudget, bedBoost, eventScaleFor, PLAYHEADS_PER_STEM,
    } from '${enginePath}';
    export {
      SCENE_RECIPES, SCENE_IDS, bedLevel, eventHeadroomDb, sceneOnsetCeiling,
    } from '${presetsPath}';
  `);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const {
  AmbienceEngine, SCENE_RECIPES, SCENE_IDS, bedLevel,
  STEM_MAKEUP, ABSOLUTE_MAX_ONSETS_PER_MIN,
  onsetsPerMinute, eventRateScale, bedBoost, eventScaleFor, PLAYHEADS_PER_STEM,
} = await bundle();

const restore = installBrowserGlobals();

/** Build an engine for a scene, start it, and let the stem loads settle. */
async function run(sceneId, { start = true } = {}) {
  const ctx = new FakeAudioContext();
  const scene = { id: sceneId, recipe: SCENE_RECIPES[sceneId] };
  const engine = new AmbienceEngine(ctx, ctx.destination, scene, 'runtime-check', {
    volume: 0.6,
    intensity: 0.6,
    onStemsReady: () => {},
  });
  if (start) engine.start(0.6);
  await flushMicrotasks();
  return { ctx, engine, scene };
}

/** Bed sources only — several event synths also loop a buffer (steam, vehiclePass…). */
const startedStemSources = (ctx) =>
  ctx.startedSources.filter((n) => n.type_ === 'bufferSource' && n.buffer?.fromDecode);

try {
  // -------------------------------------------------------------------------
  // 1. THE REGRESSION. Every layer of every scene must actually start.
  // -------------------------------------------------------------------------
  {
    let worstScene = null;
    let checked = 0;
    for (const sceneId of SCENE_IDS) {
      const recipe = SCENE_RECIPES[sceneId];
      const { ctx } = await run(sceneId);
      const started = startedStemSources(ctx).length;
      const expected = recipe.stems.length * PLAYHEADS_PER_STEM;
      checked++;
      if (started !== expected) {
        fail(
          `scene "${sceneId}": ${started}/${expected} stem sources started — ` +
          `the bed is silent, so only the synthesised one-shots are audible`,
        );
        worstScene ??= sceneId;
      }
    }
    if (!worstScene) ok(`all ${checked} scenes start every stem layer`);
  }

  // -------------------------------------------------------------------------
  // 2. Loading must not depend on start() having been called first. The engine
  //    begins loading in its constructor; a guard on `running` reintroduces the
  //    original bug in a different shape.
  // -------------------------------------------------------------------------
  {
    const { ctx, engine } = await run('cafe', { start: false });
    const before = startedStemSources(ctx).length;
    const expected = SCENE_RECIPES.cafe.stems.length * PLAYHEADS_PER_STEM;
    if (before !== expected) {
      fail(
        `stems loaded before start() attached ${before}/${expected} sources — ` +
        `load must not be gated on the running flag`,
      );
    } else {
      ok('stems attach even when the load resolves before start()');
    }
    engine.stop();
  }

  // -------------------------------------------------------------------------
  // 3. stop() must cancel an in-flight load rather than attaching to a dead graph.
  // -------------------------------------------------------------------------
  {
    const ctx = new FakeAudioContext();
    const scene = { id: 'cafe', recipe: SCENE_RECIPES.cafe };
    const engine = new AmbienceEngine(ctx, ctx.destination, scene, 'runtime-check-stop', {
      volume: 0.6, intensity: 0.6, onStemsReady: () => {},
    });
    engine.stop(); // before any microtask can resolve
    await flushMicrotasks();
    const started = startedStemSources(ctx).length;
    if (started !== 0) {
      fail(`stop() before the load resolved still attached ${started} stem sources`);
    } else {
      ok('stop() cancels an in-flight stem load');
    }
  }

  // -------------------------------------------------------------------------
  // 4. The bed must reach the destination. A source that starts but is connected
  //    to nothing is just as silent as one that never starts.
  // -------------------------------------------------------------------------
  {
    const { ctx } = await run('cafe');
    const reaches = (node, target, seen = new Set()) => {
      if (node === target) return true;
      if (seen.has(node)) return false;
      seen.add(node);
      return (node.outputs ?? []).some((out) => reaches(out, target, seen));
    };
    const orphans = startedStemSources(ctx).filter((src) => !reaches(src, ctx.destination));
    if (orphans.length) {
      fail(`${orphans.length} stem source(s) start but never reach the destination`);
    } else {
      ok('every stem source is connected through to the destination');
    }
  }

  // -------------------------------------------------------------------------
  // 5. The scheduler must produce events, and the observed onset rate must match
  //    what onsetsPerMinute() predicts — otherwise the budget in check 7 is
  //    policing a model that has drifted from the scheduler.
  // -------------------------------------------------------------------------
  {
    const MINUTES = 3;
    for (const sceneId of ['cafe', 'street', 'office']) {
      const { ctx, engine } = await run(sceneId);
      const before = ctx.startedSources.length;
      restore.pump(ctx, MINUTES * 60);
      const fired = ctx.startedSources.length - before;
      if (fired === 0) {
        fail(`scene "${sceneId}": the scheduler fired nothing in ${MINUTES} minutes`);
        continue;
      }
      // Sources per onset varies a lot by synth (a modal hit is several oscillators,
      // a typing burst is dozens), so this is a liveness check, not a rate check.
      ok(`scene "${sceneId}": scheduler ran for ${MINUTES} min and fired ${fired} sources`);
      engine.stop();
    }
  }

  // -------------------------------------------------------------------------
  // 6. MIX CALIBRATION. Bed audible, events over it but not on top of it.
  //
  // The original complaint — "little noises that have nothing to do with a bar" —
  // was a level relationship before it was a timbre problem: a full-gain event
  // peaked ~19 dB over a bed that was itself inaudible. These two bounds are what
  // keep the ambience reading as a place.
  // -------------------------------------------------------------------------
  {
    const BED_MIN_DBFS = -40;   // below this a laptop speaker reproduces nothing
    const BED_MAX_DBFS = -22;   // above this it competes with the dialogue
    // A transient may sit clearly above a continuous bed; it may not dominate it.
    // Before this work the loudest cafe event peaked ~19 dB over its (silent) bed.
    //
    // This is now a global ceiling, not the law. Every scene used to land on exactly
    // +6.0 dB, because bed gain and event scale were multiplied by the same boost —
    // so a library and a market had the same relationship between their quiet moments
    // and their loud ones, which is a large part of why they sounded alike. Each
    // recipe declares its own headroom; what is asserted here is that none of them is
    // deafening, and that they are not all the same number.
    const EVENT_MAX_OVER_BED_DB = 20;
    const MIN_DISTINCT_HEADROOMS = 6;
    const MIN_HEADROOM_SPREAD_DB = 8;

    const VOLUME = 0.6;
    let bedFailures = 0;
    let eventFailures = 0;
    let quietest = { id: null, db: Infinity };
    let loudestEvent = { id: null, db: -Infinity };

    // The headroom each recipe declares, read back through the engine's own inversion
    // so this measures what the mix does rather than what the table says.
    const headrooms = [];

    for (const sceneId of SCENE_IDS) {
      const recipe = SCENE_RECIPES[sceneId];
      const raw = bedLevel(recipe);
      const boost = bedBoost(raw);
      const bedDb = 20 * Math.log10(raw * STEM_MAKEUP * boost * VOLUME);

      if (bedDb < BED_MIN_DBFS || bedDb > BED_MAX_DBFS) {
        fail(`scene "${sceneId}": bed at ${bedDb.toFixed(1)} dBFS, outside ${BED_MIN_DBFS}..${BED_MAX_DBFS}`);
        bedFailures++;
      }
      if (bedDb < quietest.db) quietest = { id: sceneId, db: bedDb };

      const loudestGain = Math.max(...recipe.events.map((e) => e.gain));
      const scale = eventScaleFor(recipe, raw * boost);
      const ratioDb = 20 * Math.log10((loudestGain * scale) / (raw * boost * STEM_MAKEUP));
      headrooms.push(Math.round(ratioDb * 2) / 2);
      if (ratioDb > EVENT_MAX_OVER_BED_DB) {
        fail(`scene "${sceneId}": loudest event sits ${ratioDb.toFixed(1)} dB over the bed (max ${EVENT_MAX_OVER_BED_DB})`);
        eventFailures++;
      }
      if (ratioDb > loudestEvent.db) loudestEvent = { id: sceneId, db: ratioDb };
    }

    if (!bedFailures) ok(`every scene's bed lands in ${BED_MIN_DBFS}..${BED_MAX_DBFS} dBFS (quietest: ${quietest.id} at ${quietest.db.toFixed(1)})`);
    if (!eventFailures) ok(`loudest event over bed is ${loudestEvent.db.toFixed(1)} dB (${loudestEvent.id}), max ${EVENT_MAX_OVER_BED_DB}`);

    // The inverse assertion, and the one that matters for this defect: the ceilings
    // must not all be the same number. A bound that every scene satisfies identically
    // is not a contract, it is a constant.
    const distinct = new Set(headrooms);
    const spread = Math.max(...headrooms) - Math.min(...headrooms);
    if (distinct.size < MIN_DISTINCT_HEADROOMS || spread < MIN_HEADROOM_SPREAD_DB) {
      fail(
        `event headroom is nearly uniform: ${distinct.size} distinct values spanning ` +
        `${spread.toFixed(1)} dB (need ${MIN_DISTINCT_HEADROOMS} and ${MIN_HEADROOM_SPREAD_DB} dB) — ` +
        `a library and a market cannot have the same relationship between bed and event`,
      );
    } else {
      ok(`event headroom spans ${spread.toFixed(1)} dB across ${distinct.size} distinct values`);
    }
  }

  // -------------------------------------------------------------------------
  // 7. EVENT DENSITY. A place is mostly bed with occasional things happening in
  //    it — but how occasional is part of what tells you which place it is.
  //
  //    The old rule was one global ceiling of 26 onsets/min, and 26 of 42 scenes were
  //    authored over it, so they all landed on exactly 26.00: a full restaurant, a
  //    market, a call centre and a newsroom were equally eventful. The budget is now
  //    per scene with a soft knee, so what is asserted is the absolute ceiling AND
  //    that the catalogue actually uses the range.
  // -------------------------------------------------------------------------
  {
    const INTENSITY = 0.6;
    const MIN_DENSITY_RATIO = 5;      // busiest / quietest scene
    const MAX_SCENES_AT_ONE_RATE = 6; // how many may sit within 1% of each other
    let over = 0;
    const rates = [];
    for (const sceneId of SCENE_IDS) {
      const recipe = SCENE_RECIPES[sceneId];
      const authored = onsetsPerMinute(recipe, INTENSITY);
      const effective = authored / eventRateScale(recipe, INTENSITY);
      rates.push({ sceneId, authored, effective });
      if (effective > ABSOLUTE_MAX_ONSETS_PER_MIN + 0.01) {
        fail(
          `scene "${sceneId}": ${effective.toFixed(1)} onsets/min after scaling ` +
          `(absolute max ${ABSOLUTE_MAX_ONSETS_PER_MIN})`,
        );
        over++;
      }
    }
    if (!over) {
      const sorted = [...rates].sort((a, b) => b.effective - a.effective);
      ok(
        `busiest scene is ${sorted[0].sceneId} at ${sorted[0].effective.toFixed(0)} onsets/min, ` +
        `quietest ${sorted[sorted.length - 1].sceneId} at ${sorted[sorted.length - 1].effective.toFixed(1)}`,
      );
    }

    const lo = Math.min(...rates.map((r) => r.effective));
    const hi = Math.max(...rates.map((r) => r.effective));
    if (hi / Math.max(lo, 0.1) < MIN_DENSITY_RATIO) {
      fail(
        `event density spans only ${(hi / Math.max(lo, 0.1)).toFixed(1)}x across the catalogue ` +
        `(need ${MIN_DENSITY_RATIO}x) — every scene is equally eventful`,
      );
    } else {
      ok(`event density spans ${(hi / Math.max(lo, 0.1)).toFixed(1)}x (${lo.toFixed(1)}-${hi.toFixed(0)} onsets/min)`);
    }

    // The specific shape of the old bug: a pile-up at the ceiling.
    let worstCluster = 0;
    for (const r of rates) {
      const n = rates.filter((o) => Math.abs(o.effective - r.effective) < r.effective * 0.01).length;
      worstCluster = Math.max(worstCluster, n);
    }
    if (worstCluster > MAX_SCENES_AT_ONE_RATE) {
      fail(
        `${worstCluster} scenes fire at effectively the same rate (max ${MAX_SCENES_AT_ONE_RATE}) — ` +
        `the budget is clamping rather than shaping`,
      );
    } else {
      ok(`no more than ${worstCluster} scenes share an event rate`);
    }
  }

  // -------------------------------------------------------------------------
  // 8. INTENSITY MOVES DENSITY.
  //
  //    The direct regression test for the cancellation bug. `onsetsPerMinute` carries
  //    a 1/(1.6 - i) and the scheduler interval carries a (1.6 - i); with a hard clamp
  //    `rateScale` was exactly onsets(i)/ceiling, so the two cancelled and the slider
  //    changed only how loud events were — in 26 of 42 scenes it did nothing to how
  //    often they happened, which is what a listener actually reads as "busier".
  // -------------------------------------------------------------------------
  {
    const MIN_RATE_CHANGE = 0.35; // between intensity 0.2 and 0.9
    let flat = 0;
    const samples = [];
    for (const sceneId of SCENE_IDS) {
      const recipe = SCENE_RECIPES[sceneId];
      // Effective interval for a representative spec, as the scheduler computes it.
      const intervalAt = (i) => (1.6 - i) * eventRateScale(recipe, i);
      const slow = intervalAt(0.2);
      const fast = intervalAt(0.9);
      const change = (slow - fast) / slow;
      samples.push({ sceneId, change });
      if (change < MIN_RATE_CHANGE) flat++;
    }
    if (flat > 0) {
      const worst = samples.sort((a, b) => a.change - b.change).slice(0, 5);
      fail(
        `${flat} scene(s) barely change event rate between intensity 0.2 and 0.9 ` +
        `(min ${(MIN_RATE_CHANGE * 100).toFixed(0)}%): ` +
        worst.map((w) => `${w.sceneId} ${(w.change * 100).toFixed(0)}%`).join(', '),
      );
    } else {
      const avg = samples.reduce((a, b) => a + b.change, 0) / samples.length;
      ok(`intensity moves event rate in every scene (mean ${(avg * 100).toFixed(0)}% faster at 0.9 than 0.2)`);
    }
  }
} finally {
  restore();
}

// ---------------------------------------------------------------------------
for (const note of notes) console.log(`  ok  ${note}`);
if (failures.length) {
  console.error(`\ncheck:ambience:runtime — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\ncheck:ambience:runtime — ${notes.length} checks passed.`);
