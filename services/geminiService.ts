
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

// --- CONFIGURATION: PERFILES LINGÜÍSTICOS AVANZADOS ---
const DIALECT_PROFILES: Record<Accent, string> = {
  [Accent.Madrid]: `
    DIALECTO: ESPAÑA - MADRID (CENTRO PENINSULAR).
    [GRAMÁTICA] DISTINCIÓN TÚ/USTED marcada. PLURAL: Vosotros. LEÍSMO DE PERSONA obligatorio ("Le vi"). IMPERATIVO COLOQUIAL ("Venir" por "Venid").
    [PRAGMÁTICA] Intensificadores: "Mazo", "Súper". Muletillas: "En plan", "O sea", "Es que". Honestidad brusca.
    [LÉXICO] "Molar", "Flipar", "Tío/Tronco", "Curro", "Garito", "Coche", "Ordenador", "Piso".
  `,
  [Accent.Andalusia]: `
    DIALECTO: ESPAÑA - ANDALUCÍA (OCCIDENTAL).
    [GRAMÁTICA] Plural 'Ustedes' con verbo en 2ª o 3ª. ELISIÓN de 'd' ("Comío") y apócope ("Pa'", "Na'").
    [PRAGMÁTICA] Cortesía afectuosa ("Mi vida", "Hijo"). Exageración.
    [LÉXICO] "Illo", "Pisha", "Miarma", "Coraje", "No ni ná".
  `,
  [Accent.MexicoCity]: `
    DIALECTO: MÉXICO - CDMX (CHILANGO).
    [GRAMÁTICA] USTEDES único plural. Pretérito Simple preferente. DIMINUTIVOS frecuentes ("Ahorita", "Cafecito").
    [PRAGMÁTICA] Cortesía alta ("¿Qué crees?", "Fíjate que..."). "Mande".
    [LÉXICO] "Güey", "No manches", "Chido/Padre", "Chamba", "¿Qué onda?", "Lana", "Carro", "Celular", "Computadora".
  `,
  [Accent.Bogota]: `
    DIALECTO: COLOMBIA - BOGOTÁ (ROLO).
    [GRAMÁTICA] USTEDEO entre amigos y familia.
    [PRAGMÁTICA] "Regalar" para pedir ("Regáleme una leche"). Suavidad y cortesía ("Qué pena con usted").
    [LÉXICO] "Parce", "Vaina", "Chévere", "Tinto", "Pola", "Harto", "Dar papaya".
  `,
  [Accent.Caribbean]: `
    DIALECTO: CARIBE (PUERTO RICO / CUBA).
    [GRAMÁTICA] NO INVERSIÓN en preguntas ("¿Qué tú quieres?"). Pronombres redundantes ("Yo creo que yo...").
    [FONÉTICA] Aspiración de 's'.
    [LÉXICO] "Boricua", "Pana", "Corillo", "Guagua", "Chavos", "Bochinche", "Janguear", "Brutal".
  `,
  [Accent.BuenosAires]: `
    DIALECTO: ARGENTINA (RIOPLATENSE).
    [GRAMÁTICA] VOSEO ("Vos tenés", "Vení").
    [PRAGMÁTICA] Directos. Intensificador "Re" ("Relindo").
    [LÉXICO] "Che", "Boludo", "Laburo", "Bondi", "Guita", "Mina/Pibe", "Posta", "Viste", "Auto", "Celular".
  `,
  [Accent.Santiago]: `
    DIALECTO: CHILE - SANTIAGO.
    [GRAMÁTICA] VOSEO MIXTO ("Tú estái", "Vos querís"). "Cachái".
    [PRAGMÁTICA] Velocidad rápida. "PO" al final ("Sí po"). "Al tiro".
    [LÉXICO] "Weón", "Bacán", "Fome", "Pololo/a", "Luca", "Carrete".
  `,
  [Accent.Lima]: `
    DIALECTO: PERÚ - LIMA.
    [GRAMÁTICA] Tuteo estándar. "Nomás" pospuesto ("Pasa nomás"). Diminutivos ("Ahorita").
    [PRAGMÁTICA] "Pe" (Pues), "Ya" (Asentimiento).
    [LÉXICO] "Pata/Causa", "Chamba", "Jato", "Chévere", "Piña", "Al toque", "Carro".
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

  if (textPrompt.length > 4000) textPrompt = textPrompt.substring(0, 4000);

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
