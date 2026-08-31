
import { GoogleGenAI, GenerateContentParameters, Modality } from "@google/genai";
import { Level, Length, TextType, Accent, LessonPlan, Character, AppMode } from "../types";
import { ExerciseSlot, FORMAT_RULES, getBlueprint, STAGE_META } from "../data/listeningSyllabus";
import { DATA_POINTS, inferDataPoint } from "../data/dataPoints";
import { fillMissingSlots } from "./exerciseEngines";
import { MODEL_SELECTABLE_SCENES, isSceneId } from "./ambiencePresets";
import { verifyExercises } from "./exerciseVerification";
import { checkTwoVoices } from "./ttsVoiceCheck";
import { splitIntoTurns } from "./ttsTurnSplit";
import { parseLenientJson } from "./jsonRepair";
import {
  AUDIO_MODELS,
  GENERATION_MODELS,
  describeModelChainFailure,
  isModelError,
  isQuotaError,
  markSwitchable,
  modelsFrom,
  runWithModelFallback,
  thinkingConfigFor
} from "./modelFallback";
import {
  ProgressListener,
  ProgressReporter,
  formatBytes,
  formatCount,
  formatSeconds
} from "./generationProgress";

// Helper to get key from storage
const getApiKey = (): string => {
  const key = localStorage.getItem('gemini_api_key');
  if (!key) throw new Error("API Key no encontrada. Por favor, reinicia la app e ingrésala.");
  return key;
};

// El modelo de texto ya no es uno solo: `GENERATION_MODELS` (services/modelFallback.ts)
// es una cadena y `GENERATION_MODEL` es solo su primer escalón, el que se
// intenta siempre primero y el que se nombra en la pantalla de carga.
const GENERATION_MODEL = GENERATION_MODELS[0];
// El audio ya no es un modelo suelto: `AUDIO_MODELS` (services/modelFallback.ts)
// es una cadena y `AUDIO_MODEL` es solo su primer escalón —el que se intenta
// siempre primero y el que se nombra en la pantalla de carga—.
const AUDIO_MODEL = AUDIO_MODELS[0];

// `isQuotaError` vivía aquí y ahora vive con el resto de la clasificación de
// errores; se re-exporta porque `scripts/check-audio.mjs` lo importa de aquí.
export { isQuotaError };

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

// PCM crudo devuelto por el TTS: 24 kHz, 16 bits, mono. Sirve para convertir
// bytes recibidos en segundos de audio reales mientras llega el stream.
const TTS_SAMPLE_RATE = 24000;
const TTS_BYTES_PER_SECOND = TTS_SAMPLE_RATE * 2;

/** Techo de caracteres que acepta una petición al modelo de voz. */
const TTS_PROMPT_LIMIT = 5000;

/**
 * Peticiones de voz simultáneas. Con tres en paralelo la API empieza a
 * devolver 429 y 503; con dos aguanta.
 */
const TTS_CONCURRENCY = 2;

/** Fundido en cada unión entre tramos, para que no se oiga un clic. */
const JOIN_FADE_MS = 5;

/**
 * Cada turno viaja en su propio párrafo dentro de la petición de su hablante.
 * No es cosmético: el modelo hace una pausa más marcada entre párrafos que
 * entre frases, y esa pausa es justo la frontera que después hay que encontrar
 * en el audio para volver a intercalar los turnos.
 */
const TURN_JOINER = '\n\n';

/** Silencio que se deja entre dos turnos al montar la conversación. */
const TURN_GAP_MS = 220;

// --- TIMEOUTS ---
//
// Sin esto, una petición que el servidor acepta pero deja colgada (o un stream
// que deja de emitir a mitad) congelaba la pantalla de carga para siempre: es
// el «se queda en recepción del guion y no progresa». Con un `AbortController`
// la espera muerta se convierte en un error que la escalera puede reintentar y,
// si se agota, en un cambio de modelo.

// El primer token tarda más que los siguientes: estos modelos «piensan» antes
// de emitir nada (un prompt trivial ya gasta ~15 s y cientos de tokens de
// pensamiento), y con el prompt entero de una lección puede ser bastante más.
// Ese silencio inicial es legítimo, así que el margen para el PRIMER chunk es
// generoso; una vez que el flujo arranca, un silencio largo sí es un cuelgue.
/** Espera máxima hasta el primer chunk (fase de «pensamiento» del modelo). */
const STREAM_FIRST_CHUNK_MS = 90_000;
/** Sin un chunk en este tiempo **una vez arrancado** el flujo, se da por colgado. */
const STREAM_STALL_MS = 30_000;
/** Tope total de una tentativa de streaming, pase lo que pase. */
const STREAM_TOTAL_MS = 180_000;
/** Tope de la petición no-streaming (texto). */
const REQUEST_TOTAL_MS = 150_000;
/** Espera máxima hasta el primer byte de audio del TTS. */
const AUDIO_FIRST_CHUNK_MS = 60_000;
/** Sin un byte de audio en este tiempo una vez arrancado, se da por colgado. */
const AUDIO_STALL_MS = 30_000;

interface TimeoutGuard {
  signal: AbortSignal;
  /** Marca que llegó un chunk; pasa del margen inicial al de inactividad. */
  ping: () => void;
  /** El error de tiempo si fuimos nosotros quienes abortamos, o `null`. */
  reason: () => Error | null;
  /** Apaga los temporizadores; hay que llamarlo siempre (finally). */
  dispose: () => void;
}

const unref = (timer: unknown): void => {
  // En Node los timers mantienen vivo el bucle de eventos; en el navegador son
  // números y no tienen `unref`. Así el proceso de los tests no queda colgado.
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
};

function createTimeoutGuard(opts: { firstChunkMs?: number; stallMs?: number; totalMs?: number }): TimeoutGuard {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let abortReason: Error | null = null;
  let started = false;

  const abortWith = (message: string) => {
    if (controller.signal.aborted) return;
    abortReason = new Error(message);
    // `abort(reason)` no está en navegadores antiguos; el `reason()` que
    // guardamos aquí es la fuente de verdad de todos modos.
    try { controller.abort(abortReason); } catch { controller.abort(); }
  };

  const armIdle = () => {
    // Antes del primer chunk se aplica el margen de «pensamiento»; después, el
    // de inactividad, más corto.
    const ms = started ? opts.stallMs : (opts.firstChunkMs ?? opts.stallMs);
    if (!ms) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => abortWith(
        started
          ? `el modelo no envió datos en ${Math.round(ms / 1000)} s`
          : `el modelo no empezó a responder en ${Math.round(ms / 1000)} s`
      ),
      ms
    );
    unref(idleTimer);
  };

  if (opts.totalMs) {
    totalTimer = setTimeout(
      () => abortWith(`la generación superó el tiempo máximo (${Math.round(opts.totalMs! / 1000)} s)`),
      opts.totalMs
    );
    unref(totalTimer);
  }
  armIdle();

  return {
    signal: controller.signal,
    ping: () => { started = true; armIdle(); },
    reason: () => abortReason,
    dispose: () => { clearTimeout(idleTimer); clearTimeout(totalTimer); }
  };
}

/** Añade un `abortSignal` (y opcionalmente un timeout HTTP) sin mutar `params`. */
function withSignal(
  params: GenerateContentParameters,
  signal: AbortSignal,
  timeoutMs?: number
): GenerateContentParameters {
  return {
    ...params,
    config: {
      ...params.config,
      abortSignal: signal,
      ...(timeoutMs
        ? { httpOptions: { ...(params.config?.httpOptions ?? {}), timeout: timeoutMs } }
        : {})
    }
  };
}

// --- HELPERS ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Recorta un mensaje de error para el registro de la pantalla de carga.
 *
 * Los errores de la API llegan como un JSON dentro de otro JSON: el 503 de
 * saturación ocupa unos 250 caracteres escapados de los que solo importa la
 * primera línea.
 */
const briefly = (text: string, max = 140): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * Pide la respuesta en streaming para poder medir lo que va llegando.
 *
 * Antes esto era una llamada opaca envuelta en `withRetry`: la app no sabía
 * nada entre el envío y la respuesta completa, así que la pantalla de carga no
 * tenía más remedio que inventarse el avance. Con el stream, cada chunk es un
 * hecho observable (caracteres, turnos, ejercicios) que se reporta tal cual.
 *
 * Se conservan los dos intentos con espera creciente del código anterior; tras
 * ellos cae a la llamada no-streaming para que un modelo o una red que no
 * admitan streaming no rompan la generación.
 *
 * Esa escalera es para los fallos del *momento* (red, stream cortado, respuesta
 * vacía). Los fallos del *modelo* salen de aquí inmediatamente y los resuelve
 * `runWithModelFallback` bajando un escalón de la cadena: repetir tres veces
 * contra un modelo saturado es exactamente lo que dejaba la app sin generar.
 */
export async function generateJsonWithProgress(
  ai: GoogleGenAI,
  params: GenerateContentParameters,
  hooks: {
    onText: (full: string) => void;
    onRetry: (attempt: number, received: number, reason: string) => void;
    onFallback: (reason: string) => void;
    // Mientras el modelo «piensa» y aún no ha emitido nada, para que la pantalla
    // no parezca congelada («se queda en recepción del guion y ni progresa»).
    onWaiting?: (elapsedMs: number) => void;
  }
): Promise<string> {
  const STREAM_ATTEMPTS = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= STREAM_ATTEMPTS; attempt++) {
    let accumulated = '';
    const guard = createTimeoutGuard({
      firstChunkMs: STREAM_FIRST_CHUNK_MS,
      stallMs: STREAM_STALL_MS,
      totalMs: STREAM_TOTAL_MS
    });
    // Latido mientras se espera el primer chunk: el modelo puede pensar decenas
    // de segundos antes de emitir, y sin esto la barra se ve parada.
    const waitStart = Date.now();
    let beating = true;
    const heartbeat = setInterval(() => {
      if (beating) hooks.onWaiting?.(Date.now() - waitStart);
    }, 2500);
    unref(heartbeat);
    const stopBeat = () => { beating = false; clearInterval(heartbeat); };
    try {
      const stream = await ai.models.generateContentStream(withSignal(params, guard.signal));
      for await (const chunk of stream) {
        guard.ping(); // llegó algo: el stream no está colgado
        stopBeat();
        const delta = chunk.text ?? '';
        if (!delta) continue;
        accumulated += delta;
        hooks.onText(accumulated);
      }
      if (!accumulated.trim()) throw new Error('la API devolvió una respuesta vacía');
      return accumulated;
    } catch (error) {
      // Si fuimos nosotros quienes abortamos, el `AbortError` del SDK no dice
      // nada útil: se sustituye por el motivo real (inactividad o tope total).
      const actual = guard.reason() ?? error;
      // Sin cuota, reintentar solo gasta más cuota; saturado, reintentar en
      // 500 ms no cambia nada. Los dos casos los arregla otro modelo, no otra
      // vuelta de esta escalera. La red y los timeouts sí se reintentan aquí.
      if (isModelError(actual)) throw actual;
      lastError = actual;
      hooks.onRetry(attempt, accumulated.length, errorMessage(actual));
      await sleep(500 * attempt);
    } finally {
      stopBeat();
      guard.dispose();
    }
  }

  hooks.onFallback(errorMessage(lastError));
  const guard = createTimeoutGuard({ totalMs: REQUEST_TOTAL_MS });
  try {
    const response = await ai.models.generateContent(withSignal(params, guard.signal, REQUEST_TOTAL_MS));
    const text = response.text;
    if (!text || !text.trim()) {
      throw lastError instanceof Error ? lastError : new Error('la API devolvió una respuesta vacía');
    }
    hooks.onText(text);
    return text;
  } catch (error) {
    const actual = guard.reason() ?? error;
    if (isModelError(actual)) throw actual;
    // Agotada la escalera contra este modelo por red o timeout: ya no es un
    // corte transitorio de un intento, así que se marca conmutable para que la
    // cadena baje al siguiente modelo en vez de rendirse. Un corte de red suelto
    // (sin pasar por aquí) sigue sin cambiar de modelo.
    throw markSwitchable(lastError instanceof Error ? lastError : actual);
  } finally {
    guard.dispose();
  }
}

// --- BASE64 <-> BYTES (audio en streaming) ---
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Por trozos: `String.fromCharCode(...bytes)` revienta la pila con audio largo.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// El saneado del JSON del modelo vive ahora en `services/jsonRepair.ts`
// (`parseLenientJson`): además de quitar las vallas markdown, repara los fallos
// que el modelo comete de verdad en respuestas largas en lugar de reventar.

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
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
• PITCH: Moderate range, natural rising-falling patterns
• STATEMENTS: Start mid, rise slightly, fall at end
• QUESTIONS: Gentle rise at final syllable
• ATTITUDE: Plain and matter-of-fact, like ordinary everyday conversation`,

  [Accent.Andalusia]: `[TTS VOICE DIRECTIVE: ANDALUSIAN SPANISH - SEVILLE/CÁDIZ, WESTERN ANDALUSIA]
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
• TEMPO: Fairly quick, 6-7 syllables/second, flowing
• RHYTHM: Stress-timed, words blend together
• PITCH: Gently musical, natural sing-song lilt — not exaggerated
• VOWELS: May lengthen to compensate for lost consonants
• ATTITUDE: Warm and friendly, in a relaxed everyday way`,

  [Accent.MexicoCity]: `[TTS VOICE DIRECTIVE: MEXICAN SPANISH - MEXICO CITY (CDMX/CHILANGO)]
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
• RHYTHM: Gentle sing-song (cantadito), natural and understated
  - Rises and falls like gentle hills
  - Each phrase has a soft melodic arc
