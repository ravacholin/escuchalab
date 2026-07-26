// Offline DSP toolkit for the ambience stem renderer.
//
// Everything here runs at bake time (node scripts/generate-ambience-beds.mjs), never
// in the browser. That budget is what lets us do things a realtime Web Audio graph
// can't afford: FFT convolution with a real room impulse response, a dozen
// independently-synthesised voices, per-partial modal decay.
//
// Design note — why the old beds sounded like rain: they were 2-3 layers of
// *stationary* filtered noise summed at fixed gains and normalised by peak. Two
// consequences, both measurable. (a) Peak normalisation let the loudest layer (brown
// noise, scaled x3.2) set the level, so 85-97% of the energy ended up below 250 Hz.
// (b) With no amplitude structure, the short-term loudness range was 2-4 dB, where a
// real field recording spans 15-25 dB. Stationary broadband noise *is* what rain
// sounds like. The tools below exist to avoid both traps: normalizeRms() instead of
// peak, and envelopeSwell()/discrete events instead of flat texture.

export const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Deterministic PRNG. Re-running the generator produces byte-identical output,
// so regenerating stems yields empty diffs.
// ---------------------------------------------------------------------------
export function hashStringToSeed(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh, independent RNG stream derived from a parent — for decorrelating layers. */
export function forkRng(rng, label) {
  return mulberry32(hashStringToSeed(`${label}:${Math.floor(rng() * 0xffffffff)}`));
}

export const rand = (rng, lo, hi) => lo + rng() * (hi - lo);
export const randInt = (rng, lo, hi) => Math.floor(rand(rng, lo, hi + 1));
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/** Gaussian via Box-Muller — natural spread for pitch, timing, level. */
export function randNorm(rng, mean = 0, sd = 1) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------
export function whiteNoise(n, rng) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

export function brownNoise(n, rng) {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.2;
  }
  return out;
}

