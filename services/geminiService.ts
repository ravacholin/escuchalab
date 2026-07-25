
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Level, Length, TextType, Accent, LessonPlan, Character, AppMode } from "../types";
import { ExerciseSlot, FORMAT_RULES, getBlueprint, STAGE_META } from "../data/listeningSyllabus";
import { DATA_POINTS, inferDataPoint } from "../data/dataPoints";
import { fillMissingSlots } from "./exerciseEngines";
import { verifyExercises } from "./exerciseVerification";

// Helper to get key from storage
const getApiKey = (): string => {
  const key = localStorage.getItem('gemini_api_key');
  if (!key) throw new Error("API Key no encontrada. Por favor, reinicia la app e ingrésala.");
  return key;
};

const GENERATION_MODEL = "gemini-3.6-flash";
const AUDIO_MODEL = "gemini-3.1-flash-tts-preview";

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

// --- CONFIGURATION: PERFILES FONÉTICOS TTS (PRONUNCIACIÓN) ---
// Estos perfiles se inyectan como INSTRUCCIÓN al TTS para forzar pronunciación correcta
// IMPORTANTE: Cada perfil debe ser EXHAUSTIVO para garantizar pronunciación correcta
const TTS_PHONETIC_PROFILES: Record<Accent, string> = {
  [Accent.Madrid]: `[TTS VOICE DIRECTIVE: CASTILIAN SPANISH - MADRID, CENTRAL SPAIN]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: DISTINCIÓN (THETA SOUND θ)
═══════════════════════════════════════════════════════════════════════════════
The letters "z" (always) and "c" (before e/i) MUST be pronounced as [θ] - 
the VOICELESS DENTAL FRICATIVE, identical to English "th" in "think/thick/thunder".

This is NON-NEGOTIABLE. Place tongue between teeth and blow air.

MANDATORY EXAMPLES - READ THESE EXACTLY AS WRITTEN:
• "zapato" = [θa.ˈpa.to] → "THA-pa-to" (shoe)
• "cielo" = [ˈθje.lo] → "THYE-lo" (sky)
• "hacer" = [a.ˈθer] → "a-THER" (to do)
• "vez" = [beθ] → "beth" (time/instance)
• "plaza" = [ˈpla.θa] → "PLA-tha" (plaza)
• "gracias" = [ˈɡra.θjas] → "GRA-thyass" (thanks)
• "Barcelona" = [bar.θe.ˈlo.na] → "bar-the-LO-na"
• "cereza" = [θe.ˈre.θa] → "the-RE-tha" (cherry)
• "azul" = [a.ˈθul] → "a-THOOL" (blue)
• "cena" = [ˈθe.na] → "THE-na" (dinner)

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: THE "S" SOUND [s]
═══════════════════════════════════════════════════════════════════════════════
The letter "s" is ALWAYS [s] - a SHARP APICO-ALVEOLAR SIBILANT.
In Madrid, /s/ is produced with the APEX (tip) of the tongue raised.
NEVER aspirate, NEVER drop, NEVER confuse with θ.

• "casa" = [ˈka.sa] → "KA-sa" (house) - DIFFERENT from "caza" [ˈka.θa]
• "peso" = [ˈpe.so] → "PE-so" (weight)
• "estos" = [ˈes.tos] → "ES-tos" (these)

═══════════════════════════════════════════════════════════════════════════════
OTHER CONSONANTS
═══════════════════════════════════════════════════════════════════════════════
• "j" and "g" (before e/i) = STRONG VELAR FRICATIVE [x], like Scottish "loch"
  - "jefe" = [ˈxe.fe], "gente" = [ˈxen.te] - SCRATCH from back of throat
• "ll" and "y" = PALATAL APPROXIMANT [ʝ], like English "y" in "yes"
  - "calle" = [ˈka.ʝe] → "KA-ye" (NOT "ka-she")
• Intervocalic "d" = DENTAL FRICATIVE [ð], like English "th" in "the"
  - "cansado" = [kan.ˈsa.ðo] → "kan-SA-tho"
• Final consonants: FULLY ARTICULATED, clear and crisp

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: Moderate, 4.5-5 syllables/second
• RHYTHM: Syllable-timed, each syllable roughly equal duration
• PITCH: Wide range, assertive rising-falling patterns
• STATEMENTS: Start mid, rise slightly, fall at end
• QUESTIONS: Sharp rise at final syllable
• ATTITUDE: Direct, confident, authoritative`,

  [Accent.Andalusia]: `[TTS VOICE DIRECTIVE: ANDALUSIAN SPANISH - SEVILLE/CÁDIZ, WESTERN ANDALUSIA]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: SESEO (NO THETA)
═══════════════════════════════════════════════════════════════════════════════
There is NO [θ] sound. Letters "z", "c" (before e/i), AND "s" all become [s].
This is SESEO - the merger of /θ/ and /s/ into [s].

MANDATORY EXAMPLES:
• "zapato" = [sa.ˈpa.to] → "sa-PA-to" (NOT "tha-pato")
• "cielo" = [ˈsje.lo] → "SYE-lo" (NOT "thye-lo")
• "gracias" = [ˈɡra.sjah] → "GRA-syah"
• "plaza" = [ˈpla.sa] → "PLA-sa"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: S-ASPIRATION & ELISION
═══════════════════════════════════════════════════════════════════════════════
Syllable-final /s/ becomes [h] (ASPIRATION) or is DELETED entirely.
This affects /s/ before consonants and at word boundaries.

MANDATORY EXAMPLES:
• "estos" = [ˈeh.toh] or [ˈe.to] → "EH-toh" or "E-to"
• "más" = [mah] or [ma] → "mah" or "ma"
• "está" = [eh.ˈta] → "eh-TA"
• "espera" = [eh.ˈpe.ɾa] → "eh-PE-ra"
• "las casas" = [lah.ˈka.sah] → "lah KA-sah"
• "buscar" = [buh.ˈka] → "buh-KA"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #3: CONSONANT WEAKENING
═══════════════════════════════════════════════════════════════════════════════
• INTERVOCALIC /d/ → DELETED: "cansado" = [kan.ˈsa.o] → "kan-SA-o"
  - "pescado" → "peh-KA-o", "comido" → "ko-MI-o"
• FINAL /d/ → DELETED: "Madrid" = [ma.ˈðɾi] → "ma-DRI" (no final d)
• FINAL /r/ → WEAKENED: "comer" = [ko.ˈme] → "ko-ME"
• "j" = SOFT [h], not guttural: "jefe" = [ˈhe.fe]

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: FAST, 6-7 syllables/second, flowing
• RHYTHM: Stress-timed, words blend together
• PITCH: Musical, sing-song quality
• VOWELS: May lengthen to compensate for lost consonants
• ATTITUDE: Warm, friendly, expressive, animated`,

  [Accent.MexicoCity]: `[TTS VOICE DIRECTIVE: MEXICAN SPANISH - MEXICO CITY (CDMX/CHILANGO)]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: FULL S-RETENTION [s]
═══════════════════════════════════════════════════════════════════════════════
ALL /s/ sounds are FULLY PRONOUNCED as clear, crisp [s]. 
This is a DEFINING feature of Mexican Spanish. NEVER aspirate. NEVER drop.

MANDATORY EXAMPLES:
• "estos" = [ˈes.tos] → "ES-tos" (both S sounds clear!)
• "más" = [mas] → "maS" (final S audible)
• "espera" = [es.ˈpe.ɾa] → "ES-pe-ra"
• "buscar" = [bus.ˈkaɾ] → "bus-KAR"
• "este" = [ˈes.te] → "ES-te"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: SESEO
═══════════════════════════════════════════════════════════════════════════════
No [θ]. Letters "z" and "c" (before e/i) = [s], same as "s".
• "zapato" = [sa.ˈpa.to] → "sa-PA-to"
• "cielo" = [ˈsje.lo] → "SYE-lo"
• "gracias" = [ˈɡɾa.sjas] → "GRA-syas"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #3: X IN MEXICAN WORDS
═══════════════════════════════════════════════════════════════════════════════
The letter "x" in indigenous words = [h] or [ʃ]
• "México" = [ˈme.hi.ko] → "ME-hi-ko"
• "Oaxaca" = [wa.ˈha.ka] → "wa-HA-ka"
• "Xochimilco" = [so.tʃi.ˈmil.ko] or [ʃo.tʃi.ˈmil.ko]

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #4: ASSIBILATION OF /r/
═══════════════════════════════════════════════════════════════════════════════
The trill /r/ and tap /ɾ/ may have SIBILANT quality (buzzing/hissing)
• "carro" may sound like [ˈka.ʂo] with retroflex quality
• Final /r/ can be assibilated: "hablar" = [a.ˈblaʂ]

═══════════════════════════════════════════════════════════════════════════════
OTHER FEATURES
═══════════════════════════════════════════════════════════════════════════════
• "ll"/"y" = [ʝ] like English "y" in "yes"
• "j"/"g(e,i)" = SOFT [x] or [h], not harsh: "gente" = [ˈhen.te]
• UNSTRESSED VOWEL REDUCTION: Vowels next to /s/ may be reduced or devoiced
  - "trastes" can sound like [ˈtɾas.ts]

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: Moderate, 4.5-5 syllables/second
• RHYTHM: Melodic, lilting, polite
• PITCH: Soft rises and falls, friendly
• DIMINUTIVES: Natural use of -ito (cafecito, ahorita)
• ATTITUDE: Polite, courteous, indirect, warm`,

  [Accent.Bogota]: `[TTS VOICE DIRECTIVE: COLOMBIAN SPANISH - BOGOTÁ (ROLO/CACHACO)]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: PRISTINE S-PRONUNCIATION [s]
═══════════════════════════════════════════════════════════════════════════════
Bogotá Spanish has THE CLEAREST /s/ in the Spanish-speaking world.
Every /s/ is FULLY ARTICULATED with ZERO aspiration or weakening.
This is THE most conservative pronunciation of /s/ in Latin America.

MANDATORY EXAMPLES:
• "estos" = [ˈes.tos] → "ES-tos" (crystal clear)
• "más" = [mas] → "maS" (pristine final S)
• "buscar" = [bus.ˈkaɾ] → "bus-KAR"
• "esperar" = [es.pe.ˈɾaɾ] → "es-pe-RAR"
• "las casas" = [las.ˈka.sas] → "las KA-sas"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: SESEO
═══════════════════════════════════════════════════════════════════════════════
No [θ]. Standard seseo applies.
• "zapato" = [sa.ˈpa.to], "cielo" = [ˈsje.lo]

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #3: ALL CONSONANTS PRESERVED
═══════════════════════════════════════════════════════════════════════════════
Unlike other dialects, NOTHING is dropped or weakened.
• Final consonants: fully articulated
• Intervocalic /d/: preserved as [ð]: "cansado" = [kan.ˈsa.ðo]
• "ll"/"y" = clear [ʝ]: "calle" = [ˈka.ʝe]
• "j"/"g(e,i)" = gentle [x] or [h], never harsh

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION - THE "ROLO" MELODY
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: SLOW TO MODERATE, 3.5-4.5 syllables/second
• RHYTHM: DISTINCTIVE SING-SONG (cantadito)
  - Rises and falls like gentle hills
  - Each phrase has melodic arc
• PITCH: Wide range, musical quality
• ARTICULATION: Extremely clear, deliberate, careful
• VOWELS: Pure, clear, no reduction

═══════════════════════════════════════════════════════════════════════════════
ATTITUDE & REGISTER
═══════════════════════════════════════════════════════════════════════════════
• EXTREMELY polite and formal
• Soft-spoken, never aggressive
• Frequent use of "usted" even informally
• Characteristic phrases: "con mucho gusto", "a la orden", "qué pena"`,

  [Accent.Caribbean]: `[TTS VOICE DIRECTIVE: CARIBBEAN SPANISH - PUERTO RICO/CUBA]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: S-ASPIRATION TO [h]
═══════════════════════════════════════════════════════════════════════════════
Syllable-final /s/ becomes [h] (VOICELESS GLOTTAL FRICATIVE) or is DELETED.
This is the MOST PROMINENT feature of Caribbean Spanish.

MANDATORY EXAMPLES:
• "estos" = [ˈeh.toh] → "EH-toh"
• "más" = [mah] → "mah"
• "está" = [eh.ˈta] → "eh-TA"
• "buscar" = [buh.ˈkaɾ] → "buh-KAR"
• "las islas" = [lah.ˈih.lah] → "lah IH-lah"
• "espera" = [eh.ˈpe.ɾa] → "eh-PE-ra"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: LAMBDACISM (R → L) - PUERTO RICO
═══════════════════════════════════════════════════════════════════════════════
In Puerto Rico, syllable-final /r/ becomes [l]. This is called LAMBDACISM.
This is extremely common and socially unmarked.

MANDATORY EXAMPLES (PUERTO RICO):
• "puerta" = [ˈpwel.ta] → "PWEL-ta" (NOT "pwer-ta")
• "verde" = [ˈbel.de] → "BEL-de" (NOT "ver-de")
• "comer" = [ko.ˈmel] → "ko-MEL"
• "amor" = [a.ˈmol] → "a-MOL"
• "carne" = [ˈkal.ne] → "KAL-ne"
• "Puerto Rico" = [ˈpwel.to.ˈɾi.ko] → "PWEL-to RI-ko"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #3: CONSONANT WEAKENING
═══════════════════════════════════════════════════════════════════════════════
• Intervocalic /d/ → DELETED: "cansado" = [kan.ˈsa.o] → "kan-SA-o"
• Final /d/ → DELETED: "verdad" = [beɾ.ˈða] → "ver-DA" (no final d)
• Word-final /n/ → VELARIZED [ŋ] or nasalizes vowel

═══════════════════════════════════════════════════════════════════════════════
OTHER CONSONANTS
═══════════════════════════════════════════════════════════════════════════════
• SESEO: "z"/"c(e,i)" = [s]
• "ll"/"y" = [ʝ] like English "y"
• In Cuba, final /r/ may be VELARIZED (French-like [ʁ])

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: FAST, 6+ syllables/second
• RHYTHM: HIGHLY MUSICAL with African-influenced percussion-like cadence
• Words flow together rapidly
• Animated, expressive pitch changes
• Strong rises in questions
• ATTITUDE: Lively, warm, enthusiastic, expressive`,

  [Accent.BuenosAires]: `[TTS VOICE DIRECTIVE: ARGENTINE SPANISH - BUENOS AIRES (RIOPLATENSE/PORTEÑO)]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
██████████████████████████████████████████████████████████████████████████████
CRITICAL CONSONANT RULE #1: SHEÍSMO - THE [ʃ] SOUND
THIS IS THE SINGLE MOST IMPORTANT RULE. FAILURE = COMPLETE REJECTION.
██████████████████████████████████████████████████████████████████████████████
═══════════════════════════════════════════════════════════════════════════════

The letters "ll" and "y" (when not vowel) MUST be pronounced as [ʃ] -
the VOICELESS POSTALVEOLAR FRICATIVE, exactly like English "SH" in "ship/show".

THIS IS NON-NEGOTIABLE. This is the #1 defining feature of Buenos Aires Spanish.
Younger speakers use [ʃ] (voiceless). Older speakers may use [ʒ] (voiced, like "measure").

════════════════════════════════════════════════════════════════════════════
EVERY "LL" AND "Y" = "SH" SOUND. MEMORIZE THESE:
════════════════════════════════════════════════════════════════════════════
• "yo" = [ʃo] → "SHO" ❌ WRONG: "yo" 
• "ya" = [ʃa] → "SHA" ❌ WRONG: "ya"
• "calle" = [ˈka.ʃe] → "KA-SHE" ❌ WRONG: "ka-ye"
• "ella" = [ˈe.ʃa] → "E-SHA" ❌ WRONG: "e-ya"
• "llamar" = [ʃa.ˈmaɾ] → "SHA-mar" ❌ WRONG: "ya-mar"
• "llegar" = [ʃe.ˈɣaɾ] → "SHE-gar" ❌ WRONG: "ye-gar"
• "lluvia" = [ˈʃu.βja] → "SHU-vya" ❌ WRONG: "yu-vya"
• "pollo" = [ˈpo.ʃo] → "PO-SHO" ❌ WRONG: "po-yo"
• "mayo" = [ˈma.ʃo] → "MA-SHO" ❌ WRONG: "ma-yo"
• "ayer" = [a.ˈʃeɾ] → "a-SHER" ❌ WRONG: "a-yer"
• "playa" = [ˈpla.ʃa] → "PLA-SHA" ❌ WRONG: "pla-ya"
• "silla" = [ˈsi.ʃa] → "SI-SHA" ❌ WRONG: "si-ya"
• "voy" = [boʃ] → "BOSH" ❌ WRONG: "boy"
• "muy" = [muʃ] → "MOOSH" ❌ WRONG: "muy"
• "hoy" = [oʃ] → "OSH" ❌ WRONG: "oy"
• "hay" = [aʃ] → "ASH" ❌ WRONG: "ay"

IF YOU PRONOUNCE "Y" AS IN ENGLISH "YES", YOU HAVE FAILED COMPLETELY.
THE SOUND IS "SH" LIKE "SHIP", "SHOW", "SHOUT".

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: S-ASPIRATION
═══════════════════════════════════════════════════════════════════════════════
Syllable-final /s/ is often ASPIRATED to [h] or weakened:
• "estos" = [ˈeh.toh] → "EH-toh"
• "más" = [mah] → "mah"
• "vos" = [boh] → "boh"
BUT /s/ between vowels remains clear: "casa" = [ˈka.sa]

═══════════════════════════════════════════════════════════════════════════════
OTHER CONSONANTS
═══════════════════════════════════════════════════════════════════════════════
• SESEO: "z"/"c(e,i)" = [s]
• "j"/"g(e,i)" = moderate velar [x]
• "rr" = standard alveolar trill [r]

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION - ITALIAN INFLUENCE
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: Moderate, expressive
• INTONATION: DRAMATIC RISES AND FALLS like Italian
  - Almost singing quality
  - Wide pitch range, theatrical
  - Questions rise EXAGGERATEDLY at end
• VOWELS: Final vowels may be slightly elongated
• OPEN "e": [ɛ] in stressed syllables

═══════════════════════════════════════════════════════════════════════════════
VOSEO - PRONOUN SYSTEM
═══════════════════════════════════════════════════════════════════════════════
Use "VOS" not "tú": "vos tenés", "vos querés", "vos sabés"
Characteristic: "che", "dale", "viste", "boludo"`,

  [Accent.Santiago]: `[TTS VOICE DIRECTIVE: CHILEAN SPANISH - SANTIAGO]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #1: EXTREME S-ASPIRATION AND ELISION
═══════════════════════════════════════════════════════════════════════════════
/s/ is HEAVILY ASPIRATED to [h] or DELETED entirely. More extreme than Caribbean.
This affects ALL syllable-final /s/ positions.

MANDATORY EXAMPLES:
• "estos" = [ˈeh.toh] or [ˈe.to] → "EH-toh" or "E-to"
• "más" = [mah] or [ma] → "mah" or "ma"
• "es que" = [eh.ke] → "EH-ke"
• "buscar" = [buh.ˈka] or [bu.ˈka] → "buh-KA" or "bu-KA"
• "las casas" = [lah.ˈka.sah] → "lah KA-sah"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #2: SYLLABLE SWALLOWING / REDUCTION
═══════════════════════════════════════════════════════════════════════════════
Unstressed syllables are REDUCED or COMPLETELY SWALLOWED.
Words sound shorter, clipped, truncated.

MANDATORY EXAMPLES:
• "para" = [pa] → "PA" (entire syllable gone)
• "nada" = [na] → "NA"
• "pues" = [po] → "PO"
• "está" = [ta] → "TA" (initial syllable weak)
• "pero" = [pe.ɾo] → very quick, almost "PRO"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #3: THE "CH" FRICANIZATION
═══════════════════════════════════════════════════════════════════════════════
/tʃ/ may become fricative [ʃ] (like "sh") in casual speech.
• "Chile" = [ˈʃi.le] → "SHI-le" (informal) or [ˈtʃi.le] (formal)
• "leche" = [ˈle.ʃe] → "LE-she" (informal)

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #4: VERB ENDING CHANGES (VOSEO MIXTO)
═══════════════════════════════════════════════════════════════════════════════
• "-as" → "-ai" [aj]: "estás" = [eh.ˈtaj] → "eh-TAI"
• "-es" → "-ís" [ih]: "tienes" = [ˈtje.nih] → "TYE-nih"

═══════════════════════════════════════════════════════════════════════════════
OTHER FEATURES
═══════════════════════════════════════════════════════════════════════════════
• SESEO: "z"/"c(e,i)" = [s]
• "ll"/"y" = [ʝ] standard (NOT [ʃ] like Argentina)
• Intervocalic /d/ often deleted: "cansado" → "kansa'o"

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: VERY FAST - THE FASTEST SPANISH VARIANT
  - 7+ syllables/second
  - Words run together
  - Entire sentences sound like one long word
• RHYTHM: Clipped, staccato, efficient
• RISING INTONATION at phrase endings (sounds like questions)
• CHARACTERISTIC: "po" at end → "sí po", "ya po", "no po"
• "cachái" [ka.ˈʃaj] = "you know?" used constantly

═══════════════════════════════════════════════════════════════════════════════
ATTITUDE
═══════════════════════════════════════════════════════════════════════════════
• Informal, casual, cool
• Efficient and fast
• Heavy slang: "weón", "cachái", "po"`,

  [Accent.Lima]: `[TTS VOICE DIRECTIVE: PERUVIAN SPANISH - LIMA (COSTEÑO)]
MANDATORY PRONUNCIATION SYSTEM - FOLLOW EXACTLY OR OUTPUT WILL BE REJECTED.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: CLEAR S-RETENTION [s]
═══════════════════════════════════════════════════════════════════════════════
Lima Spanish is CONSERVATIVE - all /s/ sounds are CLEARLY PRONOUNCED.
/s/ is only aspirated in PRE-CONSONANTAL position, and NEVER between vowels.
This is unique among coastal Latin American varieties.

MANDATORY EXAMPLES:
• "estos" = [ˈes.tos] → "ES-tos" (clear)
• "más" = [mas] → "maS" (final S preserved)
• "casa" = [ˈka.sa] → "KA-sa" (intervocalic S clear)
• "buscar" = [bus.ˈkaɾ] → "bus-KAR" (may aspirate before consonant)

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #2: SESEO
═══════════════════════════════════════════════════════════════════════════════
Standard seseo - no [θ].
• "zapato" = [sa.ˈpa.to] → "sa-PA-to"
• "cielo" = [ˈsje.lo] → "SYE-lo"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #3: YEÍSMO (STANDARD)
═══════════════════════════════════════════════════════════════════════════════
"ll" and "y" = [ʝ] like English "y" in "yes"
• "calle" = [ˈka.ʝe] → "KA-ye"
• "yo" = [ʝo] → "yo"

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULE #4: CLEAR RHOTICS
═══════════════════════════════════════════════════════════════════════════════
Both /r/ (trill) and /ɾ/ (tap) are NON-ASSIBILATED (no buzzing).
No confusion between /r/ and /l/ (unlike Caribbean).
• "carro" = [ˈka.ro] with clear trill
• "pero" = [ˈpe.ɾo] with clear tap

═══════════════════════════════════════════════════════════════════════════════
OTHER FEATURES
═══════════════════════════════════════════════════════════════════════════════
• ALL consonants clearly articulated
• Word-final /d/ sometimes becomes [t]: "verdad" = [beɾ.ˈðat]
• "j"/"g(e,i)" = [x] or [χ] (velar or uvular fricative)

═══════════════════════════════════════════════════════════════════════════════
PROSODY & INTONATION
═══════════════════════════════════════════════════════════════════════════════
• TEMPO: MODERATE TO SLOW, 3.5-4.5 syllables/second
• RHYTHM: Measured, careful, deliberate
• INTONATION: Gentle, polite melody
  - Soft rises and falls
  - Not dramatic
• ARTICULATION: Very clear, conservative
• VOWELS: Pure, no reduction

═══════════════════════════════════════════════════════════════════════════════
CHARACTERISTIC FEATURES
═══════════════════════════════════════════════════════════════════════════════
• "pe" (from "pues") at phrase end: "ya pe", "claro pe"
• "nomás" postposed: "pasa nomás", "sigue nomás"
• Polite register, formal

═══════════════════════════════════════════════════════════════════════════════
ATTITUDE
═══════════════════════════════════════════════════════════════════════════════
• Polite, gentle, respectful
• Conservative, measured
• Friendly but not overly animated
• Clear, standard pronunciation`
};

