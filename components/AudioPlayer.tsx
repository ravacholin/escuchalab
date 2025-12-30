
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Activity, Radio, Sparkles } from 'lucide-react';
import { getAmbiencePreset } from '../services/ambiencePresets';
import type { EnvironmentProfile, AmbienceTag } from '../services/ambiencePresets';

interface AudioPlayerProps {
  speechSrc: string; // Base64 raw PCM
  recommendedSpeed?: number;
  topic?: string;
  ambientKeywords?: string; // AI-generated English keywords
  explicitQuery?: string; // Back-compat: older prop name from App.tsx
  scenarioLabel?: string;
  scenarioActionLabel?: string;
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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hashStringToSeed(input: string): number {
  // Deterministic seed (FNV-1a-ish), stable across reloads.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoiseBuffer(ctx: AudioContext, seconds: number, color: 'white' | 'pink' | 'brown', rng: () => number) {
  const length = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const out = buffer.getChannelData(0);

  if (color === 'white') {
    for (let i = 0; i < length; i++) out[i] = (rng() * 2 - 1) * 0.18;
    return buffer;
  }

  if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = rng() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      out[i] = last * 0.55;
    }
    return buffer;
  }

  // Pink (Paul Kellet)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
    b6 = white * 0.115926;
  }
  return buffer;
}

function createImpulseResponse(ctx: AudioContext, seconds: number, decay: number, rng: () => number) {
  const length = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const out = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      out[i] = (rng() * 2 - 1) * env;
    }
  }
  return buffer;
}

