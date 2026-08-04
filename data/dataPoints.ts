/**
 * ============================================================================
 *  DATO OBLIGATORIO DE LA SITUACIÓN
 * ============================================================================
 *
 * En los niveles bajos el audio va a velocidad nativa y el alumno todavía no
 * decodifica cláusulas: decodifica DATOS. Por eso el prompt del diálogo obliga a
 * que se diga un dato concreto (un teléfono dictado cifra a cifra, un precio con
 * céntimos, una hora, un apellido deletreado…), elegido por el tema.
 *
 * Antes esa decisión vivía dentro de `generateLessonPlan()` como una cadena de
 * `if/else` y MORÍA ahí: el syllabus no se enteraba de qué dato se había pedido,
 * así que la ficha de datos —el ejercicio central del nivel— podía acabar sobre
 * cualquier otra cosa. El resultado práctico era que una lección de "pedir un
 * número de teléfono" preguntaba de todo MENOS el número.
 *
 * Aquí el dato es un valor de primera clase que viaja a los tres sitios que lo
 * necesitan:
 *
 *   1. el prompt del diálogo  (`instruction`),
 *   2. las consignas de los ejercicios (`label`, `fieldLabel`),
 *   3. los motores deterministas, vía `ExerciseSlot.focus`.
 */

export type DataPointKind =
  | 'email'
  | 'spelling'
  | 'phone'
  | 'price'
  | 'address'
  | 'code'
  | 'date'
  | 'time'
  | 'quantity'
  | 'generic';

export interface DataPointProfile {
  /** Línea que se inyecta en el prompt de generación del diálogo. */
  instruction: string;
  /** Cómo se nombra el dato dentro de las consignas de los ejercicios. */
  label: string;
  /** Etiqueta de la casilla en que se anota el dato. Una sola palabra. */
  fieldLabel: string;
}

// Aquí había un cuarto campo, `contrasts`: la lista de cifras y nombres de letra
// que se confunden al oído con este tipo de dato. Lo consumía `{{contrastes}}`
// en la consigna de `a0-pares`, y `a0-pares` dejó de ir sobre el dato — hacía
// que el tercer ejercicio de A0 preguntara "¿oíste seis o siete?" sobre las
// cifras del mismo teléfono que el alumno acababa de anotar entero.

/**
 * ---------------------------------------------------------------------------
 *  POR QUÉ CADA INSTRUCCIÓN DICE LA *FORMA* Y NO SÓLO EL *QUÉ*
 * ---------------------------------------------------------------------------
 *
 * El ejercicio central de A0 no lo escribe el modelo: lo COSECHA un parser de la
 * transcripción (`a0-dato` lleva `preferEngine`, así que el motor corre primero y
 * la versión del modelo sólo se usa si el motor no encuentra nada). Durante
 * mucho tiempo estas instrucciones describían el dato y no su escritura, y los
 * dos ejemplos que traían eran justo los que ningún cosechador sabe leer:
 *
 *   - `"A las 5 y media"` — `NUMBER_LEXICON` es de PALABRAS, así que `5` no abre
 *     tramo de numerales y `media` nunca recibe su nexo; `DIGIT_LITERAL` devuelve
 *     el tramo de una sola pieza `"5"`, que muere en el filtro de dos piezas.
 *   - `"14 con 95"` — dos literales de una pieza, y el hueco `" con "` tiene
 *     letras, así que tampoco se pueden reensamblar.
 *
 * En los dos casos el motor se quedaba sin material y la tarjeta desaparecía, en
 * la lección que más la necesita. De ahí las tres reglas que gobiernan todas las
 * instrucciones de abajo:
 *
 *   1. **Sin mezclar.** El dato entero en palabras o el dato entero en cifras,
 *      nunca medio y medio: el cosechador de numerales y el de cifras se lo
 *      reparten y ninguno lo ve completo.
 *   2. **Dos piezas como mínimo.** Un número suelto ("el 45", "a las cinco") no
 *      es un dictado y se descarta a propósito. Por eso la hora pide su fracción
 *      y el precio sus céntimos.
 *   3. **De corrido y en un solo turno.** Lo exige el verificador
 *      (`verifyDictation`), pero quien tiene que cumplirlo es el diálogo; la regla
 *      común vive en `DICTATION_DELIVERY` (`services/geminiService.ts`).
 *
 * Dos tipos cambiaron además de dato, no sólo de escritura, porque su dato
 * natural no es dictable: `address` pasó del portal —una cifra suelta— al código
 * postal, y `date` al formato día/mes/año dicho pieza a pieza.
 */
