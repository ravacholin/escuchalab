
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Level, Length, TextType, Accent, LessonPlan, Character, AppMode } from "../types";

// Helper to get key from storage
const getApiKey = (): string => {
  const key = localStorage.getItem('gemini_api_key');
  if (!key) throw new Error("API Key no encontrada. Por favor, reinicia la app e ingrésala.");
  return key;
};

const GENERATION_MODEL = "gemini-2.5-flash";
const AUDIO_MODEL = "gemini-2.5-flash-preview-tts";

let lastKey = "";
let aiInstance: GoogleGenAI | null = null;

const getAi = () => {
  const key = getApiKey();
  if (key !== lastKey || !aiInstance) {
    lastKey = key;
    aiInstance = new GoogleGenAI({ apiKey: key });
  }
  return aiInstance;
};

// --- HELPERS ---
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 500): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) throw error;
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
  }
  return cleaned;
}

// Sanitize text for TTS to avoid "non-audio response" errors caused by stage directions or formatting
function sanitizeForTTS(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\*\[\]\(\)]/g, '') // Remove * [ ] ( ) characters often used for actions/emotions
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();
}

// --- VALIDATION HELPER ---
const isValidExercise = (ex: any): boolean => {
  if (!ex || !ex.type || !ex.question) return false;

  switch (ex.type) {
    case 'multiple_choice':
      return Array.isArray(ex.options) && ex.options.length >= 2 && !!ex.correctAnswer;
    case 'ordering':
      return Array.isArray(ex.options) && ex.options.length >= 2 && Array.isArray(ex.correctAnswer);
    case 'classification':
      return Array.isArray(ex.rows) && ex.rows.length > 0 &&
        Array.isArray(ex.columns) && ex.columns.length > 0 &&
        typeof ex.correctAnswer === 'object';
    case 'cloze':
      return !!ex.textWithGaps &&
        typeof ex.gapOptions === 'object' &&
        Object.keys(ex.gapOptions).length > 0;
    case 'true_false':
      if (ex.rows) return Array.isArray(ex.rows) && ex.rows.length > 0;
      return true;
    default:
      return false;
  }
};

