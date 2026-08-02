#!/usr/bin/env node
/**
 * Verificador de la cadena de modelos de texto.
 *
 * El motivo de existir: un `503 UNAVAILABLE` de `gemini-3.6-flash` dejaba la
 * app sin generar nada, porque la escalera de reintentos gastaba sus tres
 * llamadas contra el mismo modelo saturado y se rendía. Lo que se fija aquí es
 * la distinción de la que depende todo: qué errores se arreglan cambiando de
 * modelo y qué errores no.
 *
 * No necesita clave de API ni red.
 *
 *   node scripts/check-fallback.mjs        (o: npm run check:fallback)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModule(entry) {
  const dir = await mkdtemp(join(ROOT, '.check-fallback-'));
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
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

const {
  GENERATION_MODELS,
  describeModelChainFailure,
  isModelNotFoundError,
  isModelUnavailableError,
  isQuotaError,
  modelsFrom,
  runWithModelFallback,
  shouldSwitchModel
} = await loadModule('services/modelFallback.ts');
const { generateJsonWithProgress } = await loadModule('services/geminiService.ts');

const failures = [];
const check = (label, condition, detail = '') => {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// --- 1. La cadena ---------------------------------------------------------
{
  check('hay más de un modelo en la cadena', GENERATION_MODELS.length > 1, `${GENERATION_MODELS.length}`);
  check(
    'ningún modelo repetido',
    new Set(GENERATION_MODELS).size === GENERATION_MODELS.length,
    GENERATION_MODELS.join(' → ')
  );
  check(
    'el primero es el modelo documentado como primario',
    GENERATION_MODELS[0] === 'gemini-3.6-flash',
    GENERATION_MODELS[0]
  );
  check('todos son ids de Gemini', GENERATION_MODELS.every(m => m.startsWith('gemini-')));

  // Arrancar por el modelo que acaba de contestar: los de arriba se sabe que
  // están caídos, así que no se vuelven a llamar.
  check('modelsFrom() salta los modelos ya descartados',
    modelsFrom(GENERATION_MODELS[2]).length === GENERATION_MODELS.length - 2 &&
    modelsFrom(GENERATION_MODELS[2])[0] === GENERATION_MODELS[2]);
  check('modelsFrom() del primario devuelve la cadena entera',
    modelsFrom(GENERATION_MODELS[0]).length === GENERATION_MODELS.length);
  check('modelsFrom() de un modelo desconocido devuelve la cadena entera',
    modelsFrom('gemini-inventado').length === GENERATION_MODELS.length);
}

// --- 2. Clasificación de errores -----------------------------------------
// El error real que provocó todo esto, copiado tal cual: un JSON dentro de
// otro JSON, con `status` vacío y el 503 metido en `code` y en el texto.
{
  const saturado = Object.assign(
    new Error(
      '{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 503,\\n    \\"message\\": ' +
        '\\"This model is currently experiencing high demand. Spikes in demand are usually ' +
        'temporary. Please try again later.\\",\\n    \\"status\\": \\"UNAVAILABLE\\"\\n  }\\n}\\n",' +
        '"code":503,"status":""}}'
    ),
    { code: 503, status: '' }
  );

  check('el 503 real se reconoce como modelo no disponible', isModelUnavailableError(saturado));
  check('…y no se confunde con falta de cuota', !isQuotaError(saturado));
  check('…y cambia de modelo', shouldSwitchModel(saturado));

  check('un 503 con solo el status textual se reconoce',
    isModelUnavailableError({ status: 'UNAVAILABLE', message: 'nope' }));
  check('«overloaded» se reconoce', isModelUnavailableError(new Error('The model is overloaded.')));
  check('un 500 INTERNAL se reconoce', isModelUnavailableError({ code: 500, message: 'INTERNAL' }));

  // Cuota: cambia de modelo (el cupo del nivel gratuito es por modelo) pero
  // nunca repite contra el mismo, que es lo que asegura `check-audio`.
  check('un 429 sigue siendo falta de cuota', isQuotaError(new Error('got 429 Too Many Requests')));
  check('…y también cambia de modelo', shouldSwitchModel(new Error('got 429 Too Many Requests')));
  check('RESOURCE_EXHAUSTED cambia de modelo', shouldSwitchModel({ status: 'RESOURCE_EXHAUSTED' }));

  // Un id retirado tiene que bajar un escalón, no romper la app.
  const retirado = new Error(
    'models/gemini-2.0-flash is not found for API version v1beta, or is not supported'
  );
  check('un modelo retirado se reconoce', isModelNotFoundError(retirado));
  check('…y cambia de modelo', shouldSwitchModel(retirado));

  // Lo que NO puede cambiar de modelo: si lo hiciera, un corte de red se
  // comería la cadena entera de una vez y degradaría la lección sin motivo.
  const red = [
    new Error('socket hang up'),
    new TypeError('fetch failed'),
    new Error('terminated'),
    new Error('la API devolvió una respuesta vacía')
  ];
  for (const error of red) {
    check(`«${error.message}» no cambia de modelo`, !shouldSwitchModel(error));
  }
  check('«5000 caracteres» no se confunde con un 500',
    !isModelUnavailableError(new Error('el texto supera los 5000 caracteres')));
}

// --- 3. La escalera -------------------------------------------------------
{
  const MODELS = ['a', 'b', 'c', 'd'];
  const saturado = () => Object.assign(new Error('503 UNAVAILABLE'), { code: 503 });

  // a) El caso barato, que es el normal: nadie paga nada por que exista la cadena.
  {
    const llamados = [];
    const switches = [];
    const { value, model } = await runWithModelFallback(
      MODELS,
      async (m) => { llamados.push(m); return `ok:${m}`; },
      { onSwitch: (from, to) => switches.push(`${from}→${to}`) }
    );
    check('éxito al primer intento: una sola llamada', llamados.length === 1, llamados.join(','));
    check('…sin ningún cambio de modelo', switches.length === 0);
    check('…devolviendo el valor y el modelo usado', value === 'ok:a' && model === 'a', `${value} / ${model}`);
  }

  // b) El caso que motivó todo: el primero está saturado, el segundo contesta.
  {
    const llamados = [];
    const switches = [];
    const { value, model } = await runWithModelFallback(
      MODELS,
      async (m) => { llamados.push(m); if (m === 'a') throw saturado(); return `ok:${m}`; },
      { onSwitch: (from, to) => switches.push(`${from}→${to}`) }
    );
    check('un 503 en el primero pasa al segundo', model === 'b' && value === 'ok:b', `${model}`);
    check('…llamando a cada modelo una sola vez', llamados.join(',') === 'a,b', llamados.join(','));
    check('…y anunciando exactamente un cambio', switches.join(' ') === 'a→b', switches.join(' '));
  }

  // c) Un error de red no consume la cadena: lo reintenta la escalera interna.
  {
    const llamados = [];
    let capturado = null;
    try {
      await runWithModelFallback(MODELS, async (m) => {
        llamados.push(m);
        throw new Error('socket hang up');
      });
    } catch (error) {
      capturado = error;
    }
    check('un error de red no baja de modelo', llamados.length === 1, llamados.join(','));
    check('…y se relanza tal cual', capturado?.message === 'socket hang up', capturado?.message);
  }

  // d) Cadena agotada: se relanza el último error, no uno inventado.
  {
    const llamados = [];
    const switches = [];
    let capturado = null;
    try {
      await runWithModelFallback(
        MODELS,
        async (m) => { llamados.push(m); throw Object.assign(new Error(`503 en ${m}`), { code: 503 }); },
        { onSwitch: (from, to) => switches.push(`${from}→${to}`) }
      );
    } catch (error) {
      capturado = error;
    }
    check('con todos caídos se prueban todos', llamados.join(',') === 'a,b,c,d', llamados.join(','));
    check('…con un cambio menos que modelos', switches.length === MODELS.length - 1, `${switches.length}`);
    check('…y se relanza el error del último', capturado?.message === '503 en d', capturado?.message);
  }

  // e) El coste está acotado: la cadena nunca llama a un modelo dos veces.
  {
    const llamados = [];
    try {
      await runWithModelFallback(MODELS, async (m) => {
        llamados.push(m);
        throw Object.assign(new Error('429 quota'), { status: 429 });
      });
    } catch { /* esperado */ }
    check('la cuota agotada prueba cada modelo una vez y para',
      llamados.length === MODELS.length && new Set(llamados).size === MODELS.length,
      llamados.join(','));
  }
}

