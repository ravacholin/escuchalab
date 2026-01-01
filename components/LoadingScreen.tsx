import React, { useEffect, useState } from 'react';
import { Loader2, Cpu, Zap, FileText, Waves, CheckCircle2, AudioWaveform, Radio } from 'lucide-react';

interface LoadingScreenProps {
  status: 'generating_plan' | 'generating_audio';
}

interface ProcessStep {
  text: string;
  duration: number;
  progress: number;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ status }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(12).fill(0));

  // Simulated logs based on status with progress tracking
  useEffect(() => {
    let interval: any;
    let progressInterval: any;
    let waveformInterval: any;

    if (status === 'generating_plan') {
      const planSteps: ProcessStep[] = [
        { text: "Iniciando protocolo CEFR...", duration: 800, progress: 15 },
        { text: "Analizando parámetros de contexto...", duration: 900, progress: 30 },
        { text: "Estructurando diálogo...", duration: 1000, progress: 50 },
        { text: "Calculando complejidad léxica...", duration: 700, progress: 70 },
        { text: "Generando ejercicios de comprensión...", duration: 800, progress: 90 }
      ];

      let i = 0;
      setLogs(['> SYSTEM_INIT']);
      setProgress(0);
      setCurrentStep(0);

      const executeStep = () => {
        if (i < planSteps.length) {
          const step = planSteps[i];
          setLogs(prev => [...prev.slice(-4), `> ${step.text}`]);
          setCurrentStep(i);

          // Smooth progress animation
          let currentProgress = i > 0 ? planSteps[i-1].progress : 0;
          const targetProgress = step.progress;
          const progressStep = (targetProgress - currentProgress) / (step.duration / 50);

          progressInterval = setInterval(() => {
            currentProgress += progressStep;
            if (currentProgress >= targetProgress) {
              currentProgress = targetProgress;
              clearInterval(progressInterval);
            }
            setProgress(currentProgress);
          }, 50);

          i++;
          if (i < planSteps.length) {
            setTimeout(executeStep, step.duration);
          }
        }
      };

      executeStep();

    } else if (status === 'generating_audio') {
      const audioSteps: ProcessStep[] = [
        { text: "Matriz narrativa validada", duration: 600, progress: 8 },
        { text: "Conectando motor TTS neural Gemini 2.5...", duration: 800, progress: 18 },
        { text: "Cargando perfiles dialectales...", duration: 700, progress: 28 },
        { text: "Asignando voces: Fenrir/Puck/Kore...", duration: 900, progress: 38 },
        { text: "Procesando fonemas y prosodia...", duration: 1200, progress: 52 },
        { text: "Sintetizando segmentos de audio...", duration: 1500, progress: 70 },
        { text: "Modulando entonación dialectal...", duration: 1000, progress: 82 },
        { text: "Mezclando pistas de ambiente...", duration: 800, progress: 92 },
        { text: "Finalizando buffer de audio...", duration: 600, progress: 100 }
      ];

      let i = 0;
      setLogs(['> PLAN_GENERATED']);
      setProgress(0);
      setCurrentStep(0);

      // Animated waveform bars
      waveformInterval = setInterval(() => {
        setWaveformBars(prev => prev.map(() => Math.random() * 100));
      }, 150);

      const executeStep = () => {
        if (i < audioSteps.length) {
          const step = audioSteps[i];
          setLogs(prev => [...prev.slice(-4), `> ${step.text}`]);
          setCurrentStep(i);

          // Smooth progress animation
          let currentProgress = i > 0 ? audioSteps[i-1].progress : 0;
          const targetProgress = step.progress;
          const progressStep = (targetProgress - currentProgress) / (step.duration / 50);

          progressInterval = setInterval(() => {
            currentProgress += progressStep;
            if (currentProgress >= targetProgress) {
              currentProgress = targetProgress;
              clearInterval(progressInterval);
            }
            setProgress(currentProgress);
          }, 50);

          i++;
          if (i < audioSteps.length) {
            setTimeout(executeStep, step.duration);
          }
        }
      };

      executeStep();
    }

    return () => {
      clearInterval(interval);
      clearInterval(progressInterval);
      clearInterval(waveformInterval);
    };
  }, [status]);

  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Grid Decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none"></div>

      <div className="w-full max-w-2xl p-8 relative z-10">

        {/* Main Status Display */}
        <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-zinc-900 border border-zinc-800 relative">
                {status === 'generating_plan' ? (
                  <Cpu className="text-white animate-pulse absolute" size={24} />
                ) : (
                  <AudioWaveform className="text-white animate-pulse absolute" size={24} />
                )}
                <div className="absolute inset-0 rounded-full border border-white opacity-20 animate-ping"></div>
                <div className="absolute inset-0 rounded-full border border-white opacity-10 animate-ping" style={{ animationDelay: '0.5s' }}></div>
            </div>

            <h2 className="font-display text-3xl md:text-4xl uppercase font-bold tracking-tight text-white mb-2">
                {status === 'generating_plan' ? 'Procesando Guion' : 'Sintetizando Audio'}
            </h2>
            <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                {status === 'generating_plan' ? 'Fase 1 de 2: Estructura' : 'Fase 2 de 2: Voz Neural'}
            </p>
        </div>

        {/* Progress Bar Container with Percentage */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">Progreso</span>
            <span className="font-mono text-sm text-white font-bold">{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-2 bg-zinc-900 relative overflow-hidden border border-zinc-800">
              <div
                  className="absolute top-0 left-0 h-full bg-white transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
              ></div>
              {/* Animated shine effect */}
              <div
                className="absolute top-0 h-full w-32 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite]"
                style={{ left: `${Math.max(0, progress - 20)}%` }}
              ></div>
          </div>
        </div>

        {/* Audio Waveform Visualization (only for audio generation) */}
        {status === 'generating_audio' && (
          <div className="mb-6 border border-zinc-800 bg-zinc-950/30 p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Radio size={12} className="animate-pulse" />
                Visualización de Síntesis
              </span>
              <span className="font-mono text-[9px] text-zinc-700">44.1kHz / 16-bit</span>
            </div>
            <div className="flex items-end justify-center gap-1 h-20">
              {waveformBars.map((height, idx) => (
                <div
                  key={idx}
                  className="w-full bg-gradient-to-t from-white to-zinc-400 transition-all duration-150 ease-out"
                  style={{
                    height: `${height}%`,
                    opacity: 0.3 + (height / 200)
                  }}
                ></div>
              ))}
            </div>
          </div>
        )}

        {/* Terminal Log Output */}
        <div className="border border-zinc-800 bg-zinc-950/50 p-6 min-h-[180px] flex flex-col justify-end font-mono text-[10px] sm:text-xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-4">
                <span className="text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <FileText size={12} />
                  System_Log.txt
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-700 text-[9px]">
                    STEP {currentStep + 1}/{status === 'generating_plan' ? '5' : '9'}
                  </span>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></div>
                    <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
                  </div>
                </div>
            </div>
            <div className="space-y-2">
                {logs.map((log, idx) => (
                    <div
                      key={idx}
                      className="text-zinc-400 animate-in fade-in slide-in-from-bottom-2 duration-300"
                    >
                        <span className="text-zinc-600 mr-2">
                          {(new Date()).toLocaleTimeString('es-ES', {
                            hour12: false,
                            hour: '2-digit',
                            minute:'2-digit',
                            second:'2-digit'
                          })}
                        </span>
                        {log}
                        {idx === logs.length - 1 && (
                          <CheckCircle2 size={12} className="inline ml-2 text-emerald-600" />
                        )}
                    </div>
                ))}
                <div className="text-white animate-pulse">_</div>
            </div>
        </div>

      </div>

      {/* Footer Version */}
      <div className="absolute bottom-8 text-center w-full">
          <span className="font-mono text-[9px] text-zinc-700 uppercase tracking-[0.2em]">
            Laboratorio de Escucha v2.2.0 · Powered by Gemini 2.5
          </span>
      </div>
    </div>
  );
};

export default LoadingScreen;
