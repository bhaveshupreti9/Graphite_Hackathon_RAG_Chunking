import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { compare } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { ApiError } from '@/api/errors'
import { AnswerDetails } from '@/components/chat/AnswerDetails'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { AnswerText } from '@/components/AnswerText'
import { MethodBadge } from '@/components/TypeBadge'
import { recallCompare, rememberCompare } from '@/lib/chatCache'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'
import type { ChatResult, ChatTurn, Method, QAItem } from '@/types/api'

const WINNER_OPTIONS: { value: QAItem['winner']; label: string }[] = [
  { value: 'smart', label: 'SmartChunk is better' },
  { value: 'tie', label: 'Tie' },
  { value: 'naive', label: 'Traditional is better' },
]

function AnswerColumn({
  method,
  answer,
  result,
  question,
  threshold,
  highlighted,
}: {
  method: Method
  answer: string
  result: ChatResult | undefined
  question: string
  threshold: number | undefined
  highlighted: boolean
}) {
  return (
    <div
      className={cn(
        'min-w-0 space-y-3 rounded-[var(--radius-md)] border p-4 transition-colors',
        highlighted
          ? method === 'smart'
            ? 'border-accent bg-accent/[0.06]'
            : 'border-naive bg-naive/[0.06]'
          : 'border-border bg-surface',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={method} />
        {result?.not_found ? (
          <span className="rounded-full border border-noise/50 px-2 py-0.5 text-xs text-noise">
            Not found in document
          </span>
        ) : null}
        {highlighted ? <span className="ml-auto text-xs text-muted">Your pick</span> : null}
      </div>
      <AnswerText text={answer} />
      {result ? <AnswerDetails result={result} question={question} threshold={threshold} /> : null}
    </div>
  )
}

function Comparison({ item }: { item: QAItem }) {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const threshold = useAppStore((state) => state.processResult?.settings.not_found_threshold)
  const setQAWinner = useAppStore((state) => state.setQAWinner)
  const cached = recallCompare(docId, item.question)

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel space-y-4 p-4 sm:p-5"
    >
      <h2 className="text-lg font-semibold">{item.question}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <AnswerColumn
          method="naive"
          answer={item.naive_answer}
          result={cached?.naive}
          question={item.question}
          threshold={threshold}
          highlighted={item.winner === 'naive'}
        />
        <AnswerColumn
          method="smart"
          answer={item.smart_answer}
          result={cached?.smart}
          question={item.question}
          threshold={threshold}
          highlighted={item.winner === 'smart'}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <span className="text-sm text-muted">Which answer is better?</span>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={`Vote for: ${item.question}`}
        >
          {WINNER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={item.winner === option.value}
              onClick={() =>
                setQAWinner(item.question, item.winner === option.value ? 'unvoted' : option.value)
              }
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                item.winner === option.value
                  ? option.value === 'smart'
                    ? 'border-accent bg-accent/20 text-fg'
                    : option.value === 'naive'
                      ? 'border-naive bg-naive/20 text-fg'
                      : 'border-fg/40 bg-surface-2 text-fg'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </motion.article>
  )
}

export default function CompareAnswersPage() {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const qaItems = useAppStore((state) => state.qaItems)
  const upsertQAItem = useAppStore((state) => state.upsertQAItem)
  const clearQAItems = useAppStore((state) => state.clearQAItems)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ question: string; error: ApiError } | null>(null)

  const ask = async (raw: string) => {
    const question = raw.trim()
    if (question === '' || pending) return
    setDraft('')
    setFailed(null)
    setPending(question)
    // Follow-ups: the last three compared questions, with the SmartChunk answers (max 6 turns).
    const history: ChatTurn[] = qaItems.slice(-3).flatMap((item) => [
      { role: 'user' as const, content: item.question },
      { role: 'assistant' as const, content: item.smart_answer },
    ])
    try {
      const result = await compare({ doc_id: docId, question, history })
      rememberCompare(docId, question, result)
      const existing = useAppStore.getState().qaItems.find((item) => item.question === question)
      upsertQAItem({
        question,
        smart_answer: result.smart.answer,
        naive_answer: result.naive.answer,
        winner: existing?.winner ?? 'unvoted',
      })
    } catch (error) {
      setFailed({ question, error: toApiError(error) })
    } finally {
      setPending(null)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void ask(draft)
  }

  const voted = qaItems.filter((item) => item.winner !== 'unvoted').length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Answer comparison"
        description="Ask once and both chatbots answer. Only the chunking differs, so any difference in the answers comes from the chunks they were given."
        actions={
          qaItems.length > 0 ? (
            <>
              <Link to={ROUTES.summary} className="btn btn-primary">
                Summarise session ({voted}/{qaItems.length} voted)
              </Link>
              <button type="button" className="btn btn-ghost" onClick={clearQAItems}>
                Clear all
              </button>
            </>
          ) : undefined
        }
      />

      <form
        onSubmit={onSubmit}
        className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
      >
        <label htmlFor="compare-question" className="sr-only">
          Question for both chatbots
        </label>
        <input
          id="compare-question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="For example: What is the time complexity of binary search?"
          className="input flex-1 border-transparent bg-transparent text-base"
        />
        <button
          type="submit"
          className="btn btn-primary px-6"
          disabled={draft.trim() === '' || pending !== null}
        >
          {pending ? 'Asking both…' : 'Ask both'}
        </button>
      </form>

      {failed ? (
        <ErrorState
          compact
          error={failed.error}
          title="The comparison failed"
          onRetry={() => void ask(failed.question)}
        />
      ) : null}

      {pending ? (
        <div className="panel p-4">
          <p className="mb-2 font-semibold">{pending}</p>
          <LoadingState compact label="Both chatbots are retrieving and answering…" />
        </div>
      ) : null}

      {qaItems.length === 0 && !pending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(['naive', 'smart'] as const).map((method) => (
            <div
              key={method}
              className="panel flex min-h-48 flex-col items-center justify-center gap-3 border-dashed p-6 text-center"
            >
              <MethodBadge method={method} />
              <p className="max-w-xs text-sm text-muted">
                {method === 'smart'
                  ? 'Answers from whole code blocks, tables and lists.'
                  : 'Answers from fixed-size windows of the same text.'}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-6">
        <AnimatePresence initial={false}>
          {[...qaItems].reverse().map((item) => (
            <Comparison key={item.question} item={item} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
