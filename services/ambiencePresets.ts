import { TextType } from '../types';

/**
 * Ambient scene catalogue — the real-recording rebuild.
 *
 * The whole previous system synthesised its ambience: 20 DSP-generated stems plus ~39
 * synthesised "events" (footsteps, cutlery, coins, machines) and formant-synth crowd
 * babble. It was rebuilt twice and still sounded, in the words that prompted this, like
 * "un robot en lata" — because synthesised ambience, and synthesised discrete events
 * above all, read as synthetic almost by definition. The tuned partials of the struck
 * objects were the worst of it ("campanitas que no corresponden a ningún sonido real").
 *
 * This version starts from real sound. Every bed is a short seamless loop cut from a
 * **real public-domain field recording** of the named kind of place (radio aporee /
 * Internet Archive, Public Domain Mark 1.0). A real café recording sounds like a café
 * because it is one; there is nothing to fake. See public/ambience/CREDITS.md.
 *
 * On top of that base sits a deliberately small, deliberately subtle layer of
 * synthesised events — and the one rule that keeps them from sounding robotic: they are
 * **shaped noise transients only, never tuned oscillators**. A cup set on a table is a
 * short dull broadband knock, not a ringing partial; a keyboard is a tick; paper is a
 * rustle. With no sine partials there is no bell to ring, so the failure mode that
 * produced the "campanitas" cannot occur. Events are used sparingly, mostly to give a
 * little life to the quiet indoor rooms whose real bed is nearly stationary.
 *
 * The engine (services/ambienceEngine.ts) fetches /ambience/<bed>.wav, loops it under
 * two lightly-detuned playheads for width and to hide the loop, colours it per scene,
 * and schedules the events. There is no synthetic reverb on the beds: the recordings
 * carry their own room.
 */

// ---------------------------------------------------------------------------
// Beds — the bundled real recordings (plus two honest "quiet air" synth beds).
// Each corresponds to public/ambience/<id>.wav. Adding one means: bake it with
// scripts/ambience/build-beds.mjs, add its id here, and reference it from a recipe.
// ---------------------------------------------------------------------------

export type BedId =
  | 'cafe' | 'restaurant' | 'pub' | 'market' | 'shop'
  | 'street' | 'plaza' | 'park' | 'forest' | 'rain'
  | 'station' | 'airport' | 'train_interior'
  | 'office' | 'kitchen' | 'pool' | 'hall' | 'workshop'
  | 'studio_air' | 'room_air';

export const BED_IDS: BedId[] = [
  'cafe', 'restaurant', 'pub', 'market', 'shop',
  'street', 'plaza', 'park', 'forest', 'rain',
  'station', 'airport', 'train_interior',
  'office', 'kitchen', 'pool', 'hall', 'workshop',
  'studio_air', 'room_air',
];

export const isBedId = (v: unknown): v is BedId =>
  typeof v === 'string' && (BED_IDS as string[]).includes(v);

// ---------------------------------------------------------------------------
// Events — shaped-noise transients only. No oscillators, by design.
// ---------------------------------------------------------------------------

export type EventKind =
  | 'cup'        // a dull ceramic/glass set-down: broadband knock, fast decay
  | 'keyboard'   // a soft key tick
  | 'paper'      // a page/paper rustle
  | 'chair'      // a chair shift / soft scrape
  | 'door'       // a distant door thud/latch
  | 'steps'      // a couple of muffled footsteps
  | 'till'       // a soft muted counter tap (no beep tone)
  | 'splash'     // a small water movement
  | 'page';      // a single page turn

export const EVENT_KINDS: EventKind[] = [
  'cup', 'keyboard', 'paper', 'chair', 'door', 'steps', 'till', 'splash', 'page',
];

export interface BedLayer {
  bed: BedId;
  /** Playback gain relative to the bed's baked level (all real beds are −24 dBFS RMS). */
  gain: number;
  /** Optional shaping so one recording can play a slightly different role. */
  lowpass?: number;
  highpass?: number;
  /** 0 = centred/narrow, 1 = the two playheads are fully decorrelated across the stereo field. */
  width?: number;
}

