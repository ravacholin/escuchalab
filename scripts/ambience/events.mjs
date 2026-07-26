// One-shot event synthesis.
//
// These are the "things that happen" in a place. The old renderer had exactly one
// non-noise primitive — `addSpecks`, a pure sine with a sin² envelope, 3-14 times in
// 42 seconds. A sin² envelope *fades in*, which is the opposite of an impact, so even
// those read as faint beeps rather than as cups or birds.
//
// Two principles run through everything here:
//
//   1. Material comes from per-partial decay. A porcelain cup and a steel fork can
//      have similar partial frequencies; what distinguishes them is that porcelain's
//      highs die in ~80 ms while steel rings for a second. One shared envelope (what
//      the runtime's playModalHit does today) always sounds like a synth bell.
//
//   2. Contact always makes broadband noise at t=0. Every impact gets a few
//      milliseconds of filtered noise on the attack, or it sounds synthesised no
//      matter how good the modes are.

import {
  TWO_PI, rand, randInt, pick, randNorm, forkRng,
  whiteNoise, pinkNoise, brownNoise, filter, filterChain, sweptBandpass, onePole,
  modalHit, percussiveEnv, gustEnv, resampleVariable, applyDistance,
  normalizeRms, rms, peak, scale, mix, dcBlock,
} from './dsp.mjs';

// ---------------------------------------------------------------------------
// Materials — partial ratios and decay times measured off real objects' behaviour.
// `decay` is a multiplier on the fundamental's decay; note how fast the highs go.
// ---------------------------------------------------------------------------
const MATERIALS = {
  porcelain: {
    base: [1400, 2600],
    ratios: [1, 2.13, 3.41, 5.02],
    decays: [1, 0.42, 0.19, 0.08],
    baseDecayS: [0.28, 0.5],
    noise: 0.45, noiseHz: 4200,
  },
  glass: {
    base: [2100, 3800],
    ratios: [1, 2.76, 4.19, 6.83],
    decays: [1, 0.55, 0.3, 0.14],
    baseDecayS: [0.5, 0.95],
    noise: 0.3, noiseHz: 5200,
  },
  cutlery: {
    base: [2600, 4600],
    ratios: [1, 1.87, 3.05, 4.62, 6.1],
    decays: [1, 0.7, 0.45, 0.25, 0.12],
    baseDecayS: [0.16, 0.34],
    noise: 0.7, noiseHz: 5600,
  },
  metal: { // tool, weight plate, shutter
    base: [190, 420],
    ratios: [1, 2.31, 3.12, 4.55, 6.4],
    decays: [1, 0.72, 0.5, 0.3, 0.15],
    baseDecayS: [0.6, 1.4],
    noise: 0.8, noiseHz: 1800,
  },
  coin: {
    base: [3200, 5200],
    ratios: [1, 2.4, 3.9],
    decays: [1, 0.5, 0.22],
    baseDecayS: [0.12, 0.26],
    noise: 0.6, noiseHz: 6000,
  },
  wood: {
    base: [340, 720],
    ratios: [1, 1.61, 2.44, 3.8],
    decays: [1, 0.35, 0.16, 0.07],
    baseDecayS: [0.08, 0.18],
    noise: 0.9, noiseHz: 1400,
  },
  plastic: {
    base: [900, 1900],
    ratios: [1, 1.94, 3.2],
    decays: [1, 0.3, 0.12],
    baseDecayS: [0.04, 0.09],
    noise: 0.85, noiseHz: 3000,
  },
};

/** A struck object. `strength` scales both level and brightness, as real strikes do. */
export function impact(sampleRate, { material = 'porcelain', rng, strength = 1 }) {
  const m = MATERIALS[material] ?? MATERIALS.porcelain;
  const base = rand(rng, m.base[0], m.base[1]);
  const baseDecay = rand(rng, m.baseDecayS[0], m.baseDecayS[1]) * (0.7 + strength * 0.4);
  const partials = m.ratios.map((ratio, i) => ({
    // Real objects are never exactly harmonic; a few percent of inharmonicity is
    // what stops a modal stack sounding like an organ.
    freq: base * ratio * (1 + randNorm(rng, 0, 0.012)),
    decayS: baseDecay * m.decays[i],
    amp: (1 / (1 + i * 0.9)) * (0.6 + strength * 0.5),
  }));
  const durationS = Math.min(2.2, baseDecay * 3.2);
  const hit = modalHit(sampleRate, {
    partials,
    durationS,
    rng,
    noiseAmount: m.noise * strength,
    noiseFreq: m.noiseHz,
  });
  // Peak-normalise to `strength` so a gain of 0.3 means the same loudness whether the
  // material is porcelain (4 partials) or metal (5) — otherwise every recipe gain has
  // to be hand-tuned per material.
  const p = peak(hit);
  return p > 0 ? scale(hit, strength / p) : hit;
}

/** Two objects set down together — a cup meeting a saucer, a plate on a stack. */
export function impactPair(sampleRate, { material = 'porcelain', rng, strength = 1 }) {
  const a = impact(sampleRate, { material, rng, strength });
  const b = impact(sampleRate, { material, rng, strength: strength * rand(rng, 0.35, 0.7) });
  const gap = Math.floor(rand(rng, 0.02, 0.07) * sampleRate);
  const out = new Float32Array(Math.max(a.length, b.length + gap));
  out.set(a);
  for (let i = 0; i < b.length; i++) out[gap + i] += b[i];
  return out;
}

