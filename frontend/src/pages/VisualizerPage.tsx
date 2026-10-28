import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Link } from 'react-router-dom'
import { getChunks } from '@/api/client'
import { Breadcrumb } from '@/components/Breadcrumb'
import { ChunkCard } from '@/components/ChunkCard'
import { DamageHighlight } from '@/components/DamageHighlight'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { MethodBadge, TypeBadge } from '@/components/TypeBadge'
import { useAsync } from '@/hooks/useAsync'
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { buildVizModel, MAX_BLOCKS } from '@/lib/chunkGeometry'
import type { VizModel } from '@/lib/chunkGeometry'
import { cn } from '@/lib/cn'
import { CHUNK_TYPES, CHUNK_TYPE_DOT, CHUNK_TYPE_LABELS, ROUTES } from '@/lib/constants'
import { formatPage, shortChunkId } from '@/lib/format'
import { hasWebGL } from '@/lib/webgl'
import { useAppStore } from '@/store/useAppStore'
import type { VizHover, VizView } from '@/three/ChunkVisualizerScene'
import { VisualizerFallback } from '@/three/VisualizerFallback'

const ChunkVisualizerCanvas = lazy(() => import('@/three/ChunkVisualizerCanvas'))

const DURATION_MS = 14_000

interface Step {
  label: string
  at: number
  description: string
}

const STEPS: readonly Step[] = [
  {
    label: 'The document',
    at: 0,
    description:
      'Every block is a piece of the document in reading order, coloured by type. Grey slabs are repeated headers, footers and duplicates.',
  },
  {
    label: 'Cutting and cleaning',
    at: 0.06,
    description:
      'Left: the traditional blade cuts every N tokens wherever it lands. Red means it broke a block. Right: SmartChunk throws the grey noise out.',
  },
  {
    label: 'Chunking',
    at: 0.5,
    description:
      'Both sets separate into chunks. Traditional splits at every cut. SmartChunk keeps each block whole and groups blocks by section (green frames).',
  },
  {
    label: 'Result',
    at: 0.9,
    description:
      'The final chunks. Drag to rotate, scroll to zoom, click any block to read both versions of it.',
  },
]

function stepAt(progress: number): number {
  let index = 0
  STEPS.forEach((step, i) => {
    if (progress >= step.at) index = i
  })
  return index
}

interface TimelineProps {
  progressRef: MutableRefObject<number>
  playing: boolean
  speed: number
  onPlayingChange: (playing: boolean) => void
}

