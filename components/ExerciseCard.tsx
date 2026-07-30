import React, { useState, useEffect, useMemo } from 'react';
import { DialogueLine, Exercise } from '../types';
import {
  FORMAT_LABELS,
  SKILL_LABELS,
  STAGE_META,
  TRUE_FALSE_COLUMNS,
  TRUE_FALSE_NOTGIVEN_COLUMNS
} from '../data/listeningSyllabus';
import { Check, X, ArrowUp, ArrowDown, GripVertical, AlertCircle, Quote, MousePointerClick } from 'lucide-react';

interface ExerciseCardProps {
  exercise: Exercise;
  index: number;
  /** Turnos del audio, para poder citar la fuente de la respuesta al corregir. */
  dialogue?: DialogueLine[];
  /**
   * Se avisa al corregir para que la etapa pueda mostrar cuántos ejercicios
   * lleva resueltos el alumno sin desplegarlos todos. El estado de la tarjeta
   * sigue siendo suyo: esto solo lo informa hacia arriba. Quién es esta tarjeta
   * lo decide quien la monta, no el `id` que haya devuelto el modelo.
   */
  onAnswered?: (correct: boolean) => void;
}

/** Formatos que se resuelven rellenando un mapa campo → opción. */
const FIELD_TYPES = new Set(['data_capture', 'minimal_pairs']);
/** Formatos que se resuelven rellenando un mapa fila → columna. */
const TABLE_TYPES = new Set([
  'classification',
  'matching',
  'scale',
  'true_false',
  'true_false_notgiven'
]);

