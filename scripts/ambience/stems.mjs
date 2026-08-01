// Stem recipes — the continuous textures baked into public/ambience/*.wav.
//
// ARCHITECTURE NOTE. The old system baked one monolithic file per EnvironmentProfile:
// five files, five scenes, and 30 of the 40 curated scenarios ended up sharing
// office.wav. Adding a scene meant adding ~2 MB of audio.
//
// Here we bake *reusable* stems instead, and the runtime mixes 2-4 of them per scene
// (see services/ambiencePresets.ts). A café is babble_close + kitchen + room_tone; a
// station is babble_hall + transit_hum; a market is babble_open + traffic_far. Twelve
// stems cover ~27 scenes, and adding a scene costs a few lines rather than megabytes.
//
// Discrete, identifying one-shots (a specific cup, a door, a passing car near the
// listener) stay live in the runtime engine so they never repeat with the loop. What
// gets baked here is what benefits from offline compute: multi-voice babble, room
// convolution, dense grain.

import {
  rand, randInt, forkRng, mulberry32, hashStringToSeed,
  whiteNoise, pinkNoise, brownNoise, filter, filterChain,
  mix, scale, addAt, normalizeRms, rms, peak, softClip,
  envelopeSwell, applyEnvelope, applyDistance, panMono, convolve,
  renderIR, poissonTimes, makeSeamlessLoop, decorrelate, dcBlock, octaveConcentration,
} from './dsp.mjs';

import { renderBabble, renderAnnouncement } from './voice.mjs';

import {
  impact, impactPair, footstep, footstepRun, vehiclePass, trafficWash, honk, siren,
  doorLatch, doorChime, registerBeep, keyboardKey, typingBurst, paperRustle,
  printerPass, chairScrape, cashDrawer, sizzle, steamHiss, grinder,
  rain as rainEvent, windGust, leafRustle, bird,
  hvac, mainsHum, cabinRumble, motorCycle, luggageWheels,
  phoneRing, compressor, impactWrench, weightClank, applause, laugh, creak,
} from './events.mjs';

export const CROSSFADE_SECONDS = 2.5;

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

/** Scatter a one-shot generator across a stereo pair at Poisson-distributed times. */
function scatterStereo([left, right], sampleRate, {
  rng, durationS, ratePerSecond, make, gain = 1, panRange = 0.8, distanceRange = null, burst = 0,
}) {
  const times = poissonTimes(durationS, ratePerSecond, rng, { burst });
  for (const t of times) {
    let buf = make(rng);
    if (!buf || buf.length === 0) continue;
    if (distanceRange) {
      buf = applyDistance(buf, rand(rng, distanceRange[0], distanceRange[1]), sampleRate);
    }
    const [l, r] = panMono(buf, rand(rng, -panRange, panRange));
    const at = Math.floor(t * sampleRate);
    addAt(left, l, at, gain);
    addAt(right, r, at, gain);
  }
}

/** Same, mono. */
function scatterMono(dst, sampleRate, {
  rng, durationS, ratePerSecond, make, gain = 1, distanceRange = null, burst = 0,
}) {
  const times = poissonTimes(durationS, ratePerSecond, rng, { burst });
  for (const t of times) {
    let buf = make(rng);
    if (!buf || buf.length === 0) continue;
    if (distanceRange) {
      buf = applyDistance(buf, rand(rng, distanceRange[0], distanceRange[1]), sampleRate);
    }
    addAt(dst, buf, Math.floor(t * sampleRate), gain);
  }
}

const stereoPair = (n) => [new Float32Array(n), new Float32Array(n)];

function addPairInto([dl, dr], [sl, sr], gain = 1) {
  for (let i = 0; i < dl.length; i++) { dl[i] += sl[i] * gain; dr[i] += sr[i] * gain; }
  return [dl, dr];
}

/** Apply a slow breathing contour to a stereo pair. */
function swellStereo([l, r], sampleRate, { rng, depthDb }) {
  const env = envelopeSwell(l.length, sampleRate, { depthDb, rng });
  return [applyEnvelope(l, env), applyEnvelope(r, env)];
}


/**
 * Fill a stem's weakest octaves until no single one dominates it.
 *
 * A place is broadband: it has a floor, a body and some air, because it is made of
 * many objects and a volume of moving air. A synthesised texture is not, because it
 * is made of one or two generators — `office_life` is keystrokes and paper, which
 * both live at 1-2 kHz, and it measured 72% of its energy inside that one octave.
 * `check:ambience` rejects that, and it is right to: a stem concentrated in one
 * octave reads as an effect, not as somewhere you are standing.
 *
 * Tuning this by hand is a loop of guesses — and worse, of guesses measured with a
 * different instrument than the one that judges the result. This drives the fill from
 * `octaveConcentration()` itself, the exact function `check:ambience` uses, and raises
 * the floor until the measurement passes. The fill carries a slow swell of its own: a
 * flat fill closes the gaps between events and destroys the loudness range, which is
 * the property that separates a place from noise.
 */
