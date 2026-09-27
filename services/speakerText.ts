import { Character } from "../types";

/**
 * Utilidades de texto sobre hablantes y turnos, sin dependencias pesadas.
 *
 * Vivían en `geminiService.ts`, y por eso la voz de respaldo
 * (`webSpeechTts.ts`, que el reproductor importa) arrastraba al bundle inicial
 * el SDK de Gemini entero: ~450 KB de los ~1 MB que la app descargaba antes de
 * mostrar la pantalla de la clave. Aquí no importan nada más que tipos, así que
 * `geminiService` puede cargarse bajo demanda al generar. `geminiService` las
 * re-exporta para no romper a quien las importa de allí (los checks).
 */

// Sanitize text for TTS to avoid "non-audio response" errors caused by stage directions or formatting
export function sanitizeForTTS(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\*\[\]\(\)]/g, '') // Remove * [ ] ( ) characters often used for actions/emotions
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();
}

/** Minúsculas, sin tildes, sin acotaciones ni puntuación. Solo para comparar. */
export function normalizeSpeaker(raw: string): string {
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
export function canonicalSpeakerLabel(raw: string): string {
  const cleaned = (raw || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\*\[\]\{\}_"“”:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || (raw || '').trim();
}

export function findCharacter(speaker: string, characters: Character[]): Character | undefined {
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