const ExerciseCard: React.FC<ExerciseCardProps> = ({ exercise, index, dialogue, onAnswered }) => {
  // --- ROBUST DATA NORMALIZATION ---
  // This ensures that even if the AI returns malformed data (missing IDs), the UI won't break.
  const safeExercise = useMemo(() => {
    // Deep copy to allow modification without prop mutation issues
    const safe = JSON.parse(JSON.stringify(exercise));

    // Helper to ensure every item in a list has a unique ID
    const ensureIds = (list: any[], prefix: string) => {
        if (!Array.isArray(list)) return [];
        return list.map((item, idx) => {
            // If ID is missing or empty, generate one. 
            // Also supports if 'item' is just a string (though type says object)
            if (typeof item === 'string') return { id: `${prefix}_${idx}`, text: item };
            return {
                ...item,
                id: (item.id && String(item.id).trim().length > 0) ? item.id : `${prefix}_${idx}`
            };
        });
    };

    if (safe.options) safe.options = ensureIds(safe.options, `opt_${index}`);
    if (safe.rows) safe.rows = ensureIds(safe.rows, `row_${index}`);
    if (safe.columns) safe.columns = ensureIds(safe.columns, `col_${index}`);
    if (safe.tokens) safe.tokens = ensureIds(safe.tokens, `tok_${index}`);

    // Ficha de datos / pares mínimos: cada campo lleva su propia lista.
    if (Array.isArray(safe.fields)) {
        safe.fields = safe.fields.map((field: any, idx: number) => ({
            ...field,
            id: (field?.id && String(field.id).trim()) ? field.id : `fld_${index}_${idx}`,
            options: ensureIds(field?.options, `fld_${index}_${idx}_o`)
        }));
    }

    // Los formatos de juicio traen las columnas implícitas.
    if (safe.type === 'true_false_notgiven') safe.columns = [...TRUE_FALSE_NOTGIVEN_COLUMNS];
    else if (safe.type === 'true_false' && safe.rows) safe.columns = [...TRUE_FALSE_COLUMNS];

    // Normalize Gap Options for Cloze
    if (safe.gapOptions) {
        const newGaps: Record<string, any[]> = {};
        Object.keys(safe.gapOptions).forEach((key) => {
             newGaps[key] = ensureIds(safe.gapOptions[key], `gap_${index}_${key}`);
        });
        safe.gapOptions = newGaps;
    }

    return safe;
  }, [exercise, index]);

  // --- STATE ---
  // selectedOptions is now an ARRAY to support multi-select (Caza-Palabras)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [orderedList, setOrderedList] = useState<string[]>([]); 
  const [answersMap, setAnswersMap] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    setSelectedOptions([]);
    setAnswersMap({});
    setIsSubmitted(false);
    
    // Robust Ordering Initialization using safeExercise
    if (safeExercise.type === 'ordering' || safeExercise.type === 'chunk_order') {
      if (safeExercise.options && safeExercise.options.length > 0) {
          // Shuffle options for the initial state
          const shuffled = [...safeExercise.options].sort(() => Math.random() - 0.5);
          setOrderedList(shuffled.map((o: any) => o.id));
      } else {
          setOrderedList([]);
      }
    }
  }, [safeExercise]);

  const handleSubmit = () => {
    setIsSubmitted(true);
    onAnswered?.(isCorrect());
  };

  // --- VALIDATION HELPERS ---
  const isAnswerMapCorrect = () => {
    if (typeof safeExercise.correctAnswer !== 'object' || Array.isArray(safeExercise.correctAnswer) || !safeExercise.correctAnswer) return false;
    const correctMap = safeExercise.correctAnswer as Record<string, string>;
    const userKeys = Object.keys(answersMap);
    
    if (safeExercise.type === 'cloze') {
        const gapKeys = Object.keys(safeExercise.gapOptions || {});
        // Check if all gaps are filled, correctness is checked individually in render but also here for total score
        return userKeys.length === gapKeys.length && Object.entries(answersMap).every(([key, val]) => {
            const correctVal = correctMap[key];
            return correctVal && (val as string).toLowerCase() === correctVal.toLowerCase();
        });
    } else if (FIELD_TYPES.has(safeExercise.type)) {
        if (userKeys.length !== (safeExercise.fields?.length || 0)) return false;
    } else if (safeExercise.rows) {
        if (userKeys.length !== safeExercise.rows.length) return false;
    }

    return Object.entries(answersMap).every(([key, val]) => {
        const correctVal = correctMap[key];
        return typeof correctVal === 'string' && (val as string).toLowerCase() === correctVal.toLowerCase();
    });
  };

  const isOrderingCorrect = () => {
      const correct = safeExercise.correctAnswer as string[];
      if (!Array.isArray(correct)) return false;
      return JSON.stringify(orderedList) === JSON.stringify(correct);
  };

  // Handles both Single String and Array<String> correct answers
  const isSelectionCorrect = () => {
      const correct = safeExercise.correctAnswer;
      
      // Multi-Select Case (Caza-Palabras)
      if (Array.isArray(correct)) {
          // Check if selected contains ALL correct and NO incorrect
          // Note: strict equality for arrays usually requires sorting, 
          // but here we just check if sets are equal in size and content.
          if (selectedOptions.length !== correct.length) return false;
          return correct.every(c => selectedOptions.includes(c));
      }

      // Single Select Case
      if (typeof correct === 'string') {
          return selectedOptions.length === 1 && selectedOptions[0]?.toLowerCase() === correct.toLowerCase();
      }

      return false;
  };

  /**
   * En el termómetro el eje es ORDINAL, así que fallar por un punto no es lo
   * mismo que fallar por tres. Se mide la distancia máxima para poder decírselo
   * al alumno en la corrección.
   */
  const scaleDistance = () => {
      const points: string[] = (safeExercise.columns || []).map((c: any) => c.id);
      const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};
      let worst = 0;
      for (const [rowId, correctId] of Object.entries(correctMap)) {
          const given = answersMap[rowId];
          if (!given) return Infinity;
          worst = Math.max(worst, Math.abs(points.indexOf(given) - points.indexOf(correctId)));
      }
      return worst;
  };

  const isCorrect = () => {
      switch (safeExercise.type) {
          case 'classification':
          case 'matching':
          case 'scale':
          case 'cloze':
          case 'data_capture':
          case 'dictation':
          case 'minimal_pairs':
          case 'true_false_notgiven':
              return isAnswerMapCorrect();
          case 'true_false':
              return safeExercise.rows ? isAnswerMapCorrect() : isSelectionCorrect();
          case 'ordering':
          case 'chunk_order':
              return isOrderingCorrect();
          case 'multiple_choice':
          case 'spot_the_difference':
              return isSelectionCorrect();
          default:
              return false;
      }
  };

  const canSubmit = () => {
      if (isSubmitted) return false;
      switch (safeExercise.type) {
          case 'multiple_choice':
          case 'spot_the_difference':
              return selectedOptions.length > 0;
          case 'ordering':
          case 'chunk_order':
              return orderedList.length > 0;
          case 'true_false':
              if (safeExercise.rows) return Object.keys(answersMap).length === safeExercise.rows.length;
              return selectedOptions.length > 0;
          case 'classification':
          case 'matching':
          case 'scale':
          case 'true_false_notgiven':
               return Object.keys(answersMap).length === (safeExercise.rows?.length || 0);
          case 'data_capture':
          case 'dictation':
          case 'minimal_pairs':
               return Object.keys(answersMap).length === (safeExercise.fields?.length || 0);
          case 'cloze':
               return Object.keys(answersMap).length === Object.keys(safeExercise.gapOptions || {}).length;
          default:
              return false;
      }
  };

  /**
   * Turnos en los que se apoya la respuesta. Se revelan solo al corregir: es la
   * prueba de la clave y le dice al alumno exactamente dónde volver a escuchar.
   */
  const sourceLines = useMemo(() => {
      if (!dialogue || !Array.isArray(safeExercise.sourceTurns)) return [];
      return safeExercise.sourceTurns
          .map((i: number) => dialogue[i])
          .filter(Boolean)
          .slice(0, 3);
  }, [dialogue, safeExercise]);

  const getStatusColor = () => {
      if (!isSubmitted) return 'border-zinc-800';
      return isCorrect() ? 'border-green-500' : 'border-red-500';
  };

  // --- RENDERERS ---

  /**
   * Barra de modo de selección. Antes, una pregunta de respuesta única y otra de
   * respuesta múltiple se veían exactamente igual: el alumno no sabía si podía
   * marcar varias ni que volver a tocar desmarca. Se dice explícitamente, y se
   * lleva la cuenta de lo marcado para que el estado nunca sea una adivinanza.
   */
  const renderSelectionHint = (count: number, isMultiSelect: boolean) => (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 pt-6 font-mono text-[10px] uppercase tracking-widest">
        <span className="flex items-center gap-2 text-zinc-500">
            <MousePointerClick size={12} className="flex-shrink-0" />
            {isMultiSelect
                ? 'Respuesta múltiple · tocá para marcar, tocá otra vez para desmarcar'
                : 'Respuesta única · tocá una opción'}
        </span>
        {isMultiSelect && (
            <span className={count > 0 ? 'text-white' : 'text-zinc-600'}>
                {count} marcada{count === 1 ? '' : 's'}
            </span>
        )}
    </div>
  );

  const renderMultipleChoice = () => {
    const isMultiSelect = Array.isArray(safeExercise.correctAnswer);

    // Auto-detect if "Word Hunt" / "Grid" layout is suitable
    // Criteria: > 4 options AND options are short (likely single words)
    const options = safeExercise.options || [];
    const isGridSuitable = options.length > 4 && options.every((o: any) => o.text.length < 25);

    const toggleSelection = (id: string) => {
        if (isSubmitted) return;
        if (isMultiSelect) {
            setSelectedOptions(prev =>
                prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
            );
        } else {
            setSelectedOptions([id]);
        }
    };

    return (
        <>
            {renderSelectionHint(selectedOptions.length, isMultiSelect)}
            <div className={`p-6 ${isGridSuitable ? 'grid grid-cols-2 sm:grid-cols-3 gap-3' : 'flex flex-col gap-2'}`}>
            {options.map((opt: any) => {
                const isSelected = selectedOptions.includes(opt.id);

                // Determine if this specific option is correct
                let isActuallyCorrect = false;
                if (Array.isArray(safeExercise.correctAnswer)) {
                    isActuallyCorrect = safeExercise.correctAnswer.includes(opt.id);
                } else {
                    isActuallyCorrect = (safeExercise.correctAnswer as string) === opt.id;
                }
                // Clave que el alumno no marcó: ni acierto ni error de marcado.
                const isMissedKey = isSubmitted && isMultiSelect && isActuallyCorrect && !isSelected;

                let containerClass = "relative p-4 border transition-all duration-200 cursor-pointer flex items-center gap-4 group";
                // Adjust styling for Grid mode
                if (isGridSuitable) containerClass = "relative h-24 border transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-2 pt-8 px-3 group text-center";

                // Casilla (múltiple) vs. redondel (única): la forma sola ya dice
                // cuántas respuestas admite el ejercicio.
                let indicatorClass = `w-5 h-5 border flex items-center justify-center transition-all duration-200 flex-shrink-0 ${isMultiSelect ? 'rounded-[2px]' : 'rounded-full'}`;
                let indicatorGlyph: React.ReactNode = null;

                if (isSubmitted) {
                    if (isMissedKey) {
                        containerClass += " border-amber-500 bg-amber-500/10";
                        indicatorClass += " border-amber-500 text-amber-500";
                    } else if (isActuallyCorrect) {
                        containerClass += " border-green-500 bg-green-500/10";
                        indicatorClass += " border-green-500 bg-green-500 text-black";
                        indicatorGlyph = <Check size={12} strokeWidth={3} />;
                    } else if (isSelected) {
                        // Selected but wrong
                        containerClass += " border-red-500 bg-red-500/10";
                        indicatorClass += " border-red-500 bg-red-500 text-white";
                        indicatorGlyph = <X size={12} strokeWidth={3} />;
                    } else {
                        // Not selected, not correct
                        containerClass += " border-zinc-800 opacity-50";
                        indicatorClass += " border-zinc-600";
                    }
                } else {
                    if (isSelected) {
                        containerClass += " border-white bg-white";
                        indicatorClass += " border-black bg-black text-white";
                        // Marca visible dentro de la casilla: el estado no depende
                        // de recordar que la tarjeta invertida significa "elegida".
                        indicatorGlyph = isMultiSelect
                            ? <Check size={12} strokeWidth={3} />
                            : <span className="w-2 h-2 rounded-full bg-white" />;
                    } else {
                        containerClass += " border-zinc-800 hover:border-zinc-500 bg-zinc-900/50";
                        indicatorClass += " border-zinc-600 group-hover:border-zinc-400";
                    }
                }

                return (
                    <button
                        key={opt.id}
                        onClick={() => toggleSelection(opt.id)}
                        disabled={isSubmitted}
                        role={isMultiSelect ? 'checkbox' : 'radio'}
                        aria-checked={isSelected}
                        className={containerClass}
                    >
                        {/* La casilla se muestra en las dos disposiciones: en la
                            rejilla era el único formato sin indicador propio. */}
                        <div className={isGridSuitable ? 'absolute top-2 left-2' : ''}>
                            <div className={indicatorClass}>{indicatorGlyph}</div>
                        </div>

                        <span className={`text-sm font-sans leading-snug ${isSelected && !isSubmitted ? 'text-black font-medium' : 'text-zinc-300'} ${isGridSuitable ? 'font-display uppercase tracking-wider font-bold text-base' : 'text-left'}`}>
                            {opt.text}
                        </span>

                        {/* Estado en la rejilla: se marca también lo que se dejó pasar. */}
                        {isGridSuitable && isSubmitted && (
                            <div className="absolute top-2 right-2">
                                {isMissedKey
                                    ? <AlertCircle size={14} className="text-amber-500" />
                                    : isActuallyCorrect
                                        ? <Check size={14} className="text-green-500" />
                                        : isSelected && <X size={14} className="text-red-500" />}
                            </div>
                        )}

                        {!isGridSuitable && isMissedKey && (
                            <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-amber-500 flex-shrink-0">
                                se te pasó
                            </span>
                        )}
                    </button>
                );
            })}
            </div>
            {isSubmitted && isMultiSelect && (
                <p className="px-6 pb-6 -mt-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    <span className="text-green-500">verde</span> = la marcaste y va ·{' '}
                    <span className="text-amber-500">ámbar</span> = va y no la marcaste ·{' '}
                    <span className="text-red-500">roja</span> = la marcaste y no va
                </p>
            )}
        </>
    );
  };

  const renderTable = (columns: {id: string, text: string}[]) => {
      const rows = safeExercise.rows || [];
      const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};

      return (
          <div className="overflow-x-auto p-6">
              <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                      <tr>
                          <th className="pb-4 border-b border-zinc-800 font-mono text-[10px] uppercase text-zinc-500 w-1/3">Ítem</th>
                          {columns.map(col => (
                              <th key={col.id} className="pb-4 border-b border-zinc-800 font-mono text-[10px] uppercase text-zinc-500 text-center px-2">
                                  {col.text}
                              </th>
                          ))}
                      </tr>
                  </thead>
                  <tbody>
                      {rows.map((row: any) => (
                          <tr key={row.id} className="group hover:bg-zinc-900/30 transition-colors">
                              <td className="py-4 pr-4 font-sans text-sm text-zinc-300 border-b border-zinc-800/50">{row.text}</td>
                              {columns.map(col => {
                                  const isSelected = answersMap[row.id] === col.id;
                                  const isCorrectCell = isSubmitted && correctMap[row.id] === col.id;
                                  const isWrongSelection = isSubmitted && isSelected && correctMap[row.id] !== col.id;

                                  // Anillo bien visible incluso sin marcar: un gris demasiado
                                  // oscuro dejaba la casilla marcada y la vacía indistinguibles.
                                  let ringClass = "border-zinc-600";
                                  let dotClass = "bg-transparent scale-0";
                                  let cellClass = "";

                                  if (isSubmitted) {
                                      if (isCorrectCell) {
                                          ringClass = "border-green-500 bg-green-500/20";
                                          dotClass = "bg-green-500 scale-100";
                                      } else if (isWrongSelection) {
                                          ringClass = "border-red-500 bg-red-500/20";
                                          dotClass = "bg-red-500 scale-100";
                                      } else if (isSelected) {
                                          ringClass = "border-zinc-700 opacity-50";
                                      }
                                  } else if (isSelected) {
                                      // Marca fuerte: el círculo se rellena de blanco (no solo el
                                      // borde) y además se tiñe toda la celda, para que la opción
                                      // marcada no dependa de distinguir un anillo de 20px.
                                      ringClass = "border-white bg-white border-2";
                                      dotClass = "bg-black scale-100";
                                      cellClass = "bg-white/[0.06]";
                                  }

                                  return (
                                      <td key={col.id} className={`py-4 px-2 text-center border-b border-zinc-800/50 cursor-pointer transition-colors duration-200 ${cellClass}`} onClick={() => !isSubmitted && setAnswersMap(prev => ({...prev, [row.id]: col.id}))}>
                                          <div className={`w-6 h-6 mx-auto border rounded-full flex items-center justify-center transition-all duration-200 ${ringClass} ${!isSubmitted && !isSelected && 'group-hover:border-zinc-400'}`}>
                                              <div className={`w-2.5 h-2.5 rounded-full transition-transform duration-200 ${dotClass}`}></div>
                                          </div>
                                      </td>
                                  )
                              })}
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      );
  };

  const renderTrueFalse = () => {
      // PREFERRED: Matrix Mode (Rows defined)
      if (safeExercise.rows && safeExercise.rows.length > 0) {
          const tfColumns = [{id: 'true', text: 'VERDADERO'}, {id: 'false', text: 'FALSO'}];
          return renderTable(tfColumns);
      }

      // FALLBACK: Simple Mode (No rows)
      // FIX: If there are no rows, the 'question' often contains the statement. 
      // We must render the question/statement prominently INSIDE the card body 
      // because the header might just be an instruction ("Answer True/False").
      return (
        <div className="flex flex-col gap-6 p-6">
            <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-2">Afirmación a evaluar:</span>
                <p className="font-sans text-lg md:text-xl text-white font-medium leading-relaxed">
                    {safeExercise.question || "Error: Falta el enunciado."}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                {[{id:'true', text:'Verdadero'}, {id:'false', text:'Falso'}].map((opt) => {
                    const isSelected = selectedOptions.includes(opt.id);
                    const correctStr = safeExercise.correctAnswer as string;
                    const isCorrectBtn = isSubmitted && correctStr.toLowerCase() === opt.id;
                    const isWrongSelection = isSubmitted && isSelected && !isCorrectBtn;

                    let btnClass = "h-32 border flex flex-col items-center justify-center gap-2 transition-all duration-200";
                    
                    if (isSubmitted) {
                        if (isCorrectBtn) {
                            btnClass += " bg-green-500/10 border-green-500 text-green-500";
                        } else if (isWrongSelection) {
                            btnClass += " bg-red-500/10 border-red-500 text-red-500";
                        } else {
                            btnClass += " bg-zinc-950 border-zinc-800 opacity-30";
                        }
                    } else if (isSelected) {
                        btnClass += " bg-white border-white text-black scale-[1.02] shadow-xl shadow-white/10";
                    } else {
                        btnClass += " bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:border-zinc-600";
                    }

                    return (
                        <button key={opt.id} onClick={() => !isSubmitted && setSelectedOptions([opt.id])} disabled={isSubmitted} className={btnClass}>
                            <span className="font-display text-xl uppercase font-bold tracking-widest">{opt.text}</span>
                            {isSubmitted && isCorrectBtn && <Check size={20} />}
                            {isSubmitted && isWrongSelection && <X size={20} />}
                        </button>
                    )
                })}
            </div>
        </div>
      );
  };

  const renderOrdering = () => {
    if (!orderedList || orderedList.length === 0) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-zinc-500 border-b border-zinc-800">
                <AlertCircle size={32} className="mb-2" />
                <p className="font-mono text-xs uppercase">Error de datos: No hay elementos para ordenar</p>
            </div>
        );
    }

    const moveItem = (fromIndex: number, direction: 'up' | 'down') => {
        if (isSubmitted) return;
        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= orderedList.length) return;
        const newList = [...orderedList];
        [newList[fromIndex], newList[toIndex]] = [newList[toIndex], newList[fromIndex]];
        setOrderedList(newList);
    };

    return (
        <div className="flex flex-col gap-3 p-6 bg-zinc-950/50">
            {orderedList.map((itemId, idx) => {
                const item = safeExercise.options?.find((o: any) => o.id === itemId);
                if (!item) return null;
                const correctOrder = safeExercise.correctAnswer as string[];
                const isCorrectPosition = isSubmitted && correctOrder && correctOrder[idx] === itemId;
                
                // Style calculation
                let borderClass = "border-zinc-800";
                let bgClass = "bg-black";
                let textClass = "text-zinc-300";

                if (isSubmitted) {
                    if (isCorrectPosition) {
                        borderClass = "border-green-500";
                        bgClass = "bg-green-500/5";
                        textClass = "text-green-500";
                    } else {
                        borderClass = "border-red-500";
                        bgClass = "bg-red-500/5";
                        textClass = "text-red-500";
                    }
                } else {
                    // Hover effect only when not submitted
                    bgClass = "bg-black hover:bg-zinc-900";
                }

                return (
                    <div key={itemId} className={`relative flex items-center gap-4 p-4 border ${borderClass} ${bgClass} transition-all duration-200 group`}>
                        {/* Index */}
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-500">
                            {idx + 1}
                        </div>

                        {/* Text */}
                        <div className={`flex-1 font-sans text-sm leading-relaxed ${textClass}`}>
                            {item.text}
                        </div>

                        {/* Controls */}
                        {!isSubmitted && (
                            <div className="flex flex-col gap-1 opacity-100 sm:opacity-50 sm:group-hover:opacity-100 transition-opacity">
                                <button 
                                    onClick={() => moveItem(idx, 'up')} 
                                    disabled={idx === 0} 
                                    className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-white disabled:opacity-0 transition-colors rounded"
                                >
                                    <ArrowUp size={16} />
                                </button>
                                <button 
                                    onClick={() => moveItem(idx, 'down')} 
                                    disabled={idx === orderedList.length - 1} 
                                    className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-white disabled:opacity-0 transition-colors rounded"
                                >
                                    <ArrowDown size={16} />
                                </button>
                            </div>
                        )}
                        {/* Result Icon */}
                        {isSubmitted && (
                            <div className="flex-shrink-0">
                                {isCorrectPosition ? <Check className="text-green-500" size={18} /> : <X className="text-red-500" size={18} />}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
  };

  const renderCloze = () => {
    // Regex now supports alphanumeric keys like {{gap1}} or {{1}}
    const parts = safeExercise.textWithGaps?.split(/(\{\{[\w\d]+\}\})/) || [];
    const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};

    return (
        <div className="p-8 bg-zinc-950 font-serif text-lg leading-loose text-zinc-300 text-justify">
            {parts.map((part: string, i: number) => {
                const match = part.match(/\{\{([\w\d]+)\}\}/);
                if (match) {
                    const gapId = match[1];
                    const options = safeExercise.gapOptions?.[gapId] || [];
                    const selected = answersMap[gapId] || "";
                    const isCorrect = isSubmitted && correctMap[gapId] === selected;
                    
                    let selectClass = "mx-1 py-0.5 px-2 text-base font-sans font-bold cursor-pointer outline-none border-b-2 bg-transparent transition-all appearance-none rounded-none";
                    
                    if (isSubmitted) {
                        if (isCorrect) {
                            selectClass += " border-green-500 text-green-500 bg-green-500/10";
                        } else {
                            selectClass += " border-red-500 text-red-500 bg-red-500/10";
                        }
                    } else {
                        if (selected) {
                            selectClass += " border-white text-white bg-zinc-900";
                        } else {
                            selectClass += " border-zinc-600 text-zinc-500 hover:border-zinc-400 hover:text-zinc-300";
                        }
                    }

                    return (
                        <span key={i} className="relative inline-block">
                             <select
                                value={selected}
                                onChange={(e) => setAnswersMap(prev => ({...prev, [gapId]: e.target.value}))}
                                disabled={isSubmitted}
                                className={selectClass}
                            >
                                <option value="" disabled className="text-zinc-700">___</option>
                                {options.map((o: any) => (
                                    <option key={o.id} value={o.id} className="bg-black text-white py-2">{o.text}</option>
                                ))}
                            </select>
                        </span>
                    );
                }
                return <span key={i}>{part}</span>;
            })}
        </div>
    );
  };

  /**
   * FICHA DE DATOS y PARES MÍNIMOS comparten estructura (campo → opción) pero se
   * presentan distinto: la ficha imita un formulario real de la situación; los
   * pares mínimos son una rejilla de contrastes para elegir al vuelo.
   */
  const renderFields = () => {
    const fields = safeExercise.fields || [];
    const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};
    const isForm = safeExercise.type === 'data_capture';

    if (fields.length === 0) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-zinc-500">
                <AlertCircle size={32} className="mb-2" />
                <p className="font-mono text-xs uppercase">Error de datos: no hay campos</p>
            </div>
        );
    }

    return (
        <div className={`p-6 gap-4 ${isForm ? 'flex flex-col' : 'grid grid-cols-1 sm:grid-cols-2 gap-4'}`}>
            {fields.map((field: any) => {
                const selected = answersMap[field.id] || '';
                const correctId = correctMap[field.id];
                const isFieldCorrect = isSubmitted && selected === correctId;

                let frameClass = 'border-zinc-800 bg-zinc-900/40';
                if (isSubmitted) {
                    frameClass = isFieldCorrect
                        ? 'border-green-500 bg-green-500/5'
                        : 'border-red-500 bg-red-500/5';
                }

                return (
                    <div key={field.id} className={`border ${frameClass} p-4 transition-colors duration-300`}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                                {field.label}
                            </span>
                            {isSubmitted && (
                                isFieldCorrect
                                    ? <Check size={14} className="text-green-500" />
                                    : <X size={14} className="text-red-500" />
                            )}
                        </div>

                        <div className={isForm ? '' : 'grid grid-cols-2 gap-2'}>
                            {isForm ? (
                                <select
                                    value={selected}
                                    onChange={(e) => setAnswersMap(prev => ({ ...prev, [field.id]: e.target.value }))}
                                    disabled={isSubmitted}
                                    className="w-full bg-black border border-zinc-700 text-white font-mono text-base px-3 py-2 outline-none focus:border-white disabled:opacity-70"
                                >
                                    <option value="" disabled>— elegí —</option>
                                    {field.options.map((o: any) => (
                                        <option key={o.id} value={o.id} className="bg-black">{o.text}</option>
                                    ))}
                                </select>
                            ) : (
                                field.options.map((o: any) => {
                                    const isSelected = selected === o.id;
                                    const isKey = isSubmitted && correctId === o.id;
                                    let btnClass = 'py-3 px-2 border font-sans text-sm transition-all duration-200';
                                    if (isSubmitted) {
                                        if (isKey) btnClass += ' border-green-500 bg-green-500/10 text-green-400';
                                        else if (isSelected) btnClass += ' border-red-500 bg-red-500/10 text-red-400';
                                        else btnClass += ' border-zinc-800 text-zinc-600 opacity-50';
                                    } else if (isSelected) {
                                        btnClass += ' border-white bg-white text-black font-medium';
                                    } else {
                                        btnClass += ' border-zinc-700 text-zinc-300 hover:border-zinc-400';
                                    }
                                    return (
                                        <button
                                            key={o.id}
                                            onClick={() => !isSubmitted && setAnswersMap(prev => ({ ...prev, [field.id]: o.id }))}
                                            disabled={isSubmitted}
                                            className={btnClass}
                                        >
                                            {o.text}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
  };

  /**
   * RECONSTRUIR EL DATO. Comparte estructura con la ficha (campo → opción) pero
   * no se puede presentar como ella: la ficha apila desplegables a ancho
   * completo, y un teléfono de nueve piezas serían nueve filas donde se pierde
   * por completo que son UN dato. Aquí van en línea, en el orden en que suenan,
   * con las piezas fijas ("con", "arroba") intercaladas como texto.
   */
  const renderDictation = () => {
    const fields = safeExercise.fields || [];
    const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};
    const separators: string[] = Array.isArray(safeExercise.separators) ? safeExercise.separators : [];

    if (fields.length === 0) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-zinc-500">
                <AlertCircle size={32} className="mb-2" />
                <p className="font-mono text-xs uppercase">Error de datos: no hay posiciones</p>
            </div>
        );
    }

    const solution = fields
        .map((f: any) => (f.options.find((o: any) => o.id === correctMap[f.id]) || {}).text || '?')
        .reduce((acc: string, text: string, i: number) => {
            const glue = i > 0 && separators[i - 1] ? ` ${separators[i - 1]} ` : i > 0 ? ' ' : '';
            return `${acc}${glue}${text}`;
        }, '');

    return (
        <div className="p-6">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-4">
                {fields.map((field: any, i: number) => {
                    const selected = answersMap[field.id] || '';
                    const correctId = correctMap[field.id];
                    const isFieldCorrect = isSubmitted && selected === correctId;

                    let boxClass = 'border-zinc-700 bg-black text-white';
                    if (isSubmitted) {
                        boxClass = isFieldCorrect
                            ? 'border-green-500 bg-green-500/10 text-green-400'
                            : 'border-red-500 bg-red-500/10 text-red-400';
                    }

                    return (
                        <React.Fragment key={field.id}>
                            {i > 0 && separators[i - 1] && (
                                <span className="font-mono text-sm text-zinc-500 pb-2 select-none">
                                    {separators[i - 1]}
                                </span>
                            )}
                            <div className="flex flex-col gap-1">
                                <span className="font-mono text-[10px] text-zinc-600 tracking-widest">
                                    {field.label}
                                </span>
                                <select
                                    value={selected}
                                    onChange={(e) => setAnswersMap(prev => ({ ...prev, [field.id]: e.target.value }))}
                                    disabled={isSubmitted}
                                    aria-label={`Posición ${field.label}`}
                                    className={`border ${boxClass} font-mono text-base px-2 py-2 outline-none focus:border-white disabled:opacity-80 transition-colors duration-300`}
                                >
                                    <option value="" disabled>—</option>
                                    {field.options.map((o: any) => (
                                        <option key={o.id} value={o.id} className="bg-black text-white">{o.text}</option>
                                    ))}
                                </select>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {isSubmitted && (
                <div className="mt-6 border-t border-zinc-800 pt-4">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                        Se dictó
                    </p>
                    <p className="font-mono text-lg text-white break-words">{solution}</p>
                </div>
            )}
        </div>
    );
  };

  /**
   * EMPAREJAR. La biyección se impone en la propia interfaz: una opción ya usada
   * queda deshabilitada en las demás filas. Así se evita la matriz de radios de
   * N×N, que para 4 problemas y 4 soluciones era ilegible.
   */
  const renderMatching = () => {
    const rows = safeExercise.rows || [];
    const columns = safeExercise.columns || [];
    const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};
    // Qué fila reclamó cada opción, para deshabilitarla en el resto y forzar
    // que el emparejamiento sea biyectivo.
    const takenBy = new Map<string, string>();
    Object.keys(answersMap).forEach(rowId => takenBy.set(answersMap[rowId], rowId));

    return (
        <div className="p-6 flex flex-col gap-3">
            {rows.map((row: any) => {
                const selected = answersMap[row.id] || '';
                const isRowCorrect = isSubmitted && selected === correctMap[row.id];

                let frameClass = 'border-zinc-800';
                if (isSubmitted) frameClass = isRowCorrect ? 'border-green-500' : 'border-red-500';

                return (
                    <div key={row.id} className={`border ${frameClass} bg-zinc-900/30 p-4 flex flex-col md:flex-row md:items-center gap-3 transition-colors duration-300`}>
                        <p className="flex-1 font-sans text-sm text-zinc-200 leading-relaxed">{row.text}</p>

                        <div className="flex items-center gap-2 md:w-1/2">
                            <span className="font-mono text-zinc-600 hidden md:inline">→</span>
                            <select
                                value={selected}
                                onChange={(e) => setAnswersMap(prev => ({ ...prev, [row.id]: e.target.value }))}
                                disabled={isSubmitted}
                                className="flex-1 bg-black border border-zinc-700 text-white font-sans text-sm px-3 py-2 outline-none focus:border-white disabled:opacity-70"
                            >
                                <option value="" disabled>— emparejá —</option>
                                {columns.map((col: any) => {
                                    const owner = takenBy.get(col.id);
                                    return (
                                        <option
                                            key={col.id}
                                            value={col.id}
                                            disabled={!!owner && owner !== row.id}
                                            className="bg-black"
                                        >
                                            {col.text}
                                        </option>
                                    );
                                })}
                            </select>
                            {isSubmitted && (
                                isRowCorrect
                                    ? <Check size={16} className="text-green-500 flex-shrink-0" />
                                    : <X size={16} className="text-red-500 flex-shrink-0" />
                            )}
                        </div>

                        {isSubmitted && !isRowCorrect && (
                            <span className="font-mono text-[10px] uppercase text-zinc-500 md:w-40">
                                era: {columns.find((c: any) => c.id === correctMap[row.id])?.text}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
  };

  /**
   * TERMÓMETRO. Las columnas son puntos ordenados de un mismo eje, así que se
   * dibujan como una escala continua y no como categorías sueltas.
   */
  const renderScale = () => {
    const rows = safeExercise.rows || [];
    const points = safeExercise.columns || [];
    const correctMap = (safeExercise.correctAnswer as Record<string, string>) || {};

    return (
        <div className="p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                <span>{points[0]?.text}</span>
                <div className="flex-1 h-px bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-700 mx-2" />
                <span className="text-right">{points[points.length - 1]?.text}</span>
            </div>

            {rows.map((row: any) => {
                const selected = answersMap[row.id];
                const correctId = correctMap[row.id];
                const isRowCorrect = isSubmitted && selected === correctId;
                const distance = isSubmitted && selected
                    ? Math.abs(points.findIndex((p: any) => p.id === selected) - points.findIndex((p: any) => p.id === correctId))
                    : 0;

                return (
                    <div key={row.id} className="flex flex-col gap-2">
                        <p className="font-serif text-base text-zinc-200 italic">“{row.text}”</p>
                        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
                            {points.map((point: any) => {
                                const isSelected = selected === point.id;
                                const isKey = isSubmitted && correctId === point.id;
                                let cellClass = 'py-3 px-1 border text-center font-sans text-[11px] leading-tight transition-all duration-200';
                                if (isSubmitted) {
                                    if (isKey) cellClass += ' border-green-500 bg-green-500/15 text-green-400';
                                    else if (isSelected) cellClass += ' border-red-500 bg-red-500/10 text-red-400';
                                    else cellClass += ' border-zinc-800 text-zinc-600';
                                } else if (isSelected) {
                                    cellClass += ' border-white bg-white text-black font-medium';
                                } else {
                                    cellClass += ' border-zinc-800 text-zinc-400 hover:border-zinc-500';
                                }
                                return (
                                    <button
                                        key={point.id}
                                        onClick={() => !isSubmitted && setAnswersMap(prev => ({ ...prev, [row.id]: point.id }))}
                                        disabled={isSubmitted}
                                        className={cellClass}
                                    >
                                        {point.text}
                                    </button>
                                );
                            })}
                        </div>
                        {isSubmitted && !isRowCorrect && distance === 1 && (
                            <span className="font-mono text-[10px] uppercase text-amber-500">
                                casi: te quedaste a un punto del matiz exacto
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
  };

  /**
   * CAZA EL CAMBIO. Dictado sin escribir: se muestra el fragmento con algunas
   * palabras sustituidas y el alumno marca las que no oyó.
   */
  const renderSpotTheDifference = () => {
    const tokens = safeExercise.tokens || [];
    const altered: string[] = Array.isArray(safeExercise.correctAnswer)
        ? (safeExercise.correctAnswer as string[])
        : [];

    if (tokens.length === 0) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-zinc-500">
                <AlertCircle size={32} className="mb-2" />
                <p className="font-mono text-xs uppercase">Error de datos: no hay fragmento</p>
            </div>
        );
    }

    return (
        <div className="p-8 bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-4 font-mono text-[10px] uppercase tracking-widest">
                <span className="flex items-center gap-2 text-zinc-500">
                    <MousePointerClick size={12} className="flex-shrink-0" />
                    Tocá las palabras que no se dicen · tocá otra vez para desmarcar
                </span>
                <span className={selectedOptions.length > 0 ? 'text-white' : 'text-zinc-600'}>
                    {selectedOptions.length} marcada{selectedOptions.length === 1 ? '' : 's'}
                </span>
            </div>
            <div className="flex flex-wrap gap-x-1 gap-y-2 font-serif text-lg leading-loose">
                {tokens.map((token: any) => {
                    const isSelected = selectedOptions.includes(token.id);
                    const isAltered = altered.includes(token.id);

                    let tokenClass = 'px-1 py-0.5 border-b-2 transition-all duration-150 cursor-pointer';
                    if (isSubmitted) {
                        if (isAltered && isSelected) tokenClass += ' border-green-500 text-green-400 bg-green-500/10';
                        else if (isAltered) tokenClass += ' border-amber-500 text-amber-400 bg-amber-500/10';
                        else if (isSelected) tokenClass += ' border-red-500 text-red-400 bg-red-500/10 line-through';
                        else tokenClass += ' border-transparent text-zinc-500';
                    } else if (isSelected) {
                        // Inversión completa: en un párrafo corrido, un fondo al 10%
                        // no se distinguía de una palabra sin marcar.
                        tokenClass += ' border-white bg-white text-black font-medium';
                    } else {
                        tokenClass += ' border-transparent text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/60';
                    }

                    return (
                        <button
                            key={token.id}
                            onClick={() => {
                                if (isSubmitted) return;
                                setSelectedOptions(prev =>
                                    prev.includes(token.id) ? prev.filter(x => x !== token.id) : [...prev, token.id]
                                );
                            }}
                            disabled={isSubmitted}
                            role="checkbox"
                            aria-checked={isSelected}
                            className={tokenClass}
                        >
                            {token.text}
                        </button>
                    );
                })}
            </div>
            {isSubmitted && (
                <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    <span className="text-green-500">verde</span> = la cazaste ·{' '}
                    <span className="text-amber-500">ámbar</span> = cambiada y se te pasó ·{' '}
                    <span className="text-red-500">roja</span> = sí se dice
                </p>
            )}
        </div>
    );
  };

  // --- MAIN RENDER ---

  const renderContent = () => {
      switch(safeExercise.type) {
          case 'multiple_choice': return renderMultipleChoice();
          case 'true_false': return renderTrueFalse();
          case 'true_false_notgiven': return renderTable(safeExercise.columns || []);
          case 'classification': return renderTable(safeExercise.columns || []);
          case 'matching': return renderMatching();
          case 'scale': return renderScale();
          case 'ordering':
          case 'chunk_order': return renderOrdering();
          case 'cloze': return renderCloze();
          case 'data_capture':
          case 'minimal_pairs': return renderFields();
          case 'dictation': return renderDictation();
          case 'spot_the_difference': return renderSpotTheDifference();
          default: return <div className="p-4 text-red-500 border border-red-900 bg-red-950/10 font-mono text-xs">ERR_UNKNOWN_TYPE: {safeExercise.type}</div>;
      }
  };

  return (
    <div className={`mb-16 relative pl-6 md:pl-0`}>
      {/* Decorative timeline line */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${getStatusColor()} transition-colors duration-500 hidden md:block`}></div>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${getStatusColor()} transition-colors duration-500 md:hidden`}></div>

      {/* Header */}
      <div className="mb-6 md:ml-8">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest px-2 py-0.5 border border-zinc-800 bg-zinc-900/50">
                0{index + 1}
            </span>
            {/* Se nombra la habilidad que se entrena, no el widget: es lo que le
                permite al alumno saber qué está practicando. */}
            {safeExercise.skill && SKILL_LABELS[safeExercise.skill] && (
                <span className="font-mono text-[10px] text-white uppercase tracking-widest px-2 py-0.5 border border-zinc-700">
                    {SKILL_LABELS[safeExercise.skill]}
                </span>
            )}
            <span className="font-mono text-[10px] text-zinc-600 uppercase">
                // {FORMAT_LABELS[safeExercise.type] || safeExercise.type.replace(/_/g, ' ')}
            </span>
        </div>
        <h3 className="font-display font-medium text-xl md:text-2xl uppercase leading-tight text-white max-w-4xl">
            {safeExercise.question}
        </h3>
      </div>

      {/* Body */}
      <div className="border border-zinc-800 bg-black md:ml-8 transition-shadow duration-300 hover:shadow-[0_0_30px_-5px_rgba(255,255,255,0.05)]">
        {renderContent()}
        
        {/* Footer / Actions */}
        <div className="border-t border-zinc-800">
            {!isSubmitted ? (
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit()}
                    className="w-full py-4 bg-zinc-900 hover:bg-white text-zinc-400 hover:text-black font-mono text-xs uppercase tracking-widest transition-all disabled:opacity-50 disabled:hover:bg-zinc-900 disabled:hover:text-zinc-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                >
                    Confirmar Respuesta
                    <ArrowDown size={14} className="group-hover:translate-y-1 transition-transform" />
                </button>
            ) : (
                <div className="bg-zinc-950/80 p-6 animate-in fade-in slide-in-from-top-2 duration-300">
                     {safeExercise.explanation ? (
                         <div className="flex gap-5 items-start">
                            <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isCorrect() ? 'bg-green-500 text-black' : 'bg-red-500 text-white'}`}>
                                {isCorrect() ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
                            </div>
                            <div className="space-y-2 flex-1">
                                <div className="flex items-baseline justify-between">
                                    <span className={`text-[10px] font-mono uppercase tracking-widest font-bold ${isCorrect() ? 'text-green-500' : 'text-red-500'}`}>
                                        {isCorrect() ? 'Correcto' : 'Incorrecto'}
                                    </span>
                                </div>
                                <p className="text-zinc-300 text-sm font-sans leading-relaxed border-l-2 border-zinc-800 pl-4">
                                    {safeExercise.explanation}
                                </p>
                                {sourceLines.length > 0 && (
                                    <div className="pt-3 space-y-2">
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                                            <Quote size={11} /> En el audio
                                        </span>
                                        {sourceLines.map((line, i) => (
                                            <p key={i} className="font-serif text-sm text-zinc-400 italic border-l-2 border-zinc-700 pl-4">
                                                <span className="not-italic font-mono text-[10px] uppercase text-zinc-600 mr-2">
                                                    {line.speaker}
                                                </span>
                                                {line.text}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center font-mono text-xs text-zinc-500">Evaluación registrada.</div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ExerciseCard;