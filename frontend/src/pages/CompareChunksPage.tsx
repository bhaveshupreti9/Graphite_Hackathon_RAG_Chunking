import { useCallback, useMemo, useState } from 'react'
import { getChunks, getProcessResult } from '@/api/client'
import { ChunkCard } from '@/components/ChunkCard'
import { DamageHighlight, IntegrityPill } from '@/components/DamageHighlight'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Expander } from '@/components/Expander'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { RemovedList } from '@/components/RemovedList'
import { MethodBadge } from '@/components/TypeBadge'
import { useAsync } from '@/hooks/useAsync'
import { useCountUp } from '@/hooks/useCountUp'
import { cn } from '@/lib/cn'
import { CHUNK_TYPES, CHUNK_TYPE_LABELS } from '@/lib/constants'
import { assessChunk, normalisedLines } from '@/lib/damage'
import { formatNumber, formatPage } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { Chunk, ChunkType, Method, MethodStats } from '@/types/api'

const COLUMN_LIMIT = 24

interface Metric {
  label: string
  value: (stats: MethodStats) => number
  /** "lower" = smaller is better (damage); "info" = no judgement. */
  better: 'lower' | 'higher' | 'info'
  digits?: number
}

const METRICS: Metric[] = [
  { label: 'Chunks', value: (s) => s.chunk_count, better: 'info' },
  { label: 'Average size (tokens)', value: (s) => s.avg_tokens, better: 'info', digits: 1 },
  { label: 'Code blocks cut', value: (s) => s.split_code_blocks, better: 'lower' },
  { label: 'Tables cut', value: (s) => s.split_tables, better: 'lower' },
  { label: 'Lists cut', value: (s) => s.split_lists, better: 'lower' },
  { label: 'Lonely headings', value: (s) => s.orphan_headings, better: 'lower' },
  {
    label: 'Repeats removed',
    value: (s) => s.exact_duplicates_removed + s.near_duplicates_removed,
    better: 'higher',
  },
  { label: 'Headers and footers removed', value: (s) => s.noise_lines_removed, better: 'higher' },
  { label: 'Labels per chunk', value: (s) => s.metadata_fields_present, better: 'higher' },
]

function MetricValue({
  value,
  digits = 0,
  tone,
}: {
  value: number
  digits?: number
  tone: 'good' | 'bad' | 'plain'
}) {
  const animated = useCountUp(value)
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-fg',
      )}
    >
      {formatNumber(animated, digits)}
    </span>
  )
}