export interface SceneTone {
  /** Broadband tilt in dB: negative darker/absorptive, positive brighter/harder. */
  tiltDb?: number;
  lowShelfDb?: number;
  highShelfDb?: number;
  /** Telephone-line character for the "on a line" recording setups: [lowHz, highHz]. */
  bandpass?: [number, number];
}

export interface EventSpec {
  kind: EventKind;
  /** Mean seconds between occurrences at reference intensity. */
  everyS: number;
  /** Peak gain of the transient, relative to the bed. Kept low on purpose. */
  gain: number;
  /** near = present and a touch brighter; far = muffled and quieter. */
  distance?: 'near' | 'mid' | 'far';
}

export interface SceneRecipe {
  /** Shown in the player's status line. */
  label: string;
  beds: BedLayer[];
  tone?: SceneTone;
  /** The subtle synth-event layer. Most scenes have none — the real bed is enough. */
  events?: EventSpec[];
  /** Overall trim for the whole scene, 0..~1.3. Default 1. */
  level?: number;
}

const B = (bed: BedId, gain: number, opts: Omit<BedLayer, 'bed' | 'gain'> = {}): BedLayer =>
  ({ bed, gain, ...opts });
const E = (kind: EventKind, everyS: number, gain: number, distance: EventSpec['distance'] = 'mid'): EventSpec =>
  ({ kind, everyS, gain, distance });
const R = (label: string, beds: BedLayer[], extra: Omit<SceneRecipe, 'label' | 'beds'> = {}): SceneRecipe =>
  ({ label, beds, ...extra });

// ---------------------------------------------------------------------------
// The scenes. Every SceneId maps to one (occasionally two) real beds plus, where a
// quiet room needs it, a few subtle events. The label chooses the recording, never the
// topic — a bulletin about traffic is still heard from a studio, not a road.
// ---------------------------------------------------------------------------

