# INTEGRATION_NOTES

Assumptions made while building the frontend (PART C, phases C1 to C6). The contract in PART A was
**not** changed: no route, field, enum or error code was renamed or added.

## Contract and API layer

1. **Location.** Frontend lives in `frontend/`, contract examples in `contracts/` at the repo root. `frontend/scripts/sync-contracts.mjs` copies `contracts/*.json` into `frontend/src/api/contracts/` before `npm run dev` and `npm run build` (the copy approach allowed by C3 rule 3). The copies are committed so `tsc` and `eslint` work without running the script first.
2. **Contract files.** A9 lists 15 files; they did not exist yet, so they were created from the A9 examples and extended with realistic data (`chunks_page.json` holds a 24-chunk tutorial). **The backend must reuse these same files** for its contract tests. Responses with no contract file (`/api/health`, `/api/upload-sample`, `DELETE /api/documents/{id}`) are built inline by the mock layer.
3. **Not-found `prompt_sent`.** When `not_found` is true the LLM is not called, so no prompt is built. The frontend expects `"prompt_sent": ""` (empty string, not `null`, because A6 types it as `string`) and hides the "Show prompt" expander when it is empty. **Backend: please return `""` here.**
4. **Extra request/response types.** A7 describes request bodies and the health, compare and delete responses inline, with no named type in A6. They are declared in `src/types/requests.ts`. `src/types/api.ts` is A6 verbatim.
5. **Strict zod schemas.** Every schema uses `.strict()`, so a backend response with an extra field is logged in dev (`console.error`). It only logs; it never blocks the UI. `npm run check:contract` runs the same schemas over `/contracts`.
6. **Store keys.** C3 rule 10 names the persisted keys `doc_id`, `filename`, `settings`, `processResult`, `qaItems`, `demoMode`, plus chat histories. They are used as written. API payload keys stay snake_case.
7. **Client-side validation.** `uploadFile` checks extension and the 20 MB limit, and `startProcess` checks every A5 range (plus min < max and overlap < window) before sending. Failures throw the matching contract codes (`INVALID_FILE_TYPE`, `FILE_TOO_LARGE`, `VALIDATION_ERROR`) locally. The backend must still validate.
8. **Client-only error codes.** `NETWORK_ERROR` (spec C3 rule 5) and `TIMEOUT` (AbortController fired). When `/api/processing-status` returns `status: "error"`, the UI shows `error_message` under the local label `PROCESSING_FAILED`. None of these are sent to the backend.
9. **Chunk lists for comparison.** `/compare/chunks` requests `page_size=200` (the A7 maximum) for each method. Documents with more than 200 chunks show the first 200 in the columns; the damage table still uses the full `ProcessResult` stats.

## Behaviour

10. **Mock switch.** The mock is active when `VITE_USE_MOCK=true` **or** the runtime Demo mode toggle is on. When the env var forces it, the toggle is locked on.
11. **`DocGuard`.** `/explorer`, `/chat/*`, `/compare/*` and `/summary` redirect to `/upload` with a message while no processed document exists. In demo mode the navbar offers "Load demo document".
12. **Chat details after reload.** The store persists only `ChatTurn`s (role + content), as C3 rule 10 says. Full `ChatResult`s (citations, retrieved chunks, tokens) are cached in memory for the tab, so after a page reload older answers show as plain text.
13. **Compare follow-ups.** `/api/compare` history is built from the last three compared questions with their SmartChunk answers (6 turns max).
14. **Per-chunk damage colours.** The contract reports damage only as totals (`MethodStats.split_*`). Green/red on individual chunks in the comparison views comes from a text heuristic in `src/lib/damage.ts` (odd code fences, unbalanced brackets, table rows without a header or with a cut last row, chunks starting mid-sentence). SmartChunk structural chunks are shown as intact. Heading detection ignores lines inside code fences.
15. **"Same passage, two outcomes".** Matches a SmartChunk code/table chunk to traditional chunks by normalised line overlap. It opens on the most-split passage.

## Demo mode (mock)

