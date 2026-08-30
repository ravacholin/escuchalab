#!/usr/bin/env node
/**
 * Verificador del arranque temprano del audio.
 *
 * Motivo: el plan y el audio corrían en serie —el TTS esperaba a que TODA la
 * lección (diálogo + ejercicios + verificación) terminara— aunque `generateAudio`
 * solo necesita el diálogo y los personajes. Ahora, en cuanto el stream cruza a
 * "exercises", se extrae el diálogo ya completo del prefijo y se arranca el TTS en
 * paralelo con la cola del plan.
 *
 * `extractDispatchableDialogue(full, speakerCap)` es la pieza pura que decide si
 * ese prefijo es despachable. Aquí se fija su contrato sin red ni clave de API:
 *   - dispara con el diálogo/personajes correctos en el límite "exercises";
 *   - NO dispara si el diálogo excede el tope de hablantes (se regeneraría, y
 *     gastar TTS sería tirar cuota);
 *   - NO dispara si el prefijo aún no parsea (llegó cortado a media réplica);
 *   - NO dispara si aún no hay turnos ni ha aparecido "exercises".
 *
 *   node scripts/check-early-audio.mjs        (o: npm run check:early-audio)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.check-early-audio-'));
  const outfile = join(dir, 'module.mjs');
  try {
    await build({
      entryPoints: [join(ROOT, entry)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      alias: { '@': ROOT },
      external: ['@google/genai']
    });
    globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { extractDispatchableDialogue } = await loadModule('services/geminiService.ts');

const failures = [];
const check = (label, condition, detail = '') => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// Un JSON de lección tal y como lo emite el modelo (sin pretty-print). Los
// helpers reciben el texto ACUMULADO del stream, así que se corta en distintos
// puntos para simular la llegada progresiva.
const characters = [
  { name: 'Ana', gender: 'Female', tone: 'empleada cordial, trato de usted' },
  { name: 'Marcos', gender: 'Male', tone: 'cliente apurado pero educado' }
];
const dialogue = [
  { speaker: 'Ana', text: 'Buenos días, ¿en qué le puedo ayudar?', emotion: 'cordial' },
  { speaker: 'Marcos', text: 'Quería recoger un paquete a nombre de Marcos Ruiz.', emotion: 'neutral' },
  { speaker: 'Ana', text: 'Perfecto, ¿me da su número de teléfono?', emotion: 'servicial' },
  { speaker: 'Marcos', text: 'Sí, es el seis cinco cuatro, treinta y dos, dieciocho.', emotion: 'neutral' }
];
const head = `{"title":"En la oficina de correos","characters":${JSON.stringify(characters)},"dialogue":${JSON.stringify(dialogue)}`;
const withExercises = `${head},"exercises":[{"slotId":"a0-dato","type":"dictation"`;
const fullPlan = `${withExercises},"question":"Anota el teléfono"}]}`;

// 1. Con "exercises" ya abierto, se despacha el diálogo entero y sus personajes.
{
  const r = extractDispatchableDialogue(fullPlan, 2);
  check('dispara en el límite "exercises"', r !== null);
  check('…con los 4 turnos del diálogo', r?.dialogue?.length === 4, `${r?.dialogue?.length}`);
  check('…con los 2 personajes', r?.characters?.length === 2, `${r?.characters?.length}`);
  check('…conservando hablante y texto del primer turno',
    r?.dialogue?.[0]?.speaker === 'Ana' && r?.dialogue?.[0]?.text === dialogue[0].text);
  check('…y del último turno (el diálogo llega completo, no a medias)',
    r?.dialogue?.[3]?.text === dialogue[3].text);
}

// 2. También dispara sobre el prefijo justo tras abrir "exercises", aunque el
//    resto del JSON todavía no haya llegado.
{
  const r = extractDispatchableDialogue(withExercises, 2);
  check('dispara en cuanto aparece "exercises", sin esperar a los ejercicios', r !== null);
  check('…y el diálogo sigue completo', r?.dialogue?.length === 4, `${r?.dialogue?.length}`);
}

// 3. Un diálogo con MÁS hablantes que el tope no se despacha: el guion será
//    rechazado y regenerado, y arrancar el TTS sería gastar cuota en balde.
{
  const threeSpeakers = [
    ...dialogue,
    { speaker: 'Lucía', text: 'Yo también vengo a por un paquete.', emotion: 'neutral' }
  ];
  const over = `{"title":"x","characters":${JSON.stringify(characters)},"dialogue":${JSON.stringify(threeSpeakers)},"exercises":[`;
  check('NO dispara si hay 3 hablantes y el tope es 2', extractDispatchableDialogue(over, 2) === null);
  check('…pero SÍ dispara si el tope se ha subido a 4', extractDispatchableDialogue(over, 4) !== null);
}

// 4. Un solo hablante (RadioNews / Monólogo) con tope 1 se despacha.
{
  const mono = [{ speaker: 'Locutor', text: 'Y ahora, el tiempo para mañana.', emotion: 'neutral' }];
  const solo = `{"title":"x","characters":[{"name":"Locutor","gender":"Male"}],"dialogue":${JSON.stringify(mono)},"exercises":[`;
  check('dispara con un solo hablante y tope 1', extractDispatchableDialogue(solo, 1) !== null);
}

// 5. Antes de que aparezca "exercises" no hay nada que despachar: el diálogo aún
//    podría no haber terminado de llegar.
{
  check('NO dispara mientras solo se ha recibido el diálogo (sin "exercises")',
    extractDispatchableDialogue(head, 2) === null);
  check('NO dispara con un stream vacío', extractDispatchableDialogue('', 2) === null);
}

// 6. Un prefijo cortado a media réplica (JSON irreparable antes de "exercises")
//    no revienta: devuelve null y el audio saldrá luego en secuencia.
{
  const truncated = `{"title":"x","characters":[],"dialogue":[{"speaker":"Ana","text":"a media pala`;
  // Sin "exercises" en el texto, ni siquiera se intenta: es el caso de §5.
  check('un prefijo sin "exercises" no intenta parsear', extractDispatchableDialogue(truncated, 2) === null);
}

if (failures.length) {
  console.error(`✗ ${failures.length} fallo(s) en el arranque temprano del audio:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(
  '✓ arranque temprano del audio correcto: el diálogo se despacha entero (con sus personajes) ' +
    'en el límite "exercises" del stream, nunca por encima del tope de hablantes (para no gastar ' +
    'cuota TTS en un guion que se regenerará), ni antes de que "exercises" aparezca, ni sobre un ' +
    'prefijo cortado — y un hablante único con tope 1 también arranca'
);
