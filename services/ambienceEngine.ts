import {
  bedLevel,
  EventKind,
  EventSpec,
  ResolvedAmbience,
  RoomSize,
  SceneRecipe,
  StemId,
} from './ambiencePresets';
import { loadStem } from './ambienceLibrary';

/**
 * The runtime ambience engine.
 *
 * Extracted from components/AudioPlayer.tsx, which had grown to 1529 lines of which
 * roughly 900 were this. Keeping it framework-free makes it testable and keeps the
 * component to lifecycle and UI.
 *
 * Responsibilities:
 *   - mix the scene's bundled stems, each shaped and placed in the stereo field
 *   - place the whole mix in a synthetic room
 *   - schedule and synthesise the discrete events that make a place feel alive
 *   - duck everything under the dialogue
 *
 * Notable changes from the previous implementation, all of which were audible:
 *   - one bed became a mix of 2-4 stems, so scenes differ by combination, not just
 *     by which single file plays
 *   - events are scheduled ahead of time against the audio clock, not by setTimeout,
 *     which used to be throttled to >=1 s in background tabs
 *   - near/far buses, so distance is real instead of everything being at arm's length
 *   - the limiter went back to being a safety device rather than a program compressor
 *     that ducked the whole bed for 250 ms on every footstep
 *   - nodes and timers are released when they finish instead of accumulating for the
 *     whole lesson
 */

// ---------------------------------------------------------------------------
// Mix calibration
//
// The old values (EVENT_MAKEUP = 42 against a limiter at -6 dB, ratio 20) meant a
// honk arrived at 0.80 and slammed 20:1 compression onto the whole mix for a quarter
// of a second. Events are now authored close to their final level.
//
// More importantly, events are scaled RELATIVE TO THE SCENE'S BED (see
// `bedLevel()`), not by a fixed makeup. A single global gain cannot work across
// scenes whose beds span 20 dB: the same footstep that sits nicely over a café bed
// is deafening over a therapy room. Scaling by the bed keeps the event-over-bed
// relationship — which is what the ear actually judges — constant everywhere.
// ---------------------------------------------------------------------------
// Exported so scripts/check-ambience-runtime.mjs and scripts/ambience/preview.mjs read
// the real numbers instead of keeping hand-copied duplicates in step by convention.
export const STEM_MAKEUP = 2.6;    // bundled continuous textures

/**
 * Peak of a full-gain (1.0) event, as a multiple of the scene's bed RMS.
 *
 * The headline number was never really the villain — it was 12, and the calibration
 * below lands close to it again. What made a cafe's porcelain clink arrive ~19 dB over
 * its bed was everything around it: modal hits summed their in-phase partials to a
 * further 2.15x, a `gain` of 1 meant four different loudnesses depending on which
 * synth read it, and the bed it was all measured against never actually played.
 *
 * With those fixed the value can be derived instead of guessed. A spec ends up at
 * `gain * EVENT_OVER_BED / STEM_MAKEUP` over the bed; the loudest spec in the
 * catalogue is gain 0.5, and a transient peaking ~6 dB over a continuous bed is
 * clearly present without dominating, which gives 2.0 * 2.6 / 0.5 = 10.4. The typical
 * spec (gain 0.2-0.3) then lands within a couple of dB of the bed: part of the place
 * rather than sitting on top of it.
 */
export const EVENT_OVER_BED = 10.4;
const REVERB_RETURN = 0.9;

/** Reverb send for the bed. A pure distance ratio: `room.wet` is applied at the
 *  return, and applying it here too is what left the bed dry. */
export const BED_REVERB_SEND = 0.7;

/** Side-signal scale for stereo stems at width 1. See attachStem for the measurement. */
const STEREO_SIDE_SCALE = 0.7;

/**
 * Quiet scenes get lifted towards this nominal bed amplitude.
 *
 * A library's bed sits at -39.6 dBFS and a radio studio's at -42.4 before the user's
 * volume, which on a laptop speaker is nothing at all. Because events are scaled
 * against the bed, the scene doesn't become "only clicks" — it becomes silence, and a
 * learner reads silence as "the ambience is broken". The boost is applied to the bed
 * AND to the event scale together, so the event-over-bed relationship — the thing the
 * ear actually judges — is untouched; a quiet room stays quiet relative to a cafe,
 * just not inaudible.
 */
export const BED_FLOOR = 0.0101;
export const MAX_BED_BOOST = 3;

/** Below this, laptop speakers reproduce nothing but the port noise, and it eats
 *  headroom that the audible bands need. The old beds put 85-97% of their energy
 *  here. */
const BED_HIGHPASS_HZ = 80;

export const DEFAULT_AMBIENCE_VOLUME = 0.6;
export const DEFAULT_AMBIENCE_INTENSITY = 0.6;
export const DEFAULT_AMBIENCE_DUCKING = 0.65;

// Ducking: fast to get out of the way of a syllable, slow to come back, so the bed
// doesn't pump between words. The old ducker used 50 ms in both directions.
const DUCK_ATTACK_S = 0.012;
const DUCK_RELEASE_S = 0.42;
const DUCK_DEPTH = 0.85;

// Event scheduler: queue this far ahead, top up this often. Scheduling against
// ctx.currentTime rather than firing synthesis from a timer means background-tab
// throttling delays the top-up, not the audio.
const LOOKAHEAD_S = 1.5;
const SCHEDULER_INTERVAL_MS = 400;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function hashStringToSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const rand = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const randInt = (rng: Rng, lo: number, hi: number) => Math.floor(rand(rng, lo, hi + 1));
const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/** Exponential (Poisson) interval around a mean. Real events clump; uniform
 *  min..max intervals sound like a metronome. */
const poissonInterval = (rng: Rng, meanS: number) =>
  Math.max(0.12, -Math.log(Math.max(1e-6, rng())) * meanS);

// ---------------------------------------------------------------------------
// Noise pool
//
// The old playNoiseBurst allocated and filled a fresh AudioBuffer for every event —
// up to 40 per second with rain. Here a few long buffers are generated once and read
// from a random offset, which is both cheaper and less repetitive than the old 6 s
// looping noise sources (whose period was plainly audible).
// ---------------------------------------------------------------------------
/**
 * The RMS every noise colour is normalised to.
 *
 * This matters more than it looks. The three generators used to be left at their
 * natural amplitudes — white 0.231 RMS, brown 0.173, pink 0.437 (peaking at 1.965,
 * i.e. over full scale) — so the same `gain` produced wildly different loudnesses
 * depending on which colour an event happened to use. Combined with modal hits, whose
 * partials summed to a peak of 2.15, `gain: 1` spanned roughly 15 dB. The systematic
 * effect was perverse: the pingy, obviously-synthetic events (clinks, taps, beeps —
 * all sine stacks) came out loudest, and the naturalistic ones (scuffs, scrapes, car
 * passes, rustles, applause — all noise) came out quietest. Normalising here is what
 * lets `EventSpec.gain` mean one thing everywhere.
 */
const NOISE_RMS = 0.2;

class NoisePool {
  private buffers = new Map<string, AudioBuffer>();

  constructor(private ctx: AudioContext, private rng: Rng) {}

