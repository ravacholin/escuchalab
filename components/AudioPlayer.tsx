import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Activity, Radio, Sparkles, Volume2, VolumeX, Download, SlidersHorizontal } from 'lucide-react';
import { resolveAmbienceScene, type ResolvedAmbience } from '../services/ambiencePresets';
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
  hideTrackInfo,
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
  const [showMixer, setShowMixer] = useState(false);

  // Decorative static waveform for the seek bar (stable across renders).
  const waveform = useMemo(
    () => Array.from({ length: 56 }, (_, i) => 24 + Math.round(60 * Math.abs(Math.sin(i * 0.7)) * (0.55 + 0.45 * ((i * 37) % 13) / 13))),
    []
  );

  const [prefs, setPrefs] = useState<AmbiencePrefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
    savePrefs(prefs);
  }, [prefs]);

  const effectiveVolume = prefs.muted ? 0 : prefs.volume;

  const keywords = ambientKeywords ?? explicitQuery;
  // El tipo se ancla a mano: sin esto `useMemo` infería `any` para `scene`, así
  // que `scene.recipe.<campo>` no se comprobaba contra `SceneRecipe`. Fue justo
  // ese agujero el que dejó pasar la lectura de `recipe.stems`/`recipe.room`
  // (campos del motor viejo) tras reconstruir el ambiente: compilaba sin quejarse
  // y reventaba en tiempo de render. Con el tipo puesto, un cambio de forma de la
  // receta se detecta al compilar, no con la pantalla en negro.
  const scene: ResolvedAmbience = useMemo(
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
      //
      // The rebuilt ambience has no synthetic `room` on the recipe any more (the
      // real recordings carry their own space), so the voice's room is derived
      // from which beds the scene uses: an outdoor recording means outdoors, the
      // museum-`hall` bed means a long, boomy space.
      const bedIds = scene.recipe.beds.map((l) => l.bed);
      const isOutdoor = bedIds.some((b) => b === 'street' || b === 'plaza' || b === 'park' || b === 'rain' || b === 'forest');
      const isHall = bedIds.includes('hall');
      const wet = ctx.createGain();
      wet.gain.value = isOutdoor ? 0.04 : 0.12;
      const dly = ctx.createDelay(0.2);
      dly.delayTime.value = isHall ? 0.055 : 0.032;
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
      <div className="w-full h-20 bg-panel-2 flex items-center justify-center gap-2 font-mono text-muted text-xs px-4 text-center">
        <Activity size={14} className="text-faint" /> Falló el reproductor · {error}
      </div>
    );
  }

  // El motor reconstruido sobre grabaciones reales expone las camas en
  // `recipe.beds` (antes eran `recipe.stems` sintéticos). Leer el campo viejo
  // aquí, en el cuerpo del render, lanzaba `Cannot read properties of undefined
  // (reading 'length')` al montar el reproductor y, sin error boundary, dejaba
  // la app en negro justo al pasar a la pantalla que reproduce la lección. El
  // total de capas es el número de camas: es lo que el motor cuenta como
  // `layerCount` al reportar `onStemsReady`.
  const totalStems = scene.recipe.beds.length;
  const setPref = (patch: Partial<AmbiencePrefs>) => setPrefs((p) => ({ ...p, ...patch }));

  return (
    <div className="bg-panel">
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

      {/* Seek / waveform */}
      <div className="px-4 pt-3.5">
        <div onClick={handleSeek} className="relative h-9 cursor-pointer group" role="slider" aria-label="Barra de reproducción" aria-valuenow={Math.round(currentTime)} aria-valuemax={Math.round(duration) || 0}>
          <div className="absolute inset-0 flex items-center gap-[2px]">
            {waveform.map((h, i) => {
              const ratio = duration ? currentTime / duration : 0;
              const played = (i + 0.5) / waveform.length <= ratio;
              return (
                <span
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${played ? 'bg-fg' : 'bg-line group-hover:bg-faint'}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex justify-between mt-1.5 font-mono text-[11px] text-muted tabular-nums">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-1">
        <button
          onClick={togglePlay}
          disabled={!speechUrl}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          className="flex-none w-12 h-12 rounded-full bg-accent text-ink grid place-items-center hover:brightness-105 active:brightness-95 disabled:opacity-50 transition"
        >
          {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current translate-x-[1px]" />}
        </button>

        {!hideTrackInfo ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
              {isPlaying ? <Sparkles size={13} className="text-muted flex-none animate-pulse" /> : <Activity size={13} className="text-faint flex-none" />}
              <span className="truncate">{scene.recipe.label}</span>
            </div>
            {/* Shown even at 0: a silent bed used to be indistinguishable from a
                quiet one, which is how "no stem ever loads" went unnoticed. */}
            <div className="font-mono text-[11px] text-faint mt-0.5 tabular-nums">
              Ambiente · {stemsLoaded}/{totalStems} capas
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <button
          onClick={reset}
          disabled={!speechUrl}
          title="Reiniciar"
          aria-label="Reiniciar"
          className="flex-none w-9 h-9 rounded-lg grid place-items-center text-muted hover:text-fg hover:bg-panel-2 disabled:opacity-40 transition group"
        >
          <RotateCcw size={17} className="group-hover:-rotate-45 transition-transform" />
        </button>
        <button
          onClick={() => {
            const ci = SPEEDS.indexOf(playbackRate);
            const ni = (ci + 1) % SPEEDS.length;
            setPlaybackRate(SPEEDS[ni]);
          }}
          title="Velocidad de reproducción"
          className="flex-none h-9 px-2.5 rounded-lg grid place-items-center text-muted hover:text-fg hover:bg-panel-2 transition font-mono text-[12px] font-bold tabular-nums"
        >
          {playbackRate}x
        </button>
        <button
          onClick={() => setShowMixer((v) => !v)}
          aria-expanded={showMixer}
          title="Ajustes de ambiente"
          aria-label="Ajustes de ambiente"
          className={`flex-none w-9 h-9 rounded-lg grid place-items-center transition ${showMixer ? 'text-fg bg-panel-2' : 'text-muted hover:text-fg hover:bg-panel-2'}`}
        >
          <SlidersHorizontal size={17} />
        </button>
        <button
          onClick={handleDownload}
          disabled={!speechUrl}
          title="Descargar audio (WAV, solo voz)"
          aria-label="Descargar audio"
          className="flex-none w-9 h-9 rounded-lg grid place-items-center text-muted hover:text-fg hover:bg-panel-2 disabled:opacity-40 transition"
        >
          <Download size={16} />
        </button>
      </div>

      {/* Ambience mixer (collapsible) */}
      {showMixer && (
        <div className="border-t border-line-soft px-4 py-3.5 grid gap-3.5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPref({ muted: !prefs.muted })}
              className="flex-none text-muted hover:text-fg transition-colors"
              title={prefs.muted ? 'Activar ambiente' : 'Silenciar ambiente'}
              aria-label={prefs.muted ? 'Activar ambiente' : 'Silenciar ambiente'}
            >
              {prefs.muted ? <VolumeX size={16} className="text-faint" /> : <Volume2 size={16} />}
            </button>
            <span className="flex-none w-12 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Vol</span>
            <input
              type="range" min="0" max="1.0" step="0.05"
              value={prefs.volume}
              onChange={(e) => setPref({ volume: parseFloat(e.target.value), muted: false })}
              className="flex-1 min-w-0"
              disabled={prefs.muted}
              title="Volumen del ambiente"
            />
          </div>
          <div className="flex items-center gap-3">
            <Radio size={16} className="flex-none text-muted" />
            <span className="flex-none w-12 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Int</span>
            <input
              type="range" min="0" max="1.0" step="0.05"
              value={prefs.intensity}
              onChange={(e) => setPref({ intensity: parseFloat(e.target.value) })}
              className="flex-1 min-w-0"
              title="Intensidad del ambiente (frecuencia y nivel de los eventos)"
            />
          </div>
          <div className="flex items-center gap-3">
            <Activity size={16} className="flex-none text-muted" />
            <span className="flex-none w-12 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Duck</span>
            <input
              type="range" min="0" max="1.0" step="0.05"
              value={prefs.ducking}
              onChange={(e) => setPref({ ducking: parseFloat(e.target.value) })}
              className="flex-1 min-w-0"
              title="Ducking (reduce el ambiente cuando hay voz)"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioPlayer;