// ---------------------------------------------------------------------------
// Footsteps
//
// The runtime plays ONE lone step every 1.7-6.5 s. That is not walking; it's a
// metronome tick. People walk in gait pairs at roughly 2 Hz and they arrive and
// leave, so a step comes in runs with a slight left/right asymmetry.
// ---------------------------------------------------------------------------
const SURFACES = {
  tile:     { heelHz: [180, 320], heelDecay: 0.055, scuffHz: [2600, 5200], scuffMs: 45, bright: 1.0 },
  wood:     { heelHz: [140, 260], heelDecay: 0.075, scuffHz: [1400, 3000], scuffMs: 55, bright: 0.8 },
  concrete: { heelHz: [110, 210], heelDecay: 0.045, scuffHz: [1800, 4200], scuffMs: 40, bright: 0.9 },
  asphalt:  { heelHz: [95, 180],  heelDecay: 0.05,  scuffHz: [900, 2400],  scuffMs: 70, bright: 0.6 },
  gravel:   { heelHz: [80, 160],  heelDecay: 0.03,  scuffHz: [1200, 5000], scuffMs: 130, bright: 0.75 },
  carpet:   { heelHz: [70, 130],  heelDecay: 0.04,  scuffHz: [400, 1200],  scuffMs: 60, bright: 0.3 },
};

export function footstep(sampleRate, { surface = 'tile', rng, strength = 1 }) {
  const s = SURFACES[surface] ?? SURFACES.tile;
  const n = Math.floor(0.3 * sampleRate);
  const out = new Float32Array(n);

  // Heel: a damped low thump — the body's mass hitting the floor.
  const heel = modalHit(sampleRate, {
    partials: [
      { freq: rand(rng, s.heelHz[0], s.heelHz[1]), decayS: s.heelDecay, amp: 1 },
      { freq: rand(rng, s.heelHz[0], s.heelHz[1]) * 2.4, decayS: s.heelDecay * 0.4, amp: 0.35 },
    ],
    durationS: 0.2,
    rng,
  });
  for (let i = 0; i < heel.length; i++) out[i] += heel[i] * strength;

  // Sole scuff: broadband, slightly later, and the part that identifies the surface.
  // Gravel is long and grainy; carpet is a short dull brush.
  const scuffLen = Math.floor((s.scuffMs / 1000) * sampleRate * rand(rng, 0.8, 1.3));
  const scuff = filter(whiteNoise(scuffLen, rng), {
    type: 'bandpass', freq: rand(rng, s.scuffHz[0], s.scuffHz[1]), q: 0.8, sampleRate,
  });
  const scuffEnv = percussiveEnv(scuffLen, sampleRate, { attackMs: 3, decayS: s.scuffMs / 2500 });
  const offset = Math.floor(rand(rng, 0.004, 0.014) * sampleRate);
  for (let i = 0; i < scuffLen && offset + i < n; i++) {
    out[offset + i] += scuff[i] * scuffEnv[i] * 0.5 * s.bright * strength;
  }

  if (surface === 'gravel') {
    // Individual stones displaced by the foot.
    for (let k = 0; k < randInt(rng, 3, 8); k++) {
      const g = impact(sampleRate, { material: 'wood', rng, strength: rand(rng, 0.04, 0.12) });
      const at = Math.floor(rand(rng, 0, 0.09) * sampleRate);
      for (let i = 0; i < g.length && at + i < n; i++) out[at + i] += g[i];
    }
  }
  return out;
}

/**
 * A person walking past: a run of steps with a real gait, arriving and receding.
 * Returns { buffer, pans } so the caller can move it across the stereo field.
 */
export function footstepRun(sampleRate, { surface = 'tile', rng, steps = 6, tempoHz = 1.9, strength = 1 }) {
  const interval = 1 / tempoHz;
  const total = Math.floor((steps * interval + 0.4) * sampleRate);
  const out = new Float32Array(total);
  const pans = [];
  for (let k = 0; k < steps; k++) {
    // Left and right feet never land identically; alternating weight is audible.
    const asym = k % 2 === 0 ? 1 : rand(rng, 0.78, 0.95);
    // Approach and recede: the walker passes the listener mid-run.
    const t = k / Math.max(1, steps - 1);
    const proximity = 1 - Math.abs(t - 0.5) * 1.6;
    const step = footstep(sampleRate, { surface, rng, strength: strength * asym * Math.max(0.2, proximity) });
    const at = Math.floor((k * interval + randNorm(rng, 0, 0.012)) * sampleRate);
    for (let i = 0; i < step.length && at + i < total; i++) out[at + i] += step[i];
    pans.push({ at, pan: -0.8 + 1.6 * t });
  }
  return { buffer: out, pans };
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/**
 * A car passing the listener.
 *
 * The old "traffic" was a static bandpass at 340 Hz: no movement, no pitch change,
 * nothing that says a mass went by. What actually reads as a pass-by:
 *   - engine harmonics whose pitch DROPS as the car passes (Doppler)
 *   - tyre noise that peaks and then dulls as the source recedes
 *   - a level arc, and a pan sweep
 * Returns [L, R] because the movement is inherently stereo.
 */
export function vehiclePass(sampleRate, {
  rng,
  speedKmh = 45,
  distanceM = 6,
  heavy = false,
  direction = 1,
}) {
  const speed = speedKmh / 3.6;
  // How long it stays audible: faster and closer means a shorter, sharper event.
  const durationS = Math.min(6, Math.max(1.4, (distanceM * 4.5) / speed + 1.2));
  const n = Math.floor(durationS * sampleRate);
  const c = 343;

  // Geometry: the car travels along a line, closest approach at t = duration/2.
  const closest = distanceM;
  const dist = new Float32Array(n);
  const radial = new Float32Array(n);   // radial velocity, for Doppler
  const pan = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate - durationS / 2;
    const x = speed * t;
    const d = Math.sqrt(x * x + closest * closest);
    dist[i] = d;
    radial[i] = (speed * x) / d;        // + = receding
    pan[i] = direction * Math.max(-1, Math.min(1, x / Math.max(2, closest * 1.4)));
  }

  // --- engine: a harmonic stack, with revs rising slightly as it accelerates away
  const baseRpmHz = heavy ? rand(rng, 22, 34) : rand(rng, 38, 62);
  const engineRaw = new Float32Array(n);
  const harmonics = heavy ? 9 : 6;
  const phases = new Float32Array(harmonics);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const rev = baseRpmHz * (1 + 0.12 * (t / durationS));
    let s = 0;
    for (let h = 1; h <= harmonics; h++) {
      phases[h - 1] += (TWO_PI * rev * h) / sampleRate;
      s += Math.sin(phases[h - 1]) / (h * (heavy ? 0.85 : 1.25));
    }
    engineRaw[i] = s * 0.16;
  }
  // Combustion is not tonal; roughen it with correlated noise.
  const engineNoise = filter(brownNoise(n, rng), { type: 'lowpass', freq: 280, q: 0.7, sampleRate });
  const engine = mix([engineRaw, engineNoise], [1, 0.5]);

  // --- tyres: broadband road roar, the dominant sound above ~30 km/h
  const tyreNoise = whiteNoise(n, forkRng(rng, 'tyre'));
  const tyreCentre = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Rolling noise dulls with distance (air absorption) — the cue for "far away".
    tyreCentre[i] = Math.max(420, 1150 - dist[i] * 22);
  }
  const tyre = sweptBandpass(
    filter(tyreNoise, { type: 'highpass', freq: 300, q: 0.6, sampleRate }),
    tyreCentre, 0.7, sampleRate,
  );

  let body = mix([engine, tyre], [heavy ? 0.85 : 0.6, heavy ? 0.5 : 0.75]);

  // --- Doppler: resample by (c / (c + radial velocity)).
  // This single step is what turns "a noise that got louder" into "a car went past".
  const rate = new Float32Array(n);
  for (let i = 0; i < n; i++) rate[i] = c / (c + radial[i]);
  body = resampleVariable(body, rate);

  // --- level arc and air absorption
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i] / (1 + dist[i] / 5);

  const shaped = filter(out, { type: 'lowpass', freq: 9000, q: 0.6, sampleRate });

  // Constant-power pan, swept.
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = ((pan[i] + 1) / 2) * (Math.PI / 2);
    l[i] = shaped[i] * Math.cos(a);
    r[i] = shaped[i] * Math.sin(a);
  }
  return [l, r];
}

