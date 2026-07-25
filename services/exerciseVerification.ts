import { DialogueLine, Exercise, ExerciseOption, ExerciseType } from '@/types';
import { normalizeExerciseAnswers } from './exerciseNormalization';
import {
  buildTranscriptIndex,
  contentWords,
  heardRatio,
  isHeard,
  normalizeText,
  TranscriptIndex
} from './textUtils';

/**
 * ============================================================================
 *  VERIFICACIÓN DE CLAVES
 * ============================================================================
 *
 * El validador anterior (`isValidExercise`) solo miraba la FORMA del objeto: si
 * había un array de opciones y algo en `correctAnswer`, el ejercicio pasaba.
 * Nunca comprobaba que la clave apuntara a una opción existente ni que lo que
 * el ejercicio afirma sobre el audio fuera cierto, de modo que un ejercicio con
 * la respuesta mal podía llegar intacto al alumno.
 *
 * Aquí se comprueban dos cosas:
 *
 *   1. Coherencia interna: la clave apunta a ids que existen, las biyecciones
 *      son biyecciones, las permutaciones son permutaciones, y el ejercicio no
 *      es degenerado (todas las filas en la misma columna, todas las opciones
 *      correctas, etc.).
 *   2. Fidelidad al audio: lo que el ejercicio presenta como dicho literalmente
 *      se dice de verdad en la transcripción.
 *
 * Un ejercicio que no verifica se descarta y su hueco lo rellena un motor
 * determinista. Es preferible un ejercicio menos a un ejercicio que enseña algo
 * falso.
 */

/**
 * El proyecto compila sin `strictNullChecks`, donde el estrechamiento de
 * uniones discriminadas no es fiable, así que se usa una única forma con campos
 * opcionales en lugar de `{ok:true,…} | {ok:false,…}`.
 */
export interface VerificationResult {
  ok: boolean;
  exercise?: Exercise;
  reason?: string;
}

const KNOWN_TYPES = new Set<ExerciseType>([
  'multiple_choice',
  'true_false',
  'ordering',
  'classification',
  'cloze',
  'true_false_notgiven',
  'matching',
  'scale',
  'data_capture',
  'minimal_pairs',
  'spot_the_difference',
  'chunk_order'
]);

const JUDGEMENT_VALUES = new Set(['true', 'false', 'not_given']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(reason: string): VerificationResult {
  return { ok: false, reason };
}

function idsOf(options?: ExerciseOption[]): Set<string> {
  return new Set((options || []).map(o => o.id));
}

/** Toda lista de opciones necesita ids únicos y textos no vacíos. */
function optionsAreSound(options: ExerciseOption[] | undefined, min: number): boolean {
  if (!Array.isArray(options) || options.length < min) return false;
  const ids = new Set<string>();
  for (const opt of options) {
    if (!opt || typeof opt.id !== 'string' || !opt.id.trim()) return false;
    if (typeof opt.text !== 'string' || !opt.text.trim()) return false;
    if (ids.has(opt.id)) return false;
    ids.add(opt.id);
  }
  return true;
}

function asRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, string>;
}

/** Cada fila debe tener respuesta y apuntar a una columna existente. */
function rowsMapCleanly(
  rows: ExerciseOption[],
  columns: ExerciseOption[],
  correct: Record<string, string>
): boolean {
  const columnIds = idsOf(columns);
  return rows.every(row => {
    const value = correct[row.id];
    return typeof value === 'string' && columnIds.has(value);
  });
}

function distinctValues(correct: Record<string, string>): number {
  return new Set(Object.values(correct)).size;
}

