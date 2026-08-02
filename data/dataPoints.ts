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

export const DATA_POINTS: Record<DataPointKind, DataPointProfile> = {
  email: {
    instruction: "MANDATORY: Dictate an email address using 'arroba', 'punto', 'guion bajo'.",
    label: 'la dirección de correo que se dicta',
    fieldLabel: 'Correo'
  },
  spelling: {
    instruction:
      "MANDATORY: One speaker MUST SPELL a name/surname/username letter by letter (e.g., 'G-A-R-C-I-A'). It must be clear.",
    label: 'el nombre o apellido que se deletrea',
    fieldLabel: 'Apellido'
  },
  phone: {
    instruction: "MANDATORY: One speaker MUST dictate a phone number digit by digit (e.g., '6-5-4...').",
    label: 'el número de teléfono que se dicta',
    fieldLabel: 'Teléfono'
  },
  price: {
    instruction:
      "MANDATORY: Mention a specific price with decimals in the local currency of the chosen accent (e.g., '14 con 95'). Do NOT force euros.",
    label: 'el precio exacto que se dice, con sus decimales',
    fieldLabel: 'Precio'
  },
  address: {
    instruction: 'MANDATORY: Mention a specific street name and building number.',
    label: 'la calle y el número que se dicen',
    fieldLabel: 'Dirección'
  },
  code: {
    instruction: 'MANDATORY: Dictate a specific alphanumeric code/postal code digit by digit.',
    label: 'el código que se dicta carácter a carácter',
    fieldLabel: 'Código'
  },
  date: {
    instruction: 'MANDATORY: State a specific date (day, month, year) clearly.',
    label: 'la fecha exacta que se dice',
    fieldLabel: 'Fecha'
  },
  time: {
    instruction: "MANDATORY: Mention specific times (e.g., 'A las 5 y media').",
    label: 'la hora exacta que se acuerda',
    fieldLabel: 'Hora'
  },
  quantity: {
    instruction:
      'MANDATORY: One speaker MUST state a specific number/quantity clearly (e.g., a bus line, a size, a room number).',
    label: 'el número o la cantidad exacta que se dice',
    fieldLabel: 'Número'
  },
  generic: {
    instruction:
      'MANDATORY: One speaker MUST state a concrete literal datum (a number, time, price, code or spelled name) clearly, so the learner can extract it.',
    label: 'el dato concreto que se dice en el audio (cifra, hora, precio o nombre deletreado)',
    fieldLabel: 'Dato'
  }
};

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
