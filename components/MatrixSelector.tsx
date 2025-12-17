import React from 'react';
import { Terminal, Dices, ChevronDown } from 'lucide-react';
import { ScenarioContext, ScenarioAction } from '../data/scenarios';

interface MatrixSelectorProps {
    contexts: ScenarioContext[];
    selectedLocus: ScenarioContext;
    onSelectLocus: (locus: ScenarioContext) => void;
    
    selectedModus: ScenarioAction;
    onSelectModus: (modus: ScenarioAction) => void;
    
    isCustomMode: boolean;
    toggleCustomMode: () => void;
    
    customTopicInput: string;
    setCustomTopicInput: (val: string) => void;
    
    onRandomize: () => void;
}

const MatrixSelector: React.FC<MatrixSelectorProps> = ({
    contexts,
    selectedLocus,
    onSelectLocus,
    selectedModus,
    onSelectModus,
    isCustomMode,
    toggleCustomMode,
    customTopicInput,
    setCustomTopicInput,
    onRandomize
}) => {
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="flex justify-between items-end mb-2">
              <div className="flex items-center gap-2">
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 group-hover:text-white transition-colors">
                      2. CONFIGURACIÓN DE ESCENA
                  </label>
              </div>

              <div className="flex gap-2">
                   <button 
                      onClick={toggleCustomMode}
                      className={`flex items-center gap-1 text-[10px] font-mono uppercase transition-colors border px-2 py-1 ${isCustomMode ? 'text-white border-white bg-white/10' : 'text-zinc-500 border-zinc-800 hover:text-white'}`}
                  >
                      <Terminal size={10} />
                      <span>Custom</span>
                  </button>
                  <button 
                      onClick={onRandomize}
                      className="flex items-center gap-1 text-[10px] font-mono uppercase text-zinc-500 hover:text-white transition-colors border border-zinc-800 hover:border-white px-2 py-1"
                      title="Generar combinación aleatoria"
                  >
                      <Dices size={10} />
                      <span>Azar</span>
                  </button>
              </div>
            </div>

            {!isCustomMode ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* LOCUS SELECTOR (Parent) */}
                    <div className="relative group/locus">
                        <div className="absolute -top-2 left-0 text-[8px] font-mono text-zinc-600 uppercase tracking-wider opacity-70">
                          ESCENARIO
                        </div>
                        
                        {/* ICON OVERLAY */}
                        <div className="absolute left-0 top-3 pointer-events-none text-zinc-400 group-hover/locus:text-white transition-colors">
                            {React.createElement(selectedLocus.icon, { size: 18, strokeWidth: 1.5 })}
                        </div>

                        <select 
                            className="w-full bg-zinc-900/30 border-b border-zinc-800 py-3 pl-7 pr-8 font-display text-lg uppercase font-medium appearance-none outline-none cursor-pointer hover:bg-zinc-900/80 hover:border-zinc-500 text-zinc-200 focus:text-white transition-all"
                            value={selectedLocus.value}
                            onChange={(e) => {
                                const selected = contexts.find(o => o.value === e.target.value);
                                if (selected) onSelectLocus(selected);
                            }}
                        >
                            {contexts.map((opt) => (
                                <option key={opt.value} value={opt.value} className="bg-black text-sm">{opt.label}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-700 pointer-events-none" />
                    </div>

                    {/* MODUS SELECTOR (Child - Dependent on Locus) */}
                    <div className="relative group/modus">
                         <div className="absolute -top-2 left-0 text-[8px] font-mono text-zinc-500 uppercase tracking-wider font-bold">
                          ACCIÓN / NECESIDAD
                         </div>
                         
                         {/* ICON OVERLAY */}
                         <div className="absolute left-0 top-3 pointer-events-none text-zinc-500 group-hover/modus:text-white transition-colors">
                            {React.createElement(selectedModus.icon, { size: 18, strokeWidth: 1.5 })}
                        </div>

                         <select 
                            className="w-full bg-zinc-900/30 border-b border-zinc-800 py-3 pl-7 pr-8 font-display text-lg uppercase font-medium appearance-none outline-none cursor-pointer hover:bg-zinc-900/80 hover:border-white text-zinc-300 focus:text-white transition-all"
                            value={selectedModus.value}
                            onChange={(e) => {
                                // We look into the CURRENT LOCUS actions
                                const selected = selectedLocus.actions.find(o => o.value === e.target.value);
                                if (selected) onSelectModus(selected);
                            }}
                        >
                            {selectedLocus.actions.map((opt) => (
                                <option key={opt.value} value={opt.value} className="bg-black text-sm">{opt.label}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-700 pointer-events-none" />
                    </div>
                </div>
            ) : (
                <div className="relative p-0 animate-in zoom-in-95 duration-200">
                    <div className="absolute top-3 right-0 text-zinc-600 pointer-events-none">
                        <Terminal size={16} />
                    </div>
                    <input 
                      type="text"
                      value={customTopicInput}
                      onChange={(e) => setCustomTopicInput(e.target.value)}
                      placeholder="Ej: Astronautas discutiendo en Marte sobre fútbol..."
                      className="w-full bg-transparent border-b border-white py-3 pr-8 font-mono text-sm text-white outline-none placeholder:text-zinc-700"
                      autoFocus
                    />
                </div>
            )}
            
            {!isCustomMode && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-mono text-zinc-600">
                    <span>RESUMEN:</span>
                    <span className="text-zinc-400 uppercase">{selectedLocus.label}</span>
                    <span className="text-zinc-700">+</span>
                    <span className="text-white uppercase">{selectedModus.label}</span>
                </div>
            )}
        </div>
    );
};

export default MatrixSelector;