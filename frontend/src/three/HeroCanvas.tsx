// Lazy-loaded entry for the landing 3D scene (keeps three.js out of the main bundle).

import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { HeroFallback } from './HeroFallback'
import { HeroScene } from './HeroScene'
import { SceneCanvas } from './SceneCanvas'

interface HeroCanvasProps {
  stage: number
  compact: boolean
}

export default function HeroCanvas({ stage, compact }: HeroCanvasProps) {
  const reduced = usePrefersReducedMotion()
  return (
    <SceneCanvas
      camera={{ position: [0, 0, compact ? 18 : 15.5], fov: 38 }}
      reduced={reduced}
      dpr={compact ? [1, 1.5] : [1, 2]}
      fallback={<HeroFallback />}
    >
      <HeroScene stage={stage} reduced={reduced} compact={compact} />
    </SceneCanvas>
  )
}