// --- CONFIGURATION: PERFILES FONÉTICOS TTS (PRONUNCIACIÓN) ---
// Estos perfiles se inyectan como INSTRUCCIÓN al TTS para forzar pronunciación correcta
// IMPORTANTE: Cada perfil debe ser EXHAUSTIVO para garantizar pronunciación correcta
const TTS_PHONETIC_PROFILES: Record<Accent, string> = {
  [Accent.Madrid]: `[VOICE ACTING DIRECTIVE: CASTILIAN SPANISH - MADRID, CENTRAL SPAIN]
You are a native speaker from Madrid, Spain. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- DISTINCIÓN (CRITICAL): "z" and "c" (before e/i) = English "th" as in "think"
  - "zapato" → "thapato", "cielo" → "thielo", "hacer" → "ather"
  - "vez" → "veth", "Barcelona" → "Barthelona", "plaza" → "platha"
- "s" = clear, sharp /s/ sound, NEVER aspirated
- "d" between vowels = soft "th" as in "the" ("cansado" → "cansatho")
- "j" and "g" (before e/i) = strong, guttural, scratchy sound from throat
- "ll" and "y" = "y" as in English "yes" (NOT "sh")
- Final consonants pronounced clearly and crisply

VOWELS:
- Pure, clear vowel sounds
- No diphthongization of single vowels
- Equal stress on each syllable within rhythm

INTONATION & RHYTHM:
- Rising-falling melodic pattern (like a gentle wave)
- Assertive, confident tone
- Moderate speed, very clear articulation
- Slight pause before stressed words for emphasis
- Questions rise sharply at the end

ATTITUDE:
- Direct, matter-of-fact delivery
- Confident without being aggressive`,

  [Accent.Andalusia]: `[VOICE ACTING DIRECTIVE: ANDALUSIAN SPANISH - WESTERN ANDALUSIA, SOUTHERN SPAIN]
You are a native speaker from Seville/Cádiz, Andalusia. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- SESEO (CRITICAL): "z" and "c" (before e/i) = "s" sound, NEVER "th"
  - "zapato" → "sapato", "cielo" → "sielo", "hacer" → "aser"
- ASPIRATION OF S (CRITICAL): Final "s" and "s" before consonants = soft "h" or silent
  - "más" → "máh" or "má", "estos" → "ehtoh" or "etoh"
  - "está" → "ehtá", "espera" → "ehpera"
- DROP FINAL CONSONANTS: Weaken or omit "d", "r", "l" at word endings
  - "Madrid" → "Madrí", "comer" → "comé"
- SOFTEN/DROP INTERVOCALIC "d": "cansado" → "cansao", "comido" → "comío"
- "ll" and "y" = "y" as in English "yes"
- "j" = softer than Castilian, less guttural

VOWELS:
- Slightly more open than standard Spanish
- Vowels may lengthen to compensate for dropped consonants

INTONATION & RHYTHM:
- Fast, flowing, connected speech
- Musical, sing-song quality
- Words blend together smoothly
- Rising intonation even in statements (sounds friendly)
- Speed: Quick tempo, relaxed feel

ATTITUDE:
- Warm, expressive, animated
- Friendly and approachable tone
- Use of affectionate terms naturally`,

  [Accent.MexicoCity]: `[VOICE ACTING DIRECTIVE: MEXICAN SPANISH - MEXICO CITY (CHILANGO)]
You are a native speaker from Mexico City. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- CLEAR S (CRITICAL): All "s" sounds are crisp, clear, fully pronounced
  - NEVER aspirate or drop "s" - pronounce every single one
  - "estos" → "es-tos" (two clear S sounds), "más" → "más" (clear final S)
- "x" in Mexican words = "h" sound (CRITICAL)
  - "México" → "Méhico", "Oaxaca" → "Oahaca", "Xochimilco" → "Sochimilco"
- "ll" and "y" = "y" as in English "yes" (NOT "sh", NOT "j")
- "j" and "g" (before e/i) = softer "h" sound, not as guttural as Spain
- All final consonants clearly pronounced
- "d" between vowels remains as soft "d", not dropped

VOWELS:
- Slightly reduced unstressed vowels
- Clear, standard vowel sounds
- Slight nasal quality on some vowels

INTONATION & RHYTHM:
- Soft, melodic, lilting intonation
- Questions often rise then fall at the end
- Moderate pace, very clear
- Polite, measured delivery
- Statements often end with slight rise (sounds friendly/inviting)

ATTITUDE:
- Polite, courteous, warm
- Use diminutives naturally (cafecito, ahorita, tantito)
- Indirect, gentle manner of speaking`,

  [Accent.Bogota]: `[VOICE ACTING DIRECTIVE: COLOMBIAN SPANISH - BOGOTÁ (ROLO/CACHACO)]
You are a native speaker from Bogotá, Colombia. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- CLEAREST S IN SPANISH (CRITICAL): Pristine, crisp pronunciation of ALL "s" sounds
  - This is considered the most "neutral" Latin American Spanish
  - Every "s" is fully articulated: "estos" → "es-tos", "más" → "más"
- ALL consonants clearly and precisely pronounced
- "ll" and "y" = "y" as in English "yes" (soft, clear)
- "j" and "g" (before e/i) = gentle "h" sound, not harsh
- "d" between vowels = soft but present, not dropped
- Final consonants all articulated

VOWELS:
- Pure, clear, standard vowel sounds
- No reduction of unstressed vowels
- Evenly pronounced

INTONATION & RHYTHM:
- DISTINCTIVE SING-SONG MELODY (CRITICAL)
  - Rises and falls like gentle hills
  - Almost musical quality
- Slow to moderate pace
- Very deliberate, careful articulation
- Soft, gentle overall delivery
- Questions have smooth rising intonation

ATTITUDE:
- Extremely polite and formal
- Soft-spoken, never aggressive
- Use of "usted" frequently, even informally
- Phrases like "con mucho gusto", "a la orden"`,

  [Accent.Caribbean]: `[VOICE ACTING DIRECTIVE: CARIBBEAN SPANISH - PUERTO RICO/CUBA]
You are a native speaker from Puerto Rico or Cuba. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- ASPIRATION OF S (CRITICAL): "s" before consonants or at word end = "h" or silent
  - "está" → "ehtá", "estos" → "ehtoh", "más" → "máh"
  - "espera" → "ehpera", "buscar" → "buhcar"
- R/L CONFUSION (CRITICAL - PUERTO RICO): "r" at end of syllables can become "l"
  - "puerta" → "puelta", "verde" → "velde", "comer" → "comel"
- VELARIZATION OF R (CUBA): Final "r" can sound guttural/French-like
- "ll" and "y" = "y" as in English "yes"
- "rr" (trill) sometimes softer than standard
- Final consonants often weakened or dropped

VOWELS:
- Open, broad vowel sounds
- Vowels may lengthen
- Slightly "rounder" than other variants

INTONATION & RHYTHM:
- HIGHLY RHYTHMIC AND MUSICAL (CRITICAL)
  - African influence creates almost percussion-like rhythm
  - Dance-like cadence
- Fast, energetic delivery
- Strong rises in questions
- Animated, expressive pitch changes
- Words flow together rapidly

ATTITUDE:
- Lively, animated, expressive
- Warm and friendly
- Enthusiastic delivery
- Use of exclamations naturally`,

  [Accent.BuenosAires]: `[VOICE ACTING DIRECTIVE: ARGENTINE SPANISH - BUENOS AIRES (RIOPLATENSE/PORTEÑO)]
You are a native speaker from Buenos Aires, Argentina. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- SHEÍSMO/ZHEÍSMO (MOST CRITICAL RULE - NON-NEGOTIABLE):
  "ll" and "y" MUST be pronounced as "SH" sound (like English "show" or "ship")
  - "yo" → "SHO" (not "yo")
  - "calle" → "CA-SHE" (not "caye")
  - "ella" → "E-SHA" (not "eya")
  - "llamar" → "SHA-MAR" (not "yamar")
  - "llegar" → "SHE-GAR" (not "yegar")
  - "pollo" → "PO-SHO" (not "poyo")
  - "mayo" → "MA-SHO" (not "mayo")
  - "ayer" → "A-SHER" (not "ayer")
  This is the DEFINING feature of Buenos Aires Spanish - NEVER USE "y" SOUND
- ASPIRATION OF S: Final "s" and "s" before consonants often aspirated
  - "estos" → "ehtoh", "más" → "máh"
- "s" between vowels remains clear
- "rr" (trill) is standard
- "j" and "g" (before e/i) = moderate, not too guttural

VOWELS:
- Slightly elongated final vowels
- Open "e" sounds
- Clear vowel articulation

INTONATION & RHYTHM:
- ITALIAN-INFLUENCED MELODY (CRITICAL)
  - Rises and falls dramatically, like singing
  - Very expressive pitch range
  - "Tano" (Italian immigrant) influence
- Theatrical, expressive delivery
- Moderate to slow pace for emphasis
- Strong stress on emphasized words
- Questions have exaggerated rising intonation

ATTITUDE:
- Direct, confident, expressive
- Passionate delivery
- Use of "vos" naturally (vos tenés, vos querés)
- Characteristic phrases: "che", "dale", "viste"`,

  [Accent.Santiago]: `[VOICE ACTING DIRECTIVE: CHILEAN SPANISH - SANTIAGO]
You are a native speaker from Santiago, Chile. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- EXTREME S ASPIRATION (CRITICAL): "s" almost always becomes "h" or disappears
  - "estos" → "ehtoh" or "etoh", "más" → "máh" or "má"
  - "es que" → "eh que", "buscar" → "buhcar" or "bucar"
- SYLLABLE SWALLOWING (CRITICAL): Unstressed syllables often reduced/eaten
  - Words sound "clipped" and shortened
  - "para" → "pa", "nada" → "na", "pues" → "po"
- "ch" = softer than standard, almost like "sh" in some speakers
- "ll" and "y" = "y" as in English "yes"
- Final consonants heavily reduced
- Very fast consonant articulation

VOWELS:
- Reduced, swallowed unstressed vowels
- Quick vowel sounds
- Less clear than other variants

INTONATION & RHYTHM:
- EXTREMELY FAST PACED (CRITICAL)
  - Fastest Spanish variant
  - Words run together
  - Clipped, staccato rhythm
- Rising intonation at phrase endings (like asking)
- "¿Cachái?" pattern at end of statements
- Quick, efficient delivery

CHARACTERISTIC FEATURES:
- "po" at end of phrases → "sí po", "ya po", "no po"
- "cachái" (from "cachas?") meaning "you know?"
- Speed makes individual words hard to distinguish

ATTITUDE:
- Informal, casual, cool
- Fast and efficient
- Heavy use of slang and filler words`,

  [Accent.Lima]: `[VOICE ACTING DIRECTIVE: PERUVIAN SPANISH - LIMA (COSTEÑO)]
You are a native speaker from Lima, Peru. Follow these pronunciation rules EXACTLY:

CONSONANTS:
- CLEAR S PRONUNCIATION (CRITICAL): All "s" sounds fully and clearly pronounced
  - Similar to Colombian Spanish in clarity
  - "estos" → "es-tos", "más" → "más" (never aspirated)
- ALL consonants clearly articulated
- "ll" and "y" = "y" as in English "yes" (soft, standard)
- "j" and "g" (before e/i) = soft "h" sound, gentle
- "rr" (trill) clear but not exaggerated
- "d" between vowels = soft but present
- Final consonants preserved

VOWELS:
- Clear, pure, standard vowels
- Evenly pronounced
- No reduction of unstressed vowels

INTONATION & RHYTHM:
- GENTLE, POLITE MELODY (CRITICAL)
  - Soft, measured, not dramatic
  - Slight sing-song quality
- Moderate to slightly slow pace
- Very clear articulation
- Smooth, flowing delivery
- Questions rise gently

CHARACTERISTIC FEATURES:
- "pe" (from "pues") at end of phrases → "ya pe", "claro pe"
- Use of "nomás" → "pasa nomás", "sigue nomás"
- Muy formal and polite register

ATTITUDE:
- Polite, gentle, respectful
- Conservative pronunciation
- Measured, thoughtful delivery
- Friendly but not overly animated`
};

