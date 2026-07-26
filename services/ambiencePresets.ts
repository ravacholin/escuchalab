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

export interface StemLayer {
  stem: StemId;
  gain: number;
  /** Optional shaping so one stem can play several roles (near vs. muffled-through-a-wall). */
  lowpass?: number;
  highpass?: number;
  /** 0 = mono/centred, 1 = fully decorrelated stereo. */
  width?: number;
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

export interface SceneRecipe {
  /** Shown in the player's status line. */
  label: string;
  stems: StemLayer[];
  room: { size: RoomSize; wet: number };
  events: EventSpec[];
  intensityBias?: number;
  duckingBias?: number;
}

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
    room: { size: 'small', wet: 0.16 },
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
  },

  restaurant: {
    label: 'Restaurante',
    stems: [
      { stem: 'babble_close', gain: 0.62, width: 1 },
      { stem: 'kitchen', gain: 0.24, lowpass: 3200, width: 0.5 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'medium', wet: 0.2 },
    events: [
      ev('porcelain', 4, 0.45, { burst: 0.55, distance: 'mid' }),
      ev('cutlery', 3.5, 0.4, { burst: 0.6, distance: 'near' }),
      ev('glass', 9, 0.35, { burst: 0.4, distance: 'near' }),
      ev('chairScrape', 14, 0.3, { distance: 'mid' }),
      ev('laugh', 20, 0.3, { distance: 'far' }),
      ev('sizzle', 30, 0.26, { distance: 'far' }),
      ev('footstep', 5, 0.2, { distance: 'mid' }),
    ],
  },

  bar_night: {
    label: 'Bar (noche)',
    stems: [
      { stem: 'babble_close', gain: 0.75, width: 1 },
      { stem: 'room_tone', gain: 0.2 },
      { stem: 'kitchen', gain: 0.1, lowpass: 2200 },
    ],
    room: { size: 'medium', wet: 0.24 },
    events: [
      ev('glass', 4, 0.45, { burst: 0.6, distance: 'near' }),
      ev('laugh', 11, 0.4, { distance: 'mid' }),
      ev('coin', 26, 0.25, { distance: 'near' }),
      ev('cashDrawer', 40, 0.3, { distance: 'mid' }),
      ev('doorLatch', 38, 0.3, { distance: 'far' }),
    ],
    intensityBias: 0.1,
    duckingBias: 0.1,
  },

  wine_tasting: {
    label: 'Cata / sala privada',
    stems: [
      { stem: 'room_tone', gain: 0.45 },
      { stem: 'babble_close', gain: 0.14, lowpass: 2400, width: 0.7 },
    ],
    room: { size: 'medium', wet: 0.22 },
    events: [
      ev('glass', 9, 0.35, { burst: 0.35, distance: 'near' }),
      ev('chairScrape', 30, 0.2, { distance: 'mid' }),
      ev('footstep', 16, 0.15, { distance: 'far' }),
    ],
    intensityBias: -0.15,
  },

  // --- shops and markets ---------------------------------------------------
  market: {
    label: 'Mercado',
    stems: [
      { stem: 'babble_open', gain: 0.68, width: 1 },
      { stem: 'traffic_far', gain: 0.22, lowpass: 1400 },
    ],
    room: { size: 'outdoor', wet: 0.07 },
    events: [
      ev('woodKnock', 6, 0.35, { burst: 0.5, distance: 'mid' }),
      ev('coin', 13, 0.3, { distance: 'near' }),
      ev('footstep', 4, 0.25, { distance: 'mid' }),
      ev('announcement', 24, 0.3, { distance: 'far' }),
      ev('registerBeep', 20, 0.2, { distance: 'far' }),
    ],
    intensityBias: 0.1,
  },

  shop_small: {
    label: 'Tienda',
    stems: [
      { stem: 'room_tone', gain: 0.4 },
      { stem: 'babble_close', gain: 0.16, lowpass: 2600, width: 0.6 },
      { stem: 'hvac_office', gain: 0.28 },
    ],
    room: { size: 'small', wet: 0.13 },
    events: [
      ev('doorChime', 26, 0.4, { distance: 'mid' }),
      ev('registerBeep', 14, 0.3, { distance: 'near' }),
      ev('plasticTap', 10, 0.25, { burst: 0.4, distance: 'near' }),
      ev('footstep', 7, 0.22, { distance: 'mid' }),
      ev('paperRustle', 18, 0.22, { distance: 'near' }),
    ],
  },

  shop_checkout: {
    label: 'Caja',
    stems: [
      { stem: 'babble_close', gain: 0.3, lowpass: 3000, width: 0.8 },
      { stem: 'hvac_office', gain: 0.3 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'medium', wet: 0.12 },
    events: [
      ev('registerBeep', 4.5, 0.4, { burst: 0.5, distance: 'near' }),
      ev('cashDrawer', 18, 0.35, { distance: 'near' }),
      ev('coin', 12, 0.3, { distance: 'near' }),
      ev('plasticTap', 7, 0.25, { burst: 0.6, distance: 'near' }),
      ev('footstep', 6, 0.2, { distance: 'mid' }),
    ],
  },

  salon: {
    label: 'Peluquería',
    stems: [
      { stem: 'room_tone', gain: 0.38 },
      { stem: 'babble_close', gain: 0.32, width: 0.8 },
    ],
    room: { size: 'small', wet: 0.15 },
    events: [
      ev('hairDryer', 20, 0.4, { distance: 'mid' }),
      ev('metalClank', 14, 0.2, { distance: 'near' }),
      ev('chairScrape', 24, 0.22, { distance: 'mid' }),
      ev('footstep', 9, 0.2, { distance: 'mid' }),
    ],
  },

  // --- street and outdoors -------------------------------------------------
  street: {
    label: 'Calle',
    stems: [
      { stem: 'traffic_near', gain: 0.55, width: 1 },
      { stem: 'traffic_far', gain: 0.4 },
      { stem: 'babble_open', gain: 0.14, lowpass: 2000, width: 0.9 },
    ],
    room: { size: 'outdoor', wet: 0.05 },
    events: [
      ev('vehiclePass', 9, 0.45, { distance: 'near' }),
      ev('honk', 26, 0.35, { distance: 'far' }),
      ev('footstep', 4, 0.28, { distance: 'near' }),
      ev('siren', 70, 0.3, { distance: 'far' }),
    ],
    duckingBias: 0.1,
  },

  plaza: {
    label: 'Plaza',
    stems: [
      { stem: 'babble_open', gain: 0.5, width: 1 },
      { stem: 'traffic_far', gain: 0.3 },
      { stem: 'wind_leaves', gain: 0.18, lowpass: 6000 },
    ],
    room: { size: 'outdoor', wet: 0.08 },
    events: [
      ev('footstep', 5, 0.25, { distance: 'mid' }),
      ev('bird', 14, 0.25, { distance: 'far' }),
      ev('honk', 40, 0.22, { distance: 'far' }),
    ],
  },

  park: {
    label: 'Parque',
    stems: [
      { stem: 'wind_leaves', gain: 0.62 },
      { stem: 'babble_open', gain: 0.12, lowpass: 1800, width: 1 },
      { stem: 'traffic_far', gain: 0.16, lowpass: 900 },
    ],
    room: { size: 'outdoor', wet: 0.06 },
    events: [
      ev('bird', 6, 0.35, { burst: 0.5, distance: 'mid' }),
      ev('windGust', 14, 0.35),
      ev('footstep', 10, 0.2, { distance: 'mid' }),
    ],
    intensityBias: -0.05,
  },

  // --- workplaces ----------------------------------------------------------
  office: {
    label: 'Oficina',
    stems: [
      { stem: 'hvac_office', gain: 0.55 },
      { stem: 'room_tone', gain: 0.3 },
    ],
    room: { size: 'medium', wet: 0.1 },
    events: [
      ev('typing', 7, 0.3, { burst: 0.4, distance: 'mid' }),
      ev('paperRustle', 13, 0.3, { distance: 'near' }),
      ev('phoneRing', 45, 0.25, { distance: 'far' }),
      ev('printer', 34, 0.28, { distance: 'far' }),
      ev('chairScrape', 26, 0.25, { distance: 'near' }),
    ],
    intensityBias: -0.1,
  },

  open_office: {
    label: 'Oficina abierta',
    stems: [
      { stem: 'hvac_office', gain: 0.45 },
      { stem: 'babble_close', gain: 0.26, lowpass: 2800, width: 0.9 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.13 },
    events: [
      ev('typing', 4, 0.3, { burst: 0.55, distance: 'mid' }),
      ev('phoneRing', 30, 0.25, { distance: 'far' }),
      ev('printer', 26, 0.25, { distance: 'far' }),
      ev('footstep', 8, 0.2, { distance: 'far' }),
      ev('chairScrape', 20, 0.22, { distance: 'mid' }),
    ],
  },

  office_meeting: {
    label: 'Sala de reunión',
    stems: [
      { stem: 'room_tone', gain: 0.42 },
      { stem: 'hvac_office', gain: 0.3 },
    ],
    room: { size: 'medium', wet: 0.14 },
    events: [
      ev('paperRustle', 12, 0.3, { distance: 'near' }),
      ev('chairScrape', 22, 0.25, { distance: 'near' }),
      ev('plasticTap', 20, 0.18, { distance: 'near' }),
    ],
    intensityBias: -0.2,
    duckingBias: -0.1,
  },

  call_center: {
    label: 'Centro de atención',
    stems: [
      { stem: 'babble_close', gain: 0.4, lowpass: 3400, width: 0.95 },
      { stem: 'hvac_office', gain: 0.4 },
    ],
    room: { size: 'large', wet: 0.12 },
    events: [
      ev('typing', 3.5, 0.28, { burst: 0.6, distance: 'mid' }),
      ev('phoneRing', 16, 0.28, { distance: 'far' }),
      ev('chairScrape', 24, 0.2, { distance: 'far' }),
    ],
  },

  newsroom: {
    label: 'Redacción',
    stems: [
      { stem: 'babble_close', gain: 0.34, lowpass: 3200, width: 0.9 },
      { stem: 'hvac_office', gain: 0.4 },
      { stem: 'room_tone', gain: 0.18 },
    ],
    room: { size: 'large', wet: 0.13 },
    events: [
      ev('typing', 2.6, 0.32, { burst: 0.7, distance: 'mid' }),
      ev('phoneRing', 20, 0.28, { distance: 'far' }),
      ev('printer', 22, 0.28, { distance: 'far' }),
      ev('paperRustle', 11, 0.26, { distance: 'near' }),
    ],
    intensityBias: 0.05,
  },

  workshop_garage: {
    label: 'Taller',
    stems: [
      { stem: 'hvac_office', gain: 0.35, lowpass: 3000 },
      { stem: 'transit_hum', gain: 0.35, lowpass: 1600 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.26 },
    events: [
      ev('metalClank', 6, 0.5, { burst: 0.5, distance: 'mid' }),
      ev('impactWrench', 16, 0.45, { distance: 'mid' }),
      ev('compressor', 40, 0.4, { distance: 'far' }),
      ev('footstep', 9, 0.25, { distance: 'mid' }),
    ],
    intensityBias: 0.1,
    duckingBias: 0.15,
  },

  gym: {
    label: 'Gimnasio',
    stems: [
      { stem: 'hvac_office', gain: 0.45 },
      { stem: 'babble_close', gain: 0.16, lowpass: 2400, width: 0.8 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.22 },
    events: [
      ev('weightClank', 6, 0.45, { burst: 0.4, distance: 'mid' }),
      ev('footstep', 3.5, 0.25, { distance: 'mid' }),
      ev('metalClank', 12, 0.3, { distance: 'far' }),
    ],
    intensityBias: 0.05,
  },

  backstage: {
    label: 'Backstage',
    stems: [
      { stem: 'room_tone', gain: 0.22, highpass: 120 },
      { stem: 'babble_close', gain: 0.4, lowpass: 3000, width: 0.9 },
      { stem: 'hvac_office', gain: 0.2, highpass: 140 },
    ],
    room: { size: 'large', wet: 0.2 },
    events: [
      ev('metalClank', 11, 0.3, { distance: 'mid' }),
      ev('doorLatch', 20, 0.35, { distance: 'mid' }),
      ev('footstep', 5, 0.25, { distance: 'near' }),
      ev('plasticTap', 14, 0.22, { distance: 'near' }),
    ],
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
    room: { size: 'medium', wet: 0.16 },
    events: [
      ev('footstep', 8, 0.22, { distance: 'far' }),
      ev('doorLatch', 24, 0.28, { distance: 'mid' }),
      ev('cough', 18, 0.25, { distance: 'far' }),
      ev('pageTurn', 20, 0.2, { distance: 'near' }),
      ev('announcement', 40, 0.25, { distance: 'far' }),
    ],
    intensityBias: -0.1,
  },

  clinic_room: {
    label: 'Consultorio',
    stems: [
      { stem: 'room_tone', gain: 0.45 },
      { stem: 'hvac_office', gain: 0.3 },
    ],
    room: { size: 'small', wet: 0.11 },
    events: [
      ev('paperRustle', 14, 0.28, { distance: 'near' }),
      ev('plasticTap', 18, 0.22, { distance: 'near' }),
      ev('doorLatch', 40, 0.22, { distance: 'far' }),
    ],
    intensityBias: -0.25,
    duckingBias: -0.1,
  },

  hospital: {
    label: 'Hospital',
    stems: [
      { stem: 'babble_hall', gain: 0.3, lowpass: 2800, width: 0.9 },
      { stem: 'hvac_office', gain: 0.45 },
    ],
    room: { size: 'hall', wet: 0.2 },
    events: [
      ev('monitorBeep', 7, 0.25, { distance: 'far' }),
      ev('footstep', 5, 0.25, { distance: 'mid' }),
      ev('announcement', 34, 0.3, { distance: 'far' }),
      ev('doorLatch', 26, 0.25, { distance: 'far' }),
    ],
  },

  therapy_room: {
    label: 'Consulta privada',
    stems: [
      { stem: 'room_tone', gain: 0.5 },
    ],
    room: { size: 'small', wet: 0.12 },
    events: [
      ev('creak', 22, 0.2, { distance: 'near' }),
      ev('chairScrape', 40, 0.15, { distance: 'near' }),
    ],
    intensityBias: -0.3,
    duckingBias: -0.15,
  },

  bank: {
    label: 'Banco',
    stems: [
      { stem: 'hvac_office', gain: 0.42 },
      { stem: 'babble_hall', gain: 0.16, lowpass: 2200, width: 0.8 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'large', wet: 0.18 },
    events: [
      ev('typing', 9, 0.25, { burst: 0.4, distance: 'mid' }),
      ev('paperRustle', 12, 0.26, { distance: 'near' }),
      ev('printer', 30, 0.25, { distance: 'mid' }),
      ev('footstep', 9, 0.2, { distance: 'far' }),
    ],
    intensityBias: -0.1,
  },

  police_station: {
    label: 'Comisaría',
    stems: [
      { stem: 'hvac_office', gain: 0.42 },
      { stem: 'babble_close', gain: 0.24, lowpass: 2600, width: 0.85 },
      { stem: 'room_tone', gain: 0.2 },
    ],
    room: { size: 'large', wet: 0.19 },
    events: [
      ev('typing', 6, 0.3, { burst: 0.5, distance: 'mid' }),
      ev('phoneRing', 26, 0.28, { distance: 'far' }),
      ev('doorLatch', 22, 0.3, { distance: 'mid' }),
      ev('footstep', 7, 0.24, { distance: 'mid' }),
    ],
  },

  courtroom: {
    label: 'Sala de vistas',
    stems: [
      { stem: 'room_tone', gain: 0.36 },
      { stem: 'babble_hall', gain: 0.1, lowpass: 1800, width: 0.7 },
    ],
    room: { size: 'hall', wet: 0.26 },
    events: [
      ev('paperRustle', 13, 0.28, { distance: 'near' }),
      ev('cough', 20, 0.25, { distance: 'far' }),
      ev('chairScrape', 26, 0.24, { distance: 'far' }),
      ev('creak', 30, 0.2, { distance: 'mid' }),
    ],
    intensityBias: -0.15,
    duckingBias: -0.1,
  },

  classroom: {
    label: 'Aula',
    stems: [
      { stem: 'room_tone', gain: 0.38 },
      { stem: 'babble_close', gain: 0.14, lowpass: 2200, width: 0.75 },
      { stem: 'hvac_office', gain: 0.26 },
    ],
    room: { size: 'medium', wet: 0.18 },
    events: [
      ev('chairScrape', 15, 0.3, { distance: 'mid' }),
      ev('paperRustle', 9, 0.3, { distance: 'near' }),
      ev('pageTurn', 12, 0.25, { distance: 'near' }),
      ev('cough', 24, 0.22, { distance: 'far' }),
    ],
    intensityBias: -0.15,
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
    room: { size: 'large', wet: 0.2 },
    events: [
      ev('pageTurn', 10, 0.3, { distance: 'near' }),
      ev('footstep', 16, 0.18, { distance: 'far' }),
      ev('creak', 28, 0.18, { distance: 'mid' }),
      ev('cough', 34, 0.18, { distance: 'far' }),
    ],
    intensityBias: -0.3,
    duckingBias: -0.15,
  },

  gallery: {
    label: 'Galería',
    stems: [
      { stem: 'room_tone', gain: 0.36 },
      { stem: 'babble_hall', gain: 0.14, lowpass: 2000, width: 0.8 },
    ],
    room: { size: 'hall', wet: 0.28 },
    events: [
      ev('footstep', 7, 0.28, { distance: 'mid' }),
      ev('cough', 30, 0.2, { distance: 'far' }),
    ],
    intensityBias: -0.2,
  },

  foyer: {
    label: 'Vestíbulo',
    stems: [
      { stem: 'babble_hall', gain: 0.42, width: 0.95 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'hall', wet: 0.24 },
    events: [
      ev('footstep', 4, 0.26, { distance: 'mid' }),
      ev('doorLatch', 18, 0.3, { distance: 'mid' }),
      ev('registerBeep', 26, 0.2, { distance: 'far' }),
    ],
  },

  // --- transit -------------------------------------------------------------
  station: {
    label: 'Estación',
    stems: [
      { stem: 'babble_hall', gain: 0.5, width: 1 },
      { stem: 'transit_hum', gain: 0.22, lowpass: 900 },
    ],
    room: { size: 'hall', wet: 0.26 },
    events: [
      ev('announcement', 20, 0.42, { distance: 'far' }),
      ev('footstepRun', 7, 0.3, { distance: 'mid' }),
      ev('luggage', 13, 0.35, { distance: 'mid' }),
      ev('doorLatch', 30, 0.25, { distance: 'far' }),
    ],
    intensityBias: 0.05,
    duckingBias: 0.1,
  },

  airport: {
    label: 'Aeropuerto',
    stems: [
      { stem: 'babble_hall', gain: 0.45, width: 1 },
      { stem: 'hvac_office', gain: 0.4 },
    ],
    room: { size: 'hall', wet: 0.24 },
    events: [
      ev('announcement', 16, 0.45, { distance: 'far' }),
      ev('luggage', 9, 0.35, { distance: 'mid' }),
      ev('footstepRun', 8, 0.28, { distance: 'mid' }),
      ev('registerBeep', 20, 0.2, { distance: 'mid' }),
    ],
    duckingBias: 0.1,
  },

  vehicle_interior: {
    label: 'En el vehículo',
    stems: [
      { stem: 'transit_hum', gain: 0.6 },
      { stem: 'babble_close', gain: 0.12, lowpass: 1800, width: 0.6 },
    ],
    room: { size: 'small', wet: 0.07 },
    events: [
      ev('plasticTap', 9, 0.25, { burst: 0.5, distance: 'near' }),
      ev('honk', 34, 0.2, { distance: 'far' }),
      ev('announcement', 45, 0.22, { distance: 'far' }),
    ],
    duckingBias: 0.15,
  },

  hotel_lobby: {
    label: 'Recepción de hotel',
    stems: [
      { stem: 'babble_hall', gain: 0.26, lowpass: 3000, width: 0.9 },
      { stem: 'hvac_office', gain: 0.38 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'hall', wet: 0.22 },
    events: [
      ev('footstep', 6, 0.26, { distance: 'mid' }),
      ev('luggage', 18, 0.3, { distance: 'mid' }),
      ev('doorChime', 30, 0.25, { distance: 'far' }),
      ev('typing', 12, 0.22, { burst: 0.4, distance: 'near' }),
      ev('phoneRing', 40, 0.22, { distance: 'far' }),
    ],
    intensityBias: -0.05,
  },

  // --- home ----------------------------------------------------------------
  home: {
    label: 'Casa',
    stems: [
      { stem: 'room_tone', gain: 0.55 },
      { stem: 'traffic_far', gain: 0.16, lowpass: 700 },
    ],
    room: { size: 'small', wet: 0.1 },
    events: [
      ev('creak', 20, 0.22, { distance: 'mid' }),
      ev('porcelain', 26, 0.22, { distance: 'far' }),
      ev('doorLatch', 34, 0.24, { distance: 'far' }),
    ],
    intensityBias: -0.2,
  },

  // --- broadcast and performance -------------------------------------------
  studio_radio: {
    label: 'Estudio de radio',
    stems: [
      { stem: 'studio_tone', gain: 0.6 },
    ],
    room: { size: 'small', wet: 0.05 },
    events: [
      ev('paperRustle', 22, 0.16, { distance: 'near' }),
    ],
    intensityBias: -0.35,
    duckingBias: -0.2,
  },

  studio_newsroom: {
    label: 'Estudio / redacción',
    stems: [
      { stem: 'studio_tone', gain: 0.5 },
      { stem: 'hvac_office', gain: 0.24 },
      { stem: 'babble_close', gain: 0.08, lowpass: 1600, width: 0.6 },
    ],
    room: { size: 'small', wet: 0.07 },
    events: [
      ev('typing', 14, 0.16, { burst: 0.4, distance: 'far' }),
      ev('paperRustle', 18, 0.18, { distance: 'near' }),
      ev('phoneRing', 55, 0.14, { distance: 'far' }),
    ],
    intensityBias: -0.3,
    duckingBias: -0.15,
  },

  studio_podcast: {
    label: 'Estudio de podcast',
    stems: [
      { stem: 'studio_tone', gain: 0.5 },
      { stem: 'room_tone', gain: 0.22 },
    ],
    room: { size: 'small', wet: 0.08 },
    events: [
      ev('chairScrape', 40, 0.14, { distance: 'near' }),
      ev('creak', 34, 0.14, { distance: 'near' }),
    ],
    intensityBias: -0.35,
    duckingBias: -0.2,
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
    room: { size: 'small', wet: 0.06 },
    events: [
      ev('creak', 26, 0.16, { distance: 'near' }),
      ev('paperRustle', 34, 0.14, { distance: 'near' }),
    ],
    intensityBias: -0.35,
    duckingBias: -0.2,
  },

  venue_stage: {
    label: 'Auditorio',
    stems: [
      { stem: 'babble_hall', gain: 0.16, lowpass: 1600, width: 0.9 },
      { stem: 'room_tone', gain: 0.3 },
    ],
    room: { size: 'hall', wet: 0.3 },
    events: [
      ev('cough', 13, 0.28, { distance: 'far' }),
      ev('chairScrape', 20, 0.24, { distance: 'far' }),
      ev('applause', 90, 0.35, { distance: 'far' }),
      ev('creak', 26, 0.18, { distance: 'far' }),
    ],
    intensityBias: -0.2,
    duckingBias: -0.1,
  },

  // --- weather-flavoured variants ------------------------------------------
  street_rain: {
    label: 'Calle con lluvia',
    stems: [
      { stem: 'rain', gain: 0.6 },
      { stem: 'traffic_near', gain: 0.32, lowpass: 5000, width: 1 },
      { stem: 'traffic_far', gain: 0.26 },
    ],
    room: { size: 'outdoor', wet: 0.06 },
    events: [
      ev('vehiclePass', 11, 0.4, { distance: 'near' }),
      ev('rainDrip', 5, 0.3, { burst: 0.4, distance: 'near' }),
      ev('honk', 34, 0.25, { distance: 'far' }),
    ],
    duckingBias: 0.15,
  },

  park_rain: {
    label: 'Parque con lluvia',
    stems: [
      { stem: 'rain', gain: 0.65 },
      { stem: 'wind_leaves', gain: 0.3 },
    ],
    room: { size: 'outdoor', wet: 0.07 },
    events: [
      ev('rainDrip', 4, 0.32, { burst: 0.5, distance: 'near' }),
      ev('windGust', 16, 0.3),
      ev('bird', 20, 0.2, { distance: 'far' }),
    ],
    duckingBias: 0.1,
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
