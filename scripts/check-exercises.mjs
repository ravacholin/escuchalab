#!/usr/bin/env node
/**
 * Pruebas del verificador de claves y de los motores deterministas.
 *
 * Se le pasan ejercicios deliberadamente mal construidos sobre una
 * transcripción conocida y se comprueba que ninguno pasa el control, y después
 * se comprueba que los motores producen ejercicios que sí lo pasan.
 *
 * Sin clave de API ni red.
 *
 *   node scripts/check-exercises.mjs      (o: npm run check:exercises)
 */

import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModules() {
  const dir = await mkdtemp(join(tmpdir(), 'escuchalab-exercises-'));
  const entry = join(dir, 'entry.ts');
  const outfile = join(dir, 'bundle.mjs');

  await writeFile(
    entry,
    `export * from '${join(ROOT, 'services/exerciseVerification.ts')}';
     export * from '${join(ROOT, 'services/exerciseEngines.ts')}';
     export * from '${join(ROOT, 'services/answerMatching.ts')}';
     export * from '${join(ROOT, 'services/textUtils.ts')}';`
  );

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    alias: { '@': ROOT }
  });

  const mod = await import(pathToFileURL(outfile).href);
  await rm(dir, { recursive: true, force: true });
  return mod;
}

const { verifyExercise, buildTranscriptIndex, fillMissingSlots, matchesDatum } = await loadModules();

// Silencia los console.warn de diagnóstico durante las pruebas.
const realWarn = console.warn;
console.warn = () => {};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// ---------------------------------------------------------------------------
// Transcripción de referencia
// ---------------------------------------------------------------------------

const DIALOGUE = [
  { speaker: 'Recepcionista', text: 'Buenos días, farmacia del centro, ¿en qué puedo ayudarle?' },
  { speaker: 'Cliente', text: 'Hola, quería saber si tienen el jarabe que receta el médico para la tos.' },
  { speaker: 'Recepcionista', text: 'Sí, nos quedan tres frascos. El precio es de 14,95 con la receta.' },
  { speaker: 'Cliente', text: 'Perfecto, paso a buscarlo esta tarde. ¿Hasta qué hora abren hoy?' },
  { speaker: 'Recepcionista', text: 'Cerramos a las 20:30, pero el turno de la tarde empieza a las 16:00.' },
  { speaker: 'Cliente', text: 'Muy bien, entonces llego sobre las cinco. Muchas gracias por la información.' }
];

const index = buildTranscriptIndex(DIALOGUE);
const ok = ex => verifyExercise(ex, index).ok;
const why = ex => verifyExercise(ex, index).reason;

// ---------------------------------------------------------------------------
// 1. Claves incoherentes: deben rechazarse
// ---------------------------------------------------------------------------

