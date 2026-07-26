
export enum Level {
  Intro = 'Inicial Absoluto (A0)',
  Beginner = 'Principiante (A1-A2)',
  Intermediate = 'Intermedio (B1-B2)',
  Advanced = 'Avanzado (C1)'
}

export enum AppMode {
  Standard = 'Práctica Estándar',
  Vocabulary = 'Ampliar Vocabulario',
  AccentChallenge = 'Adivina el Acento'
}

// Topic is now just a helper for the AudioPlayer, but the config uses string
export enum TopicEnum {
  Restaurant = 'Restaurante y Comida',
  Accommodation = 'Alojamiento y Hotel',
  Health = 'Médico y Salud',
  Travel = 'Viajes y Transporte',
  Shopping = 'Tiendas y Compras',
  Work = 'Trabajo y Negocios',
  Social = 'Vida Social y Amigos'
}

export enum Length {
  Short = 'Corto (4-6 turnos)',
  Medium = 'Medio (8-12 turnos)',
  Long = 'Largo (14+ turnos)'
}

export enum TextType {
  Dialogue = 'Diálogo (2 personas)',
  PodcastInterview = 'Podcast - Entrevista (2 personas)',
  RadioNews = 'Noticias de Radio (1 persona)',
  Monologue = 'Monólogo / Storytelling (1 persona)'
}

export enum Accent {
  Madrid = 'España - Madrid (Distinción s/z)',
  Andalusia = 'España - Andalucía (Sur)',
  MexicoCity = 'México - CDMX (Chilango)',
  Bogota = 'Colombia - Bogotá (Rolo)',
  Caribbean = 'Caribe - Puerto Rico/Cuba',
  BuenosAires = 'Argentina - Rioplatense',
  Santiago = 'Chile - Santiago',
  Lima = 'Perú - Lima (Ribereño)'
}

export interface Character {
  name: string;
  gender: 'Male' | 'Female';
}

export interface DialogueLine {
  speaker: string;
  text: string;
  emotion?: string;
}

export interface ExerciseOption {
  id: string;
  text: string;
}

/**
 * ETAPA DE ESCUCHA: el momento metodológico que ocupa el ejercicio dentro de la
 * lección. Define CUÁNDO se resuelve y con cuánta información previa.
 */
export type ListeningStage =
  | 'anticipacion'  // antes de reproducir: activa esquemas y léxico previsible
  | 'global'        // 1.ª escucha: tema, propósito, resultado
  | 'selectiva'     // 2.ª escucha: extracción dirigida de información
  | 'intensiva'     // 3.ª escucha: forma exacta, gramática, matiz
  | 'reflexion';    // después: noticing y estrategia

/**
 * HABILIDAD AUDITIVA: la subcompetencia concreta que el ejercicio entrena.
 * Es el eje que faltaba: sin él, un mismo widget servía para tareas de dificultad
 * cognitiva incomparable.
 */
export type ListeningSkill =
  | 'decodificacion'        // discriminar sonidos, cifras, letras, formas parecidas
  | 'segmentacion'          // recuperar límites de palabra en habla encadenada
  | 'reconocimiento_lexico' // identificar palabras conocidas dentro de la cadena
  | 'dato_literal'          // extraer información explícita
  | 'idea_global'           // tema, propósito, resultado, tipo de interacción
  | 'estructura'            // secuencia, organización retórica, cronología
  | 'rol_fuente'            // quién habla, con qué rol, a quién cita
  | 'inferencia'            // puentes, causas, implicaturas
  | 'actitud_postura'       // grado de acuerdo, certeza, ironía
  | 'pragmatica_registro'   // actos de habla, cortesía, formalidad
  | 'lexico_significado'    // significado en contexto
  | 'colocacion_formula'    // chunks, colocaciones, fórmulas rutinarias
  | 'variacion_dialectal'   // rasgos de acento
  | 'estrategia';           // metacognición: qué indicio sirvió

