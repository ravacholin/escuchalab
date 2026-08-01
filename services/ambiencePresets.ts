import { TextType } from '../types';

// ---------------------------------------------------------------------------
// Scenes
//
// This replaces the old five-value `EnvironmentProfile`. That taxonomy had a fatal
// distribution problem: 30 of the 40 curated scenarios resolved to `OFFICE` and
// therefore played the identical office.wav — a mechanic's workshop, an art gallery,
// a wine tasting, a film set and a gym all sounded the same. `NATURE` was unreachable
// from any curated scenario at all, and the 108 labels belonging to the RadioNews,
// PodcastInterview and Monologue formats fell through to a keyword regex that almost
// always landed on `ROOM`, the emptiest bed of the five.
//
// A scene here is a RECIPE, not an asset: a handful of bundled stems mixed at chosen
// gains, a room to convolve them in, and the discrete events that happen in that
// place. Twelve stems (public/ambience/*.wav) therefore cover ~35 scenes, and adding
// a scene costs a few lines rather than another 2 MB of audio.
// ---------------------------------------------------------------------------

export type StemId =
  | 'babble_close'
  | 'babble_hall'
  | 'babble_open'
  | 'traffic_near'
  | 'traffic_far'
  | 'kitchen'
  | 'hvac_office'
  | 'room_tone'
  | 'studio_tone'
  | 'transit_hum'
  | 'rain'
  | 'wind_leaves';

export const STEM_IDS: StemId[] = [
  'babble_close', 'babble_hall', 'babble_open', 'traffic_near', 'traffic_far',
  'kitchen', 'hvac_office', 'room_tone', 'studio_tone', 'transit_hum', 'rain', 'wind_leaves',
];

/**
 * The RMS level each stem is baked at, in dBFS. Mirrors `targetRms` in
 * scripts/ambience/stems.mjs; scripts/check-ambience.mjs asserts the two agree.
 *
 * The engine needs these to place events relative to the bed. Without them, a fixed
 * event makeup gain puts the same footstep 11 dB over a café and 25 dB over a quiet
 * waiting room — which is how you get a lone thump that sounds like someone dropped
 * a piano in a library.
 */
export const STEM_LEVELS_DBFS: Record<StemId, number> = {
  babble_close: -26,
  babble_hall: -27,
  babble_open: -26,
  traffic_near: -25,
  traffic_far: -30,
  kitchen: -28,
  hvac_office: -32,
  room_tone: -36,
  studio_tone: -42,
  transit_hum: -28,
  rain: -27,
  wind_leaves: -30,
};

/**
 * The nominal RMS amplitude of a scene's continuous bed, from its stem gains.
 * Events are scaled against this so every scene keeps the same event-over-bed
 * relationship regardless of how loud or quiet its bed is.
 */
export function bedLevel(recipe: SceneRecipe): number {
  let power = 0;
  for (const layer of recipe.stems) {
    const amp = layer.gain * Math.pow(10, STEM_LEVELS_DBFS[layer.stem] / 20);
    power += amp * amp;
  }
  return Math.sqrt(power);
}

/**
 * Discrete one-shots synthesised live by services/ambienceEngine.ts.
 *
 * Every kind listed here has an entry in that file's EVENT_SYNTHS registry, and
 * scripts/check-ambience.mjs asserts it. That invariant is the fix for the old
 * `AmbienceTag` union, where 23 of 38 tags were assigned to scenarios and silently
 * did nothing — `Café / Restaurante` carried a `kitchen` tag and never produced a
 * single plate.
 */
export type EventKind =
  // impacts / handling
  | 'porcelain' | 'cutlery' | 'glass' | 'coin' | 'metalClank' | 'woodKnock' | 'plasticTap'
  // people
  | 'footstep' | 'footstepRun' | 'chairScrape' | 'cough' | 'laugh'
  // doors and tills
  | 'doorLatch' | 'doorChime' | 'registerBeep' | 'cashDrawer'
  // office
  | 'typing' | 'paperRustle' | 'printer' | 'phoneRing'
  // street
  | 'vehiclePass' | 'honk' | 'siren'
  // kitchen / bar
  | 'sizzle' | 'steam' | 'grinder'
  // transit
  | 'announcement' | 'luggage'
  // clinical / industrial / leisure
  | 'monitorBeep' | 'weightClank' | 'impactWrench' | 'compressor' | 'hairDryer'
  // outdoors
  | 'bird' | 'windGust' | 'rainDrip'
  // rooms
  | 'creak' | 'pageTurn' | 'applause';

export type RoomSize = 'small' | 'medium' | 'large' | 'hall' | 'outdoor';

/** What the floor is made of. Was derived from `RoomSize` alone, which gave every
 *  `large` scene concrete: a workshop, a gym, a library, a bank and a police station
 *  all walked on the same surface because they happened to share a reverb preset. */
export type Surface = 'tile' | 'wood' | 'concrete' | 'asphalt' | 'carpet';

/**
 * Spectral colour.
 *
 * Measured before this existed: 64 of 103 stem layers were mixed with no filtering at
 * all, and the only per-scene shaping available was a plain `lowpass`/`highpass`. So
 * `room_tone` — which 29 of 42 scenes use — arrived identical in every one of them,
 * and a tiled clinic corridor differed from a carpeted therapy room only in the length
 * of its reverb tail. Absorption is most of what a room does to a sound; this is how a
 * recipe says it.
 */
export interface SceneTone {
  /** Broadband tilt in dB: negative is darker (absorptive), positive brighter (hard). */
  tiltDb?: number;
  lowShelf?: { hz: number; db: number };
  highShelf?: { hz: number; db: number };
  /** One room mode, or the resonance of a duct or a cabinet. */
  peak?: { hz: number; db: number; q?: number };
}

export interface SceneRoom {
  size: RoomSize;
  wet: number;
  /** Multiplies the size preset's rt60. Lets two `large` rooms differ in liveness. */
  rt60Scale?: number;
  /** Overrides the size preset's HF damping. */
  damping?: number;
  /**
   * The air ceiling: how bright this room lets a distant sound stay.
   *
   * This was `outdoor ? 6500 : 5000` — a boolean, and 70% of all event specs went
   * through it, so the identity of every material above 5 kHz was erased identically
   * in every indoor scene in the catalogue.
   */
  brightnessHz?: number;
  surface?: Surface;
}

export interface StemLayer {
  stem: StemId;
  gain: number;
  /** Optional shaping so one stem can play several roles (near vs. muffled-through-a-wall). */
  lowpass?: number;
  highpass?: number;
  /** 0 = mono/centred, 1 = fully decorrelated stereo. */
  width?: number;
  /** Colour for this layer alone — the same builder as the scene's `tone`. */
  tone?: SceneTone;
}

export interface EventSpec {
  kind: EventKind;
  /** Mean seconds between occurrences. Scheduling is Poisson, not uniform. */
  everyS: number;
  gain: number;
  /** Probability that an occurrence spawns a short follow-up cluster. */
  burst?: number;
  /** `far` events get lowpassed and pushed into the reverb — this is what creates depth. */
  distance?: 'near' | 'mid' | 'far';
}

