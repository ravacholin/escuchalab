
import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Activity, Waves, Radio, Sparkles, CloudDownload, Loader2 } from 'lucide-react';
import { TopicEnum } from '../types';

interface AudioPlayerProps {
  speechSrc: string; // Base64 raw PCM
  recommendedSpeed?: number;
  topic?: string;
  explicitQuery?: string; // New prop for AI-generated English keywords
  hideTrackInfo?: boolean; // New prop to hide source metadata (spoilers)
}

// ----------------------------------------------------------------------
// FREESOUND CONFIGURATION
// ----------------------------------------------------------------------

// API Key (Client Secret) - Loaded from environment variables
const API_KEY = import.meta.env.VITE_FREESOUND_API_KEY || "UyddwR1Kqoj3J1tSagw6oLTBKETViLioFdGjF0Nl"; 

const BASE_URL = "https://freesound.org/apiv2/search/text/";

// DISABLE FREESOUND: Set to true if CDN is blocked by network
const DISABLE_FREESOUND = false; // Try Freesound API

// Diagnostic function to test API and CDN accessibility
const testFreesoundApi = async () => {
    try {
        const testUrl = `${BASE_URL}?query=test&fields=id,name,previews&page_size=5&token=${API_KEY}`;
        console.log('[Freesound Diagnostic] Testing API with URL:', testUrl);

        const res = await fetch(testUrl);
        console.log('[Freesound Diagnostic] API Response Status:', res.status);

        if (!res.ok) {
            if (res.status === 401) {
                console.error('[Freesound Diagnostic] ❌ API Key is INVALID or EXPIRED');
                console.error('[Freesound Diagnostic] Please get a new key from: https://freesound.org/apiv2/apply');
                return false;
            }
            const errText = await res.text();
            console.error('[Freesound Diagnostic] API Error:', res.status, errText);
            return false;
        }

        const data = await res.json();
        console.log('[Freesound Diagnostic] ✅ API Key is VALID');
        console.log('[Freesound Diagnostic] Results returned:', data.results?.length || 0);

        if (data.results && data.results.length > 0) {
            const firstSound = data.results[0];
            console.log('[Freesound Diagnostic] Sample preview URL:', firstSound.previews?.['preview-hq-mp3']);

            // Test if preview URL is accessible
            if (firstSound.previews?.['preview-hq-mp3']) {
                const previewUrl = firstSound.previews['preview-hq-mp3'];
                console.log('[Freesound Diagnostic] Testing CDN access to:', previewUrl);

                try {
                    const cdnTest = await fetch(previewUrl, { method: 'HEAD' });
                    console.log('[Freesound Diagnostic] CDN Response Status:', cdnTest.status);

                    if (cdnTest.ok) {
                        console.log('[Freesound Diagnostic] ✅ CDN is ACCESSIBLE');
                        return true;
                    } else {
                        console.warn('[Freesound Diagnostic] ⚠️ CDN returned error:', cdnTest.status);
                        return false;
                    }
                } catch (cdnError) {
                    console.error('[Freesound Diagnostic] ❌ CDN is UNREACHABLE from your network');
                    console.error('[Freesound Diagnostic] Error:', cdnError);
                    console.error('[Freesound Diagnostic] This is a network/firewall blocking issue, not a code issue');
                    return false;
                }
            }
        }

        return true;
    } catch (error) {
        console.error('[Freesound Diagnostic] Test failed:', error);
        return false;
    }
};

