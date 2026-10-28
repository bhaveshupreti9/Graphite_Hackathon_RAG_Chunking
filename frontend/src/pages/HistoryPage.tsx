import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearDocHistory, getDocuments, getHistory, getProcessResult } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { ApiError } from '@/api/errors'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { RichText } from '@/components/RichText'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { formatDate, formatNumber } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { DocumentInfo } from '@/types/api'
import type { DocHistory, HistoryEntry } from '@/types/requests'

/** One row of the page: a document on this account plus its question history (maybe empty). */
interface Row {
  doc: DocumentInfo
  history: DocHistory
  lastActivity: string
}

const METHOD_LABEL: Record<HistoryEntry['method'], string> = {
  smart: 'SmartChunk chat',
  naive: 'Traditional chat',
  compare: 'Compared',
}

const METHOD_CLASS: Record<HistoryEntry['method'], string> = {
  smart: 'border-accent/50 text-accent',
  naive: 'border-naive/50 text-naive',
  compare: 'border-border text-fg/80',
}

const STATUS: Record<DocumentInfo['status'], { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'border-good/50 text-good' },
  processing: { label: 'Processing', className: 'border-accent/60 text-fg' },
  uploaded: { label: 'Not processed', className: 'border-border text-muted' },
  error: { label: 'Failed', className: 'border-bad/50 text-bad' },
}

const PREVIEW_CHARS = 220

/** A one-line, plain-text preview of a Markdown answer (tables become "a · b · c"). */
function preview(text: string): string {
  const flat = text
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
    .map((line) =>
      line.trim().startsWith('|')
        ? line
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim())
            .join(' · ')
        : line,
    )
    .join(' ')
    .replace(/```[a-z]*|`|\*\*|__|^#+\s/gi, '')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS - 1).trimEnd()}…`
}

function emptyHistory(doc: DocumentInfo): DocHistory {
  return {
    doc_id: doc.doc_id,
    filename: doc.filename,
    summary: '',
    summarized_questions: 0,
    counts: { questions: 0, smart: 0, naive: 0, compare: 0, not_found: 0 },
    recent: [],
    updated_at: null,
  }
}

function isSpreadsheet(filename: string): boolean {
  return /\.xlsx?m?$/i.test(filename)
}

const TH = 'whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-fg'
const TD = 'px-3 py-2 align-top'
const NUM = 'text-right tabular-nums'

function StatusBadge({ status }: { status: DocumentInfo['status'] }) {
  const info = STATUS[status]
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs',
        info.className,
      )}
    >
      {info.label}
    </span>
  )
}

function OverviewTable({
  rows,
  selected,
  onSelect,
}: {
  rows: Row[]
  selected: string | null
  onSelect: (docId: string) => void
}) {
  const questions = rows.reduce((sum, row) => sum + row.history.counts.questions, 0)
  const ready = rows.filter((row) => row.doc.status === 'ready').length
  const duplicateNames = new Set(
    rows.map((row) => row.doc.filename).filter((name, index, all) => all.indexOf(name) !== index),
  )
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-semibold">All your documents</h2>
        <p className="text-sm text-muted">
          {rows.length} document{rows.length === 1 ? '' : 's'} · {ready} ready ·{' '}
          {formatNumber(questions)} question{questions === 1 ? '' : 's'} asked
        </p>
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm leading-6">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className={TH}>
                Document
              </th>
              <th scope="col" className={TH}>
                Uploaded
              </th>
              <th scope="col" className={TH}>
                Status
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Chunks (Smart / Trad.)
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Questions
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Compared
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Not in document
              </th>
              <th scope="col" className={TH}>
                Last activity
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ doc, history, lastActivity }) => {
              const active = doc.doc_id === selected
              return (
                <tr
                  key={doc.doc_id}
                  className={cn(
                    'cursor-pointer border-b border-border/60 transition-colors last:border-0',
                    active ? 'bg-accent/[0.08]' : 'hover:bg-surface-2/60',
                  )}
                  onClick={() => onSelect(doc.doc_id)}
                >
                  <td className={TD}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelect(doc.doc_id)
                      }}
                      className={cn(
                        'max-w-[20rem] truncate text-left font-medium',
                        active ? 'text-accent' : 'text-fg hover:text-accent',
                      )}
                      title={doc.filename}
                    >
                      {doc.filename}
                    </button>
                    {duplicateNames.has(doc.filename) ? (
                      <span className="block font-mono text-xs text-muted">{doc.doc_id}</span>
                    ) : null}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap text-muted')}>
                    {formatDate(doc.created_at)}
                  </td>
                  <td className={TD}>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className={cn(TD, NUM)}>
                    {doc.smart_chunk_count === null || doc.naive_chunk_count === null
                      ? '—'
                      : `${formatNumber(doc.smart_chunk_count)} / ${formatNumber(doc.naive_chunk_count)}`}
                  </td>
                  <td className={cn(TD, NUM)}>{formatNumber(history.counts.questions)}</td>
                  <td className={cn(TD, NUM)}>{formatNumber(history.counts.compare)}</td>
                  <td className={cn(TD, NUM, 'text-muted')}>
                    {formatNumber(history.counts.not_found)}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap text-muted')}>
                    {formatDate(lastActivity)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AnswerCell({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false)
  const long =
    entry.answer.length > PREVIEW_CHARS || (entry.naive_answer?.length ?? 0) > PREVIEW_CHARS
  const show = (text: string) =>
    open ? <RichText text={text} className="text-sm leading-6" /> : <p>{preview(text)}</p>
  return (
    <div className="space-y-2">
      {entry.naive_answer !== null ? (
        <>
          <div>
            <p className="text-xs font-medium text-accent">SmartChunk</p>
            {show(entry.answer)}
          </div>
          <div>
            <p className="text-xs font-medium text-naive">Traditional</p>
            {show(entry.naive_answer)}
          </div>
        </>
      ) : (
        show(entry.answer)
      )}
      {long ? (
        <button
          type="button"
          className="text-xs font-medium text-accent hover:underline"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? 'Show less' : 'Show the full answer'}
        </button>
      ) : null}
    </div>
  )
}

