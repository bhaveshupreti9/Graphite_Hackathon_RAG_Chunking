import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { CHUNK_TYPES, CHUNK_TYPE_DOT, CHUNK_TYPE_LABELS } from '@/lib/constants'
import type { MethodStats } from '@/types/api'

interface TypeDistributionProps {
  counts: MethodStats['type_counts']
  className?: string
}

/** Stacked bar of chunk types with a labelled legend (colour is never the only cue). */
export function TypeDistribution({ counts, className }: TypeDistributionProps) {
  const total = CHUNK_TYPES.reduce((sum, type) => sum + counts[type], 0)
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {total > 0
          ? CHUNK_TYPES.map((type) =>
              counts[type] > 0 ? (
                <motion.span
                  key={type}
                  title={`${CHUNK_TYPE_LABELS[type]}: ${counts[type]}`}
                  className={cn('h-full', CHUNK_TYPE_DOT[type])}
                  initial={{ width: 0 }}
                  animate={{ width: `${(counts[type] / total) * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              ) : null,
            )
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {CHUNK_TYPES.map((type) => (
          <li key={type} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 rounded-[2px]', CHUNK_TYPE_DOT[type])}
            />
            {CHUNK_TYPE_LABELS[type]}
            <span className="tabular-nums text-fg">{counts[type]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
