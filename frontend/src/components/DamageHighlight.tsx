import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { Integrity } from '@/lib/damage'

export type HighlightStatus = Integrity | 'removed'

const FRAME: Record<HighlightStatus, string> = {
  intact: 'border-good/45 bg-good/[0.04]',
  damaged: 'border-bad/60 bg-bad/[0.06]',
  removed: 'border-noise/40 bg-noise/[0.06] opacity-80',
  neutral: 'border-border bg-surface',
}

const PILL: Record<HighlightStatus, { text: string; className: string; icon: string }> = {
  intact: { text: 'Intact', className: 'text-good border-good/40', icon: '✓' },
  damaged: { text: 'Split', className: 'text-bad border-bad/50', icon: '✕' },
  removed: { text: 'Removed', className: 'text-noise border-noise/40', icon: '−' },
  neutral: { text: 'Prose', className: 'text-muted border-border', icon: '·' },
}

export function IntegrityPill({ status, title }: { status: HighlightStatus; title?: string }) {
  const pill = PILL[status]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border bg-bg/60 px-2 py-0.5 text-xs font-medium',
        pill.className,
      )}
    >
      <span aria-hidden="true">{pill.icon}</span>
      {pill.text}
    </span>
  )
}

interface DamageHighlightProps {
  status: HighlightStatus
  reason?: string
  children: ReactNode
  className?: string
}

/** Frames content green (intact), red (split), grey (removed noise) or plain (prose). */
export function DamageHighlight({ status, reason, children, className }: DamageHighlightProps) {
  return (
    <div className={cn('rounded-[var(--radius-sm)] border', FRAME[status], className)}>
      {children}
      {reason && status !== 'neutral' ? (
        <p
          className={cn(
            'border-t px-3 py-1.5 text-xs',
            status === 'damaged'
              ? 'border-bad/30 text-bad'
              : status === 'intact'
                ? 'border-good/25 text-good'
                : 'border-noise/30 text-noise',
          )}
        >
          {reason}
        </p>
      ) : null}
    </div>
  )
}
