// Offline renderer for a complete scene mix.
//
// Extracted from preview.mjs so that the auditioning CLI and the scene-distance
// check render through exactly the same code. Before this split there was no check
// that had ever rendered a scene at all: `check:ambience` measures the twelve baked
// stems and `check:ambience:runtime` measures the shape of the audio graph, so
// "every scene sounds the same" was a defect neither of them could express.
//
// The event synthesis here mirrors services/ambienceEngine.ts rather than being the
// same code — the runtime builds Web Audio graphs, this builds sample buffers — so
// treat a render as a faithful audition, not a byte-exact simulation. What it is
// exact about is the mix arithmetic: the constants come out of the engine source at
// load time (see loadMixModule) instead of being hand-copied.

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  mulberry32, hashStringToSeed, rand, randInt,
  decodeWav, renderIR, convolve, poissonTimes,
  filter, scale, addAt, rms, softClip, panMono, decorrelate,
} from './dsp.mjs';

import * as E from './events.mjs';
import { renderAnnouncement } from './voice.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const AMBIENCE_DIR = path.join(ROOT, 'public', 'ambience');
export const SAMPLE_RATE = 24000;

// ---------------------------------------------------------------------------
// EventKind -> offline generator.
//
// Every kind in services/ambiencePresets.ts must appear here or a render would
// silently omit part of the scene, which would make it untrustworthy both for
// judging by ear and for measuring.
// ---------------------------------------------------------------------------
export const EVENT_RENDERERS = {
  porcelain: (sr, rng) => E.impactPair(sr, { material: 'porcelain', rng, strength: rand(rng, 0.5, 1) }),
  cutlery: (sr, rng) => E.impact(sr, { material: 'cutlery', rng, strength: rand(rng, 0.4, 1) }),
  glass: (sr, rng) => E.impact(sr, { material: 'glass', rng, strength: rand(rng, 0.4, 1) }),
  coin: (sr, rng) => E.impact(sr, { material: 'coin', rng, strength: rand(rng, 0.3, 0.8) }),
  metalClank: (sr, rng) => E.impact(sr, { material: 'metal', rng, strength: rand(rng, 0.5, 1) }),
  woodKnock: (sr, rng) => E.impact(sr, { material: 'wood', rng, strength: rand(rng, 0.5, 1) }),
  plasticTap: (sr, rng) => E.impact(sr, { material: 'plastic', rng, strength: rand(rng, 0.4, 1) }),

  footstep: (sr, rng, surface) => E.footstepRun(sr, {
    surface, rng, steps: randInt(rng, 2, 5), tempoHz: rand(rng, 1.7, 2.2),
  }).buffer,
  footstepRun: (sr, rng, surface) => E.footstepRun(sr, {
    surface, rng, steps: randInt(rng, 5, 10), tempoHz: rand(rng, 1.8, 2.4),
  }).buffer,
  chairScrape: (sr, rng) => E.chairScrape(sr, { rng }),
  cough: (sr, rng) => E.cough(sr, { rng }),
  laugh: (sr, rng) => E.laugh(sr, { rng }),

  doorLatch: (sr, rng) => E.doorLatch(sr, { rng }),
  doorChime: (sr, rng) => E.doorChime(sr, { rng }),
  registerBeep: (sr, rng) => E.registerBeep(sr, { rng }),
  cashDrawer: (sr, rng) => E.cashDrawer(sr, { rng }),

  typing: (sr, rng) => E.typingBurst(sr, { rng, keys: randInt(rng, 4, 12) }),
  paperRustle: (sr, rng) => E.paperRustle(sr, { rng }),
  printer: (sr, rng) => E.printerPass(sr, { rng }),
  phoneRing: (sr, rng) => E.phoneRing(sr, { rng }),

  vehiclePass: (sr, rng) => E.vehiclePass(sr, {
    rng, speedKmh: rand(rng, 28, 62), distanceM: rand(rng, 3.5, 11), direction: rng() < 0.5 ? -1 : 1,
  }),
  honk: (sr, rng) => E.honk(sr, { rng, distanceM: rand(rng, 8, 40) }),
  siren: (sr, rng) => E.siren(sr, { rng, distanceM: rand(rng, 90, 250) }),

  sizzle: (sr, rng) => E.sizzle(sr, { rng, durationS: rand(rng, 1.2, 3) }),
  steam: (sr, rng) => E.steamHiss(sr, { rng, durationS: rand(rng, 2, 4.5) }),
  grinder: (sr, rng) => E.grinder(sr, { rng, durationS: rand(rng, 1.8, 3) }),

  announcement: (sr, rng) => renderAnnouncement(sr, { rng, durationS: rand(rng, 2, 4) }),
  luggage: (sr, rng) => E.luggageWheels(sr, { rng, durationS: rand(rng, 2, 4.5) }),

  monitorBeep: (sr, rng) => E.monitorBeep(sr, { rng }),
  weightClank: (sr, rng) => E.weightClank(sr, { rng }),
  impactWrench: (sr, rng) => E.impactWrench(sr, { rng }),
  compressor: (sr, rng) => E.compressor(sr, { rng, durationS: rand(rng, 3, 7) }),
  hairDryer: (sr, rng) => E.hairDryer(sr, { rng, durationS: rand(rng, 3, 8) }),

  bird: (sr, rng) => E.bird(sr, { rng, distanceM: rand(rng, 5, 30) }),
  windGust: (sr, rng) => E.windGust(sr, { rng, durationS: rand(rng, 2.5, 5.5) }),
  rainDrip: (sr, rng) => E.rainDrip(sr, { rng }),

  creak: (sr, rng) => E.creak(sr, { rng }),
  pageTurn: (sr, rng) => E.pageTurn(sr, { rng }),
  applause: (sr, rng) => E.applause(sr, { rng, durationS: rand(rng, 3.5, 7) }),
};

