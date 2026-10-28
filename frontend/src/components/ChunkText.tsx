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

/** True when every line is a heading or a table row, i.e. the chunk is one whole table. */
function isPureTable(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return (
    WHOLE_TABLE.test(text) &&
    lines.every((line) => /^\s{0,3}#{1,6}\s/.test(line) || line.trim().startsWith('|'))
  )
}

export function ChunkText({ text, type, className, clamp }: ChunkTextProps) {
  // In the full view, a table chunk that still has its header row is drawn as a real table.
  // Cut-up tables (no header) stay as raw text so the damage remains visible.
  if (type === 'table' && !clamp && isPureTable(text)) {
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
