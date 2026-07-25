# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EscuchaLAB** is an AI-powered Spanish listening practice application that generates level-appropriate dialogues, audio, and exercises based on the CEFR framework. The app uses Google's Gemini API for content generation and text-to-speech, and a bundled, scenario-aware ambient sound engine (real recorded/rendered textures + live synthetic events) to make dialogues feel situated in their context.

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
4. AudioPlayer resolves an `AmbiencePreset` (`services/ambiencePresets.ts`) from the scenario/topic and layers a bundled ambient bed with live synthetic events
5. User interacts with transcript, comprehension, and vocabulary tabs

### App Modes (AppMode enum)
- **Standard**: Scenario-based dialogues using matrix selector (Locus × Modus)
- **Vocabulary**: Topic-focused dialogue with dense terminology
- **AccentChallenge**: Two speakers from random different regions; user guesses origins

### Level System (Level enum)
Levels differ in the *listening sub-skills* they train, not just in exercise difficulty. What each level can and cannot be asked is declared in `data/listeningSyllabus.ts` (see Exercise System below).
- **Intro (A0)**: Natural-speed native audio; the learner decodes *data*, not clauses. Number/letter/time discrimination, minimal-pair contrasts, word spotting. No turn-ordering, no matching, no inference, no register judgements.
- **Beginner (A1-A2)**: Topic and outcome of the exchange, sequence of actions, attribution to concrete *roles* (client/clerk — never abstract "formal/informal", which is B1+), frequent lexis and routine formulae.
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
- Multi-speaker config with voice assignment based on character gender
- Returns base64-encoded audio data
- Error handling for "non-audio response" rejections

### Ambient Sound System
A hybrid, fully self-contained system — no external API calls, no CORS/rate-limit/key-exposure risk in production:
- `services/ambiencePresets.ts`: maps each `ScenarioContext.label` (from `data/scenarios.ts`, ~145 entries) to an `EnvironmentProfile` (`CITY | CAFE | OFFICE | NATURE | ROOM`) and a list of `AmbienceTag`s (crowd, traffic, kitchen, footsteps, door, rain, market, etc.), with a keyword-regex fallback (`inferFallbackProfile`) for custom topics/Vocabulary/AccentChallenge modes where no scenario label exists.
- `services/ambienceLibrary.ts`: resolves each `EnvironmentProfile` to a bundled, same-origin audio file under `public/ambience/*.wav` and fetch+decodes it into an `AudioBuffer` (cached per URL).
- `scripts/generate-ambience-beds.mjs`: offline Node script that renders those five `.wav` beds (long, seamlessly-looping, layered/filtered noise textures per profile). Re-run it to regenerate or retune the beds — nothing at runtime depends on this script.
- `components/AudioPlayer.tsx`: at playback start, loads the resolved bed as a looping `AudioBufferSourceNode` layered under a rich set of live, tag-driven synthetic event generators (footsteps, door chimes, crowd babble, sirens, honks, printer bursts, rain drops, bird chirps, etc. — see the file for the full list) built with the Web Audio API. When the real bed loads, the purely-synthetic continuous "hum/air" layers are attenuated (not removed) to avoid doubling, while all discrete events stay at full richness. If the bed fails to load for any reason, playback silently continues with the (now clearly audible) synthetic-only bed — there is no user-facing failure mode.
- **Mix bus & levels**: the synthetic layers are authored at tiny amplitudes and lifted by two makeup gains — `EVENT_MAKEUP` (discrete one-shots) and `BED_MAKEUP` (continuous textures) — into separate `eventBus`/`bedBus` nodes so discrete "life" is never buried under the continuous air. Both feed a persistent chain `userGain → limiter → duckGain → destination`, where `limiter` is a brickwall `DynamicsCompressor` that lets the makeup gains be driven hard without ever clipping. The bundled bed bypasses the makeup buses and sits directly on `userGain` at `REAL_BED_GAIN`. Tune everything from those constants near the top of the file.
- **Non-repetitive**: each playback reseeds the event RNG with a random per-play salt, and the bundled bed enters its loop at a random offset with a slight detune, so the same scenario never sounds identical twice.
- **Robust lifecycle & fail-safes**: `ensureAudioGraph()` creates/resumes the single `AudioContext` on the first user gesture (never born "suspended"), probes Web Audio support once, and self-heals via `onstatechange` if the context is re-suspended. If Web Audio is unavailable, speech falls back to the plain `<audio>` element (no `createMediaElementSource`, no ambience, no crash). All ambience node creation is wrapped so failures only `console.warn`.
- Real-time ducking (lowers ambience under speech) and light reverb/delay tied to the dialogue audio are also handled in `AudioPlayer.tsx`, via an `AnalyserNode` on the speech track and a `duckGain` node wrapping the whole ambience mix.

