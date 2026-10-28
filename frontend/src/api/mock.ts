// Mock backend used in demo mode. Every function has the same signature and return type as its
// real counterpart in client.ts. All data starts from the files in /contracts (copied to
// ./contracts and validated against the zod schemas when this module loads):
//   - SmartChunk chunks come from chunks_page.json.
//   - Traditional chunks are real fixed-size windows over the same text (no cleaning, no structure
//     awareness), so code blocks and tables really do get cut, exactly like the naive baseline.
//   - Chat answers use simple keyword retrieval over those chunks and quote the best passage.
//     No LLM is involved; the response shape is identical to the real one.
// Test triggers (see INTEGRATION_NOTES.md):
//   file names containing "scanned", "encrypted", "empty"  -> SCANNED_PDF / ENCRYPTED_PDF / EMPTY_DOCUMENT
//   file names containing "crash"                           -> the processing job fails
//   questions containing "__error__"                        -> LLM_ERROR

import type { ZodType } from 'zod'
import { endsWithHeading, withoutHeadings } from '@/lib/damage'
import { validateUploadFile } from '@/lib/files'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import type {
  ChatResult,
  ChatTurn,
  Chunk,
  ChunkPage,
  ChunkType,
  DocSummary,
  DocumentInfo,
  EvaluationResult,
  Method,
  MethodStats,
  ProcessResult,
  ProcessStartResponse,
  ProcessStep,
  ProcessingStatus,
  RetrievedChunk,
  SampleInfo,
  SessionSummary,
  Settings,
  SourceCitation,
  UploadResponse,
} from '@/types/api'
import type {
  ChatRequest,
  CompareRequest,
  CompareResult,
  DeleteDocumentResponse,
  DocHistory,
  GetChunksParams,
  HealthResponse,
  HistoryCleared,
  HistoryEntry,
  ProcessRequest,
  SessionSummaryRequest,
} from '@/types/requests'
import chatNotFoundJson from './contracts/chat_result_not_found.json'
import chatSmartJson from './contracts/chat_result_smart.json'
import chunksPageJson from './contracts/chunks_page.json'
import compareJson from './contracts/compare.json'
import documentsJson from './contracts/documents.json'
import errorJson from './contracts/error.json'
import evaluationJson from './contracts/evaluation.json'
import processResultJson from './contracts/process_result.json'
import processStartJson from './contracts/process_start.json'
import samplesJson from './contracts/samples.json'
import sessionSummaryJson from './contracts/session_summary.json'
import statusDoneJson from './contracts/status_done.json'
import statusRunningJson from './contracts/status_running.json'
import summaryJson from './contracts/summary.json'
import uploadJson from './contracts/upload.json'
import { ApiError } from './errors'
import {
  ChatResultSchema,
  ChunkPageSchema,
  CompareResultSchema,
  DocSummarySchema,
  DocumentsSchema,
  ErrorEnvelopeSchema,
  EvaluationResultSchema,
  HistoryListSchema,
  ProcessResultSchema,
  ProcessStartResponseSchema,
  ProcessingStatusSchema,
  SamplesSchema,
  SessionSummarySchema,
  UploadResponseSchema,
} from './schemas'

// ---------------------------------------------------------------------------------------------
// Load and validate the contract files once. A mismatch throws immediately with the file name.
// ---------------------------------------------------------------------------------------------

function load<T>(name: string, schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new Error(
      `Mock contract "${name}" does not match its zod schema: ${JSON.stringify(result.error.issues)}`,
    )
  }
  return result.data
}