  get(color: 'white' | 'pink' | 'brown'): AudioBuffer {
    const existing = this.buffers.get(color);
    if (existing) return existing;

    const seconds = 8;
    const length = Math.max(1, Math.floor(seconds * this.ctx.sampleRate));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const out = buffer.getChannelData(0);
    const rng = this.rng;

    if (color === 'white') {
      for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
    } else if (color === 'brown') {
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
        out[i] = last;
      }
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = rng() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
      }
    }

    // Normalise to a common RMS, then guarantee headroom. Noise is Gaussian-ish, so
    // the peak of an 8 s buffer runs ~4.5 sigma; clamping the peak as well keeps a
    // stray excursion from clipping once event gains are applied.
    let sum = 0;
    for (let i = 0; i < length; i++) sum += out[i] * out[i];
    const rms = Math.sqrt(sum / length) || 1;
    let scale = NOISE_RMS / rms;
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak * scale > 0.99) scale = 0.99 / peak;
    for (let i = 0; i < length; i++) out[i] *= scale;

    this.buffers.set(color, buffer);
    return buffer;
  }
}

// ---------------------------------------------------------------------------
// Room impulse responses
//
// The previous IR was full-density white noise under a (1-t)^decay envelope: no
// pre-delay, no early reflections, no high-frequency damping. That is a plate, not a
// room, and it was being applied at 1.1 s to outdoor street scenes.
// ---------------------------------------------------------------------------

const ROOM_PARAMS: Record<RoomSize, { rt60: number; preDelayMs: number; damping: number; reflections: number[] }> = {
  small:   { rt60: 0.45, preDelayMs: 7,  damping: 0.55, reflections: [0.009, 0.014, 0.021, 0.029, 0.038] },
  medium:  { rt60: 0.8,  preDelayMs: 12, damping: 0.45, reflections: [0.013, 0.02, 0.031, 0.044, 0.058, 0.071] },
  large:   { rt60: 1.5,  preDelayMs: 20, damping: 0.35, reflections: [0.021, 0.033, 0.047, 0.066, 0.085, 0.104, 0.13] },
  hall:    { rt60: 2.4,  preDelayMs: 32, damping: 0.28, reflections: [0.033, 0.05, 0.072, 0.095, 0.124, 0.158, 0.19] },
  // Outdoors there is a ground bounce and essentially nothing else. Giving a street
  // a reverb tail is one of the reasons every scene used to sound like an interior.
  outdoor: { rt60: 0.22, preDelayMs: 4,  damping: 0.8,  reflections: [0.012, 0.026] },
};

function createRoomImpulse(ctx: AudioContext, size: RoomSize, rng: Rng): AudioBuffer {
  const params = ROOM_PARAMS[size];
  const sampleRate = ctx.sampleRate;
  const length = Math.max(64, Math.floor(params.rt60 * 1.2 * sampleRate));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const decayK = Math.log(1000) / params.rt60;
  const preDelay = Math.floor((params.preDelayMs / 1000) * sampleRate);
  const buildUp = Math.max(1, Math.floor(0.05 * sampleRate));

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);

    // Early reflections. Their spacing is what the ear reads as room size, and
    // jittering them per channel decorrelates the two ears — which is most of what
    // makes a reverb sound wide rather than like a mono effect.
    for (const time of params.reflections) {
      const jittered = time * (1 + (rng() - 0.5) * 0.12);
      const idx = preDelay + Math.floor(jittered * sampleRate);
      if (idx < length) {
        out[idx] += (rng() < 0.5 ? -1 : 1) * 0.5 * Math.exp(-decayK * jittered);
      }
    }

    // Diffuse tail, growing denser over the first ~50 ms as a real tail does, with
    // the high band decaying faster than the low.
    let hp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = i / sampleRate;
      const density = Math.min(1, (i - preDelay) / buildUp);
      if (rng() > density * 0.9) continue;
      const sample = (rng() * 2 - 1) * Math.exp(-decayK * t);
      // One-pole split: `hp` tracks the low band, the residue is the high band and
      // gets an extra decay term.
      hp += (sample - hp) * 0.35;
      const high = sample - hp;
      out[i] += hp + high * Math.exp(-decayK * params.damping * 4 * t);
    }
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Event synthesis
// ---------------------------------------------------------------------------

interface EventContext {
  ctx: AudioContext;
  rng: Rng;
  noise: NoisePool;
  /** Dry destination for this event, already carrying its distance treatment. */
  dest: AudioNode;
  /** Reverb send for this event. */
  send: GainNode;
  /** When to start, on the AudioContext clock. */
  at: number;
  /** 0..1 scene intensity, already including the recipe's bias. */
  intensity: number;
  gain: number;
  track: (node: AudioNode, stopAt: number) => void;
}

/** A struck object: several partials with INDEPENDENT decay times.
 *  A shared envelope (what the old playModalHit used) always reads as a synth bell,
 *  because real objects lose their high partials first. */
function modalHit(
  c: EventContext,
  partials: Array<{ freq: number; decayS: number; amp: number }>,
  opts: { pan: number; noiseAmount?: number; noiseHz?: number } = { pan: 0 },
) {
  const { ctx, at } = c;
  const panner = ctx.createStereoPanner();
  panner.pan.value = opts.pan;

  const out = ctx.createGain();
  out.gain.value = c.gain;
  panner.connect(out);
  out.connect(c.dest);
  out.connect(c.send);

  // Partials start in phase, so at t=0 they sum. A four-partial material stack summed
  // to 2.15x its nominal gain, which is most of why the pingy events dominated the
  // mix. Renormalise so the stack peaks at the LOUDEST partial's amplitude rather than
  // at their sum, which keeps `strength` meaningful (all amps scale with it) while
  // making `gain` mean roughly "peak amplitude", the same as it does for noiseBurst.
  let ampSum = 0;
  let ampMax = 0;
  for (const p of partials) { ampSum += p.amp; ampMax = Math.max(ampMax, p.amp); }
  const ampNorm = ampSum > 0 ? ampMax / ampSum : 1;

  let longest = 0;
  for (const p of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.freq, at);
    // Modes drift slightly flat as the excitation settles.
    osc.frequency.exponentialRampToValueAtTime(p.freq * 0.995, at + p.decayS);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.amp * ampNorm), at + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0001, at + p.decayS);

    osc.connect(env);
    env.connect(panner);
    osc.start(at);
    osc.stop(at + p.decayS + 0.02);
    c.track(osc, at + p.decayS + 0.05);
    c.track(env, at + p.decayS + 0.05);
    longest = Math.max(longest, p.decayS);
  }

  // The contact transient. Without it, a modal stack sounds synthesised no matter
  // how well chosen the partials are.
  if (opts.noiseAmount) {
    noiseBurst(c, {
      durationMs: 5,
      filterType: 'highpass',
      freq: opts.noiseHz ?? 4000,
      q: 0.7,
      gain: c.gain * opts.noiseAmount,
      pan: opts.pan,
      attackMs: 0.3,
    });
  }

  c.track(panner, at + longest + 0.1);
  c.track(out, at + longest + 0.1);
}

function noiseBurst(
  c: EventContext,
  opts: {
    durationMs: number;
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    gain: number;
    pan?: number;
    attackMs?: number;
    color?: 'white' | 'pink' | 'brown';
  },
) {
  const { ctx, at } = c;
  const dur = opts.durationMs / 1000;
  const buffer = c.noise.get(opts.color ?? 'white');

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  // Random read offset: cheaper than allocating a buffer per event, and it avoids
  // the audible periodicity of a short looping noise source.
  const offset = c.rng() * Math.max(0, buffer.duration - dur - 0.05);

  const flt = ctx.createBiquadFilter();
  flt.type = opts.filterType;
  flt.frequency.value = opts.freq;
  flt.Q.value = opts.q ?? 1;

  const panner = ctx.createStereoPanner();
  panner.pan.value = opts.pan ?? 0;

  const env = ctx.createGain();
  const attack = Math.min(dur * 0.4, (opts.attackMs ?? 2) / 1000);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  src.connect(flt);
  flt.connect(panner);
  panner.connect(env);
  env.connect(c.dest);
  env.connect(c.send);

  src.start(at, offset, dur + 0.05);
  src.stop(at + dur + 0.05);
  const done = at + dur + 0.1;
  c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
}

