import { cn } from '@/lib/cn'

interface LoadingStateProps {
  label?: string
  compact?: boolean
}

/** A small stack of chunk blocks that fill in turn. */
export function LoadingState({ label = 'Loading…', compact = false }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-muted',
        compact ? 'py-6' : 'py-20',
      )}
    >
      <span aria-hidden="true" className="flex items-end gap-1">
        {['bg-type-prose', 'bg-type-code', 'bg-type-table', 'bg-type-list'].map((color, index) => (
          <span
            key={color}
            className={cn('w-2 animate-pulse rounded-[2px]', color)}
            style={{ height: `${10 + index * 4}px`, animationDelay: `${index * 150}ms` }}
          />
        ))}
      </span>
      <span className="text-sm">{label}</span>
    </div>
  )
}
