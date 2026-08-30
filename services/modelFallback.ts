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

/**
 * Cadena de modelos de **voz** (TTS), por disponibilidad esperada.
 *
 * Durante mucho tiempo el audio no tuvo cadena a propósito: un solo modelo
 * mantenía el coste fijo de dos peticiones y evitaba que los dos hablantes de
 * una misma lección se sintetizaran con modelos distintos (la tabla de tonos
 * `TTS_VOICES` está medida contra un modelo). Pero cuando el modelo primario se
 * cayó (`503`) no había ningún alternativo y la app se quedaba **sin poder
 * generar audio en absoluto** —el mismo agujero que la cadena de texto ya
 * había tapado—. La disponibilidad pesa más que la pureza de la medida: un
 * audio con las voces un pelo menos separadas es infinitamente mejor que
 * ningún audio.
 *
 * El escalón sigue siendo consistente **dentro** de una lección: el modelo se
 * resuelve una sola vez y las dos peticiones (una por hablante) usan el mismo,
 * así que nunca hay dos voces de un diálogo sintetizadas por modelos distintos.
 * Lo único que puede quedar algo desfasado tras un cambio es la tabla `pitchHz`
 * (medida contra el primario), y eso solo afecta al diagnóstico `checkTwoVoices`
 * y al margen de separación de voces, no a la corrección del audio.
 *
 * Comprobado contra la API (agosto de 2026) con una clave del nivel gratuito:
 *  - `gemini-3.1-flash-tts-preview` — primario, responde con audio.
 *  - `gemini-2.5-flash-preview-tts` — responde con audio; buen alternativo
 *    (es también el que usa por defecto `scripts/measure-tts-voices.mjs`).
 *  - `gemini-2.5-pro-preview-tts` — **fuera de la cadena a propósito**: en el
 *    nivel gratuito da `limit: 0` (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`
 *    para `gemini-2.5-pro-tts`), es decir cero peticiones; siempre devuelve 429.
 *    Como toda la app está pensada para el nivel gratuito, incluirlo solo
 *    añadiría una ida y vuelta perdida. Quien tenga facturación activada puede
 *    añadirlo aquí como último escalón: la ruta de audio ya lo trataría bien.
 */
export const AUDIO_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts'
] as const;

export type AudioModel = (typeof AUDIO_MODELS)[number];

/**
 * Cómo limitar el "pensamiento" previo al primer token, por familia de modelo.
 *
 * El síntoma que arregla: el guion de la lección se pedía **sin ninguna
 * configuración de pensamiento**, así que un modelo pensante como
 * `gemini-3.6-flash` razonaba con presupuesto dinámico y tardaba ~37 s en emitir
 * el primer token —de ahí que `STREAM_FIRST_CHUNK_MS` tuviera que ser de 90 s—.
 * Ese silencio inicial era toda la lentitud percibida.
 *
 * Se calcula por modelo porque el mismo `config` se reutiliza en toda la cadena y
 * las familias no toman el mismo control: los 3.x usan `thinkingLevel` y el 2.5
 * usa `thinkingBudget` numérico. `runWithModelFallback` ya llama a `run(model)`
 * con el modelo concreto en mano, así que el tope se resuelve ahí.
 *
 * Bajar el presupuesto aquí es seguro: la calidad de los ejercicios la sostienen
 * `verifyExercises()` y los motores deterministas, no la profundidad del
 * razonamiento; la cadena existe por disponibilidad, no por capacidad.
 */
export function thinkingConfigFor(model: string): Record<string, unknown> {
  // Los 3.x no permiten apagar el pensamiento del todo; `low` es el mínimo.
  if (model.startsWith('gemini-3')) return { thinkingLevel: 'low' };
  // 2.5-flash sí admite desactivarlo por completo.
  return { thinkingBudget: 0 };
}

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
 * Un fallo de red o de conexión: la petición ni siquiera llegó a completarse.
 *
 * En el navegador `fetch` lanza un `TypeError` con «Failed to fetch» cuando no
 * puede completar la petición —red caída, DNS, CORS, la petición bloqueada— y
 * era justo el error con el que la app se quedaba muerta: no es del modelo, así
 * que la cadena no cambiaba de escalón, y como tampoco lo arreglaba reintentar,
 * la generación no salía por ningún lado. En Node/undici el mismo caso llega
 * como «fetch failed», «socket hang up» o «terminated».
 *
 * No cambia de modelo por sí solo (ver `shouldSwitchModel`): lo reintenta antes
 * la escalera interna contra el mismo modelo. Solo cuando esa escalera se agota
 * el error se marca como conmutable para que la cadena pueda seguir bajando.
 */
