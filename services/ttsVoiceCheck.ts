/**
 * ¿El audio que devolvió el TTS trae de verdad las dos voces que se pidieron?
 *
 * El `multiSpeakerVoiceConfig` de Gemini no es un enrutador: el modelo *decide*
 * de quién es cada turno leyendo las etiquetas del texto, y a veces decide mal
 * y lee el diálogo entero con una sola voz. La documentación lo admite como
 * limitación conocida del modelo («voice inconsistency with prompts»). Medido
 * contra la API con el formato que usaba la app, el hablante grave desaparecía
 * en 2 de cada 3 generaciones: seis turnos, dos nombres distintos, una sola voz.
 *
 * Para un laboratorio de comprensión auditiva eso no es un defecto cosmético —
 * la mitad de los ejercicios pide separar turnos, y con una sola voz no hay nada
 * que separar. Así que no se confía en el modelo: se **mide** lo que devolvió.
 *
 * El módulo es aritmética pura sobre el PCM (24 kHz, 16 bits, mono), sin Web
 * Audio ni dependencias, para poder correrlo igual en el navegador y en los
 * checks offline.
 */

/** Formato del PCM que devuelve el TTS. */
export const TTS_PCM_RATE = 24000;

/** Frecuencia de trabajo del análisis: para F0 (65-320 Hz) sobra con 8 kHz. */
const WORK_RATE = 8000;

/** Rango de F0 que se considera voz humana. */
const MIN_F0 = 65;
const MAX_F0 = 330;

/**
 * Una voz se da por presente si aparecen segmentos dentro de esta distancia de
 * su tono de referencia. Es tolerante a propósito: la misma voz sube y baja
 * varios semitonos según la entonación, y un falso positivo de «colapso»
 * cuesta una petición extra.
 */
const EVIDENCE_SEMITONES = 3;

/** Segmentos mínimos, y proporción mínima, para dar una voz por presente. */
const MIN_EVIDENCE_SEGMENTS = 2;
const MIN_EVIDENCE_SHARE = 0.12;

export interface VoiceCheckResult {
  /** Falso cuando falta alguna de las dos voces pedidas. */
  ok: boolean;
  /** Explicación en una línea, para el registro de la pantalla de carga. */
  reason: string;
  /** F0 mediana de cada segmento de habla encontrado, en Hz. */
  pitches: number[];
  /** Segmentos atribuibles a cada voz pedida. */
  evidence: [number, number];
  /** Falso cuando el audio no da para decidir (poco material, mucho ruido). */
  conclusive: boolean;
}

/** PCM 16 bits little-endian → muestras en punto flotante. */
function toFloat(pcm: Uint8Array): Float32Array {
  const n = Math.floor(pcm.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = pcm[i * 2];
    const hi = pcm[i * 2 + 1];
    const v = (hi << 8) | lo;
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  return out;
}

/** Diezmado con promediado: quita el agudo que estorbaría a la autocorrelación. */
function downsample(x: Float32Array, from: number, to: number): Float32Array {
  const factor = Math.max(1, Math.round(from / to));
  if (factor === 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += x[i * factor + k];
    out[i] = sum / factor;
  }
  return out;
}

/**
 * F0 de una ventana por autocorrelación con recorte central.
 *
 * El recorte quita los formantes de amplitud baja y deja la periodicidad
 * desnuda. Entre dos retardos igual de buenos gana **el más corto**: el pico de
 * autocorrelación se repite en cada múltiplo del periodo, y quedarse con el más
 * alto hace que una voz grave se lea sistemáticamente una octava por debajo —
 * exactamente el error que convertiría una voz de 119 Hz en una de 60.
 */
function frameF0(x: Float32Array, start: number, len: number, rate: number): number | null {
  const minLag = Math.floor(rate / MAX_F0);
  const maxLag = Math.floor(rate / MIN_F0);
  if (start + len + maxLag > x.length) return null;

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(x[start + i]));
  if (peak < 0.02) return null;

  const clip = 0.35 * peak;
  const y = new Float32Array(len + maxLag);
  for (let i = 0; i < y.length; i++) {
    const v = x[start + i] || 0;
    y[i] = v > clip ? v - clip : v < -clip ? v + clip : 0;
  }

  let energy = 0;
  for (let i = 0; i < len; i++) energy += y[i] * y[i];
  if (energy <= 0) return null;

  const scores = new Float32Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e = 0;
    for (let i = 0; i < len; i++) {
      num += y[i] * y[i + lag];
      e += y[i + lag] * y[i + lag];
    }
    const r = num / Math.sqrt(energy * e + 1e-12);
    scores[lag] = r;
    if (r > best) best = r;
  }
  if (best < 0.45) return null;

  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scores[lag] >= best * 0.88) return rate / lag;
  }
  return null;
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Regiones de habla separadas por silencios; una por turno, o varias por turno. */
function speechSegments(x: Float32Array, rate: number): Array<[number, number]> {
  const hop = Math.floor(rate * 0.02);
  const frames = Math.floor(x.length / hop);
  if (frames < 4) return [];

  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < hop; i++) sum += x[f * hop + i] ** 2;
    rms[f] = Math.sqrt(sum / hop);
  }

  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const threshold = Math.max(floor * 3, loud * 0.08, 0.004);

  const gapFrames = Math.round(260 / 20);
  const minFrames = Math.round(320 / 20);
  const out: Array<[number, number]> = [];
  let start = -1;
  let quiet = 0;

  for (let f = 0; f < frames; f++) {
    if (rms[f] > threshold) {
      if (start < 0) start = f;
      quiet = 0;
    } else if (start >= 0 && ++quiet >= gapFrames) {
      if (f - quiet - start >= minFrames) out.push([start * hop, (f - quiet) * hop]);
      start = -1;
      quiet = 0;
    }
  }
  if (start >= 0 && frames - start >= minFrames) out.push([start * hop, frames * hop]);
  return out;
}