function DocumentDetails({ doc }: { doc: DocumentInfo }) {
  const unit = isSpreadsheet(doc.filename) ? 'Sheets' : 'Pages'
  const facts: [string, string][] = [
    ['Uploaded', formatDate(doc.created_at)],
    [unit, formatNumber(doc.pages)],
    [
      'SmartChunk chunks',
      doc.smart_chunk_count === null ? '—' : formatNumber(doc.smart_chunk_count),
    ],
    [
      'Traditional chunks',
      doc.naive_chunk_count === null ? '—' : formatNumber(doc.naive_chunk_count),
    ],
  ]
  return (
    <div className="panel space-y-3 p-5">
      <h3 className="font-semibold">About this document</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular-nums text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {doc.summary_preview.trim() !== '' ? (
        <p className="text-sm leading-6 text-fg/80">{doc.summary_preview}</p>
      ) : null}
    </div>
  )
}

function SelectedDocument({
  row,
  onClear,
  onOpen,
  opening,
}: {
  row: Row
  onClear: () => void
  onOpen: () => void
  opening: boolean
}) {
  const { doc, history } = row
  const newestFirst = [...history.recent].reverse()
  const ready = doc.status === 'ready'
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="space-y-5"
      aria-label={`History for ${doc.filename}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted">Selected document</p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-2xl font-semibold" title={doc.filename}>
              {doc.filename}
            </h2>
            <StatusBadge status={doc.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={onOpen} disabled={opening}>
            {opening ? 'Opening…' : ready ? 'Continue chatting' : 'Process it'}
          </button>
          {history.counts.questions > 0 ? (
            <button type="button" className="btn btn-danger" onClick={onClear}>
              Clear history
            </button>
          ) : null}
        </div>
      </div>

      <DocumentDetails doc={doc} />

      {history.counts.questions === 0 ? (
        <div className="panel p-5 text-sm text-muted">
          {ready
            ? 'No questions asked about this document yet. Click Continue chatting to ask the first one.'
            : 'This document has not been processed yet. Process it to explore its chunks and chat with it.'}
        </div>
      ) : (
        <>
          <div className="panel space-y-2 p-5">
            <h3 className="font-semibold">Summary of earlier questions</h3>
            {history.summary.trim() !== '' ? (
              <>
                <RichText text={history.summary} className="text-sm leading-6 text-fg/85" />
                <p className="text-xs text-muted">
                  {formatNumber(history.summarized_questions)} older question
                  {history.summarized_questions === 1 ? ' was' : 's were'} folded into this summary
                  to keep the history small. Follow-up questions in chat still take it into account.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                Nothing summarised yet. After 12 questions, the oldest ones are folded into a short
                summary here, and only the most recent stay word for word.
              </p>
            )}
          </div>

          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="font-semibold">Recent questions</h3>
              <p className="text-sm text-muted">Newest first, kept word for word</p>
            </div>
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-sm leading-6">
                <thead className="bg-surface-2">
                  <tr>
                    <th scope="col" className={cn(TH, 'w-40')}>
                      Asked
                    </th>
                    <th scope="col" className={cn(TH, 'w-36')}>
                      Where
                    </th>
                    <th scope="col" className={cn(TH, 'w-64')}>
                      Question
                    </th>
                    <th scope="col" className={TH}>
                      Answer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {newestFirst.map((entry, index) => (
                    <tr
                      key={`${entry.asked_at}-${index}`}
                      className="border-b border-border/60 last:border-0 even:bg-surface-2/40"
                    >
                      <td className={cn(TD, 'whitespace-nowrap text-muted')}>
                        {formatDate(entry.asked_at)}
                      </td>
                      <td className={TD}>
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                            METHOD_CLASS[entry.method],
                          )}
                        >
                          {METHOD_LABEL[entry.method]}
                        </span>
                        {entry.not_found ? (
                          <span className="mt-1 block text-xs text-noise">Not in document</span>
                        ) : null}
                      </td>
                      <td className={cn(TD, 'font-medium text-fg')}>{entry.question}</td>
                      <td className={cn(TD, 'text-fg/85')}>
                        <AnswerCell entry={entry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.section>
  )
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const demoMode = useAppStore((state) => state.demoMode)
  const username = useAppStore((state) => state.auth?.username ?? null)
  const currentDoc = useAppStore((state) => state.doc_id)
  const selectDocument = useAppStore((state) => state.selectDocument)

  // Every document on the account (Knowledge Base) joined with its question history.
  const loader = useCallback(
    () =>
      Promise.all([getDocuments(), getHistory()]).then(([documents, histories]): Row[] => {
        const byDoc = new Map(histories.map((item) => [item.doc_id, item]))
        return documents
          .map((doc) => {
            const history = byDoc.get(doc.doc_id) ?? emptyHistory(doc)
            const lastActivity =
              history.updated_at && history.updated_at > doc.created_at
                ? history.updated_at
                : doc.created_at
            return { doc, history, lastActivity }
          })
          .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
      }),
    [demoMode, username], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const data = useAsync(loader)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Row | null>(null)
  const [clearing, setClearing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [actionError, setActionError] = useState<ApiError | null>(null)

  const rows = useMemo(() => data.data ?? [], [data.data])
  const active = rows.find((row) => row.doc.doc_id === selected) ?? null

  // Pick the open document (or the most recent one) once the list arrives.
  useEffect(() => {
    if (rows.length === 0) return
    if (selected && rows.some((row) => row.doc.doc_id === selected)) return
    setSelected(rows.find((row) => row.doc.doc_id === currentDoc)?.doc.doc_id ?? rows[0].doc.doc_id)
  }, [rows, selected, currentDoc])

  const clear = async () => {
    if (!confirming) return
    setClearing(true)
    setActionError(null)
    try {
      await clearDocHistory(confirming.doc.doc_id)
      setConfirming(null)
      data.reload()
    } catch (error) {
      setActionError(toApiError(error))
      setConfirming(null)
    } finally {
      setClearing(false)
    }
  }

  const open = async (row: Row) => {
    setActionError(null)
    if (row.doc.status !== 'ready') {
      selectDocument(row.doc.doc_id, row.doc.filename, null)
      navigate(ROUTES.upload)
      return
    }
    setOpening(true)
    try {
      const result = await getProcessResult(row.doc.doc_id)
      selectDocument(row.doc.doc_id, row.doc.filename, result)
      navigate(ROUTES.chatSmart)
    } catch (error) {
      setActionError(toApiError(error))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="History"
        description="Every document on your account and every question you asked about it. Recent questions stay word for word; older ones are folded into a short summary, so the history stays small however long you chat."
        actions={
          <button
            type="button"
            className="btn"
            onClick={data.reload}
            disabled={data.status === 'loading'}
          >
            Refresh
          </button>
        }
      />

      {actionError ? <ErrorState compact error={actionError} title="That action failed" /> : null}

      {data.status === 'loading' && !data.data ? (
        <LoadingState label="Loading your history…" />
      ) : null}
      {data.status === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} title="History didn’t load" />
      ) : null}

      {data.data && data.status !== 'error' ? (
        rows.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload a file or try a sample. Everything you upload and ask is kept here on your account."
            action={
              <Link to={ROUTES.upload} className="btn btn-primary">
                Upload a document
              </Link>
            }
          />
        ) : (
          <>
            <OverviewTable rows={rows} selected={selected} onSelect={setSelected} />
            <AnimatePresence mode="wait">
              {active ? (
                <SelectedDocument
                  key={active.doc.doc_id}
                  row={active}
                  opening={opening}
                  onOpen={() => void open(active)}
                  onClear={() => setConfirming(active)}
                />
              ) : null}
            </AnimatePresence>
          </>
        )
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        title="Clear this history?"
        description={`All saved questions and the summary for ${confirming?.doc.filename ?? 'this document'} will be deleted. The document itself stays.`}
        confirmLabel="Clear history"
        busy={clearing}
        onConfirm={() => void clear()}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