// Helper: Map Spanish topics to English queries
const mapTopicToEnglishQuery = (topic?: string): string => {
  if (!topic) return "room tone";
  const t = topic.toLowerCase();

  // Transport
  if (t.match(/\b(tren|metro|subte|ferrocarril|vagón|estación|andén)\b/)) return "train station"; 
  if (t.match(/\b(aeropuerto|terminal|avión|vuelo|despegue)\b/)) return "airport ambience";
  if (t.match(/\b(coche|auto|conducir|taxi|uber|carro|tráfico|semáforo)\b/)) return "city traffic";
  if (t.match(/\b(autobús|bus|colectivo|guagua)\b/)) return "bus interior";
  
  // City / Street
  if (t.match(/\b(calle|avenida|ciudad|paseo|plaza|centro|direcciones)\b/)) return "city street";

  // Social / Crowd
  if (t.match(/\b(bar|pub|cervecería|tasca|copas|discoteca|antro|fiesta)\b/)) return "bar crowd";
  if (t.match(/\b(restaurante|comida|cena|café|bistro|desayuno|almuerzo)\b/)) return "restaurant busy";
  if (t.match(/\b(tienda|compras|mercado|super|supermercado|shopping)\b/)) return "supermarket"; 
  if (t.match(/\b(social|amigos|reunión|cumpleaños|gente)\b/)) return "people talking"; 

  // Work / Focus
  if (t.match(/\b(trabajo|oficina|negocios|jefe|despacho|banco|reunión)\b/)) return "office ambience";
  if (t.match(/\b(médico|doctor|hospital|salud|enfermera|consulta|clínica|farmacia)\b/)) return "hospital waiting room";
  if (t.match(/\b(biblioteca|escuela|clase|aula|universidad|silencio)\b/)) return "library ambience";

  // Nature
  if (t.match(/\b(parque|jardín|campo|bosque|pájaro)\b/)) return "park birds";
  if (t.match(/\b(playa|mar|océano|costa|arena)\b/)) return "ocean waves"; 
  if (t.match(/\b(lluvia|tormenta|trueno|llover)\b/)) return "rain window";

  // Home / Cozy
  if (t.match(/\b(casa|hogar|familia|sofá|salón|habitación|hotel|recepción|lobby)\b/)) return "room tone";

  return "ambience"; 
};

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

// Helper to force HTTPS on URLs to avoid mixed content blocking
const forceHttps = (url: string) => {
    if (!url) return url;
    if (url.startsWith("http://")) {
        return url.replace("http://", "https://");
    }
    return url;
};

const SPEEDS = [0.8, 1.0, 1.1, 1.25, 1.4, 1.5];

