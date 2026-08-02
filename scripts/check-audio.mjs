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

const {
  chunkDialogueLines,
  concatPcmChunks,
  ttsDialogueBudget,
  assignSpeakerVoices,
  planAudioRequests,
  isQuotaError
} = await loadModule('services/geminiService.ts');
const { checkTwoVoices, segmentPitches } = await loadModule('services/ttsVoiceCheck.ts');
const { splitIntoTurns } = await loadModule('services/ttsTurnSplit.ts');
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
// grave faltaba en 2 de cada 3 generaciones.
// Ya no dispara ninguna reparación —cada voz se pide por separado, ver la
// sección 9—, pero sigue midiendo la pista final para el registro, y para eso
// tiene que seguir siendo capaz de distinguir un audio a dos voces de uno a una.
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

// --- 9. El coste en peticiones: dos, y sabidas de antemano ---------------
// Es el contrato entero de este diseño. Antes, garantizar las dos voces costaba
// 1 petición en el mejor caso y 8 en el peor (dos intentos con el modelo más una
// petición por turno), sobre las 10 diarias que da el nivel gratuito. Ahora cada
// voz se pide por separado: dos peticiones, sin reintentos y sin medir nada.
{
  const speech = (n) =>
    `Turno número ${n}, con una frase de longitud realista para un diálogo de nivel intermedio.`;
  const conversation = (count) =>
    Array.from({ length: count }, (_, i) => ({
      speaker: i % 2 === 0 ? 'Lucía' : 'Andrés',
      text: speech(i + 1)
    }));
  const cast = [
    { name: 'Lucía', gender: 'Female' },
    { name: 'Andrés', gender: 'Male' }
  ];

  for (const accent of Object.values(Accent)) {
    const plan = planAudioRequests(conversation(6), cast, accent);
    check(
      `un diálogo de 6 turnos cuesta exactamente 2 peticiones (${accent})`,
      plan.requests.length === 2,
      `${plan.requests.length} peticiones`
    );
    check(
      `cada petición lleva una sola voz (${accent})`,
      new Set(plan.requests.map(r => r.owner.voice)).size === 2,
      plan.requests.map(r => r.owner.voice).join(' / ')
    );
  }

  // Ningún turno se pierde por el camino, en el acento con menos presupuesto.
  const largo = conversation(14);
  const plan = planAudioRequests(largo, cast, Accent.BuenosAires);
  const covered = plan.requests.flatMap(r => r.turnAt);
  check(
    'ningún turno se pierde al agrupar por hablante',
    new Set(covered).size === largo.length,
    `${new Set(covered).size} de ${largo.length}`
  );
  check(
    'cada petición respeta el presupuesto del acento',
    plan.requests.every(r => r.lines.join('\n\n').length <= plan.budget),
    plan.requests.map(r => r.lines.join('\n\n').length).join(' / ')
  );
  // Las piezas de cada petición y sus turnos van emparejadas una a una.
  check(
    'cada pieza sabe de qué turno viene',
    plan.requests.every(r => r.lines.length === r.turnAt.length)
  );
  // Sin etiqueta: con una sola voz configurada, «Lucía:» se leería en alto.
  check(
    'el texto que se envía no lleva la etiqueta del hablante',
    plan.requests.every(r => r.lines.every(l => !/^(Lucía|Andrés):/.test(l))),
    plan.requests[0].lines[0].slice(0, 20)
  );

  // Un monólogo sigue siendo una sola petición.
  const monologo = planAudioRequests(
    Array.from({ length: 8 }, (_, i) => ({ speaker: 'Narrador', text: speech(i + 1) })),
    [{ name: 'Narrador', gender: 'Male' }],
    Accent.Madrid
  );
  check(
    'un monólogo cuesta una sola petición',
    monologo.requests.length === 1 && !monologo.isMultiSpeaker,
    `${monologo.requests.length} peticiones`
  );
}

// --- 10. Errores de cuota: no se reintentan ------------------------------
// Un 429 gastaba tres llamadas (dos de streaming más el fallback sin streaming)
// de las diez del día, porque el reintento no miraba de qué error se trataba.
{
  check('un 429 se reconoce como falta de cuota', isQuotaError(new Error('got 429 Too Many Requests')));
  check('RESOURCE_EXHAUSTED se reconoce', isQuotaError(new Error('RESOURCE_EXHAUSTED: quota')));
  check('el status numérico se reconoce', isQuotaError({ status: 429, message: 'nope' }));
  check('«quota exceeded» se reconoce', isQuotaError(new Error('Quota exceeded for model')));
  check('un fallo de red no se confunde con cuota', !isQuotaError(new Error('socket hang up')));
  check('una respuesta vacía no se confunde con cuota', !isQuotaError(new Error('la API devolvió una respuesta vacía')));
}