// --- CONFIGURATION: PERFILES LINGÜÍSTICOS AVANZADOS (GRAMÁTICA/LÉXICO) ---
const DIALECT_PROFILES: Record<Accent, string> = {
  [Accent.Madrid]: `
    DIALECTO: ESPAÑA - MADRID (CENTRO PENINSULAR).
    [FONÉTICA/PROSODIA] Distinción /s/ vs /θ/ (cena/sena). /s/ apicoalveolar marcada. /x/ velar fuerte. Entonación con caída final; preguntas con leve subida y énfasis en la sílaba tónica.
    [GRAMÁTICA] Distinción tú/usted marcada. Plural: vosotros. Leísmo de persona posible ("Le vi"). Uso de "vosotros" en imperativos (venid, sentaos).
    [PRAGMÁTICA] Directo, eficiente y sobrio; cortesía breve. Pausas cortas y ritmo conversacional rápido pero claro.
    [LÉXICO] Base estándar; 1–2 localismos puntuales ("molar", "curro", "coche"). NO depender de argot.
  `,
  [Accent.Andalusia]: `
    DIALECTO: ESPAÑA - ANDALUCÍA (OCCIDENTAL).
    [FONÉTICA/PROSODIA] Aspiración o pérdida de /s/ final y relajación de /d/ intervocálica ("cansao"). Seseo frecuente (a veces ceceo local). Entonación melódica y alargamiento vocálico.
    [GRAMÁTICA] Ustedes como plural frecuente (verbo en 3ª). Apócopes coloquiales ("pa'", "na'") en registro informal.
    [PRAGMÁTICA] Cercanía afectuosa y cálida; ritmo ágil con sonoridad abierta.
    [LÉXICO] Español común con 1–2 marcas leves ("illo", "miarma"). NO depender de argot.
  `,
  [Accent.MexicoCity]: `
    DIALECTO: MÉXICO - CDMX (CHILANGO).
    [FONÉTICA/PROSODIA] Entonación suave con descenso gradual en enunciados. /s/ clara y conservada; /x/ más suave. Ritmo pausado, con vocales bien articuladas.
    [GRAMÁTICA] Ustedes único plural. Diminutivos frecuentes ("cafecito"). Uso de "¿verdad?" como coletilla neutra.
    [PRAGMÁTICA] Cortesía alta y mitigación ("disculpe", "¿me permite?"). "Mande" como respuesta. Evitar rudeza directa.
    [LÉXICO] Español estándar con pocas marcas opcionales ("carro", "computadora", "platicar"). NO depender de argot ni muletillas locales.
  `,
  [Accent.Bogota]: `
    DIALECTO: COLOMBIA - BOGOTÁ (ROLO).
    [FONÉTICA/PROSODIA] Entonación clara y relativamente plana; ritmo silábico regular. /s/ marcada y consonantes nítidas. /x/ suave.
    [GRAMÁTICA] Ustedeo frecuente entre cercanos. Diminutivos moderados.
    [PRAGMÁTICA] Cortesía alta y fórmulas atenuadoras ("qué pena", "con mucho gusto"). Peticiones con "regáleme".
    [LÉXICO] Español general con 1–2 marcas suaves ("tinto", "chévere"). NO depender de argot.
  `,
  [Accent.Caribbean]: `
    DIALECTO: CARIBE (PUERTO RICO / CUBA).
    [FONÉTICA/PROSODIA] Aspiración o pérdida de /s/ final, elisión de /d/ intervocálica. Velarización de /n/ final ("[ŋ]"). Entonación musical y ritmo rápido.
    [GRAMÁTICA] Preguntas sin inversión ocasional ("¿Qué tú quieres?") y redundancia pronominal posible.
    [PRAGMÁTICA] Expresivo, con exclamaciones breves y énfasis; energía alta sin groserías.
    [LÉXICO] Español común con 1–2 marcas suaves ("guagua", "pana"). NO depender de argot.
  `,
  [Accent.BuenosAires]: `
    DIALECTO: ARGENTINA (RIOPLATENSE).
    [FONÉTICA/PROSODIA] Yeísmo rehilado ("sh/zh" en ll/y). Entonación ascendente con fraseo alargado y ritmo conversacional dinámico.
    [GRAMÁTICA] Voseo ("vos tenés", "vení"). Uso de "che" como apelativo puntual.
    [PRAGMÁTICA] Directo y enfático, con marcadores discursivos moderados.
    [LÉXICO] Español estándar con pocas marcas ("che", "bondi" opcional). NO depender de argot.
  `,
  [Accent.Santiago]: `
    DIALECTO: CHILE - SANTIAGO.
    [FONÉTICA/PROSODIA] /s/ final aspirada, consonantes finales relajadas y reducción de sílabas. Ritmo muy rápido con entonación descendente y finales cortos.
    [GRAMÁTICA] Voseo mixto en informal ("tú estái", "vos querís"), tuteo estándar en formal. Uso frecuente de "¿cachái?" en informal.
    [PRAGMÁTICA] Cadencia rápida y elisión en habla casual; en registro formal, claridad y neutralidad.
    [LÉXICO] Español general; 1–2 marcas suaves opcionales ("al tiro", "po"). Evitar "weón" y argot fuerte salvo contexto explícito.
  `,
  [Accent.Lima]: `
    DIALECTO: PERÚ - LIMA.
    [FONÉTICA/PROSODIA] Entonación controlada y menos melodiosa; ritmo pausado con consonantes claras y /s/ conservada. /x/ suave.
    [GRAMÁTICA] Tuteo estándar. "Nomás" pospuesto ("pasa nomás"). Diminutivos moderados.
    [PRAGMÁTICA] Cortesía ligera y respuestas breves ("ya", "claro"); tono amable y calmado.
    [LÉXICO] Español general con 1–2 marcas suaves ("al toque", "chamba"). NO depender de argot.
  `
};