• PITCH: Moderate range, softly musical
• ARTICULATION: Clear but relaxed, never clipped or over-enunciated
• VOWELS: Pure, clear, no reduction

═══════════════════════════════════════════════════════════════════════════════
ATTITUDE & REGISTER
═══════════════════════════════════════════════════════════════════════════════
• Polite and courteous
• Soft-spoken, never aggressive
• Frequent use of "usted" even informally
• Characteristic phrases: "con mucho gusto", "a la orden", "qué pena"`,

  [Accent.Caribbean]: `[TTS VOICE DIRECTIVE: CARIBBEAN SPANISH - PUERTO RICO/CUBA]
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
• TEMPO: Quick, 6+ syllables/second
• RHYTHM: Musical, with a natural percussion-like cadence
• Words flow together rapidly
• Natural, lively pitch changes — not overplayed
• Gentle rises in questions
• ATTITUDE: Warm and easygoing, like relaxed everyday talk`,

  [Accent.BuenosAires]: `[TTS VOICE DIRECTIVE: ARGENTINE SPANISH - BUENOS AIRES (RIOPLATENSE/PORTEÑO)]
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL CONSONANT RULE #1: SHEÍSMO - THE [ʃ] SOUND
═══════════════════════════════════════════════════════════════════════════════

The letters "ll" and "y" (when not vowel) are pronounced as [ʃ] -
the voiceless postalveolar fricative, like English "sh" in "ship/show".

This is the #1 defining feature of Buenos Aires Spanish, and it should sound
effortless and native, not forced. Younger speakers use [ʃ] (voiceless);
older speakers may use [ʒ] (voiced, like "measure").

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

Do not pronounce "y" as in English "yes"; the sound is "sh" as in "ship/show".

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
• TEMPO: Moderate, naturally expressive
• INTONATION: Gentle rises and falls with a slight Italian lilt
  - A soft melodic quality, kept understated
  - Moderate pitch range, natural not theatrical
  - Questions rise at the end, without overdoing it
• VOWELS: Final vowels may be slightly elongated
• OPEN "e": [ɛ] in stressed syllables

═══════════════════════════════════════════════════════════════════════════════
VOSEO - PRONOUN SYSTEM
═══════════════════════════════════════════════════════════════════════════════
Use "VOS" not "tú": "vos tenés", "vos querés", "vos sabés"
Characteristic: "che", "dale", "viste", "boludo"`,

  [Accent.Santiago]: `[TTS VOICE DIRECTIVE: CHILEAN SPANISH - SANTIAGO]
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
Native pronunciation guide — apply it naturally, the way a local really talks, without over-articulating.

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
      // El número de columnas vivía sólo en la prosa del brief, así que el
      // modelo podía devolver una escala de tres puntos donde el presupuesto de
      // lectura contaba cuatro. Aquí es un dato del slot, no una sugerencia.
      const columns = slot.columns ? ` | ${slot.columns} columnas` : '';
      return `  ${i + 1}. slotId="${slot.slotId}" | etapa="${slot.stage}" (${stage}) | habilidad="${slot.skill}" | type="${slot.format}" | ${slot.items} ítems${columns}\n     ${slot.brief}`;
    })
    .join('\n');

  return `SIN PRODUCCIÓN: el alumno no compone nada. Todo se resuelve seleccionando, ordenando, clasificando o eligiendo en un desplegable. Prohibidas las preguntas abiertas, los resúmenes y las opiniones libres. ÚNICA excepción, y sólo si aparece abajo entre los formatos: "dictation", donde el alumno ESCRIBE el dato que acaba de oír — anotar un teléfono dictado es transcribir, no redactar.

PRINCIPIOS INNEGOCIABLES:
- Todo ejercicio se responde ESCUCHANDO. Si se puede acertar leyendo las opciones, razonando por plausibilidad temática o descartando lo absurdo, el ejercicio está mal hecho.
- Todo lo que presentes como dicho en el audio debe estar dicho en el audio, con su ortografía real (tildes y mayúsculas incluidas).
- Cada ejercicio incluye "sourceTurns": el array de índices (base 0) de los turnos del diálogo en los que se apoya.
- Todas las opciones, filas, columnas y campos llevan "id" único, y "correctAnswer" SIEMPRE referencia esos ids, nunca textos. Excepción: en "dictation" no hay ids y "correctAnswer" es el texto del dato.
- Redacta enunciados y opciones en español, adaptados a la variante regional indicada.
- La "explanation" es una sola frase breve. No repitas el enunciado ni cites el diálogo entero.

FORMATOS QUE DEBES USAR:
${formatBlock}

GENERA EXACTAMENTE ESTOS ${slots.length} EJERCICIOS, EN ESTE ORDEN, cada uno con su "slotId" copiado tal cual (la etapa y la habilidad las fija el sistema por la posición; NO las incluyas en el JSON):
${slotBlock}

Devuélvelos en el array "exercises" en ese mismo orden y sólo con los campos del formato indicado.`;
};

/**
 * El principio que ata el tono a la SITUACIÓN, no al acento, y que impide que
 * el perfil dialectal empuje jerga donde la escena pide respeto.
 *
 * El síntoma que arregla: en una consulta médica, un trámite o una atención al
 * cliente aparecían "che" y lunfardo porque el `REGISTER` genérico del diálogo
 * "PERMITÍA coloquialismos y léxico dialectal del acento" sin condición, y esa
 * línea pesaba más que el registro fino de la escena (que además iba enterrado
 * dentro de `Tema:`). Lo regional tiene que oírse en cómo se pronuncia y se
 * conjuga, no en las muletillas: así la variante se mantiene sin romper el tono.
 *
 * El segundo síntoma, el que motiva esta revisión: las muletillas NO son un
 * bloque único. Los marcadores del discurso neutros ("bueno", "o sea", "la
 * verdad", "a ver", "es que", "mire/mirá") son habla natural en casi cualquier
 * registro y solo hay que dosificarlos; los apelativos y el argot marcados
 * ("güey", "boludo/a", "weón", "tío/a", "chido"…) son EXCLUSIVOS del trato entre
 * pares. Meter "mucho güey en la entrevista de trabajo" o un "boludo" en la
 * consulta rompe el registro aunque el trato de usted se respete. La regla no es
 * prohibir las muletillas —eso vuelve a sonar a manual— sino ESCALAR su cantidad
 * y su fuerza con la formalidad de la escena.
 */
const REGISTER_CONSISTENCY =
  'REGISTRO Y VARIANTE: el tono lo fija la SITUACIÓN. Lo regional se oye en la PRONUNCIACIÓN, la gramática ' +
  '(voseo/tuteo/ustedeo), el léxico cotidiano y la realia, NO en la carga de argot. Las muletillas y apelativos ' +
  'se ESCALAN con el registro, en dos niveles: (1) marcadores del discurso neutros ("bueno", "o sea", "la verdad", ' +
  '"a ver", "es que", "digamos", "mire/mirá", "¿no?") — naturales con medida en casi cualquier escena hablada, ' +
  'incluso semiformal; en lo muy formal, pocos y sobrios. (2) Apelativos y argot marcados de la variante ("che", ' +
  '"boludo/a", "weón", "cachái", "güey", "tío/a", "po", "pana", "chido", "guay", "bacán", "chévere"…) — SOLO en ' +
  'escenas DISTENDIDAS entre pares (amigos, familia, confianza, gente joven): ahí el registro natural ES el ' +
  'coloquial y hay que usarlos CON SOLTURA, sin eso el diálogo suena a manual, cuidando solo de no amontonarlos ' +
  'ni volverlos caricatura. En trato de SERVICIO, jerárquico, profesional, sanitario, administrativo o ' +
  'institucional (una entrevista de trabajo, una consulta médica, una gestión en ventanilla) se mantiene el trato ' +
  'de respeto (usted donde corresponda) y quedan FUERA el argot y los apelativos marcados: nada de "güey", ' +
  '"boludo" ni "weón" ahí, por natural que suene entre amigos. Que la escena sea "cercana" o "de confianza" es ' +
  'calidez y cortesía, NO licencia para el argot. Las groserías fuertes, solo si el tema lo pide explícitamente. ' +
  'Siempre natural y coherente con la escena.';

/**
 * La naturalidad del HABLA, no del registro: cómo se escribe lengua hablada real
 * en vez de lengua escrita leída en voz alta. El síntoma que arregla es el que
 * motiva todo este cambio —"suenan raras, no naturales"—: los diálogos salían
 * gramaticalmente perfectos, con frases completas y equilibradas, sin una
 * muletilla ni una reacción, y eso no es como habla nadie. Va en TODOS los modos
 * (pegado a REGISTER) porque la naturalidad no depende del escenario. El nivel y
 * REGISTER siguen mandando: en A0/A1 la naturalidad está en el ritmo y las
 * fórmulas cotidianas, no en jerga oscura; en trato de respeto no hay argot.
 */
const SPOKEN_NATURALNESS =
  'HABLA REAL (naturalidad, IMPORTANTE): esto es lengua HABLADA y espontánea, no lengua escrita leída en voz alta. ' +
  'Escribe como habla de verdad la gente de esa región, con el ritmo y las pequeñas imperfecciones de la conversación viva: ' +
  '(a) Muletillas y marcadores del discurso propios de la variante, con medida y DOSIFICADOS SEGÚN EL REGISTRO (ver ' +
  'REGISTRO Y VARIANTE): los neutros ("o sea", "bueno", "pues", "mira/mirá", "es que", "la verdad", "digamos", "a ver", ' +
  '"¿viste?/¿sabés?/¿sabes?/¿no?") caben incluso en lo semiformal; los apelativos y el argot marcados ("güey", "boludo", ' +
  '"weón", "tío", "dale/órale"…) SOLO entre pares, nunca en una escena formal (entrevista, consulta, trámite). ' +
  '(b) Reacciones y respuestas breves de escucha ("claro", "ajá", "ya", "sí, sí", "totalmente", "uf", "qué va"). ' +
  '(c) Frases a veces incompletas, reformulaciones, arranques en falso y elipsis: no todas las réplicas cerradas y perfectas. ' +
  '(d) Contracciones y habla ligada naturales de la región donde no estorben la comprensión del nivel. ' +
  '(e) Interjecciones, énfasis y algo de calidez emocional. ' +
  'Que suene a personas concretas hablando entre ellas, con la informalidad que pida la escena, nunca a un texto recitado. ' +
  'La naturalidad en una escena formal está en el ritmo, la cortesía y las reformulaciones, no en el argot.';

const getRegisterInstruction = (textType: TextType): string => {
  switch (textType) {
    case TextType.RadioNews:
      return `REGISTRO NOTICIERO: Formal, neutro, objetivo e impersonal. Frases completas y tono informativo. PROHIBIDO: lunfardo, jerga, coloquialismos, muletillas, chistes, ironías, insultos o palabras como "weón", "güey", "boludo".`;
    case TextType.PodcastInterview:
      return `REGISTRO PODCAST-ENTREVISTA: Conversacional y cercano, como una charla de verdad. Entrevistador con cortesía relajada; entrevistado espontáneo y natural, que se explaya con soltura. PERMITIDO: coloquialismos y expresiones dialectales propias de la variante, muletillas y marcadores de charla con medida. PROHIBIDO: insultos y groserías fuertes; que no suene a comunicado leído.`;
    case TextType.Monologue:
      return `REGISTRO MONÓLOGO/STORYTELLING: Narrativo cuidado y coherente. Puede ser cercano si es personal, pero con dicción clara. PERMITIDO: coloquialidad moderada y rasgos dialectales suaves si el contexto lo justifica. PROHIBIDO: jerga fuerte o insultos; no saturar con muletillas.`;
    case TextType.Dialogue:
    default:
      return `REGISTRO DIÁLOGO: Conversación natural entre nativos, con la formalidad que pida la situación: trato de respeto en jerarquía/servicio/trámite/consulta profesional; entre pares, informal y coloquial DE VERDAD —con las muletillas, expresiones y el argot suave de la región, con calidez y espontaneidad—, no un intercambio de frases de manual. Los rasgos del acento (pronunciación, gramática, léxico y realia) son siempre bienvenidos; las groserías fuertes, solo si el tema lo exige explícitamente.`;
  }
};

/**
 * Separa la situación del registro fino de la escena. El selector de escenarios
 * (Standard) manda el registro preciso de cada lugar (`ScenarioContext.registerInstruction`)
 * pegado al tema con el marcador `|| Registro: …`. Ese registro es lo que debe
 * gobernar el tono, así que aquí se extrae para: (a) dejar el `Tema:` limpio y
 * (b) elevarlo a directiva `REGISTER` autoritativa en vez de dejarlo enterrado.
 */
