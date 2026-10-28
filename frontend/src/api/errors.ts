// Error type thrown by every API call, plus friendly text for each error code (spec A4 / C3 rule 5).

export type ServerErrorCode =
  | 'INVALID_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'EMPTY_DOCUMENT'
  | 'SCANNED_PDF'
  | 'ENCRYPTED_PDF'
  | 'VALIDATION_ERROR'
  | 'DOC_NOT_FOUND'
  | 'SAMPLE_NOT_FOUND'
  | 'NOT_PROCESSED'
  | 'PROCESSING_IN_PROGRESS'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_ERROR'
  | 'EVAL_NOT_AVAILABLE'
  | 'INTERNAL_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'USERNAME_TAKEN'

export type ClientErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'UNKNOWN_ERROR'

export type ErrorCode = ServerErrorCode | ClientErrorCode

const FRIENDLY_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INVALID_FILE_TYPE:
    "That file type isn't supported. Upload a PDF, Markdown, text, CSV, TSV or Excel (.xlsx) file.",
  FILE_TOO_LARGE: 'That file is too large. The limit is 20 MB.',
  EMPTY_DOCUMENT: 'No readable text was found in that document. Try a different file.',
  SCANNED_PDF:
    'This PDF has only images. OCR is not supported. Try a text-based PDF or a Markdown file.',
  ENCRYPTED_PDF: 'This PDF is password protected. Remove the password and upload it again.',
  VALIDATION_ERROR: 'Some values are not valid. Check the settings and try again.',
  DOC_NOT_FOUND:
    'That document no longer exists. Pick another one in the Knowledge Base or upload it again.',
  SAMPLE_NOT_FOUND: 'That sample document was not found.',
  NOT_PROCESSED:
    "This document hasn't finished processing yet. Process it on the Upload page first.",
  PROCESSING_IN_PROGRESS: 'This document is already being processed. Please wait for it to finish.',
  LLM_NOT_CONFIGURED:
    "The language model isn't configured on the server. Set LLM_API_KEY, LLM_BASE_URL and LLM_MODEL in the backend .env file.",
  LLM_ERROR: 'The language model provider returned an error. Try again in a moment.',
  EVAL_NOT_AVAILABLE:
    "Evaluation results haven't been generated yet. Run python -m eval.run_eval on the backend.",
  INTERNAL_ERROR: 'Something went wrong on the server. Try again.',
  UNAUTHORIZED: 'Your session has ended. Please log in again.',
  INVALID_CREDENTIALS: 'Wrong username or password.',
  USERNAME_TAKEN: 'That username is already taken. Log in instead, or pick another one.',
  NETWORK_ERROR: "Can't reach the backend. Check that it is running, or switch on Demo mode.",
  TIMEOUT: 'The request took too long and was cancelled. Try again.',
  UNKNOWN_ERROR: 'Something unexpected went wrong. Try again.',
}

function isKnownCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(FRIENDLY_MESSAGES, code)
}

export function friendlyMessage(code: string, fallback: string): string {
  return isKnownCode(code) ? FRIENDLY_MESSAGES[code] : fallback
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }

  /** Text that is safe and friendly to show to a user. */
  get userMessage(): string {
    return friendlyMessage(this.code, this.message)
  }
}

/** Turns anything that was thrown into an ApiError so the UI has one shape to handle. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) return new ApiError('UNKNOWN_ERROR', error.message)
  return new ApiError('UNKNOWN_ERROR', 'Something unexpected went wrong.')
}
