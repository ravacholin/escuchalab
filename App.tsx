
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppState, Exercise, Level, Length, ListeningStage, TextType, Accent, AppMode, LessonPlan } from './types';
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
import { ArrowRight, AlertTriangle, BookOpen, ChevronDown, ChevronUp, Mic2, Layout, Search, Key, RefreshCw, Terminal, Sparkles } from 'lucide-react';

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

// ¿El diálogo con el que se lanzó el TTS pronto sigue siendo el de la lección
// final? Solo turno a turno (hablante + texto): si un reintento cambió el guion,
// hay que descartar ese audio y regenerar sobre el diálogo definitivo.
const dialoguesEqual = (a: LessonPlan['dialogue'], b: LessonPlan['dialogue']): boolean =>
    a.length === b.length &&
    a.every((line, i) => line.speaker === b[i].speaker && line.text === b[i].text);

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

// Recuerda la última variedad dialectal elegida por el usuario para que sea el default la próxima vez.
const DEFAULT_ACCENT_KEY = 'escuchalab_default_accent';
const getStoredDefaultAccent = (): Accent => {
    try {
        const stored = localStorage.getItem(DEFAULT_ACCENT_KEY);
        if (stored && (Object.values(Accent) as string[]).includes(stored)) {
            return stored as Accent;
        }
    } catch (e) { /* localStorage unavailable */ }
    return Accent.Madrid;
};
const storeDefaultAccent = (accent: Accent): void => {
    try {
        localStorage.setItem(DEFAULT_ACCENT_KEY, accent);
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
                    accent: getStoredDefaultAccent()
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
                    accent: getStoredDefaultAccent()
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

    // Instrucciones libres del usuario (avanzado): una para el guion del audio y
    // otra para los ejercicios. Se apilan sobre las reglas pedagógicas, no las
    // sustituyen. Disponibles en cualquier modo.
    const [customAudioPrompt, setCustomAudioPrompt] = useState('');
    const [customExercisePrompt, setCustomExercisePrompt] = useState('');
    const [showAdvancedPrompts, setShowAdvancedPrompts] = useState(false);

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

    /**
     * Etapas desplegadas y ejercicios ya corregidos.
     *
     * La lección se pintaba entera en un scroll único: cinco o seis tarjetas
     * encadenadas, varias de ellas tablas, antes de que el alumno hubiera
     * decidido siquiera por dónde empezar. Buena parte de lo que se percibía
     * como una carga inmanejable era eso, con independencia del contenido. Ahora
     * se abre sólo la primera etapa y cada cabecera lleva su contador, así que el
     * recorrido se ve de un vistazo y se avanza por etapas.
     */
    const [openStages, setOpenStages] = useState<Set<ListeningStage>>(new Set());
    const [answered, setAnswered] = useState<Record<string, boolean>>({});

    // Cada lección nueva reinicia el recorrido: se abre su primera etapa y se
    // olvidan las respuestas de la anterior.
    useEffect(() => {
        setAnswered({});
        setOpenStages(new Set(stagedExercises.length > 0 ? [stagedExercises[0].stage] : []));
    }, [stagedExercises]);

    const toggleStage = useCallback((stage: ListeningStage) => {
        setOpenStages(prev => {
            const next = new Set(prev);
            if (next.has(stage)) next.delete(stage);
            else next.add(stage);
            return next;
        });
    }, []);

    const markAnswered = useCallback((key: string, correct: boolean) => {
        setAnswered(prev => ({ ...prev, [key]: correct }));
    }, []);

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

        const trimmedAudioPrompt = customAudioPrompt.trim();
        const trimmedExercisePrompt = customExercisePrompt.trim();

        const cacheParts = {
            mode: state.config.mode,
            level: state.config.level,
            topic: finalTopic,
            length: state.config.length,
            textType: state.config.textType,
            accent: state.config.accent,
            customAudioPrompt: trimmedAudioPrompt,
            customExercisePrompt: trimmedExercisePrompt
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

            // El TTS solo necesita diálogo + personajes, no los ejercicios. En
            // cuanto el diálogo termina de llegar por el stream, se arranca el
            // audio en paralelo con la cola del plan (ejercicios + verificación),
            // en vez de esperar a toda la lección. Mismo completion, mismo
            // contenido: solo se solapan las dos fases.
            let earlyAudio: { dialogue: LessonPlan['dialogue']; promise: Promise<string> } | null = null;

            const plan = await generateLessonPlan(
                state.config.level,
                finalTopic,
                state.config.length,
                state.config.textType,
                state.config.accent,
                state.config.mode,
                trackProgress,
                { audio: trimmedAudioPrompt, exercises: trimmedExercisePrompt },
                {
                    onDialogueReady: (dialogue, characters) => {
                        const promise = generateAudio(dialogue, characters, state.config.accent, trackProgress);
                        // Si el plan acaba lanzando (p. ej. reintentos por JSON agotados)
                        // tras haber arrancado el audio, esta promesa queda huérfana: el
                        // .catch evita un "unhandled rejection". Aun así, `await promise`
                        // más abajo sigue propagando el fallo al camino de audioError.
                        promise.catch(() => {});
                        earlyAudio = { dialogue, promise };
                        setState(prev => ({ ...prev, status: 'generating_audio' }));
                    }
                }
            );

            setState(prev => ({
                ...prev,
                config: { ...prev.config, topic: finalTopic },
                lessonPlan: plan,
                status: 'generating_audio'
            }));

            try {
                let audioUrl: string;
                // Si el audio ya venía corriendo y el diálogo final coincide con el
                // que lo lanzó, se aprovecha esa promesa. Si no arrancó pronto, o el
                // diálogo cambió en un reintento (raro con temperature 0), se genera
                // en secuencia — nunca se envía audio de un diálogo obsoleto.
                const pending = earlyAudio as { dialogue: LessonPlan['dialogue']; promise: Promise<string> } | null;
                if (pending && dialoguesEqual(pending.dialogue, plan.dialogue)) {
                    audioUrl = await pending.promise;
                } else {
                    // El audio no arrancó pronto, o el diálogo cambió en un reintento:
                    // la promesa temprana (si la hay) ya tiene su .catch y se descarta.
                    audioUrl = await generateAudio(
                        plan.dialogue,
                        plan.characters,
                        state.config.accent,
                        trackProgress
                    );
                }
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
            <div className="min-h-[100dvh] w-full bg-ink flex items-center justify-center p-6">
                <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-8 sm:p-10">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-9 h-9 rounded-xl bg-panel-2 border border-line flex items-center justify-center">
                            <AlertTriangle size={18} className="text-fg" />
                        </div>
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Registro de error</span>
                    </div>
                    <h2 className="font-display text-3xl font-semibold text-fg mb-4">Algo salió mal</h2>
                    <p className="text-sm text-muted leading-relaxed mb-8 border-l-2 border-line pl-4 font-mono">{state.error}</p>
                    <div className="flex gap-3">
                        <button onClick={resetApp} className="flex-1 px-6 py-3.5 rounded-xl bg-accent text-ink font-display font-semibold text-sm hover:brightness-105 transition-all">
                            Reiniciar
                        </button>
                        {/* Botón para cambiar API Key si el error es de autenticación */}
                        <button onClick={handleResetKey} className="px-5 py-3.5 rounded-xl border border-line text-muted hover:text-fg hover:border-faint transition-all flex items-center gap-2 text-sm font-medium" title="Cambiar API Key">
                            <Key size={15} /> Clave
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    // --- SCREEN: IDLE (Landing) ---
    if (state.status === 'idle') {
        return (
            <div className="min-h-[100dvh] w-full bg-ink text-fg flex flex-col md:flex-row">

                {/* LEFT: HERO */}
                <div className="hidden md:flex md:w-[44%] lg:w-[42%] border-r border-line p-12 flex-col justify-between relative overflow-hidden bg-gradient-to-b from-[#0d1116] to-[#0a0d10]">
                    <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(120% 80% at 15% 0%, rgba(255,255,255,0.06), transparent 60%)' }} />
                    <div className="relative z-10">
                        <img src="/escucha-logo.png" alt="EscuchaLAB" className="w-full max-w-[560px] drop-shadow-[0_0_40px_rgba(255,255,255,0.06)]" />
                        <p className="mt-6 text-muted max-w-[34ch] leading-relaxed">
                            Laboratorio de comprensión auditiva. Diálogos, voces y ambiente reales, generados a tu nivel.
                        </p>
                        <div className="flex items-end gap-1 h-12 mt-9" aria-hidden="true">
                            {[40,75,55,100,65,85,45,70,90,50,80,60].map((h, i) => (
                                <span key={i} className="w-1 rounded-sm bg-gradient-to-t from-white/25 to-accent animate-eq" style={{ height: `${h}%`, animationDelay: `${(i % 6) * 0.09}s` }} />
                            ))}
                        </div>
                    </div>

                    <div className="relative z-10 flex items-center justify-between">
                        <div className="font-mono text-[11px] text-faint uppercase tracking-[0.14em]">v4.0 · rediseño</div>
                        <button onClick={handleResetKey} className="text-faint hover:text-fg transition-colors text-[11px] font-mono uppercase tracking-[0.14em] flex items-center gap-2">
                            <Key size={11} /> Configuración de clave
                        </button>
                    </div>
                </div>

                {/* RIGHT: CONFIG */}
                <div className="w-full md:w-[56%] lg:w-[58%] md:h-[100dvh] md:overflow-y-auto bg-ink">
                    <div className="min-h-full flex flex-col">
                        {/* Mobile Header */}
                        <div className="md:hidden px-6 pt-8 pb-2 flex items-center justify-between">
                            <img src="/escucha-logo.png" alt="EscuchaLAB" className="h-9 w-auto" />
                            <button onClick={handleResetKey} className="text-faint hover:text-fg transition-colors" title="Configuración de clave" aria-label="Configuración de clave">
                                <Key size={16} />
                            </button>
                        </div>

                        <div className="flex-1 px-6 py-8 sm:px-10 md:p-12 space-y-8">

                            {/* --- MODE SELECTOR --- */}
                            <div>
                                <label className="block text-xs font-medium text-muted mb-3">Modalidad de práctica</label>
                                <div className="grid grid-cols-3 gap-2.5">
                                    {MODES.map((m) => {
                                        const active = state.config.mode === m.value;
                                        return (
                                        <button
                                            key={m.value}
                                            onClick={() => setState({ ...state, config: { ...state.config, mode: m.value } })}
                                            className={`flex flex-col items-center justify-center gap-2.5 rounded-2xl border px-2 py-4 transition-all ${active ? 'bg-white/[0.06] text-fg border-accent/50' : 'bg-panel text-muted border-line hover:border-faint hover:text-fg hover:-translate-y-0.5'}`}
                                        >
                                            <m.icon size={22} strokeWidth={1.7} />
                                            <span className="font-display font-semibold text-[13px] text-center leading-tight">{m.label}</span>
                                        </button>
                                        );
                                    })}
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
                                <div>
                                    <label className="block text-xs font-medium text-fg mb-2">Tema específico de vocabulario</label>
                                    <div className="relative">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" size={18} />
                                        <input
                                            type="text"
                                            value={vocabTopic}
                                            onChange={(e) => setVocabTopic(e.target.value)}
                                            placeholder="Ej: Astrofísica, cocina vegana, arquitectura gótica…"
                                            className="w-full rounded-xl border border-line bg-panel py-4 pl-12 pr-4 font-sans text-lg text-fg outline-none transition-all focus:border-accent focus:ring-2 focus:ring-white/10 placeholder:text-faint"
                                            autoFocus
                                        />
                                    </div>
                                    <p className="mt-2 text-xs text-faint">Se generará un diálogo denso en terminología sobre este tema.</p>
                                </div>
                            )}

                            {/* MODE: ACCENT CHALLENGE */}
                            {state.config.mode === AppMode.AccentChallenge && (
                                <div className="rounded-2xl border border-line bg-panel p-6">
                                    <div className="w-11 h-11 rounded-xl bg-panel-2 border border-line flex items-center justify-center mb-4">
                                        <Mic2 size={22} className="text-fg" />
                                    </div>
                                    <h3 className="font-display text-xl font-semibold text-fg mb-2">Reto de escucha a ciegas</h3>
                                    <p className="text-sm text-muted leading-relaxed">
                                        Dos hablantes de <strong className="text-fg font-medium">diferentes regiones</strong> hispanohablantes conversarán.
                                        Tu objetivo es identificar su origen por su vocabulario, gramática y expresiones.
                                    </p>
                                </div>
                            )}

                            {/* --- FOOTER SETTINGS --- */}
                            <div className="pt-6 border-t border-line-soft grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Accent Selector: HIDE in AccentChallenge */}
                                {state.config.mode !== AppMode.AccentChallenge && (
                                    <SelectInput
                                        label="Acento preferente"
                                        value={state.config.accent}
                                        options={ACCENTS}
                                        onChange={(e: any) => {
                                            const newAccent = e.target.value as Accent;
                                            storeDefaultAccent(newAccent);
                                            setState({ ...state, config: { ...state.config, accent: newAccent } });
                                        }}
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

                            {/* --- ADVANCED: CUSTOM PROMPTS --- */}
                            {/* Instrucciones libres para el guion y para los ejercicios. Son
                                aditivas: se apilan sobre las reglas pedagógicas, no las
                                sustituyen (el verificador y los motores siguen filtrando). */}
                            <div className="rounded-2xl border border-line bg-panel-2 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvancedPrompts(v => !v)}
                                    aria-expanded={showAdvancedPrompts}
                                    className={`w-full flex items-center gap-2.5 px-4 py-4 text-left transition-colors ${showAdvancedPrompts ? 'text-fg border-b border-line-soft' : 'text-muted hover:text-fg'}`}
                                >
                                    <Terminal size={14} />
                                    <span className="text-sm font-medium">Instrucciones personalizadas</span>
                                    {(customAudioPrompt.trim() || customExercisePrompt.trim()) && (
                                        <span className="w-2 h-2 rounded-full bg-accent" title="Instrucciones activas" />
                                    )}
                                    {showAdvancedPrompts
                                        ? <ChevronUp size={16} className="text-faint ml-auto" />
                                        : <ChevronDown size={16} className="text-faint ml-auto" />}
                                </button>

                                {showAdvancedPrompts && (
                                    <div className="p-4 space-y-5">
                                        <div>
                                            <label className="block text-xs font-medium text-muted mb-2">Guion del audio</label>
                                            <textarea
                                                value={customAudioPrompt}
                                                onChange={(e) => setCustomAudioPrompt(e.target.value)}
                                                rows={3}
                                                placeholder="Ej: que uno de los personajes esté nervioso; una charla entre tres amigos; incluye un malentendido gracioso…"
                                                className="w-full rounded-xl bg-panel border border-line p-3 font-sans text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-white/10 transition-all placeholder:text-faint resize-y"
                                            />
                                            <p className="mt-1.5 text-xs text-faint leading-relaxed">
                                                Ajusta el contenido del diálogo: tono, personajes, giro… y si lo pedís, más de dos hablantes (hasta 4; con tres o más voces cuesta alguna generación extra y se distinguen menos). No cambia el nivel ni el acento.
                                            </p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-muted mb-2">Ejercicios</label>
                                            <textarea
                                                value={customExercisePrompt}
                                                onChange={(e) => setCustomExercisePrompt(e.target.value)}
                                                rows={3}
                                                placeholder="Ej: céntrate en los conectores; que las preguntas sean más difíciles; enfatiza el vocabulario de negocios…"
                                                className="w-full rounded-xl bg-panel border border-line p-3 font-sans text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-white/10 transition-all placeholder:text-faint resize-y"
                                            />
                                            <p className="mt-1.5 text-xs text-faint leading-relaxed">
                                                Orienta las preguntas dentro de los formatos y etapas ya previstos. Las claves se siguen verificando contra el audio.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Sticky generate button */}
                        <div className="sticky bottom-0 px-6 sm:px-10 md:px-12 pb-6 pt-4 bg-gradient-to-t from-ink via-ink/95 to-transparent">
                            <button
                                onClick={() => void handleGenerate()}
                                className="w-full py-5 rounded-2xl bg-accent text-ink font-display text-xl font-semibold tracking-tight hover:brightness-105 active:brightness-95 transition-all flex items-center justify-center gap-3 group shadow-[0_12px_34px_-12px_rgba(255,255,255,0.4)]"
                            >
                                {state.config.mode === AppMode.AccentChallenge ? 'Iniciar reto' : 'Generar lección'}
                                <ArrowRight size={22} className="group-hover:translate-x-1.5 transition-transform" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- SCREEN: READY (Main App) ---
    const modeBadge = state.config.mode === AppMode.Standard ? 'STD' : (state.config.mode === AppMode.Vocabulary ? 'VOC' : 'RETO');
    return (
        <div className="min-h-[100dvh] md:h-[100dvh] flex flex-col bg-ink md:overflow-hidden">
            {/* TOP BAR */}
            <header className="h-14 flex-none border-b border-line flex items-center justify-between px-4 sm:px-6 bg-ink/85 backdrop-blur-md sticky top-0 z-30">
                <button className="flex items-center gap-2.5 group" onClick={resetApp} title="Volver a la configuración">
                    <span className="w-2 h-2 rounded-[3px] bg-accent shadow-[0_0_12px_rgba(244,246,248,0.5)]"></span>
                    <span className="font-display font-bold tracking-tight text-xl sm:text-2xl group-hover:text-fg transition-colors">Escucha<span className="text-faint">LAB</span></span>
                </button>
                <div className="flex items-center gap-2 sm:gap-3">
                    {currentCacheKey && (
                        <button
                            onClick={() => void handleRegenerate()}
                            title="Genera una lección nueva para esta misma configuración"
                            className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-faint hover:text-fg"
                        >
                            <RefreshCw size={13} />
                            <span className="hidden sm:inline">Regenerar</span>
                        </button>
                    )}
                    <span className="hidden sm:inline-flex items-center rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-muted">
                        NIV · {state.config.level.split(' ')[0]}
                    </span>
                    {state.config.mode !== AppMode.AccentChallenge && (
                        <span className="hidden md:inline-flex items-center rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-muted">
                            AC · {state.config.accent.split(' ')[0]}
                        </span>
                    )}
                    <span className="inline-flex items-center rounded-lg border border-accent/40 bg-white/[0.06] px-2.5 py-1.5 font-mono text-[11px] text-fg">
                        {modeBadge}
                    </span>
                </div>
            </header>

            <div className="flex-1 flex flex-col md:flex-row md:min-h-0">

                {/* LEFT RAIL: CONTEXT & PLAYER */}
                <aside className="w-full md:w-[35%] lg:w-[32%] flex flex-col md:border-r md:border-line md:min-h-0 bg-gradient-to-b from-[#0d1014] to-[#0b0d10]">
                    <div className="px-6 pt-6 md:p-8 md:flex-1 md:overflow-y-auto">
                        {state.lessonPlan && (
                            <div>
                                <span className="inline-flex items-center rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-muted mb-5">
                                    {state.lessonPlan.communicativeFunction}
                                </span>
                                <h1 className="font-display text-3xl md:text-[2.1rem] font-semibold leading-[1.05] mb-5 text-fg break-words">
                                    {state.lessonPlan.title}
                                </h1>
                                <p className="text-[15px] text-muted leading-relaxed border-l-2 border-accent pl-4 mb-6">
                                    {state.lessonPlan.situationDescription}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Player: docked in rail on desktop, fixed to bottom on mobile */}
                    <div className="md:mt-auto md:border-t md:border-line max-md:fixed max-md:bottom-0 max-md:inset-x-0 max-md:z-40 max-md:px-2 max-md:pb-2 max-md:pointer-events-none">
                        <div className="max-md:pointer-events-auto max-md:rounded-2xl max-md:border max-md:border-line max-md:bg-panel max-md:shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.8)] max-md:overflow-hidden">
                        {audioError ? (
                            <div className="p-4 flex gap-3 items-center bg-panel-2">
                                <AlertTriangle className="text-fg flex-shrink-0" size={20} />
                                <div className="flex flex-col min-w-0">
                                    <span className="text-xs text-fg font-medium">Error de audio</span>
                                    <span className="font-mono text-[10px] text-faint truncate">{audioError.substring(0, 60)}…</span>
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
                                downloadName={state.lessonPlan?.title}
                            />
                        ) : (
                            <div className="p-4 text-center font-mono text-xs text-faint uppercase tracking-wider">
                                Inicializando audio…
                            </div>
                        )}
                        </div>
                    </div>
                </aside>

                {/* RIGHT PANEL: CONTENT */}
                <main className="flex-1 flex flex-col md:min-h-0 bg-ink">
                    {/* Tabs */}
                    <div className="flex gap-1 px-4 sm:px-6 pt-3 border-b border-line flex-none sticky top-14 md:static z-20 bg-ink">
                        {[
                            { id: 'exercises', label: 'Ejercicios' },
                            { id: 'transcript', label: 'Transcripción' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`relative px-4 py-3 font-display text-[15px] font-semibold rounded-t-lg transition-colors
                                ${activeTab === tab.id ? 'text-fg' : 'text-muted hover:text-fg'}`}
                            >
                                {tab.label}
                                {activeTab === tab.id && <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-accent rounded-full"></span>}
                            </button>
                        ))}
                    </div>

                    {/* Content Area */}
                    <div className="md:flex-1 md:overflow-y-auto px-4 sm:px-6 py-7 pb-32 md:pb-10">

                        {/* TRANSCRIPT VIEW */}
                        {activeTab === 'transcript' && (
                            <div className="max-w-2xl mx-auto">
                                <div className="flex items-start gap-3 rounded-xl border border-line bg-panel-2 p-4 mb-8">
                                    <AlertTriangle size={16} className="text-muted flex-shrink-0 mt-0.5" />
                                    <p className="text-[13px] leading-relaxed text-muted">
                                        La transcripción es material de apoyo para el final.
                                        {hasAnticipationStage && ' Empezá por «Antes de escuchar».'} Si la leés
                                        antes de trabajar el audio, los ejercicios pasan a medir comprensión
                                        lectora y no auditiva.
                                    </p>
                                </div>
                                <div className="flex flex-col">
                                    {state.lessonPlan?.dialogue?.map((line, idx) => (
                                        <div key={idx} className="grid grid-cols-[76px_1fr] gap-4 py-3 border-b border-line-soft last:border-0 group">
                                            <div className="font-mono text-[11px] text-faint pt-1 text-right leading-relaxed">
                                                {line.speaker}
                                                {line.emotion && (
                                                    <span className="block text-faint/70 mt-1 normal-case">[{line.emotion}]</span>
                                                )}
                                            </div>
                                            <div className="border-l-2 border-line pl-4 group-hover:border-faint transition-colors">
                                                <p className="text-[16px] text-muted leading-relaxed group-hover:text-fg transition-colors">
                                                    {line.text}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* EXERCISES VIEW — recorrido por etapas de escucha */}
                        {activeTab === 'exercises' && (
                            <div className="max-w-2xl mx-auto flex flex-col gap-4">
                                {stagedExercises.length === 0 && (
                                    <p className="text-sm text-muted">
                                        No se pudo construir ningún ejercicio verificable para este audio.
                                    </p>
                                )}
                                {stagedExercises.map(group => {
                                    const isOpen = openStages.has(group.stage);
                                    const keyOf = (ex: Exercise, idx: number) => ex.id || `${group.stage}_${idx}`;
                                    const done = group.items.filter((ex, idx) => keyOf(ex, idx) in answered).length;
                                    const total = group.items.length;
                                    const pct = total ? Math.round((done / total) * 100) : 0;
                                    const allDone = done === total && total > 0;
                                    return (
                                    <section key={group.stage} className={`rounded-2xl border bg-panel overflow-hidden transition-colors ${isOpen ? 'border-accent/25' : 'border-line'}`}>
                                        <button
                                            type="button"
                                            onClick={() => toggleStage(group.stage)}
                                            aria-expanded={isOpen}
                                            className="w-full text-left flex items-center gap-3.5 px-4 sm:px-5 py-4 group"
                                        >
                                            <span className="font-mono text-[12px] text-faint">
                                                {String(group.position).padStart(2, '0')}
                                            </span>
                                            <h3 className="font-display text-lg font-semibold text-fg flex-1 group-hover:text-fg transition-colors">
                                                {STAGE_META[group.stage].label}
                                            </h3>
                                            {/* progress ring */}
                                            <span
                                                className="relative w-7 h-7 rounded-full grid place-items-center flex-none"
                                                style={{ background: `conic-gradient(${allDone ? '#f4f6f8' : '#c4cace'} ${pct}%, #20262d 0)` }}
                                                title={`${done}/${total} resueltos`}
                                            >
                                                <span className="absolute inset-[3px] rounded-full bg-panel" />
                                                <span className="relative z-10 font-mono text-[9px] font-bold text-fg tabular-nums">{done}/{total}</span>
                                            </span>
                                            {isOpen
                                                ? <ChevronUp size={17} className="text-faint flex-shrink-0" />
                                                : <ChevronDown size={17} className="text-faint flex-shrink-0" />}
                                        </button>
                                        {isOpen && (
                                            <p className="px-4 sm:px-5 -mt-1 pb-3 text-[13px] text-faint leading-relaxed">
                                                {STAGE_META[group.stage].hint}
                                            </p>
                                        )}
                                        {/* Ocultas, no desmontadas: el estado de corrección vive
                                            dentro de cada tarjeta, así que desmontarlas haría que
                                            plegar una etapa para mirar otra borrase lo respondido. */}
                                        <div hidden={!isOpen} className="px-2 sm:px-3 pb-3 flex flex-col gap-3">
                                            {group.items.map((ex, idx) => (
                                                <ExerciseCard
                                                    key={keyOf(ex, idx)}
                                                    exercise={ex}
                                                    index={idx}
                                                    dialogue={state.lessonPlan?.dialogue}
                                                    onAnswered={correct => markAnswered(keyOf(ex, idx), correct)}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default App;
