import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Level, Length, TextType, Accent, LessonPlan, Character, AppMode } from "../types";

const apiKey = process.env.API_KEY;
if (!apiKey) console.error("Falta API_KEY");

const ai = new GoogleGenAI({ apiKey: apiKey || '' });

const GENERATION_MODEL = "gemini-2.5-flash";
const AUDIO_MODEL = "gemini-2.5-flash-preview-tts";

// --- HELPERS ---
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
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
// Se incluyen instrucciones explícitas de Gramática, Léxico y Pragmática para cada variante.

const DIALECT_PROFILES: Record<Accent, string> = {
  [Accent.Madrid]: `
    DIALECTO: ESPAÑA - MADRID (CENTRO PENINSULAR).
    
    [GRAMÁTICA Y MORFOLOGÍA]
    - DISTINCIÓN TÚ/USTED: Marcada. 'Tú' generalizado hasta los 40-50 años. 'Usted' solo en jerarquía muy clara.
    - PLURAL: Estrictamente 'Vosotros' (Informal) vs 'Ustedes' (Formal).
    - LEÍSMO DE PERSONA (OBLIGATORIO): Usa "Le vi" (a él) en vez de "Lo vi". "Les dije".
    - IMPERATIVO COLOQUIAL: Uso del infinitivo por imperativo en plural ("¡Venir aquí!" en vez de "¡Venid!").
    
    [PRAGMÁTICA Y MARCADORES]
    - INTENSIFICADORES: "Mazo" (muy/mucho), "Súper" (súper bien).
    - MULETILLAS: "En plan" (usar máx 2 veces), "O sea", "¿Sabes?", "Es que..." (pronunciado 'Ejque').
    - HONESTIDAD BRUSCA: Tienden a ser directos, suenan menos "suaves" que los latinos.

    [LÉXICO]
    - INFORMAL: "Molar" (gustar), "Flipar" (alucinar), "Tío/Tronco" (amigo), "Curro" (trabajo), "Garito" (bar).
    - FORMAL: Estándar peninsular (Coche, Ordenador, DNI, Piso, Zumo).
  `,
  
  [Accent.Andalusia]: `
    DIALECTO: ESPAÑA - ANDALUCÍA (OCCIDENTAL/SEVILLA/CÁDIZ).
    
    [GRAMÁTICA Y FONÉTICA ESCRITA]
    - PLURAL: Preferencia por 'Ustedes' con verbo en 2ª persona ("Ustedes sois") o 3ª ("Ustedes son").
    - ELISIÓN (Simular ritmo rápido):
      * Pérdida de 'd' intervocálica: "Comío" (Comido), "Cansao" (Cansado), "La'o" (Lado).
      * Apócope: "Pa'" (Para), "Na'" (Nada), "To'" (Todo).
    
    [PRAGMÁTICA]
    - CORTESÍA: Muy afectuosa incluso con desconocidos ("Mi vida", "Corazón", "Hijo/a").
    - EXAGERACIÓN: Uso frecuente de hipérboles.

    [LÉXICO]
    - INFORMAL: "Illo" (Quillo/Chico - muy frecuente), "Pisha" (Cádiz), "Miarma" (Sevilla), "Coraje" (dar rabia), "No ni ná" (afirmación enfática).
    - FORMAL: Léxico peninsular estándar pero manteniendo la construcción sintáctica suave.
  `,

  [Accent.MexicoCity]: `
    DIALECTO: MÉXICO - CDMX (CHILANGO).
    
    [GRAMÁTICA]
    - USTEDES: Único plural.
    - TIEMPOS: Preferencia absoluta por Pretérito Simple ("Llegué") frente al Compuesto ("He llegado").
    - DIMINUTIVOS (PRAGMÁTICA CLAVE): Úsalos para suavizar órdenes o tiempos. "Ahorita", "Un cafecito", "Despacito".
    
    [PRAGMÁTICA]
    - CORTESÍA: Muy alta. Evita el "No" directo. Usa "¿Qué crees?" o "Fíjate que..." para dar malas noticias.
    - "MANDE": Respuesta automática a "¿Qué?" o cuando no se escucha algo.

    [LÉXICO]
    - INFORMAL: "Güey" (omnipresente entre amigos), "No manches/No mames" (sorpresa), "Chido/Padre" (bueno), "Chamba" (trabajo), "¿Qué onda?", "Lana" (dinero).
    - FORMAL: "Disculpe", "Joven", "Señorita". Vocabulario: Carro, Celular, Computadora, Departamento, Alberca (piscina).
  `,

  [Accent.Bogota]: `
    DIALECTO: COLOMBIA - BOGOTÁ (ROLO).
    
    [GRAMÁTICA - EL "USTEDEO" BOGOTANO]
    - REGLA DE ORO: En Bogotá, hombres y mujeres se tratan de "USTED" entre amigos, familiares y parejas.
      * "Oiga, ¿usted va a ir a la fiesta?" (A un amigo íntimo).
      * El "Tú" es menos frecuente en hombres (suena cursi o 'gomelo').
      * "Su merced": Usar solo en contextos de servicio muy amables o rurales/tradicionales.
    
    [PRAGMÁTICA]
    - PETICIONES: Se usa "Regalar" para comprar/pedir. "Vecino, regáleme una leche" (significa véndame).
    - SUAVIDAD: Tono pausado y muy cortés. "Qué pena con usted" (para disculparse).

    [LÉXICO]
    - INFORMAL: "Parce" (amigo), "Vaina" (cosa), "Chévere" (bien), "Tinto" (café solo), "Pola" (cerveza), "Harto" (mucho), "Dar papaya" (exponerse).
    - FORMAL: Léxico muy culto y preciso.
  `,

  [Accent.Caribbean]: `
    DIALECTO: CARIBE (PUERTO RICO / CUBA / DOMINICANA).
    
    [GRAMÁTICA - SINTAXIS]
    - NO INVERSIÓN EN PREGUNTAS (RASGO DEFINITORIO):
      * Estándar: "¿Qué quieres tú?" -> Caribe: "¿Qué tú quieres?"
      * "¿Cómo tú estás?", "¿A dónde tú vas?".
    - PRONOMBRES SUJETOS: Uso redundante. "Yo creo que yo voy a ir porque yo quiero".
    
    [FONÉTICA ESCRITA]
    - Aspiración de 's' final puede representarse sutilmente como 'h' o cortes, pero prioriza legibilidad. "Vamo' a ver".
    - Lambdacismo (R -> L) en Puerto Rico: Sutil en el texto ("Pueltorro"), pero no abuses para no hacerlo cómico.

    [LÉXICO]
    - INFORMAL: "Boricua", "Pana" (amigo), "Corillo" (grupo), "Guagua" (autobús), "Chavos" (dinero), "Bochinche" (chisme), "Janguear" (salir), "Brutal" (genial).
    - FORMAL: Mantiene la sintaxis de no inversión. Muy cálido.
  `,

  [Accent.BuenosAires]: `
    DIALECTO: ARGENTINA (RIOPLATENSE).
    
    [GRAMÁTICA - VOSEO OBLIGATORIO]
    - PRONOMBRE: "Vos" (en lugar de tú).
    - VERBOS PRESENTE: Acentuación final. "Tenés", "Podés", "Querés", "Sos".
    - IMPERATIVO: "Hacé", "Vení", "Mirá", "Decime".
    
    [PRAGMÁTICA]
    - DIRECTOS: Tono seguro, a veces percibido como arrogante pero es solo confianza.
    - INTENSIFICADOR: "Re" (sin guion o pegado). "Relindo", "Re cansado". No usan "Muy".

    [LÉXICO]
    - INFORMAL: "Che" (vocativo universal), "Boludo" (amigo o insulto, contexto), "Laburo" (trabajo), "Bondi" (bus), "Guita" (dinero), "Mina/Pibe", "Posta" (verdad), "Viste" (muletilla final).
    - FORMAL: Se mantiene el "Vos" pero se elimina el slang (Che/Boludo). Vocabulario: Auto, Celular, Departamento, Computadora.
  `,

  [Accent.Santiago]: `
    DIALECTO: CHILE - SANTIAGO.
    
    [GRAMÁTICA - VOSEO CHILENO (MIXTO)]
    - CONTEXTO INFORMAL: Usa pronombre "Tú" o "Vos" pero verbo con terminación "-ái" / "-ís".
      * "¿Cómo estái?", "¿Qué querís?", "¿Si venís?".
      * "Cachái" (¿Entiendes?) es la muletilla fundamental.
    
    [PRAGMÁTICA]
    - VELOCIDAD: Frases cortas, rápidas.
    - "PO": Aglutinación de "pues" al final de frases. "Sí po", "No po", "Ya po".
    - "AL TIRO": Inmediatamente.

    [LÉXICO]
    - INFORMAL: "Weón" (palabra comodín: amigo, sujeto, insulto), "Bacán" (genial), "Fome" (aburrido), "Pololo/a" (novio/a), "Luca" (mil pesos), "Carrete" (fiesta).
    - FORMAL: Desaparece el voseo chileno. Se vuelve un español muy estándar y sobrio. Usa "Usted".
  `,

  [Accent.Lima]: `
    DIALECTO: PERÚ - LIMA (RIBEREÑO).
    
    [GRAMÁTICA]
    - TUTEO: Estándar y claro.
    - "NOMÁS": Usado como suavizante o limitador pospuesto. "Pasa nomás", "Ahí nomás", "Un ratito nomás".
    - DIMINUTIVOS: Extensivos. "Ahorita", "Sopita", "Cerquita".
    
    [PRAGMÁTICA]
    - "PE": Reducción de "pues" al final de frase. "Claro pe", "Vamos pe".
    - "YA": Usado como asentimiento constante. "Ya, bacán".

    [LÉXICO]
    - INFORMAL: "Pata/Causa" (amigo), "Chamba" (trabajo), "Jato" (casa), "Chévere" (genial), "Piña" (mala suerte), "Al toque" (rápido), "Soroche" (mal de altura).
    - FORMAL: Uno de los acentos más neutros de América. Vocabulario: Carro, Celular.
  `
};

