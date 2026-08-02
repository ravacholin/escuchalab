import { DataPointKind } from '@/data/dataPoints';
import { normalizeText, splitTokens } from './textUtils';

/**
 * ============================================================================
 *  CORRECCIÓN DE UN DATO ESCRITO POR EL ALUMNO
 * ============================================================================
 *
 * El dictado de A0 / A1-A2 dejó de resolverse eligiendo entre desplegables: el
 * alumno oye el dato y lo ESCRIBE. Eso obliga a decidir qué cuenta como
 * acertar, y la respuesta del nivel es una sola: se corrige lo que se OYÓ, no
 * cómo se escribe.
 *
 * Un teléfono dictado "seis cinco cuatro treinta y dos dieciocho" está bien
 * anotado como `654 32 18`, como `6543218` o con las palabras enteras. Un precio
 * dicho "catorce con noventa" está bien como `14,90`, `14.90` o `14 con 90`. Una
 * hora dicha "las cinco y media" está bien como `5:30` y como `17:30`, porque el
 * audio no dice cuál de las dos es. Quien oyó bien y anotó bien acierta, y da
 * igual la forma; quien se comió una cifra falla, que es justo lo que el
 * ejercicio mide.
 *
 * La normalización de aquí sirve para COMPARAR, nunca para MOSTRAR (la misma
 * regla que gobierna `textUtils.ts`). Lo que se le enseña al alumno al corregir
 * es siempre el dato con su ortografía real.
 */

// ---------------------------------------------------------------------------
// Léxico numérico
// ---------------------------------------------------------------------------
// Vive aquí, y no en `exerciseEngines.ts`, porque lo comparten el motor que
// cosecha el dato de la transcripción y el corrector que juzga lo que escribió
// el alumno. Si las dos listas se separan, el motor puede reconocer un numeral
// que el corrector no sabe convertir, y el ejercicio pasa a ser incorregible.

/** Numerales que pueden aparecer en un dato dictado, en forma normalizada. */
export const NUMBER_WORDS = [
  'cero', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho',
  'diecinueve', 'veinte', 'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco',
  'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta', 'cuarenta', 'cincuenta',
  'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento', 'doscientos', 'trescientos',
  'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos', 'mil'
];
export const NUMBER_LEXICON = new Set(NUMBER_WORDS);

/** Piezas que unen numerales dentro de un mismo dato ("catorce con noventa"). */
export const NUMBER_GLUE = new Set(['y', 'con', 'menos']);

/**
 * Fracciones de hora. No son numerales, pero son el segundo elemento de la
 * mayoría de las horas que el prompt pide dictar ("a las cinco y media").
 */
export const MINUTE_WORDS = new Set(['media', 'cuarto']);

/** Unidades y decenas que forman compuestos con "y" ("treinta y dos"). */
export const UNIT_WORDS = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
export const COMPOUND_TENS = ['treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

/** Valor de cada numeral, para poder pasar de palabras a cifras. */
const NUMBER_VALUES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
  trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700,
  ochocientos: 800, novecientos: 900, mil: 1000
};

// ---------------------------------------------------------------------------
// Léxico del deletreo
// ---------------------------------------------------------------------------

/** Nombres de letra que no son también palabras corrientes del español. */
export const CLEAR_LETTER_NAMES = new Set([
  'efe', 'ge', 'hache', 'jota', 'ka', 'ele', 'eme', 'ene', 'pe', 'erre',
  'uve', 'equis', 'zeta', 'ceta', 'griega', 'doble'
]);

/** Nombres de letra que además son palabras corrientes ("de", "te", "ese"). */
export const AMBIGUOUS_LETTER_NAMES = new Set([
  'a', 'be', 'ce', 'de', 'e', 'i', 'o', 'u', 'ese', 'te', 've', 'cu'
]);

/** Piezas fijas de un correo dictado: no se eligen, se muestran. */
export const ADDRESS_GLUE = new Set(['arroba', 'punto', 'guion', 'bajo', 'raya']);

