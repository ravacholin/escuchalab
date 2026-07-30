import { AppMode, ExerciseOption, ExerciseType, Length, Level, ListeningSkill, ListeningStage, TextType } from '@/types';
import { DataPointKind, dataPointProfile } from '@/data/dataPoints';

/**
 * ============================================================================
 *  SYLLABUS DE COMPRENSIÓN AUDITIVA
 * ============================================================================
 *
 * Este archivo es la fuente de verdad pedagógica de la aplicación. Sustituye a
 * las instrucciones en prosa que antes vivían dentro de `getExerciseInstructions()`.
 *
 * La unidad de diseño NO es el widget de renderizado, sino el par
 *
 *      (etapa de escucha  ×  habilidad auditiva)
 *
 * y el formato es solo la mecánica con que se resuelve. De ahí salen tres reglas
 * que aquí se aplican de forma ESTRUCTURAL (filtrando slots), no confiándolas a
 * la buena voluntad del modelo:
 *
 *   1. Un formato solo puede usarse en los niveles que lo soportan
 *      (`FORMAT_RULES[...].levels`).
 *   2. Un formato solo puede usarse en los tipos de audio con la estructura
 *      discursiva adecuada (`FORMAT_RULES[...].textTypes`).
 *   3. Los ejercicios que presuponen interacción entre dos hablantes se eliminan
 *      automáticamente en audios de un solo hablante (`requiresTwoSpeakers`).
 *
 * Y una cuarta que es de CANTIDAD y no de tipo: la lección crece con el audio
 * (`minLength`). Antes no lo hacía, y un diálogo Corto de seis turnos —el valor
 * por defecto de la app— recibía las mismas seis tarjetas y las mismas veinte
 * respuestas que uno de catorce. No había material para sostenerlas: o el modelo
 * se lo inventaba, o el verificador lo tiraba y la lección encogía sin avisar.
 */

// ---------------------------------------------------------------------------
// Etapas y habilidades: metadatos para la interfaz
// ---------------------------------------------------------------------------

export const STAGE_ORDER: ListeningStage[] = [
  'anticipacion',
  'global',
  'selectiva',
  'intensiva',
  'reflexion'
];

export const STAGE_META: Record<ListeningStage, { label: string; hint: string }> = {
  anticipacion: {
    label: 'Antes de escuchar',
    hint: 'Respondé esto ANTES de darle play. No hay respuestas incorrectas por adivinar: sirve para activar lo que ya sabés.'
  },
  global: {
    label: 'Idea global',
    hint: 'Primera escucha completa. No busques detalles: buscá de qué va, para qué hablan y en qué queda.'
  },
  selectiva: {
    label: 'Detalle',
    hint: 'Segunda escucha. Ahora sí: información concreta, datos, quién hace qué y en qué orden.'
  },
  intensiva: {
    label: 'Foco en la lengua',
    hint: 'Tercera escucha, por tramos. Se trabaja la forma exacta: qué palabras se dijeron y qué matiz tienen.'
  },
  reflexion: {
    label: 'Después de escuchar',
    hint: 'Qué indicios te sirvieron. Esto es lo que se transfiere a la próxima escucha.'
  }
};

export const SKILL_LABELS: Record<ListeningSkill, string> = {
  decodificacion: 'discriminación fónica',
  segmentacion: 'segmentación del habla',
  reconocimiento_lexico: 'reconocimiento léxico',
  dato_literal: 'información explícita',
  idea_global: 'idea global',
  estructura: 'estructura del discurso',
  rol_fuente: 'quién dice qué',
  inferencia: 'inferencia',
  actitud_postura: 'actitud y postura',
  pragmatica_registro: 'pragmática y registro',
  lexico_significado: 'léxico en contexto',
  colocacion_formula: 'colocaciones y fórmulas',
  variacion_dialectal: 'variación dialectal',
  estrategia: 'estrategia de escucha'
};

/**
 * Columnas implícitas de los formatos de juicio. Se declaran aquí (y no en el
 * renderer) para que la normalización, la verificación y la interfaz compartan
 * exactamente los mismos identificadores.
 */
export const TRUE_FALSE_COLUMNS: ExerciseOption[] = [
  { id: 'true', text: 'VERDADERO' },
  { id: 'false', text: 'FALSO' }
];

export const TRUE_FALSE_NOTGIVEN_COLUMNS: ExerciseOption[] = [
  { id: 'true', text: 'VERDADERO' },
  { id: 'false', text: 'FALSO' },
  { id: 'not_given', text: 'NO SE DICE' }
];

export const FORMAT_LABELS: Record<ExerciseType, string> = {
  multiple_choice: 'opción múltiple',
  true_false: 'verdadero / falso',
  ordering: 'ordenar',
  classification: 'clasificar',
  cloze: 'completar',
  true_false_notgiven: 'V / F / no se dice',
  matching: 'emparejar',
  scale: 'termómetro',
  data_capture: 'ficha de datos',
  dictation: 'reconstruí el dato',
  minimal_pairs: '¿qué oíste?',
  spot_the_difference: 'caza el cambio',
  chunk_order: 'reconstruir la frase'
};

// ---------------------------------------------------------------------------
// Motores deterministas disponibles como plan B por slot
// ---------------------------------------------------------------------------

/**
 * Solo se listan motores que pueden construir un ejercicio DEMOSTRABLEMENTE
 * correcto a partir de la transcripción. No hay motor de `ordering` ni de
 * `matching` porque ambos exigen parafrasear, y una paráfrasis automática no es
 * verificable: antes se rellenaba ese hueco copiando turnos literales del
 * diálogo, que se ordenan leyendo y sin escuchar nada. Si el modelo falla uno de
 * esos slots, la lección sale con un ejercicio menos.
 *
 * `mention_true_false` no lo reclama hoy ningún slot (el `a2-datos` que lo usaba
 * pasó a ser una ficha de datos), pero se conserva registrado y verificado: es
 * el respaldo natural en cuanto vuelva a haber un slot de verdadero/falso.
 */
