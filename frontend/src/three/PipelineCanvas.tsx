// Lazy-loaded entry for the processing pipeline 3D scene.

import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import type { ProcessStep, ProcessingStatus } from '@/types/api'
import { PipelineScene } from './PipelineScene'
import { SceneCanvas } from './SceneCanvas'

interface PipelineCanvasProps {
  step: ProcessStep
  progress: number
  status: ProcessingStatus['status']
}

export default function PipelineCanvas({ step, progress, status }: PipelineCanvasProps) {
  const reduced = usePrefersReducedMotion()
  return (
    <SceneCanvas
      camera={{ position: [0, 1.4, 9.5], fov: 42 }}
      reduced={reduced}
      dpr={[1, 2]}
      fallback={null}
    >
      <PipelineScene step={step} progress={progress} status={status} reduced={reduced} />
    </SceneCanvas>
  )
}