const REJECT_CASES = [
  [
    'multiple_choice cuya respuesta no está entre las opciones',
    {
      type: 'multiple_choice',
      question: '¿Cuánto cuesta el jarabe?',
      options: [{ id: 'a', text: '14,95' }, { id: 'b', text: '40,95' }],
      correctAnswer: 'zzz',
      explanation: ''
    }
  ],
  [
    'multiple_choice en que todas las opciones son correctas',
    {
      type: 'multiple_choice',
      question: 'Marcá lo que se dice',
      options: [{ id: 'a', text: 'tos' }, { id: 'b', text: 'jarabe' }],
      correctAnswer: ['a', 'b'],
      explanation: ''
    }
  ],
  [
    'ordering que no es una permutación de sus elementos',
    {
      type: 'ordering',
      question: 'Ordená',
      options: [{ id: 's1', text: 'pide el jarabe' }, { id: 's2', text: 'pregunta el horario' }, { id: 's3', text: 'se despide' }],
      correctAnswer: ['s1', 's1', 's2'],
      explanation: ''
    }
  ],
  [
    'ordering construido copiando turnos literales del diálogo',
    {
      type: 'ordering',
      question: 'Ordená',
      options: DIALOGUE.slice(0, 4).map((l, i) => ({ id: `s${i}`, text: l.text })),
      correctAnswer: ['s0', 's1', 's2', 's3'],
      explanation: ''
    }
  ],
  [
    'matching no biyectivo (una opción usada dos veces)',
    {
      type: 'matching',
      question: 'Emparejá',
      rows: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }, { id: 'r3', text: 'c' }],
      columns: [{ id: 'c1', text: 'x' }, { id: 'c2', text: 'y' }, { id: 'c3', text: 'z' }],
      correctAnswer: { r1: 'c1', r2: 'c1', r3: 'c3' },
      explanation: ''
    }
  ],
  [
    'true_false_notgiven sin ningún ítem "no se dice"',
    {
      type: 'true_false_notgiven',
      question: 'Juzgá',
      rows: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }, { id: 'r3', text: 'c' }],
      correctAnswer: { r1: 'true', r2: 'false', r3: 'true' },
      explanation: ''
    }
  ],
  [
    'cloze cuya solución no suena en el audio',
    {
      type: 'cloze',
      question: 'Completá',
      textWithGaps: 'Sí, nos quedan tres {{gap1}}.',
      gapOptions: { gap1: [{ id: 'g1', text: 'paraguas' }, { id: 'g2', text: 'frascos' }] },
      correctAnswer: { gap1: 'g1' },
      explanation: ''
    }
  ],
  [
    'chunk_order cuya frase reconstruida no existe en el audio',
    {
      type: 'chunk_order',
      question: 'Reconstruí',
      options: [{ id: 'k1', text: '¿hasta qué hora' }, { id: 'k2', text: 'cierran' }, { id: 'k3', text: 'mañana?' }],
      correctAnswer: ['k1', 'k2', 'k3'],
      explanation: ''
    }
  ],
  [
    'caza-el-cambio que marca como alterada una palabra que sí se dice',
    {
      type: 'spot_the_difference',
      question: 'Marcá',
      tokens: 'Cerramos a las 20:30, pero el turno de la tarde empieza'
        .split(' ')
        .map((text, i) => ({ id: `t${i}`, text })),
      correctAnswer: ['t0', 't1'],
      explanation: ''
    }
  ],
  [
    'scale con todos los enunciados en el mismo punto del eje',
    {
      type: 'scale',
      question: 'Ubicá',
      rows: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }, { id: 'r3', text: 'c' }],
      columns: [{ id: 'p1', text: 'no' }, { id: 'p2', text: 'quizá' }, { id: 'p3', text: 'sí' }],
      correctAnswer: { r1: 'p2', r2: 'p2', r3: 'p2' },
      explanation: ''
    }
  ],
  [
    'classification con una fila sin columna válida',
    {
      type: 'classification',
      question: 'Clasificá',
      rows: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }, { id: 'r3', text: 'c' }],
      columns: [{ id: 'c1', text: 'x' }, { id: 'c2', text: 'y' }],
      correctAnswer: { r1: 'c1', r2: 'c2', r3: 'inexistente' },
      explanation: ''
    }
  ],
  [
    'pares mínimos en que suena el distractor y no la solución',
    {
      type: 'minimal_pairs',
      question: '¿Qué oíste?',
      fields: [
        { id: 'm1', label: '1', options: [{ id: 'm1a', text: 'toz' }, { id: 'm1b', text: 'tos' }] },
        { id: 'm2', label: '2', options: [{ id: 'm2a', text: 'receta' }, { id: 'm2b', text: 'recetas' }] }
      ],
      correctAnswer: { m1: 'm1a', m2: 'm2a' },
      explanation: ''
    }
  ],
  [
    'dictado cuyo dato no se dice de corrido',
    {
      type: 'dictation',
      question: 'Escribí el precio',
      // "14,55" no se dice: el audio dice "14,95".
      expected: '14,55',
      dataKind: 'price',
      correctAnswer: '14,55',
      explanation: ''
    }
  ],
  [
    'dictado sin dato que anotar',
    {
      type: 'dictation',
      question: 'Escribí el precio',
      expected: '   ',
      correctAnswer: '',
      explanation: ''
    }
  ],
  [
    'dictado con una variante aceptada que no es el mismo dato',
    {
      type: 'dictation',
      question: 'Escribí el precio',
      expected: '14,95',
      // Aceptar "14,55" daría por buena una respuesta falsa, que es peor que
      // rechazar una verdadera.
      accepts: ['14,55'],
      dataKind: 'price',
      correctAnswer: '14,95',
      explanation: ''
    }
  ],
  [
    'opción múltiple de dato literal cuya clave no cita nada que suene',
    {
      type: 'multiple_choice',
      skill: 'dato_literal',
      question: '¿Cuál es el precio del jarabe?',
      options: [
        { id: 'a', text: 'algo más de catorce euros con descuento' },
        { id: 'b', text: 'una cifra cercana a los cuarenta' }
      ],
      correctAnswer: 'a',
      explanation: ''
    }
  ]
];

