import {
  ResolvedAmbience,
  SceneRecipe,
  BedLayer,
  EventSpec,
  EventKind,
} from './ambiencePresets';
import { loadBed } from './ambienceLibrary';

/**
 * Ambience engine — the real-recording runtime.
 *
 * The bed of every scene is a real public-domain field recording (see
 * ambiencePresets.ts). This engine's whole job is to play those recordings
 * convincingly:
 *
 *   - each bed loops under **two lightly-detuned playheads**, panned apart, so a mono
 *     16-24 s loop reads as a wide, non-repeating space rather than an obvious loop;
 *   - a per-scene tone (shelves / tilt, or a telephone band for the "on a line" setups)
 *     colours it;
 *   - a small, deliberately subtle layer of **shaped-noise events** adds life to the
 *     quiet indoor rooms whose recording is nearly stationary. They are noise
 *     transients only — never tuned oscillators — so they cannot ring like the
 *     "campanitas" the synthetic system was full of.
 *
 * There is no synthetic room reverb on the beds; the recordings carry their own space.
 * Events get a short, low synthetic tail only so they don't sound pasted on.
 *
 * The public surface (constructor, start/stop, setVolume/setIntensity/setDucking,
 * applySpeechLevel) is unchanged from the previous engine, so AudioPlayer is untouched.
 */

export const DEFAULT_AMBIENCE_VOLUME = 0.6;
export const DEFAULT_AMBIENCE_INTENSITY = 0.6;
export const DEFAULT_AMBIENCE_DUCKING = 0.65;

/** Brings the −24 dBFS beds up to a sensible pre-volume level. */
export const BED_MAKEUP = 2.4;
/** Events are scaled against the bed reference, and their spec gains keep them under it. */
export const EVENT_MAKEUP = 1.15;
/** Intensity is evaluated relative to this, so the default slider position is neutral. */
export const RATE_REFERENCE_INTENSITY = 0.6;

const TWO_PI = Math.PI * 2;

// --- small deterministic RNG (per playback salt) ---------------------------
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- a shared white-noise buffer for the event synths ----------------------
class NoisePool {
  private buf: AudioBuffer | null = null;
  constructor(private ctx: BaseAudioContext, private rng: () => number) {}
  get(): AudioBuffer {
    if (this.buf) return this.buf;
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rng() * 2 - 1;
    this.buf = b;
    return b;
  }
}

// ---------------------------------------------------------------------------
// Event synthesis — shaped noise only. Each returns the nodes it created so the engine
// can release them; the source is started by the caller.
// ---------------------------------------------------------------------------

interface EventShape {
  /** Filter type + frequency for the body of the transient. */
  type: BiquadFilterType;
  freq: number;
  q?: number;
  /** Envelope in seconds. */
  attack: number;
  decay: number;
  /** Number of noise grains (footsteps = a few). */
  grains?: number;
  grainGap?: number;
  /** Adds a brief bright click at onset (a contact transient). */
  click?: number;
}

export const EVENT_SHAPES: Record<EventKind, EventShape> = {
  cup:      { type: 'bandpass', freq: 620,  q: 0.9, attack: 0.002, decay: 0.09, click: 0.4 },
  keyboard: { type: 'bandpass', freq: 2600, q: 1.1, attack: 0.001, decay: 0.02, click: 0.5 },
  paper:    { type: 'highpass', freq: 1900, q: 0.7, attack: 0.01,  decay: 0.16 },
  chair:    { type: 'bandpass', freq: 320,  q: 0.8, attack: 0.008, decay: 0.28 },
  door:     { type: 'lowpass',  freq: 420,  q: 0.7, attack: 0.003, decay: 0.14, click: 0.3 },
  steps:    { type: 'lowpass',  freq: 520,  q: 0.8, attack: 0.004, decay: 0.10, grains: 3, grainGap: 0.34 },
  till:     { type: 'bandpass', freq: 900,  q: 1.0, attack: 0.001, decay: 0.035, click: 0.3 },
  splash:   { type: 'bandpass', freq: 1400, q: 0.6, attack: 0.006, decay: 0.22 },
  page:     { type: 'highpass', freq: 2400, q: 0.6, attack: 0.012, decay: 0.20 },
};

// --- distance colouring of the event bus -----------------------------------
const DISTANCE_LOWPASS: Record<NonNullable<EventSpec['distance']>, number> = {
  near: 8000, mid: 4500, far: 2400,
};
const DISTANCE_GAIN: Record<NonNullable<EventSpec['distance']>, number> = {
  near: 1.0, mid: 0.75, far: 0.5,
};