/** Distant traffic wash: many far pass-bys blurred into a continuous, breathing bed. */
export function trafficWash(sampleRate, { rng, durationS, density = 0.8 }) {
  const n = Math.floor(durationS * sampleRate);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const count = Math.max(4, Math.floor(durationS * density));
  for (let k = 0; k < count; k++) {
    const [pl, pr] = vehiclePass(sampleRate, {
      rng,
      speedKmh: rand(rng, 35, 70),
      distanceM: rand(rng, 25, 90),
      heavy: rng() < 0.25,
      direction: rng() < 0.5 ? -1 : 1,
    });
    const at = Math.floor(rng() * n);
    for (let i = 0; i < pl.length; i++) {
      l[(at + i) % n] += pl[i];
      r[(at + i) % n] += pr[i];
    }
  }
  return [l, r];
}

export function honk(sampleRate, { rng, distanceM = 20 }) {
  // Car horns are two detuned reeds a fifth apart, heavily clipped.
  const durationS = rand(rng, 0.22, 0.6);
  const n = Math.floor(durationS * sampleRate);
  const f1 = rand(rng, 320, 440);
  const f2 = f1 * rand(rng, 1.18, 1.26);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const s = Math.sin(TWO_PI * f1 * t) + 0.8 * Math.sin(TWO_PI * f2 * t);
    out[i] = Math.tanh(s * 2.4) * 0.4;
  }
  const env = percussiveEnv(n, sampleRate, { attackMs: 8, decayS: durationS * 3 });
  for (let i = 0; i < n; i++) out[i] *= env[i];
  const shaped = filter(out, { type: 'peaking', freq: 900, q: 1.2, gainDb: 5, sampleRate });
  return applyDistance(shaped, distanceM, sampleRate);
}

export function siren(sampleRate, { rng, distanceM = 120 }) {
  const durationS = rand(rng, 3.5, 6.5);
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  const base = rand(rng, 620, 780);
  const sweepHz = rand(rng, 0.35, 0.6);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = base * (1 + 0.42 * Math.sin(TWO_PI * sweepHz * t));
    phase += (TWO_PI * f) / sampleRate;
    out[i] = (Math.sin(phase) + 0.35 * Math.sin(phase * 2)) * 0.3;
  }
  // Fade in and out — it is driving past, not switched on and off.
  const env = gustEnv(n, { risePortion: 0.45 });
  for (let i = 0; i < n; i++) out[i] *= env[i];
  return applyDistance(out, distanceM, sampleRate);
}

// ---------------------------------------------------------------------------
// Doors, tills, offices
// ---------------------------------------------------------------------------
export function doorLatch(sampleRate, { rng, strength = 1 }) {
  const click = impact(sampleRate, { material: 'metal', rng, strength: strength * 0.5 });
  const thud = impact(sampleRate, { material: 'wood', rng, strength });
  const gap = Math.floor(rand(rng, 0.03, 0.09) * sampleRate);
  const n = Math.max(thud.length, click.length + gap);
  const out = new Float32Array(n);
  out.set(thud);
  for (let i = 0; i < click.length; i++) out[gap + i] += click[i];
  return out;
}

/** Shop-door bell: two small struck bars, still swinging. */
export function doorChime(sampleRate, { rng }) {
  const n = Math.floor(1.6 * sampleRate);
  const out = new Float32Array(n);
  const strikes = randInt(rng, 2, 4);
  for (let k = 0; k < strikes; k++) {
    const bell = modalHit(sampleRate, {
      partials: [
        { freq: rand(rng, 1900, 2400), decayS: 0.85, amp: 1 },
        { freq: rand(rng, 2900, 3600), decayS: 0.5, amp: 0.5 },
        { freq: rand(rng, 4400, 5400), decayS: 0.2, amp: 0.22 },
      ],
      durationS: 1.2, rng, noiseAmount: 0.25, noiseHz: 5000,
    });
    const at = Math.floor(rand(rng, 0, 0.35) * sampleRate * k);
    const g = Math.pow(0.72, k);
    for (let i = 0; i < bell.length && at + i < n; i++) out[at + i] += bell[i] * g;
  }
  return out;
}

