/**
 * PROGRESO REAL DE GENERACIÓN
 *
 * Las pantallas de carga solían animar una secuencia de pasos inventada con
 * `setTimeout`: los porcentajes subían por reloj, no por trabajo hecho, y los
 * textos ("Procesando fonemas y prosodia…") describían etapas que no existen.
 *
 * Este módulo es lo contrario: un canal por el que los servicios reportan
 * hechos medidos —caracteres recibidos del stream, turnos ya parseados,
 * ejercicios que superan la verificación, bytes de audio recibidos— y la UI
 * los muestra tal cual. Reglas de la casa:
 *
 *  1. Nada avanza por tiempo. Cada emisión responde a un evento real.
 *  2. Un paso solo tiene `ratio` (y por tanto porcentaje) si existe un
 *     denominador conocido de verdad (p. ej. ejercicios pedidos al modelo).
 *     Si no lo hay, el paso es indeterminado y la UI lo dice, en vez de
 *     inventar una cifra.
 *  3. `counters` son magnitudes observadas; `metrics` es lo mismo en crudo,
 *     para que la interfaz pueda graficarlas sin parsear texto.
 */

export type ProgressPhase = 'plan' | 'audio';

export type StepStatus = 'pending' | 'active' | 'done' | 'warning' | 'failed';

export type LogTone = 'info' | 'ok' | 'warn' | 'error';

export interface ProgressCounter {
  label: string;
  value: string;
}

export interface StepDefinition {
  id: string;
  label: string;
  /** Peso relativo del paso dentro de la fase. La suma define el 100%. */
  weight: number;
  /**
   * Paso local e instantáneo (parsear, verificar, montar): no tiene avance
   * interno que medir, pero tampoco es una espera opaca, así que no debe
   * marcar la fase como no medible.
   */
  atomic?: boolean;
}

export interface ProgressStep extends StepDefinition {
  status: StepStatus;
  /** Descripción del resultado con cifras reales. */
  detail?: string;
  /** Avance medido dentro del paso (0..1). `undefined` = no medible. */
  ratio?: number;
  /** Magnitudes observadas, ya formateadas para mostrar. */
  counters?: ProgressCounter[];
  /** Las mismas magnitudes en crudo, para visualizaciones. */
  metrics?: Record<string, number>;
  startedAt?: number;
  endedAt?: number;
}

export interface ProgressLogEntry {
  at: number;
  text: string;
  tone: LogTone;
}

export interface ProgressSnapshot {
  phase: ProgressPhase;
  startedAt: number;
  updatedAt: number;
  steps: ProgressStep[];
  logs: ProgressLogEntry[];
  /** Fracción del trabajo conocido ya completada (0..100), ponderada por paso. */
  percent: number;
  /**
   * `false` cuando el paso en curso no tiene denominador conocido. La UI debe
   * ocultar el porcentaje en ese caso en lugar de fabricar uno.
   */
  measurable: boolean;
  activeStepId: string | null;
  finished: boolean;
}

export type ProgressListener = (snapshot: ProgressSnapshot) => void;

/**
 * Decide qué instantánea muestra la pantalla de carga cuando el plan y el audio
 * reportan A LA VEZ. El audio arranca en paralelo (en cuanto el diálogo llega,
 * antes de que terminen los ejercicios), así que las dos fases se solapan y sus
 * `onProgress` se pisan. La regla:
 *
 *  - Misma fase: avance normal, siempre se actualiza.
 *  - Un snapshot 'plan' cuando el plan YA resolvió: es un flush rezagado; se
 *    ignora para no retroceder la pantalla (la intención original del filtro).
 *  - Un snapshot 'plan' con el audio ya al 100% (`finished`) y el plan aún vivo:
 *    ESTE es el caso que se quedaba colgado. Se muestra la Fase 1 en vivo
 *    (verificación, reintentos, cambio de modelo) en lugar de un 100% congelado.
 *  - Un snapshot 'plan' mientras el audio sigue en streaming: se conserva el
 *    audio para no parpadear entre fases (sus barras se están moviendo).
 *  - Cualquier snapshot 'audio' manda (inicio/reanudación de la Fase 2).
 */
export function mergeProgress(
  prev: ProgressSnapshot | null,
  snapshot: ProgressSnapshot,
  planResolved: boolean
): ProgressSnapshot {
  if (!prev || prev.phase === snapshot.phase) return snapshot;
  if (snapshot.phase === 'plan') {
    if (planResolved) return prev;
    if (prev.phase === 'audio' && prev.finished) return snapshot;
    if (prev.phase === 'audio') return prev;
  }
  return snapshot;
}

