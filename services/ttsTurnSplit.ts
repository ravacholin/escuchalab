/**
 * Partir el bloque de audio de un hablante en sus turnos.
 *
 * Cada voz se pide en **una sola petición** con todos sus turnos seguidos —es la
 * única forma de que el TTS no se equivoque de voz sin gastar cuota en
 * comprobarlo, porque una petición de un solo hablante no tiene ninguna
 * atribución que resolver—, así que lo que vuelve es un bloque continuo y hay
 * que recuperar dónde acaba cada turno para poder intercalarlos.
 *
 * Se sabe algo que hace el problema tratable: **cuántos turnos hay** y cuántos
 * caracteres tiene cada uno. Con eso, buscar los k-1 silencios que mejor encajan
 * con el reparto esperado es una programación dinámica de nada, y sobre todo hay
 * una salida que no puede fallar: si el modelo no dejó pausas suficientes, la
 * frontera que falte se coloca por reparto proporcional, ajustada al punto más
 * callado de su entorno. Puede quedar un corte imperfecto; lo que no puede pasar
 * es que haga falta otra petición.
 *
 * Aritmética pura sobre el PCM (16 bits, mono), sin Web Audio: corre igual en el
 * navegador y en los checks offline.
 */

import { TTS_PCM_RATE, toFloat, downsample } from './ttsVoiceCheck';

/** Frecuencia de trabajo del análisis: para una envolvente de energía sobra. */
const ANALYSIS_RATE = 8000;

/** Salto de la envolvente RMS, el mismo que usa el verificador de voces. */
const HOP_MS = 20;

/** Un silencio más corto que esto no se considera frontera de turno. */
const MIN_GAP_MS = 180;

/** Margen que se conserva antes del primer turno y después del último. */
const EDGE_KEEP_MS = 60;

/**
 * Cuánto puede moverse un corte por reparto para caer en el punto más callado
 * de su entorno. Es un tiempo absoluto, no una fracción del audio: lo que se
 * busca es el valle entre dos sílabas, y ese valle está siempre a un par de
 * décimas. Con una ventana proporcional, un diálogo largo dejaba que la
 * frontera se fuese medio segundo de donde el reparto la quería.
 */
const SNAP_WINDOW_MS = 150;

/**
 * Cuánto pesa desviarse del reparto esperado frente a lo marcado que sea el
 * silencio. Alto a propósito: dentro de un turno también hay pausas —entre
 * frases— y son justo las que confundirían la frontera si solo se mirase el
 * hueco más largo.
 */
const DEVIATION_WEIGHT = 6;

/**
 * Puntuación de un corte por reparto proporcional. Por debajo de la de un
 * silencio bien colocado y por encima de la de uno claramente fuera de sitio:
 * ante la duda es mejor cortar donde toca por reparto que donde el modelo hizo
 * una pausa que no era de turno.
 */
const PROPORTIONAL_SCORE = 0.25;

export interface TurnSplit {
  /** Exactamente `weights.length` trozos, todos no vacíos y de longitud par. */
  pieces: Uint8Array[];
  /** Fronteras que salieron de un silencio realmente medido en el audio. */
  measured: number;
  /** Fronteras colocadas por reparto proporcional porque no había silencio. */
  interpolated: number;
}

interface Envelope {
  rms: Float32Array;
  threshold: number;
  frames: number;
  /** Muestras del PCM original que cubre cada trama de la envolvente. */
  samplesPerFrame: number;
  /** Primera y última trama con habla (exclusiva la última). */
  speechStart: number;
  speechEnd: number;
}

interface Candidate {
  frame: number;
  score: number;
  /** Índice de frontera al que está reservado, o -1 si sirve para cualquiera. */
  reservedFor: number;
  proportional: boolean;
}

/** Recorta a longitud par: el PCM es de 16 bits y medio sample no existe. */
const evenClamp = (bytes: number, limit: number): number =>
  Math.max(0, Math.min(limit, bytes - (bytes % 2)));

/** Envolvente RMS y umbral de habla, con el mismo criterio que `ttsVoiceCheck`. */
function envelopeOf(pcm: Uint8Array, rate: number): Envelope | null {
  const factor = Math.max(1, Math.round(rate / ANALYSIS_RATE));
  const analysisRate = rate / factor;
  const x = downsample(toFloat(pcm), rate, ANALYSIS_RATE);

  const hop = Math.floor((analysisRate * HOP_MS) / 1000);
  if (hop <= 0) return null;
  const frames = Math.floor(x.length / hop);
  if (frames < 4) return null;

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

  let speechStart = -1;
  let speechEnd = -1;
  for (let f = 0; f < frames; f++) {
    if (rms[f] > threshold) {
      if (speechStart < 0) speechStart = f;
      speechEnd = f + 1;
    }
  }
  // Silencio entero: no hay nada que segmentar por energía.
  if (speechStart < 0 || speechEnd - speechStart < 2) return null;

  return { rms, threshold, frames, samplesPerFrame: hop * factor, speechStart, speechEnd };
}

