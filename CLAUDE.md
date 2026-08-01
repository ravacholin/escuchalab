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
- **Intro (A0)**: Natural-speed native audio; the learner decodes *data*, not clauses. **Three exercises, all anchored to the dictated datum**: what the situation is, a `dictation` that rebuilds the datum element by element, and minimal-pair discrimination on the digits/letters it is made of. No turn-ordering, no matching, no inference, no register judgements — and no pre-listening prediction or metacognitive wrap-up either, since both are reading tasks in a language the learner does not yet read.
- **Beginner (A1-A2)**: Topic and outcome of the exchange, datum reconstruction, chunk reconstruction and routine formulae — **four exercises**. Roles are named by their concrete part (client/clerk — never abstract "formal/informal", which is B1+). `matching` and `spot_the_difference` are deliberately *not* used here (they remain in Vocabulary mode and B1+): stacking them on top of `ordering` and `chunk_order` made a single lesson ask for ~36 discrete answers. `ordering` went the same way and for the same reason — four paraphrases to compare is the most *reading* the level does, and no deterministic engine can back it, so the slot vanished silently whenever the model failed it. `estructura` therefore starts at B1.
- **Intermediate (B1-B2)**: **Infer the bridge without over-inferring.** V/F/NOT GIVEN is the level's flagship, because it is the only format that punishes filling gaps with what you expected to hear. Around it: topic and outcome, `spot_the_difference` on a real sentence, collocation cloze, problem↔solution matching, and a closing metacognitive item. **Four exercises in Short, five in Medium, six in Long.** `scale` is gone from here — grading a stance on a four-point ordinal axis is C1 work.
- **Advanced (C1)**: **Read between the lines and hear the architecture of the discourse.** Subtext and speech acts, implicature and irony, the ordinal scale of the speaker's commitment to what they assert (hedging), discourse markers, rhetorical organisation, and a closing item on which concrete *mark* gave it away. **Four exercises in Short, five in Medium, six in Long.**

**The lesson scales with the audio.** `getBlueprint` takes `Length`; each slot declares a `minLength`. A Short dialogue is six turns (~45 s) and it is the app's default — it used to receive the same six cards and ~20 discrete answers as a fourteen-turn one, with no material to sustain them: either the model made the exercise up or the verifier dropped it and the lesson silently shrank.

**Three budgets, all machine-checked** (`scripts/check-syllabus.mjs`, 126 combinations): cards per level × length, **discrete answers** (`answerCost`) and **reading load** (`readingLoad`) — the units of sentence-length Spanish text the learner has to read and cross-reference. Reading load is the one that was missing: B1-B2 and C1 asked for ≈34 and ≈32 units, so a scale of 4 quotes × 4 points plus a classification of 4 words × 3 columns were, together, fifteen sentences to compare. Past that point the task stops measuring listening and measures reading. Current Standard-mode figures (cards/answers/reading), printed by the check itself:

| level | Short | Medium | Long |
|---|---|---|---|
| A0 | 3 / 11 / 9.5 | 3 / 11 / 9.5 | 3 / 11 / 9.5 |
| A1-A2 | 3 / 11 / 9.5 | 4 / 13 / 12.0 | 4 / 13 / 12.0 |
| B1-B2 | 4 / 9 / 12.3 | 5 / 12 / 18.3 | 6 / 13 / 21.3 |
| C1 | 4 / 10 / 18.3 | 5 / 14 / 22.3 | 6 / 15 / 25.3 |

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

So the guarantee is not "we asked correctly". It is: **ask the way the model documents,
choose voices that can be told apart, and then measure the audio that came back.**

- Model: `gemini-3.1-flash-tts-preview`, PCM 24 kHz / 16-bit mono. Free tier is
  **10 requests per day per model** — which is why the repair path below is a fallback
  and not the default, and why chunking a short lesson is avoided.