export const SCENE_RECIPES = {
  // --- eating and drinking -------------------------------------------------
  cafe:          R('Café',            [B('cafe', 1.0, { width: 0.8 })],
                    { events: [E('cup', 9, 0.16, 'near'), E('chair', 22, 0.12)] }),
  restaurant:    R('Restaurante',     [B('restaurant', 1.0, { width: 0.8 })],
                    { events: [E('cup', 11, 0.14), E('chair', 26, 0.1)] }),
  bar_night:     R('Bar',             [B('pub', 1.0, { width: 0.85 })],
                    { level: 1.0, events: [E('cup', 10, 0.15, 'near')] }),
  wine_tasting:  R('Cata de vinos',   [B('restaurant', 0.6, { width: 0.7 })],
                    { level: 0.75, tone: { tiltDb: -2 }, events: [E('cup', 14, 0.12, 'near')] }),

  // --- shops and markets ---------------------------------------------------
  market:        R('Mercado',         [B('market', 1.0, { width: 0.9 })]),
  shop_small:    R('Tienda',          [B('shop', 0.9, { width: 0.6 })],
                    { events: [E('door', 30, 0.14, 'far'), E('till', 24, 0.1)] }),
  shop_checkout: R('Caja',            [B('shop', 0.95, { width: 0.6 })],
                    { events: [E('till', 12, 0.14), E('paper', 18, 0.1)] }),
  salon:         R('Peluquería',      [B('cafe', 0.7, { width: 0.7 })],
                    { level: 0.85, tone: { highShelfDb: 1 }, events: [E('chair', 20, 0.12)] }),

  // --- street and outdoors -------------------------------------------------
  street:        R('Calle',           [B('street', 1.0, { width: 1.0 })]),
  plaza:         R('Plaza',           [B('plaza', 1.0, { width: 1.0 })]),
  park:          R('Parque',          [B('park', 1.0, { width: 1.0 })]),
  street_rain:   R('Calle con lluvia',[B('rain', 1.0, { width: 1.0 })]),
  park_rain:     R('Parque con lluvia',[B('rain', 0.9, { width: 1.0 })],
                    { tone: { highShelfDb: -1 } }),
  // Reuses the `forest` bed (otherwise heard only in radio_field) so nature stories on
  // location don't all collapse onto `park`.
  trail:         R('Sendero',         [B('forest', 0.9, { width: 1.0 })]),

  // --- work ----------------------------------------------------------------
  office:        R('Oficina',         [B('office', 0.9, { width: 0.5 })],
                    { events: [E('keyboard', 5, 0.1), E('paper', 16, 0.09), E('chair', 34, 0.08)] }),
  open_office:   R('Oficina abierta', [B('office', 1.0, { width: 0.7 })],
                    { level: 1.0, events: [E('keyboard', 3.5, 0.1), E('paper', 12, 0.09), E('door', 40, 0.09, 'far')] }),
  office_meeting:R('Sala de reunión', [B('office', 0.6, { width: 0.5 })],
                    { level: 0.8, events: [E('paper', 18, 0.09), E('chair', 30, 0.08)] }),
  call_center:   R('Centro de llamadas',[B('office', 0.85, { width: 0.7 })],
                    { events: [E('keyboard', 4, 0.1), E('chair', 28, 0.08)] }),
  newsroom:      R('Redacción',       [B('office', 0.95, { width: 0.7 })],
                    { events: [E('keyboard', 3.5, 0.11), E('paper', 12, 0.1), E('door', 44, 0.08, 'far')] }),
  workshop_garage:R('Taller',         [B('workshop', 1.0, { width: 0.7 })]),

  // --- fitness / leisure ---------------------------------------------------
  gym:           R('Gimnasio',        [B('pool', 0.85, { width: 0.8 })],
                    { level: 0.9, tone: { tiltDb: -1 } }),
  backstage:     R('Backstage',       [B('hall', 0.6, { width: 0.7 })],
                    { level: 0.8, events: [E('door', 34, 0.12, 'far'), E('steps', 20, 0.1)] }),
  venue_stage:   R('Escenario',       [B('hall', 0.7, { width: 0.85 })],
                    { level: 0.9 }),

  // --- health --------------------------------------------------------------
  clinic_waiting:R('Sala de espera',  [B('office', 0.5, { width: 0.5 })],
                    { level: 0.8, events: [E('door', 30, 0.12, 'far'), E('chair', 26, 0.08), E('paper', 22, 0.07)] }),
  clinic_room:   R('Consulta',        [B('room_air', 1.0)],
                    { level: 0.9, events: [E('paper', 16, 0.1), E('chair', 30, 0.08)] }),
  // A vet consult is a real room with people (and animals) in it, not the near-silent
  // close-miked air of clinic_room/therapy_room — a synthetic hiss bed there just reads
  // as loud static. Uses the real `office` recording, low, with faint reception activity.
  vet_clinic:    R('Veterinaria',     [B('office', 0.55, { width: 0.6 })],
                    { level: 0.8, events: [E('door', 30, 0.12, 'far'), E('chair', 28, 0.09), E('paper', 22, 0.07)] }),
  hospital:      R('Hospital',        [B('hall', 0.55, { width: 0.7 })],
                    { level: 0.8, tone: { tiltDb: -1 }, events: [E('door', 26, 0.12, 'far'), E('steps', 18, 0.1)] }),
  therapy_room:  R('Terapia',         [B('room_air', 0.9)],
                    { level: 0.85, events: [E('chair', 34, 0.07)] }),

  // --- civic / institutional ----------------------------------------------
  bank:          R('Banco',           [B('hall', 0.55, { width: 0.7 })],
                    { level: 0.85, tone: { tiltDb: -1 }, events: [E('till', 18, 0.1), E('steps', 22, 0.08)] }),
  police_station:R('Comisaría',       [B('office', 0.8, { width: 0.6 })],
                    { events: [E('door', 28, 0.12, 'far'), E('keyboard', 6, 0.09)] }),
  courtroom:     R('Tribunal',        [B('hall', 0.5, { width: 0.7 })],
                    { level: 0.8, tone: { tiltDb: -1.5 }, events: [E('paper', 22, 0.08), E('chair', 30, 0.08)] }),
  classroom:     R('Aula',            [B('office', 0.7, { width: 0.7 })],
                    { level: 0.85, events: [E('chair', 22, 0.1), E('paper', 18, 0.09)] }),
  library:       R('Biblioteca',      [B('room_air', 0.9)],
                    { level: 0.85, events: [E('page', 14, 0.1), E('chair', 30, 0.07), E('steps', 26, 0.07, 'far')] }),
  gallery:       R('Galería',         [B('hall', 0.5, { width: 0.75 })],
                    { level: 0.8, tone: { tiltDb: -1 }, events: [E('steps', 20, 0.08, 'far')] }),
  foyer:         R('Vestíbulo',       [B('hall', 0.7, { width: 0.75 })],
                    { level: 0.9, events: [E('door', 26, 0.12, 'far'), E('steps', 18, 0.09)] }),

  // --- transit -------------------------------------------------------------
  station:       R('Estación',        [B('station', 1.0, { width: 0.95 })]),
  airport:       R('Aeropuerto',      [B('airport', 1.0, { width: 0.95 })]),
  vehicle_interior:R('Vehículo',      [B('train_interior', 1.0, { width: 0.6 })]),
  hotel_lobby:   R('Recepción de hotel',[B('hall', 0.7, { width: 0.75 })],
                    { level: 0.9, events: [E('door', 24, 0.12, 'far'), E('till', 26, 0.08)] }),

  // --- home ----------------------------------------------------------------
  home:          R('Casa',            [B('room_air', 1.0)],
                    { level: 0.95, events: [E('chair', 30, 0.08), E('door', 40, 0.09, 'far')] }),
  kitchen_home:  R('Cocina',          [B('kitchen', 0.85, { width: 0.6 })],
                    { level: 0.9 }),

  // --- recording setups (studios and lines) --------------------------------
  studio_radio:    R('Estudio de radio',   [B('studio_air', 1.0)]),
  studio_newsroom: R('Redacción en directo',[B('office', 0.65, { width: 0.6 })],
                      { level: 0.85, events: [E('keyboard', 4, 0.1), E('paper', 14, 0.09)] }),
  studio_podcast:  R('Estudio de podcast',  [B('studio_air', 1.0)]),
  studio_intimate: R('Estudio íntimo',      [B('studio_air', 0.85)], { level: 0.85 }),
  podcast_home:    R('Podcast en casa',     [B('room_air', 0.9)], { level: 0.9 }),
  podcast_live:    R('Podcast en directo',  [B('hall', 0.6, { width: 0.8 })], { level: 0.85 }),
  podcast_remote:  R('Podcast a distancia', [B('studio_air', 1.0)],
                      { tone: { bandpass: [320, 3400] } }),
  radio_desk:      R('Mesa de tertulia',    [B('studio_air', 0.95)],
                      { events: [E('paper', 16, 0.08)] }),
  radio_street:    R('Corresponsal en calle',[B('street', 0.85, { width: 0.9 })], { level: 0.9 }),
  radio_field:     R('Grabación de campo',  [B('forest', 0.9, { width: 1.0 })]),
  // On-location correspondent variants that put otherwise single-use real beds to work,
  // so a market / transport / sports report is heard from the place it is about rather
  // than from a generic street.
  radio_market:    R('Mercado (directo)',   [B('market', 0.85, { width: 0.9 })], { level: 0.9 }),
  radio_station:   R('Estación (directo)',  [B('station', 0.85, { width: 0.9 })], { level: 0.9 }),
  radio_plaza:     R('Plaza (directo)',     [B('plaza', 0.85, { width: 0.95 })], { level: 0.9 }),
  radio_phone:     R('Línea telefónica',    [B('studio_air', 1.0)],
                      { tone: { bandpass: [300, 3400] } }),
} as const;