export const ENGINE_IDS = [
  'select_all_heard',
  'mention_true_false',
  'listening_cloze',
  'two_gap_cloze',
  'data_capture',
  'dictation',
  'minimal_pairs',
  'spot_the_difference',
  'chunk_order'
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

// ---------------------------------------------------------------------------
// Reglas por formato
// ---------------------------------------------------------------------------

const ALL_LEVELS: Level[] = [Level.Intro, Level.Beginner, Level.Intermediate, Level.Advanced];
const ALL_TEXT_TYPES: TextType[] = [
  TextType.Dialogue,
  TextType.PodcastInterview,
  TextType.RadioNews,
  TextType.Monologue
];
const TWO_SPEAKER_TYPES: TextType[] = [TextType.Dialogue, TextType.PodcastInterview];

export interface FormatRule {
  /** Niveles que soportan cognitivamente esta mecánica. */
  levels: Level[];
  /** Tipos de audio cuya estructura discursiva la hace pertinente. */
  textTypes: TextType[];
  /** Ejemplo JSON exacto que se le muestra al modelo. */
  jsonShape: string;
  /** Reglas de autoría que el modelo debe respetar al construir el ejercicio. */
  guidance: string;
}

export const FORMAT_RULES: Record<ExerciseType, FormatRule> = {
  multiple_choice: {
    levels: ALL_LEVELS,
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"multiple_choice","question":"...","options":[{"id":"o1","text":"..."}],"correctAnswer":"o1","explanation":"...","sourceTurns":[2]}',
    guidance:
      'Si la respuesta es múltiple, "correctAnswer" es un array de ids. Los distractores deben ser posibles en la situación: nunca opciones absurdas ni descartables sin escuchar.'
  },
  true_false: {
    levels: ALL_LEVELS,
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"true_false","question":"...","rows":[{"id":"r1","text":"..."}],"correctAnswer":{"r1":"true","r2":"false"},"explanation":"...","sourceTurns":[1,3]}',
    guidance:
      'Cada afirmación FALSA debe estar CONTRADICHA explícitamente por el audio, nunca simplemente ausente (para eso existe true_false_notgiven). Reparte verdaderas y falsas por mitades.'
  },
  ordering: {
    levels: [Level.Beginner, Level.Intermediate, Level.Advanced],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"ordering","question":"...","options":[{"id":"s1","text":"..."}],"correctAnswer":["s1","s2","s3","s4"],"explanation":"...","sourceTurns":[0,4,7]}',
    guidance:
      'PROHIBIDO copiar turnos consecutivos del audio: el orden se reconstruiría leyendo, sin escuchar. Usa PARÁFRASIS breves (4-10 palabras) de acciones o hechos tomados de puntos SEPARADOS del audio, cubriendo principio, medio y final.'
  },
  classification: {
    // Widget neutro: la dificultad está entera en las categorías, no en la
    // mecánica. En A0 solo se usa para agrupar palabras por hablante
    // (modo Adivina el Acento), que sí es apropiado.
    levels: ALL_LEVELS,
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"classification","question":"...","rows":[{"id":"r1","text":"..."}],"columns":[{"id":"c1","text":"..."}],"correctAnswer":{"r1":"c1"},"explanation":"...","sourceTurns":[2,5]}',
    guidance:
      'Las categorías deben ser distinguibles POR LO QUE SE OYE, con una marca concreta que las justifique. Varias filas pueden compartir columna.'
  },
  cloze: {
    levels: ALL_LEVELS,
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"cloze","question":"...","textWithGaps":"Nombre: ... {{gap1}} ... {{gap2}} ...","gapOptions":{"gap1":[{"id":"g1a","text":"..."}],"gap2":[{"id":"g2a","text":"..."}]},"correctAnswer":{"gap1":"g1a","gap2":"g2a"},"explanation":"...","sourceTurns":[3]}',
    guidance:
      'La palabra correcta debe aparecer LITERALMENTE en el audio, con su ortografía y sus tildes correctas. Los distractores deben ser gramaticalmente posibles en el hueco: si solo uno encaja sintácticamente, el ejercicio se resuelve sin escuchar.'
  },
  true_false_notgiven: {
    levels: [Level.Intermediate, Level.Advanced],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"true_false_notgiven","question":"...","rows":[{"id":"r1","text":"..."}],"correctAnswer":{"r1":"true","r2":"false","r3":"not_given"},"explanation":"...","sourceTurns":[1,6]}',
    guidance:
      'Los valores son exactamente "true", "false" y "not_given". VERDADERO incluye lo que se deduce por inferencia puente. FALSO es lo contradicho por el audio. NO SE DICE es plausible y tentador pero jamás se menciona ni se implica: es el ítem que entrena a no sobreinferir, así que debe haber al menos uno y debe ser difícil.'
  },
  matching: {
    levels: [Level.Beginner, Level.Intermediate, Level.Advanced],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"matching","question":"...","rows":[{"id":"r1","text":"..."}],"columns":[{"id":"c1","text":"..."}],"correctAnswer":{"r1":"c1","r2":"c2"},"explanation":"...","sourceTurns":[2,4]}',
    guidance:
      'Emparejamiento BIYECTIVO: tantas columnas como filas, y cada columna se usa exactamente una vez. Ninguna pareja debe deducirse por descarte trivial: todas las opciones tienen que ser plausibles para más de una fila.'
  },
  scale: {
    levels: [Level.Intermediate, Level.Advanced],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"scale","question":"...","rows":[{"id":"r1","text":"..."}],"columns":[{"id":"p1","text":"..."},{"id":"p2","text":"..."},{"id":"p3","text":"..."},{"id":"p4","text":"..."}],"correctAnswer":{"r1":"p3"},"explanation":"...","sourceTurns":[5]}',
    guidance:
      'Las columnas son los puntos de UN ÚNICO eje ORDINAL, escritos de menor a mayor grado (por ejemplo: "lo descarta" → "lo ve improbable" → "lo admite como posible" → "lo afirma sin reservas"). No sirven categorías sueltas sin orden. Las filas son citas TEXTUALES del audio.'
  },
  data_capture: {
    levels: ALL_LEVELS,
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"data_capture","question":"...","fields":[{"id":"f1","label":"Hora","options":[{"id":"f1a","text":"..."}]}],"correctAnswer":{"f1":"f1a"},"explanation":"...","sourceTurns":[3]}',
    guidance:
      'Simula un formulario real de la situación (comanda, reserva, ficha de paciente, guía de envío). Cada "label" es UNA sola palabra. Las opciones de cada campo deben diferir en un único elemento y sonar casi igual ("14,95" / "40,95" / "14,55"; "8:15" / "8:50"), y el valor correcto debe decirse literalmente en el audio.'
  },
  dictation: {
    // Mecánica de nivel bajo: reproducir, no reconocer. En B1+ el dato literal
    // ya no es el objeto de aprendizaje, así que no se ofrece ahí.
    levels: [Level.Intro, Level.Beginner],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"dictation","question":"...","fields":[{"id":"d1","label":"1","options":[{"id":"d1a","text":"seis"},{"id":"d1b","text":"siete"},{"id":"d1c","text":"dieciséis"}]},{"id":"d2","label":"2","options":[{"id":"d2a","text":"treinta y dos"}]}],"separators":["","con"],"correctAnswer":{"d1":"d1a","d2":"d2a"},"explanation":"...","sourceTurns":[4]}',
    guidance:
      'RECONSTRUCCIÓN EXACTA, no reconocimiento. Cada campo es UN elemento del dato en el ORDEN en que suena (una cifra, un grupo de cifras, una letra deletreada), y "label" es sólo su número de posición. Los distractores de cada posición son numerales o letras que se confunden AL OÍDO con el de esa posición ("seis"/"siete"/"dieciséis", "be"/"de"), nunca el valor de otra posición ni una cifra al azar. "separators" son las piezas fijas que van entre dos campos y que el alumno NO elige ("y", "con", "arroba", "punto"): tantas como campos menos uno, cadena vacía donde no haya ninguna. El dato completo, leído de izquierda a derecha con sus separadores, tiene que decirse LITERALMENTE y de corrido en un solo turno del audio.'
  },
  minimal_pairs: {
    // Abierto a todos los niveles: en A0/A1 aísla contrastes fónicos básicos y
    // en B/C1 aísla el rasgo dialectal en el modo Adivina el Acento.
    levels: ALL_LEVELS,
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"minimal_pairs","question":"¿Qué oíste?","fields":[{"id":"m1","label":"1","options":[{"id":"m1a","text":"pero"},{"id":"m1b","text":"perro"}]}],"correctAnswer":{"m1":"m1a"},"explanation":"...","sourceTurns":[1,2]}',
    guidance:
      'Cada ítem tiene 2 opciones que suenan casi igual y de las cuales UNA aparece literalmente en el audio. Usa contrastes reales del español: /r/ vs /rr/, /b/ vs /p/, posición del acento ("esta" vs "está", "hablo" vs "habló"), concordancia mínima ("el" vs "la") o enlaces ("va a ir" vs "va ir"). El "label" es solo el número de ítem.'
  },
  spot_the_difference: {
    levels: [Level.Beginner, Level.Intermediate, Level.Advanced],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"spot_the_difference","question":"...","tokens":[{"id":"t0","text":"Buenos"},{"id":"t1","text":"días,"}],"correctAnswer":["t3","t7","t11"],"explanation":"...","sourceTurns":[4]}',
    guidance:
      'Copia UNA oración real del audio partida palabra por palabra en "tokens" (la puntuación va pegada a su palabra) y ALTERA exactamente el número de palabras indicado. "correctAnswer" son los ids de las palabras alteradas. Cada alteración debe dar una frase que siga siendo gramatical y verosímil: si el cambio produce algo agramatical, se detecta sin escuchar.'
  },
  chunk_order: {
    levels: [Level.Beginner, Level.Intermediate],
    textTypes: ALL_TEXT_TYPES,
    jsonShape:
      '{"id":"...","type":"chunk_order","question":"...","options":[{"id":"k1","text":"¿me podría decir"},{"id":"k2","text":"a qué hora"}],"correctAnswer":["k1","k2","k3"],"explanation":"...","sourceTurns":[6]}',
    guidance:
      'Parte UNA sola frase del audio en 4-5 GRUPOS FÓNICOS (bloques que se pronuncian de corrido), nunca en palabras sueltas. Los grupos deben ser trozos literales y contiguos de esa frase.'
  }
};

