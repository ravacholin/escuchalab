# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EscuchaLAB** is an AI-powered Spanish listening practice application that generates level-appropriate dialogues, audio, and exercises based on the CEFR framework. The app uses Google's Gemini API for content generation and text-to-speech, and a bundled, scenario-aware ambient sound engine (20 real public-domain field-recording beds mixed per scene, plus a subtle layer of synthesised noise events) to make dialogues feel situated in their context.

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
- **Intro (A0)**: Natural-speed native audio; the learner decodes *data*, not clauses. **Three exercises**: what the situation is, a `dictation` where the datum is **heard and typed** into one open box, and minimal-pair discrimination on **ordinary words of the dialogue**. The third one used to carry `focusOnDataPoint`, which pushed it onto the digits of the very phone number the learner had just written down — two of the level's three cards asking about the same number. No turn-ordering, no matching, no inference, no register judgements — and no pre-listening prediction or metacognitive wrap-up either, since both are reading tasks in a language the learner does not yet read.
- **Beginner (A1-A2)**: Topic and outcome of the exchange, datum reconstruction, chunk reconstruction and routine formulae — **four exercises**. Roles are named by their concrete part (client/clerk — never abstract "formal/informal", which is B1+). `matching` and `spot_the_difference` are deliberately *not* used here (they remain in Vocabulary mode and B1+): stacking them on top of `ordering` and `chunk_order` made a single lesson ask for ~36 discrete answers. `ordering` went the same way and for the same reason — four paraphrases to compare is the most *reading* the level does, and no deterministic engine can back it, so the slot vanished silently whenever the model failed it. `estructura` therefore starts at B1.
- **Intermediate (B1-B2)**: **Infer the bridge without over-inferring.** V/F/NOT GIVEN is the level's flagship, because it is the only format that punishes filling gaps with what you expected to hear. Around it: topic and outcome, `spot_the_difference` on a real sentence, collocation cloze, problem↔solution matching, and a closing metacognitive item. **Four exercises in Short, five in Medium, six in Long.** `scale` is gone from here — grading a stance on a four-point ordinal axis is C1 work.
- **Advanced (C1)**: **Read between the lines and hear the architecture of the discourse.** Subtext and speech acts, implicature and irony, the ordinal scale of the speaker's commitment to what they assert (hedging), discourse markers, rhetorical organisation, and a closing item on which concrete *mark* gave it away. **Four exercises in Short, five in Medium, six in Long.**

**The lesson scales with the audio.** `getBlueprint` takes `Length`; each slot declares a `minLength`. A Short dialogue is six turns (~45 s) and it is the app's default — it used to receive the same six cards and ~20 discrete answers as a fourteen-turn one, with no material to sustain them: either the model made the exercise up or the verifier dropped it and the lesson silently shrank.

**Three budgets, all machine-checked** (`scripts/check-syllabus.mjs`, 126 combinations): cards per level × length, **discrete answers** (`answerCost`) and **reading load** (`readingLoad`) — the units of sentence-length Spanish text the learner has to read and cross-reference. Reading load is the one that was missing: B1-B2 and C1 asked for ≈34 and ≈32 units, so a scale of 4 quotes × 4 points plus a classification of 4 words × 3 columns were, together, fifteen sentences to compare. Past that point the task stops measuring listening and measures reading. Current Standard-mode figures (cards/answers/reading), printed by the check itself:

| level | Short | Medium | Long |
|---|---|---|---|
| A0 | 3 / 6 / 5.0 | 3 / 6 / 5.0 | 3 / 6 / 5.0 |
| A1-A2 | 3 / 6 / 5.0 | 4 / 8 / 7.5 | 4 / 8 / 7.5 |
| B1-B2 | 4 / 9 / 12.3 | 5 / 12 / 18.3 | 6 / 13 / 21.3 |
| C1 | 4 / 10 / 18.3 | 5 / 14 / 22.3 | 6 / 15 / 25.3 |

A0 sat at exactly 11/11 discrete answers, six of them the six dropdowns of the dictation. Making the datum a single open box turned those six into one, so A0's Standard lesson went from 11/9.5 to 6/5. The answer ceilings came down with it (Intro 11→8, Beginner 13→11) because a ceiling nobody reaches is not a ceiling; the **reading** ceilings did not move, because in both levels what sets the maximum is Vocabulary mode, which has no dictation.

B1-B2 and C1 were 9 and 10 slots (≈32 and ≈38 discrete answers), then six fixed. Much of the excess was repetition — C1 graded `actitud_postura` twice over the same audio and asked for the same nuance twice. What survived the first trim was still a *reading* test with an audio attached, and worse, **B1 and C1 ran the same six mechanics on the same item counts**: only the brief's prose differed, so "what does each level train?" had no distinct answer for the two highest levels. More exercises is not more listening; past a point it is only more reading.

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
- Audio generation picks the voice pair by **measured pitch distance** (`TTS_VOICES`), not by gender pools — see Audio Generation below
- Multi-speaker TTS labels each turn with the same canonical speaker string used in `speechConfig`

### Speaker Tone (`services/geminiService.ts`)

`REGISTER` fixes the tone of the **situation** (see `composeRegisterInstruction`); it is the
scene's register, not each person's. Nothing used to keep an individual speaker consistent to
one manner across their turns — the only per-turn control was `emotion`, free-form and
unanchored, so a clerk could open with `usted` and slide into tuteo, or a cordial client
harden for no reason.

`SPEAKER_TONE_INSTRUCTION` (prompt block `TONE:`) closes that. It asks the model to give every
`characters[]` entry a constant `tone` (`Character.tone`) — 4–12 words: manner, formality of
address (tú/vos/usted per `LOCALIZE`), and an emotional baseline — **derived from the
speaker's role and always inside `REGISTER`, never contradicting it**. That tone then governs
all of that speaker's turns; the per-turn `emotion` becomes a momentary modulation of it, not
a change of register. Two speakers in one scene can differ from each other, but each stays
consistent with itself.

The tone is decided **once** and reused everywhere: it is authored in `characters`, it steers
the dialogue, and `assignSpeakerVoices()` copies it onto the `SpeakerVoiceAssignment` so the
TTS reads each voice in character (see Audio Generation). It is optional and additive — a
script without it behaves exactly as before. `check:audio` pins that the tone propagates from
the character to its voice assignment (and that a character without one leaves it undefined).

### Audio Generation

The governing fact, and the one that took three failed fixes to internalise:
**`multiSpeakerVoiceConfig` is not a router.** It does not assign turn *i* to voice
*v*. The model reads the transcript, decides on its own who is speaking in each line,
and *then* looks up a voice — and Google documents "voice inconsistency with prompt
instructions" as a known limitation of the TTS models. Measured against the API with
the prompt format this app used to send, a six-turn dialogue between `Lucía` (Kore,
185 Hz) and `Andrés` (Fenrir, 119 Hz) came back with **no low-pitched segment at all in
3 of 4 generations**: two names, two configured voices, one voice heard. Every previous
attempt at this bug fixed the *assignment* — different voices per gender, canonical
labels — which was necessary and not remotely sufficient, because the assignment was
never what broke.

The first answer to that was to **measure the returned PCM and re-request when a voice was
missing**. It worked, and it was unaffordable. The free tier is **10 TTS requests per day**,
and the repair ladder cost 1 request in the best case, 2 with the insistent retry and
**8 for a six-turn lesson** once it fell through to one request per turn — and each logical
request could once become three HTTP calls, because `synthesizeWithProgress()` used to retry
twice in streaming and then fall back to non-streaming. A learner ran out of generations
before finishing one lesson. (The TTS request is **non-streaming** now — see below — so a
piece is one HTTP call again.)

So the guarantee moved out of the retry loop and into **the shape of the request**:
**one single-speaker request per speaker, and the turns interleaved locally.**

A single-speaker request has no attribution to resolve — one configured voice, one text —
so the failure mode simply cannot occur. The cost is **exactly 2 requests**, known before
anything is spent, with **no verification-driven retries at all**. For a `Largo` lesson in
Buenos Aires it is also *cheaper* than the old best case, because each body carries half the
dialogue and stops overflowing the per-accent budget. What is paid instead is that each
speaker's block comes back continuous and has to be cut into turns (`splitIntoTurns`) — and
that is local arithmetic, which cannot run out of quota.

- Model: `gemini-3.1-flash-tts-preview`, PCM 24 kHz / 16-bit mono. Free tier is
  **10 requests per day per model**, which is the constraint the whole design answers to.
- **The TTS request is non-streaming** (`synthesizeWithProgress` → `generateContent`, not
  `generateContentStream`). Streaming the audio bought nothing: the speaker's block is needed
  *whole* to be cut into turns (`splitIntoTurns`) and is only concatenated at the end, so
  there was no latency to overlap — only a live byte counter on the loading screen. What
  streaming *did* cost was the error `"Incomplete JSON segment at the end"`, thrown by the
  SDK's incremental JSON parser whenever the audio stream was cut mid-object; the recovery
  ladder (two streaming attempts + a non-streaming fallback) could then spend **three HTTP
  calls** for one piece and discard the bytes already received — and a *persistent* one, being
  neither a model nor a network error, killed the lesson's audio without ever falling to the
  second TTS model. A plain `generateContent` reads the whole body and parses once, so that
  error class is gone, the **exactly 2 requests, no retries** guarantee is restored, and
  synthesis progress is reported by **requests completed** (`doneChunks/totalChunks`, a real
  denominator) rather than streamed bytes. Model errors (429/503/500/404) still rethrow at
  once so `runWithModelFallback` switches TTS models; a network/timeout error retries a couple
  of times against the same model and, if exhausted, is `markSwitchable`d so a dead endpoint
  falls to the second model instead of failing the audio.
- **`planAudioRequests()` is the plan, and it is deterministic.** It groups the turns by
  speaker, splits any turn that overflows the accent's budget, packs each speaker's pieces
  into as few requests as fit, and records which dialogue position every piece came from.
  It is exported and tested offline, so "a dialogue costs two requests" is an assertion and
  not a claim.
- Sanitizes text to remove stage directions (*, [], ()) before TTS.
- Voice assignment is computed **once** over the whole dialogue and reused for every
  request.
