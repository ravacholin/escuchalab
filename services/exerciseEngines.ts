import { compareByStage, EngineId, ExerciseSlot } from '@/data/listeningSyllabus';
import { DialogueLine, Exercise, ExerciseField, ExerciseOption } from '@/types';
import { verifyExercise } from './exerciseVerification';
import {
  buildTranscriptIndex,
  clampText,
  isHeard,
  normalizeText,
  shuffle,
  splitSentences,
  splitTokens,
  STOPWORDS,
  TranscriptIndex
} from './textUtils';

/**
 * ============================================================================
 *  MOTORES DETERMINISTAS
 * ============================================================================
 *
 * Plan B cuando el modelo no cubre un slot del syllabus o cuando el ejercicio
 * que devolvió no supera la verificación de claves.
 *
 * La política cambió respecto de la versión anterior. Antes esta capa
 * garantizaba "al menos un ejercicio de cada widget", sin mirar el nivel ni el
 * tipo de audio, ANTEPONÍA sus ejercicios y luego recortaba la lista por el
 * principio, de modo que los ejercicios buenos del modelo eran justamente los
 * que se perdían. Ahora rellena huecos concretos del blueprint, en la posición
 * del hueco, y todo lo que produce pasa por el mismo verificador que lo del
 * modelo.
 *
 * También se eliminaron los motores cuyas claves eran falsas o triviales:
 *
 *  - la clasificación de registro por palabras sueltas, que daba "gracias" y
 *    "por favor" como marcas de formalidad (no lo son: son neutras) y mezclaba
 *    marcas dialectales como "che" o "po" con el registro;
 *  - el ordenamiento de los cuatro primeros turnos contiguos, reconstruible
 *    leyendo por adyacencia;
 *  - los distractores tomados de una lista fija ajena al tema ("tornillo",
 *    "enchufe"), que se descartan por plausibilidad temática sin escuchar.
 *
 * Y se corrigió el fallo que rompía los cloze: el objetivo se buscaba en forma
 * normalizada (`\btelefono\b`) dentro del texto original, así que con cualquier
 * palabra acentuada el reemplazo fallaba en silencio; y cuando funcionaba, al
 * alumno se le mostraba la opción sin tildes y en minúscula. Aquí siempre se
 * opera con el token ORIGINAL y se muestra su ortografía real.
 */

// ---------------------------------------------------------------------------
// Pares mínimos reales del español
// ---------------------------------------------------------------------------
// Se excluyen a propósito los contrastes que están neutralizados en la mayoría
// de las variantes y que, por tanto, serían indistinguibles al oído:
// b/v (vaca~baca), ll/y (pollo~poyo), h muda (hola~ola) y, en zonas de seseo,
// c/z frente a s (casa~caza). Un "par mínimo" que suena igual no discrimina
// nada: solo penaliza al alumno.

const MINIMAL_PAIR_BANK: [string, string][] = [
  // vibrante simple / múltiple
  ['pero', 'perro'], ['caro', 'carro'], ['cero', 'cerro'], ['coro', 'corro'],
  ['para', 'parra'], ['ahora', 'ahorra'], ['moro', 'morro'], ['foro', 'forro'],
  ['careta', 'carreta'], ['pera', 'perra'],
  // sordas / sonoras
  ['pata', 'bata'], ['peso', 'beso'], ['pala', 'bala'], ['pote', 'bote'],
  ['cana', 'gana'], ['cama', 'gama'], ['coma', 'goma'], ['col', 'gol'],
  ['casa', 'gasa'], ['tos', 'dos'], ['tía', 'día'], ['tomo', 'domo'],
  // acento de palabra (presente / pasado)
  ['hablo', 'habló'], ['tomo', 'tomó'], ['canto', 'cantó'], ['llamo', 'llamó'],
  ['cambio', 'cambió'], ['trabajo', 'trabajó'], ['termino', 'terminó'],
  ['paso', 'pasó'], ['llego', 'llegó'], ['compro', 'compró'], ['pago', 'pagó'],
  ['esta', 'está'], ['este', 'esté'], ['papa', 'papá'], ['mama', 'mamá'],
  ['numero', 'número'], ['publico', 'público'], ['animo', 'ánimo'],
  // monosílabos con tilde diacrítica
  ['el', 'él'], ['tu', 'tú'], ['mi', 'mí'], ['si', 'sí'], ['mas', 'más'],
  ['se', 'sé'], ['de', 'dé'], ['te', 'té'], ['aun', 'aún'],
  // vocales próximas
  ['mesa', 'misa'], ['peso', 'piso'], ['cara', 'cera'], ['mano', 'mono'],
  ['pan', 'pon'], ['ven', 'van'], ['sal', 'sol'], ['gato', 'gata'],
  ['libro', 'libre'], ['sala', 'sola'], ['cuenta', 'cuento'], ['puerta', 'puerto'],
  ['banco', 'blanco'], ['carta', 'cuarta'], ['pierna', 'prensa']
];

