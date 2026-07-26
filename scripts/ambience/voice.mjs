// Babble synthesis — unintelligible but unmistakably human speech.
//
// This is the highest-leverage piece of the whole system. "There are people here" is
// the single strongest cue for a café, a market, an office or a waiting room, and it
// is the one the old engine got most wrong.
//
// What the old crowd generator did (components/AudioPlayer.tsx:565-642):
//   - all "voices" filtered ONE shared noise buffer, so they were perfectly
//     correlated and summed to a single comb-filtered hiss, not a crowd;
//   - each "formant" was a bandpass at Q=0.65, which is a gentle tilt, not a formant;
//   - the syllabic envelope was a sine of depth 0.35 modulating a gain of ~0.07, so
//     the gain went *negative* for most of each cycle — phase inversion, not silence.
//     Syllables therefore never articulated;
//   - the voiced component was a sawtooth at fixed pitch, forever.
// The result was, mathematically, filtered noise that breathes slightly. Which is
// what the user heard: "white noise homogéneo".
//
// What actually makes speech read as speech, in rough order of importance:
//   1. syllabic rhythm at 4-7 Hz with real silence in the gaps
//   2. two clearly separated formants (F1/F2) that MOVE between vowels
//   3. a pitched glottal source with jitter, so it's a voice and not a filter
//   4. phrase structure: a run of syllables, then a pause; someone else answers
//   5. many independent voices at different distances

import {
  TWO_PI, rand, randInt, pick, randNorm, forkRng,
  whiteNoise, filter, formantBank, sweptBandpass,
  normalizeRms, rms, scale, mix, applyDistance, panMono, convolve, dcBlock,
  VOWEL_FORMANTS, VOWELS,
} from './dsp.mjs';

// ---------------------------------------------------------------------------
// Glottal source
// ---------------------------------------------------------------------------

/**
 * Rosenberg glottal pulse train driven by a per-sample f0 signal.
 *
 * A sawtooth would alias badly and sounds like a synth; the Rosenberg model is the
 * standard cheap approximation of a real glottal flow derivative — smooth opening,
 * abrupt closure. The abrupt closure is what excites the formants.
 *
 * `jitter` is cycle-to-cycle period variation (real voices sit around 1-2%); without
 * it a synthetic voice sounds robotic even with correct formants.
 */
function glottalTrain(n, f0Signal, sampleRate, { rng, jitter = 0.018, shimmer = 0.06, openQuotient = 0.6 }) {
  const out = new Float32Array(n);
  let phase = 0;          // 0..1 within the current period
  let periodJitter = 1;
  let amp = 1;

  for (let i = 0; i < n; i++) {
    const f0 = Math.max(50, f0Signal[i]);
    const inc = (f0 * periodJitter) / sampleRate;
    phase += inc;
    if (phase >= 1) {
      phase -= 1;
      // New cycle: re-roll jitter and shimmer.
      periodJitter = 1 + randNorm(rng, 0, jitter);
      amp = 1 + randNorm(rng, 0, shimmer);
    }
    const t1 = openQuotient * 0.7;
    const t2 = openQuotient;
    let g;
    if (phase < t1) {
      g = 0.5 * (1 - Math.cos((Math.PI * phase) / t1));      // opening
    } else if (phase < t2) {
      g = Math.cos((Math.PI * (phase - t1)) / (2 * (t2 - t1))); // closing
    } else {
      g = 0;                                                  // closed phase
    }
    out[i] = (g - 0.35) * amp; // rough DC removal; dcBlock finishes the job
  }
  return dcBlock(out, sampleRate);
}

// ---------------------------------------------------------------------------
// Syllable planning
// ---------------------------------------------------------------------------

// Spanish is overwhelmingly CV. Consonant classes carry very different acoustics,
// and it is the alternation between them — not the choice of any one — that makes a
// stream sound like language rather than a drone.
const CONSONANTS = [
  { kind: 'plosive', closureMs: [35, 65], burstMs: [4, 10], hz: [1200, 3800], weight: 3 },   // p t k b d g
  { kind: 'fricative', closureMs: [0, 0], burstMs: [55, 110], hz: [3500, 7000], weight: 3 }, // s f j
  { kind: 'nasal', closureMs: [25, 50], burstMs: [0, 0], hz: [250, 400], weight: 2 },        // m n ñ
  { kind: 'liquid', closureMs: [0, 0], burstMs: [12, 28], hz: [900, 1800], weight: 2 },      // l r
  { kind: 'none', closureMs: [0, 0], burstMs: [0, 0], hz: [0, 0], weight: 2 },               // vowel-initial
];

function pickConsonant(rng) {
  const total = CONSONANTS.reduce((a, c) => a + c.weight, 0);
  let r = rng() * total;
  for (const c of CONSONANTS) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return CONSONANTS[CONSONANTS.length - 1];
}

