#!/usr/bin/env node
// Offline scene auditioner.
//
//   npm run ambience:preview -- cafe
//   npm run ambience:preview -- cafe street station --seconds 30
//   npm run ambience:preview -- --all
//   npm run ambience:preview               # lists the scenes
//
// Mixes a scene's real beds — at their recipe gains, with the scene's tone — into a
// .wav under .ambience-preview/ that you can actually listen to, no browser and no API
// key. This is how "does a café sound like a café?" gets answered, which no unit test
// can do. The subtle synth events are a runtime layer and are not rendered here; the
// bed is the character.

import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { build } from 'esbuild';

// Optional tool (see build-beds.mjs). Install with `npm i -D ffmpeg-static` to audition.
let ffmpegPath;
try { ffmpegPath = (await import('ffmpeg-static')).default; }
catch { console.error('This script needs ffmpeg-static. Install it with:  npm i -D ffmpeg-static'); process.exit(1); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BED_DIR = path.join(ROOT, 'public', 'ambience');
const OUT_DIR = path.join(ROOT, '.ambience-preview');

const BED_MAKEUP = 2.4; // keep in step with services/ambienceEngine.ts

async function loadRecipes() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ambience-preview-'));
  const entry = path.join(dir, 'entry.ts');
  const outfile = path.join(dir, 'bundle.mjs');
  writeFileSync(entry, `export { SCENE_RECIPES, SCENE_IDS } from '${path.join(ROOT, 'services', 'ambiencePresets').replace(/\\/g, '/')}';`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

function renderScene(id, recipe, seconds) {
  const inputs = [];
  const filters = [];
  const level = recipe.level ?? 1;
  recipe.beds.forEach((layer, i) => {
    const file = path.join(BED_DIR, `${layer.bed}.wav`);
    if (!existsSync(file)) throw new Error(`missing bed ${layer.bed}.wav`);
    inputs.push('-stream_loop', '-1', '-i', file);
    const chain = [`volume=${(layer.gain * level * BED_MAKEUP).toFixed(3)}`];
    if (layer.highpass) chain.push(`highpass=f=${layer.highpass}`);
    if (layer.lowpass) chain.push(`lowpass=f=${layer.lowpass}`);
    filters.push(`[${i}:a]${chain.join(',')}[b${i}]`);
  });
  const mixIn = recipe.beds.map((_, i) => `[b${i}]`).join('');
  filters.push(`${mixIn}amix=inputs=${recipe.beds.length}:normalize=0[mix]`);

  // Scene tone.
  let last = 'mix';
  const t = recipe.tone ?? {};
  if (t.bandpass) { filters.push(`[${last}]highpass=f=${t.bandpass[0]},lowpass=f=${t.bandpass[1]}[tn]`); last = 'tn'; }
  if (t.lowShelfDb) { filters.push(`[${last}]bass=g=${t.lowShelfDb}:f=220[ls]`); last = 'ls'; }
  if (t.highShelfDb || t.tiltDb) { filters.push(`[${last}]treble=g=${(t.highShelfDb ?? 0) + (t.tiltDb ?? 0)}:f=3200[hs]`); last = 'hs'; }
  filters.push(`[${last}]alimiter=limit=0.95[out]`);

  const out = path.join(OUT_DIR, `${id}.wav`);
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[out]', '-t', String(seconds), '-c:a', 'pcm_s16le', '-y', out,
  ]);
  return out;
}

const argv = process.argv.slice(2);
let seconds = 20;
const wanted = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--seconds' || a === '-s') { seconds = parseFloat(argv[++i]); continue; }
  if (a === '--all') { wanted.push('--all'); continue; }
  if (a.startsWith('-')) continue;
  wanted.push(a);
}

const { SCENE_RECIPES, SCENE_IDS } = await loadRecipes();

if (wanted.length === 0) {
  console.log('Scenes:\n');
  for (const id of SCENE_IDS) {
    const beds = SCENE_RECIPES[id].beds.map((b) => b.bed).join('+');
    console.log(`  ${id.padEnd(18)} ${SCENE_RECIPES[id].label.padEnd(24)} [${beds}]`);
  }
  console.log('\nRender one with:  npm run ambience:preview -- cafe street --seconds 30');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const ids = wanted.includes('--all') ? SCENE_IDS : wanted.filter((w) => SCENE_IDS.includes(w));
const bad = wanted.filter((w) => w !== '--all' && !SCENE_IDS.includes(w));
for (const b of bad) console.log(`  ? unknown scene "${b}"`);

for (const id of ids) {
  const out = renderScene(id, SCENE_RECIPES[id], seconds);
  console.log(`  ${id.padEnd(18)} -> ${path.relative(ROOT, out)}`);
}
console.log(`\nWrote ${ids.length} scene(s) to ${path.relative(ROOT, OUT_DIR)}/`);
