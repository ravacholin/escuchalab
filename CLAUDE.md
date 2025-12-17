# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EscuchaLAB** is an AI-powered Spanish listening practice application that generates level-appropriate dialogues, audio, and exercises based on the CEFR framework. The app uses Google's Gemini API for content generation and text-to-speech, and integrates with Freesound for ambient audio.

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
4. AudioPlayer fetches ambient sound from Freesound API
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

### Freesound Integration
Located in `AudioPlayer.tsx`:
- API key hardcoded: `UyddwR1Kqoj3J1tSagw6oLTBKETViLioFdGjF0Nl`
- Maps Spanish topics to English queries via regex patterns
- Fetches ambient sounds sorted by rating (min duration: 8s, license: Creative Commons)
- Downloads and mixes with dialogue audio at 15% volume
- Preference for loopable sounds (tag: "loop")

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
- `AudioPlayer.tsx`: Integrated audio playback with Freesound ambient mixing
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
- `GENERATION_MODEL`: Currently `"gemini-2.5-flash"`
- `AUDIO_MODEL`: Currently `"gemini-2.5-flash-preview-tts"`

## Important Notes

- **API Key Security**: Keys stored in localStorage and injected via Vite config; never commit `.env.local`
- **Audio Sanitization**: TTS will reject text with stage directions - always sanitize before sending
- **Speaker Mapping**: TTS requires consistent internal speaker IDs; use "SpeakerA"/"SpeakerB" mapping for robustness
- **Freesound Rate Limits**: API has rate limiting; implement caching if fetching frequently
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