const REGISTER_MARKER = '|| Registro:';
const extractScenarioRegister = (topic: string): { topic: string; register: string | null } => {
  const idx = topic.indexOf(REGISTER_MARKER);
  if (idx === -1) return { topic: topic.trim(), register: null };
  const register = topic.slice(idx + REGISTER_MARKER.length).trim();
  return {
    topic: topic.slice(0, idx).replace(/\s*\|\|\s*$/, '').trim(),
    register: register.length > 0 ? register : null
  };
};

/**
 * Compone la directiva REGISTER final: la base del formato, el registro concreto
 * de la escena (si lo hay, y manda sobre la base), y el principio de consistencia
 * que rige en todos los modos —incluidos Vocabulario, AccentChallenge y tema libre,
 * donde no hay escenario del que sacar registro pero el tono igual debe ir con la
 * situación—.
 */
const composeRegisterInstruction = (textType: TextType, scenarioRegister: string | null): string => {
  const base = getRegisterInstruction(textType);
  const scene = scenarioRegister
    ? ` REGISTRO DE ESTA SITUACIÓN (manda sobre lo anterior): ${scenarioRegister}`
    : '';
  return `${base}${scene} ${REGISTER_CONSISTENCY} ${SPOKEN_NATURALNESS}`;
};

/**
 * Reparte el registro global (REGISTER, que fija el tono de la SITUACIÓN) en un
 * perfil de tono por HABLANTE, para que cada personaje suene igual a sí mismo de
 * principio a fin en vez de que la coherencia dependa turno a turno.
 *
 * El síntoma que arregla: REGISTER fija el tono de la escena, pero nada obligaba a
 * que un mismo hablante lo mantuviera —una empleada podía abrir con trato de usted
 * y deslizarse al tuteo, o un cliente cordial endurecerse sin motivo— porque el
 * único control por turno era `emotion`, libre y sin ancla. Ahora cada personaje
 * declara su tono en `characters[].tone` (una vez), ese tono gobierna todos sus
 * turnos, y `emotion` pasa a ser solo una modulación momentánea, nunca un cambio de
 * registro. El campo viaja además al TTS (`singleVoiceDirective`) para que la voz se
 * lea con ese carácter. El tono de cada hablante NUNCA contradice REGISTER: es su
 * concreción por persona (rol, trato y línea emocional), no una licencia para
 * saltárselo.
 */
const SPEAKER_TONE_INSTRUCTION =
  'TONO POR HABLANTE (coherencia de personaje): a cada personaje de "characters" asígnale un campo ' +
  '"tone" con su tono y registro CONSTANTES, derivados de su ROL en la situación y SIEMPRE dentro de ' +
  'REGISTER (nunca lo contradice). En 4–12 palabras: manera de hablar, formalidad del trato ' +
  '(tú/vos/usted según LOCALIZE) y línea emocional de base — p. ej. "empleada cordial y servicial, ' +
  'trato de usted, calmada" o "cliente apurado pero educado, informal respetuoso". Mantén ese tono en ' +
  'TODOS los turnos de ese hablante: el "emotion" de cada turno es solo una modulación momentánea de su ' +
  'tono base (más animado, dubitativo, aliviado…), nunca un cambio de registro ni de trato. Dos ' +
  'personajes de la misma escena pueden —y suelen— tener tonos distintos, pero cada uno es consistente ' +
  'consigo mismo.';

// --- PROGRESO MEDIBLE DE LA FASE 1 ---

/**
 * Pasos reportados durante la generación del guion. Los pesos son la cuota de
 * la fase que representa cada paso; lo que hace avanzar la barra dentro de cada
 * uno es SIEMPRE una medida (turnos, ejercicios, descartes), nunca un temporizador.
 */
const PLAN_STEPS = [
  { id: 'blueprint', label: 'Plan pedagógico', weight: 3, atomic: true },
  { id: 'prompt', label: 'Composición del prompt', weight: 2, atomic: true },
  { id: 'dialogue', label: 'Recepción del guion', weight: 35 },
  { id: 'exercises', label: 'Recepción de los ejercicios', weight: 45 },
  { id: 'parse', label: 'Validación de la estructura', weight: 3, atomic: true },
  { id: 'verify', label: 'Verificación de claves', weight: 6, atomic: true },
  { id: 'assemble', label: 'Montaje de la lección', weight: 6, atomic: true }
];

/**
 * Turnos que el prompt le pide al modelo en cada duración. Es el único
 * denominador real que existe para el guion, y solo se usa donde se pide de
 * verdad: en A0 el prompt le dice explícitamente al modelo que lo ignore, así
 * que ahí ese paso se declara no medible en vez de fingir un porcentaje.
 */
const REQUESTED_TURNS: Record<Length, number> = {
  [Length.Short]: 6,
  [Length.Medium]: 12,
  // "14+ turnos": con el denominador en 14 la barra llegaba al 100 % en cuanto
  // entraba el turno catorce y se quedaba ahí el resto del guion.
  [Length.Long]: 16
};

/**
 * Cómo tiene que ENTREGARSE el dato dictado, y no sólo cuál es.
 *
 * Todo lo que hay aguas abajo del audio exige que el dato suene entero, de
 * corrido y dentro de UN SOLO turno: el verificador lo rechaza si no
 * (`verifyDictation`) y los cosechadores trabajan turno a turno, así que un dato
 * repartido entre dos réplicas no existe para ninguno de los dos. Esa exigencia
 * estaba escrita únicamente en `FORMAT_RULES.dictation.guidance`, que gobierna a
 * quien redacta los EJERCICIOS y no a quien redacta el DIÁLOGO — y el bloque del
 * diálogo, mientras tanto, pedía un guion "100% NATURAL y FLUIDO", que es
 * exactamente lo que invita al eco de confirmación ("—Es seis, cinco, cuatro…
 * —¿Seis cinco cuatro? —Treinta y dos, dieciocho.") y a la autocorrección. Con el
 * dato partido el motor no encuentra material, la clave del modelo tampoco se
 * oye de corrido, y la tarjeta central del nivel desaparece.
 *
 * La comparten A0 y A1-A2 porque los dos llevan un slot `dictation` (`a0-dato`,
 * `a2-dato`) y por tanto el mismo requisito.
 */
const DICTATION_DELIVERY =
  'EL DATO SUENA ENTERO Y DE CORRIDO DENTRO DE UN SOLO TURNO: nadie lo interrumpe a mitad, ' +
  'nadie lo repite a trozos y nadie lo corrige mientras se dice. Puede confirmarse DESPUÉS, ' +
  'entero, pero tiene que haber al menos una vez en que suene completo en un mismo turno.';

/**
 * Siembra del tercer ejercicio de A0 (`a0-pares`, discriminación fónica).
 *
 * El motor de pares mínimos necesita al menos tres palabras del diálogo de cuatro
 * letras o más, que no sean cifras ni palabras vacías, que tengan pareja en
 * `MINIMAL_PAIR_BANK` y **cuya pareja no se diga también** — si las dos suenan, el
 * ítem no tiene respuesta y se descarta. Nada en el prompt pedía ese léxico, así
 * que cuando el diálogo no lo traía por casualidad la tarjeta caía a vecinos
 * generados (que pueden ser no-palabras: "número" → "númera") o desaparecía.
 *
 * No se nombra el ejercicio a propósito: el diálogo y los ejercicios salen de la
 * misma completion, y mencionarlo invita al modelo a meter la pareja en el guion
 * para "dar la pista", que es justo lo que lo invalida.
 */
const A0_LEXICON =
  'LÉXICO: usa palabras cotidianas de dos sílabas o más que tengan un vecino fónico en español ' +
  '(perro, carro, pata, peso, mesa, cara, mano, casa, banco, carta, cuenta, puerta, libro, sala, ' +
  'gato…), y NO metas en el mismo diálogo la pareja de ninguna de ellas.';

const SPEAKER_KEY = /"speaker"\s*:/;
const SLOT_KEY = /"slotId"\s*:/;
const QUESTION_KEY = /"question"\s*:/;
const EXERCISES_KEY = /"exercises"\s*:/;
const TITLE_VALUE = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/;

const countMatches = (text: string, pattern: RegExp): number => {
  const re = new RegExp(pattern.source, 'g');
  let count = 0;
  while (re.exec(text) !== null) count++;
  return count;
};

const plural = (n: number, singular: string, pluralForm: string) =>
  `${formatCount(n)} ${n === 1 ? singular : pluralForm}`;

// --- MAIN GENERATOR ---

/**
 * En el límite diálogo→ejercicios del stream (el JSON ya trae title+characters+
 * dialogue y acaba de abrir "exercises"), intenta extraer un diálogo YA
 * despachable para arrancar el TTS en paralelo con la cola del plan. Parsea solo
 * el prefijo cerrado (todo lo anterior a "exercises"). Devuelve `null` —y el audio
 * sale luego en secuencia, como siempre— si:
 *   - el prefijo aún no parsea (llegó cortado a mitad de un valor),
 *   - no hay turnos de diálogo, o
 *   - el diálogo excede el tope de hablantes (será rechazado y regenerado por el
 *     reintento de número de hablantes, así que no hay que gastar TTS todavía).
 * Es una función pura para poder fijarla offline sin tocar la red.
 */
export function extractDispatchableDialogue(
  full: string,
  speakerCap: number
): { dialogue: LessonPlan['dialogue']; characters: Character[] } | null {
  const cut = full.lastIndexOf('"exercises"');
  if (cut <= 0) return null;
  const prefix = full.slice(0, cut).replace(/,\s*$/, '') + '}';
  try {
    const { value: partial } = parseLenientJson<LessonPlan>(prefix);
    const dialogue = Array.isArray(partial?.dialogue) ? partial.dialogue : [];
    const characters = Array.isArray(partial?.characters) ? partial.characters : [];
    const speakers = new Set(dialogue.map(d => d.speaker?.trim()).filter(Boolean));
    if (dialogue.length > 0 && speakers.size > 0 && speakers.size <= speakerCap) {
      return { dialogue, characters };
    }
  } catch {
    // Prefijo aún no parseable: se ignora.
  }
  return null;
}

