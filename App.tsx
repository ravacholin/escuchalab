
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppState, Exercise, Level, Length, ListeningStage, TextType, Accent, AppMode } from './types';
import { STAGE_META, STAGE_ORDER } from './data/listeningSyllabus';
import { generateLessonPlan, generateAudio } from './services/geminiService';
import { ProgressSnapshot } from './services/generationProgress';
import { forgetLesson, isCacheable, lessonCacheKey, readLesson, writeLesson } from './services/lessonCache';
import AudioPlayer from './components/AudioPlayer';
import ExerciseCard from './components/ExerciseCard';
import LoadingScreen from './components/LoadingScreen';
import AuthScreen from './components/AuthScreen';
import SelectInput from './components/SelectInput';
import MatrixSelector from './components/MatrixSelector';
import { SCENARIO_DATABASE, ScenarioContext, ScenarioAction } from './data/scenarios';
import { ArrowRight, AlertTriangle, BookOpen, Mic2, Layout, Search, Key, RefreshCw } from 'lucide-react';

const LEVELS = Object.values(Level);
const LENGTHS = Object.values(Length);
const TEXT_TYPES = Object.values(TextType);
const ACCENTS = Object.values(Accent);

// A0 (keyword spotting) solo tiene sentido en formatos transaccionales/expositivos.
// Podcast y Monólogo son narrativos: arrancan en A1-A2.
const NARRATIVE_FORMATS: TextType[] = [TextType.PodcastInterview, TextType.Monologue];
const availableLevels = (textType: TextType): Level[] =>
    NARRATIVE_FORMATS.includes(textType) ? LEVELS.filter(l => l !== Level.Intro) : LEVELS;

// Resuelve la lista de contextos de forma segura (nunca undefined/empty → evita crash al indexar [0]).
const resolveContextList = (textType: TextType, level: Level): ScenarioContext[] => {
    const formatDb = SCENARIO_DATABASE[textType] || SCENARIO_DATABASE[TextType.Dialogue];
    const list = formatDb[level] || formatDb[Level.Beginner] || formatDb[Level.Intro];
    return (list && list.length > 0) ? list : SCENARIO_DATABASE[TextType.Dialogue][Level.Beginner];
};
const MODES = [
    { value: AppMode.Standard, label: 'Estándar', icon: Layout },
    { value: AppMode.Vocabulary, label: 'Vocabulario', icon: BookOpen },
    { value: AppMode.AccentChallenge, label: 'Adivina Acento', icon: Mic2 },
];

const getSpeedForLevel = (level: Level): number => {
    // User requested natural speed for all levels, no "slow motion"
    return 1.0;
};

// Recuerda el último nivel elegido por el usuario para que sea el default la próxima vez.
const DEFAULT_LEVEL_KEY = 'escuchalab_default_level';
const getStoredDefaultLevel = (): Level => {
    try {
        const stored = localStorage.getItem(DEFAULT_LEVEL_KEY);
        if (stored && (Object.values(Level) as string[]).includes(stored)) {
            return stored as Level;
        }
    } catch (e) { /* localStorage unavailable */ }
    return Level.Intro;
};
const storeDefaultLevel = (level: Level): void => {
    try {
        localStorage.setItem(DEFAULT_LEVEL_KEY, level);
    } catch (e) { /* localStorage unavailable */ }
};