const getExerciseInstructions = (level: Level, mode: AppMode): string => {
  if (mode === AppMode.AccentChallenge) {
    return `MODO: ADIVINA EL ACENTO. Genera 1 ejercicio COMPRENSIÓN (multiple_choice) preguntando "¿De dónde son?" con opciones de países. Genera 1 ejercicio VOCABULARIO (classification) relacionando palabras dialectales con su país.`;
  }
  if (mode === AppMode.Vocabulary) {
    return `MODO: VOCABULARIO INTENSIVO. Genera 1 COMPRENSIÓN (true_false). Genera 3 VOCABULARIO: Definiciones (multiple_choice), Sinonimia (classification), Precisión (cloze).`;
  }

  if (level === Level.Intro) {
    return `NIVEL A0 (REALISTA - "KEYWORD SPOTTING").
      IMPORTANTE: Aunque el audio es rápido y natural, los ejercicios deben basarse en extraer el dato específico que has incluido obligatoriamente.
      
      2 Ejercicios de COMPRENSIÓN (Multiple Choice):
      - Pregunta EXACTA sobre el dato incluido (ej: "¿Qué número de habitación le han dado?", "¿Cuál es el apellido?", "¿A qué hora es la cita?").
      - Opciones distractores deben ser muy parecidas (ej: 304, 314, 403) para forzar la discriminación auditiva.
      
      2 Ejercicios de VOCABULARIO:
      - Relacionar palabras oídas con su significado o completar una frase del texto con la palabra exacta.`;
  }

  if (level.includes('Principiante')) return `NIVEL A1-A2. 2 ejercicios COMPRENSIÓN (Simple recall). 2 ejercicios VOCABULARIO (Match definition).`;
  if (level.includes('Intermedio')) return `NIVEL B1-B2. 2 ejercicios COMPRENSIÓN (Inferencia). 2 ejercicios VOCABULARIO (Sinónimos).`;
  return `NIVEL C1-C2. 2 ejercicios COMPRENSIÓN (Matices/Ironía). 2 ejercicios VOCABULARIO (Jerga/Registro).`;
};