export type SceneId = keyof typeof SCENE_RECIPES;
export const SCENE_IDS = Object.keys(SCENE_RECIPES) as SceneId[];

export const isSceneId = (value: unknown): value is SceneId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCENE_RECIPES, value);

/** Every bed a recipe actually references — used by the checks so a bed can't be dead weight. */
export const REFERENCED_BEDS = new Set<BedId>(
  SCENE_IDS.flatMap((id) => SCENE_RECIPES[id].beds.map((l) => l.bed)),
);

// ---------------------------------------------------------------------------
// Scenario label -> scene
//
// Every context label in data/scenarios.ts is listed here. scripts/check-ambience.mjs
// walks SCENARIO_DATABASE and fails if any label is missing, so the catalogue and these
// tables cannot drift apart. The SceneId vocabulary is unchanged from the previous
// system — only what each scene *sounds like* changed — so these maps are as before.
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
  'Veterinaria': 'vet_clinic',
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

const RADIO_SCENE_BY_LABEL: Record<string, SceneId> = {
  'Última Hora': 'studio_newsroom',
  'Cobertura de Crisis': 'studio_newsroom',
  'Investigación Periodística': 'studio_newsroom',
  'Sucesos y Comunidad': 'studio_newsroom',
  'Noticias del Barrio': 'studio_newsroom',
  'Política Municipal': 'studio_newsroom',
  'Tribunales y Justicia': 'studio_newsroom',
  'Tráfico': 'radio_street',
  'Transporte Público': 'radio_station',
  'Transporte y Movilidad': 'radio_station',
  'Seguridad Vial': 'radio_street',
  'Infraestructura Urbana': 'radio_street',
  'Ferias y Mercados': 'radio_market',
  'Servicios de la Ciudad': 'radio_street',
  'El Tiempo': 'radio_field',
  'Clima y Estaciones': 'radio_field',
  'Medio Ambiente': 'radio_field',
  'Medio Ambiente Local': 'radio_field',
  'Turismo de la Región': 'radio_field',
  'Deportes Locales': 'radio_plaza',
  'Geopolítica': 'radio_phone',
  'Economía y Mercados': 'radio_phone',
  'Economía Nacional': 'radio_phone',
  'Debate Electoral': 'radio_phone',
  'Tecnología y Ética': 'radio_phone',
  'Análisis Político': 'radio_phone',
  'Editorial de Opinión': 'radio_desk',
  'Cultura y Crítica': 'radio_desk',
  'Ciencia Avanzada': 'radio_desk',
  'Tecnología y Sociedad': 'radio_desk',
  'Consumo y Ahorro': 'radio_desk',
  'Trabajo y Empleo': 'radio_desk',
  'Cultura y Espectáculos': 'radio_desk',
};

