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

const { chunkDialogueLines, concatPcmChunks, ttsDialogueBudget, assignSpeakerVoices } =
  await loadModule('services/geminiService.ts');
const { checkTwoVoices, segmentPitches } = await loadModule('services/ttsVoiceCheck.ts');
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
  const pieces = chunks.flat();
  const words = w => w.replace(/\s+/g, ' ').trim().split(' ');
  const body = s => s.replace(/^Ana: /, '');
  check(
    'no se pierde texto al partir un turno enorme',
    words(pieces.map(body).join(' ')).length === words(body(huge)).length
  );
  // Cada trozo vuelve a decir de quién es. Sin esto, la segunda mitad de un
  // turno largo llegaba sin etiqueta y el modelo la leía con la voz anterior.
  check(
    'cada trozo del turno enorme conserva la etiqueta del hablante',
    pieces.every(p => p.startsWith('Ana: ')),
    pieces.map(p => p.slice(0, 12)).join(' | ')
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

// --- 7. Dos hablantes, dos voces separables ------------------------------
// El fallo que motiva esta sección: dos personajes distintos salían leídos con
// la misma voz. Primero porque la asignación mapeaba Female→Kore y Male→Fenrir
// y dos personajes del mismo género compartían timbre; después, con las voces
// ya distintas, porque «otra voz del mismo grupo» resultó no ser separable —
// medidas contra la API, las voces femeninas del catálogo caben en 3,2
// semitonos y las masculinas en 2,2. No basta con que la voz sea otra: tiene
// que sonar a otra persona, o el alumno no puede segmentar los turnos.
{
  const voicesOf = (speakers, characters) => assignSpeakerVoices(speakers, characters).map(a => a.voice);
  const semitones = (a, b) => Math.abs(12 * Math.log2(a / b));

  const cases = [
    ['dos mujeres', ['Ana', 'Lucía'], [{ name: 'Ana', gender: 'Female' }, { name: 'Lucía', gender: 'Female' }]],
    ['dos hombres', ['Marcos', 'Diego'], [{ name: 'Marcos', gender: 'Male' }, { name: 'Diego', gender: 'Male' }]],
    ['mujer y hombre', ['Ana', 'Diego'], [{ name: 'Ana', gender: 'Female' }, { name: 'Diego', gender: 'Male' }]],
    ['sin fichas de personaje', ['Ana', 'Diego'], []],
    ['una ficha suelta', ['Ana', 'Diego'], [{ name: 'Ana', gender: 'Female' }]],
    ['etiquetas con acotación', ['Ana (cajera)', 'Sra. Díaz'], [{ name: 'Ana', gender: 'Female' }, { name: 'Díaz', gender: 'Female' }]],
    ['nombres que se contienen', ['Ana', 'Ana María'], [{ name: 'Ana', gender: 'Female' }, { name: 'Ana María', gender: 'Female' }]]
  ];

  for (const [label, speakers, characters] of cases) {
    const assigned = assignSpeakerVoices(speakers, characters);
    const voices = assigned.map(a => a.voice);
    check(`[${label}] las dos voces son distintas`, new Set(voices).size === 2, voices.join(' = '));

    const gap = semitones(assigned[0].pitchHz, assigned[1].pitchHz);
    check(
      `[${label}] las dos voces se distinguen por el tono`,
      gap >= 4.5,
      `${voices.join(' / ')} = ${gap.toFixed(1)} semitonos`
    );
  }

  // Cuando el género es compatible con la separación, se respeta.
  const [ana, diego] = assignSpeakerVoices(
    ['Ana', 'Diego'],
    [{ name: 'Ana', gender: 'Female' }, { name: 'Diego', gender: 'Male' }]
  );
  check('la mujer recibe una voz femenina', ana.pitchHz > 170, `${ana.voice} ${ana.pitchHz} Hz`);
  check('el hombre recibe una voz masculina', diego.pitchHz < 140, `${diego.voice} ${diego.pitchHz} Hz`);

  // Y dos mujeres siguen siendo dos mujeres: el catálogo femenino da 4,8
  // semitonos, que llegan al mínimo. Solo entre dos hombres hay que ceder.
  const dosMujeres = assignSpeakerVoices(
    ['Ana', 'Lucía'],
    [{ name: 'Ana', gender: 'Female' }, { name: 'Lucía', gender: 'Female' }]
  );
  check(
    'dos mujeres conservan las dos voces femeninas',
    dosMujeres.every(a => a.pitchHz > 170),
    dosMujeres.map(a => `${a.voice} ${a.pitchHz}`).join(' / ')
  );

  // El hablante con más turnos es el que conserva su género si hay que ceder.
  const dosHombres = assignSpeakerVoices(
    ['Marcos', 'Diego'],
    [{ name: 'Marcos', gender: 'Male' }, { name: 'Diego', gender: 'Male' }]
  );
  check(
    'entre dos hombres, el principal conserva su voz masculina',
    dosHombres[0].pitchHz < 140,
    dosHombres.map(a => `${a.voice} ${a.pitchHz}`).join(' / ')
  );

  // Cada asignación lleva el tono de referencia con el que luego se verifica
  // el audio: sin ese número no hay forma de saber si el modelo obedeció.
  check(
    'cada voz asignada trae su tono de referencia',
    dosHombres.every(a => Number.isFinite(a.pitchHz) && a.pitchHz > 0 && a.timbre)
  );

  // La etiqueta que viaja al TTS tiene que ser inconfundible: si no, el modelo
  // no sabe de quién es el turno y lo lee todo con la primera voz.
  const acotadas = assignSpeakerVoices(['Ana (cajera)', 'Sra. Díaz'], []);
  check('la acotación se cae de la etiqueta', acotadas[0].label === 'Ana', acotadas[0].label);

  const contenidas = assignSpeakerVoices(['Ana', 'Ana María'], []);
  check(
    'los nombres que se contienen se numeran',
    contenidas.map(a => a.label).join('/') === 'Hablante 1/Hablante 2',
    contenidas.map(a => a.label).join('/')
  );

  // Una sola voz sigue siendo una sola voz.
  const solo = assignSpeakerVoices(['Locutor'], [{ name: 'Locutor', gender: 'Male' }]);
  check('el monólogo asigna una única voz', solo.length === 1, `${solo.length} voces`);
  check('el monólogo respeta el género del locutor', solo[0].pitchHz < 140, `${solo[0].voice} ${solo[0].pitchHz} Hz`);
}

// --- 8. El verificador de voces ------------------------------------------
// Por qué existe: el `multiSpeakerVoiceConfig` de Gemini no enruta nada, el
// modelo *decide* de quién es cada turno leyendo el texto, y a veces decide
// leerlo todo con una voz. Medido contra la API con el formato anterior, la voz
// grave faltaba en 2 de cada 3 generaciones. Como el fallo solo se ve en el
// audio, se mide el audio.
{
  // Una «voz» sintética: tren de pulsos a F0 con envolvente silábica, que es
  // lo que la autocorrelación necesita para dar un tono.
  const voice = (f0, seconds, rate = 24000) => {
    const n = Math.round(rate * seconds);
    const out = new Int16Array(n);
    const period = rate / f0;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      phase += 1 / period;
      if (phase >= 1) phase -= 1;
      // Diente de sierra: rico en armónicos, periodicidad inequívoca.
      const syllable = 0.55 + 0.45 * Math.sin((2 * Math.PI * i * 4.5) / rate);
      out[i] = Math.round((2 * phase - 1) * 9000 * syllable);
    }
    return new Uint8Array(out.buffer);
  };
  const silence = seconds => new Uint8Array(Math.round(24000 * seconds) * 2);
  const track = (...pieces) => {
    const total = pieces.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of pieces) { out.set(p, at); at += p.length; }
    return out;
  };

  const gap = () => silence(0.4);
  const alto = () => voice(233, 1.2);
  const grave = () => voice(119, 1.2);

  const dos = track(alto(), gap(), grave(), gap(), alto(), gap(), grave(), gap(), alto(), gap(), grave());
  const una = track(alto(), gap(), alto(), gap(), alto(), gap(), alto(), gap(), alto(), gap(), alto());

  check(
    'el medidor encuentra el tono de cada segmento',
    segmentPitches(alto()).every(p => Math.abs(p - 233) < 12),
    segmentPitches(alto()).map(Math.round).join(' ')
  );

  const conDos = checkTwoVoices(dos, 233, 119);
  check('un audio con las dos voces pasa la comprobación', conDos.ok, conDos.reason);
  check('…y las atribuye a las dos', conDos.evidence[0] > 0 && conDos.evidence[1] > 0, conDos.evidence.join('/'));

  const conUna = checkTwoVoices(una, 233, 119);
  check('un audio con una sola voz se detecta', !conUna.ok, conUna.reason);
  check('…y se dice cuál falta', /119 Hz/.test(conUna.reason), conUna.reason);

  // El error que hacía inútil la medida: la autocorrelación se queda con el
  // pico más alto, que aparece en cada múltiplo del periodo, y una voz de
  // 119 Hz se leía a 59. Con eso, «falta la voz grave» era siempre cierto.
  const graves = segmentPitches(grave());
  check(
    'una voz grave no se lee una octava por debajo',
    graves.length > 0 && graves.every(p => Math.abs(p - 119) < 12),
    graves.map(Math.round).join(' ')
  );

  // Sin material suficiente no se acusa a nadie: un falso positivo cuesta una
  // petición de más contra la cuota del TTS.
  const corto = checkTwoVoices(track(alto(), gap(), alto()), 233, 119);
  check('con poco audio la comprobación se declara no concluyente', !corto.conclusive && corto.ok, corto.reason);

  // Dos referencias pegadas no permiten decidir, y decirlo es parte del
  // contrato: por eso `assignSpeakerVoices` garantiza la separación.
  const pegadas = checkTwoVoices(dos, 122, 119);
  check('dos referencias sin separación no dan veredicto', !pegadas.conclusive, pegadas.reason);
}

if (failures.length) {
  console.error(`✗ ${failures.length} fallo(s) en el troceo de audio:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(
  '✓ troceo de audio correcto en los 8 acentos (ningún turno perdido, ningún tramo fuera de presupuesto), ' +
    'unión de PCM verificada, dos voces separadas por al menos 4,5 semitonos para dos hablantes ' +
    'y verificador de voces que distingue un audio a dos voces de uno a una sola'
);