// --- 11. Recuperar los turnos del bloque de cada voz ---------------------
// Lo que se paga por no medir-y-repetir: cada voz vuelve en un bloque continuo
// y hay que partirlo. Nunca puede costar otra petición, así que la salida de
// emergencia (reparto proporcional) tiene que producir siempre los k trozos.
{
  const RATE = 24000;
  const samples = (msValue) => Math.round((RATE * msValue) / 1000);

  const pcmOf = (x) => {
    const out = new Uint8Array(x.length * 2);
    for (let i = 0; i < x.length; i++) {
      const s = Math.round(Math.max(-1, Math.min(1, x[i])) * 32767);
      out[i * 2] = s & 0xff;
      out[i * 2 + 1] = (s >> 8) & 0xff;
    }
    return out;
  };
  const speech = (msValue, f0 = 150) => {
    const n = samples(msValue);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      out[i] = 0.4 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * f0 * t);
    }
    return out;
  };
  const quiet = (msValue) => new Float32Array(samples(msValue));
  const cat = (...parts) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const seconds = (bytes) => bytes.byteLength / 2 / RATE;

  // a) Fronteras marcadas: se encuentran y cada trozo lleva su turno.
  {
    const r = splitIntoTurns(
      pcmOf(cat(quiet(200), speech(1500), quiet(400), speech(900), quiet(400), speech(2000), quiet(200))),
      [60, 36, 80],
      RATE
    );
    check('tres turnos con pausas claras dan tres trozos', r.pieces.length === 3);
    check('…y las tres fronteras salen de un silencio medido', r.measured === 2 && r.interpolated === 0,
      `medidas ${r.measured}, interpoladas ${r.interpolated}`);
    // Cada trozo se queda con su habla más la mitad del silencio de cada lado.
    const want = [1.5 + 0.06 + 0.2, 0.9 + 0.4, 2.0 + 0.2 + 0.06];
    r.pieces.forEach((p, i) => {
      check(`el trozo ${i + 1} dura lo que su turno`, Math.abs(seconds(p) - want[i]) < 0.12,
        `${seconds(p).toFixed(2)} s, esperado ${want[i].toFixed(2)}`);
    });
  }

  // b) Sin un solo silencio: el reparto proporcional no puede fallar ni pedir
  // otra petición. Es el caso que sustituye a la escalera de reparación.
  {
    const r = splitIntoTurns(pcmOf(speech(4000)), [50, 50, 100], RATE);
    check('sin silencios se devuelven igualmente los tres trozos', r.pieces.length === 3);
    check('…y se dice que fueron por reparto', r.interpolated === 2 && r.measured === 0,
      `medidas ${r.measured}, interpoladas ${r.interpolated}`);
    const want = [1, 1, 2];
    r.pieces.forEach((p, i) => {
      check(`el trozo ${i + 1} sigue el reparto de caracteres`, Math.abs(seconds(p) - want[i]) < 0.2,
        `${seconds(p).toFixed(2)} s, esperado ${want[i]}`);
    });
  }

  // c) El reparto de caracteres manda: turnos muy desiguales no salen iguales.
  {
    const r = splitIntoTurns(
      pcmOf(cat(speech(2500), quiet(350), speech(300), quiet(350), speech(2500))),
      [200, 20, 200],
      RATE
    );
    check('un turno corto entre dos largos se reconoce como corto',
      seconds(r.pieces[1]) < 1 && seconds(r.pieces[0]) > 2 && seconds(r.pieces[2]) > 2,
      r.pieces.map(p => seconds(p).toFixed(2)).join(' / '));
  }

  // d) Una pausa entre frases dentro de un turno no es una frontera de turno.
  // Sin el reparto esperado como guía, el hueco más largo se llevaría el corte
  // al sitio equivocado y el turno 2 empezaría a mitad del turno 1.
  {
    const r = splitIntoTurns(
      pcmOf(cat(speech(1200), quiet(300), speech(1200), quiet(500), speech(1200))),
      [120, 60],
      RATE
    );
    check('una pausa interna no se confunde con la frontera del turno',
      Math.abs(seconds(r.pieces[0]) - 2.95) < 0.2,
      `${seconds(r.pieces[0]).toFixed(2)} s, esperado ~2.95`);
  }

  // e) Contrato duro: siempre k trozos, ninguno vacío, todos alineados a 16 bits.
  {
    const track = pcmOf(cat(speech(600), quiet(300), speech(600)));
    for (const k of [1, 2, 3, 5, 8]) {
      const r = splitIntoTurns(track, Array.from({ length: k }, () => 40), RATE);
      check(`k=${k}: se devuelven exactamente ${k} trozos`, r.pieces.length === k, `${r.pieces.length}`);
      check(`k=${k}: ningún trozo vacío`, r.pieces.every(p => p.byteLength > 0));
      check(`k=${k}: todos los trozos alineados a 16 bits`, r.pieces.every(p => p.byteLength % 2 === 0));
    }
    // Un PCM inservible tampoco puede quedarse sin trozos.
    const vacio = splitIntoTurns(new Uint8Array(0), [10, 10], RATE);
    check('un PCM vacío devuelve igualmente dos trozos', vacio.pieces.length === 2);
  }

  // f) Los turnos se montan en el orden del diálogo, no en el de las peticiones.
  {
    const durations = [1400, 900, 1800, 700, 1200, 1000];
    const parts = [];
    for (const d of durations) parts.push(speech(d), quiet(350));
    const r = splitIntoTurns(pcmOf(cat(...parts)), durations.map(d => Math.round(d / 12)), RATE);
    check('seis turnos seguidos se separan por sus seis silencios',
      r.pieces.length === 6 && r.measured === 5,
      `${r.pieces.length} trozos, ${r.measured} medidas`);
    check('…y cada uno conserva la duración de su turno',
      r.pieces.every((p, i) => Math.abs(seconds(p) - durations[i] / 1000) < 0.4),
      r.pieces.map(p => seconds(p).toFixed(2)).join(' / '));
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} fallo(s) en el troceo de audio:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(
  '✓ troceo de audio correcto en los 8 acentos (ningún turno perdido, ningún tramo fuera de presupuesto), ' +
    'unión de PCM verificada, dos voces separadas por al menos 4,5 semitonos para dos hablantes, ' +
    'verificador de voces que distingue un audio a dos voces de uno a una sola, ' +
    'coste fijo de 2 peticiones por diálogo en los 8 acentos sin reintentos, ' +
    'errores de cuota distinguidos de los de red, ' +
    'y recuperación de los turnos del bloque de cada voz (por silencio medido y, sin silencios, por reparto)'
);