interface ScheduledEvent { spec: EventSpec; nextAt: number; }

// ---------------------------------------------------------------------------

export interface AmbienceEngineOptions {
  volume: number;
  intensity: number;
  /** Called as beds finish loading, for the player's "N/M capas" counter. */
  onStemsReady?: (loaded: number, total: number) => void;
}

export class AmbienceEngine {
  private ctx: AudioContext;
  private dest: AudioNode;
  private scene: ResolvedAmbience;
  private recipe: SceneRecipe;
  private rng: () => number;
  private noise: NoisePool;

  // Output chain: bedBus + eventBus -> busGain(volume) -> limiter -> duckGain -> dest
  private busGain: GainNode;
  private limiter: DynamicsCompressorNode;
  private duckGain: GainNode;
  private bedBus: GainNode;
  private eventBus: GainNode;
  private eventReverb: ConvolverNode | null = null;

  private bedSources: AudioBufferSourceNode[] = [];
  private liveNodes = new Set<AudioNode>();
  private pendingCleanup: Array<{ node: AudioNode; at: number }> = [];
  private schedule: ScheduledEvent[] = [];
  private schedulerTimer: number | null = null;
  private cleanupTimer: number | null = null;

  private running = false;
  private disposed = false;
  private intensity: number;
  private duckAmount = DEFAULT_AMBIENCE_DUCKING;
  private presence: number;
  private level: number;
  /** Reference gain of the bed, used to scale events against it. */
  private bedRefGain: number;

  private loadedCount = 0;
  private layerCount = 0;

  constructor(ctx: AudioContext, destination: AudioNode, scene: ResolvedAmbience, seedSalt: string, opts: AmbienceEngineOptions) {
    this.ctx = ctx;
    this.dest = destination;
    this.scene = scene;
    this.recipe = scene.recipe;
    this.intensity = opts.intensity;
    this.presence = scene.presence ?? 1;
    this.level = (this.recipe.level ?? 1) * this.presence;
    this.rng = mulberry32(hashSeed(`${scene.id}|${seedSalt}`));
    this.noise = new NoisePool(ctx, mulberry32(hashSeed(`noise|${seedSalt}`)));

    this.busGain = ctx.createGain();
    this.busGain.gain.value = 0.0001;

    // A safety limiter, not a program compressor — gentle, so events never pump the bed.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-3, ctx.currentTime);
    this.limiter.knee.setValueAtTime(6, ctx.currentTime);
    this.limiter.ratio.setValueAtTime(6, ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.005, ctx.currentTime);
    this.limiter.release.setValueAtTime(0.12, ctx.currentTime);

    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;

    this.busGain.connect(this.limiter);
    this.limiter.connect(this.duckGain);
    this.duckGain.connect(destination);

    this.bedBus = ctx.createGain();
    this.eventBus = ctx.createGain();

    this.bedRefGain = this.maxLayerGain() * BED_MAKEUP;
    this.eventBus.gain.value = this.bedRefGain * EVENT_MAKEUP;

    this.buildBedBus();
    this.buildEventBus();
    this.setVolume(opts.volume);

    void this.loadAndStartBeds(opts.onStemsReady);
  }

  private maxLayerGain(): number {
    return this.recipe.beds.reduce((m, l) => Math.max(m, l.gain), 0) * this.level;
  }

