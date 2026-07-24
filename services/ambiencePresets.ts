export type EnvironmentProfile = 'CITY' | 'CAFE' | 'OFFICE' | 'NATURE' | 'ROOM';

export type AmbienceTag =
  | 'crowd'
  | 'music'
  | 'festival'
  | 'rain'
  | 'storm'
  | 'wind'
  | 'birds'
  | 'sea'
  | 'pa'
  | 'footsteps'
  | 'door'
  | 'kitchen'
  | 'traffic'
  | 'train'
  | 'bus'
  | 'hotel'
  | 'market'
  | 'shop'
  | 'office'
  | 'paper'
  | 'studio'
  | 'newsroom'
  | 'classroom'
  | 'library'
  | 'cinema'
  | 'theatre'
  | 'art'
  | 'medical'
  | 'police'
  | 'court'
  | 'tech'
  | 'printer'
  | 'construction'
  | 'gym'
  | 'mechanic'
  | 'pets'
  | 'kids'
  | 'home'
  | 'night';

export interface AmbiencePreset {
  profile: EnvironmentProfile;
  tags: AmbienceTag[];
  intensityBias?: number; // -0.5..+0.5 applied to UI intensity
  duckingBias?: number; // -0.5..+0.5 applied to UI ducking
}

export interface AmbienceScene {
  scenarioLabel?: string;
  scenarioActionLabel?: string;
  topic?: string;
  keywords?: string;
}

const preset = (profile: EnvironmentProfile, tags: AmbienceTag[], extra?: Omit<AmbiencePreset, 'profile' | 'tags'>): AmbiencePreset => ({
  profile,
  tags,
  ...extra,
});

function presetForScenarioLabel(label: string): AmbiencePreset | null {
  // Ambientes curados por `ScenarioContext.label` del formato Diálogo (data/scenarios.ts).
  // Los demás formatos (Radio/Podcast/Monólogo) y temas personalizados caen al fallback por regex.
  switch (label) {
    case 'Datos de Contacto':
      return preset('CITY', ['crowd', 'traffic', 'footsteps']);
    case 'Recepción de Hotel':
      return preset('OFFICE', ['hotel', 'footsteps', 'door']);
    case 'Caja / Pagar':
      return preset('OFFICE', ['shop', 'crowd', 'footsteps']);
    case 'Taxi / Transporte':
      return preset('CITY', ['traffic', 'footsteps']);
    case 'Turno / Cita':
      return preset('OFFICE', ['office', 'paper', 'footsteps']);
    case 'En la Farmacia':
      return preset('OFFICE', ['medical', 'shop']);
    case 'Café / Restaurante':
      return preset('CAFE', ['crowd', 'kitchen', 'music']);
    case 'Mercado / Verdulería':
      return preset('CITY', ['market', 'crowd', 'footsteps']);
    case 'Tienda de Ropa':
      return preset('OFFICE', ['shop', 'music', 'footsteps']);
    case 'Cine / Entradas':
      return preset('OFFICE', ['cinema', 'crowd']);
    case 'Pedir Indicaciones':
      return preset('CITY', ['traffic', 'crowd', 'footsteps']);
    case 'Estación / Transporte':
      return preset('CITY', ['train', 'pa', 'footsteps', 'crowd']);
    case 'Hotel (Recepción)':
      return preset('OFFICE', ['hotel', 'footsteps', 'door']);
    case 'Consultorio / Turno':
      return preset('OFFICE', ['medical', 'footsteps']);
    case 'Gimnasio':
      return preset('OFFICE', ['gym', 'music']);
    case 'Peluquería':
      return preset('OFFICE', ['shop', 'footsteps'], { intensityBias: -0.05 });
    case 'Comisaría / Denuncia':
      return preset('OFFICE', ['police', 'office', 'footsteps']);
    case 'Soporte Técnico':
      return preset('OFFICE', ['tech', 'office', 'printer']);
    case 'Trabajo / Oficina':
      return preset('OFFICE', ['office', 'printer', 'footsteps']);
    case 'Inmobiliaria / Alquiler':
      return preset('OFFICE', ['office', 'paper', 'footsteps']);
    case 'Taller Mecánico':
      return preset('OFFICE', ['mechanic', 'construction']);
    case 'Entrevista de Trabajo':
      return preset('OFFICE', ['office', 'paper'], { intensityBias: -0.05 });
    case 'Banco / Finanzas':
      return preset('OFFICE', ['office', 'crowd', 'footsteps']);
    case 'Consulta Médica':
      return preset('OFFICE', ['medical'], { intensityBias: -0.05 });
    case 'Veterinaria':
      return preset('OFFICE', ['medical', 'pets']);
    case 'Cena con Amigos':
      return preset('CAFE', ['crowd', 'kitchen', 'music']);
    case 'Aeropuerto / Aerolínea':
      return preset('CITY', ['pa', 'crowd', 'footsteps']);
    case 'Servicio al Cliente':
      return preset('OFFICE', ['office', 'tech']);
    case 'Redacción de Periódico':
      return preset('OFFICE', ['newsroom', 'printer', 'office']);
    case 'Startup / Inversores':
      return preset('OFFICE', ['office', 'tech']);
    case 'Juicio / Legal':
      return preset('OFFICE', ['court', 'paper']);
    case 'Galería de Arte':
      return preset('OFFICE', ['art', 'crowd'], { intensityBias: -0.1 });
    case 'Terapia Psicológica':
      return preset('ROOM', ['home'], { intensityBias: -0.15 });
    case 'Entrevista Política':
      return preset('OFFICE', ['studio', 'newsroom']);
    case 'Cata de Vinos / Lujo':
      return preset('OFFICE', ['crowd', 'music'], { intensityBias: -0.1 });
    case 'Universidad / Tutoría':
      return preset('OFFICE', ['classroom', 'paper']);
    case 'Rodaje de Cine':
      return preset('OFFICE', ['studio', 'crowd']);
    case 'Comunidad de Vecinos':
      return preset('ROOM', ['home', 'crowd']);
    case 'Negociación / Diplomacia':
      return preset('OFFICE', ['office', 'paper'], { intensityBias: -0.1 });
    case 'Backstage / Música':
      return preset('OFFICE', ['studio', 'music', 'crowd']);
    default:
      return null;
  }
}