/** Material definitions mirroring scripts/ambience/events.mjs, so a baked kitchen
 *  and a live cup sound like the same world. */
const MATERIALS: Record<string, { base: [number, number]; ratios: number[]; decays: number[]; baseDecay: [number, number]; noise: number; noiseHz: number }> = {
  porcelain: { base: [1400, 2600], ratios: [1, 2.13, 3.41, 5.02], decays: [1, 0.42, 0.19, 0.08], baseDecay: [0.28, 0.5], noise: 0.45, noiseHz: 4200 },
  glass:     { base: [2100, 3800], ratios: [1, 2.76, 4.19, 6.83], decays: [1, 0.55, 0.3, 0.14], baseDecay: [0.5, 0.95], noise: 0.3, noiseHz: 5200 },
  cutlery:   { base: [2600, 4600], ratios: [1, 1.87, 3.05, 4.62], decays: [1, 0.7, 0.45, 0.25], baseDecay: [0.16, 0.34], noise: 0.7, noiseHz: 5600 },
  metal:     { base: [190, 420],   ratios: [1, 2.31, 3.12, 4.55], decays: [1, 0.72, 0.5, 0.3],  baseDecay: [0.6, 1.4],  noise: 0.8, noiseHz: 1800 },
  coin:      { base: [3200, 5200], ratios: [1, 2.4, 3.9],         decays: [1, 0.5, 0.22],       baseDecay: [0.12, 0.26], noise: 0.6, noiseHz: 6000 },
  wood:      { base: [340, 720],   ratios: [1, 1.61, 2.44, 3.8],  decays: [1, 0.35, 0.16, 0.07], baseDecay: [0.08, 0.18], noise: 0.9, noiseHz: 1400 },
  plastic:   { base: [900, 1900],  ratios: [1, 1.94, 3.2],        decays: [1, 0.3, 0.12],       baseDecay: [0.04, 0.09], noise: 0.85, noiseHz: 3000 },
};

function material(c: EventContext, name: keyof typeof MATERIALS, strength: number, pan: number) {
  const m = MATERIALS[name];
  const base = rand(c.rng, m.base[0], m.base[1]);
  const baseDecay = rand(c.rng, m.baseDecay[0], m.baseDecay[1]);
  modalHit(
    c,
    m.ratios.map((ratio, i) => ({
      freq: base * ratio * (1 + (c.rng() - 0.5) * 0.024),
      decayS: baseDecay * m.decays[i],
      amp: (strength / (1 + i * 0.9)),
    })),
    { pan, noiseAmount: m.noise * strength, noiseHz: m.noiseHz },
  );
}

const SURFACES: Record<string, { heelHz: [number, number]; heelDecay: number; scuffHz: [number, number]; scuffMs: number; bright: number }> = {
  tile:     { heelHz: [180, 320], heelDecay: 0.055, scuffHz: [2600, 5200], scuffMs: 45, bright: 1 },
  wood:     { heelHz: [140, 260], heelDecay: 0.075, scuffHz: [1400, 3000], scuffMs: 55, bright: 0.8 },
  concrete: { heelHz: [110, 210], heelDecay: 0.045, scuffHz: [1800, 4200], scuffMs: 40, bright: 0.9 },
  asphalt:  { heelHz: [95, 180],  heelDecay: 0.05,  scuffHz: [900, 2400],  scuffMs: 70, bright: 0.6 },
  carpet:   { heelHz: [70, 130],  heelDecay: 0.04,  scuffHz: [400, 1200],  scuffMs: 60, bright: 0.3 },
};

function oneFootstep(c: EventContext, surface: keyof typeof SURFACES, strength: number, pan: number, at: number) {
  const s = SURFACES[surface];
  const sub: EventContext = { ...c, at, gain: c.gain * strength };
  modalHit(
    sub,
    [
      { freq: rand(c.rng, s.heelHz[0], s.heelHz[1]), decayS: s.heelDecay, amp: 1 },
      { freq: rand(c.rng, s.heelHz[0], s.heelHz[1]) * 2.4, decayS: s.heelDecay * 0.4, amp: 0.35 },
    ],
    { pan },
  );
  noiseBurst(
    { ...sub, at: at + rand(c.rng, 0.004, 0.014) },
    {
      durationMs: s.scuffMs * rand(c.rng, 0.8, 1.3),
      filterType: 'bandpass',
      freq: rand(c.rng, s.scuffHz[0], s.scuffHz[1]),
      q: 0.8,
      gain: c.gain * strength * 0.5 * s.bright,
      pan,
      attackMs: 3,
    },
  );
}

/** Which floor a scene has. Hearing heels on tile in a carpeted therapy room, or
 *  a soft pad on a station concourse, is immediately wrong. */
function surfaceForRoom(size: RoomSize): keyof typeof SURFACES {
  switch (size) {
    case 'outdoor': return 'asphalt';
    case 'hall': return 'tile';
    case 'large': return 'concrete';
    case 'medium': return 'wood';
    default: return 'carpet';
  }
}

type EventSynth = (c: EventContext, scene: SceneRecipe) => void;

/**
 * The registry. Every EventKind in ambiencePresets.ts must appear here — that
 * invariant is asserted by scripts/check-ambience.mjs and is what prevents the old
 * situation where 23 of 38 tags were assigned to scenarios and did nothing at all.
 */