for (const [name, exercise] of REJECT_CASES) {
  check(!ok(exercise), `debería rechazarse: ${name}`);
}

// ---------------------------------------------------------------------------
// 2. Ejercicios correctos: deben aceptarse
// ---------------------------------------------------------------------------

const ACCEPT_CASES = [
  [
    'multiple_choice bien formado',
    {
      type: 'multiple_choice',
      question: '¿Cuánto cuesta?',
      options: [{ id: 'a', text: '14,95' }, { id: 'b', text: '40,95' }, { id: 'c', text: '14,55' }],
      correctAnswer: 'a',
      sourceTurns: [2],
      explanation: ''
    }
  ],
  [
    'cloze cuya solución suena literalmente',
    {
      type: 'cloze',
      question: 'Completá',
      textWithGaps: 'Sí, nos quedan tres {{gap1}}.',
      gapOptions: { gap1: [{ id: 'g1', text: 'frascos' }, { id: 'g2', text: 'frescos' }] },
      correctAnswer: { gap1: 'g1' },
      explanation: ''
    }
  ],
  [
    'true_false_notgiven con su ítem "no se dice"',
    {
      type: 'true_false_notgiven',
      question: 'Juzgá',
      rows: [{ id: 'r1', text: 'Quedan tres frascos.' }, { id: 'r2', text: 'Cierran a las 18:00.' }, { id: 'r3', text: 'El cliente es alérgico.' }],
      correctAnswer: { r1: 'true', r2: 'false', r3: 'not_given' },
      explanation: ''
    }
  ],
  [
    'chunk_order reconstruible desde el audio',
    {
      type: 'chunk_order',
      question: 'Reconstruí',
      options: [{ id: 'k1', text: '¿Hasta qué' }, { id: 'k2', text: 'hora abren' }, { id: 'k3', text: 'hoy?' }],
      correctAnswer: ['k1', 'k2', 'k3'],
      explanation: ''
    }
  ],
  [
    'dictado cuyo dato sí se dice de corrido',
    {
      type: 'dictation',
      question: 'Escribí el precio',
      expected: '14,95',
      accepts: ['catorce con noventa y cinco'],
      dataKind: 'price',
      correctAnswer: '14,95',
      sourceTurns: [2],
      explanation: ''
    }
  ],
  [
    'opción múltiple de dato literal cuya clave sí suena',
    {
      type: 'multiple_choice',
      skill: 'dato_literal',
      question: '¿Cuánto cuesta el jarabe?',
      options: [{ id: 'a', text: '14,95' }, { id: 'b', text: '40,95' }, { id: 'c', text: '14,55' }],
      correctAnswer: 'a',
      sourceTurns: [2],
      explanation: ''
    }
  ]
];

for (const [name, exercise] of ACCEPT_CASES) {
  check(ok(exercise), `debería aceptarse: ${name} (motivo del rechazo: ${why(exercise)})`);
}

// ---------------------------------------------------------------------------
// 3. Normalización: el modelo devuelve textos donde el esquema espera ids
// ---------------------------------------------------------------------------

check(
  ok({
    type: 'multiple_choice',
    question: '¿Cuánto cuesta?',
    options: [{ id: 'a', text: '14,95' }, { id: 'b', text: '40,95' }],
    correctAnswer: '14,95',
    explanation: ''
  }),
  'la respuesta dada como texto debería mapearse al id de su opción'
);

check(
  ok({
    type: 'true_false',
    question: 'Juzgá',
    rows: [{ id: 'r1', text: 'a' }, { id: 'r2', text: 'b' }],
    correctAnswer: { r1: 'Verdadero', r2: 'FALSO' },
    explanation: ''
  }),
  'los juicios en palabras ("Verdadero"/"FALSO") deberían mapearse a true/false'
);

