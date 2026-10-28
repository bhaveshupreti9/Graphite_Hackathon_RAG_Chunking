// 2D (SVG) version of the chunking visualiser: the final state of both columns. Used when WebGL is
// missing or the 3D scene fails. Same geometry model, so it shows the same cuts.

import type { VizModel } from '@/lib/chunkGeometry'
import { cn } from '@/lib/cn'
import type { ChunkType } from '@/types/api'
import type { VizView } from './ChunkVisualizerScene'

const FILL: Record<ChunkType, string> = {
  prose: 'fill-type-prose',
  code: 'fill-type-code',
  table: 'fill-type-table',
  list: 'fill-type-list',
}
const WIDTH: Record<ChunkType, number> = { prose: 150, code: 130, table: 160, list: 120 }

const COLUMN_W = 160
const HEIGHT = 900
const GAP_NAIVE = 10
const GAP_SMART = 3
const GAP_SECTION = 14

interface VisualizerFallbackProps {
  model: VizModel
  view: VizView
  selectedBlock: number | null
  onSelect: (block: number | null) => void
}

export function VisualizerFallback({
  model,
  view,
  selectedBlock,
  onSelect,
}: VisualizerFallbackProps) {
  const total = Math.max(1, model.total)
  const scale =
    (HEIGHT -
      Math.max(
        Math.max(0, model.naive.length - 1) * GAP_NAIVE,
        Math.max(0, model.blocks.length - 1) * GAP_SMART +
          Math.max(0, model.sections.length - 1) * GAP_SECTION,
      )) /
    total
  const showNaive = view !== 'smart'
  const showSmart = view !== 'naive'
  const naiveX = 20
  const smartX = showNaive ? COLUMN_W + 80 : 20
  const width = showNaive && showSmart ? COLUMN_W * 2 + 100 : COLUMN_W + 40
  const y = (pos: number) => 30 + pos * Math.max(0.0001, scale)

  return (
    <div className="flex h-full w-full justify-center overflow-auto p-4">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT + 40}`}
        className="h-full max-h-full w-auto"
        role="img"
        aria-label="Chunk layout of both methods"
      >
        {showNaive ? (
          <g>
            <text x={naiveX} y={18} className="fill-fg text-[13px] font-medium">
              Traditional
            </text>
            {model.segments.map((segment, index) => {
              const block = model.blocks[segment.block]
              if (!block) return null
              const top = y(segment.start) + segment.naiveIndex * GAP_NAIVE
              const h = Math.max(1, (segment.end - segment.start) * scale - 1)
              return (
                <rect
                  key={index}
                  x={naiveX}
                  y={top}
                  width={WIDTH[block.chunk.type]}
                  height={h}
                  rx={2}
                  onClick={() => onSelect(segment.block)}
                  className={cn(
                    'cursor-pointer',
                    FILL[block.chunk.type],
                    block.split && 'stroke-bad',
                    selectedBlock === segment.block && 'stroke-fg',
                  )}
                  strokeWidth={block.split || selectedBlock === segment.block ? 2 : 0}
                />
              )
            })}
            {model.cuts
              .filter((cut) => cut.inside)
              .map((cut) => {
                const block = cut.block === null ? undefined : model.blocks[cut.block]
                const lineY = y(cut.pos) + cut.naiveIndex * GAP_NAIVE - GAP_NAIVE / 2
                return (
                  <line
                    key={cut.naiveIndex}
                    x1={naiveX - 8}
                    x2={naiveX + COLUMN_W + 8}
                    y1={lineY}
                    y2={lineY}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    className={block?.split ? 'stroke-bad' : 'stroke-fg'}
                  />
                )
              })}
          </g>
        ) : null}

        {showSmart ? (
          <g>
            <text x={smartX} y={18} className="fill-fg text-[13px] font-medium">
              SmartChunk
            </text>
            {model.sections.map((section, index) => {
              const first = model.blocks[section.first]
              const last = model.blocks[section.last]
              if (!first || !last) return null
              const top = y(first.start) + section.first * GAP_SMART + index * GAP_SECTION
              const bottom = y(last.end) + section.last * GAP_SMART + index * GAP_SECTION
              return (
                <rect
                  key={`${section.name}-${index}`}
                  x={smartX - 5}
                  y={top - 4}
                  width={COLUMN_W + 10}
                  height={bottom - top + 8}
                  rx={5}
                  className="fill-none stroke-good"
                  strokeWidth={1.2}
                />
              )
            })}
            {model.blocks.map((block) => {
              const top =
                y(block.start) + block.index * GAP_SMART + block.sectionIndex * GAP_SECTION
              const h = Math.max(1, (block.end - block.start) * scale)
              return (
                <rect
                  key={block.index}
                  x={smartX}
                  y={top}
                  width={WIDTH[block.chunk.type]}
                  height={h}
                  rx={2}
                  onClick={() => onSelect(block.index)}
                  className={cn(
                    'cursor-pointer',
                    FILL[block.chunk.type],
                    selectedBlock === block.index && 'stroke-fg',
                  )}
                  strokeWidth={selectedBlock === block.index ? 2 : 0}
                />
              )
            })}
          </g>
        ) : null}
      </svg>
    </div>
  )
}