// ---------------------------------------------------------------------------
// Plantillas de slot
// ---------------------------------------------------------------------------

export interface ExerciseSlot {
  slotId: string;
  stage: ListeningStage;
  skill: ListeningSkill;
  format: ExerciseType;
  /** Filas / ítems / opciones esperados. */
  items: number;
  /**
   * Columnas de los formatos que se resuelven sobre una tabla (`classification`,
   * `scale`, `matching`, juicios). Vivía sólo en la prosa del `brief`, así que no
   * había forma de MEDIR lo que costaba leer una tarjeta: una escala de 4 filas
   * son 4 respuestas pero 8 unidades de texto. Por defecto, `DEFAULT_COLUMNS`.
   */
  columns?: number;
  /**
   * Naturaleza de las filas: `'word'` cuando son palabras o expresiones sueltas
   * (todo el modo Vocabulario, el léxico dialectal) y `'phrase'` cuando son
   * afirmaciones o citas de una línea. Sin esta distinción, emparejar cuatro
   * palabras con su paráfrasis y emparejar cuatro problemas con su solución
   * costarían lo mismo, y no cuestan ni parecido.
   */
  rowScale?: 'word' | 'phrase';
  /** Instrucción concreta ya resuelta para el tipo de audio. */
  brief: string;
  engineFallback?: EngineId;
  /**
   * El motor determinista tiene PRIORIDAD sobre el modelo en este slot. Se usa
   * donde el ejercicio se puede demostrar entero contra la transcripción —el
   * dato dictado— y por tanto una versión derivada del audio siempre es más
   * fiable que una redactada. El ejercicio del modelo sólo entra si el motor no
   * encuentra material. Implica `engineFallback`.
   */
  preferEngine?: boolean;
  /** Presupone interacción entre dos hablantes. */
  requiresTwoSpeakers?: boolean;
  /**
   * Dato obligatorio de la situación al que este slot tiene que apuntar. Lo
   * rellena `getBlueprint()` en los slots marcados con `focusOnDataPoint`, y lo
   * leen los motores deterministas para no construir la ficha ni los pares
   * mínimos sobre el saludo en lugar de sobre la cifra dictada.
   */
  focus?: DataPointKind;
}

interface SlotTemplate extends Omit<ExerciseSlot, 'brief' | 'focus'> {
  brief: string;
  briefByTextType?: Partial<Record<TextType, string>>;
  /**
   * La habilidad cambia con el tipo de audio. `b-relaciones` empareja problemas
   * con soluciones en un diálogo, pero datos con su FUENTE en un boletín: es
   * `rol_fuente`, no `inferencia`. Sin esto, `textType` sólo cambiaba la
   * redacción del brief y nunca lo que la lección declara entrenar.
   */
  skillByTextType?: Partial<Record<TextType, ListeningSkill>>;
  /**
   * Duración mínima del audio a partir de la cual aparece este slot. Por defecto
   * `Corto`, o sea siempre. Es lo que hace que la lección escale: el núcleo del
   * nivel entra en Corto y lo demás se gana con turnos de audio.
   */
  minLength?: Length;
  /** El slot gira alrededor del dato obligatorio: recibe `focus` y interpolación. */
  focusOnDataPoint?: boolean;
}

/** Orden creciente de duración; el índice es lo que compara `getBlueprint`. */
const LENGTH_ORDER: Length[] = [Length.Short, Length.Medium, Length.Long];

/** Columnas implícitas de cada formato de tabla cuando el slot no las declara. */
const DEFAULT_COLUMNS: Partial<Record<ExerciseType, number>> = {
  true_false: 2,
  true_false_notgiven: 3,
  classification: 3,
  scale: 4
};

/** Columnas efectivas del slot: `matching` es biyectivo, así que son sus filas. */
function columnCount(slot: Pick<ExerciseSlot, 'format' | 'items' | 'columns'>): number {
  if (slot.columns) return slot.columns;
  if (slot.format === 'matching') return slot.items;
  return DEFAULT_COLUMNS[slot.format] ?? 0;
}

/**
 * Respuestas discretas que el slot le pide al alumno.
 *
 * No es lo mismo que `items`: una opción múltiple de seis opciones es UNA
 * respuesta, y un dictado de seis campos son seis. El presupuesto por nivel se
 * contaba en tarjetas, que es la unidad equivocada — tres tarjetas pueden ser
 * cuatro respuestas o veinte.
 */
export function answerCost(slot: Pick<ExerciseSlot, 'format' | 'items'>): number {
  switch (slot.format) {
    // Una sola decisión, tenga las opciones que tenga (aunque sea multirrespuesta:
    // se corrige todo o nada, así que el alumno entrega una única respuesta).
    case 'multiple_choice':
      return 1;
    default:
      return slot.items;
  }
}

/**
 * Unidades de texto de longitud FRASE que hay que leer para resolver el slot.
 *
 * Es el coste que de verdad hacía inmanejable una lección de B1: seis tarjetas
 * son veinte respuestas, pero también treinta y tantas frases en español que hay
 * que leer y comparar entre sí antes de poder contestar. Pasado cierto punto la
 * tarea deja de medir comprensión auditiva y mide comprensión lectora.
 *
 * Las unidades de nivel PALABRA (cifras de un dictado, pares mínimos, grupos
 * fónicos, opciones de un hueco) pesan 0.25: son las que el nivel bajo puede
 * permitirse justamente porque no hay que leer español corrido para procesarlas.
 */
