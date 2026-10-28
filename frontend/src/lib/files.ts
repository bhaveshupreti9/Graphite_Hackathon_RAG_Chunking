import { ApiError } from '@/api/errors'

export const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.tsv',
  '.xlsx',
  '.xlsm',
] as const

export const SUPPORTED_FILES_TEXT =
  'Supported files: PDF, Markdown (.md), text (.txt), CSV, TSV and Excel (.xlsx, .xlsm).'
export const MAX_UPLOAD_MB = 20
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

/** Lower-case extension including the dot, or '' when there is none. */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

/** Client-side upload check (type and size). Returns the error to show, or null when the file is fine. */
export function validateUploadFile(file: { name: string; size: number }): ApiError | null {
  const extension = fileExtension(file.name)
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return new ApiError('INVALID_FILE_TYPE', SUPPORTED_FILES_TEXT)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return new ApiError('FILE_TOO_LARGE', `The file is larger than ${MAX_UPLOAD_MB} MB.`)
  }
  return null
}