export const EVENT_SYNTHS: Record<EventKind, EventSynth> = {
  porcelain: (c) => {
    const pan = rand(c.rng, -0.7, 0.7);
    material(c, 'porcelain', rand(c.rng, 0.5, 1), pan);
    // A cup usually meets a saucer.
    if (c.rng() < 0.45) {
      material({ ...c, at: c.at + rand(c.rng, 0.03, 0.09), gain: c.gain * 0.5 }, 'porcelain', 0.6, pan);
    }
  },
  cutlery: (c) => {
    const pan = rand(c.rng, -0.8, 0.8);
    const hits = randInt(c.rng, 1, 3);
    for (let i = 0; i < hits; i++) {
      material({ ...c, at: c.at + i * rand(c.rng, 0.04, 0.13) }, 'cutlery', rand(c.rng, 0.4, 1), pan);
    }
  },
  glass: (c) => material(c, 'glass', rand(c.rng, 0.4, 1), rand(c.rng, -0.7, 0.7)),
  coin: (c) => {
    const pan = rand(c.rng, -0.4, 0.4);
    for (let i = 0; i < randInt(c.rng, 1, 4); i++) {
      material({ ...c, at: c.at + i * rand(c.rng, 0.03, 0.11) }, 'coin', rand(c.rng, 0.3, 0.8), pan);
    }
  },
  metalClank: (c) => material(c, 'metal', rand(c.rng, 0.5, 1), rand(c.rng, -0.8, 0.8)),
  woodKnock: (c) => material(c, 'wood', rand(c.rng, 0.5, 1), rand(c.rng, -0.7, 0.7)),
  plasticTap: (c) => material(c, 'plastic', rand(c.rng, 0.4, 1), rand(c.rng, -0.6, 0.6)),

  footstep: (c, scene) => {
    // Never a single isolated step: people walk. The old engine played one thump
    // every 1.7-6.5 s, which reads as a metronome, not as a person.
    const surface = surfaceForRoom(scene.room.size);
    const steps = randInt(c.rng, 2, 5);
    const interval = 1 / rand(c.rng, 1.7, 2.2);
    const pan = rand(c.rng, -0.6, 0.6);
    for (let i = 0; i < steps; i++) {
      const asym = i % 2 === 0 ? 1 : rand(c.rng, 0.78, 0.95);
      oneFootstep(c, surface, asym, pan, c.at + i * interval + rand(c.rng, -0.012, 0.012));
    }
  },
  footstepRun: (c, scene) => {
    // Someone crossing the space: more steps, and the pan sweeps as they pass.
    const surface = surfaceForRoom(scene.room.size);
    const steps = randInt(c.rng, 5, 10);
    const interval = 1 / rand(c.rng, 1.8, 2.4);
    const from = c.rng() < 0.5 ? -0.9 : 0.9;
    for (let i = 0; i < steps; i++) {
      const t = i / Math.max(1, steps - 1);
      const proximity = 1 - Math.abs(t - 0.5) * 1.5;
      oneFootstep(c, surface, Math.max(0.25, proximity), from * (1 - 2 * t), c.at + i * interval);
    }
  },
  chairScrape: (c) => {
    noiseBurst(c, {
      durationMs: rand(c.rng, 180, 600),
      filterType: 'bandpass',
      freq: rand(c.rng, 600, 1500),
      q: 3.2,
      gain: c.gain * 0.7,
      pan: rand(c.rng, -0.6, 0.6),
      attackMs: 25,
    });
  },
  cough: (c) => {
    const pan = rand(c.rng, -0.8, 0.8);
    noiseBurst(c, {
      durationMs: rand(c.rng, 90, 170), filterType: 'bandpass', freq: rand(c.rng, 500, 1100),
      q: 1.1, gain: c.gain, pan, attackMs: 4, color: 'pink',
    });
    if (c.rng() < 0.5) {
      noiseBurst({ ...c, at: c.at + rand(c.rng, 0.35, 0.7), gain: c.gain * 0.7 }, {
        durationMs: rand(c.rng, 80, 150), filterType: 'bandpass', freq: rand(c.rng, 500, 1100),
        q: 1.1, gain: c.gain * 0.7, pan, attackMs: 4, color: 'pink',
      });
    }
  },
  laugh: (c) => {
    // Syllabic bursts on a falling pitch — the shape is what reads as laughter.
    const pan = rand(c.rng, -0.8, 0.8);
    const pulses = randInt(c.rng, 3, 6);
    const f0 = rand(c.rng, 180, 340);
    for (let i = 0; i < pulses; i++) {
      noiseBurst({ ...c, at: c.at + i * rand(c.rng, 0.11, 0.18) }, {
        durationMs: rand(c.rng, 55, 95),
        filterType: 'bandpass',
        freq: f0 * (3 + i * 0.2) * rand(c.rng, 0.9, 1.1),
        q: 2.5,
        gain: c.gain * (1 - i / (pulses + 2)),
        pan,
        attackMs: 5,
        color: 'pink',
      });
    }
  },

  doorLatch: (c) => {
    const pan = rand(c.rng, -0.7, 0.7);
    material(c, 'wood', rand(c.rng, 0.6, 1), pan);
    material({ ...c, at: c.at + rand(c.rng, 0.03, 0.09), gain: c.gain * 0.5 }, 'metal', 0.4, pan);
  },
  doorChime: (c) => {
    const pan = rand(c.rng, -0.5, 0.5);
    const strikes = randInt(c.rng, 2, 4);
    for (let k = 0; k < strikes; k++) {
      const base = rand(c.rng, 1900, 2400);
      modalHit(
        { ...c, at: c.at + k * rand(c.rng, 0.09, 0.22), gain: c.gain * Math.pow(0.72, k) },
        [
          { freq: base, decayS: 0.85, amp: 1 },
          { freq: base * 1.53, decayS: 0.5, amp: 0.5 },
          { freq: base * 2.31, decayS: 0.2, amp: 0.22 },
        ],
        { pan, noiseAmount: 0.25, noiseHz: 5000 },
      );
    }
  },
  registerBeep: (c) => {
    const { ctx, at } = c;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = rand(c.rng, 2100, 2900);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 5000;
    const env = ctx.createGain();
    const dur = rand(c.rng, 0.06, 0.12);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + 0.002);
    env.gain.setValueAtTime(c.gain * 0.5, at + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    c.track(osc, at + dur + 0.05); c.track(flt, at + dur + 0.05); c.track(env, at + dur + 0.05);
  },
  cashDrawer: (c) => {
    const pan = rand(c.rng, -0.4, 0.4);
    noiseBurst(c, {
      durationMs: 220, filterType: 'bandpass', freq: 900, q: 1.1,
      gain: c.gain * 0.4, pan, attackMs: 40,
    });
    material({ ...c, at: c.at + 0.2, gain: c.gain * 0.6 }, 'metal', 0.5, pan);
    for (let k = 0; k < randInt(c.rng, 2, 5); k++) {
      material({ ...c, at: c.at + rand(c.rng, 0.25, 0.7), gain: c.gain * 0.4 }, 'coin', 0.4, pan);
    }
  },

  typing: (c) => {
    const keys = randInt(c.rng, 4, 12);
    const interval = rand(c.rng, 0.075, 0.16);
    const pan = rand(c.rng, -0.5, 0.5);
    for (let i = 0; i < keys; i++) {
      const at = c.at + i * interval + rand(c.rng, -0.02, 0.02);
      material({ ...c, at, gain: c.gain * rand(c.rng, 0.6, 1) }, 'plastic', 0.7, pan);
      // The key coming back up.
      material({ ...c, at: at + rand(c.rng, 0.045, 0.09), gain: c.gain * 0.3 }, 'plastic', 0.3, pan);
    }
  },
  paperRustle: (c) => {
    // Granulated: paper is a series of tiny crackles, not a smooth noise burst.
    const grains = randInt(c.rng, 10, 26);
    const spread = rand(c.rng, 0.25, 0.8);
    const pan = rand(c.rng, -0.5, 0.5);
    for (let i = 0; i < grains; i++) {
      noiseBurst({ ...c, at: c.at + c.rng() * spread }, {
        durationMs: rand(c.rng, 2, 12),
        filterType: 'bandpass',
        freq: rand(c.rng, 1800, 6500),
        q: 1.4,
        gain: c.gain * rand(c.rng, 0.2, 0.8),
        pan,
        attackMs: 0.4,
      });
    }
  },
  printer: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 0.9, 2.2);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, at);
    osc.frequency.linearRampToValueAtTime(220, at + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(95, at + dur);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 2200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.25), at + 0.08);
    env.gain.setValueAtTime(c.gain * 0.25, at + dur * 0.8);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    c.track(osc, at + dur + 0.05); c.track(flt, at + dur + 0.05); c.track(env, at + dur + 0.05);
    noiseBurst(c, {
      durationMs: dur * 1000, filterType: 'bandpass', freq: 1600, q: 0.8,
      gain: c.gain * 0.12, pan: rand(c.rng, -0.3, 0.3), attackMs: 60,
    });
  },
  phoneRing: (c) => {
    const pan = rand(c.rng, -0.7, 0.7);
    const base = rand(c.rng, 900, 1400);
    const bursts = randInt(c.rng, 1, 3);
    for (let b = 0; b < bursts; b++) {
      for (let i = 0; i < 8; i++) {
        modalHit(
          { ...c, at: c.at + b * 1.6 + i * 0.05, gain: c.gain * 0.4 },
          [{ freq: base * (i % 2 === 0 ? 1 : 1.26), decayS: 0.045, amp: 1 }],
          { pan },
        );
      }
    }
  },

  vehiclePass: (c) => {
    // Level arc, pan sweep and a filter that opens then closes. A real Doppler
    // resample is not worth a per-event AudioWorklet here; the arc plus the sweep
    // carries the movement, and the baked traffic_near stem supplies true Doppler.
    const { ctx, at } = c;
    const dur = rand(c.rng, 1.8, 3.4);
    const dir = c.rng() < 0.5 ? -1 : 1;

    const src = ctx.createBufferSource();
    src.buffer = c.noise.get('brown');
    src.loop = true;

    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = 0.6;
    flt.frequency.setValueAtTime(320, at);
    flt.frequency.linearRampToValueAtTime(rand(c.rng, 900, 1500), at + dur * 0.5);
    flt.frequency.linearRampToValueAtTime(300, at + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(-0.95 * dir, at);
    panner.pan.linearRampToValueAtTime(0.95 * dir, at + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain), at + dur * 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    src.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    src.start(at, c.rng() * 4);
    src.stop(at + dur + 0.05);
    const done = at + dur + 0.1;
    c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
  },
  honk: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 0.22, 0.6);
    const f1 = rand(c.rng, 320, 440);
    const pan = rand(c.rng, -0.8, 0.8);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const shaper = ctx.createWaveShaper();
    // Horns are clipped reeds; the distortion is most of the timbre.
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i / 128) - 1) * 2.4);
    shaper.curve = curve;
    const flt = ctx.createBiquadFilter();
    flt.type = 'peaking'; flt.frequency.value = 900; flt.Q.value = 1.2; flt.gain.value = 5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + 0.008);
    env.gain.setValueAtTime(c.gain * 0.5, at + dur * 0.85);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    for (const f of [f1, f1 * rand(c.rng, 1.18, 1.26)]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.connect(shaper);
      osc.start(at); osc.stop(at + dur + 0.02);
      c.track(osc, at + dur + 0.05);
    }
    shaper.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    const done = at + dur + 0.1;
    c.track(shaper, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
  },
  siren: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 3.5, 6.5);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const base = rand(c.rng, 620, 780);
    osc.frequency.setValueAtTime(base, at);
    // Two-tone wail.
    for (let t = 0; t < dur; t += 0.5) {
      osc.frequency.linearRampToValueAtTime(base * (t % 1 < 0.5 ? 1.42 : 1), at + t + 0.5);
    }
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(rand(c.rng, -0.9, -0.3), at);
    panner.pan.linearRampToValueAtTime(rand(c.rng, 0.3, 0.9), at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.4), at + dur * 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(panner); panner.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.1;
    c.track(osc, done); c.track(panner, done); c.track(env, done);
  },

  sizzle: (c) => {
    noiseBurst(c, {
      durationMs: rand(c.rng, 900, 2600), filterType: 'highpass', freq: rand(c.rng, 2200, 4200),
      q: 0.6, gain: c.gain * 0.5, pan: rand(c.rng, -0.5, 0.5), attackMs: 120,
    });
  },
  steam: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 2, 4.5);
    const src = ctx.createBufferSource();
    src.buffer = c.noise.get('white');
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.Q.value = 1.1;
    flt.frequency.setValueAtTime(2400, at);
    flt.frequency.linearRampToValueAtTime(3800, at + dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = rand(c.rng, -0.5, 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + 0.15);
    env.gain.setValueAtTime(c.gain * 0.5, at + dur * 0.8);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    src.start(at, c.rng() * 4); src.stop(at + dur + 0.05);
    const done = at + dur + 0.1;
    c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
  },
  grinder: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 1.6, 3);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(40, at);
    osc.frequency.linearRampToValueAtTime(115, at + 0.35);
    osc.frequency.setValueAtTime(115, at + dur - 0.3);
    osc.frequency.linearRampToValueAtTime(45, at + dur);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 1800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.35), at + 0.2);
    env.gain.setValueAtTime(c.gain * 0.35, at + dur - 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.1;
    c.track(osc, done); c.track(flt, done); c.track(env, done);
    noiseBurst(c, {
      durationMs: dur * 1000, filterType: 'bandpass', freq: 2600, q: 0.6,
      gain: c.gain * 0.2, pan: 0, attackMs: 200,
    });
  },

  announcement: (c) => {
    // A PA voice: syllabic bursts through a narrow band with a horn resonance. The
    // channel is the cue — nobody needs to make out the words to know what it is.
    const syllables = randInt(c.rng, 6, 14);
    const pan = rand(c.rng, -0.3, 0.3);
    let t = c.at;
    for (let i = 0; i < syllables; i++) {
      const dur = rand(c.rng, 0.09, 0.2);
      noiseBurst({ ...c, at: t }, {
        durationMs: dur * 1000,
        filterType: 'bandpass',
        freq: rand(c.rng, 700, 2000),
        q: 2.2,
        gain: c.gain * rand(c.rng, 0.5, 1),
        pan,
        attackMs: 14,
        color: 'pink',
      });
      t += dur + rand(c.rng, 0.03, 0.1);
      // Phrase break.
      if (c.rng() < 0.18) t += rand(c.rng, 0.25, 0.6);
    }
  },
  luggage: (c) => {
    const dur = rand(c.rng, 2, 4.5);
    const { ctx, at } = c;
    const src = ctx.createBufferSource();
    src.buffer = c.noise.get('white');
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = 2200; flt.Q.value = 0.7;
    const panner = ctx.createStereoPanner();
    const dir = c.rng() < 0.5 ? -1 : 1;
    panner.pan.setValueAtTime(-0.8 * dir, at);
    panner.pan.linearRampToValueAtTime(0.8 * dir, at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.4), at + dur * 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    src.start(at, c.rng() * 4); src.stop(at + dur + 0.05);
    const done = at + dur + 0.1;
    c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
    // Wheels clicking over floor joints.
    const clickRate = rand(c.rng, 7, 14);
    for (let k = 0; k * (1 / clickRate) < dur; k++) {
      material(
        { ...c, at: at + k / clickRate, gain: c.gain * 0.15 },
        'plastic', 0.4, -0.8 * dir + (1.6 * dir * (k / clickRate)) / dur,
      );
    }
  },

  monitorBeep: (c) => {
    modalHit(c, [{ freq: rand(c.rng, 980, 1160), decayS: 0.1, amp: 0.6 }], { pan: rand(c.rng, -0.4, 0.4) });
  },
  weightClank: (c) => {
    const pan = rand(c.rng, -0.7, 0.7);
    material(c, 'metal', rand(c.rng, 0.7, 1), pan);
    if (c.rng() < 0.6) material({ ...c, at: c.at + rand(c.rng, 0.05, 0.14), gain: c.gain * 0.6 }, 'metal', 0.5, pan);
  },
  impactWrench: (c) => {
    // Rattle-gun: a burst of very fast metallic hammer blows.
    const pan = rand(c.rng, -0.6, 0.6);
    const blows = randInt(c.rng, 8, 20);
    for (let i = 0; i < blows; i++) {
      material({ ...c, at: c.at + i * rand(c.rng, 0.022, 0.033), gain: c.gain * rand(c.rng, 0.5, 1) }, 'metal', 0.5, pan);
    }
  },
  compressor: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 3, 7);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(28, at);
    osc.frequency.linearRampToValueAtTime(52, at + 0.6);
    osc.frequency.setValueAtTime(52, at + dur - 0.5);
    osc.frequency.linearRampToValueAtTime(26, at + dur);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 700;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.4), at + 0.4);
    env.gain.setValueAtTime(c.gain * 0.4, at + dur - 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.1;
    c.track(osc, done); c.track(flt, done); c.track(env, done);
  },
  hairDryer: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 3, 8);
    const src = ctx.createBufferSource();
    src.buffer = c.noise.get('pink');
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = rand(c.rng, 1400, 2400); flt.Q.value = 0.8;
    const panner = ctx.createStereoPanner();
    panner.pan.value = rand(c.rng, -0.5, 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.45), at + 0.25);
    env.gain.setValueAtTime(c.gain * 0.45, at + dur - 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    src.start(at, c.rng() * 4); src.stop(at + dur + 0.05);
    const done = at + dur + 0.1;
    c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
  },

  bird: (c) => {
    const { ctx } = c;
    const notes = randInt(c.rng, 2, 5);
    const baseHz = rand(c.rng, 2200, 4800);
    const pan = rand(c.rng, -0.9, 0.9);
    const rising = c.rng() < 0.5;
    for (let k = 0; k < notes; k++) {
      const at = c.at + k * rand(c.rng, 0.12, 0.3);
      const dur = rand(c.rng, 0.05, 0.16);
      const f0 = baseHz * rand(c.rng, 0.92, 1.08);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(rising ? f0 * 1.7 : f0 * 0.62, at + dur);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + dur * 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(panner); panner.connect(env); env.connect(c.dest); env.connect(c.send);
      osc.start(at); osc.stop(at + dur + 0.02);
      const done = at + dur + 0.05;
      c.track(osc, done); c.track(panner, done); c.track(env, done);
    }
  },
  windGust: (c) => {
    noiseBurst(c, {
      durationMs: rand(c.rng, 2200, 5200), filterType: 'lowpass', freq: rand(c.rng, 700, 1600),
      q: 0.6, gain: c.gain * 0.6, pan: rand(c.rng, -0.5, 0.5), attackMs: 700, color: 'pink',
    });
  },
  rainDrip: (c) => {
    // A drip is a pitch-glide: the cavity shrinks as the drop merges.
    const { ctx, at } = c;
    const dur = rand(c.rng, 0.03, 0.09);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = rand(c.rng, 900, 2200);
    osc.frequency.setValueAtTime(f, at);
    osc.frequency.exponentialRampToValueAtTime(f * 1.6, at + dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = rand(c.rng, -0.8, 0.8);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(panner); panner.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.05;
    c.track(osc, done); c.track(panner, done); c.track(env, done);
  },

  creak: (c) => {
    noiseBurst(c, {
      durationMs: rand(c.rng, 120, 400), filterType: 'bandpass', freq: rand(c.rng, 380, 900),
      q: 5, gain: c.gain * 0.5, pan: rand(c.rng, -0.6, 0.6), attackMs: 30,
    });
  },
  pageTurn: (c) => {
    const pan = rand(c.rng, -0.4, 0.4);
    for (let i = 0; i < randInt(c.rng, 4, 9); i++) {
      noiseBurst({ ...c, at: c.at + c.rng() * 0.28 }, {
        durationMs: rand(c.rng, 8, 40), filterType: 'bandpass', freq: rand(c.rng, 2200, 6000),
        q: 1.2, gain: c.gain * rand(c.rng, 0.3, 0.9), pan, attackMs: 1.5,
      });
    }
  },
  applause: (c) => {
    // Many independent claps, dense at the start and thinning out.
    const dur = rand(c.rng, 3.5, 7);
    const claps = Math.floor(dur * rand(c.rng, 40, 90));
    for (let i = 0; i < claps; i++) {
      const t = Math.pow(c.rng(), 0.7) * dur;
      noiseBurst({ ...c, at: c.at + t }, {
        durationMs: rand(c.rng, 6, 18),
        filterType: 'bandpass',
        freq: rand(c.rng, 900, 2600),
        q: 0.9,
        gain: c.gain * rand(c.rng, 0.1, 0.45) * (1 - t / (dur * 1.4)),
        pan: rand(c.rng, -0.95, 0.95),
        attackMs: 0.5,
      });
    }
  },
};

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export interface AmbienceEngineOptions {
  /** 0..1 user volume. */
  volume: number;
  /** 0..1 user intensity, before the recipe's bias. */
  intensity: number;
  /** Called when at least one bundled stem is playing. */
  onStemsReady?: (loaded: number, total: number) => void;
}