export const DATA_POINTS: Record<DataPointKind, DataPointProfile> = {
  email: {
    instruction:
      "MANDATORY: One speaker MUST dictate an email address out loud, in one uninterrupted run: " +
      "spell the user part letter by letter with Spanish letter names, then say 'arroba', then the " +
      "domain, then 'punto', then the extension (e.g., 'eme, a, erre, te, a, arroba, correo, punto, " +
      "com'). Use 'guion bajo' for an underscore. Never write it as 'marta@correo.com' only.",
    label: 'la dirección de correo que se dicta',
    fieldLabel: 'Correo'
  },
  spelling: {
    instruction:
      "MANDATORY: One speaker MUST SPELL a surname/username letter by letter, either with Spanish " +
      "letter names ('Ge, a, erre, ce, i, a') or in capitals joined by hyphens ('G-A-R-C-Í-A'). At " +
      "least four letters, and at least two of them unambiguous letter names (efe, ge, hache, jota, " +
      "ka, ele, eme, ene, pe, erre, uve, equis, zeta). CLOSE THE SPELLING WITH A FULL STOP OR A COMMA " +
      "before saying anything else — an ordinary word right after it ('… ce, i, a de Madrid') reads " +
      "as one more letter and breaks the datum.",
    label: 'el nombre o apellido que se deletrea',
    fieldLabel: 'Apellido'
  },
  phone: {
    instruction:
      "MANDATORY: One speaker MUST dictate a phone number of at least six digits, digit by digit and " +
      "in one go: either entirely in words ('seis, cinco, cuatro, treinta y dos, dieciocho') or " +
      "entirely in figures separated by spaces or hyphens ('654 32 18', '6-5-4-3-2-1-8'). Do NOT mix " +
      "words and figures inside the number, and do NOT say it as one big quantity " +
      "('seiscientos cincuenta y cuatro mil…').",
    label: 'el número de teléfono que se dicta',
    fieldLabel: 'Teléfono'
  },
  price: {
    instruction:
      "MANDATORY: Mention a specific price WITH CENTS in the local currency of the chosen accent. Say " +
      "the whole amount in words ('catorce con noventa', 'catorce con noventa y cinco') or the whole " +
      "amount in figures with two decimals ('14,90'). NEVER half in figures and half in words " +
      "('14 con 95' is forbidden). A round price with no cents does not count. Do NOT force euros.",
    label: 'el precio exacto que se dice, con sus decimales',
    fieldLabel: 'Precio'
  },
  address: {
    instruction:
      "MANDATORY: One speaker MUST give a street address AND dictate its postal code digit by digit, " +
      "in words and in one go ('calle Serrano; código postal: dos, ocho, cero, cero, cuatro'). The " +
      "postal code is the datum, so say it complete and do not write it only in figures.",
    label: 'el código postal que se dicta',
    fieldLabel: 'Código postal'
  },
  code: {
    instruction:
      "MANDATORY: One speaker MUST dictate a numeric code (booking, order, member number) digit by " +
      "digit, at least four digits, in words and in one go ('cuatro, siete, uno, dos, nueve'). Keep " +
      "it all digits: letters mixed into the run break the dictation.",
    label: 'el código que se dicta cifra a cifra',
    fieldLabel: 'Código'
  },
  date: {
    instruction:
      "MANDATORY: One speaker MUST dictate a date the way it is read off a form: day, month and " +
      "two-digit year, piece by piece and in words, in one go ('quince, cero tres, doce'). Do NOT say " +
      "it as 'el quince de marzo de dos mil doce' — the months and the 'de' break the run.",
    label: 'la fecha exacta que se dicta',
    fieldLabel: 'Fecha'
  },
  time: {
    instruction:
      "MANDATORY: Agree on an exact time. Say the hour IN WORDS together with its fraction " +
      "('a las cinco y media', 'a las nueve y cuarto', 'a las ocho menos cuarto') or as a full clock " +
      "reading ('8:15'). A bare hour ('a las cinco', 'a las cinco en punto') does not count, and " +
      "neither does mixing the two ('a las 5 y media').",
    label: 'la hora exacta que se acuerda',
    fieldLabel: 'Hora'
  },
  quantity: {
    instruction:
      "MANDATORY: One speaker MUST dictate a specific number of at least three digits (a room, a " +
      "locker, a bus line, an order size) digit by digit, in words and in one go " +
      "('la habitación cuatro, dos, siete'). A number said as a single quantity ('la cuarenta y " +
      "cinco') is not a dictation.",
    label: 'el número exacto que se dicta',
    fieldLabel: 'Número'
  },
  generic: {
    instruction:
      "MANDATORY: One speaker MUST dictate ONE concrete literal datum, complete and in one go, in one " +
      "of these forms and no other: a phone number digit by digit in words ('seis, cinco, cuatro, " +
      "treinta y dos, dieciocho'); a price with cents entirely in words ('catorce con noventa'); an " +
      "exact time with its fraction ('a las cinco y media'); or a surname spelled letter by letter " +
      "('Ge, a, erre, ce, i, a.'). Never a bare round number.",
    label: 'el dato concreto que se dicta en el audio (cifra, hora, precio o nombre deletreado)',
    fieldLabel: 'Dato'
  }
};

