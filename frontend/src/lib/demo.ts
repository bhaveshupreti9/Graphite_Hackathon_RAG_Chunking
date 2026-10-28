import { SEED_UPLOAD, seedProcessResult } from '@/api/mock'
import { useAppStore } from '@/store/useAppStore'

/**
 * Seeds the store with the demo document from /contracts so every page that needs a processed
 * document can be opened in demo mode without going through the upload flow.
 */
export function loadDemoDocument(): void {
  const result = seedProcessResult()
  const state = useAppStore.getState()
  state.setDocument(SEED_UPLOAD)
  state.setSettings(result.settings)
  state.setProcessResult(result)
}