/** Silencios interiores lo bastante largos para ser una frontera de turno. */
function silenceGaps(env: Envelope): Array<{ frame: number; ms: number }> {
  const minFrames = Math.max(1, Math.round(MIN_GAP_MS / HOP_MS));
  const gaps: Array<{ frame: number; ms: number }> = [];

  let quietFrom = -1;
  for (let f = env.speechStart; f <= env.speechEnd; f++) {
    const quiet = f < env.speechEnd && env.rms[f] <= env.threshold;
    if (quiet) {
      if (quietFrom < 0) quietFrom = f;
      continue;
    }
    if (quietFrom >= 0) {
      const length = f - quietFrom;
      // El silencio de cabeza y el de cola no separan dos turnos: los acota
      // `speechStart`/`speechEnd`, así que aquí todo hueco es interior.
      if (length >= minFrames) {
        gaps.push({ frame: quietFrom + length / 2, ms: length * HOP_MS });
      }
      quietFrom = -1;
    }
  }
  return gaps;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Posiciones esperadas de cada frontera según el reparto de caracteres. */
function expectedFrames(weights: number[], from: number, to: number): number[] {
  const total = weights.reduce((n, w) => n + Math.max(1, w), 0);
  const span = to - from;
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    acc += Math.max(1, weights[i]);
    out.push(from + (acc / total) * span);
  }
  return out;
}

/**
 * Corte por reparto: el punto más callado dentro de una ventana alrededor de la
 * posición esperada. La ventana se limita a la mitad de la distancia a las
 * fronteras vecinas, así que los cortes salen estrictamente crecientes y el
 * reparto completo siempre es una solución válida.
 */
function proportionalCandidates(env: Envelope, expected: number[]): Candidate[] {
  const out: Candidate[] = [];
  const reach = SNAP_WINDOW_MS / HOP_MS;

  for (let i = 0; i < expected.length; i++) {
    const before = i === 0 ? env.speechStart : expected[i - 1];
    const after = i === expected.length - 1 ? env.speechEnd : expected[i + 1];
    const half = Math.max(
      1,
      Math.min(reach, (expected[i] - before) / 2, (after - expected[i]) / 2)
    );

    const lo = Math.max(env.speechStart + 1, Math.round(expected[i] - half));
    const hi = Math.min(env.speechEnd - 1, Math.round(expected[i] + half));

    let best = Math.round(expected[i]);
    let quietest = Infinity;
    for (let f = lo; f <= hi; f++) {
      if (env.rms[f] < quietest) {
        quietest = env.rms[f];
        best = f;
      }
    }
    // Estrictamente creciente aunque dos turnos consecutivos sean minúsculos.
    const previous = out.length ? out[out.length - 1].frame : env.speechStart;
    out.push({
      frame: Math.max(best, previous + 1),
      score: PROPORTIONAL_SCORE,
      reservedFor: i,
      proportional: true
    });
  }
  return out;
}

/** Reparto ciego por caracteres, para cuando no hay envolvente que mirar. */
function blindSplit(pcm: Uint8Array, weights: number[]): TurnSplit {
  const total = weights.reduce((n, w) => n + Math.max(1, w), 0);
  const pieces: Uint8Array[] = [];
  let acc = 0;
  let start = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(1, weights[i]);
    const end =
      i === weights.length - 1
        ? pcm.byteLength
        : Math.max(start + 2, evenClamp(Math.round((acc / total) * pcm.byteLength), pcm.byteLength));
    pieces.push(pcm.subarray(Math.min(start, pcm.byteLength), Math.min(end, pcm.byteLength)));
    start = end;
  }
  return { pieces, measured: 0, interpolated: Math.max(0, weights.length - 1) };
}

/**
 * Parte `pcm` en tantos trozos como pesos se le den, usando los caracteres de
 * cada turno como reparto esperado y los silencios del audio como fronteras.
 *
 * Devuelve **siempre** `weights.length` trozos: no hay camino que necesite otra
 * petición al modelo.
 */
