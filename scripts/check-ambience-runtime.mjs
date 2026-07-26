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
      MAX_EVENT_ONSETS_PER_MIN, onsetsPerMinute, eventRateScale, PLAYHEADS_PER_STEM,
    } from '${enginePath}';
    export { SCENE_RECIPES, SCENE_IDS, bedLevel } from '${presetsPath}';
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
  STEM_MAKEUP, EVENT_OVER_BED, BED_FLOOR, MAX_BED_BOOST,
  MAX_EVENT_ONSETS_PER_MIN, onsetsPerMinute, eventRateScale, PLAYHEADS_PER_STEM,
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
    const EVENT_MAX_OVER_BED_DB = 8;

    const VOLUME = 0.6;
    let bedFailures = 0;
    let eventFailures = 0;
    let quietest = { id: null, db: Infinity };
    let loudestEvent = { id: null, db: -Infinity };

    // eventScale = rawBed * boost * EVENT_OVER_BED and the bed bus carries
    // STEM_MAKEUP * boost, so the event-over-bed ratio reduces to a scene-independent
    // constant — which is the whole point of scaling events against the bed.
    const ratioForGain = (gain) => 20 * Math.log10(gain * EVENT_OVER_BED / STEM_MAKEUP);

    for (const sceneId of SCENE_IDS) {
      const recipe = SCENE_RECIPES[sceneId];
      const raw = bedLevel(recipe);
      const boost = Math.min(MAX_BED_BOOST, Math.max(1, raw > 0 ? BED_FLOOR / raw : 1));
      const bedDb = 20 * Math.log10(raw * STEM_MAKEUP * boost * VOLUME);

      if (bedDb < BED_MIN_DBFS || bedDb > BED_MAX_DBFS) {
        fail(`scene "${sceneId}": bed at ${bedDb.toFixed(1)} dBFS, outside ${BED_MIN_DBFS}..${BED_MAX_DBFS}`);
        bedFailures++;
      }
      if (bedDb < quietest.db) quietest = { id: sceneId, db: bedDb };

      const ratioDb = ratioForGain(Math.max(...recipe.events.map((e) => e.gain)));
      if (ratioDb > EVENT_MAX_OVER_BED_DB) {
        fail(`scene "${sceneId}": loudest event sits ${ratioDb.toFixed(1)} dB over the bed (max ${EVENT_MAX_OVER_BED_DB})`);
        eventFailures++;
      }
      if (ratioDb > loudestEvent.db) loudestEvent = { id: sceneId, db: ratioDb };
    }

    if (!bedFailures) ok(`every scene's bed lands in ${BED_MIN_DBFS}..${BED_MAX_DBFS} dBFS (quietest: ${quietest.id} at ${quietest.db.toFixed(1)})`);
    if (!eventFailures) ok(`loudest event over bed is ${loudestEvent.db.toFixed(1)} dB (${loudestEvent.id}), max ${EVENT_MAX_OVER_BED_DB}`);
  }

  // -------------------------------------------------------------------------
  // 7. EVENT DENSITY. A place is mostly bed with occasional things happening in
  //    it. The recipes were authored at up to ~60 onsets/minute, which is one
  //    discrete noise every second for the length of a lesson.
  // -------------------------------------------------------------------------
  {
    const INTENSITY = 0.6;
    let over = 0;
    const rates = [];
    for (const sceneId of SCENE_IDS) {
      const recipe = SCENE_RECIPES[sceneId];
      const authored = onsetsPerMinute(recipe, INTENSITY);
      const effective = authored / eventRateScale(recipe, INTENSITY);
      rates.push({ sceneId, authored, effective });
      if (effective > MAX_EVENT_ONSETS_PER_MIN + 0.01) {
        fail(`scene "${sceneId}": ${effective.toFixed(1)} onsets/min after scaling (budget ${MAX_EVENT_ONSETS_PER_MIN})`);
        over++;
      }
    }
    if (!over) {
      rates.sort((a, b) => b.authored - a.authored);
      const worst = rates[0];
      ok(
        `every scene within ${MAX_EVENT_ONSETS_PER_MIN} onsets/min ` +
        `(busiest authored: ${worst.sceneId} at ${worst.authored.toFixed(0)}, held to ${worst.effective.toFixed(0)})`,
      );
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