/** Fallback floor material, used when a recipe does not name one. Mirrors
 *  `surfaceForRoom` in services/ambienceEngine.ts. */
export function surfaceForRoom(size) {
  switch (size) {
    case 'outdoor': return 'asphalt';
    case 'hall': return 'tile';
    case 'large': return 'concrete';
    case 'medium': return 'wood';
    default: return 'carpet';
  }
}

// ---------------------------------------------------------------------------
// Load the scene recipes and the mix constants out of the TypeScript source.
// ---------------------------------------------------------------------------
async function loadMixModule() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ambience-render-'));
  const outfile = path.join(dir, 'bundle.mjs');
  // stdin + resolveDir, so no entry file is ever written into the repo root where a
  // crash could strand it for tsc to pick up.
  await build({
    stdin: {
      contents: `
        export { SCENE_RECIPES, SCENE_IDS, bedLevel } from './services/ambiencePresets';
        export {
          STEM_MAKEUP, EVENT_OVER_BED, BED_FLOOR, MAX_BED_BOOST, BED_REVERB_SEND,
          eventRateScale, onsetsPerMinute,
        } from './services/ambienceEngine';
      `,
      resolveDir: ROOT,
      sourcefile: 'entry.ts',
      loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

// Decoding and resampling a stem is the single most expensive step, and rendering
// the whole catalogue asks for the same twelve files forty-odd times.
const stemCache = new Map();

function loadStemBuffer(stemId) {
  if (stemCache.has(stemId)) return stemCache.get(stemId);
  const file = path.join(AMBIENCE_DIR, `${stemId}.wav`);
  if (!existsSync(file)) {
    stemCache.set(stemId, null);
    return null;
  }
  const { channels, sampleRate } = decodeWav(readFileSync(file));
  // Naive linear resample to the render rate. Fine for auditioning, and it puts every
  // scene at one rate so a spectral comparison measures texture rather than which
  // stems happened to be baked at 8 kHz.
  const ratio = sampleRate / SAMPLE_RATE;
  const out = channels.map((chan) => {
    if (ratio === 1) return chan;
    const outLen = Math.floor(chan.length / ratio);
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      res[i] = chan[i0] * (1 - frac) + (chan[Math.min(chan.length - 1, i0 + 1)] ?? 0) * frac;
    }
    return res;
  });
  stemCache.set(stemId, out);
  return out;
}

/**
 * Build a renderer bound to the engine's real mix constants.
 *
 * Returns the scene tables alongside `renderScene`, so a caller never has to import
 * the recipes separately and risk reading a different build of them.
 */
export async function loadSceneRenderer() {
  const mix = await loadMixModule();
  const {
    SCENE_RECIPES, SCENE_IDS, bedLevel,
    STEM_MAKEUP, EVENT_OVER_BED, BED_FLOOR, MAX_BED_BOOST, BED_REVERB_SEND,
    eventRateScale, onsetsPerMinute,
  } = mix;

  function renderScene(sceneId, { seconds = 20, seed = 'a' } = {}) {
    const recipe = SCENE_RECIPES[sceneId];
    if (!recipe) throw new Error(`Unknown scene "${sceneId}"`);
    const n = Math.floor(seconds * SAMPLE_RATE);
    const rng = mulberry32(hashStringToSeed(`preview:${sceneId}:${seed}`));
    // Mirrors services/ambienceEngine.ts: events are scaled against the scene's bed,
    // so the same event sits the same distance above the bed in every scene. Quiet
    // scenes get the same lift the engine applies, to bed and events together.
    const rawBed = bedLevel(recipe);
    const bedBoost = Math.min(MAX_BED_BOOST, Math.max(1, rawBed > 0 ? BED_FLOOR / rawBed : 1));
    const eventScale = rawBed * bedBoost * EVENT_OVER_BED;
    const bedGain = STEM_MAKEUP * bedBoost;
    const rateScale = eventRateScale(recipe, 0.6);
    const surface = recipe.surface ?? surfaceForRoom(recipe.room.size);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    const missing = [];
    const stemLayers = [];

    // --- stems ---
    for (const layer of recipe.stems) {
      const chans = loadStemBuffer(layer.stem);
      if (!chans) { missing.push(layer.stem); continue; }

      let l = chans[0];
      let r = chans[1] ?? chans[0];
      if (chans.length === 1 && (layer.width ?? 0) > 0) {
        [l, r] = decorrelate(chans[0], SAMPLE_RATE, { rng, amount: layer.width });
      }
      const shape = (buf) => {
        let out = buf;
        if (layer.highpass) out = filter(out, { type: 'highpass', freq: layer.highpass, q: 0.7, sampleRate: SAMPLE_RATE });
        if (layer.lowpass) out = filter(out, { type: 'lowpass', freq: layer.lowpass, q: 0.7, sampleRate: SAMPLE_RATE });
        // The engine high-passes the whole stem bus to free headroom below 80 Hz.
        return filter(out, { type: 'highpass', freq: 80, q: 0.7, sampleRate: SAMPLE_RATE });
      };
      const sl = shape(l);
      const sr2 = shape(r);
      // Loop the stem across the render length, entering at a random offset exactly
      // as the engine does.
      const offset = Math.floor(rng() * sl.length);
      for (let i = 0; i < n; i++) {
        left[i] += sl[(i + offset) % sl.length] * layer.gain;
        right[i] += sr2[(i + offset) % sr2.length] * layer.gain;
      }
      stemLayers.push({ sl, sr2, offset, gain: layer.gain });
    }

    // --- events ---
    const dryL = new Float32Array(n);
    const dryR = new Float32Array(n);
    const wetL = new Float32Array(n);
    const wetR = new Float32Array(n);
    const counts = {};

    // The bed goes to the room too, so bed and events share an acoustic. The engine
    // used to apply room.wet both here and at the return, which left the bed at
    // wet^2 and effectively dry while the events got the full room.
    for (const { sl, sr2, offset, gain } of stemLayers) {
      for (let i = 0; i < n; i++) {
        wetL[i] += sl[(i + offset) % sl.length] * gain * BED_REVERB_SEND * bedGain;
        wetR[i] += sr2[(i + offset) % sr2.length] * gain * BED_REVERB_SEND * bedGain;
      }
    }

    let onsets = 0;
    for (const spec of recipe.events ?? []) {
      const render = EVENT_RENDERERS[spec.kind];
      if (!render) { missing.push(`event:${spec.kind}`); continue; }
      const far = spec.distance === 'far';
      const mid = spec.distance === 'mid';

      // The engine holds each scene under a density budget by stretching every
      // interval; without mirroring it a render auditions a busier scene than the
      // browser plays.
      const times = poissonTimes(seconds, 1 / (spec.everyS * rateScale), rng, {
        burst: spec.burst ?? 0, burstGapS: [0.12, 0.7],
      });
      counts[spec.kind] = times.length;
      onsets += times.length;

      for (const t of times) {
        let buf = render(SAMPLE_RATE, rng, surface);
        let bl;
        let br;
        if (Array.isArray(buf)) { [bl, br] = buf; } else { [bl, br] = panMono(buf, rand(rng, -0.8, 0.8)); }

        // Far events are lowpassed and go mostly to the room; near events stay dry.
        // That split is what produces depth.
        if (far || mid) {
          const outdoor = recipe.room.size === 'outdoor';
          const cut = far ? (outdoor ? 2600 : 1900) : (outdoor ? 6500 : 5000);
          bl = filter(bl, { type: 'lowpass', freq: cut, q: 0.7, sampleRate: SAMPLE_RATE });
          br = filter(br, { type: 'lowpass', freq: cut, q: 0.7, sampleRate: SAMPLE_RATE });
        }
        const busGain = far ? 0.5 : mid ? 0.62 : 1;
        const busSend = far ? 0.75 : mid ? 0.95 : 0.5;
        const dryGain = spec.gain * eventScale * busGain;
        const sendGain = spec.gain * eventScale * busSend;
        const at = Math.floor(t * SAMPLE_RATE);
        addAt(dryL, bl, at, dryGain);
        addAt(dryR, br, at, dryGain);
        addAt(wetL, bl, at, sendGain);
        addAt(wetR, br, at, sendGain);
      }
    }

    // --- room ---
    const ir = renderIR(SAMPLE_RATE, { size: recipe.room.size, rng });
    const revL = convolve(wetL, ir[0], { circular: true });
    const revR = convolve(wetR, ir[1] ?? ir[0], { circular: true });

    for (let i = 0; i < n; i++) {
      left[i] = left[i] * bedGain + dryL[i] + revL[i] * recipe.room.wet * 0.9;
      right[i] = right[i] * bedGain + dryR[i] + revR[i] * recipe.room.wet * 0.9;
    }

    const level = Math.max(rms(left), rms(right));
    const gain = level > 0 ? Math.pow(10, -20 / 20) / level : 1;
    const outL = scale(left, gain);
    const outR = scale(right, gain);
    softClip(outL, 0.94);
    softClip(outR, 0.94);

    return {
      channels: [outL, outR],
      counts,
      missing,
      // Reported rather than recomputed by the caller: these are the numbers the
      // render actually used, not what the tables predict.
      onsetsPerMin: (onsets / seconds) * 60,
      bedDbfs: 20 * Math.log10(Math.max(rawBed * bedGain, 1e-12)),
      rateScale,
    };
  }

  return {
    SCENE_RECIPES, SCENE_IDS, bedLevel, renderScene,
    eventRateScale, onsetsPerMinute, SAMPLE_RATE,
  };
}