export function isNetworkError(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return (
    text.includes('failed to fetch') ||
    text.includes('fetch failed') ||
    text.includes('load failed') ||
    text.includes('networkerror') ||
    text.includes('network error') ||
    text.includes('network request failed') ||
    text.includes('socket hang up') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('etimedout') ||
    text.includes('and network resources') ||
    text === 'terminated' ||
    text.includes('the network connection was lost')
  );
}

/**
 * La petición se canceló por tiempo: el modelo aceptó la conexión pero dejó de
 * enviar datos (el caso «se queda en recepción del guion y no progresa») o tardó
 * más de la cuenta en total. Lo produce el `AbortController` que ahora rodea a
 * cada llamada; llega como `AbortError` o como el mensaje que ponemos nosotros.
 */
export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const text = errorText(error).toLowerCase();
  return (
    text.includes('aborted') ||
    text.includes('abortada') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('tardó demasiado') ||
    text.includes('no envió datos') ||
    text.includes('superó el tiempo')
  );
}

/**
 * Errores del *modelo*: existe pero no atiende, no existe, o se acabó su cupo.
 * Son los que cambian de modelo **de inmediato**, sin gastar la escalera interna
 * contra un escalón que ya se sabe que no va a contestar.
 */
export function isModelError(error: unknown): boolean {
  return isQuotaError(error) || isModelUnavailableError(error) || isModelNotFoundError(error);
}

/**
 * Marca un error como conmutable para que `runWithModelFallback` baje de modelo
 * aunque no sea un error del modelo.
 *
 * Se usa cuando la escalera interna de `generateJsonWithProgress` ya se ha
 * agotado contra un modelo por un fallo de red o un timeout: en ese punto el
 * corte ya no es «transitorio de un intento» sino «este modelo/endpoint no está
 * respondiendo», y probar el siguiente es exactamente lo que salva la
 * generación. Un error de red **suelto** (sin pasar por la escalera) sigue sin
 * cambiar de modelo, que es lo que evita comerse la cadena por un corte único.
 */
const SWITCHABLE = Symbol.for('escuchalab.switchModel');
export function markSwitchable<E>(error: E): E {
  if (error && typeof error === 'object') {
    try {
      (error as Record<PropertyKey, unknown>)[SWITCHABLE] = true;
    } catch {
      /* algunos errores son inmutables; da igual, se relanza tal cual */
    }
  }
  return error;
}
const isMarkedSwitchable = (error: unknown): boolean =>
  !!(error && typeof error === 'object' && (error as Record<PropertyKey, unknown>)[SWITCHABLE] === true);

/**
 * ¿Puede otro modelo responder a esto?
 *
 * Cambian de modelo los errores del modelo (saturación, cuota, id retirado) y
 * los que la escalera interna ya ha marcado como conmutables tras agotarse
 * (`markSwitchable`) —red caída, timeout—. Un error de red **suelto**, que aún
 * no ha pasado por la escalera, no cambia de modelo: lo reintenta antes esa
 * escalera contra el mismo modelo, y solo si se agota se marca para seguir
 * bajando. Así un corte único no se come la cadena entera de golpe, pero un
 * «Failed to fetch» persistente ya no deja la app sin generar nada.
 */
export function shouldSwitchModel(error: unknown): boolean {
  return isModelError(error) || isMarkedSwitchable(error);
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
  if (isTimeoutError(error)) {
    return `Gemini dejó de responder a tiempo (se probaron ${modelos}). ` +
      'Puede ser la conexión o una sobrecarga puntual: vuelve a intentarlo.';
  }
  if (isNetworkError(error)) {
    return 'no se pudo conectar con Gemini. Revisa tu conexión a internet ' +
      '(o si algún bloqueador/extensión está cortando la petición) y vuelve a intentarlo.';
  }
  return null;
}