interface ScheduledEvent {
  spec: EventSpec;
  nextAt: number;
}

export class AmbienceEngine {
  private ctx: AudioContext;
  private scene: ResolvedAmbience;
  private rng: Rng;
  private noise: NoisePool;

  // Persistent output chain: [buses] -> userGain -> limiter -> duckGain -> dest
  private userGain: GainNode;
  private limiter: DynamicsCompressorNode;
  private duckGain: GainNode;

  // Per-scene nodes.
  private eventNear!: GainNode;
  private eventMid!: GainNode;
  private eventMidFilter!: BiquadFilterNode;
  private eventFar!: GainNode;
  private eventFarFilter!: BiquadFilterNode;
  private stemBus!: GainNode;
  private stemHighpass!: BiquadFilterNode;
  private convolver!: ConvolverNode;
  private reverbReturn!: GainNode;
  private nearSend!: GainNode;
  private midSend!: GainNode;
  private farSend!: GainNode;

  private liveNodes = new Set<AudioNode>();
  private stemSources: AudioBufferSourceNode[] = [];
  private schedule: ScheduledEvent[] = [];
  private schedulerTimer: number | null = null;
  private cleanupTimer: number | null = null;
  private pendingCleanup: Array<{ node: AudioNode; at: number }> = [];
  private running = false;
  /**
   * Set once by `stop()`. This used to be a `generation` counter compared against a
   * value captured at the top of `loadStems()` — but the constructor starts the load
   * (capturing 0) and the caller calls `start()` synchronously in the same tick, which
   * bumped the counter to 1 before any fetch could resolve. The comparison was
   * therefore ALWAYS unequal and every stem was dropped: the bed never played in any
   * scene, and all a learner heard was the synthesised one-shots over silence.
   *
   * An engine is built per scene (AudioPlayer calls stopAmbience() first), so there is
   * no second generation to invalidate. A one-way disposed flag is both correct and
   * impossible to get out of step.
   */
  private disposed = false;

