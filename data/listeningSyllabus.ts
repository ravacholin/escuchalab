import { AppMode, ExerciseOption, ExerciseType, Level, ListeningSkill, ListeningStage, TextType } from '@/types';
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
  /** Instrucción concreta ya resuelta para el tipo de audio. */
  brief: string;
  engineFallback?: EngineId;
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
  /** El slot gira alrededor del dato obligatorio: recibe `focus` y interpolación. */
  focusOnDataPoint?: boolean;
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
  const { briefByTextType, focusOnDataPoint, ...rest } = template;
  const brief = briefByTextType?.[textType] ?? template.brief;
  return {
    ...rest,
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

const A0_SLOTS: SlotTemplate[] = [
  {
    slotId: 'a0-global',
    stage: 'global',
    skill: 'idea_global',
    format: 'multiple_choice',
    items: 3,
    brief:
      '¿Dónde ocurre? 3 opciones de 1 o 2 palabras, todas lugares posibles del mismo tipo de situación. Nada de inferencia: debe resolverse por ruidos, saludos o una palabra clave.',
    briefByTextType: {
      [TextType.RadioNews]:
        '¿De qué trata la noticia? 3 opciones de 1 a 3 palabras (el tema, no el detalle).',
      [TextType.Monologue]:
        '¿De qué habla la persona? 3 opciones de 1 a 3 palabras.',
      [TextType.PodcastInterview]:
        '¿De qué hablan? 3 opciones de 1 a 3 palabras.'
    }
  },
  {
    slotId: 'a0-ficha',
    stage: 'selectiva',
    skill: 'dato_literal',
    format: 'data_capture',
    items: 3,
    engineFallback: 'data_capture',
    focusOnDataPoint: true,
    brief:
      'Ficha de datos de la situación con 3 campos. Es EL ejercicio del nivel. El campo obligatorio se llama "{{campo}}" y recoge {{dato}}, exactamente como suena en el audio. Los otros dos campos son datos concretos secundarios de la misma situación (una cifra, una hora, un nombre). Las opciones de cada campo se diferencian en un solo elemento y suenan casi igual, y el valor correcto se dice literalmente.',
    briefByTextType: {
      [TextType.RadioNews]:
        'Ficha con 3 campos sobre los datos concretos del boletín. El campo obligatorio se llama "{{campo}}" y recoge {{dato}}, exactamente como suena. Las opciones de cada campo se diferencian en un solo elemento y suenan casi igual.'
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
// Son CINCO ejercicios. Antes eran nueve (≈36 respuestas) y acumulaban en la
// misma lección un emparejamiento 4×4, un caza-el-cambio de 4 alteraciones sobre
// una frase de 20 palabras y una reconstrucción por grupos fónicos: tres
// mecánicas exigentes seguidas, y ninguna captura de datos, que es justamente lo
// que este nivel todavía necesita consolidar. `matching` y
// `spot_the_difference` siguen usándose en el modo Vocabulario y en B1+.

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
    slotId: 'a2-secuencia',
    stage: 'selectiva',
    skill: 'estructura',
    format: 'ordering',
    items: 4,
    brief:
      '4 ACCIONES parafraseadas (no turnos literales), tomadas de puntos separados del diálogo y cubriendo principio, medio y final.',
    briefByTextType: {
      [TextType.RadioNews]:
        '4 hechos de la noticia parafraseados, en el orden en que se mencionan.',
      [TextType.Monologue]:
        '4 acontecimientos del relato en el ORDEN CRONOLÓGICO REAL en que ocurrieron, que puede no coincidir con el orden en que se cuentan.',
      [TextType.PodcastInterview]:
        '4 asuntos que se tratan, en el orden en que aparecen en la entrevista.'
    }
  },
  {
    slotId: 'a2-datos',
    stage: 'selectiva',
    skill: 'dato_literal',
    format: 'data_capture',
    items: 3,
    engineFallback: 'data_capture',
    focusOnDataPoint: true,
    brief:
      'Ficha con 3 campos de la situación (una comanda, una reserva, una ficha de cliente). Uno de los campos se llama "{{campo}}" y recoge {{dato}}. Las opciones de cada campo se diferencian en un solo elemento y suenan casi igual ("14,95" / "40,95" / "14,55"), y el valor correcto se dice literalmente en el audio.',
    briefByTextType: {
      [TextType.RadioNews]:
        'Ficha con 3 campos sobre los datos duros del boletín (cifra, fecha, lugar). Uno de los campos se llama "{{campo}}" y recoge {{dato}}. Las opciones de cada campo se diferencian en un solo elemento y suenan casi igual.',
      [TextType.Monologue]:
        'Ficha con 3 campos sobre los datos concretos del relato (cuándo, cuánto, dónde). Uno de los campos se llama "{{campo}}" y recoge {{dato}}. Las opciones de cada campo se diferencian en un solo elemento y suenan casi igual.'
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
    engineFallback: 'two_gap_cloze',
    brief:
      'Frase del audio con 2 huecos que caigan sobre una FÓRMULA rutinaria de la situación ("¿me pone…?", "¿cuánto le debo?", "un momentito"). Las 3 opciones de cada hueco son fórmulas del mismo tipo, todas gramaticales en ese lugar.'
  }
];

// ---------------------------------------------------------------------------
// NIVEL B1-B2 — Intermedio
// ---------------------------------------------------------------------------
// El salto real es dejar de premiar el reconocimiento literal. Aquí manda la
// inferencia puente, la distinción entre lo contradicho y lo no dicho, y la
// gradación de la actitud.

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
    slotId: 'b-estructura',
    stage: 'global',
    skill: 'estructura',
    format: 'ordering',
    items: 5,
    brief:
      'Ordena los 5 movimientos de la negociación (planteamiento, objeción, propuesta, ajuste, cierre) parafraseados en una línea cada uno.',
    briefByTextType: {
      [TextType.RadioNews]:
        'Ordena 5 elementos del boletín según la PIRÁMIDE INVERTIDA, de lo más informativo a lo más secundario. NO es orden cronológico.',
      [TextType.Monologue]:
        'Ordena 5 sucesos según ocurrieron REALMENTE, no según el orden en que se narran. Incluye al menos un salto atrás en el relato.',
      [TextType.PodcastInterview]:
        'Ordena las 5 fases de la conversación (apertura, pregunta central, matización, ejemplo, cierre).'
    }
  },
  {
    slotId: 'b-relaciones',
    stage: 'selectiva',
    skill: 'inferencia',
    format: 'matching',
    items: 4,
    brief:
      'Empareja los 4 problemas u obstáculos que aparecen con las 4 respuestas o soluciones que se dan. Biyectivo y sin descartes triviales.',
    briefByTextType: {
      [TextType.PodcastInterview]:
        'Empareja 4 afirmaciones del entrevistado con la evidencia o el ejemplo con que las apoya.',
      [TextType.RadioNews]:
        'Empareja 4 datos con su FUENTE ("según…", "fuentes de…"). Si el boletín no atribuye cuatro veces, empareja cada dato con la función que cumple en la noticia.',
      [TextType.Monologue]:
        'Empareja 4 causas con sus consecuencias dentro del relato.'
    }
  },
  {
    slotId: 'b-vfns',
    stage: 'intensiva',
    skill: 'inferencia',
    format: 'true_false_notgiven',
    items: 5,
    brief:
      '5 afirmaciones: 2 verdaderas (al menos una que solo se obtenga por inferencia puente, no literal), 2 falsas contradichas explícitamente y 1 de NO SE DICE que sea muy tentadora.'
  },
  {
    slotId: 'b-actitud',
    stage: 'intensiva',
    skill: 'actitud_postura',
    format: 'scale',
    items: 4,
    brief:
      'Eje ordinal de 4 puntos sobre el grado de acuerdo o disposición ("lo rechaza" → "duda" → "acepta con reservas" → "acepta sin reservas"). Las filas son 4 citas textuales del audio.'
  },
  {
    slotId: 'b-caza-cambio',
    stage: 'intensiva',
    skill: 'segmentacion',
    format: 'spot_the_difference',
    items: 4,
    engineFallback: 'spot_the_difference',
    brief:
      'Oración del audio de 15 a 25 palabras con 4 alteraciones GRAMATICALES, no léxicas obvias: tiempo o modo verbal, pronombre clítico, preposición regida o concordancia. La frase alterada debe seguir siendo perfectamente gramatical.'
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
    slotId: 'b-precision',
    stage: 'intensiva',
    skill: 'lexico_significado',
    format: 'classification',
    items: 6,
    brief:
      '6 palabras o expresiones del audio; 3 columnas con matices de significado próximos entre sí. Cada palabra se clasifica por el sentido que tiene EN ESTE audio, no por su sentido más común.'
  },
  {
    slotId: 'b-reflexion',
    stage: 'reflexion',
    skill: 'estrategia',
    format: 'multiple_choice',
    items: 3,
    brief:
      '¿Qué indicio concreto del audio permitía deducir la intención real? 3 opciones que citen material verificable (una palabra concreta, una pausa, una repetición, un cambio de tono).'
  }
];

// ---------------------------------------------------------------------------
// NIVEL C1 — Avanzado
// ---------------------------------------------------------------------------
// Subtexto, atenuación y organización retórica. Nada de reconocimiento literal
// ni de definiciones: todo se juega en el matiz y en lo que NO se dice.

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
    items: 5,
    brief:
      'Ordena 5 movimientos ARGUMENTATIVOS según aparecen (concesión, objeción, ejemplo, reformulación, conclusión), descritos por su función y no por su contenido.'
  },
  {
    slotId: 'c1-concesiones',
    stage: 'selectiva',
    skill: 'actitud_postura',
    format: 'classification',
    items: 6,
    brief:
      '6 asuntos mencionados; columnas: "lo concede", "lo matiza", "lo rechaza", "lo elude". Cada asignación debe apoyarse en una marca verbal concreta del audio.'
  },
  {
    slotId: 'c1-vfns',
    stage: 'intensiva',
    skill: 'inferencia',
    format: 'true_false_notgiven',
    items: 5,
    brief:
      '5 afirmaciones que incluyan al menos una implicatura conversacional y una ironía. Una debe ser NO SE DICE y tiene que ser la más tentadora de todas.'
  },
  {
    slotId: 'c1-compromiso',
    stage: 'intensiva',
    skill: 'actitud_postura',
    format: 'scale',
    items: 4,
    brief:
      'Eje ordinal de 4 puntos sobre el grado de compromiso del hablante con lo que afirma ("lo descarta" → "lo ve improbable" → "lo admite como posible" → "lo afirma sin reservas"). Las 4 filas son citas textuales con atenuación o matización.'
  },
  {
    slotId: 'c1-caza-cambio',
    stage: 'intensiva',
    skill: 'segmentacion',
    format: 'spot_the_difference',
    items: 4,
    engineFallback: 'spot_the_difference',
    brief:
      'Oración del audio con 4 alteraciones MORFOSINTÁCTICAS mínimas que cambien el sentido sin romper la gramática: "se lo dije" / "se los dije", indicativo / subjuntivo, ser / estar, orden de clíticos, "sino" / "si no", pretérito / imperfecto.'
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
    slotId: 'c1-matiz',
    stage: 'intensiva',
    skill: 'lexico_significado',
    format: 'matching',
    items: 4,
    brief:
      'Empareja 4 expresiones del audio con la paráfrasis que capta su matiz exacto. Las 4 paráfrasis deben ser muy próximas entre sí, de modo que la elección dependa del contexto oído.'
  },
  {
    slotId: 'c1-registro',
    stage: 'intensiva',
    skill: 'pragmatica_registro',
    format: 'classification',
    items: 6,
    brief:
      '6 fragmentos del audio; 3 columnas de registro o tono. Cada clasificación tiene que justificarse por una marca concreta (tratamiento, elección léxica, atenuación, elipsis). ATENCIÓN: "gracias", "por favor" y "buenos días" son NEUTROS y aparecen en cualquier registro; no los uses como prueba de formalidad. Tampoco confundas marca DIALECTAL ("che", "po", "vale") con marca de registro.'
  },
  {
    slotId: 'c1-reflexion',
    stage: 'reflexion',
    skill: 'estrategia',
    format: 'multiple_choice',
    items: 3,
    brief:
      '¿Qué señal delató la ironía o la reticencia? 3 opciones que citen material verificable del audio (una elección léxica, una pausa, un cambio de registro, una repetición).'
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
      items: 5,
      engineFallback: 'minimal_pairs',
      brief:
        '5 ítems con la FORMA SONORA de las palabras clave del tema: en cada uno, la palabra real del audio frente a otra que suena casi igual.'
    },
    {
      slotId: 'voc-a0-caza',
      stage: 'selectiva',
      skill: 'reconocimiento_lexico',
      format: 'multiple_choice',
      items: 6,
      engineFallback: 'select_all_heard',
      brief:
        '6 palabras del campo temático escritas correctamente; 3 aparecen literalmente en el audio y 3 no, y los distractores deben parecerse fonéticamente a las que sí suenan.'
    },
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
      items: 5,
      brief:
        'Empareja 5 palabras o expresiones del audio con su significado en contexto, en paráfrasis cortas y concretas.'
    },
    {
      slotId: 'voc-a2-campos',
      stage: 'selectiva',
      skill: 'lexico_significado',
      format: 'classification',
      items: 6,
      brief:
        '6 palabras del audio en 2 o 3 campos temáticos CONCRETOS de la situación (por ejemplo "lo que se pide" / "lo que se paga" / "lo que se agradece"). Nada de "formal" ni "informal": esa distinción es de B1 en adelante.'
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
    },
    {
      slotId: 'voc-a2-cambio',
      stage: 'intensiva',
      skill: 'segmentacion',
      format: 'spot_the_difference',
      items: 4,
      engineFallback: 'spot_the_difference',
      brief:
        'Oración del audio con 4 palabras del campo léxico cambiadas por otras del mismo campo.'
    }
  ],
  [Level.Intermediate]: [
    {
      slotId: 'voc-b-colocacion',
      stage: 'selectiva',
      skill: 'colocacion_formula',
      format: 'matching',
      items: 5,
      brief:
        'Empareja 5 verbos del audio con el complemento con el que aparecieron realmente. Todos los complementos deben ser combinables con más de un verbo.'
    },
    {
      slotId: 'voc-b-precision',
      stage: 'intensiva',
      skill: 'lexico_significado',
      format: 'classification',
      items: 6,
      brief:
        '6 palabras del audio en 3 columnas de matiz próximo, clasificadas por el sentido que tienen EN ESTE audio.'
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
      items: 5,
      brief:
        '5 afirmaciones sobre el USO de expresiones del audio (qué implican, cuándo se dicen). Una debe ser NO SE DICE.'
    }
  ],
  [Level.Advanced]: [
    {
      slotId: 'voc-c1-matiz',
      stage: 'selectiva',
      skill: 'lexico_significado',
      format: 'matching',
      items: 5,
      brief:
        'Empareja 5 expresiones del audio con la paráfrasis que capta su matiz exacto; las paráfrasis deben ser casi sinónimas entre sí.'
    },
    {
      slotId: 'voc-c1-connotacion',
      stage: 'intensiva',
      skill: 'actitud_postura',
      format: 'scale',
      items: 4,
      brief:
        'Eje ordinal de 4 puntos sobre la carga valorativa con que el hablante usa 4 expresiones ("claramente peyorativo" → "crítico y atenuado" → "neutro" → "abiertamente elogioso").'
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
      items: 6,
      brief:
        '6 expresiones del audio en 3 columnas de registro, cada una justificable por una marca concreta. No uses "gracias" ni "por favor" como prueba de formalidad, ni confundas marca dialectal con registro.'
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
            items: 6,
            brief:
              'Antes de escuchar. 6 rasgos observables descritos SIN nombrar países ("pronuncia la c de cinco como z", "usa vos en vez de tú", "aspira la s final"). El alumno marca los que cree que va a oír; "correctAnswer" es el array de los que efectivamente aparecen.'
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
            items: 6,
            brief:
              '6 palabras o expresiones DIALECTALES realmente dichas en el audio; 2 columnas, una por hablante, identificadas como "Hablante A" y "Hablante B" sin revelar el país.'
          }
        ]),
    {
      slotId: 'acc-origen-a',
      stage: 'selectiva',
      skill: 'variacion_dialectal',
      format: 'multiple_choice',
      items: 4,
      brief:
        '¿De dónde es el HABLANTE A? 4 opciones de países o ciudades hispanohablantes.'
    },
    {
      slotId: 'acc-origen-b',
      stage: 'selectiva',
      skill: 'variacion_dialectal',
      format: 'multiple_choice',
      items: 4,
      brief:
        '¿De dónde es el HABLANTE B? 4 opciones de países o ciudades hispanohablantes, distintas de la respuesta anterior.'
    },
    // El desglose gramatical fino solo se sostiene si el alumno ya maneja la
    // lengua: en A0/A1 sería metalenguaje sin anclaje.
    ...(isLow
      ? []
      : [
          {
            slotId: 'acc-rasgos',
            stage: 'intensiva' as const,
            skill: 'variacion_dialectal' as const,
            format: 'classification' as const,
            items: 6,
            brief:
              '6 rasgos fonéticos o gramaticales concretos (distinción c/z frente a seseo, aspiración de s final, yeísmo rehilado, voseo verbal, ustedes frente a vosotros, diminutivos); 2 columnas: "Hablante A" y "Hablante B".'
          }
        ]),
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
  dataPoint?: DataPointKind
): ExerciseSlot[] {
  let templates: SlotTemplate[];

  if (mode === AppMode.AccentChallenge) {
    // El reto de acentos siempre genera dos hablantes en diálogo.
    templates = accentSlots(level);
    textType = TextType.Dialogue;
  } else if (mode === AppMode.Vocabulary) {
    // Se conserva la entrada en la lección (anticipación + idea global) del nivel
    // y se sustituye el resto por el trabajo léxico propio del nivel.
    const levelTemplates = LEVEL_SLOTS[level] ?? LEVEL_SLOTS[Level.Beginner];
    const opening = levelTemplates.filter(
      slot => slot.stage === 'anticipacion' || slot.stage === 'global'
    );
    const closing = levelTemplates.filter(slot => slot.stage === 'reflexion');
    templates = [...opening, ...(VOCABULARY_SLOTS[level] ?? []), ...closing];
  } else {
    templates = LEVEL_SLOTS[level] ?? LEVEL_SLOTS[Level.Beginner];
  }

  const singleSpeaker = textType === TextType.RadioNews || textType === TextType.Monologue;

  const seen = new Set<string>();
  return templates
    .filter(slot => isFormatAllowed(slot.format, level, textType))
    .filter(slot => !(singleSpeaker && slot.requiresTwoSpeakers))
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