// ---------------------------------------------------------------------------
// 4. Motores deterministas: lo que producen tiene que pasar el mismo control
// ---------------------------------------------------------------------------

const ENGINE_SLOTS = [
  { slotId: 't-ficha', stage: 'selectiva', skill: 'dato_literal', format: 'data_capture', items: 4, brief: 'x', engineFallback: 'data_capture' },
  { slotId: 't-pares', stage: 'selectiva', skill: 'decodificacion', format: 'minimal_pairs', items: 4, brief: 'x', engineFallback: 'minimal_pairs' },
  { slotId: 't-caza', stage: 'selectiva', skill: 'reconocimiento_lexico', format: 'multiple_choice', items: 6, brief: 'x', engineFallback: 'select_all_heard' },
  { slotId: 't-vf', stage: 'selectiva', skill: 'reconocimiento_lexico', format: 'true_false', items: 4, brief: 'x', engineFallback: 'mention_true_false' },
  { slotId: 't-cloze', stage: 'intensiva', skill: 'colocacion_formula', format: 'cloze', items: 2, brief: 'x', engineFallback: 'two_gap_cloze' },
  { slotId: 't-cambio', stage: 'intensiva', skill: 'segmentacion', format: 'spot_the_difference', items: 4, brief: 'x', engineFallback: 'spot_the_difference' },
  { slotId: 't-chunks', stage: 'intensiva', skill: 'segmentacion', format: 'chunk_order', items: 4, brief: 'x', engineFallback: 'chunk_order' }
];

const built = fillMissingSlots([], ENGINE_SLOTS, DIALOGUE);

check(built.length > 0, 'los motores no produjeron ningún ejercicio a partir de la transcripción');

for (const exercise of built) {
  const result = verifyExercise(exercise, index);
  check(result.ok, `el motor produjo un ejercicio que no verifica (${exercise.slotId}): ${result.reason}`);
  check(!!exercise.stage && !!exercise.skill, `el ejercicio ${exercise.slotId} salió sin etapa o sin habilidad`);
}