/** Máxima frecuencia de emisión para actualizaciones continuas (chunks). */
const THROTTLE_MS = 90;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export class ProgressReporter {
  private readonly steps: ProgressStep[];
  private readonly logs: ProgressLogEntry[] = [];
  private readonly phase: ProgressPhase;
  private readonly listener?: ProgressListener;
  private readonly startedAt = Date.now();
  private lastEmit = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(phase: ProgressPhase, definitions: StepDefinition[], listener?: ProgressListener) {
    this.phase = phase;
    this.listener = listener;
    this.steps = definitions.map(def => ({ ...def, status: 'pending' as StepStatus }));
    this.emit(true);
  }

  private find(id: string): ProgressStep | undefined {
    return this.steps.find(step => step.id === id);
  }

  start(id: string, detail?: string): void {
    const step = this.find(id);
    if (!step) return;
    step.status = 'active';
    step.startedAt = Date.now();
    step.endedAt = undefined;
    if (detail !== undefined) step.detail = detail;
    this.emit(true);
  }

  /** Actualiza magnitudes medidas del paso en curso. No fuerza emisión. */
  update(
    id: string,
    patch: { ratio?: number; detail?: string; counters?: ProgressCounter[]; metrics?: Record<string, number> }
  ): void {
    const step = this.find(id);
    if (!step) return;
    if (patch.ratio !== undefined) step.ratio = clamp01(patch.ratio);
    if (patch.detail !== undefined) step.detail = patch.detail;
    if (patch.counters !== undefined) step.counters = patch.counters;
    if (patch.metrics !== undefined) step.metrics = { ...step.metrics, ...patch.metrics };
    this.emit(false);
  }

  finish(id: string, detail?: string, status: 'done' | 'warning' = 'done'): void {
    const step = this.find(id);
    if (!step) return;
    step.status = status;
    step.endedAt = Date.now();
    step.ratio = 1;
    if (detail !== undefined) step.detail = detail;
    this.emit(true);
  }

  fail(id: string, detail: string): void {
    const step = this.find(id);
    if (!step) return;
    step.status = 'failed';
    step.endedAt = Date.now();
    step.detail = detail;
    this.emit(true);
  }

  /** Devuelve un paso ya empezado a estado inicial (reintentos del modelo). */
  reset(ids: string[]): void {
    for (const id of ids) {
      const step = this.find(id);
      if (!step) continue;
      step.status = 'pending';
      step.ratio = undefined;
      step.detail = undefined;
      step.counters = undefined;
      step.metrics = undefined;
      step.startedAt = undefined;
      step.endedAt = undefined;
    }
    this.emit(true);
  }

  log(text: string, tone: LogTone = 'info'): void {
    this.logs.push({ at: Date.now(), text, tone });
    if (this.logs.length > 80) this.logs.shift();
    this.emit(true);
  }

  snapshot(): ProgressSnapshot {
    const total = this.steps.reduce((sum, step) => sum + step.weight, 0) || 1;
    let completed = 0;
    let activeStepId: string | null = null;
    let measurable = true;

    for (const step of this.steps) {
      if (step.status === 'done' || step.status === 'warning') {
        completed += step.weight;
      } else if (step.status === 'active') {
        activeStepId = step.id;
        if (step.ratio === undefined) measurable = measurable && Boolean(step.atomic);
        else completed += step.weight * step.ratio;
      }
    }

    return {
      phase: this.phase,
      startedAt: this.startedAt,
      updatedAt: Date.now(),
      steps: this.steps.map(step => ({ ...step })),
      logs: this.logs.map(entry => ({ ...entry })),
      percent: (completed / total) * 100,
      measurable,
      activeStepId,
      finished: this.steps.every(step => step.status === 'done' || step.status === 'warning')
    };
  }

  /** Vacía cualquier emisión pendiente. Se llama al terminar la fase. */
  flush(): void {
    this.emit(true);
  }

  private emit(force: boolean): void {
    if (!this.listener) return;
    const now = Date.now();

    if (!force && now - this.lastEmit < THROTTLE_MS) {
      // Emisión diferida: la última medida siempre llega, aunque el chunk que
      // la produjo cayera dentro de la ventana de throttling.
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.emit(true);
        }, THROTTLE_MS);
      }
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastEmit = now;
    this.listener(this.snapshot());
  }
}

// ---------------------------------------------------------------------------
// Formateo de magnitudes (compartido por servicios y UI)
// ---------------------------------------------------------------------------

export const formatCount = (n: number): string => n.toLocaleString('es-ES');

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0,0 s';
  if (seconds < 60) return `${seconds.toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')} min`;
};

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
};

export const formatClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
