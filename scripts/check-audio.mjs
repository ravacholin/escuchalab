#!/usr/bin/env node
/**
 * Verificador del troceo de audio y de la unión del PCM.
 *
 * El motivo de existir: antes, el diálogo se recortaba con un
 * `substring(0, 5000)` a ciegas después de anteponerle el perfil fonético del
 * acento. Con los perfiles largos (Buenos Aires ocupa 3407 caracteres) un
 * diálogo `Largo` perdía sus últimos turnos a media frase, y los ejercicios
 * seguían preguntando por un audio que ya no los decía.
 *
 * No necesita clave de API ni red.
 *
 *   node scripts/check-audio.mjs        (o: npm run check:audio)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Compila un módulo TypeScript del proyecto y lo importa.
 *
 * El bundle se deja dentro del repositorio porque el servicio importa el SDK
 * de Gemini (marcado como externo, aquí solo se prueban helpers puros) y desde
 * /tmp no se resolvería `node_modules`.
 */
async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.check-audio-'));
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
      // El SDK solo hace falta para llamar a la API.
      external: ['@google/genai']
    });

    globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { chunkDialogueLines, concatPcmChunks, ttsDialogueBudget } = await loadModule('services/geminiService.ts');
const { Accent } = await loadModule('types.ts');

const failures = [];
const check = (label, condition, detail = '') => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const turn = (speaker, n) =>
  `${speaker}: Turno número ${n}, con una frase de longitud realista para un diálogo de nivel intermedio en el que se discute un trámite.`;

const dialogueOf = (count) =>
  Array.from({ length: count }, (_, i) => turn(i % 2 === 0 ? 'Ana' : 'Marcos', i + 1));

// --- 1. Ningún tramo supera el presupuesto -------------------------------
for (const accent of Object.values(Accent)) {
  const budget = ttsDialogueBudget(accent);
  const lines = dialogueOf(20);
  const chunks = chunkDialogueLines(lines, '\n', budget);

  for (const [i, chunk] of chunks.entries()) {
    const size = chunk.join('\n').length;
    check(
      `[${accent}] tramo ${i + 1} dentro del presupuesto`,
      size <= budget,
      `${size} > ${budget}`
    );
  }

  // --- 2. No se pierde ni un turno (el bug del substring) ----------------
  const rebuilt = chunks.flat();
  check(
    `[${accent}] no se pierde ningún turno`,
    rebuilt.length === lines.length && rebuilt.every((l, i) => l === lines[i]),
    `${rebuilt.length} de ${lines.length} turnos`
  );
}

// --- 3. Un diálogo corto no se trocea ------------------------------------
{
  const lines = dialogueOf(4);
  const chunks = chunkDialogueLines(lines, '\n', ttsDialogueBudget(Accent.Madrid));
  check('un diálogo corto viaja en una sola petición', chunks.length === 1, `${chunks.length} tramos`);
}

// --- 4. El peor caso conocido: Buenos Aires + diálogo largo --------------
{
  const lines = dialogueOf(18);
  const budget = ttsDialogueBudget(Accent.BuenosAires);
  const chunks = chunkDialogueLines(lines, '\n', budget);
  const total = lines.join('\n').length;
  check('Buenos Aires + Largo necesita más de un tramo', chunks.length > 1, `${total} caracteres, presupuesto ${budget}`);
  check('Buenos Aires + Largo conserva el último turno', chunks.flat().at(-1) === lines.at(-1));
}

// --- 5. Un turno gigantesco se parte, no se trunca -----------------------
{
  const huge = `Ana: ${'Una frase larguísima que no cabe de ninguna manera en una sola petición. '.repeat(60)}`;
  const budget = ttsDialogueBudget(Accent.Lima);
  const chunks = chunkDialogueLines([huge], '\n', budget);
  check('un turno enorme se reparte en varios tramos', chunks.length > 1, `${chunks.length} tramos`);
  for (const [i, chunk] of chunks.entries()) {
    check(`el trozo ${i + 1} del turno enorme respeta el presupuesto`, chunk.join('\n').length <= budget);
  }
  const words = w => w.replace(/\s+/g, ' ').trim().split(' ');
  check(
    'no se pierde texto al partir un turno enorme',
    words(chunks.flat().join(' ')).length === words(huge).length
  );
}

// --- 6. Unión del PCM ----------------------------------------------------
{
  const a = new Uint8Array(1000).fill(40);
  const b = new Uint8Array(600).fill(80);
  const merged = concatPcmChunks([a, b]);
  check('la unión conserva todas las muestras', merged.length === 1600, `${merged.length} bytes`);
  check('la unión respeta el principio del primer tramo', merged[0] === 40);
  check('la unión respeta el final del segundo tramo', merged[merged.length - 1] === 80);

  const single = concatPcmChunks([a]);
  check('un solo tramo se devuelve intacto', single.length === 1000);
  check('los tramos vacíos se descartan', concatPcmChunks([new Uint8Array(0), a]).length === 1000);
  check('sin tramos devuelve vacío', concatPcmChunks([]).length === 0);

  // El fundido solo toca la costura: el interior queda como estaba.
  const samples = new Int16Array(merged.buffer, merged.byteOffset, merged.length / 2);
  check('el fundido no altera el centro del primer tramo', samples[100] === new Int16Array(a.buffer, a.byteOffset, a.length / 2)[100]);
  check('el fundido atenúa la muestra pegada a la costura', Math.abs(samples[500 - 1]) < Math.abs(samples[100]));
}

if (failures.length) {
  console.error(`✗ ${failures.length} fallo(s) en el troceo de audio:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log('✓ troceo de audio correcto en los 8 acentos (ningún turno perdido, ningún tramo fuera de presupuesto) y unión de PCM verificada');