/**
 * Plan one utterance: a run of syllables followed by a pause.
 *
 * Rates: Spanish runs ~5-7 syllables/second in casual speech, faster than English.
 * The pause matters as much as the speech — it's what lets a listener perceive
 * separate speakers taking turns rather than one continuous texture.
 */
function planPhrase(rng, { rateHz }) {
  const syllableCount = randInt(rng, 3, 9);
  const syllables = [];
  for (let i = 0; i < syllableCount; i++) {
    const cons = pickConsonant(rng);
    const vowel = pick(rng, VOWELS);
    const base = 1000 / rateHz;
    // Final syllable of a phrase lengthens — a real and very audible prosodic cue.
    const lengthen = i === syllableCount - 1 ? rand(rng, 1.3, 1.9) : 1;
    // Stressed syllables (roughly every 2-3) are longer and louder.
    const stressed = i > 0 && rng() < 0.35;
    syllables.push({
      consonant: cons,
      vowel,
      closureMs: rand(rng, cons.closureMs[0], cons.closureMs[1]),
      burstMs: rand(rng, cons.burstMs[0], cons.burstMs[1]),
      burstHz: cons.hz[0] > 0 ? rand(rng, cons.hz[0], cons.hz[1]) : 0,
      vowelMs: base * rand(rng, 0.5, 0.8) * lengthen * (stressed ? 1.35 : 1),
      level: stressed ? rand(rng, 0.9, 1.15) : rand(rng, 0.55, 0.85),
    });
  }
  return {
    syllables,
    pauseMs: rand(rng, 380, 2100),
  };
}

// ---------------------------------------------------------------------------
// One speaker
// ---------------------------------------------------------------------------

/**
 * Render a single person talking (with pauses) for `durationS`.
 *
 * Returns a mono buffer at full-ish level; callers place it in space.
 */
