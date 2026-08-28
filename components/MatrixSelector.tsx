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

const fieldClass =
    'w-full appearance-none cursor-pointer rounded-xl border border-line bg-panel py-3.5 pl-11 pr-10 font-sans text-[15px] font-medium text-fg outline-none transition-all hover:bg-panel-2 hover:border-faint focus:border-accent focus:ring-2 focus:ring-white/10';

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
    onRandomize,
}) => {
    const pill = (active: boolean) =>
        `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            active
                ? 'text-fg border-accent/40 bg-white/[0.06]'
                : 'text-muted border-line hover:text-fg hover:border-faint'
        }`;

    return (
        <div>
            <div className="flex justify-between items-center mb-3 gap-3">
                <label className="block text-xs font-medium text-muted">Configuración de escena</label>
                <div className="flex gap-2">
                    <button onClick={toggleCustomMode} className={pill(isCustomMode)}>
                        <Terminal size={13} />
                        <span>Custom</span>
                    </button>
                    <button onClick={onRandomize} className={pill(false)} title="Generar combinación aleatoria">
                        <Dices size={13} />
                        <span>Azar</span>
                    </button>
                </div>
            </div>

            {!isCustomMode ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* LOCUS (Escenario) */}
                        <div>
                            <span className="block text-[10px] font-mono uppercase tracking-[0.12em] text-faint mb-1.5">Escenario</span>
                            <div className="relative group">
                                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted group-hover:text-fg transition-colors">
                                    {React.createElement(selectedLocus.icon, { size: 17, strokeWidth: 1.6 })}
                                </div>
                                <select
                                    className={fieldClass}
                                    value={selectedLocus.value}
                                    onChange={(e) => {
                                        const selected = contexts.find(o => o.value === e.target.value);
                                        if (selected) onSelectLocus(selected);
                                    }}
                                >
                                    {contexts.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                            </div>
                        </div>

                        {/* MODUS (Acción) */}
                        <div>
                            <span className="block text-[10px] font-mono uppercase tracking-[0.12em] text-faint mb-1.5">Acción / Necesidad</span>
                            <div className="relative group">
                                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted group-hover:text-fg transition-colors">
                                    {React.createElement(selectedModus.icon, { size: 17, strokeWidth: 1.6 })}
                                </div>
                                <select
                                    className={fieldClass}
                                    value={selectedModus.value}
                                    onChange={(e) => {
                                        const selected = selectedLocus.actions.find(o => o.value === e.target.value);
                                        if (selected) onSelectModus(selected);
                                    }}
                                >
                                    {selectedLocus.actions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
                        <span className="font-mono uppercase tracking-[0.1em] text-[10px]">Resumen</span>
                        <span className="text-muted">{selectedLocus.label}</span>
                        <span className="text-faint">+</span>
                        <span className="text-fg font-medium">{selectedModus.label}</span>
                    </div>
                </>
            ) : (
                <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none">
                        <Terminal size={16} />
                    </div>
                    <input
                        type="text"
                        value={customTopicInput}
                        onChange={(e) => setCustomTopicInput(e.target.value)}
                        placeholder="Ej: Astronautas discutiendo en Marte sobre fútbol…"
                        className="w-full rounded-xl border border-line bg-panel py-3.5 pl-11 pr-4 font-sans text-[15px] text-fg outline-none transition-all focus:border-accent focus:ring-2 focus:ring-white/10 placeholder:text-faint"
                        autoFocus
                    />
                </div>
            )}
        </div>
    );
};

export default MatrixSelector;
