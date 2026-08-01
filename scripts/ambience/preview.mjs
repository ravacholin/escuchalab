#!/usr/bin/env node
// Offline scene auditioner.
//
//   npm run ambience:preview -- cafe
//   npm run ambience:preview -- cafe street station --seconds 30
//   npm run ambience:preview -- --all
//
// Renders the complete mix for a scene — the bundled stems at their recipe gains,
// the room convolution, and the scheduled events — to a .wav you can actually
// listen to, without opening a browser or generating a lesson.
//
// This exists because "does a café sound like a café?" is not a question a unit test
// can answer. The check scripts enforce the measurable floor (energy distribution,
// loudness range, distance between scenes); this is how a human judges the rest.
//
// The renderer itself lives in ./render.mjs, shared with check:ambience:scenes, so
// what you audition here is what that check measures.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { loadSceneRenderer, ROOT, SAMPLE_RATE } from './render.mjs';
import { encodeWav, lowEnergyRatio, loudnessRangeDb } from './dsp.mjs';

const OUT_DIR = path.join(ROOT, '.ambience-preview');

const argv = process.argv.slice(2);
let seconds = 20;
let seed = 'a';
const wanted = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--seconds' || a === '-s') { seconds = parseFloat(argv[++i]); continue; }
  if (a === '--seed') { seed = argv[++i]; continue; }
  if (a === '--all') { wanted.push('--all'); continue; }
  if (a.startsWith('-')) continue;
  wanted.push(a);
}

const { SCENE_RECIPES, SCENE_IDS, renderScene } = await loadSceneRenderer();

let targets = wanted.filter((w) => w !== '--all');
if (wanted.includes('--all') || targets.length === 0) {
  if (targets.length === 0 && !wanted.includes('--all')) {
    console.log('');
    console.log('Usage: npm run ambience:preview -- <scene> [<scene>...] [--seconds 20] [--seed a]');
    console.log('       npm run ambience:preview -- --all');
    console.log('');
    console.log(`Scenes (${SCENE_IDS.length}):`);
    console.log(`  ${SCENE_IDS.join(', ')}`);
    console.log('');
    process.exit(0);
  }
  targets = SCENE_IDS;
}

const unknown = targets.filter((t) => !SCENE_RECIPES[t]);
if (unknown.length > 0) {
  console.error(`Unknown scene(s): ${unknown.join(', ')}`);
  console.error(`Known: ${SCENE_IDS.join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log('');
for (const sceneId of targets) {
  const recipe = SCENE_RECIPES[sceneId];
  const started = Date.now();
  const { channels, counts, missing, onsetsPerMin } = renderScene(sceneId, { seconds, seed });
  const outPath = path.join(OUT_DIR, `${sceneId}.wav`);
  writeFileSync(outPath, encodeWav(channels, SAMPLE_RATE));

  const low = lowEnergyRatio(channels[0], SAMPLE_RATE);
  const lra = loudnessRangeDb(channels[0], SAMPLE_RATE);
  const events = Object.entries(counts).map(([k, v]) => `${k}x${v}`).join(' ');

  console.log(`${sceneId.padEnd(18)} "${recipe.label}"`);
  console.log(`  stems  ${recipe.stems.map((s) => `${s.stem}@${s.gain}`).join(' + ')}`);
  console.log(`  room   ${recipe.room.size} wet=${recipe.room.wet}`);
  console.log(`  events ${events || '(none)'}`);
  console.log(
    `  mix    <250Hz ${(low * 100).toFixed(0)}%  LRA ${lra.toFixed(1)} dB  ` +
    `${onsetsPerMin.toFixed(0)} onsets/min  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
  if (missing.length > 0) console.log(`  MISSING ${[...new Set(missing)].join(', ')}`);
  console.log(`  -> ${path.relative(ROOT, outPath)}`);
  console.log('');
}