/** Índice palabra normalizada → posibles pares mínimos (con su ortografía real). */
const PAIR_INDEX: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  const add = (key: string, value: string) => {
    const k = normalizeText(key);
    if (!k) return;
    const list = map.get(k) || [];
    if (!list.includes(value)) list.push(value);
    map.set(k, list);
  };
  for (const [a, b] of MINIMAL_PAIR_BANK) {
    add(a, b);
    add(b, a);
  }
  return map;
})();

/**
 * Vecinos fonéticos generados cuando la palabra no está en el banco. Solo se
 * aplican transformaciones que producen un contraste audible en español.
 */
function generatedNeighbours(word: string, preserveNumber = false): string[] {
  const out: string[] = [];
  const push = (candidate: string) => {
    if (candidate && candidate !== word && !out.includes(candidate)) out.push(candidate);
  };

  // Cambio de la vocal final (género y persona verbal).
  const last = word.slice(-1).toLowerCase();
  if (last === 'a') push(`${word.slice(0, -1)}o`);
  if (last === 'o') push(`${word.slice(0, -1)}a`);
  if (last === 'e') push(`${word.slice(0, -1)}a`);

  // Número. Se omite cuando el distractor tiene que encajar dentro de una frase:
  // cambiar el número rompe la concordancia y delata la opción sin escucharla.
  if (!preserveNumber) {
    if (last === 's') push(word.slice(0, -1));
    else if ('aeiou'.includes(last)) push(`${word}s`);
  }

  // Vibrante simple / múltiple.
  if (/[aeiou]r[aeiou]/i.test(word)) push(word.replace(/([aeiou])r([aeiou])/i, '$1rr$2'));
  if (/rr/i.test(word)) push(word.replace(/rr/i, 'r'));

  return out;
}