export function splitIntoTurns(
  pcm: Uint8Array,
  weights: number[],
  rate: number = TTS_PCM_RATE
): TurnSplit {
  const k = weights.length;
  if (k <= 0) return { pieces: [], measured: 0, interpolated: 0 };
  if (k === 1) return { pieces: [pcm], measured: 0, interpolated: 0 };

  const env = envelopeOf(pcm, rate);
  if (!env) return blindSplit(pcm, weights);

  const expected = expectedFrames(weights, env.speechStart, env.speechEnd);
  const gaps = silenceGaps(env);

  // La referencia del hueco es la del propio audio, no un absoluto: si el modelo
  // deja pausas de 250 ms entre turnos, la mejor de esas pausas tiene que poder
  // puntuar alto igual. Con un umbral fijo se descartarían todas y se cortaría
  // por reparto teniendo silencios buenos delante.
  const reference = Math.max(MIN_GAP_MS, median(gaps.map(g => g.ms)));
  const span = env.speechEnd - env.speechStart;

  const candidates: Candidate[] = [];
  for (const gap of gaps) {
    // El mismo hueco puede servir para cualquier frontera; la puntuación de
    // desviación se aplica al evaluarlo contra cada una.
    candidates.push({
      frame: gap.frame,
      score: Math.min(1, gap.ms / reference),
      reservedFor: -1,
      proportional: false
    });
  }
  candidates.push(...proportionalCandidates(env, expected));
  candidates.sort((a, b) => a.frame - b.frame);

  // La penalización por desviación depende de la frontera concreta, así que se
  // resuelve una DP por cada una con el candidato ya puntuado en contexto.
  const scored = candidates.map(c => ({ ...c }));
  const boundaries = chooseBoundariesWithPrior(scored, expected, span);
  if (boundaries.length !== k - 1) return blindSplit(pcm, weights);

  const toBytes = (frame: number) =>
    evenClamp(Math.round(frame * env.samplesPerFrame) * 2, pcm.byteLength);

  const margin = Math.round((EDGE_KEEP_MS / HOP_MS) * env.samplesPerFrame) * 2;
  const head = evenClamp(Math.max(0, toBytes(env.speechStart) - margin), pcm.byteLength);
  const tail = evenClamp(Math.min(pcm.byteLength, toBytes(env.speechEnd) + margin), pcm.byteLength);

  const cuts = boundaries.map(b => toBytes(b.frame));
  const pieces: Uint8Array[] = [];
  let start = head;
  for (let i = 0; i < k; i++) {
    const end = i === k - 1 ? Math.max(tail, start + 2) : Math.max(start + 2, Math.min(cuts[i], tail));
    pieces.push(pcm.subarray(Math.min(start, pcm.byteLength), Math.min(end, pcm.byteLength)));
    start = end;
  }

  const interpolated = boundaries.filter(b => b.proportional).length;
  return { pieces, measured: boundaries.length - interpolated, interpolated };
}

/**
 * La DP de `chooseBoundaries`, pero puntuando cada candidato contra la frontera
 * que se está colocando: un silencio vale lo que vale *y* lo cerca que está de
 * donde el reparto de caracteres lo esperaba.
 */
function chooseBoundariesWithPrior(
  candidates: Candidate[],
  expected: number[],
  span: number
): Candidate[] {
  const count = expected.length;
  const m = candidates.length;
  if (!m || !count) return [];

  const NEG = -Infinity;
  const dp: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < count; i++) {
    dp.push(new Array<number>(m).fill(NEG));
    from.push(new Array<number>(m).fill(-1));
  }

  const scoreAt = (c: Candidate, i: number) => {
    const deviation = span > 0 ? Math.abs(c.frame - expected[i]) / span : 0;
    // Un corte por reparto está por definición donde el reparto lo quiere: no se
    // le penaliza el desvío que introduce el ajuste al punto más callado.
    return c.proportional ? c.score : c.score - DEVIATION_WEIGHT * deviation;
  };

  for (let i = 0; i < count; i++) {
    let bestPrev = NEG;
    let bestPrevAt = -1;
    for (let j = 0; j < m; j++) {
      if (i > 0 && j > 0 && dp[i - 1][j - 1] > bestPrev) {
        bestPrev = dp[i - 1][j - 1];
        bestPrevAt = j - 1;
      }
      const c = candidates[j];
      if (c.reservedFor >= 0 && c.reservedFor !== i) continue;
      if (i > 0 && bestPrev === NEG) continue;
      dp[i][j] = (i === 0 ? 0 : bestPrev) + scoreAt(c, i);
      from[i][j] = i === 0 ? -1 : bestPrevAt;
    }
  }

  let end = -1;
  let best = NEG;
  for (let j = 0; j < m; j++) {
    if (dp[count - 1][j] > best) {
      best = dp[count - 1][j];
      end = j;
    }
  }
  if (end < 0) return [];

  const chosen: Candidate[] = [];
  for (let i = count - 1; i >= 0 && end >= 0; i--) {
    chosen.unshift(candidates[end]);
    end = from[i][end];
  }
  return chosen.length === count ? chosen : [];
}
