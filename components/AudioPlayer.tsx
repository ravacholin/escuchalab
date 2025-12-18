
import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Activity, Radio, Sparkles } from 'lucide-react';

interface AudioPlayerProps {
  speechSrc: string; // Base64 raw PCM
  recommendedSpeed?: number;
  topic?: string;
  ambientKeywords?: string; // AI-generated English keywords
  hideTrackInfo?: boolean; // Hide source metadata
}

// ----------------------------------------------------------------------
// HELPER: Convert raw PCM to WAV Blob
// ----------------------------------------------------------------------
function pcmToWavBlob(base64PCM: string, sampleRate = 24000): Blob {
  const binaryString = atob(base64PCM);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + len, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, len, true);

  return new Blob([wavHeader, bytes], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

const SPEEDS = [0.8, 1.0, 1.1, 1.25, 1.4, 1.5];

const AudioPlayer: React.FC<AudioPlayerProps> = ({ speechSrc, recommendedSpeed = 1.0, topic, ambientKeywords }) => {
  // Channel 1: Speech
  const speechRef = useRef<HTMLAudioElement | null>(null);

  // Channels: Synthetic Ambience (Web Audio API)
  const syntheticCtxRef = useRef<AudioContext | null>(null);
  const syntheticGainRef = useRef<GainNode | null>(null);
  const syntheticNodesRef = useRef<AudioNode[]>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speechUrl, setSpeechUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(recommendedSpeed);

  // Settings
  const [ambienceVolume, setAmbienceVolume] = useState(0.35);

  // Sync state with prop
  useEffect(() => {
    setPlaybackRate(recommendedSpeed);
  }, [recommendedSpeed]);

  // Load Speech Blob
  useEffect(() => {
    try {
      if (!speechSrc) return;
      const blob = pcmToWavBlob(speechSrc);
      const url = URL.createObjectURL(blob);
      setSpeechUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (e) {
      console.error(e);
      setError("ERR_DECODE");
    }
  }, [speechSrc]);

  // Apply playback rate
  useEffect(() => {
    if (speechRef.current) {
      speechRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, speechUrl]);

  // Apply Ambience Volume
  useEffect(() => {
    if (syntheticGainRef.current) {
      syntheticGainRef.current.gain.setTargetAtTime(ambienceVolume, syntheticCtxRef.current?.currentTime || 0, 0.1);
    }
  }, [ambienceVolume]);

  // Cleanup Web Audio on unmount
  useEffect(() => {
    return () => {
      stopSyntheticAmbience();
      if (syntheticCtxRef.current && syntheticCtxRef.current.state !== 'closed') {
        syntheticCtxRef.current.close();
      }
    };
  }, []);

  // --- SEMANTIC ENVIRONMENT MAPPING ---
  const getEnvironmentProfile = (topic?: string, query?: string) => {
    const t = (topic || "").toLowerCase();
    const q = (query || "").toLowerCase();
    const combined = `${t} ${q}`;

    if (combined.match(/\b(city|traffic|street|car|bus|train|metro|road|avenida|calle|tráfico|autopista|estación|andén|transporte)\b/)) return "CITY";
    if (combined.match(/\b(café|restaurant|bar|pub|comida|cena|almuerzo|bistro|mercado|supermarket|tienda|ventas|shopping)\b/)) return "CAFE";
    if (combined.match(/\b(office|work|trabajo|oficina|bank|hospital|library|school|clase|aula|reunión|negocios|médico)\b/)) return "OFFICE";
    if (combined.match(/\b(nature|park|forest|beach|ocean|waves|rain|lluvia|parque|jardín|bosque|campo|viento|trueno|mar)\b/)) return "NATURE";
    return "ROOM";
  };

  // --- SYNTHETIC AMBIENCE GENERATOR ---
  const initSyntheticAmbience = () => {
    try {
      if (!syntheticCtxRef.current) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        syntheticCtxRef.current = new AudioContextClass();
        syntheticGainRef.current = syntheticCtxRef.current!.createGain();
        syntheticGainRef.current!.connect(syntheticCtxRef.current!.destination);
      }

      const ctx = syntheticCtxRef.current!;
      if (ctx.state === 'suspended') ctx.resume();

      const masterGain = syntheticGainRef.current!;
      const nodes: AudioNode[] = [];
      const profile = getEnvironmentProfile(topic, ambientKeywords);

      // 1. BROWN NOISE (Foundation Depth)
      const brownBuffer = ctx.createBuffer(1, 4 * ctx.sampleRate, ctx.sampleRate);
      const brownOut = brownBuffer.getChannelData(0);
      let brownLast = 0;
      for (let i = 0; i < brownBuffer.length; i++) {
        const white = Math.random() * 2 - 1;
        brownLast = (brownLast + (0.02 * white)) / 1.02;
        brownOut[i] = brownLast * 3.5;
      }
      const brownSource = ctx.createBufferSource();
      brownSource.buffer = brownBuffer;
      brownSource.loop = true;
      const bFilter = ctx.createBiquadFilter();
      bFilter.type = "lowpass";
      bFilter.frequency.value = profile === "CITY" ? 220 : 130;
      const bGain = ctx.createGain();
      bGain.gain.value = profile === "CITY" ? 0.8 : 0.5;
      brownSource.connect(bFilter);
      bFilter.connect(bGain);
      bGain.connect(masterGain);
      brownSource.start();
      nodes.push(brownSource, bFilter, bGain);

      // 2. PINK NOISE (Environment Air)
      const pinkBuffer = ctx.createBuffer(1, 4 * ctx.sampleRate, ctx.sampleRate);
      const pinkOut = pinkBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < pinkBuffer.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852; b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
        pinkOut[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; pinkOut[i] *= 0.11; b6 = white * 0.115926;
      }
      const pinkSource = ctx.createBufferSource();
      pinkSource.buffer = pinkBuffer;
      pinkSource.loop = true;
      const pFilter = ctx.createBiquadFilter();
      pFilter.type = "lowpass";
      pFilter.frequency.value = profile === "NATURE" ? 4500 : 2500;
      const pLFO = ctx.createOscillator();
      pLFO.type = "sine";
      pLFO.frequency.value = profile === "CITY" ? 0.5 : 0.1;
      const pLFOGain = ctx.createGain();
      pLFOGain.gain.value = 0.25;
      pLFO.connect(pLFOGain);
      const pGain = ctx.createGain();
      pGain.gain.value = 0.4;
      pLFOGain.connect(pGain.gain);
      pinkSource.connect(pFilter);
      pFilter.connect(pGain);
      pGain.connect(masterGain);
      pinkSource.start();
      pLFO.start();
      nodes.push(pinkSource, pFilter, pGain, pLFO, pLFOGain);

      // 3. TEXTURE LAYER (Click/Dust/Rustle)
      const textBuffer = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
      const textOut = textBuffer.getChannelData(0);
      const d = profile === "NATURE" ? 0.998 : (profile === "CAFE" ? 0.9996 : 0.9998);
      for (let i = 0; i < textBuffer.length; i++) {
        if (Math.random() > d) textOut[i] = (Math.random() * 2 - 1) * 0.4;
        else textOut[i] = 0;
      }
      const tSource = ctx.createBufferSource();
      tSource.buffer = textBuffer;
      tSource.loop = true;
      const tFilter = ctx.createBiquadFilter();
      tFilter.type = profile === "NATURE" ? "lowpass" : "bandpass";
      tFilter.frequency.value = profile === "NATURE" ? 2800 : 5500;
      const tGain = ctx.createGain();
      tGain.gain.value = 0.15;
      tSource.connect(tFilter);
      tFilter.connect(tGain);
      tGain.connect(masterGain);
      tSource.start();
      nodes.push(tSource, tFilter, tGain);

      // 4. THEMATIC LIFE PULSES
      const spawn = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const now = ctx.currentTime;
        let f = 400, gv = 0.015, dur = 0.5;
        switch (profile) {
          case "CITY": o.type = "sawtooth"; f = 200 + Math.random() * 400; dur = 2.0;
            o.frequency.exponentialRampToValueAtTime(f * 1.05, now + dur); break;
          case "CAFE": o.type = "triangle"; f = 2200 + Math.random() * 1000; gv = 0.005; dur = 0.1; break;
          case "OFFICE": o.type = "sine"; f = 1000 + Math.random() * 500; gv = 0.006; dur = 0.05; break;
          case "NATURE": o.type = "sine"; f = 1500 + Math.random() * 2500; gv = 0.004; dur = 0.3;
            o.frequency.exponentialRampToValueAtTime(f * 0.8, now + dur); break;
        }
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(gv, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o.connect(g); g.connect(masterGain);
        o.start(now); o.stop(now + dur + 0.1);
        const next = (profile === "OFFICE" ? 500 : 4000) + Math.random() * 9000;
        setTimeout(spawn, next);
      };
      setTimeout(spawn, 2000);

      syntheticNodesRef.current = nodes;
      masterGain.gain.setValueAtTime(0, ctx.currentTime);
      masterGain.gain.linearRampToValueAtTime(ambienceVolume, ctx.currentTime + 3);
    } catch (e) { console.error(e); }
  };

  const stopSyntheticAmbience = () => {
    syntheticNodesRef.current.forEach(n => {
      try { if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) n.stop(); n.disconnect(); } catch (e) { }
    });
    syntheticNodesRef.current = [];
  };

  // --- DIALOGUE SPATIALIZATION ---
  const setupSpeechProcessing = (audioElement: HTMLAudioElement) => {
    try {
      if (!syntheticCtxRef.current) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        syntheticCtxRef.current = new AudioContextClass();
      }
      const ctx = syntheticCtxRef.current!;
      const source = ctx.createMediaElementSource(audioElement);
      const profile = getEnvironmentProfile(topic, ambientKeywords);

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-18, ctx.currentTime);
      comp.ratio.setValueAtTime(4, ctx.currentTime);

      const rGain = ctx.createGain();
      rGain.gain.value = profile === "CAFE" ? 0.22 : (profile === "ROOM" ? 0.16 : 0.06);

      const dly = ctx.createDelay();
      dly.delayTime.value = profile === "CAFE" ? 0.045 : 0.032;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = profile === "OFFICE" ? 2200 : 1300;

      source.connect(comp); comp.connect(ctx.destination);
      comp.connect(dly); dly.connect(f); f.connect(fb); fb.connect(dly); f.connect(rGain); rGain.connect(ctx.destination);
      return { comp, rGain, source };
    } catch (e) { return null; }
  };

  const onTimeUpdate = () => { if (speechRef.current) setCurrentTime(speechRef.current.currentTime); };
  const onLoadedMetadata = () => {
    if (speechRef.current) {
      setDuration(speechRef.current.duration);
      speechRef.current.playbackRate = playbackRate;
      setupSpeechProcessing(speechRef.current);
    }
  };
  const onEnded = () => { setIsPlaying(false); setCurrentTime(0); fadeOut(); };

  const fadeOut = () => {
    if (syntheticGainRef.current && syntheticCtxRef.current) {
      const now = syntheticCtxRef.current.currentTime;
      syntheticGainRef.current.gain.cancelScheduledValues(now);
      syntheticGainRef.current.gain.linearRampToValueAtTime(0, now + 2);
      setTimeout(() => stopSyntheticAmbience(), 2100);
    }
  };

  const togglePlay = () => {
    if (!speechRef.current) return;
    if (isPlaying) { speechRef.current.pause(); fadeOut(); }
    else { speechRef.current.play(); initSyntheticAmbience(); }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!speechRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const nt = percent * duration;
    speechRef.current.currentTime = nt; setCurrentTime(nt);
  };

  const reset = () => {
    if (!speechRef.current) return;
    speechRef.current.currentTime = 0; setCurrentTime(0);
    speechRef.current.play(); stopSyntheticAmbience(); initSyntheticAmbience();
    setIsPlaying(true);
  };

  const formatTime = (t: number) => {
    if (isNaN(t)) return "00:00";
    const m = Math.floor(t / 60); const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (error) return (
    <div className="w-full h-24 border border-red-900 bg-red-950/10 flex items-center justify-center font-mono text-red-500 text-xs uppercase">
      Falló Sistema // {error}
    </div>
  );

  const env = getEnvironmentProfile(topic, ambientKeywords);

  return (
    <div className="border border-zinc-800 bg-black relative">
      {speechUrl && <audio ref={speechRef} src={speechUrl} onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onEnded={onEnded} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />}

      <div className="grid grid-cols-[1fr_auto] border-b border-zinc-800">
        <div className="flex flex-col">
          <div className="h-12 bg-zinc-950 relative cursor-pointer group border-b border-zinc-800 overflow-hidden" onClick={handleSeek}>
            <div className="h-full bg-white absolute top-0 left-0 pointer-events-none transition-all duration-75 linear mix-blend-difference" style={{ width: `${(currentTime / duration) * 100}%` }} />
            <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
              <span className="font-mono text-xs text-zinc-500 group-hover:text-white transition-colors">{formatTime(currentTime)}</span>
              <span className="font-mono text-xs text-zinc-500 group-hover:text-white transition-colors">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-black">
            <div className="flex items-center gap-2">
              {isPlaying ? <Sparkles size={14} className="text-zinc-300 animate-pulse" /> : <Activity size={14} className="text-zinc-500" />}
              <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-300">Ambiente: {env}</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 group">
                <Radio size={12} className="text-zinc-300" />
                <input type="range" min="0" max="1.0" step="0.05" value={ambienceVolume} onChange={(e) => setAmbienceVolume(parseFloat(e.target.value))} className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" title="Volumen Ambiente" />
              </div>
              <div className="w-[1px] h-3 bg-zinc-800" />
              <span className="font-mono text-[10px] text-white font-bold">{playbackRate}x</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col border-l border-zinc-800 w-16">
          <button
            onClick={() => {
              const ci = SPEEDS.indexOf(playbackRate);
              const ni = (ci + 1) % SPEEDS.length;
              setPlaybackRate(SPEEDS[ni]);
            }}
            className="flex-1 border-b border-zinc-800 flex flex-col items-center justify-center hover:bg-white hover:text-black transition-colors group"
          >
            <span className="font-mono text-[10px] font-bold block">{playbackRate}x</span>
            <span className="text-[8px] uppercase text-zinc-600 group-hover:text-black">Vel</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2">
        <button onClick={togglePlay} disabled={!speechUrl} className="h-16 flex items-center justify-center gap-2 border-r border-zinc-800 hover:bg-white hover:text-black transition-colors disabled:opacity-50 group">
          {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current" />}
          <span className="font-display font-bold uppercase tracking-wider text-sm">{isPlaying ? 'Parar' : 'Repr.'}</span>
        </button>
        <button onClick={reset} disabled={!speechUrl} className="h-16 flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-colors disabled:opacity-50 group">
          <RotateCcw size={20} className="group-hover:rotate-[-45deg] transition-transform" />
          <span className="font-display font-bold uppercase tracking-wider text-sm">Reset</span>
        </button>
      </div>
    </div>
  );
};

export default AudioPlayer;
