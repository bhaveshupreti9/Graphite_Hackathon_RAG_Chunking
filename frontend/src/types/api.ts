// Copied exactly from PART A6 of the SmartChunk spec. Do not rename or add fields.
// All keys are snake_case on purpose: they match the JSON the backend sends.

export type ChunkType = 'prose' | 'code' | 'table' | 'list'
export type Method = 'smart' | 'naive'

export interface Settings {
  min_chunk_tokens: number
  max_chunk_tokens: number
  similarity_threshold: number
  dedup_threshold: number
  top_k: number
  naive_chunk_tokens: number
  naive_overlap_tokens: number
  not_found_threshold: number
}

export interface Chunk {
  chunk_id: string // "<doc_id>_<method>_<4-digit index>", e.g. "doc_3fa9c1b2_smart_0017"
  text: string
  source: string // original filename
  page: number | null
  heading_path: string[] // [] if none (always [] for naive chunks)
  type: ChunkType // naive chunks are classified by content too ("prose" if unsure)
  token_count: number
}

export interface UploadResponse {
  doc_id: string
  filename: string
  pages: number // 1 for md/txt
  size_bytes: number
  warnings: string[]
}

export interface ProcessStartResponse {
  doc_id: string
  status: 'started'
}

export type ProcessStep =
  | 'uploaded'
  | 'parsing'
  | 'cleaning'
  | 'semantic_split'
  | 'dedup'
  | 'embedding'
  | 'storing'
  | 'summarizing'
  | 'done'

export interface ProcessingStatus {
  doc_id: string
  status: 'idle' | 'running' | 'done' | 'error'
  step: ProcessStep
  progress: number // integer 0..100, never decreases during a run; 100 when done
  error_message: string | null
}

export interface MethodStats {
  chunk_count: number
  avg_tokens: number
  type_counts: { prose: number; code: number; table: number; list: number }
  split_code_blocks: number
  split_tables: number
  split_lists: number
  orphan_headings: number
  exact_duplicates_removed: number // always 0 for naive
  near_duplicates_removed: number // always 0 for naive
  noise_lines_removed: number // always 0 for naive
  metadata_fields_present: number // 7 for smart (the Chunk fields), 2 for naive (source, page)
}

export interface RemovedItem {
  kind: 'header' | 'footer' | 'exact_duplicate' | 'near_duplicate'
  text: string
  page: number | null
  reason: string
}

export interface ProcessResult {
  doc_id: string
  smart_stats: MethodStats
  naive_stats: MethodStats
  removed_report: { items: RemovedItem[] }
  settings: Settings
  warnings: string[]
}

export interface ChunkPage {
  items: Chunk[]
  total: number
  page: number
  page_size: number
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface SourceCitation {
  chunk_id: string
  heading_path: string[]
  page: number | null
}

export interface RetrievedChunk {
  chunk: Chunk
  score: number
}

export interface ChatResult {
  method: Method
  answer: string // "Not found in the document." style text when not_found is true
  standalone_question: string // follow-up rewritten; equals question when history is empty
  sources: SourceCitation[] // [] when not_found
  retrieved_chunks: RetrievedChunk[] // always filled with what retrieval returned, sorted by score desc
  prompt_sent: string // full prompt text (for the "show prompt" expander)
  tokens_used: { prompt: number; completion: number; total: number }
  context_window_limit: number // model context size used for the token meter (default 8192)
  latency_ms: number // end-to-end for this method
  not_found: boolean
}

export interface DocSummary {
  doc_id: string
  summary: string // "" if LLM was not configured
  key_topics: string[]
  suggested_questions: string[]
}

export interface QAItem {
  question: string
  smart_answer: string
  naive_answer: string
  winner: 'smart' | 'naive' | 'tie' | 'unvoted'
}

export interface SessionSummary {
  recap: string
  key_findings: string[]
  qa_rows: QAItem[]
}

export interface PRF {
  precision: number
  recall: number
  f1: number
}

export interface RetrievalMetrics {
  recall_at_5: number
  mrr: number
}

export interface EvaluationResult {
  generated_at: string
  documents: string[]
  questions_count: number
  methods: {
    smart: RetrievalMetrics & { by_type: Record<ChunkType, RetrievalMetrics> }
    naive: RetrievalMetrics & { by_type: Record<ChunkType, RetrievalMetrics> }
  }
  damage: {
    smart: {
      split_code_blocks: number
      split_tables: number
      duplicates: number
      noise_chunks: number
    }
    naive: {
      split_code_blocks: number
      split_tables: number
      duplicates: number
      noise_chunks: number
    }
  }
  classifier: null | { threshold: PRF; trained: PRF; test_pairs: number }
}

export interface DocumentInfo {
  doc_id: string
  filename: string
  pages: number
  status: 'uploaded' | 'processing' | 'ready' | 'error'
  smart_chunk_count: number | null
  naive_chunk_count: number | null
  created_at: string
  summary_preview: string
}

export interface SampleInfo {
  sample_id: string
  title: string
  description: string
  filename: string
}
