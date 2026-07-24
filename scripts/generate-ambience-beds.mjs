#!/usr/bin/env node
// Offline generator for the ambient "bed" textures bundled at public/ambience/*.wav.
//
// These are NOT the discrete/foreground sound events (footsteps, doors, crowd babble,
// honks, etc.) — those stay fully synthesized live at playback time in
// components/AudioPlayer.tsx, which is what already gives per-play variety.
//
// This script bakes only the continuous background "air"/"room" texture per
// EnvironmentProfile (services/ambiencePresets.ts) as a seamless, long, richly
// layered loop. Baking offline lets us spend far more compute per sample than a
// realtime Web Audio graph could (long slow LFOs, many stacked noise layers)
// without any runtime cost, and — critically — ships as a same-origin static
// asset, so there is zero external network dependency, no CORS, no API keys,
// and no rate limits in production.
//
// Run with: node scripts/generate-ambience-beds.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/ambience');

const SAMPLE_RATE = 24000;
const DURATION_SECONDS = 42;
const CROSSFADE_SECONDS = 3;

// ---------------------------------------------------------------------------
// Deterministic PRNG (same family as components/AudioPlayer.tsx) so re-running
// this script produces byte-identical output — useful for diffing/regen.
// ---------------------------------------------------------------------------
function hashStringToSeed(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Noise generators (same shaping as the live engine, offline budget only).
// ---------------------------------------------------------------------------
function whiteNoise(n, rng) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

function brownNoise(n, rng) {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.2;
  }
  return out;
}

function pinkNoise(n, rng) {
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
// Minimal RBJ biquad filter (lowpass / highpass / bandpass), with support for
// per-sample cutoff modulation (used for slow "breathing" LFO drift).
// ---------------------------------------------------------------------------
function makeBiquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return function process(sample, freq, q, sampleRate) {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.max(0.1, q));
    const cosw0 = Math.cos(w0);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
    } else {
      // bandpass (constant skirt gain)
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    const y = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = sample;
    y2 = y1; y1 = y;
    return y;
  };
}

function filterWithLfoCutoff(input, { type, baseFreq, freqSpread, lfoHz, q, rng, phase = 0 }) {
  const filter = makeBiquad(type);
  const out = new Float32Array(input.length);
  const lfoPhaseOffset = phase + rng() * Math.PI * 2;
  for (let i = 0; i < input.length; i++) {
    const t = i / SAMPLE_RATE;
    const lfo = Math.sin(t * 2 * Math.PI * lfoHz + lfoPhaseOffset);
    const freq = Math.max(40, baseFreq + lfo * freqSpread);
    out[i] = filter(input[i], freq, q, SAMPLE_RATE);
  }
  return out;
}

function gainRamp(buf, fromGain, toGain) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const t = i / (buf.length - 1);
    out[i] = buf[i] * (fromGain + (toGain - fromGain) * t);
  }
  return out;
}

function mix(buffers, gains) {
  const len = buffers[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let b = 0; b < buffers.length; b++) s += buffers[b][i] * (gains[b] ?? 1);
    out[i] = s;
  }
  return out;
}

// Sparse, very soft one-shot "specks" baked into the texture — subtle grain,
// not discrete "events" (those stay live). Adds a few random tonal micro-hits
// so the loop doesn't read as pure filtered noise.
function addSpecks(buf, { count, ampRange, freqRange, durMsRange, rng }) {
  const out = Float32Array.from(buf);
  for (let k = 0; k < count; k++) {
    const startT = rng() * (DURATION_SECONDS - 2);
    const start = Math.floor(startT * SAMPLE_RATE);
    const durMs = durMsRange[0] + rng() * (durMsRange[1] - durMsRange[0]);
    const durSamples = Math.floor((durMs / 1000) * SAMPLE_RATE);
    const freq = freqRange[0] + rng() * (freqRange[1] - freqRange[0]);
    const amp = ampRange[0] + rng() * (ampRange[1] - ampRange[0]);
    for (let i = 0; i < durSamples && start + i < out.length; i++) {
      const t = i / durSamples;
      const env = Math.sin(Math.PI * t) ** 2; // smooth in/out
      out[start + i] += Math.sin(2 * Math.PI * freq * (i / SAMPLE_RATE)) * amp * env;
    }
  }
  return out;
}

function normalize(buf, peakDb = -4) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max === 0) return buf;
  const targetPeak = Math.pow(10, peakDb / 20);
  const scale = targetPeak / max;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * scale;
  return out;
}

// Seamless loop: render duration + crossfade, then equal-power blend the tail
// into the head so buf[0..durationSamples) loops with no audible seam.
function makeSeamlessLoop(renderFn, rng) {
  const totalSamples = Math.floor((DURATION_SECONDS + CROSSFADE_SECONDS) * SAMPLE_RATE);
  const durationSamples = Math.floor(DURATION_SECONDS * SAMPLE_RATE);
  const crossfadeSamples = totalSamples - durationSamples;

  const raw = renderFn(totalSamples, rng);
  const out = new Float32Array(durationSamples);
  for (let i = 0; i < durationSamples; i++) out[i] = raw[i];

  for (let i = 0; i < crossfadeSamples; i++) {
    const tailSample = raw[durationSamples + i];
    const t = i / crossfadeSamples; // 0..1 across the fade region (start of loop)
    const fadeIn = Math.sin((t * Math.PI) / 2);
    const fadeOut = Math.cos((t * Math.PI) / 2);
    out[i] = out[i] * fadeIn + tailSample * fadeOut;
  }
  return out;
}

