# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EscuchaLAB** is an AI-powered Spanish listening practice application that generates level-appropriate dialogues, audio, and exercises based on the CEFR framework. The app uses Google's Gemini API for content generation and text-to-speech, and a bundled, scenario-aware ambient sound engine (12 reusable rendered stems mixed per scene, plus live synthesised events) to make dialogues feel situated in their context.

Built with: React 19, TypeScript, Vite, Google GenAI SDK, Tailwind CSS (via CDN in index.html)

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

### Environment Setup
- Create `.env.local` file with `GEMINI_API_KEY=your_key_here`
- API key is also stored in localStorage under `gemini_api_key` for persistence
- The app validates keys starting with "AIza" prefix

### Vite Configuration
- Dev server runs on port 3000 (host: 0.0.0.0)
- Path alias `@/*` resolves to project root
- Gemini API key injected via `process.env.GEMINI_API_KEY`

## Architecture

### State Management
The app uses a single `AppState` object managed in `App.tsx` with the following flow:
1. **auth** - API key entry screen
2. **idle** - Configuration screen (landing page)
3. **generating_plan** - AI generating lesson content
4. **generating_audio** - TTS generating audio
5. **ready** - Main lesson interface with audio player and exercises
6. **error** - Error display screen

### Core Data Flow
1. User configures lesson parameters (level, mode, topic, accent, length, format)
2. `generateLessonPlan()` in `geminiService.ts` creates structured lesson content
3. `generateAudio()` converts dialogue to speech with appropriate voice profiles
4. AudioPlayer resolves a `SceneRecipe` (`services/ambiencePresets.ts`) from the scenario label, text type, topic and the model's scene hint, and `services/ambienceEngine.ts` mixes the recipe's bundled stems in a synthetic room with live synthesised events
5. User interacts with transcript, comprehension, and vocabulary tabs

### App Modes (AppMode enum)
- **Standard**: Scenario-based dialogues using matrix selector (Locus × Modus)
- **Vocabulary**: Topic-focused dialogue with dense terminology
- **AccentChallenge**: Two speakers from random different regions; user guesses origins

### Level System (Level enum)
Levels differ in the *listening sub-skills* they train, not just in exercise difficulty. What each level can and cannot be asked is declared in `data/listeningSyllabus.ts` (see Exercise System below).
- **Intro (A0)**: Natural-speed native audio; the learner decodes *data*, not clauses. **Three exercises, all anchored to the dictated datum**: what the situation is, a data-capture form whose mandatory field *is* that datum, and minimal-pair discrimination on the digits/letters it is made of. No turn-ordering, no matching, no inference, no register judgements — and no pre-listening prediction or metacognitive wrap-up either, since both are reading tasks in a language the learner does not yet read.
- **Beginner (A1-A2)**: Topic and outcome of the exchange, sequence of actions, data capture, chunk reconstruction and routine formulae — **five exercises**. Roles are named by their concrete part (client/clerk — never abstract "formal/informal", which is B1+). `matching` and `spot_the_difference` are deliberately *not* used here (they remain in Vocabulary mode and B1+): stacking them on top of `ordering` and `chunk_order` made a single lesson ask for ~36 discrete answers.
- **Intermediate (B1-B2)**: Bridging inference, fact vs. opinion, problem↔solution, graded attitude, lexical precision and collocation. Introduces V/F/NOT GIVEN to penalise over-inference.
- **Advanced (C1)**: Implicature, irony, subtext, rhetorical organisation, hedging, diaphasic/diastratic variation.

### Scenario Database (`data/scenarios.ts`)
- Hierarchical structure: `Level → ScenarioContext (Locus) → ScenarioAction (Modus)`
- Each level has curated contexts (physical settings) with specific actions (situations)
- Icons from lucide-react for visual representation
- Used in Standard mode for matrix selector interface

### Dialect System (`services/geminiService.ts`)
Extensive dialect profiles in `DIALECT_PROFILES` covering:
- **Spain**: Madrid (leísmo, vosotros), Andalusia (ustedes, elisión)
- **Americas**: Mexico City (diminutivos, ustedeo), Bogotá (ustedeo familiar), Caribbean (no inversión), Argentina (voseo), Chile (voseo mixto, "po"), Peru (tuteo, "pe")