const App: React.FC = () => {
    // Lazy initialization to check localStorage immediately prevents the "Auth" flash
    const [state, setState] = useState<AppState>(() => {
        // Try/Catch for safer localStorage access
        try {
            const storedKey = localStorage.getItem('gemini_api_key');
            return {
                status: (storedKey && storedKey.startsWith('AIza')) ? 'idle' : 'auth',
                config: {
                    mode: AppMode.Standard,
                    level: getStoredDefaultLevel(),
                    topic: "",
                    length: Length.Short,
                    textType: TextType.Dialogue,
                    accent: Accent.Madrid
                },
                lessonPlan: null,
                audioBlob: null,
                error: null,
            };
        } catch (e) {
            return {
                status: 'auth',
                config: {
                    mode: AppMode.Standard,
                    level: getStoredDefaultLevel(),
                    topic: "",
                    length: Length.Short,
                    textType: TextType.Dialogue,
                    accent: Accent.Madrid
                },
                lessonPlan: null,
                audioBlob: null,
                error: null,
            };
        }
    });

    // FAILSAFE: Watch for localStorage changes or mismatches on mount
    // This ensures that if the lazy init failed for some reason, we recover the session.
    useEffect(() => {
        const checkKey = () => {
            const storedKey = localStorage.getItem('gemini_api_key');
            if (storedKey && storedKey.startsWith('AIza') && state.status === 'auth') {
                console.log("Restoring session from local storage...");
                setState(prev => ({ ...prev, status: 'idle' }));
            }
        };
        checkKey();
        window.addEventListener('storage', checkKey);
        return () => window.removeEventListener('storage', checkKey);
    }, [state.status]);

    const handleAuthSuccess = () => {
        setState(prev => ({ ...prev, status: 'idle' }));
    };

    const handleResetKey = () => {
        if (window.confirm("¿Seguro que quieres borrar la API Key y salir? Esto requerirá ingresarla de nuevo.")) {
            localStorage.removeItem('gemini_api_key');
            setState(prev => ({ ...prev, status: 'auth', error: null }));
        }
    };

    // 1. Get List of Contexts (Locus) for current Level
    const currentContextList = useMemo(
        () => resolveContextList(state.config.textType, state.config.level),
        [state.config.level, state.config.textType]
    );

    // 2. Select Locus (Scenario)
    const [selectedLocus, setSelectedLocus] = useState<ScenarioContext>(currentContextList[0]);

    // 3. Get List of Actions (Modus) for selected Locus
    const currentActionList = useMemo(() => selectedLocus.actions, [selectedLocus]);

    // 4. Select Modus (Action)
    const [selectedModus, setSelectedModus] = useState<ScenarioAction>(currentActionList[0]);

    // Custom Input Mode
    const [isCustomMode, setIsCustomMode] = useState(false);
    const [customTopicInput, setCustomTopicInput] = useState('');

    // Dedicated Input for Vocabulary Mode
    const [vocabTopic, setVocabTopic] = useState('');

    // La lección se abre por los ejercicios, no por la transcripción: leer el
    // texto antes de escuchar convierte cualquier tarea de comprensión auditiva
    // en una de comprensión lectora.
    const [activeTab, setActiveTab] = useState<'exercises' | 'transcript'>('exercises');
    const [audioError, setAudioError] = useState<string | null>(null);
    /** Clave de caché de la lección en pantalla (null si el modo no se cachea). */
    const [currentCacheKey, setCurrentCacheKey] = useState<string | null>(null);

    // Progreso medido de la generación (lo reportan los propios servicios).
    const [progress, setProgress] = useState<ProgressSnapshot | null>(null);

    // Una instantánea rezagada de la fase anterior no debe pisar a la actual:
    // los reportes van con un pequeño throttling y el guion termina justo
    // cuando el audio empieza.
    const trackProgress = useCallback((snapshot: ProgressSnapshot) => {
        setProgress(prev => (prev?.phase === 'audio' && snapshot.phase === 'plan' ? prev : snapshot));
    }, []);

    /**
     * Ejercicios agrupados por etapa de escucha, en el orden metodológico
     * (anticipación → global → selectiva → intensiva → reflexión). Los que
     * llegan sin etapa se muestran al final, en "Detalle".
     */
    const stagedExercises = useMemo(() => {
        const exercises: Exercise[] = state.lessonPlan?.exercises || [];
        const byStage = new Map<ListeningStage, Exercise[]>();

        for (const ex of exercises) {
            const stage: ListeningStage = ex.stage && STAGE_ORDER.includes(ex.stage) ? ex.stage : 'selectiva';
            const bucket = byStage.get(stage) || [];
            bucket.push(ex);
            byStage.set(stage, bucket);
        }

        return STAGE_ORDER
            .filter(stage => (byStage.get(stage) || []).length > 0)
            .map((stage, i) => ({ stage, items: byStage.get(stage) || [], position: i + 1 }));
    }, [state.lessonPlan]);

    // La etapa de anticipación se responde ANTES de reproducir; el resto pierde
    // sentido si se lee la transcripción primero.
    const hasAnticipationStage = stagedExercises.some(g => g.stage === 'anticipacion');

    // --- EFFECT: COERCE INVALID LEVEL FOR NARRATIVE FORMATS ---
    // Podcast/Monólogo no tienen A0: si el usuario cambia a esos formatos estando en A0,
    // saltamos a A1-A2 antes de que se intente indexar un bucket inexistente.
    useEffect(() => {
        if (NARRATIVE_FORMATS.includes(state.config.textType) && state.config.level === Level.Intro) {
            setState(prev => ({ ...prev, config: { ...prev.config, level: Level.Beginner } }));
        }
    }, [state.config.textType, state.config.level]);

    // --- EFFECT: LEVEL CHANGE ---
    useEffect(() => {
        const db = resolveContextList(state.config.textType, state.config.level);
        const firstLocus = db[0];
        if (!firstLocus) return;
        setSelectedLocus(firstLocus);
        setSelectedModus(firstLocus.actions[0]);
    }, [state.config.level, state.config.textType]);

    // --- EFFECT: LOCUS CHANGE ---
    useEffect(() => {
        setSelectedModus(selectedLocus.actions[0]);
    }, [selectedLocus]);


    // --- RANDOMIZER LOGIC ---
    const handleRandomizeMatrix = useCallback(() => {
        const contexts = resolveContextList(state.config.textType, state.config.level);
        const randomCtx = contexts[Math.floor(Math.random() * contexts.length)];

        const actions = randomCtx.actions;
        const randomAct = actions[Math.floor(Math.random() * actions.length)];

        setSelectedLocus(randomCtx);
        setSelectedModus(randomAct);

        if (isCustomMode) setIsCustomMode(false);
    }, [state.config.level, state.config.textType, isCustomMode]);

    const handleGenerate = async (options?: { skipCache?: boolean }) => {
        setState(prev => ({ ...prev, status: 'generating_plan', error: null, audioBlob: null }));
        setAudioError(null);
        setProgress(null);

        let finalTopic = "";

        if (state.config.mode === AppMode.Vocabulary) {
            if (!vocabTopic.trim()) {
                setState(prev => ({ ...prev, status: 'idle', error: "Por favor, escribe un tema para ampliar vocabulario." }));
                return;
            }
            finalTopic = vocabTopic;
        }
        else if (state.config.mode === AppMode.AccentChallenge) {
            finalTopic = "Encuentro entre desconocidos con acentos distintos";
        }
        else {
            if (isCustomMode) {
                finalTopic = customTopicInput;
            } else {
                finalTopic = `Contexto Físico: ${selectedLocus.value} || Situación Específica: ${selectedModus.value} || Registro: ${selectedLocus.registerInstruction}`;
            }
        }

        if (!finalTopic && state.config.mode === AppMode.Standard) {
            setState(prev => ({ ...prev, status: 'idle', error: "Debes definir el escenario." }));
            return;
        }

        const cacheParts = {
            mode: state.config.mode,
            level: state.config.level,
            topic: finalTopic,
            length: state.config.length,
            textType: state.config.textType,
            accent: state.config.accent
        };
        const cacheKey = lessonCacheKey(cacheParts);
        const cacheable = isCacheable(cacheParts);
        setCurrentCacheKey(cacheable ? cacheKey : null);

        try {
            // Misma configuración = misma lección (el diálogo se pide con
            // temperature 0). Si ya se generó, no se vuelve a pagar el pipeline.
            if (cacheable && !options?.skipCache) {
                const cached = await readLesson(cacheKey);
                if (cached) {
                    setState(prev => ({
                        ...prev,
                        config: { ...prev.config, topic: finalTopic },
                        lessonPlan: cached.plan,
                        audioBlob: cached.audio,
                        status: 'ready'
                    }));
                    return;
                }
            }

            const plan = await generateLessonPlan(
                state.config.level,
                finalTopic,
                state.config.length,
                state.config.textType,
                state.config.accent,
                state.config.mode,
                trackProgress
            );

            setState(prev => ({
                ...prev,
                config: { ...prev.config, topic: finalTopic },
                lessonPlan: plan,
                status: 'generating_audio'
            }));

            try {
                const audioUrl = await generateAudio(
                    plan.dialogue,
                    plan.characters,
                    state.config.accent,
                    trackProgress
                );
                setState(prev => ({
                    ...prev,
                    audioBlob: audioUrl,
                    status: 'ready'
                }));
                // Solo se guarda la lección completa: una sin audio no ahorra
                // nada al recuperarla, porque habría que volver al TTS igual.
                if (cacheable) void writeLesson(cacheKey, plan, audioUrl);
            } catch (audioErr: any) {
                console.warn("Audio generation failed:", audioErr);
                setAudioError(audioErr.message || "Fallo en la generación de audio");
                setState(prev => ({
                    ...prev,
                    audioBlob: null,
                    status: 'ready'
                }));
            }

        } catch (error: any) {
            console.error("Critical Generation Error:", error);
            setState(prev => ({
                ...prev,
                status: 'error',
                error: error.message || "FALLO CRÍTICO EN LA SECUENCIA DE GENERACIÓN."
            }));
        }
    };

    /** Descarta la versión cacheada y vuelve a generar la misma configuración. */
    const handleRegenerate = async () => {
        if (currentCacheKey) await forgetLesson(currentCacheKey);
        void handleGenerate({ skipCache: true });
    };

    const resetApp = () => {
        setState(prev => ({
            ...prev,
            status: 'idle',
            lessonPlan: null,
            audioBlob: null,
            error: null
        }));
        setAudioError(null);
        setActiveTab('exercises');
        setCurrentCacheKey(null);
    };

    const getAmbienceContext = () => {
        if (state.lessonPlan?.situationDescription) {
            return `${state.lessonPlan.title} ${state.lessonPlan.situationDescription}`;
        }
        if (state.config.mode === AppMode.Vocabulary) return vocabTopic;
        if (state.config.mode === AppMode.AccentChallenge) return "cafe park public space";
        if (isCustomMode) return customTopicInput;
        return selectedLocus.value;
    };

    // --- SCREEN: AUTH ---
    if (state.status === 'auth') {
        return <AuthScreen onSuccess={handleAuthSuccess} />;
    }

    // --- SCREEN: LOADING ---
    if (state.status === 'generating_plan' || state.status === 'generating_audio') {
        return <LoadingScreen status={state.status} progress={progress} />;
    }

    // --- SCREEN: ERROR ---
    if (state.status === 'error') {
        return (
            <div className="h-screen w-full bg-black flex items-center justify-center p-8">
                <div className="border border-red-600 p-12 max-w-lg w-full relative">
                    <div className="absolute top-0 left-0 bg-red-600 text-black font-mono text-[10px] px-2 py-1 uppercase font-bold">Registro de Error</div>
                    <h2 className="font-display text-3xl uppercase text-white mb-6">Fallo en Ejecución</h2>
                    <p className="font-mono text-red-500 text-sm mb-8 border-l-2 border-red-900 pl-4">{state.error}</p>
                    <div className="flex gap-4">
                        <button onClick={resetApp} className="flex-1 px-6 py-3 border border-zinc-700 text-zinc-300 hover:border-white hover:text-white font-mono text-xs uppercase tracking-widest transition-all">
                            Reiniciar Sistema
                        </button>
                        {/* Botón para cambiar API Key si el error es de autenticación */}
                        <button onClick={handleResetKey} className="px-6 py-3 border border-red-900 text-red-500 hover:bg-red-900 hover:text-white font-mono text-xs uppercase tracking-widest transition-all" title="Cambiar API Key">
                            <Key size={14} />
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    // --- SCREEN: IDLE (Landing) ---
    if (state.status === 'idle') {
        return (
            <div className="h-screen w-full bg-black text-white overflow-hidden flex flex-col md:flex-row">

                {/* LEFT: MANIFESTO */}
                <div className="w-full md:w-1/2 border-r border-zinc-800 p-8 md:p-12 flex flex-col justify-between relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-opacity-20 hidden md:flex">
                    <div className="relative z-10">
                        <div className="mb-8">
                            <img src="/escucha-logo.png" alt="EscuchaLAB" className="w-full max-w-[620px] drop-shadow-[0_0_40px_rgba(255,255,255,0.08)]" />
                        </div>
                        <p className="font-mono text-sm text-zinc-400 max-w-md leading-relaxed uppercase">
                            Sistema avanzado de inmersión lingüística generado por inteligencia artificial.
                            Síntesis en tiempo real de dialectos, contextos y evaluaciones pedagógicas.
                        </p>
                    </div>

                    <div className="flex items-center justify-between mt-12 md:mt-0">
                        <div className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">
                            v3.8.0 // PERSISTENCE FIX
                        </div>
                        <button onClick={handleResetKey} className="text-zinc-700 hover:text-white transition-colors text-[10px] font-mono uppercase tracking-widest flex items-center gap-2">
                            <Key size={10} /> Configuración de Clave
                        </button>
                    </div>
                </div>

                {/* RIGHT: CONFIG */}
                <div className="w-full md:w-1/2 overflow-y-auto bg-black scrollbar-thin">
                    <div className="min-h-full flex flex-col">
                        {/* Mobile Header */}
                        <div className="md:hidden p-8 pb-0">
                            <img src="/escucha-logo.png" alt="EscuchaLAB" className="w-56" />
                        </div>

                        <div className="flex-1 p-8 md:p-12 space-y-10">

                            {/* --- MODE SELECTOR --- */}
                            <div>
                                <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-3">MODALIDAD DE PRÁCTICA</label>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    {MODES.map((m) => (
                                        <button
                                            key={m.value}
                                            onClick={() => setState({ ...state, config: { ...state.config, mode: m.value } })}
                                            className={`flex flex-col items-center justify-center p-4 border transition-all ${state.config.mode === m.value ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:border-zinc-500 hover:text-white'}`}
                                        >
                                            <m.icon size={20} className="mb-2" />
                                            <span className="font-display uppercase font-bold text-xs">{m.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* --- COMMON: LEVEL --- */}
                            <div className="space-y-4">
                                <SelectInput
                                    label="Nivel de Competencia"
                                    value={state.config.level}
                                    options={availableLevels(state.config.textType)}
                                    highlight={true}
                                    onChange={(e: any) => {
                                        const newLevel = e.target.value as Level;
                                        storeDefaultLevel(newLevel);
                                        setState({ ...state, config: { ...state.config, level: newLevel } });
                                    }}
                                />
                                <SelectInput
                                    label="Formato"
                                    value={state.config.textType}
                                    options={TEXT_TYPES}
                                    onChange={(e: any) => setState({ ...state, config: { ...state.config, textType: e.target.value } })}
                                />
                            </div>

                            {/* MODE: STANDARD */}
                            {state.config.mode === AppMode.Standard && (
                                <>
                                    <MatrixSelector
                                        contexts={currentContextList}
                                        selectedLocus={selectedLocus}
                                        onSelectLocus={setSelectedLocus}
                                        selectedModus={selectedModus}
                                        onSelectModus={setSelectedModus}
                                        isCustomMode={isCustomMode}
                                        toggleCustomMode={() => setIsCustomMode(!isCustomMode)}
                                        customTopicInput={customTopicInput}
                                        setCustomTopicInput={setCustomTopicInput}
                                        onRandomize={handleRandomizeMatrix}
                                    />
                                </>
                            )}

                            {/* MODE: VOCABULARY */}
                            {state.config.mode === AppMode.Vocabulary && (
                                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <div className="relative group">
                                        <label className="block text-[10px] font-mono uppercase tracking-widest text-white mb-2 font-bold">
                                            Tema Específico de Vocabulario
                                        </label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={vocabTopic}
                                                onChange={(e) => setVocabTopic(e.target.value)}
                                                placeholder="Ej: Astrofísica, Cocina Vegana, Arquitectura Gótica..."
                                                className="w-full bg-zinc-900 border-b border-zinc-700 p-4 pl-12 font-display text-xl text-white outline-none focus:border-white focus:bg-zinc-800 transition-all placeholder:text-zinc-600"
                                                autoFocus
                                            />
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                        </div>
                                        <p className="mt-2 text-[10px] font-mono text-zinc-500">
                                            Se generará un diálogo denso en terminología sobre este tema.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* MODE: ACCENT CHALLENGE */}
                            {state.config.mode === AppMode.AccentChallenge && (
                                <div className="p-6 border border-zinc-800 bg-zinc-900/30 animate-in fade-in duration-500">
                                    <Mic2 size={32} className="text-zinc-500 mb-4" />
                                    <h3 className="font-display text-xl uppercase font-bold text-white mb-2">Reto de Escucha a Ciegas</h3>
                                    <p className="font-sans text-sm text-zinc-400 leading-relaxed">
                                        Dos hablantes de <strong>diferentes regiones</strong> hispanohablantes conversarán.
                                        Tu objetivo es identificar su origen basándote en su vocabulario, gramática y expresiones.
                                    </p>
                                </div>
                            )}

                            {/* --- FOOTER SETTINGS --- */}
                            <div className="space-y-8 pt-4 border-t border-zinc-900">
                                {/* Accent Selector: HIDE in AccentChallenge */}
                                {state.config.mode !== AppMode.AccentChallenge && (
                                    <SelectInput
                                        label="Acento Preferente"
                                        value={state.config.accent}
                                        options={ACCENTS}
                                        onChange={(e: any) => setState({ ...state, config: { ...state.config, accent: e.target.value } })}
                                        subLabel={state.config.mode === AppMode.Vocabulary ? "El vocabulario técnico se adaptará a esta región." : undefined}
                                    />
                                )}

                                <SelectInput
                                    label="Duración"
                                    value={state.config.length}
                                    options={LENGTHS}
                                    onChange={(e: any) => setState({ ...state, config: { ...state.config, length: e.target.value } })}
                                />
                            </div>
                        </div>

                        <button
                            onClick={() => void handleGenerate()}
                            className="w-full py-8 bg-white text-black font-display text-2xl uppercase font-bold tracking-tight hover:bg-zinc-300 transition-colors flex items-center justify-center gap-4 group"
                        >
                            {state.config.mode === AppMode.AccentChallenge ? 'Iniciar Reto' : 'Generar Lección'}
                            <ArrowRight className="group-hover:translate-x-2 transition-transform" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- SCREEN: READY (Main App) ---
    return (
        <div className="h-screen flex flex-col bg-black overflow-hidden">
            {/* TOP BAR */}
            <header className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-black z-20 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-white"></div>
                    <span className="font-display font-bold uppercase tracking-tight text-2xl cursor-pointer" onClick={resetApp}>Escucha<span className="text-zinc-600">LAB</span></span>
                </div>
                <div className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    {currentCacheKey && (
                        <button
                            onClick={() => void handleRegenerate()}
                            title="Genera una lección nueva para esta misma configuración"
                            className="flex items-center gap-2 border border-zinc-800 px-2 py-1 transition-colors hover:border-white hover:text-white"
                        >
                            <RefreshCw size={11} />
                            <span className="hidden sm:inline">Regenerar</span>
                        </button>
                    )}
                    <span className="hidden sm:inline">NIV: {state.config.level.split(' ')[0]}</span>
                    {state.config.mode !== AppMode.AccentChallenge && (
                        <span className="hidden sm:inline">MOD: {state.config.accent.split(' ')[0]}</span>
                    )}
                    <span className="bg-zinc-800 text-white px-2 py-0.5 rounded-sm">
                        {state.config.mode === AppMode.Standard ? 'STD' : (state.config.mode === AppMode.Vocabulary ? 'VOC' : 'RETO')}
                    </span>
                </div>
            </header>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

                {/* LEFT PANEL: CONTEXT & PLAYER */}
                <div className="w-full md:w-5/12 lg:w-1/3 bg-zinc-950/50 border-r border-zinc-800 flex flex-col h-[40vh] md:h-full z-10">
                    <div className="p-8 flex-1 overflow-y-auto">
                        {state.lessonPlan && (
                            <div>
                                <span className="font-mono text-[10px] text-zinc-500 border border-zinc-800 px-2 py-1 uppercase mb-6 inline-block">
                                    {state.lessonPlan.communicativeFunction}
                                </span>
                                <h1 className="font-display text-3xl md:text-4xl uppercase font-bold leading-none mb-6 text-white break-words">
                                    {state.lessonPlan.title}
                                </h1>
                                <p className="font-sans text-sm text-zinc-400 leading-relaxed border-l border-zinc-800 pl-4 mb-8">
                                    {state.lessonPlan.situationDescription}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Player docked at bottom of left panel */}
                    <div className="mt-auto border-t border-zinc-800">
                        {audioError ? (
                            <div className="p-4 flex gap-4 items-center bg-red-950/20">
                                <AlertTriangle className="text-red-500" size={24} />
                                <div className="flex flex-col">
                                    <span className="font-mono text-xs text-red-500 uppercase font-bold">Error de Audio</span>
                                    <span className="font-mono text-[10px] text-red-400/70">{audioError.substring(0, 50)}...</span>
                                </div>
                            </div>
                        ) : state.audioBlob ? (
                            <AudioPlayer
                                key={state.lessonPlan?.title || 'audio-player'}
                                speechSrc={state.audioBlob}
                                recommendedSpeed={getSpeedForLevel(state.config.level)}
                                topic={getAmbienceContext()}
                                explicitQuery={state.lessonPlan?.ambientKeywords}
                                sceneHint={state.lessonPlan?.ambientScene}
                                textType={state.config.textType}
                                scenarioLabel={state.config.mode === AppMode.Standard && !isCustomMode ? selectedLocus.label : undefined}
                                scenarioActionLabel={state.config.mode === AppMode.Standard && !isCustomMode ? selectedModus.label : undefined}
                                hideTrackInfo={state.config.mode === AppMode.AccentChallenge}
                            />
                        ) : (
                            <div className="p-4 text-center font-mono text-xs text-zinc-500 uppercase">
                                Inicializando Stream...
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT PANEL: CONTENT */}
                <div className="flex-1 flex flex-col bg-black h-full overflow-hidden relative">
                    {/* Custom Tabs */}
                    <div className="flex border-b border-zinc-800 flex-shrink-0 bg-black">
                        {[
                            { id: 'exercises', label: 'Ejercicios' },
                            { id: 'transcript', label: 'Transcripción' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex-1 py-4 font-mono text-[10px] sm:text-xs uppercase tracking-widest border-r border-zinc-800 hover:bg-zinc-900 transition-colors relative
                                ${activeTab === tab.id ? 'bg-white text-black border-r-white' : 'text-zinc-500'}
                            `}
                            >
                                {tab.label}
                                {activeTab === tab.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-black"></div>}
                            </button>
                        ))}
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 overflow-y-auto p-6 md:p-12 scrollbar-thin">

                        {/* TRANSCRIPT VIEW */}
                        {activeTab === 'transcript' && (
                            <div className="max-w-2xl mx-auto space-y-8 pb-20">
                                <div className="flex items-start gap-3 border border-amber-900/60 bg-amber-950/20 p-4">
                                    <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                    <p className="font-mono text-[11px] leading-relaxed text-amber-200/80 uppercase tracking-wide">
                                        La transcripción es material de apoyo para el final.
                                        {hasAnticipationStage && ' Empezá por «Antes de escuchar».'} Si la leés
                                        antes de trabajar el audio, los ejercicios pasan a medir comprensión
                                        lectora y no auditiva.
                                    </p>
                                </div>
                                {state.lessonPlan?.dialogue?.map((line, idx) => (
                                    <div key={idx} className="grid grid-cols-[60px_1fr] gap-4 group">
                                        <div className="font-mono text-xs text-zinc-500 pt-1 text-right uppercase">
                                            {line.speaker}
                                        </div>
                                        <div className="relative border-l border-zinc-800 pl-6 pb-2 transition-all group-hover:border-white">
                                            <p className="font-sans text-lg text-zinc-300 leading-relaxed group-hover:text-white transition-colors">
                                                {line.text}
                                            </p>
                                            {line.emotion && (
                                                <span className="absolute -left-[5.5rem] top-6 font-mono text-[9px] text-zinc-700 uppercase opacity-0 group-hover:opacity-100 transition-opacity text-right w-16">
                                                    [{line.emotion}]
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* EXERCISES VIEW — recorrido por etapas de escucha */}
                        {activeTab === 'exercises' && (
                            <div className="max-w-3xl mx-auto pb-20">
                                {stagedExercises.length === 0 && (
                                    <p className="font-mono text-xs text-zinc-500">
                                        No se pudo construir ningún ejercicio verificable para este audio.
                                    </p>
                                )}
                                {stagedExercises.map(group => (
                                    <section key={group.stage} className="mb-16">
                                        <div className="mb-10 border-b border-zinc-800 pb-4">
                                            <div className="flex items-baseline gap-3 flex-wrap">
                                                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                                                    {String(group.position).padStart(2, '0')}
                                                </span>
                                                <h3 className="font-display text-2xl uppercase font-bold text-white">
                                                    {STAGE_META[group.stage].label}
                                                </h3>
                                            </div>
                                            <p className="font-mono text-xs text-zinc-500 mt-2 leading-relaxed">
                                                {STAGE_META[group.stage].hint}
                                            </p>
                                        </div>
                                        {group.items.map((ex, idx) => (
                                            <ExerciseCard
                                                key={ex.id || `${group.stage}_${idx}`}
                                                exercise={ex}
                                                index={idx}
                                                dialogue={state.lessonPlan?.dialogue}
                                            />
                                        ))}
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