export function registerBeep(sampleRate, { rng }) {
  const durationS = rand(rng, 0.06, 0.12);
  const n = Math.floor(durationS * sampleRate);
  const f = rand(rng, 2100, 2900);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((TWO_PI * f * i) / sampleRate) * 0.5;
  const env = percussiveEnv(n, sampleRate, { attackMs: 1.5, decayS: durationS });
  for (let i = 0; i < n; i++) out[i] *= env[i];
  return out;
}

export function keyboardKey(sampleRate, { rng }) {
  // Two events: the key bottoming out, then the lighter release.
  const down = impact(sampleRate, { material: 'plastic', rng, strength: rand(rng, 0.6, 1) });
  const up = impact(sampleRate, { material: 'plastic', rng, strength: rand(rng, 0.2, 0.4) });
  const gap = Math.floor(rand(rng, 0.045, 0.09) * sampleRate);
  const out = new Float32Array(down.length + gap + up.length);
  out.set(down);
  for (let i = 0; i < up.length; i++) out[gap + i] += up[i];
  return out;
}

export function typingBurst(sampleRate, { rng, keys = 8 }) {
  const interval = rand(rng, 0.075, 0.16);
  const n = Math.floor((keys * interval + 0.3) * sampleRate);
  const out = new Float32Array(n);
  for (let k = 0; k < keys; k++) {
    const key = keyboardKey(sampleRate, { rng });
    // Typing is uneven: some keys land almost together, then a hesitation.
    const at = Math.floor((k * interval + randNorm(rng, 0, 0.022)) * sampleRate);
    for (let i = 0; i < key.length && at + i >= 0 && at + i < n; i++) out[at + i] += key[i];
  }
  return out;
}

export function paperRustle(sampleRate, { rng }) {
  const durationS = rand(rng, 0.25, 0.8);
  const n = Math.floor(durationS * sampleRate);
  // Paper is a series of tiny crackles, not a smooth noise burst — granulate it.
  const out = new Float32Array(n);
  const grains = randInt(rng, 14, 40);
  for (let g = 0; g < grains; g++) {
    const len = Math.floor(rand(rng, 0.002, 0.012) * sampleRate);
    const grain = filter(whiteNoise(len, rng), {
      type: 'bandpass', freq: rand(rng, 1800, 6500), q: 1.4, sampleRate,
    });
    const env = percussiveEnv(len, sampleRate, { attackMs: 0.4, decayS: 0.006 });
    const at = Math.floor(rng() * (n - len));
    const amp = rand(rng, 0.2, 1);
    for (let i = 0; i < len; i++) out[at + i] += grain[i] * env[i] * amp;
  }
  return scale(out, 0.5);
}

export function printerPass(sampleRate, { rng }) {
  const durationS = rand(rng, 0.9, 2.2);
  const n = Math.floor(durationS * sampleRate);
  // Stepper motor: a buzz whose pitch steps as the carriage accelerates.
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 90 + Math.sin(Math.PI * t) * 130;
    phase += (TWO_PI * f) / sampleRate;
    out[i] = (Math.sign(Math.sin(phase)) * 0.12 + Math.sin(phase * 3) * 0.05) * Math.sin(Math.PI * t);
  }
  const rollers = filter(whiteNoise(n, rng), { type: 'bandpass', freq: 1600, q: 0.8, sampleRate });
  for (let i = 0; i < n; i++) out[i] += rollers[i] * 0.06 * Math.sin(Math.PI * (i / n));
  return filter(out, { type: 'lowpass', freq: 5000, q: 0.7, sampleRate });
}

export function chairScrape(sampleRate, { rng }) {
  const durationS = rand(rng, 0.2, 0.7);
  const n = Math.floor(durationS * sampleRate);
  const noise = whiteNoise(n, rng);
  // Stick-slip: the friction squeal wanders in pitch.
  const centre = new Float32Array(n);
  let f = rand(rng, 600, 1400);
  for (let i = 0; i < n; i++) {
    f += randNorm(rng, 0, 6);
    centre[i] = Math.max(300, Math.min(3500, f));
  }
  const scraped = sweptBandpass(noise, centre, 3.5, sampleRate);
  const env = gustEnv(n, { risePortion: 0.2 });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = scraped[i] * env[i] * 0.6;
  return out;
}

