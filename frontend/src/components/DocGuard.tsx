import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import type { UploadRedirectState } from '@/lib/redirect'
import { useAppStore } from '@/store/useAppStore'

interface DocGuardProps {
  children: ReactNode
}

/** Sends the user to /upload (with a message) when there is no processed document yet. */
export function DocGuard({ children }: DocGuardProps) {
  const docId = useAppStore((state) => state.doc_id)
  const processResult = useAppStore((state) => state.processResult)
  const location = useLocation()

  if (!docId || !processResult) {
    const state: UploadRedirectState = {
      message: 'Upload and process a document first. That page needs a processed document.',
      from: location.pathname,
    }
    return <Navigate to={ROUTES.upload} replace state={state} />
  }

  return <>{children}</>
}
