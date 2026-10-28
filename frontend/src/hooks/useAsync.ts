import { useCallback, useEffect, useState } from 'react'
import { toApiError } from '@/api/errors'
import type { ApiError } from '@/api/errors'

export type AsyncState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: T | null; error: ApiError }

/**
 * Runs `loader` on mount and whenever it changes (wrap it in useCallback), and exposes `reload` for
 * Retry buttons. Results from a stale call are ignored.
 */
export function useAsync<T>(loader: () => Promise<T>): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }))
    loader()
      .then((data) => {
        if (active) setState({ status: 'success', data, error: null })
      })
      .catch((error: unknown) => {
        if (active) {
          setState((previous) => ({
            status: 'error',
            data: previous.data,
            error: toApiError(error),
          }))
        }
      })
    return () => {
      active = false
    }
  }, [loader, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { ...state, reload }
}