function StatsBar({ naive, smart }: { naive: MethodStats; smart: MethodStats }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              Measure
            </th>
            {METRICS.map((metric) => (
              <th key={metric.label} scope="col" className="px-3 py-2.5 text-right font-medium">
                {metric.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['naive', naive],
              ['smart', smart],
            ] as const
          ).map(([method, stats]) => (
            <tr key={method} className="border-b border-border/60 last:border-0">
              <th scope="row" className="px-4 py-3 text-left">
                <MethodBadge method={method} />
              </th>
              {METRICS.map((metric) => {
                const mine = metric.value(stats)
                const theirs = metric.value(method === 'smart' ? naive : smart)
                let tone: 'good' | 'bad' | 'plain' = 'plain'
                if (metric.better === 'lower') tone = mine > 0 ? 'bad' : 'good'
                if (metric.better === 'higher' && mine !== theirs)
                  tone = mine > theirs ? 'good' : 'plain'
                return (
                  <td key={metric.label} className="px-3 py-3 text-right text-base font-semibold">
                    <MetricValue value={mine} digits={metric.digits} tone={tone} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface PassageMatch {
  pieces: { chunk: Chunk; covered: number }[]
  whole: boolean
  lineCount: number
}

/** Which naive chunks hold the lines of one SmartChunk block, and whether any holds all of them. */
function matchPassage(selected: Chunk, naive: Chunk[]): PassageMatch {
  const lines = normalisedLines(selected.text)
  const pieces = naive
    .map((chunk) => {
      const haystack = chunk.text.toLowerCase().replace(/\s+/g, ' ')
      const covered = lines.filter((line) => haystack.includes(line)).length
      return { chunk, covered }
    })
    .filter((item) => item.covered > 0)
  const whole = pieces.some((item) => item.covered === lines.length)
  return { pieces, whole, lineCount: lines.length }
}

function SamePassage({ smart, naive }: { smart: Chunk[]; naive: Chunk[] }) {
  const candidates = useMemo(
    () => smart.filter((chunk) => chunk.type === 'code' || chunk.type === 'table'),
    [smart],
  )
  // Open on the passage the traditional chunker damaged most, so the difference is visible at once.
  const worstId = useMemo(() => {
    let best: { id: string; score: number } | null = null
    for (const chunk of candidates) {
      const result = matchPassage(chunk, naive)
      const score = (result.whole ? 0 : 100) + result.pieces.length
      if (!best || score > best.score) best = { id: chunk.chunk_id, score }
    }
    return best?.id ?? ''
  }, [candidates, naive])
  const [selectedId, setSelectedId] = useState<string>(worstId)
  const selected = candidates.find((chunk) => chunk.chunk_id === selectedId) ?? candidates[0]

  const match = useMemo(() => (selected ? matchPassage(selected, naive) : null), [selected, naive])

  if (candidates.length === 0 || !selected || !match) {
    return (
      <EmptyState
        title="No code or tables in this document"
        description="The side-by-side view needs at least one code block or table to compare."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="passage" className="label shrink-0">
          Passage
        </label>
        <select
          id="passage"
          value={selected.chunk_id}
          onChange={(event) => setSelectedId(event.target.value)}
          className="input sm:max-w-md"
        >
          {candidates.map((chunk) => (
            <option key={chunk.chunk_id} value={chunk.chunk_id}>
              {CHUNK_TYPE_LABELS[chunk.type]}: {chunk.heading_path.join(' / ') || chunk.chunk_id} (
              {formatPage(chunk.page)})
            </option>
          ))}
        </select>
        <span className={cn('text-sm font-medium', match.whole ? 'text-good' : 'text-bad')}>
          {match.whole
            ? 'The traditional chunker happened to keep this one whole.'
            : match.pieces.length === 0
              ? 'Not found in any traditional chunk.'
              : `Split across ${match.pieces.length} traditional chunk${match.pieces.length === 1 ? '' : 's'}.`}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <MethodBadge method="naive" />
          {match.pieces.length === 0 ? (
            <p className="text-sm text-muted">
              None of this passage’s lines appear in a traditional chunk.
            </p>
          ) : (
            match.pieces.map(({ chunk, covered }) => {
              const intact = covered === match.lineCount
              return (
                <DamageHighlight
                  key={chunk.chunk_id}
                  status={intact ? 'intact' : 'damaged'}
                  reason={
                    intact
                      ? 'Contains the whole passage'
                      : `Holds ${covered} of ${match.lineCount} lines`
                  }
                >
                  <ChunkCard
                    chunk={chunk}
                    full
                    className="border-0 border-l-[3px] bg-transparent"
                  />
                </DamageHighlight>
              )
            })
          )}
        </div>
        <div className="space-y-3">
          <MethodBadge method="smart" />
          <DamageHighlight
            status="intact"
            reason={`One chunk, all ${match.lineCount} lines, with its heading path`}
          >
            <ChunkCard chunk={selected} full className="border-0 border-l-[3px] bg-transparent" />
          </DamageHighlight>
        </div>
      </div>
    </div>
  )
}

function ChunkColumn({ method, chunks }: { method: Method; chunks: Chunk[] }) {
  const [limit, setLimit] = useState(COLUMN_LIMIT)
  const assessed = useMemo(
    () => chunks.map((chunk) => ({ chunk, integrity: assessChunk(chunk, method) })),
    [chunks, method],
  )
  const damaged = assessed.filter((item) => item.integrity.status === 'damaged').length
  const intact = assessed.filter((item) => item.integrity.status === 'intact').length
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={method} />
        <span className="text-sm text-muted tabular-nums">{chunks.length} chunks</span>
        <span className="ml-auto flex gap-3 text-xs">
          <span className="text-good tabular-nums">{intact} intact</span>
          <span className="text-bad tabular-nums">{damaged} split</span>
        </span>
      </div>
      {assessed.length === 0 ? (
        <p className="panel p-4 text-sm text-muted">No chunks of this type.</p>
      ) : (
        assessed.slice(0, limit).map(({ chunk, integrity }) => (
          <DamageHighlight
            key={chunk.chunk_id}
            status={integrity.status}
            reason={integrity.status === 'neutral' ? undefined : integrity.reason}
          >
            <ChunkCard
              chunk={chunk}
              aside={<IntegrityPill status={integrity.status} title={integrity.reason} />}
              className="border-0 border-l-[3px] bg-transparent"
            />
          </DamageHighlight>
        ))
      )}
      {assessed.length > limit ? (
        <button
          type="button"
          className="btn w-full"
          onClick={() => setLimit((value) => value + COLUMN_LIMIT)}
        >
          Show {Math.min(COLUMN_LIMIT, assessed.length - limit)} more
        </button>
      ) : null}
    </div>
  )
}

export default function CompareChunksPage() {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const [type, setType] = useState<ChunkType | 'all'>('all')

  const loader = useCallback(async () => {
    const [result, smart, naive] = await Promise.all([
      getProcessResult(docId),
      getChunks({ doc_id: docId, method: 'smart', page: 1, page_size: 200 }),
      getChunks({ doc_id: docId, method: 'naive', page: 1, page_size: 200 }),
    ])
    return { result, smart: smart.items, naive: naive.items }
  }, [docId])
  const data = useAsync(loader)

  const filter = (chunks: Chunk[]) =>
    type === 'all' ? chunks : chunks.filter((chunk) => chunk.type === type)

  return (
    <div className="space-y-10">
      <PageHeader
        title="Chunking comparison"
        description="The same document chunked two ways. Green is structure kept whole, red is structure that was cut, grey is noise SmartChunk removed before chunking."
      />

      {data.status === 'loading' && !data.data ? (
        <LoadingState label="Loading both chunk sets…" />
      ) : null}
      {data.status === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} title="The comparison didn’t load" />
      ) : null}

      {data.data ? (
        <>
          <section aria-labelledby="stats" className="space-y-3">
            <h2 id="stats" className="text-xl font-semibold">
              What each method broke
            </h2>
            <StatsBar naive={data.data.result.naive_stats} smart={data.data.result.smart_stats} />
          </section>

          <section aria-labelledby="same-passage" className="panel space-y-4 p-5">
            <div>
              <h2 id="same-passage" className="text-xl font-semibold">
                Same passage, two outcomes
              </h2>
              <p className="text-sm text-muted">
                Pick a code block or table and see where each chunker put it.
              </p>
            </div>
            <SamePassage smart={data.data.smart} naive={data.data.naive} />
          </section>

          <section aria-labelledby="columns" className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h2 id="columns" className="text-xl font-semibold">
                All chunks
              </h2>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Filter by chunk type"
              >
                {(['all', ...CHUNK_TYPES] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={type === option}
                    onClick={() => setType(option)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm transition-colors',
                      type === option
                        ? 'border-accent bg-accent/15 text-fg'
                        : 'border-border text-muted hover:text-fg',
                    )}
                  >
                    {option === 'all' ? 'All types' : CHUNK_TYPE_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>

            <Expander
              label={
                <span className="flex items-center gap-2">
                  <IntegrityPill status="removed" />
                  Removed before chunking ({data.data.result.removed_report.items.length})
                </span>
              }
            >
              <RemovedList items={data.data.result.removed_report.items} />
            </Expander>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChunkColumn key={`naive-${type}`} method="naive" chunks={filter(data.data.naive)} />
              <ChunkColumn key={`smart-${type}`} method="smart" chunks={filter(data.data.smart)} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