Key implementation notes:
- Each profile includes grammar, pragmatics, and lexicon
- AccentChallenge mode randomly selects two different accents
- Audio generation maps characters to voices: Male→Fenrir/Puck, Female→Kore
- Multi-speaker TTS uses internal "SpeakerA"/"SpeakerB" mapping for API robustness

### Audio Generation
- Uses `gemini-2.5-flash-preview-tts` model
- Sanitizes text to remove stage directions (*, [], ()) before TTS
- Multi-speaker config with voice assignment based on character gender, computed **once** over the whole dialogue and reused for every chunk
- Returns base64-encoded audio data
- Error handling for "non-audio response" rejections
- **Chunked at turn boundaries** (`chunkDialogueLines`): the phonetic profile prepended to every request eats 2196-3407 of the 5000-character budget, and the old code just did `substring(0, 5000)` — a `Largo` dialogue in Buenos Aires or Lima silently lost its last turns mid-sentence while the exercises kept asking about them. `ttsDialogueBudget(accent)` computes what is actually left, and no turn is ever dropped. Chunks are also used for speed above `TURNS_BEFORE_SPLITTING` turns, generated with `TTS_CONCURRENCY = 2` (three in parallel gets 429/503 from the API) and concatenated with a 5 ms fade at each seam (`concatPcmChunks`). **Each chunk is one more request against the TTS quota**, so short lessons deliberately stay in a single call. The chunking is internal to `generateAudio()`: it still takes the same arguments, still reports through `ProgressReporter`, and still returns one base64 PCM track.

### Ambient Sound System

Fully self-contained — no external API calls, no CORS/rate-limit/key-exposure risk in
production. The design unit is a **scene recipe**, not an audio file.

**Why it was rebuilt.** The previous system baked one monolithic bed per
`EnvironmentProfile`: five files, and the result was that every scenario sounded like
rain regardless of context. Three independent causes, all measurable:
- The five beds were the same recipe — 2-3 layers of *stationary* filtered noise summed
  at fixed gains and normalised **by peak**, which let the brown-noise layer set the
  level. 62-77% of their energy sat below 250 Hz and their short-term loudness range
  was 2.2-3.7 dB, where a real field recording spans 15-25 dB. Statistically they were
  indistinguishable from stationary noise, which is exactly what rain is. The `nature`
  bed in particular (lowpassed pink + bandpassed white, no amplitude modulation) *was*
  the textbook rain synthesis recipe.
- 30 of the 40 curated scenarios resolved to `OFFICE` and played the identical file — a
  workshop, an art gallery, a wine tasting and a gym all shared one texture. `NATURE`
  was unreachable, and the 108 RadioNews/Podcast/Monologue labels fell through a
  keyword regex to `ROOM`, the emptiest bed of the five.
- 23 of the 38 `AmbienceTag`s had no generator at all, so a café carried a `kitchen` tag
  and never produced a plate. The live "crowd babble" filtered one shared noise buffer
  through several wide bandpasses, so the voices were perfectly correlated and summed
  to one hiss; its syllabic envelope modulated a gain into negative values, so syllables
  never articulated.

**Architecture.** 12 reusable stems, mixed per scene at runtime:
- `public/ambience/*.wav` — 12 bundled stems (~8.9 MB total, less than the 5 old beds):
  `babble_close`, `babble_hall`, `babble_open`, `traffic_near`, `traffic_far`,
  `kitchen`, `hvac_office`, `room_tone`, `studio_tone`, `transit_hum`, `rain`,
  `wind_leaves`. Sample rate and channel count are chosen per stem by content (8-24 kHz,
  mono except the two that carry the most spatial information).
- `services/ambiencePresets.ts` — ~40 `SceneRecipe`s (stems + gains + room + events) and
  the mapping from all **148** `ScenarioContext.label`s, layered by `TextType`: a radio
  bulletin is heard from a studio, not from the place it is about. `bedLevel()` computes
  a scene's nominal bed amplitude from `STEM_LEVELS_DBFS`.
