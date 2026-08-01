#!/usr/bin/env node
/**
 * Mide el tono de las voces del TTS de Gemini contra la API real.
 *
 * De aquí sale la columna `pitchHz` de `TTS_VOICES` (services/geminiService.ts).
 * Hace falta medirlo porque el catálogo no publica el tono de cada voz, y sin
 * ese número no se puede ni elegir un par de voces separadas ni comprobar
 * después que el modelo las respetó: las dos cosas que impiden que un diálogo
 * de dos personajes vuelva leído con una sola voz.
 *
 * Es lo único de este repositorio que necesita clave y red, y no forma parte de
 * `npm test`: se corre a mano cuando cambia el modelo o el catálogo de voces.
 *
 *   GEMINI_API_KEY=... node scripts/measure-tts-voices.mjs [voz,voz,…]
 *
 * Las respuestas se guardan en `.tts-voice-cache/` para no volver a gastar
 * cuota con una voz ya medida (la del nivel gratuito del modelo de voz es de
 * unas pocas peticiones por minuto).
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.tts-voice-cache');
const MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';

/** Todas las voces que admite el modelo, según el error 400 de la propia API. */
const ALL_VOICES = [
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
  'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
  'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel',
  'Vindemiatrix', 'Zephyr', 'Zubenelgenubi'
];

/** La misma frase para todas: el tono solo es comparable sobre el mismo texto. */
const PROBE = 'Buenos días. Son las cinco y media de la tarde y quedan catorce euros con noventa.';

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY.');
  process.exit(1);
}

async function loadChecker() {
  const dir = await mkdtemp(join(ROOT, '.measure-'));
  const outfile = join(dir, 'module.mjs');
  try {
    await build({
      entryPoints: [join(ROOT, 'services/ttsVoiceCheck.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent'
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function synthesize(voice) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${MODEL}-${voice}.pcm`);
  if (existsSync(file)) return { pcm: new Uint8Array(readFileSync(file)), cached: true };

  const body = {
    contents: [{ parts: [{ text: PROBE }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };

  for (let attempt = 1; attempt <= 8; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    );
    const raw = await response.text();

    if (response.status === 429) {
      const wait = Number((raw.match(/retry in ([\d.]+)s/) || [])[1] || 35) + 3;
      process.stderr.write(`  cuota agotada, espero ${wait.toFixed(0)} s…\n`);
      await new Promise(done => setTimeout(done, wait * 1000));
      continue;
    }
    if (!response.ok) return { error: `${response.status} ${raw.slice(0, 160)}` };

    const data = JSON.parse(raw).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) return { error: 'la respuesta no traía audio' };

    const pcm = new Uint8Array(Buffer.from(data, 'base64'));
    writeFileSync(file, pcm);
    return { pcm, cached: false };
  }
  return { error: 'agotados los reintentos por cuota' };
}

const { segmentPitches } = await loadChecker();
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

const wanted = process.argv[2] ? process.argv[2].split(',') : ALL_VOICES;
console.log(`Modelo ${MODEL} · ${wanted.length} voces · frase de ${PROBE.length} caracteres\n`);

const rows = [];
for (const voice of wanted) {
  const result = await synthesize(voice);
  if (result.error) {
    console.log(`${voice.padEnd(14)} — ${result.error}`);
    continue;
  }
  const pitches = segmentPitches(result.pcm);
  if (!pitches.length) {
    console.log(`${voice.padEnd(14)} — sin segmentos con tono medible`);
    continue;
  }
  const pitch = Math.round(median(pitches));
  rows.push({ voice, pitch });
  console.log(
    `${voice.padEnd(14)} ${String(pitch).padStart(4)} Hz   ` +
      `[${pitches.map(Math.round).join(' ')}]${result.cached ? '  (caché)' : ''}`
  );
}

if (rows.length > 1) {
  rows.sort((a, b) => b.pitch - a.pitch);
  const gap = (a, b) => Math.abs(12 * Math.log2(a / b)).toFixed(1);
  console.log(`\nDe ${rows[0].voice} (${rows[0].pitch} Hz) a ${rows.at(-1).voice} ` +
    `(${rows.at(-1).pitch} Hz): ${gap(rows[0].pitch, rows.at(-1).pitch)} semitonos.`);
  console.log('Línea para TTS_VOICES:');
  for (const { voice, pitch } of rows) {
    console.log(`  { name: '${voice}', gender: '?', pitchHz: ${pitch}, timbre: '?' },`);
  }
}