// --- LOGICA PEDAGOGICA ---

const getExerciseInstructions = (level: Level, mode: AppMode): string => {
  // 1. MODE: ACCENT CHALLENGE (Override everything)
  if (mode === AppMode.AccentChallenge) {
    return `
    MODO: ADIVINA EL ACENTO.
    Genera ejercicios ESPECÍFICOS para identificar el origen de los hablantes.
    
    Genera 1 ejercicio de COMPRENSIÓN (multiple_choice):
    A. "¿De dónde son?" - Pregunta explícitamente el origen de Hablante A y Hablante B.
       Opciones incorrectas deben ser otros países de habla hispana.
    
    Genera 1 ejercicio de VOCABULARIO (classification):
    A. "Mapa de Palabras" - Relaciona la palabra dialectal (ej: "Chamba" o "Curro") con su país de origen.
    `;
  }

  // 2. MODE: VOCABULARY EXPANSION (Override everything)
  if (mode === AppMode.Vocabulary) {
    return `
    MODO: AMPLIACIÓN DE VOCABULARIO (INTENSIVO).
    
    Genera 1 ejercicio de COMPRENSIÓN (true_false):
    A. Validar el uso correcto de los términos técnicos en contexto.

    Genera 3 ejercicios de VOCABULARIO (OBLIGATORIOS):
    A. "Definiciones Precisas" (multiple_choice): Seleccionar la definición correcta de un término complejo usado.
    B. "Sinonimia Contextual" (classification): Relacionar el término técnico con su equivalente coloquial o sinónimo.
    C. "Precisión Léxica" (cloze): Rellenar huecos con el término exacto del tema seleccionado.
    `;
  }

  // 3. MODE: STANDARD (Level based)
  if (level.includes('Inicial')) {
    return `
    NIVEL INICIAL (A1-A2).
    Genera 2 ejercicios de COMPRENSIÓN (Simple recall, True/False).
    Genera 2 ejercicios de VOCABULARIO (Match word to definition).
    `;
  } 
  
  if (level.includes('Intermedio')) {
    return `
    NIVEL INTERMEDIO (B1-B2).
    Genera 2 ejercicios de COMPRENSIÓN (Inferencia, Tono).
    Genera 2 ejercicios de VOCABULARIO (Sinónimos, Colocaciones).
    `;
  }

  // Avanzado
  return `
  NIVEL AVANZADO (C1-C2).
  Genera 2 ejercicios de COMPRENSIÓN (Matices culturales, Ironía).
  Genera 2 ejercicios de VOCABULARIO (Modismos, Registro, Jerga).
  `;
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

  let profileInstruction = "";
  let finalTopic = topic;
  let numSpeakers = (textType === TextType.RadioNews || textType === TextType.Monologue) ? 1 : 2;

  // --- LOGIC FOR MODES ---
  
  if (mode === AppMode.AccentChallenge) {
      // RANDOMIZE TWO DISTINCT ACCENTS
      const allAccents = Object.values(Accent);
      const shuffled = allAccents.sort(() => 0.5 - Math.random());
      const accent1 = shuffled[0];
      const accent2 = shuffled[1];
      
      profileInstruction = `
      ESTO ES UN RETO DE ACENTOS (JUEGO DE ADIVINANZA).
      IGNORA EL ACENTO SELECCIONADO POR EL USUARIO.
      
      TU TAREA ES GENERAR UN DIÁLOGO ENTRE:
      - HABLANTE A: Rasgos de ${DIALECT_PROFILES[accent1]}
      - HABLANTE B: Rasgos de ${DIALECT_PROFILES[accent2]}
      
      El tema debe ser un choque cultural o léxico (ej: pedir algo y que el otro no entienda la palabra).

      !!! PROTOCOLO ANTI-SPOILER (CRÍTICO) !!!
      Para que el juego funcione, el usuario NO DEBE SABER de dónde son hasta que haga los ejercicios.
      1. Campo 'title': DEBE SER MISTERIOSO. Ej: "Confusión en el mercado", "Dos viajeros". NUNCA pongas "Argentino vs Mexicano".
      2. Campo 'situationDescription': DEBE SER NEUTRA. Ej: "Dos personas intentan ponerse de acuerdo...". NO menciones nacionalidades ni regiones.
      3. Campo 'communicativeFunction': "Contrastar variedades dialectales" (Genérico).
      4. Campo 'freesoundSearchQuery': GENÉRICO. Ej: "busy cafe ambience" (NO incluyas el nombre del país aquí para que no salga en los metadatos del audio).
      `;
      finalTopic = "Encuentro cultural / Choque de dialectos / Confusión de palabras";
      numSpeakers = 2; // Force dialogue

  } else if (mode === AppMode.Vocabulary) {
      // VOCABULARY MODE
      const baseProfile = DIALECT_PROFILES[accent];
      profileInstruction = `
      ${baseProfile}

      OBJETIVO: DENSIDAD LÉXICA ALTA.
      El usuario quiere aprender vocabulario sobre: "${topic}".
      
      !!! REGLA DE UNIFORMIDAD !!!
      AMBOS HABLANTES DEBEN USAR ESTE ACENTO (${accent}).
      No permitas que un hablante sea "neutro". Si el dialecto usa "vos", ambos usan "vos".
      
      El diálogo debe estar CARGADO de terminología específica, sinónimos y expresiones relacionadas con ese tema.
      `;

  } else {
      // STANDARD MODE
      // CRITICAL FIX: FORCE CONSISTENCY
      const baseProfile = DIALECT_PROFILES[accent];
      profileInstruction = `
      ${baseProfile}

      !!! REGLA DE ORO DE CONSISTENCIA (CRÍTICA) !!!
      AMBOS HABLANTES (A y B) SON NATIVOS DE ESTA REGIÓN (${accent}).
      Está PROHIBIDO que uno hable "neutro" o "estándar" y el otro dialectal.
      
      - Si el perfil dice "Usar VOS", AMBOS deben vosear.
      - Si el perfil dice "No inversión de preguntas", AMBOS lo hacen.
      - Si es una entrevista, el entrevistador TAMBIÉN es local y comparte el acento y modismos.
      
      El objetivo es una inmersión total en ESTE acento específico.
      `;
  }

  const exerciseLogic = getExerciseInstructions(level, mode);

  // IMPORTANT: Explicit schema examples prevent hallucinations
  const jsonStructure = `
  {
    "title": "String",
    "situationDescription": "String",
    "communicativeFunction": "String",
    "freesoundSearchQuery": "String",
    "characters": [{ "name": "String", "gender": "Male" | "Female" }],
    "dialogue": [{ "speaker": "String", "text": "String", "emotion": "String" }],
    "exercises": {
      "comprehension": [
        {
          "id": "ex_c1",
          "type": "multiple_choice", 
          "question": "Pregunta...",
          "options": [{ "id": "o1", "text": "Opción A" }, { "id": "o2", "text": "Opción B" }],
          "correctAnswer": "o1", 
          "explanation": "..."
        }
      ],
      "vocabulary": [
        {
          "id": "ex_v1",
          "type": "classification",
          "question": "Relaciona...",
          "rows": [{ "id": "r1", "text": "..." }],
          "columns": [{ "id": "c1", "text": "..." }],
          "correctAnswer": { "r1": "c1" },
          "explanation": "..."
        }
      ]
    }
  }
  `;

  const prompt = `
  Genera una lección de escucha en español (JSON).
  
  CONFIGURACIÓN GLOBAL:
  - Modo de App: ${mode}
  - Nivel: ${level}
  - Tema Base: ${finalTopic}
  - Formato: ${textType}
  - Hablantes: ${numSpeakers}
  - Longitud: ${length}
  
  INSTRUCCIONES DE PERFIL Y ACENTO:
  ${profileInstruction}

  REGLA DE TONO (FORMAL vs INFORMAL):
  1. Analiza el TEMA ("${finalTopic}").
     - Si es FORMAL (Trabajo, Médico, Policia): Usa la gramática del perfil pero ELIMINA el slang/jerga muy fuerte. Mantén el tratamiento de respeto (Usted/Ustedes) según las reglas del perfil regional.
     - Si es INFORMAL (Amigos, Fiesta, Bar): Usa TODAS las muletillas, slang y gramática relajada del perfil.
  
  2. MANTÉN LA COHERENCIA: No mezcles registros. O los dos son formales, o los dos son informales.

  INSTRUCCIONES DE EJERCICIOS:
  ${exerciseLogic}

  AMBIENTACIÓN SONORA:
  Genera "freesoundSearchQuery" en inglés para buscar ambiente de fondo.

  Estructura JSON:
  ${jsonStructure}
  `;

  try {
    const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: GENERATION_MODEL,
      contents: prompt,
      config: {
        // We relax system instruction slightly to allow the Prompt to override Accent logic for the challenge
        systemInstruction: "Eres un experto lingüista y guionista. Genera JSON válido estrictamente.",
        responseMimeType: "application/json", 
        temperature: 0.7, 
      },
    }));

    if (!response.text) throw new Error("API devolvió vacío");
    const jsonStr = cleanJsonString(response.text);
    const plan = JSON.parse(jsonStr) as LessonPlan;
    
    // Safety checks & VALIDATION
    if (!plan.dialogue) plan.dialogue = [];
    if (!plan.exercises) plan.exercises = { comprehension: [], vocabulary: [] };

    // Strict Filtering of Broken Exercises
    if (plan.exercises.comprehension) {
        plan.exercises.comprehension = plan.exercises.comprehension.filter(isValidExercise);
    }
    if (plan.exercises.vocabulary) {
        plan.exercises.vocabulary = plan.exercises.vocabulary.filter(isValidExercise);
    }

    return plan;
  } catch (error: any) {
    console.error("Error generando plan:", error);
    throw new Error(`Error GenAI: ${error.message}`);
  }
};

