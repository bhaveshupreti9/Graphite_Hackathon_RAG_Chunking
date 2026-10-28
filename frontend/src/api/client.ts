// The ONLY file that calls fetch (spec C3 rule 1). One typed function per endpoint in PART A7.
// Each function answers from the mock layer when mock mode is on (VITE_USE_MOCK=true or the
// Demo mode toggle), and from the real backend otherwise. Signatures are identical either way.

import type { ZodType } from 'zod'
import { ENV_USE_MOCK } from '@/lib/env'
import { validateUploadFile } from '@/lib/files'
import { validateSettings } from '@/lib/settings'
import { MAX_HISTORY_TURNS } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'
import type {
  ChatResult,
  ChunkPage,
  DocSummary,
  DocumentInfo,
  EvaluationResult,
  Method,
  ProcessResult,
  ProcessStartResponse,
  ProcessingStatus,
  SampleInfo,
  SessionSummary,
  Settings,
  UploadResponse,
} from '@/types/api'
import type {
  AuthResponse,
  ChatRequest,
  CompareRequest,
  Credentials,
  DocHistory,
  HistoryCleared,
  MeResponse,
  CompareResult,
  DeleteDocumentResponse,
  GetChunksParams,
  HealthResponse,
  ProcessRequest,
  SessionSummaryRequest,
  UploadSampleRequest,
} from '@/types/requests'
import { ApiError } from './errors'
import * as mock from './mock'
import {
  AuthResponseSchema,
  ChatResultSchema,
  ChunkPageSchema,
  CompareResultSchema,
  DeleteDocumentResponseSchema,
  DocHistorySchema,
  DocSummarySchema,
  DocumentsSchema,
  ErrorEnvelopeSchema,
  EvaluationResultSchema,
  HealthResponseSchema,
  HistoryClearedSchema,
  HistoryListSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  ProcessResultSchema,
  ProcessStartResponseSchema,
  ProcessingStatusSchema,
  SamplesSchema,
  SessionSummarySchema,
  UploadResponseSchema,
} from './schemas'

/** Backend base URL (spec A3). This is the only place a URL default lives. */
export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '')

/** Timeouts from spec C3 rule 6. */
const TIMEOUTS = { default: 30_000, upload: 120_000, chat: 90_000 } as const

/** True when calls are answered by the mock layer. */
export function isMockMode(): boolean {
  return ENV_USE_MOCK || useAppStore.getState().demoMode
}

// ---------------------------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------------------------

type QueryValue = string | number | undefined

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const queryString = params.toString()
  return queryString ? `${url}?${queryString}` : url
}

/** Runs `run` with an AbortSignal that fires after `timeoutMs`, and maps failures to ApiError. */
async function withTimeout<R>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<R>,
): Promise<R> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await run(controller.signal)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) throw new ApiError('TIMEOUT', 'The request timed out.')
    throw new ApiError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'The network request failed.',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Parses a JSON body. Returns undefined when the body is not JSON (proxy error pages, etc.). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/** Adds "Authorization: Bearer <token>" when a user is logged in. */
function addAuthHeader(headers: Headers): void {
  const token = useAppStore.getState().auth?.token
  if (token) headers.set('Authorization', `Bearer ${token}`)
}

/** Builds the error for a non-2xx response: the A4 envelope when present, else NETWORK_ERROR. */
function errorFromResponse(status: number, body: unknown): ApiError {
  const envelope = ErrorEnvelopeSchema.safeParse(body)
  if (envelope.success) {
    // An expired or unknown session logs the user out; the route guard then shows /login.
    if (envelope.data.error.code === 'UNAUTHORIZED' && useAppStore.getState().auth) {
      useAppStore.getState().setAuth(null)
    }
    return new ApiError(envelope.data.error.code, envelope.data.error.message, status)
  }
  return new ApiError(
    'NETWORK_ERROR',
    `Unexpected response from the server (HTTP ${status}).`,
    status,
  )
}

function validateInDev<T>(label: string, schema: ZodType<T>, data: unknown): void {
  if (!import.meta.env.DEV) return
  const result = schema.safeParse(data)
  if (!result.success) {
    console.error(
      `[api contract] ${label}: the response does not match the contract in PART A.`,
      result.error.issues,
    )
  }
}

interface RequestOptions<T> {
  label: string
  path: string
  schema: ZodType<T>
  method?: 'GET' | 'POST' | 'DELETE'
  query?: Record<string, QueryValue>
  json?: unknown
  form?: FormData
  timeoutMs?: number
}

async function request<T>(options: RequestOptions<T>): Promise<T> {
  const { label, path, schema, method = 'GET', query, json, form, timeoutMs } = options
  return withTimeout(timeoutMs ?? TIMEOUTS.default, async (signal) => {
    const headers = new Headers({ Accept: 'application/json' })
    addAuthHeader(headers)
    const init: RequestInit = { method, signal, headers }
    if (form) {
      init.body = form // the browser sets the multipart boundary itself
    } else if (json !== undefined) {
      headers.set('Content-Type', 'application/json')
      init.body = JSON.stringify(json)
    }

    const response = await fetch(buildUrl(path, query), init)
    const body = await readJson(response)
    if (!response.ok) throw errorFromResponse(response.status, body)
    if (body === undefined) {
      throw new ApiError(
        'NETWORK_ERROR',
        `The server sent an empty or invalid response (HTTP ${response.status}).`,
        response.status,
      )
    }
    validateInDev(label, schema, body)
    return body as T
  })
}