const PODCAST_SCENE_BY_LABEL: Record<string, SceneId> = {
  'Mi Rutina Diaria': 'podcast_home',
  'Mi Ciudad Favorita': 'studio_podcast',
  'Aprendí a Cocinar': 'kitchen_home',
  'Mi Primera Mascota': 'podcast_home',
  'Mi Trabajo Actual': 'office',
  'Un Viaje Reciente': 'studio_podcast',
  'Mi Pasatiempo': 'podcast_home',
  'Mi Familia': 'podcast_home',
  'Cómo Cambié de Casa': 'home',
  'Mi Deporte Favorito': 'gym',
  'El Día que Me Despidieron': 'studio_podcast',
  'Emprender de Cero': 'open_office',
  'Vivir en el Extranjero': 'podcast_remote',
  'Mi Relación a Distancia': 'podcast_remote',
  'Superé una Lesión': 'gym',
  'Cambié de Carrera': 'office',
  'Un Estilo de Vida Nuevo': 'park',
  'Aprendí un Oficio': 'workshop_garage',
  'Todo Salió Mal en un Evento': 'venue_stage',
  'Convivir con Compañeros': 'podcast_home',
  'Cómo Salí de una Deuda': 'bank',
  'Mi Experiencia de Voluntario': 'foyer',
  'Escapé de una Situación de Control': 'therapy_room',
  'Fui Testigo de un Hecho Grave': 'police_station',
  'Cuidé a un Familiar Enfermo': 'hospital',
  'Sobreviví a un Desastre': 'studio_podcast',
  'Denuncié Malas Prácticas': 'office_meeting',
  'Reconstruí mi Identidad': 'therapy_room',
  'La Fama y sus Costos': 'podcast_live',
  'Rechazos Antes de Publicar': 'library',
  'Ética en las Decisiones': 'studio_podcast',
  'Migrar y Empezar de Nuevo': 'station',
  'La Enfermedad que Me Cambió': 'clinic_room',
  'Perdón y Reconciliación': 'podcast_home',
};

