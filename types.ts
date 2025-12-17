
export enum Level {
  Initial = 'Inicial (A1-A2)',
  Intermediate = 'Intermedio (B1-B2)',
  Advanced = 'Avanzado (C1)'
}

export enum AppMode {
  Standard = 'Práctica Estándar',
  Vocabulary = 'Ampliar Vocabulario',
  AccentChallenge = 'Adivina el Acento'
}

// Topic is now just a helper for the AudioPlayer, but the config uses string
export enum TopicEnum {
  Restaurant = 'Restaurante y Comida',
  Accommodation = 'Alojamiento y Hotel',
  Health = 'Médico y Salud',
  Travel = 'Viajes y Transporte',
  Shopping = 'Tiendas y Compras',
  Work = 'Trabajo y Negocios',
  Social = 'Vida Social y Amigos'
}

export enum Length {
  Short = 'Corto (4-6 turnos)',
  Medium = 'Medio (8-12 turnos)',
  Long = 'Largo (14+ turnos)'
}

export enum TextType {
  Dialogue = 'Diálogo (2 personas)',
  PodcastInterview = 'Podcast - Entrevista (2 personas)',
  RadioNews = 'Noticias de Radio (1 persona)',
  Monologue = 'Monólogo / Storytelling (1 persona)'
}

export enum Accent {
  Madrid = 'España - Madrid (Distinción s/z)',
  Andalusia = 'España - Andalucía (Sur)',
  MexicoCity = 'México - CDMX (Chilango)',
  Bogota = 'Colombia - Bogotá (Rolo)',
  Caribbean = 'Caribe - Puerto Rico/Cuba',
  BuenosAires = 'Argentina - Rioplatense',
  Santiago = 'Chile - Santiago',
  Lima = 'Perú - Lima (Ribereño)'
}

export interface Character {
  name: string;
  gender: 'Male' | 'Female';
}

export interface DialogueLine {
  speaker: string;
  text: string;
  emotion?: string;
}

export interface ExerciseOption {
  id: string;
  text: string;
}

export interface Exercise {
  id: string;
  type: 'multiple_choice' | 'true_false' | 'ordering' | 'classification' | 'cloze';
  question: string; 
  
  // Opciones simples (Multiple Choice, Single Answer)
  options?: ExerciseOption[];
  
  // Estructuras de Tabla / Lista (Classification, True/False List, Matching)
  rows?: ExerciseOption[]; 
  columns?: ExerciseOption[];

  // Estructuras de Texto con Huecos (Cloze)
  textWithGaps?: string; 
  gapOptions?: Record<string, ExerciseOption[]>; 

  // Respuesta Polimórfica:
  // - String: ID única (Multiple Choice)
  // - Array<String>: Lista de IDs ordenada (Ordering)
  // - Record<string, string>: Mapa ID_Fila -> ID_Columna (Classification, True/False List, Cloze)
  correctAnswer: string | string[] | Record<string, string>; 
  
  explanation: string;
}

export interface LessonPlan {
  title: string;
  situationDescription: string;
  communicativeFunction: string;
  freesoundSearchQuery?: string; // Keywords in English for ambient noise
  characters: Character[];
  dialogue: DialogueLine[];
  exercises: {
    comprehension: Exercise[];
    vocabulary: Exercise[]; 
  };
}

export interface AppState {
  status: 'idle' | 'generating_plan' | 'generating_audio' | 'ready' | 'error';
  config: {
    mode: AppMode;
    level: Level;
    topic: string; // Changed from Enum to string for flexibility
    length: Length;
    textType: TextType;
    accent: Accent;
  };
  lessonPlan: LessonPlan | null;
  audioBlob: string | null;
  error: string | null;
}