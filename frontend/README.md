# SmartChunk frontend

React + TypeScript + Three.js site for SmartChunk (PART C of the build spec). It talks to the
FastAPI backend through one API client, or runs fully offline on the `/contracts` data in demo mode.

## Run it

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:8000, VITE_USE_MOCK=false
npm run dev                 # http://localhost:5173 (port is fixed: the backend CORS list expects it)
```

No backend yet? Either set `VITE_USE_MOCK=true` in `.env`, or switch on **Demo mode** in the navbar
at runtime. Demo mode answers every endpoint from `../contracts/*.json` and works with no internet.

## Scripts

| Command                           | What it does                                                               |
| --------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                     | Copies `../contracts` into `src/api/contracts`, starts Vite                |
| `npm run build`                   | Type-checks (`tsc -b`) and builds to `dist/`                               |
| `npm run preview`                 | Serves the production build                                                |
| `npm run lint`                    | ESLint, zero warnings allowed                                              |
| `npm run typecheck`               | TypeScript only                                                            |
| `npm run format` / `format:check` | Prettier                                                                   |
| `npm run check:contract`          | Validates every `../contracts/*.json` against the zod schemas the app uses |

Run `npm run check:contract` (frontend) and `pytest tests/test_api_contract.py` (backend) before every
demo. If both pass, the two sides agree on PART A.

## Where things live

```
src/
├── api/
│   ├── client.ts        # the ONLY file that calls fetch; one typed function per endpoint (A7)
│   ├── mock.ts          # demo-mode backend built from /contracts (same signatures)
│   ├── schemas.ts       # zod schemas for every response (dev-time validation + check:contract)
│   ├── errors.ts        # ApiError + friendly text for every error code
│   └── contracts/       # copy of ../contracts (refreshed by npm run dev / build)
├── types/api.ts         # PART A6 types, verbatim (snake_case)
├── types/requests.ts    # request bodies and small responses described inline in A7
├── store/useAppStore.ts # Zustand (persisted): doc_id, settings, processResult, chats, qaItems, demoMode
├── three/               # 3D scenes (lazy-loaded): hero + scroll story, processing pipeline, 2D fallback
├── components/          # shared UI (ChunkCard, TokenMeter, ScoreBar, StatCard, DamageHighlight, ...)
├── components/chat/     # ChatView (shared by both chat pages) and AnswerDetails
├── pages/               # one file per route in A11
└── lib/                 # settings ranges, damage heuristic, formatting, polling, palette
```

## Design system

- Colours are CSS variables in `src/index.css` and Tailwind tokens in `tailwind.config.js`. Charts and
  3D scenes read the same variables through `src/lib/palette.ts`.
- Semantic colours: green `good` = intact, red `bad` = broken, grey `noise` = removed. Accent: electric
  indigo (also the SmartChunk series colour); Traditional series uses `naive` (dusty rose).
- Chunk types: prose (blue), code (amber), table (orchid), list (orange). All chart and type colours
  were checked for colour-blind separation on the dark surface.
- Type: Bricolage Grotesque (UI) and JetBrains Mono (code), self-hosted via `@fontsource-variable`,
  so the site works offline in demo mode.

## 3D and motion

- Landing: one instanced mesh draws two copies of a document. A blade cracks the traditional copy (red);
  the SmartChunk copy snaps into labelled section groups (green). GSAP ScrollTrigger moves the scene
  through six stages: Problem, LLM, Context window, RAG, Vector DB, Solution.
- Upload page: a 3D pipeline lit by the real `step` and filled by the real `progress`.
- Every scene is lazy-loaded, caps `dpr` at 2, pauses when off-screen or the tab is hidden, disposes
  its geometries and materials, renders a static frame with `prefers-reduced-motion`, and falls back to
  2D when WebGL is missing or the scene throws. On phones the pipeline is 2D and the hero is faded.
- All real content (story text, step list, labels) is in the DOM; canvases are `aria-hidden`.

## Demo-mode test triggers

| Do this                                                 | You get                                              |
| ------------------------------------------------------- | ---------------------------------------------------- |
| Upload a file named `*scanned*.pdf`                     | `SCANNED_PDF`                                        |
| Upload a file named `*encrypted*.pdf`                   | `ENCRYPTED_PDF`                                      |
| Upload an empty file or `*empty*`                       | `EMPTY_DOCUMENT`                                     |
| Upload a `.docx` or a file over 20 MB                   | `INVALID_FILE_TYPE` / `FILE_TOO_LARGE` (client-side) |
| Upload `*crash*.md`, then Process                       | processing ends with `status: "error"`               |
| Ask a question containing `__error__`                   | `LLM_ERROR`                                          |
| Ask about something not in the doc ("weather in Paris") | `not_found: true`                                    |

The mock database lives in `localStorage` (`smartchunk-mock-db`); clear site data to reset it.

See `TEST_CHECKLIST.md` for the full manual test pass.
