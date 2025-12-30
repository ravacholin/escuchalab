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
  // Exhaustive rules per `ScenarioContext.label` in `data/scenarios.ts`.
  // Keep this explicit: every scenario label gets a deterministic ambience.
  switch (label) {
    case 'Adopté Siendo Soltera/o a los 40':
      return preset('ROOM', ['home', 'kids'], { intensityBias: -0.05 });
    case 'Agencia Inmobiliaria':
      return preset('OFFICE', ['office', 'paper', 'footsteps']);
    case 'Agenda Cultural':
      return preset('OFFICE', ['studio', 'music'], { intensityBias: -0.05 });
    case 'Análisis Social':
      return preset('OFFICE', ['studio'], { intensityBias: -0.05 });
    case 'Aprender a Conducir':
      return preset('CITY', ['traffic'], { intensityBias: 0.1 });
    case 'Aprendí a Cocinar por YouTube':
      return preset('ROOM', ['home', 'kitchen', 'tech'], { intensityBias: -0.05 });
    case 'Backstage Concierto':
      return preset('CITY', ['music', 'crowd', 'festival', 'footsteps'], { intensityBias: 0.15 });
    case 'Banco / Finanzas':
      return preset('OFFICE', ['office', 'crowd', 'footsteps']);
    case 'Biblioteca':
      return preset('ROOM', ['library', 'paper', 'footsteps'], { intensityBias: -0.25 });
    case 'Boletín del Tiempo':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Cafetería / Restaurante':
      return preset('CAFE', ['crowd', 'kitchen', 'music', 'door', 'footsteps']);
    case 'Cambio de Trabajo':
      return preset('OFFICE', ['office', 'printer', 'paper']);
    case 'Cambié de Identidad de Género':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Carta Abierta':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.25 });
    case 'Cata de Vinos / Lujo':
      return preset('CAFE', ['crowd', 'music', 'footsteps'], { intensityBias: -0.05 });
    case 'Celebración de Barrio':
      return preset('CITY', ['festival', 'crowd', 'music', 'footsteps'], { intensityBias: 0.15 });
    case 'Cena con Amigos':
      return preset('ROOM', ['home', 'kitchen', 'crowd'], { intensityBias: -0.05 });
    case 'Ciencia y Salud':
      return preset('OFFICE', ['studio', 'newsroom', 'medical'], { intensityBias: -0.05 });
    case 'Cine / Taquilla':
      return preset('CITY', ['cinema', 'crowd', 'footsteps', 'music']);
    case 'Citas y Agenda':
      return preset('OFFICE', ['office', 'footsteps'], { intensityBias: -0.1 });
    case 'Clase Universidad':
      return preset('OFFICE', ['classroom', 'crowd', 'paper', 'footsteps']);
    case 'Clima Extremo':
      return preset('NATURE', ['wind', 'storm', 'rain'], { intensityBias: 0.2 });
    case 'Cobertura de Crisis':
      return preset('OFFICE', ['newsroom', 'pa', 'printer'], { intensityBias: 0.05 });
    case 'Comisaría de Policía':
      return preset('OFFICE', ['police', 'office', 'footsteps', 'door'], { intensityBias: -0.05 });
    case 'Compras y Dinero':
      return preset('CITY', ['shop', 'crowd', 'footsteps']);
    case 'Comunidad de Vecinos':
      return preset('ROOM', ['home', 'door', 'footsteps']);
    case 'Confesión y Catarsis':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Consulta Médica':
      return preset('OFFICE', ['medical', 'crowd', 'door', 'footsteps']);
    case 'Consumo y Energía':
      return preset('OFFICE', ['studio', 'tech'], { intensityBias: -0.05 });
    case 'Crónica de Evento':
      return preset('CITY', ['festival', 'crowd', 'music', 'footsteps']);
    case 'Crónica de Investigación':
      return preset('OFFICE', ['newsroom', 'printer', 'paper'], { intensityBias: 0.05 });
    case 'Cuidé a Mi Padre con Alzheimer':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Cultura y Sociedad':
      return preset('OFFICE', ['studio'], { intensityBias: -0.05 });
    case 'Cómo Adopté a Mi Perro':
      return preset('ROOM', ['home', 'pets'], { intensityBias: -0.05 });
    case 'Datos de Contacto':
      return preset('ROOM', ['home', 'tech'], { intensityBias: -0.15 });
    case 'Debate Electoral':
      return preset('OFFICE', ['studio', 'newsroom', 'crowd'], { intensityBias: 0.05 });
    case 'Decisión Importante':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.15 });
    case 'Denuncié a Mi Propia Empresa':
      return preset('OFFICE', ['court', 'office'], { intensityBias: -0.1 });
    case 'Deportes de Barrio':
      return preset('CITY', ['festival', 'crowd', 'footsteps'], { intensityBias: 0.1 });
    case 'Descubrí que Mi Profesor Era un Fraude':
      return preset('OFFICE', ['classroom', 'crowd'], { intensityBias: -0.05 });
    case 'Día Difícil':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Discurso de Despedida':
      return preset('ROOM', ['theatre', 'crowd'], { intensityBias: 0.1 });
    case 'Discurso Motivacional':
      return preset('ROOM', ['theatre', 'crowd'], { intensityBias: 0.1 });
    case 'Economía de Mercados':
      return preset('OFFICE', ['studio', 'newsroom', 'tech'], { intensityBias: -0.05 });
    case 'Economía Doméstica':
      return preset('ROOM', ['home'], { intensityBias: -0.1 });
    case 'Economía Internacional':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Economía Nacional':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Editorial del Día':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Educación Superior':
      return preset('OFFICE', ['studio', 'classroom'], { intensityBias: -0.05 });
    case 'El Asado Dominical':
      return preset('ROOM', ['home', 'kitchen', 'crowd'], { intensityBias: -0.05 });
    case 'El Crush del Trabajo':
      return preset('OFFICE', ['office'], { intensityBias: -0.15 });
    case 'El Cumpleaños Sorpresa que Salió Mal':
      return preset('ROOM', ['home', 'crowd', 'music'], { intensityBias: 0.1 });
    case 'El Día que Me Despidieron':
      return preset('OFFICE', ['office', 'printer', 'paper'], { intensityBias: -0.05 });
    case 'El Día que Perdí Todo el Dinero':
      return preset('CITY', ['traffic', 'night'], { intensityBias: -0.1 });
    case 'El Día que Todo Salió Mal':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'El Jefe que Todos Odiábamos':
      return preset('OFFICE', ['office', 'printer', 'paper']);
    case 'El Vecino Ruidoso':
      return preset('ROOM', ['home', 'night', 'door'], { intensityBias: -0.05 });
    case 'El Viaje en Bus Eterno':
      return preset('CITY', ['bus', 'traffic', 'night']);
    case 'En la Calle (Ciudad)':
      return preset('CITY', ['traffic', 'crowd', 'footsteps']);
    case 'Ensayo Personal':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.25 });
    case 'Entrevista de Trabajo':
      return preset('OFFICE', ['office', 'footsteps'], { intensityBias: -0.1 });
    case 'Entrevista en Directo':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Entrevista Política/Radio':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Escapé de una Relación Tóxica':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Escapé de una Secta Religiosa':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Escribí un Libro y Lo Rechazaron 50 Veces':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Estación de Tren/Bus':
      return preset('CITY', ['train', 'bus', 'pa', 'crowd', 'footsteps', 'traffic']);
    case 'Evento Cultural':
      return preset('CITY', ['festival', 'crowd', 'music', 'footsteps']);
    case 'Farmacia':
      return preset('OFFICE', ['medical', 'crowd', 'footsteps']);
    case 'Ferias y Mercados':
      return preset('CITY', ['market', 'festival', 'crowd', 'music', 'footsteps']);
    case 'Fui Testigo de un Crimen Grave':
      return preset('CITY', ['police', 'night', 'traffic'], { intensityBias: -0.05 });
    case 'Fui Víctima de una Estafa Millonaria':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.15 });
    case 'Galería de Arte':
      return preset('ROOM', ['art', 'footsteps'], { intensityBias: -0.15 });
    case 'Geopolítica':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Gimnasio':
      return preset('ROOM', ['gym', 'crowd', 'music', 'footsteps']);
    case 'Heredé una Deuda de un Familiar':
      return preset('ROOM', ['home'], { intensityBias: -0.1 });
    case 'Historia de Superación':
      return preset('ROOM', ['home'], { intensityBias: -0.1 });
    case 'Hotel (Recepción)':
      return preset('OFFICE', ['hotel', 'crowd', 'door', 'footsteps']);
    case 'Informe de Defensa':
      return preset('OFFICE', ['studio', 'court'], { intensityBias: -0.1 });
    case 'Infraestructura Urbana':
      return preset('CITY', ['construction', 'traffic', 'crowd'], { intensityBias: 0.1 });
    case 'Investigación Especial':
      return preset('OFFICE', ['newsroom', 'printer', 'paper'], { intensityBias: 0.05 });
    case 'Juicio / Legal':
      return preset('OFFICE', ['court', 'crowd', 'footsteps'], { intensityBias: -0.05 });
    case 'La Fiesta de Cumpleaños Sorpresa':
      return preset('ROOM', ['home', 'crowd', 'music'], { intensityBias: 0.1 });
    case 'La Mudanza Caótica':
      return preset('ROOM', ['home', 'footsteps', 'door']);
    case 'La Receta de Mi Abuela':
      return preset('ROOM', ['home', 'kitchen'], { intensityBias: -0.05 });
    case 'Maternidad / Paternidad':
      return preset('ROOM', ['home', 'kids'], { intensityBias: -0.05 });
    case 'Me Diagnosticaron una Enfermedad Crónica':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Me Enamoré Durante la Cuarentena':
      return preset('ROOM', ['home'], { intensityBias: -0.15 });
    case 'Me Perdí en una Ciudad Extranjera':
      return preset('CITY', ['traffic', 'crowd', 'pa', 'footsteps']);
    case 'Medio Ambiente':
      return preset('OFFICE', ['studio', 'wind'], { intensityBias: -0.05 });
    case 'Memoria Histórica':
      return preset('OFFICE', ['studio'], { intensityBias: -0.1 });
    case 'Mercado Callejero':
      return preset('CITY', ['market', 'crowd', 'traffic', 'footsteps']);
    case 'Mi Barrio Está Cambiando':
      return preset('CITY', ['construction', 'crowd', 'footsteps'], { intensityBias: 0.1 });
    case 'Mi Gato Destruyó Todo':
      return preset('ROOM', ['home', 'pets'], { intensityBias: -0.05 });
    case 'Mi Hijo Tiene una Adicción':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.2 });
    case 'Mi Mascota Me Salvó el Día':
      return preset('ROOM', ['home', 'pets'], { intensityBias: -0.05 });
    case 'Mi Padre Tenía Otra Familia':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.15 });
    case 'Mi Peor Viaje de Vacaciones':
      return preset('CITY', ['train', 'bus', 'crowd', 'footsteps']);
    case 'Mi Primer Día en el País':
      return preset('CITY', ['crowd', 'traffic', 'footsteps']);
    case 'Mi Primera Cita Desastrosa':
      return preset('CAFE', ['crowd', 'music', 'footsteps'], { intensityBias: 0.05 });
    case 'Mi Primera Entrevista de Trabajo':
      return preset('OFFICE', ['office', 'footsteps'], { intensityBias: -0.1 });
    case 'Monólogo Humorístico':
      return preset('ROOM', ['theatre', 'crowd'], { intensityBias: 0.1 });
    case 'Mudanza':
      return preset('ROOM', ['home', 'footsteps', 'door']);
    case 'Negociación de Paz':
      return preset('OFFICE', ['studio'], { intensityBias: -0.05 });
    case 'Noticias de Escuela':
      return preset('OFFICE', ['classroom', 'kids', 'crowd'], { intensityBias: 0.05 });
    case 'Noticias Locales':
      return preset('OFFICE', ['newsroom', 'printer'], { intensityBias: 0.05 });
    case 'Oficina de Correos':
      return preset('OFFICE', ['office', 'crowd', 'paper', 'footsteps']);
    case 'Peluquería':
      return preset('CAFE', ['shop', 'crowd', 'music']);
    case 'Política Municipal':
      return preset('OFFICE', ['studio', 'newsroom'], { intensityBias: -0.05 });
    case 'Primer Día de Gimnasio':
      return preset('ROOM', ['gym', 'crowd', 'music', 'footsteps']);
    case 'Primer Trabajo/Clase':
      return preset('OFFICE', ['classroom', 'crowd', 'paper', 'footsteps']);
    case 'Problema y Solución':
      return preset('OFFICE', ['studio'], { intensityBias: -0.05 });
    case 'Proyecto Creativo':
      return preset('ROOM', ['home', 'tech'], { intensityBias: -0.1 });
    case 'Recepción de Hotel':
      return preset('OFFICE', ['hotel', 'crowd', 'door', 'footsteps']);
    case 'Receta en Casa':
      return preset('ROOM', ['home', 'kitchen'], { intensityBias: -0.05 });
    case 'Redacción Periódico':
      return preset('OFFICE', ['newsroom', 'printer', 'crowd'], { intensityBias: 0.05 });
    case 'Reflexión Cultural':
      return preset('OFFICE', ['studio'], { intensityBias: -0.05 });
    case 'Relato de Ciudad':
      return preset('CITY', ['traffic', 'crowd', 'night', 'footsteps'], { intensityBias: -0.05 });
    case 'Relato Literario':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.25 });
    case 'Rodaje de Cine':
      return preset('CITY', ['cinema', 'crowd', 'footsteps']);
    case 'Rompí con Mi Mejor Amigo de 15 Años':
      return preset('ROOM', ['home', 'night'], { intensityBias: -0.15 });
    case 'Salud Pública':
      return preset('OFFICE', ['studio', 'newsroom', 'medical'], { intensityBias: -0.05 });
    case 'Seguridad Ciudadana':
      return preset('CITY', ['police', 'traffic', 'crowd'], { intensityBias: 0.05 });
    case 'Seguridad Vial':
      return preset('CITY', ['traffic', 'police'], { intensityBias: 0.05 });
    case 'Servicios de la Ciudad':
      return preset('CITY', ['traffic', 'construction', 'crowd'], { intensityBias: 0.1 });
    case 'Sobreviví un Desastre Natural':
      return preset('NATURE', ['storm', 'wind', 'rain', 'night'], { intensityBias: 0.25 });
    case 'Soporte Técnico':
      return preset('OFFICE', ['tech', 'office', 'printer'], { intensityBias: -0.05 });
    case 'Start-up Tecnológica':
      return preset('OFFICE', ['tech', 'office', 'crowd'], { intensityBias: 0.05 });
    case 'Taller Mecánico':
      return preset('CITY', ['mechanic', 'construction', 'traffic'], { intensityBias: 0.15 });
    case 'Tecnología y Sociedad':
      return preset('OFFICE', ['studio', 'tech'], { intensityBias: -0.05 });
    case 'Terapia Psicológica':
      return preset('ROOM', ['medical', 'home'], { intensityBias: -0.25, duckingBias: 0.15 });
    case 'Tienda de Ropa':
      return preset('CITY', ['shop', 'crowd', 'music', 'footsteps']);
    case 'Trabajo / Oficina':
      return preset('OFFICE', ['office', 'printer', 'paper', 'footsteps']);
    case 'Tráfico Local':
      return preset('CITY', ['traffic'], { intensityBias: 0.15 });
    case 'Transporte / Ciudad':
      return preset('CITY', ['traffic', 'bus', 'pa', 'footsteps']);
    case 'Transporte Regional':
      return preset('CITY', ['train', 'bus', 'pa', 'crowd', 'footsteps']);
    case 'Tribunales':
      return preset('OFFICE', ['court', 'crowd', 'footsteps'], { intensityBias: -0.05 });
    case 'Turismo Local':
      return preset('CITY', ['crowd', 'traffic', 'footsteps']);
    case 'Última Hora':
      return preset('OFFICE', ['newsroom', 'pa', 'printer'], { intensityBias: 0.05 });
    case 'Una Amistad':
      return preset('ROOM', ['home'], { intensityBias: -0.15 });
    case 'Veterinario':
      return preset('OFFICE', ['medical', 'pets', 'crowd', 'door']);
    case 'Viaje Corto':
      return preset('CITY', ['train', 'bus', 'pa', 'footsteps']);
    case 'Viaje en Solitario':
      return preset('CITY', ['train', 'pa', 'footsteps', 'night'], { intensityBias: -0.05 });
    case 'Viví en Otro País Solo a los 18':
      return preset('CITY', ['crowd', 'traffic', 'footsteps']);
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

