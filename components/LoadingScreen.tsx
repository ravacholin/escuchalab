import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AudioWaveform,
  Check,
  Cpu,
  FileText,
  Loader2,
  Radio,
  X
} from 'lucide-react';
import {
  ProgressSnapshot,
  ProgressStep,
  formatClock,
  formatDuration
} from '../services/generationProgress';

interface LoadingScreenProps {
  status: 'generating_plan' | 'generating_audio';
  /**
   * Instantánea del progreso REAL reportado por los servicios. Todo lo que se
   * pinta aquí sale de ella: no hay pasos simulados ni barras movidas por
   * temporizador. Si todavía no ha llegado nada, se dice que se está a la espera.
   */
  progress: ProgressSnapshot | null;
}

const PHASE_TITLE: Record<'plan' | 'audio', string> = {
  plan: 'Procesando Guion',
  audio: 'Sintetizando Audio'
};

const PHASE_SUBTITLE: Record<'plan' | 'audio', string> = {
  plan: 'Fase 1 de 2: Guion y ejercicios',
  audio: 'Fase 2 de 2: Síntesis de voz'
};

const TONE_CLASS: Record<string, string> = {
  info: 'text-muted',
  ok: 'text-fg',
  warn: 'text-muted',
  error: 'text-faint'
};

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const StepIcon: React.FC<{ status: ProgressStep['status'] }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <Check size={12} className="text-fg" />;
    case 'warning':
      return <AlertTriangle size={12} className="text-muted" />;
    case 'failed':
      return <X size={12} className="text-faint" />;
    case 'active':
      return <Loader2 size={12} className="text-fg animate-spin" />;
    default:
      return <div className="w-[6px] h-[6px] border border-faint" />;
  }
};

const StepRow: React.FC<{ step: ProgressStep }> = ({ step }) => {
  const elapsed =
    step.startedAt && step.endedAt ? formatDuration(step.endedAt - step.startedAt) : null;
  const isActive = step.status === 'active';
  const isPending = step.status === 'pending';

  return (
    <div className={`py-2 border-b border-line-soft last:border-b-0 ${isPending ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="w-3 flex justify-center flex-shrink-0">
          <StepIcon status={step.status} />
        </span>
        <span
          className={`font-mono text-[11px] uppercase tracking-wider flex-1 ${
            isActive ? 'text-fg' : 'text-muted'
          }`}
        >
          {step.label}
        </span>
        {isActive && step.ratio !== undefined && (
          <span className="font-mono text-[10px] text-fg">{Math.floor(step.ratio * 100)}%</span>
        )}
        {isActive && step.ratio === undefined && !step.atomic && (
          <span className="font-mono text-[9px] text-faint uppercase">sin total conocido</span>
        )}
        {elapsed && <span className="font-mono text-[10px] text-faint">{elapsed}</span>}
      </div>

      {step.detail && (
        <p className="font-mono text-[10px] text-muted pl-6 mt-1 leading-relaxed">{step.detail}</p>
      )}

      {isActive && step.ratio !== undefined && (
        <div className="ml-6 mt-2 h-[3px] bg-panel-2 overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${step.ratio * 100}%` }}
          />
        </div>
      )}
    </div>
  );
};