function fillSpectrum(buf, sampleRate, { rng, target = 0.44, depthDb = 7, maxRounds = 7 }) {
  const nyquist = sampleRate / 2;
  const centres = [];
  for (let f = 90; f < nyquist * 0.78; f *= 1.6) centres.push(f);
  const bandOf = (src, freq) => filter(src, { type: 'bandpass', freq, q: 1.1, sampleRate });

  const pink = pinkNoise(buf.length, forkRng(rng, 'spectrum-fill'));
  const env = envelopeSwell(buf.length, sampleRate, { depthDb, rng: forkRng(rng, 'fill-env') });
  const pinkBands = centres.map((f) => bandOf(pink, f));

  let out = Float32Array.from(buf);
  for (let round = 0; round < maxRounds; round++) {
    const { share } = octaveConcentration(out, sampleRate);
    if (share <= target) break;
    // Each round lifts the floor. Starting low keeps the stem's own shape where the
    // shape is already broad enough, and only the stubborn cases end up near flat.
    const floorRatio = 0.2 + round * 0.13;
    const energies = centres.map((f) => rms(bandOf(out, f)));
    const loudest = Math.max(...energies);
    if (loudest <= 0) break;
    const next = Float32Array.from(out);
    for (let i = 0; i < centres.length; i++) {
      const want = loudest * floorRatio;
      if (energies[i] >= want) continue;
      const have = rms(pinkBands[i]);
      if (have <= 0) continue;
      // Power-complement: supply only the shortfall, not the whole band.
      const need = Math.sqrt(Math.max(0, want * want - energies[i] * energies[i]));
      const g = need / have;
      for (let k = 0; k < next.length; k++) next[k] += pinkBands[i][k] * env[k] * g;
    }
    out = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The stems
//
// `targetRms` is chosen per stem so that recipe gains in ambiencePresets.ts are
// comparable across stems. Quiet-by-nature stems (room tone, studio) are baked
// quiet on purpose rather than being baked loud and turned down — that keeps their
// noise floor where it belongs.
// ---------------------------------------------------------------------------

export const STEMS = {
  // -------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------
  babble_close: {
    sampleRate: 16000,
    durationS: 18,
    channels: 2,
    targetRms: -26,
    // A café/restaurant/open-office interior: conversations at your table and a few
    // more around it, in a small live room.
    expect: { maxLowRatio: 0.25, minLoudnessRange: 6, maxOctaveShare: 0.48 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'small', rt60: 0.62, rng });
      const out = renderBabble(sampleRate, {
        durationS, rng, voices: 11,
        distanceRange: [1.2, 9],
        rateRange: [4.8, 6.9],
        talkRatio: 0.5,
        roomIR: ir,
        spread: 0.85,
      });

      // Movement and furniture — the small sounds that say the voices are attached to
      // bodies in a room rather than floating in a mix.
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.22,
        make: (r) => chairScrape(sampleRate, { rng: r }), gain: 0.16, distanceRange: [2, 7],
      });
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.5, burst: 0.5,
        make: (r) => footstep(sampleRate, { surface: 'tile', rng: r, strength: 0.5 }),
        gain: 0.1, distanceRange: [3, 12],
      });
      // A laugh or a raised voice cutting through, occasionally.
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.09,
        make: (r) => renderAnnouncement(sampleRate, { rng: r, durationS: rand(r, 0.5, 1.1) }),
        gain: 0.1, distanceRange: [4, 9], panRange: 0.9,
      });

      return swellStereo(out, sampleRate, { rng, depthDb: 6 });
    },
  },

  babble_hall: {
    sampleRate: 16000,
    durationS: 18,
    channels: 2,
    targetRms: -27,
    // Station concourse, airport, hospital lobby: many distant voices smeared by a
    // long reverberant tail. Individual words are never resolvable — that diffuseness
    // is exactly the cue for "large hard room".
    expect: { maxLowRatio: 0.3, minLoudnessRange: 5, maxOctaveShare: 0.48 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'hall', rt60: 2.4, damping: 0.25, rng });
      const out = renderBabble(sampleRate, {
        durationS, rng, voices: 15,
        distanceRange: [5, 30],
        rateRange: [4.4, 6.4],
        talkRatio: 0.45,
        childRatio: 0.15,
        roomIR: ir,
        spread: 0.95,
      });

      // Hard floor, hard shoes — the acoustic signature of a concourse.
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.55, burst: 0.75,
        make: (r) => footstepRun(sampleRate, {
          surface: 'tile', rng: r, steps: randInt(r, 4, 9), tempoHz: rand(r, 1.7, 2.2), strength: 0.7,
        }).buffer,
        gain: 0.2, distanceRange: [4, 18], panRange: 0.9,
      });
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.15,
        make: (r) => luggageWheels(sampleRate, { rng: r, durationS: rand(r, 2, 4.5) }),
        gain: 0.28, distanceRange: [3, 14],
      });
      // Ventilation fills the space between events; a big hall is never silent.
      const air = hvac(sampleRate, { rng, durationS, bladeHz: 0, warmth: 0.7 });
      const [al, ar] = decorrelate(air, sampleRate, { rng });
      addPairInto(out, [al, ar], 0.32);

      return swellStereo(out, sampleRate, { rng, depthDb: 5 });
    },
  },

  babble_open: {
    sampleRate: 16000,
    durationS: 18,
    channels: 2,
    targetRms: -26,
    // Market, plaza, terrace: voices outdoors. Almost no tail, so voices stay dry and
    // separate, and some of them are projecting rather than conversing.
    expect: { maxLowRatio: 0.28, minLoudnessRange: 6, maxOctaveShare: 0.48 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'outdoor', rt60: 0.35, rng });
      const out = renderBabble(sampleRate, {
        durationS, rng, voices: 13,
        distanceRange: [1.5, 22],
        rateRange: [4.8, 7.2],
        talkRatio: 0.55,
        childRatio: 0.25,
        roomIR: ir,
        spread: 1,
      });

      // Stallholders calling out: louder, slower, more projected than conversation.
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.16,
        make: (r) => renderAnnouncement(sampleRate, { rng: r, durationS: rand(r, 1.1, 2.6) }),
        gain: 0.16, distanceRange: [5, 20], panRange: 1,
      });
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.6, burst: 0.6,
        make: (r) => footstep(sampleRate, { surface: 'concrete', rng: r, strength: 0.6 }),
        gain: 0.12, distanceRange: [2, 10],
      });
      // Crates, boxes, produce being handled.
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.3, burst: 0.4,
        make: (r) => impact(sampleRate, { material: 'wood', rng: r, strength: rand(r, 0.3, 0.8) }),
        gain: 0.13, distanceRange: [3, 12],
      });

      return swellStereo(out, sampleRate, { rng, depthDb: 7 });
    },
  },

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------
  traffic_near: {
    sampleRate: 16000,
    durationS: 22,
    channels: 2,
    targetRms: -25,
    // A street with cars actually going past — Doppler, pan sweep, level arc. This is
    // the stem that carries the "I am standing on a road" information; the old CITY
    // bed was a static bandpass at 340 Hz and conveyed none of it.
    expect: { maxLowRatio: 0.45, minLoudnessRange: 8 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = stereoPair(n);

      // Close passes: sparse, loud, unmistakably moving.
      for (const t of poissonTimes(durationS, 0.38, rng, { burst: 0.35, burstGapS: [0.6, 1.8], burstMax: 2 })) {
        const [pl, pr] = vehiclePass(sampleRate, {
          rng,
          speedKmh: rand(rng, 28, 62),
          distanceM: rand(rng, 3.5, 11),
          heavy: rng() < 0.18,
          direction: rng() < 0.5 ? -1 : 1,
        });
        const at = Math.floor(t * sampleRate);
        addAt(out[0], pl, at, 0.9);
        addAt(out[1], pr, at, 0.9);
      }

      // Mid-distance flow so the gaps between close passes aren't empty.
      const [wl, wr] = trafficWash(sampleRate, { rng, durationS, density: 1.1 });
      addPairInto(out, [wl, wr], 0.55);

      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.055,
        make: (r) => honk(sampleRate, { rng: r, distanceM: rand(r, 8, 40) }), gain: 0.5, panRange: 0.9,
      });
      scatterStereo(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.55, burst: 0.7,
        make: (r) => footstep(sampleRate, { surface: 'asphalt', rng: r, strength: 0.55 }),
        gain: 0.09, distanceRange: [2, 8],
      });

      return swellStereo(out, sampleRate, { rng, depthDb: 5 });
    },
  },

  traffic_far: {
    sampleRate: 8000,
    durationS: 24,
    channels: 1,
    targetRms: -30,
    // City hum heard from a window or across a plaza: no resolvable vehicles, just the
    // low surge of a lot of them. Deliberately band-limited — 8 kHz sample rate is
    // plenty for something this dull, and it costs a third of the bytes.
    expect: { maxLowRatio: 0.72, minLoudnessRange: 3 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const [wl, wr] = trafficWash(sampleRate, { rng, durationS, density: 2.4 });
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) mono[i] = (wl[i] + wr[i]) * 0.5;

      const bed = filterChain(brownNoise(n, forkRng(rng, 'far-bed')), [
        { type: 'lowpass', freq: 420, q: 0.6 },
        { type: 'highpass', freq: 55, q: 0.6 },
      ], sampleRate);

      const out = mix([mono, bed], [1, 0.35]);
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.04,
        make: (r) => siren(sampleRate, { rng: r, distanceM: rand(r, 150, 400) }), gain: 1,
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.07,
        make: (r) => honk(sampleRate, { rng: r, distanceM: rand(r, 60, 160) }), gain: 1,
      });
      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 4, rng }));
    },
  },

  // -------------------------------------------------------------------------
  // Interiors
  // -------------------------------------------------------------------------
  kitchen: {
    sampleRate: 24000,
    durationS: 18,
    channels: 1,
    targetRms: -28,
    // Restaurant kitchen / café bar heard from the dining room. Dense, bright, and
    // almost entirely made of transients — the opposite of a noise bed. The `kitchen`
    // tag existed before and did nothing at all.
    expect: { maxLowRatio: 0.2, minLoudnessRange: 9 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = new Float32Array(n);

      // Crockery and cutlery, in the bursts of a real service.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.9, burst: 0.55,
        make: (r) => impactPair(sampleRate, { material: 'porcelain', rng: r, strength: rand(r, 0.3, 0.9) }),
        gain: 0.55, distanceRange: [1.5, 6],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.7, burst: 0.7,
        make: (r) => impact(sampleRate, { material: 'cutlery', rng: r, strength: rand(r, 0.25, 0.8) }),
        gain: 0.4, distanceRange: [1.5, 6],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.25,
        make: (r) => impact(sampleRate, { material: 'glass', rng: r, strength: rand(r, 0.2, 0.6) }),
        gain: 0.35, distanceRange: [2, 7],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.18,
        make: (r) => impact(sampleRate, { material: 'metal', rng: r, strength: rand(r, 0.2, 0.55) }),
        gain: 0.3, distanceRange: [3, 8],
      });

      // Cooking: pans, steam, the grinder.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.22,
        make: (r) => sizzle(sampleRate, { rng: r, durationS: rand(r, 1.2, 3.5), intensity: rand(r, 0.5, 1) }),
        gain: 0.75, distanceRange: [2, 5],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.1,
        make: (r) => steamHiss(sampleRate, { rng: r, durationS: rand(r, 2, 4.5) }),
        gain: 0.42, distanceRange: [2, 5],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.05,
        make: (r) => grinder(sampleRate, { rng: r, durationS: rand(r, 1.8, 3.2) }),
        gain: 0.4, distanceRange: [2, 6],
      });

      // Pans, pot lids and the chopping board.
      //
      // Without these the stem measured a 21-26 dB hole right across 250-1300 Hz,
      // with 45% of its energy at 2-4 kHz sitting on top of a lone 50 Hz motor. Every
      // object in it was a bright one — porcelain from 1400 Hz, cutlery from 2600,
      // glass from 2100 — so there was nothing in the register where a kitchen has
      // its body, and it read as tinkling rather than as a place where food is being
      // cooked.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.3, burst: 0.4,
        make: (r) => impact(sampleRate, { material: 'metal', rng: r, strength: rand(r, 0.35, 0.85) }),
        gain: 0.5, distanceRange: [2, 6],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.45, burst: 0.6,
        make: (r) => impact(sampleRate, { material: 'wood', rng: r, strength: rand(r, 0.3, 0.75) }),
        gain: 0.45, distanceRange: [2, 5],
      });

      // Extractor hood runs continuously underneath everything. The motor alone was a
      // 50 Hz hum with no air in it; a real hood is mostly the sound of moving air.
      const extractor = motorCycle(sampleRate, { rng, durationS, hz: rand(rng, 44, 62) });
      const airflow = filterChain(pinkNoise(n, forkRng(rng, 'hood-air')), [
        { type: 'bandpass', freq: 520, q: 0.5 },
        { type: 'highpass', freq: 130, q: 0.6 },
      ], sampleRate);
      for (let i = 0; i < n; i++) out[i] += extractor[i] * 0.4 + airflow[i] * 0.25;

      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 6, rng }));
    },
  },

  hvac_office: {
    sampleRate: 8000,
    durationS: 20,
    channels: 1,
    targetRms: -32,
    // Air handling plus the electrical hum of a lit office. Near-stationary ON PURPOSE
    // — this is the one texture that genuinely is stationary in the real world. It's
    // baked quiet and thin so it supports a scene without becoming it.
    expect: { maxLowRatio: 0.75, minLoudnessRange: 1.5 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const air = hvac(sampleRate, { rng, durationS, bladeHz: rand(rng, 21, 29), warmth: 0.45 });
      const hum = mainsHum(sampleRate, { durationS, fundamental: 50, level: 0.8 });
      const out = mix([air, hum], [1, 0.55]);

      // Very distant office life, well below the air — enough to say "there are
      // people somewhere", not enough to compete with the dialogue.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.1,
        make: (r) => printerPass(sampleRate, { rng: r }), gain: 0.16, distanceRange: [8, 20],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.22, burst: 0.3,
        make: (r) => typingBurst(sampleRate, { rng: r, keys: randInt(r, 4, 12) }),
        gain: 0.1, distanceRange: [6, 16],
      });
      // Depth raised from 2.5: shortening the material decays (a plate should not
      // ring for half a second) took the little variation these support stems had
      // with it, and their loudness-range margin was already the tightest in the set.
      // A real plant room's level does drift; this is that drift, not decoration.
      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 4, rng }));
    },
  },

  room_tone: {
    sampleRate: 8000,
    durationS: 18,
    channels: 1,
    targetRms: -36,
    // A quiet domestic room. Almost nothing: a little air, a little street through the
    // glass, a fridge, the building settling. Its job is to stop a scene sounding like
    // a dry studio recording — it should never be identifiable on its own.
    expect: { maxLowRatio: 0.8, minLoudnessRange: 2 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const air = hvac(sampleRate, { rng, durationS, warmth: 0.8 });
      const outside = filterChain(brownNoise(n, forkRng(rng, 'window')), [
        { type: 'lowpass', freq: 260, q: 0.6 },
        { type: 'highpass', freq: 45, q: 0.6 },
      ], sampleRate);
      const fridge = mainsHum(sampleRate, { durationS, fundamental: 50, level: 0.35 });
      const out = mix([air, outside, fridge], [0.5, 0.5, 0.4]);

      // The building settling. Deliberately sparse: raising the rate fills in the
      // quiet windows and so REDUCES the measured loudness range, which is the
      // opposite of what this stem needs — the range comes from the slow swell below.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.07,
        make: (r) => impact(sampleRate, { material: 'wood', rng: r, strength: rand(r, 0.08, 0.22) }),
        gain: 1, distanceRange: [3, 9],
      });
      // See the note on hvac_office: raised from 3 for the same reason.
      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 7, rng }));
    },
  },

  studio_tone: {
    sampleRate: 8000,
    durationS: 14,
    channels: 1,
    targetRms: -42,
    // An acoustically treated room: a broadcast studio or a podcast booth. Essentially
    // a noise floor and nothing else. RadioNews / PodcastInterview / Monologue lessons
    // used to fall through to the emptiest of the five old beds by accident; now they
    // get this one on purpose, and it is right for them.
    expect: { maxLowRatio: 0.85, minLoudnessRange: 1 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const floorNoise = filterChain(pinkNoise(n, rng), [
        { type: 'lowpass', freq: 900, q: 0.6 },
        { type: 'highpass', freq: 35, q: 0.6 },
      ], sampleRate);
      const hum = mainsHum(sampleRate, { durationS, fundamental: 50, level: 0.25 });
      return mix([floorNoise, hum], [0.6, 0.3]);
    },
  },

  transit_hum: {
    sampleRate: 12000,
    durationS: 20,
    channels: 1,
    targetRms: -28,
    // Inside a moving vehicle: bus, taxi, train, plane. Engine harmonics that wander
    // with the throttle, road roar, and the joints and potholes that make it a journey
    // rather than a drone.
    expect: { maxLowRatio: 0.82, minLoudnessRange: 3 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = cabinRumble(sampleRate, {
        rng, durationS, engineHz: rand(rng, 26, 38), road: 1,
      });

      // Engine and road noise alone come out almost entirely sub-250 Hz, which reads
      // as an undifferentiated rumble — you can't tell a bus from a plane from a
      // washing machine. What identifies a cabin is the stuff on top: the ventilation
      // blowing, wind past the window seals, and trim rattling over every joint.
      const vents = hvac(sampleRate, { rng, durationS, warmth: 0.3 });
      const windNoise = filterChain(pinkNoise(n, forkRng(rng, 'cabin-wind')), [
        { type: 'bandpass', freq: 1100, q: 0.5 },
      ], sampleRate);
      for (let i = 0; i < n; i++) out[i] += vents[i] * 0.55 + windNoise[i] * 0.35;

      // Bodywork and fittings rattling over the bumps.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.9, burst: 0.7,
        make: (r) => impact(sampleRate, { material: 'plastic', rng: r, strength: rand(r, 0.1, 0.3) }),
        gain: 1, distanceRange: [1, 3],
      });
      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 4, rng }));
    },
  },

  // -------------------------------------------------------------------------
  // Weather and outdoors
  // -------------------------------------------------------------------------
  rain: {
    sampleRate: 24000,
    durationS: 20,
    channels: 1,
    targetRms: -27,
    // Rain built from resolvable droplets and near drips, with squalls. Note this is
    // now the ONLY stem that should sound like rain — previously all five did.
    expect: { maxLowRatio: 0.12, minLoudnessRange: 8 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = rainEvent(sampleRate, { rng, durationS, intensity: 1 });
      // Distant thunder — rare and low. Kept quiet deliberately: over a 20 s loop a
      // prominent clap would recur every 20 seconds, which no listener would read as
      // weather, and its low-frequency energy would swamp the droplet detail that
      // makes this stem identifiable in the first place.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.018,
        make: (r) => {
          const len = Math.floor(rand(r, 2.5, 5) * sampleRate);
          const rumble = filterChain(brownNoise(len, r), [
            { type: 'lowpass', freq: rand(r, 110, 220), q: 0.7 },
            { type: 'highpass', freq: 55, q: 0.6 },
          ], sampleRate);
          const env = new Float32Array(len);
          for (let i = 0; i < len; i++) {
            const t = i / len;
            env[i] = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.4)), 1.5) * (1 - t * 0.5);
          }
          const o = new Float32Array(len);
          for (let i = 0; i < len; i++) o[i] = rumble[i] * env[i];
          return o;
        },
        gain: 0.35,
      });
      return out;
    },
  },

  wind_leaves: {
    sampleRate: 24000,
    durationS: 20,
    channels: 1,
    targetRms: -30,
    // A park or an open green space: gusts, foliage, birds. The old `nature` bed had
    // none of these — it was lowpassed pink plus bandpassed white, which is the
    // textbook recipe for rain, and duly sounded like it.
    expect: { maxLowRatio: 0.35, minLoudnessRange: 7 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = new Float32Array(n);

      // Overlapping gusts: wind is never a single event or a steady state.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.42,
        make: (r) => windGust(sampleRate, {
          rng: r, durationS: rand(r, 2.5, 6.5), strength: rand(r, 0.4, 1),
        }),
        gain: 1,
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.4,
        make: (r) => leafRustle(sampleRate, {
          rng: r, durationS: rand(r, 1.5, 4), strength: rand(r, 0.5, 1),
        }),
        gain: 1.1,
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.35, burst: 0.4,
        make: (r) => bird(sampleRate, { rng: r, distanceM: rand(r, 5, 30) }),
        gain: 0.8,
      });
      // A very faint low bed so the gaps between gusts aren't digital silence.
      const base = filterChain(pinkNoise(n, forkRng(rng, 'wind-base')), [
        { type: 'lowpass', freq: 500, q: 0.6 },
        { type: 'highpass', freq: 60, q: 0.6 },
      ], sampleRate);
      for (let i = 0; i < n; i++) out[i] += base[i] * 0.18;
      return out;
    },
  },
  // -------------------------------------------------------------------------
  // Character stems added to break up the support cluster.
  //
  // Measured before these existed: twelve stems covered 42 scenes, `room_tone`
  // appeared in 29 of them and `hvac_office` in 20 — between the two, half of every
  // stem layer in the catalogue. There were 22 distinct stem combinations for 42
  // scenes, one of them shared by 8, and 16 pairs of scenes whose stem sets matched
  // with gain differences under half a decibel. No amount of per-scene EQ fixes a
  // palette that small; at some point two places have to be made of different things.
  // -------------------------------------------------------------------------

  /**
   * A working office, as opposed to the air in an empty one.
   *
   * `hvac_office` is deliberately featureless and was carrying 20 scenes on its own,
   * so an office, an open-plan floor, a call centre and a newsroom differed only in
   * how much crowd was mixed over the same plant noise. This is the other half: the
   * work itself, at a distance, dense enough to be a texture rather than a set of
   * one-shots.
   */
  office_life: {
    sampleRate: 12000,
    durationS: 20,
    channels: 1,
    targetRms: -30,
    expect: { maxLowRatio: 0.4, minLoudnessRange: 6 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = new Float32Array(n);

      scatterMono(out, sampleRate, {
        // Work comes in bursts with real lulls between them; a steady sprinkle of
        // keystrokes measures as noise however broadband it is.
        rng, durationS, ratePerSecond: 0.5, burst: 0.75,
        make: (r) => typingBurst(sampleRate, { rng: r, keys: randInt(r, 6, 18) }),
        gain: 0.6, distanceRange: [1.5, 7],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.32, burst: 0.3,
        make: (r) => paperRustle(sampleRate, { rng: r }),
        gain: 0.45, distanceRange: [1.2, 5],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.1,
        make: (r) => printerPass(sampleRate, { rng: r }),
        gain: 0.4, distanceRange: [4, 12],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.07,
        make: (r) => phoneRing(sampleRate, { rng: r }),
        gain: 0.3, distanceRange: [6, 16],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.11,
        make: (r) => chairScrape(sampleRate, { rng: r }),
        gain: 0.38, distanceRange: [2, 8],
      });

      // Just enough plant noise to sit the transients in a room rather than in a void
      // — and deliberately spread across the spectrum. Keystrokes and paper both live
      // at 1-2 kHz, so without a body below and some air above, the stem measured 72%
      // of its energy inside that single octave and read as a typewriter, not a room.
      const air = hvac(sampleRate, { rng, durationS, bladeHz: rand(rng, 19, 26), warmth: 0.4 });
      for (let i = 0; i < n; i++) out[i] += air[i] * 0.22;

      // A deep swell on the fill: an office is not a steady hiss, it has lulls. With a
      // shallower one the spectral fill closed the gaps between keystrokes and the
      // stem measured 4.9 dB of loudness range — statistically, noise.
      const filled = fillSpectrum(out, sampleRate, { rng, depthDb: 16 });
      return applyEnvelope(filled, envelopeSwell(n, sampleRate, { depthDb: 7, rng }));
    },
  },

  /**
   * A concourse: public address you cannot make out, in a very large space.
   *
   * A station and an airport were `babble_hall` plus one support stem each, which is
   * why they measured 4.4 apart — the single most confusable pair in the catalogue.
   * The announcement is what actually says "transport hub", and it has to be
   * unintelligible: heavily lowpassed, smeared through a long tail, so it reads as
   * information being broadcast rather than as someone talking near you.
   */
  pa_concourse: {
    sampleRate: 12000,
    durationS: 22,
    channels: 1,
    targetRms: -30,
    expect: { maxLowRatio: 0.45, minLoudnessRange: 7 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const out = new Float32Array(n);
      const ir = renderIR(sampleRate, { size: 'hall', rt60: 3.2, damping: 0.22, rng, stereo: false });

      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.22,
        make: (r) => {
          const speech = renderAnnouncement(sampleRate, { rng: r, durationS: rand(r, 3, 6) });
          const mono = Array.isArray(speech) ? speech[0] : speech;
          // Through a ceiling horn, then through the building.
          const horn = filterChain(mono, [
            { type: 'bandpass', freq: 900, q: 0.32 },
            { type: 'lowpass', freq: 2400, q: 0.7 },
          ], sampleRate);
          return convolve(horn, ir[0] ?? ir, { circular: false });
        },
        gain: 0.85, distanceRange: [12, 40],
      });

      // The chime that precedes an announcement — the most recognisable single sound
      // in a station, and worth having even at this distance.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.08,
        make: (r) => convolve(doorChime(sampleRate, { rng: r }), ir[0] ?? ir, { circular: false }),
        gain: 0.22, distanceRange: [15, 45],
      });

      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.22,
        make: (r) => luggageWheels(sampleRate, { rng: r, durationS: rand(r, 2, 5) }),
        gain: 0.4, distanceRange: [4, 18],
      });

      // A concourse is never silent between announcements: the volume of air in it
      // is itself a sound. Without this the stem measured a 31 dB loudness range —
      // isolated bangs over nothing, which is the texture the whole rebuild was
      // meant to get away from.
      const air = hvac(sampleRate, { rng, durationS, bladeHz: 0, warmth: 0.6 });
      const wash = filterChain(pinkNoise(n, forkRng(rng, 'concourse-air')), [
        { type: 'lowpass', freq: 3200, q: 0.5 },
        { type: 'highpass', freq: 70, q: 0.6 },
      ], sampleRate);
      const rumble = filterChain(brownNoise(n, forkRng(rng, 'concourse-low')), [
        { type: 'lowpass', freq: 260, q: 0.6 },
      ], sampleRate);
      for (let i = 0; i < n; i++) out[i] += air[i] * 0.55 + wash[i] * 0.5 + rumble[i] * 0.55;

      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 5, rng }));
    },
  },

  /**
   * Hard tiled room: bright, reflective, and audibly empty.
   *
   * The clinics, the courtroom, the gallery, the bank and the hospital were all
   * `room_tone` — a stem written to be a quiet domestic room and explicitly "never
   * identifiable on its own". A tiled corridor is the opposite of domestic: it has no
   * absorption, so its air noise keeps its top end and the room rings.
   */
  tiled_corridor: {
    sampleRate: 12000,
    durationS: 18,
    channels: 1,
    targetRms: -34,
    expect: { maxLowRatio: 0.42, minLoudnessRange: 4 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'large', rt60: 1.9, damping: 0.15, rng, stereo: false });
      const air = hvac(sampleRate, { rng, durationS, bladeHz: rand(rng, 14, 22), warmth: 0.2 });
      const out = filterChain(air, [
        { type: 'highpass', freq: 150, q: 0.6 },
        { type: 'highshelf', freq: 2200, gainDb: 5, q: 0.7 },
      ], sampleRate);

      // Distant footsteps on tile, with the room's own tail on them. In a corridor
      // you hear people you cannot see, and you hear the corridor doing it.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.16,
        make: (r) => convolve(
          footstepRun(sampleRate, { surface: 'tile', rng: r, steps: randInt(r, 4, 9), tempoHz: rand(r, 1.6, 2.1) }).buffer,
          ir[0] ?? ir, { circular: false },
        ),
        gain: 0.34, distanceRange: [6, 22],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.09,
        make: (r) => convolve(doorLatch(sampleRate, { rng: r }), ir[0] ?? ir, { circular: false }),
        gain: 0.3, distanceRange: [8, 25],
      });
      // A tiled corridor is bright by definition: nothing in it absorbs. The air
      // alone put 77% of the stem inside one low-mid octave, which is the spectrum of
      // a duct rather than of a hard room.
      const hum = mainsHum(sampleRate, { durationS, fundamental: 50, level: 0.3 });
      for (let i = 0; i < n; i++) out[i] += hum[i] * 0.25;

      // Tilted up on the way in: nothing in a tiled corridor absorbs, so the fill
      // should leave it bright rather than merely broad.
      const bright = filterChain(
        fillSpectrum(out, sampleRate, { rng, depthDb: 6 }),
        [{ type: 'highshelf', freq: 1900, gainDb: 4, q: 0.7 }], sampleRate,
      );
      return applyEnvelope(bright, envelopeSwell(n, sampleRate, { depthDb: 5, rng }));
    },
  },

  /**
   * A lived-in home: the fridge, a clock, the street through double glazing, a
   * television two rooms away.
   *
   * `home` and `clinic_room` measured 2.4 apart — the second-closest pair in the
   * catalogue — because both were `room_tone` plus a little air. What makes a home
   * recognisable is not its quietness but its specific, slow, domestic events.
   */
  home_life: {
    sampleRate: 12000,
    durationS: 20,
    channels: 1,
    targetRms: -33,
    expect: { maxLowRatio: 0.6, minLoudnessRange: 5 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      // Fridge compressor: on for a long stretch, then off. The cycling is the point.
      const fridge = motorCycle(sampleRate, { rng, durationS, hz: rand(rng, 46, 58) });
      const fridgeEnv = new Float32Array(n);
      {
        let on = rng() < 0.6;
        let i = 0;
        while (i < n) {
          const runS = on ? rand(rng, 5, 11) : rand(rng, 4, 9);
          const runN = Math.min(n - i, Math.floor(runS * sampleRate));
          const ramp = Math.floor(0.35 * sampleRate);
          for (let k = 0; k < runN; k++) {
            const fade = Math.min(1, k / ramp, (runN - k) / ramp);
            fridgeEnv[i + k] = on ? Math.max(0, fade) : 0;
          }
          i += runN;
          on = !on;
        }
      }
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = fridge[i] * fridgeEnv[i] * 0.55;

      // Street through glass: everything above 700 Hz gone. `trafficWash` hands back a
      // stereo pair, so it is folded before filtering — passing the pair straight into
      // `filterChain` silently produces NaN rather than an error.
      const [washL, washR] = trafficWash(sampleRate, { rng, durationS, density: 1.4 });
      const washMono = new Float32Array(n);
      for (let i = 0; i < n; i++) washMono[i] = (washL[i] + washR[i]) * 0.5;
      const street = filterChain(washMono, [
        { type: 'lowpass', freq: 620, q: 0.6 },
        { type: 'highpass', freq: 55, q: 0.6 },
      ], sampleRate);
      // A television or a radio in another room: speech with no consonants left.
      const [tvL] = renderBabble(sampleRate, {
        durationS, rng: forkRng(rng, 'home-tv'), voices: 3,
        distanceRange: [9, 16], talkRatio: 0.65, spread: 0.2,
      });
      const tv = filterChain(tvL, [
        { type: 'lowpass', freq: 900, q: 0.6 },
        { type: 'highpass', freq: 180, q: 0.6 },
      ], sampleRate);
      for (let i = 0; i < n; i++) out[i] += street[i] * 0.3 + tv[i] * 0.22;

      // The clock, and the building.
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.12,
        make: (r) => impact(sampleRate, { material: 'wood', rng: r, strength: rand(r, 0.2, 0.5) }),
        gain: 0.3, distanceRange: [2, 6],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.06,
        make: (r) => creak(sampleRate, { rng: r }), gain: 0.28, distanceRange: [3, 8],
      });

      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 6, rng }));
    },
  },

  /**
   * A treated voice booth: small, dead, and with one room mode it cannot lose.
   *
   * The four studio scenes shared `studio_tone` + `room_tone` and, being below the
   * old bed floor, arrived at exactly the same level — so a radio booth, a podcast
   * table and an intimate narration were the same recording. A real booth is not
   * silence: it is a very small box, and small boxes have a strong low resonance and
   * almost no air above 3 kHz.
   */
  booth_tight: {
    sampleRate: 8000,
    durationS: 14,
    channels: 1,
    targetRms: -44,
    expect: { maxLowRatio: 0.85, minLoudnessRange: 1 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const base = filterChain(pinkNoise(n, forkRng(rng, 'booth')), [
        { type: 'lowpass', freq: 640, q: 0.6 },
        { type: 'highpass', freq: 32, q: 0.6 },
        // The box mode. A booth you have sat in has exactly this.
        { type: 'peaking', freq: 178, gainDb: 7, q: 7 },
      ], sampleRate);
      const hum = mainsHum(sampleRate, { durationS, fundamental: 50, level: 0.22 });
      const out = mix([base, hum], [0.7, 0.3]);
      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 1.6, rng }));
    },
  },

  /**
   * A working machine shop.
   *
   * `workshop_garage` was `hvac_office` + `transit_hum` — office air and a bus cabin.
   * Nothing in it was a workshop. This is: a compressor cycling, an impact wrench
   * somewhere across the floor, metal being handled, all in a hard room.
   */
  workshop_tools: {
    sampleRate: 12000,
    durationS: 18,
    channels: 1,
    targetRms: -28,
    expect: { maxLowRatio: 0.55, minLoudnessRange: 8 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'large', rt60: 1.7, damping: 0.18, rng, stereo: false });
      const out = new Float32Array(n);
      const room = (buf) => convolve(buf, ir[0] ?? ir, { circular: false });

      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.09,
        make: (r) => room(compressor(sampleRate, { rng: r, durationS: rand(r, 3, 6.5) })),
        gain: 0.55, distanceRange: [4, 12],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.12,
        make: (r) => room(impactWrench(sampleRate, { rng: r })),
        gain: 0.45, distanceRange: [5, 16],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.95, burst: 0.55,
        make: (r) => room(impact(sampleRate, { material: 'metal', rng: r, strength: rand(r, 0.3, 0.9) })),
        gain: 0.34, distanceRange: [2, 9],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.08,
        make: (r) => room(grinder(sampleRate, { rng: r, durationS: rand(r, 2, 4) })),
        gain: 0.4, distanceRange: [4, 12],
      });

      // A shop has a floor of plant noise under the work; without it the tools are
      // isolated bangs rather than a place where tools are being used.
      const extractor = motorCycle(sampleRate, { rng, durationS, hz: rand(rng, 34, 46) });
      const air = hvac(sampleRate, { rng, durationS, bladeHz: 0, warmth: 0.3 });
      for (let i = 0; i < n; i++) out[i] += extractor[i] * 0.62 + air[i] * 0.46;

      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 6, rng }));
    },
  },

  /**
   * A crowd heard across an open space, with no near voices at all.
   *
   * `babble_open` puts its nearest talkers 1.5 m away, which is right for a market
   * stall and wrong for a square, a park or an audience before a performance. Removing
   * the foreground entirely is what makes a crowd read as *over there*.
   */
  crowd_far: {
    sampleRate: 8000,
    durationS: 20,
    channels: 1,
    targetRms: -31,
    expect: { maxLowRatio: 0.5, minLoudnessRange: 5 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'outdoor', rt60: 0.95, damping: 0.55, rng, stereo: false });
      const [l, r] = renderBabble(sampleRate, {
        durationS, rng: forkRng(rng, 'crowd-far'), voices: 22,
        distanceRange: [22, 70], rateRange: [4.4, 6.4], talkRatio: 0.4, childRatio: 0.2, spread: 1,
      });
      const summed = new Float32Array(n);
      for (let i = 0; i < n; i++) summed[i] = (l[i] + r[i]) * 0.5;
      const out = convolve(
        filterChain(summed, [{ type: 'lowpass', freq: 3400, q: 0.6 }, { type: 'highpass', freq: 120, q: 0.6 }], sampleRate),
        ir[0] ?? ir, { circular: true },
      );
      // Open air around the crowd, so the stem is a place and not just voices.
      const openAir = fillSpectrum(out, sampleRate, { rng, depthDb: 8 });
      out.set(openAir);

      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.05,
        make: (r2) => applause(sampleRate, { rng: r2, durationS: rand(r2, 2.5, 5) }),
        gain: 0.22, distanceRange: [25, 60],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.07,
        make: (r2) => laugh(sampleRate, { rng: r2 }), gain: 0.3, distanceRange: [15, 40],
      });

      return applyEnvelope(out, envelopeSwell(n, sampleRate, { depthDb: 6, rng }));
    },
  },

  /**
   * A sports hall: shoes on a sprung floor, weights, and voices in a very live box.
   *
   * `gym` was `hvac_office` + a little `babble_close`, which measured within 4.5 of a
   * bank. What a gym sounds like is impact and squeak in a room with no soft surfaces.
   */
  sports_hall: {
    sampleRate: 12000,
    durationS: 18,
    channels: 1,
    targetRms: -29,
    expect: { maxLowRatio: 0.5, minLoudnessRange: 7 },
    render(n, rng, sampleRate) {
      const durationS = n / sampleRate;
      const ir = renderIR(sampleRate, { size: 'hall', rt60: 2.2, damping: 0.2, rng, stereo: false });
      const out = new Float32Array(n);
      // The tail of a live hall is overwhelmingly low-mid, and convolving every
      // impact through it put 73% of the stem inside one octave around 200 Hz. A hall
      // that big has no boundary close enough to support that band anyway.
      const room = (buf) => filterChain(
        convolve(buf, ir[0] ?? ir, { circular: false }),
        [{ type: 'highpass', freq: 220, q: 0.7 }], sampleRate,
      );

      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.8, burst: 0.5,
        make: (r) => room(footstepRun(sampleRate, {
          surface: 'tile', rng: r, steps: randInt(r, 3, 8), tempoHz: rand(r, 2.2, 3.1),
        }).buffer),
        gain: 0.32, distanceRange: [3, 14],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.2,
        make: (r) => room(weightClank(sampleRate, { rng: r })),
        gain: 0.5, distanceRange: [3, 12],
      });
      scatterMono(out, sampleRate, {
        rng, durationS, ratePerSecond: 0.35, burst: 0.4,
        make: (r) => room(impact(sampleRate, { material: 'plastic', rng: r, strength: rand(r, 0.4, 0.9) })),
        gain: 0.32, distanceRange: [4, 16],
      });

      const [vl, vr] = renderBabble(sampleRate, {
        durationS, rng: forkRng(rng, 'gym-voices'), voices: 6,
        distanceRange: [5, 20], talkRatio: 0.3, spread: 0.8,
      });
      const air = hvac(sampleRate, { rng, durationS, bladeHz: rand(rng, 16, 24), warmth: 0.35 });
      // The air alone is very low-heavy and the hall reverb piles onto the same
      // octave; the squeak band is what makes it a sports hall rather than a plant room.
      const airHp = filterChain(air, [{ type: 'highpass', freq: 230, q: 0.6 }], sampleRate);
      for (let i = 0; i < n; i++) out[i] += (vl[i] + vr[i]) * 0.4 + airHp[i] * 0.3;

      const filled = fillSpectrum(out, sampleRate, { rng, depthDb: 8 });
      return applyEnvelope(filled, envelopeSwell(n, sampleRate, { depthDb: 6, rng }));
    },
  },
};