export function isLetterName(word: string): boolean {
  return CLEAR_LETTER_NAMES.has(word) || AMBIGUOUS_LETTER_NAMES.has(word);
}

/** Un apellido deletreado suele llegar como "G-A-R-C-Í-A". */
const SPELLED_SOURCE = '\\b[A-ZÁÉÍÓÚÑ](?:[-.·][A-ZÁÉÍÓÚÑ]){2,}\\b';
/** Global para escanear (consume `lastIndex`); la otra, sin estado, para juzgar. */
export const SPELLED_RUN = new RegExp(SPELLED_SOURCE, 'g');
export const SPELLED_TEST = new RegExp(SPELLED_SOURCE);

export function countNumerals(literal: string): number {
  return splitTokens(literal).filter(t => NUMBER_LEXICON.has(normalizeText(t))).length;
}

/**
 * ¿Este literal es plausiblemente EL dato que la lección anunció?
 *
 * Para un teléfono se cuentan las cifras DEL DATO, no las que estén escritas con
 * cifras: `digitsOnly()` pasa antes los numerales a números, así que "seis cinco
 * cuatro treinta y dos dieciocho" y "654 32 18" valen los mismos siete dígitos y
 * "654, treinta y dos" —media cifra— no llega, aunque tenga tres dígitos
 * escritos y dos numerales. Contarlos por separado era lo que dejaba pasar un
 * trozo del teléfono como si fuera el teléfono.
 */
export function isFocusLiteral(literal: string, focus: DataPointKind): boolean {
  const digits = digitsOnly(literal).length;
  const numerals = countNumerals(literal);
  const spelled = SPELLED_TEST.test(literal);

  switch (focus) {
    case 'phone':
      return digits >= 6 || spelled;
    case 'code':
      return digits >= 4 || numerals >= 4 || spelled;
    case 'price':
      return /[.,]\d{2}$/.test(literal) || /\bcon\b/i.test(literal);
    case 'time':
      // "8:15", pero también "a las cinco y media", que es como el prompt pide
      // decir la hora y que antes no contaba como el dato de la lección.
      return literal.includes(':') || splitTokens(literal).some(t => MINUTE_WORDS.has(normalizeText(t)));
    case 'spelling':
    case 'email':
      // Deletreado con guiones ("G-A-R-C-Í-A") o dicho por nombres de letra.
      return (
        spelled ||
        /\barroba\b/i.test(literal) ||
        splitTokens(literal).filter(t => CLEAR_LETTER_NAMES.has(normalizeText(t))).length >= 2
      );
    default:
      return digits > 0 || numerals >= 3;
  }
}

/**
 * De qué clase es un dato cuando nadie lo declaró. Hace falta en dos sitios: el
 * motor, cuando el slot no trae foco, y el verificador, que recibe el ejercicio
 * del modelo sin saber de qué lección viene. El orden importa — una hora tiene
 * dos puntos y un precio un "con", y los dos tienen cifras —, así que se prueba
 * de lo más específico a lo más general.
 */
export function inferKindFromLiteral(literal: string): DataPointKind {
  for (const kind of ['time', 'price', 'email', 'phone'] as DataPointKind[]) {
    if (isFocusLiteral(literal, kind)) return kind;
  }
  return 'generic';
}

/** Nombre de letra → la letra que representa (ya sin tildes). */
const LETTER_OF_NAME: Record<string, string> = {
  a: 'a', be: 'b', ce: 'c', de: 'd', e: 'e', efe: 'f', ge: 'g', hache: 'h', i: 'i',
  jota: 'j', ka: 'k', ele: 'l', eme: 'm', ene: 'n', enie: 'n', o: 'o', pe: 'p', cu: 'q',
  erre: 'r', ere: 'r', ese: 's', te: 't', u: 'u', uve: 'v', ve: 'v', equis: 'x',
  ye: 'y', zeta: 'z', ceta: 'z'
};