  private duckAmount = DEFAULT_AMBIENCE_DUCKING;
  private intensity: number;
  /** Event gain scale derived from this scene's bed level. */
  private eventScale: number;
  /** Makeup applied to the stem bus, including the quiet-scene lift. */
  private bedGain: number;

  constructor(ctx: AudioContext, destination: AudioNode, scene: ResolvedAmbience, seedSalt: string, opts: AmbienceEngineOptions) {
    this.ctx = ctx;
    this.scene = scene;
    this.intensity = opts.intensity;
    const rawBed = bedLevel(scene.recipe);
    const boost = Math.min(MAX_BED_BOOST, Math.max(1, rawBed > 0 ? BED_FLOOR / rawBed : 1));
    this.bedGain = STEM_MAKEUP * boost;
    // Boosted alongside the bed, so the event-over-bed ratio is scene-independent.
    this.eventScale = rawBed * boost * EVENT_OVER_BED;

    // Scene identity seeds the character; the salt reseeds per playback so the same
    // scenario never sounds identical twice.
    this.rng = mulberry32(hashStringToSeed(`${scene.id}|${seedSalt}`));
    this.noise = new NoisePool(ctx, mulberry32(hashStringToSeed(`noise|${seedSalt}`)));

    this.userGain = ctx.createGain();
    this.userGain.gain.value = 0.0001;

    // A safety limiter, not a program compressor. The old settings (-6 dB, 20:1,
    // 250 ms release) with events driven 42x meant every clink gain-rode the whole
    // bed — audible pumping that flattened the texture further.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-3, ctx.currentTime);
    this.limiter.knee.setValueAtTime(3, ctx.currentTime);
    this.limiter.ratio.setValueAtTime(8, ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.004, ctx.currentTime);
    this.limiter.release.setValueAtTime(0.09, ctx.currentTime);

    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;

    this.userGain.connect(this.limiter);
    this.limiter.connect(this.duckGain);
    this.duckGain.connect(destination);

    this.buildSceneGraph();
    this.setVolume(opts.volume);
    void this.loadStems(opts.onStemsReady);
  }

