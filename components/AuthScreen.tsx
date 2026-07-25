
import React, { useState } from 'react';
import { Key, ArrowRight, ExternalLink, ShieldCheck, Lock } from 'lucide-react';

interface AuthScreenProps {
  onSuccess: () => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!inputKey.trim().startsWith('AIza')) {
      setError('Formato de clave inválido (debe empezar por AIza...)');
      return;
    }
    localStorage.setItem('gemini_api_key', inputKey.trim());
    onSuccess();
  };

  return (
    <div className="h-screen w-full bg-black flex flex-col md:flex-row font-sans overflow-hidden">
      
      {/* LEFT: SPANISH GUIDE */}
      <div className="w-full md:w-1/2 border-r border-zinc-900 p-8 md:p-12 flex flex-col justify-between bg-zinc-950">
        <div>
          <h1 className="font-display text-4xl font-bold uppercase mb-8 text-white tracking-tighter">
            Configuración <br/><span className="text-zinc-600">Inicial</span>
          </h1>
          
          <div className="space-y-8">
            <div className="border-l-2 border-white pl-6 py-1">
              <h3 className="font-mono text-xs uppercase tracking-widest text-white mb-2 font-bold">Paso 01: Google AI Studio</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Ingresa a <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-white underline hover:text-zinc-300">Google AI Studio</a> e inicia sesión con tu cuenta de Google.
              </p>
            </div>

            <div className="border-l-2 border-zinc-800 pl-6 py-1">
               <h3 className="font-mono text-xs uppercase tracking-widest text-white mb-2 font-bold">Paso 02: Crear Clave</h3>
               <p className="text-sm text-zinc-400 leading-relaxed">
                 Haz clic en el botón azul <strong>"Create API Key"</strong>. Si es tu primera vez, selecciona "Create API key in new project".
               </p>
            </div>

            <div className="border-l-2 border-zinc-800 pl-6 py-1">
               <h3 className="font-mono text-xs uppercase tracking-widest text-white mb-2 font-bold">Paso 03: Copiar y Pegar</h3>
               <p className="text-sm text-zinc-400 leading-relaxed">
                 Copia la clave generada (empieza por "AIza...") y pégala en el campo de la derecha.
               </p>
            </div>
          </div>
        </div>

        <div className="mt-12 md:mt-0 font-mono text-[10px] text-zinc-600 uppercase">
           * Tu clave se guarda localmente en tu navegador. No se envía a ningún servidor externo que no sea Google.
        </div>
      </div>

      {/* RIGHT: ENGLISH GUIDE & INPUT */}
      <div className="w-full md:w-1/2 bg-black p-8 md:p-12 flex flex-col justify-center relative">
        <div className="max-w-md mx-auto w-full">
            
            {/* English Quick Guide */}
            <div className="mb-12 opacity-60 hover:opacity-100 transition-opacity">
                 <h4 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 mb-4 border-b border-zinc-800 pb-2">English Quick Guide</h4>
                 <ol className="space-y-2 text-xs text-zinc-400 list-decimal pl-4 marker:text-zinc-600 font-sans">
                    <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-zinc-200 underline">Google AI Studio <ExternalLink size={10} className="inline"/></a>.</li>
                    <li>Click <strong>"Create API Key"</strong>.</li>
                    <li>Copy the key and paste it below.</li>
                 </ol>
            </div>

            <label className="block font-display text-2xl uppercase font-bold text-white mb-6">
                Ingresar API Key
            </label>

            <div className="relative group mb-6">
                <div className="absolute top-1/2 -translate-y-1/2 left-4 text-zinc-600 group-focus-within:text-white transition-colors">
                    <Key size={20} />
                </div>
                <input 
                    type="password" 
                    value={inputKey}
                    onChange={(e) => {
                        setInputKey(e.target.value);
                        setError('');
                    }}
                    placeholder="AIzaSy..."
                    className="w-full bg-zinc-900 border border-zinc-800 py-4 pl-12 pr-4 font-mono text-sm text-white outline-none focus:border-white focus:bg-zinc-800 transition-all placeholder:text-zinc-700"
                />
            </div>

            {error && (
                <div className="mb-6 p-3 bg-red-950/20 border border-red-900/50 text-red-500 text-xs font-mono flex items-center gap-2">
                    <ShieldCheck size={14} />
                    {error}
                </div>
            )}

            <button 
                onClick={handleSave}
                className="w-full py-4 bg-white text-black font-display text-xl uppercase font-bold tracking-tight hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 group"
            >
                <span>Acceder al Sistema</span>
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            
            <div className="mt-6 flex items-center justify-center gap-2 text-zinc-600">
                <Lock size={12} />
                <span className="font-mono text-[9px] uppercase tracking-widest">Secure Local Storage</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
