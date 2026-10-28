import { useState } from 'react'
import { cn } from '@/lib/cn'
import { formatPage } from '@/lib/format'
import type { RemovedItem } from '@/types/api'
import { EmptyState } from './EmptyState'

const KIND_LABELS: Record<RemovedItem['kind'], string> = {
  header: 'Header',
  footer: 'Footer',
  exact_duplicate: 'Exact duplicate',
  near_duplicate: 'Near duplicate',
}

const KINDS: RemovedItem['kind'][] = ['header', 'footer', 'exact_duplicate', 'near_duplicate']

interface RemovedListProps {
  items: RemovedItem[]
  /** Show at most this many before "Show all". */
  limit?: number
  className?: string
}

/** What SmartChunk removed as noise or duplicates (always grey: removed). */
export function RemovedList({ items, limit = 6, className }: RemovedListProps) {
  const [kind, setKind] = useState<RemovedItem['kind'] | 'all'>('all')
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing was removed"
        description="No repeated headers, footers or duplicate chunks were found in this document."
      />
    )
  }

  const filtered = kind === 'all' ? items : items.filter((item) => item.kind === kind)
  const visible = expanded ? filtered : filtered.slice(0, limit)

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter removed items">
        {(['all', ...KINDS] as const).map((option) => {
          const count =
            option === 'all' ? items.length : items.filter((item) => item.kind === option).length
          if (option !== 'all' && count === 0) return null
          return (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                kind === option
                  ? 'border-noise bg-noise/20 text-fg'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              {option === 'all' ? 'All' : KIND_LABELS[option]}{' '}
              <span className="tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>
      <ul className="space-y-2">
        {visible.map((item, index) => (
          <li
            key={`${item.kind}-${index}-${item.text.slice(0, 20)}`}
            className="rounded-[var(--radius-sm)] border border-noise/30 bg-noise/[0.06] p-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-noise">
              <span className="rounded-full border border-noise/40 px-2 py-0.5">
                {KIND_LABELS[item.kind]}
              </span>
              <span>{formatPage(item.page)}</span>
            </div>
            <p className="mt-1.5 text-sm text-fg/70 line-through decoration-noise/60">
              {item.text}
            </p>
            <p className="mt-1 text-xs text-muted">{item.reason}</p>
          </li>
        ))}
      </ul>
      {filtered.length > limit ? (
        <button
          type="button"
          className="text-sm text-accent hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show fewer' : `Show all ${filtered.length}`}
        </button>
      ) : null}
    </div>
  )
}