const UPLOAD = load('upload.json', UploadResponseSchema, uploadJson)
const PROCESS_START = load('process_start.json', ProcessStartResponseSchema, processStartJson)
const STATUS_RUNNING = load('status_running.json', ProcessingStatusSchema, statusRunningJson)
const STATUS_DONE = load('status_done.json', ProcessingStatusSchema, statusDoneJson)
const PROCESS_RESULT = load('process_result.json', ProcessResultSchema, processResultJson)
const CHUNKS_PAGE = load('chunks_page.json', ChunkPageSchema, chunksPageJson)
const CHAT_SMART = load('chat_result_smart.json', ChatResultSchema, chatSmartJson)
const CHAT_NOT_FOUND = load('chat_result_not_found.json', ChatResultSchema, chatNotFoundJson)
load('compare.json', CompareResultSchema, compareJson)
const SUMMARY = load('summary.json', DocSummarySchema, summaryJson)
const SESSION_SUMMARY = load('session_summary.json', SessionSummarySchema, sessionSummaryJson)
const EVALUATION = load('evaluation.json', EvaluationResultSchema, evaluationJson)
const DOCUMENTS = load('documents.json', DocumentsSchema, documentsJson)
const SAMPLES = load('samples.json', SamplesSchema, samplesJson)
const ERROR_ENVELOPE = load('error.json', ErrorEnvelopeSchema, errorJson)

/** Used by the "Load demo document" button so every guarded page can be opened in demo mode. */
export const SEED_UPLOAD: UploadResponse = UPLOAD

// ---------------------------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------------------------

interface MockJob {
  startedAt: number
  settings: Settings
  fails: boolean
}

// The mock "database" survives page reloads (per browser) so a demo session can be refreshed.
const MOCK_DB_KEY = 'smartchunk-mock-db'

interface MockDb {
  docs: DocumentInfo[]
  jobs: [string, MockJob][]
}

function readDb(): MockDb | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(MOCK_DB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const docsResult = DocumentsSchema.safeParse((parsed as { docs?: unknown }).docs)
    const rawJobs = (parsed as { jobs?: unknown }).jobs
    if (!docsResult.success || !Array.isArray(rawJobs)) return null
    return { docs: docsResult.data, jobs: rawJobs as [string, MockJob][] }
  } catch {
    return null
  }
}

const savedDb = readDb()
const docs = new Map<string, DocumentInfo>(
  (savedDb?.docs ?? DOCUMENTS).map((doc) => [doc.doc_id, { ...doc }]),
)
const jobs = new Map<string, MockJob>(savedDb?.jobs ?? [])

function saveDb(): void {
  try {
    const db: MockDb = { docs: Array.from(docs.values()), jobs: Array.from(jobs.entries()) }
    localStorage.setItem(MOCK_DB_KEY, JSON.stringify(db))
  } catch {
    // Storage can be unavailable (private mode); the mock still works for this page view.
  }
}

const delay = (min = 300, max = 1200): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)))

function randomDocId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return `doc_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function assertDoc(docId: string): DocumentInfo {
  const doc = docs.get(docId)
  if (!doc) throw new ApiError('DOC_NOT_FOUND', `Document ${docId} was not found.`, 404)
  return doc
}

function addDoc(filename: string, pages: number): DocumentInfo {
  const doc: DocumentInfo = {
    doc_id: randomDocId(),
    filename,
    pages,
    status: 'uploaded',
    smart_chunk_count: null,
    naive_chunk_count: null,
    created_at: new Date().toISOString(),
    summary_preview: '',
  }
  docs.set(doc.doc_id, doc)
  saveDb()
  return doc
}

function settingsFor(docId: string): Settings {
  return jobs.get(docId)?.settings ?? DEFAULT_SETTINGS
}

// ---------------------------------------------------------------------------------------------
// Chunk sets
// ---------------------------------------------------------------------------------------------

const CHUNK_ID_PREFIX = /^doc_[0-9a-f]{8}_(smart|naive)_/
const TOTAL_PAGES = Math.max(...CHUNKS_PAGE.items.map((chunk) => chunk.page ?? 1))
const NOISE_HEADER = 'Python Tutorial - Release 3.12'

function smartChunks(docId: string, filename: string): Chunk[] {
  return CHUNKS_PAGE.items.map((chunk) => ({
    ...chunk,
    chunk_id: chunk.chunk_id.replace(CHUNK_ID_PREFIX, `${docId}_smart_`),
    source: filename,
  }))
}

interface Segment {
  text: string
  page: number | null
}

/** The raw document as the naive chunker sees it: headers, footers and duplicates included. */
function rawSegments(): Segment[] {
  const segments: Segment[] = []
  let currentPage: number | null = null
  for (const chunk of CHUNKS_PAGE.items) {
    if (chunk.page !== currentPage) {
      if (currentPage !== null) {
        segments.push({ text: `Page ${currentPage} of ${TOTAL_PAGES}`, page: currentPage })
      }
      currentPage = chunk.page
      segments.push({ text: NOISE_HEADER, page: currentPage })
    }
    segments.push({ text: chunk.text, page: chunk.page })
  }
  // The duplicates SmartChunk removed (see removed_report) are still present for the naive path.
  for (const item of PROCESS_RESULT.removed_report.items) {
    if (item.kind === 'exact_duplicate' || item.kind === 'near_duplicate') {
      segments.push({ text: item.text, page: item.page })
    }
  }
  return segments
}

function inferType(text: string): ChunkType {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (text.includes('```') || /\b(def |return |import |print\()/.test(text)) return 'code'
  if (lines.filter((line) => line.trim().startsWith('|')).length >= 2) return 'table'
  const listLines = lines.filter((line) => /^\s*([-*+•]|\d+[.)])\s+/.test(line)).length
  if (lines.length > 0 && listLines / lines.length > 0.5) return 'list'
  return 'prose'
}

