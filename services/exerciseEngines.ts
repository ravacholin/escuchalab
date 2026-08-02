import { compareByStage, EngineId, ExerciseSlot } from '@/data/listeningSyllabus';
import { DATA_POINTS, DataPointKind } from '@/data/dataPoints';
import { DialogueLine, Exercise, ExerciseField, ExerciseOption } from '@/types';
import { verifyExercise } from './exerciseVerification';
import {
  ADDRESS_GLUE,
  AMBIGUOUS_LETTER_NAMES,
  CLEAR_LETTER_NAMES,
  COMPOUND_TENS,
  countNumerals,
  datumVariants,
  inferKindFromLiteral,
  isFocusLiteral,
  isLetterName,
  MINUTE_WORDS,
  NUMBER_GLUE,
  NUMBER_LEXICON,
  SPELLED_RUN,
  SPELLED_TEST,
  UNIT_WORDS
} from './answerMatching';
import {
  buildTranscriptIndex,
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
  ['banco', 'blanco'], ['carta', 'cuarta'], ['pierna', 'prensa'],
  // numerales: son el contraste que de verdad importa cuando se dicta un
  // teléfono, un precio o una hora, y es justo el que faltaba en este banco.
  ['dos', 'doce'], ['tres', 'trece'], ['seis', 'siete'], ['ocho', 'ochenta'],
  ['diez', 'dos'], ['once', 'doce'], ['trece', 'treinta'], ['catorce', 'cuarenta'],
  ['quince', 'cincuenta'], ['dieciséis', 'sesenta'], ['diecisiete', 'setenta'],
  ['dieciocho', 'ochenta'], ['diecinueve', 'noventa'], ['veinte', 'treinta'],
  ['sesenta', 'setenta'], ['cuatro', 'catorce'], ['cinco', 'quince'],
  ['nueve', 'noventa'], ['cien', 'cinco'], ['media', 'cuarto'],
  // nombres de letra: el contraste propio del deletreo y de los códigos.
  ['be', 'de'], ['ese', 'efe'], ['eme', 'ene'], ['ge', 'jota'], ['pe', 'te'],
  ['ce', 'de'], ['equis', 'ese']
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

// ---------------------------------------------------------------------------
// Datos dictados con palabras
// ---------------------------------------------------------------------------
// El prompt de los niveles bajos pide dictar el teléfono "dígito a dígito", así
// que el modelo casi siempre escribe "seis, cinco, cuatro…" y no "654". Mientras
// los motores solo miraron cifras arábigas, la ficha de datos —el ejercicio
// central del nivel— no encontraba nada y desaparecía en silencio: la lección
// acababa preguntando de todo menos el número.

// El léxico numérico (`NUMBER_WORDS`, `NUMBER_GLUE`, `MINUTE_WORDS`, las
// unidades y las decenas compuestas) vive en `answerMatching.ts`: lo comparten
// este motor, que cosecha el dato de la transcripción, y el corrector que juzga
// lo que escribe el alumno. Si las dos listas se separan, el motor puede
// reconocer un numeral que el corrector no sabe convertir a cifras.

/** Numeral confundible al oído, con su ortografía real para mostrarlo. */
const NUMBER_CONFUSIONS: Record<string, string[]> = {
  cero: ['cinco'], uno: ['ocho'], una: ['ocho'], dos: ['doce', 'diez'], tres: ['trece', 'seis'],
  cuatro: ['catorce', 'cuarenta'], cinco: ['quince', 'cincuenta'], seis: ['siete', 'dieciséis'],
  siete: ['seis', 'diecisiete'], ocho: ['dieciocho', 'ochenta'], nueve: ['diecinueve', 'noventa'],
  diez: ['dos', 'seis'], once: ['doce', 'dos'], doce: ['dos', 'trece'], trece: ['tres', 'treinta'],
  catorce: ['cuarenta', 'cuatro'], quince: ['cincuenta', 'cinco'], dieciseis: ['sesenta', 'seis'],
  diecisiete: ['setenta', 'siete'], dieciocho: ['ochenta', 'ocho'], diecinueve: ['noventa', 'nueve'],
  veinte: ['treinta', 'doce'], treinta: ['trece', 'veinte'], cuarenta: ['catorce', 'cincuenta'],
  cincuenta: ['quince', 'sesenta'], sesenta: ['setenta', 'dieciséis'],
  setenta: ['sesenta', 'diecisiete'], ochenta: ['dieciocho', 'noventa'],
  noventa: ['diecinueve', 'ochenta'], cien: ['cinco', 'mil'], ciento: ['cien', 'quinientos'],
  mil: ['cien', 'dos mil']
};

/** Letras que se confunden al oír deletrear. */
const LETTER_CONFUSIONS: Record<string, string> = {
  B: 'D', D: 'B', S: 'F', F: 'S', M: 'N', N: 'M', G: 'J', J: 'G', P: 'T', T: 'P', C: 'D', X: 'S'
};

// `IN_WORD_CONFUSIONS` / `inWordNearMisses` se fueron con `pieceDistractors`:
// cambiaban una letra dentro de una pieza del dato para ofrecerla como
// alternativa. El dictado ya no ofrece alternativas — el dato se escribe — y
// nadie más las usaba.

/**
 * Secuencias de numerales dichas de corrido: un teléfono dictado cifra a cifra,
 * un código, un precio con decimales. Se devuelve el tramo ORIGINAL, que es el
 * que verá el alumno.
 */
function spokenNumberRuns(dialogue: DialogueLine[]): { value: string; lineIndex: number }[] {
  const out: { value: string; lineIndex: number }[] = [];

  (dialogue || []).forEach((line, lineIndex) => {
    const tokens = splitTokens(line.text || '');
    let run: string[] = [];
    let numerals = 0;
    let glued = false;

    /** ¿Este token cierra el tramo, o todavía es parte del dato? */
    const isPiece = (word: string) => NUMBER_LEXICON.has(word) || MINUTE_WORDS.has(word);

    const flush = () => {
      // Se recorta la cola: un tramo no puede terminar en "y", "con" ni "menos".
      while (run.length > 0 && !isPiece(normalizeText(stripEdges(run[run.length - 1])))) {
        run.pop();
      }
      if (numerals >= 3 || (numerals >= 2 && glued)) {
        out.push({ value: run.join(' '), lineIndex });
      }
      run = [];
      numerals = 0;
      glued = false;
    };

    tokens.forEach((token, i) => {
      const word = normalizeText(stripEdges(token));
      // "media" y "cuarto" sólo cuentan detrás del nexo de una hora: fuera de
      // ahí son sustantivos corrientes ("media hora", "el cuarto de baño").
      const afterGlue = run.length > 0 && NUMBER_GLUE.has(normalizeText(stripEdges(run[run.length - 1])));

      if (NUMBER_LEXICON.has(word) || (MINUTE_WORDS.has(word) && afterGlue)) {
        run.push(stripEdges(token));
        numerals += 1;
        if (MINUTE_WORDS.has(word)) glued = true;
        return;
      }

      if (NUMBER_GLUE.has(word) && run.length > 0) {
        // "menos" sólo une si lo que viene detrás es una fracción de hora.
        const next = normalizeText(stripEdges(tokens[i + 1] || ''));
        if (word === 'menos' && !MINUTE_WORDS.has(next)) {
          flush();
          return;
        }
        run.push(stripEdges(token));
        if (word === 'con') glued = true;
        return;
      }

      flush();
    });
    flush();
  });

  return out;
}

/**
 * Numerales que pertenecen al dato dictado, no a la conversación de alrededor.
 * Se toman SÓLO de los tramos detectados como dictado: barrer el diálogo entero
 * buscando numerales devolvía "una" de "una mesa" o la "a" de "a las cinco", que
 * no son cifras que nadie tenga que discriminar.
 */
function collectFocusWords(dialogue: DialogueLine[]): WordRef[] {
  const out: WordRef[] = [];
  const seen = new Set<string>();

  for (const run of spokenNumberRuns(dialogue)) {
    for (const token of splitTokens(run.value)) {
      const original = stripEdges(token);
      const normalized = normalizeText(original);
      if (!NUMBER_LEXICON.has(normalized) && !MINUTE_WORDS.has(normalized)) continue;
      if (normalized.length < 3) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ original, normalized, lineIndex: run.lineIndex });
    }
  }

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
  // Con foco en el dato, los numerales dictados van PRIMERO. Sin esto el motor
  // recorría la transcripción en orden y gastaba los cuatro ítems en el saludo,
  // que es exactamente lo contrario de lo que el nivel entrena.
  const focused = slot.focus && slot.focus !== 'generic' ? collectFocusWords(dialogue) : [];
  // Sin foco, el numeral queda FUERA. En A0 el dato dictado ya se trabaja entero
  // en el ejercicio anterior, y volver a preguntar "¿oíste seis o siete?" sobre
  // las cifras de ese mismo teléfono gasta la tercera tarjeta del nivel en
  // repetir lo que el alumno acaba de anotar. El contraste fónico se hace sobre
  // las palabras corrientes del diálogo, que es lo que este formato entrena.
  const lexical = collectContentWords(dialogue).filter(
    word => focused.length > 0 || (!NUMBER_LEXICON.has(word.normalized) && !MINUTE_WORDS.has(word.normalized))
  );
  const words = [...focused, ...lexical];

  const compose = (bankOnly: boolean) => {
    const fields: ExerciseField[] = [];
    const answer: Record<string, string> = {};
    const used = new Set<string>();

    for (const word of words) {
      if (fields.length >= slot.items) break;
      if (used.has(word.normalized)) continue;

      // Se prefiere el banco de pares reales; los vecinos generados son el respaldo.
      const banked = (PAIR_INDEX.get(word.normalized) || []).find(
        candidate => !isHeard(index, candidate) && !used.has(normalizeText(candidate))
      );
      const distractor = banked || (bankOnly ? null : phoneticDistractor(word.original, index, used));
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

    return { fields, answer };
  };

  // Los vecinos generados salen de transformar la palabra oída, así que a veces
  // no son palabras del español ("número" → "númera"). Se intenta SIEMPRE con el
  // banco de pares reales primero y sólo se acepta el respaldo si no alcanza:
  // esto dependía de que el slot tuviera foco, y al quitárselo a `a0-pares` el
  // ejercicio habría pasado a admitir no-palabras justo en el nivel que menos
  // se lo puede permitir.
  let { fields, answer } = compose(true);
  if (fields.length < 3) ({ fields, answer } = compose(false));

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

// La primera alternativa agrupa los bloques de un teléfono escrito con cifras
// ("654 32 18"): sin ella se leían como tres datos sueltos y la ficha pedía
// "Número", "Número 2" y "Número 3" en vez de un único campo "Teléfono".
const DIGIT_LITERAL = /\b\d{2,4}(?:[ -]\d{1,4}){1,4}\b|\b\d{1,4}(?:[.,:]\d{1,2})?\b|\b\d{5,}\b/g;

function labelFor(literal: string, focus?: DataPointKind): string {
  // Si el syllabus dijo de qué dato va la lección, manda el syllabus: es la
  // etiqueta que el alumno vio anunciada en la consigna.
  if (focus && focus !== 'generic' && isFocusLiteral(literal, focus)) {
    return DATA_POINTS[focus].fieldLabel;
  }
  if (literal.includes(':')) return 'Hora';
  if (/[.,]\d{2}$/.test(literal)) return 'Precio';
  if (SPELLED_TEST.test(literal)) return 'Nombre';
  if (/[a-záéíóúñ]/i.test(literal)) return countNumerals(literal) >= 3 ? 'Número' : 'Dato';
  if (literal.replace(/\D/g, '').length >= 6) return 'Teléfono';
  return 'Número';
}

/**
 * Recambios admisibles según el hueco. Dentro de un compuesto sólo cabe la clase
 * que corresponde: "treinta y doce" o "veinte y dos" no existen en español, y un
 * distractor agramatical se descarta leyendo, sin escuchar nada — que es justo lo
 * que el syllabus prohíbe.
 */
function replacementsFor(key: string, prev: string, next: string): string[] {
  const inCompound = next === 'y' ? COMPOUND_TENS : prev === 'y' ? UNIT_WORDS : null;
  const confusable = NUMBER_CONFUSIONS[key] || [];

  if (!inCompound) return confusable;

  const allowed = new Set(inCompound);
  const preferred = confusable.filter(word => allowed.has(normalizeText(word)));
  // Si ningún confusable encaja en el hueco, sirve cualquier otro de la clase:
  // sigue siendo un cambio de un solo elemento y sigue exigiendo oír la cifra.
  return preferred.length > 0 ? preferred : inCompound.filter(word => word !== key);
}

/**
 * Alternativas de un dato dictado con palabras: se cambia UN numeral por otro
 * que suena parecido y se deja intacto el resto, que es exactamente el error que
 * comete quien anota un teléfono al vuelo.
 */
function spokenNearMisses(literal: string): string[] {
  const tokens = splitTokens(literal);
  const keys = tokens.map(token => normalizeText(stripEdges(token)));
  const positions = keys
    .map((key, i) => ({ i, key }))
    .filter(t => NUMBER_LEXICON.has(t.key));

  const out: string[] = [];
  // Se empieza por el medio: cambiar el primer numeral es demasiado evidente.
  const order = [...positions].sort(
    (a, b) => Math.abs(a.i - tokens.length / 2) - Math.abs(b.i - tokens.length / 2)
  );

  for (const position of order) {
    const replacements = replacementsFor(position.key, keys[position.i - 1] || '', keys[position.i + 1] || '');
    for (const replacement of replacements) {
      if (normalizeText(replacement) === position.key) continue;
      const variant = [...tokens];
      variant[position.i] = replacement;
      const candidate = variant.join(' ');
      if (candidate !== literal && !out.includes(candidate)) out.push(candidate);
      if (out.length >= 2) return out;
    }
  }

  return out;
}

/** Alternativas de un nombre deletreado: se cambia una letra por otra próxima. */
function spelledNearMisses(literal: string): string[] {
  const out: string[] = [];
  const chars = [...literal];
  const swappable = chars
    .map((c, i) => ({ i, c: c.toUpperCase() }))
    .filter(({ c }) => LETTER_CONFUSIONS[c]);

  for (const { i, c } of swappable) {
    const variant = [...chars];
    variant[i] = LETTER_CONFUSIONS[c];
    const candidate = variant.join('');
    if (candidate !== literal && !out.includes(candidate)) out.push(candidate);
    if (out.length >= 2) break;
  }

  return out;
}

/** Alternativas de un teléfono en cifras agrupadas ("654 32 18"). */
function groupedNearMisses(literal: string): string[] {
  const parts = literal.split(/([ -])/);
  const groups = parts.map((p, i) => ({ p, i })).filter(g => /^\d+$/.test(g.p));
  const out: string[] = [];

  const emit = (index: number, value: string) => {
    const variant = [...parts];
    variant[index] = value;
    const candidate = variant.join('');
    if (candidate !== literal && !out.includes(candidate)) out.push(candidate);
  };

  const last = groups[groups.length - 1];
  if (last) {
    const digits = last.p.split('');
    digits[digits.length - 1] = String((Number(digits[digits.length - 1]) + 1) % 10);
    emit(last.i, digits.join(''));
  }

  const first = groups[0];
  if (first && first.p.length >= 2) {
    const digits = first.p.split('');
    [digits[0], digits[1]] = [digits[1], digits[0]];
    emit(first.i, digits.join(''));
  }

  return out;
}

/** Alternativas casi idénticas: se cambia un solo elemento del dato. */
function nearMisses(literal: string): string[] {
  const out: string[] = [];
  const push = (candidate: string) => {
    if (candidate && candidate !== literal && !out.includes(candidate)) out.push(candidate);
  };

  if (/[a-záéíóúñ]/i.test(literal)) {
    // Dato dicho con palabras: numerales de corrido o un apellido deletreado.
    for (const candidate of SPELLED_TEST.test(literal) ? spelledNearMisses(literal) : spokenNearMisses(literal)) {
      push(candidate);
    }
    return out;
  }

  if (/[ -]/.test(literal)) {
    for (const candidate of groupedNearMisses(literal)) push(candidate);
    return out;
  }

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

  const add = (value: string, lineIndex: number) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    literals.push({ value, lineIndex });
  };

  (dialogue || []).forEach((line, lineIndex) => {
    for (const match of (line.text || '').match(DIGIT_LITERAL) || []) add(match, lineIndex);
    for (const match of (line.text || '').match(SPELLED_RUN) || []) add(match, lineIndex);
  });

  // Los datos dichos con palabras van al principio: son los que el prompt de
  // los niveles bajos exige dictar, y por tanto los que la consigna anunció.
  for (const run of spokenNumberRuns(dialogue).reverse()) {
    if (seen.has(run.value)) continue;
    seen.add(run.value);
    literals.unshift(run);
  }

  // Con foco declarado, el dato de la lección encabeza la ficha.
  if (slot.focus && slot.focus !== 'generic') {
    literals.sort((a, b) => {
      const fa = isFocusLiteral(a.value, slot.focus!) ? 0 : 1;
      const fb = isFocusLiteral(b.value, slot.focus!) ? 0 : 1;
      return fa - fb;
    });
  }

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
    const baseLabel = labelFor(literal.value, slot.focus);
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

// --- Dictado del dato ----------------------------------------------------
//
// La ficha (`data_capture`) pide RECONOCER el dato entero entre tres cadenas
// parecidas. Esto pide ANOTARLO: se oye y se escribe, que es la diferencia
// entre "¿cuál de estos tres teléfonos era?" y "anotá el teléfono".
//
// Lo que este motor tiene que encontrar es, por tanto, el dato ENTERO. Las
// piezas siguen importando aunque ya no sean controles: son lo que permite
// saber dónde empieza y dónde acaba el tramo, y qué nexos van dentro de él
// ("catorce **con** noventa" es un dato, no dos).

/** Un dato dictado, con sus piezas y los nexos que van entre ellas. */
interface DictationRun {
  pieces: string[];
  /** Pieza fija que va ANTES de `pieces[i]`; `separators[0]` siempre es ''. */
  separators: string[];
  lineIndex: number;
}

// `CLEAR_LETTER_NAMES`, `AMBIGUOUS_LETTER_NAMES`, `ADDRESS_GLUE` e
// `isLetterName` también viven en `answerMatching.ts`, por la misma razón: el
// corrector tiene que resolver "ge a erre ce i a" a "garcia" con exactamente el
// mismo criterio con el que este motor decidió que eso era un deletreo.

/**
 * Datos dichos con numerales. `spokenNumberRuns` ya localiza el tramo; aquí se
 * decide dónde están las junturas. Regla: "y" entre decena compuesta y unidad
 * PEGA ("treinta y dos" es una pieza, que es como se anota), y "con", "menos" o
 * el "y" de una hora SEPARAN, porque son dos cifras que se oyen por separado.
 */
function segmentSpokenRun(value: string, lineIndex: number): DictationRun | null {
  const tokens = splitTokens(value);
  const keys = tokens.map(t => normalizeText(stripEdges(t)));

  const pieces: string[] = [];
  const separators: string[] = [];
  let pendingGlue = '';

  for (let i = 0; i < tokens.length; i++) {
    const key = keys[i];
    if (NUMBER_GLUE.has(key)) {
      const prev = keys[i - 1] || '';
      const next = keys[i + 1] || '';
      const compound = key === 'y' && COMPOUND_TENS.includes(prev) && UNIT_WORDS.includes(next);
      if (compound && pieces.length > 0) {
        // "treinta y dos": la juntura queda dentro de la pieza.
        pieces[pieces.length - 1] += ` ${stripEdges(tokens[i])} ${stripEdges(tokens[i + 1])}`;
        i += 1;
      } else {
        pendingGlue = stripEdges(tokens[i]);
      }
      continue;
    }
    pieces.push(stripEdges(tokens[i]));
    separators.push(pieces.length === 1 ? '' : pendingGlue);
    pendingGlue = '';
  }

  return pieces.length >= 2 ? { pieces, separators, lineIndex } : null;
}

/** Datos escritos con cifras: "654 32 18", "14,95", "8:15". */
function segmentDigitLiteral(value: string, lineIndex: number): DictationRun | null {
  const parts = value.split(/([ \-,.:])/).filter(p => p !== '');
  const pieces: string[] = [];
  const separators: string[] = [];
  let pendingGlue = '';

  for (const part of parts) {
    if (/^[ \-,.:]$/.test(part)) {
      pendingGlue = part.trim();
      continue;
    }
    pieces.push(part);
    separators.push(pieces.length === 1 ? '' : pendingGlue);
    pendingGlue = '';
  }

  return pieces.length >= 2 ? { pieces, separators, lineIndex } : null;
}

/** Nombre deletreado, tal como lo escribe el modelo: "G-A-R-C-Í-A". */
function segmentSpelledLiteral(value: string, lineIndex: number): DictationRun | null {
  const pieces = value.split(/[-.·]/).filter(Boolean);
  if (pieces.length < 3) return null;
  return { pieces, separators: pieces.map(() => ''), lineIndex };
}

/**
 * Deletreos y correos dichos con palabras. El listón es alto a propósito: los
 * nombres de letra ("de", "te", "ese", "a") son también palabras corrientes, y
 * un detector laxo convertiría cualquier frase en un deletreo. Se exigen cuatro
 * piezas seguidas y, o bien dos nombres de letra inequívocos, o bien un
 * "arroba", que no aparece por casualidad.
 */
function spokenSpellingRuns(dialogue: DialogueLine[]): DictationRun[] {
  const out: DictationRun[] = [];

  (dialogue || []).forEach((line, lineIndex) => {
    const tokens = splitTokens(line.text || '');
    let pieces: string[] = [];
    let separators: string[] = [];
    let clear = 0;
    let hasAddressGlue = false;
    let pendingGlue: string[] = [];

    const flush = () => {
      // O es un deletreo (dos nombres de letra inequívocos) o es una dirección
      // (un "arroba" de verdad entre sus piezas). "en punto" cumple lo de las
      // piezas unidas por un nexo, y no es ni una cosa ni la otra.
      const isAddress = hasAddressGlue && separators.some(s => normalizeText(s).includes('arroba'));
      if (pieces.length >= 4 && (clear >= 2 || isAddress)) {
        out.push({ pieces: [...pieces], separators: [...separators], lineIndex });
      }
      pieces = [];
      separators = [];
      clear = 0;
      hasAddressGlue = false;
      pendingGlue = [];
    };

    tokens.forEach((token, i) => {
      const word = normalizeText(stripEdges(token));

      if (ADDRESS_GLUE.has(word)) {
        if (pieces.length > 0) {
          pendingGlue.push(stripEdges(token));
          hasAddressGlue = true;
        }
        return;
      }

      // Detrás de "arroba" o "punto" la pieza es una palabra entera ("gmail",
      // "com"); en un deletreo, un nombre de letra. Y una palabra corriente
      // ABRE la dirección si el nexo viene justo detrás: sin esta mirada
      // adelante, el "ana" de "ana arroba correo punto com" se perdía y la
      // dirección empezaba a contarse a partir del arroba.
      const nextIsGlue = ADDRESS_GLUE.has(normalizeText(stripEdges(tokens[i + 1] || '')));
      const acceptable =
        isLetterName(word) || ((pendingGlue.length > 0 || nextIsGlue) && word.length >= 2);
      if (!acceptable) {
        flush();
        return;
      }

      pieces.push(stripEdges(token));
      separators.push(pieces.length === 1 ? '' : pendingGlue.join(' '));
      if (CLEAR_LETTER_NAMES.has(word)) clear += 1;
      pendingGlue = [];
    });

    flush();
  });

  return out;
}

/** El dato entero, con sus piezas fijas y su ortografía real. */
function joinRun(run: DictationRun): string {
  return run.pieces.map((p, i) => [run.separators[i], p].filter(Boolean).join(' ')).join(' ');
}

const dictation: Engine = (dialogue, slot) => {
  const focus = slot.focus && slot.focus !== 'generic' ? slot.focus : undefined;
  const candidates: DictationRun[] = [];

  for (const run of spokenNumberRuns(dialogue)) {
    const segmented = segmentSpokenRun(run.value, run.lineIndex);
    if (segmented) candidates.push(segmented);
  }
  candidates.push(...spokenSpellingRuns(dialogue));
  (dialogue || []).forEach((line, lineIndex) => {
    for (const match of (line.text || '').match(SPELLED_RUN) || []) {
      const segmented = segmentSpelledLiteral(match, lineIndex);
      if (segmented) candidates.push(segmented);
    }
    for (const match of (line.text || '').match(DIGIT_LITERAL) || []) {
      const segmented = segmentDigitLiteral(match, lineIndex);
      if (segmented) candidates.push(segmented);
    }
  });

  if (candidates.length === 0) return null;

  // Los cosechadores se solapan a propósito: `DIGIT_LITERAL` pesca "654" dentro
  // del "654 32 18" que ya pescó su primera alternativa. Un fragmento del dato
  // NO es el dato —pedirle al alumno media cifra es peor que no preguntarle
  // nada—, así que todo candidato contenido en otro del mismo turno se descarta
  // antes de rankear.
  const seen = new Set<string>();
  const whole = candidates.filter(run => {
    const text = normalizeText(joinRun(run));
    if (!text || seen.has(text)) return false;
    const contained = candidates.some(other => {
      if (other === run || other.lineIndex !== run.lineIndex) return false;
      const outer = normalizeText(joinRun(other));
      return outer.length > text.length && outer.includes(text);
    });
    if (contained) return false;
    seen.add(text);
    return true;
  });

  // Con foco declarado manda el dato que la consigna anunció; si no lo hay, el
  // tramo más largo, que es el que más tiene que anotar el alumno.
  const ranked = [...whole].sort((a, b) => {
    if (focus) {
      const fa = isFocusLiteral(joinRun(a), focus) ? 0 : 1;
      const fb = isFocusLiteral(joinRun(b), focus) ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    return b.pieces.length - a.pieces.length;
  });

  const run = ranked[0];
  if (!run) return null;

  const expected = joinRun(run);
  const dataKind = focus ?? inferKindFromLiteral(expected);
  const label = focus ? DATA_POINTS[focus].fieldLabel : labelFor(expected);

  return {
    id: 'eng_dictation',
    type: 'dictation',
    question: `Escuchá y escribí ${label.toLowerCase()} completo, tal como se dice.`,
    expected,
    accepts: datumVariants(expected, dataKind),
    dataKind,
    correctAnswer: expected,
    sourceTurns: [run.lineIndex],
    explanation:
      'No hay nada que deducir ni entre qué elegir: hay que volver al audio y anotar el dato entero, que es lo que se hace cuando te dictan un teléfono o un precio al vuelo. Da igual si lo escribís con cifras o con palabras; lo que se corrige es lo que oíste.'
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
  dictation,
  minimal_pairs: minimalPairs,
  spot_the_difference: spotTheDifference,
  chunk_order: chunkOrder
};

// ---------------------------------------------------------------------------
// Composición final de la lección
// ---------------------------------------------------------------------------

/** Origen final de cada slot del blueprint, para poder informarlo en la UI. */
export interface SlotReport {
  slotId: string;
  source: 'model' | 'engine' | 'empty';
  reason?: string;
}

/**
 * Empareja los ejercicios verificados con los slots del blueprint y rellena con
 * motores los que quedaron vacíos. El resultado sale ordenado por etapa de
 * escucha, que es el recorrido que después muestra la interfaz.
 */
export function fillMissingSlots(
  verified: Exercise[],
  blueprint: ExerciseSlot[],
  dialogue: DialogueLine[],
  onSlot?: (report: SlotReport) => void
): Exercise[] {
  const index = buildTranscriptIndex(dialogue);
  const pool = [...verified];
  const result: Exercise[] = [];

  /** El motor del slot, ya verificado. `null` si no hay material. */
  const runEngine = (slot: ExerciseSlot): { exercise?: Exercise; reason?: string } => {
    const engine = slot.engineFallback ? ENGINES[slot.engineFallback] : undefined;
    if (!engine) return { reason: 'sin motor de respaldo' };

    let built: Exercise | null = null;
    try {
      built = engine(dialogue, slot, index);
    } catch (error) {
      console.warn(`[ejercicios] el motor "${slot.engineFallback}" falló:`, error);
      return { reason: error instanceof Error ? error.message : String(error) };
    }
    if (!built) {
      return { reason: `el motor "${slot.engineFallback}" no encontró material en el audio` };
    }

    // Lo generado aquí pasa por el mismo control que lo generado por el modelo.
    const check = verifyExercise(built, index);
    if (!check.ok || !check.exercise) {
      console.warn(`[ejercicios] motor "${slot.engineFallback}" descartado: ${check.reason}`);
      return { reason: `motor descartado: ${check.reason || 'sin motivo'}` };
    }
    return { exercise: check.exercise };
  };

  blueprint.forEach((slot, position) => {
    // EL FORMATO MANDA. Antes bastaba con que el ejercicio trajera el slotId
    // para ocupar el hueco, sin mirar su tipo: una opción múltiple vaga
    // etiquetada `slotId: "a0-ficha"` se quedaba con el slot del dato, se le
    // estampaba `skill: 'dato_literal'` y el motor determinista no llegaba a
    // correr nunca. Y como `verifyMultipleChoice` no comprobaba nada contra el
    // audio, esa opción múltiple era además infalsificable.
    const matches = (ex: Exercise) => ex.type === slot.format;
    let i = pool.findIndex(ex => ex.slotId === slot.slotId && matches(ex));
    if (i < 0) i = pool.findIndex(matches);

    // Donde el ejercicio se puede demostrar entero contra la transcripción, el
    // motor va primero: una reconstrucción derivada del audio siempre es más
    // fiel que una redactada.
    let engineAttempt: { exercise?: Exercise; reason?: string } | null = null;
    if (slot.preferEngine) {
      engineAttempt = runEngine(slot);
      const { exercise } = engineAttempt;
      if (exercise) {
        if (i >= 0) pool.splice(i, 1);
        onSlot?.({ slotId: slot.slotId, source: 'engine' });
        result.push({
          ...exercise,
          id: `${slot.slotId}_auto`,
          slotId: slot.slotId,
          stage: slot.stage,
          skill: slot.skill
        });
        return;
      }
    }

    if (i >= 0) {
      const [ex] = pool.splice(i, 1);
      result.push({
        ...ex,
        id: ex.id || `${slot.slotId}_${position}`,
        slotId: slot.slotId,
        stage: slot.stage,
        skill: slot.skill,
        // El modelo no sabe de `DataPointKind`, pero el slot sí: es lo que
        // decide si "14,90" y "catorce con noventa" son el mismo precio.
        ...(slot.format === 'dictation' ? { dataKind: ex.dataKind ?? slot.focus } : {})
      });
      onSlot?.({ slotId: slot.slotId, source: 'model' });
      return;
    }

    const { exercise, reason } = engineAttempt || runEngine(slot);
    if (!exercise) {
      const why = reason || `el motor "${slot.engineFallback}" no encontró material en el audio`;
      if (!slot.engineFallback) console.warn(`[ejercicios] slot "${slot.slotId}" sin cubrir y sin motor de respaldo`);
      onSlot?.({ slotId: slot.slotId, source: 'empty', reason: why });
      return;
    }

    onSlot?.({ slotId: slot.slotId, source: 'engine' });
    result.push({
      ...exercise,
      id: `${slot.slotId}_auto`,
      slotId: slot.slotId,
      stage: slot.stage,
      skill: slot.skill
    });
  });

  // EL BLUEPRINT ES LA LECCIÓN. Lo que el modelo devolvió de más se descarta:
  // antes se anexaba al final, así que una lección de tres ejercicios podía
  // salir con cinco, y los dos de propina eran justo los que nadie había
  // planificado ni situado en ninguna etapa de escucha.
  if (pool.length > 0) {
    console.warn(`[ejercicios] ${pool.length} ejercicio(s) fuera del blueprint descartados`);
    onSlot?.({
      slotId: '(sobrantes)',
      source: 'empty',
      reason: `${pool.length} ejercicio(s) del modelo fuera del blueprint`
    });
  }

  return result.sort(compareByStage);
}