const MONOLOGUE_SCENE_BY_LABEL: Record<string, SceneId> = {
  'Discurso Motivacional': 'venue_stage',
  'Discurso de Despedida': 'venue_stage',
  'Manifiesto Creativo': 'venue_stage',
  'Análisis Social': 'venue_stage',
  'Monólogo de Humor': 'bar_night',
  'Ensayo Personal': 'studio_intimate',
  'Relato Literario': 'studio_intimate',
  'Una Decisión que Cambió Todo': 'studio_intimate',
  'Lo que Aprendí de un Fracaso': 'studio_intimate',
  'Carta Abierta': 'studio_intimate',
  'Confesión y Catarsis': 'home',
  'Un Día Cualquiera': 'home',
  'Un Pequeño Logro': 'home',
  'Mi Comida Favorita': 'kitchen_home',
  'Una Tradición que Heredé': 'kitchen_home',
  'Crónica de Investigación': 'newsroom',
  'Memoria Histórica': 'gallery',
  'Mi Rincón Favorito': 'library',
  'Aprendí Algo Nuevo': 'classroom',
  'Cambié de Trabajo': 'office',
  'La Vez que Me Equivoqué': 'office_meeting',
  'Un Problema y su Solución': 'workshop_garage',
  'Un Proyecto Personal': 'workshop_garage',
  'Una Historia de Superación': 'gym',
  'Una Fiesta Familiar': 'restaurant',
  'Cómo Conocí a mi Mejor Amigo': 'cafe',
  'Crónica de mi Barrio': 'street',
  'Mi Primer Viaje': 'station',
  'El Día que Perdí Algo': 'station',
  'Un Viaje en Solitario': 'trail',
  'Mi Fin de Semana': 'park',
  'Una Mascota Especial': 'park',
  'Reencuentro Inesperado': 'plaza',
  'Reflexión sobre el Tiempo': 'park_rain',
};

/**
 * How present the place is for a recording *made* in it (a podcast at a kitchen table)
 * rather than a conversation happening there. Scales the bed and events together so the
 * ambience never claims the microphone is standing in a full market. Studios are exempt.
 */
const RECORDING_PRESENCE = 0.62;

const STUDIO_SCENES = new Set<SceneId>([
  'studio_radio', 'studio_newsroom', 'studio_podcast', 'studio_intimate',
  'radio_desk', 'radio_phone', 'podcast_remote', 'podcast_home',
]);

const DEFAULT_SCENE_BY_TEXT_TYPE: Record<string, SceneId> = {
  [TextType.Dialogue]: 'office',
  [TextType.RadioNews]: 'studio_radio',
  [TextType.PodcastInterview]: 'studio_podcast',
  [TextType.Monologue]: 'studio_intimate',
};

// ---------------------------------------------------------------------------
// Free-text inference (Vocabulary mode, custom topics, AccentChallenge).
// ---------------------------------------------------------------------------