16. **Traditional chunks in demo mode** are real fixed-size windows (with overlap) over the same text, including page headers, footers and the duplicates SmartChunk removed. One mock "token" is about 0.8 characters of window so the short sample gives enough chunks to compare. `MethodStats` counts are computed from those chunks using the B4 definitions.
17. **Demo answers** come from keyword retrieval and quote the best chunk. No LLM is called. Follow-ups are rewritten only when the question contains a pronoun (it, that, this, they...).
18. **Mock process timeline** walks the A8 steps over about 10 s with monotonic progress. Triggers: file names containing `scanned`, `encrypted`, `empty`, `crash`; questions containing `__error__`.
19. **Mock persistence.** The mock database is stored in `localStorage` (`smartchunk-mock-db`) so a demo survives reloads.

## Tooling and design

20. **Fonts** are self-hosted with `@fontsource-variable` (Bricolage Grotesque, JetBrains Mono). They add a few hundred KB of font files and no runtime code, and keep demo mode fully offline. `tsx` (dev only) runs `check:contract`. No other libraries beyond the C1 stack.
21. **Dependency versions.** `@react-three/fiber` 8 and `drei` 9 target React 18. Zod 3, Tailwind 3, Zustand 5, Recharts 2, Framer Motion 11, GSAP 3.
22. **Dev server.** `strictPort: true` on 5173 so the A3 CORS origin always matches. Heavy dependencies are listed in `optimizeDeps.include` so Vite never re-bundles mid-session (which can load two copies of React).
23. **3D labels** use drei `Html` (DOM), not drei `Text`, because `Text` downloads a font from a CDN at runtime and would break offline demo mode.

## Chunking visualiser (added after C6)

24. **New page `/visualize`** (Compare menu, plus a "Visualise chunking" button on the Upload results). It uses only existing endpoints (`GET /api/chunks` for both methods, `page_size=200`) and the stored `ProcessResult.removed_report`, so the API contract is unchanged. Guarded by `DocGuard` like the other document pages.
25. **Positions are reconstructed.** The contract has no character offsets, so `src/lib/chunkGeometry.ts` puts both chunk sets on one document axis: SmartChunk chunks are the blocks (length = `token_count`), and each traditional chunk's start is found by matching its first lines against the SmartChunk text, falling back to token-count interpolation. The page says how many positions were estimated when matching is below 90%.
26. **"Broken" follows the B4 definition.** A cut inside a block only counts as breaking it when no single traditional chunk contains the whole block; otherwise the cut is drawn white ("overlap kept a copy"). The visualiser's broken count therefore agrees with the comparison page.
27. **Limits.** Long documents show the first 160 SmartChunk chunks and the first 200 traditional chunks (the API page-size maximum); a note appears when this happens.

## Backend (Part B)

28. **One worker only.** Job status is kept in memory (`backend/jobs.py`), so run `uvicorn backend.main:app` without `--workers`. If the server restarts mid-job, `GET /api/processing-status` reports `error` ("interrupted") instead of a stuck `running`. Ready documents survive restarts via `data/registry.json`, Chroma and `outputs/*.jsonl`.
29. **Upload validation happens at upload time.** The file is parsed once on upload, so `EMPTY_DOCUMENT`, `SCANNED_PDF` and `ENCRYPTED_PDF` come back from `/api/upload` (422) rather than as a failed processing job. Allowed extensions: `.pdf`, `.md`, `.markdown`, `.txt`. Upload file names are reduced to their base name (`../../x.md` becomes `x.md`).
30. **Not found skips the LLM.** When the best retrieval score is below `not_found_threshold`, chat returns `not_found: true` with HTTP 200 even if no LLM is configured. `LLM_NOT_CONFIGURED` (503) appears only when the model would actually be called.
31. **No LLM configured.** Processing still completes; the summary fields are empty and a warning is added to `ProcessResult.warnings`. `/api/session-summary` falls back to a vote-count recap instead of failing.
32. **Unknown routes** return the A4 envelope with code `NOT_FOUND` (404). This code is outside the A4 list, but only appears for URLs the frontend never calls.
33. **Chat settings.** `/api/chat` and `/api/compare` use the settings the document was last processed with (`top_k`, `not_found_threshold`).
34. **Offline fallbacks.** `EMBEDDING_BACKEND=hash` swaps the sentence-transformers model for a deterministic hashing embedder (used by the tests). If tiktoken cannot download `cl100k_base`, a regex tokenizer is used and logged. Both make token counts and retrieval quality differ from production.
35. **Evaluation pools all sample documents into one index per method.** Scored one file at a time, recall@5 is meaningless for the baseline: with 500-token windows the handbook is 1 naive chunk and the API reference 2, so "top 5" is the whole file. Even pooled, the baseline has only ~9 chunks, so its top 5 covers over half the corpus. A hit means the retrieved chunk contains at least 80% of the answer passage's words. `classifier` is filled by `classifier/boundary.py` (heading-derived boundary labels; small test set).