- Sanitizes text to remove stage directions (*, [], ()) before TTS.
- Voice assignment is computed **once** over the whole dialogue and reused for every
  chunk and every retry.
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
- **The prompt follows the documented multi-speaker format.** What used to be sent was
  the phonetic profile, then a `---BEGIN DIALOGUE---` separator, then the turns: nowhere
  did it say that this was a conversation, who was in it, or that they had different
  voices. Google's own example is `TTS the following conversation between Joe and Jane:`
  immediately before the transcript, and the guide says to align *who says it* with *how
  it sounds*. `conversationDirective()` does both — it names the two speakers and
  describes each one's timbre (`TtsVoice.timbre`) — and sits **after** the phonetic
  profile, right against the turns, so it is the last thing read before the dialogue.
- **The turn label must match `speechConfig` exactly.** The config was keyed on the
  speaker string while each line was prefixed with the raw `d.speaker`, so a script
  writing `"Ana (cajera)"` in the dialogue and `"Ana"` in the config gave the model a
  speaker it had no voice for. `canonicalSpeakerLabel()` strips acotaciones and stray
  punctuation, `assignmentFor()` routes each turn to its owner (longest match first, so
  `Ana María` never steals `Ana`'s turns), and if the two labels are still
  indistinguishable — identical, or one contained in the other — both fall back to
  `Hablante 1` / `Hablante 2`. **A split turn keeps its label**: `splitOversizedLine()`
  re-prefixes every piece, because the second half of a long turn used to arrive as text
  with no owner, which is exactly the case where the model keeps the previous voice.
- **A chunk with one speaker is sent as single-speaker.** Asking for
  `multiSpeakerVoiceConfig` where only one person talks hands the model an attribution
  it does not have to solve and a spare voice to get wrong.
- **The returned audio is measured** (`services/ttsVoiceCheck.ts`). `checkTwoVoices()`
  segments the PCM by silences, estimates F0 per segment by autocorrelation, and counts
  *evidence per voice*: segments falling within ~3 semitones of each assigned voice's
  reference pitch. It deliberately does **not** just cluster the pitches into two groups
  — one expressive voice spreads its segments over 4 semitones and would pass. What a
  single voice cannot fake is turning up where it is not: if nothing lands near 119 Hz,
  Fenrir was never used. When the two references are too close to separate, or there is
  too little audio, the verdict is `conclusive: false` and nothing is retried — a false
  alarm costs a request out of ten.
- **Repair, in order**: the chunk is re-requested once with an insistent directive
  (`conversationDirective(owners, true)`, which spells out that the voices must differ
  and which one is higher); if it still comes back single-voiced, the chunk is
  synthesised **turn by turn**, one request per turn with a single voice configured.
  That last path cannot fail by construction — one request, one voice, one turn — at the
  cost of one request per turn and of the natural hand-off between réplicas. It is the
  floor, not the plan: an audio that sounds a little less conversational still works for
  segmenting turns; an audio with one voice does not.
- Returns base64-encoded audio data.
- Error handling for "non-audio response" rejections.
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

**Then it was rebuilt again, for specificity.** The rebuild above worked — there was
life and depth — but every scene still sounded like every other one, and *nothing in the
test suite could say so*: `check:ambience` measures the baked stems and
`check:ambience:runtime` measures the shape of the audio graph, so no check had ever
rendered a scene. Measured once one did (`check:ambience:scenes`), **18 of 861 scene
pairs sat below the distinguishability floor**, and the reasons were structural:
- **106 of 148 labels resolved to one of four studios**, and those four were the same two
  featureless stems at slightly different gains. For 72% of every lesson generated, the
  learner heard no place at all — the *same* defect the Dialogue catalogue had been fixed
  for, reproduced intact in the three formats nobody had measured.
- Five global normalisations erased what distinguishes one place from another: a single
  density ceiling (26 of 42 scenes fired at exactly 26.00 onsets/min), a scene-independent
  event-over-bed ratio (+6.0 dB everywhere, by construction), a hard bed floor (12 scenes
  pinned to one level), a binary indoor/outdoor air ceiling (70% of events through one of
  two values), and no per-scene EQ at all (64 of 103 layers unfiltered).
- 12 stems covered 42 scenes, `room_tone` in 29 of them and `hvac_office` in 20.

**Architecture.** 20 reusable stems, mixed per scene at runtime:
- `public/ambience/*.wav` — 20 bundled stems (~12.1 MB total, budget 14):
  `babble_close`, `babble_hall`, `babble_open`, `traffic_near`, `traffic_far`,
  `kitchen`, `hvac_office`, `room_tone`, `studio_tone`, `transit_hum`, `rain`,
  `wind_leaves`, plus the character stems added to break up the support cluster —
  `office_life`, `pa_concourse`, `tiled_corridor`, `home_life`, `booth_tight`,
  `workshop_tools`, `crowd_far`, `sports_hall`. Sample rate and channel count are chosen
  per stem by content (8-24 kHz, mono except the three that carry the most spatial
  information).
- `services/ambiencePresets.ts` — **50** `SceneRecipe`s (stems + gains + room + tone +
  activity + event headroom + events) and the mapping from all **148**
  `ScenarioContext.label`s, layered by `TextType`. `bedLevel()` computes a scene's
  nominal bed amplitude from `STEM_LEVELS_DBFS`.
- **The label chooses the recording setup, never the topic.** A bulletin about traffic
  is still heard from a studio and not from a road — but "a studio" is not one room. A
  bulletin can come from an on-air booth, a live newsroom, a talk desk, a correspondent
  in the street or a contributor on a 300-3400 Hz phone line. A podcast about learning to
  cook is plausibly recorded at a kitchen table; one about a city is *not* recorded in
  that city. `RECORDING_PRESENCE` (0.62) scales bed, events and density together when a
  non-dialogue format lands on a real place, because a recording made somewhere is not
  the same as standing there.
- `services/ambienceEngine.ts` — framework-free runtime engine. Mixes the recipe's stems
  (each shaped, coloured, stereo-widened, entering its loop at a random offset), builds a
  room impulse response with early reflections and frequency-dependent decay, and
  schedules ~39 synthesised event kinds.
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
- **Events are scaled against the scene's bed**, never by a fixed makeup gain. Beds span
  ~20 dB across scenes, so a global gain puts the same footstep 11 dB over a café and
  25 dB over a therapy room. But scaling bed and events by the *same* factor made the
  ratio a scene-independent constant: the loudest spec of every scene landed on exactly
  +6.0 dB. In a library a dropped book is 20 dB over the bed and in a market a shout is
  barely 3, and that contrast is the information. Each recipe declares its own
  `eventHeadroomDb`; unannotated ones reproduce the old value. The catalogue now spans
  14 dB across 14 distinct values, asserted **in both directions** — no scene deafening,
  and the ceilings not all equal.
- **A density budget per scene, not one for the catalogue.** `activity`
  (`still`/`calm`/`busy`/`bustling`/`chaotic` → 6-52 onsets/min) says how often a scene
  puts a discrete sound in front of the listener. There used to be one ceiling of 26, and
  26 of 42 scenes were authored over it, so a full restaurant, a market, a call centre
  and a newsroom all landed on exactly 26.00. The naive count hides the worst of it
  because several synths are clusters — one `typing` occurrence is 16 key hits — so
  `EVENT_CLUSTER_SIZE` weights each kind by the root of its cluster size, and
  `ONSET_KNEE_MAX` stops a scene authored at 220/min from outranking one authored at 65.
- **The rate scale is evaluated at a fixed reference intensity, always.**
  `onsetsPerMinute` goes as 1/(1.6 − i) and the scheduler interval is multiplied by
  (1.6 − i), so computing the budget at the *live* intensity makes the two cancel
  exactly — and for one release the intensity slider changed only how loud events were,
  never how often, in 26 of 42 scenes. No retuning fixes that: a scene that always
  exactly fills a fixed budget cannot respond to anything. Pinning the evaluation makes
  `rateScale` a per-scene constant, and `check:ambience:runtime` asserts the slider moves
  the rate in every scene. `setIntensity()` therefore applies live; AudioPlayer used to
  rebuild the whole engine on every slider move, restarting every stem from a new random
  offset.
- **The bed floor is a compressor, not a clamp.** `min(MAX_BED_BOOST, FLOOR/raw)` lifted
  every quiet scene to *exactly* the floor — 12 scenes at one identical level and one
  identical event scale, an 18 dB spread crushed to 11.5 with a pile-up at the bottom.
  A ratio lift (`BED_KNEE_RATIO`) is strictly monotonic: quiet scenes come up and stay in
  order.
- **Per-scene colour.** `SceneTone` (tilt, shelves, one room mode) applies to the stem bus
  and to individual layers, with its own makeup taken back out of the gain so colouring a
  scene changes what it sounds like and not how loud it is. Without it, `room_tone`
  arrived identical in the 29 scenes that use it and a tiled corridor differed from a
  carpeted therapy room only in reverb length.
- **The floor is declared, not deduced.** `surface` was derived from `RoomSize` alone,
  which gave every `large` scene concrete — a workshop, a gym, a library, a bank and a
  police station walking on the same floor because they shared a reverb preset.
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
  1.1 s tail is one of the reasons everything used to sound like an interior. Beyond the
  five size presets, a recipe adjusts `rt60Scale` and `damping`, so two `large` rooms are
  not one room.
- **The air ceiling is continuous, not a boolean.** The mid and far event buses were
  lowpassed at `outdoor ? 6500 : 5000` and `outdoor ? 2600 : 1900`, and 70% of all event
  specs went through one of the two indoor values — so every material's identity above
  5 kHz was erased identically in every indoor scene, and a coin in a bank became the
  same tick as a fork in a restaurant. `room.brightnessHz` is a property of the room's
  surfaces and also bounds `sceneBandwidthHz()`.
- **An event should sound like the thing it is.** Three primitives produce 39 kinds, and
  several were the same synth reparameterised: `printer`/`grinder`/`compressor` shared an
  exact topology and arrived through the mid bus as one machine at three speeds. A
  printer is its stepper; a grinder *bogs* under load; a compressor cuts out and blows
  its relief valve. Likewise `coin` accelerates as it settles, `creak` glides upward
  where `chairScrape` is stick-slip, and a weight plate is a heavy modal hit rather than
  `material('metal')` twice.
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

- **No two scenes may measure the same.** `check:ambience:scenes` renders all 50 scenes
  offline through the same renderer as `ambience:preview` and compares them on four axes
  — spectrum, loudness range, event density and room signature. It fails on any pair
  below the distance floor, on a clustered catalogue (the *median* scene's nearest
  neighbour, not just the closest pair), and on any pair that drew ≥15% closer than its
  committed baseline. That last one catches slow convergence that still clears the floor,
  which is how this problem arrived in the first place.
- **No scene may be unreachable.** Seven were — `bar_night`, `plaza`, `park`, `hospital`,
  `library` and both rain variants: authored, measured, bundled, and reachable from
  nothing. Only the reverse invariant existed (no orphaned *stem*), so a recipe could be
  dead code indefinitely. Weather variants are exempt; `applyModifiers` is their route.

**Working on it**
- `npm run ambience:build` regenerates all 20 stems (deterministic — re-running gives
  byte-identical files). Pass stem names to rebuild a subset. It prints each stem's
  measurements and flags any that miss their targets.
- `npm run ambience:preview -- cafe street station` renders complete scene mixes to
  `.ambience-preview/*.wav` so you can **listen** without a browser or an API key. Run
  with no arguments to list the scenes, or `--all`.
- `npm run check:ambience:scenes` prints the closest scene pairs with the failing axis
  named, plus a per-scene table. `-- --write-baseline` re-pins
  `scripts/ambience/scene-distance.baseline.json` once the catalogue is where you want it.
- Beware when tuning a near-stationary support stem: raising its event *rate* fills in
  the quiet windows and so **reduces** the measured loudness range. That range has to
  come from the slow swell.
- A synthesised texture comes out spectrally narrow because it is made of one or two
  generators — `office_life` is keystrokes and paper, both at 1-2 kHz, and it measured
  72% of its energy in that one octave. Do not tune that by hand, and above all do not
  tune it with a different instrument than the one that judges it: `fillSpectrum()` in
  stems.mjs drives the correction from `octaveConcentration()` itself, the same function
  `check:ambience` uses, and its fill carries a swell because a flat one closes the gaps
  between events and destroys the loudness range.
- Adding a scene costs a recipe, not another 2 MB of audio. Adding a stem means adding it
  to `STEMS` (stems.mjs), `StemId` + `STEM_LEVELS_DBFS` (ambiencePresets.ts),
  **`STEM_BANDWIDTH_HZ` (ambienceEngine.ts)** — four tables, not three; that last one is
  the one that gets forgotten and it fails silently — and referencing it from at least
  one recipe. `check:ambience` enforces all four.
- Adding a scene: write the recipe, give it `activity`, `eventHeadroomDb`, `surface`,
  `brightnessHz` and a `tone`, map at least one label to it, audition it with
  `ambience:preview`, then run `check:ambience:scenes` and refresh the baseline.

### Exercise System

The exercise system is organised around a **listening syllabus**, not around rendering widgets. The unit of design is the pair *(listening stage × listening skill)*; the format is only the mechanic used to answer. Hard rule everywhere: **no written or spoken production** — everything is resolved by selecting, ordering, classifying or picking from a dropdown.

**Three axes (`types.ts`)**
- `ListeningStage`: `anticipacion` → `global` → `selectiva` → `intensiva` → `reflexion`. This is the order the UI renders.
- `ListeningSkill`: 14 sub-skills (`decodificacion`, `segmentacion`, `reconocimiento_lexico`, `dato_literal`, `idea_global`, `estructura`, `rol_fuente`, `inferencia`, `actitud_postura`, `pragmatica_registro`, `lexico_significado`, `colocacion_formula`, `variacion_dialectal`, `estrategia`).
- `ExerciseType`: 13 formats — the original five (`multiple_choice`, `true_false`, `ordering`, `classification`, `cloze`) plus `true_false_notgiven`, `matching` (bijective), `scale` (ordinal axis), `data_capture` (form with near-identical dropdowns), `dictation` (rebuild the dictated datum element by element), `minimal_pairs`, `spot_the_difference` (dictation without typing) and `chunk_order` (rebuild one sentence from breath groups).

**`dictation` — reproducing the datum, not recognising it.** A `data_capture` asks the learner to pick the whole datum out of three lookalike strings, and of its three fields only one is the announced datum (`slot.focus` only *reorders* the harvest, it never requires); the other two are whatever the regexes found. That is recognition. `dictation` reuses the same `ExerciseField[]` shape but each field is **one position of one datum**, in the order it was said, and each position offers only what is confusable *by ear* with that position (`NUMBER_CONFUSIONS`, `LETTER_CONFUSIONS`, `MINUTE_CONFUSIONS`) — never the value of another position, which would be discardable by elimination. `Exercise.separators` carries the fixed pieces the learner does *not* choose ("y", "con", "arroba"), so "catorce **con** noventa" is two controls and one label, not three controls. `verifyDictation()` is stricter than the ficha's check on purpose: the ficha's fields are independent data and it settles for a majority being heard, whereas here the fields are pieces of a single datum, so **the whole reconstructed sequence, separators included, must be heard contiguously**. Gated to A0/A1-A2 — at B1+ the literal datum is no longer the object of study.

`LessonPlan.exercises` is a **flat `Exercise[]`** ordered by stage. Each `Exercise` carries `stage`, `skill`, `slotId` and `sourceTurns` (dialogue indices, revealed in the feedback panel).

**`data/dataPoints.ts` — the dictated datum, as a first-class value**
At A0 and A1-A2 the topic decides which concrete datum the dialogue *must* contain (`inferDataPoint()` → `phone`, `price`, `time`, `spelling`…). That decision used to live inside `generateLessonPlan()` and die there, so the exercises never knew what had been dictated and the data-capture slot could land on anything. Now the `DataPointKind` travels to all three places that need it: the dialogue prompt (`instruction`), the exercise briefs (`{{dato}}`, `{{campo}}`, `{{contrastes}}`, interpolated by `getBlueprint(level, textType, mode, dataPoint)`) and the deterministic engines (`ExerciseSlot.focus`).

**`data/listeningSyllabus.ts` — the pedagogical source of truth**
- **Three budgets per level, not one.** `scripts/check-syllabus.mjs` caps cards **per level × length** (A0 3/3/3 · A1-A2 3/4/4 · B1-B2 4/5/6 · C1 4/5/6), plus a ceiling on **discrete answers** (`answerCost`: a `multiple_choice` is one answer whatever its option count, a `dictation` of six fields is six) and on **reading load** (`readingLoad`: sentence-length units, with word-level units — dictation pieces, minimal pairs, chunks, Vocabulary rows marked `rowScale: 'word'` — weighted 0.25). Both functions are exported from the syllabus so the checker and the tables can never drift. The blueprint *is* the lesson — there is no trimming step downstream — so a slot added anywhere has to displace another one.
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

**Deterministic engines** read `slot.focus` so the fallback lands on the datum too. They understand a datum dictated **in words** (`seis cinco cuatro treinta y dos…`, which is what the A0 prompt actually asks for) as well as in digits, and they group `654 32 18` into one `Teléfono` field instead of three loose `Número` ones. Word-run distractors change exactly one numeral and stay grammatical — `treinta y dos` → `cuarenta y dos`, never `veinte y dos`. The `dictation` engine segments the harvested run into the pieces a person would write down: `y` between a compound ten and a unit *binds* (`treinta y dos` is one piece), while `con`, `menos` and the `y` of a clock time *separate*. Time was invisible to every engine until `MINUTE_WORDS` (`media`, `cuarto`) started counting inside a run — `a las cinco y media` is one numeral and fell below the run threshold, so a "book an appointment" lesson shipped without a single exercise about the time. Engines exist only where a provably correct exercise can be derived from the transcript. There is deliberately **no `ordering` or `matching` engine**: both need paraphrase, and an automatic paraphrase cannot be verified. Distractors are **phonetic neighbours** of words that are actually said (see `MINIMAL_PAIR_BANK`), never topic-related words, which would be discardable by plausibility without listening. Contrasts neutralised in most varieties (b/v, ll/y, silent h, and c/z~s under seseo) are excluded on purpose.

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
- `App.tsx`: Main orchestrator - handles all state and screen rendering. The lesson is walked stage by stage: each `ListeningStage` is a **collapsible section** with an `n/m resueltos` counter, and only the first opens. Everything used to be painted in one scroll — five or six cards, several of them tables, before the learner had decided where to start — and a good part of what read as an unmanageable load was that, independently of the content. `ExerciseCard` reports each submit through the optional `onAnswered` prop; the card's own state stays its own.
- `AudioPlayer.tsx`: Transport, speech routing and ambience UI. The ambience engine itself lives in `services/ambienceEngine.ts` (see Ambient Sound System above); the component was 1529 lines when ~900 of them were the engine.
- `ExerciseCard.tsx`: Polymorphic renderer for the 13 formats; shows the skill badge, and on submit reveals the `sourceTurns` lines as proof of the key. `dictation` gets its own renderer rather than sharing the ficha's: the ficha stacks full-width dropdowns, and a nine-piece phone number rendered that way stops reading as *one* datum.
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
  - Street addresses with numbers
  - Exact times for appointments
  - Email addresses (with "arroba", "punto", "guion bajo")
- The central exercise asks the learner to **reproduce** the datum piece by piece (`dictation`), not to pick it out of a shortlist

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
6. Add a branch to `answerCost()` and `readingLoad()` in `data/listeningSyllabus.ts` — without one the format falls through to the default and its cost is mis-budgeted, which is exactly how the reading load got away in the first place.
7. Reference it from the level/mode blueprints with a `minLength`, and optionally add a deterministic engine in `services/exerciseEngines.ts` — only if the exercise can be *proved* correct against the transcript. If it is verifiable, add it to `VERIFIED_FORMATS` in `scripts/check-syllabus.mjs`.
8. Run `npm test`.

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
- **A bound every scene meets identically is not a bound**: the event-over-bed ratio, the density ceiling and the bed floor were all "satisfied" by every scene in the catalogue landing on the same number. Whenever a contract is added here, add the inverse assertion — that the catalogue actually uses the range.
- **Ambience is judged by ear, floored by measurement**: `check:ambience` asserts the numbers that separate "a place" from "noise" (energy below 250 Hz, short-term loudness range, spectral+dynamic distance between scenes). It cannot tell you a café sounds like a café — use `ambience:preview` for that.
- **Answer keys are verified, not trusted**: every exercise (model-generated *and* engine-generated) goes through `verifyExercise()` before rendering. It checks internal coherence and fidelity to the transcript. Prefer shipping one exercise fewer over one that teaches something false.
- **Never display normalised text**: accent-stripped, lowercased forms are for comparison only. Options shown to learners keep their real spelling.
- **Distractors must require listening**: phonetic neighbours of words actually said, never topic-adjacent words (those get discarded by plausibility) and never options that are ungrammatical in context (those get discarded by reading).
- **Accent Consistency**: In Standard/Vocabulary modes, both speakers use same accent; only AccentChallenge uses mixed accents

## Testing Approach

Automated checks (no API key or network needed) — run all with `npm test`:
- `npm run typecheck` — `tsc --noEmit`.
- `npm run check:audio` — asserts the TTS chunking never exceeds the per-accent character budget, never loses a turn (the `substring(0, 5000)` bug), keeps short dialogues in a single request, splits an oversized single turn by sentence instead of truncating it **while re-prefixing every piece with the speaker label**, that the PCM concatenation preserves every sample while fading only the seam, that `assignSpeakerVoices()` gives two speakers two voices that are both different *and* at least 4.5 semitones apart in every configuration (same gender, missing character sheets, acotaciones in the label, one name contained in the other) while keeping the declared gender wherever the catalogue allows it, and that the voice verifier works: it finds the pitch of a synthetic voice without reading it an octave low, accepts a two-voice track, rejects a one-voice track naming the voice that is missing, and declares itself inconclusive on too little audio or on two references too close to separate.
- `npm run check:syllabus` — walks `getBlueprint()` across the **126** valid level × text-type × mode × length combinations and asserts the pedagogical invariants: the three budgets (cards per level × length, discrete answers, reading load), **monotonicity by duration** (Short ⊆ Medium ⊆ Long), **at least one slot backed against the transcript**, **B1-B2 and C1 not sharing a `format:skill` signature**, no format outside its level or text-type range, nothing presupposing two speakers in single-voice audio, A0 free of ordering/matching/scale/V-F-NG/spot-the-difference, C1 free of basic decoding formats (`data_capture`, `dictation`, `chunk_order`), every lesson covering at least two stages and three distinct skills, stage order preserved, unique slot ids, existing engine fallbacks, no `preferEngine` without one, and Vocabulary/text-type variants genuinely differing from one another. It also prints the per-level load table, so the budget can be read instead of deduced from the slot tables.
- `npm run check:ambience` — asserts that all 148 scenario labels resolve to a curated scene (none falling through to the generic fallback, which is how 108 of them behaved before), that no scene monopolises the place-based dialogue catalogue (max 15%, where the old `OFFICE` profile held 75%) or the catalogue overall (max 10%, where `studio_podcast` once held 23%), that **each non-dialogue format uses at least 5 scenes with none over 35%** — replacing a rule that asserted nothing there and let 72% of the catalogue collapse onto four near-identical studios — that each such format still has its own default scene, that **no scene is unreachable from any label**, that every stem a recipe names exists and none is orphaned, that every `EventKind` has a registered synth, that the runtime's stem-level **and stem-bandwidth** tables match what was baked, and the acoustic floor: per stem, energy below 250 Hz and short-term loudness range within the targets declared in `stems.mjs`, plus a minimum spectral+dynamic distance between the character stems, how much of each stem's energy falls in its single fullest octave (the crowd stems once held 53-77% in one octave and passed every other bound), and that no stem steps at its loop point. It cannot tell you whether a café *sounds* like a café — `npm run ambience:preview` is for that.
- `npm run check:ambience:runtime` — instantiates the **real** `AmbienceEngine` against a fake `AudioContext` (`scripts/ambience/fakeWebAudio.mjs`, with virtual timers so minutes of scene time run deterministically) and asserts what the tables alone cannot: that a source actually starts for every layer of all 50 scenes, that loading does not depend on `start()` having been called, that `stop()` cancels an in-flight load, that every bed source reaches the destination, that the scheduler keeps firing over minutes, and the mix contract — every bed in −40..−22 dBFS, no event over 20 dB above its bed, **and the inverse: the headrooms not all equal** (≥6 distinct values spanning ≥8 dB), event density spanning ≥5× across the catalogue with no more than 6 scenes on the same rate, and **intensity actually moving the event rate in every scene**. Those last three exist because bounds every scene satisfies identically are constants, not contracts — which is exactly how 26 scenes came to fire at 26.00 onsets/min with a slider that could not change it.
- `npm run check:ambience:scenes` — the one that measures what a learner actually complains about. Renders all 50 scenes offline through `scripts/ambience/render.mjs` (shared with `ambience:preview`, so what it measures is what you audition) and compares all 1225 pairs on spectrum, loudness range, event density and room signature. Fails on any pair below the floor, on a clustered catalogue, and on regression against `scene-distance.baseline.json`. When it was first written, 18 pairs were below the floor. It prints the closest pairs with the failing axis named whether or not it passes.
- `npm run check:exercises` — feeds deliberately broken exercises (key not among the options, non-bijective matching, ordering copied verbatim from turns, V/F/NG with no NOT GIVEN item, cloze whose solution is never said, spot-the-difference flagging a word that *is* said…) to the verifier and asserts each is rejected; then asserts every deterministic engine produces exercises that pass the same verifier and never display accent-stripped text. It also pins the dictated-datum path: a phone said in words and a phone said as `654 32 18` must both yield one `Teléfono` field, and focused minimal pairs must contrast the digits rather than the greeting. And the precision contract of `dictation`: a reconstruction whose sequence is not heard contiguously is rejected, a position may not offer the solution twice, the engine rebuilds `seis cinco cuatro treinta y dos dieciocho` / `654 32 18` / `catorce con noventa` / `cinco y media` exactly (with `con` as a fixed piece, not a control), no position offers another position's value, a `multiple_choice` tagged with the datum's `slotId` does not take that slot, and exercises outside the blueprint never reach the lesson.

Checks that need an API key, network and quota (**not** part of `npm test`):
- `GEMINI_API_KEY=… npm run check:tts:live [repeticiones]` — the only check that can
  actually assert the two voices, because the one who decides is the model and the
  decision is only visible in the audio. Calls `generateAudio()` exactly as the app does
  (repair loop included) for a mixed-gender pair, two women and two men, measures the
  returned PCM and fails if any generation ends up single-voiced. Leaves the WAVs in
  `.tts-live/` — the number does not replace listening to it.
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
5. Rendering and submit/feedback for the newer formats (`dictation`, `data_capture`, `minimal_pairs`, `spot_the_difference`, `matching`, `scale`, `true_false_notgiven`, `chunk_order`), including the `sourceTurns` reveal. For `dictation`, check on a narrow screen that a long datum wraps instead of overflowing.
6. Audio generation across accent/gender combinations; localStorage persistence; error handling for invalid keys. **Listen to a dialogue whose two characters share a gender** — the case with the least margin — and confirm the two speakers are told apart without reading the transcript. If the loading log says «tramo devuelto con una sola voz», the repair fired and the lesson is fine; if it says it twice for the same chunk, the model is drifting and the pitch table is the first thing to re-measure.
7. Ambience: confirm the player's `N/M capas` counter reaches the total (it is the tell for a silent bed). Play a `Café / Restaurante`, a `Taxi / Transporte`, a `Taller Mecánico`, an `Aeropuerto / Aerolínea`, an `El Tiempo` (RadioNews) and a `Mi Rutina Diaria` (Podcast) — they should be recognisable blind and clearly different from one another. Check that the bed ducks under speech without pumping between syllables, that the volume/intensity/ducking/mute settings survive generating a new lesson, and that deleting `public/ambience/` degrades to a working player rather than an error.
7b. The formats that used to have no place: generate a `Aprendí a Cocinar` and a `Mi Ciudad Favorita` (both Podcast) and confirm the first is a kitchen table and the second a booth — the mapping is by recording setup, so the city episode is *supposed* to stay in the studio. A `Geopolítica` (RadioNews) should audibly be a phone line. A `Monólogo de Humor` should be a room with an audience in it.
7c. Move the intensity slider mid-playback: events must get **more frequent**, not just louder, and the bed must not restart. For one release the slider was a pure loudness control in 26 of 42 scenes and every nudge rebuilt the whole engine.
