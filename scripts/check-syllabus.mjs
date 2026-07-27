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

const SINGLE_SPEAKER = [TEXT_TYPES.RadioNews, TEXT_TYPES.Monologue];
// A0 no se ofrece en los formatos narrativos (ver `availableLevels` en App.tsx).
const NARRATIVE = [TEXT_TYPES.PodcastInterview, TEXT_TYPES.Monologue];

/**
 * Presupuesto de ejercicios por nivel. No es una preferencia estética: en A0 el
 * alumno decodifica datos, no cláusulas, y cada ejercicio de más es una tarea de
 * lectura en una lengua que todavía no lee. El techo baja según baja el nivel
 * para que no vuelva a colarse una lección de seis ejercicios de la que sólo uno
 * trabaje el dato dictado.
 *
 * El techo de B1-B2 y C1 bajó de 9 y 10 a 6: esos dos niveles nunca se habían
 * recortado, y una lección de C1 pedía ≈38 respuestas discretas repartidas en
 * diez tarjetas, con dos clasificaciones de la MISMA habilidad sobre el mismo
 * audio. Más ejercicios no es más escucha; a partir de cierto punto es sólo más
 * lectura.
 */
const MAX_SLOTS = {
  [LEVELS.Intro]: 3,
  [LEVELS.Beginner]: 4,
  [LEVELS.Intermediate]: 6,
  [LEVELS.Advanced]: 6
};

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
      combos.push({ level, textType, mode });
    }
  }
}

const blueprintsByKey = new Map();

for (const { level, textType, mode } of combos) {
  const where = `${level} · ${textType} · ${mode}`;
  const slots = getBlueprint(level, textType, mode);
  blueprintsByKey.set(`${level}|${textType}|${mode}`, slots);

  check(slots.length >= 3, `${where}: solo ${slots.length} ejercicios (mínimo 3)`);
  check(
    slots.length <= MAX_SLOTS[level],
    `${where}: ${slots.length} ejercicios (máximo ${MAX_SLOTS[level]} en este nivel)`
  );

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

// 6. El modo Vocabulario debe escalar por nivel: era el fallo más visible del
//    sistema anterior, donde un A0 y un C1 recibían ejercicios idénticos.
const vocabByLevel = Object.values(LEVELS).map(level => ({
  level,
  ids: (blueprintsByKey.get(`${level}|${TEXT_TYPES.Dialogue}|${MODES.Vocabulary}`) || [])
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

// 7. Un boletín de radio y un diálogo del mismo nivel no pueden trabajarse igual.
for (const level of Object.values(LEVELS)) {
  const dialogue = blueprintsByKey.get(`${level}|${TEXT_TYPES.Dialogue}|${MODES.Standard}`) || [];
  const news = blueprintsByKey.get(`${level}|${TEXT_TYPES.RadioNews}|${MODES.Standard}`) || [];
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

console.log(`✓ syllabus correcto en las ${total} combinaciones de nivel × tipo de audio × modo`);
