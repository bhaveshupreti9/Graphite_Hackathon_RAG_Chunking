// Lazy-loaded entry for the chunking visualiser (keeps three.js out of the main bundle).

import type { MutableRefObject } from 'react'
import type { VizModel } from '@/lib/chunkGeometry'
import { ChunkVisualizerScene } from './ChunkVisualizerScene'
import type { VizHover, VizView } from './ChunkVisualizerScene'
import { SceneCanvas } from './SceneCanvas'
import { VisualizerFallback } from './VisualizerFallback'

interface ChunkVisualizerCanvasProps {
  model: VizModel
  progressRef: MutableRefObject<number>
  view: VizView
  reduced: boolean
  selectedBlock: number | null
  onHover: (hover: VizHover | null) => void
  onSelect: (block: number | null) => void
}

export default function ChunkVisualizerCanvas(props: ChunkVisualizerCanvasProps) {
  return (
    <SceneCanvas
      camera={{ position: [0, 0, 20], fov: 40 }}
      // The timeline is driven by the page, so the canvas always renders while on screen;
      // with reduced motion the scene snaps to each state instead of easing.
      reduced={false}
      dpr={[1, 2]}
      fallback={
        <VisualizerFallback
          model={props.model}
          view={props.view}
          onSelect={props.onSelect}
          selectedBlock={props.selectedBlock}
        />
      }
    >
      <ChunkVisualizerScene {...props} />
    </SceneCanvas>
  )
}
