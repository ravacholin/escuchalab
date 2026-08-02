#!/usr/bin/env node
/**
 * Comprueba contra la API real que un diálogo vuelve con **dos voces**.
 *
 * Es la única prueba que puede afirmarlo de verdad. `check:audio` verifica la
 * asignación, el troceo y el medidor, pero quien decide si los dos personajes
 * suenan distintos es el modelo, y esa decisión solo se ve en el audio: con el
 * formato de prompt anterior, seis turnos y dos nombres distintos volvían
 * leídos con una sola voz en dos de cada tres generaciones.
 *
 * Llama a `generateAudio()` tal cual la usa la app y mide el PCM resultante.
 * Falla si alguna generación termina con una sola voz **o si gasta más
 * peticiones de las planificadas**: la garantía ahora viene de pedir cada voz
 * por separado, así que una repetición inesperada significaría que el coste ha
 * vuelto a depender de medir y reintentar.
 *
 * Es además el único sitio donde el troceador de turnos se ejercita contra
 * audio de verdad: `check:audio` lo prueba con PCM sintético, pero si el modelo
 * no deja pausas entre párrafos, se ve aquí (y se oye en los WAV que deja).
 *
 *   GEMINI_API_KEY=... node scripts/check-tts-live.mjs [repeticiones]
 *
 * No forma parte de `npm test`: necesita clave, red y cuota (el nivel gratuito
 * del modelo de voz da 10 peticiones al día, y cada repetición gasta dos).
 */

import { build } from 'esbuild';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.tts-live');

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY.');
  process.exit(1);
}

globalThis.localStorage ??= {
  getItem: key => (key === 'gemini_api_key' ? process.env.GEMINI_API_KEY : null),
  setItem: () => {},
  removeItem: () => {}
};

async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.tts-live-'));
  const outfile = join(dir, 'module.mjs');
  try {
    await build({
      entryPoints: [join(ROOT, entry)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      external: ['@google/genai'],
      logLevel: 'silent'
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { generateAudio, assignSpeakerVoices, planAudioRequests } =
  await loadModule('services/geminiService.ts');
const { checkTwoVoices } = await loadModule('services/ttsVoiceCheck.ts');
const { Accent } = await loadModule('types.ts');

/** WAV para poder escuchar lo que se midió: el número no sustituye al oído. */
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

const DIALOGUE = [
  ['Lucía', 'Buenos días, quería recoger un paquete a nombre de Lucía Serrano.'],
  ['Andrés', 'Muy bien, ¿me dice el número de referencia, por favor?'],
  ['Lucía', 'Sí, claro. Es el seis cinco cuatro treinta y dos dieciocho.'],
  ['Andrés', 'Perfecto, lo tengo aquí. Son catorce con noventa de gastos de envío.'],
  ['Lucía', '¿Puedo pagar con tarjeta o tiene que ser en efectivo?'],
  ['Andrés', 'Con tarjeta sin problema. Firme aquí y ya está todo listo.']
];

/** El caso que más falla es el que el catálogo separa peor: mismo género. */
const CASES = [
  {
    label: 'mujer + hombre',
    characters: [{ name: 'Lucía', gender: 'Female' }, { name: 'Andrés', gender: 'Male' }]
  },
  {
    label: 'dos mujeres',
    characters: [{ name: 'Lucía', gender: 'Female' }, { name: 'Andrés', gender: 'Female' }]
  },
  {
    label: 'dos hombres',
    characters: [{ name: 'Lucía', gender: 'Male' }, { name: 'Andrés', gender: 'Male' }]
  }
];

const repetitions = Number(process.argv[2] || 2);
const dialogue = DIALOGUE.map(([speaker, text]) => ({ speaker, text }));
await mkdir(OUT, { recursive: true });

const failures = [];
const errors = [];
let runs = 0;

/** El 429 de cuota trae media página de JSON: en pantalla solo estorba. */
const brief = message => {
  const quota = /RESOURCE_EXHAUSTED|"code":429/.test(message);
  if (quota) return 'cuota del modelo de voz agotada (nivel gratuito: 10 peticiones al día)';
  return message.replace(/\s+/g, ' ').slice(0, 160);
};

// El coste se sabe antes de gastar nada: es el punto del diseño.
const planned = planAudioRequests(dialogue, CASES[0].characters, Accent.Madrid).requests.length;
console.log(
  `Coste previsto: ${planned} peticiones por generación × ${repetitions} repeticiones × ` +
    `${CASES.length} casos = ${planned * repetitions * CASES.length} peticiones ` +
    `(el nivel gratuito da 10 al día).`
);

for (const { label, characters } of CASES) {
  const [a, b] = assignSpeakerVoices(['Lucía', 'Andrés'], characters);
  const gap = Math.abs(12 * Math.log2(a.pitchHz / b.pitchHz));
  console.log(
    `\n${label}: ${a.voice} (${a.pitchHz} Hz) / ${b.voice} (${b.pitchHz} Hz) — ` +
      `${gap.toFixed(1)} semitonos`
  );

  for (let i = 1; i <= repetitions; i++) {
    runs++;
    const started = Date.now();
    // Las peticiones que la síntesis dice haber hecho, para poder afirmar que
    // no hubo ninguna de reparación por detrás.
    let spent = 0;
    const watch = snapshot => {
      const made = snapshot?.steps?.find(s => s.id === 'synthesis')?.metrics?.ttsRequestsDone;
      if (typeof made === 'number') spent = Math.max(spent, made);
    };

    let base64;
    try {
      base64 = await generateAudio(dialogue, characters, Accent.Madrid, watch);
    } catch (error) {
      errors.push(`[${label}] intento ${i}: ${brief(error.message)}`);
      console.log(`  ${i}. ERROR ${brief(error.message)}`);
      continue;
    }

    const pcm = new Uint8Array(Buffer.from(base64, 'base64'));
    const verdict = checkTwoVoices(pcm, a.pitchHz, b.pitchHz);
    const file = join(OUT, `${label.replace(/\W+/g, '-')}-${i}.wav`);
    await writeFile(file, wav(pcm));

    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  ${i}. ${verdict.ok ? 'ok  ' : 'FALLA'} ${verdict.reason} · ` +
        `${spent}/${planned} peticiones · ${seconds} s · ${file}`
    );
    if (!verdict.ok) failures.push(`[${label}] intento ${i}: ${verdict.reason}`);
    if (spent > planned) {
      failures.push(
        `[${label}] intento ${i}: gastó ${spent} peticiones y estaban planificadas ${planned}`
      );
    }
  }
}

console.log('');
const measured = runs - errors.length;

if (errors.length) {
  console.error(`check:tts:live — ${errors.length} de ${runs} generaciones no llegaron a medirse:`);
  for (const error of errors) console.error(`  · ${error}`);
}
if (failures.length) {
  console.error(`check:tts:live — ${failures.length} de ${measured} generaciones medidas volvieron con una sola voz:`);
  for (const failure of failures) console.error(`  · ${failure}`);
}
if (failures.length || !measured) process.exit(1);

console.log(`check:tts:live — ${measured} generaciones medidas, todas con las dos voces. Audio en ${OUT}/`);