export const STEM_IDS = Object.keys(STEMS);

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------

/**
 * Render one stem to its final channel buffers.
 *
 * The seed is derived from the stem name only, so output is byte-identical across
 * runs and regenerating produces no diff.
 */
export function bakeStem(id) {
  const spec = STEMS[id];
  if (!spec) throw new Error(`unknown stem: ${id}`);
  const { sampleRate, durationS, channels, targetRms } = spec;

  const rng = mulberry32(hashStringToSeed(`ambience-stem:${id}`));

  const looped = makeSeamlessLoop(
    (totalSamples, r) => {
      const rendered = spec.render(totalSamples, r, sampleRate);
      const chans = Array.isArray(rendered) ? rendered : [rendered];
      // A stem declared mono but rendered stereo (or vice versa) is a recipe bug;
      // fold rather than silently shipping the wrong channel count.
      if (channels === 1 && chans.length === 2) {
        const mono = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) mono[i] = (chans[0][i] + chans[1][i]) * 0.5;
        return mono;
      }
      if (channels === 2 && chans.length === 1) {
        return decorrelate(chans[0], sampleRate, { rng: r });
      }
      return channels === 1 ? chans[0] : chans;
    },
    { durationS, crossfadeS: CROSSFADE_SECONDS, sampleRate, rng },
  );

  const chans = Array.isArray(looped) ? looped : [looped];

  // Normalise the pair together so stereo imaging survives; per-channel normalisation
  // would pull the image toward whichever side happened to be busier.
  const level = Math.max(...chans.map(rms));
  const gain = level > 0 ? Math.pow(10, targetRms / 20) / level : 1;
  const normalised = chans.map((c) => {
    const scaled = scale(dcBlock(c, sampleRate), gain);
    softClip(scaled, 0.92);
    return scaled;
  });

  return { channels: normalised, sampleRate, spec };
}