const tokenCount = (text: string): number => Math.max(1, Math.ceil(text.length / 4))

/**
 * Fixed-size windows with overlap. One mock "token" is about 0.8 characters of window here so a
 * short sample still produces enough chunks to compare; the cutting behaviour is the real thing.
 */
function naiveChunks(docId: string, filename: string, settings: Settings): Chunk[] {
  const segments = rawSegments()
  let text = ''
  const pageAt: { offset: number; page: number | null }[] = []
  for (const segment of segments) {
    pageAt.push({ offset: text.length, page: segment.page })
    text += `${segment.text}\n\n`
  }
  const size = Math.max(80, Math.round(settings.naive_chunk_tokens * 0.8))
  const overlap = Math.min(size - 20, Math.round(settings.naive_overlap_tokens * 0.8))
  const chunks: Chunk[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + size)
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end)
      if (space > start + size * 0.6) end = space
    }
    const windowText = text.slice(start, end).trim()
    if (windowText !== '') {
      const page = [...pageAt].reverse().find((entry) => entry.offset <= start)?.page ?? null
      chunks.push({
        chunk_id: `${docId}_naive_${String(chunks.length).padStart(4, '0')}`,
        text: windowText,
        source: filename,
        page,
        heading_path: [],
        type: inferType(windowText),
        token_count: tokenCount(windowText),
      })
    }
    if (end >= text.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks
}

function chunksFor(docId: string, method: Method): Chunk[] {
  const doc = assertDoc(docId)
  return method === 'smart'
    ? smartChunks(docId, doc.filename)
    : naiveChunks(docId, doc.filename, settingsFor(docId))
}

// ---------------------------------------------------------------------------------------------
// Stats (same definitions as spec B4 damage counting)
// ---------------------------------------------------------------------------------------------

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

function blockBody(text: string): string {
  return normalise(withoutHeadings(text).join('\n'))
}

function computeStats(chunks: Chunk[], method: Method): MethodStats {
  const structural = CHUNKS_PAGE.items.filter((chunk) => chunk.type !== 'prose')
  const haystack = chunks.map((chunk) => normalise(chunk.text))
  const splitCount = (type: ChunkType) =>
    structural.filter(
      (block) =>
        block.type === type && !haystack.some((text) => text.includes(blockBody(block.text))),
    ).length
  const orphanHeadings = chunks.filter((chunk) => endsWithHeading(chunk.text)).length
  const typeCounts = { prose: 0, code: 0, table: 0, list: 0 }
  chunks.forEach((chunk) => {
    typeCounts[chunk.type] += 1
  })
  const avg = chunks.reduce((sum, chunk) => sum + chunk.token_count, 0) / Math.max(1, chunks.length)
  const base = method === 'smart' ? PROCESS_RESULT.smart_stats : PROCESS_RESULT.naive_stats
  return {
    ...base,
    chunk_count: chunks.length,
    avg_tokens: Math.round(avg * 10) / 10,
    type_counts: typeCounts,
    split_code_blocks: splitCount('code'),
    split_tables: splitCount('table'),
    split_lists: splitCount('list'),
    orphan_headings: orphanHeadings,
    exact_duplicates_removed: method === 'smart' ? base.exact_duplicates_removed : 0,
    near_duplicates_removed: method === 'smart' ? base.near_duplicates_removed : 0,
    noise_lines_removed: method === 'smart' ? base.noise_lines_removed : 0,
    metadata_fields_present: method === 'smart' ? 7 : 2,
  }
}

