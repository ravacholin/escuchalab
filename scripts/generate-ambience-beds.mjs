#!/usr/bin/env node
// Offline generator for the ambience stems bundled at public/ambience/*.wav.
//
// Run with:  npm run ambience:build
//
// These are the CONTINUOUS textures. Discrete, identifying one-shots near the
// listener (a specific cup, the door, a car going past you) are synthesised live at
// playback time by services/ambienceEngine.ts, so they never repeat with the loop.
//
// What gets baked here is what benefits from an offline compute budget a realtime
// Web Audio graph could not afford: a dozen independently-synthesised speaking
// voices, FFT convolution with a real room impulse response, dense transient grain.
//
// Baking also means the app ships same-origin static assets: no external ambience
// API, nothing to rate-limit, no keys, no CORS, and no runtime failure mode beyond
// "the file didn't load", which degrades to live synthesis.
//
// Output is deterministic (seeded per stem), so re-running produces byte-identical
// files and regeneration shows up as an empty diff.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { encodeWav, lowEnergyRatio, loudnessRangeDb, rms, peak } from './ambience/dsp.mjs';
import { STEMS, STEM_IDS, bakeStem } from './ambience/stems.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/ambience');

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const targets = only.length > 0 ? only : STEM_IDS;

for (const id of targets) {
  if (!STEMS[id]) {
    console.error(`Unknown stem "${id}". Known: ${STEM_IDS.join(', ')}`);
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

let totalBytes = 0;
const rows = [];

for (const id of targets) {
  const started = Date.now();
  const { channels, sampleRate, spec } = bakeStem(id);
  const wav = encodeWav(channels.length === 1 ? channels[0] : channels, sampleRate);
  const outPath = path.join(OUT_DIR, `${id}.wav`);
  writeFileSync(outPath, wav);
  totalBytes += wav.length;

  // Report the same two measurements the check script asserts on, so a bad recipe is
  // obvious the moment it is baked rather than three steps later.
  const low = lowEnergyRatio(channels[0], sampleRate);
  const lra = loudnessRangeDb(channels[0], sampleRate);
  rows.push({
    id,
    sr: sampleRate,
    ch: channels.length,
    dur: spec.durationS,
    mb: wav.length / (1024 * 1024),
    low,
    lra,
    peak: peak(channels[0]),
    secs: (Date.now() - started) / 1000,
    lowOk: low <= spec.expect.maxLowRatio,
    lraOk: lra >= spec.expect.minLoudnessRange,
  });
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n, d = 2) => v.toFixed(d).padStart(n);

console.log('');
console.log(`${pad('stem', 15)} ${pad('sr', 6)} ${pad('ch', 3)} ${pad('s', 4)} ${pad('MB', 6)} ${pad('<250Hz', 8)} ${pad('LRA dB', 8)} ${pad('peak', 6)} time`);
console.log('-'.repeat(78));
for (const r of rows) {
  console.log(
    `${pad(r.id, 15)} ${pad(r.sr, 6)} ${pad(r.ch, 3)} ${pad(r.dur, 4)} ${num(r.mb, 6)} ` +
    `${num(r.low, 6, 3)}${r.lowOk ? '  ' : ' !'} ${num(r.lra, 6, 1)}${r.lraOk ? '  ' : ' !'} ` +
    `${num(r.peak, 6, 3)} ${num(r.secs, 5, 1)}s`,
  );
}
console.log('-'.repeat(78));
console.log(`${pad('total', 15)} ${pad('', 6)} ${pad('', 3)} ${pad('', 4)} ${num(totalBytes / (1024 * 1024), 6)} MB`);

const failures = rows.filter(r => !r.lowOk || !r.lraOk);
if (failures.length > 0) {
  console.log('');
  console.log('Stems flagged (!) miss their acoustic targets — npm run check:ambience will fail:');
  for (const r of failures) {
    const spec = STEMS[r.id].expect;
    if (!r.lowOk) console.log(`  ${r.id}: ${(r.low * 100).toFixed(1)}% of energy below 250 Hz (max ${(spec.maxLowRatio * 100).toFixed(0)}%) — too much rumble, not enough audible detail`);
    if (!r.lraOk) console.log(`  ${r.id}: loudness range ${r.lra.toFixed(1)} dB (min ${spec.minLoudnessRange}) — too stationary, reads as noise`);
  }
}
console.log('');