/**
 * FORMATO: la mecánica de respuesta. Todos son sin producción escrita
 * (seleccionar, ordenar, clasificar, desplegables).
 */
export type ExerciseType =
  // Formatos originales
  | 'multiple_choice'
  | 'true_false'
  | 'ordering'
  | 'classification'
  | 'cloze'
  // Formatos nuevos
  | 'true_false_notgiven'  // V / F / NO SE DICE — castiga la sobreinferencia
  | 'matching'             // emparejamiento biyectivo de dos columnas
  | 'scale'                // eje ordinal (termómetro de postura/certeza)
  | 'data_capture'         // ficha de datos con desplegables casi idénticos
  | 'minimal_pairs'        // ¿qué oíste? contrastes fónicos
  | 'spot_the_difference'  // caza el cambio: dictado sin escribir
  | 'chunk_order';         // reconstruir UNA frase por grupos fónicos

/** Campo de una ficha (`data_capture`) o ítem de contraste (`minimal_pairs`). */
export interface ExerciseField {
  id: string;
  label: string;
  options: ExerciseOption[];
}

/** Palabra de un fragmento en `spot_the_difference`. */
export interface ExerciseToken {
  id: string;
  text: string;
}

export interface Exercise {
  id: string;
  type: ExerciseType;
  question: string;

  // --- Metadatos pedagógicos ---
  stage?: ListeningStage;
  skill?: ListeningSkill;
  /** Slot del syllabus que cubre este ejercicio (ver data/listeningSyllabus.ts). */
  slotId?: string;
  /** Índices de los turnos del diálogo en que se apoya; se revelan en el feedback. */
  sourceTurns?: number[];

  // Opciones simples (multiple_choice, ordering, chunk_order)
  options?: ExerciseOption[];

  // Estructuras de tabla (classification, true_false con filas,
  // true_false_notgiven, matching, scale).
  // En `matching` y `scale`, `columns` son respectivamente la columna derecha
  // y los puntos ORDENADOS del eje.
  rows?: ExerciseOption[];
  columns?: ExerciseOption[];

  // Texto con huecos (cloze)
  textWithGaps?: string;
  gapOptions?: Record<string, ExerciseOption[]>;

  // Ficha de datos / pares mínimos
  fields?: ExerciseField[];

  // Caza el cambio
  tokens?: ExerciseToken[];

  // Respuesta polimórfica:
  //  - string                → multiple_choice de respuesta única, true_false simple
  //  - string[]              → multiple_choice múltiple, ordering, chunk_order,
  //                            spot_the_difference (ids de los tokens alterados)
  //  - Record<string,string> → classification, matching, scale, cloze,
  //                            true_false(_notgiven) con filas, data_capture, minimal_pairs
  correctAnswer: string | string[] | Record<string, string>;

  explanation: string;
}

export interface LessonPlan {
  title: string;
  situationDescription: string;
  communicativeFunction: string;
  ambientKeywords?: string; // Keywords in English for ambient noise
  /**
   * A scene id from the closed list in services/ambiencePresets.ts (SceneId).
   *
   * Kept as a plain string because the model can return anything; it is validated
   * with `isSceneId()` before use and ignored if it doesn't match. This is what gives
   * Vocabulary mode, custom topics and AccentChallenge a real ambience — none of them
   * has a scenario label to look up.
   */
  ambientScene?: string;
  characters: Character[];
  dialogue: DialogueLine[];
  /** Lista única ordenada por etapa de escucha (anticipación → … → reflexión). */
  exercises: Exercise[];
}

export interface AppState {
  status: 'auth' | 'idle' | 'generating_plan' | 'generating_audio' | 'ready' | 'error';
  config: {
    mode: AppMode;
    level: Level;
    topic: string; // Changed from Enum to string for flexibility
    length: Length;
    textType: TextType;
    accent: Accent;
  };
  lessonPlan: LessonPlan | null;
  audioBlob: string | null;
  error: string | null;
}