/** Localiza el turno en que se apoya un enunciado, para comparar contra él. */
function bestMatchingLine(index: TranscriptIndex, text: string, hint?: number[]): DialogueLine | null {
  if (index.lines.length === 0) return null;

  if (hint && hint.length > 0) {
    const line = index.lines[hint[0]];
    if (line) return line;
  }

  const needle = new Set(contentWords(text));
  if (needle.size === 0) return null;

  let best: DialogueLine | null = null;
  let bestScore = 0;
  for (const line of index.lines) {
    const words = new Set(contentWords(line.text || ''));
    let hits = 0;
    needle.forEach(w => {
      if (words.has(w)) hits++;
    });
    const score = hits / needle.size;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return bestScore >= 0.3 ? best : null;
}

// ---------------------------------------------------------------------------
// Verificación por formato
// ---------------------------------------------------------------------------

function verifyMultipleChoice(ex: Exercise): VerificationResult {
  if (!optionsAreSound(ex.options, 2)) return fail('multiple_choice sin opciones utilizables');
  const ids = idsOf(ex.options);

  if (typeof ex.correctAnswer === 'string') {
    if (!ids.has(ex.correctAnswer)) return fail('la respuesta correcta no está entre las opciones');
    return { ok: true, exercise: ex };
  }

  if (Array.isArray(ex.correctAnswer)) {
    const unique = [...new Set(ex.correctAnswer)];
    if (unique.length === 0) return fail('selección múltiple sin ninguna respuesta correcta');
    if (unique.some(id => !ids.has(id))) return fail('la selección múltiple apunta a ids inexistentes');
    if (unique.length === ex.options!.length) return fail('todas las opciones son correctas: el ítem no discrimina');
    return { ok: true, exercise: { ...ex, correctAnswer: unique } };
  }

  return fail('multiple_choice con respuesta de tipo inesperado');
}

function verifyJudgement(ex: Exercise, allowNotGiven: boolean): VerificationResult {
  if (!optionsAreSound(ex.rows, allowNotGiven ? 3 : 2)) return fail('sin afirmaciones utilizables');
  const correct = asRecord(ex.correctAnswer);
  if (!correct) return fail('respuesta no es un mapa fila → juicio');

  const values: string[] = [];
  for (const row of ex.rows!) {
    const value = correct[row.id];
    if (typeof value !== 'string' || !JUDGEMENT_VALUES.has(value)) {
      return fail(`la fila "${row.id}" no tiene un juicio válido`);
    }
    if (!allowNotGiven && value === 'not_given') {
      return fail('"no se dice" solo existe en true_false_notgiven');
    }
    values.push(value);
  }

  const unique = new Set(values);
  if (unique.size < 2) return fail('todas las afirmaciones tienen el mismo juicio');
  // El tercer valor es la razón de ser del formato: sin él es un V/F normal.
  if (allowNotGiven && !unique.has('not_given')) {
    return fail('true_false_notgiven sin ningún ítem "no se dice"');
  }

  return { ok: true, exercise: ex };
}

function verifyOrdering(ex: Exercise, index: TranscriptIndex): VerificationResult {
  if (!optionsAreSound(ex.options, 3)) return fail('ordering con menos de 3 elementos');
  if (!Array.isArray(ex.correctAnswer)) return fail('ordering sin secuencia de respuesta');

  const ids = idsOf(ex.options);
  const answer = ex.correctAnswer;
  if (answer.length !== ex.options!.length) return fail('la secuencia no cubre todos los elementos');
  if (new Set(answer).size !== answer.length) return fail('la secuencia repite elementos');
  if (answer.some(id => !ids.has(id))) return fail('la secuencia apunta a ids inexistentes');

  // El fallo pedagógico clásico: copiar turnos literales del diálogo. El orden
  // se reconstruye leyendo, por adyacencia, sin escuchar nada.
  const turnTexts = new Set(index.lines.map(l => normalizeText(l.text || '')).filter(Boolean));
  const verbatim = ex.options!.filter(o => turnTexts.has(normalizeText(o.text))).length;
  if (verbatim >= 3) return fail('los elementos son turnos copiados literalmente del diálogo');

  return { ok: true, exercise: ex };
}

function verifyChunkOrder(ex: Exercise, index: TranscriptIndex): VerificationResult {
  if (!optionsAreSound(ex.options, 3)) return fail('chunk_order con menos de 3 grupos');
  if (!Array.isArray(ex.correctAnswer)) return fail('chunk_order sin secuencia de respuesta');

  const ids = idsOf(ex.options);
  const answer = ex.correctAnswer;
  if (answer.length !== ex.options!.length) return fail('la secuencia no cubre todos los grupos');
  if (new Set(answer).size !== answer.length) return fail('la secuencia repite grupos');
  if (answer.some(id => !ids.has(id))) return fail('la secuencia apunta a ids inexistentes');

  // Los grupos deben ser trozos contiguos de una frase real: concatenados en el
  // orden correcto tienen que sonar literalmente en el audio. Esto valida a la
  // vez los grupos y el orden.
  const byId = new Map(ex.options!.map(o => [o.id, o.text]));
  const reconstructed = answer.map(id => byId.get(id) || '').join(' ');
  if (!isHeard(index, reconstructed)) return fail('la frase reconstruida no aparece en el audio');

  return { ok: true, exercise: ex };
}

function verifyClassification(ex: Exercise): VerificationResult {
  if (!optionsAreSound(ex.rows, 3)) return fail('classification con menos de 3 filas');
  if (!optionsAreSound(ex.columns, 2)) return fail('classification con menos de 2 columnas');
  const correct = asRecord(ex.correctAnswer);
  if (!correct) return fail('respuesta no es un mapa fila → columna');
  if (!rowsMapCleanly(ex.rows!, ex.columns!, correct)) return fail('hay filas sin columna válida');
  if (distinctValues(correct) < 2) return fail('todas las filas caen en la misma columna');
  return { ok: true, exercise: ex };
}

function verifyMatching(ex: Exercise): VerificationResult {
  if (!optionsAreSound(ex.rows, 3)) return fail('matching con menos de 3 parejas');
  if (!optionsAreSound(ex.columns, 3)) return fail('matching con menos de 3 opciones');
  const correct = asRecord(ex.correctAnswer);
  if (!correct) return fail('respuesta no es un mapa fila → opción');
  if (ex.rows!.length !== ex.columns!.length) return fail('matching no biyectivo: filas y opciones no coinciden');
  if (!rowsMapCleanly(ex.rows!, ex.columns!, correct)) return fail('hay filas sin opción válida');
  if (distinctValues(correct) !== ex.rows!.length) return fail('matching no biyectivo: una opción se repite');
  return { ok: true, exercise: ex };
}

function verifyScale(ex: Exercise): VerificationResult {
  if (!optionsAreSound(ex.rows, 3)) return fail('scale con menos de 3 enunciados');
  // Con menos de 3 puntos no hay gradación: sería una clasificación binaria.
  if (!optionsAreSound(ex.columns, 3)) return fail('scale con menos de 3 puntos en el eje');
  const correct = asRecord(ex.correctAnswer);
  if (!correct) return fail('respuesta no es un mapa enunciado → punto');
  if (!rowsMapCleanly(ex.rows!, ex.columns!, correct)) return fail('hay enunciados sin punto válido');
  if (distinctValues(correct) < 2) return fail('todos los enunciados caen en el mismo punto del eje');
  return { ok: true, exercise: ex };
}

function verifyCloze(ex: Exercise, index: TranscriptIndex): VerificationResult {
  if (!ex.textWithGaps || typeof ex.textWithGaps !== 'string') return fail('cloze sin texto');
  if (!ex.gapOptions || typeof ex.gapOptions !== 'object') return fail('cloze sin opciones de hueco');
  const correct = asRecord(ex.correctAnswer);
  if (!correct) return fail('respuesta no es un mapa hueco → opción');

  const gapKeys = Object.keys(ex.gapOptions);
  if (gapKeys.length === 0) return fail('cloze sin huecos');

  for (const gapId of gapKeys) {
    if (!ex.textWithGaps.includes(`{{${gapId}}}`)) return fail(`el hueco ${gapId} no aparece en el texto`);
    const options = ex.gapOptions[gapId];
    if (!optionsAreSound(options, 2)) return fail(`el hueco ${gapId} tiene menos de 2 opciones`);

    const answerId = correct[gapId];
    const chosen = options.find(o => o.id === answerId);
    if (!chosen) return fail(`el hueco ${gapId} apunta a una opción inexistente`);

    // La promesa del formato: la palabra correcta se dice literalmente.
    if (!isHeard(index, chosen.text)) {
      return fail(`la solución del hueco ${gapId} ("${chosen.text}") no suena en el audio`);
    }
  }

  // La frase portadora tiene que ser una cita, no una invención.
  const carrier = ex.textWithGaps.replace(/\{\{[\w\d]+\}\}/g, ' ');
  if (heardRatio(index, carrier) < 0.5) return fail('la frase del cloze no procede del audio');

  return { ok: true, exercise: ex };
}

function verifyFieldBased(ex: Exercise, index: TranscriptIndex): VerificationResult {
  const kind = ex.type === 'minimal_pairs' ? 'minimal_pairs' : 'data_capture';
  if (!Array.isArray(ex.fields) || ex.fields.length < 2) return fail(`${kind} con menos de 2 campos`);
  const correct = asRecord(ex.correctAnswer);
  if (!correct) return fail('respuesta no es un mapa campo → opción');

  let heardCount = 0;
  for (const field of ex.fields) {
    if (!field || typeof field.id !== 'string' || !field.id.trim()) return fail('campo sin id');
    if (typeof field.label !== 'string' || !field.label.trim()) return fail('campo sin etiqueta');
    if (!optionsAreSound(field.options, 2)) return fail(`el campo "${field.id}" tiene menos de 2 opciones`);

    const chosen = field.options.find(o => o.id === correct[field.id]);
    if (!chosen) return fail(`el campo "${field.id}" apunta a una opción inexistente`);

    const correctHeard = isHeard(index, chosen.text);
    if (correctHeard) heardCount++;

    if (kind === 'minimal_pairs') {
      // Nunca se acepta un ítem cuyo distractor sí suena y cuya "solución" no:
      // esa clave es definitivamente falsa.
      const distractorHeard = field.options.some(o => o.id !== chosen.id && isHeard(index, o.text));
      if (!correctHeard && distractorHeard) {
        return fail(`en el ítem "${field.id}" suena el distractor y no la solución`);
      }
    }
  }

  // Los datos dictados (un nombre deletreado, una hora dicha "y cuarto") no
  // aparecen siempre tal cual escritos, así que se exige mayoría, no unanimidad.
  if (heardCount / ex.fields.length < 0.5) {
    return fail(`${kind}: la mayoría de las soluciones no suenan en el audio`);
  }

  return { ok: true, exercise: ex };
}

function verifySpotTheDifference(ex: Exercise, index: TranscriptIndex): VerificationResult {
  if (!optionsAreSound(ex.tokens, 6)) return fail('spot_the_difference con menos de 6 palabras');
  if (!Array.isArray(ex.correctAnswer)) return fail('spot_the_difference sin lista de palabras alteradas');

  const tokenIds = idsOf(ex.tokens);
  const altered = [...new Set(ex.correctAnswer)];
  if (altered.length < 2) return fail('hacen falta al menos 2 palabras alteradas');
  if (altered.some(id => !tokenIds.has(id))) return fail('se marcan como alteradas palabras inexistentes');
  if (altered.length >= ex.tokens!.length) return fail('está alterada la frase entera');

  const alteredSet = new Set(altered);
  const kept = ex.tokens!.filter(t => !alteredSet.has(t.id));
  const changed = ex.tokens!.filter(t => alteredSet.has(t.id));

  // Se compara contra el turno concreto del que sale la frase, no contra toda
  // la transcripción: una palabra alterada puede aparecer legítimamente en otro
  // turno del diálogo.
  const source = bestMatchingLine(index, kept.map(t => t.text).join(' '), ex.sourceTurns);
  if (!source) return fail('la frase no se corresponde con ningún turno del audio');

  const sourceWords = new Set(normalizeText(source.text || '').split(' ').filter(Boolean));

  for (const token of changed) {
    const word = normalizeText(token.text);
    if (word && sourceWords.has(word)) {
      return fail(`la palabra "${token.text}" se marca como alterada pero sí se dice`);
    }
  }

  const keptContent = kept.map(t => normalizeText(t.text)).filter(w => w.length >= 4);
  if (keptContent.length > 0) {
    const hits = keptContent.filter(w => sourceWords.has(w)).length;
    if (hits / keptContent.length < 0.6) return fail('el fragmento no reproduce el turno original');
  }

  return { ok: true, exercise: { ...ex, correctAnswer: altered } };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function verifyExercise(raw: unknown, index: TranscriptIndex): VerificationResult {
  if (!raw || typeof raw !== 'object') return fail('el ejercicio no es un objeto');

  const candidate = raw as Exercise;
  if (!KNOWN_TYPES.has(candidate.type)) return fail(`tipo desconocido: ${String(candidate.type)}`);
  if (typeof candidate.question !== 'string' || !candidate.question.trim()) {
    return fail('el ejercicio no tiene enunciado');
  }
  if (candidate.correctAnswer === undefined || candidate.correctAnswer === null) {
    return fail('el ejercicio no tiene respuesta');
  }

  // Se normaliza antes de juzgar: el modelo suele devolver textos donde el
  // esquema espera ids, y eso no es un error de contenido.
  const ex = normalizeExerciseAnswers(candidate);

  // Los índices de turno fuera de rango se descartan en vez de tumbar el ítem.
  if (Array.isArray(ex.sourceTurns)) {
    ex.sourceTurns = ex.sourceTurns.filter(
      i => Number.isInteger(i) && i >= 0 && i < index.lines.length
    );
  }
  if (typeof ex.explanation !== 'string') ex.explanation = '';

  switch (ex.type) {
    case 'multiple_choice':
      return verifyMultipleChoice(ex);
    case 'true_false':
      return verifyJudgement(ex, false);
    case 'true_false_notgiven':
      return verifyJudgement(ex, true);
    case 'ordering':
      return verifyOrdering(ex, index);
    case 'chunk_order':
      return verifyChunkOrder(ex, index);
    case 'classification':
      return verifyClassification(ex);
    case 'matching':
      return verifyMatching(ex);
    case 'scale':
      return verifyScale(ex);
    case 'cloze':
      return verifyCloze(ex, index);
    case 'data_capture':
    case 'minimal_pairs':
      return verifyFieldBased(ex, index);
    case 'spot_the_difference':
      return verifySpotTheDifference(ex, index);
    default:
      return fail('tipo no verificable');
  }
}

/** Filtra una tanda de ejercicios y deja traza de lo descartado. */
export function verifyExercises(raw: unknown[], dialogue: DialogueLine[]): Exercise[] {
  const index = buildTranscriptIndex(dialogue);
  const kept: Exercise[] = [];

  for (const candidate of raw || []) {
    const result = verifyExercise(candidate, index);
    if (result.ok && result.exercise) {
      kept.push(result.exercise);
    } else {
      const slot = (candidate as Exercise)?.slotId || (candidate as Exercise)?.type || '?';
      console.warn(`[ejercicios] descartado "${slot}": ${result.reason}`);
    }
  }

  return kept;
}