const KEYWORD_SCENES: Array<{ scene: SceneId; pattern: RegExp }> = [
  { scene: 'street_rain', pattern: /(lluvia|tormenta|llover|rain|storm)/i },
  { scene: 'park', pattern: /(parque|bosque|campo|jardín|jardin|montaña|montana|naturaleza|park|forest|nature|hiking|senderismo)/i },
  { scene: 'plaza', pattern: /(playa|mar|costa|beach|sea|ocean|puerto|plaza)/i },
  { scene: 'airport', pattern: /(aeropuerto|avión|avion|vuelo|airport|flight|embarque)/i },
  { scene: 'station', pattern: /(estación|estacion|tren|metro|subte|andén|anden|station|train|platform)/i },
  { scene: 'vehicle_interior', pattern: /(taxi|autobús|autobus|colectivo|micro|coche|auto|conducir|bus|car|driving)/i },
  { scene: 'market', pattern: /(mercado|feria|verdulería|verduleria|puesto|market|stall)/i },
  { scene: 'cafe', pattern: /(café|cafe|cafetería|cafeteria|desayuno|merienda|coffee|breakfast)/i },
  { scene: 'restaurant', pattern: /(restaurante|comida|cena|almuerzo|menú|menu|camarero|mesero|restaurant|dinner|lunch)/i },
  { scene: 'bar_night', pattern: /(bar|copas|cerveza|cóctel|coctel|pub|nightlife|fiesta)/i },
  { scene: 'vet_clinic', pattern: /(veterinar|mascota|animal)/i },
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

/** Rain is the only modifier that swaps the scene outright, because it changes what you
 *  hear more than the place does. */
function applyModifiers(scene: SceneId, text: string): SceneId {
  const outdoorScenes = new Set<SceneId>(['street', 'plaza', 'park', 'radio_street', 'radio_field']);
  if (outdoorScenes.has(scene) && /(lluvia|lloviendo|tormenta|rain|storm|paraguas|umbrella)/i.test(text)) {
    if (scene === 'park' || scene === 'plaza' || scene === 'radio_field') return 'park_rain';
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
  source: 'label' | 'textType' | 'model' | 'keyword' | 'default';
  /** How present the place is, 0-1. Below 1 for a recording made somewhere rather than
   *  a conversation happening there. */
  presence?: number;
}

/**
 * Reduce cualquier valor a un texto recortado. El tipo dice `string`, pero estos
 * campos vienen del modelo (`ambientKeywords`, `ambientScene`, el tema…) y el TTS
 * no siempre respeta el esquema: `ambientKeywords` llega a veces como **array**
 * (`["hotel","lobby"]`). Un `value?.trim()` sobre un array reventaba el `useMemo`
 * de `AudioPlayer` en pleno render y, sin ningún ErrorBoundary, dejaba la pantalla
 * en negro. Aquí un array se une por espacios y cualquier otra cosa se descarta.
 */
const asSceneText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join(' ').trim();
  return '';
};

export function resolveAmbienceScene(scene: AmbienceScene): ResolvedAmbience {
  const label = asSceneText(scene.scenarioLabel);
  const action = asSceneText(scene.scenarioActionLabel);
  const topic = asSceneText(scene.topic);
  const keywords = asSceneText(scene.keywords);
  const textType = scene.textType;
  const combined = [label, action, topic, keywords].filter(Boolean).join(' | ');

  const finish = (id: SceneId, source: ResolvedAmbience['source']): ResolvedAmbience => {
    const modified = applyModifiers(id, `${action} ${topic} ${keywords}`);
    const recorded = textType !== undefined
      && textType !== TextType.Dialogue
      && !STUDIO_SCENES.has(modified);
    return {
      id: modified,
      recipe: SCENE_RECIPES[modified],
      source,
      ...(recorded ? { presence: RECORDING_PRESENCE } : {}),
    };
  };

  if (label) {
    if (textType === TextType.RadioNews && RADIO_SCENE_BY_LABEL[label]) {
      return finish(RADIO_SCENE_BY_LABEL[label], 'label');
    }
    if (textType === TextType.Monologue && MONOLOGUE_SCENE_BY_LABEL[label]) {
      return finish(MONOLOGUE_SCENE_BY_LABEL[label], 'label');
    }
    if (textType === TextType.PodcastInterview && PODCAST_SCENE_BY_LABEL[label]) {
      return finish(PODCAST_SCENE_BY_LABEL[label], 'label');
    }
    if ((!textType || textType === TextType.Dialogue) && DIALOGUE_SCENE_BY_LABEL[label]) {
      return finish(DIALOGUE_SCENE_BY_LABEL[label], 'label');
    }
    if (textType && DEFAULT_SCENE_BY_TEXT_TYPE[textType] && textType !== TextType.Dialogue) {
      return finish(DEFAULT_SCENE_BY_TEXT_TYPE[textType], 'textType');
    }
    if (DIALOGUE_SCENE_BY_LABEL[label]) {
      return finish(DIALOGUE_SCENE_BY_LABEL[label], 'label');
    }
  }

  if (isSceneId(scene.sceneHint)) return finish(scene.sceneHint, 'model');

  const inferred = inferSceneFromText(combined);
  if (inferred) return finish(inferred, 'keyword');

  if (textType && DEFAULT_SCENE_BY_TEXT_TYPE[textType]) {
    return finish(DEFAULT_SCENE_BY_TEXT_TYPE[textType], 'textType');
  }
  return finish('office', 'default');
}

/** Scenes the model is not allowed to name explicitly. */
const MODEL_EXCLUDED_SCENES = new Set<SceneId>([
  'street_rain', 'park_rain',
  'podcast_remote', 'radio_phone', 'radio_desk', 'podcast_live', 'podcast_home',
]);

export const MODEL_SELECTABLE_SCENES: SceneId[] = SCENE_IDS.filter(
  (id) => !MODEL_EXCLUDED_SCENES.has(id),
);