- **The pair is chosen by measured pitch distance** (`pickVoicePair`). The pools were
  the previous fix and they were not enough: measured on the API
  (`npm run tts:voices`), the female voices of the catalogue span 176-233 Hz and the
  male ones 119-135 — 3.2 and 2.2 semitones. "A different voice from the same pool"
  therefore did not mean a voice the learner could use to segment turns, which is the
  whole point of having two of them. `TTS_VOICES` carries each voice's measured
  `pitchHz`, and the rule is: of the pairs that respect both declared genders, the most
  separated; and if none reaches `MIN_VOICE_SEPARATION_SEMITONES` (4.5), **the gender is
  what gets sacrificed, not the distinction**. Two women still get two female voices
  (Zephyr/Autonoe, 4.8 semitones). Two men cannot — the entire male catalogue fits in
  2.2 — so the speaker with fewer turns crosses over.
- **No label is ever sent, and no `multiSpeakerVoiceConfig` is ever built.** With one voice
  configured, a `Ana:` prefix would simply be read out loud. `canonicalSpeakerLabel()` and
  `assignmentFor()` survive because they still decide *whose* turn each line is (longest
  match first, so `Ana María` never steals `Ana`'s turns; identical or nested labels fall
  back to `Hablante 1` / `Hablante 2`) — that routing now happens before the request is
  built rather than being delegated to the model.
- **The directive asks for a pause between paragraphs**, and that is load-bearing rather
  than cosmetic. Each turn travels as its own paragraph, and the pause the model leaves
  between them is the boundary `splitIntoTurns` looks for afterwards. Everything the prompt
  can do to make that boundary crisp is one fewer turn cut by proportional fallback.
- **The directive also carries the speaker's declared tone.** Each character owns a
  constant `tone` (see Speaker Tone below); it is copied onto the `SpeakerVoiceAssignment`
  and appended to `singleVoiceDirective()` so the voice is read in that character. Because a
  speaker is a single request, the tone cannot drift mid-block — the request shape guarantees
  the same consistency the pitch-distance rule gives the timbre.
- **`splitIntoTurns()` (`services/ttsTurnSplit.ts`) cuts each speaker's block back into
  turns.** It knows k and the character count of every turn, so it computes where each
  boundary is *expected*, finds the interior silences of ≥180 ms, and picks the k-1 that
  best combine "marked silence" with "where the split was due" via a small DP. The prior is
  what stops it choosing the pause between two sentences of one turn over the real turn
  boundary. Crucially it **always returns exactly k pieces**: any boundary with no silence
  to sit on is placed proportionally, snapped to the quietest point within ±150 ms (an
  absolute window — a proportional one let the cut drift half a second on a long dialogue).
  That fallback is what replaces the old repair ladder: it can be imperfect, but it can
  never need another request.
- Turns are then reassembled in **dialogue order** with a 220 ms gap and the existing 5 ms
  seam fade (`concatPcmChunks`). What is lost is the model's cross-turn hand-off — the same
  trade the old turn-by-turn floor already made, except it now costs 2 requests instead of 8.
- **`checkTwoVoices()` is a free diagnostic now, not control flow.** It still measures the
  final track — segmenting by silences, estimating F0 per segment by autocorrelation, and
  counting *evidence per voice* rather than clustering pitches (one expressive voice spreads
  over 4 semitones and would pass a clustering test; what it cannot fake is turning up where
  it is not) — and it still declares itself `conclusive: false` on too little audio or two
  references too close to separate. But nothing is ever retried on its verdict. If it warns,
  the thing that is stale is the `TTS_VOICES` pitch table, not the audio.
- **A quota error is never retried.** `synthesizeWithProgress()` once retried twice in
  streaming and then fell back to non-streaming without looking at *what* had failed, so one
  429 spent three of the day's ten calls. `isQuotaError()` (429 / `RESOURCE_EXHAUSTED` /
  "quota" / "rate limit") rethrows immediately, in both the audio and the JSON paths (now that
  the audio path is a single non-streaming call, a quota error there is at most one call);
  network errors still retry as before.
- Returns base64-encoded audio data. Error handling for "non-audio response" rejections, and
  a quota failure says so plainly — including that the lesson plan itself did generate.
- **Still chunked at turn boundaries** (`chunkDialogueLines`), now *within* a speaker: the
  phonetic profile eats 2196-3407 of the 5000-character budget, and the old code did
  `substring(0, 5000)` — a `Largo` dialogue in Buenos Aires or Lima silently lost its last
  turns mid-sentence while the exercises kept asking about them. `ttsDialogueBudget(accent)`
  computes what is left and no turn is ever dropped. The old "split above
  `TURNS_BEFORE_SPLITTING` turns for speed" rule is **gone**: with two requests already
  running in parallel it bought nothing and every extra chunk is another request against the
  quota. `TTS_CONCURRENCY = 2` still holds (three in parallel gets 429/503 from the API).
- **The audio starts before the plan finishes.** The plan and the audio used to run strictly
  in series (`App.tsx`: `await generateLessonPlan(...)` then `await generateAudio(...)`), so
  the TTS did not begin until the *entire* lesson — dialogue **and** exercises and their
  verification — had come back. But `generateAudio()` only needs `dialogue` + `characters`,
  never the exercises, and in the streamed JSON `characters`/`dialogue` arrive **before**
  `exercises`. So the request is **not split** (dialogue and exercises still come from one
  completion — see the Exercise System note on why co-generation matters); instead, the
  moment the stream crosses into `"exercises"`, `generateLessonPlan` fires an
  `onDialogueReady(dialogue, characters)` hook and `App.tsx` kicks off the TTS **in parallel**
  with the exercise tail + verification. Wall-clock goes from
  `plan + exercises + audio` to `plan + max(exercise-tail, audio)`.
  - **`extractDispatchableDialogue(full, speakerCap)`** (`services/geminiService.ts`, exported
    and unit-tested) is the pure decision: it lenient-parses only the closed prefix (everything
    before `"exercises"`) and returns the dialogue/characters **only if** the prefix parses,
    has turns, and is within `speakerCap`. The speaker-cap guard is load-bearing: a dialogue
    over the cap will be rejected and regenerated by the speaker-count retry, so starting the
    TTS on it would waste a request against the 10/day quota. Because the dispatch is gated on
    `≤ speakerCap`, it never coincides with that retry; `dialogueDispatched` persists across
    attempts so a JSON-parse retry cannot start a second TTS.
  - **`dialoguesEqual(a, b)`** (`App.tsx`) guards correctness: after the plan resolves, the
    early audio is only awaited if the final `plan.dialogue` still turn-for-turn equals the one
    the TTS was started from. With `temperature: 0.0` a regenerated dialogue is normally
    identical; on the rare mismatch the early promise is discarded and the audio is regenerated
    in sequence, so **audio for a stale dialogue is never shipped**. The normal path still costs
    exactly 2 TTS requests. `check:early-audio` pins the dispatch contract offline.

### Ambient Sound System

**Rebuilt around real recordings.** Every previous version synthesised its ambience —
20 DSP-generated stems plus ~39 synthesised "events" (footsteps, cutlery, coins,
machines) and formant-synth crowd babble. It was rebuilt twice and still sounded, in the
words that triggered this rewrite, like *"un robot en lata que no se parece a ningún
fondo de nada real"*. That is not a tuning failure: synthesised ambience, and
synthesised discrete events above all, read as synthetic almost by construction — the
tuned partials of the struck objects were the "campanitas que no corresponden a ningún
sonido de fondo".

So the base is no longer synthesised. **Each bed is a short seamless loop cut from a real
public-domain field recording** of the named kind of place (radio aporee / Internet
Archive, all Public Domain Mark 1.0 — see `public/ambience/CREDITS.md`). A café sounds
like a café because it is a recording of one; there is nothing to fake. On top of that
sits a deliberately small, deliberately subtle layer of synthesised events — and the one
rule that keeps them from sounding robotic: **they are shaped-noise transients only,
never tuned oscillators.** With no sine partials there is no bell to ring, so the failure
mode that produced the "campanitas" cannot recur. Events exist mainly to give a little
life to the quiet indoor rooms (office, clinic, library, studio) whose real recording is
nearly stationary; most outdoor and busy scenes carry none and rest on the recording
alone.

Still fully self-contained at runtime — the beds are bundled assets, no external API,
no CORS/key/rate-limit risk in production.

**Architecture.** 20 bundled beds (`public/ambience/*.wav`, ~17 MB total):
- 18 **real** recordings: `cafe`, `restaurant`, `pub`, `market`, `shop`, `street`,
  `plaza` (Zócalo de Oaxaca), `park`, `forest`, `rain` (Barcelona), `station`, `airport`,
  `train_interior`, `office`, `kitchen`, `pool`, `hall` (a museum), `workshop`. Each is a
  mono 22.05 kHz loop of ~16-22 s, normalised to −24 dBFS RMS.
- 2 **honestly-synthetic** "quiet air" beds, `studio_air` and `room_air` — broadband
  hiss plus a faint mains hum at a very low level. This is the one place synthesis is not
  pretending to be a place: it is the near-silent air a close-miked voice sits in, which
  no field recording gives you cleanly.

- `services/ambiencePresets.ts` — the **`SceneRecipe`s** and the mapping from all
  **148** `ScenarioContext.label`s (layered by `TextType`). A recipe is one or two
  `BedLayer`s (bed + gain + optional filtering + stereo width), an optional
  `SceneTone` (shelves / tilt, or a `bandpass` for the telephone-line setups), and an
  optional short list of `EventSpec`s. **The `SceneId` vocabulary and the four label maps
  are unchanged from the previous system** — only what each scene *sounds like* changed —
  so the label→scene routing, `RECORDING_PRESENCE`, studio handling and free-text
  inference are as before. **A handful of scenes layer a second real bed** to place the
  room in a fuller world — a café by the window (`cafe` + a low-passed thread of `street`),
  a covered market (`market` + the enclosed body of `hall`), a restaurant with the kitchen
  behind the service doors, a garage / shop / hotel lobby / foyer with the street leaking
  in. The second layer is always the quieter, heavily-filtered one, muffled the way a sound
  coming through a window or a service door actually is (~9-14 dB down, low-passed), so it
  adds depth without competing with the primary bed or the voice, and it reuses existing
  beds — no new audio is bundled. The engine already mixes every layer of `beds[]` (two
  detuned playheads each) and the `N/M capas` counter counts them, so nothing else changed;
  `check:ambience` still measures monopoly on `beds[0]` (the primary), so a subtle second
  layer never trips it.
