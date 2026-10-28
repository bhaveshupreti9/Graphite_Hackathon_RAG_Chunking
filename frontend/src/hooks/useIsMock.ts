import { ENV_USE_MOCK } from '@/lib/env'
import { useAppStore } from '@/store/useAppStore'

/** True when API calls are answered by the mock layer (env flag or the Demo mode toggle). */
export function useIsMock(): boolean {
  const demoMode = useAppStore((state) => state.demoMode)
  return ENV_USE_MOCK || demoMode
}
