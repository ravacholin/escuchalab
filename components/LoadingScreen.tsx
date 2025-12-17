import React, { useEffect, useState } from 'react';
import { Loader2, cpu, Zap, FileText, Waves, CheckCircle2 } from 'lucide-react';

interface LoadingScreenProps {
  status: 'generating_plan' | 'generating_audio';
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ status }) => {
  const [logs, setLogs] = useState<string[]>([]);
  
  // Simulated logs based on status
  useEffect(() => {
    let interval: any;
    if (status === 'generating_plan') {
      const planLogs = [
        "Iniciando protocolo CEFR...",
        "Analizando parámetros de contexto...",
        "Estructurando diálogo...",
        "Calculando complejidad léxica...",
        "Generando ejercicios de comprensión..."
      ];
      let i = 0;
      setLogs(['> SYSTEM_INIT']);
      interval = setInterval(() => {
        if (i < planLogs.length) {
          setLogs(prev => [...prev.slice(-4), `> ${planLogs[i]}`]);
          i++;
        }
      }, 800);
    } else if (status === 'generating_audio') {
      const audioLogs = [
        "Matriz narrativa: OK",
        "Conectando motor TTS neural...",
        "Asignando perfiles de voz...",
        "Modulando entonación dialectal...",
        "Mezclando pistas de ambiente...",
        "Finalizando buffer de audio..."
      ];
      let i = 0;
      setLogs(['> PLAN_GENERATED']);
      interval = setInterval(() => {
        if (i < audioLogs.length) {
          setLogs(prev => [...prev.slice(-4), `> ${audioLogs[i]}`]);
          i++;
        }
      }, 1200);
    }

    return () => clearInterval(interval);
  }, [status]);

  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Grid Decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none"></div>
      
      <div className="w-full max-w-md p-8 relative z-10">
        
        {/* Main Status Display */}
        <div className="mb-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 mb-6 rounded-full bg-zinc-900 border border-zinc-800 relative">
                <Loader2 className="text-white animate-spin absolute" size={20} />
                <div className="absolute inset-0 rounded-full border border-white opacity-20 animate-ping"></div>
            </div>
            
            <h2 className="font-display text-3xl md:text-4xl uppercase font-bold tracking-tight text-white mb-2">
                {status === 'generating_plan' ? 'Procesando Guion' : 'Sintetizando Audio'}
            </h2>
            <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                {status === 'generating_plan' ? 'Fase 1 de 2: Estructura' : 'Fase 2 de 2: Voz Neural'}
            </p>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full h-1 bg-zinc-900 mb-8 relative overflow-hidden">
            <div 
                className="absolute top-0 left-0 h-full bg-white transition-all duration-[2000ms] ease-out"
                style={{ 
                    width: status === 'generating_plan' ? '45%' : '90%' 
                }}
            ></div>
            {/* Indeterminate moving shine */}
            <div className="absolute top-0 left-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>
        </div>

        {/* Terminal Log Output */}
        <div className="border border-zinc-800 bg-zinc-950/50 p-6 min-h-[160px] flex flex-col justify-end font-mono text-[10px] sm:text-xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-4">
                <span className="text-zinc-500 uppercase">System_Log.txt</span>
                <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
                    <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
                </div>
            </div>
            <div className="space-y-2">
                {logs.map((log, idx) => (
                    <div key={idx} className="text-zinc-400 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <span className="text-zinc-600 mr-2">{(new Date()).toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}</span>
                        {log}
                    </div>
                ))}
                <div className="text-white animate-pulse">_</div>
            </div>
        </div>

      </div>
      
      {/* Footer Version */}
      <div className="absolute bottom-8 text-center w-full">
          <span className="font-mono text-[9px] text-zinc-700 uppercase tracking-[0.2em]">Laboratorio de Escucha v2.2.0</span>
      </div>
    </div>
  );
};

export default LoadingScreen;