- `services/ambienceEngine.ts` — framework-free runtime engine. For each bed it runs
  **two lightly-detuned playheads, panned apart**, so a mono loop reads as a wide,
  non-repeating space rather than an obvious loop; colours the bed per scene; and
  schedules the subtle noise events with a `ctx.currentTime` lookahead scheduler. There
  is **no synthetic reverb on the beds** — the recordings carry their own room. Events get
  a short, low synthetic tail only so they do not sound pasted on.
- `services/ambienceLibrary.ts` — the bed loader (`loadBed`), same-origin `fetch` +
  `decodeAudioData`, cached per `AudioContext`, degrading past a failed load silently.

**Event kinds** (`EventKind`, all shaped noise): `cup`, `keyboard`, `paper`, `chair`,
`door`, `steps`, `till`, `splash`, `page`. Each has an `EVENT_SHAPES` entry in the engine
(a filter + envelope, plus an optional broadband contact click) — no oscillators anywhere.

**Key invariants**
- **The bed has to actually play.** The old system once shipped a release where a
  generation-counter guard dropped every stem and the learner heard only disembodied
  clicks. `check:ambience:runtime` instantiates the real engine against a fake
  `AudioContext` and asserts a source starts for **every bed playhead in all 50 scenes**,
  that loading does not depend on `start()`, and that `stop()` before the load resolves
  cancels it.
- **Real beds are seamless by overlap-add.** `build-beds.mjs` folds each loop's tail back
  onto its head with an equal-power crossfade, so the wrap reproduces adjacent source
  samples (continuous), not two matched endpoints faded to zero (which would pump).
  `check:ambience` measures the seam: a real overlap-add loop scores ~0.3-2.4 on
  `loopDiscontinuity`, a hard cut 5-60×.
- **Intensity moves the event *rate*, live.** The slider re-paces the scheduler without
  rebuilding the engine or restarting a single bed. `check:ambience:runtime` asserts the
  rate actually rises with intensity.
- **Ducking is asymmetric** (~12 ms attack, ~420 ms release) so the bed does not pump
  between syllables.
- **Every bed is used, every used bed exists, nothing is orphaned.** `check:ambience`
  asserts every `BedId` has a bundled `.wav`, every bundled `.wav` is a declared bed,
  and every bed is referenced by at least one recipe.
- **No bed monopolises the catalogue** (≤34% of scenes as primary), and each non-dialogue
  format spreads across ≥5 scenes — the old defect where 106 of 148 labels collapsed onto
  four near-identical studios.
- **The beds stay distinguishable.** `check:ambience` decodes every bed and asserts a
  spectral floor between the real ones, so the catalogue is not one texture wearing many
  labels.
- **Fail-safes**: `ensureAudioContext()` creates/resumes one `AudioContext` on the first
  gesture and self-heals via `onstatechange`; if Web Audio is unavailable, speech falls
  back to the plain `<audio>` element; a bed that fails to load is skipped and the scene
  plays with the rest.
- **Non-repetitive**: per-playback RNG salt, and the two detuned playheads enter the loop
  at independent random offsets, so a 16-22 s buffer is not heard as a loop across a
  three-minute lesson.
- Ambience volume / intensity / ducking and a mute toggle persist in `localStorage`
  (`ambience_prefs_v1`).

**Working on it**
- `npm run ambience:build` re-bakes every bed from `scripts/ambience/sources.json`. Raw
  sources are fetched from archive.org on demand and cached in `.ambience-cache/`
  (gitignored); only the processed `public/ambience/*.wav` are committed. Deterministic:
  the two synthetic air beds use a fixed seed. Needs `ffmpeg-static`, which is an
  **optional** tool (`npm i -D ffmpeg-static`), not a runtime or CI dependency — the beds
  are committed, so `npm test` and the build never touch it.
- `npm run ambience:preview -- cafe street station` mixes those scenes' real beds to
  `.ambience-preview/*.wav` so you can **listen** without a browser or an API key. Run
  with no arguments to list the scenes, or `--all`. (Events are a runtime layer and are
  not rendered here; the bed is the character.)
- **Adding a scene** costs a recipe, not audio: write the `SceneRecipe`, map at least one
  label to it, and (if it needs a place no existing bed covers) add a bed to
  `sources.json`, list it in `BedId`/`BED_IDS`, bake it, and reference it. `check:ambience`
  enforces the bed/label/event wiring; audition with `ambience:preview`.
- **Licensing**: keep new beds Public Domain / CC0 (no attribution obligation). The build
  writes provenance to `public/ambience/CREDITS.md`; keep it truthful.

### Exercise System

The exercise system is organised around a **listening syllabus**, not around rendering widgets. The unit of design is the pair *(listening stage × listening skill)*; the format is only the mechanic used to answer. Hard rule everywhere: **no written or spoken production** — everything is resolved by selecting, ordering, classifying or picking from a dropdown. The one exception, deliberately narrow, is `dictation`: writing down a phone number somebody dictates to you is *transcription*, not production — nothing is composed, only recovered — and it is literally the real-world task A0 and A1-A2 declare they train.

**Three axes (`types.ts`)**
- `ListeningStage`: `anticipacion` → `global` → `selectiva` → `intensiva` → `reflexion`. This is the order the UI renders.
- `ListeningSkill`: 14 sub-skills (`decodificacion`, `segmentacion`, `reconocimiento_lexico`, `dato_literal`, `idea_global`, `estructura`, `rol_fuente`, `inferencia`, `actitud_postura`, `pragmatica_registro`, `lexico_significado`, `colocacion_formula`, `variacion_dialectal`, `estrategia`).
- `ExerciseType`: 13 formats — the original five (`multiple_choice`, `true_false`, `ordering`, `classification`, `cloze`) plus `true_false_notgiven`, `matching` (bijective), `scale` (ordinal axis), `data_capture` (form with near-identical dropdowns), `dictation` (**hear the datum and type it**), `minimal_pairs`, `spot_the_difference` (dictation without typing) and `chunk_order` (rebuild one sentence from breath groups).

**`dictation` — writing the datum down, not picking it.** A `data_capture` asks the learner to pick the whole datum out of three lookalike strings, and of its three fields only one is the announced datum; the other two are whatever the regexes found. That is recognition. `dictation` replaced it and then got stuck halfway: it kept **one dropdown per position**, so it was still choosing, and it broke where nobody could see it — a run was accepted only if *every* position found audible distractors, so one position without them threw away the whole run and the engine fell through to a shorter `DIGIT_LITERAL` match. **The learner was handed half a phone number.**

Now the exercise is `Exercise.expected` — the whole datum, real orthography and fixed pieces included ("654 32 18", "catorce con noventa", "marta.ruiz@correo.com") — plus optional `accepts` variants and a `dataKind`. There is no `fields`, no `options`, no `separators`; with nothing to choose, the all-or-nothing distractor rule and its truncation bug are gone, and the engine now succeeds on strictly more audio than before.

**What is graded is what was heard, not how it is spelled** (`services/answerMatching.ts`). `canonicalDatum(text, kind)` folds both sides to a comparable form: a phone to bare digits, so `654 32 18` = `6543218` = `seis cinco cuatro treinta y dos dieciocho`; a price to two decimals, so `14,90` = `14.90` = `catorce con noventa`; a time to `h:mm` **mod 12**, so `5:30` = `17:30` = `cinco y media` (the audio does not say which one it is); a spelling to its letter sequence, so `G-A-R-C-Í-A` = `García` = `ge a erre ce i a`. What it will not forgive is a wrong digit or a missing one, which is exactly what the exercise measures. The number lexicon lives in `answerMatching.ts` and the engine imports it: if the two lists drift, the engine can harvest a numeral the grader cannot read.

`verifyDictation()` kept the one check that mattered and dropped the three that were about dropdowns: **`expected` must be heard contiguously in one turn** — and, since one release later, **heard *whole***. Contiguity alone cannot tell a datum from its own beginning: a prefix of a dictated number is contiguous *by construction*, which is why a lesson could ship with the first five digits of a nine-digit phone as the key and mark the complete number wrong. `isDatumHeardWhole()` therefore looks at what is glued to the match: if the piece immediately before or after it (skipping the connector, and skipping a self-correction — "seis, cinco, cuatro… **perdón**, treinta y dos") is another piece of the same datum, that occurrence is a fragment. One complete occurrence anywhere is enough, and a sentence boundary closes the datum, so the number in the next sentence is not read as its continuation. The repertoire of "pieces" is chosen from the datum itself — digits and numerals for a number, letter names and `arroba`/`punto` for a spelling — and never mixed, because letter names (`de`, `a`, `e`) are ordinary words and would declare truncated any number followed by a preposition. It also rejects any `accepts` entry that does not canonicalise to `expected` — a bad variant would mark a false answer correct, which is worse than rejecting a true one. Gated to A0/A1-A2 — at B1+ the literal datum is no longer the object of study.

`LessonPlan.exercises` is a **flat `Exercise[]`** ordered by stage. Each `Exercise` carries `stage`, `skill`, `slotId` and `sourceTurns` (dialogue indices, revealed in the feedback panel).

**`data/dataPoints.ts` — the dictated datum, as a first-class value**
At A0 and A1-A2 the topic decides which concrete datum the dialogue *must* contain (`inferDataPoint()` → `phone`, `price`, `time`, `spelling`…). That decision used to live inside `generateLessonPlan()` and die there, so the exercises never knew what had been dictated and the data-capture slot could land on anything. Now the `DataPointKind` travels to all three places that need it: the dialogue prompt (`instruction`), the exercise briefs (`{{dato}}`, `{{campo}}`, `{{contrastes}}`, interpolated by `getBlueprint(level, textType, mode, dataPoint)`) and the deterministic engines (`ExerciseSlot.focus`).