function playModalHit(ctx: AudioContext, params: {
  partialsHz: number[];
  durationSeconds: number;
  gain: number;
  pan: number;
  master: AudioNode;
  reverb?: AudioNode;
}) {
  const now = ctx.currentTime;
  const { partialsHz, durationSeconds, gain, pan, master, reverb } = params;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;

  const outGain = ctx.createGain();
  outGain.gain.setValueAtTime(0.0001, now);
  outGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.01);
  outGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  panner.connect(outGain);
  outGain.connect(master);
  if (reverb) outGain.connect(reverb);

  const oscillators: OscillatorNode[] = [];
  for (const hz of partialsHz) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, now);
    o.frequency.exponentialRampToValueAtTime(hz * 0.97, now + durationSeconds);
    o.connect(panner);
    o.start(now);
    o.stop(now + durationSeconds + 0.03);
    oscillators.push(o);
  }

  return { panner, outGain, oscillators };
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  speechSrc,
  recommendedSpeed = 1.0,
  topic,
  ambientKeywords,
  explicitQuery,
  scenarioLabel,
  scenarioActionLabel,
}) => {
  // Channel 1: Speech
  const speechRef = useRef<HTMLAudioElement | null>(null);

  // Channels: Synthetic Ambience (Web Audio API)
  const syntheticCtxRef = useRef<AudioContext | null>(null);
  const syntheticGainRef = useRef<GainNode | null>(null);
  const syntheticDuckGainRef = useRef<GainNode | null>(null);
  const syntheticNodesRef = useRef<AudioNode[]>([]);
  const syntheticTimersRef = useRef<number[]>([]);
  const duckingRafRef = useRef<number | null>(null);
  const speechAnalyserRef = useRef<AnalyserNode | null>(null);
  const speechSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speechUrl, setSpeechUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(recommendedSpeed);

  // Settings
  const [ambienceVolume, setAmbienceVolume] = useState(0.35);
  const [ambienceIntensity, setAmbienceIntensity] = useState(0.65);
  const [ambienceDucking, setAmbienceDucking] = useState(0.65);

  const ambienceVolumeRef = useRef(ambienceVolume);
  const ambienceDuckingRef = useRef(ambienceDucking);

  useEffect(() => {
    ambienceVolumeRef.current = ambienceVolume;
  }, [ambienceVolume]);

  useEffect(() => {
    ambienceDuckingRef.current = ambienceDucking;
  }, [ambienceDucking]);

  const keywords = ambientKeywords ?? explicitQuery;
  const ambiencePreset = useMemo(() => {
    return getAmbiencePreset({
      scenarioLabel,
      scenarioActionLabel,
      topic,
      keywords,
    });
  }, [scenarioLabel, scenarioActionLabel, topic, keywords]);

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

  const env: EnvironmentProfile = ambiencePreset.profile;
  const envTags: AmbienceTag[] = ambiencePreset.tags;

  // --- SYNTHETIC AMBIENCE GENERATOR ---
  const initSyntheticAmbience = () => {
    try {
      stopSyntheticAmbience();

      if (!syntheticCtxRef.current) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        syntheticCtxRef.current = new AudioContextClass();
        syntheticGainRef.current = syntheticCtxRef.current!.createGain();
        syntheticDuckGainRef.current = syntheticCtxRef.current!.createGain();
        syntheticGainRef.current!.connect(syntheticDuckGainRef.current!);
        syntheticDuckGainRef.current!.connect(syntheticCtxRef.current!.destination);
      }

      if (!syntheticGainRef.current || !syntheticDuckGainRef.current) {
        syntheticGainRef.current = syntheticCtxRef.current.createGain();
        syntheticDuckGainRef.current = syntheticCtxRef.current.createGain();
        syntheticGainRef.current.connect(syntheticDuckGainRef.current);
        syntheticDuckGainRef.current.connect(syntheticCtxRef.current.destination);
      }

      const ctx = syntheticCtxRef.current!;
      if (ctx.state === 'suspended') ctx.resume();

      const masterGain = syntheticGainRef.current!; // user volume
      const duckGain = syntheticDuckGainRef.current!; // ducking against speech
      const nodes: AudioNode[] = [];
      const keywords = ambientKeywords ?? explicitQuery;
      const profile: EnvironmentProfile = env;
      const tags: AmbienceTag[] = envTags;
      const effectiveIntensity = clamp01(ambienceIntensity + (ambiencePreset.intensityBias ?? 0));
      const seed = hashStringToSeed(`${profile}|${tags.join(',')}|${topic || ''}|${keywords || ''}`);
      const rng = mulberry32(seed);

      duckGain.gain.setValueAtTime(1, ctx.currentTime);

      // Light reverb for space (contextual).
      const convolver = ctx.createConvolver();
      const irSeconds = profile === 'CAFE' ? 1.6 : (profile === 'CITY' ? 1.1 : (profile === 'NATURE' ? 2.2 : 1.3));
      const irDecay = profile === 'OFFICE' ? 2.2 : 3.0;
      convolver.buffer = createImpulseResponse(ctx, irSeconds, irDecay, rng);
      const wetGain = ctx.createGain();
      wetGain.gain.value = profile === 'CITY' ? 0.10 : (profile === 'OFFICE' ? 0.08 : 0.14);
      convolver.connect(wetGain);
      wetGain.connect(masterGain);
      nodes.push(convolver, wetGain);

      const baseLow = ctx.createBiquadFilter();
      baseLow.type = 'lowpass';
      baseLow.frequency.value = profile === 'CITY' ? 260 : 170;
      const baseLowGain = ctx.createGain();
      // Keep the "bed" subtle; detail should come from events.
      baseLowGain.gain.value = 0.05 + effectiveIntensity * 0.10;
      baseLow.connect(baseLowGain);
      baseLowGain.connect(masterGain);
      baseLowGain.connect(convolver);
      nodes.push(baseLow, baseLowGain);

      const baseAir = ctx.createBiquadFilter();
      baseAir.type = 'bandpass';
      baseAir.frequency.value = profile === 'NATURE' ? 3200 : (profile === 'CAFE' ? 2400 : (profile === 'CITY' ? 2800 : 2200));
      baseAir.Q.value = 0.4;
      const baseAirGain = ctx.createGain();
      baseAirGain.gain.value = 0.012 + effectiveIntensity * 0.04;
      baseAir.connect(baseAirGain);
      baseAirGain.connect(masterGain);
      baseAirGain.connect(convolver);
      nodes.push(baseAir, baseAirGain);

      const brownSource = ctx.createBufferSource();
      brownSource.buffer = createNoiseBuffer(ctx, 6, 'brown', rng);
      brownSource.loop = true;
      brownSource.connect(baseLow);
      brownSource.start();
      nodes.push(brownSource);

      // Air/HVAC hiss (high band) to avoid "ocean" artifacts from wideband pink.
      const airSource = ctx.createBufferSource();
      airSource.buffer = createNoiseBuffer(ctx, 6, 'white', rng);
      airSource.loop = true;
      const airHp = ctx.createBiquadFilter();
      airHp.type = 'highpass';
      airHp.frequency.value = 1200;
      const airLp = ctx.createBiquadFilter();
      airLp.type = 'lowpass';
      airLp.frequency.value = 8000;
      const airGain = ctx.createGain();
      airGain.gain.value = profile === 'ROOM' ? 0.003 : (profile === 'OFFICE' ? 0.004 : 0.005 + effectiveIntensity * 0.006);
      airSource.connect(airHp);
      airHp.connect(airLp);
      airLp.connect(airGain);
      airGain.connect(baseAir);
      airSource.start();
      nodes.push(airSource, airHp, airLp, airGain);

      // Subtle tonal bed (adds "life" without sounding like a synth).
      const humOsc = ctx.createOscillator();
      humOsc.type = 'sine';
      const humGain = ctx.createGain();
      humGain.gain.value = (profile === 'OFFICE' ? 0.012 : 0.005) + effectiveIntensity * 0.008;
      const humFilter = ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = profile === 'CITY' ? 140 : 220;
      humOsc.frequency.value = profile === 'OFFICE' ? 60 : 90;
      humOsc.connect(humFilter);
      humFilter.connect(humGain);
      humGain.connect(masterGain);
      humGain.connect(convolver);
      humOsc.start();
      nodes.push(humOsc, humGain, humFilter);

      // Event helpers (contextual one-shots).
      const playNoiseBurst = (opts: {
        durationMs: number;
        gain: number;
        filterType: BiquadFilterType;
        freq: number;
        q?: number;
        pan?: number;
        reverbSend?: number;
      }) => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = createNoiseBuffer(ctx, Math.max(0.05, opts.durationMs / 1000), 'white', rng);

        const filter = ctx.createBiquadFilter();
        filter.type = opts.filterType;
        filter.frequency.value = opts.freq;
        filter.Q.value = opts.q ?? 1.2;

        const pan = ctx.createStereoPanner();
        pan.pan.value = opts.pan ?? (rng() * 2 - 1) * 0.6;

        const g = ctx.createGain();
        const dur = opts.durationMs / 1000;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), now + Math.min(0.02, dur * 0.25));
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        src.connect(filter);
        filter.connect(pan);
        pan.connect(g);
        g.connect(masterGain);
        if ((opts.reverbSend ?? 0.5) > 0) {
          const send = ctx.createGain();
          send.gain.value = (opts.reverbSend ?? 0.5);
          g.connect(send);
          send.connect(convolver);
          nodes.push(send);
        }
        src.start(now);
        src.stop(now + dur + 0.05);
        nodes.push(src, filter, pan, g);
      };

      const playClink = (strength = 1) => {
        if (syntheticNodesRef.current.length === 0) return;
        const pan = (rng() * 2 - 1) * 0.8;
        const base = 1800 + rng() * 900;
        const partials = [
          base,
          base * (1.42 + rng() * 0.08),
          base * (2.15 + rng() * 0.10),
          base * (2.92 + rng() * 0.12),
        ];
        const hit = playModalHit(ctx, {
          partialsHz: partials,
          durationSeconds: 0.18 + rng() * 0.22,
          gain: (0.0012 + effectiveIntensity * 0.004) * strength,
          pan,
          master: masterGain,
          reverb: convolver,
        });
        nodes.push(hit.panner, hit.outGain, ...hit.oscillators);
      };

      const playMetalClank = (strength = 1) => {
        if (syntheticNodesRef.current.length === 0) return;
        const pan = (rng() * 2 - 1) * 0.9;
        const base = 220 + rng() * 120;
        const partials = [
          base,
          base * (2.31 + rng() * 0.18),
          base * (3.12 + rng() * 0.22),
          base * (4.55 + rng() * 0.28),
        ];
        const hit = playModalHit(ctx, {
          partialsHz: partials,
          durationSeconds: 0.22 + rng() * 0.26,
          gain: (0.0015 + effectiveIntensity * 0.006) * strength,
          pan,
          master: masterGain,
          reverb: convolver,
        });
        nodes.push(hit.panner, hit.outGain, ...hit.oscillators);

        playNoiseBurst({
          durationMs: 30 + rng() * 70,
          gain: 0.0015 + effectiveIntensity * 0.003,
          filterType: 'bandpass',
          freq: 900 + rng() * 1100,
          q: 1.2,
          pan,
          reverbSend: 0.25,
        });
      };

      const createBabbleCrowd = () => {
        // Crowd "babble": several pseudo-voices using noise+formants with syllabic amplitude.
        const voices = 4 + Math.floor(rng() * 3);
        const src = ctx.createBufferSource();
        src.buffer = createNoiseBuffer(ctx, 6, 'white', rng);
        src.loop = true;

        const bus = ctx.createGain();
        bus.gain.value = 1;
        const out = ctx.createGain();
        out.gain.value = 0.010 + effectiveIntensity * 0.020;
        bus.connect(out);
        out.connect(masterGain);
        out.connect(convolver);

        for (let i = 0; i < voices; i++) {
          const formant = ctx.createBiquadFilter();
          formant.type = 'bandpass';
          formant.Q.value = 0.65;
          formant.frequency.value = 320 + rng() * 520;

          const breathe = ctx.createBiquadFilter();
          breathe.type = 'highpass';
          breathe.frequency.value = 160 + rng() * 120;

          const g = ctx.createGain();
          const baseLevel = 0.22 + rng() * 0.22;
          g.gain.value = baseLevel / voices;

          const syll = ctx.createOscillator();
          syll.type = 'sine';
          syll.frequency.value = 2.2 + rng() * 2.8;
          const syllGain = ctx.createGain();
          syllGain.gain.value = 0.35;
          syll.connect(syllGain);
          syllGain.connect(g.gain);
          syll.start();

          const drift = ctx.createOscillator();
          drift.type = 'sine';
          drift.frequency.value = 0.03 + rng() * 0.05;
          const driftGain = ctx.createGain();
          driftGain.gain.value = 140 + rng() * 160;
          drift.connect(driftGain);
          driftGain.connect(formant.frequency);
          drift.start();

          src.connect(breathe);
          breathe.connect(formant);
          formant.connect(g);
          g.connect(bus);
          nodes.push(formant, breathe, g, syll, syllGain, drift, driftGain);

          // Add a tiny voiced component per "person".
          const voiceOsc = ctx.createOscillator();
          voiceOsc.type = 'sawtooth';
          voiceOsc.frequency.value = 90 + rng() * 90;
          const voiceFilter = ctx.createBiquadFilter();
          voiceFilter.type = 'bandpass';
          voiceFilter.frequency.value = 280 + rng() * 320;
          voiceFilter.Q.value = 0.9;
          const voiceGain = ctx.createGain();
          voiceGain.gain.value = (0.0008 + effectiveIntensity * 0.0016) / voices;
          voiceOsc.connect(voiceFilter);
          voiceFilter.connect(voiceGain);
          voiceGain.connect(bus);
          voiceOsc.start();
          nodes.push(voiceOsc, voiceFilter, voiceGain);
        }

        src.start();
        nodes.push(src, bus, out);
      };

      const playChirp = (opts: { baseHz: number; durationMs: number; gain: number; pan?: number }) => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const dur = opts.durationMs / 1000;

        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(opts.baseHz, now);
        carrier.frequency.exponentialRampToValueAtTime(opts.baseHz * (1.4 + rng() * 0.6), now + dur);

        const mod = ctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.value = 12 + rng() * 18;
        const modGain = ctx.createGain();
        modGain.gain.value = 20 + rng() * 40;
        mod.connect(modGain);
        modGain.connect(carrier.frequency);

        const pan = ctx.createStereoPanner();
        pan.pan.value = opts.pan ?? (rng() * 2 - 1) * 0.85;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        carrier.connect(pan);
        pan.connect(g);
        g.connect(masterGain);
        g.connect(convolver);

        carrier.start(now);
        mod.start(now);
        carrier.stop(now + dur + 0.03);
        mod.stop(now + dur + 0.03);
        nodes.push(carrier, mod, modGain, pan, g);
      };

      const playHonk = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const dur = 0.28 + rng() * 0.18;
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.type = 'square';
        o2.type = 'square';
        o1.frequency.value = 330 + rng() * 80;
        o2.frequency.value = o1.frequency.value * 1.5;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 650;
        filter.Q.value = 0.8;
        const pan = ctx.createStereoPanner();
        pan.pan.value = (rng() * 2 - 1) * 0.8;
        const g = ctx.createGain();
        const level = 0.010 + ambienceIntensity * 0.015;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(level, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o1.connect(filter);
        o2.connect(filter);
        filter.connect(pan);
        pan.connect(g);
        g.connect(masterGain);
        g.connect(convolver);
        o1.start(now);
        o2.start(now);
        o1.stop(now + dur + 0.05);
        o2.stop(now + dur + 0.05);
        nodes.push(o1, o2, filter, pan, g);
      };

      const schedule = (fn: () => void, delayMs: number) => {
        const id = window.setTimeout(fn, delayMs);
        syntheticTimersRef.current.push(id);
      };

      const scheduleLoop = (fn: () => void, minMs: number, maxMs: number) => {
        const loop = () => {
          if (syntheticNodesRef.current.length === 0) return;
          fn();
          const next = minMs + rng() * (maxMs - minMs);
          schedule(loop, next);
        };
        schedule(loop, minMs + rng() * (maxMs - minMs));
      };

      // Global "texture" events (gentle, avoids static noise).
      scheduleLoop(() => {
        const base = profile === 'CAFE' ? 0.004 : (profile === 'OFFICE' ? 0.003 : 0.002);
        playNoiseBurst({
          durationMs: 40 + rng() * 90,
          gain: base + effectiveIntensity * base,
          filterType: 'highpass',
          freq: profile === 'CITY' ? 1200 : 1800,
          q: 0.8,
          reverbSend: 0.15,
        });
      }, 900, 4500);

      const playFootstep = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const dur = 0.12 + rng() * 0.10;
        const thump = ctx.createOscillator();
        thump.type = 'sine';
        thump.frequency.value = 85 + rng() * 40;
        const thumpGain = ctx.createGain();
        const level = 0.002 + effectiveIntensity * 0.004;
        thumpGain.gain.setValueAtTime(0.0001, now);
        thumpGain.gain.exponentialRampToValueAtTime(level, now + 0.01);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        thump.connect(thumpGain);
        thumpGain.connect(masterGain);
        thumpGain.connect(convolver);
        thump.start(now);
        thump.stop(now + dur + 0.02);
        nodes.push(thump, thumpGain);

        playNoiseBurst({
          durationMs: 35 + rng() * 40,
          gain: 0.0015 + effectiveIntensity * 0.002,
          filterType: 'highpass',
          freq: 2200 + rng() * 2500,
          q: 0.8,
          pan: (rng() * 2 - 1) * 0.3,
          reverbSend: 0.1,
        });
      };

      const playDoorChime = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const dur = 0.25 + rng() * 0.15;
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.type = 'sine';
        o2.type = 'sine';
        o1.frequency.value = 740 + rng() * 120;
        o2.frequency.value = o1.frequency.value * (1.5 + rng() * 0.2);
        const g = ctx.createGain();
        const level = 0.002 + effectiveIntensity * 0.004;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(level, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o1.connect(g);
        o2.connect(g);
        g.connect(masterGain);
        g.connect(convolver);
        o1.start(now);
        o2.start(now);
        o1.stop(now + dur + 0.02);
        o2.stop(now + dur + 0.02);
        nodes.push(o1, o2, g);
      };

      const playAnnouncement = () => {
        // Pseudo-PA: band-passed noise with tremolo.
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const durMs = 650 + rng() * 650;
        playNoiseBurst({
          durationMs: durMs,
          gain: 0.0025 + effectiveIntensity * 0.004,
          filterType: 'bandpass',
          freq: 900 + rng() * 600,
          q: 0.7,
          pan: (rng() * 2 - 1) * 0.5,
          reverbSend: 0.4,
        });
        if (rng() < 0.5) {
          playChirp({
            baseHz: 650 + rng() * 250,
            durationMs: 120 + rng() * 120,
            gain: 0.0015 + effectiveIntensity * 0.0025,
          });
        }
      };

      const playSirenFar = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const dur = 1.8 + rng() * 1.4;
        const o = ctx.createOscillator();
        o.type = 'sine';
        const g = ctx.createGain();
        const level = 0.0012 + effectiveIntensity * 0.002;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(level, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        const base = 520 + rng() * 80;
        o.frequency.setValueAtTime(base, now);
        o.frequency.linearRampToValueAtTime(base * 1.45, now + dur * 0.5);
        o.frequency.linearRampToValueAtTime(base, now + dur);
        o.connect(g);
        g.connect(masterGain);
        g.connect(convolver);
        o.start(now);
        o.stop(now + dur + 0.05);
        nodes.push(o, g);
      };

      const playMonitorBeep = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const dur = 0.08 + rng() * 0.05;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 980 + rng() * 180;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.002 + effectiveIntensity * 0.002, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o.connect(g);
        g.connect(masterGain);
        g.connect(convolver);
        o.start(now);
        o.stop(now + dur + 0.02);
        nodes.push(o, g);
      };

      const playWeightClank = () => {
        playMetalClank(1.0);
      };

      const playHammer = () => {
        playMetalClank(0.85);
      };

      const playPaperShuffle = () => {
        playNoiseBurst({
          durationMs: 250 + rng() * 550,
          gain: 0.0018 + effectiveIntensity * 0.004,
          filterType: 'bandpass',
          freq: 850 + rng() * 950,
          q: 0.9,
          reverbSend: 0.12,
        });
      };

      const playPrinter = () => {
        const bursts = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < bursts; i++) {
          schedule(() => {
            playNoiseBurst({
              durationMs: 60 + rng() * 120,
              gain: 0.002 + effectiveIntensity * 0.004,
              filterType: 'bandpass',
              freq: 320 + rng() * 300,
              q: 0.7,
              reverbSend: 0.08,
            });
          }, i * (110 + rng() * 140));
        }
      };

      // Tag-driven beds/events (scenario-specific "rules").
      if (tags.includes('crowd')) {
        createBabbleCrowd();
      }

      if (tags.includes('music')) {
        // "Radio"-like muffled music bed: gentle chord + wow/flutter.
        const root = 95 + rng() * 50;
        const a = ctx.createOscillator();
        const b = ctx.createOscillator();
        const c = ctx.createOscillator();
        a.type = 'triangle';
        b.type = 'triangle';
        c.type = 'sine';
        a.frequency.value = root;
        b.frequency.value = root * 1.5;
        c.frequency.value = root * 2;

        const wow = ctx.createOscillator();
        wow.type = 'sine';
        wow.frequency.value = 0.35 + rng() * 0.35;
        const wowGain = ctx.createGain();
        wowGain.gain.value = 1.2 + rng() * 1.8;
        wow.connect(wowGain);
        wowGain.connect(a.detune);
        wowGain.connect(b.detune);
        wowGain.connect(c.detune);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 520 + rng() * 240;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 90;
        const g = ctx.createGain();
        g.gain.value = 0.002 + effectiveIntensity * 0.005;
        a.connect(lp);
        b.connect(lp);
        c.connect(lp);
        lp.connect(hp);
        hp.connect(g);
        g.connect(masterGain);
        g.connect(convolver);
        a.start();
        b.start();
        c.start();
        wow.start();
        nodes.push(a, b, c, wow, wowGain, lp, hp, g);
      }

      if (tags.includes('rain') || tags.includes('storm')) {
        // Rain should feel like many micro-events, not a constant wideband hiss.
        scheduleLoop(() => {
          const dropCount = 1 + Math.floor(rng() * (2 + effectiveIntensity * 4));
          for (let i = 0; i < dropCount; i++) {
            schedule(() => {
              playNoiseBurst({
                durationMs: 8 + rng() * 18,
                gain: 0.0008 + effectiveIntensity * 0.0022,
                filterType: 'highpass',
                freq: 4200 + rng() * 5200,
                q: 0.9,
                reverbSend: 0.22,
              });
            }, i * (20 + rng() * 40));
          }
        }, 120, 360);

        if (effectiveIntensity > 0.55) {
          // Soft "sheet" layer only when intensity is high.
          const sheet = ctx.createBufferSource();
          sheet.buffer = createNoiseBuffer(ctx, 6, 'pink', rng);
          sheet.loop = true;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 1400;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 7800;
          const g = ctx.createGain();
          g.gain.value = 0.004 + effectiveIntensity * 0.010;
          sheet.connect(hp);
          hp.connect(lp);
          lp.connect(g);
          g.connect(masterGain);
          g.connect(convolver);
          sheet.start();
          nodes.push(sheet, hp, lp, g);
        }
      }

      if (tags.includes('storm')) {
        scheduleLoop(() => {
          // thunder-ish rumble
          playNoiseBurst({
            durationMs: 1200 + rng() * 1800,
            gain: 0.002 + effectiveIntensity * 0.006,
            filterType: 'lowpass',
            freq: 160 + rng() * 120,
            q: 0.6,
            reverbSend: 0.35,
          });
        }, 16000, 42000);
      }

      if (tags.includes('pa')) {
        scheduleLoop(() => {
          if (rng() < 0.55 + effectiveIntensity * 0.25) playAnnouncement();
        }, 9000, 21000);
      }

      if (tags.includes('traffic') || tags.includes('bus') || tags.includes('train')) {
        // Distant engine "beds" + pass-bys, to avoid generic noise.
        const engine = ctx.createOscillator();
        engine.type = 'sawtooth';
        engine.frequency.value = 42 + rng() * 35;
        const engineLp = ctx.createBiquadFilter();
        engineLp.type = 'lowpass';
        engineLp.frequency.value = 180 + rng() * 120;
        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.003 + effectiveIntensity * 0.007;
        engine.connect(engineLp);
        engineLp.connect(engineGain);
        engineGain.connect(masterGain);
        engineGain.connect(convolver);
        engine.start();
        nodes.push(engine, engineLp, engineGain);

        scheduleLoop(() => {
          // pass-by "whoosh" with movement
          const pan = (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.5);
          playNoiseBurst({
            durationMs: 700 + rng() * 1300,
            gain: 0.003 + effectiveIntensity * 0.010,
            filterType: 'bandpass',
            freq: 260 + rng() * 520,
            q: 0.55,
            pan,
            reverbSend: 0.12,
          });

          if (tags.includes('train') && rng() < 0.35) {
            playModalHit(ctx, {
              partialsHz: [440, 660, 880].map(x => x * (0.85 + rng() * 0.12)),
              durationSeconds: 0.6 + rng() * 0.6,
              gain: 0.001 + effectiveIntensity * 0.002,
              pan,
              master: masterGain,
              reverb: convolver,
            });
          }
        }, 4500, 11000);
      }

      if (tags.includes('footsteps')) {
        scheduleLoop(() => {
          if (rng() < 0.65 + effectiveIntensity * 0.2) playFootstep();
        }, 1700, 6500);
      }

      if (tags.includes('door')) {
        scheduleLoop(() => {
          if (rng() < 0.45 + effectiveIntensity * 0.2) playDoorChime();
        }, 9000, 20000);
      }

      if (tags.includes('police')) {
        scheduleLoop(() => {
          if (rng() < 0.3 + effectiveIntensity * 0.25) playSirenFar();
        }, 18000, 42000);
      }

      if (tags.includes('medical')) {
        scheduleLoop(() => {
          if (rng() < 0.5 + effectiveIntensity * 0.3) playMonitorBeep();
        }, 6500, 15000);
      }

      if (tags.includes('gym')) {
        scheduleLoop(() => {
          if (rng() < 0.65 + effectiveIntensity * 0.2) playWeightClank();
        }, 2200, 6500);
      }

      if (tags.includes('construction') || tags.includes('mechanic')) {
        scheduleLoop(() => {
          if (rng() < 0.6 + effectiveIntensity * 0.25) playHammer();
        }, 1800, 6200);
      }

      if (tags.includes('paper')) {
        scheduleLoop(() => {
          if (rng() < 0.55 + effectiveIntensity * 0.25) playPaperShuffle();
        }, 6500, 14000);
      }

      if (tags.includes('printer')) {
        scheduleLoop(() => {
          if (rng() < 0.55 + effectiveIntensity * 0.2) playPrinter();
        }, 12000, 25000);
      }

      // Profile-specific life.
      if (profile === 'CAFE') {
        // Cutlery / cup clinks.
        scheduleLoop(() => {
          playClink(1.0);
          if (rng() < 0.35) schedule(() => playClink(0.6), 60 + rng() * 140);
        }, 1800, 6000);

        // Chair/cloth rustle.
        scheduleLoop(() => {
          playNoiseBurst({
            durationMs: 180 + rng() * 420,
            gain: 0.003 + effectiveIntensity * 0.006,
            filterType: 'bandpass',
            freq: 700 + rng() * 500,
            q: 1.0,
            reverbSend: 0.25,
          });
        }, 6000, 14000);
      }

      if (profile === 'CITY') {
        // Traffic whoosh.
        scheduleLoop(() => {
          playNoiseBurst({
            durationMs: 900 + rng() * 1400,
            gain: 0.004 + effectiveIntensity * 0.010,
            filterType: 'bandpass',
            freq: 300 + rng() * 500,
            q: 0.6,
            pan: (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.6),
            reverbSend: 0.12,
          });
        }, 3500, 9000);

        // Occasional honk far away.
        scheduleLoop(() => {
          if (rng() < 0.55 + effectiveIntensity * 0.25) playHonk();
        }, 9000, 18000);
      }

      if (profile === 'OFFICE') {
        // Keyboard clicks.
        scheduleLoop(() => {
          const burstCount = 2 + Math.floor(rng() * 5);
          for (let i = 0; i < burstCount; i++) {
            schedule(() => {
              playNoiseBurst({
                durationMs: 15 + rng() * 25,
                gain: 0.0025 + effectiveIntensity * 0.004,
                filterType: 'highpass',
                freq: 1600 + rng() * 2400,
                q: 1.1,
                reverbSend: 0.08,
              });
            }, i * (40 + rng() * 70));
          }
        }, 1400, 5200);

        // Paper shuffle.
        scheduleLoop(() => {
          playNoiseBurst({
            durationMs: 250 + rng() * 600,
            gain: 0.002 + effectiveIntensity * 0.005,
            filterType: 'bandpass',
            freq: 900 + rng() * 900,
            q: 0.9,
            reverbSend: 0.12,
          });
        }, 8000, 16000);
      }

      if (profile === 'NATURE') {
        // Birds.
        scheduleLoop(() => {
          const chirps = 1 + Math.floor(rng() * 3);
          for (let i = 0; i < chirps; i++) {
            schedule(() => {
              playChirp({
                baseHz: 1600 + rng() * 1800,
                durationMs: 90 + rng() * 160,
                gain: 0.002 + effectiveIntensity * 0.004,
              });
            }, i * (120 + rng() * 220));
          }
        }, 3000, 9000);

        // Wind gust.
        scheduleLoop(() => {
          playNoiseBurst({
            durationMs: 1400 + rng() * 2000,
            gain: 0.002 + effectiveIntensity * 0.008,
            filterType: 'lowpass',
            freq: 900 + rng() * 900,
            q: 0.6,
            reverbSend: 0.18,
          });
        }, 7000, 15000);
      }

      if (profile === 'ROOM') {
        // Tiny creaks / room movements.
        scheduleLoop(() => {
          playNoiseBurst({
            durationMs: 120 + rng() * 260,
            gain: 0.0015 + effectiveIntensity * 0.004,
            filterType: 'bandpass',
            freq: 400 + rng() * 700,
            q: 1.1,
            reverbSend: 0.22,
          });
        }, 6000, 16000);
      }

      // Slow evolution: shift base filters over time so it doesn't feel looped.
      const evolve = () => {
        if (syntheticNodesRef.current.length === 0) return;
        const now = ctx.currentTime;
        const drift = 0.85 + rng() * 0.4;
        baseLow.frequency.setTargetAtTime((profile === 'CITY' ? 280 : 170) * drift, now, 2.5);
        baseAir.frequency.setTargetAtTime((profile === 'NATURE' ? 3200 : (profile === 'CAFE' ? 2400 : (profile === 'CITY' ? 2800 : 2200))) * drift, now, 3.5);
        schedule(evolve, 12000 + rng() * 14000);
      };
      schedule(evolve, 8000);

      syntheticNodesRef.current = nodes;
      masterGain.gain.setValueAtTime(0, ctx.currentTime);
      masterGain.gain.linearRampToValueAtTime(ambienceVolume, ctx.currentTime + 3);
    } catch (e) { console.error(e); }
  };

  const stopSyntheticAmbience = () => {
    syntheticTimersRef.current.forEach(id => {
      try { window.clearTimeout(id); } catch (e) { }
    });
    syntheticTimersRef.current = [];

    if (duckingRafRef.current) {
      cancelAnimationFrame(duckingRafRef.current);
      duckingRafRef.current = null;
    }

    syntheticNodesRef.current.forEach(n => {
      try { if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) n.stop(); n.disconnect(); } catch (e) { }
    });
    syntheticNodesRef.current = [];
  };

  const duckingBiasRef = useRef(0);
  useEffect(() => {
    duckingBiasRef.current = ambiencePreset.duckingBias ?? 0;
  }, [ambiencePreset.duckingBias]);

  const startDuckingLoop = () => {
    const ctx = syntheticCtxRef.current;
    const analyser = speechAnalyserRef.current;
    const duckGain = syntheticDuckGainRef.current;
    if (!ctx || !analyser || !duckGain) return;

    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const speechLevel = clamp01((rms - 0.02) / 0.22);
      const duckSetting = clamp01(ambienceDuckingRef.current + duckingBiasRef.current);
      const duck = duckSetting * speechLevel;
      const target = Math.max(0, 1 - 0.85 * duck);
      duckGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);

      duckingRafRef.current = requestAnimationFrame(tick);
    };

    if (duckingRafRef.current) cancelAnimationFrame(duckingRafRef.current);
    duckingRafRef.current = requestAnimationFrame(tick);
  };

  // --- DIALOGUE SPATIALIZATION ---
  const setupSpeechProcessing = (audioElement: HTMLAudioElement) => {
    try {
      if (!syntheticCtxRef.current) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        syntheticCtxRef.current = new AudioContextClass();
      }
      const ctx = syntheticCtxRef.current!;

      if (speechSourceNodeRef.current) {
        return { source: speechSourceNodeRef.current };
      }

      const source = ctx.createMediaElementSource(audioElement);
      speechSourceNodeRef.current = source;
      const profile = env;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-18, ctx.currentTime);
      comp.ratio.setValueAtTime(4, ctx.currentTime);

      const rGain = ctx.createGain();
      rGain.gain.value = profile === "CAFE" ? 0.22 : (profile === "ROOM" ? 0.16 : 0.06);

      const dly = ctx.createDelay();
      dly.delayTime.value = profile === "CAFE" ? 0.045 : 0.032;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = profile === "OFFICE" ? 2200 : 1300;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.85;
      speechAnalyserRef.current = analyser;
      // Ensure analyser branch is in the graph without adding audible output.
      const mute = ctx.createGain();
      mute.gain.value = 0;

      source.connect(comp); comp.connect(ctx.destination);
      comp.connect(dly); dly.connect(f); f.connect(fb); fb.connect(dly); f.connect(rGain); rGain.connect(ctx.destination);

      comp.connect(analyser);
      analyser.connect(mute);
      mute.connect(ctx.destination);

      return { comp, rGain, source };
    } catch (e) { return null; }
  };

  const onTimeUpdate = () => { if (speechRef.current) setCurrentTime(speechRef.current.currentTime); };
  const onLoadedMetadata = () => {
    if (speechRef.current) {
      setDuration(speechRef.current.duration);
      speechRef.current.playbackRate = playbackRate;
      setupSpeechProcessing(speechRef.current);
      startDuckingLoop();
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

    if (duckingRafRef.current) {
      cancelAnimationFrame(duckingRafRef.current);
      duckingRafRef.current = null;
    }
  };

  const togglePlay = () => {
    if (!speechRef.current) return;
    if (isPlaying) { speechRef.current.pause(); fadeOut(); }
    else {
      speechRef.current.play();
      initSyntheticAmbience();
      startDuckingLoop();
    }
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
    speechRef.current.play(); stopSyntheticAmbience(); initSyntheticAmbience(); startDuckingLoop();
    setIsPlaying(true);
  };

  const formatTime = (t: number) => {
    if (isNaN(t)) return "00:00";
    const m = Math.floor(t / 60); const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // If the scene changes while playing, refresh ambience with the new profile.
  useEffect(() => {
    if (!isPlaying) return;
    initSyntheticAmbience();
    startDuckingLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioLabel, scenarioActionLabel, topic, ambientKeywords, explicitQuery, ambienceIntensity]);

  if (error) return (
    <div className="w-full h-24 border border-red-900 bg-red-950/10 flex items-center justify-center font-mono text-red-500 text-xs uppercase">
      Falló Sistema // {error}
    </div>
  );

  // `env` is already computed from the preset.

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
              <div className="flex items-center gap-2 group">
                <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Int</span>
                <input type="range" min="0" max="1.0" step="0.05" value={ambienceIntensity} onChange={(e) => setAmbienceIntensity(parseFloat(e.target.value))} className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" title="Intensidad Ambiente" />
              </div>
              <div className="flex items-center gap-2 group">
                <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Duck</span>
                <input type="range" min="0" max="1.0" step="0.05" value={ambienceDucking} onChange={(e) => setAmbienceDucking(parseFloat(e.target.value))} className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" title="Ducking (reduce ambiente cuando hay voz)" />
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
