# SmartChunk: Structure-Aware RAG Chunking Engine

> GRAPHITE 26 | PS 8 | Track: AI/ML | Difficulty: Moderate

SmartChunk is a document chunking engine for Retrieval-Augmented Generation (RAG) systems. It parses a document's structure (headings, code fences, tables, lists) and detects topic shifts with sentence embeddings **before** cutting, so chunks stay complete, clean and metadata-rich. A web demo runs the same RAG pipeline twice, once over traditional fixed-size chunks and once over SmartChunk chunks, so the effect of chunking quality can be measured directly.

---

## Table of Contents

1. [Problem](#1-problem)
2. [Solution Overview](#2-solution-overview)
3. [Core Concepts](#3-core-concepts)
4. [System Architecture](#4-system-architecture)
5. [Chunking Engine (Technical Details)](#5-chunking-engine-technical-details)
6. [Retrieval and RAG Pipeline](#6-retrieval-and-rag-pipeline)
7. [Optional Trained Boundary Classifier](#7-optional-trained-boundary-classifier)
8. [Evaluation Methodology](#8-evaluation-methodology)
9. [Web Application](#9-web-application)
10. [API Contract](#10-api-contract)
11. [Project Structure](#11-project-structure)
12. [Tech Stack](#12-tech-stack)
13. [Setup and Run](#13-setup-and-run)
14. [Output Format (JSONL)](#14-output-format-jsonl)
15. [Results](#15-results)
16. [Limitations](#16-limitations)
17. [Testing](#17-testing)
18. [Team](#18-team)

---

## 1. Problem

Most RAG systems split documents every fixed number of tokens, ignoring what they cut through:

| Failure | Consequence |
|---|---|
| Code blocks sliced mid-function | The LLM receives incomplete code and gives wrong or partial answers |
| Headings separated from their content | Retrieved chunks lack context about what section they belong to |
| Tables and lists mangled | Rows and columns lose meaning |
| Repeated headers/footers in PDFs | Noise chunks pollute search results |
| Near-duplicate content | Duplicate chunks waste the top-k retrieval slots and the context window |

The LLM is often not the problem. The retrieved context is.

## 2. Solution Overview

SmartChunk is a chunking engine that:

1. **Parses structure first**: converts a document into typed, atomic blocks (heading, prose, code, table, list).
2. **Finds semantic boundaries**: uses sentence embeddings and cosine similarity to detect topic changes between prose sentences.
3. **Removes noise**: strips repeated headers/footers and near-duplicate chunks.
4. **Exports rich metadata**: every chunk carries source, page, heading path, type and token count, ready for any vector database.

The demo website compares it against a traditional fixed-size splitter using an identical RAG pipeline (same embedding model, vector DB settings, top-k, prompt, LLM and temperature). **Only the chunking differs.**

## 3. Core Concepts

| Concept | Role in this project |
|---|---|
| **LLM** | Generates final answers, document summaries, standalone follow-up questions and session recaps. It never performs chunking. Temperature is fixed at 0 for reproducible comparison. |
| **Context window** | The maximum tokens an LLM can read per request (question + instructions + retrieved chunks + answer). This is why documents must be chunked. The app budgets `top_k x chunk_size + prompt overhead` and shows a token meter. Long documents are summarised hierarchically (section summaries, then a summary of summaries). |
| **RAG** | Retrieve top-k relevant chunks, augment the prompt with them, then generate. Retrieval quality depends directly on chunk quality. |
| **Vector database** | ChromaDB stores chunk embeddings plus metadata (heading path, page, type) and supports similarity search and metadata filtering. |

## 4. System Architecture

```
                         +---------------------------+
   Upload (PDF/MD/TXT)   |      React Frontend       |
   ------------------->  |  (3D landing, chat, UI)   |
                         +-------------+-------------+
                                       | REST (JSON)
                         +-------------v-------------+
                         |      FastAPI Backend      |
                         +-------------+-------------+
                                       |
        +------------------------------+------------------------------+
        |                                                             |
+-------v---------+                                         +---------v--------+
| Traditional path|                                         |  SmartChunk path |
| plain text      |                                         | parse -> clean   |
| fixed 500 tok   |                                         | -> semantic split|
| 50 overlap      |                                         | -> dedup -> meta |
+-------+---------+                                         +---------+--------+
        |                                                             |
        +----------------------+--------------------------------------+
                               |
                  Same embedding model (all-MiniLM-L6-v2)
                               |
                 +-------------v--------------+
                 |          ChromaDB          |
                 | smart_<doc>   naive_<doc>  |
                 | summary_<doc> memory_<sid> |
                 +-------------+--------------+
                               |
                 Query -> standalone rewrite -> top-k retrieval
                               |
                 Prompt builder (context-window check)
                               |
                          LLM (temp 0)
                               |
          Answer + citations + tokens + latency + not_found flag
```

### Per-question flow

```
Follow-up question
  -> rewrite as standalone question using recent chat history
  -> embed question
  -> ChromaDB top-k similarity search (optional metadata filter)
  -> weak-retrieval check (similarity below threshold => "Not found in document")
  -> build prompt, verify it fits the context window
  -> LLM generation (temperature 0)
  -> return answer, citations (heading path + page), retrieved chunks, tokens, latency
```

## 5. Chunking Engine (Technical Details)

### 5.1 Pipeline

```
load -> clean -> parse into blocks -> group blocks -> semantic split -> dedup -> attach metadata
```

### 5.2 Document loading

- **Markdown/TXT**: read directly.
- **PDF**: PyMuPDF extracts text with font sizes; heading levels are inferred from relative font size and weight and converted to Markdown-like structure.
- Scanned (image-only) and encrypted PDFs are detected and rejected with a clear message. OCR is out of scope.

### 5.3 Structure-aware parsing

The parser produces typed blocks: `heading`, `prose`, `code`, `table`, `list`.

- Code fences (```` ``` ````), tables and lists are **atomic**: they are never split.
- A heading is always kept attached to the content beneath it.
- A heading stack tracks the hierarchy, so each block gets a path such as `Algorithms > Search > Binary Search`.
- Oversized code blocks or tables are split only at safe points (between functions or rows) with the heading repeated, never mid-statement or mid-row.

### 5.4 Semantic boundary detection

Applied to **prose blocks only**:

1. Split prose into sentences.
2. Embed sentences (or small 2-3 sentence windows) with `all-MiniLM-L6-v2`.
3. Compute cosine similarity between adjacent embeddings.
4. Mark a topic boundary where similarity falls below a threshold (fixed value or `mean - k * std`).
5. Enforce `MIN_CHUNK_TOKENS` and `MAX_CHUNK_TOKENS`, and never cut through a structural block.

Note: `all-MiniLM-L6-v2` truncates input at about 256 word-piece tokens. Chunks are sized accordingly; for large code blocks or tables the heading plus the leading portion is embedded while the full text is stored and returned.

### 5.5 Noise and duplicate removal

- **Headers/footers**: lines repeating across many pages are detected after normalising page numbers (for example `Page 4` and `Page 5` become the same pattern) and removed.
- **Near-duplicates**: MinHash (`datasketch`) or embedding cosine similarity above a threshold (about 0.95, tunable) causes a chunk to be dropped or merged.
- A **removed-content report** is produced so cleaning is visible in the UI.

### 5.6 Traditional baseline

`baseline/naive.py` extracts plain text and splits it into fixed 500-token chunks with 50-token overlap, with no structure awareness and no cleaning. It also computes **structural damage counts** (split code blocks, split tables, orphan headings).

## 6. Retrieval and RAG Pipeline

- **Embedder**: one shared `sentence-transformers` model instance for both methods.
- **Vector store**: ChromaDB with cosine distance, one collection per method per document.
- **Collections**:

| Collection | Contents | Used for |
|---|---|---|
| `smart_<doc>` | SmartChunk chunks + metadata | SmartChunk chatbot |
| `naive_<doc>` | Fixed-size chunks | Traditional chatbot |
| `summary_<doc>` | Document summary, section summaries, key facts | Overview questions |
| `memory_<session>` | Past Q&A | Session summary, long conversations |

- **Follow-up handling**: the LLM rewrites a follow-up into a standalone question using the last few turns; the rewritten question is embedded for retrieval.
- **Grounded generation**: the prompt instructs the LLM to answer only from the provided context and to cite sources. If top similarity is below a threshold, the system answers "Not found in document" instead of guessing.
- **LLM access**: through an OpenAI-compatible client, so providers (Groq, Gemini, Ollama, etc.) can be switched through `.env` only.

## 7. Optional Trained Boundary Classifier

The booklet requires using an embedding model; training is an optional extension. If implemented:

- **Data**: documents with known section structure. Sentence pairs within a section are labelled 0 (no boundary); pairs crossing a heading are labelled 1 (boundary). Labels come from headings, so no manual labelling is needed.
- **Features**: cosine similarity, embedding difference, sentence lengths, heading proximity.
- **Model**: logistic regression or a small gradient-boosted model (scikit-learn).
- **Evaluation**: precision, recall and F1 compared against the plain threshold method on a held-out set.

The classifier is adopted only if it beats the threshold baseline. Results are reported either way.

## 8. Evaluation Methodology

Better-looking chunks do not by themselves prove better retrieval, so the project measures it:

1. Select 2-3 messy documents (code-heavy, table-heavy, PDF with repeated headers/footers).
2. Write 20-30 questions, each tagged with the ground-truth answer passage and a type (code, table, prose).
3. Build both chunk sets with the same embedder and store settings.
4. Run every question against both collections.
5. A retrieved chunk counts as correct if it contains the ground-truth passage (or most of it).

| Metric | Meaning |
|---|---|
| **Recall@5** | Share of questions where a correct chunk appears in the top 5 |
| **MRR** | Mean reciprocal rank of the first correct chunk |
| **Split code blocks / tables** | Structural damage count per method |
| **Duplicate chunks** | Near-duplicate chunks remaining |
| **Noise chunks** | Header/footer chunks remaining |

Results are precomputed by `eval/run_eval.py` into `eval/results.json` and displayed on the Evaluation page. Cases where SmartChunk does not win are reported too.

## 9. Web Application

Frontend: React + TypeScript with Three.js (react-three-fiber) for 3D motion, GSAP/Framer Motion for animation. Backend: FastAPI.

| Page | Route | Purpose |
|---|---|---|
| Landing | `/` | 3D scroll story: Problem, LLM, Context window, RAG, Vector DB, Solution |
| Upload and Process | `/upload` | Upload, sample docs, settings, animated pipeline progress, per-method summary |
| Chunk Explorer | `/explorer` | Browse chunks, filter by type, view removed noise, download JSONL |
| SmartChunk Chat | `/chat/smart` | Document summary, suggested questions, follow-up chat with citations |
| Traditional Chat | `/chat/traditional` | Same UI over fixed-size chunks |
| Chunking Comparison | `/compare/chunks` | Side-by-side chunks with red (broken), green (intact), grey (removed) highlights |
| Answer Comparison | `/compare/answers` | One question, two answers, retrieved chunks, tokens, latency, vote |
| Session Summary | `/summary` | Recap of all responses, Q&A table with winners, follow-ups, Markdown export |
| Evaluation | `/evaluation` | Recall@5, MRR, damage counts, results by question type |
| Knowledge Base | `/knowledge` | Stored documents, chunk counts, delete/re-process |
| How It Works | `/how-it-works` | Animated explanation of the pipeline and fairness rules |

**Frontend engineering rules**: all backend calls go through a single `api/client.ts`; a mock layer (`VITE_USE_MOCK=true`) lets the UI run without a backend; every page handles loading, empty, error and success states; 3D scenes are lazy-loaded, wrapped in error boundaries, respect `prefers-reduced-motion`, and fall back to 2D without WebGL.

## 10. API Contract

| Method | Endpoint | Request | Response |
|---|---|---|---|
| POST | `/api/upload` | multipart file | `{ doc_id, filename, pages, warnings }` |
| POST | `/api/process` | `{ doc_id, settings }` | `{ smart_stats, naive_stats, removed_report }` |
| GET | `/api/processing-status/{doc_id}` | none | `{ step, progress }` |
| GET | `/api/chunks` | `doc_id, method, type` | `Chunk[]` |
| GET | `/api/chunks/export` | `doc_id` | JSONL file |
| POST | `/api/chat` | `{ doc_id, method, question, history }` | `{ answer, standalone_question, sources, retrieved_chunks, tokens_used, latency_ms, not_found }` |
| POST | `/api/compare` | `{ doc_id, question, history }` | `{ smart, naive }` (each a chat result) |
| GET | `/api/summary/{doc_id}` | none | `{ summary, key_topics, suggested_questions }` |
| POST | `/api/session-summary` | session Q&A | `{ recap, qa_rows }` |
| GET | `/api/evaluation` | none | metrics object |
| GET | `/api/documents` | none | document list |
| DELETE | `/api/documents/{doc_id}` | none | status |

Long-running processing runs as a background job; the frontend polls `/api/processing-status`.

## 11. Project Structure

```
smartchunk/
├── smartchunk/            # Engine: config, models, pdf_loader, parser, semantic,
│                          #         cleaner, chunker, tokenizer, exporter
├── baseline/naive.py      # Traditional fixed-size splitter + damage counter
├── retrieval/             # embedder, store (ChromaDB), rag, llm_client
├── classifier/            # Optional: dataset builder, features, train, evaluate
├── eval/                  # questions.json, metrics, run_eval, results.json
├── backend/               # FastAPI app, Pydantic schemas, routes, background jobs
├── frontend/              # React + TypeScript + Three.js app
├── data/                  # samples/, training/, uploads/ (git-ignored)
├── tests/                 # parser, cleaner, chunker, naive, store tests
├── docs/                  # architecture diagram, presentation notes
├── requirements.txt
├── .env.example
└── README.md
```

## 12. Tech Stack

| Layer | Technology |
|---|---|
| Language (engine/backend) | Python 3.10 to 3.12 |
| Markdown parsing | `markdown-it-py` |
| PDF parsing | PyMuPDF |
| Embeddings | `sentence-transformers` (`all-MiniLM-L6-v2`) |
| Similarity | NumPy cosine similarity |
| Deduplication | `datasketch` (MinHash) or cosine similarity |
| Vector DB | ChromaDB |
| Token counting | `tiktoken` |
| Classifier (optional) | scikit-learn |
| LLM client | `openai` SDK (OpenAI-compatible endpoints) |
| Backend | FastAPI |
| Frontend | React, TypeScript, Vite, Tailwind CSS, Three.js (react-three-fiber), GSAP, Framer Motion, Zustand, Recharts |

## 13. Setup and Run

### Backend

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then add your LLM key
```

`.env`:

```text
LLM_API_KEY=your_key_here
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=your_model_name
```

Smoke test:

```bash
python -c "import fitz, chromadb, sentence_transformers, datasketch, tiktoken, openai; print('OK')"
```

Run the API:

```bash
uvicorn backend.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env              # VITE_API_BASE_URL, VITE_USE_MOCK
npm run dev
```

Set `VITE_USE_MOCK=true` to run the UI without the backend.

### Evaluation

```bash
python eval/run_eval.py
```

## 14. Output Format (JSONL)

One chunk per line:

```json
{
  "chunk_id": "doc1_017",
  "text": "...",
  "source": "python_tutorial.pdf",
  "page": 12,
  "heading_path": ["Algorithms", "Search", "Binary Search"],
  "type": "code",
  "token_count": 214
}
```

Allowed `type` values: `prose`, `code`, `table`, `list`.

## 15. Results

> Fill this section with your real measured numbers after running `eval/run_eval.py`. Do not publish numbers you have not measured.

| Metric | Traditional | SmartChunk |
|---|---|---|
| Recall@5 | TBD | TBD |
| MRR | TBD | TBD |
| Split code blocks | TBD | TBD |
| Split tables | TBD | TBD |
| Duplicate chunks | TBD | TBD |
| Noise chunks | TBD | TBD |

Evaluation set: TBD documents, TBD questions.

## 16. Limitations

- Scanned PDFs are not supported (no OCR).
- PDF heading detection from font size is heuristic and can fail on unusual layouts.
- The embedding model reads about 256 tokens per input; very long chunks are partly represented in their embedding.
- Semantic boundary quality depends on the threshold and the document domain.
- Evaluation covers a small document set and does not claim general superiority.

## 17. Testing

```bash
pytest tests/
```

- `test_parser.py`: code fences, tables and lists are detected; heading paths are correct.
- `test_chunker.py`: no chunk cuts through a code block, table or list; headings stay attached.
- `test_cleaner.py`: repeated headers/footers are removed; near-duplicates are dropped.
- `test_naive.py`: baseline sizes and overlap are as configured.
- `test_store.py`: both collections build and return results with metadata.

## 18. Team

| Name | Role |
|---|---|
| Dipanshu Chand | Frontend |
| Harshit Bhatt | Chunking engine |
| Bhavesh Upreti | Retrieval, RAG and API |
| Anshuman Bora | Evaluation, data and presentation |

---

*Built for GRAPHITE 26, PS 8: SmartChunk.*
