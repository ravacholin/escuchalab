import { Exercise, ExerciseOption } from '@/types';

function normalizeKey(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function findOptionIdByText(options: ExerciseOption[] | undefined, value: string): string | null {
  if (!options || options.length === 0) return null;
  const needle = normalizeKey(value);
  if (!needle) return null;
  const match = options.find(o => normalizeKey(o.text) === needle);
  return match?.id || null;
}

function findColumnIdByText(columns: ExerciseOption[] | undefined, value: string): string | null {
  return findOptionIdByText(columns, value);
}

export function normalizeExerciseAnswers(exercise: Exercise): Exercise {
  const ex = structuredClone(exercise);

  if (ex.type === 'multiple_choice') {
    if (!ex.options || !ex.correctAnswer) return ex;

    if (typeof ex.correctAnswer === 'string') {
      const hasId = ex.options.some(o => o.id === ex.correctAnswer);
      if (!hasId) {
        const mapped = findOptionIdByText(ex.options, ex.correctAnswer);
        if (mapped) ex.correctAnswer = mapped;
      }
    } else if (Array.isArray(ex.correctAnswer)) {
      ex.correctAnswer = ex.correctAnswer
        .map(val => {
          const hasId = ex.options?.some(o => o.id === val);
          if (hasId) return val;
          return findOptionIdByText(ex.options, val) || val;
        });
    }
  }

  if (ex.type === 'ordering') {
    if (!ex.options || !Array.isArray(ex.correctAnswer)) return ex;
    const optionIds = new Set(ex.options.map(o => o.id));
    const looksLikeIds = ex.correctAnswer.every(id => optionIds.has(id));
    if (looksLikeIds) return ex;

    ex.correctAnswer = ex.correctAnswer.map(val => findOptionIdByText(ex.options, val) || val);
  }

  if (ex.type === 'classification' || (ex.type === 'true_false' && ex.rows)) {
    if (!ex.columns || !ex.rows || typeof ex.correctAnswer !== 'object' || !ex.correctAnswer) return ex;
    if (Array.isArray(ex.correctAnswer)) return ex;

    const correctMap = ex.correctAnswer as Record<string, string>;
    const columnIds = new Set(ex.columns.map(c => c.id));
    const normalized: Record<string, string> = {};

    for (const [rowId, value] of Object.entries(correctMap)) {
      if (columnIds.has(value)) {
        normalized[rowId] = value;
        continue;
      }
      normalized[rowId] = findColumnIdByText(ex.columns, value) || value;
    }
    ex.correctAnswer = normalized;
  }

  if (ex.type === 'cloze') {
    if (!ex.gapOptions || typeof ex.correctAnswer !== 'object' || !ex.correctAnswer) return ex;
    if (Array.isArray(ex.correctAnswer)) return ex;

    const correctMap = ex.correctAnswer as Record<string, string>;
    const normalized: Record<string, string> = {};
    for (const [gapId, value] of Object.entries(correctMap)) {
      const options = ex.gapOptions[gapId];
      const optionIds = new Set((options || []).map(o => o.id));
      if (optionIds.has(value)) {
        normalized[gapId] = value;
        continue;
      }
      normalized[gapId] = findOptionIdByText(options, value) || value;
    }
    ex.correctAnswer = normalized;
  }

  return ex;
}

