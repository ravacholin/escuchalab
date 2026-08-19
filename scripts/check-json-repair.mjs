#!/usr/bin/env node
/**
 * Verificador de la reparación tolerante del JSON del modelo.
 *
 * El motivo de existir: el plan de la lección se parseaba con un `JSON.parse`
 * pelado, así que un solo carácter mal del modelo —una comilla sin escapar en
 * una réplica, un salto de línea crudo dentro de una cadena, una coma de más o
 * la respuesta cortada— tiraba la lección entera con «Error GenAI: Expected ','
 * or '}' after property value in JSON at position 11332». Lo que se fija aquí es
 * que `parseLenientJson` recupera esos casos sin tocar el camino normal.
 *
 * No necesita clave de API ni red.
 *
 *   node scripts/check-json-repair.mjs        (o: npm run check:json)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.check-json-'));
  const outfile = join(dir, 'module.mjs');
  try {
    await build({
      entryPoints: [join(ROOT, entry)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      alias: { '@': ROOT }
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { parseLenientJson, repairJson, extractOutermostJson, stripCodeFences } =
  await loadModule('services/jsonRepair.ts');

const failures = [];
const check = (label, condition, detail = '') => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const eq = (label, actual, expected) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);

// --- Camino normal: JSON válido, coste cero (no se repara). ---
{
  const raw = '{"title":"Hola","dialogue":[{"speaker":"Ana","text":"Buenos días"}]}';
  const r = parseLenientJson(raw);
  check('JSON válido no se marca como reparado', r.repaired === false);
  eq('JSON válido se parsea igual', r.value, JSON.parse(raw));
}

// --- Vallas markdown. ---
{
  const raw = '```json\n{"a":1}\n```';
  const r = parseLenientJson(raw);
  eq('vallas markdown se quitan', r.value, { a: 1 });
}

// --- Comilla sin escapar dentro de una cadena (el «Expected ',' or '}'»). ---
{
  const raw = '{"text":"El "mejor" del mundo","n":2}';
  const r = parseLenientJson(raw);
  check('comilla incrustada se repara', r.repaired === true);
  eq('comilla incrustada: texto recuperado', r.value.text, 'El "mejor" del mundo');
  eq('comilla incrustada: resto intacto', r.value.n, 2);
}

// --- Salto de línea crudo dentro de una cadena. ---
{
  const raw = '{"text":"línea uno\nlínea dos"}';
  const r = parseLenientJson(raw);
  check('salto de línea crudo se repara', r.repaired === true);
  eq('salto de línea: contenido preservado', r.value.text, 'línea uno\nlínea dos');
}

// --- Coma colgante antes de } y de ]. ---
{
  const r1 = parseLenientJson('{"a":1,"b":2,}');
  eq('coma colgante en objeto', r1.value, { a: 1, b: 2 });
  const r2 = parseLenientJson('{"xs":[1,2,3,]}');
  eq('coma colgante en array', r2.value, { xs: [1, 2, 3] });
}

// --- Respuesta cortada a medias (truncamiento). ---
{
  const raw = '{"title":"Café","dialogue":[{"speaker":"Ana","text":"Hola';
  const r = parseLenientJson(raw);
  check('truncada: se cierra y parsea', r.repaired === true);
  eq('truncada: título recuperado', r.value.title, 'Café');
  eq('truncada: hablante recuperado', r.value.dialogue[0].speaker, 'Ana');
}

// --- Texto de sobra alrededor del objeto (extracción). ---
{
  const raw = 'Aquí tienes la lección:\n{"a":1}\n¡Espero que te sirva!';
  const r = parseLenientJson(raw);
  eq('texto extra alrededor se recorta', r.value, { a: 1 });
}

// --- Objeto que ya escapa comillas correctamente no se rompe. ---
{
  const raw = '{"text":"Dijo \\"hola\\" y se fue"}';
  const r = parseLenientJson(raw);
  eq('comillas ya escapadas se respetan', r.value.text, 'Dijo "hola" y se fue');
}

// --- Barras invertidas y caracteres unicode reales sobreviven. ---
{
  const raw = '{"path":"C:\\\\Users","emoji":"\\u00f1"}';
  const r = parseLenientJson(raw);
  eq('escapes válidos preservados', r.value, { path: 'C:\\Users', emoji: 'ñ' });
}

// --- Un array de nivel superior también se admite. ---
{
  const r = parseLenientJson('[{"a":1},{"b":2},]');
  eq('array de nivel superior con coma colgante', r.value, [{ a: 1 }, { b: 2 }]);
}

// --- Helpers directos. ---
eq('stripCodeFences quita ```', stripCodeFences('```json\n{"x":1}\n```'), '{"x":1}');
check('extractOutermostJson recorta ruido',
  extractOutermostJson('ruido {"x":1} más ruido') === '{"x":1}');
check('repairJson cierra llaves abiertas',
  (() => { try { JSON.parse(repairJson('{"a":1,"b":{"c":2')); return true; } catch { return false; } })());

// --- Lo irrecuperable sí lanza (para que la capa de arriba reintente). ---
{
  let threw = false;
  try { parseLenientJson('no soy json en absoluto'); } catch { threw = true; }
  check('entrada sin JSON lanza', threw);
}

if (failures.length) {
  console.error(`\n✗ check:json — ${failures.length} fallo(s):`);
  for (const f of failures) console.error(`   · ${f}`);
  process.exit(1);
}
console.log('✓ check:json — la reparación tolerante del JSON del modelo se comporta');
