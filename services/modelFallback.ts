/**
 * Cadena de modelos de texto, y qué errores justifican bajar un escalón.
 *
 * El caso que lo motivó: `gemini-3.6-flash` devolviendo
 * `503 UNAVAILABLE — "This model is currently experiencing high demand"`. La
 * escalera de reintentos que ya existía trataba eso como un fallo de red y
 * gastaba sus tres llamadas (dos de streaming más el fallback sin streaming)
 * **contra el mismo modelo saturado**, con 500 ms y 1000 ms de espera entre
 * medias. Un pico de demanda dura minutos: 1,5 s no lo salvan, y la app se
 * quedaba sin generar nada.
 *
 * Lo que un reintento no puede arreglar, otro modelo sí. De ahí la separación
 * que hace este módulo: hay errores que son del *modelo* (no está disponible,
 * no existe, se acabó su cupo) y errores que son del *momento* (la red se
 * cortó, el stream vino vacío). Solo los primeros cambian de modelo; los
 * segundos los sigue reintentando la escalera interna, igual que antes.
 *
 * No importa el SDK de Gemini a propósito: así se puede probar entero sin red
 * ni clave de API (`scripts/check-fallback.mjs`).
 */

/**
 * Los cuatro son GA y tienen nivel gratuito (comprobado en la página de precios
 * de la API en agosto de 2026). El orden no es por capacidad sino por
 * **disponibilidad esperada**: se baja de generación en generación porque un
 * pico de demanda golpea a los modelos recién publicados, que son justamente
 * los que más gente está estrenando. `gemini-2.5-flash` cierra la cadena por
 * veterano: es el que menos probable es que esté saturado y el más rodado
 * generando el JSON estructurado que pide la lección.
 */
export const GENERATION_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
] as const;

export type GenerationModel = (typeof GENERATION_MODELS)[number];

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Los códigos numéricos que trae un error de la API, mirando en los tres sitios
 * donde puede estar.
 *
 * No es celo de más: en el 503 real que provocó todo esto, `status` venía como
 * cadena vacía y el 503 estaba en `code` y otra vez dentro del texto del
 * mensaje anidado. Mirar solo `error.status` —que es lo que hace
 * `isQuotaError`— no habría visto nada.
 */
function codesOf(error: unknown): unknown[] {
  const e = error as { code?: unknown; status?: unknown; error?: { code?: unknown; status?: unknown } } | null;
  if (!e || typeof e !== 'object') return [];
  return [e.code, e.status, e.error?.code, e.error?.status];
}

const hasCode = (error: unknown, code: number): boolean =>
  codesOf(error).some(value => value === code || value === String(code));

/**
 * ¿Es el error de haberse quedado sin cuota?
 *
 * Importa distinguirlo porque es el único que **empeora** al repetir la misma
 * petición: cada intento vuelve a contar contra el mismo límite. El nivel
 * gratuito da 10 peticiones de voz al día, así que un 429 tratado como un fallo
 * de red se llevaba tres de golpe.
 *
 * Cambiar de modelo es otra cosa y sí está permitido (ver `shouldSwitchModel`):
 * los límites del nivel gratuito son **por modelo**, así que el siguiente de la
 * cadena llega con su propio cupo intacto.
 */
export function isQuotaError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429 || status === 'RESOURCE_EXHAUSTED') return true;
  const text = errorText(error).toLowerCase();
  return (
    text.includes('resource_exhausted') ||
    text.includes('429') ||
    text.includes('quota') ||
    text.includes('rate limit')
  );
}

/**
 * El modelo existe pero ahora mismo no atiende: saturación (503) o fallo
 * interno (500). Es transitorio para el servicio y permanente para esta
 * generación, porque el usuario está esperando delante de la pantalla.
 */
export function isModelUnavailableError(error: unknown): boolean {
  if (hasCode(error, 503) || hasCode(error, 500)) return true;
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 'UNAVAILABLE' || status === 'INTERNAL') return true;
  const text = errorText(error).toLowerCase();
  return (
    text.includes('503') ||
    text.includes('unavailable') ||
    text.includes('overloaded') ||
    text.includes('high demand') ||
    text.includes('try again later') ||
    /\binternal\b/.test(text)
  );
}