// Ningún texto mostrado al alumno puede venir en la forma normalizada sin
// tildes: era el defecto que hacía aparecer "telefono" y "contrasena".
const shownTexts = [];
for (const exercise of built) {
  for (const opt of exercise.options || []) shownTexts.push(opt.text);
  for (const row of exercise.rows || []) shownTexts.push(row.text);
  for (const field of exercise.fields || []) for (const o of field.options) shownTexts.push(o.text);
  for (const options of Object.values(exercise.gapOptions || {})) for (const o of options) shownTexts.push(o.text);
}
const strip = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Palabras del audio indexadas por su forma sin tildes, junto a su ortografía real.
const spokenByStripped = new Map();
for (const line of DIALOGUE) {
  for (const raw of line.text.split(/\s+/)) {
    const word = raw.replace(/^[¡¿"'“”«»(]+|[.,;:!?"'“”«»)…]+$/g, '');
    if (!word) continue;
    spokenByStripped.set(strip(word), word);
  }
}

for (const text of shownTexts) {
  // Solo interesa el caso en que se muestra una forma SIN tildes.
  const isUnaccented = strip(text) === text.toLowerCase();
  if (!isUnaccented) continue;
  const twin = spokenByStripped.get(strip(text));
  if (!twin) continue; // no es una palabra del audio: es un distractor, y está bien
  check(
    twin === text || twin.toLowerCase() === text.toLowerCase(),
    `se muestra "${text}" pero en el audio se dice "${twin}": hay que conservar la ortografía real`
  );
}

// ---------------------------------------------------------------------------
// 5. El dato dictado: el motor de ficha tiene que encontrarlo de las dos formas
// ---------------------------------------------------------------------------
// El prompt de A0 pide dictar el teléfono "dígito a dígito", así que el modelo
// escribe tanto "seis, cinco, cuatro…" como "654 32 18". Con solo la primera
// forma el motor no encontraba nada y la ficha —el único ejercicio del nivel
// sobre el número— desaparecía; con la segunda partía el teléfono en tres
// campos sueltos llamados "Número".

const PHONE_SLOT = {
  slotId: 't-ficha-tel',
  stage: 'selectiva',
  skill: 'dato_literal',
  format: 'data_capture',
  items: 3,
  brief: 'x',
  engineFallback: 'data_capture',
  focus: 'phone'
};

const SPOKEN_PHONE = [
  { speaker: 'Cliente', text: 'Hola, quería dejar mi contacto para el aviso del pedido.' },
  { speaker: 'Empleada', text: 'Perfecto, dígame el teléfono.' },
  { speaker: 'Cliente', text: 'Es el seis cinco cuatro treinta y dos dieciocho, sí.' },
  { speaker: 'Empleada', text: 'Anotado. Le avisamos esta misma tarde, sobre las 18:30.' }
];

const spokenFicha = fillMissingSlots([], [PHONE_SLOT], SPOKEN_PHONE).find(
  ex => ex.slotId === 't-ficha-tel'
);
check(!!spokenFicha, 'un teléfono dictado con palabras debería producir una ficha de datos');
if (spokenFicha) {
  check(
    verifyExercise(spokenFicha, buildTranscriptIndex(SPOKEN_PHONE)).ok,
    'la ficha del teléfono dictado con palabras no verifica'
  );
  check(
    spokenFicha.fields.some(f => f.label === 'Teléfono'),
    `la ficha debería tener un campo "Teléfono" (tiene: ${spokenFicha.fields.map(f => f.label).join(', ')})`
  );
  const phoneField = spokenFicha.fields.find(f => f.label === 'Teléfono');
  if (phoneField) {
    check(
      phoneField.options.length >= 3,
      'el campo del teléfono debería ofrecer el valor correcto y dos alternativas casi idénticas'
    );
  }
}

const GROUPED_PHONE = [
  { speaker: 'Cliente', text: 'Le dejo mi número por si acaso.' },
  { speaker: 'Empleada', text: 'Muy bien, ¿cuál es?' },
  { speaker: 'Cliente', text: 'El 654 32 18. Y el pedido lo recojo a las 19:15.' }
];

const groupedFicha = fillMissingSlots([], [PHONE_SLOT], GROUPED_PHONE).find(
  ex => ex.slotId === 't-ficha-tel'
);
check(!!groupedFicha, 'un teléfono en cifras agrupadas debería producir una ficha de datos');
if (groupedFicha) {
  const labels = groupedFicha.fields.map(f => f.label);
  check(
    labels.filter(l => l.startsWith('Número')).length === 0,
    `"654 32 18" debería leerse como un único teléfono, no como números sueltos (campos: ${labels.join(', ')})`
  );
  check(
    labels.includes('Teléfono'),
    `la ficha debería tener un campo "Teléfono" (tiene: ${labels.join(', ')})`
  );
  const phoneField = groupedFicha.fields.find(f => f.label === 'Teléfono');
  if (phoneField) {
    check(
      phoneField.options.some(o => o.text === '654 32 18'),
      'el valor correcto del teléfono debería mostrarse completo, tal como se dice'
    );
  }
}

// Los pares mínimos CON foco siguen cayendo sobre las cifras: es lo que necesita
// "Adivina el Acento", donde el contraste ES el rasgo dictado.
const PAIRS_SLOT = {
  slotId: 't-pares-tel',
  stage: 'selectiva',
  skill: 'decodificacion',
  format: 'minimal_pairs',
  items: 4,
  brief: 'x',
  engineFallback: 'minimal_pairs',
  focus: 'phone'
};

const NUMERALS = new Set([
  'seis', 'cinco', 'cuatro', 'treinta', 'dos', 'dieciocho', 'siete', 'quince',
  'catorce', 'trece', 'doce', 'diez', 'sesenta', 'cincuenta', 'cuarenta', 'noventa'
]);

const focusedPairs = fillMissingSlots([], [PAIRS_SLOT], SPOKEN_PHONE).find(
  ex => ex.slotId === 't-pares-tel'
);
check(!!focusedPairs, 'los pares mínimos con foco deberían construirse sobre un teléfono dictado');
if (focusedPairs) {
  const firstOptions = focusedPairs.fields[0].options.map(o => o.text.toLowerCase());
  check(
    firstOptions.some(text => NUMERALS.has(text)),
    `el primer par mínimo con foco debería contrastar cifras del teléfono (${firstOptions.join(' / ')})`
  );
}

// Y SIN foco no pueden caer sobre ellas. Es el tercer ejercicio de A0: el dato
// ya se anota entero en el ejercicio anterior, y volver a preguntar "¿oíste seis
// o siete?" sobre las cifras de ese mismo teléfono gasta una de las tres
// tarjetas del nivel en repetir lo que el alumno acaba de escribir.
const UNFOCUSED_PAIRS_SLOT = { ...PAIRS_SLOT, slotId: 't-pares-libres', focus: undefined };
const freePairs = fillMissingSlots([], [UNFOCUSED_PAIRS_SLOT], SPOKEN_PHONE).find(
  ex => ex.slotId === 't-pares-libres'
);
check(!!freePairs, 'los pares mínimos sin foco deberían construirse sobre las palabras del diálogo');
if (freePairs) {
  const shown = freePairs.fields.flatMap(f => f.options.map(o => o.text.toLowerCase()));
  check(
    !shown.some(text => NUMERALS.has(text)),
    `sin foco, los pares mínimos no deberían ir sobre las cifras del dato (salieron: ${shown.join(' / ')})`
  );
}

// ---------------------------------------------------------------------------
// 6. El dictado: reproducir el dato, no reconocerlo entre tres cadenas
// ---------------------------------------------------------------------------

const dictationSlot = (focus, items = 6) => ({
  slotId: 't-dictado',
  stage: 'selectiva',
  skill: 'dato_literal',
  format: 'dictation',
  items,
  brief: 'x',
  engineFallback: 'dictation',
  preferEngine: true,
  focus
});

const buildDictation = (dialogue, focus, items) => {
  const made = fillMissingSlots([], [dictationSlot(focus, items)], dialogue).find(
    e => e.slotId === 't-dictado'
  );
  return made;
};

/** El dato que el ejercicio pide anotar. */
const datumOf = ex => (ex && typeof ex.expected === 'string' ? ex.expected : '');

// (a) Teléfono dictado con palabras: el dato ENTERO, no una parte. Y ninguna
//     opción a la vista: si se puede elegir, no se está anotando.
const spokenDictation = buildDictation(SPOKEN_PHONE, 'phone');
check(!!spokenDictation, 'un teléfono dictado con palabras debería producir un dictado');
if (spokenDictation) {
  const verdict = verifyExercise(spokenDictation, buildTranscriptIndex(SPOKEN_PHONE));
  check(verdict.ok, `el dictado del teléfono en palabras no verifica: ${verdict.reason}`);
  check(
    datumOf(spokenDictation) === 'seis cinco cuatro treinta y dos dieciocho',
    `el dato debería ser el teléfono completo (es: "${datumOf(spokenDictation)}")`
  );
  check(
    !spokenDictation.fields && !spokenDictation.options,
    'el dictado no puede ofrecer nada que elegir: se escribe'
  );
  check(
    spokenDictation.correctAnswer === datumOf(spokenDictation),
    'la clave del dictado debería ser el texto del dato'
  );
  check(spokenDictation.dataKind === 'phone', 'el dictado debería declarar de qué clase es el dato');
}

// (b) El mismo teléfono en cifras agrupadas, y con la trampa que rompía el
//     formato: `DIGIT_LITERAL` también pesca "654", "32" y "18" por separado, y
//     el motor antiguo caía en uno de esos fragmentos en cuanto una posición se
//     quedaba sin distractores. Media cifra no es el dato.
const groupedDictation = buildDictation(GROUPED_PHONE, 'phone');
check(!!groupedDictation, 'un teléfono en cifras agrupadas debería producir un dictado');
if (groupedDictation) {
  check(
    datumOf(groupedDictation) === '654 32 18',
    `"654 32 18" debería pedirse entero, no en trozos (es: "${datumOf(groupedDictation)}")`
  );
}

// (c) Un precio dicho "catorce con noventa": el dato lleva su nexo dentro.
const SPOKEN_PRICE = [
  { speaker: 'Cajera', text: 'Son catorce con noventa, por favor.' },
  { speaker: 'Cliente', text: 'Aquí tiene. Muchas gracias.' }
];
const priceDictation = buildDictation(SPOKEN_PRICE, 'price');
check(!!priceDictation, 'un precio dicho con palabras debería producir un dictado');
if (priceDictation) {
  check(
    datumOf(priceDictation) === 'catorce con noventa',
    `el precio debería pedirse entero, con su "con" (es: "${datumOf(priceDictation)}")`
  );
  check(
    verifyExercise(priceDictation, buildTranscriptIndex(SPOKEN_PRICE)).ok,
    'el dictado del precio no verifica'
  );
}

// (d) Una hora dicha "a las cinco y media". Antes no existía para ningún motor:
//     "cinco" sola no llegaba al umbral de tramo numérico, así que una lección
//     de "reservar una cita" salía sin un solo ejercicio sobre la hora.
const SPOKEN_TIME = [
  { speaker: 'Recepción', text: '¿Le viene bien el martes?' },
  { speaker: 'Paciente', text: 'Sí, a las cinco y media me va perfecto.' }
];
const timeDictation = buildDictation(SPOKEN_TIME, 'time');
check(!!timeDictation, 'una hora dicha "cinco y media" debería producir un dictado');
if (timeDictation) {
  check(
    datumOf(timeDictation) === 'cinco y media',
    `la hora debería pedirse entera (es: "${datumOf(timeDictation)}")`
  );
  check(
    verifyExercise(timeDictation, buildTranscriptIndex(SPOKEN_TIME)).ok,
    'el dictado de la hora no verifica'
  );
}

// (e) Un correo dictado con "arroba" y "punto": entero, desde la pieza que va
//     ANTES del arroba.
const SPOKEN_EMAIL = [
  { speaker: 'Empleado', text: '¿Me deja un correo de contacto?' },
  { speaker: 'Clienta', text: 'Sí, es marta punto ruiz arroba correo punto com.' }
];
const emailDictation = buildDictation(SPOKEN_EMAIL, 'email');
check(!!emailDictation, 'un correo dictado con "arroba" debería producir un dictado');
if (emailDictation) {
  check(
    datumOf(emailDictation) === 'marta punto ruiz arroba correo punto com',
    `el correo debería pedirse entero desde la primera pieza (es: "${datumOf(emailDictation)}")`
  );
  check(
    verifyExercise(emailDictation, buildTranscriptIndex(SPOKEN_EMAIL)).ok,
    'el dictado del correo no verifica'
  );
}

// (f) Y "en punto" NO es una dirección: el nexo suelto no basta, hace falta un
//     arroba de verdad o dos nombres de letra inequívocos.
const NOT_AN_EMAIL = [
  { speaker: 'A', text: 'Nos vemos a las nueve en punto en la puerta del cine.' },
  { speaker: 'B', text: 'De acuerdo, allí estaré sin falta.' }
];
const notEmail = buildDictation(NOT_AN_EMAIL, 'email');
if (notEmail) {
  check(
    !/\ben\b/.test(datumOf(notEmail)),
    `"en punto" no debería leerse como una dirección (salió: "${datumOf(notEmail)}")`
  );
}

// ---------------------------------------------------------------------------
// 6b. La corrección: se corrige lo que se OYÓ, no cómo se escribe
// ---------------------------------------------------------------------------
// Es el contrato del formato. Sin él, pedir que se escriba el dato sería más
// injusto que pedir que se elija: quien oyó bien el teléfono y lo anotó en
// cifras fallaría por escribirlo distinto de como el modelo lo redactó.

const ACCEPTS = [
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '654 32 18'],
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '6543218'],
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '654-32-18'],
  ['phone', '654 32 18', 'seis cinco cuatro treinta y dos dieciocho'],
  ['price', 'catorce con noventa', '14,90'],
  ['price', 'catorce con noventa', '14.90'],
  ['price', 'catorce con noventa', '14 con 90'],
  ['price', '14,90', 'catorce con noventa'],
  ['time', 'cinco y media', '5:30'],
  ['time', 'cinco y media', '17:30'],
  ['time', 'cinco menos cuarto', '4:45'],
  ['spelling', 'G-A-R-C-Í-A', 'García'],
  ['spelling', 'G-A-R-C-Í-A', 'garcia'],
  ['spelling', 'G-A-R-C-Í-A', 'ge a erre ce i a'],
  ['email', 'marta punto ruiz arroba correo punto com', 'marta.ruiz@correo.com']
];