/** Owns the animation clock so only this small component re-renders every frame. */
function Timeline({ progressRef, playing, speed, onPlayingChange }: TimelineProps) {
  const [shown, setShown] = useState(progressRef.current)

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (playing) {
        const next = Math.min(1, progressRef.current + (dt / DURATION_MS) * speed)
        progressRef.current = next
        if (next >= 1) onPlayingChange(false)
      }
      setShown((previous) =>
        Math.abs(previous - progressRef.current) > 0.001 ? progressRef.current : previous,
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, progressRef, onPlayingChange])

  const current = stepAt(shown)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(shown * 1000)}
          aria-label="Animation position"
          onChange={(event) => {
            onPlayingChange(false)
            progressRef.current = Number(event.target.value) / 1000
            setShown(progressRef.current)
          }}
          className="h-1.5 flex-1 cursor-pointer accent-[rgb(var(--c-accent))]"
        />
        <span className="w-12 text-right font-mono text-xs tabular-nums text-muted">
          {Math.round(shown * 100)}%
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.label}>
            <button
              type="button"
              aria-current={index === current ? 'step' : undefined}
              onClick={() => {
                onPlayingChange(false)
                progressRef.current = index === STEPS.length - 1 ? 1 : step.at + 0.001
                setShown(progressRef.current)
              }}
              className={cn(
                'h-full w-full rounded-[var(--radius-sm)] border px-3 py-2 text-left text-sm transition-colors',
                index === current
                  ? 'border-accent bg-accent/10 text-fg'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              <span className="font-medium">
                {index + 1}. {step.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="min-h-[3rem] text-sm leading-6 text-fg/80" aria-live="polite">
        {STEPS[current]?.description}
      </p>
    </div>
  )
}

function HoverCard({
  hover,
  model,
  container,
}: {
  hover: VizHover
  model: VizModel
  container: HTMLDivElement | null
}) {
  const rect = container?.getBoundingClientRect()
  if (!rect) return null
  const left = Math.min(rect.width - 260, Math.max(8, hover.clientX - rect.left + 14))
  const top = Math.min(rect.height - 120, Math.max(8, hover.clientY - rect.top + 14))
  const block = hover.block === null ? undefined : model.blocks[hover.block]
  const noise = hover.noise === null ? undefined : model.noise[hover.noise]
  return (
    <div
      className="pointer-events-none absolute z-10 w-60 space-y-1.5 rounded-[var(--radius-sm)] border border-border bg-bg/95 p-3 text-xs shadow-2xl backdrop-blur"
      style={{ left, top }}
    >
      {block ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <MethodBadge method={hover.method} />
            <TypeBadge type={block.chunk.type} />
          </div>
          <Breadcrumb path={block.chunk.heading_path} />
          <p className="text-muted">
            {formatPage(block.chunk.page)}
            {hover.naiveIndex !== null ? `, in traditional chunk #${hover.naiveIndex}` : ''}
          </p>
          {hover.method === 'naive' ? (
            <p
              className={
                block.split ? 'text-bad' : block.rescuedByOverlap ? 'text-fg' : 'text-good'
              }
            >
              {block.split
                ? `Broken by ${block.cuts.length} cut${block.cuts.length === 1 ? '' : 's'}`
                : block.rescuedByOverlap
                  ? 'Cut, but the overlap kept one full copy'
                  : 'Not cut'}
            </p>
          ) : (
            <p className="text-good">Kept whole</p>
          )}
          <p className="text-muted">Click to read it</p>
        </>
      ) : noise ? (
        <>
          <p className="font-medium text-noise">Removed noise</p>
          <p className="line-clamp-2 text-fg/80">{noise.item.text}</p>
          <p className="text-muted">{noise.item.reason}</p>
        </>
      ) : null}
    </div>
  )
}

function SelectedBlock({
  model,
  index,
  onClose,
}: {
  model: VizModel
  index: number
  onClose: () => void
}) {
  const block = model.blocks[index]
  if (!block) return null
  const pieces = model.naive.filter((item) => item.start < block.end && item.end > block.start)
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Block {index + 1}</h2>
          <p className="text-sm text-muted">{shortChunkId(block.chunk.chunk_id)}</p>
        </div>
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <p className={cn('text-sm font-medium', block.split ? 'text-bad' : 'text-good')}>
        {block.split
          ? `The traditional chunker broke this ${block.chunk.type} block across ${pieces.length} chunks.`
          : block.rescuedByOverlap
            ? 'A cut went through this block, but the overlap kept one complete copy.'
            : pieces.length > 1
              ? 'Split only at its edges, so the text stayed whole.'
              : 'The traditional chunker kept this block in one chunk.'}
      </p>
      <div className="space-y-2">
        <MethodBadge method="smart" />
        <DamageHighlight status="intact" reason="One chunk, with its heading path">
          <ChunkCard chunk={block.chunk} full className="border-0 border-l-[3px] bg-transparent" />
        </DamageHighlight>
      </div>
      <div className="space-y-2">
        <MethodBadge method="naive" />
        {pieces.length === 0 ? (
          <p className="text-sm text-muted">No traditional chunk was matched to this block.</p>
        ) : (
          pieces.map((item) => (
            <DamageHighlight
              key={item.chunk.chunk_id}
              status={block.split ? 'damaged' : 'neutral'}
              reason={item.matched ? undefined : 'Position estimated from token counts'}
            >
              <ChunkCard chunk={item.chunk} className="border-0 border-l-[3px] bg-transparent" />
            </DamageHighlight>
          ))
        )}
      </div>
    </div>
  )
}

const VIEWS: { value: VizView; label: string }[] = [
  { value: 'both', label: 'Side by side' },
  { value: 'naive', label: 'Traditional' },
  { value: 'smart', label: 'SmartChunk' },
]

