# Repository Guidelines

## Project Structure

- `index.tsx` / `App.tsx`: App entry and top-level state/UI flow.
- `components/`: Reusable React UI (PascalCase files like `AudioPlayer.tsx`).
- `services/`: External API integrations (notably `services/geminiService.ts`).
- `data/`: Scenario/content database (`data/scenarios.ts`).
- `public/`: Static assets served by Vite (logos, images).
- `types.ts`: Shared TypeScript types/enums for app state and content.

## Setup, Build, and Local Development

- Install deps: `npm install`
- Run dev server (port 3000): `npm run dev`
- Production build: `npm run build`
- Preview the build locally: `npm run preview`
- Type-check (recommended): `npx tsc -p tsconfig.json --noEmit`

## Configuration & Secrets

- Do not commit secrets. Use `.env.local` (gitignored via `*.local`).
- Vite config reads `GEMINI_API_KEY` (`vite.config.ts`).
- The UI also stores the Gemini key in `localStorage` under `gemini_api_key`.

## Coding Style & Naming

- TypeScript + React (Vite). Keep changes small and match existing file style (indentation varies across older files).
- Components: `PascalCase.tsx`; functions/vars: `camelCase`.
- Prefer `@/` alias for root-based imports when it improves clarity.
- Avoid committing backup/temporary files (e.g., `*.backup`).

## Testing

- `npm test` runs the type check plus two assertion scripts that need no API key or network:
  - `npm run check:syllabus` — pedagogical invariants of `data/listeningSyllabus.ts` across every level × text-type × mode combination.
  - `npm run check:exercises` — the answer-key verifier (`services/exerciseVerification.ts`) and the deterministic engines.
- There is no component test runner yet. If you add one, wire it into the `test` script and colocate the tests near the code (e.g., `components/__tests__/`).

## Commits & Pull Requests

- Follow existing commit style (Conventional Commits): `feat: …`, `fix: …`, `docs: …` (optional scopes allowed).
- PRs should include: what changed, why, screenshots for UI changes, and any new env vars or setup steps.
