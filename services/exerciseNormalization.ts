import { TRUE_FALSE_COLUMNS, TRUE_FALSE_NOTGIVEN_COLUMNS } from '@/data/listeningSyllabus';
import { Exercise, ExerciseOption } from '@/types';

/**
 * Repara la respuesta del modelo cuando devuelve TEXTOS donde el esquema espera
 * IDS. Es el fallo más frecuente de la generación y, si no se corrige, todas las
 * respuestas del alumno se marcan como incorrectas.
 *
 * Aquí NO se juzga si la clave es pedagógicamente válida: de eso se ocupa
 * `exerciseVerification.ts`, que además la contrasta con la transcripción.
 */

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

/** Mapea listas de ids con tolerancia a que vengan como textos. */
function mapIdList(values: string[], options: ExerciseOption[] | undefined): string[] {
  const ids = new Set((options || []).map(o => o.id));
  return values.map(val => (ids.has(val) ? val : findOptionIdByText(options, val) || val));
}

/** Mapea un `Record<filaId, columnaId>` con tolerancia a textos en el valor. */
function mapRowRecord(
  correct: Record<string, string>,
  columns: ExerciseOption[] | undefined
): Record<string, string> {
  const columnIds = new Set((columns || []).map(c => c.id));
  const normalized: Record<string, string> = {};
  for (const [rowId, value] of Object.entries(correct)) {
    normalized[rowId] = columnIds.has(value) ? value : findOptionIdByText(columns, value) || value;
  }
  return normalized;
}

/**
 * Los formatos de juicio traen las columnas implícitas, así que el modelo suele
 * responder "Verdadero" / "No se dice" en vez de los ids canónicos.
 */
function mapJudgementRecord(
  correct: Record<string, string>,
  columns: ExerciseOption[]
): Record<string, string> {
  const columnIds = new Set(columns.map(c => c.id));
  const normalized: Record<string, string> = {};

  for (const [rowId, rawValue] of Object.entries(correct)) {
    const value = String(rawValue ?? '');
    if (columnIds.has(value)) {
      normalized[rowId] = value;
      continue;
    }

    const key = normalizeKey(value);
    if (key === 'v' || key.startsWith('verdad') || key === 'true' || key === 'si') {
      normalized[rowId] = 'true';
    } else if (key === 'f' || key.startsWith('fals') || key === 'false') {
      normalized[rowId] = 'false';
    } else if (key.includes('no se dice') || key.includes('not given') || key === 'ns') {
      normalized[rowId] = 'not_given';
    } else {
      normalized[rowId] = findOptionIdByText(columns, value) || value;
    }
  }

  return normalized;
}

export function normalizeExerciseAnswers(exercise: Exercise): Exercise {
  const ex = structuredClone(exercise);
  const answer = ex.correctAnswer;

  switch (ex.type) {
    case 'multiple_choice': {
      if (!ex.options || !answer) break;
      if (typeof answer === 'string') {
        if (!ex.options.some(o => o.id === answer)) {
          const mapped = findOptionIdByText(ex.options, answer);
          if (mapped) ex.correctAnswer = mapped;
        }
      } else if (Array.isArray(answer)) {
        ex.correctAnswer = mapIdList(answer, ex.options);
      }
      break;
    }

    case 'ordering':
    case 'chunk_order': {
      if (!ex.options || !Array.isArray(answer)) break;
      ex.correctAnswer = mapIdList(answer, ex.options);
      break;
    }

    case 'spot_the_difference': {
      if (!ex.tokens || !Array.isArray(answer)) break;
      ex.correctAnswer = mapIdList(answer, ex.tokens);
      break;
    }

    case 'classification':
    case 'matching':
    case 'scale': {
      if (!ex.columns || !ex.rows) break;
      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) break;
      ex.correctAnswer = mapRowRecord(answer as Record<string, string>, ex.columns);
      break;
    }

    case 'true_false':
    case 'true_false_notgiven': {
      if (!ex.rows) break;
      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) break;
      const columns =
        ex.type === 'true_false_notgiven' ? TRUE_FALSE_NOTGIVEN_COLUMNS : TRUE_FALSE_COLUMNS;
      ex.correctAnswer = mapJudgementRecord(answer as Record<string, string>, columns);
      break;
    }

    case 'cloze': {
      if (!ex.gapOptions || !answer || typeof answer !== 'object' || Array.isArray(answer)) break;
      const normalized: Record<string, string> = {};
      for (const [gapId, value] of Object.entries(answer as Record<string, string>)) {
        const options = ex.gapOptions[gapId];
        const optionIds = new Set((options || []).map(o => o.id));
        normalized[gapId] = optionIds.has(value) ? value : findOptionIdByText(options, value) || value;
      }
      ex.correctAnswer = normalized;
      break;
    }

    case 'data_capture':
    case 'minimal_pairs': {
      if (!ex.fields || !answer || typeof answer !== 'object' || Array.isArray(answer)) break;
      const normalized: Record<string, string> = {};
      for (const [fieldId, value] of Object.entries(answer as Record<string, string>)) {
        const field = ex.fields.find(f => f.id === fieldId);
        const optionIds = new Set((field?.options || []).map(o => o.id));
        normalized[fieldId] = optionIds.has(value)
          ? value
          : findOptionIdByText(field?.options, value) || value;
      }
      ex.correctAnswer = normalized;
      break;
    }
  }

  return ex;
}
