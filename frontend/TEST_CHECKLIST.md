# Frontend manual test checklist

Run once with **Demo mode on**, then again against the real backend (`VITE_USE_MOCK=false`).

## Setup

- [ ] `npm install`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:contract` all pass
- [ ] `npm run dev` opens on http://localhost:5173 with no console errors

## Landing `/`

- [ ] Hero: Traditional blocks crack red as the blade passes; SmartChunk blocks group into green frames
- [ ] Scrolling moves through Problem, LLM, Context window, RAG, Vector DB, Solution (rail on the right follows)
- [ ] Clicking a rail item scrolls to that stage
- [ ] Phone width (390 px): text is readable over the faded scene, no horizontal scroll

## Upload `/upload`

- [ ] Samples list loads; clicking one uploads it (green file bar shows filename and doc_id)
- [ ] Drag-and-drop and "Choose a file" both work for .pdf, .md, .markdown, .txt
- [ ] .docx and >20 MB are rejected client-side with friendly text
- [ ] Each upload error code shows its friendly message and a Retry button
- [ ] Settings: out-of-range values and min >= max / overlap >= window show inline errors and disable Process
- [ ] Process: 3D pipeline lights the active step, fill follows progress, never moves backwards
- [ ] Leaving the page mid-run stops polling; coming back resumes it
- [ ] Results: both method panels, type distribution, damage counts, removed items with filters
- [ ] A new upload clears old results, chats and votes

## Explorer `/explorer`

- [ ] SmartChunk / Traditional tabs, type filter chips, pagination (Previous / Next)
- [ ] Row click and Enter open the drawer; Escape closes it; code/tables are monospace
- [ ] Traditional rows show "No heading path"; `page: null` shows "n/a"
- [ ] Download JSONL saves `<doc_id>_<method>.jsonl`, one chunk per line

## Chats `/chat/smart`, `/chat/traditional`

- [ ] Summary, key topics and suggested questions show (empty summary shows the LLM-not-configured text)
- [ ] Clicking a suggested question asks it
- [ ] Answer shows sources, token meter, latency, retrieved chunks with score bars, "Show prompt"
- [ ] A follow-up with "it"/"that" shows "Searched for: …" (rewritten question)
- [ ] An off-topic question shows the grey "Not found in document" state and no token meter
- [ ] `__error__` (demo) shows the error with Retry; Retry re-asks
- [ ] History survives a reload; Clear chat empties it

## Comparisons

- [ ] `/compare/chunks`: damage table, "same passage" picker opens on a split passage, columns coloured green/red, removed items grey
- [ ] `/compare/answers`: Ask both shows two answer columns; votes toggle and persist; "Summarise session" shows the voted count

## Visualiser `/visualize`

- [ ] Plays automatically: blade cuts the Traditional column, red marks broken blocks, grey noise flies out of the SmartChunk column, both columns separate into chunks, green section frames appear
- [ ] Pause, Restart, speed, the scrubber and the four step buttons all control the same timeline
- [ ] Side by side / Traditional / SmartChunk views animate between layouts
- [ ] Hovering a block shows its type, heading path, page and verdict; clicking opens both versions in the side panel
- [ ] "Blocks the traditional chunker broke" list matches the red blocks; clicking one selects it
- [ ] Drag rotates, scroll zooms; no WebGL shows the 2D version; phone width works

## Summary, Evaluation, Knowledge, How it works

- [ ] `/summary` with no compared questions shows the empty state with a link
- [ ] `/summary` shows recap, findings, Q&A table with winners; Export as Markdown downloads a .md
- [ ] `/evaluation`: charts with legends and value labels, "View as table", MRR toggle, classifier table only if not null
- [ ] `/evaluation` with no `eval/results.json` (real backend) shows the empty state, not an error
- [ ] `/knowledge`: open a ready document (goes to Explorer), delete asks for confirmation, current document is highlighted
- [ ] `/how-it-works` animations play once when scrolled into view

## Resilience

- [ ] Backend stopped, Demo mode off: every page shows "Can't reach the backend" with Retry, nothing crashes
- [ ] Guarded pages without a processed document redirect to `/upload` with a message
- [ ] Chrome with `--disable-webgl`: landing shows the 2D fallback; upload shows the 2D step list only
- [ ] OS "reduce motion" on: scenes render static frames, no scroll-scrubbed animation
- [ ] Keyboard only: skip link, navbar menus (Escape closes), table rows, drawer, dialogs all reachable
