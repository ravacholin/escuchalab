/**
 * Respaldo (failsafe) de TTS con la Web Speech API del navegador.
 *
 * El TTS de Gemini vive del nivel gratis (10 peticiones al día por modelo). Cuando
 * esa cuota se agota —o el modelo de voz falla por cualquier motivo tras recorrer
 * toda la cadena `AUDIO_MODELS`—, la lección se quedaba sin audio. Este módulo es el
 * respaldo: `window.speechSynthesis` es gratis, sin clave, sin cuota y sin red, así
 * que no puede «quedarse sin créditos».
 *
 * A cambio, la fidelidad baja: solo se usan las voces `es-XX` que el navegador
 * ofrezca (sin los perfiles fonéticos de Gemini), y no hay bytes de audio —la Web
 * Speech habla directa al dispositivo—, por lo que el modo respaldo no tiene
 * descarga WAV ni caché. El ambiente sí se mezcla (es independiente).
 *
 * Todo aquí es **lógica pura y serializable**: `planWebSpeech` arma los datos que
 * viajan por el estado de React y `pickWebSpeechVoices` recibe la lista de voces
 * como argumento, así que ambos se prueban sin navegador (`scripts/check-webspeech.mjs`).
 * La resolución de las voces concretas y el habla ocurren en el reproductor.
 */

import { Accent, Character, DialogueLine, WebSpeechPlan } from '../types';
import { sanitizeForTTS, canonicalSpeakerLabel, findCharacter } from './geminiService';

/** ¿Hay Web Speech utilizable en este entorno? */
export function isWebSpeechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof (window as any).SpeechSynthesisUtterance === 'function'
  );
}

/**
 * Acento de la lección → etiqueta BCP-47 preferida. El navegador puede no tener la
 * variante exacta; `pickWebSpeechVoices` degrada a cualquier `es-*` y, en último
 * caso, a cualquier voz. El Caribe se mapea a `es-US`, que es la variante caribeña
 * que suelen traer los navegadores.
 */
export const ACCENT_LOCALE: Record<Accent, string> = {
  [Accent.Madrid]: 'es-ES',
  [Accent.Andalusia]: 'es-ES',
  [Accent.MexicoCity]: 'es-MX',
  [Accent.Bogota]: 'es-CO',
  [Accent.Caribbean]: 'es-US',
  [Accent.BuenosAires]: 'es-AR',
  [Accent.Santiago]: 'es-CL',
  [Accent.Lima]: 'es-PE'
};

/** Forma mínima de `SpeechSynthesisVoice` que necesitamos; así el selector se
 *  prueba con voces simuladas en Node, donde el tipo del DOM no existe. */
export interface VoiceLike {
  name: string;
  lang: string;
}

const normLang = (lang: string) => (lang || '').replace('_', '-').toLowerCase();
const isSpanish = (v: VoiceLike) => normLang(v.lang).startsWith('es');

/**
 * Puntúa cuánto encaja una voz con el locale pedido: misma región (es-mx==es-mx) >
 * mismo idioma (es-*) > cualquiera. No decide sola: el orden y el desempate por
 * hablante los pone `pickWebSpeechVoices`.
 */
function localeScore(voice: VoiceLike, locale: string): number {
  const want = normLang(locale);
  const have = normLang(voice.lang);
  if (have === want) return 3;
  if (isSpanish(voice) && have.split('-')[0] === want.split('-')[0]) return 2;
  if (isSpanish(voice)) return 1;
  return 0;
}

/** Heurística barata de género por el nombre de la voz, para diferenciar dos
 *  hablantes cuando el catálogo no marca género (la Web Speech no lo expone). */
const FEMALE_HINTS = ['female', 'mujer', 'mónica', 'monica', 'paulina', 'marisol', 'helena', 'laura', 'lucia', 'lucía', 'sabina', 'esperanza', 'google español'];
const MALE_HINTS = ['male', 'hombre', 'jorge', 'diego', 'juan', 'carlos', 'pablo', 'enrique', 'miguel'];

function voiceGenderHint(voice: VoiceLike): 'Male' | 'Female' | null {
  const n = voice.name.toLowerCase();
  if (FEMALE_HINTS.some(h => n.includes(h))) return 'Female';
  if (MALE_HINTS.some(h => n.includes(h))) return 'Male';
  return null;
}

/**
 * Elige una voz por hablante a partir de la lista que ofrece el navegador.
 *
 * Función **pura**: recibe las voces como argumento (así se prueba con voces
 * simuladas). Prioridad por hablante: locale exacto → mismo idioma `es-*` →
 * cualquier `es` → primera voz disponible. Con dos hablantes intenta darles
 * **objetos de voz distintos**, prefiriendo diferenciarlos por el género declarado
 * en `characters` (o por la pista del nombre de la voz), replicando la intención de
 * `pickVoicePair` con lo que el navegador tenga. Devuelve `null` para un hablante
 * solo si no hay ninguna voz en absoluto.
 */
export function pickWebSpeechVoices(
  voices: VoiceLike[],
  accent: Accent,
  genders: Array<'Male' | 'Female' | undefined>
): (VoiceLike | null)[] {
  if (!voices || voices.length === 0) return genders.map(() => null);
  const locale = ACCENT_LOCALE[accent] || 'es';

  // Voces candidatas ordenadas por encaje de locale (estable dentro del mismo
  // puntaje, para que el resultado sea determinista).
  const ranked = voices
    .map((v, i) => ({ v, i, score: localeScore(v, locale) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(r => r.v);

  const chosen: (VoiceLike | null)[] = [];
  const used = new Set<VoiceLike>();

  for (const wantGender of genders) {
    // Preferir una voz aún no usada; entre las libres, la que coincida con el
    // género pedido si lo hay. Si todas están usadas (catálogo pequeño), se repite
    // la mejor —dos voces iguales es peor que ninguna diferencia, pero mejor que
    // callar a un hablante—.
    const free = ranked.filter(v => !used.has(v));
    const pool = free.length ? free : ranked;

    let pick: VoiceLike | undefined;
    if (wantGender) {
      pick = pool.find(v => voiceGenderHint(v) === wantGender);
    }
    if (!pick) {
      // Sin coincidencia de género: para el segundo hablante, evitar repetir el
      // género del primero cuando se pueda, para que suenen distintos.
      pick = pool[0];
    }

    chosen.push(pick || null);
    if (pick) used.add(pick);
  }

  return chosen;
}

/**
 * Construye el plan de respaldo desde el diálogo ya generado. Limpia acotaciones
 * (`sanitizeForTTS`), atribuye cada turno a su hablante y adjunta el género del
 * personaje para que el reproductor pueda diferenciar las voces. Mantiene el orden
 * del diálogo; descarta turnos vacíos o sin texto tras el saneado.
 */
export function planWebSpeech(
  dialogue: DialogueLine[],
  characters: Character[],
  accent: Accent
): WebSpeechPlan {
  const lines: WebSpeechPlan['lines'] = [];
  dialogue.forEach((d, at) => {
    const text = sanitizeForTTS(d.text || '');
    if (!text) return;
    const speaker = canonicalSpeakerLabel(d.speaker || '');
    const character = findCharacter(d.speaker || '', characters || []);
    lines.push({ at, speaker, text, gender: character?.gender });
  });
  return { kind: 'webspeech', accent, lines };
}
