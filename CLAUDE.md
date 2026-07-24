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
- **Intro (A0)**: Uses "keyword spotting" approach - natural speed dialogue with mandatory data points (phone numbers, times, spelled names)
- **Beginner (A1-A2)**: Simple recall and definition matching
- **Intermediate (B1-B2)**: Inference and synonym exercises
- **Advanced (C1)**: Nuance, irony, slang, and register exercises

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
- `components/AudioPlayer.tsx`: at playback start, loads the resolved bed as a looping `AudioBufferSourceNode` layered under a rich set of live, tag-driven synthetic event generators (footsteps, door chimes, crowd babble, sirens, honks, printer bursts, rain drops, bird chirps, etc. — see the file for the full list) built with the Web Audio API. When the real bed loads, the purely-synthetic continuous "hum/air" layers are attenuated (not removed) to avoid doubling, while all discrete events stay at full richness. If the bed fails to load for any reason, playback silently continues with the pre-existing synthetic-only bed — there is no user-facing failure mode.
- Real-time ducking (lowers ambience under speech) and light reverb/delay tied to the dialogue audio are also handled in `AudioPlayer.tsx`, via an `AnalyserNode` on the speech track and a `duckGain` node wrapping the whole ambience mix.

### Exercise System
Five exercise types in `types.ts`:
- **multiple_choice**: Standard MCQ with options array
- **true_false**: Binary or list-based T/F statements
- **ordering**: Sequence arrangement (correctAnswer is string[])
- **classification**: Row-column matching (correctAnswer is Record<string, string>)
- **cloze**: Fill-in-the-blank with gap options

Validation logic in `geminiService.ts` ensures proper structure before rendering.

### Component Structure
- `App.tsx`: Main orchestrator (580 lines) - handles all state and screen rendering
- `AudioPlayer.tsx`: Integrated audio playback with bundled ambient bed + synthetic event mixing (see Ambient Sound System above)
- `ExerciseCard.tsx`: Polymorphic exercise renderer based on type
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

### Adding a New Exercise Type
1. Add type to `Exercise` interface in `types.ts`
2. Implement validation in `isValidExercise()` (geminiService.ts)
3. Add rendering logic in `ExerciseCard.tsx`
4. Update exercise generation instructions in `getExerciseInstructions()`

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
- **Exercise Validation**: Always validate exercise structure before rendering to prevent UI crashes
- **Accent Consistency**: In Standard/Vocabulary modes, both speakers use same accent; only AccentChallenge uses mixed accents

## Testing Approach

No formal test suite currently exists. Manual testing checklist:
1. Test all three modes (Standard, Vocabulary, AccentChallenge)
2. Verify all levels (A0, A1-A2, B1-B2, C1) generate appropriate content
3. Check audio generation with different accent/gender combinations
4. Validate exercise rendering for all five types
5. Test localStorage persistence across page refreshes
6. Verify error handling for invalid API keys and generation failures
