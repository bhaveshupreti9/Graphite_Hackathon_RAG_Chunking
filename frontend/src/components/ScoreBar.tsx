import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'

interface ScoreBarProps {
  score: number
  /** Scores below this are drawn in the "not found" grey. */
  threshold?: number
  className?: string
}

/** Cosine similarity (0..1) of one retrieved chunk. */
export function ScoreBar({ score, threshold, className }: ScoreBarProps) {
  const clamped = Math.max(0, Math.min(1, score))
  const below = threshold !== undefined && clamped < threshold
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label="Similarity score"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamped}
      >
        <motion.span
          className={cn('absolute inset-y-0 left-0 rounded-full', below ? 'bg-noise' : 'bg-accent')}
          initial={{ width: 0 }}
          animate={{ width: `${clamped * 100}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        {threshold !== undefined ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-fg/60"
            style={{ left: `${threshold * 100}%` }}
          />
        ) : null}
      </div>
      <span className="w-10 text-right font-mono text-xs tabular-nums text-fg">
        {clamped.toFixed(2)}
      </span>
    </div>
  )
}