export function renderVoice(sampleRate, {
  durationS,
  rng,
  f0 = 120,            // mean fundamental
  formantScale = 1,    // >1 shortens the vocal tract (higher/smaller speaker)
  rateHz = 5.6,        // syllables per second
  startOffsetS = 0,
  talkRatio = 0.55,    // fraction of time this person is actually speaking
}) {
  const n = Math.floor(durationS * sampleRate);

  // Control signals, all at sample rate.
  const f0Sig = new Float32Array(n);
  const voiced = new Float32Array(n);   // voiced amplitude envelope
  const aspir = new Float32Array(n);    // fricative/aspiration envelope
  const fmt = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];

  // Default (rest) formants so the swept filters always have a sane target.
  const rest = VOWEL_FORMANTS.a.map(f => f * formantScale);
  for (let f = 0; f < 4; f++) fmt[f].fill(rest[f]);
  f0Sig.fill(f0);

  let cursor = Math.floor(startOffsetS * sampleRate);
  // Start mid-pause so voices don't all begin talking on sample 0.
  if (rng() < 0.5) cursor += Math.floor(rand(rng, 0, 1.5) * sampleRate);

  const write = (from, to, fn) => {
    const a = Math.max(0, Math.min(n, from));
    const b = Math.max(0, Math.min(n, to));
    for (let i = a; i < b; i++) fn(i, (i - a) / Math.max(1, b - a));
  };

  let guard = 0;
  while (cursor < n && guard++ < 20000) {
    const phrase = planPhrase(rng, { rateHz });

    // Declination: pitch drifts down across a phrase and resets at the next one.
    // This is the prosodic signature that says "a sentence just ended".
    const phraseTop = f0 * rand(rng, 1.02, 1.22);
    const phraseBottom = f0 * rand(rng, 0.78, 0.94);
    const phraseStart = cursor;
    const phraseSamples = phrase.syllables.reduce(
      (a, s) => a + Math.floor(((s.closureMs + s.burstMs + s.vowelMs) / 1000) * sampleRate), 0);

    for (const syl of phrase.syllables) {
      const closure = Math.floor((syl.closureMs / 1000) * sampleRate);
      const burst = Math.floor((syl.burstMs / 1000) * sampleRate);
      const vowelLen = Math.floor((syl.vowelMs / 1000) * sampleRate);

      // --- consonant closure: true silence. This is the beat of speech. ---
      if (closure > 0) {
        if (syl.consonant.kind === 'nasal') {
          // Nasals are voiced but heavily damped: low F1, almost no energy above it.
          write(cursor, cursor + closure, (i) => {
            voiced[i] = syl.level * 0.32;
            fmt[0][i] = 280 * formantScale;
            fmt[1][i] = 1100 * formantScale;
            fmt[2][i] = 2400 * formantScale;
            fmt[3][i] = 3200 * formantScale;
          });
        } else {
          write(cursor, cursor + closure, (i) => { voiced[i] = 0; aspir[i] = 0; });
        }
        cursor += closure;
      }

      // --- consonant burst / frication ---
      if (burst > 0 && syl.burstHz > 0) {
        write(cursor, cursor + burst, (i, t) => {
          // Plosives: sharp decay. Fricatives: sustained with soft edges.
          aspir[i] = syl.consonant.kind === 'plosive'
            ? syl.level * Math.exp(-t * 6) * 0.85
            : syl.level * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.5;
          if (syl.consonant.kind === 'liquid') voiced[i] = syl.level * 0.5;
        });
        cursor += burst;
      }

      // --- vowel nucleus ---
      const target = VOWEL_FORMANTS[syl.vowel].map(f => f * formantScale);
      const transition = Math.min(vowelLen * 0.45, Math.floor(0.045 * sampleRate));
      const prev = [fmt[0][Math.max(0, cursor - 1)], fmt[1][Math.max(0, cursor - 1)],
                    fmt[2][Math.max(0, cursor - 1)], fmt[3][Math.max(0, cursor - 1)]];
      write(cursor, cursor + vowelLen, (i, t) => {
        const local = i - cursor;
        // Formant transition into the vowel target: the movement is what the ear
        // parses as articulation. A static filter reads as a filter.
        const k = Math.min(1, local / Math.max(1, transition));
        const glide = k * k * (3 - 2 * k);
        for (let f = 0; f < 4; f++) fmt[f][i] = prev[f] + (target[f] - prev[f]) * glide;

        // Amplitude: 15 ms attack, plateau, 35 ms release to real zero.
        const attack = Math.min(1, local / Math.max(1, 0.015 * sampleRate));
        const remaining = vowelLen - local;
        const release = Math.min(1, remaining / Math.max(1, 0.035 * sampleRate));
        voiced[i] = syl.level * attack * release;
        aspir[i] = Math.max(aspir[i], syl.level * 0.035 * attack * release); // breathiness
      });
      cursor += vowelLen;
      if (cursor >= n) break;
    }

    // Pitch contour across the phrase just written.
    write(phraseStart, phraseStart + phraseSamples, (i, t) => {
      const decl = phraseTop + (phraseBottom - phraseTop) * t;
      // Micro-intonation: small accents on the syllable rate, plus slow vibrato.
      const wob = Math.sin(TWO_PI * rateHz * 0.5 * (i / sampleRate)) * f0 * 0.035
        + Math.sin(TWO_PI * 4.7 * (i / sampleRate)) * f0 * 0.012;
      f0Sig[i] = Math.max(60, decl + wob);
    });

    // --- pause between phrases ---
    // Scaled so the speaker's overall talk/silence ratio lands near `talkRatio`;
    // a room where everyone talks nonstop is exactly the wash we're trying to avoid.
    const pause = Math.floor((phrase.pauseMs / 1000) * sampleRate * (1 / Math.max(0.15, talkRatio) - 1));
    write(cursor, cursor + pause, (i) => { voiced[i] = 0; aspir[i] = 0; });
    cursor += pause;
  }

  // --- source-filter synthesis ---
  const glottal = glottalTrain(n, f0Sig, sampleRate, { rng });
  const noise = whiteNoise(n, forkRng(rng, 'aspiration'));
  // Fricative noise is shaped high; /s/ lives at 4-8 kHz.
  const shapedNoise = filter(noise, { type: 'highpass', freq: 2200, q: 0.6, sampleRate });

  const source = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    source[i] = glottal[i] * voiced[i] + shapedNoise[i] * aspir[i] * 0.55;
  }

  let out = formantBank(source, fmt, sampleRate, { q: 11, amps: [1, 0.72, 0.32, 0.16] });

  // Lip radiation: roughly a differentiator (+6 dB/octave). Without it a synthetic
  // voice sounds muffled and chest-heavy.
  const radiated = new Float32Array(n);
  let prevSample = 0;
  for (let i = 0; i < n; i++) {
    radiated[i] = out[i] - 0.92 * prevSample;
    prevSample = out[i];
  }

  // Keep the band a human voice actually occupies.
  return filter(
    filter(radiated, { type: 'highpass', freq: 90, q: 0.7, sampleRate }),
    { type: 'lowpass', freq: Math.min(sampleRate * 0.47, 7500), q: 0.7, sampleRate },
  );
}

// ---------------------------------------------------------------------------
// A crowd
// ---------------------------------------------------------------------------

/**
 * Speaker archetypes. Female/child tracts are shorter, which raises formants as well
 * as pitch — scaling only the pitch produces the classic "chipmunk" artefact.
 */
const SPEAKERS = [
  { name: 'male', f0: [92, 138], formantScale: [0.94, 1.02], weight: 4 },
  { name: 'female', f0: [175, 235], formantScale: [1.12, 1.22], weight: 4 },
  { name: 'child', f0: [240, 320], formantScale: [1.28, 1.42], weight: 1 },
];