export function readingLoad(slot: Pick<ExerciseSlot, 'format' | 'items' | 'columns' | 'rowScale'>): number {
  const WORD = 0.25;
  const cols = columnCount(slot);
  // Las filas del modo Vocabulario son palabras sueltas; las de B1/C1, citas.
  const rows = slot.items * (slot.rowScale === 'word' ? WORD : 1);

  switch (slot.format) {
    // Filas y columnas son texto que hay que cruzar; el eje se lee entero.
    case 'classification':
    case 'scale':
      return rows + cols;
    // Biyectivo: la columna derecha son paráfrasis que se comparan entre sí.
    case 'matching':
      return rows + slot.items;
    // Las etiquetas de juicio (V/F/NO SE DICE) son fijas y se leen una vez.
    case 'true_false':
    case 'true_false_notgiven':
      return rows + cols * WORD;
    // Opciones y paráfrasis de una línea.
    case 'multiple_choice':
    case 'ordering':
      return slot.items;
    // Una frase portadora más las opciones sueltas de cada hueco.
    case 'cloze':
      return 1 + slot.items * 3 * WORD;
    // Una sola frase que se lee entera y se marca encima.
    case 'spot_the_difference':
      return 1;
    // Piezas de nivel palabra: cifras, letras, grupos fónicos.
    case 'chunk_order':
      return slot.items * WORD;
    case 'minimal_pairs':
      return slot.items * 2 * WORD;
    case 'dictation':
    case 'data_capture':
      return slot.items * 3 * WORD;
    default:
      return slot.items;
  }
}

/** Suma de respuestas discretas de una lección. */
export function totalAnswers(slots: Pick<ExerciseSlot, 'format' | 'items'>[]): number {
  return slots.reduce((sum, slot) => sum + answerCost(slot), 0);
}

/** Suma de unidades de lectura de una lección. */
export function totalReadingLoad(slots: Pick<ExerciseSlot, 'format' | 'items' | 'columns'>[]): number {
  return slots.reduce((sum, slot) => sum + readingLoad(slot), 0);
}

/**
 * Marcadores que los briefs de los niveles bajos usan para hablar del dato
 * concreto que se dictó, en vez de decir "un dato" en abstracto.
 */
function interpolate(brief: string, dataPoint?: DataPointKind): string {
  const profile = dataPointProfile(dataPoint);
  return brief
    .replace(/\{\{dato\}\}/g, profile.label)
    .replace(/\{\{campo\}\}/g, profile.fieldLabel)
    .replace(/\{\{contrastes\}\}/g, profile.contrasts);
}

function resolve(template: SlotTemplate, textType: TextType, dataPoint?: DataPointKind): ExerciseSlot {
  const { briefByTextType, skillByTextType, minLength, focusOnDataPoint, ...rest } = template;
  const brief = briefByTextType?.[textType] ?? template.brief;
  return {
    ...rest,
    skill: skillByTextType?.[textType] ?? template.skill,
    brief: focusOnDataPoint ? interpolate(brief, dataPoint) : brief,
    ...(focusOnDataPoint ? { focus: dataPoint ?? 'generic' } : {})
  };
}

// ---------------------------------------------------------------------------
// NIVEL A0 — Inicial absoluto
// ---------------------------------------------------------------------------
// El audio va a velocidad nativa real. El alumno todavía no decodifica cláusulas:
// decodifica DATOS. Todo lo que exija leer español corrido, inferir o juzgar
// registro queda fuera. Las opciones son cortas, concretas y casi siempre
// numéricas o de una o dos palabras.
//
// Son TRES ejercicios y los tres giran alrededor del dato obligatorio de la
// situación. Antes eran seis (≈26 respuestas): predicción previa, idea global,
// ficha, pares mínimos, caza de palabras y una reflexión metacognitiva redactada
// en español corrido. En una lección de "pedir un número de teléfono" eso
// significaba preguntar veintitantas cosas y sólo tres o cuatro sobre el número,
// que es lo único que el nivel declara entrenar. La caza de palabras y la
// reflexión, además, exigían leer español a quien todavía no lo lee.
//
// El ejercicio central ya no es una ficha, es un DICTADO: la ficha pedía elegir
// el dato entero entre tres cadenas parecidas, y de sus tres campos sólo uno era
// el dato anunciado —los otros dos eran lo que hubieran pescado las regex—. Eso
// es reconocer, no anotar. `dictation` pide reproducir el dato elemento a
// elemento en el orden en que sonó, que es lo que de verdad hay que saber hacer
// con un teléfono dictado al vuelo.

const A0_SLOTS: SlotTemplate[] = [
  {
    slotId: 'a0-global',
    stage: 'global',
    skill: 'idea_global',
    format: 'multiple_choice',
    items: 3,
    brief:
      '¿Dónde ocurre? 3 opciones de 1 o 2 palabras, todas lugares posibles del mismo tipo de situación. Nada de inferencia: la opción correcta tiene que estar delatada por una PALABRA CONCRETA que se dice literalmente en el audio (el nombre del sitio, lo que se pide, cómo se saluda) o por el ruido de ambiente. Cita esa palabra en "explanation".',
    briefByTextType: {
      [TextType.RadioNews]:
        '¿De qué trata la noticia? 3 opciones de 1 a 3 palabras (el tema, no el detalle). La opción correcta tiene que estar delatada por una palabra que se dice literalmente; cítala en "explanation".',
      [TextType.Monologue]:
        '¿De qué habla la persona? 3 opciones de 1 a 3 palabras. La opción correcta tiene que estar delatada por una palabra que se dice literalmente; cítala en "explanation".',
      [TextType.PodcastInterview]:
        '¿De qué hablan? 3 opciones de 1 a 3 palabras. La opción correcta tiene que estar delatada por una palabra que se dice literalmente; cítala en "explanation".'
    }
  },
  {
    slotId: 'a0-dato',
    stage: 'selectiva',
    skill: 'dato_literal',
    format: 'dictation',
    items: 6,
    engineFallback: 'dictation',
    preferEngine: true,
    focusOnDataPoint: true,
    brief:
      'Es EL ejercicio del nivel: reconstruir {{dato}} tal como se dictó, elemento a elemento y en orden. La ficha se titula "{{campo}}". Pon tantos campos como elementos tenga el dato realmente dicho (no te ciñas al número orientativo), cada uno con la pieza que suena en esa posición y 2 alternativas que se confunden con ella al oído.',
    briefByTextType: {
      [TextType.RadioNews]:
        'Reconstruir {{dato}} tal como se dice en el boletín, elemento a elemento y en orden. La ficha se titula "{{campo}}". Un campo por elemento realmente dicho, con 2 alternativas confundibles al oído en cada posición.'
    }
  },
  {
    slotId: 'a0-pares',
    stage: 'selectiva',
    skill: 'decodificacion',
    format: 'minimal_pairs',
    items: 4,
    engineFallback: 'minimal_pairs',
    focusOnDataPoint: true,
    brief:
      '4 ítems de discriminación sobre {{dato}} y las palabras que lo rodean. Prioriza estos contrastes: {{contrastes}}. Cada ítem enfrenta la forma que SÍ suena con otra que suena casi igual.'
  }
];

// ---------------------------------------------------------------------------
// NIVEL A1-A2 — Principiante
// ---------------------------------------------------------------------------
// Ya sigue la situación completa: qué se quiere, en qué orden pasa y en qué
// queda. Los roles se nombran por su papel concreto (cliente/empleado), nunca
// por etiquetas abstractas como "formal/informal", que son B1+.
//
// Son CUATRO ejercicios en Medio y Largo, TRES en Corto. Fueron nueve (≈36
// respuestas) y después cinco. El que sobra es el `ordering` de cuatro acciones
// parafraseadas: es la tarea de más LECTURA del nivel —cuatro paráfrasis de una
// línea que hay que comparar entre sí—, no tiene motor determinista (una
// paráfrasis automática no es verificable), así que cuando el modelo falla el
// slot desaparece en silencio, y `a2-chunks` ya entrena reconstruir un orden,
// además de forma literal. `estructura` pasa a trabajarse a partir de B1.
// `matching` y `spot_the_difference` siguen usándose en el modo Vocabulario y
// en B1+.
//
// El cloze de fórmulas es lo que se gana con la duración: en seis turnos hay una
// fórmula rutinaria, no dos, y el núcleo del nivel —qué se quiere, el dato y la
// segmentación de una frase— ya está entero en Corto.