/**
 * El id del modelo no existe para esta versión de la API.
 *
 * Está aquí porque los ids de la cadena caducan: `gemini-2.0-flash` se apagó en
 * junio de 2026 y `gemini-3.1-flash-lite-preview` poco después. Sin esto, el
 * día que Google retire uno de los cuatro la app dejaría de generar en vez de
 * bajar al siguiente.
 */
export function isModelNotFoundError(error: unknown): boolean {
  if (hasCode(error, 404)) return true;
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 'NOT_FOUND') return true;
  const text = errorText(error).toLowerCase();
  return (
    text.includes('not_found') ||
    text.includes('is not found for api version') ||
    text.includes('not supported for') ||
    (text.includes('404') && text.includes('model'))
  );
}

/**
 * ¿Puede otro modelo responder a esto?
 *
 * Todo lo que no esté aquí —red caída, stream cortado a la mitad, respuesta
 * vacía— es cosa del momento y no del modelo, así que lo sigue reintentando la
 * escalera interna de `generateJsonWithProgress`. Si esos errores cambiaran de
 * modelo, un corte de red se comería la cadena entera de una vez y encima
 * degradaría la lección sin motivo.
 */
export function shouldSwitchModel(error: unknown): boolean {
  return isQuotaError(error) || isModelUnavailableError(error) || isModelNotFoundError(error);
}

/**
 * La cadena empezando por un modelo concreto.
 *
 * Sirve para no volver a llamar al que acaba de fallar: si la generación se
 * repite (el reintento por número de personajes lo hace) hay que arrancar por
 * el modelo que sí contestó, no re-pagar la escalera desde arriba.
 */
export function modelsFrom(
  preferred: string,
  models: readonly string[] = GENERATION_MODELS
): readonly string[] {
  const index = models.indexOf(preferred);
  return index <= 0 ? models : models.slice(index);
}

/**
 * Ejecuta `run` bajando por la cadena de modelos hasta que uno conteste.
 *
 * Devuelve también **con cuál** contestó, que es lo que permite anotarlo en el
 * registro de la pantalla de carga y arrancar por ahí la siguiente vez.
 */
export async function runWithModelFallback<T>(
  models: readonly string[],
  run: (model: string) => Promise<T>,
  hooks: { onSwitch?: (from: string, to: string, reason: string) => void } = {}
): Promise<{ value: T; model: string }> {
  if (models.length === 0) throw new Error('No hay ningún modelo de generación configurado.');

  let lastError: unknown = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return { value: await run(model), model };
    } catch (error) {
      lastError = error;
      const next = models[i + 1];
      // Sin siguiente modelo, o con un error que otro modelo tampoco
      // resolvería, esto se acabó: que lo cuente el llamador.
      if (!next || !shouldSwitchModel(error)) throw error;
      hooks.onSwitch?.(model, next, errorText(error));
    }
  }

  throw lastError;
}

/**
 * El mensaje que ve el usuario cuando se agota la cadena entera.
 *
 * Sin esto, lo que aparecía en pantalla era el JSON crudo del 503 anidado
 * dentro de otro JSON. Devuelve `null` cuando el fallo no es de disponibilidad
 * ni de cuota, para que el llamador deje pasar su mensaje de siempre.
 */
export function describeModelChainFailure(error: unknown, tried: number): string | null {
  const modelos = tried === 1 ? 'el modelo de texto' : `los ${tried} modelos de texto probados`;
  if (isQuotaError(error)) {
    return `se agotó la cuota en ${modelos}. El nivel gratuito se renueva cada día; ` +
      'vuelve a intentarlo más tarde.';
  }
  if (isModelUnavailableError(error)) {
    return `${tried === 1 ? 'el modelo de Gemini está saturado' : `los ${tried} modelos de Gemini probados están saturados`} ` +
      'ahora mismo. Suele durar unos minutos: vuelve a intentarlo.';
  }
  return null;
}