export const generateLessonPlan = async (
  level: Level,
  topic: string,
  length: Length,
  textType: TextType,
  accent: Accent,
  mode: AppMode,
  onProgress?: ProgressListener,
  /**
   * Instrucciones libres del usuario. Se siguen con la mayor libertad posible.
   * En los ejercicios son ADITIVAS y el verificador y los motores deterministas
   * siguen filtrando la salida, así que aunque el usuario pida algo que rompa una
   * invariante de corrección (producción escrita, una clave que no se oye…), como
   * mucho se pierde un ejercicio y nunca se cuela uno falso. En el guion pueden
   * ampliar incluso el número de hablantes por encima del habitual (uno/dos): el
   * tope duro solo se levanta hasta `MAX_SPEAKERS` cuando hay un prompt de audio,
   * y el modelo solo lo supera si el propio usuario lo pide (ver SPEAKERS).
   */
  customPrompts?: { audio?: string; exercises?: string },
  /**
   * Enganches de orquestación. `onDialogueReady` se dispara UNA sola vez, en cuanto
   * el diálogo termina de llegar por el stream (antes de que se emitan/verifiquen los
   * ejercicios), para que quien llama pueda arrancar el TTS en paralelo con la cola
   * del plan. Sólo se dispara sobre un diálogo ya bien formado y dentro del tope de
   * hablantes, así que nunca coincide con el reintento por exceso de hablantes.
   */
  hooks?: { onDialogueReady?: (dialogue: LessonPlan['dialogue'], characters: Character[]) => void }
): Promise<LessonPlan> => {

  const reporter = new ProgressReporter('plan', PLAN_STEPS, onProgress);
  reporter.start('blueprint');

  // DYNAMIC INSTANTIATION WITH STORED KEY
  const ai = getAi();

  // El registro fino de la escena viaja pegado al tema (`… || Registro: …`).
  // Se separa aquí: el `Tema:` queda limpio (lugar + situación) y el registro
  // pasa a gobernar la directiva REGISTER en vez de competir enterrado con ella.
  const { topic: situationTopic, register: scenarioRegister } = extractScenarioRegister(topic);

  let profileInstruction = "";
  let finalTopic = situationTopic;
  let numSpeakers = (textType === TextType.RadioNews || textType === TextType.Monologue) ? 1 : 2;

  // REGLAS ESPECÍFICAS DE NIVEL
  let constraint = "";
  // El dato obligatorio de la situación se decide UNA vez y viaja a los dos
  // sitios que lo necesitan: el prompt del diálogo (para que se diga) y el
  // blueprint (para que los ejercicios pregunten por él y no por otra cosa).
  const isLowLevel = level === Level.Intro || level === Level.Beginner;
  const dataPoint = isLowLevel ? inferDataPoint(situationTopic) : undefined;
  const dataPointInstruction = dataPoint ? DATA_POINTS[dataPoint].instruction : "";

  if (level === Level.Intro) {
    constraint = `
      NIVEL A0 (REALISTA - INMERSIÓN TOTAL):
      - Genera un diálogo 100% NATURAL y FLUIDO entre nativos.
      - VELOCIDAD NORMAL. NO hables lento. NO simplifiques las frases. NO limites el vocabulario.
      - ${dataPointInstruction}
      - ${DICTATION_DELIVERY}
      - El objetivo es que el estudiante capture ese dato específico en un entorno ruidoso/rápido.
      - ${A0_LEXICON}
      `;
  } else if (level === Level.Beginner) {
    constraint = `
      NIVEL A1-A2: Frases de longitud media, vocabulario frecuente.
      - ${dataPointInstruction}
      - ${DICTATION_DELIVERY}
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
    profileInstruction = `${baseProfile}. OBJETIVO: DENSIDAD LÉXICA ALTA sobre "${situationTopic}". AMBOS HABLANTES USAN ESTE ACENTO.`;

  } else {
    const baseProfile = DIALECT_PROFILES[accent];
    profileInstruction = `${baseProfile}. CONSISTENCIA: AMBOS HABLANTES SON NATIVOS DE ESTA REGIÓN. Prohibido mezclar con neutro.`;
  }

  const blueprint = getBlueprint(level, textType, mode, dataPoint, length);
  const customAudioPrompt = customPrompts?.audio?.trim();
  const customExercisePrompt = customPrompts?.exercises?.trim();
  // El tope duro de hablantes solo se levanta cuando el usuario escribió un
  // prompt de audio. Aun así el modelo solo pasa de dos si el prompt lo pide
  // explícitamente: por defecto se le sigue exigiendo el número de siempre.
  const allowMoreSpeakers = Boolean(customAudioPrompt);
  const exerciseLogic = buildExercisePrompt(blueprint) + (customExercisePrompt
    ? `\n\nPREFERENCIAS DEL USUARIO PARA LOS EJERCICIOS: aplícalas con la mayor libertad posible al contenido, el enfoque, la dificultad y los ejemplos. El sistema fija cuántos ejercicios hay y de qué formato, etapa y habilidad es cada uno (eso no lo cambies); dentro de ese marco, adapta todo lo que puedas a estas preferencias. Los únicos principios innegociables son de corrección: nada de producción escrita u oral, y ninguna clave que no se oiga en el audio. Preferencias: ${customExercisePrompt}`
    : '');
  const registerInstruction = composeRegisterInstruction(textType, scenarioRegister);

  const stageCount = new Set(blueprint.map(slot => slot.stage)).size;
  reporter.finish(
    'blueprint',
    `${plural(blueprint.length, 'ejercicio previsto', 'ejercicios previstos')} · ${plural(stageCount, 'etapa', 'etapas')}` +
      (dataPoint ? ` · dato obligatorio: ${DATA_POINTS[dataPoint].fieldLabel}` : '')
  );
  reporter.log(
    `Blueprint ${level} / ${textType}: ${blueprint.map(slot => slot.format).join(', ')}`,
    'info'
  );

  // LOCALIZACIÓN: el contenido de los escenarios es neutro/panhispánico; aquí se adapta
  // TODO (moneda, tratamiento, léxico, realia) a la variante regional elegida, sin mezclar.
  const localizationInstruction = (mode === AppMode.AccentChallenge)
    ? "LOCALIZACIÓN: cada hablante usa la moneda, el tratamiento y el léxico propios de SU región; no los mezcles entre hablantes."
    : `LOCALIZACIÓN OBLIGATORIA (acento ${accent}): adapta el 100% del contenido a esa región y NUNCA mezcles marcas de otras.
      - Moneda y precios SIEMPRE en la moneda local (no conviertas ni uses símbolos de otra región).
      - Tratamiento (tú/vos/usted/vosotros/ustedes) según la norma del dialecto indicado en CONTEXT.
      - Léxico cotidiano, instituciones, comidas, transporte y realia coherentes con la región (p. ej. auto/coche/carro, departamento/piso, celular/móvil, documento de identidad local).
      - Nombres propios, topónimos y referencias verosímiles para la región.`;

  // El JSON se pide sin sangría (no pretty-print): en una lección Largo la
  // sangría y los saltos de línea eran ~1/4 de la salida, y la salida es lo que
  // marca el tiempo de generación (el modelo decodifica ~400 car/s). Eso es todo
  // lo que se le pide de compacidad y nada más.
  //
  // Lo que NO se le pide es que "minifique" quitando los espacios entre tokens:
  // esa instrucción (la del PR anterior) sacaba al modelo del patrón de JSON que
  // sabe generar bien y le hacía perder la cuenta de comas y comillas, sobre todo
  // a los modelos de reserva más flojos. El resultado era JSON inválido → la
  // lección se regeneraba entera (2/3, 3/3): lento Y con error. El ahorro de esos
  // espacios (uno por coma/dos-puntos) es marginal; el coste de un JSON roto es
  // una generación completa. La VALIDEZ manda sobre la compacidad.
  //
  // Los ejercicios NO llevan "stage", "skill" ni "id": el ensamblado
  // (`fillMissingSlots`) los reescribe desde el blueprint por su posición, así
  // que pedírselos al modelo era salida desperdiciada (y una copia más que
  // podía salir mal). Se conserva "slotId" porque es lo que empareja cada
  // ejercicio con su hueco cuando dos slots comparten formato.
  const jsonStructure = `{"title":"String","situationDescription":"String","communicativeFunction":"String","ambientKeywords":"String","ambientScene":"String","characters":[{"name":"String","gender":"Male"|"Female","tone":"String"}],"dialogue":[{"speaker":"String","text":"String","emotion":"String"}],"exercises":[{"slotId":"...","type":"...","question":"...","explanation":"...","sourceTurns":[0],"correctAnswer":"..."}]}
  La forma concreta de cada ejercicio depende de su "type": usa exactamente el JSON indicado para ese formato en EXERCISES.
  IMPORTANTE: la prioridad ABSOLUTA es que el JSON sea VÁLIDO y parseable — comillas dobles bien cerradas y escapadas (\\" dentro del texto), comas correctas, sin comas de más. Para ahorrar espacio, no uses sangría ni saltos de línea decorativos (JSON sin pretty-print); pero mantén el JSON normal y correcto, sin sacrificar la validez por compactarlo.`;

  // El ambiente sonoro se elige de una lista cerrada de escenas, no con palabras
  // libres. Antes se pedían "3 keywords" sin restricción y el reproductor sólo las
  // usaba para sembrar el RNG: en modo Vocabulario, tema libre y AccentChallenge —
  // donde no hay etiqueta de escenario que consultar — el ambiente acababa siempre
  // en la escena por defecto. Un id validado contra el enum arregla justo esos casos,
  // y si el modelo devuelve cualquier otra cosa se descarta sin consecuencias.
  const ambientInstruction =
    `Elige "ambientScene": EXACTAMENTE uno de estos ids, el que mejor describa el LUGAR donde ocurre el audio ` +
    `(para un boletín de radio, un podcast o un monólogo el lugar es el estudio donde se graba, no aquello de lo que se habla): ` +
    `${MODEL_SELECTABLE_SCENES.join(', ')}. ` +
    `Añade además "ambientKeywords": 3 palabras en inglés que describan el fondo sonoro.`;

  // A0 prioriza la naturalidad del habla por encima del recuento de turnos: el
  // objetivo del nivel es captar un dato dentro de habla nativa real.
  // El número de turnos se le pide en cifras: interpolar el valor del enum metía
  // la cadena en español ("Largo (14+ turnos)") dentro de un prompt en inglés y
  // dejaba la cifra escondida entre paréntesis. Ahora es lo primero que se lee, y
  // es además el número con el que el syllabus dimensiona la lección.
  const lengthInstruction = (level === Level.Intro)
    ? "LENGTH: natural y fluida; ignora el límite estricto de turnos si corta la naturalidad."
    : `LENGTH: exactly ${REQUESTED_TURNS[length]} dialogue turns (${length}).`;

  // Denominador real de turnos: solo existe donde el prompt lo exige.
  const requestedTurns = level === Level.Intro ? null : REQUESTED_TURNS[length];

  // El escalón de la cadena por el que se empieza. Un reintento por número de
  // personajes ocurre *después* de una generación que sí llegó, así que tiene
  // que arrancar por el modelo que acaba de contestar en vez de volver a pagar
  // la cadena desde arriba con los que ya se sabe que están caídos.
  let preferredModel: string = GENERATION_MODEL;

  // Cuando una vuelta falla por JSON inválido, la siguiente sube la temperatura:
  // a 0.0 el modelo es casi determinista y repetiría el mismo carácter roto.
  let parseRetryBump = false;

  // El diálogo se despacha como muy pronto una sola vez POR GENERACIÓN (no por
  // intento): así un reintento por JSON inválido tras un despacho válido no arranca
  // un segundo TTS en paralelo. En cuanto el stream cruza a "exercises" ya tenemos
  // title+characters+dialogue completos.
  let dialogueDispatched = false;

  // Auto-retry loop for multi-speaker validation
  const MAX_SPEAKER_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_SPEAKER_RETRIES; attempt++) {
    if (attempt > 1) reporter.reset(['dialogue', 'exercises', 'parse']);
    reporter.start('prompt');
    const defaultSpeakerWord = numSpeakers === 1 ? 'PERSONAJE' : 'PERSONAJES';
    // Cuántos hablantes se admiten como máximo en esta generación: el número de
    // siempre salvo que el usuario haya abierto la puerta con un prompt de audio.
    const speakerCap = allowMoreSpeakers ? MAX_SPEAKERS : numSpeakers;
    // Strengthen constraint on retry attempts
    const speakerEmphasis = allowMoreSpeakers
      ? (attempt > 1
          ? `⚠️ REINTENTO ${attempt}/${MAX_SPEAKER_RETRIES}: el guion trajo demasiados personajes con turnos de habla. Usa como MÁXIMO ${MAX_SPEAKERS} personajes.`
          : `Por defecto ${numSpeakers} ${defaultSpeakerWord}. Puedes usar MÁS de dos personajes SOLO si las instrucciones del usuario en USER_AUDIO lo piden explícitamente (nombran a más personas, piden un grupo, una reunión, una mesa redonda, varias voces…). En ese caso usa los que la escena necesite, hasta un máximo de ${MAX_SPEAKERS} personajes con turnos de habla, cada uno con un nombre estable y consistente en todos sus turnos. Si el usuario NO pide más personajes, mantén EXACTAMENTE ${numSpeakers}.`)
      : (attempt > 1
          ? `⚠️ REINTENTO ${attempt}/${MAX_SPEAKER_RETRIES}: DETECCIÓN PREVIA DE MÁS DE 2 PERSONAJES. ESTO ES ABSOLUTAMENTE CRÍTICO - USA SOLO ${numSpeakers} ${defaultSpeakerWord}. NO AGREGUES PERSONAJES SECUNDARIOS, MESEROS, RECEPCIONISTAS, ETC.`
          : `CRITICAL: El diálogo debe tener EXACTAMENTE ${numSpeakers} ${defaultSpeakerWord} hablando. NUNCA más de 2 personajes. El sistema TTS solo soporta máximo 2 voces.`);

    // Instrucciones libres del usuario sobre el CONTENIDO del audio. Se siguen
    // con la mayor libertad posible —tema, tono, personajes, número de hablantes
    // (ver SPEAKERS), giro…— y solo el nivel, el registro y la localización se
    // mantienen por encima.
    const customAudioBlock = customAudioPrompt
      ? `\n  USER_AUDIO (preferencias del usuario para el guion; síguelas con la mayor libertad posible —incluido el número de personajes si lo pides, según SPEAKERS— mientras no contradigan NIVEL, REGISTER ni LOCALIZE): ${customAudioPrompt}`
      : '';

    const prompt = `
  JSON Lesson (Spanish). Modo: ${mode}. Nivel: ${level}. Tema: ${finalTopic}. Accent: ${accent}.

  CONTEXT: ${profileInstruction}
  RULES: ${constraint}
  REGISTER: ${registerInstruction}
  TONE: ${SPEAKER_TONE_INSTRUCTION}
  LOCALIZE: ${localizationInstruction}
  SPEAKERS: ${speakerEmphasis}${customAudioBlock}
  EXERCISES: ${exerciseLogic}
  ${lengthInstruction}
  AMBIENT: ${ambientInstruction}

  Structure: ${jsonStructure}
  `;

    const chain = modelsFrom(preferredModel);

    reporter.finish(
      'prompt',
      `${formatCount(prompt.length)} caracteres enviados · modelo ${chain[0]}` +
        (attempt > 1 ? ` · intento ${attempt}/${MAX_SPEAKER_RETRIES}` : '')
    );

    try {
      // Lo que llega del stream se cuenta tal cual: cada actualización de la
      // pantalla corresponde a texto que el modelo ya ha emitido.
      let exercisesStarted = false;
      let titleLogged = false;
      let turnsSeen = 0;
      let exercisesSeen = 0;

      // Un modelo nuevo empieza el JSON desde cero, igual que un reintento del
      // stream: los dos casos tienen que devolver la pantalla al mismo sitio, y
      // por eso comparten esta función en vez de repetir las cuatro líneas.
      const restartStream = () => {
        exercisesStarted = false;
        titleLogged = false;
        reporter.reset(['dialogue', 'exercises']);
        reporter.start('dialogue');
      };

      reporter.start('dialogue');

      const { value: rawResponse, model: usedModel } = await runWithModelFallback(
        chain,
        (model) => generateJsonWithProgress(
          ai,
          {
            model,
            contents: prompt,
            config: {
              systemInstruction: "Expert Spanish Linguist. Respond with ONLY a single valid JSON object. Valid, parseable JSON is the top priority: escape every double quote inside string values as \\\", never leave a string unterminated, use correct commas. To save space, do not pretty-print (no indentation, no decorative line breaks) — but keep it well-formed JSON; never sacrifice validity for compactness.",
              responseMimeType: "application/json",
              temperature: parseRetryBump ? 0.4 : 0.0,
              // Sin esto el modelo pensante razona con presupuesto dinámico y
              // tarda ~37 s en emitir el primer token: toda la lentitud del guion.
              thinkingConfig: thinkingConfigFor(model),
            },
          },
          {
            onText: (full) => {
              turnsSeen = countMatches(full, SPEAKER_KEY);
              exercisesSeen = Math.max(countMatches(full, SLOT_KEY), countMatches(full, QUESTION_KEY));

              if (!titleLogged) {
                const match = TITLE_VALUE.exec(full);
                if (match) {
                  titleLogged = true;
                  reporter.log(`Título recibido: «${match[1]}»`, 'ok');
                }
              }

              if (!exercisesStarted && EXERCISES_KEY.test(full)) {
                exercisesStarted = true;
                reporter.finish('dialogue', plural(turnsSeen, 'turno recibido', 'turnos recibidos'));
                reporter.start('exercises');

                // El diálogo ya llegó entero: se intenta arrancar el TTS en paralelo.
                if (!dialogueDispatched && hooks?.onDialogueReady) {
                  const ready = extractDispatchableDialogue(full, speakerCap);
                  if (ready) {
                    dialogueDispatched = true;
                    hooks.onDialogueReady(ready.dialogue, ready.characters);
                  }
                }
              }

              if (!exercisesStarted) {
                reporter.update('dialogue', {
                  // Sin denominador en A0: el paso queda declarado no medible.
                  ratio: requestedTurns ? Math.min(turnsSeen / requestedTurns, 1) : undefined,
                  detail: requestedTurns
                    ? `${formatCount(turnsSeen)} de ${requestedTurns} turnos solicitados`
                    : plural(turnsSeen, 'turno recibido', 'turnos recibidos'),
                  counters: [
                    { label: 'Turnos', value: formatCount(turnsSeen) },
                    { label: 'Caracteres', value: formatCount(full.length) }
                  ],
                  metrics: { turns: turnsSeen, chars: full.length }
                });
              } else {
                reporter.update('exercises', {
                  ratio: Math.min(exercisesSeen / blueprint.length, 1),
                  detail: `${formatCount(Math.min(exercisesSeen, blueprint.length))} de ${blueprint.length} ejercicios recibidos`,
                  counters: [
                    { label: 'Ejercicios', value: `${Math.min(exercisesSeen, blueprint.length)}/${blueprint.length}` },
                    { label: 'Caracteres', value: formatCount(full.length) }
                  ],
                  metrics: { exercises: exercisesSeen, chars: full.length }
                });
              }
            },
            onRetry: (streamAttempt, received, reason) => {
              reporter.log(
                `Stream interrumpido tras ${formatCount(received)} caracteres (intento ${streamAttempt}): ${briefly(reason)}`,
                'warn'
              );
              restartStream();
            },
            onFallback: (reason) => {
              reporter.log(`Streaming no disponible (${briefly(reason)}); se pide la respuesta completa`, 'warn');
            },
            onWaiting: (elapsedMs) => {
              // El modelo aún no ha emitido nada: se mueve el detalle para que no
              // parezca congelado, sin inventar porcentaje (no hay denominador).
              if (exercisesStarted || turnsSeen > 0) return;
              reporter.update('dialogue', {
                detail: `esperando la respuesta del modelo… (${Math.round(elapsedMs / 1000)} s)`,
                counters: [{ label: 'Espera', value: `${Math.round(elapsedMs / 1000)} s` }]
              });
            }
          }
        ),
        {
          onSwitch: (from, to, reason) => {
            reporter.log(`«${from}» no está disponible (${briefly(reason)}); se cambia a «${to}»`, 'warn');
            restartStream();
          }
        }
      );

      // La próxima generación (un reintento por número de personajes) empieza
      // por el modelo que sí ha contestado.
      preferredModel = usedModel;
      if (usedModel !== GENERATION_MODEL) {
        reporter.log(`Guion generado con «${usedModel}» en lugar de «${GENERATION_MODEL}»`, 'ok');
      }

      if (!exercisesStarted) {
        reporter.finish('dialogue', plural(turnsSeen, 'turno recibido', 'turnos recibidos'), 'warning');
        reporter.start('exercises');
      }
      reporter.finish(
        'exercises',
        `${formatCount(exercisesSeen)} de ${blueprint.length} ejercicios recibidos`,
        exercisesSeen >= blueprint.length ? 'done' : 'warning'
      );

      reporter.start('parse');
      // El modelo se equivoca en JSON largo (una comilla sin escapar en una
      // réplica, un carácter de control, la respuesta cortada). `parseLenientJson`
      // intenta el parseo estricto y, si falla, repara lo reparable en vez de
      // reventar la lección entera por un solo carácter.
      let plan: LessonPlan;
      let jsonRepaired = false;
      try {
        const parsed = parseLenientJson<LessonPlan>(rawResponse);
        plan = parsed.value;
        jsonRepaired = parsed.repaired;
      } catch (parseError: any) {
        // Ni la reparación lo salva: se reintenta la generación en vez de mostrar
        // un JSON roto. A temperatura 0 el mismo prompt puede repetir el fallo, así
        // que la vuelta siguiente sube la temperatura para forzar otra salida.
        reporter.fail('parse', errorMessage(parseError));
        if (attempt === MAX_SPEAKER_RETRIES) {
          throw new Error(
            `El modelo devolvió un JSON inválido y no se pudo reparar tras ${MAX_SPEAKER_RETRIES} intentos: ${errorMessage(parseError)}`
          );
        }
        reporter.log(
          `JSON inválido del modelo (${briefly(errorMessage(parseError))}); se reintenta la generación ${attempt + 1}/${MAX_SPEAKER_RETRIES}`,
          'warn'
        );
        parseRetryBump = true;
        continue;
      }
      if (jsonRepaired) {
        reporter.log('El JSON del modelo venía con errores; se reparó automáticamente', 'warn');
      }

      if (!plan || typeof plan !== 'object') plan = {} as LessonPlan;
      if (!plan.dialogue) plan.dialogue = [];
      const rawExercises: unknown[] = Array.isArray(plan.exercises) ? plan.exercises : [];

      // The scene id is only kept if it names a real scene. Anything else is dropped
      // and the player falls back to the scenario label / text type, so a hallucinated
      // id can never reach the ambience engine.
      if (plan.ambientScene && !isSceneId(plan.ambientScene)) {
        console.warn(`[Ambience] Model returned unknown scene "${plan.ambientScene}"; ignoring.`);
        delete plan.ambientScene;
      }

      // Validate speaker count. El tope es 2 salvo que el usuario haya pedido más
      // con un prompt de audio, en cuyo caso llega hasta MAX_SPEAKERS: cada
      // hablante se sintetiza en su propia petición y ninguno se pierde del audio.
      const uniqueSpeakers = new Set(plan.dialogue.map(d => d.speaker?.trim()).filter(Boolean));
      if (uniqueSpeakers.size > speakerCap) {
        console.warn(`[Attempt ${attempt}/${MAX_SPEAKER_RETRIES}] Detected ${uniqueSpeakers.size} speakers (cap ${speakerCap}): ${Array.from(uniqueSpeakers).join(', ')}. Retrying...`);
        reporter.fail('parse', `${uniqueSpeakers.size} hablantes: ${Array.from(uniqueSpeakers).join(', ')}`);
        reporter.log(
          `Descartado: el guion trae ${uniqueSpeakers.size} hablantes y el máximo es ${speakerCap}. Reintento ${attempt + 1}/${MAX_SPEAKER_RETRIES}`,
          'warn'
        );

        // If this was the last attempt, throw error
        if (attempt === MAX_SPEAKER_RETRIES) {
          throw new Error(`El sistema no pudo generar un diálogo con máximo ${speakerCap} ${speakerCap === 1 ? 'personaje' : 'personajes'} después de ${MAX_SPEAKER_RETRIES} intentos.`);
        }

        // Otherwise, continue to next iteration (retry)
        continue;
      }

      if (attempt > 1) {
        console.log(`[Success] Generated valid dialogue on attempt ${attempt}/${MAX_SPEAKER_RETRIES}`);
      }

      reporter.finish(
        'parse',
        `${plural(plan.dialogue.length, 'turno', 'turnos')} · ${plural(uniqueSpeakers.size, 'hablante', 'hablantes')} · ${plural(rawExercises.length, 'ejercicio en bruto', 'ejercicios en bruto')}`
      );

      // Se descarta todo ejercicio cuya clave no se sostenga contra la
      // transcripción y se rellenan los slots que queden vacíos con motores
      // deterministas: mejor un ejercicio menos que uno con la respuesta mal.
      reporter.start('verify');
      let discarded = 0;
      const verified = verifyExercises(rawExercises, plan.dialogue, ({ slot, reason }) => {
        discarded++;
        reporter.log(`Ejercicio descartado (${slot}): ${reason}`, 'warn');
      });
      reporter.finish(
        'verify',
        `${verified.length} de ${rawExercises.length} superan la verificación` +
          (discarded > 0 ? ` · ${discarded} descartados` : ''),
        discarded > 0 ? 'warning' : 'done'
      );

      reporter.start('assemble');
      let fromEngine = 0;
      let uncovered = 0;
      plan.exercises = fillMissingSlots(
        verified,
        blueprint,
        plan.dialogue,
        ({ slotId, source, reason }) => {
          if (source === 'engine') {
            fromEngine++;
            reporter.log(`Slot "${slotId}" reconstruido por motor determinista`, 'info');
          } else if (source === 'empty') {
            uncovered++;
            reporter.log(`Slot "${slotId}" sin cubrir: ${reason}`, 'warn');
          }
        }
      );
      reporter.finish(
        'assemble',
        `${plan.exercises.length} de ${blueprint.length} slots listos` +
          (fromEngine > 0 ? ` · ${fromEngine} por motor` : '') +
          (uncovered > 0 ? ` · ${uncovered} sin cubrir` : ''),
        uncovered > 0 ? 'warning' : 'done'
      );
      reporter.flush();

      return plan;
    } catch (error: any) {
      // If it's a non-speaker-related error or last attempt, throw immediately
      if (!error.message?.includes('personajes') || attempt === MAX_SPEAKER_RETRIES) {
        console.error("Error generando plan:", error);
        const active = reporter.snapshot().activeStepId;
        if (active) reporter.fail(active, errorMessage(error));
        reporter.log(`Fallo en la generación del guion: ${briefly(errorMessage(error))}`, 'error');
        // Agotada la cadena de modelos, lo que llegaba a pantalla era el JSON
        // crudo del 503 anidado dentro de otro JSON. Se dice qué ha pasado.
        const chainFailure = describeModelChainFailure(error, chain.length);
        throw new Error(`Error GenAI: ${chainFailure ?? error.message}`);
      }
      // Otherwise, this catch is just for unexpected errors during generation, continue retry loop
    }
  }

  // Should never reach here due to throw in loop, but TypeScript needs this
  throw new Error("Error inesperado en generación de lección");
};

// --- PROGRESO MEDIBLE DE LA FASE 2 ---

/**
 * El TTS no anuncia cuánto audio va a devolver, así que el paso de síntesis se
 * declara NO MEDIBLE: la UI muestra lo que de verdad ha llegado (segundos de
 * audio, datos, fragmentos) en lugar de un porcentaje inventado.
 */
const AUDIO_STEPS = [
  { id: 'prepare', label: 'Preparación del texto', weight: 6, atomic: true },
  { id: 'synthesis', label: 'Síntesis de voz', weight: 84 },
  { id: 'encode', label: 'Ensamblado de la pista', weight: 10, atomic: true }
];

// --- TROCEADO DEL TEXTO PARA EL TTS ---

/** Ejecuta `fn` sobre `items` con un tope de tareas simultáneas, conservando el orden. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return results;
}

/**
 * Parte una línea que por sí sola no cabe, primero por frases y luego por
 * palabras.
 *
 * Cada trozo vuelve a llevar la etiqueta del hablante. Sin eso, la segunda
 * mitad de un turno largo llegaba al modelo como texto sin dueño: en un tramo
 * multi-hablante, una línea sin etiqueta es exactamente el caso en el que el
 * modelo se queda con la voz anterior, y el turno partido cambiaba de persona a
 * mitad de frase o arrastraba la voz equivocada hasta el final del tramo.
 */
function splitOversizedLine(line: string, limit: number): string[] {
  if (line.length <= limit) return [line];

  const prefix = (line.match(/^([^:\n]{1,60}): /) || [])[0] || "";
  const body = line.slice(prefix.length);
  // La etiqueta se repite en cada trozo, así que ocupa sitio en cada trozo.
  const limitForBody = Math.max(40, limit - prefix.length);

  const pieces: string[] = [];
  let current = "";
  const units = body.match(/[^.!?…]+[.!?…]*\s*/g) ?? body.split(/(?<=\s)/);

  for (const unit of units) {
    if (current && current.length + unit.length > limitForBody) {
      pieces.push(current.trim());
      current = "";
    }
    if (unit.length > limitForBody) {
      // Ni una frase suelta cabe: se corta por palabras.
      for (const word of unit.split(/\s+/)) {
        if (current && current.length + word.length + 1 > limitForBody) {
          pieces.push(current.trim());
          current = "";
        }
        current += (current ? " " : "") + word;
      }
    } else {
      current += unit;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean).map(piece => `${prefix}${piece}`);
}

/** Agrupa líneas en tramos sin pasar de `limit` caracteres, sin partir turnos. */
function packLines(lines: string[], joiner: string, limit: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    const cost = line.length + (current.length ? joiner.length : 0);
    if (current.length && size + cost > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + (current.length > 1 ? joiner.length : 0);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Caracteres de diálogo que caben en una petición para ese acento, una vez
 * descontado el perfil fonético (entre 2196 y 3407 caracteres según la
 * variante) y un margen para el prefijo de continuación.
 */
export function ttsDialogueBudget(accent: Accent): number {
  const profile = TTS_PHONETIC_PROFILES[accent] || "";
  const headerLength = profile ? profile.length + 2 : 0;
  return Math.max(600, TTS_PROMPT_LIMIT - headerLength - TTS_DIRECTIVE_ALLOWANCE);
}

/**
 * Lo que `ttsDialogueBudget` reserva para la consigna y el margen de seguridad.
 * La consigna —el timbre configurado, la petición de habla natural, la de pausar
 * entre párrafos y, en un tramo de continuación, el recordatorio de mantener la
 * voz— viaja en la misma petición que el texto: sin descontarla, el tramo se pasa
 * del techo. Se amplió a 900 al reforzar `singleVoiceDirective` con la consigna
 * de habla informal y ligada (entrega casual, sin dicción de estudio): el peor
 * caso medido —directiva + tono declarado + recordatorio de continuación— ronda
 * los 866 caracteres. Reservar de más solo achica el cuerpo, nunca lo desborda:
 * incluso con el perfil más largo (Buenos Aires, 3407) queda cuerpo por encima
 * del suelo de 600.
 */
const TTS_DIRECTIVE_ALLOWANCE = 900;

/**
 * Trocea el diálogo en fronteras de turno.
 *
 * `hardLimit` es lo que deja libre el perfil fonético dentro del techo de la
 * API. Antes esto se resolvía con un `substring(0, 5000)` a ciegas: con los
 * perfiles largos (Buenos Aires ocupa 3407 caracteres) un diálogo `Largo`
 * perdía el final a mitad de frase y el audio dejaba de cubrir los
 * `sourceTurns` de los ejercicios.
 */
export function chunkDialogueLines(lines: string[], joiner: string, hardLimit: number): string[][] {
  const safeLines = lines.flatMap(line => splitOversizedLine(line, hardLimit));

  const chunkCount = packLines(safeLines, joiner, hardLimit).length;
  if (chunkCount <= 1) return [safeLines];

  // Tramos de tamaño parecido: con dos peticiones en paralelo, el tiempo total
  // lo marca la más larga.
  const totalChars = safeLines.reduce((n, l) => n + l.length + joiner.length, 0);
  const target = Math.max(
    Math.ceil(totalChars / chunkCount),
    ...safeLines.map(l => l.length)
  );
  return packLines(safeLines, joiner, Math.min(hardLimit, target));
}

/**
 * Une los tramos de PCM aplicando un fundido corto en cada costura. Todos
 * comparten formato (24 kHz, mono, 16 bits), así que basta concatenar.
 */
export function concatPcmChunks(chunks: Uint8Array[]): Uint8Array {
  const usable = chunks.filter(c => c && c.length > 1);
  if (usable.length === 0) return new Uint8Array(0);
  if (usable.length === 1) return usable[0];

  const total = usable.reduce((n, c) => n + c.length, 0);
  const out = concatBytes(usable, total);

  const samples = new Int16Array(out.buffer, out.byteOffset, Math.floor(out.length / 2));
  const fade = Math.floor((TTS_SAMPLE_RATE * JOIN_FADE_MS) / 1000);
  let boundary = 0;
  for (let i = 0; i < usable.length - 1; i++) {
    boundary += Math.floor(usable[i].length / 2);
    for (let n = 0; n < fade; n++) {
      const gain = n / fade;
      const before = boundary - 1 - n;
      const after = boundary + n;
      if (before >= 0) samples[before] = Math.round(samples[before] * gain);
      if (after < samples.length) samples[after] = Math.round(samples[after] * gain);
    }
  }

  return out;
}

/** Recibe el audio en streaming para poder contar bytes según llegan. */
async function synthesizeWithProgress(
  ai: GoogleGenAI,
  params: GenerateContentParameters,
  hooks: {
    onAudio: (totalBytes: number, chunkCount: number) => void;
    onRetry: (attempt: number, received: number, reason: string) => void;
    onFallback: (reason: string) => void;
  }
): Promise<Uint8Array> {
  const STREAM_ATTEMPTS = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= STREAM_ATTEMPTS; attempt++) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const guard = createTimeoutGuard({
      firstChunkMs: AUDIO_FIRST_CHUNK_MS,
      stallMs: AUDIO_STALL_MS,
      totalMs: STREAM_TOTAL_MS
    });
    try {
      const stream = await ai.models.generateContentStream(withSignal(params, guard.signal));
      for await (const chunk of stream) {
        guard.ping(); // llegó algo: la síntesis no está colgada
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          const data = part.inlineData?.data;
          if (!data) continue;
          const bytes = base64ToBytes(data);
          chunks.push(bytes);
          total += bytes.length;
          hooks.onAudio(total, chunks.length);
        }
      }
      if (total === 0) throw new Error('el modelo no devolvió datos de audio');
      return concatBytes(chunks, total);
    } catch (error) {
      const actual = guard.reason() ?? error;
      // Los errores del *modelo* (cuota 429, saturación 503/500, id retirado
      // 404) no se arreglan repitiendo contra el mismo modelo: la cuota es por
      // modelo y cada reintento la vuelve a contar, y un pico de saturación
      // dura minutos, no los 1,5 s de la escalera. Suben tal cual para que
      // `generateAudio` baje al siguiente modelo de `AUDIO_MODELS`. Antes solo
      // subía el 429 y un 503 se comía los tres intentos (dos de streaming más
      // el fallback) contra el modelo caído. Los errores de red y los timeouts
      // sí se reintentan aquí, contra el mismo modelo, como siempre.
      if (isModelError(actual)) throw actual;
      lastError = actual;
      hooks.onRetry(attempt, total, errorMessage(actual));
      await sleep(500 * attempt);
    } finally {
      guard.dispose();
    }
  }

  hooks.onFallback(errorMessage(lastError));
  const guard = createTimeoutGuard({ totalMs: REQUEST_TOTAL_MS });
  let response;
  try {
    response = await ai.models.generateContent(withSignal(params, guard.signal, REQUEST_TOTAL_MS));
  } catch (error) {
    throw guard.reason() ?? error;
  } finally {
    guard.dispose();
  }
  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) {
    console.error('[TTS] No audio data in response. Response structure:', JSON.stringify(response, null, 2));
    throw new Error("El modelo no devolvió datos de audio. Verifica la configuración o intenta de nuevo.");
  }
  const bytes = base64ToBytes(audioData);
  hooks.onAudio(bytes.length, 1);
  return bytes;
}

