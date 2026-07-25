import { DialogueLine } from '@/types';

/**
 * Utilidades de texto compartidas por los motores deterministas
 * (`exerciseEngines.ts`) y el verificador de claves (`exerciseVerification.ts`).
 *
 * Regla importante: la normalización sirve para COMPARAR, nunca para MOSTRAR.
 * Todo lo que se le enseña al alumno debe conservar su ortografía real, con
 * tildes y mayúsculas. (El sistema anterior mostraba "telefono" y "contrasena"
 * porque usaba la forma normalizada como texto de la opción.)
 */

export const STOPWORDS = new Set([
  'a', 'al', 'algo', 'asi', 'aqui', 'bien', 'con', 'como', 'cuando', 'de', 'del',
  'donde', 'el', 'ella', 'ellas', 'ellos', 'en', 'es', 'esa', 'ese', 'eso', 'esta',
  'este', 'esto', 'estan', 'estoy', 'fue', 'ha', 'han', 'hay', 'la', 'las', 'le',
  'les', 'lo', 'los', 'me', 'mi', 'mis', 'mucho', 'muy', 'no', 'o', 'para', 'pero',
  'por', 'porque', 'que', 'se', 'si', 'sin', 'su', 'sus', 'te', 'tu', 'un', 'una',
  'uno', 'unas', 'unos', 'usted', 'ustedes', 'ya', 'y', 'yo'
]);

/** Minúsculas, sin tildes y sin puntuación. Solo para comparar. */
export function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function clampText(text: string, max = 140): string {
  const t = (text || '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Índice de la transcripción para poder responder rápido a "¿esto se dice
 * realmente en el audio?". Es la base de toda la verificación de claves.
 */
export interface TranscriptIndex {
  /** Texto completo normalizado, con un espacio a cada lado para buscar frases. */
  padded: string;
  /** Palabras normalizadas presentes en el audio. */
  words: Set<string>;
  /** Turnos originales, para citar y para localizar oraciones. */
  lines: DialogueLine[];
}

export function buildTranscriptIndex(dialogue: DialogueLine[]): TranscriptIndex {
  const lines = dialogue || [];
  const normalized = normalizeText(lines.map(l => l.text || '').join(' '));
  const words = new Set(normalized.split(' ').filter(Boolean));
  return { padded: ` ${normalized} `, words, lines };
}

/** ¿Aparece esta palabra o frase literalmente en el audio? */
export function isHeard(index: TranscriptIndex, value: string): boolean {
  const needle = normalizeText(value);
  if (!needle) return false;
  if (!needle.includes(' ')) return index.words.has(needle);
  return index.padded.includes(` ${needle} `);
}

/** Palabras con carga semántica de un texto (normalizadas). */
export function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Proporción de palabras con contenido de `text` que suenan en el audio. Sirve
 * para detectar enunciados inventados que se presentan como citas literales.
 */
export function heardRatio(index: TranscriptIndex, text: string): number {
  const words = contentWords(text);
  if (words.length === 0) return 1;
  const hits = words.filter(w => index.words.has(w)).length;
  return hits / words.length;
}

/** Parte un turno en oraciones utilizables como base de un ejercicio. */
export function splitSentences(text: string): string[] {
  return (text || '')
    .split(/(?<=[.!?¿¡…])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Parte una frase en tokens visibles (la puntuación queda pegada a su palabra). */
export function splitTokens(text: string): string[] {
  return (text || '').trim().split(/\s+/).filter(Boolean);
}