/**
 * How much is going on. Sets the scene's own ceiling on discrete sounds per minute.
 *
 * There used to be one global ceiling, and the recipes were authored between 2 and 220
 * onsets/minute, so 26 of 42 scenes were held to *exactly* 26.00: a full restaurant, a
 * call centre, a market and a newsroom all put the same number of sounds in front of
 * the listener. Density is one of the strongest cues for what kind of place you are
 * in, and it was the axis the old budget flattened hardest.
 */
export type Activity = 'still' | 'calm' | 'busy' | 'bustling' | 'chaotic';

export const ACTIVITY_ONSETS: Record<Activity, number> = {
  still: 6, calm: 13, busy: 26, bustling: 40, chaotic: 52,
};

export interface SceneRecipe {
  /** Shown in the player's status line. */
  label: string;
  stems: StemLayer[];
  room: SceneRoom;
  events: EventSpec[];
  intensityBias?: number;
  duckingBias?: number;
  /** Colour applied to the whole bed. */
  tone?: SceneTone;
  /** Defaults to `busy` (26/min), which is the old global ceiling — so an unannotated
   *  recipe behaves exactly as before. */
  activity?: Activity;
  /** Explicit ceiling, wins over `activity`. */
  maxOnsetsPerMin?: number;
  /**
   * How far the loudest event may sit over the bed, in dB.
   *
   * This was a scene-independent constant by construction — bed gain and event scale
   * were multiplied by the same boost, so the loudest spec of *every* scene landed at
   * exactly +6 dB. But in a library a dropped book is 20 dB over the bed and in a
   * market a shout is barely 3, and that contrast is precisely the information that
   * says which room you are standing in. Left unset it reproduces the old value.
   */
  eventHeadroomDb?: number;
  /**
   * Scenes that are deliberately versions of one another (`street` / `street_rain`)
   * declare a shared family, so the distance check can ask them to be *audibly*
   * different without demanding they be different places.
   */
  family?: string;
}

/** The scene's ceiling on discrete sounds per minute, before intensity. */
export const sceneOnsetCeiling = (recipe: SceneRecipe): number =>
  recipe.maxOnsetsPerMin ?? ACTIVITY_ONSETS[recipe.activity ?? 'busy'];

/**
 * How far the loudest authored event sits over the bed.
 *
 * When a recipe does not declare it, this reproduces exactly what the old fixed
 * arithmetic produced, so the two can coexist while the catalogue is annotated. The
 * engine inverts this to derive the event scale, which means the number a recipe
 * writes is the number the ear gets.
 */
export const eventHeadroomDb = (
  recipe: SceneRecipe,
  fallbackRatio: number,
): number => {
  if (recipe.eventHeadroomDb !== undefined) return recipe.eventHeadroomDb;
  const loudest = recipe.events.reduce((m, e) => Math.max(m, e.gain), 0);
  if (loudest <= 0) return 0;
  return 20 * Math.log10(loudest * fallbackRatio);
};

const ev = (kind: EventKind, everyS: number, gain: number, extra?: Omit<EventSpec, 'kind' | 'everyS' | 'gain'>): EventSpec =>
  ({ kind, everyS, gain, ...extra });

// ---------------------------------------------------------------------------
// The scenes
// ---------------------------------------------------------------------------

