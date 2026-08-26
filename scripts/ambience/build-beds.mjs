#!/usr/bin/env node
// Build the ambience beds: turn real public-domain field recordings into seamless
// mono loops bundled at public/ambience/<id>.wav, plus two honestly-synthetic
// "quiet air" beds for studios and small rooms.
//
// One ffmpeg pass per bed extracts a stable window as mono 22.05 kHz float PCM; the
// rest — RMS normalisation, the overlap-add loop crossfade that makes the buffer loop
// seamlessly, and 16-bit WAV encoding — is done here so the loop point is exact (no
// codec padding at the seam). Raw sources are cached in .ambience-cache/ and fetched
// from archive.org on demand, so this is reproducible from the manifest alone.
//
//   npm run ambience:build            # all beds
//   npm run ambience:build cafe rain  # a subset
//
// Deterministic: the synthetic beds use a fixed seed, so re-running gives identical
// files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// ffmpeg-static is an optional tool, not a runtime/CI dependency: the beds it produces
// are committed, so `npm test` and the build never need it. Rebuilding the beds does —
// install it on demand with `npm i -D ffmpeg-static`.
let ffmpegPath;
try { ffmpegPath = (await import('ffmpeg-static')).default; }
catch { console.error('This script needs ffmpeg-static. Install it with:  npm i -D ffmpeg-static'); process.exit(1); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'public', 'ambience');
const CACHE_DIR = path.join(ROOT, '.ambience-cache');

const RATE = 22050;          // shared sample rate for every bed
const XFADE = 2.0;           // seconds of overlap-add crossfade at the loop seam
const TARGET_RMS_DBFS = -24; // every real bed is normalised here so recipe gains compare

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8'));
const BEDS = manifest.beds;

// Two beds the app needs that no field recording gives you honestly: the near-silent
// air of a recording studio and of a quiet small room. These are broadband hiss plus a
// faint mains hum at a very low level — the one place synthesis is not pretending to be
// a place, only supplying the air a close-miked voice sits in.
const SYNTH_BEDS = {
  studio_air: { rmsDbfs: -38, loopSec: 12, tiltHz: 1400, humDb: -52 },
  room_air:   { rmsDbfs: -33, loopSec: 12, tiltHz: 2600, humDb: -48 },
};

function ensureRaw(id, spec) {
  const dest = path.join(CACHE_DIR, `${id}.mp3`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100_000) return dest;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const url = `https://archive.org/download/${spec.ia}/${encodeURIComponent(spec.file)}`;
  process.stdout.write(`  fetching ${id} from archive.org … `);
  execFileSync('curl', ['-s', '-L', '--max-time', '300', '-A', 'escuchalab-ambience/1.0', '-o', dest, url]);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 100_000) {
    throw new Error(`download failed for ${id} (${url})`);
  }
  process.stdout.write(`${(fs.statSync(dest).size / 1e6).toFixed(1)} MB\n`);
  return dest;
}

// Extract [start, start+dur] as mono float PCM at RATE. A gentle high-pass clears
// subsonic rumble that would otherwise eat headroom.
function extractFloat(src, start, dur) {
  const buf = execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(start), '-t', String(dur),
    '-i', src,
    '-ac', '1', '-ar', String(RATE),
    '-af', 'highpass=f=28',
    '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
  ], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

// Fold the tail back onto the head with an equal-power crossfade so the buffer loops
// seamlessly: the sample after the last one is, by construction, the first one.
function loopCrossfade(win, loopLen, xfLen) {
  const out = new Float32Array(loopLen);
  for (let i = 0; i < loopLen; i++) out[i] = win[i];
  for (let i = 0; i < xfLen; i++) {
    const t = (i / xfLen) * (Math.PI / 2);
    const wIn = Math.sin(t);   // head content fades in
    const wOut = Math.cos(t);  // tail content fades out
    out[i] = win[i] * wIn + win[loopLen + i] * wOut;
  }
  return out;
}

function normalise(x, targetDbfs) {
  const target = Math.pow(10, targetDbfs / 20);
  const cur = rms(x) || 1e-9;
  let g = target / cur;
  // Never let the gain push peaks into clipping; leave 1.5 dB of headroom.
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const peakCap = 0.84 / (peak * g || 1e-9);
  if (peakCap < 1) g *= peakCap;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

function encodeWav(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, 44 + i * 2);
  }
  return buf;
}

