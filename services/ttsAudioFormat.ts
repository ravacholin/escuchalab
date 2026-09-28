/**
 * Normaliza lo que devuelve el TTS a PCM crudo 24 kHz / 16 bits / mono.
 *
 * Toda la ruta de audio (`splitIntoTurns`, `concatPcmChunks`, `checkTwoVoices`,
 * el WAV de descarga y el caché) trabaja sobre PCM **sin cabecera**, que es lo
 * que devolvían `gemini-3.1-flash-tts-preview` y `gemini-2.5-flash-preview-tts`.
 * Los modelos 3.8 (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`) cambiaron
 * el valor por defecto: una petición unaria devuelve **WAV con cabecera RIFF**
 * (mismo 24 kHz / 16 bits / mono por dentro). Sin quitarla, los 44+ bytes de la
 * cabecera se leerían como muestras —un chasquido al principio de cada bloque— y
 * desalinearían el corte de turnos y la concatenación.
 *
 * No se pide `AUDIO_L16` en la configuración a propósito: el mismo `config` viaja
 * por toda la cadena `AUDIO_MODELS`, y un campo que los modelos anteriores no
 * conocen podría devolver un 400 en el escalón de respaldo. Detectar la cabecera
 * en la respuesta funciona con todos.
 */

export const TTS_PCM_SAMPLE_RATE = 24000;

function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function isRiffWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && readTag(bytes, 0) === 'RIFF' && readTag(bytes, 8) === 'WAVE';
}

/**
 * Devuelve el PCM crudo de una parte de audio del TTS. Si ya es PCM crudo, lo
 * devuelve tal cual. Si es WAV, recorre los chunks hasta `data` y comprueba en
 * `fmt ` que sea PCM 16 bits mono a 24 kHz; cualquier otro formato se rechaza
 * con un error, porque interpretarlo como 24 kHz mono daría un audio a otra
 * velocidad sin que nada lo avisara.
 */
export function toRawPcm(bytes: Uint8Array, mimeType?: string): Uint8Array {
  if (!isRiffWav(bytes)) {
    const rate = /rate=(\d+)/i.exec(mimeType ?? '');
    if (rate && Number(rate[1]) !== TTS_PCM_SAMPLE_RATE) {
      throw new Error(`El TTS devolvió PCM a ${rate[1]} Hz; se esperaba ${TTS_PCM_SAMPLE_RATE} Hz.`);
    }
    return bytes;
  }

  let offset = 12;
  let fmtChecked = false;
  while (offset + 8 <= bytes.length) {
    const id = readTag(bytes, offset);
    const size = readU32(bytes, offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = readU16(bytes, body);
      const channels = readU16(bytes, body + 2);
      const sampleRate = readU32(bytes, body + 4);
      const bits = readU16(bytes, body + 14);
      if (format !== 1 || channels !== 1 || bits !== 16 || sampleRate !== TTS_PCM_SAMPLE_RATE) {
        throw new Error(
          `El TTS devolvió un WAV no soportado (formato ${format}, ${channels} canal/es, ` +
            `${bits} bits, ${sampleRate} Hz); se esperaba PCM 16 bits mono a ${TTS_PCM_SAMPLE_RATE} Hz.`
        );
      }
      fmtChecked = true;
    } else if (id === 'data') {
      if (!fmtChecked) throw new Error('El WAV del TTS no declara su formato antes de los datos.');
      // Un WAV emitido en streaming puede declarar un tamaño 0 o 0xFFFFFFFF: se
      // toma entonces hasta el final. En cualquier caso, alineado a 16 bits.
      const declared = size === 0 || size === 0xffffffff ? bytes.length - body : size;
      const end = Math.min(bytes.length, body + declared);
      return bytes.subarray(body, body + ((end - body) & ~1));
    }
    // Los chunks RIFF se rellenan a tamaño par.
    offset = body + size + (size & 1);
  }
  throw new Error('El WAV del TTS no contiene un bloque de datos de audio.');
}