/** F0 mediana de cada región de habla del PCM, en Hz. */
export function segmentPitches(pcm: Uint8Array, rate = TTS_PCM_RATE): number[] {
  const x = downsample(toFloat(pcm), rate, WORK_RATE);
  const win = Math.floor(WORK_RATE * 0.043);
  const step = Math.floor(WORK_RATE * 0.015);

  const pitches: number[] = [];
  for (const [from, to] of speechSegments(x, WORK_RATE)) {
    const f0s: number[] = [];
    for (let s = from; s + win < to; s += step) {
      const f0 = frameF0(x, s, win, WORK_RATE);
      if (f0) f0s.push(f0);
    }
    // Con menos de seis ventanas sonoras la mediana es ruido, no un tono.
    if (f0s.length >= 6) pitches.push(median(f0s) as number);
  }
  return pitches;
}

const semitones = (a: number, b: number) => Math.abs(12 * Math.log2(a / b));

/**
 * Comprueba que en el audio se oyen las dos voces pedidas.
 *
 * Se cuenta *evidencia por voz*: segmentos cuyo tono cae cerca del tono de
 * referencia de esa voz. Deliberadamente no se agrupa el audio en dos racimos
 * sin más — una sola voz expresiva reparte sus segmentos en dos grupos
 * separados 4 semitonos y pasaría la prueba. Lo que no puede fingir una voz
 * sola es aparecer *donde no está*: si ningún segmento cae cerca de los 119 Hz
 * de la voz grave, esa voz no se ha usado.
 *
 * La ventana se estrecha si las dos referencias están próximas, para que no se
 * solapen; por eso `pickVoicePair()` garantiza una separación mínima.
 */
export function checkTwoVoices(
  pcm: Uint8Array,
  pitchA: number,
  pitchB: number,
  rate = TTS_PCM_RATE
): VoiceCheckResult {
  const pitches = segmentPitches(pcm, rate);
  const separation = semitones(pitchA, pitchB);
  const window = Math.min(EVIDENCE_SEMITONES, separation / 2 - 0.25);

  const evidence: [number, number] = [0, 0];
  for (const f0 of pitches) {
    const dA = semitones(f0, pitchA);
    const dB = semitones(f0, pitchB);
    if (dA <= window && dA < dB) evidence[0]++;
    else if (dB <= window && dB < dA) evidence[1]++;
  }

  const needed = Math.max(MIN_EVIDENCE_SEGMENTS, Math.ceil(pitches.length * MIN_EVIDENCE_SHARE));
  const conclusive = window > 0.5 && pitches.length >= 2 * needed;
  const ok = !conclusive || (evidence[0] >= needed && evidence[1] >= needed);

  const missing = evidence[0] < needed ? pitchA : pitchB;
  const reason = !conclusive
    ? `audio insuficiente para medirlo (${pitches.length} segmentos con tono)`
    : ok
      ? `las dos voces presentes (${evidence[0]} y ${evidence[1]} de ${pitches.length} segmentos)`
      : `no se oye la voz de ${Math.round(missing)} Hz: ${evidence[0]}/${evidence[1]} segmentos ` +
        `de ${pitches.length} (tonos ${pitches.map(p => Math.round(p)).join(', ')})`;

  return { ok, reason, pitches, evidence, conclusive };
}
