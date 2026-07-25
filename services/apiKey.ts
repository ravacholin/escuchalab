/** Clave de Gemini guardada en el navegador. */
export const API_KEY_STORAGE = 'gemini_api_key';

/**
 * Prefijos que emite Google AI Studio. Las claves clásicas empiezan por
 * `AIza`; las nuevas, por `AQ.`. Validar solo el primero dejaba fuera claves
 * perfectamente válidas.
 */
const API_KEY_PREFIXES = ['AIza', 'AQ.'];

export const looksLikeApiKey = (key: string | null | undefined): boolean =>
  !!key && API_KEY_PREFIXES.some(prefix => key.trim().startsWith(prefix));