/**
 * Catálogo de voces del TTS con su **tono medido**, no supuesto.
 *
 * `pitchHz` es la F0 mediana de cada voz leyendo la misma frase española,
 * medida contra la API (`scripts/measure-tts-voices.mjs`). Hacía falta medirlo
 * porque la separación real entre voces no se parece a lo que sugieren los
 * nombres: dentro de un mismo género las voces del catálogo caen casi encima
 * unas de otras —las femeninas entre 176 y 233 Hz, las masculinas entre 119 y
 * 135— así que «otra voz del mismo grupo» no garantizaba que el alumno pudiera
 * distinguir los turnos, que es justamente lo que la mitad de los ejercicios le
 * pide. Con los números a la vista se puede exigir una separación mínima.
 *
 * `timbre` viaja al prompt. No es decoración: la limitación documentada del
 * modelo es la «inconsistencia de voz respecto al prompt», y se manifiesta
 * cuando el texto no dice nada sobre quién habla y la asignación de timbres
 * queda solo en la configuración. Describiendo cada voz en el propio texto, lo
 * que se pide y lo que se configura dicen lo mismo.
 */
interface TtsVoice {
  name: string;
  gender: Character['gender'];
  pitchHz: number;
  timbre: string;
}

const TTS_VOICES: readonly TtsVoice[] = [
  { name: 'Zephyr', gender: 'Female', pitchHz: 233, timbre: 'a bright, high-pitched female voice' },
  { name: 'Leda', gender: 'Female', pitchHz: 212, timbre: 'a young, light female voice' },
  { name: 'Achernar', gender: 'Female', pitchHz: 201, timbre: 'a soft female voice' },
  { name: 'Aoede', gender: 'Female', pitchHz: 194, timbre: 'a natural female voice' },
  { name: 'Kore', gender: 'Female', pitchHz: 185, timbre: 'a firm female voice' },
  { name: 'Autonoe', gender: 'Female', pitchHz: 176, timbre: 'a warm, low female voice' },
  { name: 'Orus', gender: 'Male', pitchHz: 135, timbre: 'a clear male voice' },
  { name: 'Puck', gender: 'Male', pitchHz: 122, timbre: 'a lively male voice' },
  { name: 'Charon', gender: 'Male', pitchHz: 120, timbre: 'a calm, deep male voice' },
  { name: 'Fenrir', gender: 'Male', pitchHz: 119, timbre: 'a deep, low-pitched male voice' }
];