function lastTurns<T>(history: T[]): T[] {
  return history.slice(-MAX_HISTORY_TURNS)
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  return match ? decodeURIComponent(match[1]) : null
}

const enc = encodeURIComponent

// ---------------------------------------------------------------------------------------------
// Endpoints (PART A7, same order)
// ---------------------------------------------------------------------------------------------

/** 1. GET /api/health */
export function getHealth(): Promise<HealthResponse> {
  if (isMockMode()) return mock.getHealth()
  return request({ label: 'GET /api/health', path: '/api/health', schema: HealthResponseSchema })
}

/** 2. GET /api/samples */
export function getSamples(): Promise<SampleInfo[]> {
  if (isMockMode()) return mock.getSamples()
  return request({ label: 'GET /api/samples', path: '/api/samples', schema: SamplesSchema })
}

/** 3. POST /api/upload-sample */
export function uploadSample(sampleId: string): Promise<UploadResponse> {
  if (isMockMode()) return mock.uploadSample(sampleId)
  const body: UploadSampleRequest = { sample_id: sampleId }
  return request({
    label: 'POST /api/upload-sample',
    path: '/api/upload-sample',
    method: 'POST',
    json: body,
    schema: UploadResponseSchema,
  })
}

/** 4. POST /api/upload (multipart, field name "file") */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const problem = validateUploadFile(file)
  if (problem) throw problem
  if (isMockMode()) return mock.uploadFile(file)
  const form = new FormData()
  form.append('file', file)
  return request({
    label: 'POST /api/upload',
    path: '/api/upload',
    method: 'POST',
    form,
    timeoutMs: TIMEOUTS.upload,
    schema: UploadResponseSchema,
  })
}

/** 5. POST /api/process (HTTP 202) */
export async function startProcess(
  docId: string,
  settings: Settings,
): Promise<ProcessStartResponse> {
  const problems = Object.values(validateSettings(settings))
  if (problems.length > 0)
    throw new ApiError('VALIDATION_ERROR', problems[0] ?? 'Invalid settings.')
  const body: ProcessRequest = { doc_id: docId, settings }
  if (isMockMode()) return mock.startProcess(body)
  return request({
    label: 'POST /api/process',
    path: '/api/process',
    method: 'POST',
    json: body,
    schema: ProcessStartResponseSchema,
  })
}

/** 6. GET /api/processing-status/{doc_id} */
export function getStatus(docId: string): Promise<ProcessingStatus> {
  if (isMockMode()) return mock.getStatus(docId)
  return request({
    label: 'GET /api/processing-status',
    path: `/api/processing-status/${enc(docId)}`,
    schema: ProcessingStatusSchema,
  })
}

/** 7. GET /api/process-result/{doc_id} (409 NOT_PROCESSED until the job is done) */
export function getProcessResult(docId: string): Promise<ProcessResult> {
  if (isMockMode()) return mock.getProcessResult(docId)
  return request({
    label: 'GET /api/process-result',
    path: `/api/process-result/${enc(docId)}`,
    schema: ProcessResultSchema,
  })
}

/** 8. GET /api/chunks */
export function getChunks(params: GetChunksParams): Promise<ChunkPage> {
  if (isMockMode()) return mock.getChunks(params)
  return request({
    label: 'GET /api/chunks',
    path: '/api/chunks',
    query: {
      doc_id: params.doc_id,
      method: params.method,
      type: params.type,
      page: params.page,
      page_size: params.page_size,
    },
    schema: ChunkPageSchema,
  })
}

/** 9. GET /api/chunks/export. Resolves with the file so the caller can save it (see lib/download). */
export function downloadChunks(
  docId: string,
  method: Method = 'smart',
): Promise<{ blob: Blob; filename: string }> {
  if (isMockMode()) return mock.downloadChunks(docId, method)
  return withTimeout(TIMEOUTS.default, async (signal) => {
    const headers = new Headers()
    addAuthHeader(headers)
    const response = await fetch(buildUrl('/api/chunks/export', { doc_id: docId, method }), {
      signal,
      headers,
    })
    if (!response.ok) throw errorFromResponse(response.status, await readJson(response))
    const blob = await response.blob()
    const filename =
      filenameFromDisposition(response.headers.get('Content-Disposition')) ??
      `${docId}_${method}.jsonl`
    return { blob, filename }
  })
}

/** 10. GET /api/summary/{doc_id} */
export function getSummary(docId: string): Promise<DocSummary> {
  if (isMockMode()) return mock.getSummary(docId)
  return request({
    label: 'GET /api/summary',
    path: `/api/summary/${enc(docId)}`,
    schema: DocSummarySchema,
  })
}

