import { useCallback, useState } from 'react'
import { downloadChunks, getChunks } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { ApiError } from '@/api/errors'
import { Breadcrumb } from '@/components/Breadcrumb'
import { ChunkText } from '@/components/ChunkText'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { RemovedList } from '@/components/RemovedList'
import { MethodBadge, TypeBadge } from '@/components/TypeBadge'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { CHUNK_TYPES, CHUNK_TYPE_DOT, CHUNK_TYPE_LABELS, METHOD_LABELS } from '@/lib/constants'
import { saveBlob } from '@/lib/download'
import { formatNumber, formatPage, shortChunkId } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { Chunk, ChunkType, Method } from '@/types/api'

const PAGE_SIZE = 25

export default function ExplorerPage() {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const filename = useAppStore((state) => state.filename)
  const processResult = useAppStore((state) => state.processResult)
  const [method, setMethod] = useState<Method>('smart')
  const [type, setType] = useState<ChunkType | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Chunk | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<ApiError | null>(null)

  const loader = useCallback(
    () => getChunks({ doc_id: docId, method, type, page, page_size: PAGE_SIZE }),
    [docId, method, type, page],
  )
  const chunks = useAsync(loader)
  const totalPages = chunks.data
    ? Math.max(1, Math.ceil(chunks.data.total / chunks.data.page_size))
    : 1
  const stats = processResult
    ? method === 'smart'
      ? processResult.smart_stats
      : processResult.naive_stats
    : null

  const download = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      const file = await downloadChunks(docId, method)
      saveBlob(file.blob, file.filename)
    } catch (error) {
      setDownloadError(toApiError(error))
    } finally {
      setDownloading(false)
    }
  }

  const switchMethod = (next: Method) => {
    setMethod(next)
    setPage(1)
  }

  const switchType = (next: ChunkType | undefined) => {
    setType(next)
    setPage(1)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Chunk explorer"
        description={
          <>
            Every chunk produced from <span className="text-fg">{filename}</span>. Open a row to
            read the full text.
          </>
        }
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => void download()}
            disabled={downloading}
          >
            {downloading ? 'Preparing…' : `Download ${METHOD_LABELS[method]} JSONL`}
          </button>
        }
      />

      {downloadError ? (
        <ErrorState
          compact
          error={downloadError}
          title="Download failed"
          onRetry={() => void download()}
        />
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="tablist"
          aria-label="Chunking method"
          className="inline-flex rounded-[var(--radius-sm)] border border-border bg-surface p-1"
        >
          {(['smart', 'naive'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={method === option}
              onClick={() => switchMethod(option)}
              className={cn(
                'rounded-[calc(var(--radius-sm)-2px)] px-4 py-1.5 text-sm transition-colors',
                method === option ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {METHOD_LABELS[option]}
              {processResult ? (
                <span className="ml-2 tabular-nums text-muted">
                  {option === 'smart'
                    ? processResult.smart_stats.chunk_count
                    : processResult.naive_stats.chunk_count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by chunk type">
          <button
            type="button"
            aria-pressed={type === undefined}
            onClick={() => switchType(undefined)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              type === undefined
                ? 'border-accent bg-accent/15 text-fg'
                : 'border-border text-muted hover:text-fg',
            )}
          >
            All types
          </button>
          {CHUNK_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={type === option}
              onClick={() => switchType(option)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors',
                type === option
                  ? 'border-accent bg-accent/15 text-fg'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 rounded-[2px]', CHUNK_TYPE_DOT[option])}
              />
              {CHUNK_TYPE_LABELS[option]}
              {stats ? (
                <span className="tabular-nums text-muted">{stats.type_counts[option]}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <section aria-label="Chunks" className="min-w-0">
          {chunks.status === 'loading' && !chunks.data ? (
            <LoadingState label="Loading chunks…" />
          ) : null}
          {chunks.status === 'error' ? (
            <ErrorState error={chunks.error} onRetry={chunks.reload} title="Chunks didn’t load" />
          ) : null}
          {chunks.data && chunks.status !== 'error' ? (
            chunks.data.items.length === 0 ? (
              <EmptyState
                title={type ? `No ${CHUNK_TYPE_LABELS[type].toLowerCase()} chunks` : 'No chunks'}
                description={
                  type
                    ? `The ${METHOD_LABELS[method]} chunker produced no chunks of this type.`
                    : 'This document produced no chunks.'
                }
                action={
                  type ? (
                    <button type="button" className="btn" onClick={() => switchType(undefined)}>
                      Show all types
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div
                className={cn(
                  'panel overflow-hidden transition-opacity',
                  chunks.status === 'loading' && 'opacity-60',
                )}
              >
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="border-b border-border bg-surface-2/60 text-xs text-muted">
                    <tr>
                      <th scope="col" className="hidden w-28 px-3 py-2.5 font-medium sm:table-cell">
                        Chunk
                      </th>
                      <th scope="col" className="w-24 px-3 py-2.5 font-medium">
                        Type
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Section and preview
                      </th>
                      <th scope="col" className="hidden w-16 px-3 py-2.5 font-medium sm:table-cell">
                        Page
                      </th>
                      <th scope="col" className="w-20 px-3 py-2.5 text-right font-medium">
                        Tokens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunks.data.items.map((chunk) => (
                      <tr
                        key={chunk.chunk_id}
                        tabIndex={0}
                        onClick={() => setOpen(chunk)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setOpen(chunk)
                          }
                        }}
                        className="cursor-pointer border-b border-border/60 align-top transition-colors last:border-0 hover:bg-surface-2/50 focus-visible:bg-surface-2/60"
                      >
                        <td className="hidden px-3 py-3 font-mono text-xs text-muted sm:table-cell">
                          {shortChunkId(chunk.chunk_id)}
                        </td>
                        <td className="px-3 py-3">
                          <TypeBadge type={chunk.type} />
                        </td>
                        <td className="min-w-0 px-3 py-3">
                          <Breadcrumb
                            path={chunk.heading_path}
                            emptyLabel="No heading path (traditional chunk)"
                          />
                          <p className="mt-1 truncate text-fg/75">
                            {chunk.text.replace(/\s+/g, ' ')}
                          </p>
                        </td>
                        <td className="hidden px-3 py-3 text-muted sm:table-cell">
                          {formatPage(chunk.page)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatNumber(chunk.token_count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <footer className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-sm">
                  <span className="text-muted">
                    {formatNumber(chunks.data.total)} chunks, page {chunks.data.page} of{' '}
                    {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn px-3 py-1"
                      disabled={page <= 1 || chunks.status === 'loading'}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn px-3 py-1"
                      disabled={page >= totalPages || chunks.status === 'loading'}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Next
                    </button>
                  </div>
                </footer>
              </div>
            )
          ) : null}
        </section>

        <aside className="panel h-fit space-y-4 p-4">
          <div>
            <h2 className="text-lg font-semibold">Removed noise and duplicates</h2>
            <p className="text-sm text-muted">What SmartChunk dropped before chunking.</p>
          </div>
          <RemovedList items={processResult?.removed_report.items ?? []} limit={4} />
        </aside>
      </div>

      <Drawer
        open={open !== null}
        title={open ? shortChunkId(open.chunk_id) : ''}
        onClose={() => setOpen(null)}
      >
        {open ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={open.chunk_id.includes('_naive_') ? 'naive' : 'smart'} />
              <TypeBadge type={open.type} />
              <span className="chip">{formatPage(open.page)}</span>
              <span className="chip tabular-nums">{formatNumber(open.token_count)} tokens</span>
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Chunk ID</dt>
              <dd className="break-all font-mono text-xs">{open.chunk_id}</dd>
              <dt className="text-muted">Source</dt>
              <dd>{open.source}</dd>
              <dt className="text-muted">Heading path</dt>
              <dd>
                <Breadcrumb
                  path={open.heading_path}
                  emptyLabel="None (traditional chunks have no headings)"
                />
              </dd>
            </dl>
            <ChunkText text={open.text} type={open.type} />
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