### Exercise System

The exercise system is organised around a **listening syllabus**, not around rendering widgets. The unit of design is the pair *(listening stage × listening skill)*; the format is only the mechanic used to answer. Hard rule everywhere: **no written or spoken production** — everything is resolved by selecting, ordering, classifying or picking from a dropdown.

**Three axes (`types.ts`)**
- `ListeningStage`: `anticipacion` → `global` → `selectiva` → `intensiva` → `reflexion`. This is the order the UI renders.
- `ListeningSkill`: 14 sub-skills (`decodificacion`, `segmentacion`, `reconocimiento_lexico`, `dato_literal`, `idea_global`, `estructura`, `rol_fuente`, `inferencia`, `actitud_postura`, `pragmatica_registro`, `lexico_significado`, `colocacion_formula`, `variacion_dialectal`, `estrategia`).
- `ExerciseType`: 12 formats — the original five (`multiple_choice`, `true_false`, `ordering`, `classification`, `cloze`) plus `true_false_notgiven`, `matching` (bijective), `scale` (ordinal axis), `data_capture` (form with near-identical dropdowns), `minimal_pairs`, `spot_the_difference` (dictation without typing) and `chunk_order` (rebuild one sentence from breath groups).

`LessonPlan.exercises` is a **flat `Exercise[]`** ordered by stage. Each `Exercise` carries `stage`, `skill`, `slotId` and `sourceTurns` (dialogue indices, revealed in the feedback panel).

**`data/listeningSyllabus.ts` — the pedagogical source of truth**
- `FORMAT_RULES[format]`: allowed levels and text types, the exact JSON shape shown to the model, and the authoring rules. Level gating applies **only** to formats whose mechanic itself carries the cognitive load (`ordering`, `matching`, `scale`, `true_false_notgiven`, `spot_the_difference`, `chunk_order`). For the rest the widget is neutral and the difficulty lives entirely in the slot's `brief`.
- `getBlueprint(level, textType, mode)`: composes level templates → resolves each `brief` for the text type → filters structurally. **`textType` genuinely matters**: a radio bulletin (one speaker) never gets "who says it", a monologue gets real-chronology vs. narration order, a podcast gets question↔answer matching, news gets inverted-pyramid ordering and source attribution.
- Mode overrides: `Vocabulary` now scales by level (A0 sound recognition → C1 nuance and connotation); `AccentChallenge` teaches the cues (minimal pairs on the discriminating feature → lexis by speaker) before asking for the country.

**Generation pipeline (`services/geminiService.ts`)**
1. `buildExercisePrompt(blueprint)` generates the `EXERCISES:` block from the slots — there is no hand-written prose per level any more.
2. `verifyExercises(raw, dialogue)` (`services/exerciseVerification.ts`) checks both internal coherence (keys point to existing ids, matchings are bijections, orderings are permutations, no degenerate items) **and fidelity to the audio** (cloze targets, chunk reconstructions and captured data must actually be said; tokens marked as altered must not appear in the source turn). Anything that fails is dropped — never shown with a false key.
3. `fillMissingSlots(verified, blueprint, dialogue)` (`services/exerciseEngines.ts`) fills empty slots with deterministic engines, **in the slot's position**, and everything it builds goes through the same verifier.

