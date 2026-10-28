import { useCountUp } from '@/hooks/useCountUp'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'

export type StatTone = 'neutral' | 'good' | 'bad' | 'noise'

interface StatCardProps {
  label: string
  value: number
  digits?: number
  suffix?: string
  tone?: StatTone
  hint?: string
  className?: string
}

const TONE: Record<StatTone, string> = {
  neutral: 'border-border',
  good: 'border-good/40',
  bad: 'border-bad/50',
  noise: 'border-noise/40',
}

const TONE_MARK: Record<StatTone, string> = {
  neutral: 'bg-border',
  good: 'bg-good',
  bad: 'bg-bad',
  noise: 'bg-noise',
}

/** A labelled number that counts up when it appears or changes. */
export function StatCard({
  label,
  value,
  digits = 0,
  suffix,
  tone = 'neutral',
  hint,
  className,
}: StatCardProps) {
  const animated = useCountUp(value)
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-sm)] border bg-bg/60 p-3',
        TONE[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_MARK[tone])}
      />
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        <span aria-hidden="true">{formatNumber(animated, digits)}</span>
        <span className="sr-only">{formatNumber(value, digits)}</span>
        {suffix ? <span className="ml-1 text-sm font-normal text-muted">{suffix}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