const getRegisterInstruction = (textType: TextType): string => {
  switch (textType) {
    case TextType.RadioNews:
      return `REGISTRO NOTICIERO: Formal, neutro, objetivo e impersonal. Frases completas y tono informativo. PROHIBIDO: lunfardo, jerga, coloquialismos, muletillas, chistes, ironías, insultos o palabras como "weón", "güey", "boludo".`;
    case TextType.PodcastInterview:
      return `REGISTRO PODCAST-ENTREVISTA: Semi-formal y conversacional. Entrevistador con cortesía estándar; entrevistado puede ser cercano pero sin vulgaridades. PERMITIDO: coloquialismos leves y 1–2 expresiones dialectales suaves. PROHIBIDO: lunfardo fuerte, insultos, groserías o exceso de muletillas.`;
    case TextType.Monologue:
      return `REGISTRO MONÓLOGO/STORYTELLING: Narrativo cuidado y coherente. Puede ser cercano si es personal, pero con dicción clara. PERMITIDO: coloquialidad moderada y rasgos dialectales suaves si el contexto lo justifica. PROHIBIDO: jerga fuerte o insultos; no saturar con muletillas.`;
    case TextType.Dialogue:
    default:
      return `REGISTRO DIÁLOGO: Conversación natural entre nativos. Ajusta formalidad según la situación: si hay jerarquía/servicio/trámite, usa trato formal; si es entre pares, registro informal respetuoso. PERMITIDO: coloquialismos y léxico dialectal del acento. EVITA: groserías o lunfardo excesivo salvo que el tema lo exija explícitamente.`;
  }
};