export function cashDrawer(sampleRate, { rng }) {
  const slide = filter(whiteNoise(Math.floor(0.22 * sampleRate), rng), {
    type: 'bandpass', freq: 900, q: 1.1, sampleRate,
  });
  const env = gustEnv(slide.length, { risePortion: 0.25 });
  const out = new Float32Array(Math.floor(0.9 * sampleRate));
  for (let i = 0; i < slide.length; i++) out[i] = slide[i] * env[i] * 0.35;
  const bell = impact(sampleRate, { material: 'metal', rng, strength: 0.5 });
  const at = Math.floor(0.2 * sampleRate);
  for (let i = 0; i < bell.length && at + i < out.length; i++) out[at + i] += bell[i] * 0.6;
  const coins = randInt(rng, 2, 5);
  for (let k = 0; k < coins; k++) {
    const c = impact(sampleRate, { material: 'coin', rng, strength: rand(rng, 0.2, 0.5) });
    const ca = Math.floor(rand(rng, 0.25, 0.7) * sampleRate);
    for (let i = 0; i < c.length && ca + i < out.length; i++) out[ca + i] += c[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

/** Frying: dense random micro-transients, the classic "sizzle". */
export function sizzle(sampleRate, { rng, durationS = 2, intensity = 1 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  const pops = Math.floor(durationS * rand(rng, 180, 420) * intensity);
  for (let k = 0; k < pops; k++) {
    const len = Math.floor(rand(rng, 0.0006, 0.004) * sampleRate);
    const at = Math.floor(rng() * Math.max(1, n - len));
    const f = rand(rng, 2500, 8000);
    const amp = rand(rng, 0.02, 0.3);
    for (let i = 0; i < len; i++) {
      out[at + i] += (rng() * 2 - 1) * amp * Math.exp((-i / len) * 4);
    }
    if (rng() < 0.04) { // occasional loud spit
      const spit = filter(whiteNoise(Math.floor(0.02 * sampleRate), rng), {
        type: 'bandpass', freq: f, q: 1.5, sampleRate,
      });
      const senv = percussiveEnv(spit.length, sampleRate, { attackMs: 0.3, decayS: 0.012 });
      for (let i = 0; i < spit.length && at + i < n; i++) out[at + i] += spit[i] * senv[i] * 0.5;
    }
  }
  return filter(out, { type: 'highpass', freq: 900, q: 0.7, sampleRate });
}

/** Espresso steam wand: pressurised hiss with a slight pitch rise as milk foams. */
export function steamHiss(sampleRate, { rng, durationS = 3.5 }) {
  const n = Math.floor(durationS * sampleRate);
  const noise = whiteNoise(n, rng);
  const centre = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    centre[i] = 2400 + t * 1400 + Math.sin(TWO_PI * 3 * (i / sampleRate)) * 180;
  }
  const hiss = sweptBandpass(noise, centre, 1.1, sampleRate);
  const env = gustEnv(n, { risePortion: 0.08 });
  const out = new Float32Array(n);
  // Gurgle: low-frequency turbulence under the hiss.
  const gurgle = filter(brownNoise(n, forkRng(rng, 'gurgle')), {
    type: 'bandpass', freq: 220, q: 1.2, sampleRate,
  });
  for (let i = 0; i < n; i++) out[i] = (hiss[i] * 0.7 + gurgle[i] * 0.4) * env[i];
  return out;
}

export function grinder(sampleRate, { rng, durationS = 2.5 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Spin-up, load, spin-down.
    const f = 95 * (t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1) + 20;
    phase += (TWO_PI * f) / sampleRate;
    out[i] = (Math.sin(phase) + 0.4 * Math.sin(phase * 2) + 0.2 * Math.sin(phase * 3)) * 0.2;
  }
  // Beans cracking against the burrs.
  const grind = filter(whiteNoise(n, rng), { type: 'bandpass', freq: 2600, q: 0.6, sampleRate });
  const env = gustEnv(n, { risePortion: 0.12 });
  for (let i = 0; i < n; i++) out[i] = (out[i] + grind[i] * 0.5) * env[i];
  return out;
}

// ---------------------------------------------------------------------------
// Weather and nature
// ---------------------------------------------------------------------------

/**
 * Rain, built from droplets rather than from highpassed noise.
 *
 * The old `nature` bed was lowpassed pink + bandpassed white summed flat, which is
 * literally the textbook rain recipe — which is why every scenario sounded like rain.
 * Real rain is thousands of discrete impacts of varying size on varying surfaces,
 * plus a diffuse wash from the ones too far to resolve. Building it that way gives it
 * grain and, crucially, keeps it distinguishable from the other stems.
 */
export function rain(sampleRate, { rng, durationS, intensity = 1 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);

  // Rain arrives in squalls. Without this the drop density is constant and the result
  // measures as stationary noise — the very thing we're trying to get away from, even
  // though here it would at least be the *right* stationary noise.
  const squall = new Float32Array(n);
  const squallPhases = [rng() * TWO_PI, rng() * TWO_PI];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    squall[i] = 0.55
      + 0.3 * Math.sin(TWO_PI * (1 / 13.7) * t + squallPhases[0])
      + 0.15 * Math.sin(TWO_PI * (1 / 5.3) * t + squallPhases[1]);
  }

  const drops = Math.floor(durationS * 900 * intensity);
  for (let k = 0; k < drops; k++) {
    const at = Math.floor(rng() * n);
    // Reject drops in proportion to the squall envelope: density, not just level,
    // is what changes when rain gets heavier.
    if (rng() > squall[at]) continue;
    const f = rand(rng, 1800, 9000);
    const len = Math.floor(rand(rng, 0.0008, 0.006) * sampleRate);
    const amp = Math.pow(rng(), 2.2) * 0.5 * squall[at]; // mostly small, occasionally fat
    let ph = 0;
    for (let i = 0; i < len; i++) {
      ph += (TWO_PI * f) / sampleRate;
      const idx = (at + i) % n;
      out[idx] += Math.sin(ph) * amp * Math.exp((-i / len) * 5);
    }
  }

  // Nearby drips on a hard surface — the cue that you're under shelter looking out.
  const drips = Math.floor(durationS * rand(rng, 0.6, 2) * intensity);
  for (let k = 0; k < drips; k++) {
    const drip = modalHit(sampleRate, {
      partials: [
        { freq: rand(rng, 900, 2200), decayS: rand(rng, 0.02, 0.07), amp: 1, detune: 0.12 },
      ],
      durationS: 0.15, rng, noiseAmount: 0.4, noiseHz: 4000,
    });
    const at = Math.floor(rng() * n);
    for (let i = 0; i < drip.length; i++) out[(at + i) % n] += drip[i] * rand(rng, 0.05, 0.22);
  }

  // Diffuse wash from unresolvable distance, at a level well below the grain, and
  // riding the same squall contour so the whole texture surges together.
  const wash = filterChain(pinkNoise(n, forkRng(rng, 'rain-wash')), [
    { type: 'highpass', freq: 700, q: 0.6 },
    { type: 'lowpass', freq: 7000, q: 0.6 },
  ], sampleRate);
  for (let i = 0; i < n; i++) out[i] += wash[i] * 0.35 * intensity * squall[i];

  return out;
}

/** Wind gust: multi-band noise with an asymmetric envelope and a faint edge whistle. */
export function windGust(sampleRate, { rng, durationS = 4, strength = 1 }) {
  const n = Math.floor(durationS * sampleRate);
  const noise = pinkNoise(n, rng);

  // Three bands with independent slow contours — wind is never one filter sweep.
  const bands = [
    { freq: 220, q: 0.7, gain: 1.0 },
    { freq: 900, q: 0.8, gain: 0.55 },
    { freq: 2800, q: 0.9, gain: 0.28 },
  ].map((b, i) => {
    const filtered = filter(noise, { type: 'bandpass', freq: b.freq, q: b.q, sampleRate });
    const contour = new Float32Array(n);
    const rate = 0.13 + i * 0.09;
    const phase = rng() * TWO_PI;
    for (let j = 0; j < n; j++) {
      contour[j] = 0.55 + 0.45 * Math.sin(TWO_PI * rate * (j / sampleRate) + phase);
    }
    const out = new Float32Array(n);
    for (let j = 0; j < n; j++) out[j] = filtered[j] * contour[j] * b.gain;
    return out;
  });

  const gust = gustEnv(n, { risePortion: rand(rng, 0.2, 0.4) });
  const body = mix(bands);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i] * gust[i] * strength;

  // Whistle over an edge at the gust peak.
  if (rng() < 0.4) {
    const wf = rand(rng, 700, 1600);
    for (let i = 0; i < n; i++) {
      out[i] += Math.sin((TWO_PI * wf * i) / sampleRate) * 0.012 * gust[i] * gust[i] * strength;
    }
  }
  return out;
}

/** Leaves: many small high-frequency scratches, densest at the gust peak. */
export function leafRustle(sampleRate, { rng, durationS = 3, strength = 1 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  const env = gustEnv(n, { risePortion: 0.3 });
  const count = Math.floor(durationS * rand(rng, 300, 700) * strength);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(rng() * n);
    const len = Math.floor(rand(rng, 0.0015, 0.008) * sampleRate);
    const amp = Math.pow(rng(), 1.8) * 0.25 * env[at];
    for (let i = 0; i < len && at + i < n; i++) {
      out[at + i] += (rng() * 2 - 1) * amp * Math.exp((-i / len) * 3);
    }
  }
  return filter(out, { type: 'bandpass', freq: 4200, q: 0.5, sampleRate });
}

/** Birdsong: FM chirps in phrases, with the species-typical contour. */
export function bird(sampleRate, { rng, distanceM = 12 }) {
  const notes = randInt(rng, 2, 5);
  const noteGap = rand(rng, 0.06, 0.22);
  const noteDur = rand(rng, 0.05, 0.16);
  const n = Math.floor((notes * (noteDur + noteGap) + 0.3) * sampleRate);
  const out = new Float32Array(n);
  const baseHz = rand(rng, 2200, 4800);
  // Contour type: rising sweep, falling sweep, or a trill.
  const contour = pick(rng, ['rise', 'fall', 'trill']);

  for (let k = 0; k < notes; k++) {
    const len = Math.floor(noteDur * rand(rng, 0.7, 1.3) * sampleRate);
    const at = Math.floor(k * (noteDur + noteGap) * sampleRate);
    const f0 = baseHz * rand(rng, 0.92, 1.08);
    let phase = 0;
    for (let i = 0; i < len && at + i < n; i++) {
      const t = i / len;
      let f;
      if (contour === 'rise') f = f0 * (1 + t * 0.7);
      else if (contour === 'fall') f = f0 * (1.6 - t * 0.7);
      else f = f0 * (1 + 0.22 * Math.sin(TWO_PI * 28 * (i / sampleRate)));
      phase += (TWO_PI * f) / sampleRate;
      // A second, quieter harmonic keeps it from sounding like a test tone.
      const env = Math.sin(Math.PI * t) ** 0.6;
      out[at + i] += (Math.sin(phase) + 0.25 * Math.sin(phase * 2)) * 0.4 * env;
    }
  }
  return applyDistance(out, distanceM, sampleRate);
}

// ---------------------------------------------------------------------------
// Machines and continuous textures
// ---------------------------------------------------------------------------

/**
 * HVAC / ventilation: filtered noise with a faint blade tone.
 *
 * This is the one place where near-stationary noise is *correct* — that is what
 * air handling sounds like. The mistake in the old system was making everything
 * else sound like this too.
 */
export function hvac(sampleRate, { rng, durationS, bladeHz = 0, warmth = 0.5 }) {
  const n = Math.floor(durationS * sampleRate);
  const air = filterChain(pinkNoise(n, rng), [
    { type: 'lowpass', freq: 1200 + warmth * 900, q: 0.6 },
    { type: 'highpass', freq: 70, q: 0.6 },
  ], sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = air[i];
  if (bladeHz > 0) {
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      out[i] += (Math.sin(TWO_PI * bladeHz * t) * 0.02 + Math.sin(TWO_PI * bladeHz * 2 * t) * 0.008)
        * (1 + 0.2 * Math.sin(TWO_PI * 0.07 * t));
    }
  }
  return out;
}

/** Mains hum: 50 Hz plus harmonics, as fluorescent ballasts and fridges produce. */
export function mainsHum(sampleRate, { durationS, fundamental = 50, level = 1 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  const harmonics = [
    { h: 1, a: 0.5 }, { h: 2, a: 1.0 }, { h: 3, a: 0.25 }, { h: 4, a: 0.35 }, { h: 6, a: 0.12 },
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (const { h, a } of harmonics) s += Math.sin(TWO_PI * fundamental * h * t) * a;
    out[i] = s * 0.02 * level;
  }
  return out;
}

/** Vehicle cabin: engine through the firewall, road roar, suspension thumps. */
export function cabinRumble(sampleRate, { rng, durationS, engineHz = 32, road = 1 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Gear changes and throttle: the revs wander, they don't sit still.
    const rev = engineHz * (1 + 0.18 * Math.sin(TWO_PI * 0.045 * t) + 0.07 * Math.sin(TWO_PI * 0.13 * t));
    phase += (TWO_PI * rev) / sampleRate;
    let s = 0;
    for (let h = 1; h <= 7; h++) s += Math.sin(phase * h) / (h * 1.5);
    out[i] = s * 0.09;
  }

  const roadNoise = filterChain(brownNoise(n, rng), [
    { type: 'lowpass', freq: 900, q: 0.6 },
    { type: 'highpass', freq: 45, q: 0.6 },
  ], sampleRate);
  for (let i = 0; i < n; i++) out[i] += roadNoise[i] * 0.55 * road;

  // Expansion joints and potholes: without these it's a drone, not a journey.
  const bumps = Math.floor(durationS * rand(rng, 0.25, 0.7));
  for (let k = 0; k < bumps; k++) {
    const bump = modalHit(sampleRate, {
      partials: [
        { freq: rand(rng, 45, 90), decayS: rand(rng, 0.08, 0.22), amp: 1 },
        { freq: rand(rng, 160, 320), decayS: 0.05, amp: 0.3 },
      ],
      durationS: 0.4, rng, noiseAmount: 0.5, noiseHz: 400,
    });
    const at = Math.floor(rng() * n);
    for (let i = 0; i < bump.length; i++) out[(at + i) % n] += bump[i] * rand(rng, 0.15, 0.5);
  }
  return out;
}

/** Compressor / extractor motor cycling on and off. */
export function motorCycle(sampleRate, { rng, durationS, hz = 58 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    phase += (TWO_PI * hz * (1 + 0.01 * Math.sin(TWO_PI * 0.3 * t))) / sampleRate;
    out[i] = (Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.3 + Math.sin(phase * 3) * 0.12) * 0.06;
  }
  const turbulence = filter(pinkNoise(n, rng), { type: 'bandpass', freq: 1400, q: 0.5, sampleRate });
  for (let i = 0; i < n; i++) out[i] += turbulence[i] * 0.3;
  return out;
}

/** Rolling suitcase over a hard floor — the signature sound of a station concourse. */
export function luggageWheels(sampleRate, { rng, durationS = 3 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  const noise = filter(whiteNoise(n, rng), { type: 'bandpass', freq: 2200, q: 0.7, sampleRate });
  const env = gustEnv(n, { risePortion: 0.4 });
  for (let i = 0; i < n; i++) out[i] = noise[i] * env[i] * 0.35;
  // Tile joints clicking past at the rolling rate.
  const clickRate = rand(rng, 7, 16);
  for (let k = 0; k * (1 / clickRate) < durationS; k++) {
    const at = Math.floor((k / clickRate + randNorm(rng, 0, 0.01)) * sampleRate);
    if (at < 0 || at >= n) continue;
    const click = impact(sampleRate, { material: 'plastic', rng, strength: rand(rng, 0.08, 0.2) });
    for (let i = 0; i < click.length && at + i < n; i++) out[at + i] += click[i] * env[at];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Body and room incidentals
//
// These have Web Audio twins in services/ambienceEngine.ts (EVENT_SYNTHS). The
// duplication is deliberate: the baker needs them to put grain into the stems, and
// the offline preview needs them to render a faithful audition of a scene without a
// browser. Keeping the two in the same shape is what makes the preview trustworthy.
// ---------------------------------------------------------------------------

export function cough(sampleRate, { rng }) {
  const n = Math.floor(1.2 * sampleRate);
  const out = new Float32Array(n);
  const emit = (at, strength) => {
    const len = Math.floor(rand(rng, 0.09, 0.17) * sampleRate);
    const body = filter(pinkNoise(len, rng), {
      type: 'bandpass', freq: rand(rng, 500, 1100), q: 1.1, sampleRate,
    });
    const env = percussiveEnv(len, sampleRate, { attackMs: 4, decayS: 0.05 });
    for (let i = 0; i < len && at + i < n; i++) out[at + i] += body[i] * env[i] * strength;
  };
  emit(0, 1);
  if (rng() < 0.5) emit(Math.floor(rand(rng, 0.35, 0.7) * sampleRate), 0.7);
  return out;
}

export function laugh(sampleRate, { rng }) {
  // Falling series of voiced pulses — the contour is what reads as laughter.
  const pulses = randInt(rng, 3, 6);
  const gap = rand(rng, 0.11, 0.18);
  const n = Math.floor((pulses * gap + 0.3) * sampleRate);
  const out = new Float32Array(n);
  const f0 = rand(rng, 180, 340);
  for (let i = 0; i < pulses; i++) {
    const len = Math.floor(rand(rng, 0.055, 0.095) * sampleRate);
    const at = Math.floor(i * gap * sampleRate);
    const body = filter(pinkNoise(len, rng), {
      type: 'bandpass', freq: f0 * (3 + i * 0.2), q: 2.5, sampleRate,
    });
    const env = percussiveEnv(len, sampleRate, { attackMs: 5, decayS: 0.03 });
    const amp = 1 - i / (pulses + 2);
    for (let j = 0; j < len && at + j < n; j++) out[at + j] += body[j] * env[j] * amp;
  }
  return out;
}

export function phoneRing(sampleRate, { rng }) {
  const bursts = randInt(rng, 1, 3);
  const n = Math.floor((bursts * 1.6 + 0.6) * sampleRate);
  const out = new Float32Array(n);
  const base = rand(rng, 900, 1400);
  for (let b = 0; b < bursts; b++) {
    for (let k = 0; k < 8; k++) {
      const hit = modalHit(sampleRate, {
        partials: [{ freq: base * (k % 2 === 0 ? 1 : 1.26), decayS: 0.045, amp: 1 }],
        durationS: 0.08, rng,
      });
      const at = Math.floor((b * 1.6 + k * 0.05) * sampleRate);
      for (let i = 0; i < hit.length && at + i < n; i++) out[at + i] += hit[i] * 0.4;
    }
  }
  return out;
}

export function monitorBeep(sampleRate, { rng }) {
  return modalHit(sampleRate, {
    partials: [{ freq: rand(rng, 980, 1160), decayS: 0.1, amp: 0.6 }],
    durationS: 0.16, rng,
  });
}

export function weightClank(sampleRate, { rng }) {
  const a = impact(sampleRate, { material: 'metal', rng, strength: rand(rng, 0.7, 1) });
  if (rng() > 0.6) return a;
  const b = impact(sampleRate, { material: 'metal', rng, strength: 0.5 });
  const gap = Math.floor(rand(rng, 0.05, 0.14) * sampleRate);
  const out = new Float32Array(Math.max(a.length, b.length + gap));
  out.set(a);
  for (let i = 0; i < b.length; i++) out[gap + i] += b[i];
  return out;
}

export function impactWrench(sampleRate, { rng }) {
  // Rattle-gun: a burst of very fast hammer blows against a socket.
  const blows = randInt(rng, 8, 20);
  const gap = rand(rng, 0.022, 0.033);
  const n = Math.floor((blows * gap + 1.2) * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < blows; i++) {
    const hit = impact(sampleRate, { material: 'metal', rng, strength: rand(rng, 0.5, 1) });
    const at = Math.floor(i * gap * sampleRate);
    for (let j = 0; j < hit.length && at + j < n; j++) out[at + j] += hit[j] * 0.5;
  }
  return out;
}

export function compressor(sampleRate, { rng, durationS = 5 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const spin = t < 0.12 ? t / 0.12 : t > 0.9 ? (1 - t) / 0.1 : 1;
    const f = 26 + 26 * spin;
    phase += (TWO_PI * f) / sampleRate;
    let s = 0;
    for (let h = 1; h <= 5; h++) s += Math.sin(phase * h) / (h * 1.4);
    out[i] = s * 0.18 * spin;
  }
  return filter(out, { type: 'lowpass', freq: 700, q: 0.7, sampleRate });
}

export function hairDryer(sampleRate, { rng, durationS = 5 }) {
  const n = Math.floor(durationS * sampleRate);
  const body = filter(pinkNoise(n, rng), {
    type: 'bandpass', freq: rand(rng, 1400, 2400), q: 0.8, sampleRate,
  });
  const motor = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (TWO_PI * 105) / sampleRate;
    motor[i] = Math.sin(phase) * 0.06;
  }
  const env = gustEnv(n, { risePortion: 0.06 });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (body[i] + motor[i]) * env[i];
  return out;
}

export function rainDrip(sampleRate, { rng }) {
  // A drip is a pitch GLIDE upward: the resonating cavity shrinks as the drop merges.
  const durationS = rand(rng, 0.03, 0.09);
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  const f = rand(rng, 900, 2200);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (TWO_PI * f * (1 + t * 0.6)) / sampleRate;
    out[i] = Math.sin(phase) * Math.exp(-t * 5) * 0.5;
  }
  return out;
}

export function creak(sampleRate, { rng }) {
  const durationS = rand(rng, 0.12, 0.4);
  const n = Math.floor(durationS * sampleRate);
  const centre = new Float32Array(n);
  let f = rand(rng, 380, 900);
  for (let i = 0; i < n; i++) {
    f += randNorm(rng, 0, 4);
    centre[i] = Math.max(200, Math.min(2000, f));
  }
  const body = sweptBandpass(whiteNoise(n, rng), centre, 5, sampleRate);
  const env = gustEnv(n, { risePortion: 0.25 });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = body[i] * env[i] * 0.5;
  return out;
}

export function pageTurn(sampleRate, { rng }) {
  const n = Math.floor(0.4 * sampleRate);
  const out = new Float32Array(n);
  for (let k = 0; k < randInt(rng, 4, 9); k++) {
    const len = Math.floor(rand(rng, 0.008, 0.04) * sampleRate);
    const grain = filter(whiteNoise(len, rng), {
      type: 'bandpass', freq: rand(rng, 2200, 6000), q: 1.2, sampleRate,
    });
    const env = percussiveEnv(len, sampleRate, { attackMs: 1.5, decayS: 0.01 });
    const at = Math.floor(rng() * (n - len));
    const amp = rand(rng, 0.3, 0.9);
    for (let i = 0; i < len; i++) out[at + i] += grain[i] * env[i] * amp;
  }
  return out;
}

export function applause(sampleRate, { rng, durationS = 5 }) {
  const n = Math.floor(durationS * sampleRate);
  const out = new Float32Array(n);
  // Many independent claps, dense at the start and thinning. Each clap is a short
  // band-limited transient; the crowd emerges from the density, not from a texture.
  const claps = Math.floor(durationS * rand(rng, 40, 90));
  for (let k = 0; k < claps; k++) {
    const t = Math.pow(rng(), 0.7) * durationS;
    const at = Math.floor(t * sampleRate);
    const len = Math.floor(rand(rng, 0.006, 0.018) * sampleRate);
    const clap = filter(whiteNoise(len, rng), {
      type: 'bandpass', freq: rand(rng, 900, 2600), q: 0.9, sampleRate,
    });
    const env = percussiveEnv(len, sampleRate, { attackMs: 0.5, decayS: 0.006 });
    const amp = rand(rng, 0.1, 0.45) * (1 - t / (durationS * 1.4));
    for (let i = 0; i < len && at + i < n; i++) out[at + i] += clap[i] * env[i] * amp;
  }
  return out;
}

export const MATERIAL_NAMES = Object.keys(MATERIALS);
export const SURFACE_NAMES = Object.keys(SURFACES);