// ---------------------------------------------------------------------------------------------
// Processing simulation (steps and progress follow PART A8; progress never decreases)
// ---------------------------------------------------------------------------------------------

const TIMELINE: readonly { step: ProcessStep; at: number; progress: number }[] = [
  { step: 'parsing', at: 0, progress: 10 },
  { step: 'cleaning', at: 1300, progress: 25 },
  { step: 'semantic_split', at: 2800, progress: 40 },
  { step: 'dedup', at: 4600, progress: 60 },
  { step: 'embedding', at: 5700, progress: 70 },
  { step: 'storing', at: 7300, progress: 85 },
  { step: 'summarizing', at: 8300, progress: 92 },
]
const TOTAL_MS = 9800
const FAIL_AT_MS = 3400

function snapshot(elapsed: number): { step: ProcessStep; progress: number } {
  if (elapsed >= TOTAL_MS) return { step: 'done', progress: 100 }
  let index = 0
  TIMELINE.forEach((entry, i) => {
    if (entry.at <= elapsed) index = i
  })
  const current = TIMELINE[index] ?? TIMELINE[0]
  const next = TIMELINE[index + 1]
  if (!current) return { step: 'parsing', progress: 10 }
  const endAt = next ? next.at : TOTAL_MS
  const endProgress = next ? next.progress : 99
  const fraction = Math.max(0, (elapsed - current.at) / (endAt - current.at))
  return {
    step: current.step,
    progress: Math.min(
      99,
      Math.floor(current.progress + (endProgress - current.progress) * fraction),
    ),
  }
}

/** Moves a running job to ready/error once enough fake time has passed. */
function settle(docId: string): void {
  const doc = docs.get(docId)
  const job = jobs.get(docId)
  if (!doc || !job || doc.status !== 'processing') return
  const elapsed = Date.now() - job.startedAt
  if (job.fails && elapsed >= FAIL_AT_MS) {
    doc.status = 'error'
  } else if (!job.fails && elapsed >= TOTAL_MS) {
    doc.status = 'ready'
    doc.smart_chunk_count = chunksFor(docId, 'smart').length
    doc.naive_chunk_count = chunksFor(docId, 'naive').length
    doc.summary_preview =
      SUMMARY.summary.length > 140
        ? `${SUMMARY.summary.slice(0, SUMMARY.summary.lastIndexOf(' ', 140))}…`
        : SUMMARY.summary
  }
  if (doc.status !== 'processing') saveDb()
}

function assertReady(docId: string): DocumentInfo {
  const doc = assertDoc(docId)
  settle(docId)
  if (doc.status !== 'ready') {
    throw new ApiError('NOT_PROCESSED', `Document ${docId} has not finished processing.`, 409)
  }
  return doc
}

// ---------------------------------------------------------------------------------------------
// Retrieval and answers
// ---------------------------------------------------------------------------------------------

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from how i in is it its me of on or the this that to what when which who why with you your about into than then there these those use used using'.split(
    ' ',
  ),
)

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word))
}

function score(question: string[], chunk: Chunk): number {
  if (question.length === 0) return 0
  const chunkTerms = terms(chunk.text)
  const bag = new Map<string, number>()
  chunkTerms.forEach((term) => bag.set(term, (bag.get(term) ?? 0) + 1))
  const unique = [...new Set(question)]
  const covered = unique.filter((term) => bag.has(term)).length / unique.length
  const dot = unique.reduce((sum, term) => sum + (bag.get(term) ?? 0), 0)
  const norm = Math.sqrt([...bag.values()].reduce((sum, value) => sum + value * value, 0)) || 1
  const cosine = Math.min(1, dot / (norm * Math.sqrt(unique.length)))
  return Math.round(Math.min(1, 0.78 * covered + 0.22 * cosine) * 100) / 100
}