- `services/ambienceEngine.ts` — framework-free runtime engine. Mixes the recipe's stems
  (each shaped, stereo-widened, entering its loop at a random offset), builds a room
  impulse response with early reflections and frequency-dependent decay, and schedules
  ~39 synthesised event kinds.
- `scripts/ambience/{dsp,voice,events,stems,preview}.mjs` — the offline synthesis
  toolkit. `voice.mjs` is the highest-leverage piece: a source-filter voice (Rosenberg
  glottal pulses with jitter → 4 resonant formants on real Spanish vowels → syllable
  envelopes that reach true silence → phrase structure with pauses), plus a **separate
  frication path**. That separation matters: frication used to be summed into the
  source and pushed through the vowel formant bank, whose loud resonators sit at
  300-900 Hz, so /s/ and /f/ were filtered away before they existed and the crowd
  stems ended up with 53-77% of their whole spectrum inside the single 250-500 Hz
  octave. `renderBabble` also splits the crowd into a near foreground (2-3 voices,
  taking turns) and a genuinely distant wash — summing a dozen equally-close voices
  averages their syllable envelopes away (depth falls as 1/√N) and the result measures
  as stationary noise.

**Key invariants**
- **The bed has to actually play.** For one release it did not, in any scene:
  `loadStems()` captured a generation counter in the constructor and `start()`
  incremented it synchronously before any fetch could resolve, so the guard was always
  unequal and every layer was dropped. All a learner heard were the synthesised
  one-shots over silence — "little noises that have nothing to do with a bar".
  `check:ambience:runtime` now instantiates the real engine against a fake
  `AudioContext` and asserts a source starts per layer, in all 42 scenes.
- **`gain` means the same thing in every synth.** Noise buffers are normalised to a
  common RMS and modal stacks are renormalised so they peak at their loudest partial
  rather than at the sum of four. Without this a `gain` of 1 spanned ~15 dB depending
  on which synth read it, and it was biased the wrong way: the pingy sine-stack events
  came out loudest, the naturalistic noise ones quietest.
- **Events are scaled against the scene's bed** (`bedLevel() * EVENT_OVER_BED`), never by
  a fixed makeup gain. Beds span ~20 dB across scenes, so a global gain puts the same
  footstep 11 dB over a café and 25 dB over a therapy room. The loudest spec in the
  catalogue lands +6 dB over the bed; the typical one within a couple of dB.
- **A density budget, not per-recipe restraint.** `MAX_EVENT_ONSETS_PER_MIN` caps how
  often a scene puts a discrete sound in front of the listener, and the engine stretches
  every interval to fit. Recipes were authored at up to ~92 occurrences/minute, and the
  naive count hid the worst of it because several synths are clusters — one `typing`
  occurrence is 16 key hits — so `EVENT_CLUSTER_SIZE` weights each kind by the root of
  its cluster size.
- **The limiter is a safety device, not a program compressor.** The old settings
  (−6 dB, 20:1, 250 ms release, events driven ×42) meant every clink ducked the whole
  bed for a quarter second.
- **Near/mid/far event buses.** Each is a real distance — lowpass plus reverb send —
  not a gain trim. `mid` used to be a bare ×0.7 with no filtering, and two thirds of all
  specs are `mid`, so the depth system was mostly bypassed. Nothing is bone dry: a
  perfectly dry clink inside a room is impossible and is the strongest cue that an event
  is pasted on top rather than happening in the same place as the bed.
- **`room.wet` is applied once, at the return.** Applying it at the sends too (which it
  was) returns the bed at wet² — −39 dB in a café — so the bed was dry while the events
  got the room.
- **Events are band-limited to the scene's bed.** Stems are baked at 8-24 kHz and carry
  nothing above 4-12 kHz; events synthesise to the context rate. Events living in a band
  where the bed does not exist can never be masked by it, so they float on top as a
  separate layer.
- **Outdoor scenes get almost no reverb tail** (`ROOM_PARAMS.outdoor`). Giving a street a
  1.1 s tail is one of the reasons everything used to sound like an interior.