/**
 * Los tipos de dato que la cadena entera sabe tratar: cosecharlos de la
 * transcripción (`services/exerciseEngines.ts`), reconocerlos como EL dato de la
 * lección (`isFocusLiteral`) y corregir lo que escriba el alumno
 * (`canonicalDatum`). Hoy son los diez, y esa es justamente la propiedad que hay
 * que defender: durante varias versiones `address`, `date`, `quantity` y
 * `generic` estaban declarados, se pedían en el prompt y no los cosechaba nadie,
 * así que la lección los anunciaba con su etiqueta ("Dirección") y se quedaba sin
 * la tarjeta.
 *
 * `scripts/check-exercises.mjs` recorre esta lista y exige un caso por tipo, de
 * modo que un `DataPointKind` nuevo no puede entrar sin cosechador.
 */
export const DICTATABLE_KINDS: DataPointKind[] = [
  'email',
  'spelling',
  'phone',
  'price',
  'address',
  'code',
  'date',
  'time',
  'quantity',
  'generic'
];

/**
 * Deduce del tema qué dato conviene exigir. Las palabras clave son las mismas
 * que usaba la cadena de `if/else` original, en el mismo orden de prioridad: el
 * orden importa, porque "reservar una mesa a las 8" cae en `time` y no en
 * `quantity`.
 */
export function inferDataPoint(topic: string): DataPointKind {
  const t = (topic || '').toLowerCase();

  if (t.includes('correo') || t.includes('email') || t.includes('arroba')) return 'email';
  if (t.includes('deletre') || t.includes('apellido') || t.includes('letra por letra') || t.includes('usuario'))
    return 'spelling';
  if (
    t.includes('teléfono') ||
    t.includes('telefono') ||
    t.includes('whatsapp') ||
    t.includes('celular') ||
    t.includes('móvil') ||
    t.includes('movil')
  )
    return 'phone';
  if (t.includes('precio') || t.includes('cuenta') || t.includes('cuesta') || t.includes('pagar') || t.includes('total'))
    return 'price';
  if (t.includes('dirección') || t.includes('direccion') || t.includes('calle')) return 'address';
  if (
    t.includes('código') ||
    t.includes('codigo') ||
    t.includes('postal') ||
    t.includes('matrícula') ||
    t.includes('matricula') ||
    t.includes('documento')
  )
    return 'code';
  if (t.includes('fecha') || t.includes('nacimiento') || t.includes('día') || t.includes('dia ')) return 'date';
  if (t.includes('hora') || t.includes('cita') || t.includes('horario') || t.includes('reservar')) return 'time';
  if (
    t.includes('número') ||
    t.includes('numero') ||
    t.includes('dígito') ||
    t.includes('digito') ||
    t.includes('talla') ||
    t.includes('cantidad')
  )
    return 'quantity';

  return 'generic';
}

/** Perfil del dato, con el genérico como respaldo. */
export function dataPointProfile(kind?: DataPointKind): DataPointProfile {
  return DATA_POINTS[kind ?? 'generic'] ?? DATA_POINTS.generic;
}