// --- MAIN GENERATOR ---

export const generateLessonPlan = async (
  level: Level,
  topic: string,
  length: Length,
  textType: TextType,
  accent: Accent,
  mode: AppMode
): Promise<LessonPlan> => {

  // DYNAMIC INSTANTIATION WITH STORED KEY
  const ai = getAi();

  let profileInstruction = "";
  let finalTopic = topic;
  let numSpeakers = (textType === TextType.RadioNews || textType === TextType.Monologue) ? 1 : 2;

  // REGLAS ESPECÍFICAS DE NIVEL
  let constraint = "";
  if (level === Level.Intro) {
    // DYNAMIC A0 INJECTION
    const t = topic.toLowerCase();
    let mandatoryInclusion = "";

    if (t.includes("deletrear") || t.includes("apellido") || t.includes("nombre")) {
      mandatoryInclusion = "MANDATORY: One speaker MUST SPELL a name/surname letter by letter (e.g., 'G-A-R-C-I-A'). It must be clear.";
    } else if (t.includes("teléfono") || t.includes("whatsapp")) {
      mandatoryInclusion = "MANDATORY: One speaker MUST dictate a phone number digit by digit (e.g., '6-5-4...').";
    } else if (t.includes("precio") || t.includes("cuenta") || t.includes("cuesta")) {
      mandatoryInclusion = "MANDATORY: Mention specific prices with cents (e.g., '14 euros con 95').";
    } else if (t.includes("dirección") || t.includes("calle")) {
      mandatoryInclusion = "MANDATORY: Mention a specific street name and number.";
    } else if (t.includes("hora") || t.includes("cita")) {
      mandatoryInclusion = "MANDATORY: Mention specific times (e.g., 'A las 5 y media').";
    } else if (t.includes("correo") || t.includes("email")) {
      mandatoryInclusion = "MANDATORY: Dictate an email address using 'arroba', 'punto', 'guion bajo'.";
    }

    constraint = `
      NIVEL A0 (REALISTA - INMERSIÓN TOTAL):
      - Genera un diálogo 100% NATURAL y FLUIDO entre nativos.
      - VELOCIDAD NORMAL. NO hables lento. NO simplifiques las frases. NO limites el vocabulario.
      - ${mandatoryInclusion}
      - El objetivo es que el estudiante capture ese dato específico en un entorno ruidoso/rápido.
      `;
  } else if (level === Level.Beginner) {
    constraint = `NIVEL A1-A2: Frases de longitud media, vocabulario frecuente.`;
  } else {
    constraint = `NIVEL MCER: ${level}. Naturalidad y coherencia con el nivel.`;
  }


  if (mode === AppMode.AccentChallenge) {
    const allAccents = Object.values(Accent);
    const shuffled = allAccents.sort(() => 0.5 - Math.random());
    const accent1 = shuffled[0];
    const accent2 = shuffled[1];

    profileInstruction = `
      RETO DE ACENTOS. IGNORA ACENTO SELECCIONADO.
      HABLANTE A: ${DIALECT_PROFILES[accent1]}. HABLANTE B: ${DIALECT_PROFILES[accent2]}.
      Tema: Choque cultural/léxico.
      PROTOCOLO ANTI-SPOILER: Título misterioso. Descripción neutra. NO mencionar países en metadatos.
      `;
    finalTopic = "Encuentro cultural / Confusión de palabras";
    numSpeakers = 2;

  } else if (mode === AppMode.Vocabulary) {
    const baseProfile = DIALECT_PROFILES[accent];
    profileInstruction = `${baseProfile}. OBJETIVO: DENSIDAD LÉXICA ALTA sobre "${topic}". AMBOS HABLANTES USAN ESTE ACENTO.`;

  } else {
    const baseProfile = DIALECT_PROFILES[accent];
    profileInstruction = `${baseProfile}. CONSISTENCIA: AMBOS HABLANTES SON NATIVOS DE ESTA REGIÓN. Prohibido mezclar con neutro.`;
  }

  const exerciseLogic = getExerciseInstructions(level, mode);
  const registerInstruction = getRegisterInstruction(textType);

  const jsonStructure = `
  {
    "title": "String",
    "situationDescription": "String",
    "communicativeFunction": "String",
    "ambientKeywords": "String",
    "characters": [{ "name": "String", "gender": "Male" | "Female" }],
    "dialogue": [{ "speaker": "String", "text": "String", "emotion": "String" }],
    "exercises": {
      "comprehension": [
        { "id": "ex_c1", "type": "multiple_choice", "question": "...", "options": [{ "id": "o1", "text": "..." }], "correctAnswer": "o1", "explanation": "..." }
      ],
      "vocabulary": []
    }
  }
  `;

  const lengthInstruction = (level === Level.Intro) ? "Longitud: Natural y fluida, ignorando límites estrictos de turnos si corta la naturalidad." : `Longitud: ${length}.`;

  // Auto-retry loop for multi-speaker validation
  const MAX_SPEAKER_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_SPEAKER_RETRIES; attempt++) {
    // Strengthen constraint on retry attempts
    const speakerEmphasis = attempt > 1
      ? `⚠️ REINTENTO ${attempt}/${MAX_SPEAKER_RETRIES}: DETECCIÓN PREVIA DE MÁS DE 2 PERSONAJES. ESTO ES ABSOLUTAMENTE CRÍTICO - USA SOLO ${numSpeakers} ${numSpeakers === 1 ? 'PERSONAJE' : 'PERSONAJES'}. NO AGREGUES PERSONAJES SECUNDARIOS, MESEROS, RECEPCIONISTAS, ETC.`
      : `CRITICAL: El diálogo debe tener EXACTAMENTE ${numSpeakers} ${numSpeakers === 1 ? 'PERSONAJE' : 'PERSONAJES'} hablando. NUNCA más de 2 personajes. El sistema TTS solo soporta máximo 2 voces.`;

    const prompt = `
  JSON Lesson (Spanish). Modo: ${mode}. Nivel: ${level}. Tema: ${finalTopic}. Accent: ${accent}.

  CONTEXT: ${profileInstruction}
  RULES: ${constraint}
  REGISTER: ${registerInstruction}
  SPEAKERS: ${speakerEmphasis}
  EXERCISES: ${exerciseLogic}
  LENGTH: STICK TO ${length}.
  AMBIENT: Generate "ambientKeywords" (3 keywords).

  Structure: ${jsonStructure}
  `;

    try {
      const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: GENERATION_MODEL,
        contents: prompt,
        config: {
          systemInstruction: "Expert Spanish Linguist. Minimalist JSON response only.",
          responseMimeType: "application/json",
          temperature: 0.0,
        },
      }));

      if (!response.text) throw new Error("API devolvió vacío");
      const jsonStr = cleanJsonString(response.text);
      const plan = JSON.parse(jsonStr) as LessonPlan;

      if (!plan.dialogue) plan.dialogue = [];
      if (!plan.exercises) plan.exercises = { comprehension: [], vocabulary: [] };

      // Validate speaker count
      const uniqueSpeakers = new Set(plan.dialogue.map(d => d.speaker?.trim()).filter(Boolean));
      if (uniqueSpeakers.size > 2) {
        console.warn(`[Attempt ${attempt}/${MAX_SPEAKER_RETRIES}] Detected ${uniqueSpeakers.size} speakers: ${Array.from(uniqueSpeakers).join(', ')}. Retrying...`);

        // If this was the last attempt, throw error
        if (attempt === MAX_SPEAKER_RETRIES) {
          throw new Error(`El sistema no pudo generar un diálogo con máximo 2 personajes después de ${MAX_SPEAKER_RETRIES} intentos.`);
        }

        // Otherwise, continue to next iteration (retry)
        continue;
      }

      // Success! Validate exercises and return
      if (plan.exercises.comprehension) plan.exercises.comprehension = plan.exercises.comprehension.filter(isValidExercise);
      if (plan.exercises.vocabulary) plan.exercises.vocabulary = plan.exercises.vocabulary.filter(isValidExercise);

      if (attempt > 1) {
        console.log(`[Success] Generated valid dialogue on attempt ${attempt}/${MAX_SPEAKER_RETRIES}`);
      }

      return plan;
    } catch (error: any) {
      // If it's a non-speaker-related error or last attempt, throw immediately
      if (!error.message?.includes('personajes') || attempt === MAX_SPEAKER_RETRIES) {
        console.error("Error generando plan:", error);
        throw new Error(`Error GenAI: ${error.message}`);
      }
      // Otherwise, this catch is just for unexpected errors during generation, continue retry loop
    }
  }

  // Should never reach here due to throw in loop, but TypeScript needs this
  throw new Error("Error inesperado en generación de lección");
};