/** Distancia entre dos tonos, en semitonos: la unidad en que se oye la diferencia. */
const pitchDistance = (a: number, b: number) => Math.abs(12 * Math.log2(a / b));

/**
 * Separación mínima exigida entre las dos voces de un diálogo.
 *
 * Por debajo de esto no es que suenen «parecidas»: es que el alumno no puede
 * usar el timbre para segmentar los turnos, y el verificador tampoco puede
 * comprobar que el modelo respetó la asignación. 4,5 semitonos es lo que dejan
 * las dos voces femeninas más separadas del catálogo (Zephyr 233 Hz y Autonoe
 * 176 Hz, 4,8 semitonos), así que el umbral se puede cumplir sin cambiar de
 * género salvo entre dos hombres, donde el catálogo entero cabe en 2,2.
 */
const MIN_VOICE_SEPARATION_SEMITONES = 4.5;

/**
 * Tope de hablantes cuando el usuario abre la puerta con un prompt de audio (ver
 * `assignSpeakerVoices` y la validación en `generateLessonPlan`). Por defecto el
 * app trabaja con uno o dos —el coste fijo de dos peticiones y las dos voces bien
 * separadas—; este límite existe solo para el caso en que el usuario pide
 * explícitamente más personas. Cada hablante cuesta al menos una petición de TTS
 * (el tier gratuito da 10 al día), así que se mantiene modesto: por encima de dos
 * voces el catálogo tampoco garantiza separación de par a par (los cuatro hombres
 * caben en 2,2 semitonos), y más peticiones acercan el límite diario.
 */
const MAX_SPEAKERS = 4;

export interface SpeakerVoiceAssignment {
  /** La etiqueta tal como viene en el guion. */
  speaker: string;
  /** La etiqueta que viaja al TTS, en el `speechConfig` y delante de cada turno. */
  label: string;
  voice: string;
  /** Tono de referencia de la voz asignada; con él se verifica el audio. */
  pitchHz: number;
  /** Descripción de la voz que se le da al modelo dentro del prompt. */
  timbre: string;
  /**
   * Tono y registro del personaje (`Character.tone`), si el guion lo declaró. Se le
   * pasa al TTS para que lea la voz con ese carácter y de forma consistente en todo
   * el bloque del hablante (cada hablante es una sola petición, así que el tono no
   * puede cambiar a mitad).
   */
  tone?: string;
}