/** Piezas que se dicen con dos palabras y valen por un solo símbolo. */
const MULTIWORD_PIECES: [string[], string][] = [
  [['guion', 'bajo'], '_'],
  [['doble', 'uve'], 'w'],
  [['doble', 've'], 'w'],
  [['i', 'griega'], 'y']
];

/** Palabras de moneda que sobran al comparar un precio. */
const CURRENCY_WORDS = new Set([
  'euro', 'euros', 'peso', 'pesos', 'dolar', 'dolares', 'sol', 'soles', 'bolivar', 'bolivares',
  'quetzal', 'quetzales', 'centimo', 'centimos', 'centavo', 'centavos'
]);

/** Nexos que no aportan nada al dato en sí. */
const FILLER_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'en', 'es', 'son']);

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/**
 * Minúsculas y sin tildes, pero CONSERVANDO los símbolos que forman parte de un
 * dato: `@ . , : - _`. `normalizeText()` los borra todos, que es correcto para
 * comparar frases y ruinoso para comparar un correo o una hora.
 */
function soften(text: string): string {
  return (
    (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}@._,:\-\s]/gu, ' ')
      // Un punto o una coma que no lleva cifra detrás separa dos piezas, no las
      // une: en "654, treinta y dos" la coma se quedaba pegada al 654 y el token
      // "654," no era ningún número conocido, así que el teléfono se corregía
      // como si le faltaran tres cifras. El decimal ("14,90") lleva cifra detrás
      // y no se toca.
      .replace(/[.,](?!\d)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Pasa a cifras los numerales dichos con palabras, dejando el resto intacto.
 * "seis cinco cuatro treinta y dos" → "6 5 4 32". El "y" de una decena compuesta
 * pega ("treinta y dos" es 32); cualquier otro "y" se conserva, porque en una
 * hora separa dos cifras que se oyen por separado.
 */
export function spanishToDigits(text: string): string {
  const tokens = soften(text).split(' ').filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const value = NUMBER_VALUES[token];

    if (value === undefined) {
      out.push(token);
      continue;
    }

    if (COMPOUND_TENS.includes(token) && tokens[i + 1] === 'y' && UNIT_WORDS.includes(tokens[i + 2])) {
      out.push(String(value + NUMBER_VALUES[tokens[i + 2]]));
      i += 2;
      continue;
    }

    out.push(String(value));
  }

  return out.join(' ');
}

/** Solo las cifras del dato: es lo que define un teléfono o una cantidad. */
function digitsOnly(text: string): string {
  return spanishToDigits(text).replace(/\D/g, '');
}

