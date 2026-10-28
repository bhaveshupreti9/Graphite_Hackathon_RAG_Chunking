import { CHUNK_TYPE_DOT, CHUNK_TYPE_LABELS, METHOD_LABELS } from '@/lib/constants'
import { cn } from '@/lib/cn'
import type { ChunkType, Method } from '@/types/api'

interface TypeBadgeProps {
  type: ChunkType
  className?: string
}

/** Chunk type: coloured square plus text label, so colour is never the only signal. */
export function TypeBadge({ type, className }: TypeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-fg',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('h-2 w-2 rounded-[2px]', CHUNK_TYPE_DOT[type])} />
      {CHUNK_TYPE_LABELS[type]}
    </span>
  )
}

interface MethodBadgeProps {
  method: Method
  className?: string
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        method === 'smart'
          ? 'border-accent/50 bg-accent/10 text-fg'
          : 'border-naive/50 bg-naive/10 text-fg',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', method === 'smart' ? 'bg-accent' : 'bg-naive')}
      />
      {METHOD_LABELS[method]}
    </span>
  )
}