// --- CONFIGURATION: PERFILES LINGÜÍSTICOS AVANZADOS (GRAMÁTICA/LÉXICO) ---
const DIALECT_PROFILES: Record<Accent, string> = {
  [Accent.Madrid]: `
    DIALECTO: ESPAÑA - MADRID (CENTRO PENINSULAR).
    [FONÉTICA/PROSODIA] Distinción /s/ vs /θ/ (cena/sena). /s/ apicoalveolar marcada. /x/ velar fuerte. Entonación con caída final; preguntas con leve subida y énfasis en la sílaba tónica.
    [GRAMÁTICA] Distinción tú/usted marcada. Plural: vosotros. Leísmo de persona posible ("Le vi"). Uso de "vosotros" en imperativos (venid, sentaos).
    [PRAGMÁTICA] Directo, eficiente y sobrio; cortesía breve. Pausas cortas y ritmo conversacional rápido pero claro.
    [LÉXICO] Base estándar; 1–2 localismos puntuales ("molar", "curro", "coche"). NO depender de argot.
    [REALIA] Moneda: euro (€), precios "X euros con Y céntimos". Tratamiento: tú (informal) / usted (formal); plural vosotros/ustedes. Cotidiano: coche, móvil, piso, DNI, metro/autobús. Instituciones y realia peninsulares.
  `,
  [Accent.Andalusia]: `
    DIALECTO: ESPAÑA - ANDALUCÍA (OCCIDENTAL).
    [FONÉTICA/PROSODIA] Aspiración o pérdida de /s/ final y relajación de /d/ intervocálica ("cansao"). Seseo frecuente (a veces ceceo local). Entonación melódica y alargamiento vocálico.
    [GRAMÁTICA] Ustedes como plural frecuente (verbo en 3ª). Apócopes coloquiales ("pa'", "na'") en registro informal.
    [PRAGMÁTICA] Cercanía afectuosa y cálida; ritmo ágil con sonoridad abierta.
    [LÉXICO] Español común con 1–2 marcas leves ("illo", "miarma"). NO depender de argot.
    [REALIA] Moneda: euro (€), precios "X euros con Y céntimos". Tratamiento: tú (informal) / usted (formal); plural ustedes frecuente. Cotidiano: coche, móvil, piso, DNI, autobús. Realia peninsulares.
  `,
  [Accent.MexicoCity]: `
    DIALECTO: MÉXICO - CDMX (CHILANGO).
    [FONÉTICA/PROSODIA] Entonación suave con descenso gradual en enunciados. /s/ clara y conservada; /x/ más suave. Ritmo pausado, con vocales bien articuladas.
    [GRAMÁTICA] Ustedes único plural. Diminutivos frecuentes ("cafecito"). Uso de "¿verdad?" como coletilla neutra.
    [PRAGMÁTICA] Cortesía alta y mitigación ("disculpe", "¿me permite?"). "Mande" como respuesta. Evitar rudeza directa.
    [LÉXICO] Español estándar con pocas marcas opcionales ("carro", "computadora", "platicar"). NO depender de argot ni muletillas locales.
    [REALIA] Moneda: peso mexicano ($, "pesos", centavos). Tratamiento: tú (informal) / usted (formal); plural ustedes. Cotidiano: carro, celular, departamento, credencial del INE, camión/metro. Realia mexicanas.
  `,
  [Accent.Bogota]: `
    DIALECTO: COLOMBIA - BOGOTÁ (ROLO).
    [FONÉTICA/PROSODIA] Entonación clara y relativamente plana; ritmo silábico regular. /s/ marcada y consonantes nítidas. /x/ suave.
    [GRAMÁTICA] Ustedeo frecuente entre cercanos. Diminutivos moderados.
    [PRAGMÁTICA] Cortesía alta y fórmulas atenuadoras ("qué pena", "con mucho gusto"). Peticiones con "regáleme".
    [LÉXICO] Español general con 1–2 marcas suaves ("tinto", "chévere"). NO depender de argot.
    [REALIA] Moneda: peso colombiano ($, "pesos"). Tratamiento: ustedeo frecuente incluso entre cercanos; usted/tú. Plural ustedes. Cotidiano: carro, celular, apartamento, cédula, Transmilenio/bus. Realia colombianas.
  `,
  [Accent.Caribbean]: `
    DIALECTO: CARIBE (PUERTO RICO / CUBA).
    [FONÉTICA/PROSODIA] Aspiración o pérdida de /s/ final, elisión de /d/ intervocálica. Velarización de /n/ final ("[ŋ]"). Entonación musical y ritmo rápido.
    [GRAMÁTICA] Preguntas sin inversión ocasional ("¿Qué tú quieres?") y redundancia pronominal posible.
    [PRAGMÁTICA] Expresivo, con exclamaciones breves y énfasis; energía alta sin groserías.
    [LÉXICO] Español común con 1–2 marcas suaves ("guagua", "pana"). NO depender de argot.
    [REALIA] Moneda: dólar (US$) en Puerto Rico; peso cubano en Cuba — elige UNA y sé consistente. Tratamiento: tú predominante; usted formal; plural ustedes. Cotidiano: carro, celular, apartamento, guagua (autobús). Realia caribeñas.
  `,
  [Accent.BuenosAires]: `
    DIALECTO: ARGENTINA (RIOPLATENSE).
    [FONÉTICA/PROSODIA] Yeísmo rehilado ("sh/zh" en ll/y). Entonación ascendente con fraseo alargado y ritmo conversacional dinámico.
    [GRAMÁTICA] Voseo ("vos tenés", "vení"). Uso de "che" como apelativo puntual.
    [PRAGMÁTICA] Directo y enfático, con marcadores discursivos moderados.
    [LÉXICO] Español estándar con pocas marcas ("che", "bondi" opcional). NO depender de argot.
    [REALIA] Moneda: peso argentino ($, "pesos"). Tratamiento: voseo ("vos tenés"); usted formal; plural ustedes. Cotidiano: auto, celular, departamento, DNI, colectivo/subte. Realia rioplatenses.
  `,
  [Accent.Santiago]: `
    DIALECTO: CHILE - SANTIAGO.
    [FONÉTICA/PROSODIA] /s/ final aspirada, consonantes finales relajadas y reducción de sílabas. Ritmo muy rápido con entonación descendente y finales cortos.
    [GRAMÁTICA] Voseo mixto en informal ("tú estái", "vos querís"), tuteo estándar en formal. Uso frecuente de "¿cachái?" en informal.
    [PRAGMÁTICA] Cadencia rápida y elisión en habla casual; en registro formal, claridad y neutralidad.
    [LÉXICO] Español general; 1–2 marcas suaves opcionales ("al tiro", "po"). Evitar "weón" y argot fuerte salvo contexto explícito.
    [REALIA] Moneda: peso chileno ($, "pesos"; sin centavos). Tratamiento: tú estándar; usted formal; plural ustedes. Cotidiano: auto, celular, departamento, carnet, micro/metro. Realia chilenas.
  `,
  [Accent.Lima]: `
    DIALECTO: PERÚ - LIMA.
    [FONÉTICA/PROSODIA] Entonación controlada y menos melodiosa; ritmo pausado con consonantes claras y /s/ conservada. /x/ suave.
    [GRAMÁTICA] Tuteo estándar. "Nomás" pospuesto ("pasa nomás"). Diminutivos moderados.
    [PRAGMÁTICA] Cortesía ligera y respuestas breves ("ya", "claro"); tono amable y calmado.
    [LÉXICO] Español general con 1–2 marcas suaves ("al toque", "chamba"). NO depender de argot.
    [REALIA] Moneda: sol (S/, "soles", céntimos). Tratamiento: tú estándar; usted formal; plural ustedes. Cotidiano: carro/auto, celular, departamento, DNI, combi/bus. Realia peruanas.
  `
};