/** Minúsculas, sin tildes, sin acotaciones ni puntuación. Solo para comparar. */
function normalizeSpeaker(raw: string): string {
  return (raw || '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Limpia la etiqueta que se le manda al TTS. El nombre se conserva —es lo que
 * el modelo espera ver delante de cada turno— pero sin acotaciones ni signos
 * que puedan romper la correspondencia con el `speechConfig`.
 */
function canonicalSpeakerLabel(raw: string): string {
  const cleaned = (raw || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\*\[\]\{\}_"“”:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || (raw || '').trim();
}

function findCharacter(speaker: string, characters: Character[]): Character | undefined {
  const target = normalizeSpeaker(speaker);
  if (!target) return undefined;
  const named = characters.filter(c => normalizeSpeaker(c.name));

  return (
    named.find(c => normalizeSpeaker(c.name) === target) ||
    // "Ana" ↔ "Ana Gómez", "Sra. Ana" ↔ "Ana": el más largo primero, para que
    // "Ana María" no se lleve los turnos de "Ana".
    [...named]
      .sort((a, b) => normalizeSpeaker(b.name).length - normalizeSpeaker(a.name).length)
      .find(c => {
        const name = normalizeSpeaker(c.name);
        return target.split(' ').includes(name) || name.split(' ').includes(target);
      })
  );
}

/**
 * Elige el par de voces para dos hablantes.
 *
 * La regla no es «una voz de su grupo a cada uno», que es lo que se hacía y lo
 * que dejaba pares separados por un par de semitonos. La regla es: **de todos
 * los pares que respetan el género declarado, el más separado; y si ninguno
 * llega al mínimo audible, se sacrifica el género antes que la distinción.**
 * Entre dos hombres no hay alternativa —el catálogo masculino entero cabe en
 * 2,2 semitonos—, y un diálogo en el que no se distingue quién habla no sirve
 * para un ejercicio de comprensión auditiva, que es para lo que existe el audio.
 */
function pickVoicePair(genders: Array<Character['gender'] | undefined>): [TtsVoice, TtsVoice] {
  const pairs: Array<{ a: TtsVoice; b: TtsVoice; gap: number; matches: number }> = [];

  for (const a of TTS_VOICES) {
    for (const b of TTS_VOICES) {
      if (a.name === b.name) continue;
      const matches = (genders[0] && a.gender === genders[0] ? 1 : 0) + (genders[1] && b.gender === genders[1] ? 1 : 0);
      pairs.push({ a, b, gap: pitchDistance(a.pitchHz, b.pitchHz), matches });
    }
  }

  const separated = pairs.filter(p => p.gap >= MIN_VOICE_SEPARATION_SEMITONES);
  const eligible = separated.length ? separated : pairs;

  // Primero el que respeta más géneros; si hay que sacrificar uno, que sea el
  // del hablante con menos turnos (los hablantes llegan ordenados por peso);
  // a igualdad, el par más separado.
  eligible.sort(
    (x, y) =>
      y.matches - x.matches ||
      Number(y.a.gender === genders[0]) - Number(x.a.gender === genders[0]) ||
      y.gap - x.gap
  );
  const best = eligible[0];
  return [best.a, best.b];
}

/**
 * Elige N voces distintas para tres o más hablantes. Este camino solo se usa
 * cuando el usuario pide explícitamente más de dos personas (ver la validación
 * en `generateLessonPlan`); su garantía es más débil que la de dos voces, porque
 * el catálogo no da separación de par a par para tantas: los cuatro hombres caben
 * en 2,2 semitonos. Lo que sí se garantiza es que las voces son **distintas** y
 * **lo más separadas que el catálogo permita**, respetando el género donde se
 * puede. Estrategia de punto más lejano: se siembra con la voz más aguda del
 * grupo del primer hablante y cada siguiente maximiza la distancia mínima a las
 * ya elegidas.
 */
function pickVoiceSet(genders: Array<Character['gender'] | undefined>): TtsVoice[] {
  const chosen: TtsVoice[] = [];

  for (const gender of genders) {
    const unused = TTS_VOICES.filter(v => !chosen.some(c => c.name === v.name));
    if (!unused.length) {
      // Más hablantes que voces en el catálogo (no debería ocurrir bajo
      // MAX_SPEAKERS): se admite repetir antes que dejar a alguien mudo.
      chosen.push(TTS_VOICES[chosen.length % TTS_VOICES.length]);
      continue;
    }
    const matching = unused.filter(v => gender && v.gender === gender);
    const pool = matching.length ? matching : unused;

    let best = pool[0];
    let bestScore = -Infinity;
    for (const v of pool) {
      // Con nadie elegido todavía se prefiere una voz extrema (la más aguda) para
      // que el conjunto tenga de dónde separarse; después, el punto más lejano.
      const score = chosen.length
        ? Math.min(...chosen.map(c => pitchDistance(c.pitchHz, v.pitchHz)))
        : v.pitchHz;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    chosen.push(best);
  }

  return chosen;
}

/**
 * Asigna una voz distinta a cada hablante. Distinta **y separable**: no basta
 * con que el nombre de la voz sea otro. Se calcula una vez para todo el diálogo
 * y se reutiliza en cada tramo y en cada reintento.
 */
export function assignSpeakerVoices(speakers: string[], characters: Character[]): SpeakerVoiceAssignment[] {
  const labels = canonicalSpeakerLabels(speakers);
  const matched = speakers.map(s => findCharacter(s, characters));
  const genders = matched.map(c => c?.gender);
  // El tono declarado del personaje viaja al TTS para leer la voz con su carácter.
  const tones = matched.map(c => c?.tone?.trim() || undefined);

  if (speakers.length === 1) {
    // Sin diálogo no hay nada que separar, así que no interesa un extremo del
    // catálogo: se toma la voz central de su grupo.
    const pool = TTS_VOICES.filter(v => v.gender === (genders[0] || 'Female'));
    const voice = pool[Math.floor(pool.length / 2)] || TTS_VOICES[0];
    return [{ speaker: speakers[0], label: labels[0], voice: voice.name, pitchHz: voice.pitchHz, timbre: voice.timbre, tone: tones[0] }];
  }

  // Dos hablantes: el par más separado que respete el género (el caso de siempre).
  // Tres o más (solo si el usuario lo pidió): N voces distintas y bien repartidas.
  const chosen = speakers.length === 2
    ? pickVoicePair([genders[0], genders[1]])
    : pickVoiceSet(genders);

  return speakers.map((speaker, i) => {
    const voice = chosen[i] || TTS_VOICES.find(v => !chosen.some(c => c.name === v.name)) || TTS_VOICES[i % TTS_VOICES.length];
    return { speaker, label: labels[i], voice: voice.name, pitchHz: voice.pitchHz, timbre: voice.timbre, tone: tones[i] };
  });
}

/**
 * Etiquetas únicas e inconfundibles entre sí. Si dos hablantes se llaman igual
 * tras limpiar la etiqueta, o el nombre de uno está contenido en el del otro
 * ("Ana" / "Ana María"), el TTS no puede saber a quién pertenece cada turno y
 * lo lee todo con la primera voz: en ese caso se numeran.
 */
function canonicalSpeakerLabels(speakers: string[]): string[] {
  const labels = speakers.map(canonicalSpeakerLabel);
  const normalized = labels.map(normalizeSpeaker);

  const ambiguous = normalized.some((a, i) =>
    !a || normalized.some((b, j) => i !== j && (a === b || a.includes(b)))
  );

  return ambiguous ? speakers.map((_, i) => `Hablante ${i + 1}`) : labels;
}

/** El turno pertenece al hablante cuya etiqueta coincide; el más largo gana. */
function assignmentFor(
  speaker: string | undefined,
  assignments: SpeakerVoiceAssignment[]
): SpeakerVoiceAssignment | undefined {
  const target = normalizeSpeaker(speaker || '');
  if (!target) return undefined;

  return (
    assignments.find(a => normalizeSpeaker(a.speaker) === target) ||
    [...assignments]
      .sort((a, b) => normalizeSpeaker(b.speaker).length - normalizeSpeaker(a.speaker).length)
      .find(a => {
        const name = normalizeSpeaker(a.speaker);
        return target.split(' ').includes(name) || name.split(' ').includes(target);
      })
  );
}

/**
 * La consigna que precede al texto de un hablante.
 *
 * Todas las peticiones son de una sola voz —también las de un diálogo, que va
 * una petición por personaje—, así que la consigna nunca tiene que explicar una
 * atribución: describe el timbre que se ha configurado y pide mantenerlo. Lo
 * que sí pide es **pausar entre párrafos**, porque cada turno viaja en su propio
 * párrafo y esa pausa es la frontera que `splitIntoTurns` busca luego en el
 * audio para volver a intercalar los turnos.
 */
function singleVoiceDirective(assignment: SpeakerVoiceAssignment): string {
  // El tono del personaje, si el guion lo declaró, se añade para leer la voz con
  // ese carácter. Como cada hablante es una sola petición, el tono es constante en
  // todo el bloque por construcción; aquí solo se le pide al modelo que lo respete.
  const tone = assignment.tone
    ? `You are this character: ${assignment.tone}. `
    : '';
  // La consigna es lo último que lee el modelo antes del texto, así que es donde
  // se fija la NATURALIDAD del habla. El síntoma que arregla: la voz sonaba
  // artificial y sobreactuada —tono de locutor/actor, sobre-articulada, cantarina,
  // dramática—. Se le pide una persona real en una conversación cotidiana, no una
  // interpretación; el registro/acento sigue viniendo del perfil fonético de arriba.
  return (
    `You are a real person in a spontaneous, everyday conversation caught on a live recording — not a performance, not a reading. ` +
    `Use ${assignment.timbre} throughout. ` +
    tone +
    `Talk the loose, casual, connected way people really speak in this accent: relaxed rhythm, natural everyday intonation, letting words and syllables run together — not clean, over-enunciated studio diction. ` +
    `Never sound like a narrator, announcer, actor or teacher; do not over-articulate, sing-song or dramatise. ` +
    `Stay warm, informal and understated, true to life, at an easy conversational pace, with the small hesitations of real talk. ` +
    `Each paragraph is a separate utterance: pause clearly between paragraphs.`
  );
}

/** Silencio en PCM, para separar turnos sintetizados por separado. */
function silencePcm(ms: number): Uint8Array {
  return new Uint8Array(Math.round((TTS_SAMPLE_RATE * ms) / 1000) * 2);
}

/** Una petición al TTS: un hablante, una voz, sus turnos. */
export interface TtsRequest {
  owner: SpeakerVoiceAssignment;
  /** Texto de cada pieza del tramo, en orden. */
  lines: string[];
  /** Posición en el diálogo del turno del que sale cada pieza. */
  turnAt: number[];
  /** Orden de este tramo entre los de su hablante, y cuántos son. */
  part: number;
  parts: number;
}

export interface AudioPlan {
  assignments: SpeakerVoiceAssignment[];
  requests: TtsRequest[];
  /** Turnos que llegan a sintetizarse, con su posición en el diálogo. */
  turns: Array<{ at: number; owner: SpeakerVoiceAssignment; text: string }>;
  isMultiSpeaker: boolean;
  spokenChars: number;
  budget: number;
}

/**
 * El plan de peticiones: **una por hablante**, con solo sus turnos y una sola
 * voz configurada.
 *
 * Es el punto entero de este diseño. `multiSpeakerVoiceConfig` no enruta nada:
 * el modelo lee el transcript, decide por su cuenta de quién es cada turno y
 * después busca una voz —Google documenta la «inconsistencia de voz respecto al
 * prompt» como limitación conocida— y medido contra la API volvía con una sola
 * voz en 3 de cada 4 generaciones. Comprobarlo y repetir la petición
 * funcionaba, pero el nivel gratuito son 10 peticiones al día y la escalera de
 * reparación se comía hasta ocho en una sola lección: el alumno se quedaba sin
 * generaciones antes de terminar de estudiar.
 *
 * Una petición de un solo hablante no tiene ninguna atribución que resolver:
 * hay una voz configurada y un texto. Así que la garantía deja de venir de
 * medir el audio y pasa a venir de la forma de la petición, con un coste fijo
 * de dos, sabido antes de empezar. Lo que hay que hacer a cambio es partir el
 * bloque de cada voz en sus turnos (`splitIntoTurns`) para intercalarlos, y eso
 * es aritmética local: no cuesta cuota y no puede quedarse sin ella.
 *
 * Un hablante al que no le quepa su texto en el presupuesto del acento se
 * reparte en varios tramos, siempre por frontera de turno: ningún turno se
 * pierde ni se corta a media frase.
 */
export function planAudioRequests(
  dialogue: LessonPlan['dialogue'],
  characters: Character[],
  accent: Accent
): AudioPlan | null {
  if (!dialogue || dialogue.length === 0) return null;

  const speakerCounts: Record<string, number> = {};
  dialogue.forEach(d => {
    if (d.speaker) speakerCounts[d.speaker.trim()] = (speakerCounts[d.speaker.trim()] || 0) + 1;
  });

  const sortedSpeakers = Object.keys(speakerCounts).sort((a, b) => speakerCounts[b] - speakerCounts[a]);
  if (sortedSpeakers.length === 0) return null;

  const isMultiSpeaker = sortedSpeakers.length >= 2;
  // Hasta dos por defecto; más solo cuando el usuario lo pidió y la validación
  // aguas arriba lo dejó pasar. Cada hablante se sintetiza en su propia petición.
  const assignments = assignSpeakerVoices(sortedSpeakers.slice(0, MAX_SPEAKERS), characters);

  // Cada turno guarda su posición en el diálogo: se piden agrupados por hablante
  // y hay que devolverlos a su sitio al montar la pista.
  const turns: AudioPlan['turns'] = [];
  dialogue.forEach((d, at) => {
    const owner = isMultiSpeaker ? assignmentFor(d.speaker, assignments) : assignments[0];
    if (!owner) return;
    const cleanText = sanitizeForTTS(d.text);
    if (!cleanText) return;
    turns.push({ at, owner, text: cleanText });
  });

  if (turns.length === 0) return null;

  const budget = ttsDialogueBudget(accent);
  const requests: TtsRequest[] = [];

  for (const owner of assignments) {
    const mine = turns.filter(t => t.owner === owner);
    if (!mine.length) continue;

    // Un turno más largo que el presupuesto se parte por frases; cada pieza
    // recuerda de qué turno viene para volver a unirse al montar.
    const pieces = mine.flatMap(t =>
      splitOversizedLine(t.text, budget).map(text => ({ at: t.at, text }))
    );
    const chunks = chunkDialogueLines(pieces.map(p => p.text), TURN_JOINER, budget);

    let cursor = 0;
    chunks.forEach((lines, part) => {
      const turnAt = pieces.slice(cursor, cursor + lines.length).map(p => p.at);
      cursor += lines.length;
      requests.push({ owner, lines, turnAt, part, parts: chunks.length });
    });
  }

  return {
    assignments,
    requests,
    turns,
    isMultiSpeaker,
    spokenChars: turns.reduce((n, t) => n + t.text.length, 0),
    budget
  };
}

export const generateAudio = async (
  dialogue: LessonPlan['dialogue'],
  characters: Character[],
  accent: Accent,
  onProgress?: ProgressListener
): Promise<string> => {
  const reporter = new ProgressReporter('audio', AUDIO_STEPS, onProgress);
  reporter.start('prepare');

  // DYNAMIC INSTANTIATION WITH STORED KEY
  const ai = getAi();

  if (!dialogue || dialogue.length === 0) return "";

  const plan = planAudioRequests(dialogue, characters, accent);
  // Final validation before sending
  if (!plan) {
    throw new Error("No hay texto válido para generar audio.");
  }

  const { assignments, requests, isMultiSpeaker, spokenChars, budget: dialogueBudget } = plan;
  const assignedVoices = assignments.map(
    a => `${a.label}→${a.voice} ${Math.round(a.pitchHz)} Hz`
  );

  // --- CRITICAL: INJECT PHONETIC PRONUNCIATION INSTRUCTIONS ---
  // This is the "bulletproof" accent system - we prepend pronunciation rules
  // so the TTS model knows exactly how to pronounce each dialect
  const phoneticProfile = TTS_PHONETIC_PROFILES[accent] || "";
  const header = phoneticProfile ? `${phoneticProfile}\n\n` : "";

  const totalChunks = requests.length;

  reporter.finish(
    'prepare',
    `${plural(dialogue.length, 'turno', 'turnos')} · ${formatCount(spokenChars)} caracteres de habla · ` +
      `${isMultiSpeaker ? plural(assignments.length, 'voz', 'voces') : 'una voz'} (${assignedVoices.join(', ')}) · ` +
      `${plural(totalChunks, 'petición', 'peticiones')}`
  );
  reporter.log(`Modelo TTS: ${AUDIO_MODEL} · PCM ${TTS_SAMPLE_RATE / 1000} kHz 16 bits mono`, 'info');
  if (isMultiSpeaker) {
    reporter.log(
      'Una petición por hablante, con una sola voz configurada en cada una: no hay atribución ' +
        'que el modelo pueda equivocar, así que cada voz está garantizada sin gastar ninguna ' +
        'petición en comprobarlo. Los turnos se intercalan aquí, al recibirlos.',
      'info'
    );
  }
  const overflowing = requests.filter(r => r.parts > 1).length;
  if (overflowing > 0) {
    reporter.log(
      `A algún hablante no le cabe su texto en una petición (presupuesto ${formatCount(dialogueBudget)} ` +
        `caracteres tras el perfil fonético): se reparte en tramos por frontera de turno`,
      'info'
    );
  }

  try {
    console.log(`[TTS] Generating audio: ${totalChunks} single-voice request(s), one per speaker...`);
    reporter.start('synthesis');

    // Toda la síntesis va dentro de `runWithModelFallback`: si el modelo de voz
    // primario está caído (503) o sin cuota (429), se baja al siguiente escalón
    // de `AUDIO_MODELS` y se rehace la lección entera con él. El modelo se
    // resuelve **una sola vez por lección**, así que las dos peticiones (una por
    // hablante) usan siempre el mismo —nunca hay dos voces de un diálogo
    // sintetizadas por modelos distintos—. En la ruta normal no hay cambio: un
    // modelo, sus peticiones, y el coste sigue siendo el de siempre.
    //
    // Solo cambian de modelo los errores del *modelo* (`synthesizeWithProgress`
    // ya sube el 503/500/404/429 tal cual). Un fallo de red o un timeout no
    // baja de escalón: lo reintenta antes la escalera interna contra el mismo
    // modelo, y como el host es el mismo para toda la cadena, probar otro modelo
    // no arreglaría una red caída —solo reharía dos peticiones por escalón para
    // nada—.

    const ask = async (
      model: string,
      text: string,
      owner: SpeakerVoiceAssignment,
      index: number,
      onBytes?: (bytes: number, parts: number) => void
    ) =>
      synthesizeWithProgress(
        ai,
        {
          model,
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            // Una sola voz configurada, siempre. Sin `multiSpeakerVoiceConfig`
            // no hay nada que el modelo pueda atribuir mal.
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: owner.voice } } }
          }
        },
        {
          onAudio: (totalBytes, chunkCount) => onBytes?.(totalBytes, chunkCount),
          onRetry: (attempt, received, reason) => {
            reporter.log(
              `Síntesis de la petición ${index + 1}/${totalChunks} interrumpida tras ${formatBytes(received)} ` +
                `(intento ${attempt}): ${reason}`,
              'warn'
            );
          },
          onFallback: (reason) => {
            reporter.log(
              `Streaming de audio no disponible en la petición ${index + 1}/${totalChunks} (${reason}); ` +
                `se pide la pista completa`,
              'warn'
            );
          }
        }
      );

    const { value: rendered, model: usedAudioModel } = await runWithModelFallback(
      AUDIO_MODELS,
      (model) => {
        // Contadores nuevos por intento: si se cambia de modelo, una petición
        // colgada del intento anterior escribiría en estos arrays ya
        // descartados, no en los del intento en curso.
        const bytesPerChunk = new Array<number>(totalChunks).fill(0);
        const streamPartsPerChunk = new Array<number>(totalChunks).fill(0);
        let doneChunks = 0;

        const publish = () => {
          const totalBytes = bytesPerChunk.reduce((n, b) => n + b, 0);
          const streamParts = streamPartsPerChunk.reduce((n, c) => n + c, 0);
          const seconds = totalBytes / TTS_BYTES_PER_SECOND;
          const counters = [
            { label: 'Audio recibido', value: formatSeconds(seconds) },
            { label: 'Datos', value: formatBytes(totalBytes) },
            { label: 'Fragmentos', value: formatCount(streamParts) }
          ];
          counters.push({ label: 'Peticiones', value: `${formatCount(doneChunks)}/${formatCount(totalChunks)}` });
          reporter.update('synthesis', {
            // El plan de peticiones es determinista, así que aquí sí hay un
            // denominador de verdad: no es una barra inventada sobre un reloj.
            ratio: doneChunks / totalChunks,
            detail:
              `${formatSeconds(seconds)} de audio recibidos · ` +
              `petición ${Math.min(doneChunks + 1, totalChunks)} de ${totalChunks}`,
            counters,
            metrics: {
              audioBytes: totalBytes,
              audioSeconds: seconds,
              chunks: streamParts,
              ttsRequests: totalChunks,
              ttsRequestsDone: doneChunks
            }
          });
        };

        return mapWithConcurrency(requests, TTS_CONCURRENCY, async (request, index) => {
          const body = request.lines.join(TURN_JOINER);
          const continuation = request.part > 0
            ? ' This is the continuation of the same speaker: keep exactly the same voice, pace and accent.'
            : '';

          const bytes = await ask(
            model,
            `${header}${singleVoiceDirective(request.owner)}${continuation}\n\n${body}`,
            request.owner,
            index,
            (totalBytes, chunkCount) => {
              bytesPerChunk[index] = totalBytes;
              streamPartsPerChunk[index] = chunkCount;
              publish();
            }
          );

          // El bloque vuelve con todos los turnos de esta voz seguidos: se parte
          // por los silencios, con los caracteres de cada turno como reparto
          // esperado.
          const split = splitIntoTurns(bytes, request.lines.map(l => l.length));

          doneChunks++;
          publish();
          return { request, split };
        });
      },
      {
        onSwitch: (from, to, reason) => {
          reporter.log(
            `El modelo de voz «${from}» no está disponible (${reason}); se cambia a «${to}»`,
            'warn'
          );
        }
      }
    );

    console.log('[TTS] Response received, checking for audio data...');

    // Cada turno vuelve a su sitio en el diálogo; las piezas de un turno que no
    // cupo en una petición se reúnen antes.
    const perTurn = new Map<number, Uint8Array[]>();
    let measuredCuts = 0;
    let interpolatedCuts = 0;

    for (const { request, split } of rendered) {
      measuredCuts += split.measured;
      interpolatedCuts += split.interpolated;
      request.turnAt.forEach((at, i) => {
        const piece = split.pieces[i];
        if (!piece || piece.byteLength === 0) return;
        const existing = perTurn.get(at);
        if (existing) existing.push(piece);
        else perTurn.set(at, [piece]);
      });
    }

    const ordered: Uint8Array[] = [];
    const gap = silencePcm(TURN_GAP_MS);
    for (const at of [...perTurn.keys()].sort((a, b) => a - b)) {
      if (ordered.length) ordered.push(gap);
      ordered.push(...(perTurn.get(at) as Uint8Array[]));
    }

    const audioBytes = concatPcmChunks(ordered);
    if (audioBytes.length === 0) {
      throw new Error("El modelo no devolvió datos de audio. Verifica la configuración o intenta de nuevo.");
    }

    const totalSeconds = audioBytes.length / TTS_BYTES_PER_SECOND;
    reporter.finish(
      'synthesis',
      `${formatSeconds(totalSeconds)} de audio · ${formatBytes(audioBytes.length)} · ` +
        `${plural(totalChunks, 'petición', 'peticiones')}, sin reintentos`
    );
    if (usedAudioModel !== AUDIO_MODEL) {
      reporter.log(
        `Audio generado con «${usedAudioModel}» (el primario «${AUDIO_MODEL}» no estaba disponible)`,
        'info'
      );
    }

    if (isMultiSpeaker) {
      const totalCuts = measuredCuts + interpolatedCuts;
      reporter.log(
        `Turnos intercalados: ${totalCuts} ${totalCuts === 1 ? 'frontera' : 'fronteras'} — ` +
          `${measuredCuts} por silencio medido, ${interpolatedCuts} por reparto proporcional`,
        interpolatedCuts > measuredCuts ? 'warn' : 'info'
      );

      if (assignments.length >= 2) {
        // Diagnóstico, no control de flujo. Cada voz se pidió por separado con
        // una única voz configurada, así que aquí no hay nada que reparar y no
        // se gasta ni una petición en mirarlo. Si esto avisa, lo que está
        // desfasado es la tabla de tonos de `TTS_VOICES`, no el audio.
        const verdict = checkTwoVoices(audioBytes, assignments[0].pitchHz, assignments[1].pitchHz);
        reporter.log(`Voces medidas en la pista: ${verdict.reason}`, verdict.ok ? 'info' : 'warn');
      }
    }

    reporter.start('encode');
    const audioData = bytesToBase64(audioBytes);
    reporter.finish(
      'encode',
      `Pista lista: ${formatSeconds(totalSeconds)} · ${formatBytes(audioBytes.length)} PCM`
    );
    reporter.flush();

    console.log('[TTS] Audio generation successful');
    return audioData;
  } catch (error: any) {
    const active = reporter.snapshot().activeStepId;
    if (active) reporter.fail(active, errorMessage(error));
    reporter.log(`Fallo en la síntesis: ${errorMessage(error)}`, 'error');
    console.error("Audio Gen Error:", error);
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      stack: error.stack
    });

    // Extract meaningful message from API error if possible
    let msg = error.message || "Error desconocido";
    if (isQuotaError(error)) {
      msg =
        "se agotó la cuota del modelo de voz (el nivel gratuito da 10 peticiones al día). " +
        "El plan de la lección sí se generó; vuelve a intentar el audio más tarde.";
    } else if (msg.includes("non-audio response") || msg.includes("INVALID_ARGUMENT")) {
      msg = "El modelo de audio rechazó el contenido del diálogo.";
    } else if (msg.includes("timeout") || msg.includes("DEADLINE_EXCEEDED")) {
      msg = "Tiempo de espera agotado. El audio puede ser muy largo, intenta reducir la longitud.";
    }
    throw new Error(`Error TTS: ${msg}`);
  }
};