const A2_SLOTS: SlotTemplate[] = [
  {
    slotId: 'a2-global',
    stage: 'global',
    skill: 'idea_global',
    format: 'multiple_choice',
    items: 4,
    brief:
      '¿Qué quiere conseguir quien inicia la conversación y lo consigue o no? 4 opciones de una línea; las 3 incorrectas deben describir desenlaces posibles de la misma situación.',
    briefByTextType: {
      [TextType.PodcastInterview]:
        '¿De qué trata la entrevista y qué opinión general sostiene la persona entrevistada? 4 opciones de una línea.',
      [TextType.RadioNews]:
        'Elige el titular que mejor resume la noticia. 4 opciones con formato de titular, todas verosímiles y sobre el mismo hecho.',
      [TextType.Monologue]:
        '¿Qué cuenta la persona y cómo termina? 4 opciones de una línea.'
    }
  },
  {
    slotId: 'a2-dato',
    stage: 'selectiva',
    skill: 'dato_literal',
    format: 'dictation',
    items: 6,
    engineFallback: 'dictation',
    preferEngine: true,
    focusOnDataPoint: true,
    brief:
      'Reconstruir {{dato}} tal como se dice en el audio, elemento a elemento y en orden. La ficha se titula "{{campo}}". Pon tantos campos como elementos tenga el dato realmente dicho (no te ciñas al número orientativo), cada uno con la pieza que suena en esa posición y 2 alternativas que se confunden con ella al oído ("catorce" / "cuarenta" / "cuatro").',
    briefByTextType: {
      [TextType.RadioNews]:
        'Reconstruir {{dato}} tal como se dice en el boletín, elemento a elemento y en orden. La ficha se titula "{{campo}}". Un campo por elemento realmente dicho, con 2 alternativas confundibles al oído en cada posición.',
      [TextType.Monologue]:
        'Reconstruir {{dato}} tal como se dice en el relato, elemento a elemento y en orden. La ficha se titula "{{campo}}". Un campo por elemento realmente dicho, con 2 alternativas confundibles al oído en cada posición.'
    }
  },
  {
    slotId: 'a2-chunks',
    stage: 'intensiva',
    skill: 'segmentacion',
    format: 'chunk_order',
    items: 4,
    engineFallback: 'chunk_order',
    brief:
      'Reconstruye una frase útil del audio (una pregunta o una petición) partida en 4 grupos fónicos.'
  },
  {
    slotId: 'a2-formulas',
    stage: 'intensiva',
    skill: 'colocacion_formula',
    format: 'cloze',
    items: 2,
    minLength: Length.Medium,
    engineFallback: 'two_gap_cloze',
    brief:
      'Frase del audio con 2 huecos que caigan sobre una FÓRMULA rutinaria de la situación ("¿me pone…?", "¿cuánto le debo?", "un momentito"). Las 3 opciones de cada hueco son fórmulas del mismo tipo, todas gramaticales en ese lugar.'
  }
];

// ---------------------------------------------------------------------------
// NIVEL B1-B2 — Intermedio
// ---------------------------------------------------------------------------
// El salto real es dejar de premiar el reconocimiento literal. La firma del
// nivel es INFERIR EL PUENTE SIN SOBREINFERIR: el V/F/NO SE DICE es su ejercicio
// insignia, porque es el único formato que castiga rellenar los huecos con lo
// que uno esperaba oír.
//
// Cuatro tarjetas en Corto, cinco en Medio, seis en Largo (9-13 respuestas).
// Eran seis fijas y ≈20 respuestas, pero el número de respuestas nunca fue el
// problema principal: eran ≈34 unidades de texto de longitud FRASE que había que
// leer y cruzar. Una escala de 4 citas × 4 puntos y una clasificación de 4
// palabras × 3 columnas son, juntas, quince frases que comparar; eso ya no mide
// comprensión auditiva.
//
// Se han quitado dos:
//   · `b-actitud` (scale). Graduar la postura en cuatro puntos ordinales es
//     trabajo de C1, y aquí la inferencia ya la cubre el V/F/NO SE DICE. La
//     escala pasa a ser firma EXCLUSIVA de C1 — antes B1 y C1 corrían las mismas
//     seis mecánicas con los mismos ítems y sólo cambiaba la prosa del brief, así
//     que la pregunta "¿qué se trabaja en cada nivel?" no tenía respuesta.
//   · `b-precision` (classification). Sin motor, sin verificación contra la
//     transcripción y siete unidades de lectura para construir un glosario; ese
//     trabajo léxico es literalmente lo que hace el modo Vocabulario.
//
// Y ha entrado `b-forma` (spot_the_difference), que llevaba en el repo motor,
// renderer y la verificación de fidelidad MÁS estricta de todas —las palabras
// alteradas no pueden aparecer en el turno— sin que ningún slot lo usara. Es
// escucha intensiva que no se puede resolver leyendo, y con él el nivel pasa de
// tener 1 slot respaldado de 6 a tener 2 de 4: antes, si el modelo fallaba el
// matching, la escala y el V/F/NG, la lección salía con tres tarjetas y el alumno
// no tenía forma de saber por qué.