/**
 * Construye el bloque EXERCISES del prompt a partir del syllabus.
 *
 * Antes esto era prosa escrita a mano por nivel, que ignoraba por completo el
 * tipo de audio (a un boletín de radio de un solo hablante se le pedía "¿quién
 * lo dice: hablante A o B?") y despachaba el modo antes que el nivel (un A0 y un
 * C1 en modo Vocabulario recibían exactamente los mismos ejercicios).
 *
 * Ahora cada slot del blueprint aporta su etapa, su habilidad, su brief y la
 * forma JSON exacta de su formato, y el `slotId` viaja en la respuesta para
 * poder saber después qué slots quedaron sin cubrir.
 */
const buildExercisePrompt = (slots: ExerciseSlot[]): string => {
  const formatsUsed = [...new Set(slots.map(s => s.format))];

  const formatBlock = formatsUsed
    .map(format => {
      const rule = FORMAT_RULES[format];
      return `  · ${format}\n    JSON: ${rule.jsonShape}\n    REGLAS: ${rule.guidance}`;
    })
    .join('\n');

  const slotBlock = slots
    .map((slot, i) => {
      const stage = STAGE_META[slot.stage].label;
      return `  ${i + 1}. slotId="${slot.slotId}" | etapa="${slot.stage}" (${stage}) | habilidad="${slot.skill}" | type="${slot.format}" | ${slot.items} ítems\n     ${slot.brief}`;
    })
    .join('\n');

  return `SIN PRODUCCIÓN: el alumno NUNCA escribe ni habla. Todo se resuelve seleccionando, ordenando, clasificando o eligiendo en un desplegable. Prohibidas las preguntas abiertas, los resúmenes y las opiniones libres.

PRINCIPIOS INNEGOCIABLES:
- Todo ejercicio se responde ESCUCHANDO. Si se puede acertar leyendo las opciones, razonando por plausibilidad temática o descartando lo absurdo, el ejercicio está mal hecho.
- Todo lo que presentes como dicho en el audio debe estar dicho en el audio, con su ortografía real (tildes y mayúsculas incluidas).
- Cada ejercicio incluye "sourceTurns": el array de índices (base 0) de los turnos del diálogo en los que se apoya.
- Todas las opciones, filas, columnas y campos llevan "id" único, y "correctAnswer" SIEMPRE referencia esos ids, nunca textos.
- Redacta enunciados y opciones en español, adaptados a la variante regional indicada.

FORMATOS QUE DEBES USAR:
${formatBlock}

GENERA EXACTAMENTE ESTOS ${slots.length} EJERCICIOS, EN ESTE ORDEN, cada uno con su "slotId", "stage" y "skill" copiados tal cual:
${slotBlock}

Devuélvelos en el array "exercises" en ese mismo orden.`;
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
  // El dato obligatorio de la situación se decide UNA vez y viaja a los dos
  // sitios que lo necesitan: el prompt del diálogo (para que se diga) y el
  // blueprint (para que los ejercicios pregunten por él y no por otra cosa).
  const isLowLevel = level === Level.Intro || level === Level.Beginner;
  const dataPoint = isLowLevel ? inferDataPoint(topic) : undefined;
  const dataPointInstruction = dataPoint ? DATA_POINTS[dataPoint].instruction : "";

  if (level === Level.Intro) {
    constraint = `
      NIVEL A0 (REALISTA - INMERSIÓN TOTAL):
      - Genera un diálogo 100% NATURAL y FLUIDO entre nativos.
      - VELOCIDAD NORMAL. NO hables lento. NO simplifiques las frases. NO limites el vocabulario.
      - ${dataPointInstruction}
      - El objetivo es que el estudiante capture ese dato específico en un entorno ruidoso/rápido.
      `;
  } else if (level === Level.Beginner) {
    constraint = `
      NIVEL A1-A2: Frases de longitud media, vocabulario frecuente.
      - ${dataPointInstruction}
      - Ese dato tiene que oírse con claridad dentro de la conversación, sin subrayarlo ni repetirlo de forma artificial.
      `;
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

  const blueprint = getBlueprint(level, textType, mode, dataPoint);
  const exerciseLogic = buildExercisePrompt(blueprint);
  const registerInstruction = getRegisterInstruction(textType);

  // LOCALIZACIÓN: el contenido de los escenarios es neutro/panhispánico; aquí se adapta
  // TODO (moneda, tratamiento, léxico, realia) a la variante regional elegida, sin mezclar.
  const localizationInstruction = (mode === AppMode.AccentChallenge)
    ? "LOCALIZACIÓN: cada hablante usa la moneda, el tratamiento y el léxico propios de SU región; no los mezcles entre hablantes."
    : `LOCALIZACIÓN OBLIGATORIA (acento ${accent}): adapta el 100% del contenido a esa región y NUNCA mezcles marcas de otras.
      - Moneda y precios SIEMPRE en la moneda local (no conviertas ni uses símbolos de otra región).
      - Tratamiento (tú/vos/usted/vosotros/ustedes) según la norma del dialecto indicado en CONTEXT.
      - Léxico cotidiano, instituciones, comidas, transporte y realia coherentes con la región (p. ej. auto/coche/carro, departamento/piso, celular/móvil, documento de identidad local).
      - Nombres propios, topónimos y referencias verosímiles para la región.`;

  const jsonStructure = `
  {
    "title": "String",
    "situationDescription": "String",
    "communicativeFunction": "String",
    "ambientKeywords": "String",
    "characters": [{ "name": "String", "gender": "Male" | "Female" }],
    "dialogue": [{ "speaker": "String", "text": "String", "emotion": "String" }],
    "exercises": [
      { "id": "ex1", "slotId": "...", "stage": "...", "skill": "...", "type": "...", "question": "...", "explanation": "...", "sourceTurns": [0], "correctAnswer": "..." }
    ]
  }
  La forma concreta de cada ejercicio depende de su "type": usa exactamente el JSON indicado para ese formato en EXERCISES.
  `;

  // A0 prioriza la naturalidad del habla por encima del recuento de turnos: el
  // objetivo del nivel es captar un dato dentro de habla nativa real.
  const lengthInstruction = (level === Level.Intro)
    ? "LENGTH: natural y fluida; ignora el límite estricto de turnos si corta la naturalidad."
    : `LENGTH: STICK TO ${length}.`;

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
  LOCALIZE: ${localizationInstruction}
  SPEAKERS: ${speakerEmphasis}
  EXERCISES: ${exerciseLogic}
  ${lengthInstruction}
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
      const rawExercises: unknown[] = Array.isArray(plan.exercises) ? plan.exercises : [];

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

      if (attempt > 1) {
        console.log(`[Success] Generated valid dialogue on attempt ${attempt}/${MAX_SPEAKER_RETRIES}`);
      }

      // Se descarta todo ejercicio cuya clave no se sostenga contra la
      // transcripción y se rellenan los slots que queden vacíos con motores
      // deterministas: mejor un ejercicio menos que uno con la respuesta mal.
      plan.exercises = fillMissingSlots(
        verifyExercises(rawExercises, plan.dialogue),
        blueprint,
        plan.dialogue
      );

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