**`data/listeningSyllabus.ts` — the pedagogical source of truth**
- **Three budgets per level, not one.** `scripts/check-syllabus.mjs` caps cards **per level × length** (A0 3/3/3 · A1-A2 3/4/4 · B1-B2 4/5/6 · C1 4/5/6), plus a ceiling on **discrete answers** (`answerCost`: a `multiple_choice` is one answer whatever its option count, a `classification` of six rows is six, a `dictation` is one — one box, submitted once) and on **reading load** (`readingLoad`: sentence-length units, with word-level units — minimal pairs, chunks, Vocabulary rows marked `rowScale: 'word'` — weighted 0.25, and `dictation` at **0**, since there is nothing to read). Both functions are exported from the syllabus so the checker and the tables can never drift. The blueprint *is* the lesson — there is no trimming step downstream — so a slot added anywhere has to displace another one.
- **A slot appears from `minLength` upwards**, so the lesson grows with the audio instead of being fixed. The checker enforces **monotonicity**: Short ⊆ Medium ⊆ Long, because changing the duration must change *how much* is worked, never *what* is worked.
- **No lesson may rest entirely on the model.** Every blueprint needs at least one slot backed by a deterministic engine or by a format whose key is verified against the transcript. The minimum is one and not two on purpose: at C1 the object of study is inference and nuance, which by definition cannot be derived from the transcript by rule. Where it *is* achievable it is done — A0, A1-A2 and B1-B2 carry two. B1-B2 used to carry one out of six, so a lesson could ship with three cards and the learner had no way to know why.
- **B1-B2 and C1 may not share a signature**: the checker compares their `format:skill` sets and rejects a match.
- `FORMAT_RULES[format]`: allowed levels and text types, the exact JSON shape shown to the model, and the authoring rules. Level gating applies **only** to formats whose mechanic itself carries the cognitive load (`ordering`, `matching`, `scale`, `true_false_notgiven`, `spot_the_difference`, `chunk_order`). For the rest the widget is neutral and the difficulty lives entirely in the slot's `brief`.
- `getBlueprint(level, textType, mode, dataPoint, length)`: composes level templates → resolves each `brief` for the text type → filters structurally by format rules, speaker count and `minLength`. **`textType` genuinely matters**: a radio bulletin (one speaker) never gets "who says it", a monologue gets real-chronology vs. narration order, a podcast gets question↔answer matching, news gets source attribution. It changes the **skill**, too, not only the prose: `skillByTextType` retags `b-relaciones` as `rol_fuente` in news and podcast, where pairing data with its source is attribution and not bridging inference — that skill had been declared in `types.ts` and used by nothing.
- Mode overrides: `Vocabulary` scales by level (A0 sound recognition → C1 nuance and connotation) and keeps **at most one** opener per stage — C1 has two `global` slots, so it used to inherit both and a C1 vocabulary lesson shipped six cards against A0's three, without anyone deciding it. `AccentChallenge` teaches the cues (minimal pairs on the discriminating feature → lexis by speaker) before asking for the country.

**Generation pipeline (`services/geminiService.ts`)**
1. `buildExercisePrompt(blueprint)` generates the `EXERCISES:` block from the slots — there is no hand-written prose per level any more.
2. `verifyExercises(raw, dialogue)` (`services/exerciseVerification.ts`) checks both internal coherence (keys point to existing ids, matchings are bijections, orderings are permutations, no degenerate items) **and fidelity to the audio** (cloze targets, chunk reconstructions and captured data must actually be said; tokens marked as altered must not appear in the source turn). Anything that fails is dropped — never shown with a false key.
3. `fillMissingSlots(verified, blueprint, dialogue)` (`services/exerciseEngines.ts`) fills empty slots with deterministic engines, **in the slot's position**, and everything it builds goes through the same verifier.

**Three rules govern what actually reaches the learner** — all three were holes that let vague multiple-choice items take over the datum slots:
- **The format decides, not the label.** A model exercise occupies a slot only if `ex.type === slot.format`. Matching on `slotId` alone meant a `multiple_choice` tagged `slotId: "a0-ficha"` took the datum slot, got stamped `skill: 'dato_literal'`, and the deterministic engine never ran.
- **`multiple_choice` is verified against the audio too, in the literal skills.** It used to be the *only* format with no fidelity check at all, so a vague question about the datum was unfalsifiable while a precise ficha could be rejected. When the exercise declares `dato_literal` or `decodificacion`, the key must cite something that is actually said; where the key is legitimately a paraphrase (inference, attitude, register) nothing changed.
- **The blueprint is the lesson.** Extra exercises the model returns are discarded, not appended. A "three-exercise" A0 could ship five, and the two extras belonged to no stage and no plan.

`ExerciseSlot.preferEngine` inverts the priority for the datum slots: the engine runs *first* and the model's version is used only if no material is found in the transcript. It is set where the exercise can be proved end to end against the audio, so a derived reconstruction always beats a written one.

**Deterministic engines** read `slot.focus` so the fallback lands on the datum too. They understand a datum dictated **in words** (`seis cinco cuatro treinta y dos…`, which is what the A0 prompt actually asks for) as well as in digits, and they group `654 32 18` into one `Teléfono` field instead of three loose `Número` ones. Word-run distractors change exactly one numeral and stay grammatical — `treinta y dos` → `cuarenta y dos`, never `veinte y dos`. The `dictation` engine still segments the harvested run — not to build controls, but to know where the datum begins and ends and which connectors belong inside it (`catorce **con** noventa` is one datum, not two).

**The datum is harvested whole or not at all**, and that took three separate repairs, because the harvesters were cutting the number in three different places and each cut produced the same symptom: a fragment as the "correct" answer, marking the complete number wrong.
- The harvesters overlap on purpose (`DIGIT_LITERAL` also matches `654` inside `654 32 18`), so candidates are compared **by position in the turn**, not by text: any span another span contains is dropped. Position is what lets two candidates written differently be recognised as the same stretch of audio.
- `DIGIT_LITERAL` had two caps that silently truncated. It required 2-4 digits in the *first* block, so a phone dictated the way the level's own prompt asks for it — digit by digit, `6-5-4-3-2-1-8-7-9` — matched nothing, the engine found no material, and the slot fell through to the model, whose key only had to be heard contiguously. And it allowed at most five blocks, so `65-43-21-87-96-12` came back as `65-43-21-87-96` with no longer candidate to compare against. The sequence is now uncapped and accepts single-digit blocks separated by space, hyphen or comma+space; a comma **without** a space stays the decimal point, which is what still tells `14,90` from `6, 5, 4`.
- A number written half in digits and half in words (`el 654, treinta y dos, dieciocho`) is seen at half length by two different harvesters. Adjacent candidates are **reassembled** when nothing at all is said between them (only separators) and **neither half is a complete datum on its own** — that last condition is what keeps two consecutive data (`quedan 3, son 14,95`) from being glued into one. The reassembled datum is taken from the turn verbatim, so it still sounds exactly as it reads.
- And when the lesson announced a phone and no *whole* phone is in the audio (a dictation interrupted by a self-correction, say), the engine returns **nothing**. The longest fragment of a number is precisely the wrong key that fails the learner who wrote the number down correctly; one card fewer is the cheaper mistake.

The datum is displayed as it is written in the turn (`text`), not rebuilt from its pieces: recomposing `65-43-21` gave `65 - 43 - 21`, the right datum spelled in a way nobody would write it. `minimal_pairs` without a `focus` now excludes the number lexicon outright, so the third A0 card cannot drift back onto the datum, and it always tries the real pair bank first (that used to depend on the slot having a focus, so removing the focus would have started admitting generated non-words like `númera`). Time was invisible to every engine until `MINUTE_WORDS` (`media`, `cuarto`) started counting inside a run — `a las cinco y media` is one numeral and fell below the run threshold, so a "book an appointment" lesson shipped without a single exercise about the time. Engines exist only where a provably correct exercise can be derived from the transcript. There is deliberately **no `ordering` or `matching` engine**: both need paraphrase, and an automatic paraphrase cannot be verified. Distractors are **phonetic neighbours** of words that are actually said (see `MINIMAL_PAIR_BANK`), never topic-related words, which would be discardable by plausibility without listening. Contrasts neutralised in most varieties (b/v, ll/y, silent h, and c/z~s under seseo) are excluded on purpose.

**Never** show learners the normalised form of a word: `normalizeText()` in `services/textUtils.ts` is for comparison only. Display always keeps real orthography, accents and capitals included.

### Progress Reporting (loading screens)

The loading screens used to animate an invented script with `setTimeout`: the bar
advanced on a clock rather than on work done, and the log narrated stages that do
not exist ("Procesando fonemas y prosodia…"). Now every figure on screen is a
measurement.

- `services/generationProgress.ts`: `ProgressReporter` + `ProgressSnapshot`. Services
  report **facts** (`start`/`update`/`finish`/`fail`/`log`) and the UI renders them.
  Emissions are throttled to ~90 ms with a trailing flush, so no measurement is lost.
- **The lesson-plan (JSON) call is streamed** (`generateContentStream`), which is what makes
  fine-grained measurement possible: a single opaque request has nothing to report between
  send and response. Two streaming attempts with exponential backoff, then a
  non-streaming attempt as a fail-safe — if the model or the network can't stream,
  generation still succeeds and the log says so. **The TTS call is non-streaming** (see Audio
  Generation): streaming it gave no latency to overlap and was the sole source of the
  `"Incomplete JSON segment at the end"` error, so its progress is measured by requests
  completed, not streamed bytes.
- **Phase 1 (`generateLessonPlan`)**: blueprint (slots planned) → prompt (chars sent) →
  dialogue (turns counted in the incoming JSON) → exercises (received / expected, a real
  denominator from the blueprint) → parse (turns, speakers) → verify (kept vs. discarded,
  with the verifier's reason per item) → assemble (slots covered by the model, by a
  deterministic engine, or left empty).
