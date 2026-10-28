import { getStatus } from '@/api/client'
import type { ProcessingStatus } from '@/types/api'

export interface PollOptions {
  /** Time between status calls. Spec A7 says 1000 ms. */
  intervalMs?: number
  /** Abort when the page unmounts: polling stops and the promise rejects with an AbortError. */
  signal?: AbortSignal
  /** Called after every status response (use it to drive the progress UI). */
  onUpdate?: (status: ProcessingStatus) => void
}

function abortError(): DOMException {
  return new DOMException('Polling was cancelled.', 'AbortError')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Polls GET /api/processing-status/{doc_id} until the status is "done" or "error", then resolves
 * with that final status. The caller then fetches the process result when it is "done".
 */
export async function pollProcessing(
  docId: string,
  { intervalMs = 1000, signal, onUpdate }: PollOptions = {},
): Promise<ProcessingStatus> {
  for (;;) {
    if (signal?.aborted) throw abortError()
    const status = await getStatus(docId)
    if (signal?.aborted) throw abortError()
    onUpdate?.(status)
    if (status.status === 'done' || status.status === 'error') return status
    await sleep(intervalMs, signal)
  }
}