- **Every `EventKind` has a synth**, asserted by `check:ambience` — tags can no longer be
  dead code.
- **Node lifecycle**: event nodes are released on completion rather than accumulating
  for the whole lesson; events are scheduled against `ctx.currentTime` with a lookahead
  rather than fired from `setTimeout`, which browsers throttle to ≥1 s in background tabs.
- **Ducking is asymmetric** (~12 ms attack, ~420 ms release) so the bed stops pumping
  between syllables.
- **Fail-safes**: `ensureAudioContext()` creates/resumes one `AudioContext` on the first
  user gesture (never born suspended) and self-heals via `onstatechange`. If Web Audio is
  unavailable, speech falls back to the plain `<audio>` element. A stem that fails to
  load is skipped; the scene plays with the rest.
- **Non-repetitive**: per-playback RNG salt, and each stem plays from
  `PLAYHEADS_PER_STEM` offset heads at slightly different rates, so a 14-24 s buffer is
  never heard as a loop across a three-minute lesson. Once a listener has heard a loop
  twice they hear it as a loop forever, and no amount of spectral work fixes that.
- Ambience volume / intensity / ducking and a mute toggle persist in `localStorage`
  (`ambience_prefs_v1`) — `App.tsx` remounts the player per lesson, so plain state reset
  them every time.

**Working on it**
- `npm run ambience:build` regenerates all 12 stems (deterministic — re-running gives
  byte-identical files). Pass stem names to rebuild a subset. It prints each stem's
  measurements and flags any that miss their targets.
- `npm run ambience:preview -- cafe street station` renders complete scene mixes to
  `.ambience-preview/*.wav` so you can **listen** without a browser or an API key. Run
  with no arguments to list the scenes, or `--all`.
- Beware when tuning a near-stationary support stem: raising its event *rate* fills in
  the quiet windows and so **reduces** the measured loudness range. That range has to
  come from the slow swell.
- Adding a scene costs a recipe, not another 2 MB of audio. Adding a stem means adding it
  to `STEMS` (stems.mjs), `StemId` + `STEM_LEVELS_DBFS` (ambiencePresets.ts), and
  referencing it from at least one recipe — `check:ambience` enforces all three.

### Exercise System

The exercise system is organised around a **listening syllabus**, not around rendering widgets. The unit of design is the pair *(listening stage × listening skill)*; the format is only the mechanic used to answer. Hard rule everywhere: **no written or spoken production** — everything is resolved by selecting, ordering, classifying or picking from a dropdown.

**Three axes (`types.ts`)**
- `ListeningStage`: `anticipacion` → `global` → `selectiva` → `intensiva` → `reflexion`. This is the order the UI renders.
- `ListeningSkill`: 14 sub-skills (`decodificacion`, `segmentacion`, `reconocimiento_lexico`, `dato_literal`, `idea_global`, `estructura`, `rol_fuente`, `inferencia`, `actitud_postura`, `pragmatica_registro`, `lexico_significado`, `colocacion_formula`, `variacion_dialectal`, `estrategia`).
- `ExerciseType`: 12 formats — the original five (`multiple_choice`, `true_false`, `ordering`, `classification`, `cloze`) plus `true_false_notgiven`, `matching` (bijective), `scale` (ordinal axis), `data_capture` (form with near-identical dropdowns), `minimal_pairs`, `spot_the_difference` (dictation without typing) and `chunk_order` (rebuild one sentence from breath groups).

`LessonPlan.exercises` is a **flat `Exercise[]`** ordered by stage. Each `Exercise` carries `stage`, `skill`, `slotId` and `sourceTurns` (dialogue indices, revealed in the feedback panel).

**`data/dataPoints.ts` — the dictated datum, as a first-class value**
At A0 and A1-A2 the topic decides which concrete datum the dialogue *must* contain (`inferDataPoint()` → `phone`, `price`, `time`, `spelling`…). That decision used to live inside `generateLessonPlan()` and die there, so the exercises never knew what had been dictated and the data-capture slot could land on anything. Now the `DataPointKind` travels to all three places that need it: the dialogue prompt (`instruction`), the exercise briefs (`{{dato}}`, `{{campo}}`, `{{contrastes}}`, interpolated by `getBlueprint(level, textType, mode, dataPoint)`) and the deterministic engines (`ExerciseSlot.focus`).

