import { AppMode, Accent, Length, Level, LessonPlan, TextType } from '../types';

/**
 * Caché local de lecciones ya generadas.
 *
 * El diálogo se pide con `temperature: 0.0`, así que repetir la misma
 * configuración devolvía prácticamente la misma lección después de pagar otra
 * vez el pipeline completo (~1 minuto entre texto y voz). Aquí se guardan el
 * plan y el PCM del audio para que volver a una configuración sea inmediato.
 *
 * Va a IndexedDB y no a localStorage porque el audio de una lección ronda los
 * 2-8 MB. El PCM se guarda como bytes, no como el base64 que circula por la
 * app: son un 25 % menos de espacio por entrada.
 */

const DB_NAME = 'escuchalab';
const DB_VERSION = 1;
const STORE = 'lessons';

/** Tope de lecciones guardadas; se descartan las más antiguas por uso. */
const MAX_ENTRIES = 20;

export interface LessonCacheKeyParts {
  mode: AppMode;
  level: Level;
  topic: string;
  length: Length;
  textType: TextType;
  accent: Accent;
}

interface CachedLesson {
  key: string;
  plan: LessonPlan;
  /** PCM crudo (24 kHz, mono, 16 bits), tal como lo devuelve el TTS. */
  audio: Uint8Array;
  lastUsed: number;
}

export interface CachedLessonResult {
  plan: LessonPlan;
  /** El mismo base64 que devuelve `generateAudio()`. */
  audio: string;
}

/**
 * El modo "Adivina el Acento" sortea dos acentos en cada generación
 * (`buildLessonContext`), así que su clave no describe su contenido: servirlo
 * desde caché devolvería siempre el mismo par de acentos.
 */
export const isCacheable = (parts: LessonCacheKeyParts): boolean =>
  parts.mode !== AppMode.AccentChallenge;

/**
 * Versión del syllabus con la que se generó la lección. Forma parte de la clave
 * porque una lección cacheada es la lección ENTERA, ejercicios incluidos: sin
 * esto, cambiar el plan pedagógico de un nivel no tenía ningún efecto para quien
 * ya hubiera generado esa configuración, que seguía recibiendo desde IndexedDB
 * la lección vieja —con sus ejercicios viejos— hasta pulsar «Regenerar» una por
 * una. Súbela cuando cambie el blueprint de algún nivel o modo.
 */
export const SYLLABUS_VERSION = 2;

export const lessonCacheKey = (parts: LessonCacheKeyParts): string =>
  [
    `v${SYLLABUS_VERSION}`,
    parts.mode,
    parts.level,
    parts.textType,
    parts.accent,
    parts.length,
    parts.topic.trim()
  ].join(' :: ');

// --- BASE64 <-> BYTES (el audio circula en base64, se guarda en crudo) ---
const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  // Por trozos: `String.fromCharCode(...bytes)` revienta la pila con audio largo.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('lastUsed', 'lastUsed');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[Cache] IndexedDB no disponible:', request.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('[Cache] IndexedDB no disponible:', err);
      resolve(null);
    }
  });

  return dbPromise;
};

const asPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Devuelve la lección guardada para esa configuración, o `null`. */
export async function readLesson(key: string): Promise<CachedLessonResult | null> {
  const db = await openDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const entry = (await asPromise(store.get(key))) as CachedLesson | undefined;
    if (!entry || !entry.plan || !entry.audio?.length) return null;

    entry.lastUsed = Date.now();
    store.put(entry);
    return { plan: entry.plan, audio: bytesToBase64(new Uint8Array(entry.audio)) };
  } catch (err) {
    console.warn('[Cache] Lectura fallida:', err);
    return null;
  }
}

/** Guarda una lección completa y descarta las más antiguas si hace falta. */
export async function writeLesson(key: string, plan: LessonPlan, audioBase64: string): Promise<void> {
  const db = await openDb();
  if (!db || !audioBase64) return;

  try {
    const audio = base64ToBytes(audioBase64);
    if (!audio.length) return;

    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    // Se poda antes de escribir: si la entrada nueva desborda la cuota, la
    // transacción entera aborta y no se habría podado nada.
    const keys = (await asPromise(store.index('lastUsed').getAllKeys())) as IDBValidKey[];

    // Las entradas de una versión anterior del syllabus ya no las va a leer
    // nadie: se borran en vez de esperar a que la política LRU las expulse,
    // porque cada una ocupa varios megas de PCM.
    const prefix = `v${SYLLABUS_VERSION} :: `;
    const stale = keys.filter(k => typeof k === 'string' && !k.startsWith(prefix));
    for (const k of stale) store.delete(k);

    const others = keys.filter(k => k !== key && !stale.includes(k));
    const excess = others.length - (MAX_ENTRIES - 1);
    for (let i = 0; i < excess; i++) store.delete(others[i]);

    store.put({ key, plan, audio, lastUsed: Date.now() } satisfies CachedLesson);
  } catch (err) {
    console.warn('[Cache] Escritura fallida:', err);
  }
}

/** Invalida una entrada concreta (el botón «Regenerar»). */
export async function forgetLesson(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
  } catch (err) {
    console.warn('[Cache] Borrado fallido:', err);
  }
}
