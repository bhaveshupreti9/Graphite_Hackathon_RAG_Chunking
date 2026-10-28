# SmartChunk

SmartChunk is a structure-aware chunker for RAG. It reads PDF, Markdown, text, CSV, TSV and Excel (.xlsx) files. It compares itself with a traditional fixed-size chunker on the same document, with the same embedder, vector database and prompt.

```
smartchunk-project/
  backend/      FastAPI app: routes, schemas, errors, jobs, registry, summarizer
  smartchunk/   the chunker: loading, parsing, cleaning, semantic split, dedup, damage, stats
  baseline/     the traditional fixed-size token chunker
  retrieval/    embedder, Chroma store, LLM client, RAG answer pipeline
  eval/         questions.json, metrics, run_eval.py -> eval/results.json
  classifier/   optional topic-boundary classifier
  contracts/    example JSON for every response (shared with the frontend)
  data/samples/ sample documents
  tests/        pytest suite (offline)
  frontend/     Vite + React app
```

## Run the backend

Python 3.10 or newer. On the first run, the embedding model (~90 MB) and the tiktoken file need internet access.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env               # macOS/Linux: cp .env.example .env
#   then set LLM_API_KEY (and LLM_BASE_URL / LLM_MODEL if you don't use OpenAI)
uvicorn backend.main:app --port 8000
```

Run these from the project root. Start only one worker, because job progress is kept in memory.

To check the server, open http://localhost:8000/api/health, or the interactive docs at http://localhost:8000/docs.

## Run the frontend against it

```bash
cd frontend
copy .env.example .env               # VITE_API_BASE_URL=http://localhost:8000, VITE_USE_MOCK=false
npm install
npm run dev                          # http://localhost:5173
```

Turn **Demo mode** off in the navbar so the app uses the real API.

## Evaluation

```bash
python -m eval.run_eval              # writes eval/results.json, shown on /evaluation
```

Use the real embedding model for this. Numbers produced with `EMBEDDING_BACKEND=hash` are only good for testing.

## Tests

```bash
pytest                                # offline: hashing embedder, fake LLM, temp folders
cd frontend && npm run typecheck && npm run lint && npm run check:contract && npm run build
```

## Without an LLM key

Without an LLM key you can still upload, process, explore, visualise, compare chunks and export. Chat returns `LLM_NOT_CONFIGURED`, except for "not found" answers, which never call the model.

The document summary is skipped, with a warning. The session summary uses a simple vote-count recap.

See `INTEGRATION_NOTES.md` for every assumption made where the spec was silent.