**`data/listeningSyllabus.ts` — the pedagogical source of truth**
- **Exercise budget per level.** `scripts/check-syllabus.mjs` caps lessons at 4 / 6 / 9 / 10 slots (A0 / A1-A2 / B1-B2 / C1). The blueprint *is* the lesson — there is no trimming step downstream — so a slot added to a low level has to displace another one.
- `FORMAT_RULES[format]`: allowed levels and text types, the exact JSON shape shown to the model, and the authoring rules. Level gating applies **only** to formats whose mechanic itself carries the cognitive load (`ordering`, `matching`, `scale`, `true_false_notgiven`, `spot_the_difference`, `chunk_order`). For the rest the widget is neutral and the difficulty lives entirely in the slot's `brief`.
- `getBlueprint(level, textType, mode)`: composes level templates → resolves each `brief` for the text type → filters structurally. **`textType` genuinely matters**: a radio bulletin (one speaker) never gets "who says it", a monologue gets real-chronology vs. narration order, a podcast gets question↔answer matching, news gets inverted-pyramid ordering and source attribution.
- Mode overrides: `Vocabulary` now scales by level (A0 sound recognition → C1 nuance and connotation); `AccentChallenge` teaches the cues (minimal pairs on the discriminating feature → lexis by speaker) before asking for the country.

**Generation pipeline (`services/geminiService.ts`)**
1. `buildExercisePrompt(blueprint)` generates the `EXERCISES:` block from the slots — there is no hand-written prose per level any more.
2. `verifyExercises(raw, dialogue)` (`services/exerciseVerification.ts`) checks both internal coherence (keys point to existing ids, matchings are bijections, orderings are permutations, no degenerate items) **and fidelity to the audio** (cloze targets, chunk reconstructions and captured data must actually be said; tokens marked as altered must not appear in the source turn). Anything that fails is dropped — never shown with a false key.
3. `fillMissingSlots(verified, blueprint, dialogue)` (`services/exerciseEngines.ts`) fills empty slots with deterministic engines, **in the slot's position**, and everything it builds goes through the same verifier.

**Deterministic engines** read `slot.focus` so the fallback lands on the datum too. They understand a datum dictated **in words** (`seis cinco cuatro treinta y dos…`, which is what the A0 prompt actually asks for) as well as in digits, and they group `654 32 18` into one `Teléfono` field instead of three loose `Número` ones. Word-run distractors change exactly one numeral and stay grammatical — `treinta y dos` → `cuarenta y dos`, never `veinte y dos`. Engines exist only where a provably correct exercise can be derived from the transcript. There is deliberately **no `ordering` or `matching` engine**: both need paraphrase, and an automatic paraphrase cannot be verified. Distractors are **phonetic neighbours** of words that are actually said (see `MINIMAL_PAIR_BANK`), never topic-related words, which would be discardable by plausibility without listening. Contrasts neutralised in most varieties (b/v, ll/y, silent h, and c/z~s under seseo) are excluded on purpose.

**Never** show learners the normalised form of a word: `normalizeText()` in `services/textUtils.ts` is for comparison only. Display always keeps real orthography, accents and capitals included.

### Progress Reporting (loading screens)

The loading screens used to animate an invented script with `setTimeout`: the bar
advanced on a clock rather than on work done, and the log narrated stages that do
not exist ("Procesando fonemas y prosodia…"). Now every figure on screen is a
measurement.

- `services/generationProgress.ts`: `ProgressReporter` + `ProgressSnapshot`. Services
  report **facts** (`start`/`update`/`finish`/`fail`/`log`) and the UI renders them.
  Emissions are throttled to ~90 ms with a trailing flush, so no measurement is lost.
- **Both Gemini calls are streamed** (`generateContentStream`), which is what makes
  measurement possible at all: a single opaque request has nothing to report between
  send and response. Two streaming attempts with exponential backoff, then a
  non-streaming attempt as a fail-safe — if the model or the network can't stream,
  generation still succeeds and the log says so.
