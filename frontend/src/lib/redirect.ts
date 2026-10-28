// Router state used by DocGuard when it sends the user to /upload with an explanation.

export interface UploadRedirectState {
  message: string
  from: string
}

/** Reads the redirect message out of untyped router state, or returns null. */
export function readRedirectMessage(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'message' in state) {
    const { message } = state as { message: unknown }
    return typeof message === 'string' ? message : null
  }
  return null
}
