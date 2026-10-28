import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearDocHistory, getHistory, getProcessResult } from '@/api/client'
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
import type { DocHistory, HistoryEntry } from '@/types/requests'

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

const TH = 'whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-fg'
const TD = 'px-3 py-2 align-top'

function OverviewTable({
  items,
  selected,
  onSelect,
}: {
  items: DocHistory[]
  selected: string | null
  onSelect: (docId: string) => void
}) {
  const total = items.reduce(
    (sum, item) => ({
      questions: sum.questions + item.counts.questions,
      notFound: sum.notFound + item.counts.not_found,
    }),
    { questions: 0, notFound: 0 },
  )
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-semibold">Activity by document</h2>
        <p className="text-sm text-muted">
          {formatNumber(total.questions)} question{total.questions === 1 ? '' : 's'} across{' '}
          {items.length} document{items.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full border-collapse text-sm leading-6">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className={TH}>
                Document
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Questions
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                SmartChunk chat
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Traditional chat
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Compared
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Not in document
              </th>
              <th scope="col" className={TH}>
                Last question
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const active = item.doc_id === selected
              return (
                <tr
                  key={item.doc_id}
                  className={cn(
                    'cursor-pointer border-b border-border/60 transition-colors last:border-0',
                    active ? 'bg-accent/[0.08]' : 'hover:bg-surface-2/60',
                  )}
                  onClick={() => onSelect(item.doc_id)}
                >
                  <td className={TD}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelect(item.doc_id)
                      }}
                      className={cn(
                        'max-w-[22rem] truncate text-left font-medium',
                        active ? 'text-accent' : 'text-fg hover:text-accent',
                      )}
                      title={item.filename}
                    >
                      {item.filename}
                    </button>
                    {items.filter((other) => other.filename === item.filename).length > 1 ? (
                      <span className="block font-mono text-[11px] text-muted">{item.doc_id}</span>
                    ) : null}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    {formatNumber(item.counts.questions)}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    {formatNumber(item.counts.smart)}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    {formatNumber(item.counts.naive)}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums')}>
                    {formatNumber(item.counts.compare)}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums text-muted')}>
                    {formatNumber(item.counts.not_found)}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap text-muted')}>
                    {item.updated_at ? formatDate(item.updated_at) : '—'}
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

function DocumentHistory({
  item,
  onClear,
  onOpen,
  opening,
}: {
  item: DocHistory
  onClear: () => void
  onOpen: () => void
  opening: boolean
}) {
  const newestFirst = [...item.recent].reverse()
  return (
    <motion.section
      key={item.doc_id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="space-y-5"
      aria-label={`History for ${item.filename}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted">Selected document</p>
          <h2 className="truncate text-2xl font-semibold" title={item.filename}>
            {item.filename}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={onOpen} disabled={opening}>
            {opening ? 'Opening…' : 'Continue chatting'}
          </button>
          <button type="button" className="btn btn-danger" onClick={onClear}>
            Clear history
          </button>
        </div>
      </div>

      <div className="panel space-y-2 p-5">
        <h3 className="font-semibold">Summary of earlier questions</h3>
        {item.summary.trim() !== '' ? (
          <>
            <RichText text={item.summary} className="text-sm leading-6 text-fg/85" />
            <p className="text-xs text-muted">
              {formatNumber(item.summarized_questions)} older question
              {item.summarized_questions === 1 ? ' was' : 's were'} folded into this summary to keep
              the history small. Follow-up questions in chat still take it into account.
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
    </motion.section>
  )
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const demoMode = useAppStore((state) => state.demoMode)
  const currentDoc = useAppStore((state) => state.doc_id)
  const selectDocument = useAppStore((state) => state.selectDocument)
  const loader = useCallback(() => getHistory(), [demoMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const history = useAsync(loader)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<DocHistory | null>(null)
  const [clearing, setClearing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [actionError, setActionError] = useState<ApiError | null>(null)

  const items = useMemo(() => history.data ?? [], [history.data])
  const active = items.find((item) => item.doc_id === selected) ?? null

  // Pick the current document (or the most recent one) once the list arrives.
  useEffect(() => {
    if (items.length === 0) return
    if (selected && items.some((item) => item.doc_id === selected)) return
    setSelected(items.find((item) => item.doc_id === currentDoc)?.doc_id ?? items[0].doc_id)
  }, [items, selected, currentDoc])

  const clear = async () => {
    if (!confirming) return
    setClearing(true)
    setActionError(null)
    try {
      await clearDocHistory(confirming.doc_id)
      setConfirming(null)
      setSelected(null)
      history.reload()
    } catch (error) {
      setActionError(toApiError(error))
      setConfirming(null)
    } finally {
      setClearing(false)
    }
  }

  const open = async (item: DocHistory) => {
    setOpening(true)
    setActionError(null)
    try {
      const result = await getProcessResult(item.doc_id)
      selectDocument(item.doc_id, item.filename, result)
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
        description="Every question you asked, per document. Recent questions stay word for word; older ones are folded into a short summary, so the history stays small however long you chat."
        actions={
          <button
            type="button"
            className="btn"
            onClick={history.reload}
            disabled={history.status === 'loading'}
          >
            Refresh
          </button>
        }
      />

      {actionError ? <ErrorState compact error={actionError} title="That action failed" /> : null}

      {history.status === 'loading' && !history.data ? (
        <LoadingState label="Loading your history…" />
      ) : null}
      {history.status === 'error' ? (
        <ErrorState error={history.error} onRetry={history.reload} title="History didn’t load" />
      ) : null}

      {history.data && history.status !== 'error' ? (
        items.length === 0 ? (
          <EmptyState
            title="No questions yet"
            description="Ask something in SmartChunk chat, Traditional chat or Compare answers, and it will appear here."
            action={
              <>
                <Link to={ROUTES.chatSmart} className="btn btn-primary">
                  Start chatting
                </Link>
                <Link to={ROUTES.knowledge} className="btn">
                  Pick a document
                </Link>
              </>
            }
          />
        ) : (
          <>
            <OverviewTable items={items} selected={selected} onSelect={setSelected} />
            <AnimatePresence mode="wait">
              {active ? (
                <DocumentHistory
                  key={active.doc_id}
                  item={active}
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
        description={`All saved questions and the summary for ${confirming?.filename ?? 'this document'} will be deleted. The document itself stays.`}
        confirmLabel="Clear history"
        busy={clearing}
        onConfirm={() => void clear()}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