- **Phase 1 (`generateLessonPlan`)**: blueprint (slots planned) → prompt (chars sent) →
  dialogue (turns counted in the incoming JSON) → exercises (received / expected, a real
  denominator from the blueprint) → parse (turns, speakers) → verify (kept vs. discarded,
  with the verifier's reason per item) → assemble (slots covered by the model, by a
  deterministic engine, or left empty).
- **Phase 2 (`generateAudio`)**: prepare (turns, chars, voice assignment, and how many TTS
  requests the chunking is going to make) → synthesis (bytes → seconds of PCM at
  24 kHz/16-bit as chunks arrive) → encode (final length/size).
- **A step only has a percentage if a real denominator exists.** Where none does — the
  TTS never announces total duration, and A0 explicitly tells the model to ignore the
  turn count — the step is flagged `atomic: false` + no `ratio`, the UI shows `≥ N%` with
  an indeterminate marker and the note that the service doesn't report a total, and the
  live counters carry the information instead. Never invent the number. The one exception
  is a chunked dialogue: `chunkDialogueLines()` knows how many requests it will make, so
  with more than one chunk `synthesis` reports `completed/total` requests as a genuine
  ratio. A single-chunk lesson stays indeterminate, exactly as before.
- `verifyExercises()` and `fillMissingSlots()` take optional reporting callbacks so
  discards and engine fallbacks surface on screen instead of only in `console.warn`.
- The only clock-driven element left is the elapsed-time counter, because it is a clock.

### Component Structure
- `App.tsx`: Main orchestrator (580 lines) - handles all state and screen rendering
- `AudioPlayer.tsx`: Transport, speech routing and ambience UI. The ambience engine itself lives in `services/ambienceEngine.ts` (see Ambient Sound System above); the component was 1529 lines when ~900 of them were the engine.
- `ExerciseCard.tsx`: Polymorphic renderer for the 12 formats; shows the skill badge, and on submit reveals the `sourceTurns` lines as proof of the key
- `MatrixSelector.tsx`: Locus × Modus grid interface for Standard mode
- `AuthScreen.tsx`: API key entry with localStorage persistence
- `LoadingScreen.tsx`: Measured progress of the generation (see Progress Reporting below) — it only renders what the services actually reported
- `SelectInput.tsx`: Styled select dropdown component

## Key Implementation Details

### A0 Level Special Handling
The Intro (A0) level uses a unique "realistic immersion" approach:
- Generates natural-speed native dialogue (no simplification)
- Injects a mandatory data point chosen from the topic by `inferDataPoint()` (`data/dataPoints.ts`). A1-A2 gets the same injection in a softer wording, so its data-capture slot always has material:
  - Phone numbers (digit-by-digit dictation)
  - Spelled names/surnames
  - Specific prices with cents
  - Street addresses with numbers
  - Exact times for appointments
  - Email addresses (with "arroba", "punto", "guion bajo")
- Exercises test ability to extract these specific data points from fast audio

### JSON Response Handling
- Uses `responseMimeType: "application/json"` for structured generation
- `cleanJsonString()` helper strips markdown code fences from responses
- Retry logic with exponential backoff (3 attempts, 1s → 2s delay)

### Persistence Strategy
- Generated lessons are cached in **IndexedDB** (`services/lessonCache.ts`), keyed by `{mode, level, textType, accent, length, topic}`, LRU-capped at 20 entries. The dialogue is requested with `temperature: 0.0`, so repeating a configuration used to re-pay the whole pipeline for essentially the same lesson. Only *complete* lessons (plan **and** audio) are stored — a cached lesson without audio would have to go back to the TTS anyway. `AppMode.AccentChallenge` is **never** cached: it draws two random accents per run, so its key does not describe its contents. A «Regenerar» button in the header invalidates the entry and forces a fresh lesson. The PCM is stored as raw bytes and re-encoded to base64 on read, so the app boundary is unchanged.
- API key stored in localStorage for session continuity
- Lazy initialization in `useState` prevents auth screen flash
- Storage event listener detects cross-tab key changes
- Failsafe recovery on mount if lazy init failed