const B_SLOTS: SlotTemplate[] = [
  {
    slotId: 'b-global',
    stage: 'global',
    skill: 'idea_global',
    format: 'multiple_choice',
    items: 4,
    brief:
      '¿Cuál es el verdadero objetivo de quien inicia y en qué queda finalmente la interacción? 4 opciones de una línea; los distractores describen lecturas superficiales pero defendibles del mismo diálogo.',
    briefByTextType: {
      [TextType.PodcastInterview]:
        '¿Qué tesis defiende la persona entrevistada? 4 opciones; los distractores recogen ideas que menciona pero que NO son su tesis.',
      [TextType.RadioNews]:
        '¿Cuál es el enfoque de la noticia, es decir, qué presenta como lo importante? 4 opciones sobre el mismo hecho con enfoques distintos.',
      [TextType.Monologue]:
        '¿Qué sentido le da el narrador a lo que cuenta? 4 opciones de una línea.'
    }
  },
  {
    // Tres pares y no cuatro: un emparejamiento biyectivo obliga a leer las dos
    // columnas enteras antes de poder colocar nada, así que su coste de lectura
    // crece el doble de rápido que su número de respuestas.
    slotId: 'b-relaciones',
    stage: 'selectiva',
    skill: 'inferencia',
    format: 'matching',
    items: 3,
    minLength: Length.Medium,
    // En un boletín esto no es inferencia puente: es atribución de fuente, que es
    // otra habilidad y estaba declarada sin usar en todo el syllabus.
    skillByTextType: {
      [TextType.RadioNews]: 'rol_fuente',
      [TextType.PodcastInterview]: 'rol_fuente'
    },
    brief:
      'Empareja los 3 problemas u obstáculos que aparecen con las 3 respuestas o soluciones que se dan. Biyectivo y sin descartes triviales.',
    briefByTextType: {
      [TextType.PodcastInterview]:
        'Empareja 3 afirmaciones del entrevistado con la evidencia o el ejemplo con que las apoya.',
      [TextType.RadioNews]:
        'Empareja 3 datos con su FUENTE ("según…", "fuentes de…"). Si el boletín no atribuye tres veces, empareja cada dato con la función que cumple en la noticia.',
      [TextType.Monologue]:
        'Empareja 3 causas con sus consecuencias dentro del relato.'
    }
  },
  {
    // EL ejercicio del nivel. Cuatro filas y no cinco: con 2V + 1F + 1 NO SE DICE
    // el contraste que entrena —lo contradicho frente a lo no dicho— está entero.
    slotId: 'b-vfns',
    stage: 'intensiva',
    skill: 'inferencia',
    format: 'true_false_notgiven',
    items: 4,
    brief:
      '4 afirmaciones: 2 verdaderas (al menos una que solo se obtenga por inferencia puente, no literal), 1 falsa contradicha explícitamente y 1 de NO SE DICE que sea muy tentadora. El ítem de NO SE DICE es el que entrena a no rellenar huecos con lo que uno esperaba oír: tiene que ser el más plausible de los cuatro.'
  },
  {
    // Escucha intensiva imposible de resolver leyendo: la frase alterada es
    // gramatical y verosímil, así que sólo el audio la delata. Además es el slot
    // que garantiza que el nivel nunca se quede sin ejercicios verificados.
    slotId: 'b-forma',
    stage: 'intensiva',
    skill: 'reconocimiento_lexico',
    format: 'spot_the_difference',
    items: 2,
    engineFallback: 'spot_the_difference',
    brief:
      'Copia UNA frase del audio de 10 a 16 palabras y altera exactamente 2. Las dos alteraciones deben dejar la frase gramatical y verosímil en la situación (cambia una palabra por otra del mismo tipo, no por una imposible): si el cambio canta sin escuchar, el ejercicio no vale.'
  },
  {
    slotId: 'b-colocacion',
    stage: 'intensiva',
    skill: 'colocacion_formula',
    format: 'cloze',
    items: 2,
    engineFallback: 'two_gap_cloze',
    brief:
      '2 huecos sobre COLOCACIONES del audio (verbo + sustantivo, sustantivo + adjetivo). Los distractores son colocaciones que existen en español pero que NO se dijeron.'
  },
  {
    // Noticing de cierre: una sola respuesta y tres opciones cortas. Es lo más
    // barato en lectura de toda la lección y lo único que se transfiere a la
    // siguiente escucha, y hasta ahora la etapa `reflexion` no existía fuera del
    // modo Adivina el Acento.
    slotId: 'b-reflexion',
    stage: 'reflexion',
    skill: 'estrategia',
    format: 'multiple_choice',
    items: 3,
    minLength: Length.Long,
    brief:
      '¿Qué indicio concreto del audio permitió decidir la respuesta del ejercicio de VERDADERO/FALSO/NO SE DICE? 3 opciones que citen un elemento que SUENA (una palabra, un conector, un cambio de tono), nunca un razonamiento abstracto. Las dos incorrectas deben citar elementos que también suenan pero que no deciden nada.'
  }
];

// ---------------------------------------------------------------------------
// NIVEL C1 — Avanzado
// ---------------------------------------------------------------------------
// LEER ENTRE LÍNEAS Y OÍR LA ARQUITECTURA DEL DISCURSO. Nada de reconocimiento
// literal ni de definiciones: todo se juega en el matiz, en la atenuación y en
// lo que NO se dice.
//
// Cuatro tarjetas en Corto, cinco en Medio, seis en Largo (10-15 respuestas).
// Eran seis fijas, ≈21 respuestas y ≈32 unidades de lectura; antes de eso, diez
// y ≈38.
//
// Se ha quitado `c1-registro` (classification 4×3): sin motor, sin verificación
// contra la transcripción y siete unidades de lectura. Su trabajo pragmático no
// se pierde, se traslada a `c1-reflexion`, que pide exactamente lo mismo —qué
// MARCA concreta delata el registro o la intención— por una respuesta en lugar
// de cuatro.
//
// Y `c1-retorica` pasa a partir de Medio: es el slot más caro de generar bien
// (cinco paráfrasis funcionales, sin motor posible porque una paráfrasis
// automática no se puede verificar) y en seis turnos no hay cuatro movimientos
// argumentativos que ordenar. Pedirlo sobre un audio que no los tiene es
// garantizar que el modelo se los invente.
//
// La escala ordinal es ahora firma EXCLUSIVA de este nivel: graduar el
// compromiso del hablante con lo que afirma —la atenuación— es lo que separa C1
// de B1, y mientras B1 también tenía una escala los dos niveles corrían las
// mismas seis mecánicas con los mismos ítems.

const C1_SLOTS: SlotTemplate[] = [
  {
    slotId: 'c1-subtexto',
    stage: 'global',
    skill: 'inferencia',
    format: 'multiple_choice',
    items: 4,
    brief:
      '¿Qué está haciendo realmente quien habla, por debajo de lo que dice literalmente (reprochar, tantear, presionar, escurrir el bulto)? 4 opciones; los distractores son lecturas literales correctas pero que se quedan en la superficie.',
    briefByTextType: {
      [TextType.RadioNews]:
        '¿Qué presuposición o encuadre ideológico transmite la redacción del boletín? 4 opciones sobre el mismo hecho.',
      [TextType.Monologue]:
        '¿Qué evaluación implícita hace el narrador de lo que cuenta? 4 opciones.'
    }
  },
  {
    slotId: 'c1-retorica',
    stage: 'global',
    skill: 'estructura',
    format: 'ordering',
    items: 4,
    minLength: Length.Medium,
    brief:
      'Ordena 4 movimientos ARGUMENTATIVOS según aparecen (concesión, objeción, ejemplo, reformulación, conclusión), descritos por su función y no por su contenido.'
  },
  {
    slotId: 'c1-vfns',
    stage: 'intensiva',
    skill: 'inferencia',
    format: 'true_false_notgiven',
    items: 4,
    brief:
      '4 afirmaciones que incluyan al menos una implicatura conversacional y una ironía. Una debe ser NO SE DICE y tiene que ser la más tentadora de todas.'
  },
  {
    // Tres citas y no cuatro: cada fila es una cita textual con atenuación, así
    // que la tarjeta ya obliga a leer también los cuatro puntos del eje.
    slotId: 'c1-compromiso',
    stage: 'intensiva',
    skill: 'actitud_postura',
    format: 'scale',
    items: 3,
    columns: 4,
    brief:
      'Eje ordinal de 4 puntos sobre el grado de compromiso del hablante con lo que afirma ("lo descarta" → "lo ve improbable" → "lo admite como posible" → "lo afirma sin reservas"). Las 3 filas son citas textuales con atenuación o matización.'
  },
  {
    slotId: 'c1-locuciones',
    stage: 'intensiva',
    skill: 'colocacion_formula',
    format: 'cloze',
    items: 2,
    engineFallback: 'two_gap_cloze',
    brief:
      '2 huecos sobre LOCUCIONES o MARCADORES DISCURSIVOS del audio ("por cierto", "de hecho", "ahora bien", "a ver si"). Los distractores son marcadores que encajarían sintácticamente pero cambiarían el valor argumentativo.'
  },
  {
    // Recoge el trabajo pragmático que hacía la clasificación de registro, pero
    // por una respuesta en vez de cuatro: lo que se le pedía al alumno era
    // justificar cada casilla con una marca concreta, y eso es exactamente lo
    // que aquí se pregunta de forma directa.
    slotId: 'c1-reflexion',
    stage: 'reflexion',
    skill: 'estrategia',
    format: 'multiple_choice',
    items: 3,
    minLength: Length.Long,
    brief:
      '¿Qué MARCA concreta del audio delata lo que el hablante está haciendo realmente (el tratamiento, una atenuación, una elección léxica, una elipsis, un cambio de tono)? 3 opciones que citen un elemento que SUENA. ATENCIÓN: "gracias", "por favor" y "buenos días" son NEUTROS y aparecen en cualquier registro; no valen como marca. Tampoco confundas marca DIALECTAL ("che", "po", "vale") con marca de registro.'
  }
];

