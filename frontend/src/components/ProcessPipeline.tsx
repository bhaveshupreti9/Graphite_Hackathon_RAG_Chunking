import { motion } from 'framer-motion'
import { Suspense, lazy, useMemo } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useIsSmallScreen } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'
import { PROCESS_STEPS } from '@/lib/constants'
import { hasWebGL } from '@/lib/webgl'
import type { ProcessStep, ProcessingStatus } from '@/types/api'

const PipelineCanvas = lazy(() => import('@/three/PipelineCanvas'))

const STEP_HELP: Partial<Record<ProcessStep, string>> = {
  parsing: 'Reading the file and making the traditional chunks',
  cleaning: 'Removing page headers, footers and page numbers',
  semantic_split: 'Finding where the topic changes',
  dedup: 'Removing text that appears twice',
  embedding: 'Turning each chunk into numbers that capture its meaning',
  storing: 'Saving both sets of chunks to the search database',
  summarizing: 'Writing a summary and example questions',
}

interface ProcessPipelineProps {
  status: ProcessingStatus | null
}

/**
 * Pipeline driven by the real `step` and `progress`. The 3D view is decorative; the step list
 * below it carries the same information for screen readers, small screens and no-WebGL browsers.
 */
export function ProcessPipeline({ status }: ProcessPipelineProps) {
  const small = useIsSmallScreen()
  const webgl = useMemo(() => hasWebGL(), [])
  const step: ProcessStep = status?.step ?? 'uploaded'
  const progress = status?.progress ?? 0
  const state = status?.status ?? 'idle'
  const steps = PROCESS_STEPS.filter((item) => item.step !== 'uploaded' && item.step !== 'done')
  const activeIndex = steps.findIndex((item) => item.step === step)
  const done = state === 'done' || step === 'done'
  const show3D = webgl && !small

  return (
    <div className="space-y-5">
      {show3D ? (
        <div className="relative h-56 overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg/60">
          <ErrorBoundary label="pipeline scene" fallback={() => null}>
            <Suspense fallback={null}>
              <PipelineCanvas step={step} progress={progress} status={state} />
            </Suspense>
          </ErrorBoundary>
          <div className="pointer-events-none absolute left-4 top-3 text-sm text-muted">
            {done
              ? 'Finished'
              : state === 'error'
                ? 'Stopped'
                : state === 'running'
                  ? 'Running'
                  : 'Waiting'}
          </div>
          <div className="pointer-events-none absolute right-4 top-3 font-mono text-sm tabular-nums text-fg">
            {progress}%
          </div>
        </div>
      ) : null}

      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Processing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <motion.div
          className={cn(
            'h-full rounded-full',
            state === 'error' ? 'bg-bad' : done ? 'bg-good' : 'bg-accent',
          )}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {steps.map((item, index) => {
          const isActive = !done && index === activeIndex && state !== 'idle'
          const isDone = done || (activeIndex > -1 && index < activeIndex)
          const isError = isActive && state === 'error'
          return (
            <li
              key={item.step}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'rounded-[var(--radius-sm)] border p-2.5 text-sm transition-colors',
                isError
                  ? 'border-bad/60 bg-bad/10'
                  : isActive
                    ? 'border-accent bg-accent/10'
                    : isDone
                      ? 'border-good/40 bg-good/[0.05]'
                      : 'border-border bg-surface',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px]',
                    isError
                      ? 'bg-bad text-white'
                      : isActive
                        ? 'bg-accent'
                        : isDone
                          ? 'bg-good text-bg'
                          : 'bg-surface-2',
                  )}
                >
                  {isDone ? '✓' : isError ? '!' : null}
                  {isActive && !isError ? (
                    <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent" />
                  ) : null}
                </span>
                <span className={cn('font-medium', isActive || isDone ? 'text-fg' : 'text-muted')}>
                  {item.label}
                </span>
                <span className="sr-only">
                  {isError
                    ? '(failed)'
                    : isActive
                      ? '(in progress)'
                      : isDone
                        ? '(done)'
                        : '(waiting)'}
                </span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted">{STEP_HELP[item.step]}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