### Styling Approach
- Tailwind CSS via CDN (no build-time processing)
- Custom fonts: "Bebas Neue" (display), "Space Grotesk" (sans), "Space Mono" (mono)
- Brutalist/technical aesthetic with zinc color palette
- Responsive design with md: breakpoints
- Custom scrollbar styling via `scrollbar-thin` utility

## Common Modifications

### Adding a New Dialect
1. Add enum value to `Accent` in `types.ts`
2. Create profile in `DIALECT_PROFILES` (geminiService.ts) with grammar/pragmatics/lexicon
3. Ambience is chosen by scenario/text type, not by accent, so nothing to change there unless the region needs its own scene

### Adding a New Exercise Format
1. Add the value to `ExerciseType` in `types.ts` (plus any format-specific field).
2. Add an entry to `FORMAT_RULES` in `data/listeningSyllabus.ts` with its allowed levels, allowed text types, exact `jsonShape` and authoring `guidance`. Gate by level only if the *mechanic* carries the cognitive load.
3. Add a `verify…()` branch in `services/exerciseVerification.ts` — a format with no verification can reach the learner with a wrong key.
4. Add id mapping in `services/exerciseNormalization.ts` (models return texts where the schema wants ids).
5. Add the renderer plus the `isCorrect()`/`canSubmit()` branches in `components/ExerciseCard.tsx`, and a label in `FORMAT_LABELS`.
6. Reference it from the level/mode blueprints, and optionally add a deterministic engine in `services/exerciseEngines.ts` — only if the exercise can be *proved* correct against the transcript.
7. Run `npm test`.

### Modifying Scenario Database
Edit `data/scenarios.ts`:
- Structure: `ScenarioContext` contains `label`, `value` (prompt), `icon`, `actions[]`
- Each `ScenarioAction` has `label`, `value` (specific situation), `icon`
- Icons imported from `lucide-react`

### Adjusting Gemini Models
Models defined as constants in `geminiService.ts`:
- `GENERATION_MODEL`: Currently `"gemini-3.6-flash"` (stable, faster/cheaper than 2.5-flash; fallback: `"gemini-2.5-flash"`)
- `AUDIO_MODEL`: Currently `"gemini-3.1-flash-tts-preview"` (low-latency TTS preview; fallback if unstable: `"gemini-2.5-flash-preview-tts"`)

## Important Notes

- **API Key Security**: Keys stored in localStorage and injected via Vite config; never commit `.env.local`
- **Audio Sanitization**: TTS will reject text with stage directions - always sanitize before sending
- **Speaker Mapping**: TTS requires consistent internal speaker IDs; use "SpeakerA"/"SpeakerB" mapping for robustness
- **Ambient Stems Are Bundled Assets**: `public/ambience/*.wav` ship with the app; there is no external ambient-audio API call, so there's nothing to rate-limit or fail at runtime. Regenerate/retune them with `npm run ambience:build`, and audition scenes with `npm run ambience:preview -- <scene>`.
- **Ambience is judged by ear, floored by measurement**: `check:ambience` asserts the numbers that separate "a place" from "noise" (energy below 250 Hz, short-term loudness range, spectral+dynamic distance between scenes). It cannot tell you a café sounds like a café — use `ambience:preview` for that.
- **Answer keys are verified, not trusted**: every exercise (model-generated *and* engine-generated) goes through `verifyExercise()` before rendering. It checks internal coherence and fidelity to the transcript. Prefer shipping one exercise fewer over one that teaches something false.
- **Never display normalised text**: accent-stripped, lowercased forms are for comparison only. Options shown to learners keep their real spelling.
- **Distractors must require listening**: phonetic neighbours of words actually said, never topic-adjacent words (those get discarded by plausibility) and never options that are ungrammatical in context (those get discarded by reading).
- **Accent Consistency**: In Standard/Vocabulary modes, both speakers use same accent; only AccentChallenge uses mixed accents

## Testing Approach