// ---------------------------------------------------------------------------
// WAV (PCM16 mono) writer.
// ---------------------------------------------------------------------------
function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function writeWavFile(filePath, float32, sampleRate) {
  const pcm = floatTo16BitPCM(float32);
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], 44 + i * 2);
  }

  writeFileSync(filePath, buffer);
}

// ---------------------------------------------------------------------------
// Per-profile texture recipes.
// ---------------------------------------------------------------------------
const PROFILES = {
  cafe: (n, rng) => {
    const low = filterWithLfoCutoff(brownNoise(n, rng), { type: 'lowpass', baseFreq: 260, freqSpread: 60, lfoHz: 0.03, q: 0.6, rng });
    const room = filterWithLfoCutoff(pinkNoise(n, rng), { type: 'bandpass', baseFreq: 900, freqSpread: 300, lfoHz: 0.045, q: 0.7, rng });
    const air = filterWithLfoCutoff(whiteNoise(n, rng), { type: 'highpass', baseFreq: 2600, freqSpread: 400, lfoHz: 0.02, q: 0.5, rng });
    let bed = mix([low, room, air], [0.5, 0.22, 0.03]);
    bed = addSpecks(bed, { count: 10, ampRange: [0.006, 0.02], freqRange: [1400, 3200], durMsRange: [40, 140], rng });
    return normalize(bed, -6);
  },
  city: (n, rng) => {
    const rumble = filterWithLfoCutoff(brownNoise(n, rng), { type: 'lowpass', baseFreq: 200, freqSpread: 70, lfoHz: 0.02, q: 0.5, rng });
    const traffic = filterWithLfoCutoff(pinkNoise(n, rng), { type: 'bandpass', baseFreq: 340, freqSpread: 180, lfoHz: 0.035, q: 0.5, rng });
    const air = filterWithLfoCutoff(whiteNoise(n, rng), { type: 'highpass', baseFreq: 3000, freqSpread: 500, lfoHz: 0.025, q: 0.5, rng });
    let bed = mix([rumble, traffic, air], [0.55, 0.28, 0.025]);
    bed = addSpecks(bed, { count: 4, ampRange: [0.01, 0.025], freqRange: [220, 420], durMsRange: [300, 700], rng });
    return normalize(bed, -5);
  },
  office: (n, rng) => {
    const hush = filterWithLfoCutoff(pinkNoise(n, rng), { type: 'lowpass', baseFreq: 380, freqSpread: 60, lfoHz: 0.025, q: 0.6, rng });
    const hvac = filterWithLfoCutoff(whiteNoise(n, rng), { type: 'bandpass', baseFreq: 1400, freqSpread: 200, lfoHz: 0.015, q: 0.9, rng });
    let bed = mix([hush, hvac], [0.4, 0.05]);
    bed = addSpecks(bed, { count: 6, ampRange: [0.004, 0.012], freqRange: [1800, 3400], durMsRange: [15, 40], rng });
    return normalize(bed, -8);
  },
  nature: (n, rng) => {
    const wind = filterWithLfoCutoff(pinkNoise(n, rng), { type: 'lowpass', baseFreq: 900, freqSpread: 500, lfoHz: 0.05, q: 0.5, rng });
    const leaves = filterWithLfoCutoff(whiteNoise(n, rng), { type: 'bandpass', baseFreq: 3200, freqSpread: 800, lfoHz: 0.07, q: 0.4, rng });
    let bed = mix([wind, leaves], [0.35, 0.05]);
    bed = addSpecks(bed, { count: 14, ampRange: [0.01, 0.03], freqRange: [1800, 3800], durMsRange: [70, 180], rng });
    return normalize(bed, -6);
  },
  room: (n, rng) => {
    const hush = filterWithLfoCutoff(brownNoise(n, rng), { type: 'lowpass', baseFreq: 220, freqSpread: 30, lfoHz: 0.02, q: 0.6, rng });
    const air = filterWithLfoCutoff(whiteNoise(n, rng), { type: 'bandpass', baseFreq: 2200, freqSpread: 300, lfoHz: 0.03, q: 0.6, rng });
    let bed = mix([hush, air], [0.35, 0.015]);
    bed = addSpecks(bed, { count: 3, ampRange: [0.003, 0.008], freqRange: [500, 1200], durMsRange: [80, 220], rng });
    return normalize(bed, -10);
  },
};

for (const [name, renderFn] of Object.entries(PROFILES)) {
  const rng = mulberry32(hashStringToSeed(`ambience-bed:${name}`));
  const loop = makeSeamlessLoop(renderFn, rng);
  const outPath = path.join(OUT_DIR, `${name}.wav`);
  writeWavFile(outPath, loop, SAMPLE_RATE);
  const sizeMb = (loop.length * 2) / (1024 * 1024);
  console.log(`Wrote ${outPath} (${DURATION_SECONDS}s, ${sizeMb.toFixed(2)} MB)`);
}