export function pinkNoise(n, rng) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Biquads (RBJ cookbook).
//
// The old generator recomputed sin/cos/divisions *per sample* to support an LFO on
// the cutoff — at 0.015-0.07 Hz, i.e. a period of 14-67 s over a 45 s render. That is
// an enormous per-sample cost for modulation nobody can hear. Here coefficients are
// computed once per filter; where genuine movement is wanted it comes from the
// content (events, gusts, swells), not from a barely-moving cutoff.
// ---------------------------------------------------------------------------
function biquadCoeffs(type, freq, q, sampleRate, gainDb = 0) {
  const w0 = (TWO_PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Math.max(0.05, q));
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'bandpass': // constant peak gain
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'peaking': {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cosw0; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosw0; a2 = 1 - alpha / A;
      break;
    }
    default:
      throw new Error(`unknown biquad type: ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Filter a whole buffer in place-free fashion with fixed coefficients. */
export function filter(input, { type, freq, q = 0.707, sampleRate, gainDb = 0 }) {
  const { b0, b1, b2, a1, a2 } = biquadCoeffs(type, freq, q, sampleRate, gainDb);
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Chain several filter specs. */
export function filterChain(input, specs, sampleRate) {
  let buf = input;
  for (const spec of specs) buf = filter(buf, { ...spec, sampleRate });
  return buf;
}

/**
 * A resonant bandpass whose centre frequency follows a per-sample control signal.
 * Used for formant transitions and for the tyre/engine sweep of a passing car —
 * places where the movement genuinely is the point.
 */
export function sweptBandpass(input, freqSignal, q, sampleRate) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let lastFreq = -1;
  let c = null;
  for (let i = 0; i < input.length; i++) {
    const f = freqSignal[i];
    // Recompute only when the target moves meaningfully (>0.5%): keeps this cheap
    // without the audible stepping of a coarse grid.
    if (lastFreq < 0 || Math.abs(f - lastFreq) > lastFreq * 0.005) {
      c = biquadCoeffs('bandpass', f, q, sampleRate);
      lastFreq = f;
    }
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** One-pole lowpass, for smoothing control signals (envelopes, gust contours). */
export function onePole(input, cutoffHz, sampleRate) {
  const a = Math.exp((-TWO_PI * cutoffHz) / sampleRate);
  const out = new Float32Array(input.length);
  let z = 0;
  for (let i = 0; i < input.length; i++) {
    z = input[i] * (1 - a) + z * a;
    out[i] = z;
  }
  return out;
}

export function dcBlock(input, sampleRate) {
  const r = 1 - (TWO_PI * 12) / sampleRate;
  const out = new Float32Array(input.length);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = input[i] - x1 + r * y1;
    x1 = input[i];
    y1 = y;
    out[i] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Buffer helpers
// ---------------------------------------------------------------------------
export function mix(buffers, gains) {
  const len = Math.max(...buffers.map(b => b.length));
  const out = new Float32Array(len);
  for (let b = 0; b < buffers.length; b++) {
    const buf = buffers[b];
    const g = gains?.[b] ?? 1;
    if (g === 0) continue;
    for (let i = 0; i < buf.length; i++) out[i] += buf[i] * g;
  }
  return out;
}

export function scale(buf, g) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * g;
  return out;
}

/** Add `src` into `dst` at sample offset `at`, wrapping past the end. */
export function addAt(dst, src, at, gain = 1) {
  const n = dst.length;
  if (n === 0) return dst;
  let idx = ((at % n) + n) % n;
  for (let i = 0; i < src.length; i++) {
    dst[idx] += src[i] * gain;
    idx++;
    if (idx >= n) idx = 0;
  }
  return dst;
}

export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

export function peak(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  return m;
}

/**
 * Normalise to an RMS target, not a peak target.
 *
 * This is the fix for the single worst bug in the old renderer. `normalize(buf, -6)`
 * scaled by peak; because the low-frequency layer carried the peaks, it dictated the
 * level and everything above 250 Hz got crushed. Targeting RMS makes the *audible*
 * level consistent and leaves transients room to poke out — which is what makes
 * discrete events read as events.
 *
 * `ceilingDb` is a safety clamp only; if the peak would exceed it, soft-clip rather
 * than rescale, so a couple of loud clinks don't drag the whole bed down.
 */
export function normalizeRms(buf, targetDbFs = -24, ceilingDb = -1.5) {
  const current = rms(buf);
  if (current === 0) return buf;
  const target = Math.pow(10, targetDbFs / 20);
  const out = scale(buf, target / current);
  const ceiling = Math.pow(10, ceilingDb / 20);
  const p = peak(out);
  if (p > ceiling) softClip(out, ceiling);
  return out;
}

/** tanh-style soft clip in place; transparent below the knee. */
export function softClip(buf, ceiling = 0.89) {
  const knee = ceiling * 0.7;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const a = Math.abs(x);
    if (a <= knee) continue;
    const over = (a - knee) / (ceiling - knee);
    const shaped = knee + (ceiling - knee) * Math.tanh(over);
    buf[i] = Math.sign(x) * shaped;
  }
  return buf;
}

/** Broad spectral tilt in dB per octave, hinged at 1 kHz. Cheap 3-band approximation. */
export function tilt(buf, dbPerOctave, sampleRate) {
  if (dbPerOctave === 0) return buf;
  const low = filter(buf, { type: 'lowpass', freq: 500, q: 0.6, sampleRate });
  const high = filter(buf, { type: 'highpass', freq: 2000, q: 0.6, sampleRate });
  const mid = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) mid[i] = buf[i] - low[i] - high[i];
  const gLow = Math.pow(10, (-dbPerOctave * 1.0) / 20);
  const gHigh = Math.pow(10, (dbPerOctave * 1.0) / 20);
  return mix([low, mid, high], [gLow, 1, gHigh]);
}

// ---------------------------------------------------------------------------
// Amplitude structure
// ---------------------------------------------------------------------------

/**
 * Slow multi-octave amplitude drift: the thing the old beds had none of.
 *
 * A real room breathes — the crowd swells and thins, traffic comes in waves. Summing
 * a few sine LFOs at 1/30, 1/17, 1/7 Hz with random phase gives an aperiodic contour
 * over a 20-30 s loop. `depthDb` of 6-10 alone lifts the measured p5-p95 loudness
 * range out of the "stationary noise" zone.
 */
export function envelopeSwell(n, sampleRate, { depthDb = 7, rates = [1 / 31, 1 / 17, 1 / 7.3], rng }) {
  const out = new Float32Array(n);
  const phases = rates.map(() => rng() * TWO_PI);
  const weights = rates.map((_, i) => 1 / (i + 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (let k = 0; k < rates.length; k++) v += weights[k] * Math.sin(TWO_PI * rates[k] * t + phases[k]);
    v /= wsum; // -1..1
    out[i] = Math.pow(10, (v * depthDb * 0.5) / 20);
  }
  return out;
}

export function applyEnvelope(buf, env) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * env[i % env.length];
  return out;
}

/** Percussive envelope: near-instant attack, exponential decay. The opposite of the
 *  old `sin²` speck envelope, which faded *in* and so never read as an impact. */
export function percussiveEnv(n, sampleRate, { attackMs = 1.2, decayS = 0.3, curve = 1 }) {
  const out = new Float32Array(n);
  const attack = Math.max(1, Math.floor((attackMs / 1000) * sampleRate));
  const k = 1 / Math.max(1e-4, decayS * sampleRate);
  for (let i = 0; i < n; i++) {
    const a = i < attack ? i / attack : 1;
    const d = Math.exp(-k * (i - Math.min(i, attack)) * curve);
    out[i] = a * d;
  }
  return out;
}

/** Gust/swell envelope: fast rise, slow fall — how wind and vehicle passes behave. */
export function gustEnv(n, { risePortion = 0.3 }) {
  const out = new Float32Array(n);
  const rise = Math.max(1, Math.floor(n * risePortion));
  for (let i = 0; i < n; i++) {
    if (i < rise) {
      const t = i / rise;
      out[i] = t * t * (3 - 2 * t); // smoothstep up
    } else {
      const t = (i - rise) / Math.max(1, n - rise);
      out[i] = Math.pow(1 - t, 1.8);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modal synthesis — what makes an impact sound like a material
//
// The runtime's playModalHit gives every partial the *same* amplitude envelope, so
// every strike reads as a synth bell. Real struck objects lose their high partials
// first: a porcelain cup's 4 kHz mode is gone in 80 ms while its 1.2 kHz mode rings
// for 400. Per-partial decay is the whole difference between "clink" and "beep".
// ---------------------------------------------------------------------------

/**
 * @param partials array of { freq, decayS, amp, detune? }
 */
export function modalHit(sampleRate, { partials, durationS, rng, noiseAmount = 0, noiseFreq = 3000 }) {
  const n = Math.max(1, Math.floor(durationS * sampleRate));
  const out = new Float32Array(n);

  for (const p of partials) {
    const w = (TWO_PI * p.freq) / sampleRate;
    const k = 1 / Math.max(1e-4, p.decayS * sampleRate);
    const phase0 = rng ? rng() * TWO_PI : 0;
    // Slight downward pitch drift as the excitation settles (real modes do this).
    const drift = p.detune ?? -0.004;
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-k * i);
      if (env < 1e-5) break;
      const f = w * (1 + drift * (i / n));
      out[i] += Math.sin(f * i + phase0) * p.amp * env;
    }
  }

  // The strike itself: a very short noise transient. Without it a modal stack sounds
  // synthesised, because real contact always produces broadband noise at t=0.
  if (noiseAmount > 0 && rng) {
    const tn = Math.max(2, Math.floor(0.004 * sampleRate));
    const burst = filter(whiteNoise(tn, rng), { type: 'highpass', freq: noiseFreq, q: 0.7, sampleRate });
    const env = percussiveEnv(tn, sampleRate, { attackMs: 0.2, decayS: 0.004 });
    for (let i = 0; i < tn; i++) out[i] += burst[i] * env[i] * noiseAmount;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Formants — what makes filtered noise sound like a voice
// ---------------------------------------------------------------------------

/** Spanish 5-vowel system: [F1, F2, F3, F4] in Hz, roughly male-average. */
export const VOWEL_FORMANTS = {
  a: [800, 1200, 2600, 3400],
  e: [420, 2000, 2650, 3400],
  i: [300, 2300, 3000, 3600],
  o: [500, 900, 2550, 3400],
  u: [325, 750, 2400, 3300],
};
export const VOWELS = ['a', 'e', 'i', 'o', 'u'];

/**
 * Parallel resonator bank. Q of 8-14 is what actually produces a vowel; the runtime's
 * Q=0.65 "formant" is a gentle tilt that leaves noise sounding like noise.
 */
export function formantBank(input, formantSignals, sampleRate, { q = 10, amps = [1, 0.7, 0.35, 0.2] } = {}) {
  let out = null;
  for (let f = 0; f < formantSignals.length; f++) {
    // Higher formants need higher Q to stay distinct.
    const band = sweptBandpass(input, formantSignals[f], q * (1 + f * 0.25), sampleRate);
    const a = amps[f] ?? 0.2;
    if (!out) {
      out = new Float32Array(band.length);
      for (let i = 0; i < band.length; i++) out[i] = band[i] * a;
    } else {
      for (let i = 0; i < band.length; i++) out[i] += band[i] * a;
    }
  }
  return out ?? new Float32Array(input.length);
}

// ---------------------------------------------------------------------------
// Room impulse responses
//
// The runtime IR is full-density white noise with a (1-t)^decay envelope: no early
// reflections, no HF damping, no pre-delay. That is a plate reverb, not a room — and
// it was being applied at 1.1 s to *outdoor* street scenes.
//
// What makes a space read as a space:
//   1. pre-delay + sparse early reflections (their timing encodes room size)
//   2. a diffuse tail whose density grows with time
//   3. frequency-dependent decay — air and soft surfaces eat the highs first
// ---------------------------------------------------------------------------

export const ROOM_SIZES = {
  small: { dimensions: [4.5, 3.2, 2.6], rt60: 0.45, damping: 0.55 },
  medium: { dimensions: [9, 6.5, 3.2], rt60: 0.8, damping: 0.45 },
  large: { dimensions: [22, 16, 7], rt60: 1.6, damping: 0.35 },
  hall: { dimensions: [40, 28, 12], rt60: 2.6, damping: 0.3 },
  outdoor: { dimensions: [60, 60, 30], rt60: 0.25, damping: 0.75 },
};

export function renderIR(sampleRate, { size = 'medium', rt60, damping, rng, stereo = true }) {
  const spec = ROOM_SIZES[size] ?? ROOM_SIZES.medium;
  const tail = rt60 ?? spec.rt60;
  const damp = damping ?? spec.damping;
  const n = Math.max(8, Math.floor(tail * 1.2 * sampleRate));
  const channels = stereo ? 2 : 1;
  const out = [];

  const [lx, ly, lz] = spec.dimensions;
  const c = 343; // m/s

  for (let ch = 0; ch < channels; ch++) {
    const buf = new Float32Array(n);

    // Direct-path pre-delay: the ear reads the gap before the first reflection as
    // distance-to-wall, i.e. as room size.
    const preDelay = Math.floor((Math.min(lx, ly) / 2 / c) * sampleRate);

    // Early reflections via a coarse image-source model over the 6 first-order and a
    // handful of second-order images. Outdoors there is essentially only the ground.
    const reflections = [];
    const wallDistances = size === 'outdoor'
      ? [lz / 2]
      : [lx / 2, ly / 2, lz / 2, lx, ly, lx * 0.75 + ly * 0.25, ly * 0.75 + lz * 0.25, lx + ly * 0.5];
    for (const d of wallDistances) {
      const jitter = 1 + (rng() - 0.5) * 0.08; // asymmetric room, and decorrelates L/R
      const delay = preDelay + Math.floor(((2 * d * jitter) / c) * sampleRate);
      const absorb = Math.pow(1 - damp * 0.5, 1 + d / 8);
      reflections.push({ delay, gain: absorb * (0.55 / (1 + d / 4)) * (rng() < 0.5 ? -1 : 1) });
    }
    for (const r of reflections) {
      if (r.delay < n) buf[r.delay] += r.gain;
    }

    // Diffuse tail: noise whose density ramps in (a real tail takes ~50-80 ms to go
    // fully dense) and whose envelope is a true exponential from RT60.
    const decayK = Math.log(1000) / Math.max(0.05, tail); // -60 dB at rt60
    const buildUp = Math.max(1, Math.floor(0.06 * sampleRate));
    const tailBuf = new Float32Array(n);
    for (let i = preDelay; i < n; i++) {
      const t = i / sampleRate;
      const density = Math.min(1, (i - preDelay) / buildUp);
      if (rng() > density * 0.85) continue; // sparse early, dense later
      tailBuf[i] = (rng() * 2 - 1) * Math.exp(-decayK * t);
    }

    // Frequency-dependent decay: split the tail and let the high band die faster.
    // This is what stops a synthetic reverb sounding like a metallic wash.
    const hiCut = size === 'outdoor' ? 1800 : 5200 - damp * 3000;
    const lowTail = filter(tailBuf, { type: 'lowpass', freq: hiCut, q: 0.7, sampleRate });
    const hiTail = filter(tailBuf, { type: 'highpass', freq: hiCut, q: 0.7, sampleRate });
    const hiK = decayK * (1.8 + damp * 2.2);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      buf[i] += lowTail[i] * 0.9 + hiTail[i] * Math.exp(-(hiK - decayK) * t) * 0.7;
    }

    out.push(normalizeRms(dcBlock(buf, sampleRate), -20, -0.5));
  }

  return out; // array of 1 or 2 Float32Array
}

// ---------------------------------------------------------------------------
// FFT + overlap-add convolution
// ---------------------------------------------------------------------------

/** In-place iterative radix-2 FFT. `re`/`im` must be power-of-two length. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? TWO_PI : -TWO_PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

function nextPow2(x) {
  let n = 1;
  while (n < x) n <<= 1;
  return n;
}

/**
 * Overlap-add convolution. `circular: true` wraps the tail back to the head, which is
 * what a seamlessly-looping bed needs — otherwise the reverb tail of the last event
 * is missing at the loop point and you hear the seam.
 */
export function convolve(input, ir, { circular = false } = {}) {
  const irLen = ir.length;
  const fftSize = nextPow2(irLen * 4);
  const blockSize = fftSize - irLen + 1;

  const irRe = new Float64Array(fftSize);
  const irIm = new Float64Array(fftSize);
  irRe.set(ir);
  fft(irRe, irIm);

  const outLen = input.length + irLen - 1;
  const acc = new Float64Array(outLen);

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let pos = 0; pos < input.length; pos += blockSize) {
    const len = Math.min(blockSize, input.length - pos);
    re.fill(0); im.fill(0);
    for (let i = 0; i < len; i++) re[i] = input[pos + i];
    fft(re, im);
    for (let i = 0; i < fftSize; i++) {
      const ar = re[i], ai = im[i];
      re[i] = ar * irRe[i] - ai * irIm[i];
      im[i] = ar * irIm[i] + ai * irRe[i];
    }
    fft(re, im, true);
    const limit = Math.min(fftSize, outLen - pos);
    for (let i = 0; i < limit; i++) acc[pos + i] += re[i];
  }

  const out = new Float32Array(input.length);
  if (circular) {
    for (let i = 0; i < outLen; i++) out[i % input.length] += acc[i];
  } else {
    for (let i = 0; i < input.length; i++) out[i] = acc[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Movement: Doppler, panning, distance
// ---------------------------------------------------------------------------

/**
 * Resample with a per-sample rate signal (linear interpolation). This is how a car
 * gets its pitch drop as it passes — the cue that says "that thing moved past me",
 * which no amount of filtered noise can fake.
 */
export function resampleVariable(input, rateSignal) {
  const out = new Float32Array(rateSignal.length);
  let pos = 0;
  for (let i = 0; i < rateSignal.length; i++) {
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[Math.min(input.length - 1, i0)];
    const b = input[Math.min(input.length - 1, i0 + 1)];
    out[i] = a + (b - a) * frac;
    pos += rateSignal[i];
    if (pos >= input.length - 1) pos = input.length - 1;
  }
  return out;
}

/** Constant-power pan of a mono buffer into [L, R]. `pan` in -1..1. */
export function panMono(buf, pan) {
  const a = ((pan + 1) / 2) * (Math.PI / 2);
  const gl = Math.cos(a), gr = Math.sin(a);
  return [scale(buf, gl), scale(buf, gr)];
}

/**
 * Distance cue: air absorption (lowpass) plus 1/r attenuation. A distant siren isn't
 * just quieter, it has lost its highs — get that wrong and everything sounds like
 * it's happening at arm's length, which is a big part of why the current mix feels
 * flat and "in your head".
 */
export function applyDistance(buf, meters, sampleRate) {
  const cutoff = Math.max(700, 16000 - meters * 260);
  const attenuated = scale(buf, 1 / (1 + meters / 6));
  return filter(attenuated, { type: 'lowpass', freq: cutoff, q: 0.6, sampleRate });
}

/**
 * Stereo decorrelation of a mono source.
 *
 * Everything continuous in the current system is mono — the WAV beds and every
 * synthetic noise buffer. Real ambience gets most of its sense of place from the two
 * ears hearing *different* things. A short allpass chain per channel (different delay
 * primes) leaves the spectrum untouched but scrambles phase differently on each side,
 * which widens the image without the comb filtering a plain delay would cause.
 */
export function decorrelate(buf, sampleRate, { rng, amount = 1 }) {
  const primesL = [37, 83, 149];
  const primesR = [53, 101, 173];
  const build = (primes) => {
    let sig = buf;
    for (const p of primes) {
      const delay = Math.max(1, Math.floor((p / 1000) * sampleRate * 0.12 * (0.85 + rng() * 0.3)));
      const g = 0.6;
      const out = new Float32Array(sig.length);
      const buffer = new Float32Array(delay);
      let idx = 0;
      for (let i = 0; i < sig.length; i++) {
        const delayed = buffer[idx];
        const v = sig[i] + -g * delayed;
        buffer[idx] = v;
        out[i] = delayed + g * v;
        idx = (idx + 1) % delay;
      }
      sig = out;
    }
    return sig;
  };
  const l = build(primesL);
  const r = build(primesR);
  if (amount >= 1) return [l, r];
  const outL = new Float32Array(buf.length);
  const outR = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    outL[i] = buf[i] * (1 - amount) + l[i] * amount;
    outR[i] = buf[i] * (1 - amount) + r[i] * amount;
  }
  return [outL, outR];
}

// ---------------------------------------------------------------------------
// Event scheduling
// ---------------------------------------------------------------------------

/**
 * Poisson arrival times over `durationS`, optionally clustered.
 *
 * Uniform `min..max` intervals (what the runtime does today) sound mechanical: a
 * footstep every 4 seconds is not walking, it's a metronome. Real events arrive in
 * bursts — a run of steps, two cups in a row, a knot of cars at a light. `burst`
 * spawns short follow-up clusters to reproduce that.
 */
export function poissonTimes(durationS, ratePerSecond, rng, { burst = 0, burstGapS = [0.08, 0.35], burstMax = 4 } = {}) {
  const times = [];
  let t = 0;
  while (t < durationS) {
    t += -Math.log(Math.max(1e-9, rng())) / ratePerSecond;
    if (t >= durationS) break;
    times.push(t);
    if (burst > 0 && rng() < burst) {
      const count = 1 + Math.floor(rng() * burstMax);
      let bt = t;
      for (let i = 0; i < count; i++) {
        bt += rand(rng, burstGapS[0], burstGapS[1]);
        if (bt < durationS) times.push(bt);
      }
    }
  }
  return times;
}

// ---------------------------------------------------------------------------
// Seamless looping
// ---------------------------------------------------------------------------

/**
 * Render `duration + crossfade` and equal-power blend the tail into the head.
 *
 * Note `renderFn` receives the *total* length: events placed with addAt() wrap
 * naturally, and the crossfade then makes the join inaudible.
 */
export function makeSeamlessLoop(renderFn, { durationS, crossfadeS, sampleRate, rng }) {
  const totalSamples = Math.floor((durationS + crossfadeS) * sampleRate);
  const durationSamples = Math.floor(durationS * sampleRate);
  const crossfadeSamples = totalSamples - durationSamples;

  const raw = renderFn(totalSamples, rng);
  const channels = Array.isArray(raw) ? raw : [raw];

  const out = channels.map((chan) => {
    const buf = new Float32Array(durationSamples);
    buf.set(chan.subarray(0, durationSamples));
    for (let i = 0; i < crossfadeSamples; i++) {
      const tailSample = chan[durationSamples + i];
      const t = i / crossfadeSamples;
      const fadeIn = Math.sin((t * Math.PI) / 2);
      const fadeOut = Math.cos((t * Math.PI) / 2);
      buf[i] = buf[i] * fadeIn + tailSample * fadeOut;
    }
    return buf;
  });

  return Array.isArray(raw) ? out : out[0];
}

// ---------------------------------------------------------------------------
// WAV I/O
// ---------------------------------------------------------------------------
export function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** `channels` is one Float32Array (mono) or an array of them (interleaved on write). */
export function encodeWav(channels, sampleRate) {
  const chans = Array.isArray(channels) ? channels : [channels];
  const numChannels = chans.length;
  const frames = chans[0].length;
  const interleaved = new Float32Array(frames * numChannels);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) interleaved[i * numChannels + c] = chans[c][i];
  }
  const pcm = floatTo16BitPCM(interleaved);
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2 * numChannels, 28);
  buffer.writeUInt16LE(2 * numChannels, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buffer.writeInt16LE(pcm[i], 44 + i * 2);
  return buffer;
}

export function decodeWav(buffer) {
  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  let off = 12, dataOff = 0, dataLen = 0;
  while (off < buffer.length - 8) {
    const id = buffer.toString('ascii', off, off + 4);
    const size = buffer.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  const frames = dataLen / 2 / numChannels;
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] = buffer.readInt16LE(dataOff + (i * numChannels + c) * 2) / 32768;
    }
  }
  return { channels, sampleRate, numChannels, frames };
}

// ---------------------------------------------------------------------------
// Analysis — the same measurements used to diagnose the old beds, so the
// generator and the test suite agree on what "sounds like a place" means.
// ---------------------------------------------------------------------------

/** Fraction of total energy below `hz`. The old beds sat at 0.62-0.77. */
export function lowEnergyRatio(buf, sampleRate, hz = 250) {
  const N = 4096;
  let low = 0, total = 0;
  for (let start = 0; start + N < buf.length; start += N * 3) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = buf[start + i] * (0.5 - 0.5 * Math.cos(TWO_PI * i / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = re[k] * re[k] + im[k] * im[k];
      total += mag;
      if ((k * sampleRate) / N < hz) low += mag;
    }
  }
  return total > 0 ? low / total : 0;
}

/** Short-term loudness range in dB (p5..p95 over 250 ms windows).
 *  Field recordings: 15-25 dB. The old beds: 2.2-3.7 dB. */
export function loudnessRangeDb(buf, sampleRate, windowS = 0.25) {
  const w = Math.max(1, Math.floor(windowS * sampleRate));
  const levels = [];
  for (let i = 0; i + w <= buf.length; i += w) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum += buf[j] * buf[j];
    const r = Math.sqrt(sum / w);
    levels.push(20 * Math.log10(Math.max(1e-7, r)));
  }
  if (levels.length < 4) return 0;
  levels.sort((a, b) => a - b);
  const at = (p) => levels[Math.min(levels.length - 1, Math.floor(p * levels.length))];
  return at(0.95) - at(0.05);
}

/** Log-spaced band energies (dB, normalised to total) — the fingerprint used to
 *  assert that two scenes are actually different. */
export function bandProfile(buf, sampleRate, edges = [60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000]) {
  const N = 4096;
  const bands = new Float64Array(edges.length - 1);
  let total = 0;
  for (let start = 0; start + N < buf.length; start += N * 3) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = buf[start + i] * (0.5 - 0.5 * Math.cos(TWO_PI * i / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sampleRate) / N;
      const mag = re[k] * re[k] + im[k] * im[k];
      total += mag;
      for (let b = 0; b < bands.length; b++) {
        if (f >= edges[b] && f < edges[b + 1]) { bands[b] += mag; break; }
      }
    }
  }
  return Array.from(bands, (v) => 10 * Math.log10(Math.max(1e-12, v / Math.max(1e-12, total))));
}

/** Euclidean distance between two band profiles, in dB. */
export function spectralDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