Automated checks (no API key or network needed) — run all with `npm test`:
- `npm run typecheck` — `tsc --noEmit`.
- `npm run check:audio` — asserts the TTS chunking never exceeds the per-accent character budget, never loses a turn (the `substring(0, 5000)` bug), keeps short dialogues in a single request, splits an oversized single turn by sentence instead of truncating it, and that the PCM concatenation preserves every sample while fading only the seam.
- `npm run check:syllabus` — walks `getBlueprint()` across the 42 valid level × text-type × mode combinations and asserts the pedagogical invariants: the per-level exercise budget, no format outside its level or text-type range, nothing presupposing two speakers in single-voice audio, A0 free of ordering/matching/scale/V-F-NG/spot-the-difference, C1 free of basic decoding formats, every lesson covering at least two stages and three distinct skills, stage order preserved, unique slot ids, existing engine fallbacks, and Vocabulary/text-type variants genuinely differing from one another.
- `npm run check:ambience` — asserts that all 148 scenario labels resolve to a curated scene (none falling through to the generic fallback, which is how 108 of them behaved before), that no scene monopolises the place-based dialogue catalogue (max 15%, where the old `OFFICE` profile held 75%), that each non-dialogue format has its own default scene, that every stem a recipe names exists and none is orphaned, that every `EventKind` has a registered synth, that the runtime's stem-level table matches what was baked, and the acoustic floor: per stem, energy below 250 Hz and short-term loudness range within the targets declared in `stems.mjs`, plus a minimum spectral+dynamic distance between the character stems, how much of each stem's energy falls in its single fullest octave (the crowd stems once held 53-77% in one octave and passed every other bound), and that no stem steps at its loop point. It cannot tell you whether a café *sounds* like a café — `npm run ambience:preview` is for that.
- `npm run check:ambience:runtime` — instantiates the **real** `AmbienceEngine` against a fake `AudioContext` (`scripts/ambience/fakeWebAudio.mjs`, with virtual timers so minutes of scene time run deterministically) and asserts what the tables alone cannot: that a source actually starts for every layer of all 42 scenes, that loading does not depend on `start()` having been called, that `stop()` cancels an in-flight load, that every bed source reaches the destination, that the scheduler keeps firing over minutes, and the mix contract — every bed lands in −40..−22 dBFS and no event sits more than 8 dB over its bed. This check exists because a 100% reproducible "no stem ever plays" bug shipped while all of `check:ambience` was green: it inspects tables and baked WAVs, and nothing exercised the engine.
- `npm run check:exercises` — feeds deliberately broken exercises (key not among the options, non-bijective matching, ordering copied verbatim from turns, V/F/NG with no NOT GIVEN item, cloze whose solution is never said, spot-the-difference flagging a word that *is* said…) to the verifier and asserts each is rejected; then asserts every deterministic engine produces exercises that pass the same verifier and never display accent-stripped text. It also pins the dictated-datum path: a phone said in words and a phone said as `654 32 18` must both yield one `Teléfono` field, and focused minimal pairs must contrast the digits rather than the greeting.

Manual checklist (needs an API key):
1. All three modes (Standard, Vocabulary, AccentChallenge).
2. All four levels generate stage-appropriate content.
3. A RadioNews and a Monologue lesson: confirm zero two-speaker exercises.
4. Vocabulary at A0 vs. C1: confirm they are no longer identical.
5. Rendering and submit/feedback for the newer formats (`data_capture`, `minimal_pairs`, `spot_the_difference`, `matching`, `scale`, `true_false_notgiven`, `chunk_order`), including the `sourceTurns` reveal.
6. Audio generation across accent/gender combinations; localStorage persistence; error handling for invalid keys.
7. Ambience: confirm the player's `N/M capas` counter reaches the total (it is the tell for a silent bed). Play a `Café / Restaurante`, a `Taxi / Transporte`, a `Taller Mecánico`, an `Aeropuerto / Aerolínea`, an `El Tiempo` (RadioNews) and a `Mi Rutina Diaria` (Podcast) — they should be recognisable blind and clearly different from one another. Check that the bed ducks under speech without pumping between syllables, that the volume/intensity/ducking/mute settings survive generating a new lesson, and that deleting `public/ambience/` degrades to a working player rather than an error.