// --- 4. La escalera interna deja pasar lo que no es suyo -----------------
// La otra mitad del contrato, y la que hace verdadera la cuenta de coste: un
// 503 tiene que salir de `generateJsonWithProgress` a la primera (una llamada,
// para que la cadena baje ya), mientras que un fallo de red sigue costando sus
// tres (dos de streaming más la petición completa) contra el mismo modelo.
{
  const hooks = () => ({ onText: () => {}, onRetry: () => {}, onFallback: () => {} });
  const fakeAi = (fail) => ({
    models: {
      generateContentStream: async () => { fail('stream'); },
      generateContent: async () => { fail('completa'); }
    }
  });

  // a) Saturación: una sola llamada y fuera.
  {
    const llamadas = [];
    let capturado = null;
    try {
      await generateJsonWithProgress(
        fakeAi((via) => {
          llamadas.push(via);
          throw Object.assign(new Error('503 UNAVAILABLE: high demand'), { code: 503 });
        }),
        { model: 'a', contents: 'x' },
        hooks()
      );
    } catch (error) { capturado = error; }
    check('un 503 sale de la escalera a la primera llamada', llamadas.length === 1, llamadas.join(','));
    check('…sin llegar a la petición no-streaming', !llamadas.includes('completa'), llamadas.join(','));
    check('…y llega intacto para que la cadena lo clasifique', shouldSwitchModel(capturado));
  }

  // b) Red: la escalera de siempre, sin tocar la cadena.
  {
    const llamadas = [];
    try {
      await generateJsonWithProgress(
        fakeAi((via) => { llamadas.push(via); throw new Error('socket hang up'); }),
        { model: 'a', contents: 'x' },
        hooks()
      );
    } catch { /* esperado */ }
    check('un fallo de red agota los dos intentos de streaming más la petición completa',
      llamadas.join(',') === 'stream,stream,completa', llamadas.join(','));
  }
}

