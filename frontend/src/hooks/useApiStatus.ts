import { useCallback, useEffect, useState } from 'react'
import { getHealth } from '@/api/client'

export type ApiStatus = 'checking' | 'online' | 'offline'

/** Calls GET /api/health on mount and whenever `mock` flips, and exposes a manual re-check. */
export function useApiStatus(mock: boolean): { status: ApiStatus; recheck: () => void } {
  const [status, setStatus] = useState<ApiStatus>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('checking')
    getHealth()
      .then(() => {
        if (!cancelled) setStatus('online')
      })
      .catch(() => {
        if (!cancelled) setStatus('offline')
      })
    return () => {
      cancelled = true
    }
  }, [mock, attempt])

  const recheck = useCallback(() => setAttempt((value) => value + 1), [])

  return { status, recheck }
}