for (const [kind, expected, written] of ACCEPTS) {
  check(
    matchesDatum(written, [expected], kind),
    `"${written}" debería valer como "${expected}" (${kind})`
  );
}

const REJECTS = [
  // Lo que el ejercicio mide de verdad: una cifra mal o una cifra de menos.
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '654 32 19'],
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '654 32'],
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', 'seis cinco cuatro treinta y dos'],
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '654 42 18'],
  ['price', 'catorce con noventa', '14,50'],
  ['price', 'catorce con noventa', '40,90'],
  ['price', 'catorce con noventa', '14'],
  ['time', 'cinco y media', '5:15'],
  ['time', 'cinco y media', '6:30'],
  ['spelling', 'G-A-R-C-Í-A', 'garcía y'],
  ['email', 'marta punto ruiz arroba correo punto com', 'marta.ruiz@correo.es'],
  // Y no responder no es acertar.
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', ''],
  ['phone', 'seis cinco cuatro treinta y dos dieciocho', '   ']
];

for (const [kind, expected, written] of REJECTS) {
  check(
    !matchesDatum(written, [expected], kind),
    `"${written}" NO debería valer como "${expected}" (${kind})`
  );
}

// ---------------------------------------------------------------------------
// 7. El formato manda y el blueprint es la lección
// ---------------------------------------------------------------------------
// Los dos agujeros por los que se colaban las opciones múltiples vagas: un
// ejercicio del modelo ocupaba el slot sólo por traer su slotId, sin mirar el
// tipo; y lo que devolvía de más se anexaba al final de la lección.