## Accounts (added after Part A)

36. **New endpoints** outside the original contract: `POST /api/auth/register` and `POST /api/auth/login` (body `{username, password}`, returns `{username, token}`), `GET /api/auth/me` (`{username}`) and `POST /api/auth/logout` (`{logged_out: true}`). New error codes: `UNAUTHORIZED` (401), `INVALID_CREDENTIALS` (401), `USERNAME_TAKEN` (409).
37. **Every document endpoint needs `Authorization: Bearer <token>`.** `/api/health`, `/api/samples` and `/api/evaluation` stay public. Documents belong to the user who uploaded them; another user's document answers `DOC_NOT_FOUND`, exactly like a missing one.
38. **Storage.** Passwords are salted PBKDF2-SHA256 hashes in `data/users.json`; sessions (7 days) are stored as token hashes in `data/sessions.json`. Usernames are case-insensitive. `AUTH_REQUIRED=false` turns accounts off (everyone acts as `guest`).
39. **Frontend.** `/login` (Log in / Sign up tabs). Upload, Knowledge Base and every document page require login; landing, How It Works and Evaluation do not. Demo mode needs no account (any username and password work), so the offline backup demo is unaffected. A 401 `UNAUTHORIZED` from any call logs the user out and shows the login page. Logging in as a different user clears the previous user's document, chats and votes from the browser.
40. **Documents uploaded before accounts existed** have no owner and are hidden. Upload them again after logging in.

## Spreadsheets, answer style and summarised history (added after Part A)

41. **CSV, TSV and Excel (.xlsx, .xlsm)** are accepted. `smartchunk/tabular.py` turns each sheet into Markdown: a one-paragraph description, a **Column overview** table (type, filled, unique, min, max, average, sum, most common values) and a **Data** table with row numbers. All sheets go into one page so identical header rows are never stripped as page headers. The data table holds the first 2,000 rows per sheet; statistics cover up to 50,000. Old `.xls` files are not supported (save as .xlsx). Excel needs `openpyxl` (added to requirements.txt). `DocumentInfo.pages` holds the sheet count for workbooks.
42. **Answer prompt.** The model answers from the document first and cites it. When the document only partly covers a question, or does not cover it, the model adds a final section starting `Beyond the document:`, which the UI shows in a separate, labelled box. It is asked to use Markdown tables for lists of items with properties, comparisons and figures. Both methods get the identical prompt.
43. **Default "Not found" cut-off lowered from 0.25 to 0.15** so loosely related questions still reach the model. Saved browser settings that still hold 0.25 are moved to 0.15 once (store version 2).
44. **Compare rewrites a follow-up once** and gives both methods the same standalone question (one fewer model call per comparison).
45. **Summarised history** (`backend/memory.py`): per user and document, the 12 most recent questions stay word for word; older ones are folded 6 at a time into a short summary (by the model, or a built-in summariser without one) in a background thread. The summary is used when rewriting follow-up questions. Endpoints: `GET /api/history`, `GET /api/history/{doc_id}`, `DELETE /api/history/{doc_id}`. Deleting a document deletes its history. Page: Insights → History. Demo mode keeps the same history in the browser.
46. **Answers render Markdown** (tables, bold, italic, inline code, lists, headings, quotes, links) with a small built-in renderer: no new npm packages, and nothing is rendered as raw HTML.
47. **`.env` loading.** The backend always reads the `.env` next to `requirements.txt` and lets it override values already set in the terminal. Tests set `SMARTCHUNK_SKIP_DOTENV=1` so a real `.env` never leaks into them.
