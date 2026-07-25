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
 * 2-4 MB.
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
  audio: Uint8Array;
  lastUsed: number;
}

export interface CachedLessonResult {
  plan: LessonPlan;
  audio: Uint8Array;
}

/**
 * El modo "Adivina el Acento" sortea dos acentos en cada generación
 * (`buildLessonContext`), así que su clave no describe su contenido: servirlo
 * desde caché devolvería siempre el mismo par de acentos.
 */
export const isCacheable = (parts: LessonCacheKeyParts): boolean =>
  parts.mode !== AppMode.AccentChallenge;

export const lessonCacheKey = (parts: LessonCacheKeyParts): string =>
  [parts.mode, parts.level, parts.textType, parts.accent, parts.length, parts.topic.trim()].join(' :: ');

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
    return { plan: entry.plan, audio: new Uint8Array(entry.audio) };
  } catch (err) {
    console.warn('[Cache] Lectura fallida:', err);
    return null;
  }
}

/** Guarda una lección completa y descarta las más antiguas si hace falta. */
export async function writeLesson(key: string, plan: LessonPlan, audio: Uint8Array): Promise<void> {
  const db = await openDb();
  if (!db || !audio?.length) return;

  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ key, plan, audio, lastUsed: Date.now() } satisfies CachedLesson);

    const keys = (await asPromise(store.index('lastUsed').getAllKeys())) as IDBValidKey[];
    const excess = keys.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i++) store.delete(keys[i]);
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
