// 2D version of the hero scene, used when WebGL is missing, the scene crashes, or while the 3D
// bundle loads. Same document model, drawn as SVG.

import { cn } from '@/lib/cn'
import { BLOCKS, COLUMN, CUTS, GROUPED, MAX_W, SECTIONS, sectionBounds } from './docModel'

const TYPE_FILL: Record<string, string> = {
  prose: 'fill-type-prose',
  code: 'fill-type-code',
  table: 'fill-type-table',
  list: 'fill-type-list',
}

const UNIT = 38
const PAD = 26

interface HeroFallbackProps {
  className?: string
}

export function HeroFallback({ className }: HeroFallbackProps) {
  const docWidth = MAX_W * UNIT
  const height = Math.max(COLUMN.height, GROUPED.height) * UNIT + PAD * 2 + 30
  const leftX = PAD
  const rightX = PAD * 3 + docWidth
  const width = rightX + docWidth + PAD
  const bounds = sectionBounds(GROUPED)

  return (
    <div
      className={cn('flex h-full w-full items-center justify-center', className)}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full max-h-[34rem] w-full max-w-3xl">
        <text x={leftX} y={PAD} className="fill-bad text-[13px] font-medium">
          Traditional
        </text>
        <text x={rightX} y={PAD} className="fill-good text-[13px] font-medium">
          SmartChunk
        </text>

        {BLOCKS.map((block, index) => {
          const top = (COLUMN.tops[index] ?? 0) * UNIT + PAD + 20
          const cut = CUTS[index] ?? null
          const w = block.w * UNIT
          const h = block.h * UNIT
          if (cut === null) {
            return (
              <rect
                key={`l-${index}`}
                x={leftX}
                y={top}
                width={w}
                height={h}
                rx={4}
                className={TYPE_FILL[block.type]}
              />
            )
          }
          const topH = cut * UNIT
          return (
            <g key={`l-${index}`}>
              <rect
                x={leftX - 3}
                y={top - 4}
                width={w}
                height={topH}
                rx={4}
                className={cn(TYPE_FILL[block.type], 'opacity-80')}
              />
              <rect
                x={leftX + 4}
                y={top + topH + 4}
                width={w}
                height={h - topH}
                rx={4}
                className={cn(TYPE_FILL[block.type], 'opacity-80')}
              />
              <line
                x1={leftX - 10}
                x2={leftX + docWidth + 10}
                y1={top + topH}
                y2={top + topH}
                className="stroke-bad"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            </g>
          )
        })}

        {bounds.map((section, index) => (
          <g key={SECTIONS[index]}>
            <rect
              x={rightX - 8}
              y={section.top * UNIT + PAD + 20 - 7}
              width={docWidth + 16}
              height={(section.bottom - section.top) * UNIT + 14}
              rx={8}
              className="fill-none stroke-good"
              strokeWidth={1.5}
            />
          </g>
        ))}
        {BLOCKS.map((block, index) => (
          <rect
            key={`r-${index}`}
            x={rightX}
            y={(GROUPED.tops[index] ?? 0) * UNIT + PAD + 20}
            width={block.w * UNIT}
            height={block.h * UNIT}
            rx={4}
            className={TYPE_FILL[block.type]}
          />
        ))}
      </svg>
    </div>
  )
}