/** 11. POST /api/chat (sends at most the last 6 turns of history) */
export function chat(req: ChatRequest): Promise<ChatResult> {
  const body: ChatRequest = { ...req, history: lastTurns(req.history) }
  if (isMockMode()) return mock.chat(body)
  return request({
    label: 'POST /api/chat',
    path: '/api/chat',
    method: 'POST',
    json: body,
    timeoutMs: TIMEOUTS.chat,
    schema: ChatResultSchema,
  })
}

/** 12. POST /api/compare (sends at most the last 6 turns of history) */
export function compare(req: CompareRequest): Promise<CompareResult> {
  const body: CompareRequest = { ...req, history: lastTurns(req.history) }
  if (isMockMode()) return mock.compare(body)
  return request({
    label: 'POST /api/compare',
    path: '/api/compare',
    method: 'POST',
    json: body,
    timeoutMs: TIMEOUTS.chat,
    schema: CompareResultSchema,
  })
}

/** 13. POST /api/session-summary */
export function createSessionSummary(req: SessionSummaryRequest): Promise<SessionSummary> {
  if (isMockMode()) return mock.createSessionSummary(req)
  return request({
    label: 'POST /api/session-summary',
    path: '/api/session-summary',
    method: 'POST',
    json: req,
    timeoutMs: TIMEOUTS.chat,
    schema: SessionSummarySchema,
  })
}

/** 14. GET /api/evaluation (404 EVAL_NOT_AVAILABLE when eval/results.json is missing) */
export function getEvaluation(): Promise<EvaluationResult> {
  if (isMockMode()) return mock.getEvaluation()
  return request({
    label: 'GET /api/evaluation',
    path: '/api/evaluation',
    schema: EvaluationResultSchema,
  })
}

/** 15. GET /api/documents */
export function getDocuments(): Promise<DocumentInfo[]> {
  if (isMockMode()) return mock.getDocuments()
  return request({ label: 'GET /api/documents', path: '/api/documents', schema: DocumentsSchema })
}

/** 16. DELETE /api/documents/{doc_id} */
export function deleteDocument(docId: string): Promise<DeleteDocumentResponse> {
  if (isMockMode()) return mock.deleteDocument(docId)
  return request({
    label: 'DELETE /api/documents',
    path: `/api/documents/${enc(docId)}`,
    method: 'DELETE',
    schema: DeleteDocumentResponseSchema,
  })
}

// ---------------------------------------------------------------------------------------------
// Accounts (added after PART A: /api/auth/*)
// ---------------------------------------------------------------------------------------------

/** POST /api/auth/register: creates the account and logs in. */
export function register(credentials: Credentials): Promise<AuthResponse> {
  if (isMockMode()) return mock.login(credentials)
  return request({
    label: 'POST /api/auth/register',
    path: '/api/auth/register',
    method: 'POST',
    json: credentials,
    schema: AuthResponseSchema,
  })
}

/** POST /api/auth/login */
export function login(credentials: Credentials): Promise<AuthResponse> {
  if (isMockMode()) return mock.login(credentials)
  return request({
    label: 'POST /api/auth/login',
    path: '/api/auth/login',
    method: 'POST',
    json: credentials,
    schema: AuthResponseSchema,
  })
}

/** GET /api/auth/me: confirms the stored session is still valid. */
export function getMe(): Promise<MeResponse> {
  if (isMockMode())
    return Promise.resolve({ username: useAppStore.getState().auth?.username ?? 'demo' })
  return request({ label: 'GET /api/auth/me', path: '/api/auth/me', schema: MeResponseSchema })
}

/** POST /api/auth/logout. Never throws: logging out locally must always work. */
export async function logout(): Promise<void> {
  if (!isMockMode()) {
    try {
      await request({
        label: 'POST /api/auth/logout',
        path: '/api/auth/logout',
        method: 'POST',
        schema: LogoutResponseSchema,
      })
    } catch {
      // The server may be offline or the session already gone; the local logout still happens.
    }
  }
  useAppStore.getState().setAuth(null)
}

// ---------------------------------------------------------------------------------------------
// Summarised history (added after PART A: /api/history)
// ---------------------------------------------------------------------------------------------

/** GET /api/history: every document you asked questions about, newest first. */
export function getHistory(): Promise<DocHistory[]> {
  if (isMockMode()) return mock.getHistory()
  return request({ label: 'GET /api/history', path: '/api/history', schema: HistoryListSchema })
}

/** GET /api/history/{doc_id} */
export function getDocHistory(docId: string): Promise<DocHistory> {
  if (isMockMode()) return mock.getDocHistory(docId)
  return request({
    label: 'GET /api/history/{doc_id}',
    path: `/api/history/${enc(docId)}`,
    schema: DocHistorySchema,
  })
}

/** DELETE /api/history/{doc_id} */
export function clearDocHistory(docId: string): Promise<HistoryCleared> {
  if (isMockMode()) return mock.clearDocHistory(docId)
  return request({
    label: 'DELETE /api/history/{doc_id}',
    path: `/api/history/${enc(docId)}`,
    method: 'DELETE',
    schema: HistoryClearedSchema,
  })
}