// Follow-ups refer back with a pronoun ("what is its complexity?"). Standalone questions are kept.
const PRONOUN = /\b(it|its|that|this|they|them|those|these)\b/i

function rewrite(question: string, history: ChatTurn[]): string {
  if (history.length === 0) return question
  const lastUser = [...history].reverse().find((turn) => turn.role === 'user')
  if (!lastUser) return question
  if (!PRONOUN.test(question)) return question
  const subject = lastUser.content.replace(/[?.!]+$/, '')
  return `${question.replace(/[?.!]+$/, '')} (regarding: ${subject})?`
}

const PROMPT_HEADER = `You are a careful assistant. Answer the question using ONLY the context below.
If the context does not contain the answer, say you could not find it in the document.
Cite sources as [heading path, page] when available. Keep code and tables exactly as given.`

function buildPrompt(retrieved: RetrievedChunk[], question: string): string {
  const context = retrieved
    .map(({ chunk }, index) => {
      const parts = [
        chunk.heading_path.length > 0 ? chunk.heading_path.join(' > ') : null,
        chunk.page === null ? null : `page ${chunk.page}`,
        chunk.type,
      ].filter((part): part is string => part !== null)
      return `[${index + 1}] [Source: ${parts.join(' | ')}]\n${chunk.text}`
    })
    .join('\n\n')
  return `${PROMPT_HEADER}\n\nContext:\n${context}\n\nQuestion: ${question}`
}

function answerFrom(best: Chunk): string {
  const where =
    best.heading_path.length > 0 ? `“${best.heading_path.join(' / ')}”` : 'an unlabelled passage'
  const page = best.page === null ? '' : ` on page ${best.page}`
  const body = withoutHeadings(best.text).join('\n').trim()
  const excerpt = body.length > 900 ? `${body.slice(0, 900)}…` : body
  const cite = `[${best.heading_path.length > 0 ? best.heading_path.join(' > ') : 'no heading'}, ${
    best.page === null ? 'no page' : `page ${best.page}`
  }]`
  return `The answer comes from ${where}${page}:\n\n${excerpt}\n\n${cite}`
}

