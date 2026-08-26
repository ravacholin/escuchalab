import {
  bedLevel,
  eventHeadroomDb,
  EventKind,
  EventSpec,
  ResolvedAmbience,
  RoomSize,
  SceneRecipe,
  SceneRoom,
  sceneOnsetCeiling,
  SceneTone,
  StemId,
  Surface,
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

/**
 * A single global trim pulling every discrete event DOWN, uniformly, relative to the
 * bed it sits over — applied at playback (see `fire()`), not baked into the scene's
 * declared design.
 *
 * The headrooms the recipes declare were authored so that the loudest one-shot in a
 * scene sits *above* its bed: a café at +6 dB, a restaurant at +3, a bar and a market
 * at +2. For a field recording that is right — a dropped fork is louder than the room.
 * But this ambience is meant to sit *under* a dialogue as a sense of place, and the ear
 * reading it as "a place" rather than as "a sound-effects reel" depends on the
 * continuous bed being the foreground and the discrete events being subordinate to it.
 * When the loudest thing you hear every few seconds is a pitched porcelain clink poking
 * over the bed, the whole mix collapses into "little bells over nothing" — which is
 * exactly the report this trim answers.
 *
 * It lives in the runtime `fire()` path rather than in `eventScaleFor` on purpose. The
 * offline renderer that drives `check:ambience:scenes` reads `eventScaleFor`, and that
 * check measures whether the scenes are *distinguishable by design* — a question about
 * the catalogue's diversity, which this presentation choice must not perturb. Because
 * the trim is one uniform offset, the relative contrast between scenes survives it in
 * playback too: the café's clinks stay louder than the library's, just all of them sit
 * further under their beds.
 */
export const EVENT_TRIM_DB = 8;
const EVENT_TRIM = Math.pow(10, -EVENT_TRIM_DB / 20);

/**
 * Turn a scene's declared event headroom into the scale its events are fired at.
 *
 * The old arithmetic multiplied bed gain and event scale by the same boost, which made
 * the event-over-bed ratio a scene-independent constant — the loudest spec of every
 * scene in the catalogue landed at exactly +6.0 dB. That is a defensible default and a
 * terrible law: a library is a quiet bed with loud discrete events, a market is a wall
 * of bed with events barely above it, and forcing both to +6 removes the contrast that
 * tells them apart. `eventHeadroomDb()` reproduces the old value where a recipe stays
 * silent, so the two coexist while the catalogue is annotated.
 */
export function eventScaleFor(recipe: SceneRecipe, bedAmp: number): number {
  const loudest = recipe.events.reduce((m, e) => Math.max(m, e.gain), 0);
  if (loudest <= 0) return bedAmp * EVENT_OVER_BED;
  const headroomDb = eventHeadroomDb(recipe, EVENT_OVER_BED / STEM_MAKEUP);
  // Invert `spec.gain * eventScale / (bedAmp * STEM_MAKEUP)` at the loudest spec.
  return (bedAmp * STEM_MAKEUP * Math.pow(10, headroomDb / 20)) / loudest;
}

const REVERB_RETURN = 0.9;

/** Reverb send for the bed. A pure distance ratio: `room.wet` is applied at the
 *  return, and applying it here too is what left the bed dry. */
export const BED_REVERB_SEND = 0.7;

/**
 * Playheads per stem. See attachStem: two offset heads at slightly different rates
 * stop a 14-24 s buffer from being heard as a loop over a three-minute lesson.
 */
export const PLAYHEADS_PER_STEM = 2;

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

/**
 * The floor is a compressor, not a clamp.
 *
 * `min(MAX_BED_BOOST, max(1, FLOOR / raw))` lifted every scene below the floor to
 * *exactly* the floor: measured, 12 scenes — the four studios, the therapy room, the
 * library, the courtroom, the gallery, the venue, the wine bar, the meeting room and
 * the home — arrived at an identical bed level and an identical event scale. The
 * 18 dB spread the recipes describe collapsed to 11.5 dB with a hard pile-up at the
 * bottom, so a radio booth and a library were the same loudness. Loudness is one of
 * the strongest cues for what kind of room you are in, and the device meant to keep
 * quiet scenes audible was destroying the ordering it existed to protect.
 *
 * A ratio lift is strictly monotonic: quiet scenes come up, and they stay in order.
 */
export const BED_KNEE_RATIO = 0.5;

export function bedBoost(rawBed: number): number {
  if (rawBed <= 0 || rawBed >= BED_FLOOR) return 1;
  return Math.min(MAX_BED_BOOST, Math.pow(BED_FLOOR / rawBed, BED_KNEE_RATIO));
}

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
const clampPan = (v: number) => Math.max(-1, Math.min(1, v));

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

/**
 * Nyquist of each baked stem, from the sample rate it was rendered at
 * (scripts/ambience/stems.mjs). A stem baked at 8 kHz carries nothing above 4 kHz no
 * matter how the browser resamples it.
 */
export const STEM_BANDWIDTH_HZ: Record<StemId, number> = {
  babble_close: 8000, babble_hall: 8000, babble_open: 8000,
  traffic_near: 8000, traffic_far: 4000,
  kitchen: 12000, hvac_office: 4000, room_tone: 4000, studio_tone: 4000,
  transit_hum: 6000, rain: 12000, wind_leaves: 12000,
  office_life: 6000, pa_concourse: 6000, tiled_corridor: 6000, home_life: 6000,
  booth_tight: 4000, workshop_tools: 6000, crowd_far: 4000, sports_hall: 6000,
};

/**
 * The top of the band this scene's bed actually occupies, used to keep the events
 * inside the same acoustic world. A little above the widest stem, not exactly at it:
 * clamping events hard to the bed's ceiling dulls transients that legitimately carry
 * their identity up there (cutlery, coins, keys).
 */
function sceneBandwidthHz(recipe: SceneRecipe): number {
  let widest = 4000;
  for (const layer of recipe.stems) {
    const stemTop = Math.min(STEM_BANDWIDTH_HZ[layer.stem], layer.lowpass ?? Infinity);
    widest = Math.max(widest, stemTop);
  }
  // A heavily damped room may not have events brighter than its own air.
  const ceiling = (recipe.room.brightnessHz ?? Infinity) * 1.8;
  return Math.min(14000, ceiling, widest * 1.5);
}

/**
 * Air ceilings for the mid and far event buses.
 *
 * These were `outdoor ? 6500 : 5000` and `outdoor ? 2600 : 1900` — a boolean, and 111
 * of 159 event specs (70%) passed through one of the two indoor values. So every
 * material's identity above 5 kHz was erased in exactly the same way in every indoor
 * scene in the catalogue: a coin in a bank and a fork in a restaurant became the same
 * tick. A room's brightness is a continuous property of its surfaces, and the default
 * here reproduces the old binary for any recipe that has not been given one.
 */
export const FAR_BRIGHTNESS_RATIO = 0.38;

export function busCutoffs(room: SceneRoom): { mid: number; far: number } {
  const mid = room.brightnessHz ?? (room.size === 'outdoor' ? 6500 : 5000);
  return { mid, far: mid * FAR_BRIGHTNESS_RATIO };
}

/**
 * Build the filter chain for a `SceneTone`, or null when there is nothing to do.
 *
 * `tiltDb` is realised as a complementary shelf pair rather than a real tilt filter:
 * the point is a broadband sense of "hard and bright" vs "soft and absorptive", and
 * two shelves get there for two nodes.
 */
function buildToneChain(
  ctx: AudioContext,
  tone: SceneTone | undefined,
  track: (node: AudioNode) => void,
): { input: AudioNode; output: AudioNode } | null {
  if (!tone) return null;
  const nodes: BiquadFilterNode[] = [];
  const add = (
    type: BiquadFilterType, hz: number, db: number, q?: number,
  ) => {
    if (db === 0) return;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.gain.value = db;
    if (q !== undefined) f.Q.value = q;
    nodes.push(f);
    track(f);
  };

  if (tone.tiltDb) {
    add('lowshelf', 500, -tone.tiltDb / 2);
    add('highshelf', 2500, tone.tiltDb / 2);
  }
  if (tone.lowShelf) add('lowshelf', tone.lowShelf.hz, tone.lowShelf.db);
  if (tone.highShelf) add('highshelf', tone.highShelf.hz, tone.highShelf.db);
  if (tone.peak) add('peaking', tone.peak.hz, tone.peak.db, tone.peak.q ?? 1.4);

  if (nodes.length === 0) return null;
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return { input: nodes[0], output: nodes[nodes.length - 1] };
}

/**
 * Rough makeup for a tone chain, so colouring a scene does not silently change how
 * loud its bed is or how far its events sit above it. A pink-weighted estimate: each
 * shelf/peak contributes its gain scaled by the fraction of a pink spectrum it covers.
 */
export function toneMakeupDb(tone: SceneTone | undefined): number {
  if (!tone) return 0;
  let db = 0;
  // A shelf at `hz` covers roughly this share of the audible power of a pink source.
  const shareBelow = (hz: number) => Math.min(1, Math.max(0, Math.log2(hz / 20) / Math.log2(16000 / 20)));
  if (tone.tiltDb) {
    db += (-tone.tiltDb / 2) * shareBelow(500);
    db += (tone.tiltDb / 2) * (1 - shareBelow(2500));
  }
  if (tone.lowShelf) db += tone.lowShelf.db * shareBelow(tone.lowShelf.hz);
  if (tone.highShelf) db += tone.highShelf.db * (1 - shareBelow(tone.highShelf.hz));
  // A peaking filter of Q ~1.4 covers about one octave.
  if (tone.peak) db += tone.peak.db * (1 / Math.log2(16000 / 20));
  return db;
}

/**
 * Ceiling on how often a scene may put a discrete sound in front of the listener,
 * counted in perceptual onsets per minute (a run of footsteps or a burst of typing is
 * one onset, not eight).
 *
 * The recipes were authored well past this. A restaurant scheduled ~60 onsets/minute
 * and a cafe ~42 — one distinct noise every one to one-and-a-half seconds, forever.
 * Even with each one now sitting properly inside the room, that rate alone reads as a
 * sound-effects reel rather than as a place; in a real cafe something specific catches
 * your attention every five or ten seconds, and the rest is bed.
 *
 * Enforced here rather than by rewriting ~200 numbers across 42 recipes, so that the
 * relative mix each recipe declares (mostly cups, some cutlery, the occasional door)
 * is preserved as authored while the total is capped, and so a new recipe cannot
 * reintroduce the problem.
 */
export const MAX_EVENT_ONSETS_PER_MIN = 26;

/**
 * Mean discrete hits each EventKind produces per scheduled occurrence.
 *
 * Several synths are clusters, and the spread is enormous: one `typing` occurrence is
 * 4-12 keys with a release click each, so 16 hits; one `footstep` is 2-5 steps; one
 * `luggage` rolls out up to 63 wheel clicks. Counting each occurrence as one event —
 * which is what a naive budget does — lets an office schedule 220 key clicks a minute
 * while nominally sitting at 19 "events".
 *
 * scripts/check-ambience.mjs asserts every EventKind appears here, on the same
 * principle as EVENT_SYNTHS: an unlisted kind would silently weigh nothing.
 */
export const EVENT_CLUSTER_SIZE: Record<EventKind, number> = {
  porcelain: 1.45, cutlery: 2, glass: 1, coin: 2.5, metalClank: 1, woodKnock: 1, plasticTap: 1,
  footstep: 3.5, footstepRun: 7.5, chairScrape: 1, cough: 1.5, laugh: 4.5,
  doorLatch: 2, doorChime: 3, registerBeep: 1, cashDrawer: 5.5,
  typing: 16, paperRustle: 1, printer: 1, phoneRing: 16,
  vehiclePass: 1, honk: 1, siren: 1,
  sizzle: 1, steam: 1, grinder: 1,
  announcement: 1, luggage: 1,
  monitorBeep: 1, weightClank: 1.6, impactWrench: 1, compressor: 1, hairDryer: 1,
  bird: 3.5, windGust: 1, rainDrip: 1,
  creak: 1, pageTurn: 1, applause: 1,
};

/**
 * Attention cost of a scene's event schedule, per minute.
 *
 * Cluster size counts as its square root, not linearly: eight keystrokes in a row are
 * more than one event and much less than eight, because after the first couple the ear
 * fuses them into a texture. The units are therefore "onsets" only loosely — what
 * matters is that the number is comparable across scenes and bounded.
 */
export const onsetsPerMinute = (recipe: SceneRecipe, intensity: number): number => {
  const intervalScale = 1.6 - intensity;
  let total = 0;
  for (const spec of recipe.events) {
    // A burst spawns randInt(1, 2) extras, so mean 1.5, with probability `burst`.
    const perOccurrence = 1 + (spec.burst ?? 0) * 1.5;
    const cluster = Math.sqrt(EVENT_CLUSTER_SIZE[spec.kind] ?? 1);
    total += (60 / (spec.everyS * intervalScale)) * perOccurrence * cluster;
  }
  return total;
};

/**
 * The scene's onset budget at a given intensity.
 *
 * At the default intensity (0.6) the multiplier is exactly 1, so a recipe that does
 * not declare an `activity` keeps the old global ceiling and behaves as before.
 */
export function sceneOnsetBudget(recipe: SceneRecipe, intensity: number): number {
  return sceneOnsetCeiling(recipe) * (0.55 + 0.75 * intensity);
}

/**
 * Above the budget the scene is compressed, not clamped.
 *
 * The old rule pinned every over-budget scene to *exactly* the ceiling, which had two
 * consequences. The obvious one: 26 of 42 scenes fired at 26.00 onsets/min, so a
 * bustling market and a quiet plaza were equally eventful. The subtle one: because
 * `onsetsPerMinute` is proportional to 1/(1.6 - i) and the scheduler interval is
 * multiplied by (1.6 - i), a hard clamp makes the two cancel exactly — moving the
 * intensity slider changed event *loudness* and never event *rate*, in 26 of 42
 * scenes. No amount of retuning fixes that; only a soft knee does, because a scene
 * that always exactly fills a fixed budget cannot respond to anything.
 */
export const ONSET_SOFT_KNEE = 0.65;
export const ABSOLUTE_MAX_ONSETS_PER_MIN = 62;

/**
 * The intensity at which the budget is evaluated — always, whatever the user's slider
 * says.
 *
 * This is the whole fix for the cancellation. `onsetsPerMinute` is proportional to
 * 1/(1.6 - i) and the scheduler interval is multiplied by (1.6 - i); if the rate scale
 * is computed at the live intensity, those two divide out and the slider stops moving
 * density altogether. Pinning the evaluation makes `rateScale` a per-scene constant,
 * so the (1.6 - i) in the interval is the only place intensity acts — and it acts.
 *
 * The recipe's own bias is still folded in, because that is a property of the scene
 * rather than of the slider.
 */
export const RATE_REFERENCE_INTENSITY = 0.6;

/**
 * How far past its own budget a scene may be carried by having been authored busy.
 *
 * Without this bound the knee inverts the classes: `newsroom`, `call_center`,
 * `open_office` and `restaurant` are authored at 125-220 onsets/min, and a plain
 * exponent let all four land *above* the market — a call centre busier than a market
 * is not a nuance, it is the ordering being decided by how liberally someone typed
 * `everyS` rather than by what the place is.
 */
export const ONSET_KNEE_MAX = 1.15;

/** Factor to stretch every `everyS` by so the scene fits under the budget. 1 = as authored. */
export function eventRateScale(recipe: SceneRecipe, _intensity?: number): number {
  const reference = clamp01(RATE_REFERENCE_INTENSITY + (recipe.intensityBias ?? 0));
  const rate = onsetsPerMinute(recipe, reference);
  const budget = sceneOnsetBudget(recipe, reference);
  if (rate <= budget) return 1;
  // The knee keeps a scene authored well over budget slightly busier than one authored
  // just over it, so a class is a band rather than a single value — but only slightly.
  const allowed = Math.min(
    budget * Math.min(ONSET_KNEE_MAX, Math.pow(rate / budget, 1 - ONSET_SOFT_KNEE)),
    ABSOLUTE_MAX_ONSETS_PER_MIN,
  );
  return Math.max(1, rate / allowed);
}

function createRoomImpulse(ctx: AudioContext, room: SceneRoom, rng: Rng): AudioBuffer {
  const preset = ROOM_PARAMS[room.size];
  // Two `large` rooms are not equally live, and two `small` ones are not equally
  // absorptive. The size preset sets the scale; the recipe adjusts it.
  const params = {
    ...preset,
    rt60: preset.rt60 * (room.rt60Scale ?? 1),
    damping: room.damping ?? preset.damping,
  };
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
  opts: {
    pan: number;
    noiseAmount?: number;
    noiseHz?: number;
    /** Broadband body of the strike: level, centre frequency and length in ms. */
    bodyAmount?: number;
    bodyHz?: number;
    bodyMs?: number;
  } = { pan: 0 },
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

  // The body of the strike: a short band of noise around the object's own resonance.
  //
  // A 5 ms click plus decaying sines is a mallet instrument — the click is the beater
  // and the sines are the bar. Real crockery, wood and metal put most of their energy
  // into a brief NOISY resonance, because a struck object rings in hundreds of closely
  // spaced, quickly-damped modes rather than four clean ones. This layer is what makes
  // a cup read as a cup instead of a glockenspiel note.
  if (opts.bodyAmount) {
    noiseBurst(c, {
      durationMs: opts.bodyMs ?? 35,
      filterType: 'bandpass',
      freq: opts.bodyHz ?? 1200,
      q: 1.1,
      gain: c.gain * opts.bodyAmount,
      pan: opts.pan,
      attackMs: 0.6,
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

/**
 * A short voiced sound: a pitched source through two vowel formants.
 *
 * `laugh`, `cough` and `announcement` were all band-passed noise with a speech-like
 * rhythm and no pitch at all. Rhythm alone does not read as a person — a listener
 * hears rhythmic hiss, which is a good part of why the events sounded like "little
 * noises" rather than like a place with people in it. A sawtooth is a crude stand-in
 * for a glottal pulse train, but it is harmonically rich in the same way, and putting
 * it through formants is what makes the ear commit to "voice".
 *
 * (The offline baker has a much better source-filter model in scripts/ambience/
 * voice.mjs. It cannot be used here: this builds Web Audio graphs in real time,
 * that one fills sample buffers.)
 */
function voicedBurst(
  c: EventContext,
  opts: {
    f0: number;
    f0End?: number;
    durationMs: number;
    formants: [number, number];
    gain: number;
    pan: number;
    breath?: number;
    attackMs?: number;
  },
) {
  const { ctx, at } = c;
  const dur = opts.durationMs / 1000;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(opts.f0, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f0End ?? opts.f0 * 0.85), at + dur);

  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = opts.formants[0];
  f1.Q.value = 3.2;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'peaking';
  f2.frequency.value = opts.formants[1];
  f2.Q.value = 2.4;
  f2.gain.value = 9;
  // Lips radiate, which tilts the spectrum up; without it a sawtooth reads as a buzz.
  const tilt = ctx.createBiquadFilter();
  tilt.type = 'highshelf';
  tilt.frequency.value = 1200;
  tilt.gain.value = 4;

  const panner = ctx.createStereoPanner();
  panner.pan.value = opts.pan;

  const env = ctx.createGain();
  const attack = Math.min(dur * 0.4, (opts.attackMs ?? 6) / 1000);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  osc.connect(f1); f1.connect(f2); f2.connect(tilt); tilt.connect(panner);
  panner.connect(env);
  env.connect(c.dest); env.connect(c.send);

  osc.start(at); osc.stop(at + dur + 0.02);
  const done = at + dur + 0.06;
  [osc, f1, f2, tilt, panner, env].forEach((n) => c.track(n, done));

  // Aspiration riding along with the voicing.
  if (opts.breath) {
    noiseBurst({ ...c, at }, {
      durationMs: opts.durationMs,
      filterType: 'bandpass',
      freq: opts.formants[1],
      q: 1.2,
      gain: opts.gain * opts.breath,
      pan: opts.pan,
      attackMs: opts.attackMs ?? 6,
      color: 'pink',
    });
  }
}

/** Material definitions mirroring scripts/ambience/events.mjs, so a baked kitchen
 *  and a live cup sound like the same world. */
/**
 * Struck-object recipes.
 *
 * `baseDecay` used to be 3-5x longer across the board: glass rang for 0.5-0.95 s and
 * porcelain for 0.28-0.5 s, as pure inharmonic sines with a 1.5 ms attack. That is a
 * description of a vibraphone, not of crockery — and a bar fired one every 1.6 s. A
 * cup meeting a saucer is a ~100 ms mostly-noisy tick with a faint ring after it.
 *
 * `body` is the new broadband layer (see modalHit); `noise` is the contact click.
 * Between them they now carry more of each hit than the sine partials do, which is
 * the right way round for every one of these materials.
 */
const MATERIALS: Record<string, {
  base: [number, number]; ratios: number[]; decays: number[]; baseDecay: [number, number];
  noise: number; noiseHz: number; body: number; bodyHz: number; bodyMs: number;
}> = {
  porcelain: { base: [1400, 2600], ratios: [1, 2.13, 3.41, 5.02], decays: [1, 0.42, 0.19, 0.08], baseDecay: [0.09, 0.18], noise: 0.6, noiseHz: 4200, body: 0.7, bodyHz: 2000, bodyMs: 28 },
  glass:     { base: [2100, 3800], ratios: [1, 2.76, 4.19, 6.83], decays: [1, 0.55, 0.3, 0.14], baseDecay: [0.18, 0.35], noise: 0.45, noiseHz: 5200, body: 0.55, bodyHz: 2600, bodyMs: 24 },
  cutlery:   { base: [2600, 4600], ratios: [1, 1.87, 3.05, 4.62], decays: [1, 0.7, 0.45, 0.25], baseDecay: [0.07, 0.15], noise: 0.85, noiseHz: 5600, body: 0.8, bodyHz: 3200, bodyMs: 20 },
  metal:     { base: [190, 420],   ratios: [1, 2.31, 3.12, 4.55], decays: [1, 0.72, 0.5, 0.3],  baseDecay: [0.3, 0.7],  noise: 0.9, noiseHz: 1800, body: 0.75, bodyHz: 900, bodyMs: 45 },
  coin:      { base: [3200, 5200], ratios: [1, 2.4, 3.9],         decays: [1, 0.5, 0.22],       baseDecay: [0.06, 0.14], noise: 0.75, noiseHz: 6000, body: 0.6, bodyHz: 3600, bodyMs: 16 },
  wood:      { base: [340, 720],   ratios: [1, 1.61, 2.44, 3.8],  decays: [1, 0.35, 0.16, 0.07], baseDecay: [0.05, 0.12], noise: 1, noiseHz: 1400, body: 0.95, bodyHz: 620, bodyMs: 30 },
  plastic:   { base: [900, 1900],  ratios: [1, 1.94, 3.2],        decays: [1, 0.3, 0.12],       baseDecay: [0.03, 0.07], noise: 0.95, noiseHz: 3000, body: 0.9, bodyHz: 1500, bodyMs: 18 },
};

/**
 * How much of a struck object's sound is its TUNED RING versus its noisy body.
 *
 * The "campanitas" report is, at bottom, this ratio being wrong. A cup, a coin, a fork
 * meeting a plate is overwhelmingly a brief broadband CLINK with only a faint pitched
 * tail; the decaying sine partials are the least of it. When those partials are as loud
 * and as long as the contact noise, a cup reads as a glockenspiel note — a little bell.
 *
 * So the pitched partials are pulled well below the noisy contact/body (RING_LEVEL) and
 * their tail is shortened (RING_DECAY_SCALE), while the broadband body that actually
 * carries the object's identity is brought up a touch (BODY_BOOST). The result is a
 * clink or a tick with a hint of material, not a tuned chime.
 *
 * This is a runtime-timbre change: it is not seen by the offline renderer (which drives
 * scene-distance) or by the graph-shape runtime check, so it can be judged only by ear.
 */
const RING_LEVEL = 0.45;
const RING_DECAY_SCALE = 0.55;
const BODY_BOOST = 1.2;

function material(c: EventContext, name: keyof typeof MATERIALS, strength: number, pan: number) {
  const m = MATERIALS[name];
  const base = rand(c.rng, m.base[0], m.base[1]);
  const baseDecay = rand(c.rng, m.baseDecay[0], m.baseDecay[1]);
  modalHit(
    c,
    m.ratios.map((ratio, i) => ({
      freq: base * ratio * (1 + (c.rng() - 0.5) * 0.024),
      decayS: baseDecay * m.decays[i] * RING_DECAY_SCALE,
      amp: (strength / (1 + i * 0.9)) * RING_LEVEL,
    })),
    {
      pan,
      noiseAmount: m.noise * strength,
      noiseHz: m.noiseHz,
      bodyAmount: m.body * strength * BODY_BOOST,
      bodyHz: m.bodyHz * rand(c.rng, 0.85, 1.18),
      bodyMs: m.bodyMs * rand(c.rng, 0.8, 1.3),
    },
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

/** Fallback when a recipe does not name its floor. Deriving the surface from room
 *  size alone gave every `large` scene concrete — a workshop, a gym, a library, a bank
 *  and a police station walked on the same floor because they shared a reverb preset. */
function surfaceForRoom(size: RoomSize): Surface {
  switch (size) {
    case 'outdoor': return 'asphalt';
    case 'hall': return 'tile';
    case 'large': return 'concrete';
    case 'medium': return 'wood';
    default: return 'carpet';
  }
}

/** Which floor this scene has. Hearing heels on tile in a carpeted therapy room, or
 *  a soft pad on a station concourse, is immediately wrong. */
function surfaceFor(recipe: SceneRecipe): Surface {
  return recipe.room.surface ?? surfaceForRoom(recipe.room.size);
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
      material(
        { ...c, at: c.at + i * rand(c.rng, 0.04, 0.13) },
        'cutlery', rand(c.rng, 0.4, 1), clampPan(pan + rand(c.rng, -0.1, 0.1)),
      );
    }
  },
  glass: (c) => material(c, 'glass', rand(c.rng, 0.4, 1), rand(c.rng, -0.7, 0.7)),
  /**
   * A dropped coin ACCELERATES: each bounce is closer to the last and quieter, until
   * it spins down flat. Rendered as evenly spaced hits it was the same event as
   * `cutlery`, whose frequency range it overlaps almost entirely.
   */
  coin: (c) => {
    const pan = rand(c.rng, -0.4, 0.4);
    const bounces = randInt(c.rng, 3, 7);
    let gap = rand(c.rng, 0.075, 0.13);
    let t = c.at;
    let level = rand(c.rng, 0.6, 0.9);
    for (let i = 0; i < bounces; i++) {
      material({ ...c, at: t }, 'coin', level, pan);
      t += gap;
      gap *= rand(c.rng, 0.62, 0.78);
      level *= rand(c.rng, 0.62, 0.8);
    }
    // The spin-down: a fast tremolo as it settles onto the flat.
    for (let i = 0; i < randInt(c.rng, 4, 9); i++) {
      material({ ...c, at: t + i * 0.022, gain: c.gain * 0.16 }, 'coin', 0.3, pan);
    }
  },
  metalClank: (c) => material(c, 'metal', rand(c.rng, 0.5, 1), rand(c.rng, -0.8, 0.8)),
  woodKnock: (c) => material(c, 'wood', rand(c.rng, 0.5, 1), rand(c.rng, -0.7, 0.7)),
  plasticTap: (c) => material(c, 'plastic', rand(c.rng, 0.4, 1), rand(c.rng, -0.6, 0.6)),

  footstep: (c, scene) => {
    // Never a single isolated step: people walk. The old engine played one thump
    // every 1.7-6.5 s, which reads as a metronome, not as a person.
    const surface = surfaceFor(scene);
    const steps = randInt(c.rng, 2, 5);
    const interval = 1 / rand(c.rng, 1.7, 2.2);
    const pan = rand(c.rng, -0.6, 0.6);
    for (let i = 0; i < steps; i++) {
      const asym = i % 2 === 0 ? 1 : rand(c.rng, 0.78, 0.95);
      // Drift across the run: somebody taking four steps has moved by the fourth.
      // A cluster pinned to one azimuth is one of the tells that these are scheduled
      // effects rather than things happening in a room.
      const drift = pan + (i / Math.max(1, steps - 1)) * rand(c.rng, -0.25, 0.25);
      oneFootstep(c, surface, asym, clampPan(drift), c.at + i * interval + rand(c.rng, -0.012, 0.012));
    }
  },
  footstepRun: (c, scene) => {
    // Someone crossing the space: more steps, and the pan sweeps as they pass.
    const surface = surfaceFor(scene);
    const steps = randInt(c.rng, 5, 10);
    const interval = 1 / rand(c.rng, 1.8, 2.4);
    const from = c.rng() < 0.5 ? -0.9 : 0.9;
    for (let i = 0; i < steps; i++) {
      const t = i / Math.max(1, steps - 1);
      const proximity = 1 - Math.abs(t - 0.5) * 1.5;
      oneFootstep(c, surface, Math.max(0.25, proximity), from * (1 - 2 * t), c.at + i * interval);
    }
  },
  /**
   * A chair moving is STICK-SLIP: the leg grips, releases, grips again. Rendered as
   * one smooth band-passed swell it was the same sound as `creak`, whose band overlaps
   * it — and the two appear together in eight scenes.
   */
  chairScrape: (c) => {
    const pan = rand(c.rng, -0.6, 0.6);
    const total = rand(c.rng, 180, 600);
    const grabs = randInt(c.rng, 2, 5);
    let t = c.at;
    for (let i = 0; i < grabs; i++) {
      const seg = (total / grabs) * rand(c.rng, 0.6, 1.3);
      noiseBurst({ ...c, at: t }, {
        durationMs: seg,
        filterType: 'bandpass',
        freq: rand(c.rng, 700, 1700),
        q: 3.6,
        gain: c.gain * 0.7 * rand(c.rng, 0.55, 1),
        pan,
        attackMs: 8,
      });
      t += (seg / 1000) * rand(c.rng, 0.7, 1.1);
    }
    // The leg landing at the end of the push.
    material({ ...c, at: t, gain: c.gain * 0.35 }, 'wood', rand(c.rng, 0.3, 0.7), pan);
  },
  cough: (c) => {
    // A cough is a glottal release, not a puff: a hard noisy burst with a voiced
    // body under it that pitches down as the airway closes.
    const pan = rand(c.rng, -0.8, 0.8);
    const f0 = rand(c.rng, 130, 230);
    const one = (at: number, gain: number) => {
      // The plosive release.
      noiseBurst({ ...c, at }, {
        durationMs: rand(c.rng, 22, 38), filterType: 'bandpass', freq: rand(c.rng, 900, 1700),
        q: 0.8, gain: gain * 1.1, pan, attackMs: 0.8, color: 'pink',
      });
      voicedBurst({ ...c, at: at + 0.012 }, {
        f0, f0End: f0 * 0.62, durationMs: rand(c.rng, 80, 140),
        formants: [rand(c.rng, 520, 700), rand(c.rng, 1150, 1500)],
        gain, pan, breath: 0.5, attackMs: 3,
      });
    };
    one(c.at, c.gain);
    if (c.rng() < 0.5) one(c.at + rand(c.rng, 0.35, 0.7), c.gain * 0.7);
  },
  laugh: (c) => {
    // Syllabic bursts on a falling pitch — the shape is what reads as laughter, but
    // only once the bursts are voiced. As band-passed noise this was rhythmic hiss.
    const pan = rand(c.rng, -0.8, 0.8);
    const pulses = randInt(c.rng, 3, 6);
    const f0 = rand(c.rng, 180, 340);
    const vowel: [number, number] = c.rng() < 0.5 ? [800, 1200] : [500, 900]; // /a/ or /o/
    for (let i = 0; i < pulses; i++) {
      // Pitch and level both decline across the run, as breath runs out.
      const decline = 1 - i * 0.06;
      voicedBurst({ ...c, at: c.at + i * rand(c.rng, 0.13, 0.2) }, {
        f0: f0 * decline * rand(c.rng, 0.96, 1.04),
        f0End: f0 * decline * 0.8,
        durationMs: rand(c.rng, 60, 105),
        formants: vowel,
        gain: c.gain * (1 - i / (pulses + 2)),
        pan,
        breath: 0.35,
        attackMs: 5,
      });
    }
  },

  doorLatch: (c) => {
    const pan = rand(c.rng, -0.7, 0.7);
    material(c, 'wood', rand(c.rng, 0.6, 1), pan);
    material({ ...c, at: c.at + rand(c.rng, 0.03, 0.09), gain: c.gain * 0.5 }, 'metal', 0.4, pan);
  },
  doorChime: (c) => {
    // A shop-door chime IS a bell, so it stays one — but the old version was a piercing
    // 0.85 s ring high up at 1900-2400 Hz struck 2-4 times, which is precisely the
    // "campanita" a learner hears standing proud of the whole mix. Two strikes, a lower
    // fundamental, a ring shortened to a third of its length and a soft mallet body turn
    // it into a brief "ding" you register as a door rather than as a wind-chime.
    const pan = rand(c.rng, -0.5, 0.5);
    const strikes = randInt(c.rng, 1, 2);
    for (let k = 0; k < strikes; k++) {
      const base = rand(c.rng, 1500, 1950);
      modalHit(
        { ...c, at: c.at + k * rand(c.rng, 0.11, 0.2), gain: c.gain * Math.pow(0.6, k) },
        [
          { freq: base, decayS: 0.3, amp: 1 },
          { freq: base * 1.53, decayS: 0.18, amp: 0.35 },
          { freq: base * 2.31, decayS: 0.08, amp: 0.14 },
        ],
        { pan, noiseAmount: 0.3, noiseHz: 4600, bodyAmount: 0.4, bodyHz: base * 0.8, bodyMs: 22 },
      );
    }
  },
  registerBeep: (c) => {
    // A barcode scanner's confirmation tone. It was a raw square wave at 2.1-2.9 kHz
    // with a 2 ms attack — the harshest possible thing to put in a mix, and audible
    // as a pure electronic artefact rather than as a shop. A real one comes out of a
    // small plastic transducer: band-limited, with a body resonance and a soft edge.
    const { ctx, at } = c;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = rand(c.rng, 2100, 2900);

    // The transducer: no energy either side of what a tiny piezo can reproduce.
    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = rand(c.rng, 2400, 3000);
    body.Q.value = 2.6;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 4200;

    const env = ctx.createGain();
    const dur = rand(c.rng, 0.06, 0.12);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + 0.006);
    env.gain.setValueAtTime(c.gain * 0.5, at + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(body); body.connect(flt); flt.connect(env);
    env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.05;
    c.track(osc, done); c.track(body, done); c.track(flt, done); c.track(env, done);
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
      // Keys are spread across a board, so successive strokes are not co-located.
      const keyPan = clampPan(pan + rand(c.rng, -0.12, 0.12));
      material({ ...c, at, gain: c.gain * rand(c.rng, 0.6, 1) }, 'plastic', 0.7, keyPan);
      // The key coming back up.
      material({ ...c, at: at + rand(c.rng, 0.045, 0.09), gain: c.gain * 0.3 }, 'plastic', 0.3, keyPan);
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
  /**
   * A printer, not a motor.
   *
   * `printer`, `grinder` and `compressor` were the same synth three times over — a
   * sawtooth ramping up into a lowpass with a trapezoid envelope — separated only by
   * their frequency band and duration. Through the mid bus's lowpass they arrived as
   * one machine at three speeds, which is a large part of why an office, a café and a
   * workshop did not sound like different kinds of place.
   *
   * What identifies a printer is the STEPPER: a train of discrete ticks at a rate you
   * can count, plus the paper being dragged through. The motor whine is the least
   * characteristic part of it.
   */
  printer: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 0.9, 2.2);
    const pan = rand(c.rng, -0.3, 0.3);

    // The carriage: discrete steps, fast enough to buzz but slow enough to count.
    const stepHz = rand(c.rng, 34, 58);
    const steps = Math.floor(dur * stepHz);
    for (let i = 0; i < steps; i++) {
      const t = at + (i / stepHz) + rand(c.rng, -0.0015, 0.0015);
      modalHit(
        { ...c, at: t, gain: c.gain * 0.1 * (0.7 + 0.3 * Math.sin(i * 0.4)) },
        [{ freq: rand(c.rng, 1500, 2400), decayS: 0.01, amp: 1 }],
        { pan },
      );
    }
    // Paper being pulled through the rollers.
    noiseBurst(c, {
      durationMs: dur * 1000, filterType: 'bandpass', freq: rand(c.rng, 2600, 4200), q: 0.9,
      gain: c.gain * 0.18, pan, attackMs: 90, color: 'pink',
    });
    // The feed motor underneath, quiet: it is context, not identity.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(rand(c.rng, 150, 210), at);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 900;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.09), at + 0.08);
    env.gain.setValueAtTime(c.gain * 0.09, at + dur * 0.85);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.05;
    c.track(osc, done); c.track(flt, done); c.track(env, done);
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
  /**
   * A burr grinder. What tells it apart from any other motor is that it BOGS: beans
   * feed in unevenly, the load fluctuates, and the pitch and level wobble with it.
   * A steady ramp up and down is a fan.
   */
  grinder: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 1.6, 3);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(40, at);
    osc.frequency.linearRampToValueAtTime(rand(c.rng, 105, 125), at + 0.35);
    // Load fluctuation: the motor dips whenever it catches.
    const wobble = ctx.createOscillator();
    wobble.type = 'sine';
    wobble.frequency.value = rand(c.rng, 5.5, 11);
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = rand(c.rng, 9, 18);
    wobble.connect(wobbleDepth); wobbleDepth.connect(osc.frequency);
    osc.frequency.setValueAtTime(rand(c.rng, 105, 125), at + dur - 0.3);
    osc.frequency.linearRampToValueAtTime(45, at + dur);

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 1800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.32), at + 0.2);
    env.gain.setValueAtTime(c.gain * 0.32, at + dur - 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    wobble.start(at); wobble.stop(at + dur + 0.02);
    const done = at + dur + 0.1;
    c.track(osc, done); c.track(wobble, done); c.track(wobbleDepth, done);
    c.track(flt, done); c.track(env, done);

    // The burr itself: hard fragments rattling, bright and dense.
    noiseBurst(c, {
      durationMs: dur * 1000, filterType: 'highpass', freq: rand(c.rng, 2400, 3400),
      gain: c.gain * 0.26, pan: 0, attackMs: 180,
    });
  },

  announcement: (c) => {
    // A PA voice: voiced syllables through a narrow band with a horn resonance. The
    // channel is the cue — nobody needs to make out the words to know what it is. But
    // the syllables have to be VOICED: as band-passed noise (which is what this was)
    // it had speech rhythm and no pitch, and read as static rather than as a person.
    const syllables = randInt(c.rng, 6, 14);
    const pan = rand(c.rng, -0.3, 0.3);
    const f0 = rand(c.rng, 105, 210);
    // Spanish vowels, so the syllable stream has somewhere to move between.
    const VOWELS: Array<[number, number]> = [
      [800, 1200], [420, 2000], [300, 2300], [500, 900], [325, 750], // a e i o u
    ];
    // Declination across the announcement, as in a real read.
    let t = c.at;
    for (let i = 0; i < syllables; i++) {
      const dur = rand(c.rng, 0.09, 0.2);
      const decl = 1 - (i / syllables) * 0.22;
      const vowel = VOWELS[Math.floor(c.rng() * VOWELS.length)];
      voicedBurst({ ...c, at: t }, {
        f0: f0 * decl * rand(c.rng, 0.94, 1.08),
        f0End: f0 * decl * 0.92,
        durationMs: dur * 1000,
        // Telephone/PA band: the formants are pushed into 700-2000 Hz, which is the
        // horn's passband, rather than sitting where they naturally would.
        formants: [Math.max(700, vowel[0] * 1.6), Math.min(2400, vowel[1] * 1.15)],
        gain: c.gain * rand(c.rng, 0.5, 1),
        pan,
        breath: 0.18,
        attackMs: 12,
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
    // A single bare sine was the most synthetic object in the whole registry. A ward
    // monitor's beep comes out of a small speaker: a second partial, a body
    // resonance, and an attack slow enough not to click.
    const f = rand(c.rng, 980, 1160);
    modalHit(
      c,
      [
        { freq: f, decayS: 0.11, amp: 0.6 },
        { freq: f * 2.02, decayS: 0.05, amp: 0.18 },
      ],
      { pan: rand(c.rng, -0.4, 0.4), bodyAmount: 0.22, bodyHz: f * 1.5, bodyMs: 14 },
    );
  },
  /**
   * A weight plate is heavy: it lands low, rings long, and settles against the stack.
   * `metalClank` is a light metal hit — the two were the same `material('metal')`
   * call, one of them twice, and `impactWrench` is that call again 8-20 times.
   */
  weightClank: (c) => {
    const pan = rand(c.rng, -0.7, 0.7);
    modalHit(
      { ...c, gain: c.gain * 0.9 },
      [
        { freq: rand(c.rng, 78, 140), decayS: rand(c.rng, 0.5, 0.95), amp: 1 },
        { freq: rand(c.rng, 210, 330), decayS: 0.34, amp: 0.5 },
        { freq: rand(c.rng, 520, 780), decayS: 0.12, amp: 0.22 },
      ],
      { pan },
    );
    for (let i = 0; i < randInt(c.rng, 1, 3); i++) {
      material(
        { ...c, at: c.at + 0.07 + i * rand(c.rng, 0.05, 0.11), gain: c.gain * (0.4 / (i + 1)) },
        'metal', rand(c.rng, 0.4, 0.7), pan,
      );
    }
  },
  impactWrench: (c) => {
    // Rattle-gun: a burst of very fast metallic hammer blows.
    const pan = rand(c.rng, -0.6, 0.6);
    const blows = randInt(c.rng, 8, 20);
    for (let i = 0; i < blows; i++) {
      material({ ...c, at: c.at + i * rand(c.rng, 0.022, 0.033), gain: c.gain * rand(c.rng, 0.5, 1) }, 'metal', 0.5, pan);
    }
  },
  /**
   * An air compressor: it builds pressure at a steady load and then CUTS OUT, and the
   * relief valve blows off. That final hiss is the whole signature — without it this
   * is indistinguishable from a printer an octave down.
   */
  compressor: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 3, 7);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(28, at);
    // Pressure builds: the motor works progressively harder rather than plateauing.
    osc.frequency.linearRampToValueAtTime(46, at + 0.6);
    osc.frequency.linearRampToValueAtTime(rand(c.rng, 54, 62), at + dur - 0.12);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 700;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.4), at + 0.4);
    env.gain.setValueAtTime(c.gain * 0.4, at + dur - 0.1);
    // Cut-out, not fade-out: a compressor stops.
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(flt); flt.connect(env); env.connect(c.dest); env.connect(c.send);
    osc.start(at); osc.stop(at + dur + 0.02);
    const done = at + dur + 0.1;
    c.track(osc, done); c.track(flt, done); c.track(env, done);

    // The relief valve, right on the cut-out.
    noiseBurst({ ...c, at: at + dur - 0.04 }, {
      durationMs: rand(c.rng, 320, 700), filterType: 'highpass', freq: rand(c.rng, 1800, 3200),
      gain: c.gain * 0.4, pan: rand(c.rng, -0.4, 0.4), attackMs: 4,
    });
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

    // A hair dryer has a motor in it; steam and a sizzle do not. Without this the
    // three looped-noise-through-one-filter events are one sound at three centres.
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(rand(c.rng, 118, 168), at);
    const motorFlt = ctx.createBiquadFilter();
    motorFlt.type = 'lowpass'; motorFlt.frequency.value = 620;
    const motorEnv = ctx.createGain();
    motorEnv.gain.setValueAtTime(0.0001, at);
    motorEnv.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.14), at + 0.25);
    motorEnv.gain.setValueAtTime(c.gain * 0.14, at + dur - 0.3);
    motorEnv.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    motor.connect(motorFlt); motorFlt.connect(motorEnv);
    motorEnv.connect(c.dest); motorEnv.connect(c.send);
    motor.start(at); motor.stop(at + dur + 0.05);
    c.track(motor, done); c.track(motorFlt, done); c.track(motorEnv, done);
  },

  bird: (c) => {
    // Was a bare sine gliding between two frequencies, which is a slide whistle, not
    // a bird. Three things separate them: a real call has harmonics (a syrinx is not
    // a sine), it is frequency-modulated several times within a single note rather
    // than sliding once, and it carries a little breath noise at onset.
    const { ctx } = c;
    const notes = randInt(c.rng, 2, 5);
    const baseHz = rand(c.rng, 2200, 4400);
    const pan = rand(c.rng, -0.9, 0.9);
    const rising = c.rng() < 0.5;
    for (let k = 0; k < notes; k++) {
      const at = c.at + k * rand(c.rng, 0.12, 0.3);
      const dur = rand(c.rng, 0.06, 0.18);
      const f0 = baseHz * rand(c.rng, 0.92, 1.08);
      const end = rising ? f0 * rand(c.rng, 1.35, 1.8) : f0 * rand(c.rng, 0.55, 0.75);

      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + dur * 0.22);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      panner.connect(env); env.connect(c.dest); env.connect(c.send);

      // Fundamental plus two decaying harmonics — a whistled call is not quite pure.
      for (const [mult, amp] of [[1, 1], [2, 0.3], [3, 0.12]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * mult, at);
        // Warble through the note rather than a single monotonic slide.
        const mid = (f0 + end) * 0.5 * mult;
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, end * mult), at + dur * 0.45);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, mid * rand(c.rng, 0.9, 1.1)), at + dur * 0.75);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, end * mult), at + dur);
        const partial = ctx.createGain();
        partial.gain.value = amp;
        osc.connect(partial); partial.connect(panner);
        osc.start(at); osc.stop(at + dur + 0.02);
        c.track(osc, at + dur + 0.05); c.track(partial, at + dur + 0.05);
      }

      // Breath at the onset.
      noiseBurst({ ...c, at }, {
        durationMs: dur * 1000 * 0.3, filterType: 'bandpass', freq: f0 * 1.4, q: 1.4,
        gain: c.gain * 0.12, pan, attackMs: 1,
      });

      const done = at + dur + 0.05;
      c.track(panner, done); c.track(env, done);
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

  /**
   * A creak RISES. Wood under a slowly increasing load shifts its resonance upward —
   * that glide is what tells it apart from a chair being pushed, which is a series of
   * grabs at a roughly constant pitch.
   */
  creak: (c) => {
    const { ctx, at } = c;
    const dur = rand(c.rng, 0.14, 0.45);
    const src = ctx.createBufferSource();
    src.buffer = c.noise.get('white');
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = 8;
    const start = rand(c.rng, 320, 620);
    flt.frequency.setValueAtTime(start, at);
    flt.frequency.exponentialRampToValueAtTime(start * rand(c.rng, 1.6, 2.6), at + dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = rand(c.rng, -0.6, 0.6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    src.start(at, c.rng() * 4); src.stop(at + dur + 0.02);
    const done = at + dur + 0.05;
    c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
  },
  /**
   * A page turning is one gesture: a rising sweep as the sheet lifts, then the snap of
   * it landing. `paperRustle` is the granular one — the two used the same granulated
   * synth with different grain counts, and they share a scene in the library.
   */
  pageTurn: (c) => {
    const { ctx, at } = c;
    const pan = rand(c.rng, -0.4, 0.4);
    const dur = rand(c.rng, 0.18, 0.32);
    const src = ctx.createBufferSource();
    src.buffer = c.noise.get('white');
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.Q.value = 1.1;
    flt.frequency.setValueAtTime(rand(c.rng, 1400, 2200), at);
    flt.frequency.exponentialRampToValueAtTime(rand(c.rng, 5000, 7000), at + dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.5), at + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt); flt.connect(panner); panner.connect(env);
    env.connect(c.dest); env.connect(c.send);
    src.start(at, c.rng() * 4); src.stop(at + dur + 0.02);
    const done = at + dur + 0.06;
    c.track(src, done); c.track(flt, done); c.track(panner, done); c.track(env, done);
    // The sheet settling.
    noiseBurst({ ...c, at: at + dur * 0.92 }, {
      durationMs: rand(c.rng, 14, 30), filterType: 'bandpass', freq: rand(c.rng, 900, 1600),
      q: 1.6, gain: c.gain * 0.4, pan, attackMs: 1,
    });
  },
  applause: (c) => {
    // A crowd clapping is a dense wash with a few near claps standing out of it, not
    // 140-630 individually scheduled bursts: that version built up to ~2,500 nodes
    // inside one 400 ms scheduler tick, which is a real risk of an audible dropout on
    // the audio thread. A continuous band-limited noise layer carries the mass, and a
    // couple of dozen discrete claps sit on top for the texture.
    const { ctx } = c;
    const dur = rand(c.rng, 3.5, 7);

    const wash = ctx.createBufferSource();
    wash.buffer = c.noise.get('white');
    wash.loop = true;
    const washFilter = ctx.createBiquadFilter();
    washFilter.type = 'bandpass';
    washFilter.frequency.value = rand(c.rng, 1300, 2000);
    washFilter.Q.value = 0.7;
    const washEnv = ctx.createGain();
    washEnv.gain.setValueAtTime(0.0001, c.at);
    washEnv.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * 0.9), c.at + 0.25);
    washEnv.gain.setValueAtTime(c.gain * 0.9, c.at + dur * 0.35);
    washEnv.gain.exponentialRampToValueAtTime(0.0001, c.at + dur);
    wash.connect(washFilter); washFilter.connect(washEnv);
    washEnv.connect(c.dest); washEnv.connect(c.send);
    wash.start(c.at, c.rng() * 4);
    wash.stop(c.at + dur + 0.05);
    const washDone = c.at + dur + 0.1;
    c.track(wash, washDone); c.track(washFilter, washDone); c.track(washEnv, washDone);

    // A handful of nearby hands, so the wash has grain.
    const claps = randInt(c.rng, 14, 26);
    for (let i = 0; i < claps; i++) {
      const t = Math.pow(c.rng(), 0.7) * dur;
      noiseBurst({ ...c, at: c.at + t }, {
        durationMs: rand(c.rng, 6, 18),
        filterType: 'bandpass',
        freq: rand(c.rng, 900, 2600),
        q: 0.9,
        gain: c.gain * rand(c.rng, 0.15, 0.5) * (1 - t / (dur * 1.4)),
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
  private eventTop!: BiquadFilterNode;
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
  /** Stretch applied to every `everyS` to hold the scene under the onset budget. */
  private rateScale = 1;

  constructor(ctx: AudioContext, destination: AudioNode, scene: ResolvedAmbience, seedSalt: string, opts: AmbienceEngineOptions) {
    this.ctx = ctx;
    this.scene = scene;
    this.intensity = opts.intensity;
    const rawBed = bedLevel(scene.recipe);
    const boost = bedBoost(rawBed);
    this.bedGain = STEM_MAKEUP * boost * (scene.presence ?? 1);
    // Derived from the headroom this scene declares, so the number a recipe writes is
    // the number the ear gets. Unannotated recipes reproduce the old fixed ratio.
    this.eventScale = eventScaleFor(scene.recipe, rawBed * boost) * (scene.presence ?? 1);

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

    const cutoffs = busCutoffs(recipe.room);

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createRoomImpulse(ctx, recipe.room, this.rng);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = recipe.room.wet * REVERB_RETURN;
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.userGain);

    // Air absorption / bandwidth match for the whole event side.
    //
    // Events are synthesised at the context rate (44.1-48 kHz) with contact clicks
    // high-passed at 4.2-6 kHz and cutlery partials reaching past 15 kHz, while the
    // beds are baked at 8-24 kHz and so carry literally nothing above 4-12 kHz. The
    // events therefore live in a band where the bed does not exist, which means they
    // can never be masked by it or integrate with it: acoustically they are a
    // separate layer floating on top, and that is a large part of why they read as
    // "little noises" rather than as part of the place.
    this.eventTop = ctx.createBiquadFilter();
    this.eventTop.type = 'lowpass';
    this.eventTop.frequency.value = sceneBandwidthHz(recipe);
    this.eventTop.Q.value = 0.7;
    this.eventTop.connect(this.userGain);

    // Near events: mostly dry, panned wide, but never BONE dry. `wet` is already
    // applied once at the return, so the sends below are pure distance ratios. A
    // perfectly dry clink inside a room is physically impossible, and it is the
    // single strongest cue that an event is pasted on top rather than happening in
    // the same place as the bed.
    this.eventNear = ctx.createGain();
    this.eventNear.gain.value = 1;
    this.eventNear.connect(this.eventTop);
    this.nearSend = ctx.createGain();
    this.nearSend.gain.value = 0.5;
    this.nearSend.connect(this.convolver);

    // Mid events: a real distance rather than a volume trim. This used to be a bare
    // 0.7 gain multiplier in fire() with no filtering and no extra send — and two
    // thirds of all event specs are `mid`, so the depth system was mostly bypassed.
    this.eventMidFilter = ctx.createBiquadFilter();
    this.eventMidFilter.type = 'lowpass';
    this.eventMidFilter.frequency.value = cutoffs.mid;
    this.eventMid = ctx.createGain();
    this.eventMid.gain.value = 0.62;
    this.eventMidFilter.connect(this.eventMid);
    this.eventMid.connect(this.eventTop);
    this.midSend = ctx.createGain();
    this.midSend.gain.value = 0.95;
    this.midSend.connect(this.convolver);

    // Far events: lowpassed (air absorption) and mostly reverb. This near/far split
    // is what produces depth; previously every event sat at the same distance, which
    // is a large part of why the mix felt flat and "in your head".
    this.eventFarFilter = ctx.createBiquadFilter();
    this.eventFarFilter.type = 'lowpass';
    this.eventFarFilter.frequency.value = cutoffs.far;
    this.eventFar = ctx.createGain();
    this.eventFar.gain.value = 0.5;
    this.eventFarFilter.connect(this.eventFar);
    this.eventFar.connect(this.eventTop);
    this.farSend = ctx.createGain();
    this.farSend.gain.value = 0.75;
    this.farSend.connect(this.convolver);

    // Stems: high-passed to free the headroom the old beds wasted below 80 Hz.
    this.stemHighpass = ctx.createBiquadFilter();
    this.stemHighpass.type = 'highpass';
    this.stemHighpass.frequency.value = BED_HIGHPASS_HZ;
    this.stemHighpass.Q.value = 0.7;
    this.stemBus = ctx.createGain();
    // The tone's own makeup is taken back out of the bus gain, so colouring a scene
    // changes what it sounds like and not how loud it is — the event-over-bed
    // relationship the recipe declares survives the EQ.
    this.stemBus.gain.value = this.bedGain * Math.pow(10, -toneMakeupDb(recipe.tone) / 20);

    // Scene colour, between the bus high-pass and the bus gain. Inserting it here
    // rather than inside attachStem means the three places a stem connects to
    // `stemHighpass` are untouched.
    const toneChain = buildToneChain(ctx, recipe.tone, (n) => this.liveNodes.add(n));
    if (toneChain) {
      this.stemHighpass.connect(toneChain.input);
      toneChain.output.connect(this.stemBus);
    } else {
      this.stemHighpass.connect(this.stemBus);
    }
    this.stemBus.connect(this.userGain);

    // Event schedule, with the first occurrence spread out so a scene doesn't open
    // with everything firing at once.
    const now = ctx.currentTime;
    this.rateScale = this.scaledRate(this.effectiveIntensity());
    this.schedule = recipe.events.map((spec) => ({
      spec,
      nextAt: now + rand(this.rng, 0.4, Math.max(1.2, spec.everyS * this.rateScale)),
    }));
  }

  /** Interval stretch for this scene, including the presence factor: a place we are
   *  recording *in* puts fewer things in front of the listener than the place itself. */
  private scaledRate(eff: number): number {
    return eventRateScale(this.scene.recipe, eff) / Math.max(0.2, this.scene.presence ?? 1);
  }

  /** The recipe's bias folded into the user's setting. Kept as a function rather than
   *  written back over `this.intensity`, which made the bias compound every time the
   *  slider moved. */
  private effectiveIntensity(): number {
    return clamp01(this.intensity + (this.scene.recipe.intensityBias ?? 0));
  }

  /**
   * Change how busy the scene is without rebuilding it.
   *
   * AudioPlayer used to tear down and reconstruct the whole engine on every slider
   * move, which restarted every stem from a new random offset — an audible jump — and
   * was the only way to update the rate scale at all, since it was computed once in
   * the constructor. Pulling `nextAt` forward means a move takes effect now rather
   * than after the current interval has elapsed.
   */
  setIntensity(intensity: number) {
    this.intensity = clamp01(intensity);
    const eff = this.effectiveIntensity();
    this.rateScale = this.scaledRate(eff);
    const now = this.ctx.currentTime;
    for (const entry of this.schedule) {
      const interval = entry.spec.everyS * (1.6 - eff) * this.rateScale;
      entry.nextAt = Math.min(entry.nextAt, now + Math.max(0.12, interval));
    }
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

    // Two playheads per stem, offset from each other and running at slightly
    // different rates.
    //
    // The stems are 14-24 seconds and used to play from a single source at exactly
    // 1.0, so a three-minute lesson replayed the identical 18 seconds of crowd about
    // ten times. Once a listener has heard a loop twice they hear it as a loop
    // forever, and no amount of spectral work fixes that — it is the one artefact
    // that says "recording" rather than "place".
    //
    // Two heads with an irrational-ish rate ratio means the composite never repeats
    // within any plausible lesson: the beat period between them is minutes long. It
    // costs one extra buffer source per layer and not a single byte of asset, which
    // is the only reason it is done here rather than by baking longer stems (there is
    // ~1 MB of headroom in the budget, nowhere near enough).
    const heads: AudioBufferSourceNode[] = [];
    const merge = ctx.createGain();
    // Decorrelated copies sum in power, so compensate to keep the layer at its gain.
    merge.gain.value = 1 / Math.sqrt(PLAYHEADS_PER_STEM);
    this.liveNodes.add(merge);

    for (let h = 0; h < PLAYHEADS_PER_STEM; h++) {
      const head = ctx.createBufferSource();
      head.buffer = buffer;
      head.loop = true;
      // A fraction of a percent: inaudible as pitch, but it detunes the loop period
      // enough that the two heads never line up again.
      head.playbackRate.value = h === 0 ? 1 : 1 + (this.rng() < 0.5 ? -1 : 1) * (0.004 + this.rng() * 0.004);
      head.connect(merge);
      heads.push(head);
    }

    const src = heads[0];
    let node: AudioNode = merge;

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
    // Per-layer colour. 62% of layers in the catalogue had no shaping at all, which is
    // how `room_tone` came out identical in the 29 scenes that use it.
    const layerTone = buildToneChain(ctx, layer.tone, (n) => this.liveNodes.add(n));
    if (layerTone) {
      node.connect(layerTone.input);
      node = layerTone.output;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(
      layer.gain * Math.pow(10, -toneMakeupDb(layer.tone) / 20), ctx.currentTime + 2,
    );
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
    // stems of different lengths never phase-lock into an audible super-loop. The two
    // heads enter at points well apart from each other, so at any instant they are
    // playing different material.
    const entry = this.rng() * buffer.duration;
    heads.forEach((head, h) => {
      const offset = (entry + (h * buffer.duration) / heads.length) % buffer.duration;
      head.start(ctx.currentTime, offset);
      this.liveNodes.add(head);
      this.stemSources.push(head);
    });
    void src;
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
          // Was randInt(1, 3). Clusters are real, but three extras on top of a
          // cluster-type synth (typing is already 4-12 keys) is a pile-up.
          const extra = randInt(this.rng, 1, 2);
          for (let i = 1; i <= extra; i++) {
            this.fire(entry.spec, at + i * rand(this.rng, 0.12, 0.7));
          }
        }

        // Higher intensity means more often, not just louder. With the old hard
        // clamp this was a lie in 26 of 42 scenes: `rateScale` carried a 1/(1.6 - i)
        // that cancelled this factor exactly.
        const scale = (1.6 - this.effectiveIntensity()) * this.rateScale;
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
    const eff = this.effectiveIntensity();
    try {
      synth(
        {
          ctx: this.ctx,
          rng: this.rng,
          noise: this.noise,
          dest,
          send,
          at,
          intensity: eff,
          // EVENT_TRIM keeps the discrete one-shots subordinate to the bed at
          // playback, so the ambience reads as a place rather than as bells over it.
          gain: spec.gain * this.eventScale * EVENT_TRIM * (0.55 + eff * 0.75),
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