const AudioPlayer: React.FC<AudioPlayerProps> = ({ speechSrc, recommendedSpeed = 1.0, topic, explicitQuery, hideTrackInfo = false }) => {
  // Channel 1: Speech
  const speechRef = useRef<HTMLAudioElement | null>(null);
  
  // Channel 2: Ambience (HTML5 Audio from Freesound)
  const ambienceRef = useRef<HTMLAudioElement | null>(null);
  
  // Channel 3: Ambience Fallback (Web Audio API - Generative)
  const syntheticCtxRef = useRef<AudioContext | null>(null);
  const syntheticGainRef = useRef<GainNode | null>(null);
  const syntheticNodesRef = useRef<AudioNode[]>([]); 

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speechUrl, setSpeechUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(recommendedSpeed);
  
  // Settings & State
  const [ambienceVolume, setAmbienceVolume] = useState(0.40);
  const [usingSyntheticAmbience, setUsingSyntheticAmbience] = useState(false);
  const [ambienceUrl, setAmbienceUrl] = useState<string | null>(null);
  const [isLoadingAmbience, setIsLoadingAmbience] = useState(false);
  const [ambienceName, setAmbienceName] = useState<string>("");

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

  // ----------------------------------------------------------------------
  // ROBUST FREESOUND FETCHING LOGIC (URL PARAM AUTH)
  // ----------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    // --- Search Helper using URL Parameter Auth (Most Robust) ---
    const searchApi = async (query: string, strategy: 'quality' | 'popular' | 'generic') => {
        try {
            const fields = "id,name,previews,duration,username,num_downloads,avg_rating";
            let sortParam = "";
            
            // Strategy determines sorting
            if (strategy === 'quality') sortParam = "&sort=rating_desc";
            if (strategy === 'popular') sortParam = "&sort=downloads_desc";
            // 'generic' uses default relevance sorting (no param)

            // AUTHENTICATION:
            // We append `&token=${API_KEY}` directly to the URL.
            // This is the standard way to authenticate public requests in Freesound APIv2.
            const url = `${BASE_URL}?query=${encodeURIComponent(query)}&fields=${fields}${sortParam}&page_size=30&token=${API_KEY}`;
            
            console.log(`[Freesound] Searching (${strategy}): "${query}"`);
            
            // Note: No headers object needed for URL Param auth
            const res = await fetch(url);

            if (!res.ok) {
                const errText = await res.text();
                // Specific Debugging for 401
                if (res.status === 401) {
                    console.error("FREESOUND AUTH ERROR (401): The API Key was rejected.");
                    console.error("CHECK: Did you copy the 'Client ID' (short) instead of the 'Client Secret' (long)?");
                    console.error("Current Key Length:", API_KEY.length);
                }
                throw new Error(`API Error ${res.status}: ${errText}`);
            }

            const data = await res.json();
            return data.results || [];
        } catch (e) {
            console.warn(`[Freesound] Search failed for "${query}" (${strategy})`, e);
            return [];
        }
    };

    const fetchAmbience = async () => {
        // Check if Freesound is disabled
        if (DISABLE_FREESOUND) {
            console.log('[Freesound] Disabled due to network restrictions. Using synthetic ambience.');
            setUsingSyntheticAmbience(true);
            setIsLoadingAmbience(false);
            return;
        }

        setAmbienceUrl(null);
        setUsingSyntheticAmbience(false);
        setIsLoadingAmbience(true);
        setAmbienceName("");

        // 1. Determine Search Terms
        const primaryTerm = (explicitQuery && explicitQuery.trim().length > 0) ? explicitQuery.trim() : "";
        const secondaryTerm = mapTopicToEnglishQuery(topic);
        const fallbackTerm = "ambience";

        // 2. Perform Cascading Search (3 Layers)
        let results = [];

        // Layer 1: Specific Term + High Quality (Rating)
        if (primaryTerm) {
            results = await searchApi(primaryTerm, 'quality');
            if (results.length === 0) {
                 // Try Popularity if Quality fails
                 results = await searchApi(primaryTerm, 'popular');
            }
        }

        // Layer 2: Mapped Term + Popularity (If Layer 1 failed)
        if (results.length === 0 && secondaryTerm !== primaryTerm) {
            console.log(`[Freesound] Falling back to category: "${secondaryTerm}"`);
            results = await searchApi(secondaryTerm, 'popular');
            if (results.length === 0) {
                // Try Relevance if Popularity fails
                results = await searchApi(secondaryTerm, 'generic');
            }
        }

        // Layer 3: "Ambience" + Popularity (Ultimate safety net)
        if (results.length === 0) {
             console.log(`[Freesound] Falling back to generic: "${fallbackTerm}"`);
             // For the ultimate fallback, use Relevance (generic) to ensure ANY result
             results = await searchApi(fallbackTerm, 'generic');
        }

        // 3. Process Results
        if (isMounted) {
            if (results.length > 0) {
                // Client-side filtering: 
                // We are very lenient now: 2s to 10mins.
                const validDurationItems = results.filter((item: any) => item.duration >= 2 && item.duration <= 600);
                const candidates = validDurationItems.length > 0 ? validDurationItems : results;

                // Pick a random one from the top 10 to ensure variety but relevance
                const maxIndex = Math.min(candidates.length, 10);
                const randomIndex = Math.floor(Math.random() * maxIndex);
                const sound = candidates[randomIndex];
                
                // ROBUST PREVIEW SELECTION: Try HQ, fall back to LQ
                let previewUrl = sound.previews['preview-hq-mp3'];
                if (!previewUrl) previewUrl = sound.previews['preview-lq-mp3'];
                if (!previewUrl) previewUrl = sound.previews['preview-hq-ogg']; // Rare but possible

                if (previewUrl) {
                    // FORCE HTTPS: Crucial for production/preview environments to avoid Mixed Content errors
                    setAmbienceUrl(forceHttps(previewUrl));
                    setAmbienceName(sound.name);
                    setIsLoadingAmbience(false);
                    return;
                }
            }
            
            // Final Fallback: Synthetic (Only if API is down or returns literally 0 items for "ambience")
            console.warn("[Freesound] All searches exhausted. Using Synthetic.");
            setUsingSyntheticAmbience(true);
            setIsLoadingAmbience(false);
        }
    };

    fetchAmbience();

    return () => { isMounted = false; };
  }, [topic, explicitQuery]);

  // Apply Ambience Volume
  useEffect(() => {
      // HTML5 Audio
      if (ambienceRef.current && !usingSyntheticAmbience) {
          ambienceRef.current.volume = ambienceVolume;
      }
      // Synthetic Audio
      if (syntheticGainRef.current && usingSyntheticAmbience) {
          syntheticGainRef.current.gain.setTargetAtTime(ambienceVolume, syntheticCtxRef.current?.currentTime || 0, 0.1);
      }
  }, [ambienceVolume, usingSyntheticAmbience]);

  // Cleanup Web Audio on unmount
  useEffect(() => {
      return () => {
          stopSyntheticAmbience();
          if (syntheticCtxRef.current && syntheticCtxRef.current.state !== 'closed') {
              syntheticCtxRef.current.close();
          }
      };
  }, []);

  // Run diagnostic on mount to test Freesound API and CDN
  useEffect(() => {
      testFreesoundApi();
  }, []);

  // --- SYNTHETIC AMBIENCE GENERATOR: "WARM ROOM TONE" (Not Sea/Wind) ---
  const initSyntheticAmbience = () => {
      try {
          if (!syntheticCtxRef.current) {
              const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
              syntheticCtxRef.current = new AudioContextClass();
              syntheticGainRef.current = syntheticCtxRef.current!.createGain();
              syntheticGainRef.current!.connect(syntheticCtxRef.current!.destination);
          }

          if (syntheticCtxRef.current!.state === 'suspended') {
              syntheticCtxRef.current!.resume();
          }

          const ctx = syntheticCtxRef.current!;
          const masterGain = syntheticGainRef.current!;
          const nodes: AudioNode[] = [];

          // 1. BROWN NOISE GENERATOR (Warm, deep rumble - unlike Pink/White hiss)
          const bufferSize = 2 * ctx.sampleRate;
          const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const output = noiseBuffer.getChannelData(0);
          
          let lastOut = 0;
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            // Brown noise integration: (1/f^2 spectrum)
            lastOut = (lastOut + (0.02 * white)) / 1.02;
            // Adjust gain
            output[i] = lastOut * 3.5; 
          }

          const noiseSource = ctx.createBufferSource();
          noiseSource.buffer = noiseBuffer;
          noiseSource.loop = true;
          nodes.push(noiseSource);

          // 2. STATIC LOWPASS FILTER (Simulates walls/distance)
          // No LFO modulation to avoid "wave" or "swish" effect
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = 400; // Low frequency for muffled room tone
          filter.Q.value = 0.5;
          nodes.push(filter);

          noiseSource.connect(filter);
          filter.connect(masterGain);
          
          noiseSource.start();

          // 3. LOW FREQUENCY PRESENCE (Room Hum)
          // Adds body to the sound, like distant AC or city rumble, not waves
          const osc1 = ctx.createOscillator();
          osc1.type = "sine";
          osc1.frequency.value = 50; // Mains hum freq (European-ish)
          nodes.push(osc1);

          const osc2 = ctx.createOscillator();
          osc2.type = "sine";
          osc2.frequency.value = 52; // Slight beat frequency for phase movement (not wave)
          nodes.push(osc2);

          const droneGain = ctx.createGain();
          droneGain.gain.value = 0.05; // Very subtle
          nodes.push(droneGain);

          osc1.connect(droneGain);
          osc2.connect(droneGain);
          droneGain.connect(masterGain);

          osc1.start();
          osc2.start();

          syntheticNodesRef.current = nodes;

          // Fade In
          masterGain.gain.value = 0;
          masterGain.gain.linearRampToValueAtTime(ambienceVolume, ctx.currentTime + 2);
          
      } catch (e) {
          console.error("Synthetic Ambience Init Failed", e);
      }
  };

  const stopSyntheticAmbience = () => {
      if (syntheticNodesRef.current.length > 0) {
          syntheticNodesRef.current.forEach(node => {
              try {
                  if (node instanceof AudioBufferSourceNode || node instanceof OscillatorNode) {
                      node.stop();
                  }
                  node.disconnect();
              } catch (e) {}
          });
          syntheticNodesRef.current = [];
      }
  };

  // --- HTML5 AUDIO HANDLERS ---
  const onTimeUpdate = () => {
    if (speechRef.current) {
      setCurrentTime(speechRef.current.currentTime);
    }
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
    fadeOutAmbience();
  };

  const onAmbienceError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
      const target = e.currentTarget;
      const error = target.error;

      if (error) {
          const errorMap: Record<number, string> = {
              1: 'MEDIA_ERR_ABORTED',
              2: 'MEDIA_ERR_NETWORK',
              3: 'MEDIA_ERR_DECODE',
              4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
          };

          console.warn(`[Freesound] ${errorMap[error.code] || 'UNKNOWN'} (Code ${error.code})`);
          console.warn(`[Freesound] URL: ${target.src}`);
          console.warn(`[Freesound] CrossOrigin: ${target.crossOrigin}`);
          console.warn(`[Freesound] NetworkState: ${target.networkState}`);
      }

      console.warn('[Freesound] Switching to synthetic ambience fallback.');

      // Automatically switch to fallback
      setUsingSyntheticAmbience(true);
  };

  // --- MIXER LOGIC ---

  const fadeOutAmbience = () => {
    // HTML5 Fade Out
    if (ambienceRef.current && !usingSyntheticAmbience) {
        const fade = setInterval(() => {
            if (!ambienceRef.current) { clearInterval(fade); return; }
            if (ambienceRef.current.volume > 0.05) {
                ambienceRef.current.volume -= 0.05;
            } else {
                ambienceRef.current.volume = 0;
                ambienceRef.current.pause();
                clearInterval(fade);
            }
        }, 50);
    }

    // Synthetic Fade Out
    if (usingSyntheticAmbience && syntheticGainRef.current && syntheticCtxRef.current) {
        const now = syntheticCtxRef.current.currentTime;
        syntheticGainRef.current.gain.cancelScheduledValues(now);
        syntheticGainRef.current.gain.setValueAtTime(syntheticGainRef.current.gain.value, now);
        syntheticGainRef.current.gain.linearRampToValueAtTime(0, now + 1);
        setTimeout(() => stopSyntheticAmbience(), 1000);
    }
  };

  const fadeInAmbience = () => {
    // Synthetic
    if (usingSyntheticAmbience) {
        initSyntheticAmbience();
        return;
    }

    // HTML5
    if (!ambienceRef.current) return;
    ambienceRef.current.volume = 0;
    const playPromise = ambienceRef.current.play();
    
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        // Just log a string, do not log the error object if it's complex
        console.warn("Ambience auto-play prevented by browser policy.");
      });
    }

    const fade = setInterval(() => {
        if (!ambienceRef.current) { clearInterval(fade); return; }
        if (ambienceRef.current.volume < ambienceVolume) {
            const nextVol = ambienceRef.current.volume + 0.05;
            ambienceRef.current.volume = Math.min(nextVol, ambienceVolume);
        } else {
            clearInterval(fade);
        }
    }, 50);
  };

  const togglePlay = () => {
    if (!speechRef.current) return;
    
    if (speechRef.current.playbackRate !== playbackRate) {
        speechRef.current.playbackRate = playbackRate;
    }

    if (isPlaying) {
      speechRef.current.pause();
      fadeOutAmbience();
    } else {
      speechRef.current.play();
      if (!usingSyntheticAmbience && ambienceRef.current) {
        ambienceRef.current.currentTime = 0; 
      }
      fadeInAmbience();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!speechRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const newTime = percent * duration;
    
    speechRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const cycleSpeed = () => {
    const currentIndex = SPEEDS.indexOf(playbackRate);
    let matchIndex = currentIndex;
    if (currentIndex === -1) {
         matchIndex = SPEEDS.findIndex(s => Math.abs(s - playbackRate) < 0.01);
         if (matchIndex === -1) matchIndex = 1;
    }
    const nextIndex = (matchIndex + 1) % SPEEDS.length;
    setPlaybackRate(SPEEDS[nextIndex]);
  };

  const reset = () => {
    if (!speechRef.current) return;
    speechRef.current.currentTime = 0;
    setCurrentTime(0);
    speechRef.current.play();
    
    if (usingSyntheticAmbience) {
        stopSyntheticAmbience();
        initSyntheticAmbience();
    } else if (ambienceRef.current) {
        ambienceRef.current.currentTime = 0;
        ambienceRef.current.play();
        ambienceRef.current.volume = ambienceVolume;
    }

    setIsPlaying(true);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (error) {
     return (
        <div className="w-full h-24 border border-red-900 bg-red-950/10 flex items-center justify-center font-mono text-red-500 text-xs">
            FALLO_SISTEMA // {error}
        </div>
    )
  }

  return (
    <div className="border border-zinc-800 bg-black relative">
      
      {/* CHANNEL 1: SPEECH (Hidden) */}
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

      {/* CHANNEL 2: AMBIENCE (Hidden, Loop) */}
      {ambienceUrl && !usingSyntheticAmbience && (
        <audio
            ref={ambienceRef}
            src={ambienceUrl}
            key={ambienceUrl} /* Forces re-mount if URL changes */
            loop
            preload="auto"
            crossOrigin="anonymous"
            referrerPolicy="origin"
            onError={onAmbienceError}
        />
      )}

      {/* Main Grid Interface */}
      <div className="grid grid-cols-[1fr_auto] border-b border-zinc-800">
          {/* Timeline & Info */}
          <div className="flex flex-col">
               {/* Timeline */}
               <div 
                    className="h-12 bg-zinc-950 relative cursor-pointer group border-b border-zinc-800 overflow-hidden"
                    onClick={handleSeek}
                >
                    {/* Progress Bar */}
                    <div 
                        className="h-full bg-white absolute top-0 left-0 pointer-events-none transition-all duration-75 linear mix-blend-difference"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                    
                    {/* Time Display Overlay */}
                    <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
                         <span className="font-mono text-xs text-zinc-500 group-hover:text-white transition-colors">{formatTime(currentTime)}</span>
                         <span className="font-mono text-xs text-zinc-500 group-hover:text-white transition-colors">{formatTime(duration)}</span>
                    </div>

                    {/* Scanline effect */}
                    <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==')] opacity-20 pointer-events-none"></div>
               </div>

               {/* Meta Data Row */}
               <div className="flex items-center justify-between px-4 py-3 bg-black">
                   <div className="flex items-center gap-2">
                        {isLoadingAmbience ? (
                            <Loader2 size={14} className="text-zinc-500 animate-spin" />
                        ) : usingSyntheticAmbience ? (
                            <Sparkles size={14} className="text-zinc-300 animate-pulse" />
                        ) : (
                            <Activity size={14} className={`text-zinc-500 ${isPlaying ? 'animate-pulse text-zinc-200' : ''}`} />
                        )}
                        
                        <div className="flex flex-col">
                            <span className={`font-mono text-[10px] uppercase tracking-widest transition-colors ${
                                isLoadingAmbience ? 'text-zinc-400 animate-pulse' : 
                                usingSyntheticAmbience ? 'text-zinc-300' : 'text-zinc-500'
                            }`}>
                                {isLoadingAmbience 
                                    ? 'BUSCANDO FREESOUND...' 
                                    : usingSyntheticAmbience 
                                        ? 'RUIDO SALA (SINTÉTICO)' 
                                        : (isPlaying ? 'FREESOUND ACTIVO' : 'SISTEMA STANDBY')}
                            </span>
                            {!usingSyntheticAmbience && !isLoadingAmbience && ambienceName && !hideTrackInfo && (
                                <span className="font-mono text-[8px] uppercase text-zinc-700 max-w-[150px] truncate hidden sm:block">
                                    SRC: {ambienceName}
                                </span>
                            )}
                        </div>
                   </div>
                   <div className="flex items-center gap-4">
                        {/* Mixer Control (Ambience Volume) */}
                        <div className="flex items-center gap-2 group">
                             {usingSyntheticAmbience ? (
                                 <Radio size={12} className="text-zinc-300" />
                             ) : (
                                 <Waves size={12} className={ambienceVolume > 0 ? "text-zinc-300" : "text-zinc-700"} />
                             )}
                             <input 
                                type="range" 
                                min="0" 
                                max="1.0" 
                                step="0.05" 
                                value={ambienceVolume}
                                onChange={(e) => setAmbienceVolume(parseFloat(e.target.value))}
                                className={`w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 
                                    ${usingSyntheticAmbience ? '[&::-webkit-slider-thumb]:bg-white' : '[&::-webkit-slider-thumb]:bg-white'}
                                `}
                                title="Volumen Ambiente"
                             />
                        </div>
                        <div className="w-[1px] h-3 bg-zinc-800"></div>
                        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-700">
                             <span className="text-white font-bold">VEL: {playbackRate}x</span>
                        </div>
                   </div>
               </div>
          </div>

          {/* Side Controls (Square) */}
          <div className="flex flex-col border-l border-zinc-800 w-16">
              <button 
                onClick={cycleSpeed}
                className="flex-1 border-b border-zinc-800 flex flex-col items-center justify-center hover:bg-white hover:text-black transition-colors group"
                title="Velocidad de reproducción"
              >
                  <span className="font-mono text-[10px] font-bold block">{playbackRate}x</span>
                  <span className="text-[8px] uppercase text-zinc-600 group-hover:text-black">Vel</span>
              </button>
          </div>
      </div>

      {/* Main Transport Controls */}
      <div className="grid grid-cols-2">
          <button 
            onClick={togglePlay}
            disabled={!speechUrl}
            className="h-16 flex items-center justify-center gap-2 border-r border-zinc-800 hover:bg-white hover:text-black transition-colors disabled:opacity-50 disabled:hover:bg-black disabled:hover:text-white group"
          >
            {isPlaying ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current" />}
            <span className="font-display font-bold uppercase tracking-wider text-sm">
                {isPlaying ? 'Parar' : 'Repr.'}
            </span>
          </button>
          
          <button 
            onClick={reset}
            disabled={!speechUrl}
            className="h-16 flex items-center justify-center gap-2 hover:bg-white hover:text-black transition-colors disabled:opacity-50 disabled:hover:bg-black disabled:hover:text-white text-zinc-400 hover:text-black"
          >
            <RotateCcw size={18} />
            <span className="font-mono text-xs uppercase tracking-widest">Inicio</span>
          </button>
      </div>
    </div>
  );
};

export default AudioPlayer;
