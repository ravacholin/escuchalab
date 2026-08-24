import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Activity, Radio, Sparkles, Volume2, VolumeX, Download } from 'lucide-react';
import { resolveAmbienceScene } from '../services/ambiencePresets';
import {
  AmbienceEngine,
  DEFAULT_AMBIENCE_DUCKING,
  DEFAULT_AMBIENCE_INTENSITY,
  DEFAULT_AMBIENCE_VOLUME,
} from '../services/ambienceEngine';
import { TextType } from '../types';

interface AudioPlayerProps {
  speechSrc: string; // Base64 raw PCM
  recommendedSpeed?: number;
  topic?: string;
  ambientKeywords?: string; // AI-generated English keywords
  explicitQuery?: string; // Back-compat: older prop name from App.tsx
  scenarioLabel?: string;
  scenarioActionLabel?: string;
  /** The lesson's format. RadioNews/Podcast/Monologue are recorded in a studio, not
   *  in the place they are about — without this they all fell through to the
   *  emptiest available ambience. */
  textType?: TextType;
  /** A scene id the model named, if it produced a valid one. */
  sceneHint?: string;
  hideTrackInfo?: boolean; // Hide source metadata
  /** Base filename (sin extensión) para descargar el audio de la lección. */
  downloadName?: string;
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

// ----------------------------------------------------------------------
// Ambience preferences
//
// App.tsx remounts this component on every lesson (`key={lessonPlan.title}`), so
// plain state meant volume/intensity/ducking silently reset to defaults each time —
// a user who turned the ambience down had to do it again for every lesson.
// ----------------------------------------------------------------------
const PREFS_KEY = 'ambience_prefs_v1';

interface AmbiencePrefs {
  volume: number;
  intensity: number;
  ducking: number;
  muted: boolean;
}

const DEFAULT_PREFS: AmbiencePrefs = {
  volume: DEFAULT_AMBIENCE_VOLUME,
  intensity: DEFAULT_AMBIENCE_INTENSITY,
  ducking: DEFAULT_AMBIENCE_DUCKING,
  muted: false,
};

function loadPrefs(): AmbiencePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AmbiencePrefs>;
    const num = (v: unknown, fallback: number) =>
      typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
    return {
      volume: num(parsed.volume, DEFAULT_PREFS.volume),
      intensity: num(parsed.intensity, DEFAULT_PREFS.intensity),
      ducking: num(parsed.ducking, DEFAULT_PREFS.ducking),
      muted: parsed.muted === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: AmbiencePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota — preferences just won't persist */
  }
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  speechSrc,
  recommendedSpeed = 1.0,
  topic,
  ambientKeywords,
  explicitQuery,
  scenarioLabel,
  scenarioActionLabel,
  textType,
  sceneHint,
  downloadName,
}) => {
  const speechRef = useRef<HTMLAudioElement | null>(null);

  // Web Audio. The context is created lazily on the first user gesture so it is
  // never born suspended (which would mute the <audio> element once it is routed
  // through createMediaElementSource).
  const ctxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<AmbienceEngine | null>(null);
  const speechAnalyserRef = useRef<AnalyserNode | null>(null);
  const speechSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const duckingRafRef = useRef<number | null>(null);
  // `null` = not probed yet. When false we degrade to a plain <audio> element:
  // speech still plays, there is no ambience, and nothing throws.
  const webAudioSupportedRef = useRef<boolean | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [stemsLoaded, setStemsLoaded] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speechUrl, setSpeechUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(recommendedSpeed);

  const [prefs, setPrefs] = useState<AmbiencePrefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
    savePrefs(prefs);
  }, [prefs]);

  const effectiveVolume = prefs.muted ? 0 : prefs.volume;

  const keywords = ambientKeywords ?? explicitQuery;
  const scene = useMemo(
    () => resolveAmbienceScene({ scenarioLabel, scenarioActionLabel, textType, topic, keywords, sceneHint }),
    [scenarioLabel, scenarioActionLabel, textType, topic, keywords, sceneHint],
  );

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
      return () => URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setError('ERR_DECODE');
    }
  }, [speechSrc]);

  useEffect(() => {
    if (speechRef.current) speechRef.current.playbackRate = playbackRate;
  }, [playbackRate, speechUrl]);

  // Live volume / ducking updates without rebuilding the graph.
  useEffect(() => {
    engineRef.current?.setVolume(effectiveVolume);
  }, [effectiveVolume]);

  useEffect(() => {
    engineRef.current?.setDucking(prefs.ducking);
  }, [prefs.ducking]);

  useEffect(() => {
    engineRef.current?.setIntensity(prefs.intensity);
  }, [prefs.intensity]);

  // --- AUDIO GRAPH LIFECYCLE ---------------------------------------------
  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (webAudioSupportedRef.current === false) return null;
    try {
      if (!ctxRef.current) {
        const AudioContextClass =
          (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) {
          webAudioSupportedRef.current = false;
          return null;
        }
        const ctx = new AudioContextClass();
        ctxRef.current = ctx;
        webAudioSupportedRef.current = true;

        // Self-heal if the browser re-suspends us (tab switch, audio focus loss).
        ctx.onstatechange = () => {
          if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
        };
      }
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return ctx;
    } catch (e) {
      console.warn('[Audio] Web Audio unavailable; playing speech without ambience.', e);
      webAudioSupportedRef.current = false;
      return null;
    }
  }, []);

  const stopAmbience = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    if (duckingRafRef.current !== null) {
      cancelAnimationFrame(duckingRafRef.current);
      duckingRafRef.current = null;
    }
  }, []);

  const startAmbience = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      stopAmbience();
      setStemsLoaded(0);
      const engine = new AmbienceEngine(
        ctx,
        ctx.destination,
        scene,
        // Per-playback salt: the same scenario never sounds identical twice.
        `${Math.floor(Math.random() * 0xffffffff)}`,
        {
          volume: prefsRef.current.muted ? 0 : prefsRef.current.volume,
          intensity: prefsRef.current.intensity,
          onStemsReady: (loaded) => setStemsLoaded(loaded),
        },
      );
      engine.setDucking(prefsRef.current.ducking);
      engine.start(prefsRef.current.muted ? 0 : prefsRef.current.volume);
      engineRef.current = engine;
    } catch (e) {
      console.warn('[Ambience] Init failed; continuing without ambience.', e);
    }
  }, [scene, stopAmbience]);

  // --- DIALOGUE PROCESSING ------------------------------------------------
  // Routes speech through the AudioContext for compression and a touch of the
  // scene's room, and taps an analyser to drive ducking.
  const setupSpeechProcessing = useCallback((audioElement: HTMLAudioElement) => {
    try {
      const ctx = ctxRef.current;
      if (!ctx) return; // Web Audio unavailable — the element plays natively.
      if (speechSourceRef.current) return; // createMediaElementSource is one-shot.

      const source = ctx.createMediaElementSource(audioElement);
      speechSourceRef.current = source;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-18, ctx.currentTime);
      comp.ratio.setValueAtTime(4, ctx.currentTime);

      // A small amount of the scene's space on the voice, so the speaker sounds like
      // they are in the room rather than pasted over it. Outdoor scenes get almost
      // none — that is the point of being outdoors.
      const wet = ctx.createGain();
      wet.gain.value = scene.recipe.room.size === 'outdoor' ? 0.04 : Math.min(0.18, scene.recipe.room.wet);
      const dly = ctx.createDelay(0.2);
      dly.delayTime.value = scene.recipe.room.size === 'hall' ? 0.055 : 0.032;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1800;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      speechAnalyserRef.current = analyser;
      const mute = ctx.createGain();
      mute.gain.value = 0;

      source.connect(comp);
      comp.connect(ctx.destination);
      comp.connect(dly);
      dly.connect(tone);
      tone.connect(fb);
      fb.connect(dly);
      tone.connect(wet);
      wet.connect(ctx.destination);

      comp.connect(analyser);
      analyser.connect(mute);
      mute.connect(ctx.destination);
    } catch (e) {
      console.warn('[Audio] Speech processing unavailable; playing dry.', e);
    }
  }, [scene]);

  const startDuckingLoop = useCallback(() => {
    if (duckingRafRef.current !== null) return;
    const analyser = speechAnalyserRef.current;
    if (!analyser) return;
    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      const engine = engineRef.current;
      if (!engine) {
        duckingRafRef.current = null;
        return;
      }
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      // Map the speech RMS onto 0..1 above a small noise gate.
      engine.applySpeechLevel(Math.max(0, Math.min(1, (rms - 0.02) / 0.22)));
      duckingRafRef.current = requestAnimationFrame(tick);
    };
    duckingRafRef.current = requestAnimationFrame(tick);
  }, []);

  // --- TRANSPORT ----------------------------------------------------------
  const startPlayback = useCallback(() => {
    if (!speechRef.current) return;
    const ctx = ensureAudioContext();
    if (ctx) setupSpeechProcessing(speechRef.current);
    const p = speechRef.current.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    startAmbience();
    startDuckingLoop();
  }, [ensureAudioContext, setupSpeechProcessing, startAmbience, startDuckingLoop]);

  const togglePlay = () => {
    if (!speechRef.current) return;
    if (isPlaying) {
      speechRef.current.pause();
      stopAmbience();
    } else {
      startPlayback();
    }
    setIsPlaying(!isPlaying);
  };

  const onTimeUpdate = () => {
    if (speechRef.current) setCurrentTime(speechRef.current.currentTime);
  };

  const onLoadedMetadata = () => {
    if (speechRef.current) {
      setDuration(speechRef.current.duration);
      speechRef.current.playbackRate = playbackRate;
    }
  };

  const onEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    stopAmbience();
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!speechRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const nt = percent * duration;
    speechRef.current.currentTime = nt;
    setCurrentTime(nt);
  };

  const reset = () => {
    if (!speechRef.current) return;
    speechRef.current.currentTime = 0;
    setCurrentTime(0);
    startPlayback();
    setIsPlaying(true);
  };

  // Descarga el audio hablado de la lección como WAV. Reutiliza el mismo blob
  // que ya se reproduce (`speechUrl`); es sólo la voz, sin el ambiente, que se
  // mezcla en vivo en el navegador y no forma parte del archivo generado.
  const sanitizeFilename = (name: string) =>
    (name || 'escuchalab')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'escuchalab';

  const handleDownload = () => {
    if (!speechUrl) return;
    try {
      const a = document.createElement('a');
      a.href = speechUrl;
      a.download = `${sanitizeFilename(downloadName || 'escuchalab')}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.warn('[Audio] Descarga fallida.', e);
    }
  };

  const formatTime = (t: number) => {
    if (isNaN(t)) return '00:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Rebuild ambience only when the scene itself changes. Intensity used to be in this
  // dependency list, because the rate scale was computed once in the constructor and
  // there was no other way to update it — so every nudge of the slider tore the engine
  // down and rebuilt it, restarting every stem from a new random offset. That is an
  // audible jump, and it was happening on a control whose whole job is to be tweaked.
  // `setIntensity()` now applies live, like volume and ducking.
  useEffect(() => {
    if (!isPlaying) return;
    startAmbience();
    startDuckingLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      stopAmbience();
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="w-full h-24 border border-red-900 bg-red-950/10 flex items-center justify-center font-mono text-red-500 text-xs uppercase">
        Falló Sistema // {error}
      </div>
    );
  }

  const totalStems = scene.recipe.stems.length;
  const setPref = (patch: Partial<AmbiencePrefs>) => setPrefs((p) => ({ ...p, ...patch }));

  return (
    <div className="border border-zinc-800 bg-black relative">
      {speechUrl && (
        <audio
          ref={speechRef}
          src={speechUrl}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      <div className="grid grid-cols-[1fr_auto] border-b border-zinc-800">
        <div className="flex flex-col">
          <div
            className="h-12 bg-zinc-950 relative cursor-pointer group border-b border-zinc-800 overflow-hidden"
            onClick={handleSeek}
          >
            <div
              className="h-full bg-white absolute top-0 left-0 pointer-events-none transition-all duration-75 linear mix-blend-difference"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
              <span className="font-mono text-xs text-zinc-500 group-hover:text-white transition-colors">{formatTime(currentTime)}</span>
              <span className="font-mono text-xs text-zinc-500 group-hover:text-white transition-colors">{formatTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-black">
            <div className="flex items-center gap-2">
              {isPlaying ? <Sparkles size={14} className="text-zinc-300 animate-pulse" /> : <Activity size={14} className="text-zinc-500" />}
              <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-300">
                Ambiente: {scene.recipe.label}
                {/* Shown even at 0: a silent bed used to be indistinguishable from a
                    quiet one, which is how "no stem ever loads" went unnoticed. */}
                {isPlaying ? ` · ${stemsLoaded}/${totalStems} capas` : ''}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 group">
                <button
                  onClick={() => setPref({ muted: !prefs.muted })}
                  className="text-zinc-300 hover:text-white transition-colors"
                  title={prefs.muted ? 'Activar ambiente' : 'Silenciar ambiente'}
                  aria-label={prefs.muted ? 'Activar ambiente' : 'Silenciar ambiente'}
                >
                  {prefs.muted ? <VolumeX size={12} className="text-zinc-600" /> : <Radio size={12} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1.0"
                  step="0.05"
                  value={prefs.volume}
                  onChange={(e) => setPref({ volume: parseFloat(e.target.value), muted: false })}
                  className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-40"
                  disabled={prefs.muted}
                  title="Volumen Ambiente"
                />
              </div>
              <div className="flex items-center gap-2 group">
                <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Int</span>
                <input
                  type="range"
                  min="0"
                  max="1.0"
                  step="0.05"
                  value={prefs.intensity}
                  onChange={(e) => setPref({ intensity: parseFloat(e.target.value) })}
                  className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  title="Intensidad Ambiente (frecuencia y nivel de los eventos)"
                />
              </div>
              <div className="flex items-center gap-2 group">
                <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Duck</span>
                <input
                  type="range"
                  min="0"
                  max="1.0"
                  step="0.05"
                  value={prefs.ducking}
                  onChange={(e) => setPref({ ducking: parseFloat(e.target.value) })}
                  className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  title="Ducking (reduce ambiente cuando hay voz)"
                />
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
          <button
            onClick={handleDownload}
            disabled={!speechUrl}
            title="Descargar audio (WAV, solo voz)"
            aria-label="Descargar audio"
            className="flex-1 flex flex-col items-center justify-center hover:bg-white hover:text-black transition-colors disabled:opacity-40 group"
          >
            <Download size={14} className="mb-0.5" />
            <span className="text-[8px] uppercase text-zinc-600 group-hover:text-black">WAV</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2">
        <button
          onClick={togglePlay}
          disabled={!speechUrl}
          className="h-16 flex items-center justify-center gap-2 border-r border-zinc-800 hover:bg-white hover:text-black transition-colors disabled:opacity-50 group"
        >
          {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current" />}
          <span className="font-display font-bold uppercase tracking-wider text-sm">{isPlaying ? 'Parar' : 'Repr.'}</span>
        </button>
        <button
          onClick={reset}
          disabled={!speechUrl}
          className="h-16 flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-colors disabled:opacity-50 group"
        >
          <RotateCcw size={20} className="group-hover:rotate-[-45deg] transition-transform" />
          <span className="font-display font-bold uppercase tracking-wider text-sm">Reset</span>
        </button>
      </div>
    </div>
  );
};

export default AudioPlayer;
