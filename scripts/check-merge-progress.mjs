#!/usr/bin/env node
/**
 * Verificador de `mergeProgress`: la regla que decide qué instantánea muestra la
 * pantalla de carga cuando el plan y el audio reportan A LA VEZ.
 *
 * Motivo: el TTS arranca en cuanto llega el diálogo, EN PARALELO con la cola del
 * plan (ejercicios + verificación). El filtro anterior («una vez visto el audio,
 * ignora todo 'plan'») dejaba la pantalla congelada en la Fase 2 al 100% mientras
 * el plan seguía vivo por detrás —el bug de «termina todo y se queda colgado»—.
 *
 * `mergeProgress(prev, snapshot, planResolved)` es la pieza pura. Aquí se fija su
 * contrato sin red ni React:
 *   - misma fase → siempre actualiza;
 *   - 'plan' con el plan ya resuelto → flush rezagado, se ignora;
 *   - 'plan' con el audio al 100% y el plan aún vivo → SE MUESTRA (caso del bug),
 *     marcado `finishingTail` para que la UI diga «casi listo · terminando los
 *     ejercicios» en lugar de retroceder a «Fase 1 de 2 · 85%»;
 *   - 'plan' con el audio aún en streaming → se conserva el audio (sin parpadeo);
 *   - cualquier 'audio' → manda.
 *
 *   node scripts/check-merge-progress.mjs        (o: npm run check:merge-progress)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.check-merge-progress-'));
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
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { mergeProgress } = await loadModule('services/generationProgress.ts');

const failures = [];
const check = (label, condition, detail = '') => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// Instantánea mínima: mergeProgress solo lee `phase` y `finished`. Un `tag`
// identifica la instancia para comprobar CUÁL de las dos se conserva.
const snap = (phase, finished, tag) => ({ phase, finished, tag });

// 1. Misma fase: siempre gana la nueva (avance normal dentro de una fase).
{
  const prev = snap('plan', false, 'viejo');
  const next = snap('plan', false, 'nuevo');
  check('misma fase (plan) → actualiza', mergeProgress(prev, next, false).tag === 'nuevo');
  check('misma fase (audio) → actualiza',
    mergeProgress(snap('audio', false, 'a'), snap('audio', true, 'b'), false).tag === 'b');
}

// 2. Sin instantánea previa: se toma la que llega.
check('sin previa → toma la nueva', mergeProgress(null, snap('plan', false, 'x'), false).tag === 'x');

// 3. EL CASO DEL BUG: audio al 100% (finished) y el plan sigue vivo
//    (planResolved=false) → se muestra el plan, no el 100% congelado, PERO
//    marcado `finishingTail` para que la UI no retroceda visualmente a la Fase 1.
{
  const prev = snap('audio', true, 'audio-100');
  const next = snap('plan', false, 'plan-vivo');
  const merged = mergeProgress(prev, next, false);
  check('audio finished + plan aún vivo → muestra el plan (Fase 1 en vivo)',
    merged.tag === 'plan-vivo');
  check('audio finished + plan aún vivo → marcado finishingTail',
    merged.finishingTail === true);
  // No debe mutar el snapshot original que llega (se devuelve una copia).
  check('finishingTail no muta el snapshot de entrada',
    next.finishingTail === undefined);
}

// 4. Audio aún en streaming (no finished) y llega un 'plan' interleaved →
//    se conserva el audio para no parpadear entre fases (y sin marca de cola).
{
  const prev = snap('audio', false, 'audio-mid');
  const next = snap('plan', false, 'plan-interleaved');
  const merged = mergeProgress(prev, next, false);
  check('audio en streaming + plan interleaved → conserva el audio (sin parpadeo)',
    merged.tag === 'audio-mid');
  check('audio en streaming + plan interleaved → sin finishingTail',
    merged.finishingTail === undefined);
}

// 5. Plan YA resuelto: un 'plan' posterior es un flush rezagado → se ignora,
//    tanto sobre un audio en curso como sobre uno terminado.
{
  check('plan resuelto + flush plan sobre audio en streaming → se ignora',
    mergeProgress(snap('audio', false, 'audio-mid'), snap('plan', false, 'rezagado'), true).tag === 'audio-mid');
  check('plan resuelto + flush plan sobre audio finished → se ignora',
    mergeProgress(snap('audio', true, 'audio-100'), snap('plan', false, 'rezagado'), true).tag === 'audio-100');
}

// 6. Cualquier instantánea de 'audio' manda sobre una de 'plan' (arranque/reanudación
//    de la Fase 2), con el plan resuelto o no.
{
  check('audio sobre plan (plan sin resolver) → manda el audio',
    mergeProgress(snap('plan', false, 'plan'), snap('audio', false, 'audio'), false).tag === 'audio');
  check('audio sobre plan (plan resuelto) → manda el audio',
    mergeProgress(snap('plan', true, 'plan'), snap('audio', false, 'audio'), true).tag === 'audio');
}

if (failures.length) {
  console.error(`✗ ${failures.length} fallo(s) en mergeProgress:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(
  '✓ mergeProgress correcto: la misma fase siempre avanza, el audio manda al empezar la Fase 2, ' +
    'un flush del plan ya resuelto se ignora, y —el caso que se colgaba— con el audio al 100% pero el ' +
    'plan aún vivo se muestra la Fase 1 en vivo (marcada finishingTail, sin retroceder la pantalla) en ' +
    'lugar de un 100% congelado, sin parpadear mientras el audio corre'
);