**Deterministic engines** exist only where a provably correct exercise can be derived from the transcript. There is deliberately **no `ordering` or `matching` engine**: both need paraphrase, and an automatic paraphrase cannot be verified. Distractors are **phonetic neighbours** of words that are actually said (see `MINIMAL_PAIR_BANK`), never topic-related words, which would be discardable by plausibility without listening. Contrasts neutralised in most varieties (b/v, ll/y, silent h, and c/z~s under seseo) are excluded on purpose.

**Never** show learners the normalised form of a word: `normalizeText()` in `services/textUtils.ts` is for comparison only. Display always keeps real orthography, accents and capitals included.

### Component Structure
- `App.tsx`: Main orchestrator (580 lines) - handles all state and screen rendering
- `AudioPlayer.tsx`: Integrated audio playback with bundled ambient bed + synthetic event mixing (see Ambient Sound System above)
- `ExerciseCard.tsx`: Polymorphic renderer for the 12 formats; shows the skill badge, and on submit reveals the `sourceTurns` lines as proof of the key
- `MatrixSelector.tsx`: Locus × Modus grid interface for Standard mode
- `AuthScreen.tsx`: API key entry with localStorage persistence
- `LoadingScreen.tsx`: Status-aware loading states
- `SelectInput.tsx`: Styled select dropdown component

## Key Implementation Details

### A0 Level Special Handling
The Intro (A0) level uses a unique "realistic immersion" approach:
- Generates natural-speed native dialogue (no simplification)
- Dynamically injects mandatory data points based on topic keywords:
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
3. Update AudioPlayer topic mapping if region-specific ambient sounds needed

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
- **Ambient Beds Are Bundled Assets**: `public/ambience/*.wav` ship with the app; there is no external ambient-audio API call, so there's nothing to rate-limit or fail at runtime. Regenerate/retune them with `node scripts/generate-ambience-beds.mjs`.
- **Answer keys are verified, not trusted**: every exercise (model-generated *and* engine-generated) goes through `verifyExercise()` before rendering. It checks internal coherence and fidelity to the transcript. Prefer shipping one exercise fewer over one that teaches something false.
- **Never display normalised text**: accent-stripped, lowercased forms are for comparison only. Options shown to learners keep their real spelling.
- **Distractors must require listening**: phonetic neighbours of words actually said, never topic-adjacent words (those get discarded by plausibility) and never options that are ungrammatical in context (those get discarded by reading).
- **Accent Consistency**: In Standard/Vocabulary modes, both speakers use same accent; only AccentChallenge uses mixed accents

## Testing Approach

Automated checks (no API key or network needed) — run all with `npm test`:
- `npm run typecheck` — `tsc --noEmit`.
- `npm run check:syllabus` — walks `getBlueprint()` across the 42 valid level × text-type × mode combinations and asserts the pedagogical invariants: no format outside its level or text-type range, nothing presupposing two speakers in single-voice audio, A0 free of ordering/matching/scale/V-F-NG/spot-the-difference, C1 free of basic decoding formats, every lesson covering at least two stages and three distinct skills, stage order preserved, unique slot ids, existing engine fallbacks, and Vocabulary/text-type variants genuinely differing from one another.
- `npm run check:exercises` — feeds deliberately broken exercises (key not among the options, non-bijective matching, ordering copied verbatim from turns, V/F/NG with no NOT GIVEN item, cloze whose solution is never said, spot-the-difference flagging a word that *is* said…) to the verifier and asserts each is rejected; then asserts every deterministic engine produces exercises that pass the same verifier and never display accent-stripped text.

Manual checklist (needs an API key):
1. All three modes (Standard, Vocabulary, AccentChallenge).
2. All four levels generate stage-appropriate content.
3. A RadioNews and a Monologue lesson: confirm zero two-speaker exercises.
4. Vocabulary at A0 vs. C1: confirm they are no longer identical.
5. Rendering and submit/feedback for the newer formats (`data_capture`, `minimal_pairs`, `spot_the_difference`, `matching`, `scale`, `true_false_notgiven`, `chunk_order`), including the `sourceTurns` reveal.
6. Audio generation across accent/gender combinations; localStorage persistence; error handling for invalid keys.
