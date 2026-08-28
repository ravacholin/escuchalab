
import React, { useState } from 'react';
import { Key, ArrowRight, ExternalLink, Lock, AlertTriangle } from 'lucide-react';

interface AuthScreenProps {
  onSuccess: () => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!inputKey.trim().startsWith('AIza')) {
      setError('Formato de clave inválido (debe empezar por «AIza…»).');
      return;
    }
    localStorage.setItem('gemini_api_key', inputKey.trim());
    onSuccess();
  };

  const steps = [
    {
      k: 'Paso 01 · Google AI Studio',
      hot: true,
      body: (
        <>Entrá a <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-fg underline decoration-line underline-offset-2 hover:decoration-fg">Google AI Studio <ExternalLink size={11} className="inline -mt-0.5" /></a> con tu cuenta de Google.</>
      ),
    },
    {
      k: 'Paso 02 · Crear clave',
      hot: false,
      body: <>Pulsá <strong className="text-fg font-medium">«Create API Key»</strong>. Si es tu primera vez, elegí «Create API key in new project».</>,
    },
    {
      k: 'Paso 03 · Copiar y pegar',
      hot: false,
      body: <>Copiá la clave generada (empieza por «AIza…») y pegala en el campo de la derecha.</>,
    },
  ];

  return (
    <div className="min-h-[100dvh] w-full bg-ink flex flex-col md:flex-row font-sans">

      {/* LEFT — guide (desktop) */}
      <div className="hidden md:flex md:w-1/2 border-r border-line p-12 flex-col justify-center gap-9 bg-gradient-to-b from-[#0d1116] to-[#0a0d10]">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-fg leading-[1.05]">
            Configuración<br /><span className="text-faint">inicial</span>
          </h1>
          <p className="mt-4 text-muted max-w-sm leading-relaxed">
            Necesitás una clave gratuita de Google Gemini para generar las lecciones. Toma un minuto.
          </p>
        </div>

        <div className="flex flex-col gap-6 max-w-md">
          {steps.map((s) => (
            <div key={s.k} className={`pl-5 border-l-2 ${s.hot ? 'border-accent' : 'border-line'}`}>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted mb-2">{s.k}</div>
              <p className="text-sm text-muted leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 text-faint">
          <Lock size={13} />
          <span className="text-xs">Tu clave se guarda sólo en este navegador. No se envía a ningún servidor que no sea Google.</span>
        </div>
      </div>

      {/* RIGHT — key input */}
      <div className="w-full md:w-1/2 flex flex-col justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md mx-auto">

          {/* Mobile brand */}
          <div className="md:hidden mb-10 text-center">
            <div className="font-display font-bold text-3xl tracking-tight">Escucha<span className="text-faint">LAB</span></div>
            <p className="mt-2 text-sm text-muted">Pegá tu clave de Google Gemini para empezar.</p>
          </div>

          {/* English quick guide */}
          <div className="mb-8 opacity-70 hover:opacity-100 transition-opacity">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint mb-3 pb-2 border-b border-line-soft">English quick guide</h4>
            <ol className="space-y-1.5 text-xs text-muted list-decimal pl-4 marker:text-faint">
              <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-fg underline decoration-line underline-offset-2">Google AI Studio</a>.</li>
              <li>Click <strong className="text-fg font-medium">“Create API Key”</strong>.</li>
              <li>Copy the key and paste it below.</li>
            </ol>
          </div>

          <label className="block font-display text-2xl font-semibold text-fg mb-5">Ingresar API Key</label>

          <div className="relative group mb-4">
            <div className="absolute top-1/2 -translate-y-1/2 left-4 text-faint group-focus-within:text-fg transition-colors">
              <Key size={18} />
            </div>
            <input
              type="password"
              value={inputKey}
              onChange={(e) => { setInputKey(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="AIzaSy…"
              className="w-full bg-panel border border-line rounded-xl py-4 pl-12 pr-4 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-white/10 transition-all placeholder:text-faint"
            />
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-panel-2 border border-line text-muted text-xs font-mono flex items-center gap-2">
              <AlertTriangle size={14} className="text-fg flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={handleSave}
            className="w-full py-4 rounded-2xl bg-accent text-ink font-display text-lg font-semibold hover:brightness-105 active:brightness-95 transition-all flex items-center justify-center gap-3 group shadow-[0_10px_30px_-12px_rgba(255,255,255,0.4)]"
          >
            <span>Acceder al sistema</span>
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Mobile compact steps */}
          <div className="md:hidden mt-10 flex flex-col gap-4">
            {steps.map((s) => (
              <div key={s.k} className={`pl-4 border-l-2 ${s.hot ? 'border-accent' : 'border-line'}`}>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">{s.k}</div>
                <p className="text-xs text-muted leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-7 flex items-center justify-center gap-2 text-faint">
            <Lock size={12} />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">Almacenamiento local seguro</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