export const SCENE_RECIPES = {
  // --- eating and drinking -------------------------------------------------
  cafe: {
    label: 'Café',
    stems: [
      { stem: 'babble_close', gain: 0.55, width: 0.9 },
      { stem: 'kitchen', gain: 0.3, lowpass: 4500, width: 0.6 },
      { stem: 'room_tone', gain: 0.25 },
    ],
    room: { size: 'small', wet: 0.16, brightnessHz: 5200, surface: 'tile' },
    events: [
      ev('porcelain', 5, 0.5, { burst: 0.45, distance: 'near' }),
      ev('cutlery', 7, 0.35, { burst: 0.5, distance: 'mid' }),
      ev('chairScrape', 16, 0.3, { distance: 'mid' }),
      ev('doorChime', 34, 0.28, { distance: 'far' }),
      ev('registerBeep', 22, 0.22, { distance: 'far' }),
      ev('steam', 26, 0.3, { distance: 'far' }),
      ev('grinder', 48, 0.28, { distance: 'far' }),
      ev('footstep', 6, 0.22, { distance: 'mid' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 6,
    tone: { tiltDb: 1.5 },
  },

  restaurant: {
    label: 'Restaurante',
    stems: [
      { stem: 'babble_close', gain: 0.62, width: 1 },
      { stem: 'kitchen', gain: 0.24, lowpass: 3200, width: 0.5 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'medium', wet: 0.2, rt60Scale: 1.05, brightnessHz: 4200, surface: 'wood' },
    events: [
      ev('porcelain', 4, 0.45, { burst: 0.55, distance: 'mid' }),
      ev('cutlery', 3.5, 0.4, { burst: 0.6, distance: 'near' }),
      ev('glass', 9, 0.35, { burst: 0.4, distance: 'near' }),
      ev('chairScrape', 14, 0.3, { distance: 'mid' }),
      ev('laugh', 20, 0.3, { distance: 'far' }),
      ev('sizzle', 30, 0.26, { distance: 'far' }),
      ev('footstep', 5, 0.2, { distance: 'mid' }),
    ],
    activity: 'bustling',
    eventHeadroomDb: 3,
    tone: { tiltDb: -1, lowShelf: { hz: 220, db: 2 } },
  },

  bar_night: {
    label: 'Bar (noche)',
    stems: [
      { stem: 'babble_close', gain: 0.75, width: 1 },
      { stem: 'room_tone', gain: 0.2 },
      { stem: 'kitchen', gain: 0.1, lowpass: 2200 },
    ],
    room: { size: 'medium', wet: 0.24, rt60Scale: 0.95, damping: 0.55, brightnessHz: 3400, surface: 'wood' },
    events: [
      ev('glass', 4, 0.45, { burst: 0.6, distance: 'near' }),
      ev('laugh', 11, 0.4, { distance: 'mid' }),
      ev('coin', 26, 0.25, { distance: 'near' }),
      ev('cashDrawer', 40, 0.3, { distance: 'mid' }),
      ev('doorLatch', 38, 0.3, { distance: 'far' }),
    ],
    intensityBias: 0.1,
    duckingBias: 0.1,
    activity: 'bustling',
    eventHeadroomDb: 2,
    tone: { tiltDb: -3, lowShelf: { hz: 160, db: 4 } },
  },

  wine_tasting: {
    label: 'Cata / sala privada',
    stems: [
      { stem: 'room_tone', gain: 0.45 },
      { stem: 'babble_close', gain: 0.14, lowpass: 2400, width: 0.7 },
    ],
    room: { size: 'medium', wet: 0.22, rt60Scale: 0.85, brightnessHz: 6200, surface: 'tile' },
    events: [
      ev('glass', 9, 0.35, { burst: 0.35, distance: 'near' }),
      ev('chairScrape', 30, 0.2, { distance: 'mid' }),
      ev('footstep', 16, 0.15, { distance: 'far' }),
    ],
    intensityBias: -0.15,
    activity: 'calm',
    eventHeadroomDb: 11,
    tone: { tiltDb: 2.5 },
  },

  // --- shops and markets ---------------------------------------------------
  market: {
    label: 'Mercado',
    stems: [
      { stem: 'babble_open', gain: 0.68, width: 1 },
      { stem: 'traffic_far', gain: 0.22, lowpass: 1400 },
    ],
    room: { size: 'outdoor', wet: 0.07, brightnessHz: 7500, surface: 'concrete' },
    events: [
      ev('woodKnock', 6, 0.35, { burst: 0.5, distance: 'mid' }),
      ev('coin', 13, 0.3, { distance: 'near' }),
      ev('footstep', 4, 0.25, { distance: 'mid' }),
      ev('announcement', 24, 0.3, { distance: 'far' }),
      ev('registerBeep', 20, 0.2, { distance: 'far' }),
    ],
    intensityBias: 0.1,
    activity: 'chaotic',
    eventHeadroomDb: 2,
    tone: { tiltDb: 2 },
  },

  shop_small: {
    label: 'Tienda',
    stems: [
      { stem: 'room_tone', gain: 0.4 },
      { stem: 'babble_close', gain: 0.16, lowpass: 2600, width: 0.6 },
      { stem: 'hvac_office', gain: 0.28 },
    ],
    room: { size: 'small', wet: 0.13, rt60Scale: 0.9, brightnessHz: 6000, surface: 'tile' },
    events: [
      ev('doorChime', 26, 0.4, { distance: 'mid' }),
      ev('registerBeep', 14, 0.3, { distance: 'near' }),
      ev('plasticTap', 10, 0.25, { burst: 0.4, distance: 'near' }),
      ev('footstep', 7, 0.22, { distance: 'mid' }),
      ev('paperRustle', 18, 0.22, { distance: 'near' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 9,
    tone: { tiltDb: 2 },
  },

  shop_checkout: {
    label: 'Caja',
    stems: [
      { stem: 'babble_close', gain: 0.3, lowpass: 3000, width: 0.8 },
      { stem: 'hvac_office', gain: 0.3 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'medium', wet: 0.12, rt60Scale: 0.9, brightnessHz: 6400, surface: 'tile' },
    events: [
      ev('registerBeep', 4.5, 0.4, { burst: 0.5, distance: 'near' }),
      ev('cashDrawer', 18, 0.35, { distance: 'near' }),
      ev('coin', 12, 0.3, { distance: 'near' }),
      ev('plasticTap', 7, 0.25, { burst: 0.6, distance: 'near' }),
      ev('footstep', 6, 0.2, { distance: 'mid' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 8,
    tone: { tiltDb: 2.5 },
  },

  salon: {
    label: 'Peluquería',
    stems: [
      { stem: 'room_tone', gain: 0.38 },
      { stem: 'babble_close', gain: 0.32, width: 0.8 },
    ],
    room: { size: 'small', wet: 0.15, rt60Scale: 0.85, brightnessHz: 6800, surface: 'tile' },
    events: [
      ev('hairDryer', 20, 0.4, { distance: 'mid' }),
      ev('metalClank', 14, 0.2, { distance: 'near' }),
      ev('chairScrape', 24, 0.22, { distance: 'mid' }),
      ev('footstep', 9, 0.2, { distance: 'mid' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 7,
    tone: { tiltDb: 3, peak: { hz: 2600, db: 2, q: 1.1 } },
  },

  // --- street and outdoors -------------------------------------------------
  street: {
    label: 'Calle',
    stems: [
      { stem: 'traffic_near', gain: 0.55, width: 1 },
      { stem: 'traffic_far', gain: 0.4 },
      { stem: 'babble_open', gain: 0.14, lowpass: 2000, width: 0.9 },
    ],
    room: { size: 'outdoor', wet: 0.05, brightnessHz: 7200, surface: 'asphalt' },
    events: [
      ev('vehiclePass', 9, 0.45, { distance: 'near' }),
      ev('honk', 26, 0.35, { distance: 'far' }),
      ev('footstep', 4, 0.28, { distance: 'near' }),
      ev('siren', 70, 0.3, { distance: 'far' }),
    ],
    duckingBias: 0.1,
    activity: 'bustling',
    eventHeadroomDb: 3,
    tone: { lowShelf: { hz: 140, db: 3 } },
    family: 'street',
  },

  plaza: {
    label: 'Plaza',
    stems: [
      { stem: 'babble_open', gain: 0.5, width: 1 },
      { stem: 'traffic_far', gain: 0.3 },
      { stem: 'wind_leaves', gain: 0.18, lowpass: 6000 },
    ],
    room: { size: 'outdoor', wet: 0.08, brightnessHz: 8000, surface: 'concrete' },
    events: [
      ev('footstep', 5, 0.25, { distance: 'mid' }),
      ev('bird', 14, 0.25, { distance: 'far' }),
      ev('honk', 40, 0.22, { distance: 'far' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 5,
    tone: { tiltDb: 1 },
  },

  park: {
    label: 'Parque',
    stems: [
      { stem: 'wind_leaves', gain: 0.62 },
      { stem: 'babble_open', gain: 0.12, lowpass: 1800, width: 1 },
      { stem: 'traffic_far', gain: 0.16, lowpass: 900 },
    ],
    room: { size: 'outdoor', wet: 0.06, brightnessHz: 9000, surface: 'asphalt' },
    events: [
      ev('bird', 6, 0.35, { burst: 0.5, distance: 'mid' }),
      ev('windGust', 14, 0.35),
      ev('footstep', 10, 0.2, { distance: 'mid' }),
    ],
    intensityBias: -0.05,
    activity: 'calm',
    eventHeadroomDb: 9,
    tone: { tiltDb: 3, lowShelf: { hz: 200, db: -3 } },
    family: 'park',
  },

  // --- workplaces ----------------------------------------------------------
  office: {
    label: 'Oficina',
    stems: [
      { stem: 'hvac_office', gain: 0.55 },
      { stem: 'room_tone', gain: 0.3 },
    ],
    room: { size: 'medium', wet: 0.1, rt60Scale: 0.8, damping: 0.6, brightnessHz: 4000, surface: 'carpet' },
    events: [
      ev('typing', 7, 0.3, { burst: 0.4, distance: 'mid' }),
      ev('paperRustle', 13, 0.3, { distance: 'near' }),
      ev('phoneRing', 45, 0.25, { distance: 'far' }),
      ev('printer', 34, 0.28, { distance: 'far' }),
      ev('chairScrape', 26, 0.25, { distance: 'near' }),
    ],
    intensityBias: -0.1,
    activity: 'calm',
    eventHeadroomDb: 9,
    tone: { tiltDb: -2 },
  },

  open_office: {
    label: 'Oficina abierta',
    stems: [
      { stem: 'hvac_office', gain: 0.45 },
      { stem: 'babble_close', gain: 0.26, lowpass: 2800, width: 0.9 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.13, rt60Scale: 0.6, damping: 0.65, brightnessHz: 3800, surface: 'carpet' },
    events: [
      ev('typing', 4, 0.3, { burst: 0.55, distance: 'mid' }),
      ev('phoneRing', 30, 0.25, { distance: 'far' }),
      ev('printer', 26, 0.25, { distance: 'far' }),
      ev('footstep', 8, 0.2, { distance: 'far' }),
      ev('chairScrape', 20, 0.22, { distance: 'mid' }),
    ],
    activity: 'bustling',
    eventHeadroomDb: 5,
    tone: { tiltDb: -2.5 },
  },

  office_meeting: {
    label: 'Sala de reunión',
    stems: [
      { stem: 'room_tone', gain: 0.42 },
      { stem: 'hvac_office', gain: 0.3 },
    ],
    room: { size: 'medium', wet: 0.14, rt60Scale: 0.85, damping: 0.55, brightnessHz: 4400, surface: 'carpet' },
    events: [
      ev('paperRustle', 12, 0.3, { distance: 'near' }),
      ev('chairScrape', 22, 0.25, { distance: 'near' }),
      ev('plasticTap', 20, 0.18, { distance: 'near' }),
    ],
    intensityBias: -0.2,
    duckingBias: -0.1,
    activity: 'calm',
    eventHeadroomDb: 12,
    tone: { tiltDb: -1.5 },
  },

  call_center: {
    label: 'Centro de atención',
    stems: [
      { stem: 'babble_close', gain: 0.4, lowpass: 3400, width: 0.95 },
      { stem: 'hvac_office', gain: 0.4 },
    ],
    room: { size: 'large', wet: 0.12, rt60Scale: 0.55, damping: 0.7, brightnessHz: 3200, surface: 'carpet' },
    events: [
      ev('typing', 3.5, 0.28, { burst: 0.6, distance: 'mid' }),
      ev('phoneRing', 16, 0.28, { distance: 'far' }),
      ev('chairScrape', 24, 0.2, { distance: 'far' }),
    ],
    activity: 'bustling',
    eventHeadroomDb: 4,
    tone: { tiltDb: -3.5, peak: { hz: 900, db: 2, q: 1.2 } },
  },

  newsroom: {
    label: 'Redacción',
    stems: [
      { stem: 'babble_close', gain: 0.34, lowpass: 3200, width: 0.9 },
      { stem: 'hvac_office', gain: 0.4 },
      { stem: 'room_tone', gain: 0.18 },
    ],
    room: { size: 'large', wet: 0.13, rt60Scale: 0.6, damping: 0.6, brightnessHz: 4600, surface: 'carpet' },
    events: [
      ev('typing', 2.6, 0.32, { burst: 0.7, distance: 'mid' }),
      ev('phoneRing', 20, 0.28, { distance: 'far' }),
      ev('printer', 22, 0.28, { distance: 'far' }),
      ev('paperRustle', 11, 0.26, { distance: 'near' }),
    ],
    intensityBias: 0.05,
    activity: 'bustling',
    eventHeadroomDb: 5,
    tone: { tiltDb: -1 },
  },

  workshop_garage: {
    label: 'Taller',
    stems: [
      { stem: 'hvac_office', gain: 0.35, lowpass: 3000 },
      { stem: 'transit_hum', gain: 0.35, lowpass: 1600 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.26, rt60Scale: 1.35, damping: 0.22, brightnessHz: 7000, surface: 'concrete' },
    events: [
      ev('metalClank', 6, 0.5, { burst: 0.5, distance: 'mid' }),
      ev('impactWrench', 16, 0.45, { distance: 'mid' }),
      ev('compressor', 40, 0.4, { distance: 'far' }),
      ev('footstep', 9, 0.25, { distance: 'mid' }),
    ],
    intensityBias: 0.1,
    duckingBias: 0.15,
    activity: 'bustling',
    eventHeadroomDb: 10,
    tone: { tiltDb: 3, lowShelf: { hz: 130, db: 4 } },
  },

  gym: {
    label: 'Gimnasio',
    stems: [
      { stem: 'hvac_office', gain: 0.45 },
      { stem: 'babble_close', gain: 0.16, lowpass: 2400, width: 0.8 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.22, rt60Scale: 1.35, damping: 0.25, brightnessHz: 6600, surface: 'wood' },
    events: [
      ev('weightClank', 6, 0.45, { burst: 0.4, distance: 'mid' }),
      ev('footstep', 3.5, 0.25, { distance: 'mid' }),
      ev('metalClank', 12, 0.3, { distance: 'far' }),
    ],
    intensityBias: 0.05,
    activity: 'busy',
    eventHeadroomDb: 8,
    tone: { tiltDb: 2, lowShelf: { hz: 110, db: 3 } },
  },

  backstage: {
    label: 'Backstage',
    stems: [
      { stem: 'room_tone', gain: 0.22, highpass: 120 },
      { stem: 'babble_close', gain: 0.4, lowpass: 3000, width: 0.9 },
      { stem: 'hvac_office', gain: 0.2, highpass: 140 },
    ],
    room: { size: 'large', wet: 0.2, rt60Scale: 0.8, brightnessHz: 4200, surface: 'wood' },
    events: [
      ev('metalClank', 11, 0.3, { distance: 'mid' }),
      ev('doorLatch', 20, 0.35, { distance: 'mid' }),
      ev('footstep', 5, 0.25, { distance: 'near' }),
      ev('plasticTap', 14, 0.22, { distance: 'near' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 9,
    tone: { tiltDb: -1 },
  },

  // --- health and institutions --------------------------------------------
  clinic_waiting: {
    label: 'Sala de espera',
    stems: [
      { stem: 'babble_hall', gain: 0.34, lowpass: 2600, width: 0.85 },
      // `hvac_office` and `room_tone` are both low-frequency by nature, so leaning on
      // both at once buries the waiting room under rumble. Highpassed and pulled back
      // so the voices, not the air handling, carry the scene.
      { stem: 'hvac_office', gain: 0.26, highpass: 140 },
      { stem: 'room_tone', gain: 0.16, highpass: 120 },
    ],
    room: { size: 'medium', wet: 0.16, rt60Scale: 0.9, brightnessHz: 6400, surface: 'tile' },
    events: [
      ev('footstep', 8, 0.22, { distance: 'far' }),
      ev('doorLatch', 24, 0.28, { distance: 'mid' }),
      ev('cough', 18, 0.25, { distance: 'far' }),
      ev('pageTurn', 20, 0.2, { distance: 'near' }),
      ev('announcement', 40, 0.25, { distance: 'far' }),
    ],
    intensityBias: -0.1,
    activity: 'busy',
    eventHeadroomDb: 10,
    tone: { tiltDb: 2 },
  },

  clinic_room: {
    label: 'Consultorio',
    stems: [
      { stem: 'room_tone', gain: 0.45 },
      { stem: 'hvac_office', gain: 0.3 },
    ],
    room: { size: 'small', wet: 0.11, rt60Scale: 0.8, damping: 0.35, brightnessHz: 7200, surface: 'tile' },
    events: [
      ev('paperRustle', 14, 0.28, { distance: 'near' }),
      ev('plasticTap', 18, 0.22, { distance: 'near' }),
      ev('doorLatch', 40, 0.22, { distance: 'far' }),
    ],
    intensityBias: -0.25,
    duckingBias: -0.1,
    activity: 'calm',
    eventHeadroomDb: 13,
    tone: { tiltDb: 4, peak: { hz: 1800, db: 2.5, q: 1.3 } },
  },

  hospital: {
    label: 'Hospital',
    stems: [
      { stem: 'babble_hall', gain: 0.3, lowpass: 2800, width: 0.9 },
      { stem: 'hvac_office', gain: 0.45 },
    ],
    room: { size: 'hall', wet: 0.2, rt60Scale: 0.85, damping: 0.24, brightnessHz: 7600, surface: 'tile' },
    events: [
      ev('monitorBeep', 7, 0.25, { distance: 'far' }),
      ev('footstep', 5, 0.25, { distance: 'mid' }),
      ev('announcement', 34, 0.3, { distance: 'far' }),
      ev('doorLatch', 26, 0.25, { distance: 'far' }),
    ],
    activity: 'bustling',
    eventHeadroomDb: 6,
    tone: { tiltDb: 3.5 },
  },

  therapy_room: {
    label: 'Consulta privada',
    stems: [
      { stem: 'room_tone', gain: 0.5 },
    ],
    room: { size: 'small', wet: 0.12, rt60Scale: 0.55, damping: 0.75, brightnessHz: 2600, surface: 'carpet' },
    events: [
      ev('creak', 22, 0.2, { distance: 'near' }),
      ev('chairScrape', 40, 0.15, { distance: 'near' }),
    ],
    intensityBias: -0.3,
    duckingBias: -0.15,
    activity: 'still',
    eventHeadroomDb: 13,
    tone: { tiltDb: -6, highShelf: { hz: 5000, db: -4 } },
  },

  bank: {
    label: 'Banco',
    stems: [
      { stem: 'hvac_office', gain: 0.42 },
      { stem: 'babble_hall', gain: 0.16, lowpass: 2200, width: 0.8 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'large', wet: 0.18, damping: 0.3, brightnessHz: 7000, surface: 'tile' },
    events: [
      ev('typing', 9, 0.25, { burst: 0.4, distance: 'mid' }),
      ev('paperRustle', 12, 0.26, { distance: 'near' }),
      ev('printer', 30, 0.25, { distance: 'mid' }),
      ev('footstep', 9, 0.2, { distance: 'far' }),
    ],
    intensityBias: -0.1,
    activity: 'busy',
    eventHeadroomDb: 9,
    tone: { tiltDb: 3 },
  },

  police_station: {
    label: 'Comisaría',
    stems: [
      { stem: 'hvac_office', gain: 0.42 },
      { stem: 'babble_close', gain: 0.24, lowpass: 2600, width: 0.85 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.19, rt60Scale: 0.85, brightnessHz: 5000, surface: 'concrete' },
    events: [
      ev('typing', 6, 0.3, { burst: 0.5, distance: 'mid' }),
      ev('phoneRing', 26, 0.28, { distance: 'far' }),
      ev('doorLatch', 22, 0.3, { distance: 'mid' }),
      ev('footstep', 7, 0.24, { distance: 'mid' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 8,
    tone: { tiltDb: -0.5 },
  },

  courtroom: {
    label: 'Sala de vistas',
    stems: [
      { stem: 'room_tone', gain: 0.36 },
      { stem: 'babble_hall', gain: 0.1, lowpass: 1800, width: 0.7 },
    ],
    room: { size: 'hall', wet: 0.26, rt60Scale: 0.9, damping: 0.4, brightnessHz: 5400, surface: 'wood' },
    events: [
      ev('paperRustle', 13, 0.28, { distance: 'near' }),
      ev('cough', 20, 0.25, { distance: 'far' }),
      ev('chairScrape', 26, 0.24, { distance: 'far' }),
      ev('creak', 30, 0.2, { distance: 'mid' }),
    ],
    intensityBias: -0.15,
    duckingBias: -0.1,
    activity: 'calm',
    eventHeadroomDb: 14,
    tone: { tiltDb: 1, lowShelf: { hz: 250, db: 2 } },
  },

  classroom: {
    label: 'Aula',
    stems: [
      { stem: 'room_tone', gain: 0.38 },
      { stem: 'babble_close', gain: 0.14, lowpass: 2200, width: 0.75 },
      { stem: 'hvac_office', gain: 0.26 },
    ],
    room: { size: 'medium', wet: 0.18, rt60Scale: 1.1, damping: 0.42, brightnessHz: 5600, surface: 'wood' },
    events: [
      ev('chairScrape', 15, 0.3, { distance: 'mid' }),
      ev('paperRustle', 9, 0.3, { distance: 'near' }),
      ev('pageTurn', 12, 0.25, { distance: 'near' }),
      ev('cough', 24, 0.22, { distance: 'far' }),
    ],
    intensityBias: -0.15,
    activity: 'calm',
    eventHeadroomDb: 11,
    tone: { tiltDb: 1.5 },
  },

  library: {
    label: 'Biblioteca',
    stems: [
      // A library is quiet, not muffled. Stacking three low-frequency support stems
      // produced a rumble rather than a hush, so the tone is highpassed to leave the
      // room's silence audible as silence.
      { stem: 'studio_tone', gain: 0.45, highpass: 120 },
      { stem: 'room_tone', gain: 0.2, highpass: 140 },
      { stem: 'hvac_office', gain: 0.18, highpass: 160 },
    ],
    room: { size: 'large', wet: 0.2, rt60Scale: 0.75, damping: 0.62, brightnessHz: 3000, surface: 'carpet' },
    events: [
      ev('pageTurn', 10, 0.3, { distance: 'near' }),
      ev('footstep', 16, 0.18, { distance: 'far' }),
      ev('creak', 28, 0.18, { distance: 'mid' }),
      ev('cough', 34, 0.18, { distance: 'far' }),
    ],
    intensityBias: -0.3,
    duckingBias: -0.15,
    activity: 'still',
    eventHeadroomDb: 16,
    tone: { tiltDb: -5, highShelf: { hz: 6000, db: -3 } },
  },

  gallery: {
    label: 'Galería',
    stems: [
      { stem: 'room_tone', gain: 0.36 },
      { stem: 'babble_hall', gain: 0.14, lowpass: 2000, width: 0.8 },
    ],
    room: { size: 'hall', wet: 0.28, rt60Scale: 1.15, damping: 0.2, brightnessHz: 8200, surface: 'concrete' },
    events: [
      ev('footstep', 7, 0.28, { distance: 'mid' }),
      ev('cough', 30, 0.2, { distance: 'far' }),
    ],
    intensityBias: -0.2,
    activity: 'calm',
    eventHeadroomDb: 14,
    tone: { tiltDb: 4.5 },
  },

  foyer: {
    label: 'Vestíbulo',
    stems: [
      { stem: 'babble_hall', gain: 0.42, width: 0.95 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'hall', wet: 0.24, damping: 0.26, brightnessHz: 7400, surface: 'tile' },
    events: [
      ev('footstep', 4, 0.26, { distance: 'mid' }),
      ev('doorLatch', 18, 0.3, { distance: 'mid' }),
      ev('registerBeep', 26, 0.2, { distance: 'far' }),
    ],
    activity: 'busy',
    eventHeadroomDb: 8,
    tone: { tiltDb: 3 },
  },

  // --- transit -------------------------------------------------------------
  station: {
    label: 'Estación',
    stems: [
      { stem: 'babble_hall', gain: 0.5, width: 1 },
      { stem: 'transit_hum', gain: 0.22, lowpass: 900 },
    ],
    room: { size: 'hall', wet: 0.26, rt60Scale: 1.25, damping: 0.2, brightnessHz: 8000, surface: 'tile' },
    events: [
      ev('announcement', 20, 0.42, { distance: 'far' }),
      ev('footstepRun', 7, 0.3, { distance: 'mid' }),
      ev('luggage', 13, 0.35, { distance: 'mid' }),
      ev('doorLatch', 30, 0.25, { distance: 'far' }),
    ],
    intensityBias: 0.05,
    duckingBias: 0.1,
    activity: 'bustling',
    eventHeadroomDb: 4,
    tone: { tiltDb: 2.5, lowShelf: { hz: 120, db: 3 } },
  },

  airport: {
    label: 'Aeropuerto',
    stems: [
      { stem: 'babble_hall', gain: 0.45, width: 1 },
      { stem: 'hvac_office', gain: 0.4 },
    ],
    room: { size: 'hall', wet: 0.24, rt60Scale: 1.4, damping: 0.22, brightnessHz: 6800, surface: 'tile' },
    events: [
      ev('announcement', 16, 0.45, { distance: 'far' }),
      ev('luggage', 9, 0.35, { distance: 'mid' }),
      ev('footstepRun', 8, 0.28, { distance: 'mid' }),
      ev('registerBeep', 20, 0.2, { distance: 'mid' }),
    ],
    duckingBias: 0.1,
    activity: 'bustling',
    eventHeadroomDb: 4,
    tone: { tiltDb: 1.5 },
  },

  vehicle_interior: {
    label: 'En el vehículo',
    stems: [
      { stem: 'transit_hum', gain: 0.6 },
      { stem: 'babble_close', gain: 0.12, lowpass: 1800, width: 0.6 },
    ],
    room: { size: 'small', wet: 0.07, rt60Scale: 0.3, damping: 0.85, brightnessHz: 2400, surface: 'carpet' },
    events: [
      ev('plasticTap', 9, 0.25, { burst: 0.5, distance: 'near' }),
      ev('honk', 34, 0.2, { distance: 'far' }),
      ev('announcement', 45, 0.22, { distance: 'far' }),
    ],
    duckingBias: 0.15,
    activity: 'calm',
    eventHeadroomDb: 8,
    tone: { tiltDb: -7, lowShelf: { hz: 130, db: 5 } },
  },

  hotel_lobby: {
    label: 'Recepción de hotel',
    stems: [
      { stem: 'babble_hall', gain: 0.26, lowpass: 3000, width: 0.9 },
      { stem: 'hvac_office', gain: 0.38 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'hall', wet: 0.22, rt60Scale: 0.75, damping: 0.5, brightnessHz: 4000, surface: 'carpet' },
    events: [
      ev('footstep', 6, 0.26, { distance: 'mid' }),
      ev('luggage', 18, 0.3, { distance: 'mid' }),
      ev('doorChime', 30, 0.25, { distance: 'far' }),
      ev('typing', 12, 0.22, { burst: 0.4, distance: 'near' }),
      ev('phoneRing', 40, 0.22, { distance: 'far' }),
    ],
    intensityBias: -0.05,
    activity: 'busy',
    eventHeadroomDb: 9,
    tone: { tiltDb: -2 },
  },

  // --- home ----------------------------------------------------------------
  home: {
    label: 'Casa',
    stems: [
      { stem: 'room_tone', gain: 0.55 },
      { stem: 'traffic_far', gain: 0.16, lowpass: 700 },
    ],
    room: { size: 'small', wet: 0.1, rt60Scale: 0.8, damping: 0.6, brightnessHz: 3600, surface: 'wood' },
    events: [
      ev('creak', 20, 0.22, { distance: 'mid' }),
      ev('porcelain', 26, 0.22, { distance: 'far' }),
      ev('doorLatch', 34, 0.24, { distance: 'far' }),
    ],
    intensityBias: -0.2,
    activity: 'calm',
    eventHeadroomDb: 11,
    tone: { tiltDb: -3, lowShelf: { hz: 170, db: 2 } },
  },

  // --- broadcast and performance -------------------------------------------
  studio_radio: {
    label: 'Estudio de radio',
    stems: [
      { stem: 'studio_tone', gain: 0.6 },
    ],
    room: { size: 'small', wet: 0.05, rt60Scale: 0.4, damping: 0.8, brightnessHz: 2800, surface: 'carpet' },
    events: [
      ev('paperRustle', 22, 0.16, { distance: 'near' }),
    ],
    intensityBias: -0.35,
    duckingBias: -0.2,
    activity: 'still',
    eventHeadroomDb: 8,
    tone: { tiltDb: -5, peak: { hz: 180, db: 2.5, q: 6 } },
  },

  studio_newsroom: {
    label: 'Estudio / redacción',
    stems: [
      { stem: 'studio_tone', gain: 0.5 },
      { stem: 'hvac_office', gain: 0.24 },
      { stem: 'babble_close', gain: 0.08, lowpass: 1600, width: 0.6 },
    ],
    room: { size: 'small', wet: 0.07, rt60Scale: 0.5, damping: 0.65, brightnessHz: 4200, surface: 'carpet' },
    events: [
      ev('typing', 14, 0.16, { burst: 0.4, distance: 'far' }),
      ev('paperRustle', 18, 0.18, { distance: 'near' }),
      ev('phoneRing', 55, 0.14, { distance: 'far' }),
    ],
    intensityBias: -0.3,
    duckingBias: -0.15,
    activity: 'busy',
    eventHeadroomDb: 6,
    tone: { tiltDb: -2 },
  },

  studio_podcast: {
    label: 'Estudio de podcast',
    stems: [
      { stem: 'studio_tone', gain: 0.5 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'small', wet: 0.08, rt60Scale: 0.45, damping: 0.75, brightnessHz: 3400, surface: 'carpet' },
    events: [
      ev('chairScrape', 40, 0.14, { distance: 'near' }),
      ev('creak', 34, 0.14, { distance: 'near' }),
    ],
    intensityBias: -0.35,
    duckingBias: -0.2,
    activity: 'still',
    eventHeadroomDb: 9,
    tone: { tiltDb: -4 },
  },

  studio_intimate: {
    label: 'Grabación íntima',
    // Storytelling and personal essay: one person, close mic, a domestic room rather
    // than a booth. Drier and warmer than the podcast studio, with a little more of
    // the room's own life — someone recording at their desk, not in a facility.
    stems: [
      { stem: 'room_tone', gain: 0.42 },
      { stem: 'studio_tone', gain: 0.28 },
    ],
    room: { size: 'small', wet: 0.06, rt60Scale: 0.5, damping: 0.72, brightnessHz: 3000, surface: 'carpet' },
    events: [
      ev('creak', 26, 0.16, { distance: 'near' }),
      ev('paperRustle', 34, 0.14, { distance: 'near' }),
    ],
    intensityBias: -0.35,
    duckingBias: -0.2,
    activity: 'still',
    eventHeadroomDb: 11,
    tone: { tiltDb: -4.5, lowShelf: { hz: 200, db: 2 } },
  },

  venue_stage: {
    label: 'Auditorio',
    stems: [
      { stem: 'babble_hall', gain: 0.16, lowpass: 1600, width: 0.9 },
      { stem: 'room_tone', gain: 0.3 },
    ],
    room: { size: 'hall', wet: 0.3, rt60Scale: 1.1, damping: 0.32, brightnessHz: 5800, surface: 'wood' },
    events: [
      ev('cough', 13, 0.28, { distance: 'far' }),
      ev('chairScrape', 20, 0.24, { distance: 'far' }),
      ev('applause', 90, 0.35, { distance: 'far' }),
      ev('creak', 26, 0.18, { distance: 'far' }),
    ],
    intensityBias: -0.2,
    duckingBias: -0.1,
    activity: 'calm',
    eventHeadroomDb: 12,
    tone: { tiltDb: 0.5, lowShelf: { hz: 150, db: 2 } },
  },

  // --- weather-flavoured variants ------------------------------------------
  street_rain: {
    label: 'Calle con lluvia',
    stems: [
      { stem: 'rain', gain: 0.6 },
      { stem: 'traffic_near', gain: 0.32, lowpass: 5000, width: 1 },
      { stem: 'traffic_far', gain: 0.26 },
    ],
    room: { size: 'outdoor', wet: 0.06, brightnessHz: 6000, surface: 'asphalt' },
    events: [
      ev('vehiclePass', 11, 0.4, { distance: 'near' }),
      ev('rainDrip', 5, 0.3, { burst: 0.4, distance: 'near' }),
      ev('honk', 34, 0.25, { distance: 'far' }),
    ],
    duckingBias: 0.15,
    activity: 'busy',
    eventHeadroomDb: 5,
    tone: { tiltDb: -1 },
    family: 'street',
  },

  park_rain: {
    label: 'Parque con lluvia',
    stems: [
      { stem: 'rain', gain: 0.65 },
      { stem: 'wind_leaves', gain: 0.3 },
    ],
    room: { size: 'outdoor', wet: 0.07, brightnessHz: 6400, surface: 'asphalt' },
    events: [
      ev('rainDrip', 4, 0.32, { burst: 0.5, distance: 'near' }),
      ev('windGust', 16, 0.3),
      ev('bird', 20, 0.2, { distance: 'far' }),
    ],
    duckingBias: 0.1,
    activity: 'calm',
    eventHeadroomDb: 8,
    tone: { tiltDb: -1.5 },
    family: 'park',
  },
} satisfies Record<string, SceneRecipe>;

export type SceneId = keyof typeof SCENE_RECIPES;
export const SCENE_IDS = Object.keys(SCENE_RECIPES) as SceneId[];

export const isSceneId = (value: unknown): value is SceneId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCENE_RECIPES, value);

// ---------------------------------------------------------------------------
// Scenario label -> scene
//
// Every one of the 40 `Diálogo (2 personas)` context labels in data/scenarios.ts is
// listed here. scripts/check-ambience.mjs walks SCENARIO_DATABASE and fails if any
// label is missing, so the catalogue and this table cannot drift apart.
// ---------------------------------------------------------------------------

const DIALOGUE_SCENE_BY_LABEL: Record<string, SceneId> = {
  'Datos de Contacto': 'office',
  'Recepción de Hotel': 'hotel_lobby',
  'Hotel (Recepción)': 'hotel_lobby',
  'Caja / Pagar': 'shop_checkout',
  'Taxi / Transporte': 'vehicle_interior',
  'Turno / Cita': 'clinic_waiting',
  'En la Farmacia': 'shop_small',
  'Café / Restaurante': 'cafe',
  'Mercado / Verdulería': 'market',
  'Tienda de Ropa': 'shop_small',
  'Cine / Entradas': 'foyer',
  'Pedir Indicaciones': 'street',
  'Estación / Transporte': 'station',
  'Consultorio / Turno': 'clinic_waiting',
  'Gimnasio': 'gym',
  'Peluquería': 'salon',
  'Comisaría / Denuncia': 'police_station',
  'Soporte Técnico': 'call_center',
  'Trabajo / Oficina': 'office',
  'Inmobiliaria / Alquiler': 'office',
  'Taller Mecánico': 'workshop_garage',
  'Entrevista de Trabajo': 'office_meeting',
  'Banco / Finanzas': 'bank',
  'Consulta Médica': 'clinic_room',
  'Veterinaria': 'clinic_room',
  'Cena con Amigos': 'restaurant',
  'Aeropuerto / Aerolínea': 'airport',
  'Servicio al Cliente': 'call_center',
  'Redacción de Periódico': 'newsroom',
  'Startup / Inversores': 'open_office',
  'Juicio / Legal': 'courtroom',
  'Galería de Arte': 'gallery',
  'Terapia Psicológica': 'therapy_room',
  'Entrevista Política': 'studio_radio',
  'Cata de Vinos / Lujo': 'wine_tasting',
  'Universidad / Tutoría': 'classroom',
  'Rodaje de Cine': 'backstage',
  'Comunidad de Vecinos': 'office_meeting',
  'Negociación / Diplomacia': 'office_meeting',
  'Backstage / Música': 'backstage',
};

/**
 * Overrides for the single-voice / interview formats.
 *
 * The default for those formats is the studio they are recorded in — a radio bulletin
 * about traffic is heard from a studio, not from a road, and pretending otherwise
 * would contradict the audio the learner is actually listening to. Only the handful of
 * labels whose *format* differs get an override: breaking news and investigations come
 * from a live newsroom, and speeches are delivered to a room.
 */
const RADIO_SCENE_BY_LABEL: Record<string, SceneId> = {
  'Última Hora': 'studio_newsroom',
  'Cobertura de Crisis': 'studio_newsroom',
  'Investigación Periodística': 'studio_newsroom',
  'Debate Electoral': 'studio_newsroom',
  'Análisis Político': 'studio_newsroom',
  'Sucesos y Comunidad': 'studio_newsroom',
};

const MONOLOGUE_SCENE_BY_LABEL: Record<string, SceneId> = {
  'Discurso Motivacional': 'venue_stage',
  'Discurso de Despedida': 'venue_stage',
  'Monólogo de Humor': 'venue_stage',
  'Manifiesto Creativo': 'venue_stage',
  'Análisis Social': 'venue_stage',
  'Carta Abierta': 'venue_stage',
  'Crónica de mi Barrio': 'home',
  'Confesión y Catarsis': 'home',
  'Reflexión sobre el Tiempo': 'home',
};

const DEFAULT_SCENE_BY_TEXT_TYPE: Record<string, SceneId> = {
  [TextType.Dialogue]: 'office',
  [TextType.RadioNews]: 'studio_radio',
  [TextType.PodcastInterview]: 'studio_podcast',
  // A monologue is one person telling a story, usually close-miked in a room rather
  // than in a two-chair interview booth. Sending it to the same studio as the podcast
  // would make two thirds of the catalogue share one ambience.
  [TextType.Monologue]: 'studio_intimate',
};

// ---------------------------------------------------------------------------
// Free-text inference
//
// Used for Vocabulary mode, custom topics and AccentChallenge, where there is no
// scenario label at all. Unlike the old version this consumes the topic AND the
// model's keywords — previously `inferTagsFromAction` looked only at the action
// label, so the richest contextual signal available was thrown away.
// ---------------------------------------------------------------------------

const KEYWORD_SCENES: Array<{ scene: SceneId; pattern: RegExp }> = [
  { scene: 'street_rain', pattern: /(lluvia|tormenta|llover|rain|storm)/i },
  { scene: 'park', pattern: /(parque|bosque|campo|jardín|jardin|montaña|montana|naturaleza|park|forest|nature|hiking|senderismo)/i },
  { scene: 'plaza', pattern: /(playa|mar|costa|beach|sea|ocean|puerto)/i },
  { scene: 'airport', pattern: /(aeropuerto|avión|avion|vuelo|airport|flight|embarque)/i },
  { scene: 'station', pattern: /(estación|estacion|tren|metro|subte|andén|anden|station|train|platform)/i },
  { scene: 'vehicle_interior', pattern: /(taxi|autobús|autobus|colectivo|micro|coche|auto|conducir|bus|car|driving)/i },
  { scene: 'market', pattern: /(mercado|feria|verdulería|verduleria|puesto|market|stall)/i },
  { scene: 'cafe', pattern: /(café|cafe|cafetería|cafeteria|desayuno|merienda|coffee|breakfast)/i },
  { scene: 'restaurant', pattern: /(restaurante|comida|cena|almuerzo|menú|menu|camarero|mesero|restaurant|dinner|lunch)/i },
  { scene: 'bar_night', pattern: /(bar|copas|cerveza|cóctel|coctel|pub|nightlife|fiesta)/i },
  { scene: 'hospital', pattern: /(hospital|urgencias|clínica|clinica|enfermer|emergency)/i },
  { scene: 'clinic_room', pattern: /(médico|medico|doctor|consulta|salud|síntoma|sintoma|dentista|health)/i },
  { scene: 'shop_small', pattern: /(tienda|farmacia|comprar|ropa|zapatos|shop|store|pharmacy)/i },
  { scene: 'shop_checkout', pattern: /(caja|pagar|supermercado|cajero|checkout|supermarket)/i },
  { scene: 'gym', pattern: /(gimnasio|entrenar|deporte|ejercicio|gym|workout|fitness)/i },
  { scene: 'classroom', pattern: /(clase|aula|escuela|colegio|universidad|profesor|estudiar|classroom|school|university)/i },
  { scene: 'library', pattern: /(biblioteca|libro|lectura|library|book)/i },
  { scene: 'courtroom', pattern: /(juicio|tribunal|abogad|juez|legal|court|trial)/i },
  { scene: 'bank', pattern: /(banco|cuenta|préstamo|prestamo|hipoteca|bank|loan|finanzas|finance)/i },
  { scene: 'police_station', pattern: /(policía|policia|comisaría|comisaria|denuncia|robo|police|crime)/i },
  { scene: 'hotel_lobby', pattern: /(hotel|recepción|recepcion|check-in|habitación|habitacion|reserva|booking)/i },
  { scene: 'workshop_garage', pattern: /(taller|mecánic|mecanic|motor|reparar|garage|obra|construcción|construccion)/i },
  { scene: 'office', pattern: /(oficina|trabajo|reunión|reunion|jefe|correo|office|work|meeting|email)/i },
  { scene: 'street', pattern: /(calle|ciudad|tráfico|trafico|avenida|barrio|street|city|traffic|direcciones)/i },
  { scene: 'home', pattern: /(casa|hogar|piso|apartamento|familia|cocina|home|family|apartment)/i },
];

function inferSceneFromText(text: string): SceneId | null {
  if (!text) return null;
  for (const { scene, pattern } of KEYWORD_SCENES) {
    if (pattern.test(text)) return scene;
  }
  return null;
}

/**
 * Weather and time-of-day modifiers applied on top of a resolved scene.
 *
 * Rain is the only one that changes the scene outright, because it changes what you
 * hear more than the location does. Everything else nudges the mix.
 */
function applyModifiers(scene: SceneId, text: string): SceneId {
  const isOutdoor = SCENE_RECIPES[scene].room.size === 'outdoor';
  if (isOutdoor && /(lluvia|lloviendo|tormenta|rain|storm|paraguas|umbrella)/i.test(text)) {
    if (scene === 'park' || scene === 'plaza') return 'park_rain';
    return 'street_rain';
  }
  return scene;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface AmbienceScene {
  scenarioLabel?: string;
  scenarioActionLabel?: string;
  textType?: TextType;
  topic?: string;
  keywords?: string;
  /** A scene id supplied by the model, if it produced a valid one. */
  sceneHint?: string;
}

export interface ResolvedAmbience {
  id: SceneId;
  recipe: SceneRecipe;
  /** How the scene was chosen — surfaced by the test suite and useful when debugging. */
  source: 'label' | 'textType' | 'model' | 'keyword' | 'default';
  /**
   * How present the place is, 0-1. Below 1 for a recording *made* somewhere rather
   * than a conversation happening there.
   *
   * A podcast episode about cooking is recorded at a kitchen table, and that is worth
   * hearing — but at a full market's density and level it would bury the dialogue and
   * claim something untrue, that the microphone is in the market. Scaling the bed, the
   * events and the onset budget together says the accurate thing: this was recorded in
   * that place.
   */
  presence?: number;
}

export function resolveAmbienceScene(scene: AmbienceScene): ResolvedAmbience {
  const label = scene.scenarioLabel?.trim() ?? '';
  const action = scene.scenarioActionLabel?.trim() ?? '';
  const topic = scene.topic?.trim() ?? '';
  const keywords = scene.keywords?.trim() ?? '';
  const textType = scene.textType;
  const combined = [label, action, topic, keywords].filter(Boolean).join(' | ');

  const finish = (id: SceneId, source: ResolvedAmbience['source']): ResolvedAmbience => {
    const modified = applyModifiers(id, `${action} ${topic} ${keywords}`);
    return { id: modified, recipe: SCENE_RECIPES[modified], source };
  };

  // 1. Format-specific label overrides (a bulletin about the courts is still a studio,
  //    but breaking news comes from a newsroom).
  if (label) {
    if (textType === TextType.RadioNews && RADIO_SCENE_BY_LABEL[label]) {
      return finish(RADIO_SCENE_BY_LABEL[label], 'label');
    }
    if (textType === TextType.Monologue && MONOLOGUE_SCENE_BY_LABEL[label]) {
      return finish(MONOLOGUE_SCENE_BY_LABEL[label], 'label');
    }
    // 2. The dialogue catalogue: a real place with a real ambience.
    if ((!textType || textType === TextType.Dialogue) && DIALOGUE_SCENE_BY_LABEL[label]) {
      return finish(DIALOGUE_SCENE_BY_LABEL[label], 'label');
    }
    // 3. Single-voice and interview formats: the studio they are recorded in.
    if (textType && DEFAULT_SCENE_BY_TEXT_TYPE[textType] && textType !== TextType.Dialogue) {
      return finish(DEFAULT_SCENE_BY_TEXT_TYPE[textType], 'textType');
    }
    if (DIALOGUE_SCENE_BY_LABEL[label]) {
      return finish(DIALOGUE_SCENE_BY_LABEL[label], 'label');
    }
  }

  // 4. A scene the model named explicitly, validated against the closed list.
  if (isSceneId(scene.sceneHint)) return finish(scene.sceneHint, 'model');

  // 5. Free text (Vocabulary mode, custom topics, AccentChallenge).
  const inferred = inferSceneFromText(combined);
  if (inferred) return finish(inferred, 'keyword');

  // 6. Whatever the format implies, or a neutral room.
  if (textType && DEFAULT_SCENE_BY_TEXT_TYPE[textType]) {
    return finish(DEFAULT_SCENE_BY_TEXT_TYPE[textType], 'textType');
  }
  return finish('office', 'default');
}

/** Every scene id the model is allowed to name, for the generation prompt. */
export const MODEL_SELECTABLE_SCENES: SceneId[] = SCENE_IDS.filter(
  (id) => id !== 'street_rain' && id !== 'park_rain',
);
