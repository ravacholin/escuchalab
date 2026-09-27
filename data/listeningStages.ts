import type { ListeningStage } from '../types';

/**
 * Etapas de escucha: orden y textos de la interfaz. Separadas de
 * `listeningSyllabus.ts` porque `App.tsx` solo necesita esto, y importar el
 * syllabus entero lo metía en la descarga inicial. `listeningSyllabus` las
 * re-exporta, así que el resto del código no cambia.
 */
export const STAGE_ORDER: ListeningStage[] = [
  'anticipacion',
  'global',
  'selectiva',
  'intensiva',
  'reflexion'
];

export const STAGE_META: Record<ListeningStage, { label: string; hint: string }> = {
  anticipacion: {
    label: 'Antes de escuchar',
    hint: 'Respondé esto ANTES de darle play. No hay respuestas incorrectas por adivinar: sirve para activar lo que ya sabés.'
  },
  global: {
    label: 'Idea global',
    hint: 'Primera escucha completa. No busques detalles: buscá de qué va, para qué hablan y en qué queda.'
  },
  selectiva: {
    label: 'Detalle',
    hint: 'Segunda escucha. Ahora sí: información concreta, datos, quién hace qué y en qué orden.'
  },
  intensiva: {
    label: 'Foco en la lengua',
    hint: 'Tercera escucha, por tramos. Se trabaja la forma exacta: qué palabras se dijeron y qué matiz tienen.'
  },
  reflexion: {
    label: 'Después de escuchar',
    hint: 'Qué indicios te sirvieron. Esto es lo que se transfiere a la próxima escucha.'
  }
};