function runChat(
  method: Method,
  req: { doc_id: string; question: string; history: ChatTurn[] },
): ChatResult {
  const started = performance.now()
  const question = req.question.trim()
  if (question === '') throw new ApiError('VALIDATION_ERROR', 'The question is empty.', 422)
  if (question.toLowerCase().includes('__error__')) {
    throw new ApiError('LLM_ERROR', 'The mock LLM provider failed (triggered by __error__).', 502)
  }
  const settings = settingsFor(req.doc_id)
  const standalone = rewrite(question, req.history.slice(-6))
  const questionTerms = terms(standalone)
  const retrieved: RetrievedChunk[] = chunksFor(req.doc_id, method)
    .map((chunk) => ({ chunk, score: score(questionTerms, chunk) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.top_k)

  const best = retrieved[0]
  const notFound = !best || best.score < settings.not_found_threshold
  const latency = Math.round(400 + Math.random() * 1400 + (performance.now() - started))

  if (notFound) {
    return {
      ...CHAT_NOT_FOUND,
      method,
      answer: 'Not found in the document.',
      standalone_question: standalone,
      sources: [],
      retrieved_chunks: retrieved,
      prompt_sent: '',
      tokens_used: { prompt: 0, completion: 0, total: 0 },
      latency_ms: Math.round(latency / 4),
      not_found: true,
    }
  }

  const prompt = buildPrompt(retrieved, standalone)
  const answer = answerFrom(best.chunk)
  const sources: SourceCitation[] = retrieved
    .filter((item) => item.score >= settings.not_found_threshold)
    .slice(0, 3)
    .map(({ chunk }) => ({
      chunk_id: chunk.chunk_id,
      heading_path: chunk.heading_path,
      page: chunk.page,
    }))
  const promptTokens = tokenCount(prompt)
  const completionTokens = tokenCount(answer)
  return {
    ...CHAT_SMART,
    method,
    answer,
    standalone_question: standalone,
    sources,
    retrieved_chunks: retrieved,
    prompt_sent: prompt,
    tokens_used: {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
    },
    latency_ms: latency,
    not_found: false,
  }
}

// ---------------------------------------------------------------------------------------------
// Endpoint implementations (same names as client.ts uses)
// ---------------------------------------------------------------------------------------------

export async function getHealth(): Promise<HealthResponse> {
  await delay(150, 400)
  return { status: 'ok', embedding_model_loaded: true, llm_configured: true }
}

export async function getSamples(): Promise<SampleInfo[]> {
  await delay()
  return SAMPLES.map((sample) => ({ ...sample }))
}

export async function uploadSample(sampleId: string): Promise<UploadResponse> {
  await delay()
  const sample = SAMPLES.find((item) => item.sample_id === sampleId)
  if (!sample) throw new ApiError('SAMPLE_NOT_FOUND', `Sample ${sampleId} was not found.`, 404)
  const doc = addDoc(sample.filename, 1)
  return { ...UPLOAD, doc_id: doc.doc_id, filename: sample.filename, pages: 1, size_bytes: 18_432 }
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  await delay(600, 1200)
  const problem = validateUploadFile(file)
  if (problem) throw problem
  const name = file.name.toLowerCase()
  if (file.size === 0 || name.includes('empty')) {
    throw new ApiError('EMPTY_DOCUMENT', 'No extractable text was found.', 422)
  }
  if (name.includes('scanned')) {
    throw new ApiError(ERROR_ENVELOPE.error.code, ERROR_ENVELOPE.error.message, 422)
  }
  if (name.includes('encrypted')) {
    throw new ApiError('ENCRYPTED_PDF', 'This PDF is password protected.', 422)
  }
  const isPdf = name.endsWith('.pdf')
  const doc = addDoc(file.name, isPdf ? UPLOAD.pages : 1)
  return {
    doc_id: doc.doc_id,
    filename: file.name,
    pages: doc.pages,
    size_bytes: file.size,
    warnings: isPdf
      ? []
      : ['Demo mode: the built-in sample text is used instead of your file’s content.'],
  }
}

export async function startProcess(req: ProcessRequest): Promise<ProcessStartResponse> {
  await delay()
  const doc = assertDoc(req.doc_id)
  settle(req.doc_id)
  if (doc.status === 'processing') {
    throw new ApiError(
      'PROCESSING_IN_PROGRESS',
      `Document ${req.doc_id} is already being processed.`,
      409,
    )
  }
  jobs.set(req.doc_id, {
    startedAt: Date.now(),
    settings: req.settings,
    fails: doc.filename.toLowerCase().includes('crash'),
  })
  doc.status = 'processing'
  saveDb()
  return { ...PROCESS_START, doc_id: req.doc_id }
}

export async function getStatus(docId: string): Promise<ProcessingStatus> {
  await delay(80, 220)
  const doc = assertDoc(docId)
  settle(docId)
  const job = jobs.get(docId)

  if (doc.status === 'ready') return { ...STATUS_DONE, doc_id: docId }
  if (doc.status === 'error') {
    const failed = snapshot(FAIL_AT_MS)
    return {
      ...STATUS_RUNNING,
      doc_id: docId,
      status: 'error',
      step: failed.step,
      progress: failed.progress,
      error_message:
        'The parser crashed on this file (demo failure triggered by “crash” in the name).',
    }
  }
  if (doc.status === 'processing' && job) {
    const { step, progress } = snapshot(Date.now() - job.startedAt)
    return { ...STATUS_RUNNING, doc_id: docId, status: 'running', step, progress }
  }
  return { doc_id: docId, status: 'idle', step: 'uploaded', progress: 0, error_message: null }
}

export async function getProcessResult(docId: string): Promise<ProcessResult> {
  await delay()
  assertReady(docId)
  return {
    ...PROCESS_RESULT,
    doc_id: docId,
    smart_stats: computeStats(chunksFor(docId, 'smart'), 'smart'),
    naive_stats: computeStats(chunksFor(docId, 'naive'), 'naive'),
    settings: settingsFor(docId),
  }
}

export async function getChunks(params: GetChunksParams): Promise<ChunkPage> {
  await delay(250, 700)
  assertReady(params.doc_id)
  const page = params.page ?? 1
  const pageSize = params.page_size ?? 50
  if (page < 1 || pageSize < 1 || pageSize > 200) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'page must be >= 1 and page_size between 1 and 200.',
      422,
    )
  }
  const all = chunksFor(params.doc_id, params.method)
  const filtered = params.type ? all.filter((chunk) => chunk.type === params.type) : all
  const start = (page - 1) * pageSize
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
  }
}

