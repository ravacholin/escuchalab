#!/usr/bin/env node
/**
 * Verificador de invariantes pedagógicas del syllabus.
 *
 * Recorre `getBlueprint()` para todas las combinaciones válidas de
 * nivel × tipo de audio × modo y comprueba que ninguna lección pueda pedir un
 * ejercicio que el nivel no soporta o que el tipo de audio hace imposible.
 *
 * No necesita clave de API ni red: solo evalúa el syllabus.
 *
 *   node scripts/check-syllabus.mjs        (o: npm run check:syllabus)
 */

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

/** Compila el syllabus (TypeScript + alias `@/`) a un módulo ejecutable. */
async function loadSyllabus() {
  const dir = await mkdtemp(join(tmpdir(), 'escuchalab-syllabus-'));
  const outfile = join(dir, 'syllabus.mjs');

  await build({
    entryPoints: [join(ROOT, 'data/listeningSyllabus.ts')],
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

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const S = await loadSyllabus();
const {
  getBlueprint,
  answerCost,
  readingLoad,
  totalAnswers,
  totalReadingLoad,
  FORMAT_RULES,
  ENGINE_IDS,
  STAGE_ORDER,
  STAGE_META,
  SKILL_LABELS,
  FORMAT_LABELS
} = S;

// Los enums viven en types.ts; se replican aquí por valor para no arrastrar
// todo el árbol de tipos de la app dentro del script.
const LEVELS = {
  Intro: 'Inicial Absoluto (A0)',
  Beginner: 'Principiante (A1-A2)',
  Intermediate: 'Intermedio (B1-B2)',
  Advanced: 'Avanzado (C1)'
};
const TEXT_TYPES = {
  Dialogue: 'Diálogo (2 personas)',
  PodcastInterview: 'Podcast - Entrevista (2 personas)',
  RadioNews: 'Noticias de Radio (1 persona)',
  Monologue: 'Monólogo / Storytelling (1 persona)'
};
const MODES = {
  Standard: 'Práctica Estándar',
  Vocabulary: 'Ampliar Vocabulario',
  AccentChallenge: 'Adivina el Acento'
};
const LENGTHS = {
  Short: 'Corto (4-6 turnos)',
  Medium: 'Medio (8-12 turnos)',
  Long: 'Largo (14+ turnos)'
};
const LENGTH_ORDER = [LENGTHS.Short, LENGTHS.Medium, LENGTHS.Long];

const SINGLE_SPEAKER = [TEXT_TYPES.RadioNews, TEXT_TYPES.Monologue];
// A0 no se ofrece en los formatos narrativos (ver `availableLevels` en App.tsx).
const NARRATIVE = [TEXT_TYPES.PodcastInterview, TEXT_TYPES.Monologue];

/**
 * Presupuesto de TARJETAS por nivel y duración del audio. No es una preferencia
 * estética: en A0 el alumno decodifica datos, no cláusulas, y cada ejercicio de
 * más es una tarea de lectura en una lengua que todavía no lee.
 *
 * La columna de duración es lo que faltaba. Antes el techo era un único número
 * por nivel, así que un diálogo Corto de seis turnos —el valor por defecto de la
 * app— recibía las mismas seis tarjetas que uno de catorce. No había material en
 * el audio para sostenerlas: o el modelo se inventaba el ejercicio, o el
 * verificador lo descartaba y la lección encogía sin que el alumno supiera por qué.
 */
const MAX_SLOTS = {
  [LEVELS.Intro]: { [LENGTHS.Short]: 3, [LENGTHS.Medium]: 3, [LENGTHS.Long]: 3 },
  [LEVELS.Beginner]: { [LENGTHS.Short]: 3, [LENGTHS.Medium]: 4, [LENGTHS.Long]: 4 },
  [LEVELS.Intermediate]: { [LENGTHS.Short]: 4, [LENGTHS.Medium]: 5, [LENGTHS.Long]: 6 },
  [LEVELS.Advanced]: { [LENGTHS.Short]: 4, [LENGTHS.Medium]: 5, [LENGTHS.Long]: 6 }
};

/**
 * Presupuesto de RESPUESTAS DISCRETAS por nivel. La tarjeta era la unidad
 * equivocada: tres tarjetas pueden ser cuatro respuestas o veinte, según si son
 * opciones múltiples o tablas. B1-B2 y C1 pedían ≈20 y ≈21 con seis tarjetas.
 */
const MAX_ANSWERS = {
  // A0 y A1-A2 bajaron cuando el dictado dejó de ser seis desplegables y pasó a
  // ser una casilla abierta: seis respuestas discretas se convirtieron en una.
  // Los topes bajan con ellos —A0 estaba clavado en 11/11— porque un techo que
  // nadie roza no es un techo, es un número. En los dos, quien marca ahora el
  // máximo es el modo Vocabulario y no el Estándar.
  [LEVELS.Intro]: 8,
  [LEVELS.Beginner]: 11,
  [LEVELS.Intermediate]: 16,
  [LEVELS.Advanced]: 15
};

/**
 * Presupuesto de LECTURA: unidades de texto de longitud frase que hay que leer
 * para resolver la lección entera (ver `readingLoad()` en el syllabus).
 *
 * Es el techo que de verdad faltaba. Una lección de B1 pedía ≈34 unidades y una
 * de C1 ≈32: una escala de 4 citas × 4 puntos y una clasificación de 4 palabras
 * × 3 columnas son, juntas, quince frases en español que hay que leer y cruzar
 * entre sí. Pasado ese punto la tarea deja de medir comprensión auditiva y mide
 * comprensión lectora, que es justo lo que la app NO quiere evaluar.
 */
// Un dictado abierto no se lee: se oye y se escribe, así que su carga de lectura
// es 0 y el modo Estándar de A0 cayó de 9.5 a 5.0. Estos techos no se mueven
// porque en A0 y A1-A2 quien los marca es el modo Vocabulario, que no usa el
// dictado y sigue exactamente donde estaba.
const MAX_READING = {
  [LEVELS.Intro]: 10,
  [LEVELS.Beginner]: 15,
  [LEVELS.Intermediate]: 24,
  [LEVELS.Advanced]: 26
};

/**
 * Formatos cuya clave se comprueba contra la transcripción en
 * `services/exerciseVerification.ts`. Un slot con motor determinista o con uno de
 * estos formatos es un slot RESPALDADO: o se demuestra contra el audio, o no
 * llega al alumno.
 *
 * `matching`, `scale`, `classification` y los juicios no verifican nada contra el
 * audio ni tienen motor, y eran cinco de los seis slots de B1-B2 y de C1: los
 * niveles con más ejercicios eran los menos fiables, y su número de tarjetas
 * dependía enteramente de que el modelo acertara.
 */
const VERIFIED_FORMATS = [
  'cloze',
  'chunk_order',
  'dictation',
  'data_capture',
  'minimal_pairs',
  'spot_the_difference'
];
const isBacked = slot => !!slot.engineFallback || VERIFIED_FORMATS.includes(slot.format);

/** Mecánicas cuya carga cognitiva las hace impropias de un principiante absoluto. */
const FORBIDDEN_AT_A0 = ['ordering', 'matching', 'scale', 'true_false_notgiven', 'spot_the_difference'];
/** Mecánicas de decodificación básica que en C1 serían trabajo perdido. */
const FORBIDDEN_AT_C1 = ['data_capture', 'dictation', 'chunk_order'];

/** Formatos que se resuelven sobre filas: con menos de 3 no discriminan nada. */
const ROW_BASED = [
  'classification',
  'matching',
  'scale',
  'true_false',
  'true_false_notgiven',
  'ordering',
  'chunk_order'
];

/** Marcas de que un ejercicio presupone dos interlocutores. */
const TWO_SPEAKER_HINTS = [
  'hablante a',
  'hablante b',
  'quién lo dice',
  'quien lo dice',
  'entrevistador',
  'entrevistado',
  'interlocutor'
];

const combos = [];
for (const level of Object.values(LEVELS)) {
  for (const textType of Object.values(TEXT_TYPES)) {
    if (level === LEVELS.Intro && NARRATIVE.includes(textType)) continue;
    for (const mode of Object.values(MODES)) {
      for (const length of LENGTH_ORDER) {
        combos.push({ level, textType, mode, length });
      }
    }
  }
}

const blueprintsByKey = new Map();

for (const { level, textType, mode, length } of combos) {
  const where = `${level} · ${textType} · ${mode} · ${length}`;
  const slots = getBlueprint(level, textType, mode, undefined, length);
  blueprintsByKey.set(`${level}|${textType}|${mode}|${length}`, slots);

  const answers = totalAnswers(slots);
  const reading = totalReadingLoad(slots);

  check(slots.length >= 3, `${where}: solo ${slots.length} ejercicios (mínimo 3)`);
  check(
    slots.length <= MAX_SLOTS[level][length],
    `${where}: ${slots.length} ejercicios (máximo ${MAX_SLOTS[level][length]})`
  );
  check(
    answers <= MAX_ANSWERS[level],
    `${where}: ${answers} respuestas discretas (máximo ${MAX_ANSWERS[level]} en este nivel)`
  );
  check(
    reading <= MAX_READING[level],
    `${where}: ${reading.toFixed(2)} unidades de lectura (máximo ${MAX_READING[level]} en este nivel)`
  );

  // Ninguna lección puede quedar ENTERAMENTE en manos del modelo: al menos un
  // slot tiene que ser demostrable contra el audio (motor determinista o formato
  // con verificación de fidelidad). El mínimo es uno y no dos a propósito: en C1
  // el objeto de estudio es la inferencia y el matiz, que por definición no se
  // derivan de la transcripción con una regla, así que exigir un segundo slot
  // respaldado sería exigir un ejercicio de decodificación que el nivel no
  // necesita. Donde sí se puede, se hace: A0, A1-A2 y B1-B2 llevan dos.
  const backed = slots.filter(isBacked).length;
  check(backed >= 1, `${where}: ningún slot respaldado contra la transcripción`);

  const seen = new Set();
  const stages = new Set();
  const skills = new Set();
  let lastStageIndex = -1;

  for (const slot of slots) {
    const at = `${where} → ${slot.slotId}`;

    check(!seen.has(slot.slotId), `${at}: slotId duplicado`);
    seen.add(slot.slotId);

    check(!!FORMAT_RULES[slot.format], `${at}: formato desconocido "${slot.format}"`);
    check(!!STAGE_META[slot.stage], `${at}: etapa desconocida "${slot.stage}"`);
    check(!!SKILL_LABELS[slot.skill], `${at}: habilidad desconocida "${slot.skill}"`);
    check(!!FORMAT_LABELS[slot.format], `${at}: formato sin etiqueta de interfaz`);
    check(typeof slot.brief === 'string' && slot.brief.length > 30, `${at}: brief vacío o demasiado corto`);
    // `items` significa cosas distintas según el formato: huecos en un cloze,
    // filas en una tabla, palabras alteradas en un caza-el-cambio. Un cloze de
    // un solo hueco es legítimo en A0; una tabla de dos filas no lo es nunca.
    const minItems = ROW_BASED.includes(slot.format) ? 3 : 1;
    check(slot.items >= minItems, `${at}: ${slot.items} ítems (mínimo ${minItems} para "${slot.format}")`);

    if (slot.engineFallback) {
      check(
        ENGINE_IDS.includes(slot.engineFallback),
        `${at}: engineFallback inexistente "${slot.engineFallback}"`
      );
    }

    // Dar prioridad al motor sólo tiene sentido si hay motor: sin él, la marca
    // no haría nada y el slot volvería a depender enteramente del modelo.
    check(
      !slot.preferEngine || !!slot.engineFallback,
      `${at}: preferEngine sin engineFallback`
    );

    // 1. El formato debe estar permitido en este nivel y en este tipo de audio.
    const rule = FORMAT_RULES[slot.format];
    if (rule) {
      check(rule.levels.includes(level), `${at}: "${slot.format}" no está permitido en ${level}`);
      check(
        rule.textTypes.includes(mode === MODES.AccentChallenge ? TEXT_TYPES.Dialogue : textType),
        `${at}: "${slot.format}" no está permitido en ${textType}`
      );
    }

    // 2. Prohibiciones duras por nivel.
    if (level === LEVELS.Intro) {
      check(!FORBIDDEN_AT_A0.includes(slot.format), `${at}: "${slot.format}" es inviable en A0`);
    }
    if (level === LEVELS.Advanced) {
      check(!FORBIDDEN_AT_C1.includes(slot.format), `${at}: "${slot.format}" es trabajo perdido en C1`);
    }

    // 3. Nada que presuponga dos hablantes en audios de una sola voz.
    //    (El reto de acentos siempre genera diálogo, así que queda excluido.)
    if (SINGLE_SPEAKER.includes(textType) && mode !== MODES.AccentChallenge) {
      const brief = slot.brief.toLowerCase();
      const hint = TWO_SPEAKER_HINTS.find(h => brief.includes(h));
      check(!hint, `${at}: el brief presupone dos hablantes ("${hint}") en un audio de una voz`);
    }

    // 4. Los slots salen ya ordenados por etapa: es el recorrido que pinta la UI.
    const stageIndex = STAGE_ORDER.indexOf(slot.stage);
    check(stageIndex >= lastStageIndex, `${at}: rompe el orden de etapas`);
    lastStageIndex = stageIndex;

    stages.add(slot.stage);
    skills.add(slot.skill);
  }

  // 5. Toda lección tiene un recorrido real, no un montón plano de ítems.
  check(stages.size >= 2, `${where}: solo cubre la etapa "${[...stages][0]}"`);
  check(
    stages.has('global') || stages.has('selectiva'),
    `${where}: no tiene ni escucha global ni escucha selectiva`
  );
  check(skills.size >= 3, `${where}: solo entrena ${skills.size} habilidades distintas`);
}

// 6. Cambiar la duración cambia CUÁNTO se trabaja, nunca QUÉ se trabaja: el
//    blueprint de Corto tiene que ser un subconjunto del de Medio, y el de Medio
//    del de Largo. Sin esto, alargar el audio podría hacer desaparecer el
//    ejercicio central del nivel y el alumno no tendría forma de notarlo.
for (const { level, textType, mode } of combos.filter(c => c.length === LENGTHS.Short)) {
  const at = `${level} · ${textType} · ${mode}`;
  const ids = LENGTH_ORDER.map(
    length => new Set((blueprintsByKey.get(`${level}|${textType}|${mode}|${length}`) || []).map(s => s.slotId))
  );

  for (let i = 0; i + 1 < ids.length; i++) {
    const missing = [...ids[i]].filter(id => !ids[i + 1].has(id));
    check(
      missing.length === 0,
      `${at}: al pasar de "${LENGTH_ORDER[i]}" a "${LENGTH_ORDER[i + 1]}" desaparece ${missing.join(', ')}`
    );
  }
}

// 7. B1-B2 y C1 no pueden trabajarse igual. Corrían las mismas seis mecánicas
//    sobre las mismas habilidades y con los mismos ítems, y lo único que
//    cambiaba era la prosa del brief: la pregunta "¿qué se trabaja en cada
//    nivel?" no tenía respuesta distinta para los dos niveles más altos.
for (const length of LENGTH_ORDER) {
  const signature = level =>
    (blueprintsByKey.get(`${level}|${TEXT_TYPES.Dialogue}|${MODES.Standard}|${length}`) || [])
      .map(s => `${s.format}:${s.skill}`)
      .sort()
      .join(',');
  check(
    signature(LEVELS.Intermediate) !== signature(LEVELS.Advanced),
    `${length}: B1-B2 y C1 entrenan exactamente las mismas habilidades con los mismos formatos`
  );
}

// 8. El modo Vocabulario debe escalar por nivel: era el fallo más visible del
//    sistema anterior, donde un A0 y un C1 recibían ejercicios idénticos.
const vocabByLevel = Object.values(LEVELS).map(level => ({
  level,
  ids: (blueprintsByKey.get(`${level}|${TEXT_TYPES.Dialogue}|${MODES.Vocabulary}|${LENGTHS.Long}`) || [])
    .map(s => s.slotId)
    .join(',')
}));
for (let i = 0; i < vocabByLevel.length; i++) {
  for (let j = i + 1; j < vocabByLevel.length; j++) {
    check(
      vocabByLevel[i].ids !== vocabByLevel[j].ids,
      `Vocabulario: "${vocabByLevel[i].level}" y "${vocabByLevel[j].level}" generan los mismos ejercicios`
    );
  }
}

// 9. Un boletín de radio y un diálogo del mismo nivel no pueden trabajarse igual.
for (const level of Object.values(LEVELS)) {
  const key = tt => `${level}|${tt}|${MODES.Standard}|${LENGTHS.Long}`;
  const dialogue = blueprintsByKey.get(key(TEXT_TYPES.Dialogue)) || [];
  const news = blueprintsByKey.get(key(TEXT_TYPES.RadioNews)) || [];
  if (dialogue.length === 0 || news.length === 0) continue;
  const sameBriefs = dialogue.map(s => s.brief).join('|') === news.map(s => s.brief).join('|');
  check(!sameBriefs, `${level}: diálogo y noticiero reciben exactamente las mismas consignas`);
}

const total = combos.length;
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} problema(s) en ${total} combinaciones:\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  console.error('');
  process.exit(1);
}

// La carga real de cada nivel, para que el presupuesto se pueda LEER y no haya
// que deducirlo de las tablas de slots.
console.log('');
console.log('  nivel                      corto        medio        largo    (tarjetas/respuestas/lectura)');
for (const level of Object.values(LEVELS)) {
  const cells = LENGTH_ORDER.map(length => {
    const slots = blueprintsByKey.get(`${level}|${TEXT_TYPES.Dialogue}|${MODES.Standard}|${length}`) || [];
    return `${slots.length}/${totalAnswers(slots)}/${totalReadingLoad(slots).toFixed(1)}`.padStart(12);
  });
  console.log(`  ${level.padEnd(24)}${cells.join(' ')}`);
}
console.log('');
console.log(
  `✓ syllabus correcto en las ${total} combinaciones de nivel × tipo de audio × modo × duración`
);
