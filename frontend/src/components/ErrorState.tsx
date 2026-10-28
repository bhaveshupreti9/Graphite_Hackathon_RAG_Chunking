import { motion } from 'framer-motion'
import { toApiError } from '@/api/errors'
import { cn } from '@/lib/cn'

interface ErrorStateProps {
  /** Anything that was thrown. ApiError codes are mapped to friendly text. */
  error: unknown
  /** Shows a Retry button when provided. */
  onRetry?: () => void
  title?: string
  /** Smaller inline version for use inside a panel. */
  compact?: boolean
}

export function ErrorState({
  error,
  onRetry,
  title = 'That didn’t work',
  compact = false,
}: ErrorStateProps) {
  const apiError = toApiError(error)
  // For provider and server errors the server's own message says exactly what to fix.
  const detail =
    ['LLM_ERROR', 'INTERNAL_ERROR', 'VALIDATION_ERROR'].includes(apiError.code) &&
    apiError.message.trim() !== '' &&
    apiError.message !== apiError.userMessage
      ? apiError.message
      : null
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      role="alert"
      className={cn(
        'flex rounded-[var(--radius-md)] border border-bad/40 bg-bad/[0.06]',
        compact
          ? 'flex-row items-start gap-3 p-3 text-left'
          : 'flex-col items-center gap-3 px-6 py-12 text-center',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border border-bad/50 font-semibold text-bad',
          compact ? 'h-6 w-6 text-xs' : 'h-11 w-11',
        )}
      >
        !
      </span>
      <div className={cn('space-y-1', compact ? 'flex-1' : 'max-w-md')}>
        <h2 className={cn('font-semibold', compact ? 'text-sm' : 'text-lg')}>{title}</h2>
        <p className="text-sm text-muted">{apiError.userMessage}</p>
        {detail ? (
          <p className="break-words rounded-[var(--radius-sm)] border border-bad/20 bg-bg/60 px-2.5 py-1.5 text-xs leading-5 text-fg/80">
            {detail}
          </p>
        ) : null}
        <p className="font-mono text-xs text-muted">{apiError.code}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          className={cn('btn', compact ? 'px-3 py-1' : 'btn-primary mt-1')}
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </motion.div>
  )
}