const LEVEL_SLOTS: Record<Level, SlotTemplate[]> = {
  [Level.Intro]: A0_SLOTS,
  [Level.Beginner]: A2_SLOTS,
  [Level.Intermediate]: B_SLOTS,
  [Level.Advanced]: C1_SLOTS
};

// ---------------------------------------------------------------------------
// Modo VOCABULARIO: densidad léxica, pero escalada por nivel
// ---------------------------------------------------------------------------
// El sistema anterior despachaba el modo ANTES que el nivel, así que un A0 y un
// C1 recibían exactamente los mismos ejercicios. Aquí cada nivel tiene su propia
// idea de lo que significa "trabajar el vocabulario".

const VOCABULARY_SLOTS: Record<Level, SlotTemplate[]> = {
  [Level.Intro]: [
    {
      slotId: 'voc-a0-forma',
      stage: 'selectiva',
      skill: 'reconocimiento_lexico',
      format: 'minimal_pairs',
      items: 4,
      engineFallback: 'minimal_pairs',
      brief:
        '4 ítems con la FORMA SONORA de las palabras clave del tema: en cada uno, la palabra real del audio frente a otra que suena casi igual.'
    },
    // Aquí había un `voc-a0-caza`: seis palabras escritas de las que había que
    // marcar cuáles suenan. Se quitó porque en A0 es una tarea de LECTURA —seis
    // palabras que hay que saber leer antes de poder escuchar nada— y porque su
    // motor de respaldo (`selectAllHeard`) descarta explícitamente todo lo que
    // lleve dígitos, o sea justo el material que el nivel entrena.
    {
      slotId: 'voc-a0-ficha',
      stage: 'selectiva',
      skill: 'dato_literal',
      format: 'data_capture',
      items: 3,
      engineFallback: 'data_capture',
      brief:
        'Ficha con 3 campos del tema (cantidad, precio, hora, nombre) con opciones casi idénticas.'
    }
  ],
  [Level.Beginner]: [
    {
      slotId: 'voc-a2-significado',
      stage: 'selectiva',
      skill: 'lexico_significado',
      format: 'matching',
      items: 4,
      rowScale: 'word',
      brief:
        'Empareja 4 palabras o expresiones del audio con su significado en contexto, en paráfrasis cortas y concretas.'
    },
    {
      slotId: 'voc-a2-campos',
      stage: 'selectiva',
      skill: 'lexico_significado',
      format: 'classification',
      items: 4,
      columns: 2,
      rowScale: 'word',
      minLength: Length.Medium,
      brief:
        '4 palabras del audio en 2 campos temáticos CONCRETOS de la situación (por ejemplo "lo que se pide" / "lo que se paga"). Nada de "formal" ni "informal": esa distinción es de B1 en adelante.'
    },
    {
      slotId: 'voc-a2-formulas',
      stage: 'intensiva',
      skill: 'colocacion_formula',
      format: 'cloze',
      items: 2,
      engineFallback: 'two_gap_cloze',
      brief:
        'Frase del audio con 2 huecos sobre fórmulas rutinarias de la situación.'
    }
  ],
  [Level.Intermediate]: [
    {
      slotId: 'voc-b-colocacion',
      stage: 'selectiva',
      skill: 'colocacion_formula',
      format: 'matching',
      items: 4,
      rowScale: 'word',
      brief:
        'Empareja 4 verbos del audio con el complemento con el que aparecieron realmente. Todos los complementos deben ser combinables con más de un verbo.'
    },
    {
      slotId: 'voc-b-precision',
      stage: 'intensiva',
      skill: 'lexico_significado',
      format: 'classification',
      items: 4,
      rowScale: 'word',
      brief:
        '4 palabras del audio en 3 columnas de matiz próximo, clasificadas por el sentido que tienen EN ESTE audio.'
    },
    {
      slotId: 'voc-b-cloze',
      stage: 'intensiva',
      skill: 'colocacion_formula',
      format: 'cloze',
      items: 2,
      engineFallback: 'two_gap_cloze',
      brief:
        '2 huecos con opciones semánticamente cercanas: la diferencia entre ellas debe ser de precisión, no de gramática.'
    },
    {
      slotId: 'voc-b-uso',
      stage: 'intensiva',
      skill: 'lexico_significado',
      format: 'true_false_notgiven',
      items: 4,
      minLength: Length.Medium,
      brief:
        '4 afirmaciones sobre el USO de expresiones del audio (qué implican, cuándo se dicen). Una debe ser NO SE DICE.'
    }
  ],
  [Level.Advanced]: [
    {
      slotId: 'voc-c1-matiz',
      stage: 'selectiva',
      skill: 'lexico_significado',
      format: 'matching',
      items: 4,
      rowScale: 'word',
      brief:
        'Empareja 4 expresiones del audio con la paráfrasis que capta su matiz exacto; las paráfrasis deben ser casi sinónimas entre sí.'
    },
    {
      slotId: 'voc-c1-connotacion',
      stage: 'intensiva',
      skill: 'actitud_postura',
      format: 'scale',
      items: 3,
      columns: 4,
      rowScale: 'word',
      brief:
        'Eje ordinal de 4 puntos sobre la carga valorativa con que el hablante usa 3 expresiones ("claramente peyorativo" → "crítico y atenuado" → "neutro" → "abiertamente elogioso").'
    },
    {
      slotId: 'voc-c1-locuciones',
      stage: 'intensiva',
      skill: 'colocacion_formula',
      format: 'cloze',
      items: 2,
      engineFallback: 'two_gap_cloze',
      brief:
        '2 huecos sobre locuciones o marcadores discursivos del audio, con distractores que cambiarían el valor argumentativo.'
    },
    {
      slotId: 'voc-c1-registro',
      stage: 'intensiva',
      skill: 'pragmatica_registro',
      format: 'classification',
      items: 4,
      rowScale: 'word',
      minLength: Length.Medium,
      brief:
        '4 expresiones del audio en 3 columnas de registro, cada una justificable por una marca concreta. No uses "gracias" ni "por favor" como prueba de formalidad, ni confundas marca dialectal con registro.'
    }
  ]
};

// ---------------------------------------------------------------------------
// Modo ADIVINA EL ACENTO: enseñar los indicios, no solo pedir el país
// ---------------------------------------------------------------------------
// El recorrido va de lo perceptible a lo interpretativo: primero se aísla el
// rasgo, después se agrupa el léxico por región y solo al final se pide la
// procedencia. Sin ese andamiaje, acertar el país es adivinar.

