import React, { useEffect, useRef, useState } from 'react';
import { Cpu, FileText, CheckCircle2 } from 'lucide-react';

interface LoadingScreenProps {
  /** Turnos de diálogo ya escritos por el modelo (llegan por streaming). */
  turnsWritten: number;
  /** Turnos que cabe esperar según la longitud pedida. */
  expectedTurns: number;
}

/**
 * Pantalla de espera de la única llamada bloqueante: la escritura del diálogo.
 *
 * Antes esto animaba una secuencia de pasos inventados con `setTimeout` que
 * llegaba al 100 % a los pocos segundos y se quedaba ahí mientras la petición
 * seguía en curso. Ahora cuenta turnos reales conforme el modelo los escribe;
 * los ejercicios y la voz ya no se esperan aquí, se generan con la lección en
 * pantalla.
 */
const LoadingScreen: React.FC<LoadingScreenProps> = ({ turnsWritten, expectedTurns }) => {
  const [logs, setLogs] = useState<string[]>(['> SYSTEM_INIT']);
  const [elapsed, setElapsed] = useState(0);
  const lastLoggedTurn = useRef(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (turnsWritten === 0 || turnsWritten === lastLoggedTurn.current) return;
    lastLoggedTurn.current = turnsWritten;
    setLogs(prev => [...prev.slice(-4), `> Turno ${turnsWritten} escrito`]);
  }, [turnsWritten]);

  useEffect(() => {
    if (turnsWritten > 0 || elapsed < 1.5) return;
    setLogs(prev => (prev.length > 1 ? prev : [...prev, '> Redactando el diálogo...']));
  }, [elapsed, turnsWritten]);

  // Nunca llega al 100 %: el último tramo lo cierra la respuesta real.
  const progress = Math.min(92, Math.round((turnsWritten / Math.max(1, expectedTurns)) * 92));

  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Grid Decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none"></div>

      <div className="w-full max-w-2xl p-8 relative z-10">

        {/* Main Status Display */}
        <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-zinc-900 border border-zinc-800 relative">
                <Cpu className="text-white animate-pulse absolute" size={24} />
                <div className="absolute inset-0 rounded-full border border-white opacity-20 animate-ping"></div>
                <div className="absolute inset-0 rounded-full border border-white opacity-10 animate-ping" style={{ animationDelay: '0.5s' }}></div>
            </div>

            <h2 className="font-display text-3xl md:text-4xl uppercase font-bold tracking-tight text-white mb-2">
                Escribiendo el Diálogo
            </h2>
            <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                Los ejercicios y la voz se generan después, ya con la lección abierta
            </p>
        </div>

        {/* Progress Bar Container */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
              {turnsWritten > 0 ? `${turnsWritten} turnos` : 'Conectando'}
            </span>
            <span className="font-mono text-sm text-white font-bold">{elapsed.toFixed(1)}s</span>
          </div>
          <div className="w-full h-2 bg-zinc-900 relative overflow-hidden border border-zinc-800">
              <div
                  className="absolute top-0 left-0 h-full bg-white transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(4, progress)}%` }}
              ></div>
              <div
                className="absolute top-0 h-full w-32 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite]"
                style={{ left: `${Math.max(0, progress - 20)}%` }}
              ></div>
          </div>
        </div>

        {/* Terminal Log Output */}
        <div className="border border-zinc-800 bg-zinc-950/50 p-6 min-h-[180px] flex flex-col justify-end font-mono text-[10px] sm:text-xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-4">
                <span className="text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <FileText size={12} />
                  System_Log.txt
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-700 text-[9px]">
                    {turnsWritten}/{expectedTurns} TURNOS
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
            Laboratorio de Escucha · Powered by Gemini
          </span>
      </div>
    </div>
  );
};

export default LoadingScreen;