- **Phase 2 (`generateAudio`)**: prepare (turns, chars, voice assignment, and how many TTS
  requests the chunking is going to make) → synthesis (each non-streaming request lands its
  whole block at once; the step counts `completed/total` requests and the PCM seconds
  received) → encode (final length/size).
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
- `App.tsx`: Main orchestrator - handles all state and screen rendering. The lesson is walked stage by stage: each `ListeningStage` is a **collapsible section** with an `n/m resueltos` counter, and only the first opens. Everything used to be painted in one scroll — five or six cards, several of them tables, before the learner had decided where to start — and a good part of what read as an unmanageable load was that, independently of the content. `ExerciseCard` reports each submit through the optional `onAnswered` prop; the card's own state stays its own.
- `AudioPlayer.tsx`: Transport, speech routing and ambience UI. The ambience engine itself lives in `services/ambienceEngine.ts` (see Ambient Sound System above); the component was 1529 lines when ~900 of them were the engine.
- `ExerciseCard.tsx`: Polymorphic renderer for the 13 formats; shows the skill badge, and on submit reveals the `sourceTurns` lines as proof of the key. `dictation` gets its own renderer: a single open `<input>` with the datum's label, `inputMode="numeric"` where the datum is only digits, and the datum in its real spelling revealed on submit.
- `MatrixSelector.tsx`: Locus × Modus grid interface for Standard mode
- `AuthScreen.tsx`: API key entry with localStorage persistence
- `LoadingScreen.tsx`: Measured progress of the generation (see Progress Reporting below) — it only renders what the services actually reported
- `SelectInput.tsx`: Styled select dropdown component

## Key Implementation Details

### A0 Level Special Handling
The Intro (A0) level uses a unique "realistic immersion" approach:
- Generates natural-speed native dialogue (no simplification)
- Injects a mandatory data point chosen from the topic by `inferDataPoint()` (`data/dataPoints.ts`). A1-A2 gets the same injection in a softer wording, so its `dictation` slot always has material:
  - Phone numbers (digit-by-digit dictation)
  - Spelled names/surnames
  - Specific prices with cents
  - Postal codes, dictated digit by digit, for an address situation
  - Exact times for appointments
  - Dates read off a form (day, month, two-digit year)
  - Email addresses (with "arroba", "punto", "guion bajo")
- The central exercise asks the learner to **write the datum down, whole** (`dictation`), not to pick it out of a shortlist nor to assemble it from dropdowns

**The datum instruction declares the *form*, not only the *what*** — and that is the piece that was missing for a long time. `a0-dato` carries `preferEngine`, so the level's central card is not written by the model: it is **harvested from the transcript by a parser**. The prompt that produces that transcript therefore has to speak the parser's language, and it did not. The two examples `DATA_POINTS` shipped were precisely the two renderings no harvester can read: `"A las 5 y media"` (`NUMBER_LEXICON` is a set of *words*, so `5` never opens a numeral run and `media` never gets its glue; `DIGIT_LITERAL` returns the one-piece `"5"`, which dies in the two-piece filter) and `"14 con 95"` (two one-piece literals whose gap contains letters, so `isBridgeable` refuses to join them). In both cases the engine found nothing and the card vanished — in the lesson that needs it most. Three rules now govern every instruction:
- **Never mixed.** The whole datum in words or the whole datum in figures. The numeral harvester and the digit harvester split a half-and-half datum between them and neither sees it whole.
- **Two pieces minimum.** A lone number ("el 45", "a las cinco") is not a dictation and is dropped on purpose — which is why the time asks for its fraction and the price for its cents.
- **Whole, uninterrupted, in one turn.** `DICTATION_DELIVERY` (`services/geminiService.ts`), shared by A0 and A1-A2. The verifier already demanded it, but the demand lived only in `FORMAT_RULES.dictation.guidance`, which governs whoever writes the *exercises* — while the dialogue block asked for a script "100% NATURAL y FLUIDO", which is exactly what invites the confirmation echo ("—Es seis, cinco, cuatro… —¿Seis cinco cuatro? —Treinta y dos, dieciocho.") and the self-correction.

Two kinds changed *datum*, not just spelling, because their natural datum is not dictable: `address` moved from the building number (one loose figure) to the **postal code**, and `date` to the piece-by-piece form of a form field. `canonicalDatum` gained its `date` branch — without it the datum was harvested correctly and *graded* wrongly, since "15/03/12" and "quince cero tres doce" did not compare equal.

**`DICTATABLE_KINDS` + the table in `check:exercises` are what keep the two halves together.** For every `DataPointKind`, the check writes the turn the way that kind's `instruction` demands and asserts the three things that have to hold at once: the engine harvests it **whole**, the verifier accepts it, and the grader takes both spellings while rejecting the same datum with a piece missing. It also asserts **exhaustiveness**, so a new kind cannot arrive declared, requested in the prompt, and read by nobody — which is how `address`, `date`, `quantity` and `generic` spent several releases announcing their field label ("Dirección") over a card that never appeared. The forbidden renderings are pinned in the negative direction too: if the old examples come back, the check fails instead of the lesson silently losing a card.

**The A0 lexicon line is not decoration** (`A0_LEXICON`, `services/geminiService.ts`). The third card, `a0-pares`, needs at least three dialogue words of four characters or more, not numerals and not stopwords, that have a partner in `MINIMAL_PAIR_BANK` **whose partner is not also spoken** — if both are heard the item has no answer and is discarded. Nothing asked the dialogue for that vocabulary, so when it did not turn up by chance the card fell back to generated neighbours (which can be non-words: "número" → "númera") or disappeared. The exercise is deliberately *not* named in that instruction: dialogue and exercises come out of the same completion, and naming it invites the model to put the partner in the script "as a hint", which is what invalidates it.

**A fragment is worse than nothing, and the bound has to count the right thing.** While pinning the table, a date said the forbidden way ("nació el quince de marzo de dos mil doce") was found to harvest **the year alone** as the key. `digitsOnly()` converts numerals but does not compose them, so "dos mil doce" measured as seven digits and cleared a digit-count threshold meant for a five-figure code. `isFocusLiteral` now counts numerals when the datum comes in words and figures when it comes in figures, for `code`, `address` and `date` alike — never the two counts mixed.

### JSON Response Handling
- Uses `responseMimeType: "application/json"` for structured generation
- `cleanJsonString()` helper strips markdown code fences from responses
- Retry logic with exponential backoff (3 attempts, 1s → 2s delay)

### Persistence Strategy
- Generated lessons are cached in **IndexedDB** (`services/lessonCache.ts`), keyed by `{mode, level, textType, accent, length, topic, customAudioPrompt, customExercisePrompt}`, LRU-capped at 20 entries. The two custom-prompt fields are part of the key on purpose: two different free-text instructions produce different lessons, so leaving them out would serve one from the other's entry. The dialogue is requested with `temperature: 0.0`, so repeating a configuration used to re-pay the whole pipeline for essentially the same lesson. Only *complete* lessons (plan **and** audio) are stored — a cached lesson without audio would have to go back to the TTS anyway. `AppMode.AccentChallenge` is **never** cached: it draws two random accents per run, so its key does not describe its contents. A «Regenerar» button in the header invalidates the entry and forces a fresh lesson. The PCM is stored as raw bytes and re-encoded to base64 on read, so the app boundary is unchanged.
- API key stored in localStorage for session continuity
- Lazy initialization in `useState` prevents auth screen flash
- Storage event listener detects cross-tab key changes
- Failsafe recovery on mount if lazy init failed

