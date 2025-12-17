import React, { useState, useEffect, useMemo } from 'react';
import { Exercise } from '../types';
import { Check, X, ArrowUp, ArrowDown, GripVertical, AlertCircle } from 'lucide-react';

interface ExerciseCardProps {
  exercise: Exercise;
  index: number;
}

const ExerciseCard: React.FC<ExerciseCardProps> = ({ exercise, index }) => {
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
    if (safeExercise.type === 'ordering') {
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

  const isCorrect = () => {
      switch (safeExercise.type) {
          case 'classification':
          case 'cloze':
              return isAnswerMapCorrect();
          case 'true_false':
              return safeExercise.rows ? isAnswerMapCorrect() : isSelectionCorrect();
          case 'ordering':
              return isOrderingCorrect();
          case 'multiple_choice':
              return isSelectionCorrect();
          default:
              return false;
      }
  };

  const canSubmit = () => {
      if (isSubmitted) return false;
      switch (safeExercise.type) {
          case 'multiple_choice':
              return selectedOptions.length > 0;
          case 'ordering':
              return orderedList.length > 0; 
          case 'true_false':
              if (safeExercise.rows) return Object.keys(answersMap).length === safeExercise.rows.length;
              return selectedOptions.length > 0;
          case 'classification':
               return Object.keys(answersMap).length === (safeExercise.rows?.length || 0);
          case 'cloze':
               return Object.keys(answersMap).length === Object.keys(safeExercise.gapOptions || {}).length;
          default:
              return false;
      }
  };

  const getStatusColor = () => {
      if (!isSubmitted) return 'border-zinc-800';
      return isCorrect() ? 'border-green-500' : 'border-red-500';
  };

  // --- RENDERERS ---

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

                let containerClass = "relative p-4 border transition-all duration-200 cursor-pointer flex items-center gap-4 group";
                // Adjust styling for Grid mode
                if (isGridSuitable) containerClass = "relative h-24 border transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-2 group text-center";

                let indicatorClass = "w-5 h-5 border flex items-center justify-center transition-all duration-200 flex-shrink-0";

                if (isSubmitted) {
                    if (isActuallyCorrect) {
                        containerClass += " border-green-500 bg-green-500/10";
                        indicatorClass += " border-green-500 bg-green-500 text-black";
                    } else if (isSelected) {
                        // Selected but wrong
                        containerClass += " border-red-500 bg-red-500/10";
                        indicatorClass += " border-red-500 bg-red-500 text-white";
                    } else {
                        // Not selected, not correct
                        containerClass += " border-zinc-800 opacity-50";
                        indicatorClass += " border-zinc-600";
                    }
                } else {
                    if (isSelected) {
                        containerClass += " border-white bg-white";
                        indicatorClass += " border-black bg-black";
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
                        className={containerClass}
                    >
                        {/* Only show circle indicator in list mode, grid mode uses whole card state mostly */}
                        {!isGridSuitable && (
                            <div className={indicatorClass}>
                                {isSubmitted && isActuallyCorrect && <Check size={12} />}
                                {isSubmitted && isSelected && !isActuallyCorrect && <X size={12} />}
                            </div>
                        )}
                        
                        <span className={`text-sm font-sans leading-snug ${isSelected && !isSubmitted ? 'text-black font-medium' : 'text-zinc-300'} ${isGridSuitable ? 'font-display uppercase tracking-wider font-bold text-base' : 'text-left'}`}>
                            {opt.text}
                        </span>

                        {/* Grid Mode Icons */}
                        {isGridSuitable && isSubmitted && (
                            <div className="absolute top-2 right-2">
                                {isActuallyCorrect && <Check size={14} className="text-green-500" />}
                                {isSelected && !isActuallyCorrect && <X size={14} className="text-red-500" />}
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
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

                                  let ringClass = "border-zinc-700";
                                  let dotClass = "bg-transparent scale-0";

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
                                      ringClass = "border-white bg-white";
                                      dotClass = "bg-black scale-100";
                                  }

                                  return (
                                      <td key={col.id} className="py-4 px-2 text-center border-b border-zinc-800/50 cursor-pointer" onClick={() => !isSubmitted && setAnswersMap(prev => ({...prev, [row.id]: col.id}))}>
                                          <div className={`w-5 h-5 mx-auto border rounded-full flex items-center justify-center transition-all duration-200 ${ringClass} ${!isSubmitted && !isSelected && 'group-hover:border-zinc-500'}`}>
                                              <div className={`w-2 h-2 rounded-full transition-transform duration-200 ${dotClass}`}></div>
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

  // --- MAIN RENDER ---
  
  const renderContent = () => {
      switch(safeExercise.type) {
          case 'multiple_choice': return renderMultipleChoice();
          case 'true_false': return renderTrueFalse();
          case 'classification': return renderTable(safeExercise.columns || []);
          case 'ordering': return renderOrdering();
          case 'cloze': return renderCloze();
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
        <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest px-2 py-0.5 border border-zinc-800 bg-zinc-900/50">
                0{index + 1}
            </span>
            <span className="font-mono text-[10px] text-zinc-600 uppercase">
                // {safeExercise.type.replace('_', ' ')}
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