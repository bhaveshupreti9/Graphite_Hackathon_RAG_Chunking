import { RichText } from '@/components/RichText'
import { cn } from '@/lib/cn'
import type { ChunkType } from '@/types/api'

interface ChunkTextProps {
  text: string
  type: ChunkType
  className?: string
  /** Clamp to a number of lines (preview). Omit for full text. */
  clamp?: boolean
}

/** Chunk text: monospace and whitespace-preserving for code and tables, readable prose otherwise. */
// A complete Markdown table: a header row followed by a |---|---| separator row.
const WHOLE_TABLE = /^[^\n]*\|[^\n]*\n\s*\|?\s*:?-{2,}:?\s*\|/m

export function ChunkText({ text, type, className, clamp }: ChunkTextProps) {
  // In the full view, a table chunk that still has its header row is drawn as a real table.
  // Cut-up tables (no header) stay as raw text so the damage remains visible.
  if (type === 'table' && !clamp && WHOLE_TABLE.test(text)) {
    return (
      <RichText
        text={text}
        className={cn('text-sm leading-6 [&_p[role=heading]]:text-muted', className)}
      />
    )
  }
  const structural = type === 'code' || type === 'table'
  if (structural) {
    return (
      <pre
        className={cn(
          'code-block scrollbar-thin',
          clamp
            ? 'max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]'
            : '',
          className,
        )}
      >
        {text}
      </pre>
    )
  }
  return (
    <p
      className={cn(
        'whitespace-pre-wrap break-words text-sm leading-6 text-fg/90',
        clamp ? 'line-clamp-6' : '',
        className,
      )}
    >
      {text}
    </p>
  )
}
