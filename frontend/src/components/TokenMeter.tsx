import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'

interface TokenMeterProps {
  tokens: { prompt: number; completion: number; total: number }
  limit: number
  className?: string
}

/** How much of the model's context window this answer used (prompt + completion). */
export function TokenMeter({ tokens, limit, className }: TokenMeterProps) {
  const safeLimit = limit > 0 ? limit : 1
  const promptShare = Math.min(1, tokens.prompt / safeLimit)
  const completionShare = Math.min(1 - promptShare, tokens.completion / safeLimit)
  const used = tokens.total / safeLimit
  const tone = used > 0.9 ? 'bg-bad' : used > 0.7 ? 'bg-type-code' : 'bg-accent'

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted">AI reading limit used</span>
        <span className="tabular-nums text-fg">
          {formatNumber(tokens.total)}
          <span className="text-muted"> / {formatNumber(limit)} tokens</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="Context window used"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={tokens.total}
        className="flex h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <motion.span
          className={cn('h-full', tone)}
          initial={{ width: 0 }}
          animate={{ width: `${promptShare * 100}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
        <motion.span
          className={cn('h-full opacity-50', tone)}
          initial={{ width: 0 }}
          animate={{ width: `${completionShare * 100}%` }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: 0.2 }}
        />
      </div>
      <p className="text-xs text-muted tabular-nums">
        {formatNumber(tokens.prompt)} read, {formatNumber(tokens.completion)} written
      </p>
    </div>
  )
}