  // -------------------------------------------------------------------------
  private buildSceneGraph() {
    const { ctx } = this;
    const recipe = this.scene.recipe;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createRoomImpulse(ctx, recipe.room.size, this.rng);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = recipe.room.wet * REVERB_RETURN;
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.userGain);

    // Near events: mostly dry, panned wide, but never BONE dry. `wet` is already
    // applied once at the return, so the sends below are pure distance ratios. A
    // perfectly dry clink inside a room is physically impossible, and it is the
    // single strongest cue that an event is pasted on top rather than happening in
    // the same place as the bed.
    this.eventNear = ctx.createGain();
    this.eventNear.gain.value = 1;
    this.eventNear.connect(this.userGain);
    this.nearSend = ctx.createGain();
    this.nearSend.gain.value = 0.5;
    this.nearSend.connect(this.convolver);

    // Mid events: a real distance rather than a volume trim. This used to be a bare
    // 0.7 gain multiplier in fire() with no filtering and no extra send — and two
    // thirds of all event specs are `mid`, so the depth system was mostly bypassed.
    this.eventMidFilter = ctx.createBiquadFilter();
    this.eventMidFilter.type = 'lowpass';
    this.eventMidFilter.frequency.value = recipe.room.size === 'outdoor' ? 6500 : 5000;
    this.eventMid = ctx.createGain();
    this.eventMid.gain.value = 0.62;
    this.eventMidFilter.connect(this.eventMid);
    this.eventMid.connect(this.userGain);
    this.midSend = ctx.createGain();
    this.midSend.gain.value = 0.95;
    this.midSend.connect(this.convolver);

    // Far events: lowpassed (air absorption) and mostly reverb. This near/far split
    // is what produces depth; previously every event sat at the same distance, which
    // is a large part of why the mix felt flat and "in your head".
    this.eventFarFilter = ctx.createBiquadFilter();
    this.eventFarFilter.type = 'lowpass';
    this.eventFarFilter.frequency.value = recipe.room.size === 'outdoor' ? 2600 : 1900;
    this.eventFar = ctx.createGain();
    this.eventFar.gain.value = 0.5;
    this.eventFarFilter.connect(this.eventFar);
    this.eventFar.connect(this.userGain);
    this.farSend = ctx.createGain();
    this.farSend.gain.value = 0.75;
    this.farSend.connect(this.convolver);

    // Stems: high-passed to free the headroom the old beds wasted below 80 Hz.
    this.stemHighpass = ctx.createBiquadFilter();
    this.stemHighpass.type = 'highpass';
    this.stemHighpass.frequency.value = BED_HIGHPASS_HZ;
    this.stemHighpass.Q.value = 0.7;
    this.stemBus = ctx.createGain();
    this.stemBus.gain.value = this.bedGain;
    this.stemHighpass.connect(this.stemBus);
    this.stemBus.connect(this.userGain);