export default function VisualizerPage() {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const filename = useAppStore((state) => state.filename)
  const removed = useAppStore((state) => state.processResult?.removed_report.items)
  const reduced = usePrefersReducedMotion()
  const webgl = useMemo(() => hasWebGL(), [])

  const loader = useCallback(async () => {
    const [smart, naive] = await Promise.all([
      getChunks({ doc_id: docId, method: 'smart', page: 1, page_size: 200 }),
      getChunks({ doc_id: docId, method: 'naive', page: 1, page_size: 200 }),
    ])
    return { smart, naive }
  }, [docId])
  const data = useAsync(loader)

  const model = useMemo(
    () =>
      data.data ? buildVizModel(data.data.smart.items, data.data.naive.items, removed ?? []) : null,
    [data.data, removed],
  )

  const progressRef = useRef(reduced ? 1 : 0)
  const [playing, setPlaying] = useState(!reduced)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState<VizView>('both')
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<VizHover | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const replay = () => {
    progressRef.current = 0
    setPlaying(true)
  }

  const togglePlay = () => {
    if (progressRef.current >= 1) progressRef.current = 0
    setPlaying((value) => !value)
  }

  const brokenBlocks = model ? model.blocks.filter((block) => block.split) : []
  const naiveTotal = data.data?.naive.total ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chunking visualiser"
        description={
          <>
            Watch <span className="text-fg">{filename}</span> being cut into chunks by both methods.
            Every block is a real chunk from this document.
          </>
        }
        actions={
          <Link to={ROUTES.compareChunks} className="btn">
            Chunk-by-chunk comparison
          </Link>
        }
      />

      {data.status === 'loading' && !data.data ? (
        <LoadingState label="Loading both chunk sets…" />
      ) : null}
      {data.status === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} title="The chunks didn’t load" />
      ) : null}

      {model && model.blocks.length === 0 ? (
        <EmptyState
          title="This document has no chunks"
          description="Process a document with some text in it, then come back."
          action={
            <Link to={ROUTES.upload} className="btn btn-primary">
              Upload a document
            </Link>
          }
        />
      ) : null}

      {model && model.blocks.length > 0 ? (
        <>
          <div className="panel space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary min-w-24" onClick={togglePlay}>
                {playing ? 'Pause' : progressRef.current >= 1 ? 'Play again' : 'Play'}
              </button>
              <button type="button" className="btn" onClick={replay}>
                Restart
              </button>
              <label className="ml-1 flex items-center gap-2 text-sm text-muted">
                Speed
                <select
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                  className="input w-auto py-1"
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                </select>
              </label>
              <div
                role="group"
                aria-label="Which method to show"
                className="ml-auto inline-flex rounded-[var(--radius-sm)] border border-border p-0.5"
              >
                {VIEWS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={view === option.value}
                    onClick={() => setView(option.value)}
                    className={cn(
                      'rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-sm',
                      view === option.value ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <Timeline
              progressRef={progressRef}
              playing={playing}
              speed={speed}
              onPlayingChange={setPlaying}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
            <div
              ref={containerRef}
              className="relative h-[70vh] min-h-[28rem] overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg"
            >
              {webgl ? (
                <ErrorBoundary
                  label="visualiser"
                  fallback={() => (
                    <VisualizerFallback
                      model={model}
                      view={view}
                      selectedBlock={selected}
                      onSelect={setSelected}
                    />
                  )}
                >
                  <Suspense fallback={<LoadingState label="Loading the 3D view…" />}>
                    <ChunkVisualizerCanvas
                      model={model}
                      progressRef={progressRef}
                      view={view}
                      reduced={reduced}
                      selectedBlock={selected}
                      onHover={setHover}
                      onSelect={setSelected}
                    />
                  </Suspense>
                </ErrorBoundary>
              ) : (
                <VisualizerFallback
                  model={model}
                  view={view}
                  selectedBlock={selected}
                  onSelect={setSelected}
                />
              )}
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-around gap-2 bg-gradient-to-b from-bg via-bg/80 to-transparent px-3 pb-6 pt-3">
                {view !== 'smart' ? (
                  <span className="rounded-full border border-naive/60 bg-bg/85 px-3 py-1 text-sm font-medium">
                    Traditional: {model.stats.naiveCount} chunks
                  </span>
                ) : null}
                {view !== 'naive' ? (
                  <span className="rounded-full border border-accent/70 bg-bg/85 px-3 py-1 text-sm font-medium">
                    SmartChunk: {model.stats.smartCount} chunks
                  </span>
                ) : null}
              </div>
              {hover ? (
                <HoverCard hover={hover} model={model} container={containerRef.current} />
              ) : null}
              <ul className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-[var(--radius-sm)] bg-bg/80 px-3 py-2 text-xs text-muted backdrop-blur">
                {CHUNK_TYPES.map((type) => (
                  <li key={type} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn('h-2 w-2 rounded-[2px]', CHUNK_TYPE_DOT[type])}
                    />
                    {CHUNK_TYPE_LABELS[type]}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-bad" />
                  Broken block
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-0.5 w-3 bg-fg" />
                  Cut, copy kept by overlap
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-noise" />
                  Noise
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-3 rounded-[2px] border border-good" />
                  Section group
                </li>
              </ul>
            </div>

            <aside className="panel h-fit space-y-5 p-5 xl:sticky xl:top-24">
              {selected !== null ? (
                <SelectedBlock model={model} index={selected} onClose={() => setSelected(null)} />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard
                      label="Cuts made by the traditional method"
                      value={model.stats.cutsTotal}
                    />
                    <StatCard
                      label="Cuts that landed inside a block"
                      value={model.stats.cutsInsideBlocks}
                      tone={model.stats.cutsInsideBlocks > 0 ? 'bad' : 'good'}
                    />
                    <StatCard
                      label="Code, tables and lists broken"
                      value={model.stats.splitStructuralBlocks}
                      suffix={`of ${model.stats.structuralBlocks}`}
                      tone={model.stats.splitStructuralBlocks > 0 ? 'bad' : 'good'}
                    />
                    <StatCard
                      label="Junk lines SmartChunk threw away"
                      value={model.stats.noiseCount}
                      tone={model.stats.noiseCount > 0 ? 'noise' : 'neutral'}
                    />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-sm font-semibold">Broken by the traditional chunker</h2>
                    <ul className="space-y-1.5 text-sm">
                      {CHUNK_TYPES.map((type) => (
                        <li key={type} className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn('h-2 w-2 rounded-[2px]', CHUNK_TYPE_DOT[type])}
                          />
                          {CHUNK_TYPE_LABELS[type]}
                          <span className="ml-auto tabular-nums">
                            <span
                              className={
                                model.stats.splitByType[type] > 0 ? 'text-bad' : 'text-good'
                              }
                            >
                              {model.stats.splitByType[type]}
                            </span>
                            <span className="text-muted"> of {model.stats.blocksByType[type]}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted">
                      SmartChunk breaks none: each block is one chunk.
                    </p>
                  </div>
                  {model.stats.matchedShare < 0.9 || model.truncated || naiveTotal > 200 ? (
                    <div className="space-y-1 rounded-[var(--radius-sm)] border border-border p-3 text-xs text-muted">
                      {model.stats.matchedShare < 0.9 ? (
                        <p>
                          {Math.round((1 - model.stats.matchedShare) * 100)}% of cut positions were
                          estimated from token counts because their text could not be matched.
                        </p>
                      ) : null}
                      {model.truncated || naiveTotal > 200 ? (
                        <p>
                          Long document: showing the first {MAX_BLOCKS} SmartChunk chunks and 200
                          traditional chunks.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-sm text-muted">
                    Click any block in the view to read both versions of it.
                  </p>
                </>
              )}
            </aside>
          </div>

          <section aria-labelledby="broken-list" className="space-y-3">
            <h2 id="broken-list" className="text-xl font-semibold">
              Blocks the traditional chunker broke
            </h2>
            {brokenBlocks.length === 0 ? (
              <p className="panel p-4 text-sm text-good">
                None. Every block survived in at least one traditional chunk for this document.
              </p>
            ) : (
              <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {brokenBlocks.map((block) => (
                  <li key={block.index}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(block.index)
                        containerRef.current?.scrollIntoView({
                          behavior: reduced ? 'auto' : 'smooth',
                          block: 'center',
                        })
                      }}
                      className={cn(
                        'w-full rounded-[var(--radius-sm)] border bg-surface p-3 text-left transition-colors hover:border-bad',
                        selected === block.index ? 'border-bad' : 'border-bad/40',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <TypeBadge type={block.chunk.type} />
                        <span className="text-xs text-muted">{formatPage(block.chunk.page)}</span>
                        <span className="ml-auto text-xs text-bad">
                          {block.cuts.length} cut{block.cuts.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <Breadcrumb className="mt-2" path={block.chunk.heading_path} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