// --- 5. El mensaje que ve el usuario -------------------------------------
// Antes, un 503 llegaba a pantalla como el JSON crudo anidado.
{
  const saturado = Object.assign(new Error('503 UNAVAILABLE {"code":503}'), { code: 503 });
  const cuota = Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 });

  const msgSaturado = describeModelChainFailure(saturado, 4);
  check('el mensaje de saturación dice cuántos modelos se probaron',
    typeof msgSaturado === 'string' && msgSaturado.includes('4'), String(msgSaturado));
  check('…y no contiene el JSON crudo',
    !msgSaturado?.includes('{'), String(msgSaturado));

  const msgCuota = describeModelChainFailure(cuota, 4);
  check('el mensaje de cuota habla de cuota',
    typeof msgCuota === 'string' && msgCuota.includes('cuota'), String(msgCuota));

  check('un error que no es del modelo no se reescribe',
    describeModelChainFailure(new Error('socket hang up'), 4) === null);
  check('con un solo modelo el mensaje va en singular',
    !describeModelChainFailure(saturado, 1).includes('1 modelos'),
    describeModelChainFailure(saturado, 1));
}

if (failures.length) {
  console.error(`✗ ${failures.length} fallo(s) en la cadena de modelos:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(
  `✓ cadena de ${GENERATION_MODELS.length} modelos de texto (${GENERATION_MODELS.join(' → ')}): ` +
    'saturación, cuota y modelo retirado bajan un escalón; los fallos de red no; ' +
    'ningún modelo se llama dos veces y la ruta normal sigue costando una sola llamada'
);