    // Event schedule, with the first occurrence spread out so a scene doesn't open
    // with everything firing at once.
    const effIntensity = clamp01(this.intensity + (recipe.intensityBias ?? 0));
    const now = ctx.currentTime;
    this.schedule = recipe.events.map((spec) => ({
      spec,
      nextAt: now + rand(this.rng, 0.4, Math.max(1.2, spec.everyS)),
    }));
    this.intensity = effIntensity;
  }

  private async loadStems(onReady?: (loaded: number, total: number) => void) {
    const recipe = this.scene.recipe;
    const layers = recipe.stems;
    let loaded = 0;

    await Promise.all(layers.map(async (layer) => {
      const buffer = await loadStem(this.ctx, layer.stem);
      // Deliberately NOT gated on `running`: loading begins in the constructor, before
      // the caller has had a chance to call start(). Only disposal cancels it.
      if (this.disposed) return;
      if (!buffer) return;
      try {
        this.attachStem(layer.stem, layer, buffer);
        loaded++;
        onReady?.(loaded, layers.length);
      } catch (err) {
        console.warn(`[Ambience] Could not attach stem "${layer.stem}".`, err);
      }
    }));
  }

  private attachStem(id: StemId, layer: SceneRecipe['stems'][number], buffer: AudioBuffer) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    let node: AudioNode = src;

    if (layer.highpass) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = layer.highpass;
      node.connect(hp); node = hp;
      this.liveNodes.add(hp);
    }
    if (layer.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = layer.lowpass;
      lp.Q.value = 0.7;
      node.connect(lp); node = lp;
      this.liveNodes.add(lp);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(layer.gain, ctx.currentTime + 2);
    node.connect(gain);
    this.liveNodes.add(gain);

    // Stereo width.
    //
    // The two branches used to be one, gated on `buffer.numberOfChannels === 1` — and
    // every stem that declares a `width` is stereo except `kitchen`. So the widening
    // was dead code for the stems that asked for it, while `kitchen` (mono) got 2.5
    // summed copies of itself, roughly +7 dB that `bedLevel()` does not model, which
    // skewed the event-to-bed ratio of exactly the two busiest scenes.
    const width = layer.width ?? 0;
    if (width > 0 && buffer.numberOfChannels === 1) {
      const splitL = ctx.createDelay(0.05);
      const splitR = ctx.createDelay(0.05);
      splitL.delayTime.value = 0.007 + this.rng() * 0.004;
      splitR.delayTime.value = 0.013 + this.rng() * 0.005;
      const panL = ctx.createStereoPanner();
      const panR = ctx.createStereoPanner();
      panL.pan.value = -width;
      panR.pan.value = width;
      // Level compensation: three decorrelated copies sum in power, so without this
      // the layer arrives ~3.5 dB above the gain the recipe asked for.
      const comp = ctx.createGain();
      comp.gain.value = 1 / Math.sqrt(1 + 1 + 0.5 * 0.5);
      gain.connect(comp);
      comp.connect(splitL); splitL.connect(panL); panL.connect(this.stemHighpass);
      comp.connect(splitR); splitR.connect(panR); panR.connect(this.stemHighpass);
      // Keep some centre so the widening doesn't hollow out the middle.
      const centre = ctx.createGain();
      centre.gain.value = 0.5;
      comp.connect(centre); centre.connect(this.stemHighpass);
      [comp, splitL, splitR, panL, panR, centre].forEach((n) => this.liveNodes.add(n));
    } else if (width > 0 && buffer.numberOfChannels > 1) {
      // Stereo stems: mid/side, so `width` narrows rather than doing nothing.
      //
      // The baked babble stems measure an L/R correlation of 0.05-0.19 — effectively
      // fully decorrelated, which the ear reads as diffuse and "inside your head"
      // rather than as a room in front of you. Real crowd recordings sit around
      // 0.35-0.6. Scaling the side signal pulls the correlation back into that range
      // without rebaking a single byte.
      const merger = ctx.createChannelMerger(2);
      const splitter = ctx.createChannelSplitter(2);
      const side = ctx.createGain();
      const sideInvert = ctx.createGain();
      side.gain.value = width * STEREO_SIDE_SCALE;
      sideInvert.gain.value = -width * STEREO_SIDE_SCALE;
      const midL = ctx.createGain();
      const midR = ctx.createGain();
      midL.gain.value = 0.5;
      midR.gain.value = 0.5;

      gain.connect(splitter);
      // M = (L+R)/2 to both outputs; S = (L-R)/2 added to L, subtracted from R.
      splitter.connect(midL, 0); splitter.connect(midL, 1);
      splitter.connect(midR, 0); splitter.connect(midR, 1);
      midL.connect(merger, 0, 0);
      midR.connect(merger, 0, 1);

      const sideSrcL = ctx.createGain(); sideSrcL.gain.value = 0.5;
      const sideSrcR = ctx.createGain(); sideSrcR.gain.value = -0.5;
      splitter.connect(sideSrcL, 0);
      splitter.connect(sideSrcR, 1);
      sideSrcL.connect(side); sideSrcR.connect(side);
      sideSrcL.connect(sideInvert); sideSrcR.connect(sideInvert);
      side.connect(merger, 0, 0);
      sideInvert.connect(merger, 0, 1);

      merger.connect(this.stemHighpass);
      [splitter, merger, side, sideInvert, midL, midR, sideSrcL, sideSrcR]
        .forEach((n) => this.liveNodes.add(n));
    } else {
      gain.connect(this.stemHighpass);
    }

    // Send the stem to the room too, so bed and events share an acoustic.
    //
    // This used to be `room.wet * 0.5` feeding a return already scaled by `room.wet`,
    // so `wet` was applied twice and the bed came back at wet^2 * 0.45 — 0.0115, or
    // -39 dB, in a cafe. The bed was bone dry while the events got 2-9x more room, the
    // exact opposite of "bed and events share an acoustic". The sends are now pure
    // distance ratios; `wet` is applied once, at the return.
    const send = ctx.createGain();
    send.gain.value = BED_REVERB_SEND;
    gain.connect(send);
    send.connect(this.convolver);
    this.liveNodes.add(send);

    // Random entry point so repeated plays of the same scene don't line up, and so
    // stems of different lengths never phase-lock into an audible super-loop.
    src.start(ctx.currentTime, this.rng() * buffer.duration);
    this.liveNodes.add(src);
    this.stemSources.push(src);
  }

  // -------------------------------------------------------------------------
  private trackNode = (node: AudioNode, stopAt: number) => {
    this.liveNodes.add(node);
    // Release when the event is over. The old engine pushed every node of every
    // event into an append-only array for the whole lesson and never removed any.
    this.pendingCleanup.push({ node, at: stopAt });
  };

  private collect() {
    const now = this.ctx.currentTime;
    let write = 0;
    for (let i = 0; i < this.pendingCleanup.length; i++) {
      const entry = this.pendingCleanup[i];
      if (entry.at <= now) {
        try { entry.node.disconnect(); } catch { /* already gone */ }
        this.liveNodes.delete(entry.node);
      } else {
        this.pendingCleanup[write++] = entry;
      }
    }
    this.pendingCleanup.length = write;
  }

  private runScheduler = () => {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD_S;
    const recipe = this.scene.recipe;

    for (const entry of this.schedule) {
      let guard = 0;
      while (entry.nextAt < horizon && guard++ < 24) {
        const at = Math.max(entry.nextAt, now + 0.02);
        this.fire(entry.spec, at);

        // Bursts: real events clump. A run of steps, two cups, a knot of cars.
        if (entry.spec.burst && this.rng() < entry.spec.burst) {
          const extra = randInt(this.rng, 1, 3);
          for (let i = 1; i <= extra; i++) {
            this.fire(entry.spec, at + i * rand(this.rng, 0.12, 0.7));
          }
        }

        // Higher intensity means more often, not just louder.
        const scale = 1.6 - this.intensity;
        entry.nextAt = at + poissonInterval(this.rng, entry.spec.everyS * scale);
      }
    }

    this.collect();
    this.schedulerTimer = window.setTimeout(this.runScheduler, SCHEDULER_INTERVAL_MS);
  };

  private fire(spec: EventSpec, at: number) {
    const synth = EVENT_SYNTHS[spec.kind];
    if (!synth) return;
    const far = spec.distance === 'far';
    const mid = spec.distance === 'mid';
    // Distance is now carried by the bus (filtering + reverb send), not by a gain trim.
    const dest = far ? this.eventFarFilter : mid ? this.eventMidFilter : this.eventNear;
    const send = far ? this.farSend : mid ? this.midSend : this.nearSend;
    try {
      synth(
        {
          ctx: this.ctx,
          rng: this.rng,
          noise: this.noise,
          dest,
          send,
          at,
          intensity: this.intensity,
          gain: spec.gain * this.eventScale * (0.55 + this.intensity * 0.75),
          track: this.trackNode,
        },
        this.scene.recipe,
      );
    } catch (err) {
      console.warn(`[Ambience] Event "${spec.kind}" failed.`, err);
    }
  }

  // -------------------------------------------------------------------------
  start(volume: number) {
    if (this.running || this.disposed) return;
    this.running = true;
    this.setVolume(volume, 2.5);
    this.runScheduler();
    this.cleanupTimer = window.setInterval(() => this.collect(), 2000);
  }

  setVolume(volume: number, rampS = 0.15) {
    const now = this.ctx.currentTime;
    const target = Math.max(0.0001, volume);
    this.userGain.gain.cancelScheduledValues(now);
    this.userGain.gain.setValueAtTime(Math.max(0.0001, this.userGain.gain.value), now);
    this.userGain.gain.linearRampToValueAtTime(target, now + rampS);
  }

  setDucking(amount: number) {
    this.duckAmount = clamp01(amount + (this.scene.recipe.duckingBias ?? 0));
  }

  /**
   * Apply a speech level (0..1) to the ducking node.
   *
   * Asymmetric on purpose: attack fast enough to clear a syllable, release slow
   * enough that the bed doesn't surge back between words. The old ducker used the
   * same 50 ms constant both ways and pumped audibly.
   */
  applySpeechLevel(level: number) {
    const duck = this.duckAmount * clamp01(level);
    const target = Math.max(0, 1 - DUCK_DEPTH * duck);
    const current = this.duckGain.gain.value;
    const constant = target < current ? DUCK_ATTACK_S : DUCK_RELEASE_S;
    this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, constant);
  }

  stop() {
    this.running = false;
    this.disposed = true;

    if (this.schedulerTimer !== null) { window.clearTimeout(this.schedulerTimer); this.schedulerTimer = null; }
    if (this.cleanupTimer !== null) { window.clearInterval(this.cleanupTimer); this.cleanupTimer = null; }

    const now = this.ctx.currentTime;
    try {
      this.userGain.gain.cancelScheduledValues(now);
      this.userGain.gain.setValueAtTime(Math.max(0.0001, this.userGain.gain.value), now);
      this.userGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    } catch { /* context may be closing */ }

    for (const src of this.stemSources) {
      try { src.stop(now + 0.35); } catch { /* already stopped */ }
    }
    this.stemSources = [];

    // Let the fade finish before tearing the graph down.
    window.setTimeout(() => {
      for (const node of this.liveNodes) {
        try {
          if (node instanceof AudioBufferSourceNode || node instanceof OscillatorNode) node.stop();
        } catch { /* already stopped */ }
        try { node.disconnect(); } catch { /* already gone */ }
      }
      this.liveNodes.clear();
      this.pendingCleanup.length = 0;
      try { this.convolver.disconnect(); } catch { /* noop */ }
      try { this.reverbReturn.disconnect(); } catch { /* noop */ }
      try { this.userGain.disconnect(); } catch { /* noop */ }
      try { this.limiter.disconnect(); } catch { /* noop */ }
      try { this.duckGain.disconnect(); } catch { /* noop */ }
    }, 400);
  }

  /** Diagnostics for the player's status line. */
  get sceneLabel(): string {
    return this.scene.recipe.label;
  }

  get liveNodeCount(): number {
    return this.liveNodes.size;
  }
}
