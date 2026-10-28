// Runtime (zod) schemas for every response in PART A. Each one is annotated with the matching
// TypeScript type, so the compiler fails if a schema and its type ever drift apart.
// Objects are .strict(): an unexpected extra field is reported (in dev) as a contract break.

import { z } from 'zod'
import type {
  ChatResult,
  Chunk,
  ChunkPage,
  DocSummary,
  DocumentInfo,
  EvaluationResult,
  MethodStats,
  ProcessResult,
  ProcessStartResponse,
  ProcessingStatus,
  RemovedItem,
  RetrievedChunk,
  SampleInfo,
  SessionSummary,
  Settings,
  SourceCitation,
  UploadResponse,
  QAItem,
} from '@/types/api'
import type {
  AuthResponse,
  CompareResult,
  DeleteDocumentResponse,
  ErrorEnvelope,
  DocHistory,
  HealthResponse,
  HistoryCleared,
  MeResponse,
} from '@/types/requests'

const ChunkTypeSchema = z.enum(['prose', 'code', 'table', 'list'])
const MethodSchema = z.enum(['smart', 'naive'])
const ProcessStepSchema = z.enum([
  'uploaded',
  'parsing',
  'cleaning',
  'semantic_split',
  'dedup',
  'embedding',
  'storing',
  'summarizing',
  'done',
])

const count = () => z.number().int().min(0)
const score = () => z.number().min(0).max(1)
const pageNumber = () => z.number().int().min(1).nullable()

export const SettingsSchema: z.ZodType<Settings> = z
  .object({
    min_chunk_tokens: z.number(),
    max_chunk_tokens: z.number(),
    similarity_threshold: z.number(),
    dedup_threshold: z.number(),
    top_k: z.number(),
    naive_chunk_tokens: z.number(),
    naive_overlap_tokens: z.number(),
    not_found_threshold: z.number(),
  })
  .strict()

export const ChunkSchema: z.ZodType<Chunk> = z
  .object({
    chunk_id: z.string(),
    text: z.string(),
    source: z.string(),
    page: pageNumber(),
    heading_path: z.array(z.string()),
    type: ChunkTypeSchema,
    token_count: count(),
  })
  .strict()

export const UploadResponseSchema: z.ZodType<UploadResponse> = z
  .object({
    doc_id: z.string(),
    filename: z.string(),
    pages: count(),
    size_bytes: count(),
    warnings: z.array(z.string()),
  })
  .strict()

export const ProcessStartResponseSchema: z.ZodType<ProcessStartResponse> = z
  .object({
    doc_id: z.string(),
    status: z.literal('started'),
  })
  .strict()

export const ProcessingStatusSchema: z.ZodType<ProcessingStatus> = z
  .object({
    doc_id: z.string(),
    status: z.enum(['idle', 'running', 'done', 'error']),
    step: ProcessStepSchema,
    progress: z.number().int().min(0).max(100),
    error_message: z.string().nullable(),
  })
  .strict()

export const MethodStatsSchema: z.ZodType<MethodStats> = z
  .object({
    chunk_count: count(),
    avg_tokens: z.number().min(0),
    type_counts: z
      .object({ prose: count(), code: count(), table: count(), list: count() })
      .strict(),
    split_code_blocks: count(),
    split_tables: count(),
    split_lists: count(),
    orphan_headings: count(),
    exact_duplicates_removed: count(),
    near_duplicates_removed: count(),
    noise_lines_removed: count(),
    metadata_fields_present: count(),
  })
  .strict()

export const RemovedItemSchema: z.ZodType<RemovedItem> = z
  .object({
    kind: z.enum(['header', 'footer', 'exact_duplicate', 'near_duplicate']),
    text: z.string(),
    page: pageNumber(),
    reason: z.string(),
  })
  .strict()

export const ProcessResultSchema: z.ZodType<ProcessResult> = z
  .object({
    doc_id: z.string(),
    smart_stats: MethodStatsSchema,
    naive_stats: MethodStatsSchema,
    removed_report: z.object({ items: z.array(RemovedItemSchema) }).strict(),
    settings: SettingsSchema,
    warnings: z.array(z.string()),
  })
  .strict()

export const ChunkPageSchema: z.ZodType<ChunkPage> = z
  .object({
    items: z.array(ChunkSchema),
    total: count(),
    page: z.number().int().min(1),
    page_size: z.number().int().min(1),
  })
  .strict()

export const SourceCitationSchema: z.ZodType<SourceCitation> = z
  .object({
    chunk_id: z.string(),
    heading_path: z.array(z.string()),
    page: pageNumber(),
  })
  .strict()

export const RetrievedChunkSchema: z.ZodType<RetrievedChunk> = z
  .object({
    chunk: ChunkSchema,
    score: score(),
  })
  .strict()

export const ChatResultSchema: z.ZodType<ChatResult> = z
  .object({
    method: MethodSchema,
    answer: z.string(),
    standalone_question: z.string(),
    sources: z.array(SourceCitationSchema),
    retrieved_chunks: z.array(RetrievedChunkSchema),
    prompt_sent: z.string(),
    tokens_used: z.object({ prompt: count(), completion: count(), total: count() }).strict(),
    context_window_limit: count(),
    latency_ms: z.number().min(0),
    not_found: z.boolean(),
  })
  .strict()

