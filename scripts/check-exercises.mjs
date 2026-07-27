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

const { verifyExercise, buildTranscriptIndex, fillMissingSlots } = await loadModules();

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

// Y los pares mínimos con foco tienen que caer sobre las cifras, no sobre el saludo.
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

const focusedPairs = fillMissingSlots([], [PAIRS_SLOT], SPOKEN_PHONE).find(
  ex => ex.slotId === 't-pares-tel'
);
check(!!focusedPairs, 'los pares mínimos con foco deberían construirse sobre un teléfono dictado');
if (focusedPairs) {
  const NUMERALS = new Set(['seis', 'cinco', 'cuatro', 'treinta', 'dos', 'dieciocho']);
  const firstOptions = focusedPairs.fields[0].options.map(o => o.text.toLowerCase());
  check(
    firstOptions.some(text => NUMERALS.has(text)),
    `el primer par mínimo debería contrastar cifras del teléfono, no otra palabra (${firstOptions.join(' / ')})`
  );
}

// ---------------------------------------------------------------------------
// 6. El blueprint ES la lección: nada de ejercicios de más
// ---------------------------------------------------------------------------
// El modelo improvisa, y el formato que improvisa es la opción múltiple. Antes
// esos sobrantes se añadían al final de la lección, así que un A0 de tres slots
// podía llegar al alumno con nueve ejercicios —seis de ellos opciones múltiples
// que nadie había pedido y que no tocaban el dato dictado— mientras el
// presupuesto por nivel de `check-syllabus` seguía dando el visto bueno sobre un
// blueprint de tres.

const A0_LIKE_BLUEPRINT = [
  { slotId: 'a0-global', stage: 'global', skill: 'idea_global', format: 'multiple_choice', items: 3, brief: 'x' },
  { ...PHONE_SLOT, slotId: 'a0-ficha' },
  { ...PAIRS_SLOT, slotId: 'a0-pares' }
];

const mcq = (id, slotId) => ({
  id,
  ...(slotId ? { slotId } : {}),
  type: 'multiple_choice',
  question: `¿Pregunta ${id}?`,
  options: [
    { id: `${id}a`, text: 'una farmacia' },
    { id: `${id}b`, text: 'una panadería' },
    { id: `${id}c`, text: 'un quiosco' }
  ],
  correctAnswer: `${id}a`,
  explanation: 'x',
  sourceTurns: [0]
});

// Seis opciones múltiples válidas para un blueprint que solo tiene una.
const flooded = fillMissingSlots(
  ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map(id => mcq(id)),
  A0_LIKE_BLUEPRINT,
  SPOKEN_PHONE
);

check(
  flooded.length <= A0_LIKE_BLUEPRINT.length,
  `la lección no puede tener más ejercicios que slots el blueprint (${flooded.length} > ${A0_LIKE_BLUEPRINT.length})`
);
check(
  flooded.filter(ex => ex.type === 'multiple_choice').length === 1,
  `solo hay un slot de opción múltiple, así que solo puede salir una (salieron ${flooded.filter(ex => ex.type === 'multiple_choice').length})`
);
check(
  flooded.every(ex => A0_LIKE_BLUEPRINT.some(slot => slot.slotId === ex.slotId)),
  `todo ejercicio mostrado tiene que ocupar un slot del blueprint (${flooded.map(ex => ex.slotId).join(', ')})`
);

// El slot lo reclama quien lo declara, no quien llega antes por formato.
const claimedByName = fillMissingSlots(
  [mcq('libre'), mcq('propio', 'a0-global')],
  A0_LIKE_BLUEPRINT,
  SPOKEN_PHONE
);
const globalExercise = claimedByName.find(ex => ex.slotId === 'a0-global');
check(
  globalExercise?.question === '¿Pregunta propio?',
  `el ejercicio que declara su slotId debe quedarse con el slot, no el primero del mismo formato (quedó "${globalExercise?.question}")`
);

// Y un slot con foco no acepta un ejercicio que ignore el dato dictado.
const offFocusFicha = {
  id: 'f1',
  slotId: 'a0-ficha',
  type: 'data_capture',
  question: 'Completa la ficha',
  fields: [
    {
      id: 'c1',
      label: 'Aviso',
      options: [
        { id: 'c1a', text: 'pedido' },
        { id: 'c1b', text: 'perdido' }
      ]
    }
  ],
  correctAnswer: { c1: 'c1a' },
  explanation: 'x',
  sourceTurns: [0]
};

const refocused = fillMissingSlots([offFocusFicha], [{ ...PHONE_SLOT, slotId: 'a0-ficha' }], SPOKEN_PHONE);
const fichaSlot = refocused.find(ex => ex.slotId === 'a0-ficha');
check(!!fichaSlot, 'el slot de la ficha no debería quedar vacío');
check(
  !!fichaSlot?.fields?.some(f => f.label === 'Teléfono'),
  `una ficha que ignora el teléfono dictado debe reconstruirse sobre él (campos: ${fichaSlot?.fields?.map(f => f.label).join(', ')})`
);

// Pero si el ejercicio del modelo SÍ recoge el dato, se respeta tal cual.
const onFocusFicha = {
  ...offFocusFicha,
  id: 'f2',
  fields: [
    {
      id: 'c1',
      label: 'Teléfono',
      options: [
        { id: 'c1a', text: 'seis cinco cuatro treinta y dos dieciocho' },
        { id: 'c1b', text: 'seis cinco cuatro cuarenta y dos dieciocho' }
      ]
    }
  ]
};
const kept = fillMissingSlots([onFocusFicha], [{ ...PHONE_SLOT, slotId: 'a0-ficha' }], SPOKEN_PHONE);
check(
  kept.find(ex => ex.slotId === 'a0-ficha')?.id === 'f2',
  'una ficha del modelo que sí recoge el dato dictado debe conservarse'
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
