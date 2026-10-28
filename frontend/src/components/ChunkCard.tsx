import { cn } from '@/lib/cn'
import { CHUNK_TYPE_BORDER } from '@/lib/constants'
import { formatNumber, formatPage, shortChunkId } from '@/lib/format'
import type { Chunk } from '@/types/api'
import { Breadcrumb } from './Breadcrumb'
import { ChunkText } from './ChunkText'
import { TypeBadge } from './TypeBadge'
import type { ReactNode } from 'react'

interface ChunkCardProps {
  chunk: Chunk
  /** Extra content in the header row (score, integrity pill...). */
  aside?: ReactNode
  /** Show the whole text instead of a clamped preview. */
  full?: boolean
  onOpen?: () => void
  className?: string
}

export function ChunkCard({ chunk, aside, full = false, onOpen, className }: ChunkCardProps) {
  return (
    <article
      className={cn(
        'space-y-2 rounded-[var(--radius-sm)] border border-border border-l-[3px] bg-surface p-3',
        CHUNK_TYPE_BORDER[chunk.type],
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <TypeBadge type={chunk.type} />
        <span className="font-mono text-xs text-muted">{shortChunkId(chunk.chunk_id)}</span>
        <span className="text-xs text-muted">{formatPage(chunk.page)}</span>
        <span className="text-xs text-muted tabular-nums">
          {formatNumber(chunk.token_count)} tok
        </span>
        {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
      </header>
      <Breadcrumb path={chunk.heading_path} />
      <ChunkText text={chunk.text} type={chunk.type} clamp={!full} />
      {onOpen ? (
        <button type="button" onClick={onOpen} className="text-xs text-accent hover:underline">
          Open full chunk
        </button>
      ) : null}
    </article>
  )
}