const VAGUE_MC = {
  id: 'modelo_1',
  type: 'multiple_choice',
  slotId: 't-dictado',
  question: '¿Cuál era el número de teléfono?',
  options: [{ id: 'a', text: 'un móvil' }, { id: 'b', text: 'un fijo' }],
  correctAnswer: 'a',
  explanation: ''
};

const substituted = fillMissingSlots([VAGUE_MC], [dictationSlot('phone')], SPOKEN_PHONE);
check(
  substituted.length === 1 && substituted[0].type === 'dictation',
  `una opción múltiple etiquetada con el slotId del dato no debería ocupar ese slot (salió: ${substituted.map(e => e.type).join(', ')})`
);

const EXTRA_MC = { ...VAGUE_MC, id: 'modelo_2', slotId: 'inventado' };
const withLeftovers = fillMissingSlots([EXTRA_MC], [dictationSlot('phone')], SPOKEN_PHONE);
check(
  withLeftovers.length === 1,
  `los ejercicios fuera del blueprint deberían descartarse (salieron ${withLeftovers.length})`
);

// Y un ejercicio del modelo del formato correcto sí entra cuando el motor no
// encuentra material: `preferEngine` da prioridad, no exclusividad.
const NO_DATA = [
  { speaker: 'A', text: 'Qué buen día hace hoy, ¿no te parece?' },
  { speaker: 'B', text: 'Sí, precioso. Vamos a dar una vuelta.' }
];
const MODEL_DICTATION = {
  id: 'modelo_3',
  type: 'dictation',
  slotId: 't-dictado',
  question: 'Reconstruí',
  fields: [
    { id: 'd1', label: '1', options: [{ id: 'd1a', text: 'buen' }, { id: 'd1b', text: 'bien' }] },
    { id: 'd2', label: '2', options: [{ id: 'd2a', text: 'día' }, { id: 'd2b', text: 'lía' }] }
  ],
  separators: [''],
  correctAnswer: { d1: 'd1a', d2: 'd2a' },
  explanation: ''
};
const fallenBack = fillMissingSlots([MODEL_DICTATION], [dictationSlot('phone')], NO_DATA);
check(
  fallenBack.length === 1 && fallenBack[0].id === 'modelo_3',
  'sin material en el audio, el ejercicio del modelo debería cubrir el slot con preferEngine'
);

// ---------------------------------------------------------------------------

console.warn = realWarn;

const totalCases = REJECT_CASES.length + ACCEPT_CASES.length + 2 + built.length;
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} problema(s):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✓ verificación de claves correcta (${REJECT_CASES.length} claves falsas rechazadas, ` +
    `${ACCEPT_CASES.length} válidas aceptadas, ${built.length} ejercicios de motor verificados)`
);