  // --- graph ---------------------------------------------------------------
  private buildBedBus() {
    const { ctx } = this;
    // Per-scene colour on the whole bed.
    let head: AudioNode = this.bedBus;
    const tone = this.recipe.tone;
    if (tone?.bandpass) {
      const [lo, hi] = tone.bandpass;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = lo; hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = hi; lp.Q.value = 0.7;
      this.bedBus.connect(hp); hp.connect(lp); head = lp;
    }
    if (tone?.lowShelfDb) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowshelf'; f.frequency.value = 220; f.gain.value = tone.lowShelfDb;
      head.connect(f); head = f;
    }
    if (tone?.highShelfDb || tone?.tiltDb) {
      const f = ctx.createBiquadFilter();
      f.type = 'highshelf'; f.frequency.value = 3200;
      f.gain.value = (tone.highShelfDb ?? 0) + (tone.tiltDb ?? 0);
      head.connect(f); head = f;
    }
    if (tone?.tiltDb) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowshelf'; f.frequency.value = 3200; f.gain.value = -tone.tiltDb;
      head.connect(f); head = f;
    }
    head.connect(this.busGain);
  }

  private buildEventBus() {
    if (!this.recipe.events || this.recipe.events.length === 0) return;
    const { ctx } = this;
    // A short, quiet synthetic tail so events sit in a space instead of sounding dry
    // and pasted. Not a room simulation — just enough air.
    const conv = ctx.createConvolver();
    conv.buffer = this.smallRoomImpulse();
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    this.eventBus.connect(conv); conv.connect(wet); wet.connect(this.busGain);
    this.eventBus.connect(this.busGain); // dry path
    this.eventReverb = conv;
  }

  private smallRoomImpulse(): AudioBuffer {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * 0.28);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (this.rng() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  private async loadAndStartBeds(onReady?: (loaded: number, total: number) => void) {
    this.layerCount = this.recipe.beds.length;
    onReady?.(0, this.layerCount);
    await Promise.all(this.recipe.beds.map(async (layer) => {
      const buffer = await loadBed(this.ctx, layer.bed);
      if (this.disposed || !buffer) return;
      this.startLayer(layer, buffer);
      this.loadedCount += 1;
      onReady?.(this.loadedCount, this.layerCount);
    }));
  }

  // Two detuned, panned playheads from one mono loop -> width + no audible loop.
  private startLayer(layer: BedLayer, buffer: AudioBuffer) {
    const { ctx } = this;
    const gain = ctx.createGain();
    gain.gain.value = layer.gain * this.level * BED_MAKEUP;

    let head: AudioNode = gain;
    if (layer.highpass) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = layer.highpass;
      gain.connect(hp); head = hp;
    }
    if (layer.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = layer.lowpass;
      head.connect(lp); head = lp;
    }
    head.connect(this.bedBus);

    const width = layer.width ?? 0.5;
    const dur = buffer.duration;
    const detunes = [-0.0025, 0.0025];
    const pans = [-width, width];
    for (let i = 0; i < 2; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = 1 + detunes[i];
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pans[i]));
      src.connect(panner); panner.connect(gain);
      const offset = this.rng() * dur;
      try { src.start(0, offset); } catch { /* fake ctx in tests */ src.start(); }
      this.bedSources.push(src);
    }
  }

  // --- event scheduling ----------------------------------------------------
  private rateFor(everyS: number): number {
    // Higher intensity -> more frequent. Neutral at the reference.
    const k = 1 + (this.intensity - RATE_REFERENCE_INTENSITY) * 1.4;
    return Math.max(0.4, everyS / Math.max(0.2, k));
  }

  private primeSchedule() {
    const now = this.ctx.currentTime;
    this.schedule = (this.recipe.events ?? []).map((spec) => ({
      spec,
      nextAt: now + this.rateFor(spec.everyS) * (0.3 + this.rng() * 0.7),
    }));
  }

  private tick = () => {
    if (!this.running || this.disposed) return;
    const now = this.ctx.currentTime;
    const horizon = now + 1.5;
    for (const s of this.schedule) {
      while (s.nextAt < horizon) {
        this.fire(s.spec, Math.max(s.nextAt, now + 0.02));
        // jittered interval so events never fall into a rhythm
        s.nextAt += this.rateFor(s.spec.everyS) * (0.6 + this.rng() * 0.8);
      }
    }
  };

  private fire(spec: EventSpec, at: number) {
    const { ctx } = this;
    const shape = EVENT_SHAPES[spec.kind];
    const dist = spec.distance ?? 'mid';
    const busIn = ctx.createGain();
    busIn.gain.value = spec.gain * DISTANCE_GAIN[dist];
    const distLp = ctx.createBiquadFilter();
    distLp.type = 'lowpass'; distLp.frequency.value = DISTANCE_LOWPASS[dist];
    busIn.connect(distLp); distLp.connect(this.eventBus);

    const grains = shape.grains ?? 1;
    let last = at;
    for (let g = 0; g < grains; g++) {
      const t = at + g * (shape.grainGap ?? 0) * (0.85 + this.rng() * 0.3);
      last = this.grain(shape, t, busIn);
    }
    this.scheduleCleanup(busIn, last + 0.4);
    this.scheduleCleanup(distLp, last + 0.4);
  }

  private grain(shape: EventShape, t: number, out: AudioNode): number {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.get();
    src.loop = true;
    src.playbackRate.value = 0.8 + this.rng() * 0.5;

    const filt = ctx.createBiquadFilter();
    filt.type = shape.type; filt.frequency.value = shape.freq; filt.Q.value = shape.q ?? 0.7;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + shape.attack);
    env.gain.exponentialRampToValueAtTime(0.0006, t + shape.attack + shape.decay);

    src.connect(filt); filt.connect(env); env.connect(out);
    try { src.start(t); } catch { src.start(); }
    const end = t + shape.attack + shape.decay + 0.05;
    try { src.stop(end); } catch { /* fake ctx */ }
    this.scheduleCleanup(src, end + 0.1);
    this.scheduleCleanup(env, end + 0.1);
    this.scheduleCleanup(filt, end + 0.1);

    // A brief bright contact click at onset, for the handled objects.
    if (shape.click) {
      const c = ctx.createBufferSource();
      c.buffer = this.noise.get();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3500;
      const ce = ctx.createGain();
      ce.gain.setValueAtTime(shape.click, t);
      ce.gain.exponentialRampToValueAtTime(0.0004, t + 0.012);
      c.connect(hp); hp.connect(ce); ce.connect(out);
      try { c.start(t); } catch { c.start(); }
      try { c.stop(t + 0.03); } catch { /* fake ctx */ }
      this.scheduleCleanup(c, t + 0.1);
      this.scheduleCleanup(ce, t + 0.1);
      this.scheduleCleanup(hp, t + 0.1);
    }
    return end;
  }

  private scheduleCleanup(node: AudioNode, at: number) {
    this.liveNodes.add(node);
    this.pendingCleanup.push({ node, at });
  }

  private runCleanup = () => {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    this.pendingCleanup = this.pendingCleanup.filter(({ node, at }) => {
      if (at <= now) {
        try { node.disconnect(); } catch { /* already gone */ }
        this.liveNodes.delete(node);
        return false;
      }
      return true;
    });
  };

  // --- public API ----------------------------------------------------------
  start(volume: number) {
    if (this.running || this.disposed) return;
    this.running = true;
    this.setVolume(volume);
    this.primeSchedule();
    // ctx.currentTime-based lookahead scheduler (not setTimeout-fired synthesis), so a
    // backgrounded tab does not starve the events.
    const win = typeof window !== 'undefined' ? window : (globalThis as unknown as Window);
    this.schedulerTimer = win.setInterval(this.tick, 250) as unknown as number;
    this.cleanupTimer = win.setInterval(this.runCleanup, 500) as unknown as number;
    this.tick();
  }

  setVolume(volume: number, rampS = 0.15) {
    const v = Math.max(0.0001, volume);
    const now = this.ctx.currentTime;
    this.busGain.gain.cancelScheduledValues(now);
    this.busGain.gain.setValueAtTime(Math.max(0.0001, this.busGain.gain.value), now);
    this.busGain.gain.exponentialRampToValueAtTime(v, now + rampS);
  }

  setIntensity(intensity: number) {
    this.intensity = Math.max(0, Math.min(1, intensity));
    // Re-pace the schedule live (no engine rebuild, no restarted beds).
    if (this.running) this.primeSchedule();
  }

  setDucking(amount: number) {
    this.duckAmount = Math.max(0, Math.min(1, amount));
  }

  applySpeechLevel(level: number) {
    // Asymmetric duck: quick to get out of the way, slow to return, so the bed does not
    // pump between syllables.
    const target = 1 - this.duckAmount * Math.max(0, Math.min(1, level));
    const now = this.ctx.currentTime;
    const cur = this.duckGain.gain.value;
    const tau = target < cur ? 0.012 : 0.42;
    this.duckGain.gain.setTargetAtTime(target, now, tau);
  }

  stop() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.schedulerTimer !== null) clearInterval(this.schedulerTimer);
    if (this.cleanupTimer !== null) clearInterval(this.cleanupTimer);
    const now = this.ctx.currentTime;
    try {
      this.busGain.gain.cancelScheduledValues(now);
      this.busGain.gain.setValueAtTime(Math.max(0.0001, this.busGain.gain.value), now);
      this.busGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    } catch { /* fake ctx */ }
    for (const src of this.bedSources) {
      try { src.stop(now + 0.25); } catch { /* not started / fake ctx */ }
    }
    const win = typeof window !== 'undefined' ? window : (globalThis as unknown as Window);
    win.setTimeout(() => {
      for (const node of this.liveNodes) { try { node.disconnect(); } catch { /* */ } }
      this.liveNodes.clear();
      for (const src of this.bedSources) { try { src.disconnect(); } catch { /* */ } }
      this.bedSources = [];
      try { this.bedBus.disconnect(); } catch { /* */ }
      try { this.eventBus.disconnect(); } catch { /* */ }
      try { this.busGain.disconnect(); } catch { /* */ }
    }, 300);
  }
}