function pickSpeaker(rng, { childRatio = 0 }) {
  const pool = SPEAKERS.filter(s => s.name !== 'child' || rng() < childRatio);
  const total = pool.reduce((a, s) => a + s.weight, 0);
  let r = rng() * total;
  for (const s of pool) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return pool[0];
}

/**
 * Render a room full of people.
 *
 * @param voices        how many speakers. 8-14 reads as "a busy room"; 3-5 as "a
 *                      couple of conversations nearby".
 * @param distanceRange metres. Spreading speakers in depth is what turns a flat wall
 *                      of sound into a room you could point around in.
 * @param roomIR        optional [L, R] impulse response to place the crowd in a space.
 * @returns [L, R]
 */
export function renderBabble(sampleRate, {
  durationS,
  rng,
  voices = 10,
  distanceRange = [1.5, 12],
  rateRange = [4.6, 6.8],
  talkRatio = 0.5,
  childRatio = 0,
  roomIR = null,
  spread = 0.85,
}) {
  const n = Math.floor(durationS * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  for (let v = 0; v < voices; v++) {
    // Every speaker gets an INDEPENDENT rng stream. This is the fix for the central
    // flaw of the old generator: correlated voices sum to one voice, not a crowd.
    const vrng = forkRng(rng, `voice-${v}`);
    const archetype = pickSpeaker(vrng, { childRatio });

    const mono = renderVoice(sampleRate, {
      durationS,
      rng: vrng,
      f0: rand(vrng, archetype.f0[0], archetype.f0[1]),
      formantScale: rand(vrng, archetype.formantScale[0], archetype.formantScale[1]),
      rateHz: rand(vrng, rateRange[0], rateRange[1]),
      startOffsetS: rand(vrng, 0, durationS * 0.4),
      talkRatio,
    });

    // Nearer speakers are fewer and louder; the crowd is mostly background. Squaring
    // a uniform draw biases toward the far end of the range.
    const u = vrng();
    const meters = distanceRange[0] + (distanceRange[1] - distanceRange[0]) * (u * u);
    const placed = applyDistance(mono, meters, sampleRate);

    // Distant voices also drift toward the centre, as real diffuse sound does.
    const panWidth = spread * (1 - Math.min(0.7, meters / (distanceRange[1] * 1.6)));
    const [l, r] = panMono(placed, rand(vrng, -panWidth, panWidth));
    for (let i = 0; i < n; i++) { left[i] += l[i]; right[i] += r[i]; }
  }

  if (roomIR) {
    const irL = roomIR[0];
    const irR = roomIR[1] ?? roomIR[0];
    // `circular` wraps the reverb tail back to the head so the loop point keeps its
    // ambience instead of dropping to a dry seam.
    const wetL = convolve(left, irL, { circular: true });
    const wetR = convolve(right, irR, { circular: true });
    const wet = 0.35;
    for (let i = 0; i < n; i++) {
      left[i] = left[i] * (1 - wet * 0.5) + wetL[i] * wet;
      right[i] = right[i] * (1 - wet * 0.5) + wetR[i] * wet;
    }
  }

  const level = Math.max(rms(left), rms(right));
  if (level > 0) {
    const g = Math.pow(10, -20 / 20) / level;
    return [scale(left, g), scale(right, g)];
  }
  return [left, right];
}

/**
 * A PA announcement: a voice pushed through a horn.
 *
 * Recognisable as "megafonía" without any intelligible words, because the *channel*
 * is the cue — narrow band, compressed, honky midrange resonance, slap echo off a
 * far wall.
 */
export function renderAnnouncement(sampleRate, { rng, durationS = 3.2, roomIR = null }) {
  const voice = renderVoice(sampleRate, {
    durationS,
    rng,
    f0: rand(rng, 150, 210),
    formantScale: rand(rng, 1.0, 1.15),
    rateHz: rand(rng, 4.2, 5.2),   // announcements are slower and more deliberate
    talkRatio: 0.85,
  });

  // Telephone/PA band.
  let out = filter(
    filter(voice, { type: 'highpass', freq: 380, q: 0.8, sampleRate }),
    { type: 'lowpass', freq: 3400, q: 0.8, sampleRate },
  );
  // Horn resonance.
  out = filter(out, { type: 'peaking', freq: 1750, q: 1.6, gainDb: 9, sampleRate });
  // Hard limiting, as every PA amplifier does.
  const peakLevel = Math.max(1e-6, rms(out) * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh((out[i] / peakLevel) * 2.2) * peakLevel;

  if (roomIR) {
    const wet = convolve(out, roomIR[0], { circular: true });
    for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.45 + wet[i] * 0.75;
  }
  return normalizeRms(out, -22);
}