// --- deterministic noise for the synthetic air beds ------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthAir(spec, seed) {
  const len = Math.round((spec.loopSec + XFADE) * RATE);
  const rnd = mulberry32(seed);
  const x = new Float32Array(len);
  // Pink-ish noise: white through a one-pole low-pass whose cutoff sets the tilt.
  const k = Math.exp(-2 * Math.PI * (spec.tiltHz / RATE));
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    lp = w * (1 - k) + lp * k;
    x[i] = lp;
  }
  // Faint mains hum (50 Hz + its octave), so the air reads as a room and not as tape.
  const hum = Math.pow(10, spec.humDb / 20);
  for (let i = 0; i < len; i++) {
    const ph = (2 * Math.PI * i) / RATE;
    x[i] += hum * (Math.sin(50 * ph) + 0.4 * Math.sin(100 * ph));
  }
  const loopLen = Math.round(spec.loopSec * RATE);
  const out = loopCrossfade(x, loopLen, Math.round(XFADE * RATE));
  return normalise(out, spec.rmsDbfs);
}

// ---------------------------------------------------------------------------
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.slice(2);
  const want = (id) => only.length === 0 || only.includes(id);

  const rows = [];
  let totalBytes = 0;

  for (const [id, spec] of Object.entries(BEDS)) {
    if (!want(id)) continue;
    const src = ensureRaw(id, spec);
    const loopLen = Math.round(spec.loopSec * RATE);
    const win = extractFloat(src, spec.windowStart, spec.loopSec + XFADE);
    if (win.length < loopLen + Math.round(XFADE * RATE)) {
      throw new Error(`${id}: window too short (got ${(win.length / RATE).toFixed(1)}s)`);
    }
    let loop = loopCrossfade(win, loopLen, Math.round(XFADE * RATE));
    loop = normalise(loop, TARGET_RMS_DBFS);
    const wav = encodeWav(loop, RATE);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.wav`), wav);
    totalBytes += wav.length;
    rows.push({ id, kind: 'real', sec: spec.loopSec, kb: Math.round(wav.length / 1024), rms: (20 * Math.log10(rms(loop))).toFixed(1) });
  }

  for (const [id, spec] of Object.entries(SYNTH_BEDS)) {
    if (!want(id)) continue;
    const loop = synthAir(spec, 0x5eed ^ [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
    const wav = encodeWav(loop, RATE);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.wav`), wav);
    totalBytes += wav.length;
    rows.push({ id, kind: 'synth', sec: spec.loopSec, kb: Math.round(wav.length / 1024), rms: (20 * Math.log10(rms(loop))).toFixed(1) });
  }

  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${r.id.padEnd(16)} ${r.kind.padEnd(5)} ${String(r.sec).padStart(2)}s  ${String(r.kb).padStart(4)} KB  RMS ${r.rms} dBFS`);
  }
  console.log(`  ${'—'.repeat(44)}\n  total ${(totalBytes / 1e6).toFixed(1)} MB across ${rows.length} beds`);

  if (only.length === 0) writeCredits();
}

function writeCredits() {
  const lines = [
    '# Ambience beds — provenance',
    '',
    'The background ambience is built from **real field recordings in the public domain**',
    '(Public Domain Mark 1.0, no rights reserved), sourced from the [radio aporee](https://aporee.org/maps/)',
    'sound-maps collection on the Internet Archive. Each file below is a short seamless',
    'loop cut and normalised from its source by `scripts/ambience/build-beds.mjs`; the',
    'originals are longer recordings of the named place.',
    '',
    'Two beds are synthetic on purpose — the near-silent "air" of a recording studio and',
    'of a quiet small room — and carry no external provenance.',
    '',
    '| bed | place | source (archive.org) |',
    '| --- | --- | --- |',
  ];
  for (const [id, s] of Object.entries(BEDS)) {
    lines.push(`| \`${id}\` | ${s.credit} | [${s.ia}](https://archive.org/details/${s.ia}) |`);
  }
  lines.push('| `studio_air` | synthetic studio air | — |');
  lines.push('| `room_air` | synthetic quiet-room air | — |');
  lines.push('');
  lines.push('_Regenerate with `npm run ambience:build`._');
  fs.writeFileSync(path.join(OUT_DIR, 'CREDITS.md'), lines.join('\n') + '\n');
  console.log('  wrote public/ambience/CREDITS.md');
}

main();