function accentSlots(level: Level): SlotTemplate[] {
  const isLow = level === Level.Intro || level === Level.Beginner;
  const isIntro = level === Level.Intro;

  return [
    // La anticipación exige leer descripciones metafonéticas en español corrido
    // ("aspira la s final"), que en A0/A1 es una tarea de lectura disfrazada de
    // escucha. En niveles bajos se entra directamente por la percepción.
    ...(isLow
      ? []
      : [
          {
            slotId: 'acc-anticipacion',
            stage: 'anticipacion' as const,
            skill: 'variacion_dialectal' as const,
            format: 'multiple_choice' as const,
            items: 4,
            minLength: Length.Long,
            brief:
              'Antes de escuchar. 4 rasgos observables descritos SIN nombrar países ("pronuncia la c de cinco como z", "usa vos en vez de tú", "aspira la s final"). El alumno marca los que cree que va a oír; "correctAnswer" es el array de los que efectivamente aparecen.'
          }
        ]),
    {
      // La percepción va primero: identificar el país sin haber aislado antes el
      // rasgo que lo delata es adivinar. En niveles bajos se usan solo los
      // contrastes más marcados, que son perfectamente audibles sin formación.
      slotId: 'acc-pares',
      stage: 'selectiva',
      skill: 'decodificacion',
      format: 'minimal_pairs',
      items: 4,
      brief: isLow
        ? '4 ítems con los contrastes MÁS MARCADOS que aparecen en el audio: la misma palabra tal como suena en boca de cada hablante ("cinco" con z frente a "cinco" con s, "calle" con y frente a "calle" con sh, "tú tienes" frente a "vos tenés"). El alumno marca la forma que realmente oye.'
        : '4 ítems que aíslen el rasgo discriminante fino: seseo frente a distinción, aspiración o elisión de /s/ final, yeísmo rehilado, y realización de la jota. Usa palabras que se dicen en el audio.'
    },
    // Clasificar seis expresiones dialectales escritas es, en A0, una tarea de
    // lectura: el alumno no tiene aún léxico con el que reconocerlas. El andamio
    // que sí funciona a ese nivel son los pares mínimos de arriba, que aíslan el
    // rasgo por el oído.
    ...(isIntro
      ? []
      : [
          {
            slotId: 'acc-lexico',
            stage: 'selectiva' as const,
            skill: 'variacion_dialectal' as const,
            format: 'classification' as const,
            items: 4,
            columns: 2,
            rowScale: 'word' as const,
            minLength: Length.Medium,
            brief:
              '4 palabras o expresiones DIALECTALES realmente dichas en el audio; 2 columnas, una por hablante, identificadas como "Hablante A" y "Hablante B" sin revelar el país.'
          }
        ]),
    // En niveles bajos la procedencia se pregunta UNA vez, por la pareja: dos
    // tarjetas seguidas con la misma pregunta y las mismas opciones no enseñan
    // nada que no enseñe una, y en A0 cada tarjeta de más es lectura.
    ...(isLow
      ? [
          {
            slotId: 'acc-origen' as const,
            stage: 'selectiva' as const,
            skill: 'variacion_dialectal' as const,
            format: 'multiple_choice' as const,
            items: 4,
            brief:
              '¿De dónde son los dos? 4 opciones y cada una es una PAREJA de procedencias ("España y Argentina", "México y Chile"). Sólo una empareja bien a cada hablante con su país.'
          }
        ]
      : [
          {
            slotId: 'acc-origen-a' as const,
            stage: 'selectiva' as const,
            skill: 'variacion_dialectal' as const,
            format: 'multiple_choice' as const,
            items: 4,
            brief:
              '¿De dónde es el HABLANTE A? 4 opciones de países o ciudades hispanohablantes.'
          },
          {
            slotId: 'acc-origen-b' as const,
            stage: 'selectiva' as const,
            skill: 'variacion_dialectal' as const,
            format: 'multiple_choice' as const,
            items: 4,
            brief:
              '¿De dónde es el HABLANTE B? 4 opciones de países o ciudades hispanohablantes, distintas de la respuesta anterior.'
          }
        ]),
    // Aquí había un `acc-rasgos`: seis rasgos fonéticos o gramaticales repartidos
    // entre los dos hablantes. Es la misma tarea que `acc-lexico` —clasificar
    // material del audio en dos columnas, una por hablante— con otro material, y
    // se sostenía sólo en B1+, donde la lección ya tenía siete tarjetas.
    {
      slotId: 'acc-reflexion',
      stage: 'reflexion',
      skill: 'estrategia',
      format: 'multiple_choice',
      items: 3,
      brief:
        '¿Cuál fue el indicio decisivo para identificar a uno de los dos? 3 opciones que citen un rasgo concreto que suena en el audio.'
    }
  ];
}

// ---------------------------------------------------------------------------
// Composición del blueprint
// ---------------------------------------------------------------------------

function isFormatAllowed(format: ExerciseType, level: Level, textType: TextType): boolean {
  const rule = FORMAT_RULES[format];
  return rule.levels.includes(level) && rule.textTypes.includes(textType);
}

/**
 * Devuelve los slots pedagógicos de una lección concreta.
 *
 * Composición: plantillas del nivel (o del modo, si el modo las sustituye)
 * → resolución del brief para el tipo de audio → filtrado estructural por
 * `FORMAT_RULES` y por número de hablantes.
 */
export function getBlueprint(
  level: Level,
  textType: TextType,
  mode: AppMode,
  dataPoint?: DataPointKind,
  length: Length = Length.Short
): ExerciseSlot[] {
  let templates: SlotTemplate[];

  if (mode === AppMode.AccentChallenge) {
    // El reto de acentos siempre genera dos hablantes en diálogo.
    templates = accentSlots(level);
    textType = TextType.Dialogue;
  } else if (mode === AppMode.Vocabulary) {
    // Se conserva la entrada en la lección (anticipación + idea global) del nivel
    // y se sustituye el resto por el trabajo léxico propio del nivel.
    //
    // UNA apertura como mucho, no todas las que compartan etapa: C1 tiene dos
    // slots de etapa `global` (`c1-subtexto` y `c1-retorica`), así que heredaba
    // las dos y un Vocabulario de C1 salía con seis tarjetas mientras uno de A0
    // salía con tres, sin que nadie lo hubiera decidido.
    const levelTemplates = LEVEL_SLOTS[level] ?? LEVEL_SLOTS[Level.Beginner];
    const first = (stage: ListeningStage) => levelTemplates.filter(slot => slot.stage === stage).slice(0, 1);
    templates = [
      ...first('anticipacion'),
      ...first('global'),
      ...(VOCABULARY_SLOTS[level] ?? []),
      ...first('reflexion')
    ];
  } else {
    templates = LEVEL_SLOTS[level] ?? LEVEL_SLOTS[Level.Beginner];
  }

  const singleSpeaker = textType === TextType.RadioNews || textType === TextType.Monologue;
  const lengthIndex = Math.max(0, LENGTH_ORDER.indexOf(length));

  const seen = new Set<string>();
  return templates
    .filter(slot => isFormatAllowed(slot.format, level, textType))
    .filter(slot => !(singleSpeaker && slot.requiresTwoSpeakers))
    // La lección crece con el audio: el núcleo del nivel entra siempre y el
    // resto se gana con turnos. Pedir seis tarjetas sobre seis turnos no era
    // pedir más escucha, era pedir que el modelo rellenara.
    .filter(slot => lengthIndex >= LENGTH_ORDER.indexOf(slot.minLength ?? Length.Short))
    .filter(slot => {
      if (seen.has(slot.slotId)) return false;
      seen.add(slot.slotId);
      return true;
    })
    .map(slot => resolve(slot, textType, dataPoint))
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
}

/** Orden canónico de los ejercicios de una lección, por etapa de escucha. */
export function compareByStage(a: { stage?: ListeningStage }, b: { stage?: ListeningStage }): number {
  const ia = a.stage ? STAGE_ORDER.indexOf(a.stage) : STAGE_ORDER.length;
  const ib = b.stage ? STAGE_ORDER.indexOf(b.stage) : STAGE_ORDER.length;
  return ia - ib;
}

export { TWO_SPEAKER_TYPES };
