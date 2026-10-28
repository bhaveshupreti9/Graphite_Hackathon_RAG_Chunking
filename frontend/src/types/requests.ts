// Request bodies and small responses that PART A7 describes inline (they have no named type in A6).
// Nothing here adds or renames a contract field; it only gives the A7 shapes a TypeScript name.

import type { ChatResult, ChatTurn, ChunkType, Method, QAItem, Settings } from './api'

export interface HealthResponse {
  status: 'ok'
  embedding_model_loaded: boolean
  llm_configured: boolean
}

export interface UploadSampleRequest {
  sample_id: string
}

export interface ProcessRequest {
  doc_id: string
  settings: Settings
}

export interface GetChunksParams {
  doc_id: string
  method: Method
  type?: ChunkType
  page?: number // default 1
  page_size?: number // default 50, max 200
}

export interface ChatRequest {
  doc_id: string
  method: Method
  question: string
  history: ChatTurn[]
}

export interface CompareRequest {
  doc_id: string
  question: string
  history: ChatTurn[]
}

export interface CompareResult {
  smart: ChatResult
  naive: ChatResult
}

export interface SessionSummaryRequest {
  doc_id: string
  qa_items: QAItem[]
}

export interface DeleteDocumentResponse {
  deleted: true
  doc_id: string
}

export interface ErrorEnvelope {
  error: { code: string; message: string }
}

/** POST /api/auth/register and /api/auth/login body. */
export interface Credentials {
  username: string
  password: string
}

/** POST /api/auth/register and /api/auth/login response. */
export interface AuthResponse {
  username: string
  token: string
}

/** GET /api/auth/me response. */
export interface MeResponse {
  username: string
}

/** One asked question in the summarised history (GET /api/history). */
export interface HistoryEntry {
  question: string
  method: 'smart' | 'naive' | 'compare'
  answer: string
  /** The traditional chunker's answer when the question was asked on Compare answers. */
  naive_answer: string | null
  not_found: boolean
  asked_at: string
}

export interface HistoryCounts {
  questions: number
  smart: number
  naive: number
  compare: number
  not_found: number
}

/** A document's history: a rolling summary of older questions plus the most recent ones word for word. */
export interface DocHistory {
  doc_id: string
  filename: string
  summary: string
  summarized_questions: number
  counts: HistoryCounts
  recent: HistoryEntry[]
  updated_at: string | null
}

export interface HistoryCleared {
  cleared: true
  doc_id: string
}