export async function downloadChunks(
  docId: string,
  method: Method,
): Promise<{ blob: Blob; filename: string }> {
  await delay(200, 500)
  assertReady(docId)
  const lines = chunksFor(docId, method).map((chunk) => JSON.stringify(chunk))
  return {
    blob: new Blob([`${lines.join('\n')}\n`], { type: 'application/x-ndjson' }),
    filename: `${docId}_${method}.jsonl`,
  }
}

export async function getSummary(docId: string): Promise<DocSummary> {
  await delay()
  assertReady(docId)
  return { ...SUMMARY, doc_id: docId }
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  await delay(600, 1300)
  assertReady(req.doc_id)
  const result = runChat(req.method, req)
  recordHistory(req.doc_id, req.question, req.method, result.answer, null, result.not_found)
  return result
}

export async function compare(req: CompareRequest): Promise<CompareResult> {
  await delay(800, 1500)
  assertReady(req.doc_id)
  const result = { smart: runChat('smart', req), naive: runChat('naive', req) }
  recordHistory(
    req.doc_id,
    req.question,
    'compare',
    result.smart.answer,
    result.naive.answer,
    result.smart.not_found && result.naive.not_found,
  )
  return result
}

export async function createSessionSummary(req: SessionSummaryRequest): Promise<SessionSummary> {
  await delay(700, 1300)
  assertReady(req.doc_id)
  const tally = { smart: 0, naive: 0, tie: 0, unvoted: 0 }
  req.qa_items.forEach((item) => {
    tally[item.winner] += 1
  })
  const total = req.qa_items.length
  const recap =
    total === 0
      ? 'No questions have been compared yet.'
      : `You compared ${total} question${total === 1 ? '' : 's'}. SmartChunk won ${tally.smart}, the traditional chunker won ${tally.naive}, ${tally.tie} ${tally.tie === 1 ? 'was a tie' : 'were ties'} and ${tally.unvoted} ${tally.unvoted === 1 ? 'is' : 'are'} not voted on yet.`
  return {
    recap,
    key_findings: SESSION_SUMMARY.key_findings,
    qa_rows: req.qa_items.map((item) => ({ ...item })),
  }
}

export async function getEvaluation(): Promise<EvaluationResult> {
  await delay()
  return EVALUATION
}