export const generateAudio = async (
  dialogue: LessonPlan['dialogue'],
  characters: Character[],
  accent: Accent
): Promise<string> => {
  // DYNAMIC INSTANTIATION WITH STORED KEY
  const ai = getAi();

  if (!dialogue || dialogue.length === 0) return "";

  const speakerCounts: Record<string, number> = {};
  dialogue.forEach(d => {
    if (d.speaker) speakerCounts[d.speaker.trim()] = (speakerCounts[d.speaker.trim()] || 0) + 1;
  });

  const sortedSpeakers = Object.keys(speakerCounts).sort((a, b) => speakerCounts[b] - speakerCounts[a]);
  if (sortedSpeakers.length === 0) return "";

  const isMultiSpeaker = sortedSpeakers.length >= 2;
  let speechConfig;
  let textPrompt = "";

  if (isMultiSpeaker) {
    const s1 = sortedSpeakers[0];
    const s2 = sortedSpeakers[1];

    const getVoice = (name: string, defaultVoice: string) => {
      const char = characters.find(c => c.name === name || name.includes(c.name));
      return char?.gender === 'Female' ? 'Kore' : (char?.gender === 'Male' ? 'Fenrir' : defaultVoice);
    };

    // Use actual speaker names directly (not internal mapping)
    speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: s1,
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: getVoice(s1, 'Fenrir') }
            }
          },
          {
            speaker: s2,
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: getVoice(s2, 'Kore') }
            }
          }
        ]
      }
    };

    textPrompt = dialogue
      .filter(d => d.speaker && (d.speaker.includes(s1) || d.speaker.includes(s2) || s1.includes(d.speaker) || s2.includes(d.speaker)))
      .map(d => {
        const cleanText = sanitizeForTTS(d.text);
        if (!cleanText) return null;
        return `${d.speaker}: ${cleanText}`;
      })
      .filter(Boolean) // Remove nulls
      .join('\n');

  } else {
    // Single Speaker Logic
    const s1 = sortedSpeakers[0];
    const char = characters.find(c => c.name === s1 || s1.includes(c.name));

    speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: char?.gender === 'Female' ? 'Kore' : 'Puck'
        }
      }
    };

    textPrompt = dialogue
      .map(d => sanitizeForTTS(d.text))
      .filter(t => t.length > 0)
      .join('\n\n');
  }

  // Final validation before sending
  if (textPrompt.length === 0) {
    throw new Error("No hay texto válido para generar audio.");
  }

  // --- CRITICAL: INJECT PHONETIC PRONUNCIATION INSTRUCTIONS ---
  // This is the "bulletproof" accent system - we prepend pronunciation rules
  // so the TTS model knows exactly how to pronounce each dialect
  const phoneticProfile = TTS_PHONETIC_PROFILES[accent];
  if (phoneticProfile) {
    // Prepend the pronunciation instructions as a system-level directive
    textPrompt = `${phoneticProfile}\n\n---BEGIN DIALOGUE---\n\n${textPrompt}`;
  }

  // Ensure we don't exceed TTS limits (accounting for the added instructions)
  if (textPrompt.length > 5000) textPrompt = textPrompt.substring(0, 5000);

  try {
    console.log(`[TTS] Generating audio with ${isMultiSpeaker ? 'multi-speaker' : 'single-speaker'} config...`);
    const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: AUDIO_MODEL,
      contents: [{ parts: [{ text: textPrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: speechConfig
      }
    }));

    console.log('[TTS] Response received, checking for audio data...');

    // Check if we actually got audio data
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      console.error('[TTS] No audio data in response. Response structure:', JSON.stringify(response, null, 2));
      throw new Error("El modelo no devolvió datos de audio. Verifica la configuración o intenta de nuevo.");
    }

    console.log('[TTS] Audio generation successful');
    return audioData;
  } catch (error: any) {
    console.error("Audio Gen Error:", error);
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      stack: error.stack
    });

    // Extract meaningful message from API error if possible
    let msg = error.message || "Error desconocido";
    if (msg.includes("non-audio response") || msg.includes("INVALID_ARGUMENT")) {
      msg = "El modelo de audio rechazó el contenido del diálogo.";
    } else if (msg.includes("timeout") || msg.includes("DEADLINE_EXCEEDED")) {
      msg = "Tiempo de espera agotado. El audio puede ser muy largo, intenta reducir la longitud.";
    }
    throw new Error(`Error TTS: ${msg}`);
  }
};
