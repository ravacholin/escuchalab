import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Activity, Radio, Sparkles, Volume2, VolumeX, Download, SlidersHorizontal, Info } from 'lucide-react';
import { resolveAmbienceScene, type ResolvedAmbience } from '../services/ambiencePresets';
import { loadBed, bedAssetUrl } from '../services/ambienceLibrary';
import {
  AmbienceEngine,
  DEFAULT_AMBIENCE_DUCKING,
  DEFAULT_AMBIENCE_INTENSITY,
  DEFAULT_AMBIENCE_VOLUME,
} from '../services/ambienceEngine';
import { TextType, WebSpeechPlan } from '../types';
import { ACCENT_LOCALE, pickWebSpeechVoices, type VoiceLike } from '../services/webSpeechTts';

interface AudioPlayerProps {
  speechSrc: string; // Base64 raw PCM. Cadena vacía en modo respaldo (no hay PCM).
  /**
   * Plan de respaldo con la voz del navegador (Web Speech API), presente solo
   * cuando el TTS de Gemini falló y no hay `speechSrc`. Excluyente con el PCM: o
   * suena la pista PCM, o la voz del navegador. Ver `services/webSpeechTts.ts`.
   */
  webSpeech?: WebSpeechPlan | null;
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
  webSpeech,
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

  // --- MODO RESPALDO (voz del navegador) ---------------------------------
  // Activo cuando no hay PCM de Gemini pero sí un plan Web Speech. La reproducción
  // no pasa por el <audio>/Web Audio de la pista: se habla el diálogo con
  // `speechSynthesis`, intervención por intervención, y el ambiente se mezcla igual
  // pero su ducking se dispara en las fronteras de cada intervención (no hay
  // analyser que leer). Sin bytes: no hay descarga WAV ni barra de búsqueda.
  const isFallback = !speechSrc && !!webSpeech && webSpeech.lines.length > 0;
  const playRateRef = useRef(playbackRate);
  useEffect(() => { playRateRef.current = playbackRate; }, [playbackRate]);
  // Voces del navegador ya resueltas por hablante (mismo objeto que devuelve
  // getVoices, compatible con VoiceLike). Se rellena de forma perezosa porque
  // getVoices() puede llegar vacío en el primer tick (ver onvoiceschanged).
  const speakerVoicesRef = useRef<Map<string, VoiceLike | null> | null>(null);
  const fallbackLineRef = useRef(0);
  const [fallbackLine, setFallbackLine] = useState(0);
  const fallbackTotal = isFallback ? webSpeech!.lines.length : 0;

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

  // Warm the browser's HTTP cache for this scene's beds as soon as the scene is known —
  // seconds before the user reaches the play button. On a cold cache the bed's ~1 MB
  // fetch is the multi-second cost that made the ambience burst in several seconds after
  // the voice on the first play (on replay the fetch was already cached, so it lined up).
  // Paying it up-front lets the decode-on-play resolve quickly so the bed can enter in
  // step with the voice from the very first turn. Same-origin static assets — the only
  // failure mode is "didn't load", which the player already degrades past silently.
  useEffect(() => {
    scene.recipe.beds.forEach((l) => {
      try {
        void fetch(bedAssetUrl(l.bed)).catch(() => {});
      } catch {
        /* fetch unavailable (SSR/old env) — the on-play decode still works */
      }
    });
  }, [scene.id]);

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
    const el = speechRef.current;

    const startVoice = () => {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };

    const ctx = ensureAudioContext();
    if (!ctx) {
      // Web Audio unavailable — the element plays natively, there is no ambience to
      // sync to, so start the voice straight away.
      startVoice();
      return;
    }

    setupSpeechProcessing(el);