export async function getDocuments(): Promise<DocumentInfo[]> {
  await delay()
  Array.from(docs.keys()).forEach(settle)
  return Array.from(docs.values())
    .map((doc) => ({ ...doc }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function deleteDocument(docId: string): Promise<DeleteDocumentResponse> {
  await delay()
  assertDoc(docId)
  docs.delete(docId)
  jobs.delete(docId)
  saveDb()
  histories.delete(docId)
  saveHistories()
  return { deleted: true, doc_id: docId }
}

/** Process result for the seeded demo document (used by "Load demo document"). */
export function seedProcessResult(): ProcessResult {
  const docId = SEED_UPLOAD.doc_id
  if (!docs.has(docId)) {
    docs.set(docId, { ...(DOCUMENTS[0] as DocumentInfo), doc_id: docId, status: 'ready' })
    saveDb()
  }
  return {
    ...PROCESS_RESULT,
    doc_id: docId,
    smart_stats: computeStats(chunksFor(docId, 'smart'), 'smart'),
    naive_stats: computeStats(chunksFor(docId, 'naive'), 'naive'),
    settings: settingsFor(docId),
  }
}

/** Demo mode accepts any username (3+ characters) and password (6+ characters). */
export async function login(credentials: { username: string; password: string }): Promise<{
  username: string
  token: string
}> {
  await delay(200, 500)
  const username = credentials.username.trim()
  if (username.length < 3 || credentials.password.length < 6) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'Usernames need at least 3 characters and passwords at least 6.',
      422,
    )
  }
  return { username, token: 'demo-token' }
}

// ---------------------------------------------------------------------------------------------
// Summarised history (same rules as backend/memory.py, with the built-in summariser)
// ---------------------------------------------------------------------------------------------

const MOCK_HISTORY_KEY = 'smartchunk-mock-history'
const RECENT_LIMIT = 12
const COMPRESS_BATCH = 6
const SUMMARY_CHARS = 2400

function readHistories(): Map<string, DocHistory> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(MOCK_HISTORY_KEY)
    if (!raw) return new Map()
    const parsed = HistoryListSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? new Map(parsed.data.map((item) => [item.doc_id, item])) : new Map()
  } catch {
    return new Map()
  }
}

const histories = readHistories()

function saveHistories(): void {
  try {
    localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(Array.from(histories.values())))
  } catch {
    // Storage can be unavailable; history then lasts for this page view only.
  }
}

function emptyHistory(docId: string): DocHistory {
  return {
    doc_id: docId,
    filename: docs.get(docId)?.filename ?? docId,
    summary: '',
    summarized_questions: 0,
    counts: { questions: 0, smart: 0, naive: 0, compare: 0, not_found: 0 },
    recent: [],
    updated_at: null,
  }
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function foldHistory(history: DocHistory): void {
  while (history.recent.length > RECENT_LIMIT) {
    const batch = history.recent.slice(0, COMPRESS_BATCH)
    const lines = history.summary ? [history.summary] : []
    batch.forEach((item) => {
      const first = item.answer.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0] ?? ''
      lines.push(
        `- ${item.question} → ${item.not_found ? 'not found in the document' : clip(first, 160)}`,
      )
    })
    let summary = lines.join('\n')
    if (summary.length > SUMMARY_CHARS) {
      summary = summary.slice(-SUMMARY_CHARS)
      summary = summary.slice(summary.indexOf('\n') + 1)
    }
    history.summary = summary
    history.summarized_questions += batch.length
    history.recent = history.recent.slice(batch.length)
  }
}

function recordHistory(
  docId: string,
  question: string,
  method: HistoryEntry['method'],
  answer: string,
  naiveAnswer: string | null,
  notFound: boolean,
): void {
  const history = histories.get(docId) ?? emptyHistory(docId)
  const askedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  history.recent.push({
    question: clip(question, 500),
    method,
    answer: clip(answer, 1200),
    naive_answer: naiveAnswer === null ? null : clip(naiveAnswer, 1200),
    not_found: notFound,
    asked_at: askedAt,
  })
  history.counts.questions += 1
  history.counts[method] += 1
  if (notFound) history.counts.not_found += 1
  history.updated_at = askedAt
  foldHistory(history)
  histories.set(docId, history)
  saveHistories()
}

export async function getHistory(): Promise<DocHistory[]> {
  await delay(150, 400)
  return Array.from(histories.values())
    .filter((item) => item.counts.questions > 0)
    .map((item) => ({ ...item, filename: docs.get(item.doc_id)?.filename ?? item.filename }))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
}

export async function getDocHistory(docId: string): Promise<DocHistory> {
  await delay(150, 400)
  assertDoc(docId)
  return histories.get(docId) ?? emptyHistory(docId)
}

export async function clearDocHistory(docId: string): Promise<HistoryCleared> {
  await delay(150, 400)
  assertDoc(docId)
  histories.delete(docId)
  saveHistories()
  return { cleared: true, doc_id: docId }
}