function inferFallbackProfile(text: string): EnvironmentProfile {
  const t = text.toLowerCase();
  if (t.match(/\b(train|metro|subte|estación|estacion|andén|anden)\b/)) return 'CITY';
  if (t.match(/\b(bus|autobús|micro|coach)\b/)) return 'CITY';
  if (t.match(/\b(city|traffic|street|car|road|avenida|calle|tráfico|autopista|taxi)\b/)) return 'CITY';
  if (t.match(/\b(café|cafe|restaurant|bar|pub|comida|cena|almuerzo|bistro)\b/)) return 'CAFE';
  if (t.match(/\b(hotel|recepción|recepcion|check-in|habitación|habitacion)\b/)) return 'OFFICE';
  if (t.match(/\b(hospital|médico|medico|clínica|clinica|farmacia|consulta|terapia)\b/)) return 'OFFICE';
  if (t.match(/\b(nature|park|forest|beach|ocean|waves|rain|lluvia|parque|bosque|campo|viento|trueno|mar)\b/)) return 'NATURE';
  return 'ROOM';
}

function uniqueTags(tags: AmbienceTag[]): AmbienceTag[] {
  return Array.from(new Set(tags));
}

function inferTagsFromAction(action: string): AmbienceTag[] {
  const a = action.toLowerCase();
  const tags: AmbienceTag[] = [];
  if (a.match(/\b(lluvia|tormenta|trueno|huracán|huracan)\b/)) tags.push('rain', 'storm', 'wind');
  if (a.match(/\b(viento)\b/)) tags.push('wind');
  if (a.match(/\b(noche|madrugada)\b/)) tags.push('night');
  if (a.match(/\b(ambulancia|sirena|policía|policia)\b/)) tags.push('police');
  if (a.match(/\b(tren|metro|estación|estacion)\b/)) tags.push('train', 'pa');
  if (a.match(/\b(bus|autobús)\b/)) tags.push('bus');
  if (a.match(/\b(restaurante|comida|cocina)\b/)) tags.push('kitchen');
  if (a.match(/\b(mercado|feria)\b/)) tags.push('market', 'crowd');
  return tags;
}

export function getAmbiencePreset(scene: AmbienceScene): AmbiencePreset {
  const label = scene.scenarioLabel?.trim();
  const actionLabel = scene.scenarioActionLabel?.trim() || '';
  const keywords = (scene.keywords || '').trim();
  const topic = (scene.topic || '').trim();
  const combined = [label, actionLabel, topic, keywords].filter(Boolean).join(' | ');

  const base = label ? presetForScenarioLabel(label) : null;
  const fallback = preset(inferFallbackProfile(combined), []);
  const resolved = base ?? fallback;

  return {
    ...resolved,
    tags: uniqueTags([...resolved.tags, ...inferTagsFromAction(actionLabel)]),
  };
}