export const CompareResultSchema: z.ZodType<CompareResult> = z
  .object({
    smart: ChatResultSchema,
    naive: ChatResultSchema,
  })
  .strict()

export const DocSummarySchema: z.ZodType<DocSummary> = z
  .object({
    doc_id: z.string(),
    summary: z.string(),
    key_topics: z.array(z.string()),
    suggested_questions: z.array(z.string()),
  })
  .strict()

export const QAItemSchema: z.ZodType<QAItem> = z
  .object({
    question: z.string(),
    smart_answer: z.string(),
    naive_answer: z.string(),
    winner: z.enum(['smart', 'naive', 'tie', 'unvoted']),
  })
  .strict()

export const SessionSummarySchema: z.ZodType<SessionSummary> = z
  .object({
    recap: z.string(),
    key_findings: z.array(z.string()),
    qa_rows: z.array(QAItemSchema),
  })
  .strict()

const PRFSchema = z.object({ precision: score(), recall: score(), f1: score() }).strict()
const metrics = () => z.object({ recall_at_5: score(), mrr: score() }).strict()
const metricsByType = () =>
  z.object({ prose: metrics(), code: metrics(), table: metrics(), list: metrics() }).strict()
const damage = () =>
  z
    .object({
      split_code_blocks: count(),
      split_tables: count(),
      duplicates: count(),
      noise_chunks: count(),
    })
    .strict()

export const EvaluationResultSchema: z.ZodType<EvaluationResult> = z
  .object({
    generated_at: z.string(),
    documents: z.array(z.string()),
    questions_count: count(),
    methods: z
      .object({
        smart: z.object({ recall_at_5: score(), mrr: score(), by_type: metricsByType() }).strict(),
        naive: z.object({ recall_at_5: score(), mrr: score(), by_type: metricsByType() }).strict(),
      })
      .strict(),
    damage: z.object({ smart: damage(), naive: damage() }).strict(),
    classifier: z
      .object({
        threshold: PRFSchema,
        trained: PRFSchema,
        test_pairs: count(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const DocumentInfoSchema: z.ZodType<DocumentInfo> = z
  .object({
    doc_id: z.string(),
    filename: z.string(),
    pages: count(),
    status: z.enum(['uploaded', 'processing', 'ready', 'error']),
    smart_chunk_count: count().nullable(),
    naive_chunk_count: count().nullable(),
    created_at: z.string(),
    summary_preview: z.string(),
  })
  .strict()

export const DocumentsSchema: z.ZodType<DocumentInfo[]> = z.array(DocumentInfoSchema)

export const SampleInfoSchema: z.ZodType<SampleInfo> = z
  .object({
    sample_id: z.string(),
    title: z.string(),
    description: z.string(),
    filename: z.string(),
  })
  .strict()

export const SamplesSchema: z.ZodType<SampleInfo[]> = z.array(SampleInfoSchema)

export const HealthResponseSchema: z.ZodType<HealthResponse> = z
  .object({
    status: z.literal('ok'),
    embedding_model_loaded: z.boolean(),
    llm_configured: z.boolean(),
  })
  .strict()

export const DeleteDocumentResponseSchema: z.ZodType<DeleteDocumentResponse> = z
  .object({
    deleted: z.literal(true),
    doc_id: z.string(),
  })
  .strict()

export const ErrorEnvelopeSchema: z.ZodType<ErrorEnvelope> = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict()

export const AuthResponseSchema: z.ZodType<AuthResponse> = z
  .object({ username: z.string(), token: z.string() })
  .strict()

export const MeResponseSchema: z.ZodType<MeResponse> = z.object({ username: z.string() }).strict()

export const LogoutResponseSchema: z.ZodType<{ logged_out: true }> = z
  .object({ logged_out: z.literal(true) })
  .strict()

export const DocHistorySchema: z.ZodType<DocHistory> = z
  .object({
    doc_id: z.string(),
    filename: z.string(),
    summary: z.string(),
    summarized_questions: z.number().int().nonnegative(),
    counts: z
      .object({
        questions: z.number().int().nonnegative(),
        smart: z.number().int().nonnegative(),
        naive: z.number().int().nonnegative(),
        compare: z.number().int().nonnegative(),
        not_found: z.number().int().nonnegative(),
      })
      .strict(),
    recent: z.array(
      z
        .object({
          question: z.string(),
          method: z.enum(['smart', 'naive', 'compare']),
          answer: z.string(),
          naive_answer: z.string().nullable(),
          not_found: z.boolean(),
          asked_at: z.string(),
        })
        .strict(),
    ),
    updated_at: z.string().nullable(),
  })
  .strict()

export const HistoryListSchema: z.ZodType<DocHistory[]> = z.array(DocHistorySchema)

export const HistoryClearedSchema: z.ZodType<HistoryCleared> = z
  .object({ cleared: z.literal(true), doc_id: z.string() })
  .strict()