    // Start the voice only once the scene's beds are decoded, so on the FIRST play the
    // bed is present from the very first turn instead of bursting in several seconds
    // late once its cold-cache fetch+decode finally lands — the exact behaviour a replay
    // already had, because there the decode promise was cached and resolved. `loadBed`
    // caches the decode per context, and the mount-time byte prefetch warms the fetch,
    // so in the common case these promises resolve almost immediately and the voice is
    // not perceptibly held. A short safety timeout guarantees a slow or dead network can
    // never stall playback: the voice starts anyway and the bed eases in over its own
    // ramp when it lands. Ambience itself is still started from the <audio> element's
    // `playing` event (see handleSpeechPlaying) — by which point the bed buffer is warm
    // and enters in step with the voice, instead of ahead of it (the fresh context /
    // one-shot createMediaElementSource / resume all delay the voice on the first play).
    let voiceStarted = false;
    const startVoiceOnce = () => {
      if (voiceStarted) return;
      voiceStarted = true;
      startVoice();
    };
    Promise.all(scene.recipe.beds.map((l) => loadBed(ctx, l.bed))).then(startVoiceOnce, startVoiceOnce);
    window.setTimeout(startVoiceOnce, 1200);
  }, [ensureAudioContext, setupSpeechProcessing, scene]);

  // Fired by the <audio> element when playback is actually producing sound (after
  // any first-play buffering/resume latency), so the ambience bed enters in step
  // with the voice rather than seconds before it. The `!engineRef.current` guard
  // keeps a mid-playback `playing` (e.g. after a seek) from restarting the bed;
  // pause/resume clears the engine, so resuming re-syncs the bed to the voice too.
  const handleSpeechPlaying = useCallback(() => {
    setIsPlaying(true);
    if (!engineRef.current) {
      startAmbience();
      startDuckingLoop();
    }
  }, [startAmbience, startDuckingLoop]);

  // --- REPRODUCCIÓN EN MODO RESPALDO (Web Speech) ------------------------
  // Resuelve, una vez, una voz del navegador por hablante del plan. Puede
  // devolver un mapa vacío si getVoices() aún no cargó (se reintenta; ver el
  // efecto de `voiceschanged`). Los objetos devueltos son los mismos que
  // getVoices(), así que valen como `utterance.voice`.
  const resolveSpeakerVoices = useCallback((): Map<string, VoiceLike | null> => {
    if (speakerVoicesRef.current) return speakerVoicesRef.current;
    if (!isFallback || typeof window === 'undefined' || !('speechSynthesis' in window)) return new Map();
    const voices = window.speechSynthesis.getVoices() as unknown as VoiceLike[];
    if (!voices || voices.length === 0) return new Map();
    const order: string[] = [];
    const genderOf = new Map<string, 'Male' | 'Female' | undefined>();
    for (const l of webSpeech!.lines) {
      if (!order.includes(l.speaker)) { order.push(l.speaker); genderOf.set(l.speaker, l.gender); }
    }
    const picked = pickWebSpeechVoices(voices, webSpeech!.accent, order.map(s => genderOf.get(s)));
    const map = new Map<string, VoiceLike | null>();
    order.forEach((s, i) => map.set(s, picked[i] ?? null));
    speakerVoicesRef.current = map;
    return map;
  }, [isFallback, webSpeech]);

  // Encola todas las intervenciones desde `startIdx`. Cada una lleva la voz de su
  // hablante y la velocidad actual; su `onstart`/`onend` mueven el contador y
  // disparan el ducking del ambiente (no hay analyser en este modo).
  const speakFallbackFrom = useCallback((startIdx: number) => {
    if (!isFallback || typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const voices = resolveSpeakerVoices();
    synth.cancel();
    const lines = webSpeech!.lines;
    const from = Math.max(0, Math.min(startIdx, lines.length - 1));
    fallbackLineRef.current = from;
    setFallbackLine(from);
    for (let i = from; i < lines.length; i++) {
      const line = lines[i];
      const u = new SpeechSynthesisUtterance(line.text);
      const v = voices.get(line.speaker) as SpeechSynthesisVoice | null | undefined;
      if (v) u.voice = v;
      u.lang = v?.lang || ACCENT_LOCALE[webSpeech!.accent] || 'es-ES';
      u.rate = playRateRef.current;
      u.onstart = () => {
        fallbackLineRef.current = i;
        setFallbackLine(i);
        engineRef.current?.applySpeechLevel(0.85);
      };
      u.onend = () => {
        engineRef.current?.applySpeechLevel(0);
        if (i >= lines.length - 1) {
          setIsPlaying(false);
          fallbackLineRef.current = 0;
          setFallbackLine(0);
          stopAmbience();
        }
      };
      synth.speak(u);
    }
  }, [isFallback, webSpeech, resolveSpeakerVoices, stopAmbience]);

  const startFallbackPlayback = useCallback(() => {
    ensureAudioContext();
    if (!engineRef.current) startAmbience();
    engineRef.current?.applySpeechLevel(0);
    speakFallbackFrom(fallbackLineRef.current || 0);
    setIsPlaying(true);
  }, [ensureAudioContext, startAmbience, speakFallbackFrom]);

  const toggleFallbackPlay = useCallback(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) return;
    if (isPlaying) {
      try { synth.pause(); } catch { /* noop */ }
      stopAmbience();
      setIsPlaying(false);
      return;
    }
    if (synth.paused && synth.speaking) {
      if (!engineRef.current) startAmbience();
      try { synth.resume(); } catch { /* noop */ }
      setIsPlaying(true);
    } else {
      startFallbackPlayback();
    }
  }, [isPlaying, stopAmbience, startAmbience, startFallbackPlayback]);

  const resetFallback = useCallback(() => {
    fallbackLineRef.current = 0;
    setFallbackLine(0);
    startFallbackPlayback();
  }, [startFallbackPlayback]);

  const togglePlay = () => {
    if (isFallback) { toggleFallbackPlay(); return; }
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
    if (isFallback) { resetFallback(); return; }
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

  // Modo respaldo: prepara las voces del navegador en cuanto se conocen. getVoices()
  // suele llegar vacío en el primer tick y se puebla luego, disparando `voiceschanged`;
  // reintentar ahí deja la voz correcta lista antes del primer play.
  useEffect(() => {
    if (!isFallback || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const prime = () => { speakerVoicesRef.current = null; resolveSpeakerVoices(); };
    prime();
    synth.addEventListener?.('voiceschanged', prime);
    return () => synth.removeEventListener?.('voiceschanged', prime);
  }, [isFallback, resolveSpeakerVoices]);

  // Tear everything down on unmount. La cola de `speechSynthesis` es global, así que
  // hay que cancelarla explícitamente: si no, la voz del respaldo seguiría hablando
  // tras cambiar de lección (el componente se remonta con key nueva).
  useEffect(() => {
    return () => {
      stopAmbience();
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
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

  // En modo respaldo no hay tiempo ni seek: se puede reproducir en cuanto hay plan,
  // y el progreso se mide por intervención hablada. En modo PCM manda `speechUrl`.
  const canPlay = isFallback || !!speechUrl;
  const progressRatio = isFallback
    ? (fallbackTotal ? Math.min(1, (fallbackLine + (isPlaying ? 1 : 0)) / fallbackTotal) : 0)
    : (duration ? currentTime / duration : 0);

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
          onPlaying={handleSpeechPlaying}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Aviso de respaldo: la voz del navegador sustituye al TTS de Gemini. */}
      {isFallback && (
        <div className="flex gap-2 items-start px-4 pt-3 pb-1 text-[11px] leading-snug text-faint">
          <Info size={13} className="flex-none mt-[1px] text-muted" />
          <span>
            Voz del navegador (respaldo): sin cuota de Gemini disponible. La calidad y
            el acento son más limitados, y no hay descarga de audio.
          </span>
        </div>
      )}

      {/* Seek / waveform */}
      <div className="px-4 pt-3.5">
        <div
          onClick={isFallback ? undefined : handleSeek}
          className={`relative h-9 group ${isFallback ? 'cursor-default' : 'cursor-pointer'}`}
          role="slider"
          aria-label="Barra de reproducción"
          aria-valuenow={isFallback ? fallbackLine : Math.round(currentTime)}
          aria-valuemax={isFallback ? Math.max(0, fallbackTotal - 1) : (Math.round(duration) || 0)}
        >
          <div className="absolute inset-0 flex items-center gap-[2px]">
            {waveform.map((h, i) => {
              const played = (i + 0.5) / waveform.length <= progressRatio;
              return (
                <span
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${played ? 'bg-fg' : `bg-line ${isFallback ? '' : 'group-hover:bg-faint'}`}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex justify-between mt-1.5 font-mono text-[11px] text-muted tabular-nums">
          {isFallback ? (
            <>
              <span>Voz navegador</span>
              <span>{Math.min(fallbackLine + (isPlaying ? 1 : 0), fallbackTotal)}/{fallbackTotal}</span>
            </>
          ) : (
            <>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-1">
        <button
          onClick={togglePlay}
          disabled={!canPlay}
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
          disabled={!canPlay}
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
        {!isFallback && (
          <button
            onClick={handleDownload}
            disabled={!speechUrl}
            title="Descargar audio (WAV, solo voz)"
            aria-label="Descargar audio"
            className="flex-none w-9 h-9 rounded-lg grid place-items-center text-muted hover:text-fg hover:bg-panel-2 disabled:opacity-40 transition"
          >
            <Download size={16} />
          </button>
        )}
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
