import { AppMode, Exercise, ExerciseOption, LessonPlan, Level } from '@/types';

type AugmentConfig = {
  level: Level;
  mode: AppMode;
};

const STOPWORDS = new Set([
  'a', 'al', 'algo', 'así', 'aquí', 'bien', 'con', 'como', 'cómo', 'cuando', 'cuándo', 'de', 'del',
  'donde', 'dónde', 'el', 'ella', 'ellas', 'ellos', 'en', 'es', 'esa', 'ese', 'eso', 'esta', 'este',
  'esto', 'está', 'están', 'estoy', 'fue', 'ha', 'han', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los',
  'me', 'mi', 'mis', 'mucho', 'muy', 'no', 'o', 'para', 'pero', 'por', 'porque', 'que', 'qué', 'se',
  'si', 'sí', 'sin', 'su', 'sus', 'te', 'tú', 'tu', 'un', 'una', 'uno', 'unas', 'unos', 'usted', 'ustedes',
  'ya', 'y', 'yo'
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clampText(text: string, max = 140): string {
  const t = (text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function uniqueByNormalized(options: ExerciseOption[]): ExerciseOption[] {
  const seen = new Set<string>();
  const out: ExerciseOption[] = [];
  for (const opt of options) {
    const key = normalizeText(opt.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(opt);
  }
  return out;
}

function getSpeakers(dialogue: LessonPlan['dialogue']): string[] {
  const speakers: string[] = [];
  const seen = new Set<string>();
  for (const line of dialogue || []) {
    const s = (line.speaker || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    speakers.push(s);
  }
  return speakers;
}

function detectRegisterToken(text: string): 'formal' | 'informal' | 'neutral' {
  const t = normalizeText(text);
  if (!t) return 'neutral';

  const formalSignals = ['usted', 'disculpe', 'buenos dias', 'buenas tardes', 'por favor', 'gracias', 'permiso'];
  const informalSignals = ['tio', 'tía', 'che', 'vale', 'oye', 'pana', 'vos', 'cachai', 'po'];

  if (formalSignals.some(s => t.includes(s))) return 'formal';
  if (informalSignals.some(s => t.includes(s))) return 'informal';
  return 'neutral';
}

function detectSpeechAct(text: string): 'request' | 'offer' | 'confirm' | 'apology' | 'thanks' | 'rejection' | null {
  const t = normalizeText(text);
  if (!t) return null;

  if (t.includes('perdon') || t.includes('disculp')) return 'apology';
  if (t.includes('gracias')) return 'thanks';
  if (t.includes('no puedo') || t.includes('no, ') || t.startsWith('no ') || t.includes('lo siento, no')) return 'rejection';
  if (t.includes('vale') || t.includes('de acuerdo') || t.includes('perfecto') || t.includes('ok') || t.includes('entendido')) return 'confirm';

  const requestSignals = ['podria', 'puede', 'me puedes', 'me puede', 'quisiera', 'quiero', 'me gustaria', 'necesito', 'me das', 'me da', 'me trae'];
  if (requestSignals.some(s => t.includes(s))) return 'request';

  const offerSignals = ['te ofrezco', 'le ofrezco', 'te puedo', 'le puedo', 'si quieres', 'si quiere', 'puedo darte', 'puedo darle', 'te traigo', 'le traigo'];
  if (offerSignals.some(s => t.includes(s))) return 'offer';

  return null;
}

function extractKeywordCandidates(dialogue: LessonPlan['dialogue']): string[] {
  const tokens: string[] = [];
  for (const line of dialogue || []) {
    const clean = normalizeText(line.text || '');
    if (!clean) continue;
    for (const token of clean.split(' ')) {
      if (!token) continue;
      if (token.length < 4) continue;
      if (STOPWORDS.has(token)) continue;
      tokens.push(token);
    }
  }
  return tokens;
}

function findDigitLiterals(dialogue: LessonPlan['dialogue']): string[] {
  const found: string[] = [];
  const rx = /\b\d{1,4}(?:[\.,:]\d{1,2})?\b/g;
  for (const line of dialogue || []) {
    const matches = (line.text || '').match(rx);
    if (!matches) continue;
    for (const m of matches) found.push(m);
  }
  return found;
}

function buildOrderingFromDialogue(dialogue: LessonPlan['dialogue']): Exercise | null {
  const usable = (dialogue || [])
    .filter(d => (d.text || '').trim().length >= 12)
    .slice(0, 10);
  if (usable.length < 4) return null;

  const picked = usable.slice(0, 4);
  const options: ExerciseOption[] = picked.map((line, idx) => ({
    id: `auto_ord_opt_${idx}`,
    text: `${line.speaker}: ${line.text}`
  }));

  return {
    id: 'auto_comp_ordering_1',
    type: 'ordering',
    question: 'Ordena los enunciados según aparecen en el audio (de primero a último).',
    options,
    correctAnswer: options.map(o => o.id),
    explanation: 'Escucha la progresión: qué se pide primero, qué se confirma después y cómo termina el intercambio.'
  };
}

function buildWhoSaidItClassification(dialogue: LessonPlan['dialogue']): Exercise | null {
  const speakers = getSpeakers(dialogue);
  if (speakers.length < 2) return null;

  const usable = (dialogue || [])
    .filter(d => (d.text || '').trim().length >= 10 && (d.speaker || '').trim())
    .slice(0, 12);
  if (usable.length < 4) return null;

  const picked = usable.slice(0, 4);
  const columns: ExerciseOption[] = speakers.slice(0, 2).map(s => ({ id: s, text: s }));
  const rows: ExerciseOption[] = picked.map((line, idx) => ({
    id: `auto_who_row_${idx}`,
    text: `“${line.text}”`
  }));
  const correctAnswer: Record<string, string> = {};
  picked.forEach((line, idx) => {
    correctAnswer[`auto_who_row_${idx}`] = (line.speaker || '').trim();
  });

  return {
    id: 'auto_comp_who_1',
    type: 'classification',
    question: '¿Quién lo dice? Asigna cada frase al hablante correcto.',
    rows,
    columns,
    correctAnswer,
    explanation: 'Fíjate en las intenciones (pedir, negar, confirmar) y en el turno de palabra: quién responde y quién inicia.'
  };
}

function buildSelectAllHeard(dialogue: LessonPlan['dialogue']): Exercise | null {
  const normalizedFull = normalizeText((dialogue || []).map(d => d.text || '').join(' '));
  if (!normalizedFull) return null;

  const keywordCandidates = extractKeywordCandidates(dialogue);
  const present = uniqueByNormalized(
    shuffle(keywordCandidates)
      .slice(0, 40)
      .map((t, idx) => ({ id: `auto_sa_p_${idx}`, text: t }))
  )
    .filter(o => normalizedFull.includes(normalizeText(o.text)))
    .slice(0, 3);

  const distractorPool = [
    'pasaporte', 'contrasena', 'paraguas', 'entrega', 'garantia', 'camarote', 'recargo', 'reembolso', 'tornillo', 'enchufe'
  ];
  const absent = uniqueByNormalized(
    shuffle(distractorPool).map((t, idx) => ({ id: `auto_sa_a_${idx}`, text: t }))
  )
    .filter(o => !normalizedFull.includes(normalizeText(o.text)))
    .slice(0, 3);

  if (present.length < 2 || absent.length < 2) return null;

  const options = shuffle([...present, ...absent]).slice(0, 6);
  const correctAnswer = options
    .filter(o => present.some(p => normalizeText(p.text) === normalizeText(o.text)))
    .map(o => o.id);

  if (correctAnswer.length < 2) return null;

  return {
    id: 'auto_comp_select_all_1',
    type: 'multiple_choice',
    question: 'Selecciona TODAS las palabras que SÍ se escuchan en el audio.',
    options,
    correctAnswer,
    explanation: 'Marca solo las que aparecen literalmente. Si dudas, vuelve a escuchar el tramo donde se mencionan los detalles.'
  };
}

function buildSpeechActClassification(dialogue: LessonPlan['dialogue']): Exercise | null {
  const usable = (dialogue || [])
    .map(d => ({ speaker: (d.speaker || '').trim(), text: (d.text || '').trim(), act: detectSpeechAct(d.text || '') }))
    .filter(d => d.speaker && d.text && d.act);

  if (usable.length < 4) return null;

  const picked = usable.slice(0, 4);
  const columns: ExerciseOption[] = [
    { id: 'request', text: 'Pedir / Solicitar' },
    { id: 'offer', text: 'Ofrecer' },
    { id: 'confirm', text: 'Confirmar / Aceptar' },
    { id: 'rejection', text: 'Rechazar' },
    { id: 'apology', text: 'Disculparse' },
    { id: 'thanks', text: 'Agradecer' }
  ];

  const rows: ExerciseOption[] = picked.map((line, idx) => ({
    id: `auto_act_row_${idx}`,
    text: clampText(`“${line.text}”`, 120)
  }));
  const correctAnswer: Record<string, string> = {};
  picked.forEach((line, idx) => {
    correctAnswer[`auto_act_row_${idx}`] = line.act as string;
  });

  return {
    id: 'auto_comp_act_1',
    type: 'classification',
    question: 'Identifica la intención (acto de habla) de cada frase.',
    rows,
    columns,
    correctAnswer,
    explanation: 'No es gramática: es intención. ¿Pide algo, ofrece algo, confirma, rechaza, se disculpa o agradece?'
  };
}

function buildRegisterClassification(dialogue: LessonPlan['dialogue']): Exercise | null {
  const usable = (dialogue || [])
    .filter(d => (d.text || '').trim().length >= 10)
    .map(d => ({ text: (d.text || '').trim(), reg: detectRegisterToken(d.text || '') }));

  if (usable.length < 6) return null;

  const picked = usable.slice(0, 6);
  const columns: ExerciseOption[] = [
    { id: 'formal', text: 'Formal' },
    { id: 'neutral', text: 'Neutro' },
    { id: 'informal', text: 'Informal' }
  ];

  const rows: ExerciseOption[] = picked.map((line, idx) => ({
    id: `auto_reg_row_${idx}`,
    text: clampText(`“${line.text}”`, 120)
  }));
  const correctAnswer: Record<string, string> = {};
  picked.forEach((line, idx) => {
    correctAnswer[`auto_reg_row_${idx}`] = line.reg;
  });

  return {
    id: 'auto_vocab_register_1',
    type: 'classification',
    question: 'Clasifica el registro de cada frase (según lo que se escucha).',
    rows,
    columns,
    correctAnswer,
    explanation: 'Busca marcas como “usted/por favor” (formal) o muletillas y cercanía (informal).'
  };
}

function buildTwoGapCloze(dialogue: LessonPlan['dialogue']): Exercise | null {
  const usable = (dialogue || [])
    .filter(d => (d.text || '').trim().length >= 28)
    .slice(0, 16);
  if (usable.length === 0) return null;

  const line = usable[0];
  const clean = normalizeText(line.text || '');
  const candidates = clean
    .split(' ')
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
  if (candidates.length < 2) return null;

  const target1 = candidates[0];
  const target2 = candidates[candidates.length - 1];
  if (normalizeText(target1) === normalizeText(target2)) return null;

  let textWithGaps = line.text || '';
  textWithGaps = textWithGaps.replace(new RegExp(`\\b${target1}\\b`, 'i'), '{{gap1}}');
  textWithGaps = textWithGaps.replace(new RegExp(`\\b${target2}\\b`, 'i'), '{{gap2}}');
  if (!textWithGaps.includes('{{gap1}}') || !textWithGaps.includes('{{gap2}}')) return null;

  const keywordCandidates = extractKeywordCandidates(dialogue);
  const distractorPool = shuffle(keywordCandidates)
    .map(t => normalizeText(t))
    .filter(t => t && t !== normalizeText(target1) && t !== normalizeText(target2));

  const gap1Options: ExerciseOption[] = uniqueByNormalized([
    { id: 'auto_gap1_correct', text: target1 },
    ...distractorPool.slice(0, 3).map((t, idx) => ({ id: `auto_gap1_d_${idx}`, text: t }))
  ]);
  const gap2Options: ExerciseOption[] = uniqueByNormalized([
    { id: 'auto_gap2_correct', text: target2 },
    ...distractorPool.slice(3, 6).map((t, idx) => ({ id: `auto_gap2_d_${idx}`, text: t }))
  ]);

  if (gap1Options.length < 3 || gap2Options.length < 3) return null;

  return {
    id: 'auto_vocab_cloze_2g_1',
    type: 'cloze',
    question: 'Completa la frase exacta (2 huecos).',
    textWithGaps: `${line.speaker}: ${textWithGaps}`,
    gapOptions: { gap1: shuffle(gap1Options), gap2: shuffle(gap2Options) },
    correctAnswer: { gap1: 'auto_gap1_correct', gap2: 'auto_gap2_correct' },
    explanation: 'Las dos opciones correctas son las que aparecen literalmente en ese turno del audio.'
  };
}

function buildMentionTrueFalse(dialogue: LessonPlan['dialogue']): Exercise | null {
  const normalizedFull = normalizeText((dialogue || []).map(d => d.text || '').join(' '));
  if (!normalizedFull) return null;

  const keywordCandidates = extractKeywordCandidates(dialogue);
  const present = uniqueByNormalized(
    shuffle(keywordCandidates)
      .slice(0, 20)
      .map((t, idx) => ({ id: `auto_tf_p_${idx}`, text: t }))
  )
    .slice(0, 2)
    .filter(o => normalizedFull.includes(normalizeText(o.text)));

  const distractorPool = [
    'piscina', 'bicicleta', 'receta', 'aduana', 'museo', 'farmacia', 'ascensor', 'contraseña', 'estacionamiento',
    'maleta', 'abrigo', 'callejon', 'propina'
  ];
  const absent = uniqueByNormalized(
    shuffle(distractorPool)
      .map((t, idx) => ({ id: `auto_tf_a_${idx}`, text: t }))
  )
    .filter(o => !normalizedFull.includes(normalizeText(o.text)))
    .slice(0, 2);

  if (present.length < 2 || absent.length < 2) return null;

  const rows = shuffle([
    ...present.map((o, idx) => ({ id: `auto_tf_row_p_${idx}`, text: o.text })),
    ...absent.map((o, idx) => ({ id: `auto_tf_row_a_${idx}`, text: o.text }))
  ]);
  const correctAnswer: Record<string, string> = {};
  for (const row of rows) {
    correctAnswer[row.id] = normalizedFull.includes(normalizeText(row.text)) ? 'true' : 'false';
  }

  return {
    id: 'auto_comp_tf_1',
    type: 'true_false',
    question: 'Según el audio: ¿se menciona (literalmente) cada palabra?',
    rows,
    correctAnswer,
    explanation: 'Marca VERDADERO solo si la palabra aparece en el audio; FALSO si no se menciona.'
  };
}

function buildListeningCloze(dialogue: LessonPlan['dialogue']): Exercise | null {
  const usable = (dialogue || [])
    .filter(d => (d.text || '').trim().length >= 18)
    .slice(0, 12);
  if (usable.length === 0) return null;

  const line = usable[0];
  const clean = normalizeText(line.text || '');
  const candidates = clean
    .split(' ')
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
  if (candidates.length === 0) return null;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const rx = new RegExp(`\\b${target}\\b`, 'i');
  const textWithGaps = (line.text || '').replace(rx, '{{gap1}}');
  if (textWithGaps === line.text) return null;

  const keywordCandidates = extractKeywordCandidates(dialogue);
  const distractors = shuffle(keywordCandidates)
    .map(t => normalizeText(t))
    .filter(t => t && t !== normalizeText(target))
    .slice(0, 3);
  const optionTexts = uniqueByNormalized([
    { id: 'auto_gap1_correct', text: target },
    ...distractors.map((t, idx) => ({ id: `auto_gap1_d_${idx}`, text: t }))
  ]);

  if (optionTexts.length < 3) return null;

  return {
    id: 'auto_vocab_cloze_1',
    type: 'cloze',
    question: 'Completa la frase exacta (elige la palabra que se escucha).',
    textWithGaps: `${line.speaker}: ${textWithGaps}`,
    gapOptions: { gap1: shuffle(optionTexts) },
    correctAnswer: { gap1: 'auto_gap1_correct' },
    explanation: 'La opción correcta es la palabra que aparece literalmente en ese turno del audio.'
  };
}

function ensureAtLeastOneType(
  exercises: Exercise[],
  type: Exercise['type'],
  build: () => Exercise | null
): Exercise[] {
  if (exercises.some(ex => ex.type === type)) return exercises;
  const created = build();
  if (!created) return exercises;
  return [created, ...exercises];
}

function ensureAtLeastNByType(
  exercises: Exercise[],
  type: Exercise['type'],
  minimum: number,
  build: () => Exercise | null
): Exercise[] {
  const count = exercises.filter(ex => ex.type === type).length;
  if (count >= minimum) return exercises;
  const created = build();
  if (!created) return exercises;
  return [created, ...exercises];
}

export function augmentLessonPlanExercises(plan: LessonPlan, cfg: AugmentConfig): LessonPlan {
  const dialogue = plan.dialogue || [];

  const isIntro = cfg.level === Level.Intro;

  const minComprehension = (() => {
    if (cfg.mode === AppMode.AccentChallenge) return 2;
    if (isIntro) return 4;
    if (cfg.level === Level.Intermediate) return 5;
    if (cfg.level === Level.Advanced) return 5;
    return 4;
  })();

  const minVocabulary = (() => {
    if (cfg.mode === AppMode.AccentChallenge) return 1;
    if (cfg.mode === AppMode.Vocabulary) return 4;
    if (isIntro) return 3;
    return 3;
  })();

  const comprehension = [...(plan.exercises?.comprehension || [])];
  const vocabulary = [...(plan.exercises?.vocabulary || [])];

  let nextComprehension = comprehension;
  if (cfg.mode === AppMode.Standard || cfg.mode === AppMode.Vocabulary) {
    nextComprehension = ensureAtLeastOneType(nextComprehension, 'ordering', () => buildOrderingFromDialogue(dialogue));
    nextComprehension = ensureAtLeastOneType(nextComprehension, 'classification', () => buildWhoSaidItClassification(dialogue));
    nextComprehension = ensureAtLeastOneType(nextComprehension, 'true_false', () => buildMentionTrueFalse(dialogue));
    nextComprehension = ensureAtLeastNByType(nextComprehension, 'multiple_choice', 1, () => buildSelectAllHeard(dialogue));

    if (!isIntro) {
      nextComprehension = ensureAtLeastNByType(nextComprehension, 'classification', 2, () => buildSpeechActClassification(dialogue));
    }
  }

  let nextVocabulary = vocabulary;
  if (cfg.mode === AppMode.Standard || cfg.mode === AppMode.Vocabulary) {
    nextVocabulary = ensureAtLeastNByType(nextVocabulary, 'cloze', cfg.mode === AppMode.Vocabulary ? 2 : 1, () => buildListeningCloze(dialogue));
    nextVocabulary = ensureAtLeastNByType(nextVocabulary, 'cloze', 2, () => buildTwoGapCloze(dialogue));
    nextVocabulary = ensureAtLeastOneType(nextVocabulary, 'classification', () => buildRegisterClassification(dialogue));
  }

  // A0: if we detected explicit digits, add an extra micro-listening exercise.
  if (isIntro && cfg.mode !== AppMode.AccentChallenge) {
    const digits = findDigitLiterals(dialogue);
    const pick = digits.find(d => d.length >= 1);
    if (pick) {
      const baseNum = parseFloat(pick.replace(',', '.'));
      const distractors = Number.isFinite(baseNum)
        ? uniqueByNormalized([
            { id: 'auto_num_correct', text: pick },
            { id: 'auto_num_d1', text: String(baseNum + 10).replace('.', ',') },
            { id: 'auto_num_d2', text: String(baseNum + 1).replace('.', ',') },
            { id: 'auto_num_d3', text: String(Math.max(0, baseNum - 1)).replace('.', ',') }
          ])
        : uniqueByNormalized([
            { id: 'auto_num_correct', text: pick },
            { id: 'auto_num_d1', text: '10' },
            { id: 'auto_num_d2', text: '12' },
            { id: 'auto_num_d3', text: '15' }
          ]);

      if (distractors.length >= 2) {
        nextComprehension = [
          {
            id: 'auto_comp_number_1',
            type: 'multiple_choice',
            question: 'Escucha el dato: ¿qué número aparece en el audio?',
            options: shuffle(distractors),
            correctAnswer: 'auto_num_correct',
            explanation: 'Los distractores son números parecidos: la clave es discriminar con precisión.'
          },
          ...nextComprehension
        ];
      }
    }
  }

  // Soft caps to keep the module usable.
  const maxComprehension = cfg.mode === AppMode.Vocabulary ? 6 : 7;
  const maxVocabulary = cfg.mode === AppMode.Vocabulary ? 7 : 6;
  if (nextComprehension.length > Math.max(minComprehension, maxComprehension)) nextComprehension = nextComprehension.slice(0, Math.max(minComprehension, maxComprehension));
  if (nextVocabulary.length > Math.max(minVocabulary, maxVocabulary)) nextVocabulary = nextVocabulary.slice(0, Math.max(minVocabulary, maxVocabulary));

  // If AI generated too few, we still try to backfill with what we can.
  if (nextComprehension.length < minComprehension) {
    nextComprehension = ensureAtLeastOneType(nextComprehension, 'cloze', () => buildListeningCloze(dialogue));
  }

  if (nextVocabulary.length < minVocabulary) {
    nextVocabulary = ensureAtLeastOneType(nextVocabulary, 'multiple_choice', () => buildSelectAllHeard(dialogue));
  }

  return {
    ...plan,
    exercises: {
      comprehension: nextComprehension,
      vocabulary: nextVocabulary
    }
  };
}
