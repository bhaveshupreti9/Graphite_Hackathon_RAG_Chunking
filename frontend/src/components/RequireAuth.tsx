import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useIsMock } from '@/hooks/useIsMock'
import { ROUTES } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'

export interface LoginRedirectState {
  from: string
}

/**
 * Sends logged-out users to /login and brings them back afterwards. Demo mode needs no account,
 * so the offline backup demo always works.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAppStore((state) => state.auth)
  const mock = useIsMock()
  const location = useLocation()

  if (!auth && !mock) {
    // While the page-change animation runs, the old page is still mounted and re-renders with the
    // new /login location. Redirecting again from there would overwrite where to go back to.
    if (location.pathname === ROUTES.login) return null
    const state: LoginRedirectState = { from: location.pathname }
    return <Navigate to={ROUTES.login} replace state={state} />
  }
  return <>{children}</>
}
