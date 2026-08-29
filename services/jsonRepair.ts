/**
 * Reparación tolerante del JSON del modelo.
 *
 * El porqué: el plan de la lección se pedía con `responseMimeType:
 * "application/json"` y luego se hacía un `JSON.parse` pelado. Basta con que el
 * modelo emita **un** carácter mal —una comilla sin escapar dentro de una
 * réplica ("dijo 'hola'" pero con comillas dobles), un salto de línea crudo
 * dentro de una cadena, una coma de más, o la respuesta cortada a medias— para
 * que el parseo reviente y el aprendiz vea «Error GenAI: Expected ',' or '}'
 * after property value in JSON at position 11332». Un solo glitch tiraba la
 * lección entera.
 *
 * `responseMimeType` NO es una garantía dura de validez: no hay `responseSchema`
 * que lo constriña, y en respuestas largas el modelo se equivoca. Estos son
 * exactamente los dos errores que se veían en producción:
 *   - «Expected ',' or '}' after property value»  → comilla sin escapar / cadena
 *     que se cierra antes de tiempo.
 *   - «Expected ':' after property name»            → clave malformada o carácter
 *     de control dentro de una cadena.
 *
 * `parseLenientJson()` intenta primero el parseo estricto (coste cero en el
 * camino normal) y, solo si falla, aplica reparaciones conservadoras y vuelve a
 * intentarlo. Lo que no se pueda reparar se propaga como error para que la capa
 * de arriba reintente la generación.
 */

export interface LenientParseResult<T> {
  value: T;
  /** `true` si hubo que reparar; el camino normal devuelve `false`. */
  repaired: boolean;
}

/** Quita las vallas de código markdown (```json … ```) y espacios. */
export function stripCodeFences(input: string): string {
  let s = input.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  }
  return s;
}

/**
 * Recorta a la porción que va del primer `{`/`[` hasta su cierre equilibrado,
 * ignorando llaves y corchetes que estén dentro de cadenas. Devuelve la cadena
 * tal cual si no encuentra un delimitador de apertura. Si el cierre nunca llega
 * (respuesta cortada) devuelve desde la apertura hasta el final, que es lo que
 * `repairJson` sabe cerrar.
 */
export function extractOutermostJson(input: string): string {
  const startObj = input.indexOf("{");
  const startArr = input.indexOf("[");
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start === -1) return input;

  const open = input[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  // Sin cierre: probablemente cortada. Se devuelve el resto y `repairJson` cierra.
  return input.slice(start);
}

const CONTROL_ESCAPES: Record<string, string> = {
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t"
};

/**
 * Reconstruye la cadena carácter a carácter arreglando los fallos que de verdad
 * comete el modelo:
 *
 *  - **Carácter de control crudo dentro de una cadena** (salto de línea, tab…):
 *    se escapa. JSON prohíbe controles literales entre comillas.
 *  - **Comilla sin escapar dentro de una cadena**: si tras una `"` lo siguiente
 *    (saltando espacios) no es un `,`, `:`, `}`, `]` ni el fin, esa `"` no cerraba
 *    la cadena —era una comilla del texto— así que se re-escapa y se sigue dentro
 *    de la cadena. Este es el heurístico que salva el «Expected ',' or '}'».
 *  - **Comas colgantes** antes de `}` o `]`: se eliminan.
 *  - **Truncamiento**: al acabar la entrada se cierra la cadena abierta y se
 *    añaden los `}`/`]` que falten, en orden.
 */
export function repairJson(input: string): string {
  const out: string[] = [];
  const stack: string[] = []; // '{' o '['
  let inString = false;
  let escaped = false;

  const lastSignificant = (): string => {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k];
      if (c !== " " && c !== "\n" && c !== "\r" && c !== "\t") return c;
    }
    return "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        out.push(ch);
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out.push(ch);
        escaped = true;
        continue;
      }
      if (ch === '"') {
        // ¿Cierra de verdad? Lo siguiente significativo debe ser : } ] o fin —
        // o una coma que de verdad separa valores.
        let j = i + 1;
        while (j < input.length && /\s/.test(input[j])) j++;
        const next = input[j];
        if (j >= input.length || next === ":" || next === "}" || next === "]") {
          out.push('"');
          inString = false;
        } else if (next === ",") {
          // Una coma es ambigua: puede separar dos valores ("a","b") o estar
          // DENTRO del texto ("dijo "sí", claro"). El desempate: tras una coma
          // que separa valores, lo que sigue en JSON válido es una clave o un
          // valor (", { [ - dígito true/false/null) o el fin (respuesta cortada).
          // Si en cambio sigue una palabra, la comilla era del texto —este es el
          // «Expected ',' or '}'» que el minificado del modelo provocaba.
          let m = j + 1;
          while (m < input.length && /\s/.test(input[m])) m++;
          const after = input[m];
          const separatesValues =
            m >= input.length ||
            after === '"' || after === "{" || after === "[" || after === "-" ||
            (after >= "0" && after <= "9") ||
            after === "t" || after === "f" || after === "n";
          if (separatesValues) {
            out.push('"');
            inString = false;
          } else {
            out.push('\\"');
          }
        } else {
          // Comilla incrustada en el texto: se escapa y seguimos dentro.
          out.push('\\"');
        }
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out.push(CONTROL_ESCAPES[ch] ?? "\\u" + code.toString(16).padStart(4, "0"));
        continue;
      }
      out.push(ch);
      continue;
    }

    // Fuera de cadena.
    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      out.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      // Quita una coma colgante inmediatamente anterior.
      if (lastSignificant() === ",") {
        for (let k = out.length - 1; k >= 0; k--) {
          if (out[k] === ",") { out.splice(k, 1); break; }
          if (!/\s/.test(out[k])) break;
        }
      }
      if (stack.length) stack.pop();
      out.push(ch);
      continue;
    }
    out.push(ch);
  }

  // Truncamiento: cerrar lo que quede abierto.
  if (inString) out.push('"');
  // Una coma colgante al final tampoco es válida antes de los cierres.
  if (lastSignificant() === ",") {
    for (let k = out.length - 1; k >= 0; k--) {
      if (out[k] === ",") { out.splice(k, 1); break; }
      if (!/\s/.test(out[k])) break;
    }
  }
  while (stack.length) {
    out.push(stack.pop() === "{" ? "}" : "]");
  }

  return out.join("");
}

/**
 * Parseo tolerante: estricto primero (coste cero), reparación después. Lanza si
 * ni siquiera la versión reparada parsea, para que quien llama pueda reintentar
 * la generación en lugar de mostrar un JSON roto al aprendiz.
 */
export function parseLenientJson<T = unknown>(raw: string): LenientParseResult<T> {
  const cleaned = stripCodeFences(raw);

  try {
    return { value: JSON.parse(cleaned) as T, repaired: false };
  } catch {
    /* seguimos con la reparación */
  }

  const trimmed = extractOutermostJson(cleaned);
  if (trimmed !== cleaned) {
    try {
      return { value: JSON.parse(trimmed) as T, repaired: true };
    } catch {
      /* seguimos */
    }
  }

  const repaired = repairJson(trimmed);
  return { value: JSON.parse(repaired) as T, repaired: true };
}