### Custom Prompts (audio + exercises)
The config screen has an **«Instrucciones personalizadas»** panel (`App.tsx`) with two free-text fields, available in every mode: one steers the **dialogue** and one steers the **exercises**. They travel to `generateLessonPlan()` as `customPrompts: { audio, exercises }` and are injected as clearly-labelled extra blocks (`USER_AUDIO` in the main prompt; a `PREFERENCIAS DEL USUARIO` line appended to `buildExercisePrompt()`'s output). The guiding principle is **follow the user as far as possible**: the model is told to honour them with the most latitude it can, and only a short list of hard limits overrides them — level, register, localization and, for the exercises, the correctness invariants (no written/spoken production, no key that is not heard) and the structural budget (how many cards and of which format/stage/skill, which is fixed by the level and length, not by the prompt). This is safe precisely because the guardrails downstream are unchanged: `verifyExercises()` and the deterministic engines still filter everything, so a user instruction that would produce a false key or written production loses at most one card rather than shipping something wrong. Both strings are part of the cache key (see Persistence Strategy).

**The one/two-speaker principle is no longer an absolute cap — it is the default the user can lift.** By default the app still works with one or two speakers (the fixed two-request cost and the two well-separated voices are untouched, and a lesson with no custom audio prompt is generated and validated exactly as before). But **when the user writes a custom audio prompt**, the hard ceiling rises to `MAX_SPEAKERS` (4, `services/geminiService.ts`), and the model is told it *may* exceed two **only if the user's own instructions ask for it** (more named people, a group, a round table…). This is a genuine opt-in, gated twice: `allowMoreSpeakers` (any custom audio prompt present) raises the *cap*, and the model's prompt raises the *actual count* only on explicit request — a custom prompt about tone or topic does not silently add speakers. The audio path already supported it: every speaker is synthesised in **its own single-voice request** and the turns are interleaved by dialogue position (`planAudioRequests` now voices up to `MAX_SPEAKERS`, no longer `slice(0, 2)`), so no speaker is ever dropped from the audio. What is weaker beyond two is **voice separation**, not correctness: `pickVoiceSet()` gives N *distinct* voices spread as far as the catalogue allows (farthest-point, honouring gender where it can), but the catalogue cannot separate three or four voices by the 4.5 semitones two get — the four male voices fit in 2.2 — so the learner may find three voices harder to tell apart than two. Each extra speaker also costs at least one more TTS request against the free tier's 10/day, which is why the cap is modest. The exercise blueprint is still sized for the text type's nominal speaker count, so a three-speaker script may lose an exercise that presumed exactly two — the verifier drops it rather than shipping a false key, the same safety net as everywhere else. `check:audio` pins both the unchanged two-speaker contract **and** the new path (three and four speakers get that many distinct voices; three speakers plan three requests with no turn lost).

### Audio Download
The player (`components/AudioPlayer.tsx`) exposes a **WAV download** of the generated speech, reusing the same `pcmToWavBlob` object URL it already plays — so it costs nothing extra and needs no re-encode. It is **voice only**: the ambience is mixed live in the browser (see Ambient Sound System) and is not part of the file. The filename comes from the lesson title (`downloadName` prop), slugified (NFD-stripped, non-alphanumerics collapsed to `-`, ≤60 chars, with an `escuchalab` fallback).

### Failsafe TTS (voz del navegador)

**Cuando el TTS de Gemini falla, el diálogo se sintetiza con la Web Speech API del
navegador** (`window.speechSynthesis`) en vez de dejar la lección muda. El nivel gratis de
Gemini son 10 peticiones de TTS al día por modelo; agotada la cuota —o caído el modelo de
voz por cualquier motivo— la lección se quedaba sin audio. `window.speechSynthesis` es
gratis, sin clave, sin cuota y sin red: no puede «quedarse sin créditos». El disparador es
**cualquier fallo de audio**, no solo la cuota: se activa en el `catch` de audio de
`App.tsx` (`handleGenerate`), es decir *después* de que `generateAudio` recorra toda la
cadena `AUDIO_MODELS`.

- **No preserva el contrato PCM.** `generateAudio()` devuelve base64 de PCM (24 kHz mono) y
  de eso dependen el `<audio>`/Web Audio, la descarga WAV y el caché IndexedDB. La Web
  Speech **no produce bytes** —habla directa al dispositivo—, así que es un **camino de
  reproducción paralelo** en `AudioPlayer`, no un reemplazo del PCM. Excluyentes: o hay
  `audioBlob` (PCM), o hay `audioFallback` (`WebSpeechPlan`), nunca ambos (`types.ts`).
- **`services/webSpeechTts.ts`** es lógica **pura y serializable**: `planWebSpeech(dialogue,
  characters, accent)` arma una intervención por turno en orden de diálogo (reutilizando
  `sanitizeForTTS`/`canonicalSpeakerLabel`/`findCharacter` de `geminiService.ts`), y
  `pickWebSpeechVoices(voices, accent, genders)` —que recibe la lista de voces como
  argumento, así se prueba sin navegador— elige la voz por `ACCENT_LOCALE` (acento → BCP-47
  `es-XX`), degradando a cualquier `es-*` y luego a cualquier voz, y da dos voces distintas
  a dos hablantes cuando el catálogo lo permite. La resolución de las voces concretas y el
  habla (encolar utterances, pausa/reanudación) ocurren en `AudioPlayer.tsx`.
- **Lo que se pierde en modo respaldo:** la fidelidad del acento baja (solo voces `es-XX`
  del navegador, sin los perfiles fonéticos de Gemini — afecta sobre todo a *Adivina el
  Acento*), no hay descarga WAV ni caché (no hay bytes; `writeLesson` ya salta sin audio) y
  no hay barra de búsqueda (el progreso se mide por intervención). **El ambiente sí se
  mezcla** (es independiente del `<audio>`): su ducking se dispara en las fronteras de cada
  intervención (`applySpeechLevel` en `onstart`/`onend`) en vez de por RMS, porque no hay
  analyser que leer. El reproductor muestra un aviso de que está usando la voz de respaldo.
- **`check:webspeech`** (`scripts/check-webspeech.mjs`, sin navegador ni clave) fija el
  contrato de la parte pura: `planWebSpeech` produce una intervención por turno en orden con
  el texto saneado y el género del personaje; `pickWebSpeechVoices` elige el locale correcto,
  degrada cuando falta y da dos voces distintas a dos hablantes; `ACCENT_LOCALE` cubre los
  ocho acentos.

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
6. Add a branch to `answerCost()` and `readingLoad()` in `data/listeningSyllabus.ts` — without one the format falls through to the default and its cost is mis-budgeted, which is exactly how the reading load got away in the first place.
7. Reference it from the level/mode blueprints with a `minLength`, and optionally add a deterministic engine in `services/exerciseEngines.ts` — only if the exercise can be *proved* correct against the transcript. If it is verifiable, add it to `VERIFIED_FORMATS` in `scripts/check-syllabus.mjs`.
8. Run `npm test`.

### Modifying Scenario Database
Edit `data/scenarios.ts`:
- Structure: `ScenarioContext` contains `label`, `value` (prompt), `icon`, `actions[]`
- Each `ScenarioAction` has `label`, `value` (specific situation), `icon`
- Icons imported from `lucide-react`

### Adjusting Gemini Models

**The text model is a chain, not a constant.** `GENERATION_MODELS`
(`services/modelFallback.ts`) is `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` →
`gemini-3.6-flash` → `gemini-2.5-flash`; all four are GA and on the free tier.
`GENERATION_MODEL` in `geminiService.ts` is just its first rung — the one always tried
first and the one named on the loading screen. The primary is a **lite** model on
purpose: `gemini-3.6-flash` used to open the chain and, being the newest and a thinking
model, was either saturated (`503 "high demand"`) or slow to the first token (~37 s), so
the "recepción del guion" wait was long and frequent. A lite model reaches the first token
sooner and is less saturated; `gemini-3.6-flash` is **not** removed — it drops to a later
rung and stays available as a fallback. A lite primary is safe because the verifier and the
deterministic engines guard the output, not the model's power.

It exists because a `503 UNAVAILABLE — "This model is currently experiencing high demand"`
from `gemini-3.6-flash` used to leave the app unable to generate anything at all. The
retry ladder in `generateJsonWithProgress()` treated it as a network failure and spent all
three of its calls (two streaming attempts plus the non-streaming fallback) **against the
same overloaded model**, waiting 500 ms and 1000 ms in between. A demand spike lasts
minutes; 1.5 s does not outlast it. What a retry cannot fix, a different model can.

Hence the distinction the whole module is built on — errors of the *model* versus errors
of the *moment*:
- **Model errors go down a rung immediately** (`shouldSwitchModel`): unavailable (503/500),
  quota (429), and model-not-found (404). Note `isModelUnavailableError` reads `code`,
  `status` *and* the message text, because in the real 503 `status` arrived empty and the
  code was buried in a JSON nested inside another JSON. `isModelNotFoundError` exists so
  that the day Google retires one of the four ids — `gemini-2.0-flash` went in June 2026 —
  the app drops to the next one instead of breaking.
- **A 429 switches only when switching can help** (`quotaScope`). The free tier has two
  kinds of quota and only one is cured by another model. A **per-model** limit
  (`…PerProjectPerModel…`, the "10 requests/day per model" bucket) means the next rung
  arrives with its own quota intact, so the switch is immediate and worth it. A
  **per-project/per-key** limit is shared across every model, so walking the chain would
  only spend one round-trip per rung against a bucket already at zero — exactly the waste
  the whole module exists to avoid. So `shouldSwitchModel` returns **false** for a
  project-scoped quota: the error is rethrown at once, `describeModelChainFailure` says
  switching won't help and to wait for the daily reset, and the audio path falls straight
  to the browser-voice failsafe instead of churning. The signal is in the 429's
  `QuotaFailure` details — `PerModel` in the `quotaId` or a `model` dimension → per-model;
  a bare `PerProject`/`PerUser` with no model dimension → per-project. **Unknown scope
  defaults to switching**: recovering real output from a fresh model beats the failsafe, and
  one wasted round-trip is cheap, so only positive project-scope evidence cuts the chain.
- **Everything else keeps the existing ladder first**: network failures, a stream cut
  halfway, an empty response, a timeout. A *single* dropped connection must not burn the
  whole chain, so a raw network/timeout error does **not** switch models on its own — it is
  retried by the internal ladder (two streaming attempts plus the non-streaming fallback)
  against the *same* model. Only when that whole ladder is exhausted does
  `generateJsonWithProgress()` **mark the error switchable** (`markSwitchable`) so the chain
  advances to the next model. That is the fix for the report where a persistent
  `Failed to fetch` left the app dead on the first model: `isNetworkError` /`isTimeoutError`
  classify it, `isModelError` gates the immediate switch, and `shouldSwitchModel` returns
  true only for model errors *or* an error the ladder has already given up on. So a transient
  blip is absorbed by the ladder, but a model/endpoint that keeps failing no longer stops the
  world — and `describeModelChainFailure` now has friendly copy for both network and timeout.

**Every call is bounded by a timeout** (`createTimeoutGuard`, an `AbortController` wired
through `config.abortSignal`). This is what fixes the *original* symptom — "se queda en
recepción del guion y ni progresa": a request the server accepts but leaves hanging, or a
stream that stops emitting mid-way, used to freeze the loading screen forever. The margins
are thinking-aware, because these models spend real time before the first token. That
~37 s-to-first-token measurement was under *dynamic* thinking; capping it (`thinkingConfigFor`,
below) brought the first token much closer, so the first-chunk margin was cut from the 90 s
that number once justified down to a still-generous `STREAM_FIRST_CHUNK_MS` **45 s** — enough
for a slow-but-working generation, while recovering from a genuine hang (a request the server
accepts but never emits into) in half the time it used to take before the chain tried another
model. The inter-chunk stall once the flow has started is short (`STREAM_STALL_MS` 30 s), under
a hard total cap (`STREAM_TOTAL_MS` 120 s). During that first-token wait an `onWaiting` heartbeat moves the
`dialogue` step's detail ("esperando la respuesta del modelo… (N s)") so the screen no longer
looks frozen. The audio path (`synthesizeWithProgress`) carries the same guard.

**A 429 switches models but is still never retried** — and now only when switching can help.
The two are not in tension: a **per-model** free-tier limit means the next rung arrives with
its own quota intact, so the switch is instant, while the rule that actually matters — never
repeat the same request against the same limit — is untouched. A **per-project/per-key** limit
(`quotaScope === 'project'`) is the exception: it is shared across every model, so the chain
is not walked at all — the error is rethrown at once so the app warns and falls to the
failsafe rather than burning a request per rung against a bucket already at zero.

The order of the chain is by **expected availability**, not by capability: a demand spike
hits the newest models, which are the ones everyone is trying out. `gemini-2.5-flash` closes
the chain as the veteran, least likely to be saturated and most rehearsed at the structured
JSON the lesson needs. The verifier and the deterministic engines already guard the output,
so a lesson from a lower rung is still a checked lesson.

The chain never costs anything on the normal path — one model, one call, as before — and
even in the worst case it is *cheaper* than what it replaced: 4 calls with all four models
down, against the 3 the old ladder spent on a single saturated one. The loading log names
the switch (`«…» no está disponible (…); se cambia a «…»`) and, if the plan did not come
from the primary, says which model produced it. A speaker-count retry restarts from the
model that just answered (`modelsFrom`), not from the top.

**The plan call caps the model's thinking** (`thinkingConfigFor`, `services/modelFallback.ts`).
The primary is a *thinking* model, and the lesson-plan request used to carry **no thinking
configuration at all**, so the model reasoned with a dynamic budget and took ~37 s to emit
the first token — the entire "se queda en recepción del guion" slowness was that silence,
not the generation itself. The cap is computed **per model** because the same `config` is
reused across the whole chain and the families take different controls: 3.x models get
`thinkingLevel: 'low'` (they cannot disable thinking outright), `gemini-2.5-flash` gets
`thinkingBudget: 0`. Lowering it is safe here for the same reason a lower rung is: the
verifier and the deterministic engines guard the output, not the depth of the reasoning.
`check:fallback` asserts every model in the chain receives a bounded (never dynamic/`-1`,
never `high`) config. The TTS path is untouched — `AUDIO_MODEL` does not think.

**`AUDIO_MODELS` is now a short chain, not a single model** (`services/modelFallback.ts`):
`"gemini-3.1-flash-tts-preview"` → `"gemini-2.5-flash-preview-tts"`. For a long time the TTS
was deliberately one model — the fixed 2-request cost, and the fear that two speakers of one
lesson might be synthesised by different models — but when the primary went down (`503`) there
was **no alternative and no audio at all**, the same hole the text chain already closed.
Availability wins: audio with voices a hair less separated beats no audio. The chain answers
that while keeping the old worry moot — **the model is resolved once per lesson**, so both of a
lesson's requests (one per speaker) always use the same one; there are never two voices of a
dialogue on two models. The only thing a switch can leave slightly stale is the `pitchHz` table
(measured against the primary), which affects the `checkTwoVoices` diagnostic and the
voice-separation margin, never correctness. `AUDIO_MODEL` in `geminiService.ts` is just the
chain's first rung — the one always tried first and named on the loading screen.
- **Model errors switch immediately; a network error switches only once the ladder is spent.**
  `synthesizeWithProgress()` rethrows a 503/500/404 as well as a 429 at once (before, only the
  429 bubbled and a 503 burned the streaming attempts plus the non-streaming fallback against
  the dead model), so `runWithModelFallback` drops to the next TTS model. A **raw** network
  error or timeout does not switch on its own — the request is retried a couple of times
  against the same model (a single dropped connection must not burn the chain), and only when
  that internal ladder is exhausted is the error `markSwitchable`d so the chain falls to the
  next model, exactly as the text path does. That last part is new: it is what keeps a dead
  endpoint — or a persistent stream cut, back when the audio was streamed — from failing the
  lesson's audio without ever trying the second model.
- **A 429 switches but is still never retried**, same as the text chain — and, like it, only
  when switching helps (`quotaScope`): a **per-model** limit lets the next rung arrive with its
  own daily quota intact, so it switches; a **per-project/per-key** limit is shared across every
  TTS model, so `runWithModelFallback` does not walk to the second model — the 429 is rethrown
  at once and the lesson falls straight to the browser-voice failsafe (App.tsx), which has no
  quota, instead of spending a request on a model that would 429 the same way.
- **`gemini-2.5-pro-preview-tts` is deliberately *not* in the chain.** Measured against the API
  (August 2026, free-tier key) it returns `429` with `limit: 0` on
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier` for `gemini-2.5-pro-tts` — i.e. zero
  free-tier requests, always. Since the whole app is built for the free tier, adding it would
  only cost a wasted round trip; a maintainer with billing enabled can append it as a last rung.
- `check:audio` pins the chain: the primary is first, the checked fallback is present, no `pro`
  model is included, a 503/429 is a model error (switches) while a network error is not, a 503
  on the primary lands on the second model with one switch, the normal path costs one model
  resolution and zero switches, and an exhausted chain rethrows.
- `scripts/measure-tts-voices.mjs` still defaults to `"gemini-2.5-flash-preview-tts"`.

## Important Notes

- **API Key Security**: Keys stored in localStorage and injected via Vite config; never commit `.env.local`
- **Audio Sanitization**: TTS will reject text with stage directions - always sanitize before sending
- **Speaker Mapping**: TTS requires consistent internal speaker IDs; use "SpeakerA"/"SpeakerB" mapping for robustness
- **Ambience beds are bundled real recordings**: `public/ambience/*.wav` are seamless loops cut from public-domain field recordings (plus two synthetic "quiet air" beds); they ship with the app, so there is no external ambient-audio API to rate-limit or fail at runtime. Re-bake them with `npm run ambience:build` (needs the optional `ffmpeg-static`), and audition scenes with `npm run ambience:preview -- <scene>`.
- **Realism comes from the recording, not the synth**: the "robot en lata" was the synthesised events and crowd babble. Keep the bed real; keep any event a *shaped-noise transient* (no oscillators, or the "campanitas" come back); keep events subtle and mostly on the quiet indoor rooms.
- **Ambience is judged by ear, floored by measurement**: `check:ambience` asserts what separates "a place" from "noise" (normalised level, seamless loop, a spectral floor between beds, no bed monopolising the catalogue). It cannot tell you a café sounds like a café — use `ambience:preview` for that.
- **Bed licensing**: only add Public Domain / CC0 recordings, and keep `public/ambience/CREDITS.md` truthful. `scripts/ambience/sources.json` is the manifest.
- **Answer keys are verified, not trusted**: every exercise (model-generated *and* engine-generated) goes through `verifyExercise()` before rendering. It checks internal coherence and fidelity to the transcript. Prefer shipping one exercise fewer over one that teaches something false.
- **Never display normalised text**: accent-stripped, lowercased forms are for comparison only. Options shown to learners keep their real spelling.
- **Distractors must require listening**: phonetic neighbours of words actually said, never topic-adjacent words (those get discarded by plausibility) and never options that are ungrammatical in context (those get discarded by reading).
- **Accent Consistency**: In Standard/Vocabulary modes, both speakers use same accent; only AccentChallenge uses mixed accents

## Testing Approach

Automated checks (no API key or network needed) — run all with `npm test`:
- `npm run typecheck` — `tsc --noEmit`.
- `npm run check:audio` — asserts the TTS chunking never exceeds the per-accent character budget, never loses a turn (the `substring(0, 5000)` bug), keeps short dialogues in a single request, splits an oversized single turn by sentence instead of truncating it **while re-prefixing every piece with the speaker label**, that the PCM concatenation preserves every sample while fading only the seam, that `assignSpeakerVoices()` gives two speakers two voices that are both different *and* at least 4.5 semitones apart in every configuration (same gender, missing character sheets, acotaciones in the label, one name contained in the other) while keeping the declared gender wherever the catalogue allows it, and that the voice verifier works: it finds the pitch of a synthetic voice without reading it an octave low, accepts a two-voice track, rejects a one-voice track naming the voice that is missing, and declares itself inconclusive on too little audio or on two references too close to separate.
  It also pins **the cost**, which is the whole contract of the current design: a six-turn dialogue plans **exactly 2 requests in all 8 accents**, one voice each, no turn lost when grouping by speaker, every request inside its accent's budget, no speaker label in the text that gets sent, and a monologue still costing one. Plus that a quota error is told apart from a network error (a 429 used to spend three of the day's ten calls), and the whole contract of `splitIntoTurns()` against synthetic PCM: clear pauses give k pieces with the boundaries on the measured silences and each piece the length of its turn; **no silence at all still gives k pieces**, placed by the character prior, which is the case that replaces the old repair ladder; a pause *inside* a turn is not mistaken for the boundary between two; and for k of 1, 2, 3, 5 and 8 — and for an empty PCM — the result is always exactly k pieces, none empty, all 16-bit aligned.
- `npm run check:early-audio` — pins `extractDispatchableDialogue(full, speakerCap)`, the pure decision behind starting the TTS before the plan finishes (see Audio Generation). Asserts it dispatches the **whole** dialogue and its characters at the `"exercises"` boundary of the streamed JSON — the moment the dialogue is complete but the exercises are not — and that it refuses to dispatch when it would be wrong or wasteful: a dialogue over `speakerCap` (which will be regenerated, so spending a TTS request on it burns quota), a prefix that has not yet reached `"exercises"`, and an empty stream; while a single speaker with cap 1 (RadioNews/Monologue) still dispatches. No API key or network.
- `npm run check:syllabus` — walks `getBlueprint()` across the **126** valid level × text-type × mode × length combinations and asserts the pedagogical invariants: the three budgets (cards per level × length, discrete answers, reading load), **monotonicity by duration** (Short ⊆ Medium ⊆ Long), **at least one slot backed against the transcript**, **B1-B2 and C1 not sharing a `format:skill` signature**, no format outside its level or text-type range, nothing presupposing two speakers in single-voice audio, A0 free of ordering/matching/scale/V-F-NG/spot-the-difference, C1 free of basic decoding formats (`data_capture`, `dictation`, `chunk_order`), every lesson covering at least two stages and three distinct skills, stage order preserved, unique slot ids, existing engine fallbacks, no `preferEngine` without one, and Vocabulary/text-type variants genuinely differing from one another. It also prints the per-level load table, so the budget can be read instead of deduced from the slot tables.
- `npm run check:ambience` — asserts that all 148 scenario labels resolve to a curated scene (none falling through to the fallback), that every `BedId` has a bundled `.wav`, no bundled `.wav` is undeclared, and every bed is referenced by a recipe (no dead weight), that every `EventKind` a recipe uses has a synth shape in the engine, that no bed is the primary of more than 34% of scenes and each non-dialogue format spreads across ≥5 scenes, and the acoustic floor per bed: sane loop length, a normalised level (real beds ≈ −24 dBFS, synth air quieter), no clipping, a **seamless loop seam** (`loopDiscontinuity` ~0.3-2.4 for the overlap-add loops vs 5-60× for a hard cut), and a spectral distance floor between the real beds so the catalogue is not one texture. It cannot tell you whether a café *sounds* like a café — `npm run ambience:preview` is for that.
- `npm run check:ambience:runtime` — instantiates the **real** `AmbienceEngine` against a fake `AudioContext` (`scripts/ambience/fakeWebAudio.mjs`, with virtual timers so minutes of scene time run deterministically) and asserts what the tables alone cannot: that a source starts for **every bed playhead of all 50 scenes** (two detuned playheads per layer), that loading does not depend on `start()` having been called, that `stop()` cancels an in-flight load, that every bed source reaches the destination, and that **intensity actually moves the event rate** (the scheduler keeps firing over minutes and speeds up with the slider).
- `npm run check:exercises` — feeds deliberately broken exercises (key not among the options, non-bijective matching, ordering copied verbatim from turns, V/F/NG with no NOT GIVEN item, cloze whose solution is never said, spot-the-difference flagging a word that *is* said…) to the verifier and asserts each is rejected; then asserts every deterministic engine produces exercises that pass the same verifier and never display accent-stripped text. It also pins the dictated-datum path: a phone said in words and a phone said as `654 32 18` must both yield one `Teléfono` field in the ficha; minimal pairs **with** a focus must contrast the digits, and **without** one must not touch them at all. And the whole contract of `dictation`: the engine harvests the datum **complete** (`654 32 18`, never the `654` that `DIGIT_LITERAL` also matches inside it) for a phone in words and in digits, a price, a time and a spoken email, while `a las nueve en punto` is not read as an address; the exercise offers nothing to choose; `expected` that is not heard contiguously is rejected, as is an `accepts` variant that is not the same datum. **A phone comes out whole in the six ways it gets dictated** — digit by digit with hyphens, with spaces and with commas, in six blocks, half in digits and half in words, and as a run of numerals — each one graded so the complete number is accepted and the same number missing one digit is not; an interrupted dictation yields no exercise rather than half a number; and the verifier rejects a truncated key (a prefix, a prefix up to mid-digit, a tail) on audio where the whole number is dictated, while a price followed by a time in the same sentence is **not** mistaken for a cut price — the inverse assertion, without which the check would quietly take out half the lesson. Plus the tolerance table itself — every equivalent spelling of a phone, a price, a time, a spelling and an email accepted, and a changed digit, a **truncated** datum and an empty answer rejected. A `multiple_choice` tagged with the datum's `slotId` still does not take that slot, and exercises outside the blueprint never reach the lesson.
- `npm run check:fallback` — pins the distinction the model chain rests on: which errors are
  fixed by switching models and which are not. It classifies **the real 503 payload**, copied
  verbatim (a JSON inside another JSON, `status` empty, the code only in `code` and in the
  text) as unavailable and *not* as quota; a 429 and a retired model id as switchable; and a
  *raw* `socket hang up` / `Failed to fetch` / empty response as **not** switchable on its own
  — a single dropped connection must not burn the whole chain. It pins **the quota scope**
  too: a 429 whose `QuotaFailure` names `PerModel` (or a `model` dimension) is `quotaScope`
  `'model'` and switches; a bare `PerProject` 429 is `'project'` and does **not** switch —
  `runWithModelFallback` stops on the first model so the app falls to the failsafe instead of
  walking the chain, and `describeModelChainFailure` says switching won't help; a 429 with no
  detail is `'unknown'` and switches (the optimistic default). It also pins the new half:
  `Failed to fetch` and `fetch failed` and `ECONNRESET` classify as network, an `AbortError`
  and our own "no envió datos" / "superó el tiempo" messages as timeout, and the *same*
  network error **once `markSwitchable` has tagged it** (i.e. after the internal ladder gave
  up) *does* switch. Then it drives `runWithModelFallback` against a fake runner: a 503 on the
  first model lands on the second with exactly one announced switch and one call per model, a
  raw network error does not advance at all, an exhausted chain rethrows the *last* error after
  `n-1` switches, no model is ever called twice — and the cheap case, **success on the first
  model costs exactly one call and zero switches**. It runs the real `generateJsonWithProgress`
  end to end against a fake AI too: a 503 leaves on the first call, a network error spends its
  `stream,stream,completa` ladder and comes out switchable, and a *persistent* `Failed to
  fetch` under `runWithModelFallback` now walks the whole chain (each model's full ladder, one
  announced switch) instead of dying on the first model — the exact case the user reported.
  Finally, that the message shown to the learner when the chain is exhausted says what happened
  (saturation, quota, connection or timeout) instead of printing the raw nested JSON.
- `npm run check:webspeech` — pins the pure part of the **failsafe TTS** (voz del navegador;
  see Failsafe TTS above): `planWebSpeech` produces one intervention per turn in dialogue
  order with the sanitized text and the character's gender, dropping empty turns;
  `pickWebSpeechVoices` (fed a simulated voice list, no browser) picks the exact locale for
  the accent, degrades to any `es-*` and then to any voice when the variant is missing, and
  gives two speakers two distinct voices when the catalogue allows it (reusing one only when
  there is a single voice); `ACCENT_LOCALE` covers the eight accents; and
  `isWebSpeechAvailable()` returns false outside a browser without throwing.

Checks that need an API key, network and quota (**not** part of `npm test`):
- `GEMINI_API_KEY=… npm run check:tts:live [repeticiones]` — the only check that hears what
  the model actually did, and the only place `splitIntoTurns()` runs against real audio
  rather than synthetic PCM. Calls `generateAudio()` exactly as the app does for a
  mixed-gender pair, two women and two men; announces the request cost before spending it;
  fails if any generation ends up single-voiced **or spends more requests than were
  planned** — an unplanned request would mean the cost has gone back to depending on
  measure-and-retry. Leaves the WAVs in `.tts-live/`: if the model stops pausing between
  paragraphs, the number will not say so but the audio will.
- `GEMINI_API_KEY=… npm run tts:voices [voz,voz,…]` — regenerates the `pitchHz` column
  of `TTS_VOICES` by measuring each catalogue voice on the same sentence. Run it when
  the TTS model changes: the pitch table is what makes both the pair selection and the
  verification possible, and a table copied from another model is a table that lies.
  Responses are cached in `.tts-voice-cache/`.

Manual checklist (needs an API key):
1. All three modes (Standard, Vocabulary, AccentChallenge).
2. All four levels generate stage-appropriate content.
3. A RadioNews and a Monologue lesson: confirm zero two-speaker exercises. In a B1-B2 RadioNews, `b-relaciones` should carry the **«quién dice qué»** skill badge and pair data with its source.
4. Vocabulary at A0 vs. C1: confirm they are no longer identical, and that C1 opens with **one** card, not two.
4b. Same configuration in **Short and in Long** at each level: Short must bring 3-4 cards and Long 4-6, and Short's cards must be literally the first ones of Long.
4c. A B1-B2 lesson: `spot_the_difference` must render and be answerable — this is the first release in which that format reaches a learner at all (engine, renderer and verifier existed, no slot used them).
4d. Stage sections: only the first open, the `n/m resueltos` counter tracking submits, and the whole thing reset when a new lesson is generated.
4e. The model chain, which cannot be triggered on demand by waiting for Google to be busy: put a bogus id (`gemini-no-existe`) temporarily at the head of `GENERATION_MODELS`. The API answers 404, and the loading log must show «"gemini-no-existe" no está disponible (…); se cambia a "gemini-3.5-flash-lite"» followed by «Guion generado con …», with the lesson generating normally. Revert the id afterwards, and confirm a normal lesson's log mentions **no** switch at all and that the `prompt` step still names `gemini-3.5-flash-lite`.
5. Rendering and submit/feedback for the newer formats (`dictation`, `data_capture`, `minimal_pairs`, `spot_the_difference`, `matching`, `scale`, `true_false_notgiven`, `chunk_order`), including the `sourceTurns` reveal. For `dictation`, type the datum both in digits and in words and confirm both are accepted, type it with a digit missing and confirm it is not, and check on a narrow screen that the box and the revealed datum do not overflow. Generate an A0 "dar un número de teléfono" lesson and **read the transcript before answering**: the datum revealed on submit has to be the *whole* number the audio dictates, not the part of it the harvester could parse — this is the failure the format is most exposed to, because a fragment looks perfectly well-formed on screen.
6. Audio generation across accent/gender combinations; localStorage persistence; error handling for invalid keys. **Listen to a dialogue whose two characters share a gender** — the case with the least margin — and confirm the two speakers are told apart without reading the transcript. Then listen for the seams, which is where the current design can fail: no turn should start or end mid-word, and the gaps between réplicas should read as a conversation rather than as two monologues spliced together. The loading log names the count: «Turnos intercalados: N fronteras — X por silencio medido, Y por reparto proporcional». A lesson mostly cut by *reparto proporcional* means the model stopped pausing between paragraphs — check the directive in `singleVoiceDirective()` before touching the splitter. The log should also say «2 peticiones, sin reintentos»; anything else is a regression in the cost.
7. Ambience: confirm the player's `N/M capas` counter reaches the total (it is the tell for a silent bed). Play a `Café / Restaurante`, a `Taxi / Transporte`, a `Taller Mecánico`, an `Aeropuerto / Aerolínea`, an `El Tiempo` (RadioNews) and a `Mi Rutina Diaria` (Podcast) — they should be recognisable blind and clearly different from one another. Check that the bed ducks under speech without pumping between syllables, that the volume/intensity/ducking/mute settings survive generating a new lesson, and that deleting `public/ambience/` degrades to a working player rather than an error.
7b. The formats that used to have no place: generate a `Aprendí a Cocinar` and a `Mi Ciudad Favorita` (both Podcast) and confirm the first is a kitchen table and the second a booth — the mapping is by recording setup, so the city episode is *supposed* to stay in the studio. A `Geopolítica` (RadioNews) should audibly be a phone line. A `Monólogo de Humor` should be a room with an audience in it.
7c. Move the intensity slider mid-playback: events must get **more frequent**, not just louder, and the bed must not restart. For one release the slider was a pure loudness control in 26 of 42 scenes and every nudge rebuilt the whole engine.
