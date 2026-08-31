#!/usr/bin/env node
/**
 * Verificador del respaldo (failsafe) de TTS con la voz del navegador.
 *
 * Cuando el TTS de Gemini falla (cuota agotada, modelo caído, red) tras recorrer
 * toda la cadena `AUDIO_MODELS`, la lección se sintetiza con `window.speechSynthesis`.
 * Aquí se prueba, sin navegador ni clave de API, la parte pura de ese camino:
 *   - `planWebSpeech` arma una intervención por turno, en orden, con el texto saneado
 *     y el género del personaje.
 *   - `pickWebSpeechVoices` elige la voz por acento, degrada cuando falta la variante
 *     y da dos voces distintas a dos hablantes cuando el catálogo lo permite.
 *   - `ACCENT_LOCALE` cubre todos los acentos, e `isWebSpeechAvailable` no revienta
 *     fuera del navegador.
 *
 *   node scripts/check-webspeech.mjs        (o: npm run check:webspeech)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.check-webspeech-'));
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

const { isWebSpeechAvailable, ACCENT_LOCALE, pickWebSpeechVoices, planWebSpeech } =
  await loadModule('services/webSpeechTts.ts');
const { Accent } = await loadModule('types.ts');

const failures = [];
const check = (label, condition, detail = '') => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// --- 1. isWebSpeechAvailable no revienta sin navegador -------------------
check('isWebSpeechAvailable() es false fuera del navegador', isWebSpeechAvailable() === false);

// --- 2. ACCENT_LOCALE cubre todos los acentos, en es-* ------------------
for (const accent of Object.values(Accent)) {
  const locale = ACCENT_LOCALE[accent];
  check(`[${accent}] tiene locale`, typeof locale === 'string' && locale.startsWith('es'), String(locale));
}

// --- 3. planWebSpeech: una intervención por turno, en orden, saneada ----
const characters = [
  { name: 'Ana', gender: 'Female' },
  { name: 'Marcos', gender: 'Male' }
];
const dialogue = [
  { speaker: 'Ana', text: 'Hola, [sonríe] ¿qué tal?' },
  { speaker: 'Marcos', text: '  Muy bien (con calma), gracias.  ' },
  { speaker: 'Ana', text: '   ' },            // vacío tras el saneado → se descarta
  { speaker: 'Marcos', text: 'Perfecto.' }
];
const plan = planWebSpeech(dialogue, characters, Accent.MexicoCity);

check('planWebSpeech marca kind webspeech', plan.kind === 'webspeech');
check('planWebSpeech conserva el acento', plan.accent === Accent.MexicoCity);
check('planWebSpeech descarta turnos vacíos', plan.lines.length === 3, `${plan.lines.length}`);
check('planWebSpeech mantiene el orden del diálogo',
  plan.lines.map(l => l.at).join(',') === '0,1,3',
  plan.lines.map(l => l.at).join(','));
check('planWebSpeech quita los caracteres de acotación ([] () *)',
  plan.lines.every(l => !/[\[\]\(\)\*]/.test(l.text)),
  JSON.stringify(plan.lines.map(l => l.text)));
check('planWebSpeech normaliza espacios y recorta',
  plan.lines.every(l => l.text === l.text.trim() && !/\s{2,}/.test(l.text)),
  JSON.stringify(plan.lines.map(l => l.text)));
check('planWebSpeech saneó el turno con paréntesis',
  plan.lines[1].text === 'Muy bien con calma, gracias.',
  JSON.stringify(plan.lines[1].text));
check('planWebSpeech atribuye género del personaje',
  plan.lines[0].gender === 'Female' && plan.lines[1].gender === 'Male');

// --- 4. pickWebSpeechVoices: selección y degradación --------------------
const voice = (name, lang) => ({ name, lang });

// (a) Sin voces → null por hablante.
check('sin voces devuelve null por hablante',
  JSON.stringify(pickWebSpeechVoices([], Accent.BuenosAires, ['Female', 'Male'])) === JSON.stringify([null, null]));

// (b) Locale exacto gana sobre otro es-*.
const catalog = [
  voice('Google español de Estados Unidos', 'es-US'),
  voice('Jorge', 'es-AR'),
  voice('Mónica', 'es-ES')
];
const arPick = pickWebSpeechVoices(catalog, Accent.BuenosAires, [undefined]);
check('elige la variante exacta del acento (es-AR)', arPick[0]?.lang === 'es-AR', JSON.stringify(arPick[0]));

// (c) Sin la variante exacta, degrada a cualquier es-*.
const noExact = [voice('Mónica', 'es-ES'), voice('Paulina', 'es-MX')];
const clPick = pickWebSpeechVoices(noExact, Accent.Santiago, [undefined]);
check('degrada a otra voz española cuando falta la variante',
  !!clPick[0] && clPick[0].lang.startsWith('es'), JSON.stringify(clPick[0]));

// (d) Sin ninguna voz española, degrada a la que haya.
const noSpanish = [voice('Daniel', 'en-GB'), voice('Thomas', 'fr-FR')];
const anyPick = pickWebSpeechVoices(noSpanish, Accent.Lima, [undefined]);
check('degrada a cualquier voz cuando no hay español', anyPick[0] === noSpanish[0], JSON.stringify(anyPick[0]));

// (e) Dos hablantes reciben voces DISTINTAS cuando el catálogo lo permite.
const twoVoices = [voice('Paulina', 'es-MX'), voice('Juan', 'es-MX')];
const pair = pickWebSpeechVoices(twoVoices, Accent.MexicoCity, ['Female', 'Male']);
check('dos hablantes → dos voces distintas', pair[0] && pair[1] && pair[0] !== pair[1], JSON.stringify(pair));
check('respeta el género por la pista del nombre',
  pair[0]?.name === 'Paulina' && pair[1]?.name === 'Juan', JSON.stringify(pair));

// (f) Con una sola voz, el segundo hablante la reutiliza (mejor repetir que callar).
const onlyOne = [voice('Paulina', 'es-MX')];
const reuse = pickWebSpeechVoices(onlyOne, Accent.MexicoCity, ['Female', 'Male']);
check('con una sola voz, ambos hablantes la usan', reuse[0] === onlyOne[0] && reuse[1] === onlyOne[0]);

// --- Resultado ----------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ check:webspeech — ${failures.length} fallo(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('✓ check:webspeech — el respaldo con la voz del navegador cumple su contrato');