const LoadingScreen: React.FC<LoadingScreenProps> = ({ status, progress }) => {
  const phase: 'plan' | 'audio' = progress?.phase ?? (status === 'generating_plan' ? 'plan' : 'audio');
  const [now, setNow] = useState(() => Date.now());

  // Único elemento que avanza con el reloj, y porque es literalmente un reloj:
  // el tiempo que el usuario lleva esperando.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const steps = progress?.steps ?? [];
  const activeStep = steps.find(step => step.id === progress?.activeStepId);
  // Entre el fin de un paso y el arranque del siguiente no hay ninguno activo:
  // se mantiene el último con actividad para no parpadear.
  const currentStep = activeStep ?? [...steps].reverse().find(step => step.status !== 'pending');
  const doneCount = steps.filter(s => s.status === 'done' || s.status === 'warning').length;
  const measurable = progress?.measurable ?? false;
  const percent = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const elapsed = progress ? now - progress.startedAt : 0;

  // Caudal real de datos: se guarda el incremento observado entre instantáneas
  // para dibujar lo que está llegando, en vez de barras aleatorias.
  const [throughput, setThroughput] = useState<number[]>([]);
  const lastVolume = useRef<number>(0);
  const volume = currentStep?.metrics?.audioBytes ?? currentStep?.metrics?.chars ?? 0;

  useEffect(() => {
    if (!volume) return;
    const delta = Math.max(0, volume - lastVolume.current);
    lastVolume.current = volume;
    if (delta <= 0) return;
    setThroughput(prev => [...prev.slice(-31), delta]);
  }, [volume]);

  useEffect(() => {
    // Cada fase mide su propio caudal.
    lastVolume.current = 0;
    setThroughput([]);
  }, [phase]);

  const peak = useMemo(() => Math.max(1, ...throughput), [throughput]);
  const logs = progress?.logs ?? [];
  const visibleLogs = logs.slice(-6);

  return (
    <div className="min-h-[100dvh] w-full bg-ink flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Grid Decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none"></div>

      <div className="w-full max-w-2xl p-6 md:p-8 relative z-10 max-h-screen overflow-y-auto scrollbar-thin">

        {/* Main Status Display */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-panel-2 border border-line relative">
            {phase === 'plan' ? (
              <Cpu className="text-fg animate-pulse absolute" size={24} />
            ) : (
              <AudioWaveform className="text-fg animate-pulse absolute" size={24} />
            )}
            <div className="absolute inset-0 rounded-full border border-accent opacity-20 animate-ping"></div>
          </div>

          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-fg mb-2">
            {PHASE_TITLE[phase]}
          </h2>
          <p className="font-mono text-[11px] text-faint uppercase tracking-[0.16em]">
            {PHASE_SUBTITLE[phase]}
          </p>
        </div>

        {/* Progress Bar: real percentage, or explicit "unknown" */}
        <div className="mb-6">
          <div className="flex items-end justify-between mb-2 gap-4">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-faint uppercase tracking-wider">
                {currentStep ? currentStep.label : 'A la espera del primer dato'}
              </span>
              <span className="font-mono text-[10px] text-faint uppercase tracking-wider">
                Paso {Math.min(doneCount + 1, steps.length || 1)} de {steps.length || '—'} · Transcurrido {formatClock(elapsed)}
              </span>
            </div>
            <span className="font-mono text-sm text-fg font-bold whitespace-nowrap">
              {measurable ? `${Math.floor(percent)}%` : `≥ ${Math.floor(percent)}%`}
            </span>
          </div>

          <div className="w-full h-2.5 bg-panel-2 relative overflow-hidden border border-line rounded-full">
            <div
              className="absolute top-0 left-0 h-full bg-accent transition-[width] duration-200 ease-linear rounded-full"
              style={{ width: `${percent}%` }}
            />
            {!measurable && (
              // El paso en curso no tiene total conocido: se marca la zona
              // indeterminada en vez de rellenarla con una cifra inventada.
              <div
                className="absolute top-0 h-full w-24 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.6s_linear_infinite]"
                style={{ left: `${percent}%` }}
              />
            )}
          </div>

          {!measurable && (
            <p className="font-mono text-[9px] text-faint uppercase tracking-wider mt-2">
              El servicio no informa del total de este paso: se muestra lo ya recibido.
            </p>
          )}
        </div>

        {/* Live counters for the active step */}
        {currentStep?.counters && currentStep.counters.length > 0 && (
          <div className="mb-6 grid grid-cols-3 gap-px bg-line border border-line rounded-xl overflow-hidden">
            {currentStep.counters.map(counter => (
              <div key={counter.label} className="bg-panel p-3.5">
                <div className="font-mono text-[9px] text-faint uppercase tracking-wider mb-1">
                  {counter.label}
                </div>
                <div className="font-display text-xl text-fg font-bold leading-none">
                  {counter.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Real throughput: bytes/characters received between snapshots */}
        {throughput.length > 1 && (
          <div className="mb-6 border border-line bg-panel p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[10px] text-muted uppercase tracking-wider flex items-center gap-2">
                <Radio size={12} className="animate-pulse" />
                Datos recibidos por actualización
              </span>
              <span className="font-mono text-[9px] text-faint uppercase">
                {phase === 'audio' ? 'bytes de audio' : 'caracteres'}
              </span>
            </div>
            <div className="flex items-end justify-start gap-[3px] h-12">
              {throughput.map((value, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-accent/70"
                  style={{ height: `${Math.max(4, (value / peak) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Step-by-step truth */}
        <div className="border border-line bg-panel p-4 mb-6 rounded-xl">
          {steps.length === 0 ? (
            <p className="font-mono text-[10px] text-faint uppercase">Iniciando…</p>
          ) : (
            steps.map(step => <StepRow key={step.id} step={step} />)
          )}
        </div>

        {/* Event log: real events, stamped when they happened */}
        <div className="border border-line bg-panel p-4 rounded-xl min-h-[120px] flex flex-col font-mono text-[10px] sm:text-[11px]">
          <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
            <span className="text-muted uppercase tracking-wider flex items-center gap-2">
              <FileText size={12} />
              Registro de eventos
            </span>
            <span className="text-faint text-[9px] uppercase">{logs.length} eventos</span>
          </div>
          <div className="space-y-1.5">
            {visibleLogs.length === 0 && (
              <div className="text-faint">Sin eventos todavía.</div>
            )}
            {visibleLogs.map((entry, idx) => (
              <div key={`${entry.at}_${idx}`} className="flex gap-2 leading-relaxed">
                <span className="text-faint flex-shrink-0">{timeOf(entry.at)}</span>
                <span className={TONE_CLASS[entry.tone] || 'text-muted'}>{entry.text}</span>
              </div>
            ))}
            <div className="text-fg animate-pulse">_</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