/** Distractor que suena parecido a `word` y que NO se dice en el audio. */
function phoneticDistractor(
  word: string,
  index: TranscriptIndex,
  used: Set<string>,
  preserveNumber = false
): string | null {
  const banked = (PAIR_INDEX.get(normalizeText(word)) || []).filter(candidate => {
    if (!preserveNumber) return true;
    // Dentro de una frase, el par solo sirve si mantiene el número.
    return candidate.endsWith('s') === word.endsWith('s');
  });
  const candidates = [...banked, ...generatedNeighbours(word, preserveNumber)];
  for (const candidate of candidates) {
    const key = normalizeText(candidate);
    if (!key || used.has(key)) continue;
    if (isHeard(index, candidate)) continue;
    used.add(key);
    return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extracción de material del audio
// ---------------------------------------------------------------------------

interface WordRef {
  /** Ortografía real, tal como se le mostrará al alumno. */
  original: string;
  normalized: string;
  lineIndex: number;
}

const EDGE_PUNCTUATION = /^[¡¿"'“”«»(\[]+|[.,;:!?"'“”«»)\]…]+$/g;

function stripEdges(token: string): string {
  return token.replace(EDGE_PUNCTUATION, '');
}

/** Palabras con carga semántica del audio, conservando su forma original. */
function collectContentWords(dialogue: DialogueLine[]): WordRef[] {
  const out: WordRef[] = [];
  const seen = new Set<string>();

  (dialogue || []).forEach((line, lineIndex) => {
    for (const token of splitTokens(line.text || '')) {
      const original = stripEdges(token);
      const normalized = normalizeText(original);
      if (normalized.length < 4) continue;
      if (STOPWORDS.has(normalized)) continue;
      if (/\d/.test(original)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ original, normalized, lineIndex });
    }
  });

  return out;
}

/** Turnos suficientemente largos para servir de base a un ejercicio. */
function usableSentences(dialogue: DialogueLine[], minWords: number, maxWords = 40) {
  const out: { text: string; lineIndex: number; speaker: string }[] = [];
  (dialogue || []).forEach((line, lineIndex) => {
    for (const sentence of splitSentences(line.text || '')) {
      const words = splitTokens(sentence).length;
      if (words < minWords || words > maxWords) continue;
      out.push({ text: sentence, lineIndex, speaker: (line.speaker || '').trim() });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Motores
// ---------------------------------------------------------------------------

type Engine = (dialogue: DialogueLine[], slot: ExerciseSlot, index: TranscriptIndex) => Exercise | null;

/**
 * Caza de palabras: se muestran palabras del audio junto a otras que suenan
 * parecido pero no se dicen. El contraste es fonético, no temático, para que no
 * se pueda acertar por plausibilidad.
 */
const selectAllHeard: Engine = (dialogue, slot, index) => {
  const target = Math.max(2, Math.floor(slot.items / 2));
  const words = shuffle(collectContentWords(dialogue)).slice(0, 30);
  if (words.length < target) return null;

  const used = new Set<string>();
  const heard: ExerciseOption[] = [];
  const unheard: ExerciseOption[] = [];

  for (const word of words) {
    if (heard.length >= target) break;
    const distractor = phoneticDistractor(word.original, index, used);
    if (!distractor) continue;
    used.add(word.normalized);
    heard.push({ id: `eng_sa_h${heard.length}`, text: word.original });
    unheard.push({ id: `eng_sa_x${unheard.length}`, text: distractor });
  }

  if (heard.length < 2) return null;

  const options = shuffle([...heard, ...unheard]);
  return {
    id: 'eng_select_all_heard',
    type: 'multiple_choice',
    question: 'Marcá TODAS las palabras que se dicen en el audio.',
    options,
    correctAnswer: heard.map(o => o.id),
    explanation:
      'Cada palabra tiene al lado otra que suena casi igual pero no se dice. La diferencia está en un solo sonido: hay que volver a escuchar ese tramo, no razonar por el tema.'
  };
};

/** La misma discriminación fonética, planteada como juicio ítem a ítem. */
const mentionTrueFalse: Engine = (dialogue, slot, index) => {
  const built = selectAllHeard(dialogue, slot, index);
  if (!built || !built.options) return null;

  const correct = new Set(built.correctAnswer as string[]);
  const rows = built.options.map((opt, i) => ({ id: `eng_tf_r${i}`, text: opt.text }));
  const answer: Record<string, string> = {};
  built.options.forEach((opt, i) => {
    answer[`eng_tf_r${i}`] = correct.has(opt.id) ? 'true' : 'false';
  });

  return {
    id: 'eng_mention_true_false',
    type: 'true_false',
    question: '¿Se dice esta palabra en el audio?',
    rows,
    correctAnswer: answer,
    explanation:
      'Marcá VERDADERO solo si la palabra suena tal cual. Las falsas se parecen mucho a otras que sí aparecen.'
  };
};

/** Discriminación fónica pura: la palabra del audio frente a su par mínimo. */
const minimalPairs: Engine = (dialogue, slot, index) => {
  const words = collectContentWords(dialogue);
  const fields: ExerciseField[] = [];
  const answer: Record<string, string> = {};
  const used = new Set<string>();

  for (const word of words) {
    if (fields.length >= slot.items) break;

    // Se prefiere el banco de pares reales; los vecinos generados son el respaldo.
    const banked = (PAIR_INDEX.get(word.normalized) || []).find(
      candidate => !isHeard(index, candidate) && !used.has(normalizeText(candidate))
    );
    const distractor = banked || phoneticDistractor(word.original, index, used);
    if (!distractor) continue;

    used.add(word.normalized);
    used.add(normalizeText(distractor));

    const fieldId = `eng_mp_${fields.length}`;
    const correctId = `${fieldId}_ok`;
    fields.push({
      id: fieldId,
      label: String(fields.length + 1),
      options: shuffle([
        { id: correctId, text: word.original },
        { id: `${fieldId}_x`, text: distractor }
      ])
    });
    answer[fieldId] = correctId;
  }

  if (fields.length < 3) return null;

  return {
    id: 'eng_minimal_pairs',
    type: 'minimal_pairs',
    question: '¿Qué oíste? Elegí la forma que suena en el audio.',
    fields,
    correctAnswer: answer,
    explanation:
      'Las dos formas se diferencian en un solo sonido o en la sílaba acentuada. Es discriminación pura: hay que fiarse del oído, no del sentido.'
  };
};

// --- Ficha de datos ------------------------------------------------------

const DIGIT_LITERAL = /\b\d{1,4}(?:[.,:]\d{1,2})?\b|\b\d{5,}\b/g;

function labelFor(literal: string): string {
  if (literal.includes(':')) return 'Hora';
  if (/[.,]\d{2}$/.test(literal)) return 'Precio';
  if (literal.replace(/\D/g, '').length >= 6) return 'Teléfono';
  return 'Número';
}

/** Alternativas casi idénticas: se cambia un solo elemento del dato. */
function nearMisses(literal: string): string[] {
  const out: string[] = [];
  const push = (candidate: string) => {
    if (candidate && candidate !== literal && !out.includes(candidate)) out.push(candidate);
  };

  if (literal.includes(':')) {
    const [h, m = '00'] = literal.split(':');
    push(`${h}:${m.split('').reverse().join('')}`);
    push(`${Number(h) + 1}:${m}`);
    push(`${h}:${m === '30' ? '13' : '30'}`);
  } else if (/[.,]/.test(literal)) {
    const sep = literal.includes(',') ? ',' : '.';
    const [whole, dec] = literal.split(sep);
    push(`${whole.split('').reverse().join('')}${sep}${dec}`);
    push(`${whole}${sep}${dec.split('').reverse().join('')}`);
    push(`${Number(whole) + 1}${sep}${dec}`);
  } else if (literal.length >= 5) {
    const digits = literal.split('');
    const mid = Math.floor(digits.length / 2);
    const swapped = [...digits];
    [swapped[mid], swapped[mid - 1]] = [swapped[mid - 1], swapped[mid]];
    push(swapped.join(''));
    push(`${digits.slice(0, -1).join('')}${(Number(digits[digits.length - 1]) + 1) % 10}`);
  } else {
    const n = Number(literal);
    if (Number.isFinite(n)) {
      push(String(n + 10));
      push(String(n + 1));
      if (n > 1) push(String(n - 1));
    }
  }

  return out;
}

const dataCapture: Engine = (dialogue, slot) => {
  const literals: { value: string; lineIndex: number }[] = [];
  const seen = new Set<string>();

  (dialogue || []).forEach((line, lineIndex) => {
    for (const match of (line.text || '').match(DIGIT_LITERAL) || []) {
      if (seen.has(match)) continue;
      seen.add(match);
      literals.push({ value: match, lineIndex });
    }
  });

  const fields: ExerciseField[] = [];
  const answer: Record<string, string> = {};
  const sourceTurns: number[] = [];

  for (const literal of literals) {
    if (fields.length >= slot.items) break;
    const misses = nearMisses(literal.value).slice(0, 2);
    if (misses.length < 2) continue;

    const fieldId = `eng_dc_${fields.length}`;
    const correctId = `${fieldId}_ok`;
    // Dos horas o dos precios en la misma ficha se numeran: una etiqueta
    // repetida no le dice al alumno cuál de los dos datos tiene que anotar.
    const baseLabel = labelFor(literal.value);
    const repeats = fields.filter(f => f.label === baseLabel || f.label.startsWith(`${baseLabel} `)).length;
    fields.push({
      id: fieldId,
      label: repeats === 0 ? baseLabel : `${baseLabel} ${repeats + 1}`,
      options: shuffle([
        { id: correctId, text: literal.value },
        ...misses.map((text, i) => ({ id: `${fieldId}_x${i}`, text }))
      ])
    });
    answer[fieldId] = correctId;
    if (!sourceTurns.includes(literal.lineIndex)) sourceTurns.push(literal.lineIndex);
  }

  if (fields.length < 2) return null;

  return {
    id: 'eng_data_capture',
    type: 'data_capture',
    question: 'Completá la ficha con los datos que se dicen en el audio.',
    fields,
    correctAnswer: answer,
    sourceTurns,
    explanation:
      'Las alternativas se diferencian en una sola cifra. Es exactamente lo que hay que resolver en la vida real al anotar un precio o una hora al vuelo.'
  };
};

// --- Cloze ---------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sustituye una palabra por su hueco respetando los límites de palabra también
 * con tildes y eñes, que es donde fallaba la implementación anterior.
 */
function replaceWord(text: string, word: string, marker: string): string | null {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'u');
  if (!pattern.test(text)) return null;
  return text.replace(pattern, marker);
}

function buildCloze(dialogue: DialogueLine[], index: TranscriptIndex, gaps: number): Exercise | null {
  const sentences = usableSentences(dialogue, gaps === 2 ? 8 : 5);
  const used = new Set<string>();

  for (const sentence of sentences) {
    const tokens = splitTokens(sentence.text).map(stripEdges);
    const candidates = tokens
      // Se descarta la primera palabra: suele ser un saludo o un conector y su
      // hueco se completa por rutina, sin escuchar.
      .slice(1)
      .filter(word => {
        const norm = normalizeText(word);
        return norm.length >= 5 && !STOPWORDS.has(norm) && !/\d/.test(word);
      })
      // Las palabras largas son las que llevan la carga informativa.
      .sort((a, b) => b.length - a.length);
    if (candidates.length < gaps) continue;

    const targets = candidates.slice(0, gaps);
    if (new Set(targets.map(normalizeText)).size !== targets.length) continue;

    let textWithGaps: string | null = sentence.text;
    const gapOptions: Record<string, ExerciseOption[]> = {};
    const answer: Record<string, string> = {};
    let ok = true;

    targets.forEach((target, i) => {
      if (!ok || !textWithGaps) return;
      const gapId = `gap${i + 1}`;
      const replaced = replaceWord(textWithGaps, target, `{{${gapId}}}`);
      if (!replaced) {
        ok = false;
        return;
      }
      textWithGaps = replaced;

      // Los distractores suenan parecido al objetivo: la elección se resuelve
      // discriminando, no descartando por gramática.
      const distractors: string[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = phoneticDistractor(target, index, used, true);
        if (candidate) distractors.push(candidate);
      }
      if (distractors.length < 1) {
        ok = false;
        return;
      }

      const correctId = `${gapId}_ok`;
      gapOptions[gapId] = shuffle([
        { id: correctId, text: target },
        ...distractors.map((text, d) => ({ id: `${gapId}_x${d}`, text }))
      ]);
      answer[gapId] = correctId;
    });

    if (!ok || !textWithGaps) continue;

    return {
      id: gaps === 2 ? 'eng_two_gap_cloze' : 'eng_listening_cloze',
      type: 'cloze',
      question: sentence.speaker
        ? `Completá lo que dice ${sentence.speaker}.`
        : 'Completá la frase tal como suena en el audio.',
      textWithGaps,
      gapOptions,
      correctAnswer: answer,
      sourceTurns: [sentence.lineIndex],
      explanation:
        'Las opciones se diferencian en un solo sonido o en la sílaba acentuada, así que las dos encajan en la frase: la única forma de decidir es volver a escuchar.'
    };
  }

  return null;
}

const listeningCloze: Engine = (dialogue, _slot, index) => buildCloze(dialogue, index, 1);
const twoGapCloze: Engine = (dialogue, _slot, index) => buildCloze(dialogue, index, 2) || buildCloze(dialogue, index, 1);

// --- Caza el cambio ------------------------------------------------------

/**
 * Alteraciones que mantienen la frase gramatical y verosímil. Si el cambio
 * produjera algo agramatical, se detectaría leyendo y el ejercicio dejaría de
 * medir comprensión auditiva.
 */
const SWAPS: [string, string][] = [
  // Preposiciones y conjunciones: no tocan la concordancia.
  ['a', 'de'], ['en', 'con'], ['por', 'para'], ['desde', 'hasta'], ['sobre', 'bajo'],
  ['pero', 'porque'], ['cuando', 'donde'],
  // Adverbios y cuantificadores invariables en esta forma.
  ['muy', 'tan'], ['también', 'tampoco'], ['siempre', 'nunca'],
  ['aquí', 'allí'], ['ahora', 'luego'], ['mucho', 'poco'], ['más', 'menos'],
  ['algo', 'nada'], ['alguien', 'nadie'],
  // Posesivos y demostrativos que conservan género y número.
  ['mi', 'su'], ['tu', 'su'], ['este', 'ese'], ['esta', 'esa'],
  // Clíticos que no arrastran concordancia con un sustantivo contiguo.
  ['me', 'te'], ['le', 'les']
];

// NO se incluyen aquí los cambios de género o número en determinantes y
// clíticos (el/la, un/una, los/las, lo/la). Rompen la concordancia con el
// sustantivo siguiente y producen frases agramaticales como "por lo tos", que
// se detectan leyendo y por tanto dejan de medir comprensión auditiva.

const SWAP_INDEX: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [a, b] of SWAPS) {
    map.set(normalizeText(a), b);
    map.set(normalizeText(b), a);
  }
  return map;
})();

/** Cambio de tiempo verbal en formas regulares muy frecuentes. */
function tenseSwap(word: string): string | null {
  if (/ó$/.test(word)) return `${word.slice(0, -1)}a`;
  if (/aba$/.test(word)) return `${word.slice(0, -3)}ó`;
  if (/amos$/.test(word)) return `${word.slice(0, -4)}aban`;
  return null;
}

function matchCase(source: string, replacement: string): string {
  if (!source || !replacement) return replacement;
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const spotTheDifference: Engine = (dialogue, slot) => {
  const sentences = usableSentences(dialogue, 10, 28);
  let best: Exercise | null = null;
  let bestCount = 0;

  for (const sentence of sentences) {
    const rawTokens = splitTokens(sentence.text);
    const sentenceWords = new Set(rawTokens.map(t => normalizeText(stripEdges(t))).filter(Boolean));

    const tokens: { id: string; text: string }[] = [];
    const altered: string[] = [];

    rawTokens.forEach((raw, i) => {
      const id = `t${i}`;
      const bare = stripEdges(raw);
      const trailing = raw.slice(bare.length ? raw.indexOf(bare) + bare.length : raw.length);
      const leading = raw.slice(0, raw.indexOf(bare) === -1 ? 0 : raw.indexOf(bare));

      if (altered.length < slot.items && bare) {
        const norm = normalizeText(bare);
        const candidate = SWAP_INDEX.get(norm) || tenseSwap(bare);
        // La palabra alterada no puede existir ya en la frase: si existe, el
        // alumno no tendría forma de saber cuál de las dos es la intrusa.
        if (candidate && !sentenceWords.has(normalizeText(candidate))) {
          tokens.push({ id, text: `${leading}${matchCase(bare, candidate)}${trailing}` });
          altered.push(id);
          return;
        }
      }

      tokens.push({ id, text: raw });
    });

    // Se queda con la oración que admite MÁS cambios: dos alteraciones en una
    // frase larga se cazan por casualidad; cuatro obligan a recorrerla entera.
    if (altered.length >= 2 && tokens.length >= 6 && altered.length > bestCount) {
      bestCount = altered.length;
      best = {
        id: 'eng_spot_the_difference',
        type: 'spot_the_difference',
        question: 'Se cambiaron algunas palabras. Marcá las que NO se dicen en el audio.',
        tokens,
        correctAnswer: altered,
        sourceTurns: [sentence.lineIndex],
        explanation:
          'Los cambios mantienen la frase perfectamente gramatical, así que leyéndola no se notan: hay que contrastarla palabra por palabra con lo que suena.'
      };
      if (bestCount >= slot.items) break;
    }
  }

  return best;
};

// --- Reconstruir la frase ------------------------------------------------

/**
 * Palabras átonas que en el habla se apoyan en la siguiente: un grupo fónico
 * empieza en ellas, nunca termina en ellas.
 */
const GROUP_STARTERS = new Set([
  'a', 'ante', 'bajo', 'con', 'contra', 'de', 'desde', 'en', 'entre', 'hacia',
  'hasta', 'para', 'por', 'segun', 'sin', 'sobre', 'tras',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
  'que', 'quien', 'cuando', 'donde', 'como', 'porque', 'pero', 'y', 'o', 'si',
  'mi', 'tu', 'su', 'nuestro', 'este', 'esta', 'ese', 'esa', 'aquel'
]);

const chunkOrder: Engine = dialogue => {
  const sentences = usableSentences(dialogue, 8, 18);

  for (const sentence of sentences) {
    const words = splitTokens(sentence.text);
    if (words.length < 8) continue;

    // Se corta donde cortaría la voz: antes de una preposición, un determinante
    // o un relativo, y nunca dejando grupos de una sola palabra.
    const target = Math.ceil(words.length / 4);
    const options: ExerciseOption[] = [];
    let current: string[] = [];

    words.forEach((word, i) => {
      const startsGroup = GROUP_STARTERS.has(normalizeText(stripEdges(word)));
      const shouldBreak =
        current.length >= 2 &&
        i < words.length - 1 &&
        (current.length >= target || startsGroup) &&
        (startsGroup || current.length >= target + 1);

      if (shouldBreak) {
        options.push({ id: `k${options.length}`, text: current.join(' ') });
        current = [];
      }
      current.push(word);
    });
    if (current.length > 0) {
      if (current.length === 1 && options.length > 0) {
        options[options.length - 1].text += ` ${current[0]}`;
      } else {
        options.push({ id: `k${options.length}`, text: current.join(' ') });
      }
    }

    if (options.length < 3 || options.length > 6) continue;

    return {
      id: 'eng_chunk_order',
      type: 'chunk_order',
      question: 'Reconstruí la frase: ordená los grupos tal como se pronuncian.',
      options: shuffle(options),
      correctAnswer: options.map(o => o.id),
      sourceTurns: [sentence.lineIndex],
      explanation:
        'En el habla real estos grupos se pronuncian de corrido, sin pausa entre las palabras. Reconstruirlos es entrenar la segmentación de la cadena hablada.'
    };
  }

  return null;
};

const ENGINES: Record<EngineId, Engine> = {
  select_all_heard: selectAllHeard,
  mention_true_false: mentionTrueFalse,
  listening_cloze: listeningCloze,
  two_gap_cloze: twoGapCloze,
  data_capture: dataCapture,
  minimal_pairs: minimalPairs,
  spot_the_difference: spotTheDifference,
  chunk_order: chunkOrder
};

// ---------------------------------------------------------------------------
// Composición final de la lección
// ---------------------------------------------------------------------------

/**
 * Empareja los ejercicios verificados con los slots del blueprint y rellena con
 * motores los que quedaron vacíos. El resultado sale ordenado por etapa de
 * escucha, que es el recorrido que después muestra la interfaz.
 */
export function fillMissingSlots(
  verified: Exercise[],
  blueprint: ExerciseSlot[],
  dialogue: DialogueLine[]
): Exercise[] {
  const index = buildTranscriptIndex(dialogue);
  const pool = [...verified];
  const result: Exercise[] = [];

  blueprint.forEach((slot, position) => {
    // El modelo suele devolver el slotId; si no lo hace, se empareja por formato.
    let i = pool.findIndex(ex => ex.slotId === slot.slotId);
    if (i < 0) i = pool.findIndex(ex => ex.type === slot.format);

    if (i >= 0) {
      const [ex] = pool.splice(i, 1);
      result.push({
        ...ex,
        id: ex.id || `${slot.slotId}_${position}`,
        slotId: slot.slotId,
        stage: slot.stage,
        skill: slot.skill
      });
      return;
    }

    const engine = slot.engineFallback ? ENGINES[slot.engineFallback] : undefined;
    if (!engine) {
      console.warn(`[ejercicios] slot "${slot.slotId}" sin cubrir y sin motor de respaldo`);
      return;
    }

    let built: Exercise | null = null;
    try {
      built = engine(dialogue, slot, index);
    } catch (error) {
      console.warn(`[ejercicios] el motor "${slot.engineFallback}" falló:`, error);
    }
    if (!built) return;

    // Lo generado aquí pasa por el mismo control que lo generado por el modelo.
    const check = verifyExercise(built, index);
    if (!check.ok || !check.exercise) {
      console.warn(`[ejercicios] motor "${slot.engineFallback}" descartado: ${check.reason}`);
      return;
    }

    result.push({
      ...check.exercise,
      id: `${slot.slotId}_auto`,
      slotId: slot.slotId,
      stage: slot.stage,
      skill: slot.skill
    });
  });

  // Ejercicios válidos que el modelo añadió de más: se conservan al final.
  for (const leftover of pool) {
    result.push({ ...leftover, question: clampText(leftover.question, 300) });
  }

  return result.sort(compareByStage);
}