/** Cifras y letras, sin separadores: un código, una dirección con portal. */
function alphanumeric(text: string): string {
  return spanishToDigits(text)
    .split(' ')
    .filter(token => token && !FILLER_WORDS.has(token))
    .join('')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Precio con dos decimales: "catorce con noventa", "14,90" y "14.9" coinciden. */
function canonicalPrice(text: string): string {
  const spelled = spanishToDigits(text)
    .split(' ')
    .filter(token => !CURRENCY_WORDS.has(token))
    .join(' ')
    // "con", la coma y el punto son el mismo separador decimal dicho de tres formas.
    .replace(/[,.]/g, ' ');

  const numbers = spelled.match(/\d+/g) || [];
  if (numbers.length === 0) return '';

  const whole = String(Number(numbers[0]));
  const cents = (numbers[1] ?? '0').padEnd(2, '0').slice(0, 2);
  return `${whole}.${cents}`;
}

/**
 * Hora en formato `h:mm` con la hora módulo 12: el audio dice "las cinco y
 * media" y no dice si son las 5 o las 17, así que las dos anotaciones valen.
 */
function canonicalTime(text: string): string {
  const value = spanishToDigits(text);
  const fraction = (piece: string) => (piece === 'cuarto' ? 15 : piece === 'media' ? 30 : Number(piece));

  const clock = value.match(/(\d{1,2})\s*[:.]\s*(\d{1,2})/);
  if (clock) return format(Number(clock[1]), Number(clock[2]));

  const before = value.match(/(\d{1,2})\s+menos\s+(cuarto|media|\d{1,2})/);
  if (before) {
    const offset = fraction(before[2]);
    return format(Number(before[1]) - 1, 60 - offset);
  }

  const after = value.match(/(\d{1,2})\s+(?:y\s+)?(cuarto|media|\d{1,2})\b/);
  if (after) return format(Number(after[1]), fraction(after[2]));

  const bare = value.match(/(\d{1,2})/);
  if (bare) return format(Number(bare[1]), 0);

  return '';

  function format(hour: number, minute: number): string {
    const carry = Math.floor(minute / 60);
    const mm = ((minute % 60) + 60) % 60;
    const hh = (((hour + carry) % 12) + 12) % 12;
    return `${hh}:${String(mm).padStart(2, '0')}`;
  }
}

/**
 * Deletreos y correos. Los nombres de letra se resuelven a su letra, "arroba" y
 * "guion bajo" a su símbolo, y se quitan los separadores que no cambian el dato
 * (el punto y el guion), para que "G-A-R-C-Í-A", "garcía" y "ge a erre ce i a"
 * sean la misma cosa.
 */
function canonicalSpelling(text: string): string {
  const tokens = soften(text).split(' ').filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const pair = MULTIWORD_PIECES.find(([words]) => words[0] === tokens[i] && words[1] === tokens[i + 1]);
    if (pair) {
      out.push(pair[1]);
      i += 1;
      continue;
    }

    const token = tokens[i];
    if (token === 'arroba') out.push('@');
    else if (token === 'punto') out.push('.');
    else if (token === 'guion' || token === 'raya') out.push('-');
    else if (LETTER_OF_NAME[token]) out.push(LETTER_OF_NAME[token]);
    else out.push(token);
  }

  return out.join('').replace(/[\s.\-]/g, '');
}

/** Lo demás: cifras donde las haya y palabras donde no, sin nexos ni signos. */
function canonicalGeneric(text: string): string {
  return alphanumeric(text);
}

/**
 * Forma con la que se compara un dato. Depende del tipo, porque lo que puede
 * variar sin dejar de ser el mismo dato no es lo mismo en un teléfono que en una
 * hora.
 */
export function canonicalDatum(text: string, kind?: DataPointKind): string {
  if (!text || !text.trim()) return '';

  switch (kind) {
    case 'phone':
    case 'quantity':
      return digitsOnly(text);
    case 'code':
    case 'address':
      return alphanumeric(text);
    case 'price':
      return canonicalPrice(text);
    case 'time':
      return canonicalTime(text);
    case 'spelling':
    case 'email':
      return canonicalSpelling(text);
    default:
      return canonicalGeneric(text);
  }
}

/**
 * ¿Lo que escribió el alumno es el dato que suena? Se canonizan los dos lados,
 * así que la equivalencia entre cifras y palabras sale gratis y `variants` sólo
 * hace falta cuando el dato admite dos lecturas distintas de verdad.
 */
export function matchesDatum(input: string, variants: string[], kind?: DataPointKind): boolean {
  const got = canonicalDatum(input, kind);
  if (!got) return false;
  return variants.some(variant => {
    const want = canonicalDatum(variant, kind);
    return !!want && want === got;
  });
}

/**
 * Las otras escrituras del mismo dato que conviene declarar en `accepts`. Sólo
 * se añade la forma en cifras cuando el dato se dictó con palabras: el resto de
 * la tolerancia ya la da `canonicalDatum()`.
 */
export function datumVariants(expected: string, kind?: DataPointKind): string[] {
  const digits = spanishToDigits(expected);
  return soften(digits) === soften(expected) ? [] : [digits];
}