export const generateAudio = async (
    dialogue: LessonPlan['dialogue'], 
    characters: Character[],
    accent: Accent // Note: In "AccentChallenge", the text itself carries the phonetic markers written by the LLM
): Promise<string> => {
  if (!dialogue || dialogue.length === 0) return "";

  const speakerCounts: Record<string, number> = {};
  dialogue.forEach(d => {
      if (d.speaker) speakerCounts[d.speaker.trim()] = (speakerCounts[d.speaker.trim()] || 0) + 1;
  });
  
  const sortedSpeakers = Object.keys(speakerCounts).sort((a,b) => speakerCounts[b] - speakerCounts[a]);
  if (sortedSpeakers.length === 0) return "";

  const isMultiSpeaker = sortedSpeakers.length >= 2;
  let speechConfig;
  
  // RAW TEXT: No system instructions hidden here to ensure natural cadence.
  let textPrompt = "";

  if (isMultiSpeaker) {
    const s1 = sortedSpeakers[0];
    const s2 = sortedSpeakers[1];
    const mapToInternal = (original: string) => {
        if (original.includes(s1) || s1.includes(original)) return "SpeakerA";
        if (original.includes(s2) || s2.includes(original)) return "SpeakerB";
        return "SpeakerA";
    };
    const getVoice = (name: string, defaultVoice: string) => {
        const char = characters.find(c => c.name === name || name.includes(c.name));
        return char?.gender === 'Female' ? 'Kore' : (char?.gender === 'Male' ? 'Fenrir' : defaultVoice);
    };
    speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: "SpeakerA", voiceConfig: { prebuiltVoiceConfig: { voiceName: getVoice(s1, 'Puck') } } },
          { speaker: "SpeakerB", voiceConfig: { prebuiltVoiceConfig: { voiceName: getVoice(s2, 'Kore') } } }
        ]
      }
    };
    textPrompt = dialogue
        .filter(d => d.speaker && (d.speaker.includes(s1) || d.speaker.includes(s2) || s1.includes(d.speaker) || s2.includes(d.speaker)))
        .map(d => `${mapToInternal(d.speaker)}: ${d.text}`)
        .join('\n');
  } else {
    const s1 = sortedSpeakers[0];
    const char = characters.find(c => c.name === s1 || s1.includes(c.name));
    speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: char?.gender === 'Female' ? 'Kore' : 'Puck' } } };
    textPrompt = dialogue.map(d => d.text).join('\n\n');
  }

  if (textPrompt.length > 4000) textPrompt = textPrompt.substring(0, 4000);

  try {
    const response = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: AUDIO_MODEL,
      contents: { parts: [{ text: textPrompt }] },
      config: { responseModalities: ['AUDIO'] as any, speechConfig: speechConfig }
    }));
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  } catch (error: any) {
    console.error("Audio Gen Error:", error);
    throw new Error(`Error TTS: ${error.message}`);
  }
};